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
import { initDb, queryFirst, run } from './db';
import { persistReceiptPrefs } from './posSyncReceipt';
import { RECEIPT_TEMPLATE_DEFAULTS, fetchDefaultKitchenTemplate, fetchDefaultReceiptTemplate, fetchReceiptTemplates, persistKitchenTemplate, persistReceiptTemplate, syncMerchantLogoRaster } from './receiptTemplate';
import { getWatermark, setWatermark } from './sync';

export class GoCatalogUnavailable extends Error {
  constructor() {
    super('backend bukan Go (/pos/menu 404)');
    this.name = 'GoCatalogUnavailable';
  }
}

interface GoAddonItem {
  id: number;
  name: string;
  price: number;
  isActive: boolean;
  trackStock: boolean;
  stockQty?: number | null;
  dailyStockTemplate?: number | null;
}

interface GoAddonCategory {
  id: number;
  name: string;
  addonItems?: GoAddonItem[] | null;
}

interface GoMenuItem {
  id: number;
  // P1-06 fields ditambah di bawah via cast (kompat mundur).
  name: string;
  price: number;
  promoPrice?: number | null;
  imageUrl?: string | null;
  isActive: boolean;
  categoryId?: number | null;
  trackStock: boolean;
  stockQty?: number | null;
  dailyStockTemplate?: number | null;
  hasAddons?: boolean;
  addonCategories?: GoAddonCategory[] | null;
  /** Fase 3 katalog polimorfik (best-effort, BE lama tak mengirim = null). */
  unitLabel?: string | null;
  sku?: string | null;
  provider?: string | null;
  nominal?: number | null;
  durationMin?: number | null;
  sizeLabel?: string | null;
  colorLabel?: string | null;
  kind?: string | null;
}

interface GoCategory {
  id: number;
  name: string;
  sortOrder: number;
}

interface GoMerchant {
  currency: string;
  /** Identitas merchant untuk header struk 1:1 BE (showMerchantName/Address/Phone/Email). Opsional — BE lama tak mengirim. */
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** 1:1 BE: kode/logo/tipe merchant untuk prefix nomor, pratinjau logo,
   * dan cabang label retail. Opsional — BE lama tak mengirim. */
  code?: string | null;
  logoUrl?: string | null;
  merchantType?: string | null;
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
    // P2 delta envelope (BE aditif): daftar id terhapus + penanda full/delta.
    deletedIds?: Array<number | string>;
    delta?: string;
    sinceEcho?: string;
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
  // P2 delta: kirim since bila watermark ada (BE lama abaikan). Best-effort.
  let since = '';
  try { const wm = await getWatermark('branchmenu'); since = wm.pull || ''; } catch { /* abaikan */ }
  const res = await apiGet('api/merchant/pos/menu', { limit: 500, ...(since ? { since } : {}) });
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
  // P2 delta: hapus lokal id yang dihapus server (best-effort; BE kini kirim [] bila tak ada).
  try {
    const del = (body.data as { deletedIds?: Array<number|string> }).deletedIds;
    if (Array.isArray(del) && del.length > 0) {
      for (const raw of del) {
        const id = String(raw ?? '').trim();
        if (!id) continue;
        try { await run('DELETE FROM ms_branchmenu WHERE menuId = ?', [id]); } catch { /* abaikan */ }
        try { await run('DELETE FROM ms_menu WHERE id = ?', [id]); } catch { /* abaikan */ }
      }
    }
  } catch { /* delta best-effort */ }

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
    // trackStock milik server (cermin BE menus.track_stock): server-wins.
    // Menentukan apakah qty lokal ikut turun saat penjualan + derivasi Habis
    // (paritas BE orders decrement + filter publik track=false → tampil).
    const tracked = m.trackStock === true ? 1 : 0;
    // Template harian milik server (cermin BE menus.daily_stock_template):
    // server-wins (NULL = tanpa template → tombol reset tak tampil, cermin
    // FE guard item.dailyStockTemplate === null).
    const tpl = m.dailyStockTemplate !== undefined && m.dailyStockTemplate !== null
      ? Math.max(0, Math.round(Number(m.dailyStockTemplate))) : null;
    // P1-06: imageHash/imageUpdatedAt/updatedAt opsional (kompat mundur, BE lama tak mengirim).
    const imgHash = (m as unknown as Record<string, unknown>).imageHash !== undefined && (m as unknown as Record<string, unknown>).imageHash !== null ? String((m as unknown as Record<string, unknown>).imageHash) : null;
    const imgUpd = (m as unknown as Record<string, unknown>).imageUpdatedAt !== undefined && (m as unknown as Record<string, unknown>).imageUpdatedAt !== null ? String((m as unknown as Record<string, unknown>).imageUpdatedAt) : null;
    const mUpd = (m as unknown as Record<string, unknown>).updatedAt !== undefined && (m as unknown as Record<string, unknown>).updatedAt !== null ? String((m as unknown as Record<string, unknown>).updatedAt) : now;
    await run(
      `INSERT INTO ms_menu (id, menuName, categoryId, price, imageUrl, imageHash, imageUpdatedAt, updatedAt, stationId, trackStock, stockTemplate, flagActive, syncDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET menuName = excluded.menuName,
         categoryId = excluded.categoryId, price = excluded.price,
         imageUrl = excluded.imageUrl, imageHash = excluded.imageHash, imageUpdatedAt = excluded.imageUpdatedAt, updatedAt = excluded.updatedAt, trackStock = excluded.trackStock,
         stockTemplate = excluded.stockTemplate,
         flagActive = excluded.flagActive, syncDate = excluded.syncDate`,
      [id, str(m.name) ?? '', m.categoryId !== undefined && m.categoryId !== null ? String(m.categoryId) : null, price, str(m.imageUrl), imgHash, imgUpd, mUpd, tracked, tpl, active, now],
    );
    // Fase 3: kolom polimorfik best-effort (DB lama tanpa kolom = abaikan, jangan gagalkan pull).
    try {
      const extra = m as unknown as Record<string, unknown>;
      const hasExtra = ['unitLabel','sku','provider','nominal','durationMin','sizeLabel','colorLabel','kind'].some((k) => extra[k] !== undefined && extra[k] !== null && String(extra[k]).trim() !== '');
      if (hasExtra) {
        const g = (k: string): string | null => {
          const v = extra[k];
          return v === undefined || v === null ? null : String(v).trim() || null;
        };
        const n = (k: string): number | null => {
          const v = extra[k];
          if (v === undefined || v === null) return null;
          const x = Math.round(Number(v));
          return Number.isFinite(x) ? x : null;
        };
        await run(
          'UPDATE ms_menu SET unitLabel = COALESCE(?, unitLabel), sku = COALESCE(?, sku), provider = COALESCE(?, provider), nominal = COALESCE(?, nominal), durationMin = COALESCE(?, durationMin), sizeLabel = COALESCE(?, sizeLabel), colorLabel = COALESCE(?, colorLabel), kind = COALESCE(?, kind) WHERE id = ?',
          [g('unitLabel'), g('sku'), g('provider'), n('nominal'), n('durationMin'), g('sizeLabel'), g('colorLabel'), g('kind'), id],
        );
      }
    } catch {
      /* DB lama tanpa kolom polimorfik — pull tetap sukses */
    }
    // Stok cabang: habis = trackStock + stockQty <= 0. stationId +
    // lowThreshold lokal dipertahankan (printer milik layar Printer; ambang
    // milik Stock Management — pull tak mengirim keduanya).
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
    // Relasi menu→kategori addon (label "Varian" kartu Stock Management).
    // Dihapus per-menu lalu ditulis ulang agar kategori yang dilepas di web
    // ikut hilang (server-wins penuh, pola ms_category di atas).
    await run('DELETE FROM ms_menuaddon WHERE menuId = ?', [id]);
    const cats = Array.isArray(m.addonCategories) ? m.addonCategories : [];
    for (const c of cats) {
      const cid = String(c?.id ?? '').trim();
      if (!cid) continue;
      await run(
        `INSERT OR IGNORE INTO ms_addoncategory (id, categoryName, flagActive, syncDate)
         VALUES (?, ?, 1, ?)`,
        [cid, str(c?.name) ?? cid, now],
      );
      await run(
        `INSERT OR IGNORE INTO ms_menuaddon (menuId, categoryId, syncDate)
         VALUES (?, ?, ?)`,
        [id, cid, now],
      );
      const items = Array.isArray(c?.addonItems) ? c.addonItems : [];
      for (const a of items) {
        const aid = String(a?.id ?? '').trim();
        if (!aid) continue;
        const aTracked = a?.trackStock === true ? 1 : 0;
        const aActive = a?.isActive === false ? 0 : 1;
        const aPrice = num(a?.price, 0);
        // Template harian addon milik server (cermin BE
        // addon_items.daily_stock_template): server-wins, NULL = tanpa template.
        const aTpl = a?.dailyStockTemplate !== undefined && a?.dailyStockTemplate !== null
          ? Math.max(0, Math.round(Number(a.dailyStockTemplate))) : null;
        await run(
          `INSERT INTO ms_addon (id, categoryId, addonName, price, trackStock, stockTemplate, flagActive, syncDate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET categoryId = excluded.categoryId,
             addonName = excluded.addonName, price = excluded.price,
             trackStock = excluded.trackStock, stockTemplate = excluded.stockTemplate,
             flagActive = excluded.flagActive,
             syncDate = excluded.syncDate`,
          [aid, cid, str(a?.name) ?? aid, aPrice, aTracked, aTpl, aActive, now],
        );
        // Stok cabang addon: pola ms_branchmenu; lowThreshold lokal
        // dipertahankan (pull tak mengirimnya, milik Stock Management).
        const aQty = a?.stockQty !== undefined && a?.stockQty !== null ? num(a.stockQty) : 0;
        const aSold = a?.trackStock === true && a?.stockQty !== undefined && a?.stockQty !== null && num(a.stockQty) <= 0 ? 1 : 0;
        await run(
          `INSERT INTO ms_branchaddon (branchId, addonId, qty, flagSoldOut, flagActive, syncDate)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(branchId, addonId) DO UPDATE SET qty = excluded.qty,
             flagSoldOut = excluded.flagSoldOut, flagActive = excluded.flagActive,
             syncDate = excluded.syncDate`,
          [branchId, aid, aQty, aSold, aActive, now],
        );
      }
    }
  }

  // 1:1 identitas merchant untuk header struk (showMerchantName/Address/Phone/Email).
  // Server-wins bila BE mengirim (BE-final /pos/menu); ketidakhadiran = jangan sentuh cache lokal.
  try {
    const mName = typeof merchant.name === 'string' ? merchant.name.trim().slice(0, 80) : '';
    const mAddr = typeof merchant.address === 'string' ? merchant.address.trim().slice(0, 200) : '';
    const mPhone = typeof merchant.phone === 'string' ? merchant.phone.trim().slice(0, 40) : '';
    const mEmail = typeof merchant.email === 'string' ? merchant.email.trim().slice(0, 100) : '';
    const mLogo = typeof merchant.logoUrl === 'string' ? merchant.logoUrl.trim().slice(0, 500) : '';
    const mCode = typeof merchant.code === 'string' ? merchant.code.trim().toUpperCase().slice(0, 12) : '';
    const mType = typeof merchant.merchantType === 'string' ? merchant.merchantType.trim().slice(0, 20) : '';
    if (mName || mAddr || mPhone || mEmail || mLogo || mCode || mType) {
      const infoRaw = JSON.stringify({ name: mName, address: mAddr, phone: mPhone, email: mEmail, logoUrl: mLogo, merchantCode: mCode, merchantType: mType }).slice(0, 2000);
      await run(
        `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Merchant', 'InfoJSON', ?, '1')
         ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
        [infoRaw],
      );
    }
  } catch {
    /* abaikan — header fallback ke nama cabang lokal */
  }
  // Raster logo thermal (pull-time, fire-and-forget): unduh logoUrl → mono →
  // Merchant/LogoMonoJSON; print-time hanya baca (offline tetap jalan).
  // Gagal decode/jaringan = cache lama utuh, pratinjau URL tetap 1:1.
  try {
    const mLogoSync = typeof merchant.logoUrl === 'string' ? merchant.logoUrl.trim().slice(0, 500) : '';
    void syncMerchantLogoRaster(mLogoSync).catch(() => {});
  } catch {
    /* abaikan */
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
  // APP-11 rev 1:1: template struk website (server-wins; 404/BE lama =
  // tak tulis = cache lokal utuh). Best-effort: gagal pull template tak boleh
  // menggagalkan katalog (kontrak katalog tetap hijau). Bila BE baru namun
  // merchant belum membuat template (list 200 kosong), tulis default kanonik
  // BE agar merchant tanpa kustomisasi tetap 1:1 dengan PDF (bukan legacy).
  try {
    const [tpl, kitchenTpl, all] = await Promise.all([
      fetchDefaultReceiptTemplate(),
      fetchDefaultKitchenTemplate(),
      fetchReceiptTemplates(),
    ]);
    if (tpl) {
      await persistReceiptTemplate(tpl, run);
    } else if (all.length === 0) {
      // List kosong perlu dibedakan dari BE lama (404 juga []): cek via
      // endpoint mentah? fetchReceiptTemplates menelan 404. Di sini [] =
      // kemungkinan BE baru tanpa template ATAU BE lama/offline. Tulis
      // default hanya bila katalog Go sukses (BE baru terbukti) — BE lama
      // takkan sampai ke lane ini (GoCatalogUnavailable lebih dulu).
      await persistReceiptTemplate(
        { id: 0, name: 'default', templateType: 'CUSTOMER_RECEIPT', settings: { ...RECEIPT_TEMPLATE_DEFAULTS } },
        run,
      );
    }
    if (kitchenTpl) {
      await persistKitchenTemplate(kitchenTpl, run);
    }
  } catch {
    /* abaikan — render fallback ke default kanonik BE */
  }

  await setWatermark('menu', { pull: now });
  await setWatermark('branchmenu', { pull: now });
  let addonCount = 0;
  try {
    const r = await queryFirst<{ c: number }>('SELECT COUNT(*) AS c FROM ms_addon');
    addonCount = Number(r?.c ?? 0) || 0;
  } catch {
    /* abaikan */
  }
  await setWatermark('addon', { pull: now });
  return { per: { menu: menuItems.length, branchmenu: menuItems.length, addon: addonCount }, at: now };
}
