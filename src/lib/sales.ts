/**
 * Simpan penjualan lunas ke SQLite (kontrak §5 + aturan Lampiran B).
 * Dipanggil fire-and-forget dari PayScreen.goSuccess - TIDAK PERNAH
 * melempar: kasir tidak boleh diblokir database. Baris ditulis dengan
 * syncDate NULL (= kotor) agar ikut push berikutnya; pengiriman
 * server tetap lewat antrean ringan `recordSale` (src/lib/payments.ts).
 */
import { getTerminal, ApiPath } from '../config/server';
import { getSession } from '../session';
import { initDb, query, queryFirst, run } from './db';
import { getItem, setItem } from './storage';
import { enqueueOutbox, enqueueSync } from './sync';
import { apiFetch } from './apiSource';
import { lineSubtotal, normalizeSalesMode, type SaleInput } from './payments';

const r = (n: number) => Math.round(n);

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
  const cashier = getSession()?.name ?? '';
  const items = s.items ?? [];
  const subtotal = s.subtotal ?? items.reduce((a, it) => a + lineSubtotal(it), 0);
  const payments = s.payments?.length
    ? s.payments
    : [{ method: s.method, amount: s.grandTotal }];
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const voucherAmt = r(s.voucherCode ? (s.discountTotal ?? 0) : 0);
  await initDb();
  // Mode/ongkir/customer + rincian pajak/service/voucher ikut tersimpan agar
  // struk ulang dan push server konsisten dengan rumus kasir kanonik.
  await run(
    `INSERT INTO tr_saleshead (salesNum, branchId, terminalId, userId, salesDate,
      salesMode, subtotal, discount, tax, serviceCharge, voucherAmount, voucherCode,
      grandTotal, paidAmount, changeAmount,
      paymentMethod, memberId, tableNo, customerName, ongkir,
      status, cashierName, createdAt, updatedAt, syncDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, NULL)`,
    [
      salesNum, t.branchId || null, t.terminalCode || null, cashier, now,
      s.mode ? normalizeSalesMode(s.mode) : 'DINE_IN',
      r(subtotal), r(s.discountTotal ?? 0),
      r(s.vatTotal ?? 0), r(s.serviceTotal ?? 0),
      voucherAmt, s.voucherCode ?? null,
      r(s.grandTotal), r(paid),
      r(s.change ?? Math.max(0, paid - s.grandTotal)), payments[0]?.method ?? s.method,
      s.memberId ?? null, s.tableId ?? null, s.customer ?? null, r(s.ongkir ?? 0),
      cashier, now, now,
    ],
  );
  for (const it of items) {
    await run(
      `INSERT INTO tr_salesmenu (id, salesNum, menuId, menuName, qty, price,
        discount, subtotal, note, status, syncDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'served', NULL, ?)`,
      [
        uid('sm'), salesNum, it.id, it.name, it.qty, r(it.basePrice),
        r(it.discount ?? 0), r(lineSubtotal(it)),
        it.note ?? null, now,
      ],
    );
    for (const m of it.modifiers ?? []) {
      await run(
        `INSERT INTO tr_salesmenuextra (id, salesMenuId, salesNum, extraId,
          extraName, qty, price, subtotal, syncDate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [uid('se'), it.id, salesNum, m.name, m.name, it.qty, r(m.price), r(m.price * it.qty)],
      );
    }
  }
  for (const p of payments) {
    await run(
      `INSERT INTO tr_salespayment (id, salesNum, paymentMethod, amount,
        tendered, changeAmount, refNo, syncDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        uid('sp'), salesNum, p.method, r(p.amount), r(s.cash ?? p.amount),
        r(s.change ?? 0), p.approvalCode ?? p.voucherCode ?? null, now,
      ],
    );
  }
  if (s.voucherCode) {
    await run(
      `INSERT INTO tr_salesvoucherusage (id, salesNum, voucherCode, voucherAmount, status, syncDate)
       VALUES (?, ?, ?, ?, 'burn', NULL)`,
      [uid('sv'), salesNum, s.voucherCode, voucherAmt],
    );
  }
  return salesNum;
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
  const srcGrand = srcAgg.subtotal - srcAgg.discount + srcTax + srcSvc - n(src.voucherAmount) + srcFee + srcRound;
  await run(
    'UPDATE tr_saleshead SET subtotal = ?, discount = ?, tax = ?, serviceCharge = ?, platformFee = ?, rounding = ?, grandTotal = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?',
    [srcAgg.subtotal, srcAgg.discount, srcTax, srcSvc, srcFee, srcRound, r(srcGrand), now, fromSalesNum],
  );
  const destAgg = await headTotals(destNum);
  const destGrand = destAgg.subtotal - destAgg.discount + dTax + dSvc + dFee + dRound;
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
