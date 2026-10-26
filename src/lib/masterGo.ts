/**
 * Tarik katalog dari backend GO (kontrak /pos/menu) ke SQLite.
 * P0-2 audit paritas: pull ESB (`main/get-menu`, `main/get-branch-menu`)
 * 404 vs backend Go sehingga harga/stok kasir basi. Modul ini memetakan
 * respons Go `{success, data: {merchant, categories, menuItems}}` ke
 * ms_category / ms_menu / ms_branchmenu + ms_setting (currency, PPN).
 * Server menang; stationId lokal dipertahankan (cermin domain station di
 * master.ts — server tak tahu alamat printer per-terminal).
 * 401 = sesi kedaluwarsa (login ulang); 404 = bukan backend Go (pemanggil
 * boleh fallback ke domain ESB).
 */
import { apiGet, getBranchId } from '../config/server';
import { initDb, run } from './db';
import { persistReceiptPrefs } from './posSyncReceipt';
import { fetchDefaultReceiptTemplate, persistReceiptTemplate } from './receiptTemplate';
import { setWatermark } from './sync';

export class GoCatalogUnavailable extends Error {
  constructor() {
    super('backend bukan Go (/pos/menu 404)');
    this.name = 'GoCatalogUnavailable';
  }
}

interface GoMenuItem {
  id: number;
  name: string;
  price: number;
  promoPrice?: number | null;
  imageUrl?: string | null;
  isActive: boolean;
  categoryId?: number | null;
  trackStock: boolean;
  stockQty?: number | null;
}

interface GoCategory {
  id: number;
  name: string;
  sortOrder: number;
}

interface GoMerchant {
  currency: string;
  enableTax: boolean;
  taxPercentage: number;
  /** Knob service charge merchant (audit trisisi #1 — server-driven).
   * Skala serviceChargePercent = persen (5 = 5%), cermin BE
   * MerchantPOSMenuGet. Opsional — BE lama tak mengirim; ketidakhadiran =
   * jangan sentuh cache lokal (fallback legacy 5% + label estimasi). */
  enableServiceCharge?: boolean;
  serviceChargeType?: string;
  serviceChargePercent?: number;
  serviceChargeFixedAmount?: number;
  /** Biaya kemasan merchant (BE /pos/menu → merchant block). Opsional —
   * BE lama tak mengirim; ketidakhadiran = jangan sentuh cache lokal. */
  enablePackagingFee?: boolean;
  packagingFeeAmount?: number;
  /** Preferensi struk merchant (A3, server-wins). Opsional — BE lama tak
   * mengirim; ketidakhadiran = jangan sentuh cache lokal. */
  receiptShowTax?: boolean;
  receiptShowFooter?: boolean;
  receiptShowQris?: boolean;
  receiptFooterText?: string;
}

interface GoMenuResponse {
  success: boolean;
  data: {
    merchant: GoMerchant;
    categories: GoCategory[];
    menuItems: GoMenuItem[];
  };
}

const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

export interface GoCatalogResult {
  per: Record<string, number>;
  at: string;
}

/**
 * Tarik katalog Go dan tulis ke SQLite. Melempar GoCatalogUnavailable bila
 * endpoint tak ada (404), Error jujur untuk 401/gagal lain.
 */
export async function pullGoCatalog(): Promise<GoCatalogResult> {
  await initDb();
  const res = await apiGet('api/merchant/pos/menu', { limit: 500 });
  if (res.status === 404) throw new GoCatalogUnavailable();
  if (res.status === 401) {
    throw new Error('Sesi kedaluwarsa (401) — login ulang sebelum sync katalog.');
  }
  if (!res.ok) throw new Error(`Pull katalog Go: HTTP ${res.status}`);
  const body = (await res.json()) as GoMenuResponse;
  if (!body?.success || !body?.data) throw new Error('Pull katalog Go: respons cacat');
  const { merchant, categories, menuItems } = body.data;
  if (!merchant || !Array.isArray(categories) || !Array.isArray(menuItems)) {
    throw new Error('Pull katalog Go: bentuk data tak dikenal');
  }

  const now = new Date().toISOString();
  const branchId = getBranchId();

  for (const c of categories) {
    const id = String(c.id ?? '');
    if (!id) continue;
    await run(
      `INSERT OR REPLACE INTO ms_category (id, categoryName, sortOrder, flagActive, syncDate)
       VALUES (?, ?, ?, 1, ?)`,
      [id, str(c.name) ?? '', num(c.sortOrder), now],
    );
  }

  for (const m of menuItems) {
    const id = String(m.id ?? '');
    if (!id) continue;
    // Harga efektif kasir = promo aktif (sudah digerbang jadwal di BE)
    // bila ada, else harga dasar — sama dengan yang dipakai FE web.
    const price = m.promoPrice !== undefined && m.promoPrice !== null
      ? num(m.promoPrice)
      : num(m.price);
    const active = m.isActive ? 1 : 0;
    await run(
      `INSERT INTO ms_menu (id, menuName, categoryId, price, imageUrl, stationId, flagActive, syncDate)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET menuName = excluded.menuName,
         categoryId = excluded.categoryId, price = excluded.price,
         imageUrl = excluded.imageUrl, flagActive = excluded.flagActive,
         syncDate = excluded.syncDate`,
      [id, str(m.name) ?? '', m.categoryId !== undefined && m.categoryId !== null ? String(m.categoryId) : null, price, str(m.imageUrl), active, now],
    );
    // Stok cabang: habis = trackStock + stockQty <= 0. stationId lokal
    // dipertahankan (alamat printer milik layar Printer).
    const qty = m.stockQty !== undefined && m.stockQty !== null ? num(m.stockQty) : 0;
    const soldOut = m.trackStock && m.stockQty !== undefined && m.stockQty !== null && num(m.stockQty) <= 0 ? 1 : 0;
    await run(
      `INSERT INTO ms_branchmenu (branchId, menuId, stationId, qty, flagSoldOut, flagActive, syncDate)
       VALUES (?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(branchId, menuId) DO UPDATE SET qty = excluded.qty,
         flagSoldOut = excluded.flagSoldOut, flagActive = excluded.flagActive,
         syncDate = excluded.syncDate`,
      [branchId, id, qty, soldOut, active, now],
    );
  }

  // Mata uang + PPN milik server (cermin currency.ts + totals.ts getTaxRate).
  const currency = String(merchant.currency ?? '').toUpperCase();
  if (currency === 'IDR' || currency === 'AUD') {
    const locale = currency === 'IDR' ? 'id-ID' : 'en-AU';
    await run(
      `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Branch', 'Currency', ?, ?)
       ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
      [currency, locale],
    );
  }
  if (merchant.enableTax) {
    await run(
      `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Tax', 'PPN', ?, NULL)
       ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1`,
      [String(num(merchant.taxPercentage, 11))],
    );
  }
  // Kemasan milik server (A2: info merchant /pos/menu). Hanya tulis bila BE
  // mengirim kuncinya (kompat BE lama); server menang atas cache lokal.
  // value1 = nominal, value2 = '1' aktif / '0' mati (dibaca getPackagingFee).
  if (merchant.enablePackagingFee !== undefined || merchant.packagingFeeAmount !== undefined) {
    const enabled = merchant.enablePackagingFee === true ? '1' : '0';
    const amount = Math.max(0, Math.round(num(merchant.packagingFeeAmount, 0)));
    await run(
      `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Packaging', 'Fee', ?, ?)
       ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
      [String(amount), enabled],
    );
  }
  // A2: service charge milik server (audit trisisi #1). Hanya tulis bila BE
  // mengirim minimal satu kunci (kompat BE lama); server menang atas cache
  // lokal. value1: Enabled '1'/'0'; Type 'PERCENT'/'FIXED'; Rate persen
  // (skala persen, mis. 5 = 5%); Fixed nominal. Dibaca getServiceConfig().
  if (
    merchant.enableServiceCharge !== undefined ||
    merchant.serviceChargeType !== undefined ||
    merchant.serviceChargePercent !== undefined ||
    merchant.serviceChargeFixedAmount !== undefined
  ) {
    const svcEnabled = merchant.enableServiceCharge === true ? '1' : '0';
    const svcType =
      String(merchant.serviceChargeType ?? '').trim().toUpperCase() === 'FIXED'
        ? 'FIXED'
        : 'PERCENT';
    const svcRate = Math.max(0, num(merchant.serviceChargePercent, 0));
    const svcFixed = Math.max(0, Math.round(num(merchant.serviceChargeFixedAmount, 0)));
    const svcRows: Array<[string, string]> = [
      ['Enabled', svcEnabled],
      ['Type', svcType],
      ['Rate', String(svcRate)],
      ['Fixed', String(svcFixed)],
    ];
    for (const [k2, v1] of svcRows) {
      await run(
        `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Service', ?, ?, '1')
         ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
        [k2, v1],
      );
    }
  }
  // Aturan pembulatan trisisi (audit #3): lane Go = integer rupiah (step 1),
  // cermin BE roundGroupOrderMoney IDR (scale 1) + FE roundCurrencyAmount IDR
  // (Math.round). Server-wins: pull Go SELALU menulis Step=1 agar preview
  // kasir = nilai yang divalidasi BE saat settle (tanpa step, tender non-tunai
  // 400). Lane ESB (fallback 404) tak menulis Step = default legacy 100.
  // JANGAN tambah endpoint rounding; JANGAN ubah step sepihak.
  await run(
    `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Rounding', 'Step', '1', 'go-lane')
     ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
  );
  // A3: preferensi struk milik server (hanya tulis bila BE mengirim kuncinya).
  await persistReceiptPrefs(merchant, run);
  // APP-11: template struk website (server-wins; 404/BE lama = tak tulis =
  // cache lokal utuh). Best-effort: gagal pull template tak boleh
  // menggagalkan katalog (kontrak katalog tetap hijau).
  try {
    const tpl = await fetchDefaultReceiptTemplate();
    await persistReceiptTemplate(tpl, run);
  } catch {
    /* abaikan — render fallback ke default perilaku-lama */
  }

  await setWatermark('menu', { pull: now });
  await setWatermark('branchmenu', { pull: now });
  return { per: { menu: menuItems.length, branchmenu: menuItems.length }, at: now };
}
