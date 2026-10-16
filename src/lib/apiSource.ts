/**
 * Pemilih sumber data API: Dummy Mode vs Backend asli (satu titik wiring).
 *
 * - Bila EXPO_PUBLIC_API_BASE_URL kosong (default) -> Dummy Mode: semua
 *   request dilayani dari JSON lokal di src/data/dummy (offline-first,
 *   tanpa dial ke server pihak ketiga mana pun).
 * - Bila EXPO_PUBLIC_API_BASE_URL terisi URL backend sendiri -> Real Mode:
 *   request memakai apiGet/apiPost (header X-Terminal-Code/X-Branch-Id/
 *   Idempotency-Key/Bearer ala src/config/server.ts). Bila fetch gagal atau
 *   offline, otomatis jatuh kembali ke JSON dummy lokal.
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

export type ApiMode = 'dummy' | 'real';

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

/** Mode aktif saat ini: dummy bila env kosong, real bila env terisi. */
export function getApiMode(): ApiMode {
  return readEnvBaseUrl() ? 'real' : 'dummy';
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
  'main/get-expense-chart-of-accounts': require('../data/dummy/pull/main-get-expense-chart-of-accounts.json') as unknown,
  'main/get-menu-online': require('../data/dummy/pull/main-get-menu-online.json') as unknown,
  'esb_api/pull/pos-version': require('../data/dummy/pull/esb-api-pull-pos-version.json') as unknown,
  'main/get-payment-method': require('../data/dummy/pull/main-get-payment-method.json') as unknown,
  'main/get-station': require('../data/dummy/pull/main-get-station.json') as unknown,
  'terminal/get-terminal': require('../data/dummy/pull/terminal-get-terminal.json') as unknown,
  'terminal/update': require('../data/dummy/pull/terminal-update.json') as unknown,
  'order/finish': require('../data/dummy/push/order-finish.json') as unknown,
  'order/split-bill': require('../data/dummy/push/order-split-bill.json') as unknown,
  'order/move-items': require('../data/dummy/push/order-move-items.json') as unknown,
  'order/move-table': require('../data/dummy/push/order-move-table.json') as unknown,
  'order/view': require('../data/dummy/push/order-view.json') as unknown,
  'shift/open': require('../data/dummy/push/shift-open.json') as unknown,
  'shift/close': require('../data/dummy/push/shift-close.json') as unknown,
  'branch-expenses/push': require('../data/dummy/push/branch-expenses-push.json') as unknown,
  'member-deposit-withdrawal/inquiry-deposit': require('../data/dummy/push/member-deposit-withdrawal-inquiry-deposit.json') as unknown,
  'member-deposit-withdrawal/topup': require('../data/dummy/push/member-deposit-withdrawal-topup.json') as unknown,
  'sales/receipt-email': require('../data/dummy/push/sales-receipt-email.json') as unknown,
  'posv1/esb-voucher/validate': require('../data/dummy/push/posv1-esb-voucher-validate.json') as unknown,
  'posv1/esb-voucher/lock': require('../data/dummy/push/posv1-esb-voucher-lock.json') as unknown,
  'posv1/esb-voucher/unlock': require('../data/dummy/push/posv1-esb-voucher-unlock.json') as unknown,
  'posv1/esb-voucher/burn': require('../data/dummy/push/posv1-esb-voucher-burn.json') as unknown,
  'auth/cashier-login': require('../data/dummy/push/auth-cashier-login.json') as unknown,
  'auth/supervisor-approve': require('../data/dummy/push/auth-supervisor-approve.json') as unknown,
  'device/register-push': require('../data/dummy/push/device-register-push.json') as unknown,
  'member/register': require('../data/dummy/push/member-register.json') as unknown,
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
 * Panggil endpoint lewat backend asli (Real Mode) atau JSON dummy lokal
 * (Dummy Mode / fetch gagal / offline). Selalu resolve, tidak melempar
 * untuk kasus dummy; hanya melempar bila Real Mode gagal total dan dummy
 * pun tak tersedia (tak terjadi untuk path terkatalog).
 */
export async function apiFetch<T = unknown>(
  path: string,
  opts?: FetchOpts,
): Promise<ApiResult<T>> {
  const method = opts?.method ?? 'POST';
  if (getApiMode() === 'real') {
    try {
      const res =
        method === 'GET'
          ? await apiGet(path, opts?.params)
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
    let id = '';
    for (let i = 0; i < 16; i += 1) {
      id += Math.floor(Math.random() * 16).toString(16);
    }
    await setItem(LS_DEVICE, id);
    return id;
  } catch {
    return 'a91f3c07d2e84b5a';
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
}

/**
 * Validasi kode voucher/tender ke server (kontrak §5.2 validate
 * {code, grandTotal} → {valid, amount, minSpend}). Dipakai PayScreen sebelum
 * voucher dipasang / tender diterima - tidak ada kode yang lolos tanpa
 * validasi. Dummy Mode memakai JSON lokal; Real Mode ke backend asli.
 */
export async function validateVoucherCode(
  code: string,
  grandTotal: number,
): Promise<VoucherCheck> {
  const r = await apiFetch(ApiPath.voucherValidate, {
    body: { code, grandTotal: Math.round(grandTotal) },
  });
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const d = data as { valid?: unknown; amount?: unknown; minSpend?: unknown };
  const amount = Math.round(Number(d.amount ?? 0)) || 0;
  const minSpend = Math.round(Number(d.minSpend ?? 0)) || 0;
  return {
    ok: d.valid === true && amount > 0,
    amount,
    minSpend,
    fromDummy: r.fromDummy,
  };
}

export interface EmployeeSession {
  ok: boolean;
  userId: string;
  nama: string;
  authKey: string;
  role: string;
  fromDummy: boolean;
}

/**
 * Revalidasi PIN ke server (kontrak §3.4 esb/employee/validate).
 * Wajib dipakai untuk verifikasi login - jangan verifikasi PIN lokal saja.
 */
export async function validateEmployee(
  username: string,
  pin: string,
): Promise<EmployeeSession> {
  const r = await apiFetch('esb/employee/validate', {
    body: { username, pin },
  });
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
