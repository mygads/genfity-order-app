/**
 * Simpan penjualan lunas ke SQLite (kontrak §5 + aturan Lampiran B, identitas
 * Q7 SPEC §12: client_id UUIDv7 + nomor display tersegmen).
 * Dipanggil dari PayScreen.goSuccess - FAIL-CLOSED: saveSale MELEMPAR bila
 * COMMIT transaksi gagal (tanpa swallow-and-return); antrean ringan
 * `recordSale` (src/lib/payments.ts) sudah di-flush pemanggil SEBELUM saveSale
 * sehingga kasir tetap bisa push walau DB lokal gagal. SATU pengecualian
 * pra-tulis fail-closed: device unbound (branch/terminal kosong) melempar
 * SEBELUM tulis apa pun (tanpa fallback B001). Baris ditulis dengan
 * syncDate NULL (= kotor) agar ikut push berikutnya; pengiriman
 * server tetap lewat antrean ringan `recordSale` (src/lib/payments.ts).
 */
import { getBranchId, getTerminal, ApiPath } from '../config/server';
import { getSession } from '../session';
import { initDb, query, queryFirst, run, withTransaction } from './db';
import { dbNowLocal } from './datefmt';
import { enqueueOutbox, enqueueOutboxPhysical, enqueueSync } from './sync';
import { apiFetch } from './apiSource';
import { lineSubtotal, normalizeMethod, normalizeSalesMode, type SaleInput } from './payments';
import { uuidv7 } from './uuidv7';
import { getItem, setItem } from './storage';
import * as DisplayBus from './display';

const r = (n: number) => Math.round(n);

function uid(_prefix: string): string {
  // UUIDv7 (Q7): semua id baris anak (sm/se/sp/dep/sv/si/kitchen/payment)
  // merge-safe lintas-device. Prefix debug lama dibuang — kolom TEXT muat 36-char.
  // P14: uuidv7 melempar jujur bila CSPRNG tak tersedia — teruskan (jangan
  // fallback Math.random) agar withTransaction rollback + L1-throw
  // meneruskannya ke pemanggil; baris anak tak boleh lahir tanpa id aman.
  try {
    return uuidv7();
  } catch (e) {
    throw new Error(
      `id transaksi tak bisa diterbitkan (${e instanceof Error ? e.message : 'CSPRNG gagal'})`,
    );
  }
}

/**
 * Backstop voucher di choke point saveSale (temuan audit #1/#2 + #16b): cek
 * status/kuota/jendela/nominal/minSpend langsung ke ms_voucher, lalu fallback
 * ke ms_promotion (promo reusable: flagActive=1 + jendela + value>0, tanpa
 * kuota). Semantik cermin validateVoucherCodeLocal (apiSource.ts) + totals()
 * (#16): status harus 'available', quota > 0, amount > 0, dalam jendela
 * validFrom/validTo (banding string waktu LOKAL via dbNowLocal), dan
 * gross >= minSpend (base = jumlah kotor per baris SEBELUM diskon item —
 * cermin subtotalGross CashierScreen; tanpa ongkir/pajak/service).
 * ms_voucher TAK punya kolom minSpend (server tak mengirimnya — pull voucher
 * di master.ts tanpa minSpend), jadi voucher kuota tak kena gate belanja;
 * gate minSpend hanya berlaku untuk promo. Kode promo tercatat di kolom
 * voucherCode yang sama; UPDATE kuota di bawah no-op untuknya karena baris
 * ms_voucher-nya tak ada. Query gagal (DB glitch) = fail-open (perilaku
 * lama) agar kasir tak terblokir; data tak-valid = {ok:false}.
 * Selalu initDb dulu karena dipanggil sebelum/sesudah initDb pemanggil.
 * Diekspor untuk seed.ts (L9: seed unbound memakai backstop yang sama agar
 * pemakaian voucher contoh tetap membakar kuota secara jujur).
 */
export async function assertVoucherUsable(code: string, base: number): Promise<{ ok: boolean; amount: number }> {
  const fail = { ok: false, amount: 0 };
  const c = String(code ?? '').trim();
  if (!c) return fail;
  const baseR = Math.max(0, Math.round(Number(base) || 0));
  try {
    await initDb();
    const row = await queryFirst<{
      amount: number | null;
      quota: number | null;
      validFrom: string | null;
      validTo: string | null;
      status: string | null;
    }>(
      `SELECT amount, quota, validFrom, validTo, status FROM ms_voucher
       WHERE UPPER(voucherCode) = UPPER(?) LIMIT 1`,
      [c],
    );
    const now = dbNowLocal();
    if (row) {
      if ((row.status ?? '').toLowerCase() !== 'available') return fail;
      if (Math.round(Number(row.quota) || 0) <= 0) return fail;
      const amt = Math.max(0, Math.round(Number(row.amount) || 0));
      if (amt <= 0) return fail;
      if (row.validFrom && row.validFrom > now) return fail;
      if (row.validTo && row.validTo < now) return fail;
      return { ok: true, amount: amt };
    }
    // Bukan voucher kuota: coba promo reusable (seed HEMAT10/ONGKIR10 hanya
    // ada di ms_promotion — tanpa fallback, diskonnya nol diam-diam saat simpan).
    const promo = await queryFirst<{
      promoType: string | null;
      value: number | null;
      maxAmount: number | null;
      minSpend: number | null;
      validFrom: string | null;
      validTo: string | null;
      flagActive: number | null;
    }>(
      `SELECT promoType, value, maxAmount, minSpend, validFrom, validTo, flagActive
       FROM ms_promotion WHERE UPPER(promoCode) = UPPER(?) LIMIT 1`,
      [c],
    );
    if (!promo || Number(promo.flagActive ?? 0) !== 1) return fail;
    if (promo.validFrom && promo.validFrom > now) return fail;
    if (promo.validTo && promo.validTo < now) return fail;
    const pType = String(promo.promoType ?? 'nominal').toLowerCase();
    const pValue = Math.max(0, Math.round(Number(promo.value) || 0));
    const pCap = Math.max(0, Math.round(Number(promo.maxAmount ?? pValue) || 0));
    // Persen: amount = cap nominal (selaras PromotionList + totals() via rate).
    const pAmt = pType === 'percent' ? pCap : pValue;
    if (pAmt <= 0) return fail;
    // Gate minSpend cermin totals() meetsMin (gross >= minSpend lolos; gagal =
    // voucher diabaikan total termasuk ongkirCut). Voucher kuota tak punya
    // data minSpend sehingga selalu lolos gate ini.
    const pMin = Math.max(0, Math.round(Number(promo.minSpend) || 0));
    if (pMin > 0 && baseR < pMin) return fail;
    return { ok: true, amount: pAmt };
  } catch {
    return { ok: true, amount: 0 };
  }
}

// S2-C310: definisi nomor-display + gate terminal pindah ke salesNum.ts agar
// sync.ts tak perlu mengimpor sales.ts (pecah require-cycle sales ↔ sync).
// Impor untuk pemakaian internal (saveSale, appendGroupPayment, moveSaleItems)
// + ekspor-ulang demi kompatibilitas importir lama (layar kasir/POS, seed).
import { isTerminalBound, nextDisplayNumber, nextSalesNum, nextSalesNumRetry, normalizeTerminalCode, TERMINAL_CODE_RE } from './salesNum';
export { isTerminalBound, nextDisplayNumber, nextSalesNum, nextSalesNumRetry, normalizeTerminalCode, TERMINAL_CODE_RE } from './salesNum';

// Galat gate unbound privat modul ini (cermin milik salesNum.ts yang juga
// privat — tak diekspor agar tak ada ketergantungan balik sales ↔ salesNum).
function terminalUnboundError(): Error {
  const e = new Error('Terminal belum diklaim - klaim terminal dulu sebelum jualan.');
  (e as { code?: string }).code = 'terminal-unbound';
  return e;
}

/**
 * Backfill client_id untuk baris lama yang masih NULL (satu UUIDv7 per baris,
 * salesNum TIDAK diubah). Normalnya tak ada kerja: migrasi skema sudah
 * mengisi client_id = salesNum untuk instalasi lama. Best-effort, tak pernah
 * melempar; mengembalikan jumlah baris yang diisi.
 */
export async function backfillSaleClientIds(): Promise<number> {
  try {
    await initDb();
    const rows = await query<{ salesNum: string | null }>(
      'SELECT salesNum FROM tr_saleshead WHERE client_id IS NULL',
    );
    let n = 0;
    for (const row of rows) {
      const no = String(row?.salesNum ?? '').trim();
      if (!no) continue;
      try {
        await run(
          'UPDATE tr_saleshead SET client_id = ? WHERE salesNum = ? AND client_id IS NULL',
          [uuidv7(), no],
        );
        n += 1;
      } catch {
        /* baris bentrok - lanjut */
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * Payload QR pembayaran (APP-PRINTER-SALES, audit row 12-parsial/Q7): QR
 * struk/display MEMBAWA client_id UUIDv7 (kunci upsert server) + nomor display
 * + total. Bentuk JSON ringkas agar muat di QR kecil struk 58mm.
 */
export function buildSaleQrPayload(clientId: string, salesNum: string, total?: number): string {
  const cid = String(clientId ?? '').trim();
  const no = String(salesNum ?? '').trim();
  return JSON.stringify({
    client_id: cid,
    salesNum: no,
    ...(total === undefined ? {} : { total: Math.max(0, Math.round(Number(total) || 0)) }),
  });
}

/**
 * Ambil client_id head dari DB (APP-PRINTER-SALES: rantai Pay→Qris/Edc→
 * Success→Receipt memakai ulang SATU client_id agar QR tak basi).
 * Null bila head belum ada (belum saveSale pertama).
 */
export async function getSaleClientId(salesNum: string): Promise<string | null> {
  const no = String(salesNum ?? '').trim();
  if (!no) return null;
  try {
    await initDb();
    const row = await queryFirst<{ client_id: string | null }>(
      'SELECT client_id FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
      [no],
    );
    const cid = String(row?.client_id ?? '').trim();
    return cid || null;
  } catch {
    return null;
  }
}

/**
 * Rantai idempotency bayar (P0-4): SATU chainClientId per salesNum, dipersist
 * ke storage SEBELUM saveSale pertama agar SEMUA retry/drain memakai kunci
 * yang sama (bukan uuidv7 baru tiap ketukan). Format kunci baru:
 * `payment-{orderId}-{uuidv7}`.
 * Urutan menang: seed params/head (kunci lama uuidv7 mentah TETAP sah untuk
 * rantai ini — stabilitas lebih penting dari format) → simpanan rantai →
 * terbitkan baru + simpan. Tak pernah melempar (fallback uuidv7 mentah).
 */
const LS_PAY_CHAIN = 'genfity.paychain.';

function payChainName(salesNum: string): string {
  return `${LS_PAY_CHAIN}${String(salesNum ?? '').trim()}`;
}

/** Terbitkan kunci rantai baru format `payment-{orderId}-{uuidv7}`. */
export function buildPayChainId(salesNum: string): string {
  return `payment-${String(salesNum ?? '').trim()}-${uuidv7()}`;
}

/** True bila v sudah berupa kunci rantai nomor ini (format baru). */
export function isPayChainIdFor(v: string, salesNum: string): boolean {
  const s = String(v ?? '').trim();
  const no = String(salesNum ?? '').trim();
  return !!s && !!no && s.startsWith(`payment-${no}-`) && s.length > `payment-${no}-`.length;
}

export async function getOrCreatePayChainId(salesNum: string, seed?: string): Promise<string> {
  const no = String(salesNum ?? '').trim();
  const cleanSeed = String(seed ?? '').trim();
  if (!no) return cleanSeed || uuidv7();
  const name = payChainName(no);
  // Seed params/head menang (stabil untuk rantai ini) lalu dipersist agar
  // retry berikutnya + drain membaca kunci yang sama.
  if (cleanSeed) {
    try {
      await setItem(name, cleanSeed);
    } catch {
      /* abaikan: kunci tetap dipakai untuk panggilan ini */
    }
    return cleanSeed;
  }
  try {
    const head = await getSaleClientId(no);
    if (head) {
      try {
        await setItem(name, head);
      } catch {
        /* abaikan */
      }
      return head;
    }
  } catch {
    /* abaikan: lanjut ke simpanan */
  }
  try {
    const stored = await getItem(name);
    const st = String(stored ?? '').trim();
    if (st) return st;
  } catch {
    /* abaikan: terbitkan baru */
  }
  const fresh = buildPayChainId(no);
  try {
    await setItem(name, fresh);
  } catch {
    /* abaikan: kunci tetap dipakai untuk panggilan ini */
  }
  return fresh;
}

/**
 * Ambil tip tersimpan satu head (fitur tip v1, 2026-10): dipakai layar riwayat
 * agar cetak-ulang struk menampilkan baris Tip (cermin getSaleClientId di atas).
 * 0 bila head tak ada / kolom belum migrasi di instalasi lama.
 */
export async function getSaleTip(salesNum: string): Promise<number> {
  const no = String(salesNum ?? '').trim();
  if (!no) return 0;
  try {
    await initDb();
    const row = await queryFirst<{ tip: number | null }>(
      'SELECT tip FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
      [no],
    );
    return Math.max(0, Math.round(Number(row?.tip) || 0));
  } catch {
    return 0;
  }
}

/**
 * Nomor antrean display dari suffix NNNN salesNum (TRX-{BR}-{TM}-{YMD}-{NNNN}[-A|B]).
 * Nomor non-segmen (SEED-xxx, TRX-{timestamp}) → null (display fallback).
 */
export function queueNoOf(salesNum: string): string | null {
  const m = /-(\d+)(-[AB])?$/.exec(String(salesNum ?? '').trim());
  return m ? m[1] : null;
}

/**
 * Stasiun kerja satu menu untuk kolom tr_salesmenu.stationId (L17, read-only):
 * cermin pola baca routing print (MenuManagementScreen: SELECT qty, stationId
 * FROM ms_branchmenu WHERE branchId = ? AND menuId = ?) lalu fallback
 * ms_menu.stationId. Null bila tak ketemu — penjualan tetap sah, tiket dapur
 * memakai rute default sisi layar dapur.
 */
async function lookupMenuStation(menuId: string, branch: string): Promise<string | null> {
  const id = String(menuId ?? '').trim();
  if (!id) return null;
  try {
    const b = await queryFirst<{ stationId: string | null }>(
      'SELECT stationId FROM ms_branchmenu WHERE branchId = ? AND menuId = ? LIMIT 1',
      [branch, id],
    );
    const s1 = String(b?.stationId ?? '').trim();
    if (s1) return s1;
    const m = await queryFirst<{ stationId: string | null }>(
      'SELECT stationId FROM ms_menu WHERE id = ? LIMIT 1',
      [id],
    );
    const s2 = String(m?.stationId ?? '').trim();
    return s2 || null;
  } catch {
    return null;
  }
}

/** Tulis head + item + pembayaran dari payload tier-penuh. */
export async function saveSale(s: SaleInput): Promise<string> {
  // Gate bound (Q7): device belum ter-bound dilarang bikin sale. nextSalesNum
  // ikut melempar kode yang sama; pemanggil UI (Pay/Qris/Edc) menangkap
  // 'terminal-unbound' menjadi pesan klaim-terminal (bukan Success).
  if (!isTerminalBound()) throw terminalUnboundError();
  // L2: penerbitan nomor di-retry terbatas (tabrakan PK antar-device).
  const salesNum = s.salesNum ?? (await nextSalesNumRetry());
  // client_id UUIDv7 (Q7): diterbitkan sekali per sale, kunci rekonsiliasi
  // server (upsert by client_id) + payload QR + Idempotency-Key push.
  // P14: kegagalan CSPRNG melempar jujur (tanpa id bisu) — pra-tulis sehingga
  // aman: belum ada baris yang ditulis saat ini melempar.
  let clientId: string;
  try {
    clientId = s.clientId ?? uuidv7();
  } catch (e) {
    throw new Error(
      `client_id tak bisa diterbitkan (${e instanceof Error ? e.message : 'CSPRNG gagal'})`,
    );
  }
  const now = new Date().toISOString();
  const t = getTerminal();
  const sess = getSession();
  const cashier = sess?.name ?? '';
  const cashierId = (sess?.userId ?? '').trim();
  const branchId = t.branchId || getBranchId();
  const items = s.items ?? [];
  const subtotal = s.subtotal ?? items.reduce((a, it) => a + lineSubtotal(it), 0);
  let payments = s.payments?.length
    ? s.payments
    : [{ method: s.method, amount: s.grandTotal }];
  let paid = payments.reduce((a, p) => a + p.amount, 0);
  // Status lunas otomatis: bayar penuh (semua alur lama tak berubah) = 'paid';
  // bayar sebagian (cicilan split bill grup) = 'open' hingga appendGroupPayment
  // menggenapi. Grand 0 = lunas trivial.
  // `let`: backstop deposit over-saldo di dalam transaksi bisa meng-clamp kaki
  // deposit lalu menghitung ulang keduanya agar ledger == head.
  let headStatus: string = r(s.grandTotal) > 0 && paid < r(s.grandTotal) ? 'open' : 'paid';
  // Porsi voucher murni = diskon head - diskon per-item. Pemanggil Pay mengirim
  // gabungan keduanya di discountTotal; tanpa pemisah, nominal voucher di head
  // + usage ter-overstate sebesar diskon item (bug G5).
  const itemDiscSum = r(items.reduce((a, it) => a + r(it.discount ?? 0), 0));
  // Basis minSpend (#16b): gross cermin totals()/CashierScreen subtotalGross —
  // jumlah kotor per baris SEBELUM diskon item/voucher, tanpa ongkir/pajak/
  // service. Dihitung dari items (bukan s.subtotal pemanggil) agar seragam.
  const grossBase = r(
    items.reduce(
      (a, it) => a + (it.basePrice + (it.modifiers ?? []).reduce((m, x) => m + x.price, 0)) * it.qty,
      0,
    ),
  );
  // Backstop voucher head (#2): kode tak-valid (status/kuota/jendela/
  // nominal/minSpend) = usage 'rejected', voucherAmt 0, tanpa burn. Penjualan
  // tetap sah (fail-closed hanya untuk vouchernya, bukan kasirnya).
  let headVoucherOk = false;
  if (s.voucherCode) {
    headVoucherOk = (await assertVoucherUsable(s.voucherCode, grossBase)).ok;
  }
  // Representasi voucher (L7/L8): kolom head `discount` = SEMUA potongan
  // belanja (diskon order + voucher); `voucherAmount` = SUBSET porsi voucher
  // saja untuk pelaporan — pembaca JANGAN menjumlahkan keduanya. Bila
  // pemanggil mengirim voucherAmount eksplisit + kode voucher (jalur Pay
  // pasca-split yang memisah keduanya), pakai nilai eksplisit itu; selainnya
  // turunkan dari discountTotal − diskon item (cermin bug G5).
  const rawExplicitVoucher = (s as unknown as { voucherAmount?: unknown }).voucherAmount;
  const voucherAmt = !headVoucherOk
    ? 0
    : typeof rawExplicitVoucher === 'number' && Number.isFinite(rawExplicitVoucher)
      ? r(Math.max(0, rawExplicitVoucher))
      : r(Math.max(0, (s.discountTotal ?? 0) - itemDiscSum));
  await initDb();
  // Q7: jaring pengaman baris lama ber-client_id NULL (migrasi skema sudah
  // backfill client_id = salesNum; helper ini best-effort, tak melempar).
  await backfillSaleClientIds();
  // Transaksi atomik (#22): head + item + payment + stok + voucher + deposit +
  // dapur + outbox fisik = semua-atau-tidak-sama-sekali. Kill tepat di tengah
  // tulis tak lagi menyisakan struk setengah (head tanpa item dsb).
  // Antrean ringan (AsyncStorage) TIDAK ikut transaksi: dikumpulkan di
  // postCommit lalu di-flush hanya bila COMMIT berhasil.
  const postCommit: Array<() => void> = [];
  let committed = false;
  try {
  await withTransaction(async () => {
  // Backstop deposit over-saldo: baca saldo DALAM transaksi lalu clamp total
  // kaki deposit ke saldo saat simpan. UI Pay (onDepositLanjut) sudah cap di
  // saldo live, tapi saldo bisa berubah di antara pilih dan simpan; tanpa
  // clamp, kaki tercatat penuh sementara saldo hanya terdebit `take` ->
  // paidAmount overstate + status 'paid' hantu. Sisa otomatis jadi 'open'
  // untuk ditagih via appendGroupPayment. Blok debit di bawah memakai
  // payments yang sudah di-clamp sehingga take == depUsed.
  if (s.memberId) {
    const isDep = (m: unknown): boolean => /deposit/i.test(String(m ?? ''));
    const depSum = payments.reduce((a, p) => a + (isDep(p.method) ? r(p.amount) : 0), 0);
    if (depSum > 0) {
      try {
        const cur = await queryFirst<{ depositBalance: number | null }>(
          'SELECT depositBalance FROM ms_member WHERE id = ? LIMIT 1',
          [s.memberId],
        );
        let take = Math.min(Math.max(0, Math.round(Number(cur?.depositBalance) || 0)), depSum);
        for (let i = 0; i < payments.length; i += 1) {
          if (!isDep(payments[i].method)) continue;
          const amt = r(payments[i].amount);
          const keep = Math.min(amt, take);
          take -= keep;
          if (keep !== amt) payments[i] = { ...payments[i], amount: keep };
        }
        // Buang kaki deposit yang jadi nol (kaki non-deposit nol tetap ditulis
        // seperti perilaku lama).
        payments = payments.filter((p) => !isDep(p.method) || r(p.amount) > 0);
        paid = payments.reduce((a, p) => a + p.amount, 0);
        headStatus = r(s.grandTotal) > 0 && paid < r(s.grandTotal) ? 'open' : 'paid';
      } catch {
        /* baca saldo gagal - biarkan apa adanya, blok debit best-effort */
      }
    }
  }
  // Atribusi shift (#18): head.shiftId = shift terbuka cabang ini (bila ada).
  // Tanpa shift terbuka = NULL yang jujur (kasir mode bebas/demo).
  let shiftId: string | null = null;
  try {
    const open = await queryFirst<{ id: string | null }>(
      `SELECT id FROM tr_shiftlog WHERE status = 'open'
       AND (branchId = ? OR branchId IS NULL OR branchId = '') ORDER BY clockIn DESC LIMIT 1`,
      [branchId],
    );
    shiftId = open?.id ? String(open.id) : null;
  } catch {
    /* abaikan */
  }
  // Mode/ongkir/customer + rincian pajak/service/voucher ikut tersimpan agar
  // struk ulang dan push server konsisten dengan rumus kasir kanonik.
  // queueNumber ditulis saat lahir agar display antrean punya nomor pendek
  // (sebelumnya kolom ada tapi tak pernah diisi → fallback salesNum penuh).
  const queueNumber = (s.queueNumber ?? '').trim() || queueNoOf(salesNum);
  await run(
    `INSERT INTO tr_saleshead (salesNum, client_id, branchId, terminalId, userId, shiftId, salesDate,
      salesMode, subtotal, discount, tax, serviceCharge, tip, platformFee, rounding,
      voucherAmount, voucherCode,
      grandTotal, paidAmount, changeAmount,
      paymentMethod, memberId, tableNo, customerName, ongkir,
      status, queueNumber, cashierName, createdAt, updatedAt, syncDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      salesNum, clientId, branchId, t.terminalCode || null, cashierId || null, shiftId, now,
      s.mode ? normalizeSalesMode(s.mode) : 'DINE_IN',
      r(subtotal), r(s.discountTotal ?? 0),
      r(s.vatTotal ?? 0), r(s.serviceTotal ?? 0), r(s.tipTotal ?? 0),
      r(s.feeESB ?? 0), Math.round(Number(s.rounding) || 0),
      voucherAmt, s.voucherCode ?? null,
      r(s.grandTotal), r(paid),
      r(s.change ?? Math.max(0, paid - s.grandTotal)), normalizeMethod(payments[0]?.method ?? s.method),
      s.memberId ?? null, s.tableId ?? null, s.customer ?? null, r(s.ongkir ?? 0),
      headStatus, queueNumber, cashier, now, now,
    ],
  );
  for (const it of items) {
    // Id baris dipakai ulang sebagai salesMenuId extras agar move/split
    // menemukan addon-nya (sebelumnya extras menunjuk id cart -> orphan).
    const smId = uid('sm');
    // L17: stationId ditulis saat lahir dari master (lookup di atas).
    const station = await lookupMenuStation(it.id, branchId);
    await run(
      `INSERT INTO tr_salesmenu (id, salesNum, client_id, menuId, menuName, qty, price,
        discount, subtotal, note, stationId, status, syncDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'served', NULL, ?)`,
      [
        smId, salesNum, clientId, it.id, it.name, it.qty, r(it.basePrice),
        r(it.discount ?? 0), r(lineSubtotal(it)),
        it.note ?? null, station, now,
      ],
    );
    for (const m of it.modifiers ?? []) {
      await run(
        `INSERT INTO tr_salesmenuextra (id, salesMenuId, salesNum, client_id, extraId,
          extraName, qty, price, subtotal, syncDate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [uid('se'), smId, salesNum, clientId, m.name, m.name, it.qty, r(m.price), r(m.price * it.qty)],
      );
    }
    // Stok cabang ikut turun per item terjual (qty NULL = tak dilacak, tak
    // diubah); tembus <= 0 otomatis flagSoldOut agar kasir + alert low-stock
    // Dashboard konsisten (paritas logika StockScreen; opt allowSellEmpty
    // bisa membuka lagi dari layar Stok). Custom-menu (tanpa baris
    // branchmenu) tak kena apa-apa.
    try {
      const branch = branchId;
      const soldQty = Math.max(0, Math.round(Number(it.qty) || 0));
      if (branch && it.id && soldQty > 0) {
        await run(
          `UPDATE ms_branchmenu SET qty = qty - ?, syncDate = NULL
            WHERE branchId = ? AND menuId = ? AND qty IS NOT NULL`,
          [soldQty, branch, it.id],
        );
        await run(
          `UPDATE ms_branchmenu SET flagSoldOut = 1, syncDate = NULL
            WHERE branchId = ? AND menuId = ? AND qty IS NOT NULL AND qty <= 0
              AND (flagSoldOut IS NULL OR flagSoldOut = 0)`,
          [branch, it.id],
        );
        try {
          await enqueueOutboxPhysical('ms_branchmenu', `${branch}:${it.id}`, 'update');
        } catch {
          /* abaikan */
        }
      }
    } catch {
      /* stok gagal turun - penjualan tetap sah, selisih terlihat di Stok */
    }
  }
  // Backstop voucher tender (#1): tiap kode voucher di kaki bayar
  // divalidasi ke ms_voucher. Yang tak-valid = usage 'rejected', tanpa burn,
  // kode dicoret dari refNo (nominal kaki tetap tercatat sebagai jejak audit
  // kasir). Kode yang sama dengan head cukup dibakar sekali via head.
  const headCodeU = String(s.voucherCode ?? '').trim().toUpperCase();
  const legCodes: string[] = [];
  for (const p of payments) {
    const c = String(p.voucherCode ?? '').trim();
    if (c && c.toUpperCase() !== headCodeU && !legCodes.some((x) => x.toUpperCase() === c.toUpperCase())) {
      legCodes.push(c);
    }
  }
  const rejectedLegs = new Set<string>();
  const burnedLegs: { code: string; amount: number }[] = [];
  for (const c of legCodes) {
    const chk = await assertVoucherUsable(c, grossBase);
    if (chk.ok) burnedLegs.push({ code: c, amount: chk.amount });
    else rejectedLegs.add(c.toUpperCase());
  }
  // Tendered/kembalian per kaki: kaki awal exact (sebesar porsinya), kaki
  // TERAKHIR menyerap sisa (tunai yang diserahkan bisa melebihi porsi kaki
  // terakhir) + seluruh kembalian. Sebelumnya tiap baris membawa cash grand
  // + change penuh sehingga tendered/change ter-overstate N kali lipat.
  const cashTotal = s.cash ?? paid;
  let tenderAcc = 0;
  let pi = 0;
  for (const p of payments) {
    const isLast = pi === payments.length - 1;
    const legTendered = isLast ? Math.max(0, Math.round(cashTotal - tenderAcc)) : r(p.amount);
    const legChange = isLast ? r(s.change ?? 0) : 0;
    // Kode tender yang di-reject backstop tak ditulis ke refNo.
    const legV = String(p.voucherCode ?? '').trim();
    const legVKept = legV && !rejectedLegs.has(legV.toUpperCase()) ? legV : null;
    await run(
      `INSERT INTO tr_salespayment (id, salesNum, client_id, paymentMethod, amount,
        tendered, changeAmount, refNo, syncDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        uid('sp'), salesNum, clientId, p.method, r(p.amount), legTendered,
        legChange, p.approvalCode ?? legVKept, now,
      ],
    );
    tenderAcc += r(p.amount);
    pi += 1;
  }
  // Bayar pakai deposit: saldo member ikut turun + ledger withdraw + outbox/
  // sync. Tanpa ini saldo tak pernah berkurang dan deposit bisa dipakai ulang
  // tanpa batas (bug G1). Best-effort: penjualan tetap sah bila gagal.
  const depUsed = r(
    payments
      .filter((p) => /deposit/i.test(p.method ?? ''))
      .reduce((a, p) => a + r(p.amount), 0),
  );
  // L4: kaki deposit tanpa member = melempar (paritas appendGroupPayment) —
  // di dalam transaksi sehingga rollback; jangan diam-diam lewati debit.
  if (depUsed > 0 && !s.memberId) throw new Error('Deposit butuh member');
  if (depUsed > 0 && s.memberId) {
    try {
      const cur = await queryFirst<{ depositBalance: number | null }>(
        'SELECT depositBalance FROM ms_member WHERE id = ? LIMIT 1',
        [s.memberId],
      );
      const before = Math.max(0, Math.round(Number(cur?.depositBalance) || 0));
      const take = Math.min(before, depUsed);
      const after = before - take;
      await run('UPDATE ms_member SET depositBalance = ?, syncDate = NULL WHERE id = ?', [after, s.memberId]);
      try {
        await enqueueOutboxPhysical('ms_member', s.memberId, 'update');
      } catch {
        /* abaikan */
      }
      const depId = uid('dep');
      await run(
        `INSERT INTO tr_memberdeposit (id, memberId, branchId, trxType, amount, balanceAfter, userId, trxDate, syncDate)
         VALUES (?, ?, ?, 'withdraw', ?, ?, ?, ?, NULL)`,
        [depId, s.memberId, branchId || null, take, after, cashierId || null, now],
      );
      try {
        await enqueueOutboxPhysical('tr_memberdeposit', depId, 'insert');
        postCommit.push(() => enqueueSync('other', { table: 'tr_memberdeposit', rowId: depId, op: 'insert' }));
      } catch {
        /* abaikan */
      }
      try {
        postCommit.push(() => enqueueSync('other', { kind: 'deposit-withdraw', memberId: s.memberId, nominal: take }));
      } catch {
        /* abaikan */
      }
    } catch {
      /* saldo gagal turun - penjualan tetap sah, selisih terlihat di Member */
    }
  }
  if (s.voucherCode) {
    if (headVoucherOk) {
      await run(
        `INSERT INTO tr_salesvoucherusage (id, salesNum, client_id, voucherCode, voucherAmount, status, syncDate)
         VALUES (?, ?, ?, ?, ?, 'burn', NULL)`,
        [uid('sv'), salesNum, clientId, s.voucherCode, voucherAmt],
      );
      // Kuota lokal ikut turun agar voucher tak bisa dipakai ulang offline;
      // syncDate NULL menandai perubahan untuk push berikutnya.
      await run(
        `UPDATE ms_voucher SET quota = quota - 1, syncDate = NULL
          WHERE UPPER(voucherCode) = UPPER(?) AND quota > 0`,
        [s.voucherCode],
      );
      // Kuota tembus 0 = hangus/ludes: tandai used agar tak bisa dipakai ulang
      // offline (daftar voucher menyembunyikan yang terpakai).
      await run(
        `UPDATE ms_voucher SET status = 'used', syncDate = NULL
          WHERE UPPER(voucherCode) = UPPER(?) AND quota IS NOT NULL AND quota <= 0
            AND (status IS NULL OR status = 'available')`,
        [s.voucherCode],
      );
    } else {
      // Head tak-valid: catat penolakan untuk audit, kuota tak tersentuh.
      await run(
        `INSERT INTO tr_salesvoucherusage (id, salesNum, client_id, voucherCode, voucherAmount, status, syncDate)
         VALUES (?, ?, ?, ?, 0, 'rejected', NULL)`,
        [uid('sv'), salesNum, clientId, s.voucherCode],
      );
    }
  }
  // Usage kaki tender: yang valid dibakar (+kuota turun), yang tak-valid
  // dicatat 'rejected' tanpa sentuh kuota.
  for (const b of burnedLegs) {
    await run(
      `INSERT INTO tr_salesvoucherusage (id, salesNum, client_id, voucherCode, voucherAmount, status, syncDate)
       VALUES (?, ?, ?, ?, ?, 'burn', NULL)`,
      [uid('sv'), salesNum, clientId, b.code, b.amount],
    );
    await run(
      `UPDATE ms_voucher SET quota = quota - 1, syncDate = NULL
        WHERE UPPER(voucherCode) = UPPER(?) AND quota > 0`,
      [b.code],
    );
    await run(
      `UPDATE ms_voucher SET status = 'used', syncDate = NULL
        WHERE UPPER(voucherCode) = UPPER(?) AND quota IS NOT NULL AND quota <= 0
          AND (status IS NULL OR status = 'available')`,
      [b.code],
    );
  }
  for (const c of legCodes) {
    if (!rejectedLegs.has(c.toUpperCase())) continue;
    await run(
      `INSERT INTO tr_salesvoucherusage (id, salesNum, client_id, voucherCode, voucherAmount, status, syncDate)
       VALUES (?, ?, ?, ?, 0, 'rejected', NULL)`,
      [uid('sv'), salesNum, clientId, c],
    );
  }
  // tr_platformfee (L18): escpos/payments hanya mengenal SATU angka fee
  // (feeESB → platformFee tunggal, tanpa breakdown per platform) sehingga
  // ditulis satu baris {platform:'total'} sebagai sumber rekap; syncDate
  // NULL = ikut push. Tanpa fee (feeESB 0/absen) tak ada baris.
  const feeTotal = r(s.feeESB ?? 0);
  if (feeTotal > 0) {
    await run(
      `INSERT INTO tr_platformfee (id, salesNum, client_id, platform, feeAmount, syncDate)
       VALUES (?, ?, ?, 'total', ?, NULL)`,
      [uid('pf'), salesNum, clientId, feeTotal],
    );
  }
  // Tiket dapur lahir dari penjualan nyata: satu baris per order dengan status
  // awal 'Baru'. Id deterministik agar retry penyimpanan tak bikin ganda.
  // Q7: kanonis-menang untuk identitas — baris cermin push (client_id NULL /
  // sementara) dikoreksi ke client_id sale nyata; status tak disentuh agar
  // advance dapur (Diproses) tak regresi ke 'Baru'.
  await run(
    `INSERT INTO tr_kitchenticket (id, ticketNo, salesNum, client_id, status, createdAt, updatedAt, syncDate)
     VALUES (?, ?, ?, ?, 'Baru', ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET client_id = excluded.client_id`,
    [`kt-${salesNum}`, salesNum, salesNum, clientId, now, now],
  );
  // Identitas penyetuju eskalasi (kompliment/non-penjualan) diaudit ke
  // tr_salesinfo; tanpa migrasi (tabel KV sudah ada). Ikut payload push via
  // buildSalePayload (approvedBy) agar server ikut mencatat.
  if (s.approvedBy) {
    await run(
      `INSERT INTO tr_salesinfo (id, salesNum, client_id, infoKey, infoValue, syncDate)
       VALUES (?, ?, ?, 'approvedBy', ?, NULL)`,
      [uid('si'), salesNum, clientId, s.approvedBy],
    );
  }
  // Porsi voucher atas ongkir (bruto = ongkir neto + cut). Kepala
  // voucherAmount tetap belanja saja; kunci 'ongkirCut' ikut push via
  // buildSalePayload agar server ikut mencatat.
  if (s.ongkirCut !== undefined && s.ongkirCut > 0) {
    await run(
      `INSERT INTO tr_salesinfo (id, salesNum, client_id, infoKey, infoValue, syncDate)
       VALUES (?, ?, ?, 'ongkirCut', ?, NULL)`,
      [uid('si'), salesNum, clientId, String(Math.round(s.ongkirCut))],
    );
  }
  committed = true;
  });
  } catch (e) {
    // L1 fail-closed: withTransaction sudah rollback; TERUSKAN galat (tanpa
    // swallow-and-return) agar PayScreen/Qris/Edc tak menampilkan Success
    // palsu. Antrean ringan recordSale milik pemanggil (di-flush SEBELUM
    // saveSale) tetap menjamin push saat online kembali.
    throw e instanceof Error ? e : new Error('gagal menyimpan penjualan');
  }
  if (committed) for (const fn of postCommit) { try { fn(); } catch { /* abaikan */ } }
  if (committed) {
    // Realtime lane (APP-PRINTER-SALES, audit row 12-parsial/SPEC §8): siarkan
    // live-cart kasir→display via publishDisplayOrder (bus lokal + WS
    // best-effort; SSE primer + polling fallback milik sisi view). Tak pernah
    // melempar — penjualan tetap sah bila display belum siap.
    try {
      DisplayBus.publishDisplayOrder(
        salesNum,
        items.map((it) => ({
          name: String(it.name ?? ''),
          qty: Math.max(1, Math.round(Number(it.qty) || 0)),
          price: Math.round(Number(it.basePrice) || 0),
        })),
        r(s.grandTotal),
        headStatus,
      );
    } catch {
      /* display belum siap - penjualan tetap sah */
    }
    // APP-EVENTS (same-device kasir→dapur/display, audit row 12): kipas sale
    // ke bus sale lokal (client_id untuk korelasi QR); idempoten terhadap
    // publishDisplayOrder di atas (konten sama, dedupe di sisi layar).
    try {
      DisplayBus.notifySaleSavedLocal({
        salesNum,
        clientId: String(clientId ?? ''),
        total: r(s.grandTotal),
        itemCount: items.reduce((a, it) => a + Math.max(1, Math.round(Number(it.qty) || 0)), 0),
        items: items.map((it) => {
          const qty = Math.max(1, Math.round(Number(it.qty) || 0));
          const unit = Math.round(Number(it.basePrice) || 0);
          return { name: String(it.name ?? ''), qty, subtotal: qty * unit };
        }),
      });
    } catch {
      /* bus lokal belum siap - penjualan tetap sah */
    }
  }
  return salesNum;
}

/** Head penjualan sudah ada? (penentu create-vs-append pada split grup). */
export async function saleHeadExists(salesNum: string): Promise<boolean> {
  const no = String(salesNum ?? '').trim();
  if (!no) return false;
  try {
    await initDb();
    const row = await queryFirst<{ n: number }>(
      'SELECT COUNT(*) AS n FROM tr_saleshead WHERE salesNum = ?',
      [no],
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Kebenaran DB untuk bill grup: total terbayar, grand, lunas-penuh, jml kaki + nominal tiap kaki. */
export type GroupPaid = {
  paidTotal: number;
  grandTotal: number;
  fullyPaid: boolean;
  payCount: number;
  amounts: number[];
};

export async function getGroupPaid(salesNum: string): Promise<GroupPaid> {
  const empty: GroupPaid = { paidTotal: 0, grandTotal: 0, fullyPaid: false, payCount: 0, amounts: [] };
  const no = String(salesNum ?? '').trim();
  if (!no) return empty;
  try {
    await initDb();
    const head = await queryFirst<{ grandTotal: number | null; paidAmount: number | null; status: string | null }>(
      'SELECT grandTotal, paidAmount, status FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
      [no],
    );
    if (!head) return empty;
    const rows = await query<{ amount: number | null }>(
      'SELECT amount FROM tr_salespayment WHERE salesNum = ? ORDER BY createdAt ASC',
      [no],
    );
    const amounts = rows.map((x) => Math.max(0, Math.round(Number(x?.amount) || 0)));
    const grand = Math.max(0, Math.round(Number(head.grandTotal) || 0));
    const paidTotal = Math.max(0, Math.round(Number(head.paidAmount) || 0));
    return {
      paidTotal,
      grandTotal: grand,
      fullyPaid: (head.status ?? '') === 'paid' || (grand > 0 && paidTotal >= grand),
      payCount: amounts.length,
      amounts,
    };
  } catch {
    return empty;
  }
}

/**
 * Tambah kaki bayar ke penjualan grup yang sudah ada (kunjungan split ke-2
 * dst): baris payment baru + head paidAmount/method/change + flip 'open' ke
 * 'paid' saat genap (grand 0 = 'paid' trivial, paritas saveSale). Stok/dapur
 * tak disentuh (milik create pertama); voucher tender per-leg DIBACKSTOP
 * (burn/rejected, cermin saveSale) kecuali sama dengan kode head. Seluruh
 * mutasi dalam SATU transaksi + head update atomik (paidAmount + delta);
 * antrean ringan + display disiarkan pasca-commit. Melempar bila gate
 * gagal (unbound/salesNum kosong/nominal kosong/head tak ada/deposit tanpa
 * member) — pemanggil UI wajib try/catch.
 */
/**
 * Satu kaki bayar kunjungan grup (L12: kontrak antar-agen). `memberId` per-leg
 * diteruskan defensif oleh PayScreen (fallback ke memberId top-level);
 * `voucherCode` per-leg memicu backstop burn di bawah (kunjungan 2+).
 */
export interface GroupPayLeg {
  method?: string;
  amount?: number;
  approvalCode?: string;
  memberId?: string;
  voucherCode?: string;
}

export async function appendGroupPayment(
  salesNum: string,
  p: { payments: GroupPayLeg[]; method: string; change?: number; clientId?: string; memberId?: string },
): Promise<void> {
  // Gate bound (D3-03, cermin saveSale): device belum ter-bound dilarang
  // memutasi state uang. Tanpa ini kunjungan grup ke-2+ menulis kaki + head
  // diam-diam sementara saveSale/nextSalesNum melempar di device yang sama.
  if (!isTerminalBound()) throw terminalUnboundError();
  const no = String(salesNum ?? '').trim();
  if (!no) throw new Error('salesNum kosong');
  let legs = (p.payments ?? [])
    .map((x) => ({
      method: String(x?.method ?? p.method ?? 'split'),
      amount: Math.max(0, Math.round(Number(x?.amount) || 0)),
      approvalCode: x?.approvalCode,
      memberId: String(x?.memberId ?? '').trim() || undefined,
      voucherCode: String(x?.voucherCode ?? '').trim() || undefined,
    }))
    .filter((x) => x.amount > 0);
  if (legs.length === 0) throw new Error('nominal kosong');
  await initDb();
  const now = new Date().toISOString();
  // Nilai keluar-transaksi untuk flush pasca-commit (antrean ringan +
  // display tak boleh di dalam transaksi SQLite).
  let outAdd = 0;
  let outNewPaid = 0;
  let outFullyPaid = false;
  let outGrand = 0;
  let outGroupClientId: string | null = null;
  let outDepTake = 0;
  let outDepMember = '';
  let outDepBranch: string | null = null;
  let outDepId = '';
  // L3: SELURUH mutasi (kaki + head + deposit + voucher) dalam SATU transaksi
  // — kill di tengah tak menyisakan kaki tanpa head / head tanpa debit.
  await withTransaction(async () => {
    const head = await queryFirst<{
      grandTotal: number | null; paidAmount: number | null; changeAmount: number | null;
      client_id: string | null; branchId: string | null; voucherCode: string | null;
      subtotal: number | null; discount: number | null;
    }>(
      `SELECT grandTotal, paidAmount, changeAmount, client_id, branchId, voucherCode,
              subtotal, discount FROM tr_saleshead WHERE salesNum = ? LIMIT 1`,
      [no],
    );
    if (!head) throw new Error(`Head ${no} tidak ada`);
    // APP-PRINTER-SALES: kaki grup ikut client_id head (merge-safe + payload
    // group-payment stabil untuk upsert server).
    const groupClientId = String(p.clientId ?? head.client_id ?? '').trim() || null;
    outGroupClientId = groupClientId;
    const grand = r(head.grandTotal ?? 0);
    outGrand = grand;
    // Backstop voucher kaki (L12, cermin saveSale): kode tender per-leg yang
    // BEDA dari kode head (sudah dibakar saat create) divalidasi — valid =
    // burn + kuota turun; tak-valid = usage 'rejected' + kode dicoret dari
    // refNo. Basis minSpend ≈ subtotal + discount (aproksimasi gross head).
    const headCodeU = String(head.voucherCode ?? '').trim().toUpperCase();
    const grossBase = r((head.subtotal ?? 0) + (head.discount ?? 0));
    const legCodes: string[] = [];
    for (const leg of legs) {
      const c = String(leg.voucherCode ?? '').trim();
      if (c && c.toUpperCase() !== headCodeU && !legCodes.some((x) => x.toUpperCase() === c.toUpperCase())) {
        legCodes.push(c);
      }
    }
    const rejectedLegs = new Set<string>();
    const burnedLegs: { code: string; amount: number }[] = [];
    for (const c of legCodes) {
      const chk = await assertVoucherUsable(c, grossBase);
      if (chk.ok) burnedLegs.push({ code: c, amount: chk.amount });
      else rejectedLegs.add(c.toUpperCase());
    }
    // Deposit backstop (paritas saveSale bug G1): kaki deposit kunjungan ke-2+
    // WAJIB memotong saldo member. Sebelumnya appendGroupPayment tak menyentuh
    // ms_member sama sekali sehingga deposit bisa dipakai ulang tanpa batas
    // lewat split grup. Clamp ke saldo hidup + catat withdraw, cermin saveSale.
    // Pemilik member = memberId per-leg dulu, fallback top-level (L12).
    const memberId = String(
      legs.find((l) => l.memberId)?.memberId ?? p.memberId ?? '',
    ).trim();
    outDepMember = memberId;
    let depBefore = 0;
    let depTake = 0;
    const depWanted = legs
      .filter((x) => /deposit/i.test(x.method ?? ''))
      .reduce((a, x) => a + x.amount, 0);
    if (depWanted > 0) {
      if (!memberId) throw new Error('Deposit butuh member');
      const cur = await queryFirst<{ depositBalance: number | null }>(
        'SELECT depositBalance FROM ms_member WHERE id = ? LIMIT 1',
        [memberId],
      );
      depBefore = Math.max(0, Math.round(Number(cur?.depositBalance) || 0));
      let left = depBefore;
      const capped: typeof legs = [];
      for (const leg of legs) {
        if (!/deposit/i.test(leg.method ?? '')) {
          capped.push(leg);
          continue;
        }
        const takeLeg = Math.min(left, leg.amount);
        left -= takeLeg;
        if (takeLeg > 0) capped.push({ ...leg, amount: takeLeg });
      }
      legs = capped;
      if (legs.length === 0) throw new Error('nominal kosong');
      depTake = Math.max(0, depBefore - left);
    }
    outDepTake = depTake;
    outDepBranch = head.branchId;
    // Konvensi tendered/change kaki-vs-head (L13, paritas saveSale): tiap kaki
    // mencatat tendered = nominal kaki + change 0 (kembalian menempel di head,
    // bukan kaki); head mengakumulasi paidAmount + changeAmount. Struk per-kaki
    // membaca kolom kaki, rekap membaca head — pembaca JANGAN menjumlahkan
    // change kaki × N. (Catatan: bila display struk-per-kaki butuh kembalian
    // per kaki di masa depan, itu kerja pemilik layar Receipt — dilaporkan.)
    const add = legs.reduce((a, x) => a + x.amount, 0);
    outAdd = add;
    for (const leg of legs) {
      const legV = String(leg.voucherCode ?? '').trim();
      const legVKept = legV && !rejectedLegs.has(legV.toUpperCase()) ? legV : null;
      await run(
        `INSERT INTO tr_salespayment (id, salesNum, client_id, paymentMethod, amount,
          tendered, changeAmount, refNo, syncDate, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [uid('sp'), no, groupClientId, leg.method, r(leg.amount), r(leg.amount), 0, leg.approvalCode ?? legVKept, now],
      );
    }
    // L3: head update ATOMIK — paidAmount bertambah via SET paidAmount =
    // paidAmount + delta (tanpa read-modify-write; aman dari balapan dua
    // kunjungan). L14: grand 0 = lunas trivial (paritas saveSale).
    const changeAdd = Math.max(0, Math.round(Number(p.change) || 0));
    await run(
      `UPDATE tr_saleshead SET paidAmount = paidAmount + ?, changeAmount = changeAmount + ?,
         paymentMethod = ?,
         status = CASE WHEN grandTotal <= 0 OR paidAmount + ? >= grandTotal THEN 'paid' ELSE 'open' END,
         updatedAt = ?, syncDate = NULL WHERE salesNum = ?`,
      [add, changeAdd, normalizeMethod(p.method), add, now, no],
    );
    const newPaid = r((head.paidAmount ?? 0) + add);
    outNewPaid = newPaid;
    const fullyPaid = grand <= 0 || newPaid >= grand;
    outFullyPaid = fullyPaid;
    // Usage kaki tender: valid dibakar (+kuota turun), tak-valid 'rejected'.
    for (const b of burnedLegs) {
      await run(
        `INSERT INTO tr_salesvoucherusage (id, salesNum, client_id, voucherCode, voucherAmount, status, syncDate)
         VALUES (?, ?, ?, ?, ?, 'burn', NULL)`,
        [uid('sv'), no, groupClientId, b.code, b.amount],
      );
      await run(
        `UPDATE ms_voucher SET quota = quota - 1, syncDate = NULL
          WHERE UPPER(voucherCode) = UPPER(?) AND quota > 0`,
        [b.code],
      );
      await run(
        `UPDATE ms_voucher SET status = 'used', syncDate = NULL
          WHERE UPPER(voucherCode) = UPPER(?) AND quota IS NOT NULL AND quota <= 0
            AND (status IS NULL OR status = 'available')`,
        [b.code],
      );
    }
    for (const c of legCodes) {
      if (!rejectedLegs.has(c.toUpperCase())) continue;
      await run(
        `INSERT INTO tr_salesvoucherusage (id, salesNum, client_id, voucherCode, voucherAmount, status, syncDate)
         VALUES (?, ?, ?, ?, 0, 'rejected', NULL)`,
        [uid('sv'), no, groupClientId, c],
      );
    }
    // Potong saldo + ledger withdraw (paritas saveSale): di DALAM transaksi
    // (sebelumnya best-effort di luar — kaki bisa sah tanpa debit).
    if (depTake > 0 && memberId) {
      const after = Math.max(0, depBefore - depTake);
      await run('UPDATE ms_member SET depositBalance = ?, syncDate = NULL WHERE id = ?', [after, memberId]);
      await enqueueOutboxPhysical('ms_member', memberId, 'update');
      const depId = uid('dep');
      outDepId = depId;
      const cashierId = (getSession()?.userId ?? '').trim() || null;
      await run(
        `INSERT INTO tr_memberdeposit (id, memberId, branchId, trxType, amount, balanceAfter, userId, trxDate, syncDate)
         VALUES (?, ?, ?, 'withdraw', ?, ?, ?, ?, NULL)`,
        [depId, memberId, head.branchId ?? null, depTake, after, cashierId, now],
      );
      await enqueueOutboxPhysical('tr_memberdeposit', depId, 'insert');
    }
  });
  // --- Pasca-commit (di luar transaksi): antrean ringan + display. ---
  if (outDepTake > 0 && outDepMember) {
    try {
      enqueueSync('other', { table: 'tr_memberdeposit', rowId: outDepId, op: 'insert' });
    } catch {
      /* abaikan */
    }
    try {
      enqueueSync('other', { kind: 'deposit-withdraw', memberId: outDepMember, nominal: outDepTake });
    } catch {
      /* abaikan */
    }
  }
  try {
    enqueueSync('order', {
      op: 'group-payment',
      salesNum: no,
      ...(outGroupClientId ? { clientId: outGroupClientId, client_id: outGroupClientId } : {}),
      payments: legs,
      method: p.method,
      paidTotal: outNewPaid,
      fullyPaid: outFullyPaid,
    });
  } catch {
    /* abaikan */
  }
  // D5: siarkan display setelah COMMIT (tanpa import cycle — display.ts tak
  // mengimpor sales.ts). Best-effort; pembayaran tetap sah bila display gagal.
  try {
    const its = await query<{ menuName: string | null; qty: number | null; price: number | null }>(
      'SELECT menuName, qty, price FROM tr_salesmenu WHERE salesNum = ?',
      [no],
    );
    const names = its
      .map((it) => ({
        name: String(it.menuName ?? '').trim(),
        qty: Math.max(1, Math.round(Number(it.qty) || 0)),
        price: Math.round(Number(it.price) || 0),
      }))
      .filter((it) => it.name);
    DisplayBus.publishDisplayOrder(
      no,
      names,
      outGrand,
      outFullyPaid ? 'paid' : 'open',
    );
  } catch {
    /* display belum siap - pembayaran tetap sah */
  }
  try {
    const its = await query<{ menuName: string | null; qty: number | null; price: number | null }>(
      'SELECT menuName, qty, price FROM tr_salesmenu WHERE salesNum = ?',
      [no],
    );
    const items = its
      .map((it) => {
        const qty = Math.max(1, Math.round(Number(it.qty) || 0));
        const unit = Math.round(Number(it.price) || 0);
        return { name: String(it.menuName ?? ''), qty, subtotal: qty * unit };
      })
      .filter((it) => it.name);
    DisplayBus.notifySaleSavedLocal({
      salesNum: no,
      clientId: String(outGroupClientId ?? ''),
      total: outGrand,
      itemCount: items.reduce((a, it) => a + it.qty, 0),
      items,
    });
  } catch {
    /* bus lokal belum siap - pembayaran tetap sah */
  }
}

/** Bungkus aman untuk UI: gagal simpan = log diam, kasir tetap jalan. */
export function saveSaleSafe(s: SaleInput): void {
  try {
    void saveSale(s).catch(() => undefined);
  } catch {
    /* abaikan */
  }
}

export interface MoveSaleItem {
  id: string;
  qty: number;
}

export interface MoveSaleResult {
  fromSalesNum: string;
  toSalesNum: string;
  movedIds: string[];
}

interface HeadTotals {
  salesNum: string;
  subtotal: number;
  discount: number;
  tax: number;
  serviceCharge: number;
  /** Tip/gratuity per bill (fitur tip v1): menempel pada bill, tak diprorata. */
  tip: number;
  platformFee: number;
  rounding: number;
  voucherAmount: number;
  grandTotal: number;
}

interface HeadLite extends HeadTotals {
  branchId: string | null;
  terminalId: string | null;
  userId: string | null;
  shiftId: string | null;
  salesMode: string | null;
  memberId: string | null;
  customerName: string | null;
  cashierName: string | null;
  status: string | null;
  ongkir: number | null;
}

interface MenuLite {
  id: string;
  salesNum: string;
  menuId: string | null;
  menuName: string | null;
  qty: number;
  price: number;
  discount: number;
  subtotal: number;
  note: string | null;
  stationId: string | null;
  status: string | null;
}

interface ExtraLite {
  id: string;
  salesMenuId: string;
  salesNum: string;
  extraId: string | null;
  extraName: string | null;
  qty: number;
  price: number;
  subtotal: number;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

async function headTotals(salesNum: string): Promise<{ subtotal: number; discount: number }> {
  const rows = await query<{ subtotal: number | null; discount: number | null }>(
    'SELECT subtotal, discount FROM tr_salesmenu WHERE salesNum = ?',
    [salesNum],
  );
  let subtotal = 0;
  let discount = 0;
  for (const row of rows) {
    subtotal += n(row.subtotal);
    discount += n(row.discount);
  }
  return { subtotal: r(subtotal), discount: r(discount) };
}

/**
 * Belah fisik tr_salesmenu antar bill (F1): pindahkan baris item dari bill
 * asal (fromSalesNum) ke bill meja tujuan + head tujuan + outbox.
 * - Baris penuh (qty sama): UPDATE salesNum baris asal + extras ikut.
 * - Baris sebagian: baris asal dikecilkan (qty/subtotal/diskon prorata),
 *   baris baru dibuat untuk tujuan; extras diskalakan prorata.
 * - Head tujuan: dipakai bila toSalesNum ada di DB (gabung; cabang uang
 *   dipertahankan apa adanya), dibuat baru (status 'open', meja = toTableNo,
 *   memberId diwarisi dari asal) bila tidak ada; tanpa toSalesNum maka nomor
 *   baru via nextSalesNumRetry(). Pajak/service/fee/rounding diprorata dari
 *   porsi subtotal pindahan; voucher/diskon head tetap di bill asal.
 * - Referensi anak ikut pindah (L5): sumber KOSONG + tujuan baru = payment /
 *   voucherusage / info / platformfee / kitchenticket di-UPDATE ke dest;
 *   pindah sebagian ke tujuan baru = tiket dapur baru untuk dest; gabung ke
 *   tujuan yang ada = referensi dipertahankan (uang milik bill masing-masing).
 * - Kedua head ditandai kotor (syncDate NULL) + outbox; server dikirim
 *   immediate-first (S6: apiFetch langsung, antrean ringan hanya bila gagal).
 * Melempar Error bila head asal tak ada / sudah lunas / tak ada item valid -
 * pemanggil UI (MoveItemsScreen, ter-wire) wajib try/catch.
 */
export async function moveSaleItems(args: {
  fromSalesNum: string;
  toTableNo: string;
  moves: MoveSaleItem[];
  toSalesNum?: string;
}): Promise<MoveSaleResult> {
  const { fromSalesNum, toTableNo } = args;
  const moves = (args.moves ?? []).filter((m) => m && m.id && n(m.qty) > 0);
  if (!fromSalesNum || !toTableNo || moves.length === 0) {
    throw new Error('Pindah item butuh bill asal, meja tujuan, dan item.');
  }
  await initDb();
  const src = await queryFirst<HeadLite>('SELECT * FROM tr_saleshead WHERE salesNum = ? LIMIT 1', [fromSalesNum]);
  if (!src) throw new Error(`Bill asal ${fromSalesNum} tidak ditemukan.`);
  if ((src.status ?? 'open') === 'paid') throw new Error(`Bill ${fromSalesNum} sudah lunas - tidak bisa dipindah.`);
  const srcRows = await query<MenuLite>('SELECT * FROM tr_salesmenu WHERE salesNum = ?', [fromSalesNum]);
  const byId = new Map(srcRows.map((row) => [row.id, row]));
  const valid = moves.filter((m) => byId.has(m.id));
  if (valid.length === 0) throw new Error('Item yang dipilih tidak ada di bill asal.');

  // Head tujuan: gabung bila toSalesNum sudah ada, sonst buat baru.
  let destNum = (args.toSalesNum ?? '').trim();
  let dest: HeadLite | null = destNum
    ? await queryFirst<HeadLite>('SELECT * FROM tr_saleshead WHERE salesNum = ? LIMIT 1', [destNum])
    : null;
  if (dest && (dest.status ?? 'open') === 'paid') {
    throw new Error(`Bill tujuan ${destNum} sudah lunas - pilih bill lain.`);
  }
  const now = new Date().toISOString();
  // L15: destCreated menandai head baru (memberId diwarisi di bawah).
  let destCreated = false;
  if (!dest) {
    if (!destNum) destNum = await nextSalesNumRetry();
    if (destNum === fromSalesNum) throw new Error('Bill tujuan sama dengan bill asal.');
    // Bill tujuan = sale baru: client_id UUIDv7 sendiri (Q7). Gabung ke dest
    // yang ada tetap by salesNum selama transisi terima-dua-format.
    await run(
      `INSERT INTO tr_saleshead (salesNum, client_id, branchId, terminalId, userId, shiftId, salesDate,
        salesMode, tableNo, memberId, customerName, queueNumber, subtotal, discount, tax, serviceCharge,
        grandTotal, status, cashierName, createdAt, updatedAt, syncDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'open', ?, ?, ?, NULL)`,
      [
        destNum, uuidv7(), src.branchId, src.terminalId, src.userId, src.shiftId, now,
        src.salesMode ?? 'DINE_IN', toTableNo, src.memberId, src.customerName, queueNoOf(destNum),
        src.cashierName ?? src.userId ?? '', now, now,
      ],
    );
    destCreated = true;
    try {
      await enqueueOutbox('tr_saleshead', destNum, 'insert');
    } catch {
      /* abaikan: tandai kotor di bawah tetap dicoba */
    }
  } else {
    destNum = dest.salesNum;
    await run('UPDATE tr_saleshead SET tableNo = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?', [
      toTableNo,
      now,
      destNum,
    ]);
  }

  // Q7: baris pindahan memakai client_id HEAD TUJUAN (kunci upsert server =
  // head, join lokal tetap by salesNum). Head lama tanpa client_id di-backfill
  // dulu agar tak lahirkan baris anak NULL.
  let destCid = String(
    (
      await queryFirst<{ client_id: string | null }>(
        'SELECT client_id FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
        [destNum],
      )
    )?.client_id ?? '',
  ).trim();
  if (!destCid) {
    destCid = uuidv7();
    await run(
      'UPDATE tr_saleshead SET client_id = ?, syncDate = NULL WHERE salesNum = ? AND client_id IS NULL',
      [destCid, destNum],
    );
  }

  // Pindahkan baris fisik.
  const movedIds: string[] = [];
  let movedSubtotal = 0;
  for (const m of valid) {
    const row = byId.get(m.id);
    if (!row) continue;
    const want = Math.min(n(m.qty), n(row.qty));
    if (want <= 0) continue;
    if (want >= n(row.qty)) {
      await run('UPDATE tr_salesmenu SET salesNum = ?, client_id = ?, syncDate = NULL WHERE id = ?', [destNum, destCid, row.id]);
      await run('UPDATE tr_salesmenuextra SET salesNum = ?, client_id = ?, syncDate = NULL WHERE salesMenuId = ?', [destNum, destCid, row.id]);
      // L6: extras yang ikut pindah baris-penuh ikut di-outbox agar push
      // berikutnya membawa salesNum/client_id barunya.
      try {
        const movedExtras = await query<{ id: string }>(
          'SELECT id FROM tr_salesmenuextra WHERE salesMenuId = ?',
          [row.id],
        );
        for (const mx of movedExtras) {
          try {
            await enqueueOutbox('tr_salesmenuextra', mx.id, 'update');
          } catch {
            /* abaikan */
          }
        }
      } catch {
        /* abaikan */
      }
      movedIds.push(row.id);
      movedSubtotal += n(row.subtotal);
    } else {
      const ratio = want / Math.max(1, n(row.qty));
      const moveSub = r(n(row.subtotal) * ratio);
      const moveDisc = r(n(row.discount) * ratio);
      await run('UPDATE tr_salesmenu SET qty = ?, discount = ?, subtotal = ?, syncDate = NULL WHERE id = ?', [
        r(n(row.qty) - want),
        r(n(row.discount) - moveDisc),
        r(n(row.subtotal) - moveSub),
        row.id,
      ]);
      const destMenuId = uid('sm');
      await run(
        `INSERT INTO tr_salesmenu (id, salesNum, client_id, menuId, menuName, qty, price,
          discount, subtotal, note, stationId, status, syncDate, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
          destMenuId, destNum, destCid, row.menuId, row.menuName, want, r(n(row.price)),
          moveDisc, moveSub, row.note, row.stationId, row.status ?? 'open', now,
        ],
      );
      const extras = await query<ExtraLite>('SELECT * FROM tr_salesmenuextra WHERE salesMenuId = ?', [row.id]);
      // L6: baris menu tujuan baru ikut di-outbox sebagai insert.
      try {
        await enqueueOutbox('tr_salesmenu', destMenuId, 'insert');
      } catch {
        /* abaikan */
      }
      for (const ex of extras) {
        // L6 single-unit: pindahkan min(qty, prorata) — JANGAN paksa minimal 1
        // (extras satuan yang hanya tersentuh sebagian tetap di asal; porsi
        // yang pindah = pembulatan prorata, dibatasi qty baris).
        const moveQty = Math.min(n(ex.qty), Math.max(0, Math.round(n(ex.qty) * ratio)));
        if (moveQty > 0) {
          const newExtraId = uid('se');
          await run(
            `INSERT INTO tr_salesmenuextra (id, salesMenuId, salesNum, client_id, extraId,
              extraName, qty, price, subtotal, syncDate)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [newExtraId, destMenuId, destNum, destCid, ex.extraId, ex.extraName, moveQty, r(n(ex.price)), r(n(ex.price) * moveQty)],
          );
          try {
            await enqueueOutbox('tr_salesmenuextra', newExtraId, 'insert');
          } catch {
            /* abaikan */
          }
        }
        const leftQty = r(n(ex.qty) - moveQty);
        if (leftQty <= 0) {
          await run('DELETE FROM tr_salesmenuextra WHERE id = ?', [ex.id]);
        } else {
          await run('UPDATE tr_salesmenuextra SET qty = ?, subtotal = ?, syncDate = NULL WHERE id = ?', [
            leftQty,
            r(n(ex.price) * leftQty),
            ex.id,
          ]);
          // L6: baris induk extras yang diperbarui ikut di-outbox.
          try {
            await enqueueOutbox('tr_salesmenuextra', ex.id, 'update');
          } catch {
            /* abaikan */
          }
        }
      }
      movedIds.push(destMenuId);
      movedSubtotal += moveSub;
    }
    try {
      await enqueueOutbox('tr_salesmenu', row.id, 'update');
    } catch {
      /* abaikan */
    }
  }
  if (movedIds.length === 0) throw new Error('Tidak ada item yang berhasil dipindah.');

  // Hitung ulang kedua head: subtotal/diskon dari baris; pajak/service/fee/
  // rounding diprorata porsi pindahan (pengurang tepat agar total konservasi).
  // L16: basis nol (diskon 100% / bill kosong) = share 0 — tanpa ini
  // movedSubtotal / max(1, 0) menggelembungkan pajak/service tujuan dari basis
  // nol (inflasi dari ketiadaan).
  const srcBase = n(src.subtotal);
  const share = srcBase > 0 ? movedSubtotal / srcBase : 0;
  const dTax = r(n(src.tax) * share);
  const dSvc = r(n(src.serviceCharge) * share);
  const dFee = r(n(src.platformFee) * share);
  const dRound = r(n(src.rounding) * share);
  const srcAgg = await headTotals(fromSalesNum);
  const srcTax = r(n(src.tax) - dTax);
  const srcSvc = r(n(src.serviceCharge) - dSvc);
  const srcFee = r(n(src.platformFee) - dFee);
  const srcRound = r(n(src.rounding) - dRound);
  // Ongkir menempel pada bill (bukan item): pindah item tak memindahkan
  // ongkir — bill asal mempertahankannya, bill tujuan memakai ongkirnya
  // sendiri (0 untuk bill baru). Sebelumnya grand dihitung tanpa ongkir.
  // Tip/gratuity (fitur tip v1) menempel pada bill dengan aturan yang sama:
  // gratifikasi atas kunjungan, bukan per item — pindah item tak memindahkan
  // tip; grand kedua bill wajib membawa tip masing-masing agar tip yang sudah
  // diputuskan di Pay tak hilang diam-diam saat baris dipindah.
  const srcGrand = srcAgg.subtotal - srcAgg.discount + srcTax + srcSvc - n(src.voucherAmount) + srcFee + srcRound + n(src.ongkir) + n(src.tip);
  // Grand tak boleh negatif: prorata pajak/service dari sumber bersubtotal
  // nol (diskon 100%) bisa mengecilkan sisi asal di bawah nol. Clamp 0 yang
  // jujur (selisih sen akibat pembulatan prorata tetap terlihat di rekap).
  await run(
    'UPDATE tr_saleshead SET subtotal = ?, discount = ?, tax = ?, serviceCharge = ?, platformFee = ?, rounding = ?, grandTotal = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?',
    [srcAgg.subtotal, srcAgg.discount, srcTax, srcSvc, srcFee, srcRound, Math.max(0, r(srcGrand)), now, fromSalesNum],
  );
  const destAgg = await headTotals(destNum);
  const destGrand = destAgg.subtotal - destAgg.discount + dTax + dSvc + dFee + dRound + n(dest?.ongkir ?? 0) + n(dest?.tip ?? 0);
  await run(
    'UPDATE tr_saleshead SET subtotal = ?, discount = ?, tax = ?, serviceCharge = ?, platformFee = ?, rounding = ?, grandTotal = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?',
    [destAgg.subtotal, destAgg.discount, dTax, dSvc, dFee, dRound, r(destGrand), now, destNum],
  );
  try {
    await enqueueOutbox('tr_saleshead', fromSalesNum, 'update');
  } catch {
    /* abaikan */
  }
  try {
    await enqueueOutbox('tr_saleshead', destNum, 'update');
  } catch {
    /* abaikan */
  }
  // L5: referensi anak non-item ikut tujuan. Sumber KOSONG + tujuan BARU =
  // pindah utuh (payment/voucherusage/info/platformfee/kitchenticket
  // di-UPDATE ke destNum + destCid); pindah SEBAGIAN ke tujuan baru = tiket
  // dapur baru untuk dest (dapur harus masak pindahan); gabung ke tujuan
  // yang SUDAH ADA = referensi dipertahankan (uang/voucher milik tiap bill),
  // tiket dest dipastikan ada. Daftar tabel statis (aman dari injeksi).
  const CHILD_TABLES = [
    'tr_salespayment',
    'tr_salesvoucherusage',
    'tr_salesinfo',
    'tr_platformfee',
    'tr_kitchenticket',
  ] as const;
  try {
    const left = await queryFirst<{ n: number }>(
      'SELECT COUNT(*) AS n FROM tr_salesmenu WHERE salesNum = ?',
      [fromSalesNum],
    );
    const srcEmptied = (left?.n ?? 0) === 0;
    if (srcEmptied && destCreated) {
      for (const tbl of CHILD_TABLES) {
        await run(
          `UPDATE ${tbl} SET salesNum = ?, client_id = ?, syncDate = NULL WHERE salesNum = ?`,
          [destNum, destCid, fromSalesNum],
        );
        try {
          await enqueueOutbox(tbl, destNum, 'update');
        } catch {
          /* abaikan */
        }
      }
    } else if (destCreated) {
      await run(
        `INSERT OR IGNORE INTO tr_kitchenticket (id, ticketNo, salesNum, client_id, status, createdAt, updatedAt, syncDate)
         VALUES (?, ?, ?, ?, 'Baru', ?, ?, NULL)`,
        [`kt-${destNum}`, destNum, destNum, destCid, now, now],
      );
    } else {
      await run(
        `INSERT OR IGNORE INTO tr_kitchenticket (id, ticketNo, salesNum, client_id, status, createdAt, updatedAt, syncDate)
         VALUES (?, ?, ?, ?, 'Baru', ?, ?, NULL)`,
        [`kt-${destNum}`, destNum, destNum, destCid, now, now],
      );
    }
  } catch {
    /* referensi anak gagal ikut - item sudah pindah, dapur/bayar selisih terlihat di layar pemilik */
  }
  // S6 immediate-first: coba live apiFetch DULU (kunci dest sama:
  // toSalesNum + client_id agar server korelasikan tanpa push); antrean
  // ringan (twin) HANYA bila live gagal — sebelumnya urutan terbalik
  // sehingga server menerima ganda (live + push) untuk satu move.
  const moveBody = {
    fromSalesNum, toSalesNum: destNum, toTableNo,
    itemIds: movedIds, clientId: destCid, client_id: destCid,
  };
  try {
    await apiFetch(ApiPath.moveItems, { body: moveBody });
  } catch {
    /* offline - twin via antrean ringan di bawah */
    try {
      // M11: payload move-items membawa client_id head TUJUAN (kunci upsert
      // server untuk baris pindahan) — tanpa ini pushLightItem mengisi id
      // antrean sebagai clientId dan server tak bisa mengkorelasikan move
      // dengan sale-nya. Baris DB pindahan sendiri sudah memakai destCid
      // (UPDATE/INSERT client_id di atas).
      enqueueSync('other', { op: 'move-items', ...moveBody, at: now });
    } catch {
      /* abaikan */
    }
  }
  // D5: siarkan display untuk bill tujuan setelah sukses (tanpa import
  // cycle — display.ts tak mengimpor sales.ts). Best-effort.
  try {
    const dHead = await queryFirst<{ grandTotal: number | null; status: string | null }>(
      'SELECT grandTotal, status FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
      [destNum],
    );
    const dRows = await query<{ menuName: string | null; qty: number | null; price: number | null }>(
      'SELECT menuName, qty, price FROM tr_salesmenu WHERE salesNum = ?',
      [destNum],
    );
    const dItems = dRows
      .map((it) => ({
        name: String(it.menuName ?? '').trim(),
        qty: Math.max(1, Math.round(Number(it.qty) || 0)),
        price: Math.round(Number(it.price) || 0),
      }))
      .filter((it) => it.name);
    DisplayBus.publishDisplayOrder(
      destNum,
      dItems,
      r(dHead?.grandTotal ?? 0),
      String(dHead?.status ?? 'open'),
    );
    DisplayBus.notifySaleSavedLocal({
      salesNum: destNum,
      clientId: destCid,
      total: r(dHead?.grandTotal ?? 0),
      itemCount: dItems.reduce((a, it) => a + it.qty, 0),
      items: dItems.map((it) => ({ name: it.name, qty: it.qty, subtotal: it.qty * it.price })),
    });
  } catch {
    /* display belum siap - pindahan tetap sah */
  }
  return { fromSalesNum, toSalesNum: destNum, movedIds };
}
