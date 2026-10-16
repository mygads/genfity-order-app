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
  { id: 'compliment', label: 'Kompliment', desc: 'Gratis - butuh persetujuan supervisor', needsAuth: true },
  { id: 'nonsales', label: 'Non-Penjualan', desc: 'Konsumsi internal - butuh persetujuan', needsAuth: true },
];

export const EXTRA_LABEL: Record<ExtraMethodId, string> = {
  transfer: 'Transfer',
  deposit: 'Deposit',
  compliment: 'Kompliment',
  nonsales: 'Non-Penjualan',
};

export interface SaleItemIn {
  id: string;
  name: string;
  basePrice: number;
  qty: number;
  modifiers?: { name: string; price: number }[];
  discount?: number;
  note?: string;
}

export interface SalePaymentIn {
  method: string;
  amount: number;
  approvalCode?: string;
  voucherCode?: string;
}

export interface SaleInput {
  method: string;
  grandTotal: number;
  /** Nomor struk pemanggil (TRX-…) - dipakai saveSale + push agar satu nomor. */
  salesNum?: string;
  subtotal?: number;
  discountTotal?: number;
  vatTotal?: number;
  serviceTotal?: number;
  /** Fee platform order ESB/marketplace → payload kontrak §5: platformFee. */
  feeESB?: number;
  cash?: number;
  change?: number;
  items?: SaleItemIn[];
  payments?: SalePaymentIn[];
  voucherCode?: string;
  approvalCode?: string;
  memberId?: string;
  tableId?: string;
  /** Konteks order dari kasir (dine-in/bawa-pulang/delivery, dst). */
  mode?: string;
  /** Biaya antar - 0/absen = tidak ada. */
  ongkir?: number;
  /** Nama pelanggan (delivery / pencatatan kasir). */
  customer?: string;
}

const METHOD_MAP: Record<string, string> = {
  cash: 'Tunai',
  debit: 'Debit',
  kredit: 'Kredit',
  qris: 'QRIS',
  ovo: 'OVO',
  gopay: 'GoPay',
  dana: 'DANA',
  shopeepay: 'ShopeePay',
  transfer: 'Transfer',
  deposit: 'Deposit',
  compliment: 'Kompliment',
  nonsales: 'Non-Penjualan',
  pluxee: 'Pluxee',
  ultra: 'Ultra',
  voucher: 'Voucher',
};

/** Subtotal satu baris kanonis kasir: (harga + Σ modifier) × qty - diskon. */
export function lineSubtotal(it: SaleItemIn): number {
  const mod = (it.modifiers ?? []).reduce((a, m) => a + m.price, 0);
  return Math.round((it.basePrice + mod) * it.qty - (it.discount ?? 0));
}

/**
 * Normalisasi mode kasir → enum kontrak §5 (DINE_IN / TAKE_AWAY / DELIVERY).
 * Mode agregator (GOFOOD/GRABFOOD/SHOPEEFOOD/online) diteruskan apa adanya.
 */
export function normalizeSalesMode(raw?: string): string {
  const k = (raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!k) return 'DINE_IN';
  if (/DINE/.test(k)) return 'DINE_IN';
  if (/TAKE|BAWA|BUNGKUS|TA\b/.test(k)) return 'TAKE_AWAY';
  if (/DELIVER|ANTAR|KURIR|OJEK|DEL\b/.test(k)) return 'DELIVERY';
  if (/GOFOOD|GRABFOOD|SHOPEEFOOD|ONLINE|ESB/.test(k)) return k.replace(/_ORDER$/, '');
  return k;
}
export function normalizeMethod(m: string): string {
  const k = m.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (METHOD_MAP[k]) return METHOD_MAP[k];
  if (/^debit/.test(k)) return 'Debit';
  if (/^kredit/.test(k)) return 'Kredit';
  return m;
}

/**
 * Susun body tier-penuh sesuai docs/API-CONTRACT.md §5.
 * Tanpa data sensitif: tidak ada nomor kartu/CVV/PIN di sini.
 */
export function buildSalePayload(s: SaleInput): Record<string, unknown> {
  const r = (n: number) => Math.round(n);
  const items = (s.items ?? []).map((it) => ({
    menuId: it.id,
    name: it.name,
    qty: it.qty,
    price: r(it.basePrice),
    discount: r(it.discount ?? 0),
    modifiers: (it.modifiers ?? []).map((m) => ({ name: m.name, price: r(m.price) })),
    ...(it.note ? { note: it.note } : {}),
  }));
  const subtotal = s.subtotal ?? (s.items ?? []).reduce((a, it) => a + lineSubtotal(it), 0);
  const payments: Record<string, unknown>[] =
    s.payments && s.payments.length > 0
      ? s.payments.map((p) => ({
          method: normalizeMethod(p.method),
          amount: r(p.amount),
          ...(p.approvalCode ? { approvalCode: p.approvalCode } : {}),
          ...(p.voucherCode ? { voucherCode: p.voucherCode } : {}),
        }))
      : [{ method: normalizeMethod(s.method), amount: r(s.grandTotal) }];
  return {
    method: normalizeMethod(s.method),
    ...(s.salesNum ? { salesNum: s.salesNum } : {}),
    total: r(s.grandTotal),
    subtotal: r(subtotal),
    discountTotal: r(s.discountTotal ?? 0),
    ...(s.vatTotal !== undefined ? { vatTotal: r(s.vatTotal) } : {}),
    ...(s.serviceTotal !== undefined ? { serviceTotal: r(s.serviceTotal) } : {}),
    ...(s.feeESB !== undefined && s.feeESB > 0 ? { platformFee: r(s.feeESB) } : {}),
    grandTotal: r(s.grandTotal),
    ...(items.length > 0 ? { items } : {}),
    payments,
    ...(s.cash !== undefined ? { cash: r(s.cash) } : {}),
    ...(s.change !== undefined ? { change: r(s.change) } : {}),
    ...(s.voucherCode ? { voucherCode: s.voucherCode } : {}),
    ...(s.approvalCode ? { approvalCode: s.approvalCode } : {}),
    ...(s.memberId ? { memberId: s.memberId } : {}),
    ...(s.tableId ? { tableId: s.tableId } : {}),
    ...(s.mode ? { mode: normalizeSalesMode(s.mode), salesMode: normalizeSalesMode(s.mode) } : {}),
    ...(s.ongkir !== undefined && s.ongkir > 0 ? { ongkir: r(s.ongkir) } : {}),
    ...(s.customer ? { customer: s.customer } : {}),
    ts: new Date().toISOString(),
  };
}

/** Catat pelunasan ke antrean agar terkirim saat online (tanpa data sensitif). */
export function recordSale(input: SaleInput): void {
  try {
    enqueueSync('order', buildSalePayload(input));
  } catch {
    /* antrean penuh/rusak - jangan blokir kasir */
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** Catat permintaan kirim struk via email (isi body ikut kontrak server Anda). */
export function recordReceiptEmail(email: string, no: string, total: number, method: string): void {
  enqueueSync('receipt', { email: email.trim(), no, total: Math.round(total), method });
}
