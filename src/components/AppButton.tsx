/**
 * Alias bersama untuk tombol - bungkus tipis di atas `Button`
 * agar impor seragam (`AppButton`) tanpa menduplikat gaya.
 * Varian primer (oranye) + sekunder (outline navy) + danger hidup
 * di components/Button.tsx; jangan tambah gaya di sini.
 */
import type { ComponentProps } from 'react';
import { useWindowDimensions, type TextStyle, type ViewStyle } from 'react-native';
import Button from './Button';
import { TABLET_BP } from '../theme';

/**
 * Ukuran tombol bersama — samakan di semua layar agar konsisten:
 * - `sm`: di dalam card/baris padat (h36, radius 10, font 13).
 * - `md`: aksi di dalam card/container (h46, radius 12, font 14).
 * - `lg`: CTA bar bawah/full-width (h56, radius 12 PAR-01 parity FE, font 16,
 *   default; dulu radius 14).
 */
export type AppButtonSize = 'sm' | 'md' | 'lg';

/** Props sama persis dengan `Button` + `size` opsional (default `lg`). */
export type AppButtonProps = ComponentProps<typeof Button> & {
  size?: AppButtonSize;
};

// PAR-01 parity (2026-10-27): lg radius 12 paritas FE rounded-lg (dulu 14).
const SIZE_BOX: Record<AppButtonSize, ViewStyle> = {
  sm: { height: 36, borderRadius: 10, paddingHorizontal: 12 },
  md: { height: 46, borderRadius: 12, paddingHorizontal: 14 },
  lg: { height: 56, borderRadius: 12 },
};

const SIZE_TEXT: Record<AppButtonSize, TextStyle> = {
  sm: { fontSize: 13 },
  md: { fontSize: 14 },
  lg: { fontSize: 16 },
};

// Peta ukuran tablet: tinggi + font naik agar proporsional di layar lebar
// (cabang isTablet; phone pakai peta dasar tak berubah).
const SIZE_BOX_TABLET: Record<AppButtonSize, ViewStyle> = {
  sm: { height: 44, borderRadius: 10, paddingHorizontal: 12 },
  md: { height: 50, borderRadius: 12, paddingHorizontal: 14 },
  lg: { height: 60, borderRadius: 12 },
};

const SIZE_TEXT_TABLET: Record<AppButtonSize, TextStyle> = {
  sm: { fontSize: 14 },
  md: { fontSize: 15 },
  lg: { fontSize: 17 },
};

/** Ekspor ulang varian agar pemanggil tak perlu impor Button langsung. */
export type { ButtonVariant as AppButtonVariant } from './Button';

/** Tombol bersama - teruskan semua props ke `Button`, terapkan ukuran. */
export default function AppButton({ size = 'lg', style, textStyle, ...rest }: AppButtonProps) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const box = isTablet ? SIZE_BOX_TABLET[size] : SIZE_BOX[size];
  const txt = isTablet ? SIZE_TEXT_TABLET[size] : SIZE_TEXT[size];
  return <Button {...rest} style={[box, style]} textStyle={[txt, textStyle]} />;
}
