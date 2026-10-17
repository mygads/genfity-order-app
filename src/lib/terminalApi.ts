/**
 * Klien bind-flow B1/R1 (SPEC-TERMINAL-SESSION §3 + §5): branch picker,
 * terminal picker, PIN terminal, bind atomik, staff-login 2-tahap (stub
 * pemakaian L1), revoke logout, dan okupansi terminal.
 *
 * Semua call mencoba BE Go lewat ApiPath (E01/E02/E03/E06 + E07/E09)
 * memakai apiFetch (Local/Dummy/Real Mode ala lib/apiSource.ts). Bila BE
 * belum ada / tak terjangkau, kembalikan {ok:false, reason:'need_be'|
 * 'offline'} yang jujur — layar menampilkan status eksplisit, bukan bypass
 * diam-diam. Daftar branch/terminal BOLEH memakai fixture dummy lokal
 * (fromDummy:true agar layar melabeli "mode lokal"); verifikasi PIN,
 * bind, dan staff-login WAJIB fail-closed (dummy tak pernah sukses:
 * login pertama wajib online, SPEC §2 + Q6 CLOSED).
 */
import { ApiPath } from '../config/server';
import { apiFetch, getApiMode, unwrap } from './apiSource';
// F10: validasi tag BE via parseDeviceRole (standalone, tanpa siklus impor).
import { parseDeviceRole } from './deviceRole';

/** Alasan gagal jujur: BE belum dikonfigurasi vs jaringan putus. */
export type TerminalApiReason = 'need_be' | 'offline';

export type TerminalApiResult<T> =
  | { ok: true; data: T; fromDummy: boolean }
  | { ok: false; reason: TerminalApiReason; status: number; fromDummy: boolean };

export interface BranchItem {
  id: string;
  name: string;
}

export interface TerminalItem {
  terminalId: string;
  terminalCode: string;
  name: string;
  /** Tag kanonis lowercase (kasir|dapur|view_pelanggan|view_queue|full_access) atau '' bila BE tak mengirim. */
  tag: string;
  pinSet: boolean;
  pairedKasirId?: string;
  pairedViewId?: string;
  verified?: boolean;
}

/** Hasil bind atomik E03 (verify+bind satu panggilan, SPEC §3). */
export interface BindData {
  bound: boolean;
  kickedUserId: string;
  tag: string;
  pairedKasirId: string;
  pairedViewId: string;
}

export interface PinCheckData {
  valid: boolean;
}

export interface OccupantData {
  userId: string;
  username: string;
  name: string;
  loginAt: string;
}

function str(v: unknown, fb = ''): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return fb;
  return String(v);
}

function fail<T>(status: number, fromDummy: boolean): TerminalApiResult<T> {
  return {
    ok: false,
    reason: getApiMode() === 'local' ? 'need_be' : 'offline',
    status,
    fromDummy,
  };
}

function withId(path: string, id: string): string {
  const safe = encodeURIComponent(id);
  return path.replace('{id}', safe).replace('{viewId}', safe);
}

function asBranch(b: Record<string, unknown>): BranchItem {
  return { id: str(b.id ?? b.branchId), name: str(b.name ?? b.branchName) };
}

function asTerminal(t: Record<string, unknown>): TerminalItem {
  // F10: tag asing → '' (fail-closed; penolakan di layar PIN/F11) — jangan lolos mentah.
  const rawTag = str(t.tag).trim().toLowerCase();
  return {
    terminalId: str(t.terminalId ?? t.id),
    terminalCode: str(t.terminalCode ?? t.code),
    name: str(t.name),
    tag: parseDeviceRole(rawTag) ?? '',
    pinSet: t.pinSet === true,
    ...(str(t.pairedKasirId ?? t.pairedKasir) ? { pairedKasirId: str(t.pairedKasirId ?? t.pairedKasir) } : {}),
    ...(str(t.pairedViewId ?? t.pairedView) ? { pairedViewId: str(t.pairedViewId ?? t.pairedView) } : {}),
    ...(t.verified !== undefined ? { verified: t.verified === true } : {}),
  };
}

/** Kupas body apiFetch menjadi array branch (envelope {data} atau langsung). */
function parseBranchList(body: unknown): BranchItem[] | null {
  const { data } = unwrap<unknown>(body);
  const arr = Array.isArray(data)
    ? data
    : (data as { branches?: unknown })?.branches;
  if (!Array.isArray(arr)) return null;
  return (arr as Record<string, unknown>[])
    .map(asBranch)
    .filter((b) => b.id.length > 0);
}

function parseTerminalList(body: unknown): TerminalItem[] | null {
  const { data } = unwrap<unknown>(body);
  const arr = Array.isArray(data)
    ? data
    : (data as { terminals?: unknown })?.terminals;
  if (!Array.isArray(arr)) return null;
  return (arr as Record<string, unknown>[]).map(asTerminal);
}

// ---------------------------------------------------------------------------
// Fallback fixture dummy lokal: HANYA untuk daftar terminal picker (E09),
// tak pernah untuk PIN/bind/login (ketiganya tetap fail-closed need_be/
// offline). Pola require() LITERAL-STATIS mengikuti preseden lib/apiSource.ts
// (aman untuk transform Metro web — yang dilarang hanya require() DINAMIS
// seperti require(p)). Fixture branch-terminals.json = envelope
// {request, response:{data:{branchId, terminals}}} khusus B001; branch lain
// => null (need_be jujur, bukan daftar palsu). Fixture daftar branch (E07)
// BELUM ADA di repo => fetchMyBranches tetap fail need_be/mode_local jujur.
// ---------------------------------------------------------------------------

const branchTerminalsFixture = require('../data/dummy/pull/branch-terminals.json') as unknown;

function tryFixtureList(
  kind: 'branches' | 'terminals',
  branchId?: string,
): Record<string, unknown>[] | null {
  if (kind === 'branches') return null; // fixture E07 belum ada — need_be jujur
  try {
    const data = (branchTerminalsFixture as {
      response?: { data?: { branchId?: unknown; terminals?: unknown } };
    })?.response?.data;
    const rows = Array.isArray(data?.terminals)
      ? (data.terminals as Record<string, unknown>[])
      : null;
    if (!rows) return null;
    const fixtureBranch = typeof data?.branchId === 'string' ? data.branchId : '';
    const want = (branchId ?? '').trim();
    // Fixture hanya mencakup branch-nya sendiri: branch lain => null jujur.
    if (want && fixtureBranch && fixtureBranch !== want) return null;
    return rows;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Endpoint.
// ---------------------------------------------------------------------------

/** E07: branch milik user (branch picker B1). */
export async function fetchMyBranches(): Promise<
  TerminalApiResult<{ branches: BranchItem[] }>
> {
  const r = await apiFetch(ApiPath.branches, { method: 'GET' });
  if (r.ok && !r.fromDummy) {
    const branches = parseBranchList(r.data) ?? [];
    return { ok: true, data: { branches }, fromDummy: false };
  }
  const fixture = tryFixtureList('branches');
  if (fixture) {
    return {
      ok: true,
      data: { branches: fixture.map(asBranch).filter((b) => b.id.length > 0) },
      fromDummy: true,
    };
  }
  return fail(r.status, r.fromDummy);
}

/** E09: terminal dalam satu branch (terminal picker B1). */
export async function fetchBranchTerminals(
  branchId: string,
): Promise<TerminalApiResult<{ branchId: string; terminals: TerminalItem[] }>> {
  const r = await apiFetch(withId(ApiPath.branchTerminals, branchId), {
    method: 'GET',
  });
  if (r.ok && !r.fromDummy) {
    const terminals = parseTerminalList(r.data) ?? [];
    return { ok: true, data: { branchId, terminals }, fromDummy: false };
  }
  const fixture = tryFixtureList('terminals', branchId);
  if (fixture) {
    return {
      ok: true,
      data: { branchId, terminals: fixture.map(asTerminal) },
      fromDummy: true,
    };
  }
  return fail(r.status, r.fromDummy);
}

/**
 * E02: cek PIN terminal tanpa efek (UX bind). Fail-closed: dummy/offline
 * tak pernah {valid:true} — hanya jawaban BE asli yang dipercaya.
 */
export async function validateTerminalPin(
  terminalId: string,
  pin: string,
  userId?: string,
): Promise<TerminalApiResult<PinCheckData>> {
  const r = await apiFetch(withId(ApiPath.terminalValidatePin, terminalId), {
    body: userId ? { pin, userId } : { pin },
  });
  if (!r.ok || r.fromDummy) {
    return fail<PinCheckData>(r.status, r.fromDummy);
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return {
    ok: true,
    data: { valid: data.valid === true },
    fromDummy: false,
  };
}

/**
 * E03: bind atomik verify+bind {pin,deviceId} (SPEC §3). Fail-closed sama
 * seperti validateTerminalPin; {bound:false} dari BE = PIN ditolak
 * (layar tampilkan bind_failed, tanpa bypass).
 */
export async function bindTerminal(
  terminalId: string,
  pin: string,
  deviceId: string,
): Promise<TerminalApiResult<BindData>> {
  const r = await apiFetch(withId(ApiPath.terminalBind, terminalId), {
    body: { pin, deviceId },
  });
  if (!r.ok || r.fromDummy) {
    return fail<BindData>(r.status, r.fromDummy);
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  // Tag asing dari BE → '' (disiplin F10 yang sama: jangan lolos mentah).
  const bindTag = str(data.tag).trim().toLowerCase();
  return {
    ok: true,
    data: {
      bound: data.bound !== false,
      kickedUserId: str(data.kickedUserId),
      tag: parseDeviceRole(bindTag) ?? '',
      pairedKasirId: str(data.pairedKasirId),
      pairedViewId: str(data.pairedViewId),
    },
    fromDummy: false,
  };
}

/**
 * E01: staff-login 2-tahap (SPEC §4, POST /api/v1/auth/terminal-login —
 * body SELALU {username,password,staffPin?,terminalCode,deviceId}).
 * Helper ber-signature kontrak penuh (nol pemanggil produksi saat ini;
 * LoginScreen memakai callStaffLogin sendiri): fail-closed — dummy/offline
 * selalu {ok:false} (login pertama wajib online, tanpa grant bawaan).
 */
export async function staffLogin(input: {
  username: string;
  password: string;
  staffPin?: string;
  terminalCode?: string;
  deviceId?: string;
}): Promise<TerminalApiResult<Record<string, unknown>>> {
  const r = await apiFetch(ApiPath.staffLogin, { body: input });
  if (!r.ok || r.fromDummy) {
    return fail<Record<string, unknown>>(r.status, r.fromDummy);
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return { ok: true, data, fromDummy: false };
}

/**
 * E06: revoke sesi server-side (O1, SPEC §7). Gagal jaringan → {ok:false};
 * pemanggil menandai pendingRevoke (session.markPendingRevoke) untuk
 * di-flush saat online — logout lokal tetap langsung berlaku.
 */
export async function logoutRevoke(input: {
  sessionId?: string;
  userId?: string;
}): Promise<TerminalApiResult<{ revoked: boolean }>> {
  const r = await apiFetch(ApiPath.authLogout, { body: input });
  if (!r.ok || r.fromDummy) {
    return fail<{ revoked: boolean }>(r.status, r.fromDummy);
  }
  return { ok: true, data: { revoked: true }, fromDummy: false };
}

/** E05: sesi aktif terminal (okupansi tunggal, SPEC §7.1). */
export async function fetchOccupant(
  terminalId: string,
): Promise<TerminalApiResult<{ occupant: OccupantData | null }>> {
  const r = await apiFetch(withId(ApiPath.terminalOccupant, terminalId), {
    method: 'GET',
  });
  if (!r.ok || r.fromDummy) {
    return fail<{ occupant: OccupantData | null }>(r.status, r.fromDummy);
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const raw = (data.occupant ?? data) as Record<string, unknown>;
  const userId = str(raw.userId);
  if (!userId) {
    return { ok: true, data: { occupant: null }, fromDummy: false };
  }
  return {
    ok: true,
    data: {
      occupant: {
        userId,
        username: str(raw.username),
        name: str(raw.name),
        loginAt: str(raw.loginAt),
      },
    },
    fromDummy: false,
  };
}
