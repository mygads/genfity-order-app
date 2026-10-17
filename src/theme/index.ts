export const colors = {
  navy: '#16215E',
  navyDark: '#101845',
  /** Teks terang di atas navy (konsolidasi #B9C2E8/#C6CFE8/#C9D4F5). */
  navyTint: '#C6CFE8',
  /** Abu netral utk switch-off & tombol nonaktif (konsolidasi #CBD2DE/#C6CBD6). */
  stroke: '#CBD2DE',
  orange: '#F5820D',
  orangeDark: '#D96F00',
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
export const rp = (n: number) => 'Rp ' + rpNum(n);
/** Angka grouping ala Indonesia tanpa prefix - utk input yg sudah ada label "Rp". */
/** Angka grouping ala Indonesia tanpa prefix - utk input yg sudah ada label "Rp". */
export const rpNum = (n: number) =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Angka grouping ala Australia tanpa prefix - pasangan rpNum utk AUD. */
export const audNum = (n: number) =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
let warnedCurrencyFallback = false;
/** Format mata uang cabang: 'AUD' → 'A$ ' + grouping en-AU; default/''/tak dikenal → rp(n) (fallback IDR, tak pernah blank). */
export const formatCurrency = (n: number, currency?: string) => {
  const code = (currency ?? '').trim().toUpperCase();
  if (code === 'AUD') return 'A$ ' + audNum(n);
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

export { TABLET_BP, useIsWide, wideCenter, wideCenterLg, wideCenterSm } from './responsive';
