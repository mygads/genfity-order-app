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
import { getSession } from '../session';

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
  /** R40: identitas approver — diisi jalur lokal dari sesi; jalur server
   * membiarkan null (pemanggil fallback ke user sesi — JANGAN edit pemanggil). */
  userId?: string;
  role?: string;
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
  // R36: kunci kedaluwarsa memberi jendela baru (decay, cermin
  // authorizeSupervisor di bawah — attempts harus meluruh, bukan abadi).
  if (lockedUntil !== 0 && !isLocked()) {
    attempts = 0;
    lockedUntil = 0;
    persistThrottle();
  }
  if (isLocked()) return locked();
  const clean = pin.replace(/[^0-9]/g, '');
  // R38: panjang PIN 4-6 di jalur lokal juga (full-string, tanpa pemotongan).
  // M1: PIN kosong/pendek/panjang ikut dihitung via fail() — tebakan
  // panjang-salah tetap tebakan (it's a guess).
  if (!clean || clean.length < 4 || clean.length > 6) {
    return fail('invalid', tOf('sup_invalid'));
  }
  let v: { ok: boolean | null; userId?: string };
  try {
    v = await verifyAttendancePin(clean);
  } catch {
    // R35: error/thrown = offline — kembalikan hasil offline jujur TANPA
    // membakar attempt (klasifikasi SEBELUM penghitungan).
    return { ok: false, code: 'offline', message: tOf('sup_offline') };
  }
  // R35: null = DB/offline/belum-siap, BUKAN tebakan → early offline jujur,
  // tanpa fail() (tanpa bakar attempt).
  if (v.ok === null) {
    return { ok: false, code: 'offline', message: tOf('sup_offline') };
  }
  if (v.ok !== true || !v.userId) {
    return fail('invalid', tOf('sup_invalid'));
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
  // R40: userId approver + role dari sesi (jalur server membiarkan keduanya
  // null — pemanggil fallback ke user sesi).
  let role: string | undefined;
  try {
    role = getSession()?.role?.trim() || undefined;
  } catch {
    /* abaikan: role opsional */
  }
  return {
    ok: true,
    code: 'ok',
    message: tOf('sup_ok'),
    userId: v.userId,
    ...(role ? { role } : {}),
  };
}

/** Minta persetujuan supervisor ke server; offline selalu ditolak. */
export async function authorizeSupervisor(pin: string): Promise<AuthResult> {
  await hydrateThrottle();
  // R38: TANPA slice(0,6) — cocokkan string PENUH apa adanya (no
  // slice-prefix acceptance: '1234567' tak boleh lolos sebagai '123456').
  const clean = pin.replace(/[^0-9]/g, '');
  // Kunci kedaluwarsa memberi jendela baru; kunci aktif menolak tanpa panggil server.
  if (lockedUntil !== 0 && !isLocked()) {
    attempts = 0;
    lockedUntil = 0;
    persistThrottle();
  }
  if (isLocked()) return locked();
  // R39: status 'unconfigured' (mode local / tanpa base URL) kembali AWAL
  // sebelum fail() — PIN dummy/tak-terkonfigurasi tak membakar attempt.
  // (Perubahan perilaku vs M1: PIN kosong di mode local kini 'unconfigured'
  // tanpa burn; di jalur evaluasi nyata, PIN kosong tetap 'invalid' + burn.)
  // Mode local = offline-first tanpa server: pemanggil shift (buka/tutup)
  // lanjut ke fallback PIN lokal 4-digit (seed: 1111/2222/1234); pemanggil
  // aksi sensitif (void/refund) tetap fail-closed karena mereka tidak punya
  // fallback lokal.
  if (getApiMode() === 'local' || !getBaseUrl()) {
    return { ok: false, code: 'unconfigured', message: tOf('sup_unconfigured') };
  }
  // R38: panjang 4-6 di jalur server juga (full-string); M1: tebakan
  // panjang-salah ikut dihitung (attempt-limit + kunci berlaku).
  if (!clean || clean.length < 4 || clean.length > 6) {
    return fail('invalid', tOf('sup_invalid'));
  }
  try {
    // GAP-5: timeout eksplisit via AbortController (pola callStaffLogin
    // LoginScreen:266) — BE macet tak boleh menggantung UI void/eskalasi
    // selamanya. 15 dtk selaras endpoint auth; AbortError jatuh ke offline
    // jujur di catch bawah (tanpa bakar attempt).
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      try {
        ctrl.abort();
      } catch {
        /* abaikan */
      }
    }, 15_000);
    let r: Awaited<ReturnType<typeof apiFetch>>;
    try {
      // Lewat apiFetch (bukan apiPost langsung): Dummy Mode dilayani fixture
      // lokal tanpa PIN keluar perangkat; Real Mode ke server sendiri.
      r = await apiFetch(ApiPath.supervisorApprove, { body: { pin: clean }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (r.fromDummy && getApiMode() === 'real') {
      // R35: jaringan gagal lalu jatuh ke dummy = offline — fail-closed jujur
      // TANPA membakar attempt (klasifikasi sebelum penghitungan).
      return { ok: false, code: 'offline', message: tOf('sup_offline') };
    }
    const { success, data } = unwrap<{ approved?: unknown }>(r.data);
    if (!r.ok || !success || data.approved !== true) {
      const msg = tOf('sup_denied').replace('{n}', String(attemptsLeft() - 1));
      return fail('denied', msg);
    }
    attempts = 0;
    lockedUntil = 0;
    persistThrottle();
    // R40: jalur server membiarkan userId/role null — pemanggil fallback ke
    // user sesi (JANGAN edit pemanggil).
    return { ok: true, code: 'ok', message: tOf('sup_ok') };
  } catch {
    // R35: network error tak membakar attempt — hasil offline jujur.
    return { ok: false, code: 'offline', message: tOf('sup_offline') };
  }
}
