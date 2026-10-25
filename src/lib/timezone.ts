/**
 * Zona waktu merchant untuk struk/laporan POS (PP-011).
 *
 * - Sumber kebenaran: profil merchant server (GET api/merchant/profile,
 *   field `timezone`) → fallback per currency (AUD → `Australia/Perth`,
 *   selain itu → `Asia/Jakarta`) → `UTC` bila Intl menolak.
 * - Perth untuk AU mengikuti dashboard FE (`Australia/Perth` utk AU,
 *   admin_dashboard.go:163) + seed/tests BE — BUKAN Sydney (default
 *   merchantCountryDefaultTimezone untuk negara non-ID).
 * - Cache sinkron agar bisa dipakai formatter (pola lib/currency.ts);
 *   sync dipanggil setelah login/syncCurrencyFromProfile.
 */

import { apiFetch, unwrap } from './apiSource';
import { getCachedCurrency } from './currency';
import { initDb, queryFirst, run } from './db';

export const TZ_PERTH = 'Australia/Perth';
export const TZ_JAKARTA = 'Asia/Jakarta';
export const TZ_UTC = 'UTC';

let cachedTz = TZ_JAKARTA;

function fallbackForCurrency(): string {
  try {
    return getCachedCurrency().code === 'AUD' ? TZ_PERTH : TZ_JAKARTA;
  } catch {
    return TZ_JAKARTA;
  }
}

function normalizeTz(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  try {
    // Validasi via Intl — lempar bila zona tak dikenal.
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

/** Baca cache timezone merchant saat ini (sinkron agar bisa dipakai formatter). */
export function getCachedTimezone(): string {
  return cachedTz;
}

/**
 * Singkatan zona untuk label jam operasional (DUAL-CURRENCY §4c — pengganti
 * 'WIB' hardcode di idle_hours_val/help.contact). Peta eksplisit agar
 * deterministik di semua engine; zona tak dikenal = tampil nama zonanya
 * sendiri (jujur, bukan WIB yang salah).
 *
 * R4-DOCS(a) SoT JAM OPERASIONAL = DISPLAY-ONLY: label '08.00 - 22.00 {tz}'
 * (i18n idle_hours_val, render IdleScreen infoRow) adalah teks STATIS, BUKAN
 * jadwal yang dienforce server — server tak menolak order di luar jam ini.
 * Jangan jadikan gerbang (mis. blokir kasir / kunci PayScreen) tanpa kontrak
 * + endpoint BE. (Catatan ditaruh di sini — bukan di IdleScreen — karena
 * tripwire-shiftcash W1-05 mengunci status Idle* sebagai aset lane W1.)
 */
const TZ_SHORT: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
  'Australia/Perth': 'AWST',
  'Australia/Sydney': 'AEST',
  'Australia/Melbourne': 'AEST',
  UTC: 'UTC',
};

export function getTimezoneShort(timeZone?: string): string {
  const z = (timeZone ?? '').trim() || getCachedTimezone();
  return TZ_SHORT[z] ?? z;
}

/** Tulis cache secara eksplisit (mis. setelah pilih branch). Tak pernah melempar. */
export function setCachedTimezone(tz: string): string {
  const v = normalizeTz(tz) ?? fallbackForCurrency();
  cachedTz = v;
  return cachedTz;
}

function readTimezoneFromProfile(data: Record<string, unknown>): string {
  const direct = data.timezone;
  if (typeof direct === 'string' && direct.trim()) return direct;
  for (const nest of ['merchant', 'branch', 'profile', 'data']) {
    const inner = data[nest];
    if (inner && typeof inner === 'object') {
      const c = (inner as Record<string, unknown>).timezone;
      if (typeof c === 'string' && c.trim()) return c;
    }
  }
  return '';
}

/**
 * Sinkronisasi timezone: server dulu, lalu baris lokal ms_setting
 * (Branch, Timezone), lalu fallback per currency. Tak pernah melempar.
 */
export async function syncTimezoneFromProfile(): Promise<string> {
  try {
    const r = await apiFetch('api/merchant/profile', { method: 'GET' });
    if (r.ok && !r.fromDummy) {
      const { data } = unwrap<Record<string, unknown>>(r.data);
      const raw = readTimezoneFromProfile(data ?? {});
      const v = normalizeTz(raw);
      if (v) {
        cachedTz = v;
        try {
          await initDb();
          await run(
            `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Branch', 'Timezone', ?, '')` +
              ` ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1`,
            [v],
          );
        } catch {
          /* persist gagal: cache tetap di-set */
        }
        return cachedTz;
      }
    }
  } catch {
    /* offline / BE belum ada: jatuh ke baris lokal */
  }
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Branch' AND key2 = 'Timezone' LIMIT 1`,
    );
    const v = normalizeTz(row?.value1 ?? '');
    if (v) {
      cachedTz = v;
      return cachedTz;
    }
  } catch {
    /* DB gagal: jatuh ke fallback */
  }
  cachedTz = fallbackForCurrency();
  return cachedTz;
}
