/**
 * Klien bind-flow B1/R1 (SPEC-TERMINAL-SESSION §3 + §5): branch picker,
 * terminal picker, PIN terminal, bind atomik, terminal-login single-stage
 * (koreksi 2026-10-17 — RoE live: sesi penuh langsung, tanpa tahap-2
 * staffPin), revoke logout, okupansi terminal, dan deteksi kick via event
 * `takeover` SSE terminal (koreksi 2026-10-17 — tak ada frame SESSION_KICKED
 * push sisi server; 401 = gagal auth final → re-login, BUKAN bukti kick).
 *
 * Semua call mencoba BE Go lewat ApiPath (E01/E02/E03/E06 + E07/E09)
 * memakai apiFetch (Local/Dummy/Real Mode ala lib/apiSource.ts). Bila BE
 * belum ada / tak terjangkau, kembalikan {ok:false, reason:'need_be'|
 * 'offline'} yang jujur — layar menampilkan status eksplisit, bukan bypass
 * diam-diam. Daftar branch/terminal BOLEH memakai fixture dummy lokal
 * (fromDummy:true agar layar melabeli "mode lokal"); verifikasi PIN,
 * bind, dan login WAJIB fail-closed (dummy tak pernah sukses:
 * login pertama wajib online, SPEC §2 + Q6 CLOSED).
 */
import { ApiPath } from '../config/server';
import { apiFetch, getApiMode, getDeviceId, unwrap } from './apiSource';
// F10: validasi tag BE via parseDeviceRole (standalone, tanpa siklus impor).
import { parseDeviceRole } from './deviceRole';

/** Alasan gagal jujur: BE belum dikonfigurasi vs jaringan putus. */
export type TerminalApiReason = 'need_be' | 'offline';

/** Varian gagal — kode/pesan server opsional (fase-1b): layar butuh bedakan
 * 409 okupansi vs offline (bind/claim) tanpa menebak dari status saja. */
export interface TerminalApiErr {
  ok: false;
  reason: TerminalApiReason;
  status: number;
  fromDummy: boolean;
  errorCode?: string;
  serverMessage?: string;
}

export type TerminalApiResult<T> =
  | { ok: true; data: T; fromDummy: boolean }
  | TerminalApiErr;

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

function fail<T>(status: number, fromDummy: boolean): TerminalApiErr {
  return {
    ok: false,
    reason: getApiMode() === 'local' ? 'need_be' : 'offline',
    status,
    fromDummy,
  };
}

/** Gagal + bawa kode/pesan server (envelope error tanpa `data`, baca
 * top-level — deklarasi fungsi di-hoist, definisi di bawah). */
function failWith<T>(status: number, fromDummy: boolean, rawBody: unknown): TerminalApiErr {
  return {
    ...fail<T>(status, fromDummy),
    errorCode: readTerminalErrorField(rawBody, 'error'),
    serverMessage: readTerminalErrorField(rawBody, 'message'),
  };
}

function rawErrorBody(r: unknown): unknown {
  return (r as { data?: unknown }).data;
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
 * Fase-1b: kegagalan bawa errorCode/serverMessage (failWith) agar layar bedakan
 * 409 okupansi (TERMINAL_OCCUPIED/DEVICE_CONFLICT/TAG_CONFLICT → tawarkan claim)
 * dari offline/need_be — tanpa menebak dari status saja.
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
    return failWith<BindData>(r.status, r.fromDummy, rawErrorBody(r));
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
 * E32: claim — ambil alih terminal yang terokupansi (satu-satunya jalur
 * takeover eksplisit). POST /terminals/{id}/claim {pin,deviceId} → {bound,
 * terminal{tag}, kickedUserId}. PIN terminal WAJIB (fase-1a; tanpa pin →
 * PIN_REQUIRED 401); pindah DEVICE saja (okupansi user lain tak disentuh);
 * kapasitas per-tag dilanggar → 409 TERMINAL_TAG_CONFLICT. Fail-closed seperti
 * bind; kegagalan bawa errorCode/serverMessage untuk cabang UI layar.
 */
export interface ClaimData {
  bound: boolean;
  kickedUserId: string;
  tag: string;
}

export async function claimTerminalPin(
  terminalId: string,
  pin: string,
  deviceId: string,
): Promise<TerminalApiResult<ClaimData>> {
  const r = await apiFetch(withId(ApiPath.terminalClaim, terminalId), {
    body: { pin, deviceId },
  });
  if (!r.ok || r.fromDummy) {
    return failWith<ClaimData>(r.status, r.fromDummy, rawErrorBody(r));
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const termObj = (data.terminal ?? {}) as Record<string, unknown>;
  const claimTag = str(termObj.tag ?? data.tag).trim().toLowerCase();
  return {
    ok: true,
    data: {
      bound: data.bound !== false,
      kickedUserId: str(data.kickedUserId),
      tag: parseDeviceRole(claimTag) ?? '',
    },
    fromDummy: false,
  };
}

/**
 * E01: terminal-login LOGIN-FIRST dua tahap (F1, keputusan 2026-10-17) —
 * POST /api/v1/auth/terminal-login {username,password,deviceId,
 * terminalCode?,terminalPin?,merchantId?}:
 *   - Tahap A (picker): tanpa terminalCode di device yang belum bound →
 *     {stage:'pick-terminal', userId, branches, terminals} TANPA sesi/token.
 *     Layar menampilkan picker branch+terminal lalu memanggil lagi DENGAN
 *     terminalCode (+merchantId bila multi-branch).
 *   - Tahap B (complete): dengan terminalCode (atau fast-path device yang
 *     sudah bound) → sesi penuh (session + JWT pair + tag + branches +
 *     terminals + grant + tookOver?) + pinRequired:true SELALU (PIN user =
 *     langkah 2 via E29 pinVerifyTerminalPin, verifikasi SERVER).
 * `staffPin` SENGAJA TAK ADA di body: server mengabaikan field tak dikenal.
 * PIN hybrid: online = verifikasi server (E29, pinVersion disimpan sesi);
 * offline = verifikasi lokal memakai grant triple (khusus device+user+
 * terminal yang sudah bound). Fail-closed — dummy/offline selalu {ok:false}
 * (login pertama wajib online, tanpa grant bawaan).
 */
export interface StaffLoginInput {
  username: string;
  password: string;
  terminalCode?: string;
  terminalPin?: string;
  merchantId?: number;
  deviceId?: string;
}

export async function staffLogin(
  input: StaffLoginInput,
): Promise<TerminalApiResult<Record<string, unknown>>> {
  const r = await apiFetch(ApiPath.staffLogin, { body: input });
  if (!r.ok || r.fromDummy) {
    return fail<Record<string, unknown>>(r.status, r.fromDummy);
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return { ok: true, data, fromDummy: false };
}

// ---------------------------------------------------------------------------
// 401 vs kick (K1; koreksi 2026-10-17 atas arah 401-guard yang SALAH —
// kebenaran BE terverifikasi: tabel grant terminal TAK PERNAH dibaca
// middleware auth, kick TAK PERNAH merevoke user_sessions, dan server TAK
// PERNAH push frame SESSION_KICKED. Perangkat yang ditendang TIDAK menerima
// 401). Aturan jujur: 401 dari BE = gagal auth final (token buruk/kedaluwarsa;
// app TAK PUNYA token-refresh; apiFetch di apiSource.ts kini meneruskan 401
// ke unauthorizedHandler (default logout(), kecuali 401 faktor-PIN
// USER_PIN_*/PIN_REQUIRED; override via setUnauthorizedHandler) → re-login,
// BUKAN bukti kick.
// Deteksi kick = event `takeover` SSE terminal (feed E26 milik terminal sesi;
// tipe mengandung `takeover` dengan user/device event ≠ sesi/binding kami →
// notice kicked_msg + logout; watcher sesi di App.tsx) + pencocokan pola
// kick/takeover sisi-klien pada pesan WS (future-proof, realtime.ts/App.tsx).
// Modul ini SENGAJA tanpa 401-guard: fetcher hanya teruskan {ok:false} jujur.
// ---------------------------------------------------------------------------

/**
 * E06/E31: akhiri sesi server-side (O1, SPEC §7) — BE hanya punya
 * POST /api/v1/auth/terminal-logout {deviceId} (deviceId dilampirkan otomatis
 * dari getDeviceId; field sessionId/userId diteruskan apa adanya, server
 * mengabaikannya). Server merevoke sesi + grant triple TAPI mempertahankan
 * bound_device_id (logout tetap bound untuk fast-login). Gagal jaringan →
 * {ok:false}; pemanggil menandai pendingRevoke untuk di-flush saat online —
 * logout lokal tetap langsung berlaku.
 */
export async function logoutRevoke(input: {
  sessionId?: string;
  userId?: string;
  deviceId?: string;
}): Promise<TerminalApiResult<{ revoked: boolean }>> {
  let deviceId = (input.deviceId ?? '').trim();
  if (!deviceId) {
    try {
      deviceId = (await getDeviceId()) ?? '';
    } catch {
      deviceId = '';
    }
  }
  const r = await apiFetch(ApiPath.authLogout, {
    body: { ...input, deviceId },
  });
  if (!r.ok || r.fromDummy) {
    return fail<{ revoked: boolean }>(r.status, r.fromDummy);
  }
  return { ok: true, data: { revoked: true }, fromDummy: false };
}

/**
 * E29: pin-verify — langkah 3 login staged fase-1a (faktor PIN user /
 * workforce, verifikasi SERVER via staff_pos_pins). POST
 * /terminals/{id}/pin-verify {pin} → {verified:true, pinVersion} —
 * pinVersion = sumber versi PIN hybrid (simpan ke sesi; invalidasi cache
 * PIN lokal saat sync bila versi berbeda). Fail-closed seperti E02, TAPI
 * kode error dipertahankan agar layar bisa bedakan: USER_PIN_NOT_SET (400,
 * belum enroll → fallback lokal), USER_PIN_INVALID (401), USER_PIN_LOCKED
 * (423). INTI HTTP TUNGGAL E29 (LoginScreen.callPinVerify mendelegasikan ke
 * sini — jangan duplikasi fetch E29 di layar). Token opsional: login-first
 * belum punya sesi tersimpan saat PIN modal (completeOnline jalan SETELAH
 * PIN lolos) sehingga JWT tahap-B diteruskan eksplisit; tanpa ini E29 selalu
 * 401 dan login macet permanen (temuan review Trek 1).
 */
export interface PinVerifyData {
  verified: boolean;
  /** Versi PIN server (0 bila user belum pernah set PIN). */
  pinVersion: number;
}

export type PinVerifyResult =
  | { ok: true; data: PinVerifyData; fromDummy: boolean }
  | {
      ok: false;
      reason: TerminalApiReason;
      status: number;
      fromDummy: boolean;
      errorCode: string;
      serverMessage: string;
    };

function readTerminalErrorField(body: unknown, field: 'error' | 'message'): string {
  try {
    const b = (body ?? {}) as Record<string, unknown>;
    const inner = (b.data ?? b) as Record<string, unknown>;
    return str((inner[field] ?? b[field]) as unknown);
  } catch {
    return '';
  }
}

export async function pinVerifyTerminalPin(
  terminalId: string,
  pin: string,
  opts?: { token?: string },
): Promise<PinVerifyResult> {
  const r = await apiFetch(withId(ApiPath.terminalPinVerify, terminalId), {
    body: { pin },
    ...(opts?.token ? { token: opts.token } : {}),
  });
  if (!r.ok || r.fromDummy) {
    const raw = (r as unknown as { data?: unknown }).data;
    return {
      ...fail<PinVerifyData>(r.status, r.fromDummy),
      errorCode: readTerminalErrorField(raw, 'error'),
      serverMessage: readTerminalErrorField(raw, 'message'),
    };
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const rawVersion = data.pinVersion;
  const pinVersion =
    typeof rawVersion === 'number' && Number.isFinite(rawVersion)
      ? Math.max(0, Math.floor(rawVersion))
      : typeof rawVersion === 'string' && rawVersion.trim() !== '' && Number.isFinite(Number(rawVersion))
        ? Math.max(0, Math.floor(Number(rawVersion)))
        : 0;
  return {
    ok: true,
    data: { verified: data.verified === true, pinVersion },
    fromDummy: false,
  };
}

/**
 * E14: set-pin — owner set/rotasi PIN terminal (BE: terminalPinRequest {pin},
 * 4–8 digit; owner-only + UserAuth via bearer sesi/V2 otorisasi server).
 * 200 → {updated:true}. 401/403/422 diteruskan jujur (failWith) untuk copy
 * layar (bukan owner / PIN tak valid / terminal tak ditemukan).
 */
export async function setTerminalPin(
  terminalId: string,
  pin: string,
): Promise<TerminalApiResult<{ updated: boolean }>> {
  const r = await apiFetch(withId(ApiPath.setTerminalPin, terminalId), {
    body: { pin },
  });
  if (!r.ok || r.fromDummy) {
    return failWith<{ updated: boolean }>(r.status, r.fromDummy, rawErrorBody(r));
  }
  return { ok: true, data: { updated: true }, fromDummy: false };
}

/**
 * E15: pair — pasangkan display view→kasir. POST /terminals/{viewId}/pair
 * {kasirId} (string numerik OK — BE parseTerminalPairID terima angka/string).
 * Penolakan BE diteruskan via failWith agar layar jujur: ONLY_DISPLAY_PAIRS
 * (422, pemanggil bukan view_pelanggan), NOT_A_KASIR (422), PAIR_CONFLICT
 * (422 + data.pairedViewId), FORBIDDEN (kasir beda branch), 410 TERMINAL_
 * INACTIVE (kasir nonaktif), KASIR_NOT_FOUND (404).
 */
export async function pairTerminalView(
  viewId: string,
  kasirId: string,
): Promise<TerminalApiResult<{ paired: boolean; pairedKasirId: string }>> {
  const r = await apiFetch(withId(ApiPath.pairView, viewId), {
    body: { kasirId },
  });
  if (!r.ok || r.fromDummy) {
    return failWith<{ paired: boolean; pairedKasirId: string }>(r.status, r.fromDummy, rawErrorBody(r));
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return {
    ok: true,
    data: { paired: true, pairedKasirId: str(data.pairedKasirId ?? data.kasirId ?? kasirId) },
    fromDummy: false,
  };
}

/**
 * E16: unpair — lepas pairing display. DELETE /terminals/{viewId}/pair
 * (tanpa body; owner-only; via apiDelete/apiFetch method DELETE). Idempoten:
 * belum ter-pair tetap 200 {paired:false} → kembalikan apa adanya.
 */
export async function unpairTerminalView(
  viewId: string,
): Promise<TerminalApiResult<{ paired: boolean }>> {
  const r = await apiFetch(withId(ApiPath.unpairView, viewId), {
    method: 'DELETE',
  });
  if (!r.ok || r.fromDummy) {
    return failWith<{ paired: boolean }>(r.status, r.fromDummy, rawErrorBody(r));
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return {
    ok: true,
    data: { paired: data.paired === true },
    fromDummy: false,
  };
}

/**
 * qr-consume (Q3 backend, mendarat 2026-10-17): tukar token QR sekali-pakai
 * hasil scan HP. POST /terminals/{id}/qr-consume {qrToken (wajib), deviceId?
 * (≤128 char, diteruskan ke tahap-B, tak disimpan server)} — PUBLIC (HP belum
 * punya sesi; rate-limit bentuk terminal-login) → {terminalId, terminalCode,
 * merchantId, pinVersion ADVISORY (versi PIN pembuat token; E29 pasca-login
 * yang menang — timpa)}. TIDAK mencetak sesi/grant/binding; PIN terminal
 * tetap WAJIB di tahap-B (langsung lompat ke stage-B tanpa ketik ulang kode).
 * Token mentah JANGAN di-log/persist. Gagal jujur via failWith:
 * QR_TOKEN_MISMATCH (400, token milik terminal lain — TIDAK hangus),
 * QR_TOKEN_USED (409/410), QR_TOKEN_EXPIRED/INVALID (410 → minta token baru
 * via issueTerminalQr), TERMINAL_NOT_FOUND (404).
 */
export interface QrConsumeData {
  terminalId: string;
  terminalCode: string;
  merchantId: number;
  pinVersion: number;
}

export async function consumeTerminalQr(
  terminalId: string,
  qrToken: string,
  deviceId?: string,
): Promise<TerminalApiResult<QrConsumeData>> {
  const r = await apiFetch(withId(ApiPath.terminalQrConsume, terminalId), {
    body: {
      qrToken,
      ...(deviceId ? { deviceId } : {}),
    },
  });
  if (!r.ok || r.fromDummy) {
    return failWith<QrConsumeData>(r.status, r.fromDummy, rawErrorBody(r));
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const terminalCode = str(data.terminalCode);
  if (!terminalCode) {
    // Kontrak dilanggar (200 tanpa terminalCode): ok:false jujur.
    return failWith<QrConsumeData>(r.status, r.fromDummy, r.data);
  }
  const merchantId = Number(data.merchantId);
  const pinVersion = Number(data.pinVersion);
  return {
    ok: true,
    data: {
      terminalId: str(data.terminalId ?? terminalId),
      terminalCode,
      merchantId: Number.isFinite(merchantId) ? merchantId : 0,
      pinVersion: Number.isFinite(pinVersion) && pinVersion > 0 ? Math.floor(pinVersion) : 0,
    },
    fromDummy: false,
  };
}

/**
 * qr-issue (di luar nomor E app; E25 login-qr TBD Q2): terbitkan token QR
 * login sekali-pakai. POST /terminals/{id}/qr-issue (tanpa body; member-only
 * + UserAuth) → {qrToken, expiresAt, ttlSeconds} (TTL 60 dtk BE). Token mentah
 * hanya dikembalikan sekali (server simpan SHA256): JANGAN log/persist mentah
 * — teruskan ke QR display lalu buang. Konsumen (Q3) wajib hitung mundur
 * ttlSeconds dan minta token baru saat kedaluwarsa.
 */
export interface TerminalQrIssueData {
  qrToken: string;
  expiresAt: string;
  ttlSeconds: number;
}

export async function issueTerminalQr(
  terminalId: string,
): Promise<TerminalApiResult<TerminalQrIssueData>> {
  const r = await apiFetch(withId(ApiPath.terminalQrIssue, terminalId), {
    body: {},
  });
  if (!r.ok || r.fromDummy) {
    return failWith<TerminalQrIssueData>(r.status, r.fromDummy, rawErrorBody(r));
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const qrToken = str(data.qrToken);
  if (!qrToken) {
    // Kontrak dilanggar (200 tanpa token): ok:false jujur, bukan sukses palsu.
    return failWith<TerminalQrIssueData>(r.status, r.fromDummy, r.data);
  }
  const ttl = Number(data.ttlSeconds);
  return {
    ok: true,
    data: {
      qrToken,
      expiresAt: str(data.expiresAt),
      ttlSeconds: Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 60,
    },
    fromDummy: false,
  };
}

/**
 * E04: unbind — owner lepas binding terminal (force-unbind admin; pengusiran
 * penghuni oleh owner). POST /terminals/{id}/unbind (tanpa body; owner-only
 * + UserAuth) → {terminalId, bound:false}. Beda dari E30 release (occupant
 * melepas MILIKNYA sendiri: member-only + {deviceId}). UI exit/keluar-resto +
 * aturan peran Q-E milik lane screens — helper ini hanya transport.
 */
export async function unbindTerminal(
  terminalId: string,
): Promise<TerminalApiResult<{ terminalId: string; bound: boolean }>> {
  const r = await apiFetch(withId(ApiPath.terminalUnbind, terminalId));
  if (!r.ok || r.fromDummy) {
    return failWith<{ terminalId: string; bound: boolean }>(r.status, r.fromDummy, rawErrorBody(r));
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return {
    ok: true,
    data: { terminalId: str(data.terminalId ?? terminalId), bound: data.bound === true },
    fromDummy: false,
  };
}

/**
 * E10: owner bikin terminal di branch. POST /branches/{id}/terminals
 * {name (wajib, ≤120 char), tag (wajib, 1 dari 5 kanonis), terminalCode?
 * (opsional, ≤8 char; kosong = server assign otomatis)} → 201 + bentuk
 * terminal penuh. Penolakan jujur via failWith: TERMINAL_QUEUE_EXISTS /
 * TERMINAL_CODE_TAKEN (409), VALIDATION_ERROR (400), 403 bukan owner.
 * UI terminal-management milik lane settings/install.
 */
export interface TerminalCreateInput {
  name: string;
  tag: string;
  terminalCode?: string;
}

export async function createTerminal(
  branchId: string,
  input: TerminalCreateInput,
): Promise<TerminalApiResult<TerminalItem>> {
  const body: Record<string, string> = {
    name: input.name,
    tag: input.tag,
    ...(input.terminalCode ? { terminalCode: input.terminalCode } : {}),
  };
  const r = await apiFetch(withId(ApiPath.createTerminal, branchId), { body });
  if (!r.ok || r.fromDummy) {
    return failWith<TerminalItem>(r.status, r.fromDummy, rawErrorBody(r));
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return { ok: true, data: asTerminal(data), fromDummy: false };
}

/**
 * E11: owner ubah terminal (parsial). PATCH /terminals/{id} {name?, tag?}
 * → 200 + bentuk terminal. E13 /tag khusus TAK ADA di BE — ganti tag lewat
 * sini. 409 TERMINAL_QUEUE_EXISTS bila menjadi view_queue kedua di branch.
 */
export async function patchTerminal(
  terminalId: string,
  patch: { name?: string; tag?: string },
): Promise<TerminalApiResult<TerminalItem>> {
  const r = await apiFetch(withId(ApiPath.patchTerminal, terminalId), {
    method: 'PATCH',
    body: { ...patch },
  });
  if (!r.ok || r.fromDummy) {
    return failWith<TerminalItem>(r.status, r.fromDummy, rawErrorBody(r));
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return { ok: true, data: asTerminal(data), fromDummy: false };
}

/**
 * E12: owner nonaktifkan terminal (soft-delete: DeactivateTerminal + event
 * `delete`; bukan hapus fisik). DELETE /terminals/{id} (tanpa body;
 * owner-only) → {terminalId}.
 */
export async function deleteTerminal(
  terminalId: string,
): Promise<TerminalApiResult<{ terminalId: string }>> {
  const r = await apiFetch(withId(ApiPath.deleteTerminal, terminalId), {
    method: 'DELETE',
  });
  if (!r.ok || r.fromDummy) {
    return failWith<{ terminalId: string }>(r.status, r.fromDummy, rawErrorBody(r));
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return {
    ok: true,
    data: { terminalId: str(data.terminalId ?? terminalId) },
    fromDummy: false,
  };
}

/**
 * E30: release — occupant melepas binding MILIKNYA sendiri (full clear
 * device+user + burn grant triple). POST /terminals/{id}/release {deviceId}
 * → {released:true}. Beda dari E04 unbind (owner-only, admin).
 */
export async function releaseTerminal(
  terminalId: string,
  deviceId: string,
): Promise<TerminalApiResult<{ released: boolean }>> {
  const r = await apiFetch(withId(ApiPath.terminalRelease, terminalId), {
    body: { deviceId },
  });
  if (!r.ok || r.fromDummy) {
    return fail<{ released: boolean }>(r.status, r.fromDummy);
  }
  return { ok: true, data: { released: true }, fromDummy: false };
}

/**
 * E31: terminal-logout — akhiri sesi POS. POST /auth/terminal-logout
 * {deviceId} → {loggedOut, deviceStillBound}. Server merevoke sesi + grant
 * triple TAPI mempertahankan bound_device_id (logout tetap bound untuk
 * fast-login; full release = E30/E04). Gagal jaringan → {ok:false};
 * pemanggil tetap logout lokal (binding dipertahankan session.logout).
 */
export interface TerminalLogoutData {
  loggedOut: boolean;
  deviceStillBound: boolean;
}

export async function terminalLogout(
  deviceId: string,
): Promise<TerminalApiResult<TerminalLogoutData>> {
  const r = await apiFetch(ApiPath.terminalLogout, { body: { deviceId } });
  if (!r.ok || r.fromDummy) {
    return fail<TerminalLogoutData>(r.status, r.fromDummy);
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  return {
    ok: true,
    data: {
      loggedOut: data.loggedOut !== false,
      deviceStillBound: data.deviceStillBound === true,
    },
    fromDummy: false,
  };
}
/** E05: sesi aktif terminal (okupansi tunggal, SPEC §7.1) — MISSING-BE
 * (GET /terminals/{id}/occupant tanpa rute; 0 pemanggil). DEPRECATED sampai
 * lane BE mendaratkan rute (atau snapshot okupansi via SSE, alternatif yang
 * disetujui swarm): fail-closed, JANGAN dipakai untuk call baru. */
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

/** S-READINESS: kesiapan terminal (SPEC-TERMINAL-SESSION §11 baris S-READINESS).
 * GET /api/v1/terminals/{id}/readiness {deviceId?} → {needsShift, needsCash,
 * shift{open}, cash{open}, grant{valid}, pairing} (BE terminal_readiness.go,
 * member-only; deviceId opsional — tanpanya grant dilaporkan valid:false).
 * Fail-open jujur: {ok:false}/dummy/offline = status TAK DIKETAHUI —
 * pemanggil JANGAN blokir (gerbang shift lokal App.tsx tetap berlaku);
 * gate 'Shift' hanya bila server eksplisit menjawab needsShift/needsCash.
 * Pola cermin fetchOccupant (GET + withId + unwrap + fail jujur). */
export interface TerminalReadiness {
  needsShift: boolean;
  needsCash: boolean;
  shiftOpen: boolean;
  cashOpen: boolean;
  grantValid: boolean;
}

export async function fetchTerminalReadiness(
  terminalId: string,
  opts?: { deviceId?: string },
): Promise<TerminalApiResult<TerminalReadiness>> {
  const dev = (opts?.deviceId ?? '').trim();
  const r = await apiFetch(withId(ApiPath.terminalReadiness, terminalId), {
    method: 'GET',
    ...(dev ? { params: { deviceId: dev } } : {}),
  });
  if (!r.ok || r.fromDummy) {
    return fail<TerminalReadiness>(r.status, r.fromDummy);
  }
  const { data } = unwrap<Record<string, unknown>>(r.data);
  const shift = (data.shift ?? {}) as Record<string, unknown>;
  const cash = (data.cash ?? {}) as Record<string, unknown>;
  const grant = (data.grant ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      needsShift: data.needsShift === true,
      needsCash: data.needsCash === true,
      shiftOpen: shift.open === true,
      cashOpen: cash.open === true,
      grantValid: grant.valid === true,
    },
    fromDummy: false,
  };
}

