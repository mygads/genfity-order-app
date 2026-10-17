/**
 * Simpan penjualan lunas ke SQLite (kontrak §5 + aturan Lampiran B).
 * Dipanggil fire-and-forget dari PayScreen.goSuccess - TIDAK PERNAH
 * melempar: kasir tidak boleh diblokir database. Baris ditulis dengan
 * syncDate NULL (= kotor) agar ikut push berikutnya; pengiriman
 * server tetap lewat antrean ringan `recordSale` (src/lib/payments.ts).
 */
import { getBranchId, getTerminal, ApiPath } from '../config/server';
import { getSession } from '../session';
import { initDb, query, queryFirst, run } from './db';
import { getItem, setItem } from './storage';
import { enqueueOutbox, enqueueSync } from './sync';
import { apiFetch } from './apiSource';
import { lineSubtotal, normalizeMethod, normalizeSalesMode, type SaleInput } from './payments';

const r = (n: number) => Math.round(n);

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Backstop voucher di choke point saveSale (temuan audit #1/#2): cek
 * status/kuota/jendela/nominal langsung ke ms_voucher. Semantik cermin
 * validateVoucherCodeLocal (apiSource.ts): status harus 'available',
 * quota > 0, amount > 0, dalam jendela validFrom/validTo (banding string ISO).
 * Query gagal (DB glitch) = fail-open (perilaku lama) agar kasir tak
 * terblokir; data tak-valid = {ok:false}. Selalu initDb dulu karena
 * dipanggil sebelum/sesudah initDb pemanggil.
 */
async function assertVoucherUsable(code: string): Promise<{ ok: boolean; amount: number }> {
  const fail = { ok: false, amount: 0 };
  const c = String(code ?? '').trim();
  if (!c) return fail;
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
    if (!row) return fail;
    if ((row.status ?? '').toLowerCase() !== 'available') return fail;
    if (Math.round(Number(row.quota) || 0) <= 0) return fail;
    const amt = Math.max(0, Math.round(Number(row.amount) || 0));
    if (amt <= 0) return fail;
    const now = new Date().toISOString();
    if (row.validFrom && row.validFrom > now) return fail;
    if (row.validTo && row.validTo < now) return fail;
    return { ok: true, amount: amt };
  } catch {
    return { ok: true, amount: 0 };
  }
}

/**
 * Nomor struk lokal format kontrak §5 (TRX-YYYYMMDD-NNN), sekuens harian
 * per terminal. Unik per (branch, terminal, tanggal); server memakai
 * salesNum ini sebagai id rekonsiliasi saat push.
 */
export async function nextSalesNum(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const key = `genfity.sales.seq.${ymd}`;
  let n = 1;
  try {
    const raw = await getItem(key);
    n = (raw ? parseInt(raw, 10) + 1 : 1) || 1;
  } catch {
    /* storage rusak - mulai dari 1 */
  }
  try {
    await setItem(key, String(n));
  } catch {
    /* abaikan */
  }
  return `TRX-${ymd}-${String(n).padStart(3, '0')}`;
}

/** Tulis head + item + pembayaran dari payload tier-penuh. */
export async function saveSale(s: SaleInput): Promise<string> {
  const salesNum = s.salesNum ?? (await nextSalesNum());
  const now = new Date().toISOString();
  const t = getTerminal();
  const sess = getSession();
  const cashier = sess?.name ?? '';
  const cashierId = (sess?.userId ?? '').trim();
  const branchId = t.branchId || getBranchId();
  const items = s.items ?? [];
  const subtotal = s.subtotal ?? items.reduce((a, it) => a + lineSubtotal(it), 0);
  const payments = s.payments?.length
    ? s.payments
    : [{ method: s.method, amount: s.grandTotal }];
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  // Status lunas otomatis: bayar penuh (semua alur lama tak berubah) = 'paid';
  // bayar sebagian (cicilan split bill grup) = 'open' hingga appendGroupPayment
  // menggenapi. Grand 0 = lunas trivial.
  const headStatus = r(s.grandTotal) > 0 && paid < r(s.grandTotal) ? 'open' : 'paid';
  // Porsi voucher murni = diskon head - diskon per-item. Pemanggil Pay mengirim
  // gabungan keduanya di discountTotal; tanpa pemisah, nominal voucher di head
  // + usage ter-overstate sebesar diskon item (bug G5).
  const itemDiscSum = r(items.reduce((a, it) => a + r(it.discount ?? 0), 0));
  // Backstop voucher head (#2): kode tak-valid (status/kuota/jendela/
  // nominal) = usage 'rejected', voucherAmt 0, tanpa burn. Penjualan tetap
  // sah (fail-closed hanya untuk vouchernya, bukan kasirnya).
  let headVoucherOk = false;
  if (s.voucherCode) {
    headVoucherOk = (await assertVoucherUsable(s.voucherCode)).ok;
  }
  const voucherAmt = headVoucherOk ? r(Math.max(0, (s.discountTotal ?? 0) - itemDiscSum)) : 0;
  await initDb();
  // Mode/ongkir/customer + rincian pajak/service/voucher ikut tersimpan agar
  // struk ulang dan push server konsisten dengan rumus kasir kanonik.
  await run(
    `INSERT INTO tr_saleshead (salesNum, branchId, terminalId, userId, salesDate,
      salesMode, subtotal, discount, tax, serviceCharge, platformFee, rounding,
      voucherAmount, voucherCode,
      grandTotal, paidAmount, changeAmount,
      paymentMethod, memberId, tableNo, customerName, ongkir,
      status, cashierName, createdAt, updatedAt, syncDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      salesNum, branchId, t.terminalCode || null, cashierId || null, now,
      s.mode ? normalizeSalesMode(s.mode) : 'DINE_IN',
      r(subtotal), r(s.discountTotal ?? 0),
      r(s.vatTotal ?? 0), r(s.serviceTotal ?? 0),
      r(s.feeESB ?? 0), Math.round(Number(s.rounding) || 0),
      voucherAmt, s.voucherCode ?? null,
      r(s.grandTotal), r(paid),
      r(s.change ?? Math.max(0, paid - s.grandTotal)), normalizeMethod(payments[0]?.method ?? s.method),
      s.memberId ?? null, s.tableId ?? null, s.customer ?? null, r(s.ongkir ?? 0),
      headStatus, cashier, now, now,
    ],
  );
  for (const it of items) {
    // Id baris dipakai ulang sebagai salesMenuId extras agar move/split
    // menemukan addon-nya (sebelumnya extras menunjuk id cart -> orphan).
    const smId = uid('sm');
    await run(
      `INSERT INTO tr_salesmenu (id, salesNum, menuId, menuName, qty, price,
        discount, subtotal, note, status, syncDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'served', NULL, ?)`,
      [
        smId, salesNum, it.id, it.name, it.qty, r(it.basePrice),
        r(it.discount ?? 0), r(lineSubtotal(it)),
        it.note ?? null, now,
      ],
    );
    for (const m of it.modifiers ?? []) {
      await run(
        `INSERT INTO tr_salesmenuextra (id, salesMenuId, salesNum, extraId,
          extraName, qty, price, subtotal, syncDate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [uid('se'), smId, salesNum, m.name, m.name, it.qty, r(m.price), r(m.price * it.qty)],
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
          await enqueueOutbox('ms_branchmenu', `${branch}:${it.id}`, 'update');
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
    const chk = await assertVoucherUsable(c);
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
      `INSERT INTO tr_salespayment (id, salesNum, paymentMethod, amount,
        tendered, changeAmount, refNo, syncDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        uid('sp'), salesNum, p.method, r(p.amount), legTendered,
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
        await enqueueOutbox('ms_member', s.memberId, 'update');
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
        await enqueueOutbox('tr_memberdeposit', depId, 'insert');
      } catch {
        /* abaikan */
      }
      try {
        enqueueSync('other', { kind: 'deposit-withdraw', memberId: s.memberId, nominal: take });
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
        `INSERT INTO tr_salesvoucherusage (id, salesNum, voucherCode, voucherAmount, status, syncDate)
         VALUES (?, ?, ?, ?, 'burn', NULL)`,
        [uid('sv'), salesNum, s.voucherCode, voucherAmt],
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
        `INSERT INTO tr_salesvoucherusage (id, salesNum, voucherCode, voucherAmount, status, syncDate)
         VALUES (?, ?, ?, 0, 'rejected', NULL)`,
        [uid('sv'), salesNum, s.voucherCode],
      );
    }
  }
  // Usage kaki tender: yang valid dibakar (+kuota turun), yang tak-valid
  // dicatat 'rejected' tanpa sentuh kuota.
  for (const b of burnedLegs) {
    await run(
      `INSERT INTO tr_salesvoucherusage (id, salesNum, voucherCode, voucherAmount, status, syncDate)
       VALUES (?, ?, ?, ?, 'burn', NULL)`,
      [uid('sv'), salesNum, b.code, b.amount],
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
      `INSERT INTO tr_salesvoucherusage (id, salesNum, voucherCode, voucherAmount, status, syncDate)
       VALUES (?, ?, ?, 0, 'rejected', NULL)`,
      [uid('sv'), salesNum, c],
    );
  }
  // Tiket dapur lahir dari penjualan nyata: satu baris per order dengan status
  // awal 'Baru'. Id deterministik agar retry penyimpanan tak bikin ganda.
  await run(
    `INSERT INTO tr_kitchenticket (id, ticketNo, salesNum, status, createdAt, updatedAt, syncDate)
     VALUES (?, ?, ?, 'Baru', ?, ?, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [`kt-${salesNum}`, salesNum, salesNum, now, now],
  );
  // Identitas penyetuju eskalasi (kompliment/non-penjualan) diaudit ke
  // tr_salesinfo; tanpa migrasi (tabel KV sudah ada). Ikut payload push via
  // buildSalePayload (approvedBy) agar server ikut mencatat.
  if (s.approvedBy) {
    await run(
      `INSERT INTO tr_salesinfo (id, salesNum, infoKey, infoValue, syncDate)
       VALUES (?, ?, 'approvedBy', ?, NULL)`,
      [uid('si'), salesNum, s.approvedBy],
    );
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
 * 'paid' saat genap. Stok/voucher/dapur tak disentuh (milik create pertama).
 */
export async function appendGroupPayment(
  salesNum: string,
  p: { payments: { method?: string; amount?: number; approvalCode?: string }[]; method: string; change?: number },
): Promise<void> {
  const no = String(salesNum ?? '').trim();
  if (!no) throw new Error('salesNum kosong');
  const legs = (p.payments ?? [])
    .map((x) => ({
      method: String(x?.method ?? p.method ?? 'split'),
      amount: Math.max(0, Math.round(Number(x?.amount) || 0)),
      approvalCode: x?.approvalCode,
    }))
    .filter((x) => x.amount > 0);
  if (legs.length === 0) throw new Error('nominal kosong');
  await initDb();
  const head = await queryFirst<{ grandTotal: number | null; paidAmount: number | null; changeAmount: number | null }>(
    'SELECT grandTotal, paidAmount, changeAmount FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
    [no],
  );
  if (!head) throw new Error(`Head ${no} tidak ada`);
  const now = new Date().toISOString();
  const add = legs.reduce((a, x) => a + x.amount, 0);
  for (const leg of legs) {
    await run(
      `INSERT INTO tr_salespayment (id, salesNum, paymentMethod, amount,
        tendered, changeAmount, refNo, syncDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [uid('sp'), no, leg.method, r(leg.amount), r(leg.amount), 0, leg.approvalCode ?? null, now],
    );
  }
  const grand = r(head.grandTotal ?? 0);
  const newPaid = r((head.paidAmount ?? 0) + add);
  const newChange = r((head.changeAmount ?? 0) + Math.max(0, Math.round(Number(p.change) || 0)));
  const fullyPaid = grand > 0 && newPaid >= grand;
  await run(
    `UPDATE tr_saleshead SET paidAmount = ?, changeAmount = ?, paymentMethod = ?,
       status = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?`,
    [newPaid, newChange, normalizeMethod(p.method), fullyPaid ? 'paid' : 'open', now, no],
  );
  try {
    enqueueSync('order', {
      op: 'group-payment',
      salesNum: no,
      payments: legs,
      method: p.method,
      paidTotal: newPaid,
      fullyPaid,
    });
  } catch {
    /* abaikan */
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
 * - Head tujuan: dipakai bila toSalesNum ada di DB (gabung), dibuat baru
 *   (status 'open', meja = toTableNo) bila tidak ada; tanpa toSalesNum maka
 *   nomor baru via nextSalesNum(). Pajak/service/fee/rounding diprorata dari
 *   porsi subtotal pindahan; voucher/diskon head tetap di bill asal.
 * - Kedua head ditandai kotor (syncDate NULL) + outbox + antrean ringan
 *   'move-items'; kirim server best-effort kontrak §5.2
 *   {fromSalesNum, toTableNo, itemIds[]}.
 * Melempar Error bila head asal tak ada / sudah lunas / tak ada item valid -
 * pemanggil UI (milik layar tabel) wajib try/catch. Tanpa pemanggil baru
 * (belum di-wire ke MoveItemsScreen) sehingga nol regresi ke alur kasir.
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
  if (!dest) {
    if (!destNum) destNum = await nextSalesNum();
    if (destNum === fromSalesNum) throw new Error('Bill tujuan sama dengan bill asal.');
    await run(
      `INSERT INTO tr_saleshead (salesNum, branchId, terminalId, userId, shiftId, salesDate,
        salesMode, tableNo, customerName, subtotal, discount, tax, serviceCharge,
        grandTotal, status, cashierName, createdAt, updatedAt, syncDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'open', ?, ?, ?, NULL)`,
      [
        destNum, src.branchId, src.terminalId, src.userId, src.shiftId, now,
        src.salesMode ?? 'DINE_IN', toTableNo, src.customerName,
        src.cashierName ?? src.userId ?? '', now, now,
      ],
    );
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

  // Pindahkan baris fisik.
  const movedIds: string[] = [];
  let movedSubtotal = 0;
  for (const m of valid) {
    const row = byId.get(m.id);
    if (!row) continue;
    const want = Math.min(n(m.qty), n(row.qty));
    if (want <= 0) continue;
    if (want >= n(row.qty)) {
      await run('UPDATE tr_salesmenu SET salesNum = ?, syncDate = NULL WHERE id = ?', [destNum, row.id]);
      await run('UPDATE tr_salesmenuextra SET salesNum = ?, syncDate = NULL WHERE salesMenuId = ?', [destNum, row.id]);
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
        `INSERT INTO tr_salesmenu (id, salesNum, menuId, menuName, qty, price,
          discount, subtotal, note, stationId, status, syncDate, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
          destMenuId, destNum, row.menuId, row.menuName, want, r(n(row.price)),
          moveDisc, moveSub, row.note, row.stationId, row.status ?? 'open', now,
        ],
      );
      const extras = await query<ExtraLite>('SELECT * FROM tr_salesmenuextra WHERE salesMenuId = ?', [row.id]);
      for (const ex of extras) {
        const moveQty = Math.min(n(ex.qty), Math.max(n(ex.qty) >= 1 ? 1 : 0, Math.round(n(ex.qty) * ratio)));
        if (moveQty > 0) {
          await run(
            `INSERT INTO tr_salesmenuextra (id, salesMenuId, salesNum, extraId,
              extraName, qty, price, subtotal, syncDate)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [uid('se'), destMenuId, destNum, ex.extraId, ex.extraName, moveQty, r(n(ex.price)), r(n(ex.price) * moveQty)],
          );
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
  const share = movedSubtotal / Math.max(1, n(src.subtotal));
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
  const srcGrand = srcAgg.subtotal - srcAgg.discount + srcTax + srcSvc - n(src.voucherAmount) + srcFee + srcRound + n(src.ongkir);
  await run(
    'UPDATE tr_saleshead SET subtotal = ?, discount = ?, tax = ?, serviceCharge = ?, platformFee = ?, rounding = ?, grandTotal = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?',
    [srcAgg.subtotal, srcAgg.discount, srcTax, srcSvc, srcFee, srcRound, r(srcGrand), now, fromSalesNum],
  );
  const destAgg = await headTotals(destNum);
  const destGrand = destAgg.subtotal - destAgg.discount + dTax + dSvc + dFee + dRound + n(dest?.ongkir ?? 0);
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
  try {
    enqueueSync('other', {
      op: 'move-items', fromSalesNum, toSalesNum: destNum, toTableNo,
      itemIds: movedIds, at: now,
    });
  } catch {
    /* abaikan */
  }
  try {
    await apiFetch(ApiPath.moveItems, { body: { fromSalesNum, toTableNo, itemIds: movedIds } });
  } catch {
    /* offline - terkirim via push berikutnya */
  }
  return { fromSalesNum, toSalesNum: destNum, movedIds };
}
