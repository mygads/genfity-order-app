/**
 * Konfigurasi server + terminal milik sendiri (clean-room).
 * Nama host/path di bawah adalah FAKTA hasil bedah string APK (REA),
 * dipakai sebagai default agar flow install/pull/push sama; base URL
 * bisa diganti ke server Anda kapan saja — kontrak JSON ikut server Anda.
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
  staging: 'wss://stg-eso.esb.co.id/ws',
  custom: '',
};

/** Path API (fakta dari string table APK — tanpa body JSON). */
export const ApiPath = {
  validateTerminal: 'main/validate-terminal',
  getTerminal: 'terminal/get-terminal',
  updateTerminal: 'terminal/update',
  install: 'pos/install',
  createPin: 'pos/create-pin',
  checkBranch: 'main/check-branch-status',
  pullMenu: 'main/get-menu',
  pullBranchMenu: 'main/get-branch-menu',
  pullUser: 'main/get-user',
  pullTable: 'main/get-table',
  pullPromotion: 'main/get-promotion',
  pullMember: 'main/get-member',
  pullVoucher: 'main/get-voucher',
  pullSales: 'main/get-sales',
  pushOrderFinish: 'order/finish',
  pushOrderView: 'order/view',
  splitBill: 'order/split-bill',
  moveItems: 'order/move-items',
  moveTable: 'order/move-table',
  receiptEmail: 'sales/receipt-email',
  voucherLock: 'posv1/esb-voucher/lock',
  voucherUnlock: 'posv1/esb-voucher/unlock',
  voucherValidate: 'posv1/esb-voucher/validate',
  clockIn: 'employee-attendance/clock-in',
  supervisorApprove: 'auth/supervisor-approve',
  cashierLogin: 'auth/cashier-login',
  clockOut: 'employee-attendance/clock-out',
  depositInquiry: 'member-deposit-withdrawal/inquiry-deposit',
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
 * Tunggu pemuatan nilai tersimpan selesai — panggil sekali saat start
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
