/**
 * Token radius terpusat - konsolidasi pemakaian `borderRadius` di repo.
 *
 * Sebaran aktual (grep `borderRadius` di `src`, Okt 2026):
 * - 10 → ±190 pakai (terbanyak: sel, kartu kecil, bungkus ikon 40)
 * - 8  → ±94 pakai (badge, tombol kecil, kotak ikon)
 * - 12 → ±82 pakai (kartu standar, CTA Dashboard)
 * - 16 → ±30 pakai (kartu besar, modal, helpCard)
 * - 14 → ±20 pakai (input h56 Login)
 *
 * Aturan pakai:
 * - Pilih token di bawah utk bentuk baru; jangan tambah literal baru.
 * - Lingkaran (avatar, dot, logo bulat) = setengah sisi elemen
 *   (cth. 40→20, 64→32, 84→42), jadi TIDAK ditoken di sini.
 * - `pill` (999) utk kapsul penuh yg lebarnya dinamis.
 * - `cta` (12) = PAR-01 parity (2026-10-27): CTA 12px paritas FE rounded-lg.
 *   Dulu stadium 28 (tinggi/2) ala Login; kini 12. Layar lama dgn literal 28
 *   dimigrasi bertahap ke token ini (LoginScreen masih literal, lihat decision-packet).
 * - Literal ganjil yg tersisa (3, 4, 5, 15, 125, …) adalah warisan
 *   khas satu layar - biarkan apa adanya sampai layar itu dimigrasi.
 */
export const radius = {
  /** Badge mini, statusBadge, chip kecil. */
  xs: 6,
  /** Badge, tombol kecil, kotak ikon kecil. */
  sm: 8,
  /** Kartu kecil, sel grid, bungkus ikon 40. */
  md: 10,
  /** Kartu standar + CTA Dashboard. */
  lg: 12,
  /** Input h56 ala Login — PAR-01 parity 12 (dulu 14), paritas FE rounded-lg + border #D0D5DD. */
  input: 12,
  /** Kartu besar + modal. */
  xl: 16,
  /** CTA 12px paritas FE (dulu stadium 28 = tinggi/2). */
  cta: 12,
  /** Kapsul penuh utk lebar dinamis. */
  pill: 999,
} as const;

export type RadiusKey = keyof typeof radius;
