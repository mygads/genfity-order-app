/**
 * Alias bersama untuk kolom input - bungkus tipis di atas `Input`
 * agar impor seragam (`AppInput`) tanpa menduplikat gaya.
 * Gaya terpadu (label + pesan error + token colors dan fonts) hidup
 * di components/Input.tsx; jangan tambah gaya di sini.
 */
import type { ComponentProps } from 'react';
import Input from './Input';

/** Props sama persis dengan `Input` (label, required, error, ...). */
export type AppInputProps = ComponentProps<typeof Input>;

/** Kolom input bersama - teruskan semua props ke `Input`. */
export default function AppInput(props: AppInputProps) {
  return <Input {...props} />;
}
