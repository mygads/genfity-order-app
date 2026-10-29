/**
 * Katalog metode pembayaran lanjutan (fakta domain APK: deposit, online,
 * transfer/external, kompliment, non-penjualan). Implementasi orisinal;
 * pelunasan tetap direkonsiliasi server lewat antrean sync.
 */
import { parseCustomerId } from './memberRef';
import { enqueueSync } from './sync';

export type ExtraMethodId = 'transfer' | 'deposit' | 'compliment' | 'nonsales';

export interface ExtraMethod {
  id: ExtraMethodId;
  labelKey: string;
  descKey: string;
  needsAuth: boolean;
}

export const EXTRA_METHODS: ExtraMethod[] = [
  { id: 'transfer', labelKey: 'xp_m_transfer', descKey: 'xp_m_transfer_d', needsAuth: false },
  { id: 'deposit', labelKey: 'xp_m_deposit', descKey: 'xp_m_deposit_d', needsAuth: false },
  { id: 'compliment', labelKey: 'xp_m_compliment', descKey: 'xp_m_compliment_d', needsAuth: true },
  { id: 'nonsales', labelKey: 'xp_m_nonsales', descKey: 'xp_m_nonsales_d', needsAuth: true },
];

/** Label metode lanjutan lewat kamus i18n (jangan hardcode string user-facing). */
export function xmLabel(m: ExtraMethod, t: (k: string) => string): string {
  return t(m.labelKey);
}

/** Deskripsi metode lanjutan lewat kamus i18n. */
export function xmDesc(m: ExtraMethod, t: (k: string) => string): string {
  return t(m.descKey);
}

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
  /** client_id UUIDv7 (Q7): diterbitkan sekali per sale (PayScreen), dipakai
   * ulang apa adanya oleh Qris/settlePaid — JANGAN generate ulang agar QR
   * yang tampil tak basi. Kunci rekonsiliasi server (upsert by client_id). */
  clientId?: string;
  subtotal?: number;
  discountTotal?: number;
  vatTotal?: number;
  serviceTotal?: number;
  /** Tip/gratuity pelanggan (nominal Rp utuh) — opsional; 0/absen = tanpa tip.
   * Diputuskan saat bayar (PayScreen), dibawa ke BE sebagai `tipAmount`
   * (kolom orders.tip_amount; cap = subtotal, ditegakkan server). */
  tipTotal?: number;
  /** Fee platform order ESB/marketplace → payload kontrak §5: platformFee. */
  feeESB?: number;
  /** Biaya kemasan nominal (Rp utuh) — LEDGER LOKAL SAJA. SENGAJA tak
   * dikirim ke BE: kontrak pos/payment tak punya field kemasan; nilainya
   * tetap terbawa di dalam grandTotal (finalTotal). Cermin aturan ongkir
   * yang menempel pada bill. */
  packagingFee?: number;
  cash?: number;
  change?: number;
  items?: SaleItemIn[];
  payments?: SalePaymentIn[];
  voucherCode?: string;
  approvalCode?: string;
  /** Id user ms_posuser penyetuju eskalasi (kompliment/non-penjualan) — audit. */
  approvedBy?: string;
  /** Ronde-3 Q1: ref member OTORITATIF = customerId GO (int, dari hasil
   *  searchServerCustomers yang ditempel). HANYA ini yang disimpan di
   *  transaksi + dikirim ke BE (payload create/settle/sync). */
  customerId?: number;
  /** Pointer ledger deposit lokal (legacy, format `MC{id}` / `M…`).
   *  DEPRECATED sebagai ref transaksi: saveSale menurunkan ulang dari
   *  customerId bila ada; kolom ini hanya fallback bila customerId absen
   *  (data lama). JANGAN kirim ke BE — buildSalePayload tak lagi memakainya. */
  memberId?: string;
  tableId?: string;
  /** Konteks order dari kasir (dine-in/bawa-pulang/delivery, dst). */
  mode?: string;
  /** Pembulatan struk (bisa negatif) - 0/absen = tidak ada. */
  rounding?: number;
  /** Biaya antar - 0/absen = tidak ada. */
  ongkir?: number;
  /** Porsi voucher yang memotong ongkir (info audit; ongkir di atas = neto). */
  ongkirCut?: number;
  /** Nama pelanggan (delivery / pencatatan kasir). */
  customer?: string;
  /** Adaptive Vertical Shell Fase 3 (SERVICE/HOME_SERVICE via POS):
   * jadwal wajib BE (YYYY-MM-DD + HH:MM) + teknisi + DP% + alamat.
   * Best-effort optional — payload lama tanpa field ini tetap jalan. */
  serviceDate?: string;
  serviceTime?: string;
  technician?: string;
  dpPercent?: number;
  deliveryAddress?: string;
  deliveryFee?: number;
  /** Nomor antrean display (QS-014 gaya): bila kosong saveSale menurunkan
   * dari suffix NNNN salesNum agar CustomerDisplay/QueueView tak selalu
   * fallback ke salesNum penuh. */
  queueNumber?: string;
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
 * Normalisasi mode kasir → enum BE-kanonis §5 (DINE_IN / TAKEAWAY / DELIVERY).
 * TAKE_AWAY (underscore) TAK PERNAH di-emit: POS create Go menolaknya
 * (orders_pos_create.go:196 — hanya DINE_IN/TAKEAWAY/IN_STORE_ORDER/
 * IN_STORE_SERVICE). Mode agregator (GOFOOD/GRABFOOD/SHOPEEFOOD/online)
 * diteruskan apa adanya di payload; kanonisasi POS-create terjadi di
 * sync.ts goPosOrderType (agregator/DELIVERY → TAKEAWAY).
 */
export function normalizeSalesMode(raw?: string): string {
  const k = (raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!k) return 'DINE_IN';
  if (/DINE/.test(k)) return 'DINE_IN';
  if (/TAKE|BAWA|BUNGKUS|TA\b/.test(k)) return 'TAKEAWAY';
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
    // displayNo = nomor struk manusiawi untuk kolom backend display_no
    // (orders_pos_create.go parsePOSSaleIdentity: butuh clientId saudaranya;
    // tanpa displayNo, backend tak mengisi display_no). salesNum adalah
    // sumber tunggalnya — satu nomor untuk saveSale + push + QR.
    ...(s.salesNum ? { displayNo: s.salesNum } : {}),
    // Kunci stabil QR + rekonsiliasi (Q7). Bentuk camelCase menyamai
    // clientId outbox fisik (sync.ts drainPhysicalQueue) — satu kunci di
    // semua payload; BE terima-dua-format selama transisi. Bentuk snake_case
    // client_id dikirim juga (APP-PRINTER-SALES): server upsert by client_id.
    ...(s.clientId ? { clientId: s.clientId, client_id: s.clientId } : {}),
    total: r(s.grandTotal),
    subtotal: r(subtotal),
    discountTotal: r(s.discountTotal ?? 0),
    ...(s.vatTotal !== undefined ? { vatTotal: r(s.vatTotal) } : {}),
    ...(s.serviceTotal !== undefined ? { serviceTotal: r(s.serviceTotal) } : {}),
    // Tip diteruskan apa adanya (server memvalidasi: cap subtotal, kunci usai
    // lunas). Nol/absen = tanpa tip — payload lama tak berubah.
    ...(s.tipTotal !== undefined && r(s.tipTotal) > 0 ? { tipAmount: r(s.tipTotal) } : {}),
    ...(s.feeESB !== undefined && s.feeESB > 0 ? { platformFee: r(s.feeESB) } : {}),
    ...(s.rounding !== undefined && s.rounding !== 0 ? { rounding: r(s.rounding) } : {}),
    grandTotal: r(s.grandTotal),
    ...(items.length > 0 ? { items } : {}),
    payments,
    ...(s.cash !== undefined ? { cash: r(s.cash) } : {}),
    ...(s.change !== undefined ? { change: r(s.change) } : {}),
    ...(s.voucherCode ? { voucherCode: s.voucherCode } : {}),
    ...(s.approvalCode ? { approvalCode: s.approvalCode } : {}),
    ...(s.approvedBy ? { approvedBy: s.approvedBy } : {}),
    // Ronde-3 Q1: HANYA customerId (int GO) yang naik ke BE. memberId
    // (alias lokal M/MC) SENGAJA tak dikirim — bukan data tersimpan transaksi.
    ...(parseCustomerId(s.customerId) != null ? { customerId: parseCustomerId(s.customerId) } : {}),
    ...(s.tableId ? { tableId: s.tableId } : {}),
    ...(s.mode ? { mode: normalizeSalesMode(s.mode), salesMode: normalizeSalesMode(s.mode) } : {}),
    ...(s.ongkir !== undefined && s.ongkir > 0 ? { ongkir: r(s.ongkir) } : {}),
    ...(s.ongkirCut !== undefined && s.ongkirCut > 0 ? { ongkirCut: r(s.ongkirCut) } : {}),
    ...(s.customer ? { customer: s.customer } : {}),
    ...(s.serviceDate ? { serviceDate: s.serviceDate } : {}),
    ...(s.serviceTime ? { serviceTime: s.serviceTime } : {}),
    ...(s.deliveryAddress ? { deliveryAddress: s.deliveryAddress } : {}),
    ...(s.deliveryFee !== undefined && r(s.deliveryFee) > 0 ? { deliveryFee: r(s.deliveryFee) } : {}),
    // Teknisi + DP dilipat ke notes order (BE tak punya kolom teknisi;
    // sync meneruskan notes untuk order SERVICE/HOME_SERVICE).
    ...((s.technician || (s.dpPercent !== undefined && r(s.dpPercent) > 0))
      ? { notes: [`Teknisi ${String(s.technician ?? '-').slice(0, 60)}`, s.dpPercent !== undefined && r(s.dpPercent) > 0 ? `DP ${r(s.dpPercent)}%` : ''].filter(Boolean).join(' · ').slice(0, 500) }
      : {}),
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
