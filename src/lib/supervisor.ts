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
import { tOf } from './i18n';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

let attempts = 0;
let lockedUntil = 0;

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

/** Catat 1 kegagalan; kunci sementara bila batas tercapai. */
function fail(code: Exclude<SupervisorCode, 'ok' | 'locked'>, message: string): AuthResult {
  attempts += 1;
  if (attempts >= MAX_ATTEMPTS) {
    lockedUntil = Date.now() + LOCK_MS;
    return locked();
  }
  return { ok: false, code, message };
}

function locked(): AuthResult {
  const msg = tOf('sup_locked').replace('{n}', String(lockRemainingSec()));
  return { ok: false, code: 'locked', message: msg };
}

/** Minta persetujuan supervisor ke server; offline selalu ditolak. */
export async function authorizeSupervisor(pin: string): Promise<AuthResult> {
  const clean = pin.replace(/[^0-9]/g, '').slice(0, 6);
  if (clean.length !== 6) {
    return { ok: false, code: 'invalid', message: tOf('sup_invalid') };
  }
  // Kunci kedaluwarsa memberi jendela baru; kunci aktif menolak tanpa panggil server.
  if (lockedUntil !== 0 && !isLocked()) {
    attempts = 0;
    lockedUntil = 0;
  }
  if (isLocked()) return locked();
  if (!getBaseUrl()) {
    return fail('unconfigured', tOf('sup_unconfigured'));
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
    return { ok: true, code: 'ok', message: tOf('sup_ok') };
  } catch {
    return fail('offline', tOf('sup_offline'));
  }
}
