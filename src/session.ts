/**
 * Sesi kasir di memori + persistensi AsyncStorage (lib/storage.ts) agar
 * sesi bertahan restart di web + native. API tetap sinkron seperti semula.
 * C4 (SESI-C): authToken JWT E01 TAK PERNAH ke AsyncStorage — salinan
 * persistennya milik expo-secure-store (lihat blok C4 di bawah); memori
 * Session.authToken tetap sumber sinkron pembaca bearer.
 */
import * as SecureStore from 'expo-secure-store';
import { getItem, removeItem, setItem } from './lib/storage';
import {
  parseDeviceRole,
  resolveTerminalTag,
  type TerminalTag,
} from './lib/deviceRole';
import { hashPin, verifyPinHash } from './lib/pin';
import type { PinRecord } from './lib/pin';
import { normalizeMerchantType } from './lib/posModes';

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
  /** Token sesi server dari E01 terminal-login single-stage (live 2026-10-17).
   * C4 (SESI-C, CLOSED): HANYA di memori + SecureStore (saveAuthTokenStore) —
   * persist() di bawah men-strip-nya dari JSON AsyncStorage. */
  authToken?: string;
  /** Refresh token sesi server (E01 + rotasi terminal-refresh T-AUTH-REFRESH).
   * C4-extended: HANYA di memori + SecureStore (saveRefreshTokenStore) —
   * persist() men-strip-nya dari JSON AsyncStorage, disejajarkan dengan
   * authToken agar tak bocor lintas-user/sesi. */
  refreshToken?: string;
  /** Waktu login ISO (dibuat saat loginEmployee/saveSession). */
  loginAt?: string;
  /** true = sesi dibuat offline dari grant cache (rekonsiliasi saat reconnect). */
  offline?: boolean;
  /** GAP-14 owner-override attribution: 'owner:<approverUserId>' bila sesi
   * dikunci lewat PIN owner sebagai pengganti PIN staff di modal login
   * (LoginScreen submitStaffPin). Absen = login normal tanpa override.
   * Murni jejak audit lokal (persist ikut sesi); bukan kredensial. */
  approvedBy?: string;
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
  /** Q1 (2026-10-17): branch IS merchant — nama merchant hanya cermin display.
   * Opsional; diderivasi dari branchName saat disimpan (saveBinding/adopt).
   * Jangan dipakai sebagai kunci/otorisasi. */
  merchantName?: string;
  /** C2 (SESI-C): tipe merchant untuk daftar mode kasir (RESTAURANT default
   * bila tak diketahui — [ASUMSI] koordinator; penolakan BE ditandai BLOCKED
   * jujur). Diderivasi dari body E01 bila BE mengirim merchantType
   * (readMerchantTypeFromLoginBody; FAKTA 2026-10-20: BE belum mengirim →
   * default), dipertahankan lintas re-bind terminal yang sama. BUKAN
   * otorisasi — gate izin tetap milik access.ts + server. */
  merchantType?: string;
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
 * pinVersion = versi PIN hybrid dari E29 pin-verify (0 = belum diketahui):
 * cache PIN lokal diinvalidasi saat sync bila versi server berbeda.
 * Satu user boleh memegang N terminal (kasir+dapur+N view, kapasitas per-tag
 * di server) — store menyimpan SATU grant per triple (grant-map F1).
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
  /** Versi PIN server (E29 pinVersion); default 0 bila belum diketahui. */
  pinVersion: number;
}

/** Triple identitas grant (kunci grant-map). */
export interface GrantTriple {
  userId: string;
  terminalId: string;
  deviceId: string;
}

/**
 * Revoke sesi yang masih terutang ke server (SPEC-TERMINAL-SESSION §7/O1):
 * logout lokal langsung berlaku di device; revoke E06 server-side menyusul
 * (jujur, bukan bypass) untuk di-flush worker sync (flushPendingRevokes).
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
/** Grant-map F1: satu grant per triple user|terminal|device (multi-terminal). */
let grantMap: Record<string, Grant> = {};
/** Kunci triple grant aktif (sesi berjalan); null = belum ada. */
let activeGrantKey: string | null = null;
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
  if (current) {
    // C4: authToken TAK PERNAH ke AsyncStorage plaintext — strip sebelum
    // stringify; salinan persistennya milik SecureStore (saveAuthTokenStore,
    // dicerminkan saveSession). Pembaca bearer sinkron (server.ts/sse.ts/
    // terminalContract.ts) tetap memakai Session.authToken di memori.
    const scrubbed: Session = { ...current };
    delete scrubbed.authToken;
    delete scrubbed.refreshToken;
    void setItem(LS_SESSION, JSON.stringify(scrubbed));
  } else void removeItem(LS_SESSION);
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
      // C4: migrasi-scrub sesi lama — token plaintext warisan (pra-C4) pindah
      // ke SecureStore sekali, lalu re-persist menimpa simpanan plaintext.
      // Guard identitas (current === parsed): login yang menyusul restore
      // tak boleh tokennya ditimpa salinan basi user lain.
      const legacyToken = parsed.authToken ? String(parsed.authToken) : '';
      const legacyRefresh = parsed.refreshToken ? String(parsed.refreshToken) : '';
      delete parsed.authToken;
      delete parsed.refreshToken;
      if (legacyToken && current === parsed) {
        void saveAuthTokenStore(legacyToken)
          .then(() => {
            if (current === parsed) persist();
          })
          .catch(() => {});
      }
      if (legacyRefresh && current === parsed) {
        void saveRefreshTokenStore(legacyRefresh).catch(() => {});
      }
      // C4: hidrasi malas — salinan SecureStore kembali ke memori. Guard ganda:
      // sesi hasil restore ini + BUKAN sesi offline (offline tak memegang token
      // server; lihat saveSession yang membersihkan salinan saat tanpa token).
      void loadAuthTokenStore()
        .then((t) => {
          if (t && current === parsed && !current.authToken && !current.offline) {
            current.authToken = t;
          }
        })
        .catch(() => {});
      // T-AUTH-REFRESH: hidrasi refresh token disejajarkan dengan authToken.
      void loadRefreshTokenStore()
        .then((t) => {
          if (t && current === parsed && !current.refreshToken && !current.offline) {
            current.refreshToken = t;
          }
        })
        .catch(() => {});
    } catch {
      /* abaikan */
    }
  });
}

// ---------------------------------------------------------------------------
// C4 (SESI-C): salinan persisten authToken di SecureStore (pola lib/pin.ts).
// AsyncStorage HANYA fallback bertanda-TODO bila SecureStore tak tersedia
// (web) — build produksi wajib dev-client agar OS-level terenkripsi.
// Semua fungsi tak pernah melempar (fire-and-forget aman via void).
// ---------------------------------------------------------------------------

/** Kunci SecureStore (+fallback AsyncStorage) salinan persisten authToken. */
const LS_AUTH_TOKEN = 'genfity.session.authToken';

/** Tulis salinan persisten token; string kosong = buang salinan (anti basi). */
export async function saveAuthTokenStore(token: string): Promise<void> {
  const t = String(token ?? '').trim();
  if (!t) {
    await clearAuthTokenStore();
    return;
  }
  try {
    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.setItemAsync(LS_AUTH_TOKEN, t);
      return;
    }
  } catch {
    /* jatuh ke fallback di bawah */
  }
  try {
    await setItem(LS_AUTH_TOKEN, t);
  } catch {
    /* abaikan */
  }
}

/** Baca salinan persisten token; '' = tak ada. */
export async function loadAuthTokenStore(): Promise<string> {
  try {
    const raw = await SecureStore.getItemAsync(LS_AUTH_TOKEN);
    if (raw) return String(raw).trim();
  } catch {
    /* coba fallback di bawah */
  }
  try {
    const fb = await getItem(LS_AUTH_TOKEN);
    return String(fb ?? '').trim();
  } catch {
    return '';
  }
}

/** Buang salinan persisten token (SecureStore + fallback). Idempoten. */
export async function clearAuthTokenStore(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LS_AUTH_TOKEN);
  } catch {
    /* lanjut ke fallback di bawah */
  }
  try {
    await removeItem(LS_AUTH_TOKEN);
  } catch {
    /* abaikan */
  }
}

// ---------------------------------------------------------------------------
// T-AUTH-REFRESH: salinan persisten refreshToken di SecureStore (pola sama
// dengan authToken di atas). Refresh token TIDAK PERNAH di AsyncStorage
// plaintext — SecureStore dulu, fallback AsyncStorage hanya bila SecureStore
// tak tersedia (web). Semua fungsi tak pernah melempar.
// ---------------------------------------------------------------------------

/** Kunci SecureStore (+fallback AsyncStorage) salinan persisten refreshToken. */
const LS_REFRESH_TOKEN = 'genfity.session.refreshToken';

/** Tulis salinan persisten refresh token; string kosong = buang salinan. */
export async function saveRefreshTokenStore(token: string): Promise<void> {
  const t = String(token ?? '').trim();
  if (!t) {
    await clearRefreshTokenStore();
    return;
  }
  try {
    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.setItemAsync(LS_REFRESH_TOKEN, t);
      return;
    }
  } catch {
    /* jatuh ke fallback di bawah */
  }
  try {
    await setItem(LS_REFRESH_TOKEN, t);
  } catch {
    /* abaikan */
  }
}

/** Baca salinan persisten refresh token; '' = tak ada. */
export async function loadRefreshTokenStore(): Promise<string> {
  try {
    const raw = await SecureStore.getItemAsync(LS_REFRESH_TOKEN);
    if (raw) return String(raw).trim();
  } catch {
    /* coba fallback di bawah */
  }
  try {
    const fb = await getItem(LS_REFRESH_TOKEN);
    return String(fb ?? '').trim();
  } catch {
    return '';
  }
}

/** Buang salinan persisten refresh token (SecureStore + fallback). Idempoten. */
export async function clearRefreshTokenStore(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LS_REFRESH_TOKEN);
  } catch {
    /* lanjut ke fallback di bawah */
  }
  try {
    await removeItem(LS_REFRESH_TOKEN);
  } catch {
    /* abaikan */
  }
}

// ---------------------------------------------------------------------------
// TAHAP-1 REMEMBER-ME: akun terakhir yang dicentang "ingat saya".
// BUKAN rahasia: hanya username + nama tampilan (tanpa password/token) →
// AsyncStorage cukup. Sesi/token tetap di SecureStore dan dibuang saat
// logout; remembered ini SENGAJA bertahan melewati logout (itulah gunanya:
// prefilling + sapaan "Halo kembali"). Dibuang hanya via "ganti pengguna"
// atau preferensi dimatikan. Tak pernah melempar.
// ---------------------------------------------------------------------------

export interface RememberedAccount {
  username: string;
  name: string;
}

const LS_REMEMBERED = 'genfity.session.remembered';

/** Baca akun yang diingat; null = tak ada / rusak (fail-closed). */
export async function loadRememberedAccount(): Promise<RememberedAccount | null> {
  try {
    const raw = await getItem(LS_REMEMBERED);
    if (!raw) return null;
    const p = JSON.parse(String(raw)) as Partial<RememberedAccount>;
    const username = String(p.username ?? '').trim();
    if (!username) return null;
    return { username, name: String(p.name ?? '').trim() };
  } catch {
    return null;
  }
}

/** Tulis akun yang diingat; username kosong = buang (anti baris sampah). */
export async function saveRememberedAccount(a: { username: string; name?: string }): Promise<void> {
  const username = String(a.username ?? '').trim();
  if (!username) {
    await clearRememberedAccount();
    return;
  }
  try {
    await setItem(LS_REMEMBERED, JSON.stringify({ username, name: String(a.name ?? '').trim() }));
  } catch {
    /* abaikan */
  }
}

/** Buang akun yang diingat. Idempoten. */
export async function clearRememberedAccount(): Promise<void> {
  try {
    await removeItem(LS_REMEMBERED);
  } catch {
    /* abaikan */
  }
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
    // Q1: merchantName opsional (binding lama tanpa kunci ini tetap valid).
    (b['merchantName'] === undefined || typeof b['merchantName'] === 'string') &&
    // C2: merchantType opsional (binding lama tanpa kunci ini tetap valid).
    (b['merchantType'] === undefined || typeof b['merchantType'] === 'string') &&
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
    // Q1: materialisasi cermin display — simpanan selalu ada string.
    merchantName: (b.merchantName ?? b.branchName ?? '').trim(),
    // C2: materialisasi tipe (default RESTAURANT = [ASUMSI] koordinator).
    merchantType: normalizeMerchantType(b.merchantType),
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

/** Masukan adopsi binding (F6): device mengikat tepat satu terminal. */
export interface AdoptTerminalBindingInput {
  terminalId: string;
  terminalCode: string;
  branchId: string;
  branchName: string;
  /** Satu dari 5 tag kanonis (divalidasi parseDeviceRole, fail-closed). */
  tag: string;
  deviceId: string;
  merchantName?: string;
  /** C2: tipe merchant dari body E01 ('' = tak diketahui → default saat baca). */
  merchantType?: string;
}

/**
 * Adopsi binding terminal baru — UNIFIKASI TULIS 3 store (F6+F22):
 * logout + clearGrant, lalu tulis binding ke SEMUA store: sesi (LS_BINDING
 * via saveBinding), kontrak terminalContract v1, dan server store
 * (config/server setTerminal). Tag asing → throw (fail-closed, tanpa default
 * diam-diam). setPinOpen BUKAN urusan modul ini (milik layar PIN, paket lain).
 *
 * Anti-siklus: terminalContract mengimpor statis modul ini, begitu pula
 * pemakaian lazy-require di config/server — maka kedua store luar ditulis via
 * lazy-require searah (pola sama dengan logout→realtime di bawah). terminalApi
 * SENGAJA tak diimpor (jalur network milik paket lain).
 */
export function adoptTerminalBinding(
  input: AdoptTerminalBindingInput,
): Binding {
  const terminalId = String(input?.terminalId ?? '').trim();
  const terminalCode = String(input?.terminalCode ?? '').trim();
  const branchId = String(input?.branchId ?? '').trim();
  const branchName = String(input?.branchName ?? '').trim();
  const deviceId = String(input?.deviceId ?? '').trim();
  const tag = parseDeviceRole(input?.tag);
  if (!terminalId || !terminalCode || !branchId || !branchName || !deviceId) {
    throw new Error('[session] adoptTerminalBinding: binding tak lengkap');
  }
  if (!tag) {
    throw new Error('[session] adoptTerminalBinding: tag terminal tak dikenal');
  }
  const prev = binding;
  // Q1: merchantName hanya cermin — input > binding lama > branchName (selalu
  // non-kosong di titik ini, lolos validasi di atas).
  const merchantName =
    String(input?.merchantName ?? '').trim() || prev?.merchantName || branchName;
  // Sesi user lama berakhir di device ini; binding lama tak boleh terbawa.
  // Grant-map F1: hanya triple device ini yang dibuang (device pindah
  // terminal → triple lama basi); grant user lain di device ini dipertahankan.
  logout();
  clearGrantsForDevice(deviceId);
  const boundAt = new Date().toISOString();
  const next = saveBinding({
    terminalId,
    terminalCode,
    branchId,
    branchName,
    merchantName,
    // C2: input E01 > binding lama > default RESTAURANT (di saveBinding).
    // BUKAN otorisasi — hanya daftar mode kasir.
    merchantType: normalizeMerchantType(input?.merchantType ?? prev?.merchantType),
    tag,
    // Pairing 1:1 (BE E15) dipertahankan hanya bila terminalnya sama.
    ...(prev && prev.terminalId === terminalId && prev.pairedKasirId
      ? { pairedKasirId: prev.pairedKasirId }
      : {}),
    ...(prev && prev.terminalId === terminalId && prev.pairedViewId
      ? { pairedViewId: prev.pairedViewId }
      : {}),
    deviceId,
    boundAt,
  });
  // Cermin ke kontrak v1 (async, fire-and-forget — store sesi kanonis sudah
  // tertulis di atas sehingga kegagalan cermin tak membatalkan bind).
  try {
    const tc = require('./lib/terminalContract') as typeof import('./lib/terminalContract');
    void Promise.resolve(
      tc.saveBinding({
        branchId: next.branchId,
        branchName: next.branchName,
        terminalId: next.terminalId,
        terminalCode: next.terminalCode,
        terminalName: next.terminalCode,
        tag,
        deviceId: next.deviceId ?? deviceId,
        boundAt: next.boundAt,
      }),
    ).catch(() => {
      /* abaikan: cermin best-effort */
    });
  } catch {
    /* abaikan: cermin best-effort */
  }
  // Cermin ke server store (sinkron, fire-and-forget di dalamnya).
  try {
    const srv = require('./config/server') as typeof import('./config/server');
    srv.setTerminal({
      terminalCode: next.terminalCode,
      branchId: next.branchId,
      branchName: next.branchName,
      tag: next.tag,
      // S7: cerminkan ID numerik BE agar supervisor-approve V1 bisa memakai
      // path /terminals/{id} tanpa input manual (binding lama: kosong → dialog
      // minta isi eksplisit, fail-closed).
      terminalIdBe: next.terminalId,
    });
  } catch {
    /* abaikan: cermin best-effort */
  }
  return next;
}

/**
 * Keluar dari cabang di SEMUA store (F22, pasangan adoptTerminalBinding):
 * logout + hapus SEMUA binding (sesi, kontrak v1, server store) + clear
 * grant. Dipakai unbind/ganti cabang. setPinOpen BUKAN urusan modul ini.
 */
export function exitBranchAll(): void {
  logout();
  clearGrant();
  clearBinding();
  try {
    const tc = require('./lib/terminalContract') as typeof import('./lib/terminalContract');
    void Promise.resolve(tc.clearBinding()).catch(() => {
      /* abaikan: cermin best-effort */
    });
  } catch {
    /* abaikan: cermin best-effort */
  }
  try {
    const srv = require('./config/server') as typeof import('./config/server');
    srv.setTerminal({ terminalCode: '', branchId: '', branchName: '' });
  } catch {
    /* abaikan: cermin best-effort */
  }
}

// ---------------------------------------------------------------------------
// Reclaim tanpa login ulang (tugas E): sesi direclaim dari tempat lain →
// device kembali ke PILIH TERMINAL dengan token auth tetap tersimpan (TANPA
// login ulang). Beda dengan revokeKickedSession (yang melempar ke Login
// dengan sesi+token dibuang) dan exitBranchAll (logout penuh).
// ---------------------------------------------------------------------------

type ReclaimListener = () => void;
const reclaimListeners = new Set<ReclaimListener>();

/** Langganan momen reclaim (GuardedStacks navigasi ke TerminalPicker). */
export function subscribeReclaim(fn: ReclaimListener): () => void {
  reclaimListeners.add(fn);
  return () => {
    reclaimListeners.delete(fn);
  };
}

function emitReclaim(): void {
  reclaimListeners.forEach((l) => {
    try {
      l();
    } catch {
      /* abaikan */
    }
  });
}

/**
 * Lepas binding terminal TAPI pertahankan sesi + token auth (memori +
 * SecureStore tak disentuh — tanpa logout, tanpa clearAuthTokenStore).
 * - Binding dihapus di SEMUA store (sesi, kontrak v1, server store).
 * - Grant HANYA triple device ini yang dicabut (pola grant-map F1).
 * - Field terminal sesi digunduli (terminalId/Code/Tag dikosongkan;
 *   branchId/outlet dipertahankan untuk param picker) lalu persist.
 * - Realtime dimatikan (feed milik terminal lama); hidup lagi saat
 *   login/bind berikut.
 * Kembali true bila ada binding/sesi yang dilepas. Tak pernah melempar.
 */
export function releaseBindingForReclaim(): boolean {
  try {
    const hadBinding = binding !== null;
    const hadSession = current !== null;
    if (!hadBinding && !hadSession) return false;
    const deviceId = String(current?.deviceId ?? binding?.deviceId ?? '').trim();
    try {
      if (deviceId) clearGrantsForDevice(deviceId);
    } catch {
      /* abaikan */
    }
    binding = null;
    void removeItem(LS_BINDING);
    try {
      const tc = require('./lib/terminalContract') as typeof import('./lib/terminalContract');
      void Promise.resolve(tc.clearBinding()).catch(() => {
        /* abaikan: cermin best-effort */
      });
    } catch {
      /* abaikan: cermin best-effort */
    }
    try {
      const srv = require('./config/server') as typeof import('./config/server');
      srv.setTerminal({ terminalCode: '', branchId: '', branchName: '' });
    } catch {
      /* abaikan: cermin best-effort */
    }
    // Gunduli field terminal sesi (branchId/outlet = konteks picker).
    if (current) {
      current.terminalId = '';
      current.terminalCode = '';
      current.terminalTag = '';
      persist();
    }
    postLoginRoute = null;
    emit();
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
    emitReclaim();
    return true;
  } catch {
    return false;
  }
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

/** Kunci kanonis grant-map: user|terminal|device (trim, case-sensitive). */
export function grantKeyOf(t: GrantTriple): string {
  return `${String(t.userId ?? '').trim()}|${String(t.terminalId ?? '').trim()}|${String(t.deviceId ?? '').trim()}`;
}

function normPinVersion(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function normalizeGrant(g: Grant): Grant {
  return {
    userId: g.userId.trim(),
    terminalId: g.terminalId.trim(),
    deviceId: g.deviceId.trim(),
    staffPinHash: g.staffPinHash,
    grantedAt: g.grantedAt,
    expiresAt: g.expiresAt,
    pinVersion: normPinVersion((g as { pinVersion?: unknown }).pinVersion),
  };
}

interface GrantStoreEnvelope {
  v: 1;
  active?: string;
  grants: Record<string, Grant>;
}

function persistGrantMap(): void {
  try {
    const env: GrantStoreEnvelope = { v: 1, grants: grantMap };
    if (activeGrantKey) env.active = activeGrantKey;
    void setItem(LS_GRANT, JSON.stringify(env));
  } catch {
    /* abaikan */
  }
}

/** Baca store ke memori (hanya mengisi bila memori kosong — tak pernah
 *  menimpa grant yang lebih baru hasil saveGrant/touchGrant). Legacy
 *  single-grant JSON otomatis dimigrasi menjadi satu entri grant-map. */
async function loadGrantStore(): Promise<Grant | null> {
  grantRestored = true;
  if (!grant && Object.keys(grantMap).length === 0) {
    try {
      const raw = await getItem(LS_GRANT);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const env = parsed as Partial<GrantStoreEnvelope>;
        if (env && typeof env === 'object' && env.grants && typeof env.grants === 'object') {
          for (const [k, v] of Object.entries(env.grants)) {
            if (isGrantLike(v)) grantMap[k] = normalizeGrant(v);
          }
          if (typeof env.active === 'string' && grantMap[env.active]) {
            activeGrantKey = env.active;
            grant = grantMap[env.active];
          }
        } else if (isGrantLike(parsed)) {
          // Legacy: satu grant polos → migrasi ke map + persist envelope.
          const g = normalizeGrant(parsed);
          const k = grantKeyOf(g);
          grantMap[k] = g;
          activeGrantKey = k;
          grant = g;
          persistGrantMap();
        }
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

/**
 * Grant aktif sesi berjalan; opsional triple untuk baca terarah tanpa
 * mengubah sesi aktif. Tanpa triple: grant aktif memori, fallback satu-satunya
 * entri map (kompatibilitas single-terminal lama), else null.
 */
export function getGrant(triple?: GrantTriple): Grant | null {
  restoreGrant();
  if (triple && (triple.userId || triple.terminalId || triple.deviceId)) {
    const g = grantMap[grantKeyOf(triple)];
    return g ?? null;
  }
  if (grant) return grant;
  const keys = Object.keys(grantMap);
  if (keys.length === 1) {
    grant = grantMap[keys[0]];
    activeGrantKey = keys[0];
    return grant;
  }
  return null;
}

/**
 * Simpan grant dari hasil auth online (E01 terminal-login login-first F1).
 * Menulis ke grant-map di bawah kunci triple-nya SEKALIGUS menjadikannya
 * grant aktif. Menolak plaintext PIN/password bila ikut terbawa di objek
 * (fail-fast, bukan bypass diam).
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
  const n = normalizeGrant(g);
  const k = grantKeyOf(n);
  grantMap[k] = n;
  grant = n;
  activeGrantKey = k;
  persistGrantMap();
  emit();
  return grant;
}

/**
 * Hapus grant cache. Tanpa triple: hapus SEMUA (semantik lama — dipakai
 * re-bind/ganti cabang/exitBranchAll). Dengan triple: hapus hanya entri itu
 * (dipakai revokeKickedSession agar terminal lain user yang sama tak ikut
 * tercabut). SPEC §7.
 */
export function clearGrant(triple?: GrantTriple): void {
  if (triple) {
    const k = grantKeyOf(triple);
    delete grantMap[k];
    if (activeGrantKey === k) {
      activeGrantKey = null;
      grant = null;
    }
  } else {
    grantMap = {};
    activeGrantKey = null;
    grant = null;
  }
  try {
    if (Object.keys(grantMap).length === 0) {
      void removeItem(LS_GRANT);
    } else {
      persistGrantMap();
    }
  } catch {
    /* abaikan */
  }
  emit();
}

/**
 * Hapus SEMUA entri grant milik satu device (dipakai adoptTerminalBinding:
 * device pindah terminal → triple lama device ini basi; grant user yang sama
 * di device LAIN tak tersentuh karena store per-device, dan grant user lain
 * di device ini dipertahankan).
 */
export function clearGrantsForDevice(deviceId: string): void {
  restoreGrant();
  const dev = String(deviceId ?? '').trim();
  if (!dev) return;
  let changed = false;
  for (const k of Object.keys(grantMap)) {
    if (grantMap[k]?.deviceId === dev) {
      delete grantMap[k];
      changed = true;
      if (activeGrantKey === k) {
        activeGrantKey = null;
        grant = null;
      }
    }
  }
  if (!changed) return;
  try {
    if (Object.keys(grantMap).length === 0) {
      void removeItem(LS_GRANT);
    } else {
      persistGrantMap();
    }
  } catch {
    /* abaikan */
  }
  emit();
}

/**
 * Tambal pinVersion satu entri grant (sumber versi PIN hybrid E29).
 * Mengembalikan grant terbarui, atau null bila triple tak punya grant.
 */
export function setGrantPinVersion(triple: GrantTriple, version: number): Grant | null {
  restoreGrant();
  const k = grantKeyOf(triple);
  const g = grantMap[k];
  if (!g) return null;
  const n = { ...g, pinVersion: normPinVersion(version) };
  grantMap[k] = n;
  if (activeGrantKey === k) grant = n;
  persistGrantMap();
  emit();
  return n;
}

/** Baca pinVersion tersimpan satu triple; null = tak ada grant (wajib online). */
export function getGrantPinVersion(triple: GrantTriple): number | null {
  restoreGrant();
  const g = grantMap[grantKeyOf(triple)];
  return g ? g.pinVersion : null;
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
  /** Versi PIN server (E29 pinVersion) bila sudah diketahui saat membangun. */
  pinVersion?: number;
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
  return { userId, terminalId, deviceId, staffPinHash, grantedAt, expiresAt, pinVersion: normPinVersion(args.pinVersion) };
}

/**
 * Cocokkan PIN kandidat ke hash grant tersimpan (login offline L1).
 * Triple opsional = verifikasi terarah (dipakai LoginScreen offline yang
 * sudah tahu user+terminal+device); tanpa triple = grant aktif (kompatibel).
 */
export function verifyGrantPin(pin: string, triple?: GrantTriple): boolean {
  restoreGrant();
  const g = triple ? (grantMap[grantKeyOf(triple)] ?? null) : grant;
  if (!g) return false;
  const clean = String(pin ?? '');
  if (!clean) return false;
  try {
    return verifyPinHash(clean, g.staffPinHash);
  } catch {
    return false;
  }
}

/**
 * Perpanjangan sliding window saat auth online sukses (Q6 CLOSED):
 * grantedAt=sekarang, expiresAt=sekarang+policy. G7 fail-closed (audit
 * 2026-10-17): prasyarat validitas (grant ada + triple cocok + belum
 * kedaluwarsa) dicek DULU; prasyarat gagal → null TANPA mencetak ulang
 * (no mint). null = jalur offline ditolak (deny offline path) — pemanggil
 * non-LoginScreen WAJIB menangani null; LoginScreen dimiliki paket lain.
 */
export function touchGrant(): Grant | null {
  restoreGrant();
  restoreBinding();
  restore();
  if (!grant) return null;
  const u = String(current?.userId ?? current?.username ?? '').trim();
  const t = String(binding?.terminalId ?? current?.terminalId ?? '').trim();
  let problem: GrantProblem | null;
  if (u && t) {
    const d = String(binding?.deviceId ?? current?.deviceId ?? '').trim();
    problem = describeGrantProblem(u, t, d || undefined);
  } else {
    // Tanpa identitas referensi (tak ada sesi/binding): hanya prasyarat
    // kedaluwarsa yang bisa dinilai — triple-mismatch tak terputus di sini.
    const now = Date.now();
    const exp = Date.parse(grant.expiresAt);
    const grantedMs = Date.parse(grant.grantedAt);
    const cap = Number.isFinite(grantedMs)
      ? grantedMs + getMaxOfflineGrantDays() * DAY_MS
      : exp;
    problem =
      !Number.isFinite(exp) || now >= Math.min(exp, cap)
        ? 'grant-expired'
        : null;
  }
  if (problem !== null) return null;
  const now = Date.now();
  grant = {
    ...grant,
    grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + getMaxOfflineGrantDays() * DAY_MS).toISOString(),
  };
  // Write-through grant-map: entri triple yang sama ikut diperpanjang.
  try {
    const k = grantKeyOf(grant);
    grantMap[k] = grant;
    activeGrantKey = k;
  } catch {
    /* abaikan */
  }
  persistGrantMap();
  emit();
  return grant;
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
  const u = String(userId ?? '').trim();
  const t = String(terminalId ?? '').trim();
  if (!u || !t) return 'grant-mismatch';
  const dev = String(
    deviceId ?? binding?.deviceId ?? current?.deviceId ?? '',
  ).trim();
  if (!dev) return 'grant-mismatch';
  // Grant-map F1: cari entri triple EKSAK (tanpa fallback grant aktif milik
  // triple lain — user multi-terminal tak boleh lolos memakai grant terminal
  // lain).
  const g = grantMap[grantKeyOf({ userId: u, terminalId: t, deviceId: dev })];
  if (!g) return 'no-grant';
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

/**
 * Ambil + hapus revoke terutang sekali-pakai (F22, pola consumeKickNotice):
 * worker sync mem-flush hasilnya ke E06/E07 lalu membuangnya. null = tak ada
 * utang. Tak pernah melempar.
 */
export function consumePendingRevoke(): PendingRevoke | null {
  try {
    restoreRevoke();
    const r = pendingRevoke;
    if (r) clearPendingRevoke();
    return r;
  } catch {
    return pendingRevoke;
  }
}

// ---------------------------------------------------------------------------
// Sesi
// ---------------------------------------------------------------------------

export function getSession(): Session | null {
  restore();
  restoreBinding();
  if (current) {
    // F22: backfill WAJIB persist ke store (bukan sekadar mutasi memori)
    // agar sesi tersimpan ikut membawa konteks terminal hasil (re)bind.
    let dirty = false;
    if (!current.role) {
      current.role = 'Merchant Staff';
      dirty = true;
    }
    // Backfill konteks terminal dari binding bila sesi belum membawanya
    // (mis. sesi lama tersimpan sebelum Fase 1, atau sesudah re-bind).
    // Hanya mengisi yang kosong — cermin paket app-model tak ditimpa.
    if (binding) {
      if (!current.branchId && binding.branchId) {
        current.branchId = binding.branchId;
        dirty = true;
      }
      if (!current.terminalId && binding.terminalId) {
        current.terminalId = binding.terminalId;
        dirty = true;
      }
      if (!current.terminalCode && binding.terminalCode) {
        current.terminalCode = binding.terminalCode;
        dirty = true;
      }
      if (!current.terminalTag && binding.tag) {
        current.terminalTag = binding.tag;
        dirty = true;
      }
      if (!current.deviceId && binding.deviceId) {
        current.deviceId = binding.deviceId;
        dirty = true;
      }
      if (!current.merchantName && binding.merchantName) {
        current.merchantName = binding.merchantName;
        dirty = true;
      }
    }
    if (dirty) persist();
  }
  return current;
}

export function isLoggedIn(): boolean {
  restore();
  return current !== null;
}

/**
 * T-AUTH-REFRESH: baca refresh token sesi aktif (memori dulu, lalu
 * SecureStore bila memori kosong — mis. sesaat sesudah restart sebelum
 * hidrasi malas selesai). '' = tak ada (sesi offline/lokal/legacy) → silent
 * refresh dilarang, panggil mesti gagal fail-closed (paksa login ulang).
 * Sinkron-sampai-memori + async-hidrasi agar tak memblokir hot path 401.
 */
export async function getRefreshToken(): Promise<string> {
  restore();
  const mem = String(current?.refreshToken ?? '').trim();
  if (mem) return mem;
  if (!current || current.offline) return '';
  try {
    const stored = await loadRefreshTokenStore();
    if (stored && current && !current.refreshToken && !current.offline) {
      current.refreshToken = stored;
    }
    return stored;
  } catch {
    return '';
  }
}

/**
 * T-AUTH-REFRESH: terapkan hasil rotasi /auth/terminal-refresh ke sesi aktif
 * (access + refresh BARU, keduanya dicermin ke SecureStore). Guard searah:
 * hanya bila sesi masih sesi yang sama (userId/username cocok) dan bukan
 * offline; kalau tidak, refresh hasil hangus (fail-closed, tanpa mutasi).
 * Mengembalikan true bila diterapkan.
 */
export function applyRefreshedTokens(args: {
  userId?: string;
  username?: string;
  accessToken: string;
  refreshToken: string;
}): boolean {
  restore();
  const access = String(args.accessToken ?? '').trim();
  const refresh = String(args.refreshToken ?? '').trim();
  if (!access || !refresh || !current || current.offline) return false;
  const sameUser =
    (args.userId && current.userId && args.userId === current.userId) ||
    (args.username && current.username && args.username === current.username) ||
    (!args.userId && !args.username);
  if (!sameUser) return false;
  current.authToken = access;
  current.refreshToken = refresh;
  persist();
  void saveAuthTokenStore(access);
  void saveRefreshTokenStore(refresh);
  emit();
  return true;
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
  // C4: cermin SecureStore mengikuti sesi resmi — ada token = simpan, tanpa
  // token (login lokal/offline) = buang salinan lama agar token user
  // sebelumnya tak bocor ke sesi/token user lain (anti token basi lintas-user).
  if (current.authToken) void saveAuthTokenStore(current.authToken);
  else void clearAuthTokenStore();
  // T-AUTH-REFRESH: cermin salinan refresh token mengikuti sesi resmi.
  if (current.refreshToken) void saveRefreshTokenStore(current.refreshToken);
  else void clearRefreshTokenStore();
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
 * Konteks terminal (branch/terminal/device) milik binding — F20: binding
 * SEGAR menang di atas sesi sebelumnya (binding?.x ?? prev?.x) agar take-over
 * kick (SPEC §7/Q13) tetap di terminal yang sama. ctx terminal opsional
 * (F17, dari hasil E01 staff-login paket app-login) menang di atas keduanya;
 * string kosong = tak diubah. Tag ctx divalidasi parseDeviceRole (fail-closed:
 * tag asing diabaikan, konteks lama dipertahankan).
 * authToken/flag offline selalu dibuang di sini (authKey warisan paket
 * app-login tak disentuh): sesi resmi hanya via saveSession sesudah E01
 * (fail-closed, anti token basi).
 */
export function loginEmployee(
  e: { nama: string; username: string; role?: string; userId?: string },
  ctx?: {
    branchId?: string;
    terminalCode?: string;
    terminalTag?: string;
    deviceId?: string;
  },
): Session {
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
  // F20: binding segar di atas prev (urutan dibalik dari versi lama).
  const keepBranch = binding?.branchId ?? prev?.branchId;
  const keepTerminalId = binding?.terminalId ?? prev?.terminalId;
  const keepTerminalCode = binding?.terminalCode ?? prev?.terminalCode;
  const keepTag = binding?.tag ?? prev?.terminalTag;
  const keepDevice = binding?.deviceId ?? prev?.deviceId;
  // Q1 (temuan review Trek 1): merchantName murni cermin display — trim, dan
  // JANGAN warisi prev lintas-cabang. Urutan: cermin binding sendiri >
  // branchName binding sendiri > prev HANYA bila cabang tak berganti.
  const keepMerchant =
    (binding?.merchantName ?? '').trim() ||
    (binding?.branchName ?? '').trim() ||
    (!binding?.branchId || binding.branchId === prev?.branchId
      ? (prev?.merchantName ?? '').trim()
      : '');
  if (keepBranch) current.branchId = keepBranch;
  if (keepTerminalId) current.terminalId = keepTerminalId;
  if (keepTerminalCode) current.terminalCode = keepTerminalCode;
  if (keepTag) current.terminalTag = keepTag;
  if (keepDevice) current.deviceId = keepDevice;
  if (keepMerchant) current.merchantName = keepMerchant;
  // F17: ctx terminal eksplisit (hasil E01) menang di atas binding + prev.
  if (ctx) {
    const cxBranch = String(ctx.branchId ?? '').trim();
    const cxCode = String(ctx.terminalCode ?? '').trim();
    const cxDev = String(ctx.deviceId ?? '').trim();
    const cxTag = parseDeviceRole(ctx.terminalTag);
    if (cxBranch) current.branchId = cxBranch;
    if (cxCode) current.terminalCode = cxCode;
    if (cxTag) current.terminalTag = cxTag;
    if (cxDev) current.deviceId = cxDev;
  }
  delete current.authToken;
  delete current.offline;
  current.loginAt = new Date().toISOString();
  persist();
  // C4: login lokal tanpa token server — salinan SecureStore basi (milik sesi
  // online user sebelumnya) WAJIB dibuang di sini; kalau tidak, restart di
  // bawah sesi lokal ini menghidrasi token user lain (bocor lintas-user).
  // T-AUTH-REFRESH: refresh token ikut dibuang (sesi lokal tak memegang sesi
  // server; silent refresh tanpa refresh token tak bermakna).
  void clearAuthTokenStore();
  void clearRefreshTokenStore();
  emit();
  return current;
}

export function logout(): void {
  if (current) {
    // E06 revoke = POST /auth/terminal-logout (kanonis; /auth/logout memang
    // tak ada — BUKAN 404/zombie): catat utang revoke agar di-flush worker
    // sync (milik lane sync). Binding + grant cache SENGAJA dipertahankan
    // agar login ulang offline masih bisa (SPEC §2).
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
  // C4: logout membuang salinan SecureStore (memori sudah null di atas;
  // tanpa ini salinan bertahan dan bisa terhidrasi ke sesi berikutnya).
  // T-AUTH-REFRESH: refresh ikut dibuang — sesi berakhir, silent refresh
  // pasca-logout dilarang (fail-closed).
  void clearAuthTokenStore();
  void clearRefreshTokenStore();
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
 * C4 (SESI-C): jalur token-hilang — authToken yang SEHARUSNYA ada ternyata
 * tak ada = sesi tak lagi tepercaya: buang salinan SecureStore, hapus grant
 * (akses offline berbasis grant tak boleh bertahan tanpa token server yang
 * sah), lalu logout penuh. Jejak revoke E06 memakai alasan token-loss agar
 * server bisa membedakan dari logout normal. Dipakai completeOnline dengan
 * { requireToken: true } (E01 online terverifikasi E29 tanpa token = payload
 * tak lengkap → gagal fail-closed 'e01-no-token', bukan sesi bisu yang 401
 * di mana-mana). Tak pernah melempar.
 */
export function forceLogoutOnTokenLoss(reason?: string): void {
  const who = current?.userId ?? current?.username;
  // T-AUTH-REFRESH: refresh ikut dibuang — sesi tak tepercaya = tak ada
  // silent refresh (kalau tidak, token basi bisa diperpanjang diam-diam).
  void clearAuthTokenStore();
  void clearRefreshTokenStore();
  try {
    clearGrant();
  } catch {
    /* abaikan */
  }
  try {
    logout();
  } catch {
    /* abaikan */
  }
  try {
    markPendingRevoke({
      ...(who ? { userId: who } : {}),
      reason: reason ?? 'token-loss',
    });
  } catch {
    /* abaikan */
  }
}

// ---------------------------------------------------------------------------
// KICK-NO-LOCAL-REVOKE + kick-no-live-notify (SPEC §7/Q13): perangkat LAMA
// yang sesinya digantikan login lain wajib mencabut sesi + grant lokalnya
// sendiri agar sesi basi tak bisa dipakai lagi. Notif kick disimpan di modul
// agar layar Login yang tampil pasca-revoke bisa menampilkannya via
// consumeKickNotice (sekali tampil, pola yang sama dengan approvals).
// ---------------------------------------------------------------------------

let kickNotice: string | null = null;
const kickListeners = new Set<Listener>();

/** Simpan notif kick untuk ditampilkan layar berikutnya. Tak pernah melempar. */
export function setKickNotice(msg: string): void {
  try {
    kickNotice = String(msg ?? '');
    kickListeners.forEach((l) => {
      try {
        l();
      } catch {
        /* abaikan */
      }
    });
  } catch {
    /* abaikan */
  }
}

/** Ambil + kosongkan notif kick (sekali tampil). */
export function consumeKickNotice(): string | null {
  const m = kickNotice;
  kickNotice = null;
  return m;
}

/** Intip notif kick tanpa mengonsumsi. */
export function peekKickNotice(): string | null {
  return kickNotice;
}

export function subscribeKickNotice(fn: Listener): () => void {
  kickListeners.add(fn);
  return () => {
    kickListeners.delete(fn);
  };
}

/**
 * Cabut sesi + grant lokal perangkat yang ditendang. kickedUserId opsional:
 * bila diisi dan tak cocok dengan sesi aktif (userId/username) → abaikan
 * (false; bukan sesi kami). Tanpa argumen = cabut apa pun yang aktif.
 * Grant-map F1: HANYA entri triple sesi ini yang dicabut — grant user yang
 * sama di terminal lain tetap berlaku.
 * Selalu menandai pendingRevoke (reason 'kicked') agar revoke server-side
 * menyusul saat E06/E07 mendarat. Tak pernah melempar; true = sesi dicabut.
 */
export function revokeKickedSession(kickedUserId?: string): boolean {
  try {
    const who = current?.userId ?? current?.username ?? '';
    const k = String(kickedUserId ?? '').trim();
    if (k && who && k !== who && k !== (current?.username ?? '')) return false;
    if (!current && !grant && Object.keys(grantMap).length === 0) return false;
    try {
      markPendingRevoke({
        ...(who ? { userId: who } : {}),
        reason: 'kicked',
      });
    } catch {
      /* abaikan */
    }
    try {
      // Grant-map F1: HANYA entri triple sesi ini yang dicabut — grant user
      // yang sama di terminal lain (kasir/dapur/view lain) tetap berlaku.
      const tu = String(current?.userId ?? '').trim();
      const tt = String(binding?.terminalId ?? current?.terminalId ?? '').trim();
      const td = String(binding?.deviceId ?? current?.deviceId ?? '').trim();
      if (tu && tt && td) {
        clearGrant({ userId: tu, terminalId: tt, deviceId: td });
      } else {
        clearGrant();
      }
    } catch {
      /* abaikan */
    }
    current = null;
    postLoginRoute = null;
    persist();
    emit();
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
    return true;
  } catch {
    return false;
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
