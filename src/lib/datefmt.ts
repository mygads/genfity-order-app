/**
 * Formatter tanggal locale-aware (id vs en) untuk seluruh aplikasi.
 *
 * - `fmtDate`: Date → '13 Okt 2026' (id) / '13 Oct 2026' (en).
 * - `fmtTime`: Date → '12:04' (24 jam, bebas locale perangkat).
 * - `fmtSalesDate`: string ISO → { date, time } (pengganti BULAN manual
 *   yang dulu hidup di lib/history.ts).
 * - Varian `*InTz`: sama, tapi dalam zona waktu merchant (lib/timezone;
 *   AUD = Australia/Perth). PW-4/S3: struk/laporan harus ikut jam cabang,
 *   bukan jam perangkat kasir.
 */
import type { Lang } from './i18n';
import { getCachedCurrency } from './currency';
import { getCachedTimezone } from './timezone';

/**
 * Locale tanggal mengikuti currency cabang, BUKAN bahasa UI (DUAL-CURRENCY
 * §4e): cabang AUD selalu en-AU (format Sydney) walau UI berbahasa Indonesia;
 * selain itu peta lama per bahasa (id → id-ID, en → fallback pemanggil).
 */
function branchLocale(lang: Lang, enFallback: string): string {
  try {
    if (getCachedCurrency().code === 'AUD') return 'en-AU';
  } catch {
    /* cache belum siap: fallback bahasa UI */
  }
  return lang === 'id' ? 'id-ID' : enFallback;
}

/** Nol depan untuk jam/menit ('4' → '04'). */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date → tanggal pendek sesuai bahasa ('13 Okt 2026' / '13 Oct 2026'). */
export function fmtDate(d: Date, lang: Lang = 'id'): string {
  if (Number.isNaN(d.getTime())) return '-';
  const locale = lang === 'id' ? 'id-ID' : 'en-GB';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Date → '12:04' (24 jam). */
export function fmtTime(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Waktu lokal format server 'YYYY-MM-DD HH:MM:SS' untuk banding string
 * window validFrom/validTo di SQLite (kolom DATETIME server = waktu lokal,
 * BUKAN UTC — toISOString() membunuh voucher X jam lebih awal). */
export function dbNowLocal(d = new Date()): string {
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** ISO → { date, time }; aman untuk string rusak ('-' / ''). */
export function fmtSalesDate(iso: string, lang: Lang = 'id'): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '-', time: '' };
  return { date: fmtDate(d, lang), time: fmtTime(d) };
}

/* ---- Varian zona-merchant (PW-4/S3) ---- */

/** Zona merchant aktif: param eksplisit dulu, lalu cache lib/timezone. */
function merchantTz(timeZone?: string): string {
  return (timeZone ?? '').trim() || getCachedTimezone();
}

/**
 * Offset menit zona `timeZone` terhadap UTC pada instant `d`
 * (null bila Intl menolak zona). `% 24` menjinakkan "hour 24" tengah malam
 * ala en-US hour12:false di sebagian engine.
 */
function tzOffsetMinutes(d: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(d);
    const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const asUTC = Date.UTC(
      Number(v('year')),
      Number(v('month')) - 1,
      Number(v('day')),
      Number(v('hour')) % 24,
      Number(v('minute')),
      Number(v('second')),
    );
    if (!Number.isFinite(asUTC)) return null;
    return Math.round((asUTC - d.getTime()) / 60000);
  } catch {
    return null;
  }
}

/** Geser instant ke dinding-waktu zona merchant (lantas pakai getter UTC). */
function inMerchantTz(d: Date, timeZone?: string): Date {
  const off = tzOffsetMinutes(d, merchantTz(timeZone));
  return off === null ? d : new Date(d.getTime() + off * 60000);
}

/** Date → tanggal pendek sesuai bahasa DALAM zona merchant. */
export function fmtDateInTz(d: Date, lang: Lang = 'id', timeZone?: string): string {
  if (Number.isNaN(d.getTime())) return '-';
  const locale = branchLocale(lang, 'en-AU');
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: merchantTz(timeZone),
    }).format(d);
  } catch {
    return fmtDate(d, lang);
  }
}

/** Date → 'HH:MM' 24 jam DALAM zona merchant. */
export function fmtTimeInTz(d: Date, timeZone?: string): string {
  if (Number.isNaN(d.getTime())) return '';
  const s = inMerchantTz(d, timeZone);
  return `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD HH:MM:SS' DALAM zona merchant — pengganti dbNowLocal yang
 * sadar-cabang (dbNowLocal = jam perangkat; salah bila kasir beda zona
 * dengan cabang). */
export function dbNowInTz(d = new Date(), timeZone?: string): string {
  if (Number.isNaN(d.getTime())) return '';
  const s = inMerchantTz(d, timeZone);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())} ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}`;
}

/** ISO → { date, time } DALAM zona merchant. */
export function fmtSalesDateInTz(
  iso: string,
  lang: Lang = 'id',
  timeZone?: string,
): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '-', time: '' };
  return { date: fmtDateInTz(d, lang, timeZone), time: fmtTimeInTz(d, timeZone) };
}
