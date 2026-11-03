/**
 * GAP-DD (rekomendasi audit clock-skew): estimasi selisih jam perangkat vs
 * server dari header `Date` tiap respons HTTP (choke point: apiFetch di
 * apiSource.ts). Tanpa ini, window voucher/promo + validasi waktu diam-diam
 * meleset bila jam HP maju/mundur; shift/rekap wall-clock ikut bergeser.
 *
 * Fail-safe: sampling best-effort (try/catch, header absen = diam); modul
 * TAK PERNAH melempar dan tak mengubah alur fetch. UI membaca
 * isClockSkewed()/clockSkewText() untuk banner jujur di ShiftScreen.
 */

/** Ambang banner: selisih > 5 menit dianggap material. */
export const CLOCK_SKEW_ALERT_MS = 5 * 60_000;

let skewMs: number | null = null;
let lastSampleAt = 0;

/** Catat satu sampel (header `Date` respons). Invalid/absen = abaikan. */
export function noteClockSample(dateHeader: string | null | undefined): void {
  try {
    if (!dateHeader) return;
    const t = Date.parse(dateHeader);
    if (Number.isNaN(t)) return;
    skewMs = t - Date.now();
    lastSampleAt = Date.now();
  } catch {
    /* abaikan - sampling tak boleh ganggu fetch */
  }
}

/** Selisih terakhir server-perangkat (ms; positif = jam server lebih maju). */
export function getClockSkewMs(): number | null {
  return skewMs;
}

/** true bila selisih terakhir melewati ambang (default 5 mnt). */
export function isClockSkewed(thresholdMs = CLOCK_SKEW_ALERT_MS): boolean {
  return skewMs !== null && Math.abs(skewMs) > thresholdMs;
}

/** Teks banner jujur (null bila belum ada sampel / masih wajar). */
export function clockSkewText(lang: 'id' | 'en' = 'id'): string | null {
  if (!isClockSkewed() || skewMs === null) return null;
  const mins = Math.round(Math.abs(skewMs) / 60_000);
  const arah = skewMs > 0 ? (lang === 'id' ? 'lebih maju' : 'ahead of') : lang === 'id' ? 'tertinggal dari' : 'behind';
  return lang === 'id'
    ? `Jam server ${arah} ±${mins} mnt dari HP ini - periksa jam perangkat bila voucher/shift meleset.`
    : `Server clock is ${arah} this device by ~${mins} min - check device time if vouchers/shifts look off.`;
}
