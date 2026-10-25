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
import { ApiPath, getBaseUrl, getTerminal } from '../config/server';
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

// A-P0-1: flag wajib-ganti-PIN pasca-seed. PIN seed = acak sekali-pakai yang
// tak diketahui siapa pun; eskalasi supervisor akun default ('u-admin')
// DITOLAK selama flag '1' — kasir wajib buat PIN via Install/CreatePin atau
// reset via Lupa PIN (keduanya membersihkan flag). Instalasi lama yang
// record-nya sudah ada tak tersentuh (hash tak bisa membuktikan PIN default)
// — limitasi terdokumentasi, bukan celah baru.
export const PIN_MUST_CHANGE_PREFIX = 'genfity.pin.mustChange.';
export async function isPinChangeRequired(userId: string): Promise<boolean> {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  try {
    return (await getItem(PIN_MUST_CHANGE_PREFIX + id)) === '1';
  } catch {
    // Fail-closed: storage tak terbaca = anggap wajib ganti.
    return true;
  }
}
export async function markPinChangeRequired(userId: string): Promise<void> {
  const id = String(userId ?? '').trim();
  if (!id) return;
  await setItem(PIN_MUST_CHANGE_PREFIX + id, '1');
}
export async function clearPinChangeRequired(userId: string): Promise<void> {
  const id = String(userId ?? '').trim();
  if (!id) return;
  await setItem(PIN_MUST_CHANGE_PREFIX + id, '0');
}

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
  // A-P0-1: tolak akun default selama flag wajib-ganti menyala (PIN seed
  // acak sekali-pakai belum diganti manusia). Bakar attempt seperti tebakan
  // gagal — PIN default bukan kredensial sah.
  if (v.userId === 'u-admin') {
    let must = true;
    try {
      must = await isPinChangeRequired('u-admin');
    } catch {
      must = true;
    }
    if (must) return fail('denied', tOf('sup_default_deny'));
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

// ---------------------------------------------------------------------------
// S7 (PP-001/PP-016): otorisasi supervisor via kontrak BE BARU
// POST /api/v1/terminals/{id}/supervisor-approve {supervisorUserId,
// supervisorPin, action, refId, reason} (BE router.go:1119,
// supervisor_approve.go). PENGGANTI legacy authorizeSupervisor {pin} untuk
// alur void/eskalasi/compliment — legacy DINYATAKAN MATI di Real mode (404,
// kontrak API-CONTRACT §4.4) dan NOL dipakai alur-alur tersebut; shift screens
// tetap legacy (E29 territory, follow-up eksplisit, bukan urusan S7).
//
// Perbedaan vs legacy: identitas supervisor EKSPLISIT (userId numerik BE —
// APP tak punya roster staf, E18 MISSING-BE, jadi UI memakai input ID numerik
// eksplisit; follow-up owner: endpoint roster) + aksi/refId/alasan tercatat
// append-only di pos_supervisor_approvals. Supervisor = OWNER atau grant
// supervisor_override; self-approval direkam BE apa adanya.
//
// Throttle 5x/60 dtk + klasifikasi offline-sebelum-hitung (R35) + PIN
// full-string tanpa slice (R38) + abort 15 dtk (GAP-5) dipertahankan sama
// dengan legacy. Kegagalan bentuk-formulir (userId/aksi/refId/alasan)
// TIDAK membakar attempt — itu kesalahan isi, bukan tebakan PIN; hanya
// PIN-shape salah (M1) dan penolakan server yang membakar.
// ---------------------------------------------------------------------------

/** Batas kontrak BE (supervisor_approve.go:179-193): action 1..64, refId ≤128, reason 1..500. */
export const SUPERVISOR_V1_LIMITS = { actionMin: 1, actionMax: 64, refIdMax: 128, reasonMin: 1, reasonMax: 500 } as const;

/**
 * COND-2 (syarat merge, PP-028/BE orders_pos_payment.go:404): aksi kanonis
 * yang WAJIB dipakai approval compliment — persis `COMPLIMENT_SETTLE`
 * (case-sensitive, tanpa trim-toleransi di sisi APP: BE memang trim, tapi
 * APP mengirim persis agar tak ada ambiguitas). Satu char salah = baris
 * approval tak cocok → settle COMPLIMENT 403 COMPLIMENT_APPROVAL_REQUIRED
 * permanen yang benar. JANGAN hardcode string ini di layar — impor konstanta.
 */
export const SUPERVISOR_ACTION_COMPLIMENT_SETTLE = 'COMPLIMENT_SETTLE';

/**
 * COND-3 (PP-007 Tahap 0, kunci kontrak): aksi kanonis yang WAJIB dipakai
 * approval void/refund — persis `ORDER_VOID` / `ORDER_REFUND` (case-sensitive,
 * pola sama seperti COMPLIMENT_SETTLE di atas). Enforcement BE (W9) hanya
 * mengenali kedua string ini; approval yang dibuat dengan literal lowercase
 * (`void`/`refund`) TAKKAN cocok → void/refund staf 403 permanen yang benar.
 * JANGAN hardcode string ini di layar — impor konstanta.
 * Scope: HANYA action supervisor-approve V1. Namespace outbox lokal
 * (`history.ts` action `void`) dan approval `cancel` (Belum ada enforcement
 * BE; tetap lowercase) TIDAK ikut dikunci tahap ini.
 */
export const SUPERVISOR_ACTION_ORDER_VOID = 'ORDER_VOID';
export const SUPERVISOR_ACTION_ORDER_REFUND = 'ORDER_REFUND';

/**
 * COND-2: refId approval compliment = id-desimal order BE
 * (strconv.FormatInt(orderID, 10) — tanpa nol depan, bukan nomor struk
 * human-readable/salesNum). False = jangan kunci (dialog tetap bisa diisi
 * manual, tapi approval itu TAKKAN cocok untuk settle — lihat ExtraPaySection).
 */
export function isDecimalOrderId(s: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test((s ?? '').trim());
}

export interface SupervisorV1Input {
  /** ID numerik BE terminal untuk path /terminals/{id} (bukan terminalCode). */
  terminalId: string;
  /** ID numerik BE supervisor (merchant_users) — input eksplisit di UI. */
  supervisorUserId: number;
  /** PIN workforce milik supervisor (bukan PIN kasir yang login). */
  supervisorPin: string;
  /** Aksi bebas 1..64 char. Untuk void/refund WAJIB konstanta kanonis
   * (SUPERVISOR_ACTION_ORDER_VOID/REFUND — BE hanya cocok persis itu);
   * `cancel` tetap lowercase (tanpa enforcement BE); `compliment` via konstanta. */
  action: string;
  /** Referensi bebas ≤128 char (cth. order id); boleh kosong — KECUALI
   * untuk COMPLIMENT_SETTLE (OFFLINE-RULE: wajib id-desimal, lihat gate di
   * authorizeSupervisorV1). */
  refId?: string;
  /** Alasan WAJIB 1..500 char — tercatat di audit BE. */
  reason: string;
}

export interface SupervisorV1Result extends AuthResult {
  /** ID baris pos_supervisor_approvals (string angka; undefined = jalur lokal). */
  approvalId?: string;
  /** Waktu persetujuan ISO dari BE (undefined = jalur lokal). */
  approvedAt?: string;
}

/** ID numerik BE terminal yang ter-bound (cermin session → server store, S7).
 * '' = belum ada (binding lama / belum bind) → dialog wajib minta isi manual. */
export function getBoundSupervisorTerminalId(): string {
  try {
    return String(getTerminal().terminalIdBe ?? '').trim();
  } catch {
    return '';
  }
}

/** Baca kode error envelope BE {success:false, error:CODE, message} (response.go:33). */
function v1ErrorOf(body: unknown): { code: string; message: string } {
  try {
    const b = (body ?? {}) as Record<string, unknown>;
    const code = typeof b.error === 'string' ? b.error : '';
    const message = typeof b.message === 'string' ? b.message : '';
    return { code, message };
  } catch {
    return { code: '', message: '' };
  }
}

export async function authorizeSupervisorV1(input: SupervisorV1Input): Promise<SupervisorV1Result> {
  await hydrateThrottle();
  if (lockedUntil !== 0 && !isLocked()) {
    attempts = 0;
    lockedUntil = 0;
    persistThrottle();
  }
  if (isLocked()) return locked();
  // R39 (paritas legacy): tanpa base URL / mode local → unconfigured AWAL,
  // tanpa bakar attempt. Pemanggil lanjut ke verifyLocalEscalation.
  if (getApiMode() === 'local' || !getBaseUrl()) {
    return { ok: false, code: 'unconfigured', message: tOf('sup_unconfigured') };
  }
  // Validasi bentuk-formulir: TANPA fail() (tanpa bakar attempt).
  const badField = tOf('sup_v1_badfield');
  const terminalId = String(input?.terminalId ?? '').trim();
  if (!terminalId) {
    return { ok: false, code: 'denied', message: tOf('terminal_unbound_hint') };
  }
  const supervisorUserId = input?.supervisorUserId;
  if (!Number.isInteger(supervisorUserId) || (supervisorUserId as number) <= 0) {
    return { ok: false, code: 'invalid', message: badField };
  }
  const action = String(input?.action ?? '').trim();
  if (action.length < SUPERVISOR_V1_LIMITS.actionMin || action.length > SUPERVISOR_V1_LIMITS.actionMax) {
    return { ok: false, code: 'invalid', message: badField };
  }
  const refId = String(input?.refId ?? '').trim();
  if (refId.length > SUPERVISOR_V1_LIMITS.refIdMax) {
    return { ok: false, code: 'invalid', message: badField };
  }
  // OFFLINE-RULE (putusan koordinator): approval COMPLIMENT_SETTLE wajib
  // refId id-desimal order (create-first). BE membolehkan refId kosong, tapi
  // approval begitu TAKKAN cocok untuk settle (403 permanen) — jadi APP
  // menolak mengirimnya di sini (tanpa bakar attempt). Non-desimal lain
  // (salesNum/nomor struk) ikut ditolak dengan pesan yang sama.
  if (action === SUPERVISOR_ACTION_COMPLIMENT_SETTLE && !isDecimalOrderId(refId)) {
    return { ok: false, code: 'invalid', message: tOf('sup_v1_refid_need') };
  }
  const reason = String(input?.reason ?? '').trim();
  if (reason.length < SUPERVISOR_V1_LIMITS.reasonMin || reason.length > SUPERVISOR_V1_LIMITS.reasonMax) {
    return { ok: false, code: 'invalid', message: badField };
  }
  // R38: PIN full-string TANPA pemotongan; kebijakan panjang = BE 4..8 digit
  // (merchant_workforce.go:898,945; terminal.go:329) — AUDIT-V2: gate 4..6
  // + truncate dialog = PIN 7-8 digit sah tak pernah lolos (bahkan membakar
  // lockout server via 6-digit terpotong yang SALAH). M1: shape salah bakar.
  // (Gate legacy authorizeSupervisor + verifyLocalEscalation tetap 4..6:
  // pre-existing, dipakai alur shared di luar S7 — follow-up owner.)
  const clean = String(input?.supervisorPin ?? '').replace(/[^0-9]/g, '');
  if (!clean || clean.length < 4 || clean.length > 8) {
    return fail('invalid', tOf('sup_invalid'));
  }
  try {
    // GAP-5: abort 15 dtk selaras endpoint auth; AbortError → offline jujur.
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
      const path = ApiPath.supervisorApproveV1.replace('{id}', encodeURIComponent(terminalId));
      r = await apiFetch(path, {
        body: { supervisorUserId, supervisorPin: clean, action, refId, reason },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (r.fromDummy && getApiMode() === 'real') {
      // R35: jatuh ke dummy = offline — fail-closed jujur tanpa bakar attempt.
      return { ok: false, code: 'offline', message: tOf('sup_offline') };
    }
    const { success, data } = unwrap<Record<string, unknown>>(r.data);
    if (r.ok && success) {
      const approvalId = String((data as Record<string, unknown>)?.approvalId ?? '').trim();
      const approvedAt = String((data as Record<string, unknown>)?.approvedAt ?? '').trim();
      if (approvalId) {
        attempts = 0;
        lockedUntil = 0;
        persistThrottle();
        return {
          ok: true,
          code: 'ok',
          message: tOf('sup_ok'),
          userId: String(supervisorUserId),
          ...(approvalId ? { approvalId } : {}),
          ...(approvedAt ? { approvedAt } : {}),
        };
      }
      // 200 tanpa approvalId = respons tak dikenal → tolak + bakar (deny).
      return fail('denied', tOf('sup_denied').replace('{n}', String(attemptsLeft() - 1)));
    }
    // Gagal: petakan kode BE (supervisor_approve.go:221-237) ke throttle lokal.
    const { code, message } = v1ErrorOf(r.data);
    if (code === 'SUPERVISOR_PIN_INVALID') {
      return fail('invalid', tOf('sup_invalid'));
    }
    if (code === 'SUPERVISOR_PIN_LOCKED' || r.status === 423 || r.status === 429) {
      // Kunci sisi server (E29 5x/5 mnt) → kunci lokal juga agar tak spam.
      attempts = MAX_ATTEMPTS;
      lockedUntil = Date.now() + LOCK_MS;
      persistThrottle();
      return locked();
    }
    if (code === 'VALIDATION_ERROR') {
      // Bentuk ditolak server — kesalahan isi, bukan tebakan: tanpa burn.
      return { ok: false, code: 'invalid', message: message || badField };
    }
    const msg = message || tOf('sup_denied').replace('{n}', String(attemptsLeft() - 1));
    return fail('denied', msg);
  } catch {
    // R35: network error tak membakar attempt — hasil offline jujur.
    return { ok: false, code: 'offline', message: tOf('sup_offline') };
  }
}
