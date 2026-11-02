/**
 * PIN-lockout countdown (423 Retry-After + retryAfter body).
 *
 * BE mengirim countdown 423 dua jalur: header `Retry-After` (klien HTTP
 * standar) + field body `retryAfter` (detik). Jalur body yang dipakai di
 * sini karena apiFetch/apiPost POS meneruskan body apa adanya sementara
 * header hanya tersedia pada pemanggil apiPost mentah. Best-effort murni:
 * nilai tak valid/absen = 0 → pemanggil memakai pesan generik lama.
 */

/** Header Retry-After mentah → detik (>0), else 0. */
export function parseRetryAfterSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? Math.floor(value) : 0;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Field body `retryAfter` (envelope BE atau data) → detik (>0), else 0. */
export function bodyRetryAfterSeconds(body: unknown): number {
  try {
    const b = (body ?? {}) as Record<string, unknown>;
    const inner = (b.data ?? b) as Record<string, unknown>;
    const raw = (inner.retryAfter ?? b.retryAfter) as unknown;
    return parseRetryAfterSeconds(raw);
  } catch {
    return 0;
  }
}

/**
 * Akhiran countdown untuk pesan 423, mis. " - coba lagi dalam 4 mnt" /
 * " - try again in 4 min" (di bawah 60 dtk: detik). '' bila sec <= 0 agar
 * pemanggil jatuh ke pesan generik lama.
 */
export function lockCountdownSuffix(sec: number, lang: string): string {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const id = lang === 'id';
  if (sec >= 60) {
    const m = Math.max(1, Math.ceil(sec / 60));
    return id ? ` - coba lagi dalam ${m} mnt` : ` - try again in ${m} min`;
  }
  const s = Math.max(1, Math.ceil(sec));
  return id ? ` - coba lagi dalam ${s} dtk` : ` - try again in ${s}s`;
}
