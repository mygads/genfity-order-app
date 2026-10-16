/**
 * RBAC fondasi: cek hak akses per user dari `ms_posuseraccess` lokal.
 *
 * Hirarki baca per (userId, accessKey):
 * 1. baris eksak (userId, accessKey) - menang mutlak;
 * 2. baris wildcard (userId, '*') - allow-all (dipakai admin seed u-admin);
 * 3. template peran: peran dibaca dari ms_posuser.role, lalu baris
 *    (role, accessKey) dan (role, '*') - mis. template 'kasir' berisi deny
 *    eksplisit untuk aksi sensitif, template 'supervisor' berisi allow;
 * 4. tanpa baris apa pun = fail-open allow (kompatibilitas kasir offline),
 *    KECUALI ada deny eksplisit di tingkat di atas.
 *
 * Fail-open juga berlaku saat DB belum siap (catch -> allow, reason
 * 'db-unready'). Fungsi ini TIDAK PERNAH melempar. Alur PIN supervisor
 * (lib/pin.ts) tidak disentuh - modul ini hanya membaca tabel akses.
 */
import { queryFirst } from './db';

/** Wildcard allow-all di kolom accessKey. */
export const ACCESS_WILDCARD = '*';

/** Kunci akses yang dikenal (didokumentasikan untuk pemilik layar). */
export const ACCESS_KEYS = [
  'order.void',
  'order.cancel',
  'sale.refund',
  'settings.edit',
] as const;

export type AccessKey = (typeof ACCESS_KEYS)[number] | string;

/** Deskripsi tiap kunci untuk dokumentasi pemilik layar. */
export const ACCESS_KEY_DESCRIPTIONS: Record<string, string> = {
  'order.void': 'Void item/pesanan di kasir (perlu supervisor bila kasir di-deny)',
  'order.cancel': 'Batalkan pesanan (perlu supervisor bila kasir di-deny)',
  'sale.refund': 'Refund penjualan (perlu supervisor bila kasir di-deny)',
  'settings.edit': 'Ubah pengaturan (khusus admin/supervisor)',
};

/** Daftar kunci akses yang dikenal (wildcard '*' tidak termasuk). */
export function listAccessKeys(): string[] {
  return [...ACCESS_KEYS];
}

/** Hasil keputusan akses (tidak pernah melempar). */
export interface AccessDecision {
  ok: boolean;
  reason: string;
}

async function findAllow(userId: string, accessKey: string): Promise<number | null> {
  const row = await queryFirst<{ flagAllow: number | null }>(
    `SELECT flagAllow FROM ms_posuseraccess WHERE userId = ? AND accessKey = ? LIMIT 1`,
    [userId, accessKey],
  );
  if (!row || row.flagAllow === null || row.flagAllow === undefined) return null;
  return Number(row.flagAllow) ? 1 : 0;
}

async function decide(userId: string, accessKey: string): Promise<AccessDecision> {
  // 1. Baris eksak per user.
  const exact = await findAllow(userId, accessKey);
  if (exact !== null) {
    return exact === 1
      ? { ok: true, reason: 'explicit-allow' }
      : { ok: false, reason: 'explicit-deny' };
  }

  // 2. Wildcard per user (admin seed: ('u-admin', '*', 1)).
  const wild = await findAllow(userId, ACCESS_WILDCARD);
  if (wild !== null) {
    return wild === 1
      ? { ok: true, reason: 'wildcard-allow' }
      : { ok: false, reason: 'wildcard-deny' };
  }

  // 3. Template peran (userId = nama peran): baris eksak lalu wildcard.
  const urow = await queryFirst<{ role: string | null }>(
    `SELECT role FROM ms_posuser WHERE id = ? LIMIT 1`,
    [userId],
  );
  const role = (urow?.role ?? '').trim();
  if (role) {
    const roleExact = await findAllow(role, accessKey);
    if (roleExact !== null) {
      return roleExact === 1
        ? { ok: true, reason: 'role-allow' }
        : { ok: false, reason: 'role-deny' };
    }
    const roleWild = await findAllow(role, ACCESS_WILDCARD);
    if (roleWild !== null) {
      return roleWild === 1
        ? { ok: true, reason: 'role-wildcard-allow' }
        : { ok: false, reason: 'role-wildcard-deny' };
    }
  }

  // 4. Fail-open: tanpa baris = allow (kompatibilitas kasir offline).
  return { ok: true, reason: 'default-allow' };
}

/**
 * True bila user boleh memakai accessKey. Tidak pernah melempar:
 * DB belum siap -> true (fail-open).
 */
export async function hasAccess(userId: string, accessKey: string): Promise<boolean> {
  try {
    return (await decide(userId, accessKey)).ok;
  } catch {
    return true;
  }
}

/**
 * Gate check: {ok, reason}. Tidak pernah melempar: DB belum siap ->
 * {ok: true, reason: 'db-unready'} (fail-open).
 */
export async function requireAccess(
  userId: string,
  accessKey: string,
): Promise<AccessDecision> {
  try {
    return await decide(userId, accessKey);
  } catch {
    return { ok: true, reason: 'db-unready' };
  }
}
