/**
 * R4-4 — snapshot metode bayar merchant dari GET pos-config (agen BE paralel;
 * kontrak: key `pos.paymentMethods{payAtCashierEnabled,manualTransferEnabled,
 * qrisEnabled,codEnabled,gpayEnabled}`, absen = semua true = tampil semua).
 *
 * Modul MURNI (nol-impor, erasable-only) agar dapat ditranspile + diuji
 * runtime oleh tripwire-payment-methods apa adanya (cermin backupCodec).
 *
 * Kebijakan konsumsi (server-wins, defensif vs BE lama):
 * - Kunci absen (BE lama) = semua true = tampil semua (legacy, NOL-regresi).
 * - Nilai tak dikenal (string asing) = dianggap absen = true (fail-visible:
 *   kasir tak boleh terkunci oleh payload asing).
 * - Hanya pemetaan JELAS yang digerbang UI (QRIS). Sisanya tampil + parked
 *   di bawah (jangan tebak berlebihan).
 *
 * R4-4 PETA FLAG→UI APP POS (permukaan yang tak disebut = selalu tampil):
 * - qrisEnabled=false → kartu QRIS di tab online PayScreen disembunyikan.
 *   [JELAS — nama sama, elemen sama — DITERAPKAN via filterOnlineWallets]
 * - codEnabled → TANPA permukaan UI di APP POS (tak ada alur COD di PayScreen
 *   / ExtraPaySection — grep COD nihil) → no-op. [PARKED: BE mungkin untuk FE]
 *
 * Q4 (putusan owner 25-Okt — satukan ke key efektif): bila respons memuat
 * BOTH `paymentSettings` (EFEKTIF kanonis BE: qris dinormalisasi ID+IDR +
 * requirePaymentProof) dan `paymentMethods` (MENTAH R4-4, deprecated) →
 * efektif menang PER KUNCI; mentah hanya mengisi kunci yang absen di efektif
 * (mis. gpayEnabled yang tak ada di blok efektif); keduanya absen =
 * semua-true (legacy tampil). Defensif: key mana pun absen/berubah = tetap
 * jalan (legacy tampil, kasir tak terkunci).
 * - manualTransferEnabled → kandidat kartu Transfer ExtraPay, TAPI setting ini
 *   milik checkout customer (FE storefront) bukan tender kasir → TAMPIL.
 *   [PARKED/AMBIGU — butuh putusan owner sebelum digerbang]
 * - payAtCashierEnabled → kandidat tab tunai, TAPI seluruh POS = di kasir
 *   (pemetaan 1:1 tak bermakna) → TAMPIL. [PARKED/AMBIGU]
 * - gpayEnabled → kandidat kartu GoPay, TAPI "gpay" ambigu (GoPay vs Google Pay
 *   vs Genfity Pay — BE memakai istilah Genfity Pay untuk proxy Duitku) →
 *   TAMPIL. [PARKED/AMBIGU]
 * - Tab tunai + member (deposit) → tak digerbang snapshot R4-4 ini (selalu
 *   tampil dari sisi paymentMethods; gate tab S-F1/S-F1b terpisah tak diubah
 *   R4-4 — kasir tak boleh terkunci; cermin fallback visibleTabs PayScreen
 *   yang kembali ke daftar currency bila semua tab mati).
 */

/** Snapshot 5 flag metode bayar (semua-true = tampil semua = default legacy). */
export interface PaymentMethods {
  payAtCashierEnabled: boolean;
  manualTransferEnabled: boolean;
  qrisEnabled: boolean;
  codEnabled: boolean;
  gpayEnabled: boolean;
}

export const PAYMENT_METHODS_DEFAULT: PaymentMethods = {
  payAtCashierEnabled: true,
  manualTransferEnabled: true,
  qrisEnabled: true,
  codEnabled: true,
  gpayEnabled: true,
};

/** Satu flag + alias yang diterima (camelCase + snake_case + bentuk pendek). */
interface FlagAlias {
  key: keyof PaymentMethods;
  aliases: string[];
}

const FLAG_ALIASES: FlagAlias[] = [
  { key: 'payAtCashierEnabled', aliases: ['payAtCashierEnabled', 'pay_at_cashier_enabled', 'payAtCashier', 'pay_at_cashier'] },
  { key: 'manualTransferEnabled', aliases: ['manualTransferEnabled', 'manual_transfer_enabled', 'manualTransfer', 'manual_transfer'] },
  { key: 'qrisEnabled', aliases: ['qrisEnabled', 'qris_enabled', 'qris', 'enableQris', 'enable_qris'] },
  { key: 'codEnabled', aliases: ['codEnabled', 'cod_enabled', 'cod', 'cashOnDelivery', 'cash_on_delivery'] },
  { key: 'gpayEnabled', aliases: ['gpayEnabled', 'gpay_enabled', 'gpay', 'goPayEnabled', 'gopay_enabled', 'gopay'] },
];

/** Kunci pembungkus yang dipindai (kontrak `pos.paymentMethods` + varian). */
const CONTAINER_KEYS = [
  'pos',
  'posBehavior',
  'posBehaviorSettings',
  'pos_behavior',
  'pb',
  'paymentSettings',
  'payment_settings',
  'payment',
  'settings',
];

/** Q4: blok EFEKTIF kanonis BE — dipindai DULU, menang per kunci atas mentah. */
const EFFECTIVE_KEYS = ['paymentSettings', 'payment_settings'];

/** Kunci objek snapshot di dalam tiap kontainer. */
const SNAPSHOT_KEYS = ['paymentMethods', 'payment_methods'];

/** Tafsir satu nilai ke boolean; undefined = absen/tak-dikenal (→ default). */
function asBoolLoose(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return undefined;
    return v !== 0;
  }
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'ya' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'tidak' || s === 'no') return false;
  return undefined;
}

/**
 * Parse murni snapshot metode bayar: toleran flat + nested + snake_case.
 * Tak pernah melempar; absen total = semua-true (BE lama, NOL-regresi).
 */
export function parsePaymentMethods(raw: unknown): PaymentMethods {
  const out: PaymentMethods = { ...PAYMENT_METHODS_DEFAULT };
  if (!raw || typeof raw !== 'object') return out;
  const root = raw as Record<string, unknown>;
  const found: Partial<Record<keyof PaymentMethods, boolean>> = {};

  const scanFlat = (o: Record<string, unknown>): void => {
    for (const { key, aliases } of FLAG_ALIASES) {
      if (found[key] !== undefined) continue;
      for (const a of aliases) {
        const b = asBoolLoose(o[a]);
        if (b !== undefined) {
          found[key] = b;
          break;
        }
      }
    }
  };

  const scanContainer = (o: Record<string, unknown>): void => {
    for (const nk of SNAPSHOT_KEYS) {
      const n = o[nk];
      if (n && typeof n === 'object') scanFlat(n as Record<string, unknown>);
    }
    scanFlat(o);
  };

  // Q4: FASE E DULU — blok efektif kanonis (kanonis BE) menang per kunci.
  // Guard di scanFlat (kunci terisi tak ditimpa) membuat fase mentah di bawah
  // hanya mengisi sisa (mis. gpayEnabled yang tak ada di blok efektif).
  for (const ek of EFFECTIVE_KEYS) {
    const e = root[ek];
    if (e && typeof e === 'object') scanFlat(e as Record<string, unknown>);
  }
  // FASE R — fallback snapshot mentah R4-4 + flat root (BE lama / gap-fill).
  scanContainer(root);
  for (const ck of CONTAINER_KEYS) {
    const c = root[ck];
    if (c && typeof c === 'object') scanContainer(c as Record<string, unknown>);
  }
  return { ...out, ...found };
}

/**
 * Saring kartu dompet online menurut snapshot (murni).
 * Hanya QRIS yang digerbang tegas; gpayEnabled AMBIGU → tak dipakai di sini.
 * NOL-regresi: snapshot absen/all-true = daftar utuh dikembalikan.
 */
export function filterOnlineWallets<T extends { id: string }>(wallets: T[], m: PaymentMethods): T[] {
  if (!m) return wallets;
  let out = wallets;
  // QRIS digerbang tegas bila false.
  if (m.qrisEnabled === false) out = out.filter((w) => w.id !== 'qris');
  // Genfity Pay (gopay/google-pay ambigu diselesaikan): id gpay/genfity_pay digerbang bila false.
  if (m.gpayEnabled === false) out = out.filter((w) => w.id !== 'gpay' && w.id !== 'genfity_pay' && w.id !== 'gopay');
  return out;
}

/** Strict fail-closed: snapshot absen = semua false + butuh sync (untuk layar baru). Legacy parse tetap all-true agar BE lama tidak terkunci. */
export interface StrictPaymentMethodsResult {
  methods: PaymentMethods;
  hasExplicitSnapshot: boolean;
}

export function hasExplicitPaymentSnapshot(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const root = raw as Record<string, unknown>;
  const containers: unknown[] = [root];
  for (const k of ['pos', 'paymentSettings', 'payment_settings']) {
    if (root[k] && typeof root[k] === 'object') containers.push(root[k]);
  }
  for (const c of containers) {
    const o = c as Record<string, unknown>;
    for (const k of ['paymentMethods', 'payment_methods']) {
      if (o[k] && typeof o[k] === 'object') return true;
    }
    for (const k of ['qrisEnabled', 'qris_enabled', 'gpayEnabled', 'gpay_enabled', 'manualTransferEnabled', 'payAtCashierEnabled', 'codEnabled']) {
      if (o[k] !== undefined) return true;
    }
  }
  return false;
}

export function parsePaymentMethodsStrict(raw: unknown): StrictPaymentMethodsResult {
  const has = hasExplicitPaymentSnapshot(raw);
  if (!has) {
    return { methods: { payAtCashierEnabled: false, manualTransferEnabled: false, qrisEnabled: false, codEnabled: false, gpayEnabled: false }, hasExplicitSnapshot: false };
  }
  return { methods: parsePaymentMethods(raw), hasExplicitSnapshot: true };
}
