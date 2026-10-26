/**
 * A4: cermin pelunasan immediate-first ke BE (/pos/payment) untuk lane
 * QRIS/EDC — paritas mirrorSettleToServer PayScreen (cash lane).
 *
 * Tanpa id server / tanpa padanan enum BE = BLOCKED diam (lokal tetap sah).
 * Immediate gagal (offline/ditolak) = antre GO_OP_SETTLE agar drain
 * memfinalisasi — jujur di SyncScreen, tanpa Success palsu, tanpa kirim buta.
 * P1-2: sesi kas W1 yang diketahui disertakan (atribusi setoran benar);
 * tak diketahui = BE me-resolve sendiri. Tak pernah melempar.
 *
 * Deposits-gate (paritas PayScreen): deposit/member TAK punya padanan
 * enum BE — cermin server DILARANG untuk keduanya (hanya ledger lokal +
 * antre ESB). Transfer MANUAL kini mirrored (APP-9).
 *
 * Grup split: kunjungan grup SENGAJA tak memanggil helper ini — semua
 * kunjungan berbagi SATU client_id rantai (Q7) sehingga immediate ganda
 * berisiko settle-duplikat beda nominal; kunjungan grup mengandalkan drain
 * (create → tautan HP-E2E → GO_OP_SETTLE idempoten).
 */
import { getCashSessionId } from './beWorkforce';
import {
  GO_OP_SETTLE,
  getServerOrderIdForSale,
  mapPayMethodToBe,
  settlePosPayment,
  type SettleResult,
} from './posWire';
import { parseCustomerId } from './memberRef';
import { recordSettleMemberResult } from './memberChangedStore';
import { enqueueSync } from './sync';

export type MirrorSettleInput = {
  salesNum: string;
  methodLabel: string;
  amount: number;
  tip?: number;
  voucherCode?: string;
  clientId?: string;
  /** Ronde-3 Q1/Q2: customerId GO (int) bila member ditempel. */
  customerId?: number;
  /** Ronde-3 Q4: snapshot tampilan member pra-settle (poin/voucher yang
   *  dipajang sebelum bayar; null = tak diketahui = banding dilewati). */
  prevPoints?: number | null;
  prevVouchers?: number | null;
  /** Ronde-3 Q4: dipanggil SEKALI saat immediate settle menjawab (2xx/409
   *  replay = sukses; offline/blocked/ditolak = tak dipanggil). */
  onSettled?: (r: SettleResult & { memberChanged?: boolean }) => void;
  /** APP-9: ref kaki (EDC approval / QRIS refCode) → notes settle. */
  notes?: string;
  /** SESI-FINAL-APP: URL foto bukti bayar (https) — diteruskan aditif ke
   *  settlePosPayment + antrean GO_OP_SETTLE. Absen = perilaku lama. */
  proofUrl?: string;
};

export function mirrorSettleToServer(inp: MirrorSettleInput): void {
  void (async () => {
    try {
      const serverId = await getServerOrderIdForSale(inp.salesNum);
      if (serverId == null) return;
      // A4 deposits-gate: tanpa padanan enum BE = BLOCKED diam.
      const beMethod = mapPayMethodToBe(inp.methodLabel);
      if (!beMethod) return;
      let cashSid: number | undefined;
      try {
        const s = await getCashSessionId();
        const n = parseInt(String(s ?? '').trim(), 10);
        if (Number.isFinite(n) && n > 0) cashSid = n;
      } catch {
        /* abaikan: BE me-resolve */
      }
      const custId = parseCustomerId(inp.customerId);
      // SESI-FINAL-APP: proofUrl https ≤2048 diteruskan aditif (lainnya =
      // dihilangkan; settle jalan, BE menolak jujur bila diwajibkan).
      // APP-9: ref kaki ikut sebagai notes.
      const proofClean = /^https:\/\/.{1,2040}$/i.test(String(inp.proofUrl ?? '').trim())
        ? String(inp.proofUrl ?? '').trim().slice(0, 2048)
        : '';
      const notesClean = String(inp.notes ?? '').trim().slice(0, 500);
      const res = await settlePosPayment({
        serverId,
        method: beMethod,
        amountPaid: inp.amount,
        ...(inp.tip && inp.tip > 0 ? { tipAmount: inp.tip } : {}),
        ...(inp.voucherCode ? { voucherCode: inp.voucherCode } : {}),
        ...(notesClean ? { notes: notesClean } : {}),
        ...(custId != null ? { customerId: custId } : {}),
        ...(inp.clientId ? { idempotencyKey: inp.clientId } : {}),
        ...(cashSid ? { cashSessionId: cashSid } : {}),
        ...(proofClean ? { proofUrl: proofClean } : {}),
      });
      if (res.ok || res.reason === 'blocked') {
        if (res.ok) {
          // Q4: snapshot pra vs block pasca → banner persisten; view
          // minimal Q3 disimpan untuk Success/struk. Fire-and-forget.
          let changed = false;
          try {
            const r = await recordSettleMemberResult(
              inp.salesNum,
              res.data,
              {
                customerId: custId,
                pointsBalance:
                  inp.prevPoints == null || !Number.isFinite(Number(inp.prevPoints))
                    ? null
                    : Math.round(Number(inp.prevPoints)),
                vouchersValid:
                  inp.prevVouchers == null || !Number.isFinite(Number(inp.prevVouchers))
                    ? null
                    : Math.round(Number(inp.prevVouchers)),
              },
            );
            changed = r.changed;
          } catch {
            /* best-effort */
          }
          try {
            inp.onSettled?.({ ...res.data, memberChanged: changed });
          } catch {
            /* callback UI best-effort */
          }
        }
        return;
      }
      try {
        enqueueSync('other', {
          op: GO_OP_SETTLE,
          serverId,
          method: beMethod,
          amountPaid: inp.amount,
          ...(inp.tip && inp.tip > 0 ? { tipAmount: inp.tip } : {}),
          ...(inp.voucherCode ? { voucherCode: inp.voucherCode } : {}),
          ...(notesClean ? { notes: notesClean } : {}),
          ...(custId != null ? { customerId: custId } : {}),
          ...(inp.clientId ? { clientId: inp.clientId } : {}),
          ...(cashSid ? { cashSessionId: cashSid } : {}),
          ...(proofClean ? { proofUrl: proofClean } : {}),
          salesNum: inp.salesNum,
          at: new Date().toISOString(),
        });
      } catch {
        /* antrean belum siap */
      }
    } catch {
      /* abaikan: sale lokal tetap sah */
    }
  })();
}
