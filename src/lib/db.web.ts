/**
 * Stub web untuk lapisan SQLite (dipakai hanya di web - Metro memilih
 * file `.web.ts` ini saat bundling web sehingga `expo-sqlite` + wasm
 * tidak ikut terbundel; di native tetap dipakai `db.ts`).
 *
 * Semua fungsi no-op yang aman: UI verifikasi visual tetap jalan,
 * data tidak persisten di web. Tanda tangan sama persis dengan db.ts.
 */

export const DB_NAME = 'poslite.db';

export type BindParams = Array<string | number | null | Uint8Array>;

export interface WebRunResult {
  lastInsertRowId: number;
  changes: number;
}

export interface WebDatabase {
  getAllAsync: <T>(sql: string, params?: BindParams) => Promise<T[]>;
  getFirstAsync: <T>(sql: string, params?: BindParams) => Promise<T | null>;
  runAsync: (sql: string, params?: BindParams) => Promise<WebRunResult>;
  execAsync: (source: string) => Promise<void>;
}

const emptyDb: WebDatabase = {
  getAllAsync: async <T>() => [] as T[],
  getFirstAsync: async <T>() => null as T | null,
  runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }),
  execAsync: async () => {},
};

/** Kembalikan handle stub (web: tanpa SQLite). */
export function getDb(): WebDatabase {
  return emptyDb;
}

/** No-op di web - skema hanya dibuat di native. */
export async function initDb(): Promise<void> {}

/** SELECT banyak baris (web: selalu kosong). */
export async function all<T = Record<string, unknown>>(
  _sql: string,
  _params: BindParams = [],
): Promise<T[]> {
  return [];
}

/** Alias `all`. */
export async function query<T = Record<string, unknown>>(
  _sql: string,
  _params: BindParams = [],
): Promise<T[]> {
  return [];
}

/** SELECT satu baris (web: selalu null). */
export async function queryFirst<T = Record<string, unknown>>(
  _sql: string,
  _params: BindParams = [],
): Promise<T | null> {
  return null;
}

/** INSERT/UPDATE/DELETE/DDL (web: no-op). */
export async function run(_sql: string, _params: BindParams = []): Promise<WebRunResult> {
  return { lastInsertRowId: 0, changes: 0 };
}

/** Skrip SQL mentah (web: no-op). */
export async function exec(_source: string): Promise<void> {}

/** Tandai baris kotor (web: no-op, kembalikan 0). */
export async function markDirty(_table: string, _id: string | number): Promise<number> {
  return 0;
}

/** Alias markDirty untuk alur cetak-ulang (web: no-op). */
export async function resetSyncDate(_table: string, _id: string | number): Promise<number> {
  return 0;
}

/** Hitung baris `syncDate IS NULL` (web: selalu 0). */
export async function countDirty(_table: string): Promise<number> {
  return 0;
}

export interface RoundingSetting {
  /** Nilai mentah ms_setting(Rounding, Mode), '' bila tak ada. */
  mode: string;
  /** Nilai numerik Rounding Nearest Value, 0 bila tak ada/tak valid. */
  nearest: number;
  /** Nilai numerik Rounding Step, 100 bila tak ada/tak valid. */
  step: number;
}

/** Setting pembulatan REA-14 (web: default, tanpa DB). */
export async function getRoundingSetting(): Promise<RoundingSetting> {
  return { mode: '', nearest: 0, step: 100 };
}
