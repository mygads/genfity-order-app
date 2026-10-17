/**
 * Lapisan SQLite lokal untuk WEB (expo-sqlite 57 build web: SQLite WASM yang
 * persisten di OPFS browser). API dan perilaku SAMA PERSIS dengan db.ts
 * (native) — pemanggil mengimpor './db' dan Metro memilih file ini saat
 * bundling web.
 *
 * Riwayat jujur: file ini dulu stub no-op (tulis hilang, baca selalu
 * kosong) sehingga login admin/1234 + seluruh alur offline TAK PERNAH bisa
 * jalan di web. Sekarang implementasi penuh dengan skema tunggal dari
 * lib/dbSchema.ts — web dan native tidak akan drift.
 *
 * Syarat browser: secure context (localhost/https) agar OPFS tersedia;
 * bila OPFS tak tersedia, expo-sqlite web jatuh ke penyimpanan memori
 * sesi (data hilang saat tab ditutup, tapi alur tetap berfungsi).
 */

import {
  openDatabaseAsync,
  type SQLiteBindValue,
  type SQLiteDatabase,
  type SQLiteRunResult,
} from 'expo-sqlite';
import { MIGRATION_STATEMENTS, SCHEMA_STATEMENTS } from './dbSchema';

export const DB_NAME = 'poslite.db';

export type BindParams = SQLiteBindValue[];

let db: SQLiteDatabase | null = null;
let initPromise: Promise<void> | null = null;
let openPromise: Promise<SQLiteDatabase> | null = null;

/**
 * Buka database secara ASYNC (bukan openDatabaseSync). Alasan: jalur sync
 * expo-sqlite web memakai SharedArrayBuffer/Atomics yang menuntut header
 * isolasi COOP+COEP — tidak dijamin ada di semua server web. Jalur async
 * (postMessage worker) bebas dari syarat itu. Semua API publik di bawah
 * tetap ber-tanda-tangan sama persis dengan db.ts.
 */
async function dbAsync(): Promise<SQLiteDatabase> {
  if (db) return db;
  if (!openPromise) {
    openPromise = openDatabaseAsync(DB_NAME).catch((e) => {
      openPromise = null;
      throw e;
    });
  }
  db = await openPromise;
  return db;
}

/**
 * Handle sinkron — hanya valid setelah initDb() (atau operasi async apa
 * pun) membuka database. Gagal-cepat dengan pesan jelas bila dipanggil
 * terlalu dini; pemanggil internal selalu lewat dbAsync().
 */
export function getDb(): SQLiteDatabase {
  if (!db) throw new Error('[db.web] database belum dibuka — panggil initDb() dulu');
  return db;
}

/** SELECT banyak baris. */
export async function all<T = Record<string, unknown>>(
  sql: string,
  params: BindParams = [],
): Promise<T[]> {
  return (await dbAsync()).getAllAsync<T>(sql, params);
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
  return (await dbAsync()).getFirstAsync<T>(sql, params);
}

/** INSERT/UPDATE/DELETE/DDL berparameter. */
export async function run(sql: string, params: BindParams = []): Promise<SQLiteRunResult> {
  return (await dbAsync()).runAsync(sql, params);
}

/** Jalankan skrip SQL mentah (dipakai initDb). */
export async function exec(source: string): Promise<void> {
  await (await dbAsync()).execAsync(source);
}

/**
 * Transaksi atomik (#22): cermin db.ts untuk web (WASM). Satu koneksi
 * dbAsync + BEGIN/COMMIT; gagal = ROLLBACK + lempar ulang. Tidak bersarang.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const d = await dbAsync();
  await d.execAsync('BEGIN');
  try {
    const out = await fn();
    await d.execAsync('COMMIT');
    return out;
  } catch (e) {
    try {
      await d.execAsync('ROLLBACK');
    } catch {
      /* abaikan */
    }
    throw e;
  }
}

/**
 * Buat semua tabel inti bila belum ada. Idempoten - aman dipanggil tiap
 * start aplikasi. Guard promise ganda agar dua pemanggil bersamaan tidak
 * membuat skema dua kali. (Logika sama dengan db.ts.)
 */
export async function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const database = await dbAsync();
      for (const stmt of SCHEMA_STATEMENTS) {
        await database.execAsync(stmt);
      }
      // Migrasi ringan kolom baru (tanpa CHECK inline): gagal = sudah ada.
      for (const stmt of MIGRATION_STATEMENTS) {
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
 * Paksa push ulang (dipakai alur cetak-ulang): sama dengan markDirty.
 */
export async function resetSyncDate(table: string, id: string): Promise<number> {
  return markDirty(table, id);
}

/**
 * Tandai baris sebagai SUDAH terkirim (syncDate = now) setelah push sukses.
 * Cermin markDirty (whitelist PK sama, format id sama). Best-effort: 0 bila
 * tabel tak dikenal / DB gagal. Tanpa ini badge dirty (syncDate NULL)
 * menumpuk selamanya walau antrean fisik sudah terkuras.
 */
export async function markClean(table: string, id: string, at?: string): Promise<number> {
  const pk = DIRTY_PK[table];
  if (!pk) return 0;
  const stamp = at ?? new Date().toISOString();
  try {
    if (Array.isArray(pk)) {
      const parts = id.split(':');
      if (parts.length !== pk.length) return 0;
      const where = pk.map((c) => `"${c}" = ?`).join(' AND ');
      const res = await run(`UPDATE "${table}" SET syncDate = ? WHERE ${where}`, [stamp, ...parts]);
      return res.changes;
    }
    const res = await run(`UPDATE "${table}" SET syncDate = ? WHERE "${pk}" = ?`, [stamp, id]);
    return res.changes;
  } catch {
    return 0;
  }
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
 * Baca setting pembulatan REA-14 (display-only). (Logika sama dengan db.ts.)
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

export interface BranchCurrency {
  /** Kode mata uang cabang ternormalisasi: 'IDR' | 'AUD', '' bila tak ada/tak dikenal. */
  code: string;
  /** Locale dari value2 (mis. 'id-ID'/'en-AU'), '' bila tak ada. */
  locale: string;
}

let warnedBranchCurrency = false;

/**
 * Baca mata uang cabang dari ms_setting (key1='Branch', key2='Currency',
 * value1='IDR'|'AUD', value2=locale). (Logika sama dengan db.ts.)
 */
export async function getBranchCurrency(): Promise<BranchCurrency> {
  const fallback: BranchCurrency = { code: '', locale: '' };
  try {
    const row = await queryFirst<{ value1: string | null; value2: string | null }>(
      `SELECT value1, value2 FROM ms_setting WHERE key1 = 'Branch' AND key2 = 'Currency' LIMIT 1`,
    );
    if (!row) return fallback;
    const raw = (row.value1 ?? '').trim().toUpperCase();
    const code = raw === 'IDR' || raw === 'AUD' ? raw : '';
    if (raw && !code && !warnedBranchCurrency) {
      warnedBranchCurrency = true;
      try {
        console.warn(`[currency] unknown Branch/Currency value1 "${row.value1}", fallback IDR`);
      } catch {
        /* abaikan */
      }
    }
    return { code, locale: (row.value2 ?? '').trim() };
  } catch {
    return fallback;
  }
}
