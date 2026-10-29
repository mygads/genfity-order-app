/**
 * Adaptive Vertical Shell — 1 codebase + 7 preset vertikal (PRD multi-merchant).
 *
 * Layer1 BE (kanonis): RESTAURANT | PRODUCT | SERVICE — gate orderType POS-create.
 * Layer2 FE (preset UX): COFFEE | WARUNG_QSR | RESTO_FULL | FASHION | GROCERY |
 *   PULSA_DIGITAL | SERVICE — mengatur kategori, drawer, field checkout, pay policy.
 *
 * Best practice yang ditiru: Square (Retail vs Restaurants vs Appointments =
 * 1 engine, N preset vertikal), Toast (QSR vs full-service dipisah), Clover
 * (plan per vertikal), Moka/Majoo/Olsera (FnB+retail+service, 30rb+ UMKM).
 * Aturan kasir: home → tambah → bayar ≤3 tap; target sentuh ≥44dp; wording ID.
 */

import type { PosMerchantType } from './posModes';

export type VerticalId =
  | 'COFFEE'
  | 'WARUNG_QSR'
  | 'RESTO_FULL'
  | 'FASHION'
  | 'GROCERY'
  | 'PULSA_DIGITAL'
  | 'SERVICE';

export type PayPolicy = 'PREPAID' | 'POSTPAID' | 'DP';
export type CatalogKind = 'FNB' | 'RETAIL' | 'DIGITAL' | 'SERVICE';

export interface VerticalFlags {
  needTable: boolean;
  needKitchen: boolean;
  needBooking: boolean;
  needScan: boolean;
  needPhone: boolean;
  needSchedule: boolean;
  needTechnician: boolean;
  customItems: boolean;
  editOrder: boolean;
  allowDebt: boolean;
  allowSplit: boolean;
  allowReturn: boolean;
  onlineOnly: boolean;
}

export interface VerticalConfig {
  id: VerticalId;
  merchantType: PosMerchantType;
  /** Label Indonesia untuk onboarding/pengaturan. */
  label: string;
  example: string;
  icon: string;
  catalogKind: CatalogKind;
  categories: string[];
  payPolicy: PayPolicy;
  modes: string[];
  drawer: { tables: boolean; kitchen: boolean; booking: boolean; scan: boolean };
  flags: VerticalFlags;
  homeCtas: string[];
  receiptNote: string;
}

export const VERTICALS: Record<VerticalId, VerticalConfig> = {
  COFFEE: {
    id: 'COFFEE',
    merchantType: 'RESTAURANT',
    label: 'Coffeeshop',
    example: 'kopi, teh, jus',
    icon: '☕',
    catalogKind: 'FNB',
    categories: ['Favorit', 'Kopi', 'Non-Kopi', 'Snack', 'Dessert'],
    payPolicy: 'POSTPAID',
    modes: ['DINE IN', 'TAKE AWAY', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'],
    drawer: { tables: false, kitchen: true, booking: false, scan: false },
    flags: {
      needTable: false, needKitchen: true, needBooking: false, needScan: false,
      needPhone: false, needSchedule: false, needTechnician: false,
      customItems: true, editOrder: true, allowDebt: false, allowSplit: true,
      allowReturn: false, onlineOnly: false,
    },
    homeCtas: ['Order Baru', 'Antrean'],
    receiptNote: 'Nomor antrean + nama, tanpa meja untuk takeaway.',
  },
  WARUNG_QSR: {
    id: 'WARUNG_QSR',
    merchantType: 'RESTAURANT',
    label: 'Warung / QSR',
    example: 'warteg, geprek, bakso',
    icon: '🍗',
    catalogKind: 'FNB',
    categories: ['Favorit', 'Paket Hemat', 'Makanan', 'Minuman', 'Add-on'],
    payPolicy: 'POSTPAID',
    modes: ['DINE IN', 'TAKE AWAY', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'],
    drawer: { tables: false, kitchen: true, booking: false, scan: false },
    flags: {
      needTable: false, needKitchen: true, needBooking: false, needScan: false,
      needPhone: false, needSchedule: false, needTechnician: false,
      customItems: true, editOrder: true, allowDebt: false, allowSplit: false,
      allowReturn: false, onlineOnly: false,
    },
    homeCtas: ['Makan di Sini', 'Bungkus'],
    receiptNote: 'QSR: kecepatan > coursing; KDS ringkas.',
  },
  RESTO_FULL: {
    id: 'RESTO_FULL',
    merchantType: 'RESTAURANT',
    label: 'Resto Meja',
    example: 'resto, cafe dine-in',
    icon: '🍽️',
    catalogKind: 'FNB',
    categories: ['Favorit', 'Appetizer', 'Main Course', 'Dessert', 'Minuman'],
    payPolicy: 'POSTPAID',
    modes: ['DINE IN', 'TAKE AWAY', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'],
    drawer: { tables: true, kitchen: true, booking: true, scan: false },
    flags: {
      needTable: true, needKitchen: true, needBooking: true, needScan: false,
      needPhone: false, needSchedule: false, needTechnician: false,
      customItems: true, editOrder: true, allowDebt: true, allowSplit: true,
      allowReturn: false, onlineOnly: false,
    },
    homeCtas: ['Denah Meja', 'Reservasi'],
    receiptNote: 'Split bill + service charge + pajak; KDS full + coursing.',
  },
  FASHION: {
    id: 'FASHION',
    merchantType: 'PRODUCT',
    label: 'Baju / Fashion',
    example: 'baju, sepatu, distro',
    icon: '👕',
    catalogKind: 'RETAIL',
    categories: ['Favorit', 'Atasan', 'Bawahan', 'Sepatu', 'Aksesoris'],
    payPolicy: 'POSTPAID',
    modes: ['IN STORE ORDER', 'IN STORE PICKUP', 'TAKE AWAY'],
    drawer: { tables: false, kitchen: false, booking: false, scan: true },
    flags: {
      needTable: false, needKitchen: false, needBooking: false, needScan: true,
      needPhone: false, needSchedule: false, needTechnician: false,
      customItems: false, editOrder: false, allowDebt: false, allowSplit: true,
      allowReturn: true, onlineOnly: false,
    },
    homeCtas: ['Scan Barcode', 'Cari SKU'],
    receiptNote: 'SKU + size + kebijakan retur 7 hari.',
  },
  GROCERY: {
    id: 'GROCERY',
    merchantType: 'PRODUCT',
    label: 'Kelontong',
    example: 'sembako, minimarket',
    icon: '🛒',
    catalogKind: 'RETAIL',
    categories: ['Favorit', 'Sembako', 'Minuman', 'Snack', 'Rumah Tangga'],
    payPolicy: 'POSTPAID',
    modes: ['IN STORE ORDER', 'IN STORE PICKUP'],
    drawer: { tables: false, kitchen: false, booking: false, scan: true },
    flags: {
      needTable: false, needKitchen: false, needBooking: false, needScan: true,
      needPhone: false, needSchedule: false, needTechnician: false,
      customItems: false, editOrder: false, allowDebt: true, allowSplit: false,
      allowReturn: false, onlineOnly: false,
    },
    homeCtas: ['Scan Cepat', 'Kasbon'],
    receiptNote: 'Tunai cepat + kasbon langganan (nama + tempo + limit).',
  },
  PULSA_DIGITAL: {
    id: 'PULSA_DIGITAL',
    merchantType: 'PRODUCT',
    label: 'Pulsa / Digital',
    example: 'pulsa, token PLN, PPOB',
    icon: '📱',
    catalogKind: 'DIGITAL',
    categories: ['Pulsa', 'Paket Data', 'Token PLN', 'E-Money', 'PPOB'],
    payPolicy: 'PREPAID',
    modes: ['IN STORE ORDER'],
    drawer: { tables: false, kitchen: false, booking: false, scan: false },
    flags: {
      needTable: false, needKitchen: false, needBooking: false, needScan: false,
      needPhone: true, needSchedule: false, needTechnician: false,
      customItems: false, editOrder: false, allowDebt: false, allowSplit: false,
      allowReturn: false, onlineOnly: true,
    },
    homeCtas: ['Isi Pulsa', 'Riwayat'],
    receiptNote: 'SN/token monospace besar + salin WA; bayar dulu, tanpa tempo.',
  },
  SERVICE: {
    id: 'SERVICE',
    merchantType: 'SERVICE',
    label: 'Jasa',
    example: 'barbershop, salon, laundry',
    icon: '✂️',
    catalogKind: 'SERVICE',
    categories: ['Favorit', 'Potong', 'Perawatan', 'Laundry', 'Bengkel'],
    payPolicy: 'DP',
    modes: ['IN STORE SERVICE', 'HOME SERVICE'],
    drawer: { tables: false, kitchen: false, booking: true, scan: false },
    flags: {
      needTable: false, needKitchen: false, needBooking: true, needScan: false,
      needPhone: false, needSchedule: true, needTechnician: true,
      customItems: false, editOrder: true, allowDebt: false, allowSplit: false,
      allowReturn: false, onlineOnly: false,
    },
    homeCtas: ['Jadwal Hari Ini', 'Antrean'],
    receiptNote: 'Jasa + teknisi + slot + DP/pelunasan + garansi.',
  },
};

export const VERTICAL_IDS = Object.keys(VERTICALS) as VerticalId[];

export function normalizeVerticalId(raw?: unknown): VerticalId | '' {
  const v = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((VERTICAL_IDS as string[]).includes(v)) return v as VerticalId;
  return '';
}

export function defaultVerticalForMerchantType(mt?: unknown): VerticalId {
  const k = String(mt ?? '').trim().toUpperCase();
  if (k === 'SERVICE') return 'SERVICE';
  if (k === 'PRODUCT' || k === 'PRODUK' || k === 'RETAIL' || k === 'BARANG') return 'GROCERY';
  return 'WARUNG_QSR';
}

export function verticalFor(raw?: unknown, merchantType?: unknown): VerticalConfig {
  const v = normalizeVerticalId(raw);
  if (v) return VERTICALS[v];
  return VERTICALS[defaultVerticalForMerchantType(merchantType)];
}

export function isVerticalCompatible(vertical: VerticalId | '', merchantType?: unknown): boolean {
  if (!vertical) return true;
  const cfg = VERTICALS[vertical as VerticalId];
  if (!cfg) return true;
  const mt = String(merchantType ?? '').trim().toUpperCase();
  if (!mt) return true;
  return cfg.merchantType === mt;
}

/** Validasi nomor HP Indonesia (08…, 10-14 digit) untuk PULSA_DIGITAL. */
export function isValidPhoneNumberID(raw?: unknown): boolean {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 14) return false;
  return d.startsWith('08') || d.startsWith('628');
}

export function normalizePhoneNumberID(raw?: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Fase 3: preset modifier 1-tap per vertikal (kopi cepat, tanpa ketik). */
export const MODIFIER_PRESETS: Record<string, { name: string; price: number }[]> = {
  COFFEE: [
    { name: 'Less Sugar', price: 0 },
    { name: 'Extra Shot', price: 5000 },
    { name: 'Oat Milk', price: 6000 },
  ],
  WARUNG_QSR: [
    { name: 'Sambal Extra', price: 2000 },
    { name: 'Kerupuk', price: 3000 },
  ],
  RESTO_FULL: [{ name: 'Sambal Extra', price: 3000 }],
  FASHION: [],
  GROCERY: [],
  PULSA_DIGITAL: [],
  SERVICE: [{ name: 'Express', price: 15000 }],
};

/** Fase 3: kebijakan retur/kasbon per vertikal. */
export const VERTICAL_POLICY: Record<string, { returnDays: number; kasbonAllowed: boolean; kasbonLimit: number }> = {
  COFFEE: { returnDays: 0, kasbonAllowed: false, kasbonLimit: 0 },
  WARUNG_QSR: { returnDays: 0, kasbonAllowed: true, kasbonLimit: 200000 },
  RESTO_FULL: { returnDays: 0, kasbonAllowed: true, kasbonLimit: 500000 },
  FASHION: { returnDays: 7, kasbonAllowed: false, kasbonLimit: 0 },
  GROCERY: { returnDays: 0, kasbonAllowed: true, kasbonLimit: 300000 },
  PULSA_DIGITAL: { returnDays: 0, kasbonAllowed: false, kasbonLimit: 0 },
  SERVICE: { returnDays: 7, kasbonAllowed: false, kasbonLimit: 0 },
};
// P3 vertical telemetry (2026-10-29): catat pemakaian per vertical ke tr_applog (best-effort, tanpa endpoint).
// Sampai dashboard vertical ada, LogScreen adalah observability jujur.
/** Catat pemakaian vertical aktif (fire-and-forget, tak pernah melempar). */
export async function logVerticalUse(action: string): Promise<void> {
  try {
    void action;
    const { initDb, run } = await import('./db');
    await initDb();
    await run("INSERT INTO tr_applog (at, tag, msg) VALUES (?, ?, ?)", [new Date().toISOString(), 'vertical', `${action}`.slice(0, 200)]);
  } catch { /* abaikan */ }
}
