/**
 * Rumus kanonik total order - SATU sumber kebenaran untuk kasir/CartDetail/SplitBill/DineIn.
 *
 * Selaras docs/PARITY.md seksi 3 (urutan rumus-BE, integer rupiah):
 * - diskonBelanja = sum(item.discount) + voucherBelanja
 * - ongkirNet = max(0, ongkir - min(ongkir, voucherOngkir))
 * - dasar = subtotal - diskonBelanja
 * - service = round(dasar * 5 / 100)
 * - pajakTampil = round(dasar * taxRate / (100 + taxRate)), taxRate default 11 (PPN,
 *   kontrak §10.3 + fixtures: 66000->6541, 50000->4955, 145000->14369),
 *   dibaca dari ms_setting(Tax, PPN) via getTaxRate(); info-only (sudah termasuk)
 * - feeESB = round(dasar * 5 / 100), hanya order ESB/marketplace
 * - bruto = dasar + service + ongkirNet + feeESB
 * - grandTotal = bulatkan(bruto, step 100); rounding = grandTotal - bruto
 *
 * Voucher:
 * - kind 'Ongkir' / kode GRATISONGKIR -> potong ongkir sebesar min(amount, ongkir)
 * - kind mengandung '%' (mis. 'Diskon (%)' dari VoucherScreen, amount = persen)
 *   -> potong = round(dasar * pct / 100), pct dibatasi 0-100, diterapkan
 *   SEBELUM service/pajak (mengurangi dasar)
 * - selain itu -> diskon flat nominal atas belanja sebesar min(amount, dasar)
 */
import { initDb, queryFirst } from './db';

export type TotalsVoucher = {
  code?: string;
  kind?: string;
  /** Nominal Rp untuk voucher flat/ongkir, atau persen (0-100) untuk kind '%'. */
  amount?: number;
};

/** Tarif pajak default 11 (PPN, kontrak §10.3) bila ms_setting(Tax, PPN) tak terbaca. */
export const TAX_DEFAULT = 11;

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

/** Ongkir bawaan untuk mode order; 0 bila mode tak dikenal (tetap bisa diubah manual). */
export function defaultOngkirForMode(mode?: string): number {
  const v = FEE_DEFAULTS.ongkirByMode[(mode ?? '').trim().toUpperCase()];
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Baca tarif pajak dari ms_setting(Tax, PPN) (dummy: value1 '11').
 * Fallback TAX_DEFAULT bila DB kosong / nilai tak valid. Tanpa infrastruktur
 * baru: memakai pola queryFirst yang sudah ada (lih. ExpenseScreen loadCoa).
 */
export async function getTaxRate(): Promise<number> {
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      "SELECT value1 FROM ms_setting WHERE key1 = 'Tax' AND key2 = 'PPN'",
    );
    const n = Number(row?.value1);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  } catch {
    /* abaikan: pakai fallback default */
  }
  return TAX_DEFAULT;
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
  /** true untuk order ESB/marketplace → fee platform 5% masuk bruto. */
  esbOrder?: boolean;
  /** Tarif pajak persen; default TAX_DEFAULT (11 = PPN). */
  taxRate?: number;
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
  /** 5% dari subtotal (excl). */
  service: number;
  /** Pajak inclusive info-only: round(subtotal * taxRate / (100 + taxRate)). */
  taxIncl: number;
  /** Tarif pajak efektif yang dipakai (echo taxRate / default). */
  taxRate: number;
  /** Fee platform 5% dari subtotal (0 bila bukan order ESB/marketplace). */
  feeESB: number;
  /** subtotal + service + ongkirNet + feeESB (tak membulat). */
  bruto: number;
  /** bruto dibulatkan ke Rp 100. */
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
  const discount = Math.max(
    0,
    Math.round(Number(input.discount ?? input.discountTotal) || 0),
  );
  const ongkir = Math.max(0, Math.round(Number(input.ongkir) || 0));
  const amount = Math.max(0, Math.round(Number(input.voucher?.amount) || 0));
  const code = typeof input.voucher?.code === 'string' ? input.voucher.code : '';
  const kind = typeof input.voucher?.kind === 'string' ? input.voucher.kind : '';
  const rate = (() => {
    const r = Number(input.taxRate);
    return Number.isFinite(r) && r >= 0 && r <= 100 ? r : TAX_DEFAULT;
  })();

  const isOngkirVoucher = kind === 'Ongkir' || code === 'GRATISONGKIR';
  const useOngkirCut = isOngkirVoucher && ongkir > 0;
  const ongkirCut = useOngkirCut ? Math.min(amount, ongkir) : 0;
  const ongkirNet = ongkir - ongkirCut;
  /** Dasar belanja sebelum voucher belanja (PARITY seksi 3: subtotal - diskonBelanja parsial). */
  const dasarBelanja = Math.max(0, gross - discount);
  /** Voucher persen kanonis: potong = round(dasar * pct/100), sebelum service/pajak. */
  const isPercentVoucher = !isOngkirVoucher && kind.includes('%');
  const pct = isPercentVoucher ? Math.min(100, amount) : 0;
  const voucherPctAmt = isPercentVoucher ? Math.round((dasarBelanja * pct) / 100) : 0;
  const voucherAmt = useOngkirCut
    ? 0
    : isPercentVoucher
      ? Math.min(voucherPctAmt, dasarBelanja)
      : Math.min(amount, dasarBelanja);
  const subtotal = Math.max(0, gross - discount - voucherAmt);
  const service = Math.round(subtotal * FEE_DEFAULTS.serviceRate);
  /** Pajak inclusive info-only (kontrak §10.3: default 11 -> round(net * 11/111), setting-driven via ms_setting Tax/PPN). */
  const taxIncl = Math.round((subtotal * rate) / (100 + rate));
  /** Fee platform khusus order ESB/marketplace (kontrak §5: platformFee). */
  const feeESB = input.esbOrder ? Math.round(subtotal * FEE_DEFAULTS.platformFeeRate) : 0;
  const bruto = subtotal + service + ongkirNet + feeESB;
  /** Pembulatan ke kelipatan Rp 100 terdekat. */
  const total = Math.round(bruto / FEE_DEFAULTS.roundStep) * FEE_DEFAULTS.roundStep;
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
    bruto,
    total,
    rounding,
    isOngkirVoucher,
    useOngkirCut,
    isPercentVoucher,
  };
}
