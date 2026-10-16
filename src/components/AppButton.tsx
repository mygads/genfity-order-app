/**
 * Alias bersama untuk tombol - bungkus tipis di atas `Button`
 * agar impor seragam (`AppButton`) tanpa menduplikat gaya.
 * Varian primer (oranye) + sekunder (outline navy) + danger hidup
 * di components/Button.tsx; jangan tambah gaya di sini.
 */
import type { ComponentProps } from 'react';
import Button from './Button';

/** Props sama persis dengan `Button` (title, variant, disabled, ...). */
export type AppButtonProps = ComponentProps<typeof Button>;

/** Ekspor ulang varian agar pemanggil tak perlu impor Button langsung. */
export type { ButtonVariant as AppButtonVariant } from './Button';

/** Tombol bersama - teruskan semua props ke `Button`. */
export default function AppButton(props: AppButtonProps) {
  return <Button {...props} />;
}
