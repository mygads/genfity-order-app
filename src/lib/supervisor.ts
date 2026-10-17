/**
 * Otorisasi supervisor untuk aksi sensitif (kompliment, non-penjualan, void).
 * Keamanan: PIN supervisor TIDAK disimpan di perangkat dan tidak dicatat di
 * log; validasi selalu ke server saat online. Saat offline/LUPA - GAGAL
 * TERTUTUP (fail-closed): aksi ditolak dengan pesan, bukan dilewatkan.
 * Ini kebalikan dari PIN-lokal-only APK yang dilarang ditiru (AGENTS.md #7).
 *
 * Attempt-limit (T11): 5x gagal beruntun mengunci sementara 60 detik.
 * Pesan lewat kamus i18n (tOf) agar ikut bahasa aktif; kode hasil
 * (AuthResult.code) dipakai layar untuk memilih pesan via t().
 */
import { ApiPath, getBaseUrl } from '../config/server';
import { apiFetch, getApiMode, unwrap } from './apiSource';
import { requireEscalationAccess } from './access';
import { verifyAttendancePin } from './pin';
import { tOf } from './i18n';
import { getItem, setItem } from './storage';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

// Attempt-limit PERSISTEN (AUDIT-ALIGNMENT-TERMINAL baris 15, CONFIRMED-2):
// counter in-memory + cermin AsyncStorage agar tak hilang saat restart.
// Penghitung dihydrate di background saat modul dipakai; titik masuk async
// menunggu hydrate sekali sebelum menilai kunci.
const LS_SUP_ATTEMPTS = 'genfity.supervisor.attempts';
const LS_SUP_LOCKED = 'genfity.supervisor.lockedUntil';

let attempts = 0;
let lockedUntil = 0;
let throttleHydrated = false;
let throttleHydratePromise: Promise<void> | null = null;

function persistThrottle(): void {
  void setItem(LS_SUP_ATTEMPTS, String(attempts));
  void setItem(LS_SUP_LOCKED, String(lockedUntil));
}

function hydrateThrottle(): Promise<void> {
  if (throttleHydrated) return Promise.resolve();
  if (!throttleHydratePromise) {
    throttleHydratePromise = (async () => {
      try {
        const [a, l] = await Promise.all([
          getItem(LS_SUP_ATTEMPTS),
          getItem(LS_SUP_LOCKED),
        ]);
        const pa = a !== null ? Number.parseInt(a, 10) : 0;
        const pl = l !== null ? Number.parseInt(l, 10) : 0;
        attempts = Number.isFinite(pa) && pa > 0 ? Math.min(pa, MAX_ATTEMPTS) : 0;
        lockedUntil = Number.isFinite(pl) && pl > Date.now() ? pl : 0;
        if (lockedUntil === 0 && attempts >= MAX_ATTEMPTS) attempts = 0;
        if (attempts === 0 && pl) persistThrottle();
      } catch {
        /* memori saja bila storage gagal */
      } finally {
        throttleHydrated = true;
      }
    })();
  }
  return throttleHydratePromise;
}

// Sapu latar agar getter sinkron (attemptsLeft/isLocked) benar segera setelah
// restart tanpa menunggu panggilan async pertama.
void hydrateThrottle();

export function attemptsLeft(): number {
  return Math.max(0, MAX_ATTEMPTS - attempts);
}

/** Sisa detik kunci sementara; 0 bila tidak dikunci. */
export function lockRemainingSec(): number {
  return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
}

export function isLocked(): boolean {
  return lockRemainingSec() > 0;
}

export type SupervisorCode =
  | 'ok'
  | 'invalid'
  | 'locked'
  | 'denied'
  | 'offline'
  | 'unconfigured';

export interface AuthResult {
  ok: boolean;
  message: string;
  code: SupervisorCode;
}

/** Catat 1 kegagalan; kunci sementara bila batas tercapai. Persisten (CONFIRMED-2). */
function fail(code: Exclude<SupervisorCode, 'ok' | 'locked'>, message: string): AuthResult {
  attempts += 1;
  if (attempts >= MAX_ATTEMPTS) {
    lockedUntil = Date.now() + LOCK_MS;
    persistThrottle();
    return locked();
  }
  persistThrottle();
  return { ok: false, code, message };
}

function locked(): AuthResult {
  const msg = tOf('sup_locked').replace('{n}', String(lockRemainingSec()));
  return { ok: false, code: 'locked', message: msg };
}

export interface EscalationResult extends AuthResult {
  /** Id user ms_posuser pemilik PIN (hanya bila ok) — untuk audit/eskalasi. */
  userId?: string;
}

/**
 * Fallback eskalasi offline-first untuk aksi sensitif (void, kompliment,
 * non-penjualan). HANYA dipanggil pemanggil bila authorizeSupervisor
 * mengembalikan 'offline'/'unconfigured' (pola yang sama dengan buka/tutup
 * shift di ShiftScreen/EndShiftScreen).
 *
 * Jujur + fail-closed: PIN dicocokkan ke hash lokal (lib/pin.ts), lalu
 * pemegang PIN (APPROVER — belum tentu pemegang sesi login kasir) WAJIB punya
 * hak accessKey via requireEscalationAccess: device HARUS terikat terminal
 * ('terminal-unbound' bila belum bind) + hirarki RBAC untuk userId approver,
 * TANPA gerbang grant sesi kasir (D3-05: grant milik approver tak boleh
 * dituntut, grant basi milik kasir tak boleh diwarisi). PIN salah /
 * tak dikenal / tanpa hak / device unbound = tolak + hitung attempt
 * (kunci 5x beruntun).
 */
export async function verifyLocalEscalation(
  pin: string,
  accessKey: string,
): Promise<EscalationResult> {
  await hydrateThrottle();
  if (isLocked()) return locked();
  const clean = pin.replace(/[^0-9]/g, '');
  if (!clean) {
    // M1: PIN kosong ikut dihitung via fail() agar brute-force tak lolos attempt-limit.
    return fail('invalid', tOf('sup_invalid'));
  }
  let v: { ok: boolean | null; userId?: string };
  try {
    v = await verifyAttendancePin(clean);
  } catch {
    return fail('offline', tOf('sup_offline'));
  }
  if (v.ok !== true || !v.userId) {
    if (v.ok === false) return fail('invalid', tOf('sup_invalid'));
    return fail('offline', tOf('sup_offline'));
  }
  let gate: { ok: boolean };
  try {
    gate = await requireEscalationAccess(v.userId, accessKey);
  } catch {
    return fail('denied', tOf('sup_denied').replace('{n}', String(attemptsLeft() - 1)));
  }
  if (!gate.ok) {
    return fail('denied', tOf('sup_denied').replace('{n}', String(attemptsLeft() - 1)));
  }
  return { ok: true, code: 'ok', message: tOf('sup_ok'), userId: v.userId };
}

/** Minta persetujuan supervisor ke server; offline selalu ditolak. */
export async function authorizeSupervisor(pin: string): Promise<AuthResult> {
  await hydrateThrottle();
  const clean = pin.replace(/[^0-9]/g, '').slice(0, 6);
  // Kunci kedaluwarsa memberi jendela baru; kunci aktif menolak tanpa panggil server.
  if (lockedUntil !== 0 && !isLocked()) {
    attempts = 0;
    lockedUntil = 0;
    persistThrottle();
  }
  if (isLocked()) return locked();
  // M1: PIN kosong/pendek ikut dihitung via fail() agar tebakan 4-digit tak
  // lolos attempt-limit + kunci sementara di Real Mode.
  if (!clean) {
    return fail('invalid', tOf('sup_invalid'));
  }
  // Mode local = offline-first tanpa server (apiFetch short-circuit tanpa
  // dial network): kembalikan 'unconfigured' TANPA gerbang panjang-PIN agar
  // pemanggil shift (buka/tutup) bisa lanjut ke fallback PIN lokal 4-digit
  // (seed: 1111/2222/1234). Validasi 6 digit hanya berlaku untuk jalur server
  // di bawah; pemanggil aksi sensitif (void/refund) tetap fail-closed karena
  // mereka tidak punya fallback lokal.
  if (getApiMode() === 'local' || !getBaseUrl()) {
    return fail('unconfigured', tOf('sup_unconfigured'));
  }
  if (clean.length !== 6) {
    // M1: PIN pendek ikut dihitung (attempt-limit + kunci berlaku).
    return fail('invalid', tOf('sup_invalid'));
  }
  try {
    // Lewat apiFetch (bukan apiPost langsung): Dummy Mode dilayani fixture
    // lokal tanpa PIN keluar perangkat; Real Mode ke server sendiri.
    const r = await apiFetch(ApiPath.supervisorApprove, { body: { pin: clean } });
    if (r.fromDummy && getApiMode() === 'real') {
      // Jaringan gagal lalu jatuh ke dummy: tetap fail-closed, jangan setujui.
      return fail('offline', tOf('sup_offline'));
    }
    const { success, data } = unwrap<{ approved?: unknown }>(r.data);
    if (!r.ok || !success || data.approved !== true) {
      const msg = tOf('sup_denied').replace('{n}', String(attemptsLeft() - 1));
      return fail('denied', msg);
    }
    attempts = 0;
    lockedUntil = 0;
    persistThrottle();
    return { ok: true, code: 'ok', message: tOf('sup_ok') };
  } catch {
    return fail('offline', tOf('sup_offline'));
  }
}
