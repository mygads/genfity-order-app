/**
 * Formatter tanggal locale-aware (id vs en) untuk seluruh aplikasi.
 *
 * - `fmtDate`: Date → '13 Okt 2026' (id) / '13 Oct 2026' (en).
 * - `fmtTime`: Date → '12:04' (24 jam, bebas locale perangkat).
 * - `fmtSalesDate`: string ISO → { date, time } (pengganti BULAN manual
 *   yang dulu hidup di lib/history.ts).
 */
import type { Lang } from './i18n';

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
