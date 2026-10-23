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
import { tr } from '../lib/i18n';

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
  // LEGACY MATI — Real mode = 404 (kontrak §4.4). authorizeSupervisor legacy
  // (shift screens, E29 territory) masih memakainya sampai follow-up E29;
  // alur void/eskalasi/compliment WAJIB supervisorApproveV1 (S7).
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
  // ---- E01-E28: endpoint kontrak sesi terminal (SPEC-TERMINAL-SESSION §11,
  // tabel final; BE Go pemilik kebenaran — yang BELUM ADA (MISSING-BE, klien
  // wajib fail-closed, JANGAN di-wire diam-diam): E05 occupant, E08 (POST
  // /branches scope-terminal; scope-merchant ada di bawah auth berbeda),
  // E13 /tag khusus (ganti tag via E11 PATCH generik), E17–E22 scope-terminal
  // (scope-merchant ada, auth berbeda), E23, E24, E25-consume. E04/E10/E11/E12
  // SUDAH ADA (mendarat 2026-10-17). '{id}'/'{viewId}' diganti caller.
  staffLogin: 'api/v1/auth/terminal-login', // E01 POST LOGIN-FIRST F1 (single-stage, BUKAN dua kredensial): {username,password,deviceId,terminalCode?,terminalPin?,merchantId?} → tahap-A {stage:'pick-terminal'} tanpa terminalCode, tahap-B sesi penuh + pinRequired SELALU. `staffPin` TAK ADA (server abaikan); PIN user SELALU langkah 2 via E29 (cek hybrid berversi, bukan gate buta).
  terminalValidatePin: 'api/v1/terminals/{id}/validate-pin', // E02 POST cek PIN tanpa efek
  terminalBind: 'api/v1/terminals/{id}/bind', // E03 POST bind atomik {pin,deviceId}
  terminalUnbind: 'api/v1/terminals/{id}/unbind', // E04 POST owner lepas binding
  terminalOccupant: 'api/v1/terminals/{id}/occupant', // E05 GET sesi aktif terminal — MISSING-BE (tanpa rute BE; fetchOccupant fail-closed, 0 pemanggil). Alternatif disetujui swarm: snapshot okupansi via SSE (lane BE).
  authLogout: 'api/v1/auth/terminal-logout', // E06/E31 POST akhiri sesi {deviceId} → {loggedOut, deviceStillBound} (BE tak punya /auth/logout; logout = terminal-logout, device tetap bound)
  branches: 'api/v1/branches', // E07 GET branch milik user
  createBranch: 'api/v1/branches', // E08 POST owner bikin branch — MISSING-BE scope-terminal (scope-merchant GET+POST ada di bawah auth berbeda, tak bisa dipakai alur UserAuth terminal).
  branchTerminals: 'api/v1/branches/{id}/terminals', // E09 GET terminal picker
  createTerminal: 'api/v1/branches/{id}/terminals', // E10 POST owner create {name,tag}
  patchTerminal: 'api/v1/terminals/{id}', // E11 PATCH {name,tag}
  deleteTerminal: 'api/v1/terminals/{id}', // E12 DELETE hapus/revoke
  setTerminalTag: 'api/v1/terminals/{id}/tag', // E13 KHUSUS — MISSING-BE (tanpa rute) → DEPRECATED: ganti tag via patchTerminal (E11 PATCH generik /terminals/{id} {tag}). Konstanta dipertahankan agar impor lama tak pecah; JANGAN dipakai untuk call baru.
  setTerminalPin: 'api/v1/terminals/{id}/set-pin', // E14 POST owner set/rotate PIN
  pairView: 'api/v1/terminals/{viewId}/pair', // E15 POST pair view→kasir (E422 bila ganda)
  unpairView: 'api/v1/terminals/{viewId}/pair', // E16 DELETE lepas pairing
  createStaff: 'api/v1/staff', // E17 POST — MISSING-BE scope-terminal (scope-merchant ada, auth berbeda)
  listStaff: 'api/v1/staff', // E18 GET — MISSING-BE scope-terminal (scope-merchant ada, auth berbeda)
  patchStaff: 'api/v1/staff/{id}', // E19 PATCH — MISSING-BE scope-terminal (scope-merchant ada, auth berbeda)
  deleteStaff: 'api/v1/staff/{id}', // E20 DELETE — MISSING-BE scope-terminal (scope-merchant ada, auth berbeda)
  staffBranches: 'api/v1/staff/{id}/branches', // E21 GET — MISSING-BE scope-terminal
  branchStaff: 'api/v1/branches/{id}/staff', // E22 GET — MISSING-BE scope-terminal
  approvals: 'api/v1/approvals', // E23 POST {action:void|cancel|compliment, ownerPin, refId} — MISSING-BE
  ownerAudit: 'api/v1/audit/owner-actions', // E24 GET rekap pemakaian PIN owner — MISSING-BE
  terminalLoginQr: 'api/v1/terminals/{id}/login-qr', // E25 POST QR login (TBD Q2) — MISSING-BE (pasangan qr-issue/qr-consume SUDAH ADA dan ter-wire; E25-login-qr endpoint terpisah bila masih dibutuhkan)
  terminalEvents: 'api/v1/terminals/{id}/events', // E26 GET SSE feed per terminal
  queueEvents: 'api/v1/branches/{id}/queue-events', // E27 GET SSE antrean per branch
  // S-READINESS: GET kesiapan terminal {deviceId?} → {needsShift, needsCash,
  // shift{open}, cash{open}, grant{valid}, pairing} (BE terminal_readiness.go,
  // router.go:1173, member-only; SPEC-TERMINAL-SESSION §11 baris S-READINESS).
  terminalReadiness: 'api/v1/terminals/{id}/readiness',
  // E29-E31: sesi terminal fase-1a (login staged 3 faktor + logout tetap bound).
  terminalPinVerify: 'api/v1/terminals/{id}/pin-verify', // E29 POST verifikasi PIN user {pin} → {verified} (USER_PIN_NOT_SET/INVALID/LOCKED)
  terminalRelease: 'api/v1/terminals/{id}/release', // E30 POST occupant lepas binding sendiri {deviceId} → {released}
  terminalLogout: 'api/v1/auth/terminal-logout', // E31 POST akhiri sesi {deviceId} → {loggedOut, deviceStillBound} (device tetap bound)
  terminalClaim: 'api/v1/terminals/{id}/claim', // E32 POST ambil alih {pin,deviceId} → {bound, kickedUserId} (fase-1b: PIN terminal WAJIB; pindah device saja, kapasitas per-tag 409 TAG_CONFLICT)
  terminalQrIssue: 'api/v1/terminals/{id}/qr-issue', // POST terbitkan token QR login sekali-pakai (tanpa body; member-only) → {qrToken, expiresAt, ttlSeconds} (TTL 60 dtk BE; E25 login-qr TBD Q2)
  terminalQrConsume: 'api/v1/terminals/{id}/qr-consume', // POST tukar token QR hasil scan {qrToken, deviceId?} (PUBLIC, HP belum bersesi) → {terminalId, terminalCode, merchantId, pinVersion advisory} — TANPA sesi/grant/binding; PIN terminal tetap wajib tahap-B
  // PP-001/S7: kontrak supervisor BARU (BE router.go:1119,
  // supervisor_approve.go) — PENGGANTI legacy auth/supervisor-approve untuk
  // alur void/eskalasi/compliment. '{id}' = ID numerik BE terminal (bukan
  // terminalCode), diganti caller via .replace('{id}', encodeURIComponent(id))
  // ala terminalApi.ts:109. Body {supervisorUserId:int64, supervisorPin,
  // action 1..64, refId ≤128, reason 1..500} → {approvalId, approvedAt}.
  // Supervisor = OWNER atau grant supervisor_override; self-approval direkam.
  supervisorApproveV1: 'api/v1/terminals/{id}/supervisor-approve',
  // E28: tanpa endpoint — policy max_offline_grant_days via pull-terminal-settings
  // (lihat offlineGrantPolicyKey di bawah).
} as const;

/** E28: kunci policy grant offline (server-wins via terminal-settings, default 7 hari). */
export const offlineGrantPolicyKey = 'max_offline_grant_days';

export interface TerminalInfo {
  terminalCode: string;
  branchId: string;
  branchName: string;
  /** ID numerik BE terminal (string angka dari E09 picker/bind) untuk path
   * kontrak-Go /terminals/{id}/... (S7 supervisor-approve V1). Opsional agar
   * binding lama tetap kompilasi; kosong = bind ulang / isi manual di dialog
   * persetujuan (fail-closed bila kosong dan tak diisi). */
  terminalIdBe?: string;
  /** Tag terminal model-5 (SPEC §1): kasir|dapur|view_pelanggan|view_queue|full_access.
   * Opsional agar konstruktor lama tetap kompilasi; undefined = belum sync dari BE. */
  tag?: string;
  /** true bila owner sudah set PIN terminal (E09 terminal picker, E14 set-pin). */
  pinSet?: boolean;
  /** Pasangan 1:1 view_pelanggan → kasir (E09/E15; BE menolak view ke-2, E422). */
  pairedKasirId?: string;
  /** Cermin sisi kasir: id view yang terpasang padanya. */
  pairedViewId?: string;
  /** Status verifikasi terminal dari BE (E09 respons terminal). */
  verified?: boolean;
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
  const v = url.trim();
  // S5: hanya skema http(s)://host yang diterima; kosong = belum dikonfigurasi
  // (pushAll menolak dengan sync_no_url sebelum drain).
  if (v && !/^https?:\/\/[^/\s]+/i.test(v)) {
    throw new Error(tr('sync_bad_url'));
  }
  customUrl = v;
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
 *
 * FAIL-CLOSED (SPEC-TERMINAL-SESSION, menutup termreg-branch-fallback):
 * device belum ter-bound (unbound) mengembalikan string kosong — fallback
 * diam-diam 'B001' DIHAPUS. Tipe kembali tetap string sehingga pemanggil lama
 * tetap kompilasi, tetapi pemanggil WAJIB menganggap '' = unbound dan memaksa
 * (re)claim sebelum transaksi; dilarang mencatat penjualan/shift di bawah
 * branch kosong maupun cabang fiktif.
 */
export function getBranchId(): string {
  hydrate();
  const b = (terminal.branchId ?? '').trim();
  if (!b) {
    console.warn('[server] getBranchId: terminal unbound (branchId kosong) — klaim terminal dulu.');
  }
  return b;
}

/**
 * GO-POS COMPAT auth (wire-app): path kontrak-Go (`api/...`, mis.
 * `api/merchant/orders/pos` + `api/v1/...`) dilayani backend Go di belakang
 * MerchantAuth — tanpa bearer, push 401. Token dibaca MALAS (lazy) dari store
 * sesi pada tiap panggilan (sesi bisa terhidrasi sesudah modul ini dimuat),
 * via accessor yang SAMA dengan terminalContract requestPinReset
 * (`getSession()`, urutan `authToken` JWT E01 dulu, fallback `authKey`
 * terminal-login). Tanpa token → header dihilangkan (server 401 jujur, bukan
 * sukses palsu). Path bentuk-ESB (`main/...`, `order/...`, `posv1/...`,
 * `v1/push/...`, ...) SENGAJA tanpa bearer (jalur dummy/lokal tak pernah
 * sampai sini — apiFetch short-circuit sebelum dial network).
 * Lazy-require ala display.ts/sse.ts/realtime.ts agar nol risiko siklus impor
 * statis. Verifikasi siklus: session.ts statis→ hanya lib/storage,
 * lib/deviceRole, lib/pin; transitif→ db/dbSchema/uuidv7/secure-store/
 * AsyncStorage — tak ada yang mengimpor config/server maupun session.
 */
function resolveSessionToken(): string {
  try {
    const sess = require('../session') as typeof import('../session');
    const s = sess.getSession();
    return String(s?.authToken ?? s?.authKey ?? '').trim();
  } catch {
    return '';
  }
}

/** true = path kontrak Go (`api/...`) yang butuh bearer MerchantAuth. */
function needsSessionBearer(path: string): boolean {
  return String(path ?? '')
    .replace(/^\/+/, '')
    .startsWith('api/');
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
  opts?: { token?: string; idempotencyKey?: string; signal?: AbortSignal },
): Promise<Response> {
  const t = getTerminal();
  const q = new URLSearchParams({
    ...(t.branchId ? { branchId: t.branchId } : {}),
    ...Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])),
  });
  const url = `${apiUrl(path)}?${q.toString()}`;
  const headers: Record<string, string> = {};
  if (t.terminalCode) headers['X-Terminal-Code'] = t.terminalCode;
  // S17: opsi auth/idempotency ala apiPost (aditif — pemanggil lama tetap jalan).
  // Bearer: token eksplisit menang; bila absen dan path kontrak-Go, pakai
  // token sesi (compat push MerchantAuth) — path ESB tetap header-free.
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const getToken = opts?.token
    ? opts.token
    : needsSessionBearer(path)
      ? resolveSessionToken()
      : '';
  if (getToken) headers['Authorization'] = `Bearer ${getToken}`;
  return fetch(url, {
    headers,
    // GAP-1/5: teruskan sinyal abort (timeout per-attempt / pembatalan user).
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
}

export async function apiPost(
  path: string,
  body: unknown,
  opts?: { idempotencyKey?: string; token?: string; signal?: AbortSignal },
): Promise<Response> {
  const t = getTerminal();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t.terminalCode) headers['X-Terminal-Code'] = t.terminalCode;
  if (t.branchId) headers['X-Branch-Id'] = t.branchId;
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  // Bearer: token eksplisit menang; bila absen dan path kontrak-Go, pakai
  // token sesi (compat push MerchantAuth) — path ESB tetap header-free.
  const postToken = opts?.token
    ? opts.token
    : needsSessionBearer(path)
      ? resolveSessionToken()
      : '';
  if (postToken) headers['Authorization'] = `Bearer ${postToken}`;
  return fetch(apiUrl(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    // S4-APP-313: teruskan sinyal abort pemanggil (timeout per-attempt /
    // pembatalan user) — aditif, pemanggil lama tanpa signal tetap jalan.
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
}

/**
 * D (E16 unpair): DELETE tanpa body — pasangan apiPost untuk lepas-pairing
 * view. Bearer/idempotency + header kontrak X-Terminal-Code/Branch-Id ala
 * apiPost agar konsisten dengan panggilan kontrak-Go lain.
 */
export async function apiDelete(
  path: string,
  opts?: { idempotencyKey?: string; token?: string; signal?: AbortSignal },
): Promise<Response> {
  const t = getTerminal();
  const headers: Record<string, string> = {};
  if (t.terminalCode) headers['X-Terminal-Code'] = t.terminalCode;
  if (t.branchId) headers['X-Branch-Id'] = t.branchId;
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const delToken = opts?.token
    ? opts.token
    : needsSessionBearer(path)
      ? resolveSessionToken()
      : '';
  if (delToken) headers['Authorization'] = `Bearer ${delToken}`;
  return fetch(apiUrl(path), {
    method: 'DELETE',
    headers,
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
}

/**
 * D (E11 patch): PATCH dengan body JSON — pasangan apiPost/apiDelete untuk
 * update parsial (E11 {name?, tag?}). Bearer/idempotency + header kontrak
 * ala apiPost.
 */
export async function apiPatch(
  path: string,
  body: unknown,
  opts?: { idempotencyKey?: string; token?: string; signal?: AbortSignal },
): Promise<Response> {
  const t = getTerminal();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t.terminalCode) headers['X-Terminal-Code'] = t.terminalCode;
  if (t.branchId) headers['X-Branch-Id'] = t.branchId;
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const patchToken = opts?.token
    ? opts.token
    : needsSessionBearer(path)
      ? resolveSessionToken()
      : '';
  if (patchToken) headers['Authorization'] = `Bearer ${patchToken}`;
  return fetch(apiUrl(path), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
}

/**
 * S15: detak koneksi (pong) + ambang mati 90 dtk. Soket dimiliki realtime.ts
 * (agen lain) — modul ini hanya menyimpan stempel; pemilik realtime memanggil
 * notePong() tiap pong dan noteReconnect() tiap sambung-ulang.
 * pullMaster TIDAK dipicu dari sini: import master.ts akan bersiklus
 * (server → master → sync → server) — wiring reconnect→pullMaster milik
 * pemilik realtime (DEFERRED, lihat laporan).
 */
let lastPongMs = 0;
let lastReconnectMs = 0;
/** S15: ambang mati koneksi 90 detik tanpa pong. */
export const CONN_DEAD_MS = 90_000;
export function notePong(): void {
  lastPongMs = Date.now();
}
export function getLastPong(): number {
  return lastPongMs;
}
export function isConnDead(now = Date.now()): boolean {
  return lastPongMs > 0 && now - lastPongMs > CONN_DEAD_MS;
}
export function noteReconnect(): void {
  lastReconnectMs = Date.now();
}
export function getLastReconnect(): number {
  return lastReconnectMs;
}
