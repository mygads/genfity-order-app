/**
 * Rumus kanonik total order - SATU sumber kebenaran untuk kasir/CartDetail/SplitBill/DineIn.
 *
 * Selaras docs/PARITY.md seksi 3 (urutan rumus-BE, integer rupiah):
 * - diskonBelanja = sum(item.discount) + voucherBelanja
 * - ongkirNet = max(0, ongkir - min(ongkir, voucherOngkir))
 * - dasar = subtotal - diskonBelanja
 * - service = server-driven (audit trisisi #1): enabled/type/rate/fixed dari
 *   ms_setting Service/* via getServiceConfig() — cermin BE serviceChargeForOrder
 *   (service_charge.go: enabled? FIXED? round(fixed) : round(dasar*rate/100)).
 *   Tanpa baris setting (lane ESB / offline-murni) = legacy 5% + label estimasi.
 * - pajakTampil = round(dasar * taxRate / (100 + taxRate)), taxRate default 11 (PPN,
 *   kontrak §10.3 + fixtures: 66000->6541, 50000->4955, 145000->14369),
 *   dibaca dari ms_setting(Tax, PPN) via getTaxRate(); info-only (sudah termasuk)
 * - feeESB = round(dasar * 5 / 100), hanya order ESB/marketplace
 * - packaging = nominal kemasan per mode (DINE IN = 0; TAKE AWAY/DELIVERY =
 *   info merchant bila tersedia; kosong/tak dikenal = 0; dibaca via
 *   getPackagingFee — lokal saja, TANPA kirim ke BE karena pos/payment
 *   tak punya field kemasan; cermin ongkir yang menempel pada bill)
 * - bruto = dasar + service + ongkirNet + feeESB + packaging
 * - grandTotal = bulatkan(bruto, step); rounding = grandTotal - bruto
 *
 * ATURAN PEMBULATAN TRISISI (audit #3 — satu kontrak, tiga repo):
 * - Lane Go: step = 1 (integer rupiah). Ditulis server-wins oleh pullGoCatalog
 *   ke ms_setting(Rounding, Step); cermin BE validatePOSPaymentAmountsCurrency
 *   (due IDR dibulatkan ke presisi currency = integer; nilai kirim pun wajib
 *   presisi currency) dan FE roundCurrencyAmount IDR (Math.round). Total APP =
 *   integer = due yang divalidasi BE saat settle (E2E 2026-10-25: stored
 *   totalAmount 27037.5 → cash/card 27038 hijau, stepped 400).
 *   Catatan: stored totalAmount BE (round2) boleh bawa .5; yang diuji saat
 *   settle adalah due presisi-currency — keduanya 27038 untuk kasus di atas.
 * - Lane ESB: step = 100 (NEAREST, dari branch-settings server lama).
 * - JANGAN tambah endpoint rounding; JANGAN ubah step sepihak — tiga repo
 *   harus tetap selaras (BE integer / FE integer / APP step-setting).
 *
 * DISCOUNT_BACKSTOP: diskonBelanja eksplisit di-clamp ke gross (flag
 * backstopHit) agar diskon tak pernah melebihi bruto — dasarBelanja/voucher
 * persen dihitung dari dasar yang sudah dijaga, bukan dari nilai negatif.
 *
 * Voucher:
 * - kind 'Ongkir' / kode GRATISONGKIR -> potong ongkir sebesar min(amount, cap, ongkir)
 * - persen: `rate` 0-100 (promo percent; legacy: kind mengandung '%' + amount = persen)
 *   -> potong = min(round(dasar * pct / 100), cap, dasar), SEBELUM service/pajak
 * - selain itu -> diskon flat nominal sebesar min(amount, cap, dasar)
 * - minSpend: patokan gross (bruto item); tak terpenuhi = voucher diabaikan
 *   (voucherAmt 0 + ongkirCut 0). Backstop kanonis — entry (PromotionList pakai,
 *   Pay applyVoucher) sudah menegakkan duluan.
 */
import { initDb, query, queryFirst } from './db';
import { getJSON } from './storage';

export type TotalsVoucher = {
  code?: string;
  kind?: string;
  /** Nominal Rp untuk voucher flat/ongkir, atau persen (0-100) untuk kind '%' legacy. */
  amount?: number;
  /** Persen 0-100 untuk promo percent (diisi loader promo; mengalahkan tafsir legacy). */
  rate?: number;
  /** Cap nominal (Rp) untuk voucher persen (dan flat/ongkir bila diisi). */
  maxAmount?: number;
  /** Minimum belanja (gross) agar voucher berlaku. */
  minSpend?: number;
};

/**
 * Potongan field promo (rate/maxAmount/minSpend) agar selamat melewati
 * hop navigasi yang membangun ulang objek voucher {code, amount, kind}.
 */
export function voucherExtras(
  v: TotalsVoucher | null | undefined,
): { rate?: number; maxAmount?: number; minSpend?: number } {
  if (!v) return {};
  return {
    ...(v.rate != null ? { rate: v.rate } : {}),
    ...(v.maxAmount != null ? { maxAmount: v.maxAmount } : {}),
    ...(v.minSpend ? { minSpend: v.minSpend } : {}),
  };
}

/** Tarif pajak default 11 (PPN, kontrak §10.3) bila ms_setting(Tax, PPN) tak terbaca. */
export const TAX_DEFAULT = 11;

/**
 * Konfigurasi service charge merchant (audit trisisi #1 — server-driven).
 * Cermin baris BE: enable_service_charge / service_charge_type /
 * service_charge_percent (skala persen, mis. 5 = 5%) / service_charge_fixed_amount.
 */
export type ServiceChargeType = 'PERCENT' | 'FIXED';
export interface ServiceConfig {
  enabled: boolean;
  type: ServiceChargeType;
  /** Skala persen (5 = 5%), cermin BE service_charge_percent. */
  rate: number;
  /** Nominal tetap (Rp), cermin BE service_charge_fixed_amount. */
  fixed: number;
  /** true = dari pull server (Go); false = fallback legacy offline-murni. */
  fromServer: boolean;
}

/**
 * Fallback legacy: lane ESB / offline-murni tanpa pull = service 5% seperti
 * perilaku lama. Pemanggil WAJIB melabeli hasil ini sebagai estimasi
 * (lihat serviceLabel() + kunci i18n serviceEst) karena server bisa
 * menetapkan 0% / FIXED / persen lain — settle BE selalu menang.
 */
export const SERVICE_LEGACY: ServiceConfig = {
  enabled: true,
  type: 'PERCENT',
  rate: 5,
  fixed: 0,
  fromServer: false,
};

/**
 * Baca konfigurasi service dari ms_setting (ditulis server-wins oleh
 * pullGoCatalog dari blok merchant /pos/menu).
 * - ('Service','Enabled') = '1'/'0'
 * - ('Service','Type') = 'PERCENT'/'FIXED' (selain FIXED = persen, cermin BE)
 * - ('Service','Rate') = persen (skala persen)
 * - ('Service','Fixed') = nominal tetap
 * Baris absen (BE lama / lane ESB / belum pull) = SERVICE_LEGACY.
 * Catatan: baris legacy ('Service','Charge') era ESB/seed SENGAJA tak dibaca —
 * itu konstanta tampilan, bukan knob server.
 */
export async function getServiceConfig(): Promise<ServiceConfig> {
  try {
    await initDb();
    const rows = await query<{ key2: string | null; value1: string | null }>(
      `SELECT key2, value1 FROM ms_setting WHERE key1 = 'Service' LIMIT 10`,
    );
    if (!rows.length) return { ...SERVICE_LEGACY };
    const get = (k: string): string | null => {
      const r = rows.find((x) => (x.key2 ?? '').trim().toLowerCase() === k);
      return r ? (r.value1 ?? null) : null;
    };
    const enabledRaw = get('enabled');
    if (enabledRaw === null) return { ...SERVICE_LEGACY };
    const typeRaw = (get('type') ?? '').trim().toUpperCase();
    const rateRaw = Number(get('rate') ?? '');
    const fixedRaw = Number(get('fixed') ?? '');
    return {
      enabled: enabledRaw.trim() !== '0',
      type: typeRaw === 'FIXED' ? 'FIXED' : 'PERCENT',
      rate: Number.isFinite(rateRaw) && rateRaw >= 0 ? rateRaw : 0,
      fixed: Number.isFinite(fixedRaw) && fixedRaw >= 0 ? Math.round(fixedRaw) : 0,
      fromServer: true,
    };
  } catch {
    return { ...SERVICE_LEGACY };
  }
}

/**
 * Label baris service untuk layar/struk dari konfigurasi efektif.
 * - disabled → '' (pemanggil menyembunyikan baris bila service = 0)
 * - FIXED → 'Service (tetap)'
 * - PERCENT → 'Service {r}%' (r = persen server, atau 5 legacy)
 * - legacy (fromServer false) → + ' (estimasi)'
 * `t` = fungsi translate layar (kunci: serviceExclRate/serviceExclFixed/serviceEst).
 */
export function serviceLabel(
  t: (key: string) => string,
  cfg: ServiceConfig,
): string {
  if (!cfg.enabled) return '';
  const base =
    cfg.type === 'FIXED'
      ? t('serviceExclFixed')
      : t('serviceExclRate').replace('{r}', String(cfg.rate));
  return cfg.fromServer ? base : `${base}${t('serviceEst')}`;
}

/**
 * Konfigurasi fee terpusat - SATU sumber angka untuk service, fee platform,
 * langkah pembulatan, dan ongkir bawaan per mode. totals() di bawah memakai
 * konstanta ini (nilai identik dengan literal lama: 0.05 / 0.05 / 100),
 * dan layar kasir memakai defaultOngkirForMode() untuk nilai awal ongkir.
 */
export const FEE_DEFAULTS: {
  /** Tarif service excl sebagai pecahan (0.05 = 5%). */
  serviceRate: number;
  /** Tarif fee platform ESB/marketplace sebagai pecahan (0.05 = 5%). */
  platformFeeRate: number;
  /** Langkah pembulatan grand total (Rp). */
  roundStep: number;
  /** Ongkir bawaan per mode (Rp) - saat ini 0 semua; dialog ongkir tetap bisa ubah manual. */
  ongkirByMode: Record<string, number>;
} = {
  serviceRate: 0.05,
  platformFeeRate: 0.05,
  roundStep: 100,
  ongkirByMode: {
    'DINE IN': 0,
    'TAKE AWAY': 0,
    GOFOOD: 0,
    GRABFOOD: 0,
    SHOPEEFOOD: 0,
  },
};

/** Ongkir bawaan untuk mode order; 0 bila mode tak dikenal (tetap bisa diubah manual).
 * S-F3: jadwal server opsional (base/perKm/min/max dari pos-config BE) —
 * bila base valid → base (absen = peta legacy di bawah = perilaku lama).
 * Jarak (perKm) dihitung via calculateDeliveryFee bila jarak diketahui. */
export function defaultOngkirForMode(mode?: string, schedule?: DeliveryFeeSchedule | null): number {
  const base = schedule?.base;
  if (base !== undefined && base !== null && Number.isFinite(base) && base >= 0) {
    return Math.round(base);
  }
  const v = FEE_DEFAULTS.ongkirByMode[(mode ?? '').trim().toUpperCase()];
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/** S-F3: jadwal ongkir server (cermin BE terminal_pos_config.go: null per
 * field = tak dikonfigurasi). */
export interface DeliveryFeeSchedule {
  base: number | null;
  perKm: number | null;
  min: number | null;
  max: number | null;
}

/** S-F3: hitung ongkir dari jarak (cermin BE calculateDeliveryFee:
 * round(base + perKm*km), lalu clamp min, lalu max; invalid = 0 jujur). */
export function calculateDeliveryFee(distanceKm: unknown, s?: DeliveryFeeSchedule | null): number {
  if (!s) return 0;
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km < 0) return 0;
  const base = s.base !== null && s.base !== undefined && Number.isFinite(s.base) && s.base >= 0 ? s.base : 0;
  const perKm = s.perKm !== null && s.perKm !== undefined && Number.isFinite(s.perKm) && s.perKm >= 0 ? s.perKm : 0;
  let fee = Math.round(base + perKm * km);
  if (s.min !== null && s.min !== undefined && Number.isFinite(s.min) && s.min >= 0 && fee < s.min) fee = Math.round(s.min);
  if (s.max !== null && s.max !== undefined && Number.isFinite(s.max) && s.max >= 0 && fee > s.max) fee = Math.round(s.max);
  return Math.max(0, fee);
}

/**
 * Baca tarif pajak dari ms_setting (DUAL-CURRENCY §4d: per-cabang).
 * Urutan menang: eksplisit per-cabang ms_setting('Tax', 'PPN_<branchId>')
 * → eksplisit global ms_setting('Tax', 'PPN') → default per currency
 * (IDR = TAX_DEFAULT 11 PPN, AUD = 10 GST). Tanpa baris per-cabang =
 * perilaku lama persis. branchId default = cabang aktif
 * (ms_setting('Branch','Name').value2 — B001/B004 di alur seed).
 */
export async function getTaxRate(currency?: string, branchId?: string): Promise<number> {
  try {
    await initDb();
    const bid = (branchId ?? '').trim() || (await getActiveBranchId());
    if (bid) {
      const per = await queryFirst<{ value1: string | null }>(
        `SELECT value1 FROM ms_setting WHERE key1 = 'Tax' AND key2 = ? LIMIT 1`,
        [`PPN_${bid}`],
      );
      const pn = Number(per?.value1);
      if (Number.isFinite(pn) && pn >= 0 && pn <= 100) return pn;
    }
    const row = await queryFirst<{ value1: string | null }>(
      "SELECT value1 FROM ms_setting WHERE key1 = 'Tax' AND key2 = 'PPN'",
    );
    const n = Number(row?.value1);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  } catch {
    /* abaikan: pakai fallback default */
  }
  if ((currency ?? '').trim().toUpperCase() === 'AUD') return 10;
  return TAX_DEFAULT;
}

/** ID cabang aktif dari ms_setting('Branch','Name').value2 ('' bila tak ada). */
export async function getActiveBranchId(): Promise<string> {
  try {
    await initDb();
    const row = await queryFirst<{ value2: string | null }>(
      `SELECT value2 FROM ms_setting WHERE key1 = 'Branch' AND key2 = 'Name' LIMIT 1`,
    );
    return (row?.value2 ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * Langkah pembulatan grand total per currency. Urutan menang (S-F4):
 * 1. cache pos-config server (`genfity.pos.roundingStep`, ditulis
 *    syncPosConfigFromServer dari BE roundingStep currency-derived);
 * 2. setting eksplisit ms_setting(Rounding, Step) — dua layout ala
 *    getRoundingSetting di lib/db.ts;
 * 3. default currency (argumen; pemanggil isi getCachedCurrency().code):
 *    AUD = 1 (sen), selain itu FEE_DEFAULTS.roundStep (100, kompatibel).
 */
export async function getRoundStep(currency?: string): Promise<number> {
  try {
    const srv = await getJSON<{ step?: unknown } | null>('genfity.pos.roundingStep', null);
    const s = srv?.step;
    if (s !== undefined && s !== null && s !== '') {
      const n = Number(s);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }
  } catch {
    /* abaikan: lanjut ke ms_setting */
  }
  try {
    await initDb();
    const rows = await query<{
      key1: string | null;
      key2: string | null;
      value1: string | null;
    }>(`SELECT key1, key2, value1 FROM ms_setting WHERE key1 LIKE 'Rounding%' LIMIT 20`);
    for (const r of rows) {
      const k1 = (r.key1 ?? '').trim().toLowerCase();
      const k2 = (r.key2 ?? '').trim().toLowerCase();
      const k = k1 === 'rounding' ? k2 : k1.replace(/^rounding\s+/, '');
      if (k === 'step') {
        const n = Number((r.value1 ?? '').trim());
        if (Number.isFinite(n) && n > 0) return Math.round(n);
      }
    }
  } catch {
    /* abaikan: pakai fallback default */
  }
  if ((currency ?? '').trim().toUpperCase() === 'AUD') return 1;
  return FEE_DEFAULTS.roundStep;
}

/**
 * Biaya kemasan nominal (Rp utuh) untuk mode order dari ms_setting
 * ('Packaging','Fee': value1 = nominal, value2 = '1' aktif / '0' mati),
 * ditulis oleh pull katalog masterGo dari info merchant BE
 * (enablePackagingFee + packagingFeeAmount).
 * - DINE IN (varian) = 0 — makan di tempat tak kena kemasan.
 * - TAKE AWAY / DELIVERY / agregator (varian) = nominal bila diaktifkan.
 * - kosong / tak dikenal = 0 (tanpa tuduhan biaya).
 * Tanpa baris setting (BE lama / belum pull) = 0: perilaku lama persis.
 */
export async function getPackagingFee(mode?: string): Promise<number> {
  const m = (mode ?? '').trim().toUpperCase();
  if (!m) return 0;
  if (m.includes('DINE')) return 0;
  const takeaway = m.includes('TAKE') || m.includes('BAWA') || m.includes('BUNGKUS') || m.includes('PULANG');
  const delivery = m.includes('DELIVER') || m.includes('ANTAR') || m.includes('KIRIM') || m.includes('OJEK');
  const aggregator = isMarketplaceMode(m) || m.includes('PICKUP') || m.includes('AMBIL');
  if (!takeaway && !delivery && !aggregator) return 0;
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null; value2: string | null }>(
      `SELECT value1, value2 FROM ms_setting WHERE key1 = 'Packaging' AND key2 = 'Fee' LIMIT 1`,
    );
    if ((row?.value2 ?? '').trim() !== '1') return 0;
    const n = Math.round(Number(row?.value1) || 0);
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export type TotalsInput = {
  /** Bruto item (jumlah itemTotal, sebelum diskon/voucher). */
  gross: number;
  /** Diskon order (bukan voucher). */
  discount?: number;
  /** Alias discount - dipakai pemanggil kasir/CartDetail/DineIn. */
  discountTotal?: number;
  voucher?: TotalsVoucher | null;
  ongkir?: number;
  /** Biaya kemasan nominal (Rp utuh) per mode order — default 0 (DINE IN /
   * mode tak dikenal). Diisi pemanggil dari getPackagingFee(mode). Masuk
   * bruto apa adanya (tanpa persen/pembulatan sendiri). */
  packaging?: number;
  /** true untuk order ESB/marketplace → fee platform 5% masuk bruto. */
  esbOrder?: boolean;
  /** Tarif pajak persen; default TAX_DEFAULT (11 = PPN). */
  taxRate?: number;
  /**
   * Service charge server-driven (audit trisisi #1). Default = legacy 5%
   * (enabled, PERCENT, rate 5) = perilaku lama; pemanggil yang sadar-server
   * mengisi dari getServiceConfig(). Skala rate = persen (5 = 5%).
   */
  serviceEnabled?: boolean;
  serviceType?: ServiceChargeType;
  serviceRate?: number;
  serviceFixed?: number;
  /** Langkah pembulatan grand total; default FEE_DEFAULTS.roundStep (100 =
   * rupiah). Cabang AUD memakai 1 (sen) — diisi pemanggil dari
   * getRoundStep() atau eksplisit per order (seed AUD). */
  roundStep?: number;
};

/** Mode agregator/online yang kena fee platform (GOFOOD/GRABFOOD/SHOPEEFOOD/ESB). */
export function isMarketplaceMode(mode?: string): boolean {
  const k = (mode ?? '').toUpperCase();
  return (
    k.includes('GOFOOD') ||
    k.includes('GRABFOOD') ||
    k.includes('GRAB') ||
    k.includes('SHOPEEFOOD') ||
    k.includes('SHOPEE') ||
    k.includes('ESB')
  );
}

export type TotalsResult = {
  /** Echo bruto tersanitasi (alias gross). */
  subtotalGross: number;
  /** Echo diskon tersanitasi. */
  discountTotal: number;
  /** gross - discount - voucherAmt (net item = dasar rumus kanonik). */
  subtotal: number;
  /** Diskon voucher belanja: flat nominal atau persen (0 bila voucher ongkir terpakai). */
  voucherAmt: number;
  /** Potongan ongkir oleh voucher ongkir. */
  ongkirCut: number;
  /** ongkir - ongkirCut. */
  ongkirNet: number;
  /** Service server-driven (0 bila disabled); legacy = 5% dari subtotal. */
  service: number;
  /** Pajak inclusive info-only: round(subtotal * taxRate / (100 + taxRate)). */
  taxIncl: number;
  /** Tarif pajak efektif yang dipakai (echo taxRate / default). */
  taxRate: number;
  /** Fee platform 5% dari subtotal (0 bila bukan order ESB/marketplace). */
  feeESB: number;
  /** Biaya kemasan nominal (echo input tersanitasi; 0 = tanpa kemasan). */
  packaging: number;
  /** true bila diskonBelanja eksplisit melebihi gross dan di-clamp. */
  backstopHit: boolean;
  /** subtotal + service + ongkirNet + feeESB (tak membulat). */
  bruto: number;
  /** bruto dibulatkan ke kelipatan langkah (default Rp 100; AUD = 1). */
  total: number;
  /** total - bruto. */
  rounding: number;
  /** kind === 'Ongkir' || code === 'GRATISONGKIR'. */
  isOngkirVoucher: boolean;
  /** isOngkirVoucher && ongkir > 0. */
  useOngkirCut: boolean;
  /** true bila voucher dihitung sebagai persen (kind mengandung '%'). */
  isPercentVoucher: boolean;
};

export function totals(input: TotalsInput): TotalsResult {
  const gross = Math.max(0, Math.round(Number(input.gross) || 0));
  /** DISCOUNT_BACKSTOP: diskon eksplisit tak boleh melebihi bruto item. */
  const discountRaw = Math.max(
    0,
    Math.round(Number(input.discount ?? input.discountTotal) || 0),
  );
  const backstopHit = discountRaw > gross;
  const discount = Math.min(discountRaw, gross);
  const ongkir = Math.max(0, Math.round(Number(input.ongkir) || 0));
  const packaging = Math.max(0, Math.round(Number(input.packaging) || 0));
  const amount = Math.max(0, Math.round(Number(input.voucher?.amount) || 0));
  const code = typeof input.voucher?.code === 'string' ? input.voucher.code : '';
  const kind = typeof input.voucher?.kind === 'string' ? input.voucher.kind : '';
  const rate = (() => {
    const r = Number(input.taxRate);
    return Number.isFinite(r) && r >= 0 && r <= 100 ? r : TAX_DEFAULT;
  })();

  const isOngkirVoucher = kind === 'Ongkir' || code === 'GRATISONGKIR';
  /** Backstop minSpend (#16): patokan gross; gagal = voucher diabaikan total. */
  const minSpend = Math.max(0, Math.round(Number(input.voucher?.minSpend) || 0));
  const meetsMin = gross >= minSpend;
  const useOngkirCut = isOngkirVoucher && ongkir > 0 && meetsMin;
  const capRaw = Number(input.voucher?.maxAmount);
  const cap = Number.isFinite(capRaw) && capRaw >= 0 ? Math.round(capRaw) : null;
  const cappedFlat = cap != null ? Math.min(amount, cap) : amount;
  const ongkirCut = useOngkirCut ? Math.min(cappedFlat, ongkir) : 0;
  const ongkirNet = ongkir - ongkirCut;
  /** Dasar belanja sebelum voucher belanja (PARITY seksi 3: subtotal - diskonBelanja parsial). */
  const dasarBelanja = Math.max(0, gross - discount);
  /** Voucher persen kanonis (#15): rate eksplisit diutamakan; legacy kind '%'
   * memakai amount sebagai persen. Cap + minSpend + batas dasar ditegakkan. */
  const rateRaw = Number(input.voucher?.rate);
  const hasRate = Number.isFinite(rateRaw);
  const isPercentVoucher = !isOngkirVoucher && (hasRate || kind.includes('%'));
  const pct = !isPercentVoucher
    ? 0
    : hasRate
      ? Math.min(100, Math.max(0, rateRaw))
      : Math.min(100, amount);
  const voucherPctAmt = isPercentVoucher ? Math.round((dasarBelanja * pct) / 100) : 0;
  const cappedPct = cap != null ? Math.min(voucherPctAmt, cap) : voucherPctAmt;
  const voucherAmt = !meetsMin
    ? 0
    : useOngkirCut
      ? 0
      : isOngkirVoucher
        ? 0 // Voucher ongkir MURNI potong ongkir saja: tanpa ongkir (dine-in/
          // takeaway) nilainya 0, bukan berubah jadi diskon belanja.
        : isPercentVoucher
          ? Math.min(cappedPct, dasarBelanja)
          : Math.min(cappedFlat, dasarBelanja);
  const subtotal = Math.max(0, gross - discount - voucherAmt);
  /**
   * Service server-driven (audit trisisi #1) — cermin BE serviceChargeForOrder
   * (FIXED? round(fixed) : round(dasar*rate/100), disabled/rate<=0/fixed<=0 = 0).
   * Default tanpa input server = legacy 5% (perilaku lama persis).
   */
  const svcEnabled = input.serviceEnabled ?? true;
  const svcType: ServiceChargeType =
    input.serviceType === 'FIXED' ? 'FIXED' : 'PERCENT';
  const svcRateRaw = Number(input.serviceRate);
  const svcRate =
    Number.isFinite(svcRateRaw) && svcRateRaw >= 0 ? svcRateRaw : 5;
  const svcFixedRaw = Number(input.serviceFixed);
  const svcFixed =
    Number.isFinite(svcFixedRaw) && svcFixedRaw >= 0
      ? Math.round(svcFixedRaw)
      : 0;
  const service = !svcEnabled
    ? 0
    : svcType === 'FIXED'
      ? svcFixed > 0
        ? svcFixed
        : 0
      : svcRate > 0
        ? Math.round((subtotal * svcRate) / 100)
        : 0;
  /** Pajak inclusive info-only (kontrak §10.3: default 11 -> round(net * 11/111), setting-driven via ms_setting Tax/PPN). */
  const taxIncl = Math.round((subtotal * rate) / (100 + rate));
  /** Fee platform khusus order ESB/marketplace (kontrak §5: platformFee). */
  const feeESB = input.esbOrder ? Math.round(subtotal * FEE_DEFAULTS.platformFeeRate) : 0;
  const bruto = subtotal + service + ongkirNet + feeESB + packaging;
  /** Pembulatan ke kelipatan langkah (default Rp 100; AUD = 1 via roundStep). */
  const stepRaw = Number(input.roundStep);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? Math.round(stepRaw) : FEE_DEFAULTS.roundStep;
  const total = Math.round(bruto / step) * step;
  const rounding = total - bruto;
  return {
    subtotalGross: gross,
    discountTotal: discount,
    subtotal,
    voucherAmt,
    ongkirCut,
    ongkirNet,
    service,
    taxIncl,
    taxRate: rate,
    feeESB,
    packaging,
    backstopHit,
    bruto,
    total,
    rounding,
    isOngkirVoucher,
    useOngkirCut,
    isPercentVoucher,
  };
}
