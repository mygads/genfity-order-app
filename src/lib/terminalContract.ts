/**
 * Klien kontrak terminal backend Go + binding device & grant offline sisi app.
 *
 * KONTRAK TERKUNCI (kedua sisi implementasi; app degrade gracefully saat
 * backend belum ada — Fase 0 backend, audit row 1/4):
 * - POST /api/v1/auth/terminal-login {username,password,terminalCode,deviceId}
 * - GET  /api/v1/branches
 * - GET  /api/v1/branches/{id}/terminals
 * - POST /api/v1/branches/{id}/terminals {name,tag}
 * - PATCH /api/v1/terminals/{id} {name,tag}
 * - POST /api/v1/terminals/{id}/set-pin {pin}
 * - POST /api/v1/terminals/{id}/validate-pin {pin,userId}
 * - POST /api/v1/terminals/{id}/bind {pin,deviceId} => {bound,kickedUserId?}
 * - POST /api/v1/terminals/{id}/claim (evict previous)
 * - GET  /api/v1/terminals/{id}/events (SSE text/event-stream, tag-filtered)
 * - POST /api/v1/staff/{id}/pin-reset (owner-only)
 *
 * Aturan degrade (audit row 2/3/16/18/19, paket app-login 2026-10-17):
 * - Base URL dibaca dari EXPO_PUBLIC_TERMINAL_API_BASE_URL (atau
 *   EXPO_PUBLIC_API_BASE_URL sebagai fallback). Kosong = kontrak absen.
 * - Setiap call tak pernah melempar untuk kasus offline/kontrak-absen;
 *   kembalikan {ok:false, offline:true} agar layar memakai fallback jujur
 *   (SQLite lokal / pesan offline). Hanya backend yang memutuskan; app
 *   tak pernah mengarang keberhasilan (pelajaran CONFIRMED-3 ForgotPin).
 *
 * Tiga PIN terpisah (audit row 5): PIN terminal (binding, tak disimpan —
 * diverifikasi per-bind via validate-pin/bind) ≠ PIN staff (login/absensi/
 * shift, hash lokal via lib/pin.ts) ≠ PIN owner (eskalasi, supervisor.ts).
 *
 * Grant offline (audit row 19, Q6 CLOSED): cache 7-hari sliding terikat
 * rangkap-tiga (userId + terminalCode + deviceId). Login PERTAMA wajib
 * online; offline hanya lolos bila grant valid. Kick (Q13): bind/claim
 * mengembalikan kickedUserId; notifikasi ditampilkan ke perangkat BARU.
 */

import { getItem, getJSON, removeItem, setItem, setJSON } from './storage';
import { randomHex as randomHexCsprng } from './uuidv7';
// APP-FIXUP (fix-app-contract E3): store grant tunggal = session.ts.
// Modul ini tak lagi menyimpan grant sendiri; fungsi grant di bawah adalah
// delegasi tipis ke store sesi agar gate access.ts (satu-satunya gate grant)
// dan layar login menyentuh state yang sama (sebelumnya dua store ganda).
// Impor statis aman dari siklus: session.ts hanya bergantung pada
// lib/storage, lib/deviceRole, lib/pin (tak ada yang mengimpor modul ini).
import {
  getBinding as getSessionBinding,
  getGrant as getSessionGrant,
  getSession,
  hydrateTerminalState,
  isGrantValid as isSessionGrantValid,
  touchGrant as touchSessionGrant,
} from '../session';

/** 5 tag terminal eksplisit (audit row 6, Q1 CLOSED). */
export type TerminalTag =
  | 'kasir'
  | 'dapur'
  | 'view_pelanggan'
  | 'view_queue'
  | 'full_access';

export function isTerminalTag(v: unknown): v is TerminalTag {
  return (
    v === 'kasir' ||
    v === 'dapur' ||
    v === 'view_pelanggan' ||
    v === 'view_queue' ||
    v === 'full_access'
  );
}

export interface BranchInfo {
  id: string;
  name: string;
}

export interface ContractTerminal {
  terminalId: string;
  terminalCode: string;
  name: string;
  tag: TerminalTag | '';
  pinSet: boolean;
  pairedKasirId: string;
}

/** Ikatan device↔terminal: persist lintas logout user (model akses). */
export interface TerminalBinding {
  branchId: string;
  branchName: string;
  terminalId: string;
  terminalCode: string;
  terminalName: string;
  tag: TerminalTag | '';
  deviceId: string;
  boundAt: string;
}

/** Grant login offline: sliding 7 hari, triple-bound (Q6 CLOSED). */
export interface TerminalGrant {
  userId: string;
  username: string;
  terminalCode: string;
  deviceId: string;
  role: string;
  tag: string;
  authKey: string;
  issuedAt: string;
  expiresAt: string;
}

/** TTL grant 7 hari sliding (Q6 CLOSED 2026-10-17).
 * APP-FIXUP (fix-app-contract E3): konstanta warisan, dipertahankan untuk
 * kompatibilitas tipe; otoritas TTL kini policy sesi
 * (getMaxOfflineGrantDays, default 7 hari, server-wins).
 * @deprecated Nol pembaca (audit 2026-10-17) — jangan pakai untuk logika baru;
 * hapus setelah satu siklus rilis bila tetap tanpa pemanggil. */
export const GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LS_BINDING = 'genfity.terminal.binding.v1';
// APP-FIXUP (fix-app-contract E3): kunci store ganda warisan
// ('genfity.terminal.grant.v1') DIHAPUS — baca/tulis grant kini milik
// session.ts. Sisa byte yatim di perangkat disapu best-effort di readGrant.
const LEGACY_LS_GRANT = 'genfity.terminal.grant.v1';
/** Kunci deviceId SAMA dengan lib/apiSource.ts agar satu identitas device. */
const LS_DEVICE = 'genfity.device.id';

// ---------------------------------------------------------------------------
// Base URL + fetch bertenggat.
// ---------------------------------------------------------------------------

function readEnv(key: string): string {
  try {
    const p = globalThis as {
      process?: { env?: Record<string, string | undefined> };
    };
    return (p.process?.env?.[key] ?? '').trim();
  } catch {
    return '';
  }
}

/** Base URL kontrak; '' = kontrak absen (degrade offline jujur). */
export function contractBase(): string {
  const raw = readEnv('EXPO_PUBLIC_TERMINAL_API_BASE_URL') || readEnv('EXPO_PUBLIC_API_BASE_URL');
  const b = raw.replace(/\/+$/, '');
  if (!b) return '';
  // Hindari /api/v1 ganda bila env sudah menunjuk ke root versi.
  return /\/api\/v1$/.test(b) ? b : `${b}/api/v1`;
}

export function isContractConfigured(): boolean {
  return contractBase().length > 0;
}

interface CallResult<T> {
  ok: boolean;
  status: number;
  offline: boolean;
  data: T | null;
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 9000): Promise<CallResult<T>> {
  const base = contractBase();
  if (!base) return { ok: false, status: 0, offline: true, data: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, offline: false, data };
  } catch {
    return { ok: false, status: 0, offline: true, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(path: string, timeoutMs = 9000): Promise<CallResult<T>> {
  const base = contractBase();
  if (!base) return { ok: false, status: 0, offline: true, data: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { method: 'GET', signal: ctrl.signal });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, offline: false, data };
  } catch {
    return { ok: false, status: 0, offline: true, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? fb : String(v);
}

function bool(v: unknown): boolean {
  return v === true;
}

/** Kupas envelope {data} bila backend membungkus; loloskan body langsung. */
function unwrapData<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Device ID stabil (kontrak bind/grant). Format + kunci sama dengan
// lib/apiSource.ts agar dua modul sepakat pada satu identitas.
// ---------------------------------------------------------------------------

/** Ambil atau buat deviceID 16-hex persisten (CSPRNG, Q7). */
export async function getContractDeviceId(): Promise<string> {
  try {
    const cur = await getItem(LS_DEVICE);
    if (cur && /^[0-9a-f]{16}$/.test(cur)) return cur;
    const id = randomHexCsprng(16);
    await setItem(LS_DEVICE, id);
    return id;
  } catch {
    return randomHexCsprng(16);
  }
}

// ---------------------------------------------------------------------------
// Endpoint kontrak.
// ---------------------------------------------------------------------------

export interface TerminalLoginSuccess {
  userId: string;
  role: string;
  branches: BranchInfo[];
  terminals: ContractTerminal[];
  tag: TerminalTag | '';
  authKey: string;
  grantExpiresAt: string;
}

export async function terminalLogin(input: {
  username: string;
  password: string;
  terminalCode: string;
  deviceId: string;
}): Promise<CallResult<TerminalLoginSuccess>> {
  const r = await postJson<Record<string, unknown>>('/auth/terminal-login', input);
  if (!r.ok || !r.data) return { ok: false, status: r.status, offline: r.offline, data: null };
  const d = unwrapData<Record<string, unknown>>(r.data);
  const branches = Array.isArray(d.branches)
    ? (d.branches as Record<string, unknown>[]).map((b) => ({
        id: str(b.id ?? b.branchId),
        name: str(b.name ?? b.branchName),
      }))
    : [];
  const terminals = Array.isArray(d.terminals)
    ? (d.terminals as Record<string, unknown>[]).map((t) => {
        const rawTag = str(t.tag);
        return {
          terminalId: str(t.terminalId ?? t.id),
          terminalCode: str(t.terminalCode ?? t.code),
          name: str(t.name),
          tag: isTerminalTag(rawTag) ? rawTag : ('' as const),
          pinSet: bool(t.pinSet),
          pairedKasirId: str(t.pairedKasirId ?? t.pairedKasir),
        };
      })
    : [];
  const rawTag = str(d.tag);
  const grant = (d.grant ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    status: r.status,
    offline: false,
    data: {
      userId: str(d.userId),
      role: str(d.role),
      branches,
      terminals,
      tag: isTerminalTag(rawTag) ? rawTag : ('' as const),
      authKey: str(d.authKey),
      grantExpiresAt: str(grant.expiresAt),
    },
  };
}

export async function fetchBranches(): Promise<{
  ok: boolean;
  offline: boolean;
  branches: BranchInfo[];
}> {
  const r = await getJson<unknown>('/branches');
  if (!r.ok || !r.data) return { ok: false, offline: r.offline, branches: [] };
  const d = unwrapData<unknown>(r.data);
  const arr = Array.isArray(d) ? d : (d as { branches?: unknown }).branches;
  if (!Array.isArray(arr)) return { ok: false, offline: false, branches: [] };
  return {
    ok: true,
    offline: false,
    branches: (arr as Record<string, unknown>[])
      .map((b) => ({ id: str(b.id ?? b.branchId), name: str(b.name ?? b.branchName) }))
      .filter((b) => b.id.length > 0),
  };
}

export async function fetchTerminals(branchId: string): Promise<{
  ok: boolean;
  offline: boolean;
  terminals: ContractTerminal[];
}> {
  const r = await getJson<unknown>(`/branches/${encodeURIComponent(branchId)}/terminals`);
  if (!r.ok || !r.data) return { ok: false, offline: r.offline, terminals: [] };
  const d = unwrapData<unknown>(r.data);
  const arr = Array.isArray(d) ? d : (d as { terminals?: unknown }).terminals;
  if (!Array.isArray(arr)) return { ok: false, offline: false, terminals: [] };
  return {
    ok: true,
    offline: false,
    terminals: (arr as Record<string, unknown>[]).map((t) => {
      const rawTag = str(t.tag);
      return {
        terminalId: str(t.terminalId ?? t.id),
        terminalCode: str(t.terminalCode ?? t.code),
        name: str(t.name),
        tag: isTerminalTag(rawTag) ? rawTag : ('' as const),
        pinSet: bool(t.pinSet),
        pairedKasirId: str(t.pairedKasirId ?? t.pairedKasir),
      };
    }),
  };
}

/** Validasi PIN terminal (binding) — PIN tak disimpan di device. */
export async function validateTerminalPin(
  terminalId: string,
  pin: string,
  userId?: string,
): Promise<CallResult<Record<string, unknown>>> {
  return postJson<Record<string, unknown>>(
    `/terminals/${encodeURIComponent(terminalId)}/validate-pin`,
    userId ? { pin, userId } : { pin },
  );
}

/**
 * Bind device↔terminal. Q13: login baru menang; bila server mengusir sesi
 * lama, {bound:true, kickedUserId} — layar WAJIB memberitahu perangkat baru.
 */
export async function bindTerminal(
  terminalId: string,
  pin: string,
  deviceId: string,
): Promise<CallResult<{ bound: boolean; kickedUserId: string }>> {
  const r = await postJson<Record<string, unknown>>(
    `/terminals/${encodeURIComponent(terminalId)}/bind`,
    { pin, deviceId },
  );
  if (!r.ok || !r.data) return { ok: false, status: r.status, offline: r.offline, data: null };
  const d = unwrapData<Record<string, unknown>>(r.data);
  return {
    ok: true,
    status: r.status,
    offline: false,
    data: { bound: bool(d.bound), kickedUserId: str(d.kickedUserId) },
  };
}

/** Claim terminal: usir sesi sebelumnya (evict previous). */
export async function claimTerminal(
  terminalId: string,
  deviceId: string,
): Promise<CallResult<{ bound: boolean; kickedUserId: string }>> {
  const r = await postJson<Record<string, unknown>>(
    `/terminals/${encodeURIComponent(terminalId)}/claim`,
    { deviceId },
  );
  if (!r.ok || !r.data) return { ok: false, status: r.status, offline: r.offline, data: null };
  const d = unwrapData<Record<string, unknown>>(r.data);
  return {
    ok: true,
    status: r.status,
    offline: false,
    data: { bound: d.bound !== false, kickedUserId: str(d.kickedUserId) },
  };
}

/**
 * Minta reset PIN staff (audit row 16, fix CONFIRMED-3: call nyata, bukan
 * setSent palsu). Kontrak fix-be D1: POST /api/v1/staff/{id}/pin-reset
 * (owner-only) — {id} path boleh id ATAU username (server yang resolve),
 * body PERSIS {merchantId, pin, username?/userId?} tanpa terminalCode/
 * deviceId (otorisasi milik server via binding/owner). Jujur offline:
 * kontrak tak terjangkau → {ok:false, offline:true}; server menolak →
 * {ok:false, offline:false} (BUKAN sukses palsu).
 *
 * APP-FIXUP (fix-app-contract D1): kunci identifier dipilih dari bentuk
 * nilai — pola id (`u-*` seed, UUID, numerik murni) → `userId`, selainnya
 * → `username` (layar Forgot PIN selalu mengirim username staff).
 */
export async function requestPinReset(input: {
  userIdOrUsername: string;
  merchantId: string;
  newPin: string;
}): Promise<{ ok: boolean; offline: boolean; status: number }> {
  const id = String(input.userIdOrUsername ?? '').trim();
  const merchantId = String(input.merchantId ?? '').trim();
  const pin = String(input.newPin ?? '');
  const body: Record<string, string> = { merchantId, pin };
  if (isUserIdLike(id)) body.userId = id;
  else body.username = id;
  const r = await postJson<Record<string, unknown>>(
    `/staff/${encodeURIComponent(id)}/pin-reset`,
    body,
  );
  return { ok: r.ok, offline: r.offline, status: r.status };
}

/** Bedakan id user (`u-admin`, UUID, numerik) dari username staff. */
function isUserIdLike(v: string): boolean {
  return (
    /^u[-_]/i.test(v) ||
    /^[0-9]+$/.test(v) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/**
 * URL SSE event terminal (kontrak GET .../events, tag-filtered). Hanya
 * pembentuk URL — konsumsi EventSource milik paket event/Fase 4 (row 8).
 */
export function terminalEventsUrl(terminalId: string): string {
  const base = contractBase();
  if (!base || !terminalId) return '';
  return `${base}/terminals/${encodeURIComponent(terminalId)}/events`;
}

// ---------------------------------------------------------------------------
// Binding store (persist lintas logout; login hanya akhiri sesi user).
// ---------------------------------------------------------------------------

export async function loadBinding(): Promise<TerminalBinding | null> {
  return getJSON<TerminalBinding | null>(LS_BINDING, null);
}

export async function saveBinding(b: TerminalBinding): Promise<void> {
  await setJSON(LS_BINDING, b);
}

export async function clearBinding(): Promise<void> {
  await setItem(LS_BINDING, '');
}

// ---------------------------------------------------------------------------
// Grant store (row 19): DELEGASI ke store tunggal session.ts (E3).
// APP-FIXUP (fix-app-contract E3): access.ts hanya membaca store sesi, jadi
// store ganda di sini adalah bug (LoginScreen menyentuh store yang tak pernah
// dibaca gate). Semantik lestari: triple-bound + 7-hari sliding (Q6 CLOSED).
// Bentuk TerminalGrant dipertahankan sebagai PROYEKSI baca (username/role/
// tag/authKey diambil dari sesi+binding); penulisan grant hash-PIN hanya via
// session buildGrant/saveGrant pasca-auth online — shim tulis di bawah
// sengaja gagal-keras (fail-closed) daripada sukses palsu.
// ---------------------------------------------------------------------------

/** Proyeksi baca grant kanonis sesi ke bentuk kontrak (null bila tanpa grant).
 * @deprecated Nol pemanggil produksi (audit 2026-10-17) — gate memakai
 * session.ts langsung (getGrant/isGrantValid/describeGrantProblem). Proyeksi
 * '' saat sesi/binding absen by design (fail-closed); jangan andalkan untuk
 * logika baru. */
export async function readGrant(): Promise<TerminalGrant | null> {
  try {
    await hydrateTerminalState();
    try {
      await removeItem(LEGACY_LS_GRANT);
    } catch {
      /* abaikan: sapu sisa kunci ganda warisan, best-effort */
    }
    const g = getSessionGrant();
    if (!g) return null;
    const s = getSession();
    const b = getSessionBinding();
    return {
      userId: g.userId,
      username: s?.username ?? '',
      terminalCode: b?.terminalCode ?? '',
      deviceId: g.deviceId,
      role: s?.role ?? '',
      tag: b?.tag ?? s?.terminalTag ?? '',
      authKey: s?.authKey ?? '',
      issuedAt: g.grantedAt,
      expiresAt: g.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * DEPRECATED (E3): grant hash-PIN tak bisa dicetak dari TerminalGrant
 * (tanpa staffPin plaintext — mencetak hash tanpa PIN = mengarang grant).
 * Pakai session buildGrant/saveGrant pasca-auth online. Gagal-keras agar
 * penyalahgunaan ketahuan, bukan sukses palsu.
 */
export async function saveGrant(_g: TerminalGrant): Promise<void> {
  throw new Error(
    '[terminalContract] saveGrant dipindah ke session.ts — pakai buildGrant/saveGrant',
  );
}

/**
 * DEPRECATED (E3): lihat saveGrant — TTL kini policy sesi
 * (getMaxOfflineGrantDays, server-wins), bukan konstanta modul ini.
 */
export async function saveGrantFromLogin(
  _login: TerminalLoginSuccess,
  _username: string,
  _terminalCode: string,
  _deviceId: string,
): Promise<TerminalGrant> {
  throw new Error(
    '[terminalContract] saveGrantFromLogin dipindah ke session.ts — pakai buildGrant/saveGrant',
  );
}

/**
 * Grant valid bila: cocok rangkap-tiga (userId ATAU username + terminalCode
 * + device) DAN belum kedaluwarsa — dinilai pada store sesi kanonis.
 * terminalCode kontrak dipetakan ke terminalId sesi via binding sesi
 * (SPEC §2); username diselesaikan via sesi aktif; yang tak terpeta →
 * false (fail-closed). Login PERTAMA wajib online (tanpa grant valid →
 * tolak jujur). Tak pernah melempar.
 * @deprecated Nol pemanggil produksi (audit 2026-10-17) — gate memakai
 * access.requireTerminalAccess atas store sesi. Username-tanpa-sesi = false
 * by design (fail-closed); jangan pakai untuk logika baru.
 */
export async function grantValidFor(input: {
  userId?: string;
  username?: string;
  terminalCode: string;
}): Promise<boolean> {
  try {
    const code = String(input.terminalCode ?? '').trim();
    if (!code) return false;
    await hydrateTerminalState();
    const b = getSessionBinding();
    const terminalId = b && b.terminalCode === code ? b.terminalId : '';
    if (!terminalId) return false;
    let userId = String(input.userId ?? '').trim();
    if (!userId && input.username) {
      const s = getSession();
      if (
        s?.username &&
        s.username.toLowerCase() === String(input.username).toLowerCase() &&
        s.userId
      ) {
        userId = s.userId;
      }
    }
    if (!userId) return false;
    return isSessionGrantValid(userId, terminalId);
  } catch {
    return false;
  }
}

/**
 * Geser TTL (sliding) tiap login sukses — didelegasikan ke store sesi
 * kanonis (sebelumnya menggeser store ganda yang tak dibaca gate access.ts).
 * Best-effort: tanpa grant → diam; gate yang memutuskan. Tanda tangan
 * Promise<void> dipertahankan agar pemanggil lama (LoginScreen) tetap kompil.
 */
export async function touchGrant(): Promise<void> {
  try {
    await hydrateTerminalState();
    touchSessionGrant();
  } catch {
    /* abaikan: sliding best-effort, gate yang memutuskan */
  }
}
