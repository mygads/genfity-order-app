/**
 * Sesi kasir di memori + persistensi AsyncStorage (lib/storage.ts) agar
 * sesi bertahan restart di web + native. API tetap sinkron seperti semula.
 */
import { getItem, removeItem, setItem } from './lib/storage';
import { resolveTerminalTag, type TerminalTag } from './lib/deviceRole';
import { hashPin, verifyPinHash } from './lib/pin';
import type { PinRecord } from './lib/pin';

export interface Session {
  name: string;
  username: string;
  /** Peran hasil login ('Merchant Owner'/'Merchant Staff'); default Staff. */
  role?: string;
  /** Id user login (kunci tabel ms_posuseraccess); fallback username bila kosong. */
  userId?: string;
  /** Konteks terminal hasil login (audit row 18, paket app-login 2026-10-17):
   * branch/terminal/tag/authKey dari kontrak terminal-login; binding device
   * sendiri (branchId/terminalCode/tag) tinggal di lib/terminalContract.ts.
   * Opsional agar sesi lama tetap terbaca (kompatibel mundur). */
  branchId?: string;
  terminalCode?: string;
  terminalTag?: string;
  /** Nama terminal tampilan (sapaan login "merchant X terminal Y", paket app-model). */
  terminalName?: string;
  /** Nama merchant tampilan (sapaan login, paket app-model). */
  merchantName?: string;
  authKey?: string;
  /** Id terminal sesi (kunci grant + okupansi tunggal, SPEC-TERMINAL-SESSION §7.1). */
  terminalId?: string;
  /** Id device sesi (1 device = 1 terminal, SPEC-TERMINAL-SESSION §7.1). */
  deviceId?: string;
  /** Token sesi server dari E01 staff-login (endpoint belum ada; saat mendarat
   *  pindahkan ke SecureStore ala lib/pin.ts, jangan plaintext di storage). */
  authToken?: string;
  /** Waktu login ISO (dibuat saat loginEmployee/saveSession). */
  loginAt?: string;
  /** true = sesi dibuat offline dari grant cache (rekonsiliasi saat reconnect). */
  offline?: boolean;
  outlet: string;
  shift: string;
  clockIn: string;
  cash: number;
}

/**
 * Binding device<->terminal (SPEC-TERMINAL-SESSION §2): milik tepat satu
 * branch, persist sampai unbind/re-bind. Logout TIDAK menghapus binding.
 */
export interface Binding {
  terminalId: string;
  terminalCode: string;
  branchId: string;
  branchName: string;
  merchantName: string;
  /** Satu dari 5 tag kanonis, disimpan lowercase (kasir|dapur|view_pelanggan|view_queue|full_access). */
  tag: string;
  /** Untuk tag view_pelanggan: terminal kasir pasangan (aturan 1:1, BE E15). */
  pairedKasirId?: string;
  /** Untuk tag kasir: terminal view pasangan (aturan 1:1, BE E15). */
  pairedViewId?: string;
  /** Id device terikat (1 device = 1 terminal). */
  deviceId?: string;
  /** Waktu bind ISO. */
  boundAt: string;
}

/**
 * Grant cache otorisasi offline (SPEC-TERMINAL-SESSION §2 + Q6 CLOSED):
 * dibuat saat auth online sukses (E01 staff-login), terikat triple
 * (user, terminal, device), TTL 7 hari sliding via max_offline_grant_days
 * (server-wins). staffPinHash adalah PinRecord — TIDAK PERNAH plaintext.
 */
export interface Grant {
  userId: string;
  terminalId: string;
  deviceId: string;
  staffPinHash: PinRecord;
  /** Otorisasi BE terakhir (ISO); dasar sliding window + cap policy. */
  grantedAt: string;
  /** Kedaluwarsa efektif saat grant dibuat (ISO). */
  expiresAt: string;
}

/**
 * Revoke sesi yang masih terutang ke server (SPEC-TERMINAL-SESSION §7/O1):
 * logout lokal langsung berlaku di device; revoke E06/E07 server-side
 * menyusul. Selama endpoint BE belum ada, setiap logout meninggalkan flag
 * ini (jujur, bukan bypass) untuk di-flush worker sync saat E06/E07 mendarat.
 */
export interface PendingRevoke {
  sessionId?: string;
  userId?: string;
  markedAt: string;
  reason?: string;
}

/** Masalah grant untuk status UI eksplisit ("needs BE / mode lokal"). */
export type GrantProblem = 'no-grant' | 'grant-mismatch' | 'grant-expired';

/**
 * Basis sesi netral — BUKAN identitas fiktif. Nama/username selalu ditimpa
 * hasil validateEmployee saat login nyata (loginEmployee di bawah); outlet +
 * shift mengikuti identitas cabang seed (B001 'Genfity Cabang Poris').
 * clockIn/cash mulai kosong sampai shift nyata dibaca Dashboard.
 */
const DEMO: Session = {
  name: '',
  username: '',
  role: 'Merchant Staff',
  outlet: 'Genfity Cabang Poris',
  shift: 'Shift Pagi',
  clockIn: '--:--',
  cash: 0,
};

const LS_SESSION = 'genfity.session.current';
const LS_BINDING = 'genfity.terminal.binding';
const LS_GRANT = 'genfity.session.grant';
const LS_GRANT_POLICY = 'genfity.session.grantPolicy';
const LS_PENDING_REVOKE = 'genfity.session.pendingRevoke';

/** Umur grant offline default (Q6 CLOSED): 7 hari sliding, server-driven. */
export const DEFAULT_MAX_OFFLINE_GRANT_DAYS = 7;
const DAY_MS = 86400000;

let current: Session | null = null;
let restored = false;
let binding: Binding | null = null;
let bindingRestored = false;
let grant: Grant | null = null;
let grantRestored = false;
let maxOfflineGrantDays = DEFAULT_MAX_OFFLINE_GRANT_DAYS;
let policyDirty = false;
let policyRestored = false;
let pendingRevoke: PendingRevoke | null = null;
let revokeRestored = false;
type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function persist(): void {
  if (current) void setItem(LS_SESSION, JSON.stringify(current));
  else void removeItem(LS_SESSION);
}

/** Muat sesi tersimpan sekali di background; panggil emit bila ada. */
function restore(): void {
  if (restored) return;
  restored = true;
  void getItem(LS_SESSION).then((raw) => {
    if (!raw || current) return;
    try {
      const parsed = JSON.parse(raw) as Session;
      // Kompatibel mundur: sesi lama tanpa role dibaca sebagai Staff.
      if (!parsed.role) parsed.role = 'Merchant Staff';
      current = parsed;
      emit();
    } catch {
      /* abaikan */
    }
  });
}

// ---------------------------------------------------------------------------
// Binding device<->terminal (SPEC-TERMINAL-SESSION §2)
// ---------------------------------------------------------------------------

function isBindingLike(v: unknown): v is Binding {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b['terminalId'] === 'string' &&
    (b['terminalId'] as string).trim() !== '' &&
    typeof b['terminalCode'] === 'string' &&
    (b['terminalCode'] as string).trim() !== '' &&
    typeof b['branchId'] === 'string' &&
    (b['branchId'] as string).trim() !== '' &&
    typeof b['branchName'] === 'string' &&
    typeof b['merchantName'] === 'string' &&
    typeof b['tag'] === 'string' &&
    typeof b['boundAt'] === 'string'
  );
}

/** Baca store ke memori (hanya mengisi bila memori kosong — tak pernah
 *  menimpa binding yang lebih baru hasil saveBinding). */
async function loadBindingStore(): Promise<Binding | null> {
  bindingRestored = true;
  if (!binding) {
    try {
      const raw = await getItem(LS_BINDING);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isBindingLike(parsed)) binding = parsed;
      }
    } catch {
      /* abaikan */
    }
  }
  return binding;
}

function restoreBinding(): void {
  if (bindingRestored) return;
  bindingRestored = true;
  void loadBindingStore().then((b) => {
    if (b) emit();
  });
}

export function getBinding(): Binding | null {
  restoreBinding();
  return binding;
}

export function saveBinding(b: Binding): Binding {
  if (!isBindingLike(b)) {
    throw new Error('[session] saveBinding: binding tak lengkap');
  }
  binding = {
    terminalId: b.terminalId.trim(),
    terminalCode: b.terminalCode.trim(),
    branchId: b.branchId.trim(),
    branchName: b.branchName,
    merchantName: b.merchantName,
    // Kanon SPEC §11.1: tag simpanan SELALU satu dari 5 nilai —
    // resolveTerminalTag memaksa explicit default 'full_access' untuk
    // string asing/kosong (tanpa '' diam-diam yang merusak DrawerMenu dkk).
    tag: resolveTerminalTag(b.tag),
    ...(b.pairedKasirId ? { pairedKasirId: b.pairedKasirId } : {}),
    ...(b.pairedViewId ? { pairedViewId: b.pairedViewId } : {}),
    ...(b.deviceId ? { deviceId: b.deviceId } : {}),
    boundAt: b.boundAt,
  };
  void setItem(LS_BINDING, JSON.stringify(binding));
  emit();
  return binding;
}

/**
 * Cabut binding lokal (unbind/re-bind, SPEC R1). R1 lengkap juga memanggil
 * clearGrant() + logout() — orkestrasi itu milik tugas R1, bukan fungsi ini.
 */
export function clearBinding(): void {
  binding = null;
  void removeItem(LS_BINDING);
  emit();
}

// ---------------------------------------------------------------------------
// Grant cache offline L1 (SPEC-TERMINAL-SESSION §4 + Q6 CLOSED)
// ---------------------------------------------------------------------------

function isPinRecordLike(v: unknown): v is PinRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['salt'] === 'string' &&
    (r['salt'] as string).length > 0 &&
    typeof r['hash'] === 'string' &&
    (r['hash'] as string).length > 0 &&
    typeof r['iter'] === 'number' &&
    (r['iter'] as number) > 0
  );
}

function isGrantLike(v: unknown): v is Grant {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return (
    typeof g['userId'] === 'string' &&
    (g['userId'] as string).trim() !== '' &&
    typeof g['terminalId'] === 'string' &&
    (g['terminalId'] as string).trim() !== '' &&
    typeof g['deviceId'] === 'string' &&
    (g['deviceId'] as string).trim() !== '' &&
    isPinRecordLike(g['staffPinHash']) &&
    typeof g['grantedAt'] === 'string' &&
    typeof g['expiresAt'] === 'string'
  );
}

/** Baca store ke memori (hanya mengisi bila memori kosong — tak pernah
 *  menimpa grant yang lebih baru hasil saveGrant/touchGrant). */
async function loadGrantStore(): Promise<Grant | null> {
  grantRestored = true;
  if (!grant) {
    try {
      const raw = await getItem(LS_GRANT);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isGrantLike(parsed)) grant = parsed;
      }
    } catch {
      /* abaikan */
    }
  }
  return grant;
}

function restoreGrant(): void {
  if (grantRestored) return;
  grantRestored = true;
  void loadGrantStore().then((g) => {
    if (g) emit();
  });
}

export function getGrant(): Grant | null {
  restoreGrant();
  return grant;
}

/**
 * Simpan grant dari hasil auth online (E01 staff-login; endpoint belum ada —
 * kini dipanggil manual/seeding sampai E01 mendarat). Menolak plaintext
 * PIN/password bila ikut terbawa di objek (fail-fast, bukan bypass diam).
 */
export function saveGrant(g: Grant): Grant {
  const raw = g as unknown as Record<string, unknown>;
  if (
    typeof raw['staffPin'] === 'string' ||
    typeof raw['pin'] === 'string' ||
    typeof raw['password'] === 'string'
  ) {
    throw new Error(
      '[session] saveGrant menolak plaintext PIN/password — pakai buildGrant',
    );
  }
  if (!isGrantLike(g)) {
    throw new Error('[session] saveGrant: grant tak lengkap');
  }
  grant = {
    userId: g.userId.trim(),
    terminalId: g.terminalId.trim(),
    deviceId: g.deviceId.trim(),
    staffPinHash: g.staffPinHash,
    grantedAt: g.grantedAt,
    expiresAt: g.expiresAt,
  };
  void setItem(LS_GRANT, JSON.stringify(grant));
  emit();
  return grant;
}

/** Hapus grant cache (dipakai R1 re-bind + revoke/ganti-role; SPEC §7). */
export function clearGrant(): void {
  grant = null;
  void removeItem(LS_GRANT);
  emit();
}

/**
 * Bangun grant dari PIN staff plaintext SEKALI (di memori pemanggil saja);
 * yang disimpan hanya PinRecord hash. Login pertama wajib online — tidak
 * ada grant bawaan (Q6 CLOSED).
 */
export function buildGrant(args: {
  userId: string;
  terminalId: string;
  deviceId: string;
  staffPin: string;
  grantedAt?: string;
}): Grant {
  const userId = String(args.userId ?? '').trim();
  const terminalId = String(args.terminalId ?? '').trim();
  const deviceId = String(args.deviceId ?? '').trim();
  if (!userId || !terminalId || !deviceId) {
    throw new Error('[session] buildGrant butuh userId+terminalId+deviceId');
  }
  if (!args.staffPin) {
    throw new Error('[session] buildGrant butuh staffPin');
  }
  const parsedAt = Date.parse(args.grantedAt ?? '');
  const grantedMs = Number.isFinite(parsedAt) ? parsedAt : Date.now();
  const grantedAt = new Date(grantedMs).toISOString();
  const expiresAt = new Date(
    grantedMs + getMaxOfflineGrantDays() * DAY_MS,
  ).toISOString();
  const r = hashPin(args.staffPin);
  const staffPinHash: PinRecord = {
    v: 1,
    iter: r.iter,
    salt: r.salt,
    hash: r.hash,
    updatedAt: grantedAt,
  };
  return { userId, terminalId, deviceId, staffPinHash, grantedAt, expiresAt };
}

/** Cocokkan PIN kandidat ke hash grant tersimpan (login offline L1). */
export function verifyGrantPin(pin: string): boolean {
  restoreGrant();
  if (!grant) return false;
  const clean = String(pin ?? '');
  if (!clean) return false;
  try {
    return verifyPinHash(clean, grant.staffPinHash);
  } catch {
    return false;
  }
}

/**
 * Perpanjangan sliding window saat auth online sukses (Q6 CLOSED):
 * grantedAt=sekarang, expiresAt=sekarang+policy. false bila tanpa grant.
 */
export function touchGrant(): boolean {
  restoreGrant();
  if (!grant) return false;
  const now = Date.now();
  grant = {
    ...grant,
    grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + getMaxOfflineGrantDays() * DAY_MS).toISOString(),
  };
  void setItem(LS_GRANT, JSON.stringify(grant));
  emit();
  return true;
}

/** Policy max_offline_grant_days (server-wins via pull-terminal-settings;
 *  default 7 hari, Q6 CLOSED). 0 = login offline dimatikan. */
export function getMaxOfflineGrantDays(): number {
  restorePolicy();
  return maxOfflineGrantDays;
}

/** Terapkan policy dari server (E28 via terminal-settings). */
export function setMaxOfflineGrantDays(days: number): void {
  const n = Math.floor(Number(days));
  maxOfflineGrantDays = Number.isFinite(n)
    ? Math.min(365, Math.max(0, n))
    : DEFAULT_MAX_OFFLINE_GRANT_DAYS;
  policyDirty = true;
  void setItem(LS_GRANT_POLICY, String(maxOfflineGrantDays));
  emit();
}

async function loadPolicyStore(): Promise<number> {
  policyRestored = true;
  if (!policyDirty) {
    try {
      const raw = await getItem(LS_GRANT_POLICY);
      if (raw !== null) {
        const n = Math.floor(Number(raw));
        if (Number.isFinite(n)) {
          maxOfflineGrantDays = Math.min(365, Math.max(0, n));
        }
      }
    } catch {
      /* abaikan: default 7 hari */
    }
  }
  return maxOfflineGrantDays;
}

function restorePolicy(): void {
  if (policyRestored) return;
  policyRestored = true;
  void loadPolicyStore();
}

/**
 * Klasifikasi masalah grant untuk status UI eksplisit:
 * - 'no-grant'       → login pertama wajib online (butuh BE).
 * - 'grant-expired'  → grant kedaluwarsa; re-auth online (butuh BE).
 * - 'grant-mismatch' → triple (user, terminal, device) tak cocok; cek binding.
 * - null             → grant valid.
 * Kedaluwarsa efektif = min(expiresAt, grantedAt + policy) agar policy
 * server yang mengecil segera berlaku (server-wins).
 */
export function describeGrantProblem(
  userId: string,
  terminalId: string,
  deviceId?: string,
): GrantProblem | null {
  restoreGrant();
  restoreBinding();
  restore();
  const g = grant;
  if (!g) return 'no-grant';
  const u = String(userId ?? '').trim();
  const t = String(terminalId ?? '').trim();
  if (!u || !t || g.userId !== u || g.terminalId !== t) {
    return 'grant-mismatch';
  }
  const dev = String(
    deviceId ?? binding?.deviceId ?? current?.deviceId ?? '',
  ).trim();
  if (!dev || g.deviceId !== dev) return 'grant-mismatch';
  const now = Date.now();
  const exp = Date.parse(g.expiresAt);
  if (!Number.isFinite(exp)) return 'grant-expired';
  const grantedMs = Date.parse(g.grantedAt);
  const cap = Number.isFinite(grantedMs)
    ? grantedMs + getMaxOfflineGrantDays() * DAY_MS
    : exp;
  if (now >= Math.min(exp, cap)) return 'grant-expired';
  return null;
}

/**
 * Triple match (userId, terminalId, deviceId) + expiry + cap policy.
 * deviceId opsional: bila absen, dipakai device binding/sesi aktif; bila
 * device tak dapat dipastikan → false (fail-closed). Tak pernah melempar.
 */
export function isGrantValid(
  userId: string,
  terminalId: string,
  deviceId?: string,
): boolean {
  try {
    return describeGrantProblem(userId, terminalId, deviceId) === null;
  } catch {
    return false;
  }
}

/**
 * Muat ulang binding+grant+policy+revoke dari store (untuk gerbang async
 * seperti requireTerminalAccess agar tak menilai dari memori dingin
 * pasca-restart). Tak pernah melempar.
 */
export async function hydrateTerminalState(): Promise<{
  binding: Binding | null;
  grant: Grant | null;
}> {
  try {
    const [b, g] = await Promise.all([
      loadBindingStore(),
      loadGrantStore(),
    ]);
    await Promise.all([loadPolicyStore(), loadRevokeStore()]);
    return { binding: b, grant: g };
  } catch {
    return { binding, grant };
  }
}

// ---------------------------------------------------------------------------
// PendingRevoke O1 (SPEC-TERMINAL-SESSION §7)
// ---------------------------------------------------------------------------

function isRevokeLike(v: unknown): v is PendingRevoke {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r['markedAt'] === 'string';
}

async function loadRevokeStore(): Promise<PendingRevoke | null> {
  revokeRestored = true;
  if (!pendingRevoke) {
    try {
      const raw = await getItem(LS_PENDING_REVOKE);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isRevokeLike(parsed)) pendingRevoke = parsed;
      }
    } catch {
      /* abaikan */
    }
  }
  return pendingRevoke;
}

function restoreRevoke(): void {
  if (revokeRestored) return;
  revokeRestored = true;
  void loadRevokeStore();
}

export function getPendingRevoke(): PendingRevoke | null {
  restoreRevoke();
  return pendingRevoke;
}

export function hasPendingRevoke(): boolean {
  restoreRevoke();
  return pendingRevoke !== null;
}

/** Tandai revoke terutang (dipanggil logout; di-flush saat E06/E07 ada). */
export function markPendingRevoke(info?: {
  sessionId?: string;
  userId?: string;
  reason?: string;
}): void {
  restoreRevoke();
  pendingRevoke = {
    ...(info?.sessionId ? { sessionId: info.sessionId } : {}),
    ...(info?.userId ? { userId: info.userId } : {}),
    markedAt: new Date().toISOString(),
    ...(info?.reason ? { reason: info.reason } : {}),
  };
  void setItem(LS_PENDING_REVOKE, JSON.stringify(pendingRevoke));
}

/** Hapus flag setelah server konfirmasi revoke (E06/E07). */
export function clearPendingRevoke(): void {
  pendingRevoke = null;
  void removeItem(LS_PENDING_REVOKE);
}

// ---------------------------------------------------------------------------
// Sesi
// ---------------------------------------------------------------------------

export function getSession(): Session | null {
  restore();
  restoreBinding();
  if (current) {
    if (!current.role) current.role = 'Merchant Staff';
    // Backfill konteks terminal dari binding bila sesi belum membawanya
    // (mis. sesi lama tersimpan sebelum Fase 1, atau sesudah re-bind).
    // Hanya mengisi yang kosong — cermin paket app-model tak ditimpa.
    if (binding) {
      if (!current.branchId && binding.branchId) {
        current.branchId = binding.branchId;
      }
      if (!current.terminalId && binding.terminalId) {
        current.terminalId = binding.terminalId;
      }
      if (!current.terminalCode && binding.terminalCode) {
        current.terminalCode = binding.terminalCode;
      }
      if (!current.terminalTag && binding.tag) {
        current.terminalTag = binding.tag;
      }
      if (!current.deviceId && binding.deviceId) {
        current.deviceId = binding.deviceId;
      }
      if (!current.merchantName && binding.merchantName) {
        current.merchantName = binding.merchantName;
      }
    }
  }
  return current;
}

export function isLoggedIn(): boolean {
  restore();
  return current !== null;
}

/**
 * Simpan sesi penuh (hasil E01 staff-login: user + token + konteks terminal
 * + flag offline). Dipakai alur L1; login lokal tetap via loginEmployee.
 */
export function saveSession(s: Session): Session {
  restore();
  current = { ...s };
  if (!current.role) current.role = 'Merchant Staff';
  if (!current.loginAt) current.loginAt = new Date().toISOString();
  persist();
  emit();
  return current;
}

/** Bersihkan sesi memori+store tanpa menyentuh binding/grant (SPEC §2). */
export function clearSession(): void {
  current = null;
  persist();
  emit();
}

/**
 * Login karyawan tervalidasi server (T1): nama + username dari hasil
 * validateEmployee; peran + userId dikunci dari hasil login ini.
 * Outlet/shift/kas HANYA diwarisi bila username sama (login ulang sesi
 * sendiri); user berbeda selalu mulai dari basis netral agar identitas,
 * shift, dan kas user sebelumnya tak bocor ke sesi baru.
 *
 * Konteks terminal (branch/terminal/device) milik binding — dipertahankan
 * lintas user agar take-over kick (SPEC §7/Q13) tetap di terminal yang sama.
 * authToken/flag offline selalu dibuang di sini (authKey warisan paket
 * app-login tak disentuh): sesi resmi hanya via saveSession sesudah E01
 * (fail-closed, anti token basi).
 */
export function loginEmployee(e: { nama: string; username: string; role?: string; userId?: string }): Session {
  restore();
  restoreBinding();
  const uname = e.username.trim();
  const prev = current;
  const base = current && current.username === uname ? current : DEMO;
  const userId = (e.userId ?? '').trim();
  current = {
    ...base,
    name: e.nama.trim() || base.name,
    username: uname || base.username,
    role: (e.role ?? '').trim() || 'Merchant Staff',
    ...(userId ? { userId } : {}),
  };
  const keepBranch = prev?.branchId ?? binding?.branchId;
  const keepTerminalId = prev?.terminalId ?? binding?.terminalId;
  const keepTerminalCode = prev?.terminalCode ?? binding?.terminalCode;
  const keepTag = prev?.terminalTag ?? binding?.tag;
  const keepDevice = prev?.deviceId ?? binding?.deviceId;
  const keepMerchant = prev?.merchantName ?? binding?.merchantName;
  if (keepBranch) current.branchId = keepBranch;
  if (keepTerminalId) current.terminalId = keepTerminalId;
  if (keepTerminalCode) current.terminalCode = keepTerminalCode;
  if (keepTag) current.terminalTag = keepTag;
  if (keepDevice) current.deviceId = keepDevice;
  if (keepMerchant) current.merchantName = keepMerchant;
  delete current.authToken;
  delete current.offline;
  current.loginAt = new Date().toISOString();
  persist();
  emit();
  return current;
}

export function logout(): void {
  if (current) {
    // E06/E07 revoke server-side BELUM ADA: catat utang revoke agar di-flush
    // worker sync saat endpoint mendarat (SPEC §7/O1). Binding + grant cache
    // SENGAJA dipertahankan agar login ulang offline masih bisa (SPEC §2).
    const who = current.userId ?? current.username;
    try {
      markPendingRevoke({
        ...(who ? { userId: who } : {}),
        reason: 'logout',
      });
    } catch {
      /* abaikan */
    }
  }
  current = null;
  postLoginRoute = null;
  persist();
  emit();
  // Matikan realtime + foreground service (pasangan startRealtime saat login).
  try {
    const { stopRealtime } = require('./lib/realtime') as typeof import('./lib/realtime');
    stopRealtime();
  } catch {
    /* abaikan */
  }
  try {
    const { setWsForeground } = require('./native/printer') as typeof import('./native/printer');
    void setWsForeground(false);
  } catch {
    /* abaikan */
  }
}

/**
 * Rute tujuan sekali-pakai setelah stack tamu -> authed berganti (mis. QrScan
 * dari kartu QR Login). Jangan navigate manual tepat setelah login: navigator
 * tamu tak mengenal rute authed sehingga NAVIGATE sinkron race dan error
 * "not handled by any navigator". GuardedStacks mengonsumsi ini sekali
 * saat stack authed mount; logout membuangnya.
 */
let postLoginRoute: string | null = null;

export function setPostLoginRoute(name: string): void {
  postLoginRoute = name;
}

export function takePostLoginRoute(): string | null {
  const r = postLoginRoute;
  postLoginRoute = null;
  return r;
}

/** Intip tanpa mengonsumsi (untuk jaring pengaman rute agar tak berebut target). */
export function peekPostLoginRoute(): string | null {
  return postLoginRoute;
}

export function subscribeSession(fn: Listener): () => void {
  restore();
  listeners.add(fn);
  // Sapu langsung: restore async (di web: localStorage resolve dalam
  // microtask) bisa selesai SEBELUM effect subscribe mount sehingga emit
  // terlewat dan loggedIn macet false selamanya (reload balik ke Intro,
  // teramati listeners=0). Menutup kedua urutan balap: sudah-pulih →
  // beri tahu sekarang; belum-pulih → emit restore nanti yang memberi tahu.
  if (current !== null) {
    try {
      fn();
    } catch {
      /* abaikan */
    }
  }
  return () => {
    listeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Cermin konteks terminal (paket app-model, baris 18). Diisi alur login/bind
// dari Binding sesi / kontrak terminalContract.ts; getSession() juga
// backfill dari binding bila kosong. Tanpa kunci i18n baru: sapaan memakai
// literal netral "merchant · terminal".
// ---------------------------------------------------------------------------

/** Konteks terminal untuk dicerminkan ke sesi (semua opsional, '' = tak diubah). */
export interface SessionTerminalContext {
  branchId?: string;
  terminalId?: string;
  terminalCode?: string;
  terminalTag?: string;
  terminalName?: string;
  merchantName?: string;
  deviceId?: string;
  authKey?: string;
}

/**
 * Cerminkan konteks terminal ke sesi aktif (panggil setelah loginEmployee /
 * bind). Tak ada sesi => null. Tak pernah melempar.
 */
export function setSessionTerminal(ctx: SessionTerminalContext): Session | null {
  restore();
  if (!current) return null;
  const put = (v?: string): string | undefined => {
    const s = (v ?? '').trim();
    return s ? s : undefined;
  };
  try {
    const next: Session = { ...current };
    const b = put(ctx.branchId);
    const tid = put(ctx.terminalId);
    const t = put(ctx.terminalCode);
    const g = put(ctx.terminalTag);
    const tn = put(ctx.terminalName);
    const mn = put(ctx.merchantName);
    const dv = put(ctx.deviceId);
    const ak = put(ctx.authKey);
    if (b !== undefined) next.branchId = b;
    if (tid !== undefined) next.terminalId = tid;
    if (t !== undefined) next.terminalCode = t;
    if (g !== undefined) next.terminalTag = g;
    if (tn !== undefined) next.terminalName = tn;
    if (mn !== undefined) next.merchantName = mn;
    if (dv !== undefined) next.deviceId = dv;
    if (ak !== undefined) next.authKey = ak;
    current = next;
    persist();
    emit();
    return current;
  } catch {
    return current;
  }
}

/** Cermin konteks terminal sesi aktif; null bila belum login. */
export function getSessionTerminal(): SessionTerminalContext | null {
  const s = getSession();
  if (!s) return null;
  return {
    ...(s.branchId ? { branchId: s.branchId } : {}),
    ...(s.terminalId ? { terminalId: s.terminalId } : {}),
    ...(s.terminalCode ? { terminalCode: s.terminalCode } : {}),
    ...(s.terminalTag ? { terminalTag: s.terminalTag } : {}),
    ...(s.terminalName ? { terminalName: s.terminalName } : {}),
    ...(s.merchantName ? { merchantName: s.merchantName } : {}),
    ...(s.deviceId ? { deviceId: s.deviceId } : {}),
  };
}

/** Tag terminal sesi sebagai tipe model-5 (legacy/kosong => full_access). */
export function getSessionTag(): TerminalTag {
  return resolveTerminalTag(getSession()?.terminalTag);
}

/**
 * Data sapaan merchant-terminal untuk layar login ("welcome merchant X
 * terminal Y"). Literal netral ID/EN, tanpa kunci i18n baru.
 */
export function getSessionWelcome(): {
  merchantName: string;
  terminalName: string;
  text: string;
} {
  const s = getSession();
  const merchantName = (s?.merchantName ?? '').trim() || (s?.outlet ?? '').trim();
  const terminalName =
    (s?.terminalName ?? '').trim() || (s?.terminalCode ?? '').trim();
  const text =
    merchantName && terminalName
      ? `${merchantName} · ${terminalName}`
      : merchantName || terminalName;
  return { merchantName, terminalName, text };
}
