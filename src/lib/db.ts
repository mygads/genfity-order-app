/**
 * Lapisan SQLite lokal (expo-sqlite v15) - database `poslite.db`.
 *
 * Aturan offline (Lampiran B dossier):
 * - kolom `syncDate` NULL = baris kotor (belum ter-push),
 *   dibaca dengan `WHERE syncDate IS NULL`;
 * - watermark push/pull per domain di `tr_sync(syncType, pushDateTime,
 *   pullDateTime)`, diakses lewat getWatermark/setWatermark di lib/sync.ts;
 * - outbox di `tr_esoprocessqueue(orderID, serverID, ...)`.
 *
 * Tanpa FK/views/trigger - port verbatim dari skema sqflite APK.
 */
import {
  openDatabaseSync,
  type SQLiteBindValue,
  type SQLiteDatabase,
  type SQLiteRunResult,
} from 'expo-sqlite';

export const DB_NAME = 'poslite.db';

export type BindParams = SQLiteBindValue[];

let db: SQLiteDatabase | null = null;
let initPromise: Promise<void> | null = null;

/** Buka (sekali saja) dan kembalikan handle database. */
export function getDb(): SQLiteDatabase {
  if (!db) db = openDatabaseSync(DB_NAME);
  return db;
}

/** SELECT banyak baris. */
export async function all<T = Record<string, unknown>>(
  sql: string,
  params: BindParams = [],
): Promise<T[]> {
  return getDb().getAllAsync<T>(sql, params);
}

/** Alias `all` - SELECT banyak baris. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: BindParams = [],
): Promise<T[]> {
  return all<T>(sql, params);
}

/** SELECT satu baris (null bila tidak ada). */
export async function queryFirst<T = Record<string, unknown>>(
  sql: string,
  params: BindParams = [],
): Promise<T | null> {
  return getDb().getFirstAsync<T>(sql, params);
}

/** INSERT/UPDATE/DELETE/DDL berparameter. */
export async function run(sql: string, params: BindParams = []): Promise<SQLiteRunResult> {
  return getDb().runAsync(sql, params);
}

/** Jalankan skrip SQL mentah (dipakai initDb). */
export async function exec(source: string): Promise<void> {
  await getDb().execAsync(source);
}

const SCHEMA: string[] = [
  // --- Konfig KV + sesi + terminal (Lampiran B) ---
  `CREATE TABLE IF NOT EXISTS ms_setting (
    key1 TEXT NOT NULL, key2 TEXT NOT NULL, value1 TEXT, value2 TEXT, syncDate TEXT,
    PRIMARY KEY (key1, key2))`,
  `CREATE TABLE IF NOT EXISTS ms_posuser (
    id TEXT PRIMARY KEY, username TEXT, pinHash TEXT, password TEXT, authKey TEXT,
    branchId TEXT, role TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_terminalsetting (
    terminalId TEXT NOT NULL, settingKey TEXT NOT NULL, settingValue TEXT,
    flag INTEGER DEFAULT 0, syncDate TEXT,
    PRIMARY KEY (terminalId, settingKey))`,
  `CREATE TABLE IF NOT EXISTS ms_station (
    id TEXT PRIMARY KEY, stationName TEXT, printerName TEXT, printerPort TEXT,
    connection TEXT, printerType TEXT, printerMode TEXT, charPerLine INTEGER DEFAULT 32,
    localIdentifier TEXT, flagDefault INTEGER DEFAULT 0, flagActive INTEGER DEFAULT 1,
    flagAutocut INTEGER DEFAULT 1, flagOpenCashdrawer INTEGER DEFAULT 0, syncDate TEXT)`,

  // --- Inti transaksi ---
  `CREATE TABLE IF NOT EXISTS tr_saleshead (
    salesNum TEXT PRIMARY KEY, branchId TEXT, terminalId TEXT, userId TEXT, shiftId TEXT,
    salesDate TEXT, salesMode TEXT, tableNo TEXT, customerName TEXT,
    subtotal REAL DEFAULT 0, discount REAL DEFAULT 0, discountName TEXT,
    tax REAL DEFAULT 0, serviceCharge REAL DEFAULT 0,
    voucherAmount REAL DEFAULT 0, voucherCode TEXT,
    platformFee REAL DEFAULT 0, rounding REAL DEFAULT 0, grandTotal REAL DEFAULT 0,
    paidAmount REAL DEFAULT 0, changeAmount REAL DEFAULT 0,
    paymentMethod TEXT, paymentType TEXT, memberId TEXT,
    ongkir REAL DEFAULT 0,
    status TEXT DEFAULT 'open', note TEXT, queueNumber TEXT, refNum TEXT,
    externalId TEXT, onlineOrderId TEXT, cashierName TEXT,
    createdAt TEXT, updatedAt TEXT, syncDate TEXT, printedCount INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS tr_salesmenu (
    id TEXT PRIMARY KEY, salesNum TEXT, menuId TEXT, menuName TEXT,
    qty REAL DEFAULT 0, price REAL DEFAULT 0, discount REAL DEFAULT 0,
    subtotal REAL DEFAULT 0, note TEXT, stationId TEXT, status TEXT,
    syncDate TEXT, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_salesmenuextra (
    id TEXT PRIMARY KEY, salesMenuId TEXT, salesNum TEXT, extraId TEXT, extraName TEXT,
    qty REAL DEFAULT 0, price REAL DEFAULT 0, subtotal REAL DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_salespayment (
    id TEXT PRIMARY KEY, salesNum TEXT, paymentMethod TEXT, paymentType TEXT,
    amount REAL DEFAULT 0, tendered REAL DEFAULT 0, changeAmount REAL DEFAULT 0,
    refNo TEXT, edcBatch TEXT, syncDate TEXT, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_salesvoucherusage (
    id TEXT PRIMARY KEY, salesNum TEXT, voucherCode TEXT, voucherAmount REAL DEFAULT 0,
    status TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_salesinfo (
    id TEXT PRIMARY KEY, salesNum TEXT, infoKey TEXT, infoValue TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_platformfee (
    id TEXT PRIMARY KEY, salesNum TEXT, platform TEXT, feeAmount REAL DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_cancelmenu (
    id TEXT PRIMARY KEY, salesNum TEXT, menuId TEXT, menuName TEXT, qty REAL DEFAULT 0,
    reasonId TEXT, reasonNote TEXT, userId TEXT, cancelDate TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_shiftlog (
    id TEXT PRIMARY KEY, branchId TEXT, terminalId TEXT, userId TEXT, shiftName TEXT,
    clockIn TEXT, clockOut TEXT, cashInDrawer REAL DEFAULT 0, totalSales REAL DEFAULT 0,
    cashActual REAL DEFAULT 0, cashDiff REAL DEFAULT 0,
    status TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_shiftlogdetail (
    id TEXT PRIMARY KEY, shiftId TEXT, paymentMethod TEXT,
    totalAmount REAL DEFAULT 0, totalTrx INTEGER DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_memberdeposit (
    id TEXT PRIMARY KEY, memberId TEXT, branchId TEXT, trxType TEXT, amount REAL DEFAULT 0,
    balanceAfter REAL DEFAULT 0, userId TEXT, trxDate TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_branchexpense (
    id TEXT PRIMARY KEY, branchId TEXT, coaId TEXT, coaName TEXT, amount REAL DEFAULT 0,
    note TEXT, userId TEXT, expenseDate TEXT, photoPath TEXT, syncDate TEXT, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_branchexpensedocument (
    id TEXT PRIMARY KEY, expenseId TEXT, docPath TEXT, docType TEXT, syncDate TEXT)`,

  // --- Sync / audit (tanpa syncDate - ini infrastrukturnya) ---
  `CREATE TABLE IF NOT EXISTS tr_sync (
    syncType TEXT PRIMARY KEY, pushDateTime TEXT, pullDateTime TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_esoprocessqueue (
    id TEXT PRIMARY KEY, orderID TEXT, serverID TEXT, tableName TEXT, op TEXT,
    payload TEXT, status TEXT DEFAULT 'antre', createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_transactionlogapi (
    id TEXT PRIMARY KEY, url TEXT, method TEXT, reqBody TEXT,
    resCode INTEGER DEFAULT 0, resBody TEXT, createdAt TEXT)`,

  // --- Master katalog ---
  `CREATE TABLE IF NOT EXISTS ms_branchmenu (
    branchId TEXT NOT NULL, menuId TEXT NOT NULL, stationId TEXT, qty REAL DEFAULT 0,
    flagSoldOut INTEGER DEFAULT 0, flagActive INTEGER DEFAULT 1, syncDate TEXT,
    PRIMARY KEY (branchId, menuId))`,
  `CREATE TABLE IF NOT EXISTS ms_menu (
    id TEXT PRIMARY KEY, menuName TEXT, categoryId TEXT, price REAL DEFAULT 0,
    imageUrl TEXT, stationId TEXT, flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_category (
    id TEXT PRIMARY KEY, categoryName TEXT, sortOrder INTEGER DEFAULT 0,
    flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_table (
    id TEXT PRIMARY KEY, tableNo TEXT, sectionId TEXT, capacity INTEGER DEFAULT 0,
    status TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_paymentmethod (
    id TEXT PRIMARY KEY, methodName TEXT, methodType TEXT,
    flagActive INTEGER DEFAULT 1, sortOrder INTEGER DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_member (
    id TEXT PRIMARY KEY, memberName TEXT, phone TEXT,
    depositBalance REAL DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_voucher (
    id TEXT PRIMARY KEY, voucherCode TEXT, voucherName TEXT, amount REAL DEFAULT 0,
    quota INTEGER DEFAULT 0, validFrom TEXT, validTo TEXT, status TEXT, syncDate TEXT)`,
];

/**
 * Migrasi kolom bertahap untuk database lama: satu ADD COLUMN per statement
 * (SQLite tidak mendukung IF NOT EXISTS untuk ADD COLUMN di semua versi,
 * jadi kegagalan "duplicate column" ditelan initDb).
 */
const MIGRATIONS: string[] = [
  'ALTER TABLE tr_saleshead ADD COLUMN ongkir REAL DEFAULT 0',
  'ALTER TABLE tr_salesvoucherusage ADD COLUMN voucherAmount REAL DEFAULT 0',
  'ALTER TABLE tr_shiftlog ADD COLUMN cashActual REAL DEFAULT 0',
  'ALTER TABLE tr_shiftlog ADD COLUMN cashDiff REAL DEFAULT 0',
];

/**
 * Buat semua tabel inti bila belum ada. Idempoten - aman dipanggil tiap
 * start aplikasi. Guard promise ganda agar dua pemanggil bersamaan tidak
 * membuat skema dua kali.
 */
export async function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const database = getDb();
      for (const stmt of SCHEMA) {
        await database.execAsync(stmt);
      }
      // Migrasi ringan kolom baru (tanpa CHECK inline): gagal = sudah ada.
      for (const stmt of MIGRATIONS) {
        try {
          await database.execAsync(stmt);
        } catch {
          /* kolom sudah ada - abaikan */
        }
      }
    })().catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  await initPromise;
}

/** Kolom id per tabel untuk markDirty/resetSyncDate (whitelist anti-injeksi). */
const DIRTY_PK: Record<string, string | string[]> = {
  ms_setting: 'key1',
  ms_posuser: 'id',
  ms_terminalsetting: 'terminalId',
  ms_station: 'id',
  tr_saleshead: 'salesNum',
  tr_salesmenu: 'id',
  tr_salesmenuextra: 'id',
  tr_salespayment: 'id',
  tr_salesvoucherusage: 'id',
  tr_salesinfo: 'id',
  tr_platformfee: 'id',
  tr_cancelmenu: 'id',
  tr_shiftlog: 'id',
  tr_shiftlogdetail: 'id',
  tr_memberdeposit: 'id',
  tr_branchexpense: 'id',
  tr_branchexpensedocument: 'id',
  ms_menu: 'id',
  ms_branchmenu: ['branchId', 'menuId'],
  ms_category: 'id',
  ms_table: 'id',
  ms_paymentmethod: 'id',
  ms_member: 'id',
  ms_voucher: 'id',
};

/**
 * Tandai baris sebagai kotor (syncDate = NULL) agar ikut push berikutnya.
 * Kembalikan jumlah baris yang diubah; 0 bila tabel tak dikenal / DB gagal.
 * PK komposit (ms_branchmenu: [branchId, menuId]) memakai id gabungan
 * `${branchId}:${menuId}` sesuai pemanggil MenuManagement/Stock.
 */
export async function markDirty(table: string, id: string): Promise<number> {
  const pk = DIRTY_PK[table];
  if (!pk) return 0;
  try {
    if (Array.isArray(pk)) {
      const parts = id.split(':');
      if (parts.length !== pk.length) return 0;
      const where = pk.map((c) => `"${c}" = ?`).join(' AND ');
      const res = await run(`UPDATE "${table}" SET syncDate = NULL WHERE ${where}`, parts);
      return res.changes;
    }
    const res = await run(`UPDATE "${table}" SET syncDate = NULL WHERE "${pk}" = ?`, [id]);
    return res.changes;
  } catch {
    return 0;
  }
}

/**
 * Paksa push ulang (dipakai alur cetak-ulang): sama dengan markDirty -
 * mereset syncDate ke NULL sesuai aturan Lampiran B dossier.
 */
export async function resetSyncDate(table: string, id: string): Promise<number> {
  return markDirty(table, id);
}

/** Hitung baris kotor (syncDate NULL) pada satu tabel; 0 bila gagal. */
export async function countDirty(table: string): Promise<number> {
  if (!DIRTY_PK[table]) return 0;
  try {
    const row = await queryFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "${table}" WHERE syncDate IS NULL`,
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}
