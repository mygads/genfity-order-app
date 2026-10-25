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
 * Deposits-gate (paritas PayScreen): deposit/member/transfer TAK punya
 * padanan enum BE — cermin server DILARANG untuk ketiganya (hanya ledger
 * lokal + antre ESB).
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
} from './posWire';
import { enqueueSync } from './sync';

export type MirrorSettleInput = {
  salesNum: string;
  methodLabel: string;
  amount: number;
  tip?: number;
  voucherCode?: string;
  clientId?: string;
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
      const res = await settlePosPayment({
        serverId,
        method: beMethod,
        amountPaid: inp.amount,
        ...(inp.tip && inp.tip > 0 ? { tipAmount: inp.tip } : {}),
        ...(inp.voucherCode ? { voucherCode: inp.voucherCode } : {}),
        ...(inp.clientId ? { idempotencyKey: inp.clientId } : {}),
        ...(cashSid ? { cashSessionId: cashSid } : {}),
      });
      if (res.ok || res.reason === 'blocked') return;
      try {
        enqueueSync('other', {
          op: GO_OP_SETTLE,
          serverId,
          method: beMethod,
          amountPaid: inp.amount,
          ...(inp.tip && inp.tip > 0 ? { tipAmount: inp.tip } : {}),
          ...(inp.voucherCode ? { voucherCode: inp.voucherCode } : {}),
          ...(inp.clientId ? { clientId: inp.clientId } : {}),
          ...(cashSid ? { cashSessionId: cashSid } : {}),
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
