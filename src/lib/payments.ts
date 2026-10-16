/**
 * Katalog metode pembayaran lanjutan (fakta domain APK: deposit, online,
 * transfer/external, kompliment, non-penjualan). Implementasi orisinal;
 * pelunasan tetap direkonsiliasi server lewat antrean sync.
 */
import { enqueueSync } from './sync';

export type ExtraMethodId = 'transfer' | 'deposit' | 'compliment' | 'nonsales';

export interface ExtraMethod {
  id: ExtraMethodId;
  label: string;
  desc: string;
  needsAuth: boolean;
}

export const EXTRA_METHODS: ExtraMethod[] = [
  { id: 'transfer', label: 'Transfer Bank', desc: 'Konfirmasi manual mutasi bank', needsAuth: false },
  { id: 'deposit', label: 'Deposit Member', desc: 'Potong saldo deposit member', needsAuth: false },
  { id: 'compliment', label: 'Kompliment', desc: 'Gratis — butuh persetujuan supervisor', needsAuth: true },
  { id: 'nonsales', label: 'Non-Penjualan', desc: 'Konsumsi internal — butuh persetujuan', needsAuth: true },
];

export const EXTRA_LABEL: Record<ExtraMethodId, string> = {
  transfer: 'Transfer',
  deposit: 'Deposit',
  compliment: 'Kompliment',
  nonsales: 'Non-Penjualan',
};

/** Catat pelunasan ke antrean agar terkirim saat online (tanpa data sensitif). */
export function recordSale(method: string, total: number, extra?: Record<string, unknown>): void {
  try {
    enqueueSync('order', {
      method,
      total: Math.round(total),
      ts: new Date().toISOString(),
      ...(extra ?? {}),
    });
  } catch {
    /* antrean penuh/rusak — jangan blokir kasir */
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** Catat permintaan kirim struk via email (isi body ikut kontrak server Anda). */
export function recordReceiptEmail(email: string, no: string, total: number, method: string): void {
  enqueueSync('receipt', { email: email.trim(), no, total: Math.round(total), method });
}
