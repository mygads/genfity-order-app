/**
 * APP-11 (rev 1:1): template struk website 1:1 (server-wins, offline-first).
 *
 * Website (ReceiptTemplateTab) menyimpan ThermalReceiptTemplate per merchant
 * (CUSTOMER_RECEIPT/KITCHEN_TICKET/PACKING_SLIP/REFUND_RECEIPT/VOID_RECEIPT)
 * dengan ~30 toggle + paperSize + receiptLanguage + modeOverrides; BE
 * me-render-nya sebagai escpos-v1 (PDF/HTML/bridge). Modul ini menutup gap
 * agar cetakan HP identik dengan website:
 *
 * Pull (Pull Now -> pullGoCatalog -> masterGo) mengambil daftar template,
 * memilih default CUSTOMER_RECEIPT (isDefault, atau CUSTOMER_RECEIPT pertama)
 * + default KITCHEN_TICKET (tipe KITCHEN pertama), dan menyimpan settings-JSON
 * mentah ke ms_setting ('Receipt','TemplateJSON') + ('Receipt','KitchenTemplateJSON').
 * Render (ReceiptScreen paper/doPrint/shareText, BillPreview, printBridge
 * auto-print) membaca + menggabungkan di atas default KANONIK BE sehingga
 * merchant tanpa kustomisasi = identik dengan PDF/BE.
 *
 * Kanonik default = BE newDefaultReceiptSettings() / FE
 * DEFAULT_RECEIPT_SETTINGS (paper 80mm, lang en, showPhone true,
 * showItemNotes true, showAddonPrices false, packaging/delivery false,
 * thanks false, branding true). JANGAN ubah sepihak — ubah BE+FE+APP
 * bersamaan.
 *
 * Pola = kemasan A2/posSyncReceipt: hanya tulis bila server mengirim
 * (ketidakhadiran = jangan sentuh cache lokal), baca tak pernah melempar.
 */
import { apiGet } from '../config/server';
import { initDb, queryFirst, run, type BindParams } from './db';
import type { EscMonoImage } from './escpos';

/** Subset toggle website yang dirender APP (kunci lain diabaikan diam-diam). */
export type ReceiptTemplateToggles = {
  // Global
  paperSize: '58mm' | '80mm';
  receiptLanguage?: 'id' | 'en';
  // Header
  showLogo: boolean;
  showMerchantName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showEmail: boolean;
  // Order
  showOrderNumber: boolean;
  showOrderType: boolean;
  showTableNumber: boolean;
  showDateTime: boolean;
  showCustomerName: boolean;
  showCustomerPhone: boolean;
  // Items
  showItemNotes: boolean;
  showOrderNotes: boolean;
  showAddons: boolean;
  showAddonPrices: boolean;
  showUnitPrice: boolean;
  // Payment
  showSubtotal: boolean;
  showTax: boolean;
  showServiceCharge: boolean;
  showPackagingFee: boolean;
  showDeliveryFee: boolean;
  showDiscount: boolean;
  showTotal: boolean;
  showAmountPaid: boolean;
  showChange: boolean;
  showPaymentMethod: boolean;
  showCashierName: boolean;
  // Footer
  showThankYouMessage: boolean;
  customThankYouMessage?: string;
  showCustomFooterText: boolean;
  customFooterText?: string;
  showFooterPhone: boolean;
  showTrackingQRCode: boolean;
  showGenfityBranding: boolean;
  /** Override per mode order (DINE_IN/TAKEAWAY/DELIVERY/...). Hanya toggle
   * boolean display + custom messages yang boleh dioverride; global
   * (paperSize/receiptLanguage) TIDAK dioverride. Disimpan mentah apa adanya
   * dari server; digabung via getEffectiveTogglesForMode(). */
  modeOverrides?: Record<string, Partial<ReceiptTemplateToggles>>;
};

/**
 * Default KANONIK BE/FE (1:1). Sama persis dengan Go
 * newDefaultReceiptSettings() + TS DEFAULT_RECEIPT_SETTINGS.
 */
export const RECEIPT_TEMPLATE_DEFAULTS: ReceiptTemplateToggles = {
  paperSize: '80mm',
  receiptLanguage: 'en',
  showLogo: true,
  showMerchantName: true,
  showAddress: true,
  showPhone: true,
  showEmail: false,
  showOrderNumber: true,
  showOrderType: true,
  showTableNumber: true,
  showDateTime: true,
  showCustomerName: true,
  showCustomerPhone: true,
  showItemNotes: true,
  showOrderNotes: true,
  showAddons: true,
  showAddonPrices: false,
  showUnitPrice: false,
  showSubtotal: true,
  showTax: true,
  showServiceCharge: true,
  showPackagingFee: false,
  showDeliveryFee: false,
  showDiscount: true,
  showTotal: true,
  showAmountPaid: true,
  showChange: true,
  showPaymentMethod: true,
  showCashierName: true,
  showThankYouMessage: false,
  customThankYouMessage: undefined,
  showCustomFooterText: false,
  customFooterText: undefined,
  showFooterPhone: false,
  showTrackingQRCode: true,
  showGenfityBranding: true,
};

/** Default dapur aman: tanpa harga/total/pembayaran/QR/branding (slip kerja). */
export const KITCHEN_TEMPLATE_DEFAULTS: ReceiptTemplateToggles = {
  ...RECEIPT_TEMPLATE_DEFAULTS,
  showLogo: false,
  showAddress: false,
  showPhone: false,
  showEmail: false,
  showCustomerPhone: false,
  showAddonPrices: false,
  showUnitPrice: false,
  showSubtotal: false,
  showTax: false,
  showServiceCharge: false,
  showPackagingFee: false,
  showDeliveryFee: false,
  showDiscount: false,
  showTotal: false,
  showAmountPaid: false,
  showChange: false,
  showPaymentMethod: false,
  showCashierName: false,
  showThankYouMessage: false,
  showCustomFooterText: false,
  showFooterPhone: false,
  showTrackingQRCode: false,
  showGenfityBranding: false,
};

const KNOWN_BOOL_KEYS = (Object.keys(RECEIPT_TEMPLATE_DEFAULTS) as (keyof ReceiptTemplateToggles)[]).filter(
  (k) => typeof RECEIPT_TEMPLATE_DEFAULTS[k] === 'boolean',
);

function asBool(v: unknown): boolean | undefined {
  if (v === true || v === '1' || v === 1) return true;
  if (v === false || v === '0' || v === 0) return false;
  return undefined;
}

/** Gabung settings mentah server di atas default; kunci asing diabaikan. */
export function mergeReceiptTemplateToggles(raw: unknown): ReceiptTemplateToggles {
  const out: ReceiptTemplateToggles = { ...RECEIPT_TEMPLATE_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const k of KNOWN_BOOL_KEYS) {
    const b = asBool(src[k]);
    if (b !== undefined) (out as unknown as Record<string, boolean>)[k] = b;
  }
  // Alias snake_case BE untuk branding (kunci wire preview/PDF).
  const brandSnake = asBool(src['show_genfity_branding']);
  if (brandSnake !== undefined) out.showGenfityBranding = brandSnake;
  // paperSize: hanya 58mm/80mm yang sah; asing = default.
  const ps = src['paperSize'];
  if (typeof ps === 'string') {
    const v = ps.trim();
    if (v === '58mm' || v === '80mm') out.paperSize = v;
  }
  if (typeof src['customThankYouMessage'] === 'string') {
    out.customThankYouMessage = (src['customThankYouMessage'] as string).slice(0, 200) || undefined;
  }
  // Alias snake BE.
  if (typeof src['customThankYouMsg'] === 'string' && !out.customThankYouMessage) {
    out.customThankYouMessage = (src['customThankYouMsg'] as string).slice(0, 200) || undefined;
  }
  if (typeof src['customFooterText'] === 'string') {
    out.customFooterText = (src['customFooterText'] as string).slice(0, 500) || undefined;
  }
  // Bahasa label website ('id'/'en'); nilai asing = abaikan (ikut default en).
  const rl = src['receiptLanguage'];
  if (typeof rl === 'string') {
    const v = rl.trim().toLowerCase();
    if (v === 'id' || v === 'indonesian' || v === 'en' || v === 'english') {
      out.receiptLanguage = v.startsWith('i') ? 'id' : 'en';
    }
  }
  // modeOverrides: teruskan mentah (divalidasi saat dipakai).
  const mo = src['modeOverrides'];
  if (mo && typeof mo === 'object' && !Array.isArray(mo)) {
    out.modeOverrides = mo as Record<string, Partial<ReceiptTemplateToggles>>;
  }
  return out;
}

/** Gabung merge mentah dapur di atas default dapur aman. */
export function mergeKitchenTemplateToggles(raw: unknown): ReceiptTemplateToggles {
  const base = mergeReceiptTemplateToggles(raw);
  // Default dapur = aman tanpa harga; bila server mengirim toggle pembayaran
  // eksplisit true, hormati (merchant sengaja menyalakan harga di dapur).
  // Bila server tak mengirim template dapur sama sekali (raw kosong), paksa
  // aman via KITCHEN_TEMPLATE_DEFAULTS.
  if (!raw || typeof raw !== 'object' || Object.keys(raw as Record<string, unknown>).length === 0) {
    return { ...KITCHEN_TEMPLATE_DEFAULTS, paperSize: base.paperSize, receiptLanguage: base.receiptLanguage };
  }
  return base;
}

/**
 * Kanonis mode order 1:1 BE (canonicalReceiptSettingsMode di Go).
 * PICKUP/IN_STORE_PICKUP/IN_STORE_ORDER -> IN_STORE_PICKUP;
 * SERVICE/IN_STORE_SERVICE -> IN_STORE_SERVICE. Trim + case-insensitive.
 * Tanpa ini order PICKUP/SERVICE tak dapat override IN_STORE_* di BE. */
export function canonicalReceiptMode(orderType?: string): string {
  const k = String(orderType ?? '').trim().toUpperCase();
  if (k === 'DINE_IN') return 'DINE_IN';
  if (k === 'TAKEAWAY') return 'TAKEAWAY';
  if (k === 'DELIVERY') return 'DELIVERY';
  if (k === 'PICKUP' || k === 'IN_STORE_PICKUP' || k === 'IN_STORE_ORDER') return 'IN_STORE_PICKUP';
  if (k === 'SERVICE' || k === 'IN_STORE_SERVICE') return 'IN_STORE_SERVICE';
  if (k === 'HOME_SERVICE') return 'HOME_SERVICE';
  return '';
}

/**
 * Terapkan override per mode order 1:1 BE (DINE_IN/TAKEAWAY/DELIVERY/
 * IN_STORE_PICKUP/IN_STORE_SERVICE/HOME_SERVICE via canonicalReceiptMode).
 * Hanya kunci boolean display + custom messages yang diterapkan;
 * paperSize/receiptLanguage/modeOverrides global TIDAK berubah.
 */
export function getEffectiveTogglesForMode(
  base: ReceiptTemplateToggles,
  orderType?: string,
): ReceiptTemplateToggles {
  if (!orderType || !base.modeOverrides) return base;
  const key = canonicalReceiptMode(orderType);
  if (!key) return base;
  const ov = (base.modeOverrides as Record<string, unknown>)[key];
  if (!ov || typeof ov !== 'object') return base;
  const src = ov as Record<string, unknown>;
  const out: ReceiptTemplateToggles = { ...base };
  // 1:1 BE snake_case: modeOverrides dari BE memakai `show_genfity_branding`.
  const snakeBrand = asBool(src['show_genfity_branding']);
  if (snakeBrand !== undefined) out.showGenfityBranding = snakeBrand;
  for (const k of KNOWN_BOOL_KEYS) {
    if (k === 'paperSize') continue;
    if (k === 'showGenfityBranding' && snakeBrand !== undefined) continue;
    const b = asBool(src[k as string]);
    if (b !== undefined) (out as unknown as Record<string, boolean>)[k as string] = b;
  }
  if (typeof src['customThankYouMessage'] === 'string') {
    out.customThankYouMessage = (src['customThankYouMessage'] as string).slice(0, 200) || undefined;
  }
  if (typeof src['customFooterText'] === 'string') {
    out.customFooterText = (src['customFooterText'] as string).slice(0, 500) || undefined;
  }
  return out;
}

/**
 * Nomor order penuh 1:1 BE formatFullOrderNumber (orders_merchant_receipt.go):
 * "WKB-00123" dari nomor mentah + kode merchant (3 huruf pertama, uppercase).
 * Kode kosong atau nomor sudah mengandung '-' = mentah (tanpa prefix).
 */
export function formatFullOrderNumber(orderNumber: string, merchantCode?: string): string {
  const raw = String(orderNumber ?? '').trim();
  const code = String(merchantCode ?? '').trim();
  if (!raw) return '';
  if (!code || raw.includes('-')) return raw;
  const c = code.toUpperCase().slice(0, 3);
  if (!c) return raw;
  return `${c}-${raw}`;
}

/**
 * Label tipe order 1:1 BE buildOrderTypeLine (orders_merchant_receipt.go).
 * merchantType opsional: PRODUCT/SERVICE mengaktifkan cabang retail
 * ("Ambil di Toko"/"Pesanan di Toko"); absen = cabang resto (perilaku lama,
 * didokumentasikan untuk HP yang tak tahu tipe merchant).
 * Mode tak dikenal = mentah (pemanggil boleh memetakan dulu, mis. POS
 * 'ESB Order' -> 'Genfity Order' untuk tampil).
 */
export function receiptOrderTypeLabel(orderType: string, lang: 'id' | 'en', merchantType?: string): string {
  const k = String(orderType ?? '').trim().toUpperCase();
  const id = lang === 'id';
  const retail = String(merchantType ?? '').trim().toUpperCase() === 'PRODUCT' ||
    String(merchantType ?? '').trim().toUpperCase() === 'SERVICE';
  switch (k) {
    case 'DINE_IN':
      return id ? 'Makan di Tempat' : 'Dine In';
    case 'PICKUP':
    case 'IN_STORE_PICKUP':
      if (retail) return id ? 'Ambil di Toko' : 'In-Store Pickup';
      return id ? 'Bawa Pulang' : 'Takeaway';
    case 'IN_STORE_ORDER':
      if (retail) return id ? 'Ambil di Toko' : 'In-Store Pickup';
      return id ? 'Pesanan di Toko' : 'In-Store Order';
    case 'TAKEAWAY':
      if (retail) return id ? 'Ambil di Toko' : 'In-Store Pickup';
      return id ? 'Bawa Pulang' : 'Takeaway';
    case 'IN_STORE_SERVICE':
    case 'SERVICE':
      return id ? 'Layanan di Toko' : 'In-Store Service';
    case 'HOME_SERVICE':
      return id ? 'Layanan ke Rumah' : 'Home Service';
    case 'DELIVERY':
      return id ? 'Pengantaran' : 'Delivery';
    default:
      return String(orderType ?? '').trim();
  }
}

/** Label nomor order 1:1 BE receiptLabels.OrderNumber ("Pesanan #"/"Order #")
 * + formatFullOrderNumber (prefix kode merchant, mis. "Pesanan #WKB-00123").
 * merchantCode opsional; absen = perilaku lama (tanpa prefix). */
export function receiptOrderNumberLabel(no: string, lang: 'id' | 'en', merchantCode?: string): string {
  const full = formatFullOrderNumber(String(no ?? '').trim(), merchantCode);
  return `${lang === 'id' ? 'Pesanan #' : 'Order #'}${full}`;
}

/**
 * Baris tipe order + meja 1:1 BE ("Dine In - Table 5" / "Makan di Tempat -
 * Meja 5"). Meja hanya bila showTableNumber && tableNumber non-kosong
 * (cermin bridge/PDF; HTML menyembunyikan meja untuk PRODUCT/SERVICE tapi
 * bridge/PDF menampilkannya — HP ikut bridge). Kosong = baris disembunyikan.
 * merchantType opsional diteruskan ke receiptOrderTypeLabel (cabang retail).
 */
export function buildReceiptOrderTypeLine(
  orderType: string,
  tableNumber: string | undefined | null,
  t: { showOrderType: boolean; showTableNumber: boolean },
  lang: 'id' | 'en',
  merchantType?: string,
): string {
  if (!t.showOrderType) return '';
  const label = receiptOrderTypeLabel(orderType, lang, merchantType);
  const table = String(tableNumber ?? '').trim();
  if (!label && !table) return '';
  if (t.showTableNumber && table) {
    const tableLabel = lang === 'id' ? 'Meja' : 'Table';
    return label ? `${label} - ${tableLabel} ${table}` : `${tableLabel} ${table}`;
  }
  return label;
}

/** Lebar kolom ESC/POS dari paperSize template (58mm=32, 80mm=48). */
export function paperColsForSize(paperSize?: string): 32 | 48 {
  return paperSize === '58mm' ? 32 : 48;
}

export type ReceiptTemplateRef = {
  id: number;
  name: string;
  templateType: string;
  isDefault?: boolean;
  settings: Record<string, unknown>;
};

type TemplateListResponse = {
  data?: { templates?: ReceiptTemplateRef[] };
};

/**
 * Ambil SEMUA template struk merchant (BE kontrak baru dipakai layar pilih
 * template per station): GET api/merchant/thermal-receipt-templates →
 * {data:{templates:[{id,name,templateType,isDefault,settings}]}}. Kembali []
 * bila offline, 404 (BE lama), 401, atau kosong. Tak pernah melempar untuk
 * 404/jaringan (pola branchsettings-skip).
 */
export async function fetchReceiptTemplates(): Promise<ReceiptTemplateRef[]> {
  let res: Response;
  try {
    res = await apiGet('api/merchant/thermal-receipt-templates');
  } catch {
    return [];
  }
  if (res.status === 404 || !res.ok) return [];
  let body: TemplateListResponse;
  try {
    body = (await res.json()) as TemplateListResponse;
  } catch {
    return [];
  }
  const items = body?.data?.templates ?? [];
  if (!Array.isArray(items)) return [];
  return items.filter((t) => t && Number.isFinite(Number(t.id)));
}

/**
 * Ambil template struk pelanggan default merchant. Kembali null bila offline,
 * 404 (BE lama), 401 (sesi basi — pemanggil yang menangani), atau kosong.
 * Tak pernah melempar untuk 404/jaringan (pola branchsettings-skip).
 */
export async function fetchDefaultReceiptTemplate(): Promise<ReceiptTemplateRef | null> {
  const items = await fetchReceiptTemplates();
  if (items.length === 0) return null;
  return (
    items.find((t) => t && t.isDefault === true && String(t.templateType).toUpperCase() === 'CUSTOMER_RECEIPT') ??
    items.find((t) => t && t.isDefault === true) ??
    items.find((t) => t && String(t.templateType).toUpperCase() === 'CUSTOMER_RECEIPT') ??
    items[0] ??
    null
  );
}

/** Ambil template tiket dapur default (tipe KITCHEN_TICKET pertama). */
export async function fetchDefaultKitchenTemplate(): Promise<ReceiptTemplateRef | null> {
  const items = await fetchReceiptTemplates();
  if (items.length === 0) return null;
  return (
    items.find((t) => t && String(t.templateType).toUpperCase() === 'KITCHEN_TICKET') ??
    null
  );
}

/**
 * Tulis server-wins ke ms_setting. HANYA bila template ada (kompat BE lama:
 * tak ada template = tak ada tulis = lokal utuh).
 */
export async function persistReceiptTemplate(
  tpl: ReceiptTemplateRef | null,
  run: (sql: string, params?: BindParams) => Promise<unknown>,
): Promise<void> {
  if (!tpl || !tpl.settings || typeof tpl.settings !== 'object') return;
  const raw = JSON.stringify(tpl.settings).slice(0, 20000);
  await run(
    `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Receipt', 'TemplateJSON', ?, '1')
     ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
    [raw],
  );
}

/** Tulis template dapur ke ms_setting (key2 KitchenTemplateJSON). */
export async function persistKitchenTemplate(
  tpl: ReceiptTemplateRef | null,
  run: (sql: string, params?: BindParams) => Promise<unknown>,
): Promise<void> {
  if (!tpl || !tpl.settings || typeof tpl.settings !== 'object') return;
  const raw = JSON.stringify(tpl.settings).slice(0, 20000);
  await run(
    `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Receipt', 'KitchenTemplateJSON', ?, '1')
     ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
    [raw],
  );
}

/** Ada baris TemplateJSON (pernah pull template) — bedakan mode template vs
 * legacy tanpa menebak dari isi toggle. Tak pernah melempar. */
export async function hasReceiptTemplate(): Promise<boolean> {
  try {
    await initDb();
    const row = await queryFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ms_setting WHERE key1 = 'Receipt' AND key2 = 'TemplateJSON' LIMIT 1`,
      [],
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Baca preferensi efektif (async; default KANONIK BE bila tak ada baris). */
export async function getReceiptTemplateToggles(): Promise<ReceiptTemplateToggles> {
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Receipt' AND key2 = 'TemplateJSON' LIMIT 1`,
      [],
    );
    if (row == null || !row.value1) return { ...RECEIPT_TEMPLATE_DEFAULTS };
    return mergeReceiptTemplateToggles(JSON.parse(row.value1 as string) as unknown);
  } catch {
    return { ...RECEIPT_TEMPLATE_DEFAULTS };
  }
}

/** Ada template dapur tersimpan. */
export async function hasKitchenTemplate(): Promise<boolean> {
  try {
    await initDb();
    const row = await queryFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ms_setting WHERE key1 = 'Receipt' AND key2 = 'KitchenTemplateJSON' LIMIT 1`,
      [],
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Identitas merchant cache untuk header struk 1:1 BE (nama/alamat/telpon/email).
 * Diisi pullGoCatalog dari /pos/menu merchant block (BE-final); BE lama tak
 * mengirim = cache kosong = fallback nama cabang lokal. Tak pernah melempar. */
export type CachedMerchantInfo = {
  name: string;
  address: string;
  phone: string;
  email: string;
  /** URL logo merchant untuk pratinjau kertas (Receipt/BillPreview Image).
   * Raster thermal mono (EscReceipt.logo) dibaca dari cache Merchant/
   * LogoMonoJSON via getEffectiveReceiptLogo (diisi pull-time oleh
   * syncMerchantLogoRaster; pratinjau visual tetap 1:1 via URL). */
  logoUrl: string;
  /** Kode merchant untuk prefix nomor order ala BE (WKB-00123). */
  merchantCode: string;
  /** Tipe merchant untuk cabang label retail BE (RESTAURANT/PRODUCT/SERVICE). */
  merchantType: string;
};

/** Baca identitas merchant cache (default kosong = fallback lokal). */
export async function getCachedMerchantInfo(): Promise<CachedMerchantInfo> {
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Merchant' AND key2 = 'InfoJSON' LIMIT 1`,
      [],
    );
    if (row == null || !row.value1) return { name: '', address: '', phone: '', email: '', logoUrl: '', merchantCode: '', merchantType: '' };
    const raw = JSON.parse(row.value1 as string) as Partial<CachedMerchantInfo>;
    return {
      name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
      address: typeof raw.address === 'string' ? raw.address.slice(0, 200) : '',
      phone: typeof raw.phone === 'string' ? raw.phone.slice(0, 40) : '',
      email: typeof raw.email === 'string' ? raw.email.slice(0, 100) : '',
      logoUrl: typeof raw.logoUrl === 'string' ? raw.logoUrl.slice(0, 500) : '',
      merchantCode: typeof raw.merchantCode === 'string' ? raw.merchantCode.trim().toUpperCase().slice(0, 12) : '',
      merchantType: typeof raw.merchantType === 'string' ? raw.merchantType.slice(0, 20) : '',
    };
  } catch {
    return { name: '', address: '', phone: '', email: '', logoUrl: '', merchantCode: '', merchantType: '' };
  }
}

/** Baca toggle dapur efektif (default dapur aman bila tak ada baris). */
export async function getKitchenTemplateToggles(): Promise<ReceiptTemplateToggles> {
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Receipt' AND key2 = 'KitchenTemplateJSON' LIMIT 1`,
      [],
    );
    if (row == null || !row.value1) return { ...KITCHEN_TEMPLATE_DEFAULTS };
    return mergeKitchenTemplateToggles(JSON.parse(row.value1 as string) as unknown);
  } catch {
    return { ...KITCHEN_TEMPLATE_DEFAULTS };
  }
}

/** Raster logo mono cache untuk header thermal (GS v 0).
 * Disimpan di ms_setting ('Merchant','LogoMonoJSON') sebagai JSON
 * {widthPx,heightPx,base64,sourceUrl,updatedAt}. Pola server-wins/
 * offline-first: hanya ditulis oleh syncMerchantLogoRaster (pull-time,
 * best-effort); ketidakhadiran/gagal decode = jangan sentuh cache lama,
 * baca tak pernah melempar. Praktik umum thermal: raster tengah, 1 bit/
 * piksel MSB-dulu, batas 384 dot (58mm)/576 dot (80mm) — buildRasterImageBytes
 * memotong kelebihan, sehingga cache disimpan pada 576 dot dan di-clip per
 * station. Tinggi dibatasi 256px (~18KB) agar muat memori printer. */
export type CachedMerchantLogoRaster = {
  widthPx: number;
  heightPx: number;
  /** Byte bitmap MSB-dulu, panjang ceil(widthPx/8)*heightPx, base64. */
  base64: string;
  /** URL sumber saat raster dibuat — untuk invalidasi bila merchant ganti logo. */
  sourceUrl: string;
  /** Waktu cache (ISO). */
  updatedAt: string;
};

function isValidMonoRaster(r: unknown): r is CachedMerchantLogoRaster {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (
    Number.isFinite(Number(o['widthPx'])) && Number(o['widthPx']) >= 8 &&
    Number.isFinite(Number(o['heightPx'])) && Number(o['heightPx']) >= 1 &&
    typeof o['base64'] === 'string' && (o['base64'] as string).length > 0 &&
    typeof o['sourceUrl'] === 'string'
  );
}

/** Baca raster logo cache (null bila tak ada/rusak). Tak pernah melempar. */
export async function getCachedMerchantLogoRaster(): Promise<CachedMerchantLogoRaster | null> {
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Merchant' AND key2 = 'LogoMonoJSON' LIMIT 1`,
      [],
    );
    if (row == null || !row.value1) return null;
    const raw = JSON.parse(row.value1 as string) as unknown;
    return isValidMonoRaster(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Tulis raster logo cache (internal; dipanggil syncMerchantLogoRaster). */
export async function cacheMerchantLogoRaster(r: CachedMerchantLogoRaster): Promise<void> {
  try {
    if (!isValidMonoRaster(r)) return;
    await initDb();
    const raw = JSON.stringify({ ...r, base64: String(r.base64).slice(0, 100000) }).slice(0, 110000);
    await run(
      `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Merchant', 'LogoMonoJSON', ?, '1')
       ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
      [raw],
    );
  } catch {
    /* abaikan — pratinjau URL tetap jalan */
  }
}

/** Hapus raster logo cache (mis. merchant menghapus logo). Tak melempar. */
export async function clearMerchantLogoRaster(): Promise<void> {
  try {
    await initDb();
    await run(`DELETE FROM ms_setting WHERE key1 = 'Merchant' AND key2 = 'LogoMonoJSON'`, []);
  } catch {
    /* abaikan */
  }
}

function bytesToBase64Local(bytes: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a: number = bytes[i] ?? 0;
    const hasB = i + 1 < bytes.length;
    const hasC = i + 2 < bytes.length;
    const b: number = hasB ? (bytes[i + 1] ?? 0) : 0;
    const c: number = hasC ? (bytes[i + 2] ?? 0) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63] + (hasB ? abc[(n >> 6) & 63] : '=') + (hasC ? abc[n & 63] : '=');
  }
  return out;
}

/**
 * Unduh logoUrl → decode → mono 1-bit → cache. Dipanggil pull-time
 * (masterGo sesudah InfoJSON) secara fire-and-forget; print-time hanya baca
 * via getEffectiveReceiptLogo (tanpa jaringan) agar cetak offline tetap jalan.
 * Decoder: guarded dynamic require('jimp-compact') (dependensi transitif
 * 0.16.1, tanpa tambah dep); gagal decode/jaringan = null + cache lama utuh.
 * logoUrl kosong = hapus cache basi (merchant menghapus logo) lalu null.
 * Tak pernah melempar. maxDots default 576 (80mm); clip per station di
 * buildRasterImageBytes.
 */
export async function syncMerchantLogoRaster(logoUrl?: string, maxDots = 576): Promise<CachedMerchantLogoRaster | null> {
  let url = '';
  try {
    if (typeof logoUrl === 'string') url = logoUrl.trim().slice(0, 500);
    else url = (await getCachedMerchantInfo()).logoUrl;
  } catch {
    return null;
  }
  if (!url) {
    try {
      const old = await getCachedMerchantLogoRaster();
      if (old) await clearMerchantLogoRaster();
    } catch {
      /* abaikan */
    }
    return null;
  }
  try {
    const cur = await getCachedMerchantLogoRaster();
    if (cur && cur.sourceUrl === url) return cur;
  } catch {
    /* lanjut unduh */
  }
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.length === 0 || buf.length > 4_000_000) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Cl: { read: (b: Uint8Array) => Promise<any> } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const req = require('jimp-compact') as unknown;
      const cand = (req as { default?: unknown }).default ?? req;
      const maybe = cand as unknown as { read?: unknown };
      if (maybe && typeof maybe.read === 'function') {
        Cl = maybe as unknown as { read: (b: Uint8Array) => Promise<any> };
      }
    } catch {
      Cl = null;
    }
    if (!Cl) return null;
    const img = await Cl.read(buf);
    const w0 = Math.max(1, img.bitmap.width);
    const h0 = Math.max(1, img.bitmap.height);
    const cap = Math.max(8, Math.min(576, Math.floor(maxDots) || 576));
    const scale = Math.min(1, cap / w0, 256 / h0);
    const w = Math.max(8, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    try {
      img.resize(w, h);
    } catch {
      return null;
    }
    try {
      img.grayscale();
    } catch {
      /* lanjut tanpa grayscale */
    }
    const data = img.bitmap.data;
    const rowBytes = Math.ceil(w / 8);
    const packed = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = (y * w + x) * 4;
        const r = data[px] as number;
        const g = data[px + 1] as number;
        const b = data[px + 2] as number;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 128) packed[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    const raster: CachedMerchantLogoRaster = {
      widthPx: w,
      heightPx: h,
      base64: bytesToBase64Local(packed),
      sourceUrl: url,
      updatedAt: new Date().toISOString(),
    };
    await cacheMerchantLogoRaster(raster);
    return raster;
  } catch {
    return null;
  }
}

/**
 * Logo efektif untuk EscReceipt: raster cache bila showLogo && sourceUrl cocok
 * dengan InfoJSON saat ini; selain itu undefined (pratinjau URL tetap tampil,
 * thermal hemat tanpa logo basi). Tak pernah melempar.
 */
export async function getEffectiveReceiptLogo(showLogo?: boolean): Promise<EscMonoImage | undefined> {
  try {
    if (!showLogo) return undefined;
    const [raster, info] = await Promise.all([getCachedMerchantLogoRaster(), getCachedMerchantInfo()]);
    if (!raster || !info.logoUrl || raster.sourceUrl !== info.logoUrl) return undefined;
    return { widthPx: raster.widthPx, heightPx: raster.heightPx, base64: raster.base64 };
  } catch {
    return undefined;
  }
}

/* Adaptive Vertical Shell: preset struk per vertikal (additive).
 * Prinsip: 1 engine print, N preset field. Resto: meja/service; fashion:
 * SKU+retur; pulsa: SN monospace besar (58mm); jasa: teknisi+slot+garansi. */
export type VerticalReceiptPreset = {
  paper: '58mm' | '80mm';
  showTableNumber: boolean;
  showCustomerPhone: boolean;
  footerID: string;
  /** Footer Inggris (kasir lang=en / template receiptLanguage=en). */
  footerEN: string;
};
/** Footer vertikal sesuai bahasa struk (display-only; bukan kontrak BE). */
export function verticalFooterForLang(preset: VerticalReceiptPreset | null | undefined, lang?: unknown): string {
  if (!preset) return '';
  return String(lang ?? '').toLowerCase().startsWith('en') ? (preset.footerEN || preset.footerID) : preset.footerID;
}
export function receiptPresetForVertical(verticalId?: unknown): VerticalReceiptPreset {
  const v = String(verticalId ?? '').trim().toUpperCase();
  switch (v) {
    case 'PULSA_DIGITAL':
      return { paper: '58mm', showTableNumber: false, showCustomerPhone: true, footerID: 'Simpan SN/token ini. Komplain sertakan nomor tujuan + waktu.', footerEN: 'Keep this SN/token. For complaints include the destination number + time.' };
    case 'FASHION':
      return { paper: '80mm', showTableNumber: false, showCustomerPhone: false, footerID: 'Retur/tukar 7 hari dengan struk + label utuh.', footerEN: 'Returns/exchanges within 7 days with receipt + intact labels.' };
    case 'GROCERY':
      return { paper: '80mm', showTableNumber: false, showCustomerPhone: false, footerID: 'Terima kasih. Cek kembali belanjaan Anda.', footerEN: 'Thank you. Please double-check your items.' };
    case 'SERVICE':
      return { paper: '80mm', showTableNumber: false, showCustomerPhone: true, footerID: 'Garansi layanan 7 hari dengan struk ini.', footerEN: '7-day service warranty with this receipt.' };
    case 'COFFEE':
    case 'WARUNG_QSR':
      return { paper: '80mm', showTableNumber: false, showCustomerPhone: false, footerID: 'Nomor antrean tertera. Terima kasih.', footerEN: 'Queue number shown. Thank you.' };
    case 'RESTO_FULL':
    default:
      return { paper: '80mm', showTableNumber: true, showCustomerPhone: false, footerID: 'Pajak dan service sudah termasuk (bila ada).', footerEN: 'Tax and service included (where applicable).' };
  }
}
