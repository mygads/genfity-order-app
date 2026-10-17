/**
 * Pemilih sumber data API: Local Mode vs Dummy Mode vs Backend asli
 * (satu titik wiring).
 *
 * - Bila EXPO_PUBLIC_API_BASE_URL terisi URL backend sendiri -> Real Mode:
 *   request memakai apiGet/apiPost (header X-Terminal-Code/X-Branch-Id/
 *   Idempotency-Key/Bearer ala src/config/server.ts). Bila fetch gagal atau
 *   offline, otomatis jatuh kembali ke JSON dummy lokal.
 * - Bila URL kosong DAN EXPO_PUBLIC_DUMMY === '1' -> Dummy Mode (eksplisit
 *   untuk screenshot/demo): semua request dilayani dari JSON lokal di
 *   src/data/dummy, tanpa dial ke server pihak ketiga mana pun.
 * - Selain itu (default: URL kosong, tanpa flag dummy) -> Local Mode:
 *   TIDAK ada dial network dan TIDAK ada JSON dummy; apiFetch mengembalikan
 *   { ok:false, status:0, data:null, fromDummy:false } agar layar memakai
 *   jalur SQLite lokal + empty-state jujur. Dummy pull yang di-cache ke
 *   SQLite tidak boleh mengotori data asli/seed.
 *
 * Layar memanggil helper di file ini (bukan apiGet/apiPost langsung dan
 * bukan require JSON langsung), sehingga saat backend asli jadi cukup ganti
 * base URL di env tanpa mengubah layar.
 */
import {
  ApiPath,
  apiGet,
  apiPost,
  getTerminal,
  setCustomBaseUrl,
  setServerEnv,
} from '../config/server';
import { getItem, setItem } from './storage';
import { dbNowLocal } from './datefmt';
import { initDb, queryFirst } from './db';
import { loadPinRecord, verifyPinHash } from './pin';
import { randomHex as randomHexCsprng } from './uuidv7';

export type ApiMode = 'dummy' | 'real' | 'local';

/** Baca EXPO_PUBLIC_API_BASE_URL tanpa bergantung ke tipe Node. */
export function readEnvBaseUrl(): string {
  try {
    const p = (globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }).process;
    return (p?.env?.['EXPO_PUBLIC_API_BASE_URL'] ?? '').trim();
  } catch {
    return '';
  }
}

/** Baca flag screenshot/demo eksplisit EXPO_PUBLIC_DUMMY tanpa tipe Node. */
export function readEnvDummy(): string {
  try {
    const p = (globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }).process;
    return (p?.env?.['EXPO_PUBLIC_DUMMY'] ?? '').trim();
  } catch {
    return '';
  }
}

// Bila env terisi, arahkan konfigurasi server ke backend sendiri sejak awal
// agar apiGet/apiPost menembak backend asli (bukan host bawaan).
const ENV_URL = readEnvBaseUrl();
if (ENV_URL) {
  try {
    setCustomBaseUrl(ENV_URL);
    setServerEnv('custom');
  } catch {
    /* konfigurasi tetap default dummy */
  }
}

/**
 * Mode aktif saat ini:
 * - 'real' bila EXPO_PUBLIC_API_BASE_URL terisi (backend sendiri);
 * - 'dummy' bila URL kosong DAN EXPO_PUBLIC_DUMMY === '1' (eksplisit
 *   untuk screenshot/demo);
 * - 'local' untuk selain itu (default offline-first tanpa server:
 *   tanpa dial network, tanpa JSON dummy).
 */
export function getApiMode(): ApiMode {
  if (readEnvBaseUrl()) return 'real';
  if (readEnvDummy() === '1') return 'dummy';
  return 'local';
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  /** Body mentah: envelope Yii2 {name,message,code,status,success,data} (OTA: array). */
  data: T;
  /** True bila respons berasal dari JSON dummy lokal (bukan backend asli). */
  fromDummy: boolean;
}

export interface FetchOpts {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number>;
  body?: unknown;
  idempotencyKey?: string;
  token?: string;
}

// ---------------------------------------------------------------------------
// Katalog dummy: path endpoint -> file {request, response} di src/data/dummy.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-require-imports */
const DUMMY: Record<string, unknown> = {
  'pos/install': require('../data/dummy/install/pos-install.json') as unknown,
  'main/validate-terminal': require('../data/dummy/install/main-validate-terminal.json') as unknown,
  'main/check-branch-status': require('../data/dummy/install/main-check-branch-status.json') as unknown,
  'pos/create-pin': require('../data/dummy/install/pos-create-pin.json') as unknown,
  'esb/employee/validate': require('../data/dummy/install/esb-employee-validate.json') as unknown,
  'esb/employee/update-pin': require('../data/dummy/install/esb-employee-update-pin.json') as unknown,
  'employee-attendance/clock-in': require('../data/dummy/install/employee-attendance-clock-in.json') as unknown,
  'employee-attendance/clock-out': require('../data/dummy/install/employee-attendance-clock-out.json') as unknown,
  'main/get-branch-settings': require('../data/dummy/pull/main-get-branch-settings.json') as unknown,
  'main/get-menu': require('../data/dummy/pull/main-get-menu.json') as unknown,
  'main/get-branch-menu': require('../data/dummy/pull/main-get-branch-menu.json') as unknown,
  'main/get-user': require('../data/dummy/pull/main-get-user.json') as unknown,
  'main/get-table': require('../data/dummy/pull/main-get-table.json') as unknown,
  'main/get-promotion': require('../data/dummy/pull/main-get-promotion.json') as unknown,
  'main/get-voucher': require('../data/dummy/pull/main-get-voucher.json') as unknown,
  'main/get-member': require('../data/dummy/pull/main-get-member.json') as unknown,
  'main/get-sales': require('../data/dummy/pull/main-get-sales.json') as unknown,
  // REA-18: path tebakan diganti padanan APK (lihat ApiPath).
  'v1/pull/get-menu-online': require('../data/dummy/pull/v1-pull-get-menu-online.json') as unknown,
  'v1/pull/expense-chart-of-accounts': require('../data/dummy/pull/v1-pull-expense-chart-of-accounts.json') as unknown,
  'esb_api/pull/pull-pos-version': require('../data/dummy/pull/esb-api-pull-pull-pos-version.json') as unknown,
  'esb_api/pull/pull-station-data': require('../data/dummy/pull/esb-api-pull-pull-station-data.json') as unknown,
  'esb_api/pull/pull-terminal-settings': require('../data/dummy/pull/esb-api-pull-pull-terminal-settings.json') as unknown,
  'esb_api/main/get-shift-log-data': require('../data/dummy/pull/esb-api-main-get-shift-log-data.json') as unknown,
  'esb_apiv11/main/get-terminal-settings': require('../data/dummy/pull/esb-apiv11-main-get-terminal-settings.json') as unknown,
  'esb_apiv9/terminal/verification-notify': require('../data/dummy/pull/esb-apiv9-terminal-verification-notify.json') as unknown,
  'main/get-payment-method': require('../data/dummy/pull/main-get-payment-method.json') as unknown,
  'terminal/get-terminal': require('../data/dummy/pull/terminal-get-terminal.json') as unknown,
  'terminal/update': require('../data/dummy/pull/terminal-update.json') as unknown,
  'order/finish': require('../data/dummy/push/order-finish.json') as unknown,
  // PAY-03: alias varian action-flag POST order/finish (kontrak §5.1.1).
  // Real Mode tetap POST ke 'order/finish' + body.action; alias ini agar
  // Dummy Mode bisa melayani tiap varian langsung via apiFetch.
  'order/void': require('../data/dummy/push/order-void.json') as unknown,
  'order/change-payment': require('../data/dummy/push/order-change-payment.json') as unknown,
  'order/split-bill': require('../data/dummy/push/order-split-bill.json') as unknown,
  'order/move-items': require('../data/dummy/push/order-move-items.json') as unknown,
  'order/move-table': require('../data/dummy/push/order-move-table.json') as unknown,
  'order/view': require('../data/dummy/push/order-view.json') as unknown,
  'posv1/order/view-by-qr': require('../data/dummy/push/posv1-order-view-by-qr.json') as unknown,
  'posv1/order/view-quick-service': require('../data/dummy/push/posv1-order-view-quick-service.json') as unknown,
  'posv1/order/pos-error-log': require('../data/dummy/push/posv1-order-pos-error-log.json') as unknown,
  // REA-18: satu path v1/push/shift untuk buka + tutup (beda body.op).
  'v1/push/shift': require('../data/dummy/push/v1-push-shift.json') as unknown,
  'v1/push/branch-expenses': require('../data/dummy/push/v1-push-branch-expenses.json') as unknown,
  'erp/member': require('../data/dummy/push/erp-member.json') as unknown,
  'erp/member/balance-deposit': require('../data/dummy/push/erp-member-balance-deposit.json') as unknown,
  'erp/member/deposit': require('../data/dummy/push/erp-member-deposit.json') as unknown,
  'erp/member/sales': require('../data/dummy/push/erp-member-sales.json') as unknown,
  'erp/ezo-delivery/approve': require('../data/dummy/push/erp-ezo-delivery-approve.json') as unknown,
  'erp/ezo-delivery/create-booking': require('../data/dummy/push/erp-ezo-delivery-create-booking.json') as unknown,
  'erp/ezo-delivery/finish-by-outlet': require('../data/dummy/push/erp-ezo-delivery-finish-by-outlet.json') as unknown,
  'erp/ezo-delivery/push-data': require('../data/dummy/push/erp-ezo-delivery-push-data.json') as unknown,
  'erp/ezo-delivery/schedule-order': require('../data/dummy/push/erp-ezo-delivery-schedule-order.json') as unknown,
  'erp/ezo-delivery/search-ongoing': require('../data/dummy/push/erp-ezo-delivery-search-ongoing.json') as unknown,
  'erp/ezo-delivery/search-outstanding': require('../data/dummy/push/erp-ezo-delivery-search-outstanding.json') as unknown,
  'member-deposit-withdrawal/inquiry-deposit': require('../data/dummy/push/member-deposit-withdrawal-inquiry-deposit.json') as unknown,
  'member-deposit-withdrawal/topup': require('../data/dummy/push/member-deposit-withdrawal-topup.json') as unknown,
  'sales/receipt-email': require('../data/dummy/push/sales-receipt-email.json') as unknown,
  'posv1/esb-voucher/validate': require('../data/dummy/push/posv1-esb-voucher-validate.json') as unknown,
  'posv1/esb-voucher/lock': require('../data/dummy/push/posv1-esb-voucher-lock.json') as unknown,
  'posv1/esb-voucher/unlock': require('../data/dummy/push/posv1-esb-voucher-unlock.json') as unknown,
  'posv1/esb-voucher/burn': require('../data/dummy/push/posv1-esb-voucher-burn.json') as unknown,
  'esb_api/external-voucher/validate': require('../data/dummy/push/esb-api-external-voucher-validate.json') as unknown,
  'esb_api/external-voucher/burn': require('../data/dummy/push/esb-api-external-voucher-burn.json') as unknown,
  'esb_api/external-voucher/unburn': require('../data/dummy/push/esb-api-external-voucher-unburn.json') as unknown,
  'esb_api/voucher/validate-online-voucher-pos-payment': require('../data/dummy/push/esb-api-voucher-validate-online-voucher-pos-payment.json') as unknown,
  'esb_api/voucher/claim-online-voucher-pos-payment': require('../data/dummy/push/esb-api-voucher-claim-online-voucher-pos-payment.json') as unknown,
  'esb_api/voucher/claim-voucher-template': require('../data/dummy/push/esb-api-voucher-claim-voucher-template.json') as unknown,
  'auth/cashier-login': require('../data/dummy/push/auth-cashier-login.json') as unknown,
  'auth/supervisor-approve': require('../data/dummy/push/auth-supervisor-approve.json') as unknown,
  'device/register-push': require('../data/dummy/push/device-register-push.json') as unknown,
  'esb/update/pos-lite-minimum-version-v2': require('../data/dummy/ota/pos-lite-minimum-version-v2.json') as unknown,
};
/* eslint-enable @typescript-eslint/no-require-imports */

function normPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Ambil bagian `response` dari file dummy; null bila path tak dikenal. */
function dummyResponse(path: string): { found: boolean; body: unknown } {
  const file = DUMMY[normPath(path)] as { response?: unknown } | undefined;
  if (!file || file.response === undefined) {
    return {
      found: false,
      body: {
        name: 'Not Found',
        message: 'Endpoint belum punya dummy JSON.',
        code: 'E422',
        status: 404,
        success: false,
        data: {},
      },
    };
  }
  return { found: true, body: file.response };
}

/**
 * Panggil endpoint lewat backend asli (Real Mode), JSON dummy lokal
 * (Dummy Mode eksplisit), atau tanpa sumber data sama sekali (Local Mode).
 *
 * - Local Mode: TIDAK dial network, TIDAK layani JSON dummy. Selalu
 *   resolve { ok:false, status:0, data:null, fromDummy:false } agar layar
 *   memakai jalur SQLite lokal + empty-state jujur (tanpa dummy yang
 *   mengotori cache/seed).
 * - Real Mode: coba backend asli; bila fetch gagal/offline, jatuh kembali
 *   ke JSON dummy lokal (fromDummy:true) agar kasir tetap jalan.
 * - Dummy Mode: layani langsung dari JSON dummy lokal.
 *
 * Selalu resolve, tidak melempar untuk kasus dummy/local; hanya melempar
 * bila Real Mode gagal total dan dummy pun tak tersedia (tak terjadi untuk
 * path terkatalog).
 */
export async function apiFetch<T = unknown>(
  path: string,
  opts?: FetchOpts,
): Promise<ApiResult<T>> {
  const mode = getApiMode();
  if (mode === 'local') {
    // Tanpa server: tanpa network, tanpa dummy. Layar sudah punya jalur
    // SQLite + empty-state; pemanggil yang butuh cache wajib cek fromDummy
    // / ok:false dan melewati penulisan ke SQLite.
    return { ok: false, status: 0, data: null as T, fromDummy: false };
  }
  const method = opts?.method ?? 'POST';
  if (mode === 'real') {
    try {
      const res =
        method === 'GET'
          ? await apiGet(path, opts?.params, { token: opts?.token, idempotencyKey: opts?.idempotencyKey })
          : await apiPost(path, opts?.body ?? {}, {
              idempotencyKey: opts?.idempotencyKey,
              token: opts?.token,
            });
      const body = (await res.json()) as T;
      if (!res.ok) {
        // Backend menjawab error: teruskan apa adanya (bukan dummy).
        return { ok: false, status: res.status, data: body, fromDummy: false };
      }
      return { ok: true, status: res.status, data: body, fromDummy: false };
    } catch {
      // Jaringan gagal / offline: jatuh ke dummy lokal agar kasir jalan.
    }
  }
  const d = dummyResponse(path);
  return {
    ok: d.found,
    status: d.found ? 200 : 404,
    data: d.body as T,
    fromDummy: true,
  };
}

/** Kupas envelope Yii2 {success,data}; loloskan body non-envelope (mis. OTA). */
export function unwrap<T = Record<string, unknown>>(body: unknown): {
  success: boolean;
  data: T;
} {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    const b = body as { data?: T; success?: boolean };
    return { success: b.success !== false, data: (b.data ?? {}) as T };
  }
  return { success: true, data: body as T };
}

// ---------------------------------------------------------------------------
// Device ID stabil 16-hex untuk kontrak install ({deviceID}).
// ---------------------------------------------------------------------------

const LS_DEVICE = 'genfity.device.id';

/** Ambil atau buat deviceID 16-hex persisten (dipakai body install). */
export async function getDeviceId(): Promise<string> {
  try {
    const cur = await getItem(LS_DEVICE);
    if (cur && /^[0-9a-f]{16}$/.test(cur)) return cur;
    // CSPRNG (Q7): identitas device mengikat triple-bind grant Q6 — tak boleh
    // dari Math.random, dan tak boleh konstanta sama untuk semua device gagal.
    const id = randomHexCsprng(16);
    await setItem(LS_DEVICE, id);
    return id;
  } catch {
    // Storage gagal total: kembalikan id sesi ini (unik, tak dipersist) agar
    // dua device tak pernah berbagi identitas yang sama.
    return randomHexCsprng(16);
  }
}

// ---------------------------------------------------------------------------
// Helper install (dipakai layar install/*): selalu lewat apiFetch.
// ---------------------------------------------------------------------------

export interface ValidateTerminalResult {
  valid: boolean;
  branchId: string;
  branchName: string;
  fromDummy: boolean;
}

/** Klaim terminal via ApiPath.validateTerminal; echo kode yang diminta. */
export async function validateTerminal(
  terminalCode: string,
): Promise<ValidateTerminalResult> {
  const deviceID = await getDeviceId();
  const r = await apiFetch(ApiPath.validateTerminal, {
    body: { terminalCode, deviceID },
  });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return {
    valid: (data as { valid?: boolean }).valid === true,
    branchId: String((data as { branchId?: unknown }).branchId ?? ''),
    branchName: String((data as { branchName?: unknown }).branchName ?? ''),
    fromDummy: r.fromDummy,
  };
}

export interface CheckBranchResult {
  status: string;
  branchId: string;
  branchName: string;
  fromDummy: boolean;
}

/** Cek status cabang via ApiPath.checkBranch (active/inactive/expired). */
export async function checkBranch(branchId: string): Promise<CheckBranchResult> {
  const r = await apiFetch(ApiPath.checkBranch, { body: { branchId } });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const d = data as { status?: unknown; branchId?: unknown; branchName?: unknown };
  return {
    status: String(d.status ?? ''),
    branchId: String(d.branchId ?? branchId),
    branchName: String(d.branchName ?? ''),
    fromDummy: r.fromDummy,
  };
}

/** Buat PIN via ApiPath.createPin (PIN dikirim sekali, tak disimpan). */
export async function createPinOnServer(
  userId: string,
  pin: string,
): Promise<{ ok: boolean; fromDummy: boolean }> {
  const deviceID = await getDeviceId();
  const r = await apiFetch(ApiPath.createPin, {
    body: { userId, pin, deviceID },
  });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return {
    ok: (data as { ok?: boolean }).ok === true,
    fromDummy: r.fromDummy,
  };
}

/**
 * Ganti PIN via `esb/employee/update-pin` (kontrak §3.4). PIN dikirim sekali
 * saat online; offline pemanggil mengantrekan via sync (server sumber akhir).
 */
export async function updatePinOnServer(
  userId: string,
  oldPin: string,
  newPin: string,
): Promise<{ ok: boolean; fromDummy: boolean }> {
  const deviceID = await getDeviceId();
  const r = await apiFetch('esb/employee/update-pin', {
    body: { userId, oldPin, newPin, deviceID },
  });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return {
    ok: (data as { ok?: boolean }).ok === true,
    fromDummy: r.fromDummy,
  };
}

export interface VoucherCheck {
  ok: boolean;
  amount: number;
  minSpend: number;
  fromDummy: boolean;
  /** Kind kanonis: 'Ongkir' untuk potongan ongkir, ''/lain untuk diskon belanja. */
  kind: string;
  /** Persen 0-100 bila promo percent (untuk hitung kanonis di Pay). */
  rate?: number;
  /** Cap nominal (Rp) promo percent / flat bila ada. */
  maxAmount?: number;
}

/**
 * Validasi kode voucher/tender ke server (kontrak §5.2 validate
 * {code, grandTotal} → {valid, amount, minSpend}). Dipakai PayScreen sebelum
 * voucher dipasang / tender diterima - tidak ada kode yang lolos tanpa
 * validasi. Dummy Mode memakai JSON lokal; Real Mode ke backend asli.
 */
interface LocalVoucherRow {
  amount: number | null;
  quota: number | null;
  validFrom: string | null;
  validTo: string | null;
  status: string | null;
}

interface LocalPromoRow {
  promoType: string | null;
  value: number | null;
  maxAmount: number | null;
  minSpend: number | null;
  validFrom: string | null;
  validTo: string | null;
  flagActive: number | null;
}

/**
 * Validasi voucher ke ms_voucher lokal (seed/pull): kode cocok (case-insensitive),
 * status 'available', kuota > 0, dan dalam jendela validitas — lalu fallback
 * ke ms_promotion (flagActive=1 + jendela + value>0; persen = sebesar cap,
 * selaras PromotionList). Dipakai bila server tak menjawab (local mode /
 * offline / fallback dummy) agar voucher tetap bisa dipakai offline-first —
 * bukan fixture dummy.
 */
async function validateVoucherCodeLocal(
  code: string,
  grandTotal: number,
): Promise<VoucherCheck> {
  const nope: VoucherCheck = { ok: false, amount: 0, minSpend: 0, fromDummy: false, kind: '' };
  const clean = (code ?? '').trim().toUpperCase();
  if (!clean || !(grandTotal > 0)) return nope;
  const inferKind = (promoType: string | null, fallbackCode: string): string => {
    const pt = String(promoType ?? '').toLowerCase();
    if (pt.includes('ongkir')) return 'Ongkir';
    if (fallbackCode === 'GRATISONGKIR' || fallbackCode.includes('ONGKIR')) return 'Ongkir';
    return '';
  };
  try {
    await initDb();
    const row = await queryFirst<LocalVoucherRow>(
      `SELECT amount, quota, validFrom, validTo, status FROM ms_voucher
        WHERE UPPER(voucherCode) = ? LIMIT 1`,
      [clean],
    );
    if (!row) {
      // Bukan voucher kuota: coba promo reusable (cermin saveSale backstop).
      const now = dbNowLocal();
      const promo = await queryFirst<LocalPromoRow>(
        `SELECT promoType, value, maxAmount, minSpend, validFrom, validTo, flagActive
         FROM ms_promotion WHERE UPPER(promoCode) = ? LIMIT 1`,
        [clean],
      );
      if (!promo || Number(promo.flagActive ?? 0) !== 1) return nope;
      if (promo.validFrom && promo.validFrom > now) return nope;
      if (promo.validTo && promo.validTo < now) return nope;
      const pType = String(promo.promoType ?? 'nominal').toLowerCase();
      const pValue = Math.max(0, Math.round(Number(promo.value) || 0));
      const pCap = Math.max(0, Math.round(Number(promo.maxAmount ?? pValue) || 0));
      const pMin = Math.max(0, Math.round(Number(promo.minSpend) || 0));
      // Gate minSpend dulu (gross = grandTotal pemanggil): gagal = tolak.
      if (pMin > 0 && Math.round(grandTotal) < pMin) {
        return { ok: false, amount: 0, minSpend: pMin, fromDummy: false, kind: '' };
      }
      const kind = inferKind(promo.promoType, clean);
      if (pType === 'percent') {
        // Persen kanonis atas grandTotal pemanggil, dibatasi cap (selaras
        // totals(): round(dasar*pct/100) capped; di sini dasar ≈ grandTotal
        // karena Pay hanya punya total resmi, bukan gross item).
        const pct = Math.min(100, Math.max(0, pValue));
        if (pct <= 0 || pCap <= 0) return nope;
        const amt = Math.min(Math.round((Math.round(grandTotal) * pct) / 100), pCap);
        if (amt <= 0) return nope;
        return { ok: true, amount: amt, minSpend: pMin, fromDummy: false, kind, rate: pct, maxAmount: pCap };
      }
      if (pType === 'ongkir') {
        if (pValue <= 0) return nope;
        return { ok: true, amount: pValue, minSpend: pMin, fromDummy: false, kind: 'Ongkir', maxAmount: pCap > 0 ? pCap : pValue };
      }
      if (pValue <= 0) return nope;
      return { ok: true, amount: pValue, minSpend: pMin, fromDummy: false, kind, maxAmount: pCap > 0 ? pCap : undefined };
    }
    if ((row.status ?? '').toLowerCase() !== 'available') return nope;
    if (Math.round(Number(row.quota) || 0) <= 0) return nope;
    const now = dbNowLocal();
    if (row.validFrom && row.validFrom > now) return nope;
    if (row.validTo && row.validTo < now) return nope;
    const amount = Math.round(Number(row.amount) || 0);
    if (amount <= 0) return nope;
    return { ok: true, amount, minSpend: 0, fromDummy: false, kind: inferKind(null, clean) };
  } catch {
    return nope;
  }
}

export async function validateVoucherCode(
  code: string,
  grandTotal: number,
): Promise<VoucherCheck> {
  const r = await apiFetch(ApiPath.voucherValidate, {
    body: { code, grandTotal: Math.round(grandTotal) },
  });
  // Server menang hanya bila benar-benar menjawab (bukan fixture dummy:
  // jaringan real-mode yang gagal JANGAN divalidasi pakai voucher dummy).
  if (r.ok && !r.fromDummy) {
    const { data } = unwrap<Record<string, unknown>>(r.data);
    const d = data as { valid?: unknown; amount?: unknown; minSpend?: unknown; kind?: unknown; promoType?: unknown; rate?: unknown; maxAmount?: unknown };
    const amount = Math.round(Number(d.amount ?? 0)) || 0;
    const minSpend = Math.round(Number(d.minSpend ?? 0)) || 0;
    const rawKind = String((d.kind ?? d.promoType) ?? '').trim();
    const clean = String(code ?? '').trim().toUpperCase();
    const kind =
      rawKind.toLowerCase().includes('ongkir') || clean === 'GRATISONGKIR' || clean.includes('ONGKIR')
        ? 'Ongkir'
        : rawKind;
    const rateRaw = Number(d.rate);
    const capRaw = Number(d.maxAmount);
    return {
      ok: d.valid === true && amount > 0,
      amount,
      minSpend,
      fromDummy: r.fromDummy,
      kind,
      ...(Number.isFinite(rateRaw) && rateRaw > 0 ? { rate: Math.min(100, rateRaw) } : {}),
      ...(Number.isFinite(capRaw) && capRaw > 0 ? { maxAmount: Math.round(capRaw) } : {}),
    };
  }
  return validateVoucherCodeLocal(code, grandTotal);
}

export interface EmployeeSession {
  ok: boolean;
  userId: string;
  nama: string;
  authKey: string;
  role: string;
  fromDummy: boolean;
}

interface LocalPosUserRow {
  id: string;
  username: string | null;
  pinHash: string | null;
  password: string | null;
  authKey: string | null;
  branchId: string | null;
  role: string | null;
}

/**
 * Cek kredensial ke SQLite lokal (ms_posuser by username COLLATE NOCASE +
 * hash PIN via lib/pin, fallback perbandingan legacy pinHash/password
 * untuk baris hasil pull yang belum punya record).
 * - Cocok → EmployeeSession ok:true (bentuk SAMA seperti jalur online).
 * - Username ada tapi PIN salah → EmployeeSession ok:false (JANGAN throw:
 *   pemanggil LoginScreen.submit tidak try/catch, hanya cek s.ok/userId).
 * - Username tidak ada di lokal → null (pemanggil yang memutuskan: Real Mode
 *   teruskan ke server, Dummy Mode kembalikan gagal).
 */
async function validateEmployeeLocal(
  username: string,
  pin: string,
): Promise<EmployeeSession | null> {
  const uname = (username ?? '').trim();
  await initDb();
  const row = await queryFirst<LocalPosUserRow>(
    'SELECT id, username, pinHash, password, authKey, branchId, role FROM ms_posuser WHERE username = ? COLLATE NOCASE LIMIT 1',
    [uname],
  );
  if (!row) return null;
  let match = false;
  try {
    const rec = await loadPinRecord(row.id);
    if (rec && verifyPinHash(pin, rec)) match = true;
  } catch {
    /* lanjut ke fallback legacy di bawah */
  }
  if (!match && (row.pinHash === pin || row.password === pin)) match = true;
  if (!match) {
    return {
      ok: false,
      userId: '',
      nama: '',
      authKey: '',
      role: '',
      fromDummy: false,
    };
  }
  return {
    ok: true,
    userId: row.id,
    // ms_posuser tidak punya kolom nama - pakai username lokal.
    nama: row.username ?? uname,
    authKey: row.authKey ?? `local-${row.id}`,
    role: row.role ?? '',
    fromDummy: false,
  };
}

/**
 * Login LOCAL-FIRST di semua mode (kontrak §3.4 esb/employee/validate).
 * Selalu cek SQLite lokal dulu via validateEmployeeLocal:
 * - User lokal cocok / PIN salah → kembalikan hasilnya langsung (tidak
 *   throw; LoginScreen.submit hanya cek s.ok/userId lalu toast login_fail,
 *   tanpa try/catch di sekeliling await).
 * - Username tidak ada di lokal DAN Real Mode → teruskan ke server.
 * - Username tidak ada di lokal DAN Dummy Mode → gagal (jangan dummy Gista).
 */
export async function validateEmployee(
  username: string,
  pin: string,
): Promise<EmployeeSession> {
  let local: EmployeeSession | null = null;
  try {
    local = await validateEmployeeLocal(username, pin);
  } catch {
    local = null;
  }
  if (local) return local;
  if (getApiMode() !== 'real') {
    return {
      ok: false,
      userId: '',
      nama: '',
      authKey: '',
      role: '',
      fromDummy: true,
    };
  }
  const r = await apiFetch('esb/employee/validate', {
    body: { username, pin },
  });
  if (r.fromDummy) {
    // Fetch gagal/offline padahal base URL terisi, dan user juga tidak ada
    // di lokal (cek di atas) → gagal, bukan dummy. JANGAN throw.
    return {
      ok: false,
      userId: '',
      nama: '',
      authKey: '',
      role: '',
      fromDummy: true,
    };
  }
  const { success, data } = unwrap<Record<string, unknown>>(r.data);
  const d = data as {
    userId?: unknown;
    nama?: unknown;
    authKey?: unknown;
    role?: unknown;
  };
  return {
    ok: success && !!d.userId,
    userId: String(d.userId ?? ''),
    nama: String(d.nama ?? ''),
    authKey: String(d.authKey ?? ''),
    role: String(d.role ?? ''),
    fromDummy: r.fromDummy,
  };
}

export interface QrLoginPayload {
  username: string;
  pin: string;
  terminalId?: string;
}

/**
 * Urai isi QR login dari BE: JSON {username/user, pin/password}
 * (+terminalId opsional). Null bila bukan QR login yang dikenal.
 */
export function parseQrLoginPayload(raw: string): QrLoginPayload | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const username = String(o.username ?? o.user ?? '').trim();
    const pin = String(o.pin ?? o.password ?? o.passcode ?? '');
    const terminalId = String(o.terminalId ?? o.terminal ?? '').trim();
    if (!username || !pin) return null;
    return { username, pin, ...(terminalId ? { terminalId } : {}) };
  } catch {
    return null;
  }
}

/**
 * Login kasir via QR dari BE (kontrak auth/cashier-login): kirim kredensial
 * hasil pindaian apa adanya, server yang memutuskan (jangan login lokal saja).
 * Fail-closed di luar Real Mode: tanpa server, QR tak bisa divalidasi siapa
 * pun (local: unwrap(null) akan melempar; dummy: fixture bukan identitas
 * nyata) sehingga tolak dengan ok:false.
 */
export async function loginByQrCode(p: QrLoginPayload): Promise<EmployeeSession> {
  if (getApiMode() !== 'real') {
    return { ok: false, userId: '', nama: '', authKey: '', role: '', fromDummy: false };
  }
  const r = await apiFetch(ApiPath.cashierLogin, {
    body: { username: p.username, pin: p.pin, ...(p.terminalId ? { terminalId: p.terminalId } : {}) },
  });
  // F5: disiplin fail-closed ala validateEmployee — dummy/offline tak pernah
  // sukses; tolak SEBELUM unwrap (unwrap(null) lokal / fixture dummy bukan identitas nyata).
  if (!r.ok || r.fromDummy) {
    return { ok: false, userId: '', nama: '', authKey: '', role: '', fromDummy: r.fromDummy };
  }
  const { success, data } = unwrap<Record<string, unknown>>(r.data);
  const d = data as {
    userId?: unknown;
    nama?: unknown;
    authKey?: unknown;
    role?: unknown;
  };
  return {
    ok: success && !!d.userId,
    userId: String(d.userId ?? ''),
    nama: String(d.nama ?? ''),
    authKey: String(d.authKey ?? ''),
    role: String(d.role ?? ''),
    fromDummy: r.fromDummy,
  };
}

/** Info terminal tersimpan (untuk header debug layar install). */
export function describeSource(): string {
  const t = getTerminal();
  const mode = getApiMode();
  const who = t.terminalCode || 'tanpa-terminal';
  return `${mode}:${who}`;
}

// ---------------------------------------------------------------------------
// Helper REA-FIX-A: voucher online + eksternal, versi POS, verify terminal,
// delivery EZO, member ERP. Dipakai pemilik layar (VoucherScreen, EsbOrder,
// Member, Shift) - kontrak di docs/API-CONTRACT.md §4.1/§5.3/§5.5/§5.6.
// ---------------------------------------------------------------------------

export interface OnlineVoucherCheck {
  ok: boolean;
  amount: number;
  minSpend: number;
  fromDummy: boolean;
}

/** Validasi voucher online (REA-7) {code, grandTotal} → {valid, amount}. */
export async function validateOnlineVoucher(
  code: string,
  grandTotal: number,
): Promise<OnlineVoucherCheck> {
  const r = await apiFetch(ApiPath.voucherOnlineValidate, {
    body: { code, grandTotal: Math.round(grandTotal) },
  });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const d = data as { valid?: unknown; amount?: unknown; minSpend?: unknown };
  const amount = Math.round(Number(d.amount ?? 0)) || 0;
  return {
    ok: d.valid === true && amount > 0,
    amount,
    minSpend: Math.round(Number(d.minSpend ?? 0)) || 0,
    fromDummy: r.fromDummy,
  };
}

export interface OnlineVoucherClaim {
  ok: boolean;
  amount: number;
  fromDummy: boolean;
}

/** Klaim voucher online ke transaksi berjalan (REA-7). */
export async function claimOnlineVoucher(
  code: string,
  salesNum: string,
): Promise<OnlineVoucherClaim> {
  const r = await apiFetch(ApiPath.voucherOnlineClaim, {
    body: { code, salesNum },
  });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const d = data as { claimed?: unknown; amount?: unknown };
  const amount = Math.round(Number(d.amount ?? 0)) || 0;
  return { ok: d.claimed === true, amount, fromDummy: r.fromDummy };
}

export type ExtVoucherOp = 'validate' | 'burn' | 'unburn';

const EXT_VOUCHER_PATH: Record<ExtVoucherOp, string> = {
  validate: ApiPath.extVoucherValidate,
  burn: ApiPath.extVoucherBurn,
  unburn: ApiPath.extVoucherUnburn,
};

export interface ExtVoucherResult {
  ok: boolean;
  amount: number;
  fromDummy: boolean;
}

/**
 * Voucher eksternal (REA-6): validate → {valid, amount},
 * burn → {burned}, unburn → {unburned}.
 */
export async function externalVoucher(
  op: ExtVoucherOp,
  code: string,
  salesNum?: string,
): Promise<ExtVoucherResult> {
  const r = await apiFetch(EXT_VOUCHER_PATH[op], {
    body: salesNum ? { code, salesNum } : { code },
  });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const d = data as {
    valid?: unknown;
    burned?: unknown;
    unburned?: unknown;
    amount?: unknown;
  };
  const ok =
    op === 'burn' ? d.burned === true
    : op === 'unburn' ? d.unburned === true
    : d.valid === true;
  return {
    ok,
    amount: Math.round(Number(d.amount ?? 0)) || 0,
    fromDummy: r.fromDummy,
  };
}

export interface PosVersionInfo {
  minVersion: number;
  latestVersion: number;
  fromDummy: boolean;
}

/** Versi POS dari server (REA-12 pull-pos-version). */
export async function fetchPosVersion(): Promise<PosVersionInfo> {
  const t = getTerminal();
  const r = await apiFetch(ApiPath.pullPosVersion, {
    body: { branchId: t.branchId, terminalId: t.terminalCode, platform: 'android' },
  });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const d = data as { minVersion?: unknown; latestVersion?: unknown };
  return {
    minVersion: Math.round(Number(d.minVersion ?? 0)) || 0,
    latestVersion: Math.round(Number(d.latestVersion ?? 0)) || 0,
    fromDummy: r.fromDummy,
  };
}

/** Notifikasi verifikasi terminal (REA-9). */
export async function notifyTerminalVerification(
  status: string,
): Promise<{ ok: boolean; fromDummy: boolean }> {
  const t = getTerminal();
  const deviceID = await getDeviceId();
  const r = await apiFetch(ApiPath.terminalVerifyNotify, {
    body: { terminalCode: t.terminalCode, branchId: t.branchId, deviceID, status },
  });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return { ok: (data as { ok?: boolean }).ok === true, fromDummy: r.fromDummy };
}

export type DeliveryOp =
  | 'approve'
  | 'create-booking'
  | 'finish-by-outlet'
  | 'push-data'
  | 'schedule-order'
  | 'search-ongoing'
  | 'search-outstanding';

const DELIVERY_PATH: Record<DeliveryOp, string> = {
  approve: ApiPath.deliveryApprove,
  'create-booking': ApiPath.deliveryCreateBooking,
  'finish-by-outlet': ApiPath.deliveryFinishByOutlet,
  'push-data': ApiPath.deliveryPushData,
  'schedule-order': ApiPath.deliveryScheduleOrder,
  'search-ongoing': ApiPath.deliverySearchOngoing,
  'search-outstanding': ApiPath.deliverySearchOutstanding,
};

/**
 * Delivery EZO (REA-2, kontrak §5.6). TODO(pemilik layar EsbOrder): panggil
 * dari dashboard delivery saat UI batch lain siap.
 */
export async function deliveryApi<T = Record<string, unknown>>(
  op: DeliveryOp,
  body: Record<string, unknown>,
): Promise<ApiResult<T>> {
  return apiFetch<T>(DELIVERY_PATH[op], { body });
}

export type MemberErpOp = 'balance-deposit' | 'deposit' | 'sales';

const MEMBER_ERP_PATH: Record<MemberErpOp, string> = {
  'balance-deposit': ApiPath.memberErpBalance,
  'deposit': ApiPath.memberErpDeposit,
  'sales': ApiPath.memberErpSales,
};

/**
 * Member via erp/member/* (REA-3, kontrak §5.5).
 * TODO(pemilik layar Member): alihkan inquiry/topup/register ke helper ini.
 */
export async function memberErpApi<T = Record<string, unknown>>(
  op: MemberErpOp,
  body: Record<string, unknown>,
): Promise<ApiResult<T>> {
  return apiFetch<T>(MEMBER_ERP_PATH[op], { body });
}
