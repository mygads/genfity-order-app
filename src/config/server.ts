/**
 * Konfigurasi server + terminal milik sendiri (clean-room).
 * Nama host/path di bawah adalah FAKTA hasil bedah string APK (REA),
 * dipakai sebagai default agar flow install/pull/push sama; base URL
 * bisa diganti ke server Anda kapan saja - kontrak JSON ikut server Anda.
 *
 * Persistensi memakai lib/storage.ts (AsyncStorage) agar work di web +
 * native. API modul ini tetap sinkron (kompatibel dengan layar yang sudah
 * memakainya): nilai di-cache di memori, dibaca/ditulis AsyncStorage secara
 * fire-and-forget, dan dimuat ulang di background saat pertama dipakai.
 */
import { getItem, setItem } from '../lib/storage';

export type ServerEnv = 'prod' | 'dev' | 'staging' | 'custom';

export const ENV_BASE_URL: Record<ServerEnv, string> = {
  prod: 'https://poslite.esb.co.id/api/web',
  dev: 'https://dev7.esb.co.id/api/web',
  staging: 'https://stg-core-lite.esb.co.id/api/web',
  custom: '',
};

export const WS_URL: Record<ServerEnv, string> = {
  prod: 'wss://ws-poslite.esb.co.id/ws',
  dev: 'wss://dev7.esb.co.id/wss-self-order',
  // REA-13: APK memakai /wss-self-order di semua env non-prod (staging lama
  // memakai /ws di stg-eso - diselaraskan ke APK).
  staging: 'wss://stg-eso.esb.co.id/wss-self-order',
  custom: '',
};

/** Path API (fakta dari string table APK - tanpa body JSON).
 *
 * Status tiap path (REA-18, dossier Lampiran F):
 * - [FAKTA] = literalnya ada di libapp.so.
 * - [asumsi-clean-room] = TIDAK ADA di APK; tebakan clean-room milik kita,
 *   didokumentasikan eksplisit di docs/API-CONTRACT.md.
 */
export const ApiPath = {
  validateTerminal: 'main/validate-terminal',
  getTerminal: 'terminal/get-terminal',
  updateTerminal: 'terminal/update',
  install: 'pos/install',
  createPin: 'pos/create-pin',
  checkBranch: 'main/check-branch-status',
  pullMenu: 'main/get-menu',
  pullBranchMenu: 'main/get-branch-menu',
  pullBranchSettings: 'main/get-branch-settings',
  // [FAKTA] APK: v1/pull/get-menu-online (REA-18: main/get-menu-online
  // adalah tebakan tanpa padanan).
  pullMenuOnline: 'v1/pull/get-menu-online',
  // [FAKTA] APK: v1/pull/expense-chart-of-accounts (REA-18).
  pullExpenseCoa: 'v1/pull/expense-chart-of-accounts',
  pullUser: 'main/get-user',
  // [asumsi-clean-room] TIDAK ADA di APK (REA-18): hak akses per user untuk
  // RBAC lokal (dipetakan ke ms_posuseraccess via master.ts 'useraccess').
  pullUserAccess: 'main/get-user-access',
  pullTable: 'main/get-table',
  pullPromotion: 'main/get-promotion',
  pullMember: 'main/get-member',
  pullVoucher: 'main/get-voucher',
  // [asumsi-clean-room] TIDAK ADA di APK (REA-18).
  pullPaymentMethod: 'main/get-payment-method',
  // [FAKTA] APK: esb_api/pull/pull-station-data (REA-12/REA-18).
  pullStation: 'esb_api/pull/pull-station-data',
  pullSales: 'main/get-sales',
  // [FAKTA] REA-11: tarik log shift dari server.
  pullShiftLog: 'esb_api/main/get-shift-log-data',
  // [FAKTA] REA-12: setting per terminal.
  pullTerminalSettings: 'esb_api/pull/pull-terminal-settings',
  // [FAKTA] REA-12: versi POS (nama konkret pull-pos-version).
  pullPosVersion: 'esb_api/pull/pull-pos-version',
  // [FAKTA] REA-8: spesimen grup v11.
  terminalSettingsV11: 'esb_apiv11/main/get-terminal-settings',
  // [FAKTA] REA-9: notifikasi verifikasi terminal.
  terminalVerifyNotify: 'esb_apiv9/terminal/verification-notify',
  pushOrderFinish: 'order/finish',
  pushOrderView: 'order/view',
  // [FAKTA] REA-10: varian order tambahan.
  orderViewByQr: 'posv1/order/view-by-qr',
  orderViewQuickService: 'posv1/order/view-quick-service',
  orderErrorLog: 'posv1/order/pos-error-log',
  splitBill: 'order/split-bill',
  moveItems: 'order/move-items',
  moveTable: 'order/move-table',
  // [FAKTA] APK: satu path v1/push/shift untuk buka + tutup (REA-18).
  // Dibedakan via body {op: 'shift-open' | 'shift-close'} (kontrak §5.2).
  pushShiftOpen: 'v1/push/shift',
  pushShiftClose: 'v1/push/shift',
  // [FAKTA] APK: v1/push/branch-expenses (REA-18).
  pushExpense: 'v1/push/branch-expenses',
  // [asumsi-clean-room] TIDAK ADA di APK (REA-18).
  pushRegister: 'device/register-push',
  receiptEmail: 'sales/receipt-email',
  voucherLock: 'posv1/esb-voucher/lock',
  voucherUnlock: 'posv1/esb-voucher/unlock',
  voucherValidate: 'posv1/esb-voucher/validate',
  voucherBurn: 'posv1/esb-voucher/burn',
  // [FAKTA] REA-6: voucher eksternal (burn/unburn/validate).
  extVoucherValidate: 'esb_api/external-voucher/validate',
  extVoucherBurn: 'esb_api/external-voucher/burn',
  extVoucherUnburn: 'esb_api/external-voucher/unburn',
  // [FAKTA] REA-7: voucher online + template.
  voucherOnlineValidate: 'esb_api/voucher/validate-online-voucher-pos-payment',
  voucherOnlineClaim: 'esb_api/voucher/claim-online-voucher-pos-payment',
  voucherTemplateClaim: 'esb_api/voucher/claim-voucher-template',
  clockIn: 'employee-attendance/clock-in',
  // [asumsi-clean-room] TIDAK ADA di APK (REA-18).
  supervisorApprove: 'auth/supervisor-approve',
  // [asumsi-clean-room] TIDAK ADA di APK (REA-18).
  cashierLogin: 'auth/cashier-login',
  clockOut: 'employee-attendance/clock-out',
  depositInquiry: 'member-deposit-withdrawal/inquiry-deposit',
  // [asumsi-clean-room] inquiry-deposit ADA di APK, topup nihil (REA-18).
  depositTopup: 'member-deposit-withdrawal/topup',
  // Dipetakan ke grup erp/member/* (REA-3: balance-deposit, deposit, sales).
  // Sub-path pasti untuk registrasi tak terverifikasi - pakai path dasar grup.
  // Lihat kontrak §5.5.
  registerMember: 'erp/member',
  // [FAKTA] REA-2: grup delivery erp/ezo-delivery (7 path).
  deliveryApprove: 'erp/ezo-delivery/approve',
  deliveryCreateBooking: 'erp/ezo-delivery/create-booking',
  deliveryFinishByOutlet: 'erp/ezo-delivery/finish-by-outlet',
  deliveryPushData: 'erp/ezo-delivery/push-data',
  deliveryScheduleOrder: 'erp/ezo-delivery/schedule-order',
  deliverySearchOngoing: 'erp/ezo-delivery/search-ongoing',
  deliverySearchOutstanding: 'erp/ezo-delivery/search-outstanding',
  // [FAKTA] REA-3: sub-path member erp/member/*.
  memberErpBalance: 'erp/member/balance-deposit',
  memberErpDeposit: 'erp/member/deposit',
  memberErpSales: 'erp/member/sales',
} as const;

export interface TerminalInfo {
  terminalCode: string;
  branchId: string;
  branchName: string;
}

const LS_ENV = 'genfity.server.env';
const LS_CUSTOM = 'genfity.server.custom';
const LS_TERMINAL = 'genfity.server.terminal';

let env: ServerEnv = 'prod';
let customUrl = '';
let terminal: TerminalInfo = { terminalCode: '', branchId: '', branchName: '' };
let hydrated = false;

function restore(): void {
  void getItem(LS_ENV).then((e) => {
    if (e === 'prod' || e === 'dev' || e === 'staging' || e === 'custom') env = e;
  });
  void getItem(LS_CUSTOM).then((v) => {
    if (v !== null) customUrl = v;
  });
  void getItem(LS_TERMINAL).then((raw) => {
    if (!raw) return;
    try {
      terminal = { ...terminal, ...(JSON.parse(raw) as TerminalInfo) };
    } catch {
      /* abaikan */
    }
  });
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  restore();
}

/**
 * Tunggu pemuatan nilai tersimpan selesai - panggil sekali saat start
 * aplikasi bila layar pertama butuh nilai pasti, bukan default.
 */
export async function loadServerState(): Promise<void> {
  hydrate();
  const [e, c, t] = await Promise.all([
    getItem(LS_ENV),
    getItem(LS_CUSTOM),
    getItem(LS_TERMINAL),
  ]);
  if (e === 'prod' || e === 'dev' || e === 'staging' || e === 'custom') env = e;
  if (c !== null) customUrl = c;
  if (t) {
    try {
      terminal = { ...terminal, ...(JSON.parse(t) as TerminalInfo) };
    } catch {
      /* abaikan */
    }
  }
}

export function getServerEnv(): ServerEnv {
  hydrate();
  return env;
}

export function setServerEnv(next: ServerEnv): void {
  hydrate();
  env = next;
  void setItem(LS_ENV, next);
}

export function getCustomBaseUrl(): string {
  hydrate();
  return customUrl;
}

export function setCustomBaseUrl(url: string): void {
  customUrl = url.trim();
  void setItem(LS_CUSTOM, customUrl);
}

/** Tautan web publik (fakta alur APK: registrasi/login lewat browser). */
export const WEB_URLS = {
  register: 'https://www.esb.id/esbposlite/registration/',
  login: 'https://poslite.esb.co.id/login',
} as const;

export function getWsUrl(): string {
  hydrate();
  if (env === 'custom') return customUrl.replace(/^http/, 'ws');
  return WS_URL[env] ?? '';
}

export function getBaseUrl(): string {
  hydrate();
  if (env === 'custom') return customUrl;
  return ENV_BASE_URL[env];
}

export function apiUrl(path: string): string {
  const base = getBaseUrl().replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return base ? `${base}/${p}` : p;
}

export function getTerminal(): TerminalInfo {
  hydrate();
  return { ...terminal };
}

export function setTerminal(next: TerminalInfo): void {
  terminal = { ...next };
  void setItem(LS_TERMINAL, JSON.stringify(terminal));
}

/**
 * ID cabang aktif untuk query lokal (ms_branchmenu dsb).
 * TODO(M9-7): fallback 'B001' hanya untuk mode dummy / terminal belum
 * diklaim (selaras kontrak §3-§4 dan dummy pull). Bila alur install sudah
 * mewajibkan klaim, ganti fallback ini menjadi string kosong + guard pemanggil.
 */
export function getBranchId(): string {
  hydrate();
  const b = (terminal.branchId ?? '').trim();
  return b || 'B001';
}

/** GET dengan query branch + paging inkremental (§0 kontrak).
 *
 * REA-18: header X-Terminal-Code / X-Branch-Id TANPA padanan literal di APK
 * (kandidat yang ADA: authKey, deviceID/UDID, Authorization/Bearer, ApiKey).
 * Dipertahankan sebagai [KONTRAK] milik kita - lihat docs/API-CONTRACT.md §2.
 */
export async function apiGet(
  path: string,
  params?: Record<string, string | number>,
): Promise<Response> {
  const t = getTerminal();
  const q = new URLSearchParams({
    ...(t.branchId ? { branchId: t.branchId } : {}),
    ...Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])),
  });
  const url = `${apiUrl(path)}?${q.toString()}`;
  const headers: Record<string, string> = {};
  if (t.terminalCode) headers['X-Terminal-Code'] = t.terminalCode;
  return fetch(url, { headers });
}

export async function apiPost(
  path: string,
  body: unknown,
  opts?: { idempotencyKey?: string; token?: string },
): Promise<Response> {
  const t = getTerminal();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t.terminalCode) headers['X-Terminal-Code'] = t.terminalCode;
  if (t.branchId) headers['X-Branch-Id'] = t.branchId;
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts?.token) headers['Authorization'] = `Bearer ${opts.token}`;
  return fetch(apiUrl(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}
