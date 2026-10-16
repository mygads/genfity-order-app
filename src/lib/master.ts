/**
 * Tarik master dari server ke SQLite (kontrak §4 + §8).
 * Per domain: baca watermark pull → GET ?since&limit → upsert
 * (INSERT OR REPLACE, syncDate = waktu pull = bersih) → tulis watermark.
 * Server menang untuk master; hanya jalan saat base URL terisi.
 */
import { ApiPath, apiGet, getBaseUrl, getBranchId, getServerEnv } from '../config/server';
import { initDb, run } from './db';
import { getWatermark, setWatermark } from './sync';

type Row = Record<string, string | number | null>;

interface Domain {
  key: string;
  path: string;
  table: string;
  cols: string[];
  map: (r: Row) => (string | number | null)[];
  /** Klausa ON CONFLICT kustom; default INSERT OR REPLACE. */
  upsert?: string;
  /** INSERT OR IGNORE bila true (lindungi baris lokal: penjualan). */
  ignoreExisting?: boolean;
  /** Lewati baris bila kolom pertama hasil map kosong. */
  requireFirst?: boolean;
  /** Hook pasca-baris (mis. menu: soldOut -> ms_branchmenu). */
  after?: (r: Row, now: string) => Promise<void>;
}

const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

const flag = (v: unknown, d = 1): number => (v === undefined || v === null ? d : Number(v) ? 1 : 0);

const DOMAINS: Domain[] = [
  {
    key: 'menu',
    path: ApiPath.pullMenu,
    table: 'ms_menu',
    cols: ['id', 'menuName', 'categoryId', 'price', 'imageUrl', 'stationId', 'flagActive'],
    map: (r) => [str(r.menuId) ?? '', str(r.name), str(r.categoryId), num(r.price), str(r.imageUrl), str(r.stationId), flag(r.flagActive)],
    requireFirst: true,
    // Field soldOut kontrak §4 JANGAN dibuang: cerminkan ke flagSoldOut
    // ms_branchmenu. qty tidak disentuh (domain branchmenu yang mengisinya).
    after: async (r, now) => {
      const menuId = str(r.menuId) ?? '';
      if (!menuId) return;
      const sold = flag(r.soldOut, 0);
      await run(
        `INSERT INTO ms_branchmenu (branchId, menuId, qty, flagSoldOut, flagActive, syncDate)
         VALUES (?, ?, 0, ?, ?, ?)
         ON CONFLICT (branchId, menuId) DO UPDATE SET flagSoldOut = excluded.flagSoldOut`,
        [getBranchId(), menuId, sold, flag(r.flagActive), now],
      );
    },
  },
  {
    key: 'branchmenu',
    path: ApiPath.pullBranchMenu,
    table: 'ms_branchmenu',
    cols: ['branchId', 'menuId', 'stationId', 'qty', 'flagSoldOut', 'flagActive'],
    map: (r) => [str(r.branchId) ?? '', str(r.menuId) ?? '', str(r.stationId), num(r.qty), flag(r.flagSoldOut, 0), flag(r.flagActive)],
  },
  {
    key: 'branchsettings',
    path: ApiPath.pullBranchSettings,
    table: 'ms_setting',
    cols: ['key1', 'key2', 'value1', 'value2'],
    map: (r) => [str(r.key1) ?? '', str(r.key2) ?? '', str(r.value1), str(r.value2)],
    requireFirst: true,
  },
  {
    key: 'user',
    path: ApiPath.pullUser,
    table: 'ms_posuser',
    cols: ['id', 'username', 'branchId', 'role'],
    map: (r) => [str(r.userId) ?? '', str(r.username), str(r.branchId), str(r.role)],
    requireFirst: true,
    // Upsert parsial: JANGAN timpa pinHash/password/authKey lokal
    // (dipakai fallback verifikasi PIN legacy di lib/pin.ts).
    upsert: 'ON CONFLICT(id) DO UPDATE SET username = excluded.username, branchId = excluded.branchId, role = excluded.role, syncDate = excluded.syncDate',
  },
  {
    key: 'table',
    path: ApiPath.pullTable,
    table: 'ms_table',
    cols: ['id', 'tableNo', 'sectionId', 'capacity', 'status'],
    map: (r) => [str(r.tableId) ?? '', str(r.tableNo), str(r.section), num(r.capacity), str(r.status)],
  },
  {
    key: 'station',
    path: ApiPath.pullStation,
    table: 'ms_station',
    cols: ['id', 'stationName', 'printerName', 'connection', 'printerType', 'charPerLine', 'flagDefault', 'flagActive'],
    map: (r) => [str(r.stationId ?? r.id) ?? '', str(r.stationName), str(r.printerName), str(r.connection), str(r.printerType), num(r.charPerLine, 32), flag(r.flagDefault, 0), flag(r.flagActive)],
  },
  {
    key: 'paymentmethod',
    path: ApiPath.pullPaymentMethod,
    table: 'ms_paymentmethod',
    cols: ['id', 'methodName', 'methodType', 'flagActive', 'sortOrder'],
    map: (r) => [str(r.methodId ?? r.id) ?? '', str(r.name), str(r.type), flag(r.flagActive), num(r.sortOrder)],
  },
  {
    key: 'member',
    path: ApiPath.pullMember,
    table: 'ms_member',
    cols: ['id', 'memberName', 'phone', 'depositBalance'],
    map: (r) => [str(r.memberId) ?? '', str(r.name), str(r.phoneMasked ?? r.phone), num(r.balance ?? r.depositBalance)],
  },
  {
    key: 'voucher',
    path: ApiPath.pullVoucher,
    table: 'ms_voucher',
    cols: ['id', 'voucherCode', 'voucherName', 'amount', 'quota', 'validFrom', 'validTo', 'status'],
    map: (r) => [
      str(r.voucherId) ?? '', str(r.code), str(r.name), num(r.amount), num(r.quota),
      str(r.validFrom), str(r.validTo), str(r.status),
    ],
    requireFirst: true,
  },
  {
    key: 'sales',
    path: ApiPath.pullSales,
    table: 'tr_saleshead',
    cols: ['salesNum', 'branchId', 'terminalId', 'userId', 'salesDate', 'salesMode', 'tableNo',
      'customerName', 'subtotal', 'discount', 'tax', 'serviceCharge', 'voucherAmount', 'voucherCode',
      'platformFee', 'rounding', 'grandTotal', 'paidAmount', 'changeAmount', 'paymentMethod',
      'ongkir', 'status'],
    map: (r) => [
      str(r.salesNum) ?? '', str(r.branchId), str(r.terminalId), str(r.userId),
      str(r.salesDate), str(r.salesMode), str(r.tableNo), str(r.customerName),
      num(r.subtotal), num(r.discount), num(r.tax), num(r.serviceCharge),
      num(r.voucherAmount), str(r.voucherCode), num(r.platformFee), num(r.rounding),
      num(r.grandTotal), num(r.paidAmount), num(r.changeAmount), str(r.paymentMethod),
      num(r.ongkir), str(r.status) ?? 'paid',
    ],
    requireFirst: true,
    // INSERT OR IGNORE: nomor lokal TRX-YYYYMMDD-NNN bisa tabrakan dengan
    // nomor server; baris lokal (terutama yang syncDate NULL / belum push)
    // tidak boleh tertimpa riwayat pull.
    ignoreExisting: true,
    after: async (r, now) => {
      const salesNum = str(r.salesNum) ?? '';
      if (!salesNum) return;
      const raw = (r as unknown as { items?: unknown }).items;
      if (!Array.isArray(raw)) return;
      let idx = 0;
      for (const it of raw) {
        const m = it as Row;
        const menuId = str(m.menuId) ?? '';
        if (!menuId) continue;
        const qty = num(m.qty, 1);
        const price = num((m.unitPrice ?? m.price) as unknown as string | number | null);
        const disc = num(m.discount);
        await run(
          `INSERT OR IGNORE INTO tr_salesmenu
           (id, salesNum, menuId, menuName, qty, price, discount, subtotal, note, syncDate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`${salesNum}:i${idx}`, salesNum, menuId, str(m.name),
            qty, price, disc, qty * price - disc, str(m.note), now],
        );
        idx += 1;
      }
    },
  },
];

// TODO(M9-4): domain kontrak §4 berikut belum ditarik karena tabelnya tidak
// ada di skema db.ts dan M9 melarang skema baru tanpa migrasi aman:
// - promotion (8 tabel ms_promotion_* - skema belum ada)
// - expense-chart-of-accounts (ms_coa - skema belum ada)
// - menu-online (mapping gofood/grab - skema belum ada)
// Bila tabelnya ditambahkan via migrasi aman, daftarkan Domain di atas memakai
// ApiPath.pullPromotion / pullExpenseCoa / pullMenuOnline (path + dummy JSON
// sudah tersedia) dan FORCE_PULL akan menjemputnya otomatis.

function rowsOf(body: unknown): Row[] {
  if (Array.isArray(body)) return body as Row[];
  if (body && typeof body === 'object') {
    const b = body as { ok?: boolean; data?: unknown };
    if (Array.isArray(b.data)) return b.data as Row[];
    const d = b.data as { items?: unknown };
    if (d && Array.isArray(d.items)) return d.items as Row[];
  }
  return [];
}

export interface PullResult {
  total: number;
  per: Record<string, number>;
  at: string;
}

/**
 * Tarik semua domain master - HANYA ke server milik sendiri (env Custom).
 * Melempar bila bukan Custom / respons cacat.
 * Bila `only` diisi (mis. dari WS FORCE_PULL {domains}), hanya domain
 * bernama itu yang ditarik; nama tak dikenal (mis. promotion yang tabelnya
 * belum ada, lihat TODO M9-4) diabaikan diam-diam.
 */
export async function pullMaster(only?: string[]): Promise<PullResult> {
  if (getServerEnv() !== 'custom' || !getBaseUrl()) {
    throw new Error('Pilih Server Custom (milik sendiri) di Pengaturan sebelum sync.');
  }
  await initDb();
  const targets = !only || only.length === 0
    ? DOMAINS
    : DOMAINS.filter((d) => only.includes(d.key));
  const per: Record<string, number> = {};
  for (const d of targets) {
    const wm = await getWatermark(d.key);
    const res = await apiGet(d.path, { ...(wm.pull ? { since: wm.pull } : {}), limit: 200 });
    if (!res.ok) throw new Error(`Pull ${d.key}: HTTP ${res.status}`);
    const rows = rowsOf(await res.json());
    const now = new Date().toISOString();
    const marks = d.cols.map(() => '?').join(', ');
    for (const r of rows) {
      const mapped = d.map(r);
      if (d.requireFirst && !mapped[0]) continue;
      if (d.upsert) {
        await run(
          `INSERT INTO "${d.table}" (${d.cols.join(', ')}, syncDate) VALUES (${marks}, ?) ${d.upsert}`,
          [...mapped, now],
        );
      } else if (d.ignoreExisting) {
        await run(
          `INSERT OR IGNORE INTO "${d.table}" (${d.cols.join(', ')}, syncDate) VALUES (${marks}, ?)`,
          [...mapped, now],
        );
      } else {
        await run(
          `INSERT OR REPLACE INTO "${d.table}" (${d.cols.join(', ')}, syncDate) VALUES (${marks}, ?)`,
          [...mapped, now],
        );
      }
      if (d.after) {
        try {
          await d.after(r, now);
        } catch {
          /* hook tambahan gagal - baris utama tetap tersimpan */
        }
      }
    }
    per[d.key] = rows.length;
    await setWatermark(d.key, { pull: now });
  }
  const total = Object.values(per).reduce((a, b) => a + b, 0);
  return { total, per, at: new Date().toISOString() };
}
