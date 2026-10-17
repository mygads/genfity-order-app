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
import { MIGRATION_STATEMENTS, SCHEMA_STATEMENTS } from './dbSchema';

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

/**
 * Skema + migrasi tinggal di lib/dbSchema.ts (sumber tunggal untuk native
 * dan web). Alias di sini agar sisa file tidak berubah.
 */
const SCHEMA: string[] = SCHEMA_STATEMENTS;

/**
 * Migrasi kolom bertahap untuk database lama — lihat dbSchema.ts.
 */
const MIGRATIONS: string[] = MIGRATION_STATEMENTS;

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
  ms_notes: 'id',
  ms_notescategory: 'id',
  ms_posuseraccess: ['userId', 'accessKey'],
  ms_posuserrole: 'id',
  ms_cashmethod: 'id',
  tr_membertransactionlog: 'id',
  tr_kitchenticket: 'id',
  tr_draftorder: 'id',
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

export interface RoundingSetting {
  /** Nilai mentah ms_setting(Rounding, Mode), '' bila tak ada. */
  mode: string;
  /** Nilai numerik Rounding Nearest Value, 0 bila tak ada/tak valid. */
  nearest: number;
  /** Nilai numerik Rounding Step, 100 bila tak ada/tak valid. */
  step: number;
}

/**
 * Baca setting pembulatan REA-14 (display-only, tanpa menyentuh rumus
 * totals.ts). Aman untuk instalasi lama: baris ms_setting boleh tak ada,
 * nilai tak valid jatuh ke default. Membaca semua baris key1 LIKE
 * 'Rounding%' agar tahan dua layout (key1='Rounding'/key2='Mode' maupun
 * key1='Rounding Mode' satu kunci).
 */
export async function getRoundingSetting(): Promise<RoundingSetting> {
  const fallback: RoundingSetting = { mode: '', nearest: 0, step: 100 };
  try {
    const rows = await query<{ key1: string | null; key2: string | null; value1: string | null }>(
      `SELECT key1, key2, value1 FROM ms_setting WHERE key1 LIKE 'Rounding%' LIMIT 20`,
    );
    if (rows.length === 0) return fallback;
    const out = { ...fallback };
    for (const r of rows) {
      const k1 = (r.key1 ?? '').trim().toLowerCase();
      const k2 = (r.key2 ?? '').trim().toLowerCase();
      const v = (r.value1 ?? '').trim();
      // Layout satu kunci: key1='rounding mode' / 'rounding nearest value'.
      const k = k1 === 'rounding' ? k2 : k1.replace(/^rounding\s+/, '');
      if (k === 'mode') {
        out.mode = v;
      } else if (k === 'nearest value' || k === 'nearestvalue' || k === 'nearest') {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) out.nearest = n;
      } else if (k === 'step') {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) out.step = Math.round(n);
      }
    }
    return out;
  } catch {
    return fallback;
  }
}
