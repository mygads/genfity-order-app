/**
 * Alias bersama untuk tombol - bungkus tipis di atas `Button`
 * agar impor seragam (`AppButton`) tanpa menduplikat gaya.
 * Varian primer (oranye) + sekunder (outline navy) + danger hidup
 * di components/Button.tsx; jangan tambah gaya di sini.
 */
import type { ComponentProps } from 'react';
import { type TextStyle, type ViewStyle } from 'react-native';
import Button from './Button';

/**
 * Ukuran tombol bersama — samakan di semua layar agar konsisten:
 * - `sm`: di dalam card/baris padat (h36, radius 10, font 13).
 * - `md`: aksi di dalam card/container (h46, radius 12, font 14).
 * - `lg`: CTA bar bawah/full-width (h56, radius 14, font 16, default
 *   agar CTA lama tak berubah).
 */
export type AppButtonSize = 'sm' | 'md' | 'lg';

/** Props sama persis dengan `Button` + `size` opsional (default `lg`). */
export type AppButtonProps = ComponentProps<typeof Button> & {
  size?: AppButtonSize;
};

const SIZE_BOX: Record<AppButtonSize, ViewStyle> = {
  sm: { height: 36, borderRadius: 10, paddingHorizontal: 12 },
  md: { height: 46, borderRadius: 12, paddingHorizontal: 14 },
  lg: { height: 56, borderRadius: 14 },
};

const SIZE_TEXT: Record<AppButtonSize, TextStyle> = {
  sm: { fontSize: 13 },
  md: { fontSize: 14 },
  lg: { fontSize: 16 },
};

/** Ekspor ulang varian agar pemanggil tak perlu impor Button langsung. */
export type { ButtonVariant as AppButtonVariant } from './Button';

/** Tombol bersama - teruskan semua props ke `Button`, terapkan ukuran. */
export default function AppButton({ size = 'lg', style, textStyle, ...rest }: AppButtonProps) {
  return <Button {...rest} style={[SIZE_BOX[size], style]} textStyle={[SIZE_TEXT[size], textStyle]} />;
}
