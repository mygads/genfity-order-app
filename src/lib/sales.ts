/**
 * Simpan penjualan lunas ke SQLite (kontrak §5 + aturan Lampiran B).
 * Dipanggil fire-and-forget dari PayScreen.goSuccess - TIDAK PERNAH
 * melempar: kasir tidak boleh diblokir database. Baris ditulis dengan
 * syncDate NULL (= kotor) agar ikut push berikutnya; pengiriman
 * server tetap lewat antrean ringan `recordSale` (src/lib/payments.ts).
 */
import { getTerminal } from '../config/server';
import { getSession } from '../session';
import { initDb, run } from './db';
import { getItem, setItem } from './storage';
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
