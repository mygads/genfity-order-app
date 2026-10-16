/**
 * Riwayat penjualan dari SQLite (RIW-01/02): baca tr_saleshead + item +
 * pembayaran, dan persist void ke tr_cancelmenu. Bentuk baris dipetakan ke
 * tipe `Transaction` (src/data/mock.ts) agar layar tidak berubah.
 */
import { ApiPath } from '../config/server';
import { apiFetch } from './apiSource';
import { getSession } from '../session';
import { initDb, query, queryFirst, run } from './db';
import { enqueueOutbox, enqueueSync } from './sync';
import type { Transaction, TxnStatus } from '../data/mock';

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO → {date: '13 Okt 2026', time: '12:04'} (manual, bebas locale perangkat). */
export function fmtSalesDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '-', time: '' };
  return {
    date: `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** salesMode kontrak (DINE_IN/…) → label kartu ('Dine In', …). */
export function modeLabel(salesMode?: string | null): string {
  const k = (salesMode ?? '').toUpperCase();
  if (/DINE/.test(k)) return 'Dine In';
  if (/TAKE/.test(k)) return 'Take Away';
  if (/DELIVER/.test(k)) return 'Delivery';
  if (!k) return 'Dine In';
  return k.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

function dbStatus(s?: string | null): TxnStatus {
  if (s === 'void') return 'Void';
  if (s === 'paid') return 'Selesai';
  return 'Batal';
}

interface HeadRow {
  salesNum: string;
  salesDate: string | null;
  salesMode: string | null;
  tableNo: string | null;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  grandTotal: number | null;
  paymentMethod: string | null;
  cashierName: string | null;
  status: string | null;
}

interface ItemRow {
  menuName: string | null;
  qty: number | null;
  price: number | null;
  note: string | null;
}

/**
 * Muat riwayat terbaru dari DB. Gagal/DB kosong → [] (layar memakai
 * fallback demo). Tidak pernah melempar.
 */
export async function loadHistory(limit = 300): Promise<Transaction[]> {
  try {
    await initDb();
    const heads = await query<HeadRow>(
      `SELECT salesNum, salesDate, salesMode, tableNo, subtotal, discount, tax,
              grandTotal, paymentMethod, cashierName, status
       FROM tr_saleshead ORDER BY salesDate DESC LIMIT ?`,
      [Math.max(1, limit)],
    );
    const out: Transaction[] = [];
    for (const h of heads) {
      let items: ItemRow[] = [];
      let pay: { paymentMethod: string | null } | null = null;
      try {
        items = await query<ItemRow>(
          'SELECT menuName, qty, price, note FROM tr_salesmenu WHERE salesNum = ?',
          [h.salesNum],
        );
      } catch {
        /* abaikan */
      }
      try {
        pay = await queryFirst<{ paymentMethod: string | null }>(
          'SELECT paymentMethod FROM tr_salespayment WHERE salesNum = ? LIMIT 1',
          [h.salesNum],
        );
      } catch {
        /* abaikan */
      }
      const { date, time } = fmtSalesDate(h.salesDate ?? '');
      out.push({
        id: h.salesNum,
        no: h.salesNum,
        date,
        time,
        cashier: h.cashierName ?? '-',
        ...(h.tableNo ? { table: h.tableNo } : {}),
        mode: modeLabel(h.salesMode),
        items: items.map((it) => ({
          name: it.menuName ?? '-',
          qty: Math.round(it.qty ?? 0),
          price: Math.round(it.price ?? 0),
          ...(it.note ? { note: it.note } : {}),
        })),
        subtotal: Math.round(h.subtotal ?? 0),
        discount: Math.round(h.discount ?? 0),
        tax: Math.round(h.tax ?? 0),
        total: Math.round(h.grandTotal ?? 0),
        payment: pay?.paymentMethod ?? h.paymentMethod ?? 'Tunai',
        status: dbStatus(h.status),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Void penuh: head → 'void' + satu baris tr_cancelmenu per item + outbox/sync
 * + POST server bila online. Tidak pernah melempar.
 */
export async function persistVoidDb(salesNum: string, reason: string): Promise<void> {
  const now = new Date().toISOString();
  const user = getSession()?.name ?? '';
  try {
    await initDb();
    await run(
      `UPDATE tr_saleshead SET status = 'void', updatedAt = ?, syncDate = NULL
       WHERE salesNum = ?`,
      [now, salesNum],
    );
    let items: { id: string; menuId: string | null; menuName: string | null; qty: number | null }[] = [];
    try {
      items = await query(
        'SELECT id, menuId, menuName, qty FROM tr_salesmenu WHERE salesNum = ?',
        [salesNum],
      );
    } catch {
      /* abaikan */
    }
    for (const it of items) {
      try {
        await run(
          `INSERT INTO tr_cancelmenu (id, salesNum, menuId, menuName, qty,
            reasonId, reasonNote, userId, cancelDate, syncDate)
           VALUES (?, ?, ?, ?, ?, 'VOID', ?, ?, ?, NULL)`,
          [
            `cm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
            salesNum, it.menuId, it.menuName, it.qty ?? 0,
            reason, user, now,
          ],
        );
      } catch {
        /* abaikan */
      }
    }
  } catch {
    /* DB gagal - antrean di bawah tetap jalan */
  }
  try {
    await enqueueOutbox('tr_saleshead', salesNum, 'update');
  } catch {
    /* abaikan */
  }
  try {
    enqueueSync('order', { action: 'void', salesNum, no: salesNum, reason });
  } catch {
    /* abaikan */
  }
  try {
    await apiFetch(ApiPath.pushOrderFinish, { body: { action: 'void', no: salesNum, reason } });
  } catch {
    /* offline - terkirim via push berikutnya */
  }
}

/** Ganti metode bayar: payment + head ikut terupdate + outbox/sync/server. */
export async function persistPayChangeDb(salesNum: string, method: string): Promise<void> {
  try {
    await initDb();
    await run('UPDATE tr_salespayment SET paymentMethod = ?, syncDate = NULL WHERE salesNum = ?', [method, salesNum]);
    await run('UPDATE tr_saleshead SET paymentMethod = ?, syncDate = NULL WHERE salesNum = ?', [method, salesNum]);
  } catch {
    /* abaikan */
  }
  try {
    await enqueueOutbox('tr_saleshead', salesNum, 'update');
  } catch {
    /* abaikan */
  }
  try {
    enqueueSync('order', { action: 'change-payment', salesNum, no: salesNum, method });
  } catch {
    /* abaikan */
  }
  try {
    await apiFetch(ApiPath.pushOrderFinish, { body: { action: 'change-payment', no: salesNum, method } });
  } catch {
    /* offline - terkirim via push berikutnya */
  }
}
