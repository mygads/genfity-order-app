/**
 * Fondasi dual-currency POS (IDR + AUD) — cache in-memory + persist ms_setting.
 *
 * - Tanpa ubah perilaku IDR bila currency tak diketahui: fallback selalu
 *   { code:'IDR', locale:'id-ID' } (perilaku lama).
 * - Sumber kebenaran urutan: profil merchant server (GET api/merchant/profile,
 *   field `currency`) → baris lokal ms_setting (key1='Branch', key2='Currency')
 *   → fallback IDR.
 * - Tulis SQLite via initDb/run/queryFirst dari lib/db.ts (pola getTaxRate di
 *   lib/totals.ts); fetch via apiFetch/unwrap dari lib/apiSource.ts (pola
 *   terminalApi.ts: GET + cek r.ok && !r.fromDummy).
 */

import { apiFetch, unwrap } from './apiSource';
import { initDb, queryFirst, run } from './db';

/** Kode mata uang yang didukung POS. */
export type BranchCurrencyCode = 'IDR' | 'AUD';

/** Currency cabang yang di-cache di memori. */
export interface CachedCurrency {
  code: BranchCurrencyCode;
  locale: string;
}

/** Fallback perilaku lama: IDR + locale Indonesia. */
export const CURRENCY_FALLBACK: CachedCurrency = { code: 'IDR', locale: 'id-ID' };

/** Locale bawaan per kode (dipakai bila server/baris lokal tak membawa locale). */
export const LOCALE_BY_CURRENCY: Record<BranchCurrencyCode, string> = {
  IDR: 'id-ID',
  AUD: 'en-AU',
};

let cached: CachedCurrency = { ...CURRENCY_FALLBACK };

/** Normalisasi kode asing → IDR (fallback lama, tak pernah blank). */
function normalizeCode(raw: unknown): BranchCurrencyCode {
  const c = String(raw ?? '').trim().toUpperCase();
  return c === 'AUD' ? 'AUD' : 'IDR';
}

function normalizeLocale(raw: unknown, code: BranchCurrencyCode): string {
  const l = String(raw ?? '').trim();
  return l || LOCALE_BY_CURRENCY[code];
}

/** Baca cache currency saat ini (salinan; sinkron agar bisa dipakai rp()). */
export function getCachedCurrency(): CachedCurrency {
  return { ...cached };
}

/**
 * Tulis cache secara eksplisit (mis. setelah login memilih branch).
 * Kode asing dinormalisasi ke IDR; locale kosong diisi bawaan per kode.
 */
export function setCachedCurrency(code: string, locale?: string): CachedCurrency {
  const c = normalizeCode(code);
  cached = { code: c, locale: normalizeLocale(locale, c) };
  return getCachedCurrency();
}

/** Kupas field `currency` dari payload profil (toleran dua bentuk envelope). */
function readCurrencyFromProfile(data: Record<string, unknown>): string {
  const direct = data.currency;
  if (typeof direct === 'string' && direct.trim()) return direct;
  for (const nest of ['merchant', 'branch', 'profile', 'data']) {
    const inner = data[nest];
    if (inner && typeof inner === 'object') {
      const c = (inner as Record<string, unknown>).currency;
      if (typeof c === 'string' && c.trim()) return c;
    }
  }
  return '';
}

/** Persist cache ke ms_setting(Branch, Currency) = (code, locale). */
async function persistCurrency(code: BranchCurrencyCode, locale: string): Promise<void> {
  await initDb();
  await run(
    `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Branch', 'Currency', ?, ?)` +
      ` ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
    [code, locale],
  );
}

/**
 * Sinkronisasi currency: server dulu, lalu baris lokal, lalu fallback IDR.
 * - Server (GET api/merchant/profile): bila ok + bukan dummy + ada field
 *   currency → persist ke ms_setting + set cache.
 * - Lokal: bila baris ms_setting(Branch, Currency) ada dan valid → set cache
 *   (tanpa network).
 * - Selain itu: cache = fallback IDR (perilaku lama), tanpa throw.
 * SENGAJA tanpa markDirty: baris ini milik server (pull), bukan data kotor push.
 */
export async function syncCurrencyFromProfile(): Promise<CachedCurrency> {
  try {
    const r = await apiFetch('api/merchant/profile', { method: 'GET' });
    if (r.ok && !r.fromDummy) {
      const { data } = unwrap<Record<string, unknown>>(r.data);
      const raw = readCurrencyFromProfile(data ?? {});
      if (raw.trim()) {
        const code = normalizeCode(raw);
        const locale = normalizeLocale('', code);
        try {
          await persistCurrency(code, locale);
        } catch {
          /* persist gagal: cache tetap di-set */
        }
        cached = { code, locale };
        return getCachedCurrency();
      }
    }
  } catch {
    /* offline / BE belum ada: jatuh ke baris lokal */
  }
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null; value2: string | null }>(
      `SELECT value1, value2 FROM ms_setting WHERE key1 = 'Branch' AND key2 = 'Currency' LIMIT 1`,
    );
    const raw = (row?.value1 ?? '').trim();
    if (raw) {
      const code = normalizeCode(raw);
      cached = { code, locale: normalizeLocale(row?.value2, code) };
      return getCachedCurrency();
    }
  } catch {
    /* DB gagal: jatuh ke fallback */
  }
  cached = { ...CURRENCY_FALLBACK };
  return getCachedCurrency();
}
