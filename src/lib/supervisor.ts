/**
 * Otorisasi supervisor untuk aksi sensitif (kompliment, non-penjualan, void).
 * Keamanan: PIN supervisor TIDAK disimpan di perangkat dan tidak dicatat di
 * log; validasi selalu ke server saat online. Saat offline/LUPA — GAGAL
 * TERTUTUP (fail-closed): aksi ditolak dengan pesan, bukan dilewatkan.
 * Ini kebalikan dari PIN-lokal-only APK yang dilarang ditiru (AGENTS.md #7).
 */
import { ApiPath, apiPost, getBaseUrl } from '../config/server';

const MAX_ATTEMPTS = 5;

let attempts = 0;

export function attemptsLeft(): number {
  return Math.max(0, MAX_ATTEMPTS - attempts);
}

export interface AuthResult {
  ok: boolean;
  message: string;
}

/** Minta persetujuan supervisor ke server; offline selalu ditolak. */
export async function authorizeSupervisor(pin: string): Promise<AuthResult> {
  const clean = pin.replace(/[^0-9]/g, '').slice(0, 6);
  if (clean.length !== 6) {
    return { ok: false, message: 'Masukkan 6 digit PIN supervisor.' };
  }
  if (attempts >= MAX_ATTEMPTS) {
    return { ok: false, message: 'Terlalu banyak percobaan. Tutup lalu coba lagi.' };
  }
  if (!getBaseUrl()) {
    attempts += 1;
    return { ok: false, message: 'Server belum diatur — otorisasi ditolak.' };
  }
  try {
    const res = await apiPost(ApiPath.clockIn, { role: 'supervisor', pin: clean });
    if (!res.ok) {
      attempts += 1;
      return { ok: false, message: `Otorisasi ditolak server (${sisa()} percobaan lagi).` };
    }
    attempts = 0;
    return { ok: true, message: 'Disetujui supervisor.' };
  } catch {
    attempts += 1;
    return { ok: false, message: 'Offline — aksi sensitif ditolak demi keamanan.' };
  }
}

function sisa(): number {
  return attemptsLeft();
}
