/**
 * RBAC fondasi: cek hak akses per user dari `ms_posuseraccess` lokal.
 *
 * Hirarki baca per (userId, accessKey):
 * 0. grant terminal (Q6, paket app-model): grant tersimpan tapi user/terminal
 *    tak cocok atau kedaluwarsa = DENY fail-closed; grant valid/absen = lanjut;
 * Jalur eskalasi PIN Owner (requireEscalationAccess, D3-05): gerbang BINDING
 * fail-closed + hirarki 1-4 untuk userId APPROVER — TANPA gerbang grant sesi
 * kasir (approver tak wajib memegang sesi login kasir).
 * 1. baris eksak (userId, accessKey) - menang mutlak;
 * 2. baris wildcard (userId, '*') - allow-all (dipakai admin seed u-admin);
 * 3. template peran: peran dibaca dari ms_posuser.role via id ATAU username
 *    (dinormalisasi via normalizeRole), lalu baris (role, accessKey) dan
 *    (role, '*') - mis. template 'Merchant Staff' berisi deny eksplisit untuk
 *    aksi sensitif, template 'Merchant Owner' berisi allow-all wildcard;
 * 4. tanpa baris apa pun = fail-open allow (kompatibilitas kasir offline),
 *    KECUALI ada deny eksplisit di tingkat di atas.
 *
 * Model peran hanya ada 2: Merchant Owner (akses penuh) dan Merchant Staff
 * (dibatasi: deny order.void/order.cancel/sale.refund/settings.edit, lalu
 * eskalasi PIN Owner). Nilai peran legacy (admin/supervisor/kasir/...) dari
 * server dipetakan ke kanonis via normalizeRole agar template terbaca.
 *
 * Fail-open juga berlaku saat DB belum siap (catch -> allow, reason
 * 'db-unready'); tiap jalur fail-open memancarkan console.warn sekali
 * (warn-once) agar tidak diam. Fungsi ini TIDAK PERNAH melempar. Alur PIN
 * supervisor (lib/pin.ts) tidak disentuh - modul ini hanya membaca tabel akses.
 */
import { queryFirst } from './db';
import {
  describeGrantProblem,
  getBinding,
  getGrant,
  hydrateTerminalState,
  isGrantValid,
} from '../session';

/** Wildcard allow-all di kolom accessKey. */
export const ACCESS_WILDCARD = '*';

/** Nama peran kanonis: pemilik merchant (akses penuh). */
export const ROLE_OWNER = 'Merchant Owner';

/** Nama peran kanonis: staf merchant (dibatasi + eskalasi PIN Owner). */
export const ROLE_STAFF = 'Merchant Staff';

/**
 * Normalisasi peran mentah ke nama kanonis (ROLE_OWNER/ROLE_STAFF).
 * Trim + lowercase; legacy admin/owner/supervisor/spv -> Owner,
 * kasir/cashier/staff -> Staff; tak dikenal -> '' (fail-open default lestari).
 */
export function normalizeRole(raw: unknown): string {
  const key = String(raw ?? '').trim().toLowerCase();
  if (!key) return '';
  if (
    key === ROLE_OWNER.toLowerCase() ||
    key === 'owner' ||
    key === 'admin' ||
    key === 'supervisor' ||
    key === 'spv'
  ) {
    return ROLE_OWNER;
  }
  if (
    key === ROLE_STAFF.toLowerCase() ||
    key === 'staff' ||
    key === 'kasir' ||
    key === 'cashier'
  ) {
    return ROLE_STAFF;
  }
  return '';
}

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
  'order.void': 'Void item/pesanan di kasir (perlu Owner bila Staff di-deny)',
  'order.cancel': 'Batalkan pesanan (perlu Owner bila Staff di-deny)',
  'sale.refund': 'Refund penjualan (perlu Owner bila Staff di-deny)',
  'settings.edit': 'Ubah pengaturan (khusus Owner)',
};

/** Daftar kunci akses yang dikenal (wildcard '*' tidak termasuk). */
export function listAccessKeys(): string[] {
  return [...ACCESS_KEYS];
}

// ---------------------------------------------------------------------------
// Grant terminal offline (AUDIT-ALIGNMENT-TERMINAL baris 19, Q6 CLOSED):
// cache terikat (user, terminal) + TTL 7 hari SLIDING, login pertama wajib
// online (penerbitan grant oleh alur login, paket app-login). Fail-closed:
// grant ada tapi terminal/user tak cocok atau kedaluwarsa => DENY.
// Tanpa grant tersimpan => perilaku lama lestari (fail-open default,
// kompatibilitas kasir offline pra-grant) + warn-once.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Grant terminal offline (AUDIT-ALIGNMENT-TERMINAL baris 19, Q6 CLOSED):
// store tunggal = session.ts (Grant triple-bound user+terminal+device, TTL
// sliding via policy server). Modul ini HANYA gate fail-closed sebelum
// hierarki RBAC: grant ada tapi tak cocok/kedaluwarsa => DENY dengan string
// masalah yang sama dengan requireTerminalAccess ('grant-expired' /
// 'grant-mismatch'); tanpa grant => hierarki lama lestari (fail-open default,
// kompatibilitas kasir offline pra-grant) + warn-once.
// ---------------------------------------------------------------------------

/**
 * Validasi grant sesi saat ini (await hydrate agar tak menilai memori dingin
 * pasca-restart). 'absent' = tak ada grant (biarkan hierarki lama); 'ok' =
 * grant valid (lanjut hierarki — grant memeriksa IKATAN, bukan menggantikan
 * RBAC); 'denied' = fail-closed.
 */
async function checkTerminalGrant(userId: string): Promise<
  | { state: 'absent' }
  | { state: 'ok' }
  | { state: 'denied'; reason: 'grant-expired' | 'grant-mismatch' }
> {
  await hydrateTerminalState();
  if (!getGrant()) return { state: 'absent' };
  const terminalId = (getBinding()?.terminalId ?? '').trim();
  if (!terminalId) {
    // Grant ada tapi device belum terikat terminal yang dikenal => tolak.
    return { state: 'denied', reason: 'grant-mismatch' };
  }
  const problem = describeGrantProblem(userId, terminalId);
  if (problem === null) return { state: 'ok' };
  if (problem === 'no-grant') return { state: 'absent' };
  return { state: 'denied', reason: problem };
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

/** Warn-once agar fail-open diam (GAP-12) tetap memancarkan sinyal di log. */
let warnedFailOpen = false;
function warnFailOpenOnce(reason: string, userId: string, accessKey: string): void {
  if (warnedFailOpen) return;
  warnedFailOpen = true;
  console.warn(`[access] fail-open allow (${reason}) user=${userId} key=${accessKey}`);
}

async function decideHierarchy(userId: string, accessKey: string): Promise<AccessDecision> {
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

  // 3. Template peran (userId = nama peran kanonis): baris eksak lalu wildcard.
  // Cari peran via id ATAU username (kunci sesi bisa berupa salah satunya);
  // normalisasi via normalizeRole karena server bisa kirim Admin/SUPERVISOR/
  // kasir legacy - semuanya dipetakan ke Merchant Owner / Merchant Staff.
  const urow = await queryFirst<{ role: string | null }>(
    `SELECT role FROM ms_posuser WHERE id = ? OR username = ? LIMIT 1`,
    [userId, userId],
  );
  const role = normalizeRole(urow?.role ?? '');
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
  warnFailOpenOnce('default-allow', userId, accessKey);
  return { ok: true, reason: 'default-allow' };
}

async function decide(userId: string, accessKey: string): Promise<AccessDecision> {
  // 0. Grant terminal (Q6): grant ada tapi user/terminal tak cocok atau
  //    kedaluwarsa => DENY fail-closed. Grant valid => lanjut hierarki biasa
  //    (grant memeriksa IKATAN, bukan menggantikan RBAC). Tanpa grant =>
  //    hierarki lama lestari (kompatibilitas pra-grant).
  try {
    const grant = await checkTerminalGrant(userId);
    if (grant.state === 'denied') {
      return { ok: false, reason: grant.reason };
    }
  } catch {
    /* grant tak bisa dibaca => hierarki lama yang memutuskan */
  }
  return decideHierarchy(userId, accessKey);
}

/**
 * True bila user boleh memakai accessKey. Tidak pernah melempar:
 * DB belum siap -> true (fail-open).
 */
export async function hasAccess(userId: string, accessKey: string): Promise<boolean> {
  try {
    return (await decide(userId, accessKey)).ok;
  } catch {
    warnFailOpenOnce('db-unready', userId, accessKey);
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
    warnFailOpenOnce('db-unready', userId, accessKey);
    return { ok: true, reason: 'db-unready' };
  }
}

/**
 * Gerbang eskalasi persetujuan (void/cancel/kompliment butuh PIN Owner,
 * SPEC Q-kunci + D3-05): BINDING-gated, approver-aware, TANPA gerbang grant
 * sesi kasir. Alasan: PIN Owner dimasukkan approver yang BELUM tentu memegang
 * sesi/grant login kasir — menuntut grant milik approver menolak eskalasi sah
 * (deny arah-1), sedangkan melewatkan grant kasir meloloskan sesi basi (allow
 * arah-2). Yang diverifikasi:
 * 1. device TERIKAT terminal dikenal (getBinding) — fail-closed
 *    'terminal-unbound' bila belum bind;
 * 2. hirarki RBAC (decideHierarchy) untuk userId APPROVER — PIN-nya sudah
 *    diverifikasi pemanggil (supervisor.verifyLocalEscalation) SEBELUM fungsi
 *    ini dipanggil.
 * Tidak pernah melempar: store belum siap -> deny fail-closed 'db-unready'
 * (SENGAJA berlawanan dengan requireAccess yang fail-open — persetujuan tak
 * boleh fail-open).
 */
export async function requireEscalationAccess(
  approverUserId: string,
  accessKey: string,
): Promise<AccessDecision> {
  try {
    await hydrateTerminalState();
    const terminalId = (getBinding()?.terminalId ?? '').trim();
    if (!terminalId) {
      return { ok: false, reason: 'terminal-unbound' };
    }
    if (!approverUserId.trim()) {
      return { ok: false, reason: 'missing-identity' };
    }
    return await decideHierarchy(approverUserId, accessKey);
  } catch {
    return { ok: false, reason: 'db-unready' };
  }
}

// ---------------------------------------------------------------------------
// Gerbang terminal-access FAIL-CLOSED (SPEC-TERMINAL-SESSION.md §4/L1).
// SENGAJA berlawanan dengan requireAccess di atas (fail-open untuk 4 kunci
// aksi dalam-app): gerbang ini MENOLAK bila tanpa grant cache valid, bila
// identitas kosong, atau bila pengecekan gagal. Tidak pernah melempar.
// BE E01 staff-login BELUM ADA: satu-satunya otoritas kini adalah grant
// cache (dibuat saat auth online sukses; lihat buildGrant/saveGrant di
// session.ts). Alasan deny dipetakan ke status UI eksplisit ("needs BE /
// mode lokal") — dipakai alur L1, bukan bypass diam:
// - 'no-grant'         → login pertama wajib online (butuh BE).
// - 'grant-expired'    → grant kedaluwarsa; re-auth online (butuh BE).
// - 'grant-mismatch'   → triple (user, terminal, device) tak cocok;
//                        cek binding dulu (mode lokal).
// - 'missing-identity' → userId/terminalId kosong (bug pemanggil).
// - 'db-unready'       → store grant tak terbaca (fail-closed).
// ---------------------------------------------------------------------------

/** Warn-once per alasan deny agar log tak dibanjiri penolakan berulang. */
const terminalDenyWarned = new Set<string>();
function warnTerminalDenyOnce(
  reason: string,
  userId: string,
  terminalId: string,
): void {
  if (terminalDenyWarned.has(reason)) return;
  terminalDenyWarned.add(reason);
  console.warn(
    `[access] terminal-access deny (${reason}) user=${userId} terminal=${terminalId}`,
  );
}

/**
 * True bila pasangan (userId, terminalId[, deviceId]) boleh memakai terminal:
 * grant cache valid (triple match + belum expiry + dalam cap policy).
 * Fail-CLOSED: tanpa grant / grant rusak / store tak terbaca → false.
 * Tidak pernah melempar.
 */
export async function hasTerminalAccess(
  userId: string,
  terminalId: string,
  deviceId?: string,
): Promise<boolean> {
  try {
    return (await requireTerminalAccess(userId, terminalId, deviceId)).ok;
  } catch {
    return false;
  }
}

/**
 * Gate check terminal-access: {ok, reason}. Tidak pernah melempar:
 * tanpa grant valid atau store tak terbaca → {ok: false, ...} (fail-closed).
 */
export async function requireTerminalAccess(
  userId: string,
  terminalId: string,
  deviceId?: string,
): Promise<AccessDecision> {
  const u = String(userId ?? '').trim();
  const t = String(terminalId ?? '').trim();
  const d =
    deviceId === undefined || deviceId === null
      ? undefined
      : String(deviceId).trim() || undefined;
  if (!u || !t) {
    warnTerminalDenyOnce('missing-identity', u || '?', t || '?');
    return { ok: false, reason: 'missing-identity' };
  }
  try {
    // Muat store dulu agar penilaian tak memakai memori dingin pasca-restart.
    await hydrateTerminalState();
    if (isGrantValid(u, t, d)) return { ok: true, reason: 'grant-valid' };
    const problem = describeGrantProblem(u, t, d) ?? 'no-grant';
    warnTerminalDenyOnce(problem, u, t);
    return { ok: false, reason: problem };
  } catch {
    warnTerminalDenyOnce('db-unready', u, t);
    return { ok: false, reason: 'db-unready' };
  }
}
