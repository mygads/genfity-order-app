/**
 * Wiring-1: pemanggil kontrak merchant Go untuk shift/clock + sesi kas +
 * tutup-hari (grup /api/merchant, MerchantAuth) ke Backend Go.
 *
 * Prinsip (gas mode, aditif - cermin posWire.ts):
 * - SQLite lokal tetap cache/kebenaran; semua call ke sini best-effort dan
 *   TAK PERNAH melempar (kecuali dokumentasi sebaliknya).
 * - PIN live-only: panggilan live BOLEH bawa `pin` (workforce PIN 6-8 digit)
 *   + lokasi GPS opsional; payload ANTREAN tetap dipoles `stripPin()` dan
 *   TANPA lokasi basi. Server yang mewajibkan PIN (RequirePINForPOS) menjawab
 *   PIN_REQUIRED = error jujur (reason 'rejected'), bukan antrean buta.
 *   Alur kasir lokal tetap jalan karena verifikasi PIN sudah terjadi lokal
 *   (authorizeSupervisor / verifyAttendancePin di layar) SEBELUM modul ini
 *   dipanggil, lalu PIN yang sama diteruskan live ke server.
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
import { beErrorOf, isSelectionRequiredCodeW2, settlePosPayment } from './posWire';
import type { GoResult, SettleInput, SettleResult } from './posWire';

// ---------------------------------------------------------------------------
// Nama op antrean W1 (dishare ke sync.ts pathFor - satu sumber nama).
// 'be-' agar TAK PERNAH tabrakan op W2 (pos-*, booking-*) maupun op ESB
// (shift-open/shift-close/move-*/...).
// ---------------------------------------------------------------------------
export const W1_OP_CLOCK_IN = 'be-clock-in';
export const W1_OP_CLOCK_OUT = 'be-clock-out';
export const W1_OP_BREAK = 'be-break';
export const W1_OP_CASH_OPEN = 'be-cash-open';
export const W1_OP_CASH_MOVE = 'be-cash-move';
export const W1_OP_CASH_CLOSE = 'be-cash-close';
export const W1_OP_CASH_APPROVE = 'be-cash-approve';
export const W1_OP_EOD_CLOSE = 'be-eod-close';

/** Timeout immediate-first W1 (cermin posWire, tanpa impor sync). */
export const BE_WF_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Pesan bilingual lokal W1 (tak menyentuh i18n.ts yang dipakai lane lain -
// append-only di modul ini agar tak tabrakan, cermin posWire WIRE_STR).
// ---------------------------------------------------------------------------
const WF_STR: Record<string, { id: string; en: string }> = {
  offline: { id: 'Offline - perubahan tersimpan di perangkat.', en: 'Offline - change kept on this device.' },
  blocked: { id: 'Tak ada id sesi server - tak dikirim (bukan kirim buta).', en: 'No server session id - not sent (never send blind).' },
  rejected: { id: 'Server menolak: {m}', en: 'Server rejected: {m}.' },
  needPin: { id: 'Server mewajibkan PIN untuk aksi ini.', en: 'Server requires a PIN for this action.' },
  needSession: { id: 'Belum ada sesi kas server - buka sesi dulu saat online.', en: 'No server cash session yet - open one while online.' },
  openOrders: { id: 'Masih ada order belum bayar di sesi kas ini.', en: 'This cash session still has unpaid orders.' },
  selectionRequired: { id: 'Ada beberapa sesi kas terbuka - pilih salah satu di FE Laci kas (atau tutup yang lain), lalu ulangi. Tak diantrekan buta.', en: 'Multiple cash sessions are open - pick one in FE Cash drawer (or close the others), then retry. Not queued blindly.' },
  locationFailed: { id: 'Lokasi tak terverifikasi (geofence aktif). Dekatkan perangkat ke outlet / aktifkan GPS akurasi tinggi, lalu ulangi.', en: 'Location not verified (geofence on). Move closer to the outlet / enable high-accuracy GPS, then retry.' },
  sessionClosed: { id: 'Sesi kas ini sudah ditutup di server.', en: 'This cash session is already closed on the server.' },
  shiftRequired: { id: 'Butuh shift aktif - clock-in dulu sebelum aksi kas.', en: 'An active shift is required - clock in before cash actions.' },
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
/** Bulatkan ke 2 desimal (IDR/AUD aman; jangan Math.round bulat). */
export function round2(n: unknown): number {
  const v = numOf(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

export type WfLocation = { latitude?: number; longitude?: number; accuracyMeters?: number };

function cleanPin(pin: unknown): string | null {
  const s = String(pin ?? '').replace(/[^0-9]/g, '').slice(0, 8);
  return s.length >= 6 ? s : null;
}

function withLiveAuth(body: Record<string, unknown>, pin?: unknown, loc?: WfLocation | null): Record<string, unknown> {
  const out = { ...body };
  const p = cleanPin(pin);
  if (p) out.pin = p;
  if (loc && Number.isFinite(loc.latitude as number) && Number.isFinite(loc.longitude as number)) {
    out.latitude = loc.latitude;
    out.longitude = loc.longitude;
    if (Number.isFinite(loc.accuracyMeters as number)) out.accuracyMeters = loc.accuracyMeters;
  }
  return out;
}

/**
 * Ambil lokasi GPS POS (native-first expo-location, fallback web).
 * - Native: minta izin foreground SEKALI, baca Balanced (hemat baterai, cukup
 *   untuk geofence outlet), timeout 8 dtk. Izin ditolak = null jujur (layar
 *   menampilkan LOCATION_CHECK_FAILED ramah, tak menggantung UI).
 * - Web/dev: fallback navigator.geolocation.
 * - Offline: GPS tetap dicoba (GPS tak butuh internet); gagal = null.
 * Tak pernah melempar.
 */
export async function getPosLocation(timeoutMs = 8000): Promise<WfLocation | null> {
  const ms = Math.max(1000, Math.floor(Number(timeoutMs) || 8000));
  // 1) Native expo-location (dinamis agar bundel web tanpa modul tetap jalan).
  try {
    type ExpoLoc = {
      requestForegroundPermissionsAsync?: () => Promise<{ status?: string }>;
      getCurrentPositionAsync?: (opts?: Record<string, unknown>) => Promise<{ coords?: { latitude?: number; longitude?: number; accuracy?: number | null } }>;
      Accuracy?: { Balanced?: number };
    };
    let Loc: ExpoLoc | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const req = require('expo-location') as ExpoLoc | null | undefined;
      Loc = req ?? null;
    } catch {
      Loc = null;
    }
    if (Loc?.requestForegroundPermissionsAsync && Loc?.getCurrentPositionAsync) {
      try {
        const perm = await withTimeoutMs(Loc.requestForegroundPermissionsAsync(), Math.min(ms, 8000));
        if (String((perm as { status?: unknown })?.status ?? '').toLowerCase() !== 'granted') return null;
        const pos = await withTimeoutMs(
          Loc.getCurrentPositionAsync({ accuracy: Loc.Accuracy?.Balanced ?? 3 }),
          ms,
        );
        const c = (pos as { coords?: { latitude?: number; longitude?: number; accuracy?: number | null } })?.coords;
        if (c && Number.isFinite(c.latitude as number) && Number.isFinite(c.longitude as number)) {
          const out: WfLocation = { latitude: c.latitude as number, longitude: c.longitude as number };
          if (Number.isFinite(c.accuracy as number)) out.accuracyMeters = c.accuracy as number;
          return out;
        }
        return null;
      } catch {
        return null;
      }
    }
  } catch {
    /* jatuh ke fallback web di bawah */
  }
  // 2) Fallback web/navigator (Expo web + dev-client tanpa expo-location).
  try {
    const g = (globalThis as unknown as { navigator?: { geolocation?: { getCurrentPosition: (...a: unknown[]) => void } } }).navigator?.geolocation;
    if (!g) return null;
    return await new Promise<WfLocation | null>((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
      try {
        g.getCurrentPosition(
          (pos: unknown) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            const c = (pos as { coords?: { latitude?: number; longitude?: number; accuracy?: number } }).coords || {};
            if (!Number.isFinite(c.latitude as number) || !Number.isFinite(c.longitude as number)) { resolve(null); return; }
            resolve({ latitude: c.latitude as number, longitude: c.longitude as number, accuracyMeters: c.accuracy as number });
          },
          () => { if (!done) { done = true; clearTimeout(timer); resolve(null); } },
          { enableHighAccuracy: true, timeout: ms, maximumAge: 30000 } as unknown,
        );
      } catch { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
    });
  } catch { return null; }
}

/** Izin lokasi foreground sudah diberikan? null = modul lokasi tak tersedia. */
export async function getLocationPermissionState(): Promise<'granted' | 'denied' | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Loc = require('expo-location') as { getForegroundPermissionsAsync?: () => Promise<{ status?: string }> };
    if (!Loc?.getForegroundPermissionsAsync) return null;
    const r = await withTimeoutMs(Loc.getForegroundPermissionsAsync(), 4000);
    const st = String((r as { status?: unknown })?.status ?? '').toLowerCase();
    if (st === 'granted') return 'granted';
    if (st) return 'denied';
    return null;
  } catch { return null; }
}

/** Buang SEMUA kunci PIN (defense-in-depth: payload antrean tak pernah kirim PIN). */
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

async function postBe(path: string, body: Record<string, unknown>, opts?: { strip?: boolean }): Promise<BeCall | { offline: true }> {
  if (!isW1Online()) return { offline: true };
  const payload = opts?.strip === false ? body : stripPin(body);
  try {
    const res = await withTimeoutMs(apiFetch(path, { method: 'POST', body: payload }));
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
 * stamp-nya (404 TERMINAL_NOT_FOUND / 400 INVALID_TERMINAL). Live boleh bawa
 * PIN/lokasi bila `live` diisi; antrean tetap tanpa PIN (stripPin).
 */
async function postWithStampRetry(path: string, body: Record<string, unknown>, live?: { pin?: unknown; loc?: WfLocation | null }): Promise<BeCall | { offline: true }> {
  const authed = live ? withLiveAuth(body, live.pin, live.loc) : body;
  const stamp = terminalStamp();
  const first = await postBe(path, stamp > 0 ? { ...authed, terminalId: stamp } : { ...authed }, { strip: live ? false : undefined });
  if (!('res' in first)) return first;
  if (!first.res.ok) {
    const be = beErrorOf(first.res.data);
    if (
      first.res.status === 404 ? be.code === 'TERMINAL_NOT_FOUND'
      : first.res.status === 400 ? be.code === 'INVALID_TERMINAL'
      : false
    ) {
      if (stamp > 0) return postBe(path, { ...authed }, { strip: live ? false : undefined });
    }
  }
  return first;
}

const SELECTION_CODES = new Set(['CASH_SESSION_SELECTION_REQUIRED', 'SESSION_SELECTION_REQUIRED', 'SELECTION_REQUIRED']);

export function isSelectionRequiredCode(code: unknown): boolean {
  return SELECTION_CODES.has(String(code ?? '').trim().toUpperCase());
}

export function isSelectionRequiredResult<T>(r: WfResult<T>): boolean {
  return !r.ok && r.reason === 'rejected' && isSelectionRequiredCode((r as { code?: unknown }).code);
}

function friendlyWfMessage(code: string, fallback: string): string {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return fallback;
  if (c === 'PIN_REQUIRED' || c.startsWith('SUPERVISOR_PIN_') || c.startsWith('USER_PIN_')) return wfTr('needPin');
  if (c === 'LOCATION_CHECK_FAILED') return wfTr('locationFailed');
  if (SELECTION_CODES.has(c)) return wfTr('selectionRequired');
  if (c === 'OPEN_POS_ORDERS') return wfTr('openOrders');
  if (c === 'CASH_SESSION_REQUIRED' || c === 'CASH_SESSION_CLOSED' || c === 'SESSION_CLOSED') return wfTr('needSession');
  if (c === 'SHIFT_REQUIRED' || c === 'NO_OPEN_SHIFT' || c === 'SHIFT_ALREADY_CLOSED') return wfTr('shiftRequired');
  return fallback;
}

function rejected<T>(status: number, body: unknown): WfResult<T> {
  const be = beErrorOf(body);
  const code = be.code || `HTTP_${status}`;
  const fallback = wfTr('rejected', { m: be.message || be.code || `HTTP ${status}` });
  return {
    ok: false,
    reason: 'rejected',
    code,
    message: friendlyWfMessage(code, fallback),
    status,
  };
}

// Kode yang berarti "sudah dalam keadaan target" = sukses idempoten.
const REPLAY_OK_CODES = /^(SHIFT_ALREADY_OPEN|SESSION_CLOSED|SHIFT_ALREADY_CLOSED)$/;

// ---------------------------------------------------------------------------
// Clock in / out (workforce milik sendiri - ac.UserID server).
// ---------------------------------------------------------------------------
export interface ClockResult {
  shiftId: number;
  replayed: boolean;
}

export async function clockInBe(pin?: unknown, loc?: WfLocation | null): Promise<WfResult<ClockResult>> {
  const call = await postWithStampRetry(ApiPath.merchantClockIn, {}, { pin, loc });
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

export async function clockOutBe(pin?: unknown, loc?: WfLocation | null): Promise<WfResult<ClockResult>> {
  const call = await postWithStampRetry(ApiPath.merchantClockOut, {}, { pin, loc });
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

export type BreakAction = 'START' | 'END';

export async function breakBe(action: BreakAction): Promise<WfResult<{ shiftId: number }>> {
  const a = String(action || '').toUpperCase() === 'END' ? 'END' : 'START';
  const call = await postWithStampRetry(ApiPath.merchantBreak, { action: a });
  if (!('res' in call)) return offlineResult();
  const { res } = call;
  if (res.ok) {
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const id = numOf((data as Record<string, unknown>)?.shiftId ?? (data as Record<string, unknown>)?.id);
    return { ok: true, data: { shiftId: id > 0 ? Math.round(id) : 0 } };
  }
  const be = beErrorOf(res.data);
  if (res.status === 409 && (be.code === 'BREAK_ALREADY_OPEN' || be.code === 'NO_OPEN_SHIFT')) {
    // Idempoten longgar: START saat sudah istirahat / tanpa shift = rejected jujur agar UI bisa sinkron.
    if (be.code === 'BREAK_ALREADY_OPEN' && a === 'START') return { ok: true, data: { shiftId: 0 } };
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

/** P0-03: UUID sesi kas lokal saat buka shift offline (tak ada id server).
 * Dibawa di settle drain sebagai clientSessionUuid; BE cocokkan saat cash-open online.
 * Tak pernah melempar. */
export async function getPendingSessionUuid(): Promise<string | null> {
  try {
    const { getItem } = await import('./storage');
    const v = await getItem(LS_PENDING_SESSION_UUID);
    const s = String(v ?? '').trim();
    return s ? s : null;
  } catch { return null; }
}
export async function setPendingSessionUuid(uuid: string): Promise<void> {
  try {
    const { setItem } = await import('./storage');
    const s = String(uuid ?? '').trim().slice(0, 64);
    if (s) await setItem(LS_PENDING_SESSION_UUID, s);
  } catch { /* abaikan */ }
}
export async function clearPendingSessionUuid(): Promise<void> {
  try {
    const { setItem } = await import('./storage');
    await setItem(LS_PENDING_SESSION_UUID, '');
  } catch { /* abaikan */ }
}
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
const LS_PENDING_SESSION_UUID = 'genfity.be.pendingSessionUuid';
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

export async function cashOpenBe(openingCash: number, note?: string, pin?: unknown, loc?: WfLocation | null): Promise<WfResult<CashOpenResult>> {
  const cash = Math.max(0, round2(openingCash));
  // registerId 0 = server pakai/buat 'Main register' (kontrak BE).
  // P0-03: sertakan clientSessionUuid (UUID lokal saat buka offline) agar BE cocokkan saat online.
  const body: Record<string, unknown> = { registerId: 0, openingCash: cash };
  try { const pend = await getPendingSessionUuid(); if (pend) body.clientSessionUuid = pend; } catch { /* abaikan */ }
  const n = String(note ?? '').trim();
  if (n) body.note = n.slice(0, 500);
  const call = await postWithStampRetry(ApiPath.merchantCashOpen, body, { pin, loc });
  if (!('res' in call)) return offlineResult();
  const { res } = call;
  if (res.ok) {
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const id = Math.round(numOf((data as Record<string, unknown>)?.id));
    if (id <= 0) {
      return { ok: false, reason: 'error', code: 'BAD_RESPONSE', message: 'Server tanpa id sesi', status: res.status };
    }
    await setCashSessionId(id);
    try { await clearPendingSessionUuid(); } catch { /* abaikan */ }
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
  const amt = round2(amount);
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
  pin?: unknown,
): Promise<WfResult<CashCloseResult>> {
  if (!isServerSessionId(sessionId)) {
    return { ok: false, reason: 'blocked', message: wfTr('blocked') };
  }
  const sid = parseInt(String(sessionId).trim(), 10);
  const body: Record<string, unknown> = { actualCash: Math.max(0, round2(actualCash)) };
  const n = String(note ?? '').trim();
  if (n) body.note = n.slice(0, 500);
  const call = await postWithStampRetry(pathWithSession(ApiPath.merchantCashClose, sid), body, pin ? { pin } : undefined);
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
    // Jujur: BE menyertakan status aktual di data 409 (PENDING_REVIEW vs
    // CLOSED). Pakai kebenaran server agar kartu approve tak terlewat;
    // fallback 0/false bila BE lama tanpa data (kompatibel mundur).
    const raw409 = (res.data ?? {}) as Record<string, unknown>;
    const inner409 = ((raw409.data ?? {}) as Record<string, unknown>);
    return {
      ok: true,
      data: {
        sessionId: sid, status: strOf(inner409.status) || 'CLOSED',
        pendingManagerReview: inner409.pendingManagerReview === true,
        expectedCash: numOf(inner409.expectedCash),
        actualCash: numOf(inner409.actualCash ?? body.actualCash),
        variance: numOf(inner409.variance), replayed: true,
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
      // Sesi tak valid - buang (jangan antre selamanya).
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
// Tutup-hari (read-only preview + close; layar khusus belum ada - dipakai
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
// Payload builder antrean W1 (murni, TANPA stamp terminal + TANPA PIN -
// drain sync mem-POST apa adanya via pathFor).
// ---------------------------------------------------------------------------
export function clockInPayload(): Record<string, unknown> {
  return { op: W1_OP_CLOCK_IN };
}

export function clockOutPayload(): Record<string, unknown> {
  return { op: W1_OP_CLOCK_OUT };
}

export function breakPayload(action: 'START' | 'END'): Record<string, unknown> {
  return { op: W1_OP_BREAK, action: action === 'END' ? 'END' : 'START' };
}

export function cashOpenPayload(openingCash: number, note?: string): Record<string, unknown> {
  const p: Record<string, unknown> = { op: W1_OP_CASH_OPEN, openingCash: Math.max(0, round2(openingCash)) };
  const n = String(note ?? '').trim();
  if (n) p.note = n.slice(0, 500);
  return p;
}

export function cashMovePayload(type: CashMoveType, amount: number, reason: string): Record<string, unknown> {
  return {
    op: W1_OP_CASH_MOVE,
    type,
    amount: Math.max(0, round2(amount)),
    reason: String(reason ?? '').trim().slice(0, 500),
  };
}

export function cashClosePayload(actualCash: number, note?: string): Record<string, unknown> {
  const p: Record<string, unknown> = { op: W1_OP_CASH_CLOSE, actualCash: Math.max(0, round2(actualCash)) };
  const n = String(note ?? '').trim();
  if (n) p.note = n.slice(0, 500);
  return p;
}

// ---------------------------------------------------------------------------
// Approve sesi kas (manager KEDUA; closer tak boleh approve sesi sendiri -
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

/** Ganti PIN workforce ke Backend Go (PUT workforce/pin {pin baru 6-8, currentPin lama}).
 * - PIN lama diteruskan APA ADANYA (4-8 digit): BE hanya bcrypt-verify tanpa cek panjang,
 *   sehingga seed 4-digit lama LOLOS migrasi ke 6-8.
 * - PIN baru digate lokal 6-8 digit cermin BE (hemat round-trip).
 * - Best-effort: offline/timeout/local-mode = {ok:false}; TAK PERNAH melempar.
 * - Dipakai AttendanceScreen berdampingan legacy esb/employee/update-pin (fallback),
 *   agar hash server Go (staff_pos_pins) ikut mutakhir - bukan cuma hash lokal + legacy.
 */
export async function updateWorkforcePinOnServer(
  oldPin: string,
  newPin: string,
): Promise<{ ok: boolean; fromDummy: boolean; rejected?: boolean; code?: string; message?: string; status?: number }> {
  try {
    const o = String(oldPin ?? '').replace(/[^0-9]/g, '');
    const n = String(newPin ?? '').replace(/[^0-9]/g, '');
    if (o.length < 4 || o.length > 8 || n.length < 6 || n.length > 8) return { ok: false, fromDummy: false };
    if (!isW1Online()) return { ok: false, fromDummy: false };
    const res = await withTimeoutMs(
      apiFetch(ApiPath.merchantWorkforcePin, { method: 'PUT', body: { pin: n, currentPin: o } }),
      BE_WF_TIMEOUT_MS,
    );
    if (res.fromDummy || res.status === 0) return { ok: false, fromDummy: true };
    if (!res.ok) {
      // Jujur: bedakan offline vs ditolak deterministik (PIN salah/terkunci)
      // agar layar tak mengklaim "tersimpan, terkirim saat online" padahal
      // server sudah menjawab TIDAK (401/423/400).
      const be = beErrorOf(res.data);
      if (res.status >= 500 || res.status === 429 || res.status === 0) return { ok: false, fromDummy: false };
      return { ok: false, fromDummy: false, rejected: true, code: be.code, message: be.message, status: res.status };
    }
    return { ok: true, fromDummy: false };
  } catch {
    return { ok: false, fromDummy: false };
  }
}

/**
 * Settle dengan penyembuhan-sesi otomatis (auto-heal SELECTION_REQUIRED).
 * Rumahnya di sisi W1 (beWorkforce) agar sekat lane terjaga: posWire (W2)
 * TAK mengimpor beWorkforce (tripwire W1-05). Dipakai PayScreen + settleMirror.
 * Alur kasir tanpa friksi: sale lokal sudah sah, uang sudah diterima.
 * - Settle tanpa cashSessionId eksplisit yang ditolak SELECTION_REQUIRED
 *   (perangkat tak punya id sesi tapi server punya BANYAK sesi OPEN):
 *   ambil daftar sesi OPEN; bila TEPAT SATU → adopsi (persist) + ulangi settle
 *   SEKALI. Bila >1/nol/gagal-list → kembalikan rejection jujur (pemanggil
 *   mengantrekan GO_OP_SETTLE → Sync menampilkan catatan ramah; kasir memilih
 *   di FE Laci kas).
 * Tak pernah melempar (gagal-heal = rejection pertama).
 */
export async function settleWithSessionHeal(inp: SettleInput): Promise<GoResult<SettleResult>> {
  const first = await settlePosPayment(inp);
  if (first.ok) return first;
  if (first.reason !== 'rejected' || !isSelectionRequiredCodeW2(first.code)) return first;
  if (Math.max(0, Math.round(Number(inp.cashSessionId) || 0)) > 0) return first;
  try {
    const list = await listOpenCashSessionsBe();
    if (list.ok && list.data.length === 1) {
      const sid = String(list.data[0].sessionId ?? '').trim();
      const n = parseInt(sid, 10);
      if (!Number.isFinite(n) || n <= 0) return first;
      try { await chooseCashSessionId(sid); } catch { /* lanjut retry walau persist gagal */ }
      return settlePosPayment({ ...inp, cashSessionId: n });
    }
  } catch { /* abaikan: kembalikan rejection jujur */ }
  return first;
}

/** Layak diantrekan ke sync (offline/5xx/429) vs error jujur final (4xx deterministik). */
export function shouldQueueW1<T>(r: WfResult<T>): boolean {
  if (r.ok) return false;
  if (r.reason === 'offline') return true;
  if (r.reason === 'error') {
    const st = r.status ?? 0;
    return st === 0 || st >= 500 || st === 429;
  }
  // 'rejected' (PIN_REQUIRED / LOCATION_CHECK_FAILED / SELECTION_REQUIRED /
  // OPEN_POS_ORDERS / validasi) = JANGAN antre buta - kasir perbaiki live.
  return false;
}

// ---------------------------------------------------------------------------
// Multi-register: daftar register + sesi OPEN untuk picker jujur.
// Single LS_CASH_SESSION per device tetap (multi-register via FE per-register,
// BE per-register). Bila server menjawab CASH_SESSION_SELECTION_REQUIRED,
// layar memanggil listOpenCashSessionsBe() lalu kasir memilih satu sesi untuk
// setCashSessionId() - tanpa tebak-tebakan, tanpa kirim buta.
// ---------------------------------------------------------------------------
export interface OpenCashSession {
  sessionId: string;
  registerId: number;
  registerName: string;
  openedBy: string;
  openingCash: number;
  openedAt: string;
}

function parseOpenSessions(body: unknown): OpenCashSession[] {
  try {
    const root = (body ?? {}) as Record<string, unknown>;
    const inner = ((root.data ?? root) ?? {}) as Record<string, unknown>;
    const items = (inner.items ?? inner.registers ?? inner.sessions ?? []) as unknown;
    if (!Array.isArray(items)) return [];
    const out: OpenCashSession[] = [];
    for (const e of items) {
      if (!e || typeof e !== 'object') continue;
      const r = e as Record<string, unknown>;
      const sess = (r.session ?? r) as Record<string, unknown>;
      const sid = sess.id ?? r.sessionId ?? r.session_id;
      const sidStr = String(sid ?? '').trim();
      if (!isServerSessionId(sidStr)) continue;
      out.push({
        sessionId: sidStr,
        registerId: Math.round(numOf(r.id ?? r.registerId ?? r.register_id)),
        registerName: strOf(r.name ?? r.registerName ?? r.register_name) || `Register ${r.id ?? ''}`.trim(),
        openedBy: strOf(sess.openedBy ?? sess.opened_by ?? r.openedBy ?? ''),
        openingCash: numOf(sess.openingCash ?? sess.opening_cash),
        openedAt: strOf(sess.openedAt ?? sess.opened_at),
      });
    }
    return out;
  } catch { return []; }
}

export async function listOpenCashSessionsBe(): Promise<WfResult<OpenCashSession[]>> {
  if (!isW1Online()) return offlineResult();
  try {
    const res = await withTimeoutMs(apiFetch(ApiPath.merchantCashRegisters, { method: 'GET' }));
    if (res.fromDummy || res.status === 0) return offlineResult();
    if (res.ok) {
      const { data } = unwrap<unknown>(res.data);
      return { ok: true, data: parseOpenSessions(data) };
    }
    const be = beErrorOf(res.data);
    if (res.status >= 500 || res.status === 429) {
      return { ok: false, reason: 'error', code: be.code || `HTTP_${res.status}`, message: be.message || wfTr('offline'), status: res.status };
    }
    return rejected(res.status, res.data);
  } catch {
    return offlineResult();
  }
}

/** Pilih sesi kas secara eksplisit pasca-SELECTION_REQUIRED (persist single id). */
export async function chooseCashSessionId(sessionId: string | number): Promise<boolean> {
  const sid = String(sessionId ?? '').trim();
  if (!isServerSessionId(sid)) return false;
  await setCashSessionId(sid);
  return true;
}
