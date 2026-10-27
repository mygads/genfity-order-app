import { getCachedCurrency } from '../lib/currency';

/** Kanonis primer lintas-platform PAR-01 (2026-10-27): GENFITY #FF6B35.
 * FE: primary-500 #FF6B35. POS: colors.orange/primary kini sama. JANGAN tambah primer baru. */
export const PRIMARY = '#FF6B35';
export const PRIMARY_DARK = '#E55A2B';
/** Fokus tunggal kedua sisi: #FF6B35 (FE --color-border-focus; POS ganti BLUE). */
export const FOCUS = '#FF6B35';
/** Border input tunggal kedua sisi: FE gray-300 #D0D5DD. */
export const INPUT_BORDER_TOKEN = '#D0D5DD';

export const colors = {
  navy: '#16215E',
  navyDark: '#101845',
  /** Teks terang di atas navy (konsolidasi #B9C2E8/#C6CFE8/#C9D4F5). */
  navyTint: '#C6CFE8',
  /** Abu netral utk switch-off & tombol nonaktif (konsolidasi #CBD2DE/#C6CBD6). */
  stroke: '#CBD2DE',
  /** PAR-01 parity: disatukan ke GENFITY #FF6B35 (dulu #F5820D). Alias primary. */
  orange: '#FF6B35',
  /** PAR-01 parity: disatukan ke primary-hover #E55A2B (dulu #D96F00). */
  orangeDark: '#E55A2B',
  /** Alias eksplisit primer kanonis (dipakai CTA baru; orange dipertahankan utk kompat). */
  primary: '#FF6B35',
  primaryDark: '#E55A2B',
  /** Fokus tunggal #FF6B35 (ganti BLUE #1B5BD7 utk state fokus baru). */
  focus: '#FF6B35',
  /** Border input tunggal #D0D5DD (paritas FE gray-300; dulu #BDBDBD). */
  inputBorder: '#D0D5DD',
  green: '#1FA855',
  greenDark: '#1B7A43',
  blue: '#1B5BD7',
  blueDark: '#1438C9',
  amber: '#D99A00',
  amberDark: '#9A6B00',
  red: '#D33A3F',
  bg: '#F2F4F7',
  card: '#FFFFFF',
  white: '#FFFFFF',
  text: '#1A1A2E',
  muted: '#4A5568',
  faint: '#8A93A6',
  line: '#E2E6EE',
  paleBlue: '#EAF2FF',
  paleOrange: '#FFF4E8',
  paleGreen: '#E8F7EE',
  paleRed: '#FDECEC',
  paleAmber: '#FFF6E0',
};
export const fonts = {
  regular: 'HKGrotesk-Regular',
  medium: 'HKGrotesk-Medium',
  semibold: 'HKGrotesk-SemiBold',
  bold: 'HKGrotesk-Bold',
};
/** rp sadar-currency via cache (lib/currency): IDR = 'Rp ' + rpNum (PERSIS lama);
 * AUD = 'A$' + grouping koma + 2 desimal TANPA spasi (paritas dashboard FE
 * formatCurrency `A$10.50`); kode asing = fallback IDR + warn sekali. */
export const rp = (n: number) => {
  const { code } = getCachedCurrency();
  if (code === 'AUD') {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
    const neg = v < 0;
    const [int, dec] = Math.abs(v).toFixed(2).split('.');
    const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${neg ? '-' : ''}A$${grouped}.${dec}`;
  }
  if (code && code !== 'IDR' && !warnedCurrencyFallback) {
    warnedCurrencyFallback = true;
    try {
      console.warn(`[currency] unknown code "${code}", fallback IDR`);
    } catch {
      /* abaikan */
    }
  }
  return 'Rp ' + rpNum(n);
};
/** Angka grouping ala Indonesia tanpa prefix - utk input yg sudah ada label "Rp". */
/** Angka grouping ala Indonesia tanpa prefix - utk input yg sudah ada label "Rp". */
export const rpNum = (n: number) =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Angka grouping ala Australia tanpa prefix - pasangan rpNum utk AUD.
 * INTEGER-only (cermin rpNum): JANGAN dipakai untuk nominal currency AUD
 * (butuh 2 desimal) — pakai formatCurrency()/rp() di bawah. */
export const audNum = (n: number) =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** Grouping angka input/chip sadar-currency (S4): IDR = titik (rpNum),
 * AUD = koma (audNum). Untuk nominal TAMPIL (ada prefix) pakai rp()/formatCurrency. */
export const numGrouping = (n: number) =>
  getCachedCurrency().code === 'AUD' ? audNum(n) : rpNum(n);
let warnedCurrencyFallback = false;
/** Format mata uang cabang: 'AUD' → 'A$' + grouping en-AU + 2 desimal TANPA
 * spasi (paritas dashboard FE `A$10.50`; grouping dipertahankan ala en-AU —
 * dashboard kini tanpa grouping, owner putuskan bila dashboard ikut grouping);
 * default/''/tak dikenal → rp(n) (fallback IDR, tak pernah blank).
 * BUG-FIX PW-4: dulu `'A$ ' + audNum(n)` (integer round → desimal hilang,
 * mis. 10.50 → "A$ 11"); kini desimal-aware. NaN/Infinity → 0 (defensif
 * ala dashboard). */
export const formatCurrency = (n: number, currency?: string) => {
  const code = (currency ?? '').trim().toUpperCase();
  if (code === 'AUD') {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
    const neg = v < 0;
    const [int, dec] = Math.abs(v).toFixed(2).split('.');
    const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${neg ? '-' : ''}A$${grouped}.${dec}`;
  }
  if (code && code !== 'IDR' && !warnedCurrencyFallback) {
    warnedCurrencyFallback = true;
    try {
      console.warn(`[currency] unknown code "${currency}", fallback IDR`);
    } catch {
      /* abaikan */
    }
  }
  return rp(n);
};

/** Token shadow terpusat PAR-01 (2026-10-27): paritas shadow-theme-* FE.
 * Dulu inline per-layar; layar baru pakai token ini. */
export const shadows = {
  xs: '0px 1px 2px 0px rgba(16, 24, 40, 0.05)',
  sm: '0px 1px 3px 0px rgba(16, 24, 40, 0.1), 0px 1px 2px 0px rgba(16, 24, 40, 0.06)',
  md: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
  lg: '0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)',
  xl: '0px 20px 24px -4px rgba(16, 24, 40, 0.08), 0px 8px 8px -4px rgba(16, 24, 40, 0.03)',
  /** CTA primer: glow orange ala FE --shadow-floating. */
  floating: '0 4px 12px rgba(255, 107, 53, 0.4)',
  /** Fokus tunggal: ring orange 12% ala FE --shadow-focus-ring. */
  focusRing: '0px 0px 0px 4px rgba(255, 107, 53, 0.12)',
} as const;

export { TABLET_BP, useIsWide, wideCenter, wideCenterLg, wideCenterSm } from './responsive';
