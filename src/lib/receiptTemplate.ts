/**
 * APP-11: template struk website 1:1 (server-wins, offline-first).
 *
 * Website (ReceiptTemplateTab) menyimpan ThermalReceiptTemplate per merchant
 * (tag CUSTOMER_RECEIPT/KITCHEN_TICKET/dll) dengan ~30 toggle; BE me-render-nya
 * sebagai escpos-v1. APP sebelumnya membangun struk dari layout hardcoded +
 * 4 preferensi lokal (posSyncReceipt) sehingga toggle website TAK PERNAH
 * tercermin di cetakan HP. Modul ini menutup gap itu untuk struk pelanggan:
 *
 * Pull (Pull Now -> pullGoCatalog -> masterGo) mengambil daftar template,
 * memilih default (isDefault, atau CUSTOMER_RECEIPT pertama), dan menyimpan
 * settings-JSON mentah ke ms_setting ('Receipt','TemplateJSON').
 * Render (ReceiptScreen paper/doPrint/shareText) membaca + menggabungkan di
 * atas default perilaku-lama sehingga server-lama/tanpa-template = byte
 * identik dengan sebelumnya.
 *
 * Pola = kemasan A2/posSyncReceipt: hanya tulis bila server mengirim
 * (ketidakhadiran = jangan sentuh cache lokal), baca tak pernah melempar.
 */
import { apiGet } from '../config/server';
import { initDb, queryFirst, type BindParams } from './db';

/** Subset toggle website yang dirender APP (kunci lain diabaikan diam-diam). */
export type ReceiptTemplateToggles = {
  // Header
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
  showAddons: boolean;
  showAddonPrices: boolean;
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
  /** Bahasa label default (thanks/branding) ala website; undefined = ikut
   * bahasa UI HP. Bukan boolean sehingga tak masuk KNOWN_BOOL_KEYS. */
  receiptLanguage?: 'id' | 'en';
};

/**
 * Default = perilaku APP sebelum APP-11 (byte-identik bila tanpa template).
 * showPhone/showEmail/showFooterPhone default MATI (dulu tak pernah tampil);
 * showItemNotes MATI (dulu tak dirender); branding MATI; sisanya tampil.
 */
export const RECEIPT_TEMPLATE_DEFAULTS: ReceiptTemplateToggles = {
  showMerchantName: true,
  showAddress: true,
  showPhone: false,
  showEmail: false,
  showOrderNumber: true,
  showOrderType: true,
  showTableNumber: true,
  showDateTime: true,
  showCustomerName: true,
  showCustomerPhone: true,
  showItemNotes: false,
  showAddons: true,
  showAddonPrices: true,
  showSubtotal: true,
  showTax: true,
  showServiceCharge: true,
  showPackagingFee: true,
  showDeliveryFee: true,
  showDiscount: true,
  showTotal: true,
  showAmountPaid: true,
  showChange: true,
  showPaymentMethod: true,
  showCashierName: true,
  showThankYouMessage: true,
  customThankYouMessage: undefined,
  showCustomFooterText: false,
  customFooterText: undefined,
  showFooterPhone: false,
  showTrackingQRCode: true,
  showGenfityBranding: false,
};

const KNOWN_BOOL_KEYS = Object.keys(RECEIPT_TEMPLATE_DEFAULTS).filter(
  (k) => typeof (RECEIPT_TEMPLATE_DEFAULTS as Record<string, unknown>)[k] === 'boolean',
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
  if (typeof src['customThankYouMessage'] === 'string') {
    out.customThankYouMessage = (src['customThankYouMessage'] as string).slice(0, 200) || undefined;
  }
  if (typeof src['customFooterText'] === 'string') {
    out.customFooterText = (src['customFooterText'] as string).slice(0, 500) || undefined;
  }
  // Bahasa label website ('id'/'en'); nilai asing = abaikan (ikut bahasa UI).
  const rl = src['receiptLanguage'];
  if (typeof rl === 'string') {
    const v = rl.trim().toLowerCase();
    if (v === 'id' || v === 'indonesian' || v === 'en' || v === 'english') {
      out.receiptLanguage = v.startsWith('i') ? 'id' : 'en';
    }
  }
  return out;
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
  let res: Response;
  try {
    res = await apiGet('api/merchant/thermal-receipt-templates');
  } catch {
    return null;
  }
  if (res.status === 404) return null;
  if (!res.ok) return null;
  let body: TemplateListResponse;
  try {
    body = (await res.json()) as TemplateListResponse;
  } catch {
    return null;
  }
  const items = body?.data?.templates ?? [];
  if (items.length === 0) return null;
  return (
    items.find((t) => t && t.isDefault === true) ??
    items.find((t) => t && String(t.templateType).toUpperCase() === 'CUSTOMER_RECEIPT') ??
    items[0] ??
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

/** Baca preferensi efektif (async; default perilaku-lama bila tak ada baris). */
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
