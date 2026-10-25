/**
 * Wiring-1: pemanggil kontrak merchant Go untuk shift/clock + sesi kas +
 * tutup-hari (grup /api/merchant, MerchantAuth) ke Backend Go.
 *
 * Prinsip (gas mode, aditif — cermin posWire.ts):
 * - SQLite lokal tetap cache/kebenaran; semua call ke sini best-effort dan
 *   TAK PERNAH melempar (kecuali dokumentasi sebaliknya).
 * - PIN TAK PERNAH dikirim dan TAK PERNAH diantrekan: body yang dibawa ke
 *   jaringan maupun ke antrean sync dipoles `stripPin()` dulu. Server yang
 *   mewajibkan PIN (RequirePINForPOS) menjawab PIN_REQUIRED = error jujur
 *   (reason 'rejected'), bukan antrean buta. Alur kasir lokal tetap jalan
 *   karena verifikasi PIN sudah terjadi lokal (authorizeSupervisor /
 *   verifyAttendancePin di layar) SEBELUM modul ini dipanggil.
 * - Stamp terminal numerik + retry-tanpa-stamp: terminalIdBe (string angka
 *   dari E09 picker) dikirim sebagai terminalId bila > 0; bila server menolak
 *   karena stamp (404 TERMINAL_NOT_FOUND / 400 INVALID_TERMINAL), ulangi
 *   SEKALI tanpa stamp. Payload antrean SELALU tanpa stamp (stamp bisa basi
 *   saat drain; absent = sah di server).
 * - Offline fail-open: jaringan/timeout/local-mode = {ok:false,
 *   reason:'offline'}; layar melanjutkan alur lokal + mengantrekan payload
 *   W1 (sync.ts pathFor mengurasnya). 4xx deterministik = 'rejected' jujur
 *   (JANGAN diantrekan); 5xx/429 = 'error' (layak antre).
 * - 409 idempoten = sukses: SHIFT_ALREADY_OPEN (clock-in ganda),
 *   SESSION_CLOSED (tutup ganda). 409 OPEN_POS_ORDERS = 'rejected' (kasir
 *   harus selesaikan order dulu; tutup yang tertunda dicatat pending agar
 *   flushPendingCashCloses() bisa mengulanginya).
 * - Modul ini TAK mengimpor lib/sync (arah impor: sync → beWorkforce,
 *   cermin posWire) agar tak ada siklus. Enqueue milik pemanggil (layar)
 *   via payload builder di bawah; drain menerjemahkan op W1 di sync.ts.
 */
import { ApiPath, getTerminal } from '../config/server';
import { apiFetch, getApiMode, unwrap } from './apiSource';
import { getItem, setItem } from './storage';
import { getLang } from './i18n';
import { beErrorOf } from './posWire';

// ---------------------------------------------------------------------------
// Nama op antrean W1 (dishare ke sync.ts pathFor — satu sumber nama).
// 'be-' agar TAK PERNAH tabrakan op W2 (pos-*, booking-*) maupun op ESB
// (shift-open/shift-close/move-*/...).
// ---------------------------------------------------------------------------
export const W1_OP_CLOCK_IN = 'be-clock-in';
export const W1_OP_CLOCK_OUT = 'be-clock-out';
export const W1_OP_CASH_OPEN = 'be-cash-open';
export const W1_OP_CASH_MOVE = 'be-cash-move';
export const W1_OP_CASH_CLOSE = 'be-cash-close';
export const W1_OP_CASH_APPROVE = 'be-cash-approve';
export const W1_OP_EOD_CLOSE = 'be-eod-close';

/** Timeout immediate-first W1 (cermin posWire, tanpa impor sync). */
export const BE_WF_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Pesan bilingual lokal W1 (tak menyentuh i18n.ts yang dipakai lane lain —
// append-only di modul ini agar tak tabrakan, cermin posWire WIRE_STR).
// ---------------------------------------------------------------------------
const WF_STR: Record<string, { id: string; en: string }> = {
  offline: { id: 'Offline — perubahan tersimpan di perangkat.', en: 'Offline — change kept on this device.' },
  blocked: { id: 'Tak ada id sesi server — tak dikirim (bukan kirim buta).', en: 'No server session id — not sent (never send blind).' },
  rejected: { id: 'Server menolak: {m}', en: 'Server rejected: {m}.' },
  needPin: { id: 'Server mewajibkan PIN untuk aksi ini.', en: 'Server requires a PIN for this action.' },
  needSession: { id: 'Belum ada sesi kas server — buka sesi dulu saat online.', en: 'No server cash session yet — open one while online.' },
  openOrders: { id: 'Masih ada order belum bayar di sesi kas ini.', en: 'This cash session still has unpaid orders.' },
  ok: { id: 'Tersinkron ke server.', en: 'Synced to server.' },
};

export function wfTr(key: string, vars?: Record<string, string>): string {
  const e = WF_STR[key] ?? WF_STR.blocked;
  const lang = (() => {
    try {
      return getLang();
    } catch {
      return 'id';
    }
  })();
  let s = lang === 'en' ? e.en : e.id;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Hasil + util parsing ketat.
// ---------------------------------------------------------------------------
export type WfReason = 'offline' | 'blocked' | 'rejected' | 'error';
export type WfResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: WfReason; code?: string; message?: string; status?: number };

function numOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function strOf(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** Id sesi server BE (int64 serial sebagai angka/"123", mulai dari 1). Non-desimal = bukan id server. */
export function isServerSessionId(v: unknown): boolean {
  return /^[1-9][0-9]*$/.test(String(v ?? '').trim());
}

export function pathWithSession(tmpl: string, id: string | number): string {
  return String(tmpl).replace('{sessionId}', encodeURIComponent(String(id)));
}

/** true bila mode real (backend sendiri). Local/dummy = offline untuk W1. */
export function isW1Online(): boolean {
  try {
    return getApiMode() === 'real';
  } catch {
    return false;
  }
}

function withTimeoutMs<T>(promise: Promise<T>, ms = BE_WF_TIMEOUT_MS): Promise<T> {
  const limit = Math.max(1000, Math.floor(ms));
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), limit);
    }),
  ]);
}

// ---------------------------------------------------------------------------
// PIN strip + stamp terminal.
// ---------------------------------------------------------------------------
/** Buang SEMUA kunci PIN (defense-in-depth: pemanggil tak pernah kirim PIN). */
export function stripPin<T extends Record<string, unknown>>(body: T): T {
  const out = { ...body };
  for (const k of Object.keys(out)) {
    if (k.toLowerCase() === 'pin') delete (out as Record<string, unknown>)[k];
  }
  return out;
}

/** Stamp terminal numerik BE (>0) atau 0 = tanpa stamp. Non-angka = 0. */
export function terminalStamp(): number {
  try {
    const raw = String(getTerminal()?.terminalIdBe ?? '').trim();
    if (!/^[0-9]+$/.test(raw)) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

interface BeCall {
  res: Awaited<ReturnType<typeof apiFetch>>;
}

async function postBe(path: string, body: Record<string, unknown>): Promise<BeCall | { offline: true }> {
  if (!isW1Online()) return { offline: true };
  try {
    const res = await withTimeoutMs(apiFetch(path, { method: 'POST', body: stripPin(body) }));
    if (res.fromDummy || res.status === 0) return { offline: true };
    return { res };
  } catch {
    return { offline: true };
  }
}

function offlineResult<T>(): WfResult<T> {
  return { ok: false, reason: 'offline', message: wfTr('offline') };
}

/**
 * POST dengan stamp terminal + retry-tanpa-stamp SEKALI bila server menolak
 * stamp-nya (404 TERMINAL_NOT_FOUND / 400 INVALID_TERMINAL). PIN tak pernah
 * ikut (stripPin di postBe).
 */
async function postWithStampRetry(path: string, body: Record<string, unknown>): Promise<BeCall | { offline: true }> {
  const stamp = terminalStamp();
  const first = await postBe(path, stamp > 0 ? { ...body, terminalId: stamp } : { ...body });
  if (!('res' in first)) return first;
  if (!first.res.ok) {
    const be = beErrorOf(first.res.data);
    if (
      first.res.status === 404 ? be.code === 'TERMINAL_NOT_FOUND'
      : first.res.status === 400 ? be.code === 'INVALID_TERMINAL'
      : false
    ) {
      if (stamp > 0) return postBe(path, { ...body });
    }
  }
  return first;
}

function rejected<T>(status: number, body: unknown): WfResult<T> {
  const be = beErrorOf(body);
  return {
    ok: false,
    reason: 'rejected',
    code: be.code || `HTTP_${status}`,
    message: wfTr('rejected', { m: be.message || be.code || `HTTP ${status}` }),
    status,
  };
}

// Kode yang berarti "sudah dalam keadaan target" = sukses idempoten.
const REPLAY_OK_CODES = /^(SHIFT_ALREADY_OPEN|SESSION_CLOSED|SHIFT_ALREADY_CLOSED)$/;

// ---------------------------------------------------------------------------
// Clock in / out (workforce milik sendiri — ac.UserID server).
// ---------------------------------------------------------------------------
export interface ClockResult {
  shiftId: number;
  replayed: boolean;
}

export async function clockInBe(): Promise<WfResult<ClockResult>> {
  const call = await postWithStampRetry(ApiPath.merchantClockIn, {});
  if (!('res' in call)) return offlineResult();
  const { res } = call;
  if (res.ok) {
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const id = numOf((data as Record<string, unknown>)?.id);
    return { ok: true, data: { shiftId: id > 0 ? Math.round(id) : 0, replayed: false } };
  }
  const be = beErrorOf(res.data);
  if (res.status === 409 && REPLAY_OK_CODES.test(be.code)) {
    return { ok: true, data: { shiftId: 0, replayed: true } };
  }
  if (res.status >= 500 || res.status === 429) {
    return { ok: false, reason: 'error', code: be.code || `HTTP_${res.status}`, message: be.message || wfTr('offline'), status: res.status };
  }
  return rejected(res.status, res.data);
}

export async function clockOutBe(): Promise<WfResult<ClockResult>> {
  const call = await postWithStampRetry(ApiPath.merchantClockOut, {});
  if (!('res' in call)) return offlineResult();
  const { res } = call;
  if (res.ok) {
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const id = numOf((data as Record<string, unknown>)?.id);
    return { ok: true, data: { shiftId: id > 0 ? Math.round(id) : 0, replayed: false } };
  }
  const be = beErrorOf(res.data);
  if (res.status === 409 && REPLAY_OK_CODES.test(be.code)) {
    return { ok: true, data: { shiftId: 0, replayed: true } };
  }
  if (res.status === 409 && be.code === 'NO_OPEN_SHIFT') {
    // Tak ada shift terbuka di server = sudah dalam keadaan target.
    return { ok: true, data: { shiftId: 0, replayed: true } };
  }
  if (res.status >= 500 || res.status === 429) {
    return { ok: false, reason: 'error', code: be.code || `HTTP_${res.status}`, message: be.message || wfTr('offline'), status: res.status };
  }
  return rejected(res.status, res.data);
}

// ---------------------------------------------------------------------------
// Sesi kas: id sesi server dis persist agar tutup/gerak lanjutan bisa
// menunjuk sesi yang sama (tanpa id server = BLOCKED jujur).
// ---------------------------------------------------------------------------
const LS_CASH_SESSION = 'genfity.be.cashSessionId';
const LS_PENDING_CLOSES = 'genfity.be.pendingCashCloses';

let cashSessionMem: string | null = null;

export async function getCashSessionId(): Promise<string | null> {
  if (cashSessionMem) return cashSessionMem;
  try {
    const v = await getItem(LS_CASH_SESSION);
    const s = String(v ?? '').trim();
    if (isServerSessionId(s)) {
      cashSessionMem = s;
      return s;
    }
  } catch {
    /* abaikan */
  }
  return null;
}

export async function setCashSessionId(id: string | number): Promise<void> {
  const s = String(id ?? '').trim();
  if (!isServerSessionId(s)) return;
  cashSessionMem = s;
  try {
    await setItem(LS_CASH_SESSION, s);
  } catch {
    /* abaikan */
  }
}

export async function clearCashSessionId(): Promise<void> {
  cashSessionMem = null;
  try {
    await setItem(LS_CASH_SESSION, '');
  } catch {
    /* abaikan */
  }
}

// ---------------------------------------------------------------------------
// Sesi menunggu review manager: diset saat tutup-kas menjawab
// pendingManagerReview, dibaca ShiftScreen sebagai kartu approve, dibersihkan
// saat approve sukses (atau replay REVIEW_NOT_PENDING).
// ---------------------------------------------------------------------------
const LS_PENDING_REVIEW = 'genfity.be.pendingReviewSid';

let pendingReviewMem: string | null = null;

export async function getPendingReviewSid(): Promise<string | null> {
  if (pendingReviewMem) return pendingReviewMem;
  try {
    const v = await getItem(LS_PENDING_REVIEW);
    const s = String(v ?? '').trim();
    if (isServerSessionId(s)) {
      pendingReviewMem = s;
      return s;
    }
  } catch {
    /* abaikan */
  }
  return null;
}

export async function setPendingReviewSid(id: string | number): Promise<void> {
  const s = String(id ?? '').trim();
  if (!isServerSessionId(s)) return;
  pendingReviewMem = s;
  try {
    await setItem(LS_PENDING_REVIEW, s);
  } catch {
    /* abaikan */
  }
}

export async function clearPendingReviewSid(): Promise<void> {
  pendingReviewMem = null;
  try {
    await setItem(LS_PENDING_REVIEW, '');
  } catch {
    /* abaikan */
  }
}

export interface CashOpenResult {
  sessionId: number;
}

export async function cashOpenBe(openingCash: number, note?: string): Promise<WfResult<CashOpenResult>> {
  const cash = Math.max(0, Math.round(numOf(openingCash)));
  // registerId 0 = server pakai/buat 'Main register' (kontrak BE).
  const body: Record<string, unknown> = { registerId: 0, openingCash: cash };
  const n = String(note ?? '').trim();
  if (n) body.note = n.slice(0, 500);
  const call = await postWithStampRetry(ApiPath.merchantCashOpen, body);
  if (!('res' in call)) return offlineResult();
  const { res } = call;
  if (res.ok) {
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const id = Math.round(numOf((data as Record<string, unknown>)?.id));
    if (id <= 0) {
      return { ok: false, reason: 'error', code: 'BAD_RESPONSE', message: 'Server tanpa id sesi', status: res.status };
    }
    await setCashSessionId(id);
    return { ok: true, data: { sessionId: id } };
  }
  const be = beErrorOf(res.data);
  if (res.status >= 500 || res.status === 429) {
    return { ok: false, reason: 'error', code: be.code || `HTTP_${res.status}`, message: be.message || wfTr('offline'), status: res.status };
  }
  return rejected(res.status, res.data);
}

export type CashMoveType = 'PAID_IN' | 'PAID_OUT' | 'CASH_DROP';

export function mapArusToMoveType(arus: unknown): CashMoveType | null {
  const k = String(arus ?? '').trim().toLowerCase();
  if (k === 'masuk' || k === 'in' || k === 'paid_in') return 'PAID_IN';
  if (k === 'keluar' || k === 'out' || k === 'paid_out') return 'PAID_OUT';
  if (k === 'drop' || k === 'cash_drop') return 'CASH_DROP';
  return null;
}

export interface CashMoveResult {
  movementId: number;
}

export async function cashMoveBe(
  sessionId: string | number,
  type: CashMoveType,
  amount: number,
  reason: string,
): Promise<WfResult<CashMoveResult>> {
  if (!isServerSessionId(sessionId)) {
    return { ok: false, reason: 'blocked', message: wfTr('blocked') };
  }
  const amt = Math.round(numOf(amount));
  const rs = String(reason ?? '').trim();
  if (amt <= 0 || !rs) {
    return { ok: false, reason: 'blocked', message: wfTr('blocked') };
  }
  const call = await postWithStampRetry(pathWithSession(ApiPath.merchantCashMove, sessionId), {
    type,
    amount: amt,
    reason: rs.slice(0, 500),
  });
  if (!('res' in call)) return offlineResult();
  const { res } = call;
  if (res.ok) {
    const { data } = unwrap<Record<string, unknown>>(res.data);
    return { ok: true, data: { movementId: Math.round(numOf((data as Record<string, unknown>)?.id)) } };
  }
  const be = beErrorOf(res.data);
  if (res.status >= 500 || res.status === 429) {
    return { ok: false, reason: 'error', code: be.code || `HTTP_${res.status}`, message: be.message || wfTr('offline'), status: res.status };
  }
  return rejected(res.status, res.data);
}

export interface CashCloseResult {
  sessionId: number;
  status: string;
  pendingManagerReview: boolean;
  expectedCash: number;
  actualCash: number;
  variance: number;
  replayed: boolean;
}

export async function cashCloseBe(
  sessionId: string | number,
  actualCash: number,
  note?: string,
): Promise<WfResult<CashCloseResult>> {
  if (!isServerSessionId(sessionId)) {
    return { ok: false, reason: 'blocked', message: wfTr('blocked') };
  }
  const sid = parseInt(String(sessionId).trim(), 10);
  const body: Record<string, unknown> = { actualCash: Math.max(0, Math.round(numOf(actualCash))) };
  const n = String(note ?? '').trim();
  if (n) body.note = n.slice(0, 500);
  const call = await postWithStampRetry(pathWithSession(ApiPath.merchantCashClose, sid), body);
  if (!('res' in call)) return offlineResult();
  const { res } = call;
  if (res.ok) {
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const d = (data ?? {}) as Record<string, unknown>;
    await clearCashSessionId();
    return {
      ok: true,
      data: {
        sessionId: sid,
        status: strOf(d.status) || 'CLOSED',
        pendingManagerReview: (d.pendingManagerReview ?? d.pending_review) === true,
        expectedCash: numOf(d.expectedCash ?? d.expected_cash),
        actualCash: numOf(d.actualCash ?? d.actual_cash),
        variance: numOf(d.variance),
        replayed: false,
      },
    };
  }
  const be = beErrorOf(res.data);
  if (res.status === 409 && be.code === 'SESSION_CLOSED') {
    await clearCashSessionId();
    return {
      ok: true,
      data: {
        sessionId: sid, status: 'CLOSED', pendingManagerReview: false,
        expectedCash: 0, actualCash: body.actualCash as number, variance: 0, replayed: true,
      },
    };
  }
  if (res.status === 409 && be.code === 'OPEN_POS_ORDERS') {
    return { ok: false, reason: 'rejected', code: be.code, message: wfTr('openOrders'), status: res.status };
  }
  if (res.status >= 500 || res.status === 429) {
    return { ok: false, reason: 'error', code: be.code || `HTTP_${res.status}`, message: be.message || wfTr('offline'), status: res.status };
  }
  return rejected(res.status, res.data);
}

// ---------------------------------------------------------------------------
// Tutup tertunda: tutup kas yang gagal karena offline / OPEN_POS_ORDERS
// dicatat agar bisa di-flush ulang (dipanggil saat layar kasir dibuka +
// sesudah tutup shift). Best-effort, tak pernah melempar.
// ---------------------------------------------------------------------------
export interface PendingCashClose {
  sessionId: string;
  actualCash: number;
  note: string | null;
  at: string;
}

export async function loadPendingCashCloses(): Promise<PendingCashClose[]> {
  try {
    const raw = await getItem(LS_PENDING_CLOSES);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: PendingCashClose[] = [];
    for (const e of arr) {
      if (!e || typeof e !== 'object') continue;
      const r = e as Record<string, unknown>;
      const sid = String(r.sessionId ?? '').trim();
      if (!isServerSessionId(sid)) continue;
      out.push({
        sessionId: sid,
        actualCash: Math.max(0, Math.round(numOf(r.actualCash))),
        note: typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 500) : null,
        at: strOf(r.at) || new Date(0).toISOString(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function savePendingCashCloses(list: PendingCashClose[]): Promise<void> {
  try {
    await setItem(LS_PENDING_CLOSES, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* abaikan */
  }
}

export async function recordPendingCashClose(p: PendingCashClose): Promise<void> {
  if (!isServerSessionId(p.sessionId)) return;
  const cur = await loadPendingCashCloses();
  const rest = cur.filter((e) => e.sessionId !== p.sessionId);
  rest.push(p);
  await savePendingCashCloses(rest);
}

export async function dropPendingCashClose(sessionId: string | number): Promise<void> {
  const sid = String(sessionId ?? '').trim();
  const cur = await loadPendingCashCloses();
  await savePendingCashCloses(cur.filter((e) => e.sessionId !== sid));
}

export interface FlushSummary {
  attempted: number;
  flushed: number;
  remaining: number;
}

/** Ulangi tutup tertunda (berhenti di offline pertama; entri sukses/hilang dihapus). */
export async function flushPendingCashCloses(): Promise<FlushSummary> {
  const pending = await loadPendingCashCloses();
  let flushed = 0;
  let attempted = 0;
  const rest: PendingCashClose[] = [];
  for (const p of pending) {
    attempted += 1;
    let r: WfResult<CashCloseResult>;
    try {
      r = await cashCloseBe(p.sessionId, p.actualCash, p.note ?? undefined);
    } catch {
      rest.push(p);
      continue;
    }
    if (r.ok) {
      flushed += 1;
      continue;
    }
    if (r.reason === 'offline' || r.reason === 'error') {
      // Offline/5xx: berhenti, sisanya (termasuk ini) tetap antre.
      rest.push(p);
      const idx = pending.indexOf(p);
      for (let i = idx + 1; i < pending.length; i++) rest.push(pending[i]);
      break;
    }
    if (r.reason === 'blocked') {
      // Sesi tak valid — buang (jangan antre selamanya).
      continue;
    }
    // 'rejected' deterministik (OPEN_POS_ORDERS / PIN / validasi): simpan
    // untuk percobaan berikut (kasir akan selesaikan order dulu).
    rest.push(p);
  }
  await savePendingCashCloses(rest);
  return { attempted, flushed, remaining: rest.length };
}

// ---------------------------------------------------------------------------
// Tutup-hari (read-only preview + close; layar khusus belum ada — dipakai
// probe/flush; error jujur, offline fail-open).
// ---------------------------------------------------------------------------
export interface EodSnapshot {
  businessDate: string;
  blockers: string[];
  canClose: boolean;
}

export async function eodPreviewBe(date?: string): Promise<WfResult<EodSnapshot>> {
  if (!isW1Online()) return offlineResult();
  try {
    const d = String(date ?? '').trim();
    const res = await withTimeoutMs(
      apiFetch(ApiPath.merchantEodPreview, {
        method: 'GET',
        ...(d ? { params: { date: d } } : {}),
      }),
    );
    if (res.fromDummy || res.status === 0) return offlineResult();
    if (!res.ok) {
      const be = beErrorOf(res.data);
      if (res.status >= 500 || res.status === 429) {
        return { ok: false, reason: 'error', code: be.code || `HTTP_${res.status}`, message: be.message || wfTr('offline'), status: res.status };
      }
      return rejected(res.status, res.data);
    }
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const d0 = (data ?? {}) as Record<string, unknown>;
    const snap = (d0.snapshot ?? d0) as Record<string, unknown>;
    const rawBlockers = (snap as Record<string, unknown>).blockers ?? (d0 as Record<string, unknown>).blockers;
    const blockers = Array.isArray(rawBlockers) ? rawBlockers.map((b) => strOf(b)).filter((b) => b.length > 0) : [];
    const canCloseRaw = (d0 as Record<string, unknown>).canClose ?? (snap as Record<string, unknown>).canClose;
    return {
      ok: true,
      data: {
        businessDate: strOf((snap as Record<string, unknown>).businessDate ?? (snap as Record<string, unknown>).business_date),
        blockers,
        canClose: typeof canCloseRaw === 'boolean' ? canCloseRaw : blockers.length === 0,
      },
    };
  } catch {
    return offlineResult();
  }
}

export async function eodCloseBe(date?: string): Promise<WfResult<{ businessDate: string }>> {
  const body: Record<string, unknown> = {};
  const d = String(date ?? '').trim();
  if (d) body.date = d;
  const call = await postBe(ApiPath.merchantEodClose, body);
  if (!('res' in call)) return offlineResult();
  const { res } = call;
  if (res.ok) {
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const d0 = ((data ?? {}) as Record<string, unknown>).snapshot ?? data ?? {};
    return { ok: true, data: { businessDate: strOf((d0 as Record<string, unknown>).businessDate ?? d) || d } };
  }
  const be = beErrorOf(res.data);
  if (res.status >= 500 || res.status === 429) {
    return { ok: false, reason: 'error', code: be.code || `HTTP_${res.status}`, message: be.message || wfTr('offline'), status: res.status };
  }
  return rejected(res.status, res.data);
}

// ---------------------------------------------------------------------------
// Payload builder antrean W1 (murni, TANPA stamp terminal + TANPA PIN —
// drain sync mem-POST apa adanya via pathFor).
// ---------------------------------------------------------------------------
export function clockInPayload(): Record<string, unknown> {
  return { op: W1_OP_CLOCK_IN };
}

export function clockOutPayload(): Record<string, unknown> {
  return { op: W1_OP_CLOCK_OUT };
}

export function cashOpenPayload(openingCash: number, note?: string): Record<string, unknown> {
  const p: Record<string, unknown> = { op: W1_OP_CASH_OPEN, openingCash: Math.max(0, Math.round(numOf(openingCash))) };
  const n = String(note ?? '').trim();
  if (n) p.note = n.slice(0, 500);
  return p;
}

export function cashMovePayload(type: CashMoveType, amount: number, reason: string): Record<string, unknown> {
  return {
    op: W1_OP_CASH_MOVE,
    type,
    amount: Math.max(0, Math.round(numOf(amount))),
    reason: String(reason ?? '').trim().slice(0, 500),
  };
}

export function cashClosePayload(actualCash: number, note?: string): Record<string, unknown> {
  const p: Record<string, unknown> = { op: W1_OP_CASH_CLOSE, actualCash: Math.max(0, Math.round(numOf(actualCash))) };
  const n = String(note ?? '').trim();
  if (n) p.note = n.slice(0, 500);
  return p;
}

// ---------------------------------------------------------------------------
// Approve sesi kas (manager KEDUA; closer tak boleh approve sesi sendiri —
// server menjawab 403 INDEPENDENT_REVIEW_REQUIRED = 'rejected' jujur).
// Catatan wajib 1–500 char (aturan server). PIN tak pernah ikut.
// ---------------------------------------------------------------------------
export interface CashApproveResult {
  sessionId: number;
  status: string;
  approvedBy: string;
  replayed: boolean;
}

export async function cashApproveBe(
  sessionId: string | number,
  note: string,
): Promise<WfResult<CashApproveResult>> {
  if (!isServerSessionId(sessionId)) {
    return { ok: false, reason: 'blocked', message: wfTr('blocked') };
  }
  const n = String(note ?? '').trim();
  if (!n) {
    return { ok: false, reason: 'blocked', message: wfTr('blocked') };
  }
  const sid = parseInt(String(sessionId).trim(), 10);
  const call = await postWithStampRetry(pathWithSession(ApiPath.merchantCashApprove, sid), {
    note: n.slice(0, 500),
  });
  if (!('res' in call)) return offlineResult();
  const { res } = call;
  if (res.ok) {
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const d = (data ?? {}) as Record<string, unknown>;
    try {
      await clearPendingReviewSid();
    } catch {
      /* abaikan */
    }
    return {
      ok: true,
      data: {
        sessionId: sid,
        status: strOf(d.status) || 'CLOSED',
        approvedBy: strOf(d.approvedBy ?? d.approved_by),
        replayed: false,
      },
    };
  }
  const be = beErrorOf(res.data);
  if (res.status === 409 && be.code === 'REVIEW_NOT_PENDING') {
    // Sudah di-approve (retry ganda) = keadaan target.
    try {
      await clearPendingReviewSid();
    } catch {
      /* abaikan */
    }
    return { ok: true, data: { sessionId: sid, status: 'CLOSED', approvedBy: '', replayed: true } };
  }
  if (res.status >= 500 || res.status === 429) {
    return { ok: false, reason: 'error', code: be.code || `HTTP_${res.status}`, message: be.message || wfTr('offline'), status: res.status };
  }
  return rejected(res.status, res.data);
}

export function cashApprovePayload(sessionId: string | number, note: string): Record<string, unknown> {
  return {
    op: W1_OP_CASH_APPROVE,
    serverSessionId: String(sessionId ?? '').trim(),
    note: String(note ?? '').trim().slice(0, 500),
  };
}

/** Layak diantrekan ke sync (offline/5xx/429) vs error jujur final (4xx deterministik). */
export function shouldQueueW1<T>(r: WfResult<T>): boolean {
  if (r.ok) return false;
  if (r.reason === 'offline') return true;
  if (r.reason === 'error') {
    const s = r.status ?? 0;
    return s === 0 || s >= 500 || s === 429;
  }
  return false;
}
