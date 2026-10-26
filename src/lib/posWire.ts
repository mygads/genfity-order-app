/**
 * Wiring-2: pemanggil kontrak merchant Go (reservasi / status order / riwayat
 * POS / settle-refund-void) untuk Backend Go (grup /api/merchant, MerchantAuth).
 *
 * Prinsip (gas mode, aditif):
 * - SQLite lokal tetap cache/kebenaran; semua call ke sini best-effort dan
 *   TAK PERNAH melempar (kecuali dokumentasi sebaliknya).
 * - Tanpa id server desimal yang valid = BLOCKED jujur ({ok:false,
 *   reason:'blocked'}) — JANGAN kirim buta / mengarang id.
 * - Mode selain 'real' (local/dummy) = {ok:false, reason:'offline'}; respons
 *   fromDummy TAK PERNAH diperlakukan sebagai data server.
 * - 409-already-recorded / replay echo ({replayed:true}) = sukses.
 * - Transisi status CANCELLED tak pernah lewat endpoint status (BE 400) —
 *   pakai cancel endpoint; cermin allowedTransitions BE dipakai sebagai pagar,
 *   BUKAN pemetaan diam-diam (invalid = rejected jujur + pesan BE).
 * - Modul ini TAK mengimpor lib/sync (arah impor: sync → posWire) agar tak
 *   ada siklus. Enqueue fallback milik pemanggil (layar) via enqueueSync;
 *   drain menerjemahkan op W2 di sync.ts (goMerchantOp).
 */
import { ApiPath } from '../config/server';
import { apiFetch, getApiMode, unwrap } from './apiSource';
import { getLang } from './i18n';
import { initDb, queryFirst } from './db';
import {
  parseCustomerId,
  parseSettleMemberBlock,
  type ParsedSettleMember,
} from './memberRef';
import { uuidv7 } from './uuidv7';

// ---------------------------------------------------------------------------
// Pesan bilingual lokal W2 (tak menyentuh i18n.ts yang sedang dipakai lane
// lain — append-only di modul ini agar tak tabrakan).
// ---------------------------------------------------------------------------
const WIRE_STR: Record<string, { id: string; en: string }> = {
  offline: { id: 'Offline — perubahan tersimpan di perangkat.', en: 'Offline — change kept on this device.' },
  blocked: { id: 'Tak ada id order server — tak dikirim (bukan kirim buta).', en: 'No server order id — not sent (never send blind).' },
  rejected: { id: 'Server menolak: {m}', en: 'Server rejected: {m}' },
  invalidTransition: { id: 'Transisi tak valid: {f} → {t}.', en: 'Invalid transition: {f} → {t}.' },
  needPin: { id: 'Butuh PIN supervisor untuk aksi ini.', en: 'Supervisor PIN required for this action.' },
  ok: { id: 'Tersinkron ke server.', en: 'Synced to server.' },
};

export function wireTr(key: string, vars?: Record<string, string>): string {
  const e = WIRE_STR[key] ?? WIRE_STR.blocked;
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
// Hasil + util identitas.
// ---------------------------------------------------------------------------
export type GoReason = 'offline' | 'blocked' | 'rejected' | 'error';
export type GoResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: GoReason; code?: string; message?: string };

/** P1-1b: 400 PIN_REQUIRED seragam (payment/refund/void/cancel) → pemanggil
 * boleh minta PIN manajer lalu ulangi live SEKALI (transport-only; antrean
 * sync TAK pernah membawa PIN — lihat goMerchantOp di sync.ts). */
export function isPinRequiredRejection(r: GoResult<unknown>): boolean {
  return !r.ok && r.reason === 'rejected' && r.code === 'PIN_REQUIRED';
}

/** Penyedia PIN interaktif (modal) — null/batal = pakai hasil pertama. */
export type ManagerPinProvider = () => Promise<string | null>;

/** Ulangi panggilan live SEKALI dengan PIN bila BE menuntutnya (400
 * PIN_REQUIRED); tanpa provider = hasil pertama apa adanya. */
export async function withManagerPin<T>(
  call: (pin?: string) => Promise<T>,
  isPinRequired: (r: T) => boolean,
  getPin?: ManagerPinProvider,
): Promise<T> {
  const first = await call();
  if (!getPin || !isPinRequired(first)) return first;
  let pin: string | null = null;
  try {
    pin = await getPin();
  } catch {
    pin = null;
  }
  const clean = String(pin ?? '').trim();
  if (!clean) return first;
  return call(clean);
}

/** Id desimal BE (int64 serial sebagai angka/“123”). Non-desimal = bukan id server. */
export function isDecimalId(v: unknown): boolean {
  return /^[0-9]+$/.test(String(v ?? '').trim());
}

export function pathWithId(tmpl: string, id: string | number): string {
  return String(tmpl).replace('{id}', encodeURIComponent(String(id)));
}

/** Timeout immediate-first W2 (cermin sync.ts IMMEDIATE_TIMEOUT_MS, tanpa impor sync). */
function withTimeoutMs<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  const limit = Math.max(1000, Math.floor(ms));
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), limit);
    }),
  ]);
}

/** true bila mode real (backend sendiri). Local/dummy = offline untuk W2. */
export function isOnlineMode(): boolean {
  try {
    return getApiMode() === 'real';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cermin allowedTransitions BE (orders_merchant.go) — pagar sisi klien.
// CANCELLED SENGAJA tak punya target: endpoint status menolaknya (BE 400
// "Use the cancel endpoint"); pembatalan lewat cancel endpoint di bawah.
// ---------------------------------------------------------------------------
export const ALLOWED_BE_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACCEPTED'],
  ACCEPTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['READY'],
  READY: ['COMPLETED', 'SHIPPED'],
  SHIPPED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function isAllowedBeTransition(from: string, to: string): boolean {
  const f = String(from ?? '').trim().toUpperCase();
  const t = String(to ?? '').trim().toUpperCase();
  if (!f || !t || f === t) return false;
  return (ALLOWED_BE_TRANSITIONS[f] ?? []).includes(t);
}

/** Target status BE dari label lokal (eksplisit, terdokumentasi — bukan map diam-diam).
 *  Total: label tak dikenal -> null (pemanggil BLOCKED, jangan padankan buta). */
export function beStatusForLocal(local: string): 'ACCEPTED' | 'IN_PROGRESS' | 'READY' | null {
  // Dapur/ESB 'Diproses' = kasir mengakui tiket → ACCEPTED (idempoten bila
  // server sudah ACCEPTED: BE 200 "already in target status").
  // 'Selesai' = siap disaji/ambil → READY (BUKAN COMPLETED: COMPLETED menutup
  // order + auto-mark-paid — itu tugas langkah bayar, bukan layar dapur).
  if (local === 'Diproses') return 'ACCEPTED';
  if (local === 'Selesai') return 'READY';
  return null;
}

// ---------------------------------------------------------------------------
// Kupas error BE multi-ejaan (envelope {success,data} + {error:{code,message}}).
// ---------------------------------------------------------------------------
export interface BeErr {
  code: string;
  message: string;
}

function pickStr(o: unknown, ...names: string[]): string {
  if (!o || typeof o !== 'object') return '';
  const r = o as Record<string, unknown>;
  for (const n of names) {
    const v = r[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

export function beErrorOf(body: unknown): BeErr {
  if (typeof body === 'string') return { code: '', message: body.slice(0, 300) };
  if (!body || typeof body !== 'object') return { code: '', message: '' };
  const r = body as Record<string, unknown>;
  const inner = (r.data ?? r) as Record<string, unknown>;
  const errObj = (r as { error?: unknown }).error;
  const code =
    pickStr(errObj, 'code', 'errorCode', 'error_code', 'name') ||
    pickStr(inner, 'code', 'errorCode', 'error_code', 'name') ||
    pickStr(r, 'code', 'errorCode', 'error_code', 'name');
  const message =
    pickStr(errObj, 'message', 'msg', 'errorMessage', 'error_message', 'detail') ||
    pickStr(inner, 'message', 'msg', 'errorMessage', 'error_message', 'detail') ||
    pickStr(r, 'message', 'msg', 'errorMessage', 'error_message', 'detail');
  return { code, message };
}

/** Kode replay/sudah-ada = sukses idempoten (409 = sukses, replay echo ok). */
const REPLAY_OK_RE = /PAYMENT_ALREADY_RECORDED|IDEMPOTENCY_KEY_REUSED|ORDER_ALREADY_REFUNDED|ORDER_CLOSED|already[\s_-]?(exist|sync|recorded|refunded)|replayed|duplicate|TERKIRIM/i;

export function isReplaySuccess(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const r = body as Record<string, unknown>;
  const inner = (r.data ?? r) as Record<string, unknown>;
  if (r.replayed === true || inner.replayed === true) return true;
  const hay = `${beErrorOf(body).code} ${beErrorOf(body).message}`;
  return REPLAY_OK_RE.test(hay);
}

// ---------------------------------------------------------------------------
// Nama op antrean W2 (dishare ke sync.ts goMerchantOp — satu sumber nama).
// PUT-only ops (resv-cancel, pos-status) dikuras via apiPutWithTimeout di
// drain; POST ops lewat apiPostWithTimeout. Tanpa id server = BLOCKED
// fail-once (S10), bukan retry buta.
// ---------------------------------------------------------------------------
export const GO_OP_SETTLE = 'pos-settle';
export const GO_OP_REFUND = 'pos-refund';
export const GO_OP_CANCEL = 'pos-cancel';
export const GO_OP_VOID = 'pos-void';
export const GO_OP_STATUS = 'pos-status';
export const GO_OP_RESV_CANCEL = 'booking-server-cancel';
export const GO_OP_MOVE_TABLE = 'move-table-go';

// ---------------------------------------------------------------------------
// Tautan sale lokal ↔ order server.
// Hari ini tr_saleshead.onlineOrderId belum ditulis siapa pun (kolom tidur,
// hanya dibaca Dashboard) → resolve null = BLOCKED jujur sampai alur
// order-server (online order) mengisinya. JANGAN fallback ke salesNum/TRX
// (bukan id server — kirim buta).
// ---------------------------------------------------------------------------
export async function getServerOrderIdForSale(salesNum: string): Promise<number | null> {
  const no = String(salesNum ?? '').trim();
  if (!no) return null;
  try {
    await initDb();
    const row = await queryFirst<{ onlineOrderId: string | null }>(
      'SELECT onlineOrderId FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
      [no],
    );
    const raw = String(row?.onlineOrderId ?? '').trim();
    if (!isDecimalId(raw)) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registri sesi no-tampil → id server (untuk baris riwayat server: no yang
// tampil = orderNumber BE, sedangkan void/cancel butuh id numerik).
// ---------------------------------------------------------------------------
const txnKeyToServerId = new Map<string, number>();

export function registerServerTxnKey(localKey: string, serverId: number): void {
  const k = String(localKey ?? '').trim();
  if (k && Number.isFinite(serverId) && serverId > 0) txnKeyToServerId.set(k, serverId);
}

export function serverIdForTxnKey(localKey: string): number | null {
  const k = String(localKey ?? '').trim();
  if (!k) return null;
  const m = /^srv-([0-9]+)$/.exec(k);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return txnKeyToServerId.get(k) ?? null;
}

// ---------------------------------------------------------------------------
// Reservasi server.
// ---------------------------------------------------------------------------
export interface ServerResv {
  id: number;
  status: string;
  displayStatus: string;
  partySize: number;
  date: string;
  time: string;
  table: string;
  name: string;
  phone: string;
  note: string;
  email: string;
  orderId: number | null;
}

function strOf(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function numOf(v: unknown): number {
  const n = Math.round(Number(v) || 0);
  return Number.isFinite(n) ? n : 0;
}

/** Petakan status/displayStatus BE → status lokal. null = lewati (batal/kadaluarsa). */
export function mapResvStatusToLocal(status: unknown, displayStatus: unknown): 'Terjadwal' | 'Datang' | 'Selesai' | null {
  const s = `${strOf(status)} ${strOf(displayStatus)}`.toUpperCase();
  if (/CANCEL|BATAL|NO_SHOW|NOSHOW|EXPIRED|KADALUARSA/.test(s)) return null;
  if (/COMPLET|SELESAI|DONE|SEATED|DATANG|ACCEPT|CHECKED_IN/.test(s)) {
    if (/COMPLET|SELESAI|DONE/.test(s)) return 'Selesai';
    return 'Datang';
  }
  return 'Terjadwal';
}

export async function pullServerReservations(limit = 100): Promise<GoResult<ServerResv[]>> {
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  try {
    const res = await withTimeoutMs(
      apiFetch(ApiPath.merchantResvList, {
        method: 'GET',
        params: { limit: Math.max(1, Math.min(200, limit)) },
      }),
    );
    if (res.fromDummy || !res.ok) {
      return res.fromDummy || res.status === 0
        ? { ok: false, reason: 'offline', message: wireTr('offline') }
        : { ok: false, reason: 'error', code: String(res.status), message: wireTr('rejected', { m: `HTTP ${res.status}` }) };
    }
    const { data } = unwrap<unknown>(res.data);
    const rows = Array.isArray(data)
      ? data
      : Array.isArray((data as { rows?: unknown })?.rows)
        ? (data as { rows: unknown[] }).rows
        : [];
    const out: ServerResv[] = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const idRaw = o.id ?? o.reservationId ?? o.reservation_id;
      if (!isDecimalId(idRaw)) continue;
      const cust = (o.customer ?? o.Customer ?? {}) as Record<string, unknown>;
      out.push({
        id: parseInt(String(idRaw).trim(), 10),
        status: strOf(o.status ?? o.Status),
        displayStatus: strOf(o.displayStatus ?? o.display_status ?? o.displayStatusText),
        partySize: numOf(o.partySize ?? o.party_size ?? o.pax),
        date: strOf(o.reservationDate ?? o.reservation_date ?? o.date),
        time: strOf(o.reservationTime ?? o.reservation_time ?? o.time),
        table: strOf(o.tableNumber ?? o.table_number ?? o.table),
        name: strOf(cust.name ?? o.customerName ?? o.customer_name) || '-',
        phone: strOf(cust.phone ?? o.customerPhone ?? o.customer_phone),
        note: strOf(o.notes ?? o.note),
        email: strOf(cust.email ?? o.customerEmail ?? o.customer_email),
        orderId: isDecimalId((o.order as { id?: unknown } | null)?.id ?? o.orderId ?? o.order_id)
          ? parseInt(String(((o.order as { id?: unknown })?.id ?? o.orderId ?? o.order_id) as string).trim(), 10)
          : null,
      });
    }
    return { ok: true, data: out };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}

export async function cancelServerReservation(
  serverId: number,
  reason?: string,
): Promise<GoResult<{ replayed: boolean }>> {
  if (!Number.isFinite(serverId) || serverId <= 0) {
    return { ok: false, reason: 'blocked', message: wireTr('blocked') };
  }
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  const key = uuidv7();
  try {
    const res = await withTimeoutMs(
      apiFetch(pathWithId(ApiPath.merchantResvCancel, serverId), {
        method: 'PUT',
        body: { ...(reason ? { reason } : {}) },
        idempotencyKey: key,
      }),
    );
    if (res.fromDummy || res.status === 0) {
      return { ok: false, reason: 'offline', message: wireTr('offline') };
    }
    const { data } = unwrap<unknown>(res.data);
    if (res.ok) return { ok: true, data: { replayed: isReplaySuccess(data) } };
    const be = beErrorOf(data ?? res.data);
    if (res.status === 409 && isReplaySuccess(data ?? res.data)) {
      return { ok: true, data: { replayed: true } };
    }
    return {
      ok: false,
      reason: 'rejected',
      code: be.code || String(res.status),
      message: wireTr('rejected', { m: be.message || be.code || `HTTP ${res.status}` }),
    };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}

// ---------------------------------------------------------------------------
// Order aktif server (cermin OrderListItem; items TIDAK disertakan BE di
// snapshot aktif — baris hasil punya items kosong, total dari totalAmount).
// ---------------------------------------------------------------------------
export interface ServerActiveOrder {
  id: number;
  orderNumber: string;
  orderType: string;
  tableNumber: string;
  status: string;
  total: number;
  customerName: string;
  createdAt: string;
}

export async function pullActiveOrders(): Promise<GoResult<ServerActiveOrder[]>> {
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  try {
    const res = await withTimeoutMs(apiFetch(ApiPath.merchantOrdersActive, { method: 'GET' }));
    if (res.fromDummy || !res.ok) {
      return res.fromDummy || res.status === 0
        ? { ok: false, reason: 'offline', message: wireTr('offline') }
        : { ok: false, reason: 'error', code: String(res.status), message: wireTr('rejected', { m: `HTTP ${res.status}` }) };
    }
    const { data } = unwrap<unknown>(res.data);
    const rows = Array.isArray(data)
      ? data
      : Array.isArray((data as { orders?: unknown })?.orders)
        ? (data as { orders: unknown[] }).orders
        : [];
    const out: ServerActiveOrder[] = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      if (!isDecimalId(o.id)) continue;
      const cust = (o.customer ?? {}) as Record<string, unknown>;
      out.push({
        id: parseInt(String(o.id).trim(), 10),
        orderNumber: strOf(o.orderNumber ?? o.order_number) || `SRV-${String(o.id).trim()}`,
        orderType: strOf(o.orderType ?? o.order_type),
        tableNumber: strOf(o.tableNumber ?? o.table_number),
        status: strOf(o.status ?? o.Status).toUpperCase(),
        total: numOf(o.totalAmount ?? o.total_amount ?? o.total),
        customerName: strOf(cust.name ?? o.customerName ?? o.customer_name) || '-',
        createdAt: strOf(o.createdAt ?? o.created_at ?? o.placedAt ?? o.placed_at),
      });
    }
    return { ok: true, data: out };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}

// ---------------------------------------------------------------------------
// Status order: PUT /orders/{id}/status. target = enum BE (tak pernah
// CANCELLED — dipagar di sini + di BE). same-status = sukses tanpa kirim
// (BE pun 200 idempoten).
// ---------------------------------------------------------------------------
export async function pushOrderStatus(
  serverId: number,
  target: string,
  opts?: { note?: string; current?: string },
): Promise<GoResult<{ replayed: boolean }>> {
  const t = String(target ?? '').trim().toUpperCase();
  if (!Number.isFinite(serverId) || serverId <= 0) {
    return { ok: false, reason: 'blocked', message: wireTr('blocked') };
  }
  if (t === 'CANCELLED' || !(ALLOWED_BE_TRANSITIONS[t] !== undefined)) {
    return {
      ok: false,
      reason: 'rejected',
      code: 'INVALID_TARGET',
      message: wireTr('invalidTransition', { f: opts?.current ?? '?', t }),
    };
  }
  const cur = String(opts?.current ?? '').trim().toUpperCase();
  if (cur && cur === t) return { ok: true, data: { replayed: true } };
  if (cur && !isAllowedBeTransition(cur, t)) {
    return {
      ok: false,
      reason: 'rejected',
      code: 'INVALID_TRANSITION',
      message: wireTr('invalidTransition', { f: cur, t }),
    };
  }
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  try {
    const res = await withTimeoutMs(
      apiFetch(pathWithId(ApiPath.merchantOrderStatus, serverId), {
        method: 'PUT',
        body: { status: t, ...(opts?.note ? { note: opts.note } : {}) },
        idempotencyKey: uuidv7(),
      }),
    );
    if (res.fromDummy || res.status === 0) {
      return { ok: false, reason: 'offline', message: wireTr('offline') };
    }
    const { data } = unwrap<unknown>(res.data);
    if (res.ok) return { ok: true, data: { replayed: isReplaySuccess(data) } };
    const be = beErrorOf(data ?? res.data);
    return {
      ok: false,
      reason: 'rejected',
      code: be.code || String(res.status),
      message: wireTr('rejected', { m: be.message || be.code || `HTTP ${res.status}` }),
    };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}

// ---------------------------------------------------------------------------
// Cancel / void order merchant (POST; replayed:true = sukses idempoten).
// PIN tak dibawa (transport-only milik dialog supervisor); bila BE menuntut
// PIN → rejected jujur PIN_REQUIRED (bukan logout: prefix ada di allowlist).
// ---------------------------------------------------------------------------
async function postOrderVerdict(
  tmpl: string,
  serverId: number,
  reason: string | undefined,
  idemKey: string | undefined,
  pin?: string,
): Promise<GoResult<{ replayed: boolean }>> {
  if (!Number.isFinite(serverId) || serverId <= 0) {
    return { ok: false, reason: 'blocked', message: wireTr('blocked') };
  }
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  const pinClean = String(pin ?? '').trim();
  try {
    const res = await withTimeoutMs(
      apiFetch(pathWithId(tmpl, serverId), {
        method: 'POST',
        body: { ...(reason ? { reason } : {}), ...(pinClean ? { pin: pinClean } : {}) },
        ...(idemKey ? { idempotencyKey: idemKey } : {}),
      }),
    );
    if (res.fromDummy || res.status === 0) {
      return { ok: false, reason: 'offline', message: wireTr('offline') };
    }
    const { data } = unwrap<unknown>(res.data);
    if (res.ok) return { ok: true, data: { replayed: isReplaySuccess(data) } };
    if (res.status === 409 && isReplaySuccess(data ?? res.data)) {
      return { ok: true, data: { replayed: true } };
    }
    const be = beErrorOf(data ?? res.data);
    return {
      ok: false,
      reason: 'rejected',
      code: be.code || String(res.status),
      message: wireTr('rejected', { m: be.message || be.code || `HTTP ${res.status}` }),
    };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}

export function cancelMerchantOrder(serverId: number, reason?: string, pin?: string): Promise<GoResult<{ replayed: boolean }>> {
  return postOrderVerdict(ApiPath.merchantOrderCancel, serverId, reason, undefined, pin);
}

export function voidMerchantOrder(serverId: number, reason?: string, pin?: string): Promise<GoResult<{ replayed: boolean }>> {
  return postOrderVerdict(ApiPath.merchantOrderVoid, serverId, reason, uuidv7(), pin);
}

// ---------------------------------------------------------------------------
// Settle POS (POST /pos/payment) + refund POS (POST /pos/refund).
// 409 PAYMENT_ALREADY_RECORDED / ORDER_ALREADY_REFUNDED / ORDER_CLOSED +
// replayed:true = sukses idempoten.
// ---------------------------------------------------------------------------
export type BePayMethod = 'CASH_ON_COUNTER' | 'CARD_ON_COUNTER' | 'QRIS' | 'SPLIT' | 'COMPLIMENT' | 'MANUAL_TRANSFER';

/**
 * Petakan label metode lokal → enum BE. null = tak ada padanan → BLOCKED
 * (jangan map diam-diam: deposit/member bukan enum BE).
 * APP-9 (HP-E2E 2026-10-26): transfer bank MANUAL kini punya padanan BE
 * MANUAL_TRANSFER (migrasi 00206 + validasi settle) — tak lagi BLOCKED diam.
 */
export function mapPayMethodToBe(method: unknown): BePayMethod | null {
  const m = String(method ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  // Transfer bank manual (label mentah 'transfer' dari extraLabelToMethod +
  // varian) — cek DULU agar tak tertelan pola lain.
  if (/transfer|manualtransfer|banktransfer/.test(m)) return 'MANUAL_TRANSFER';
  if (/^qris$/.test(m) || /qris|ovo|gopay|dana|shopee|wallet|online/.test(m)) {
    if (/tunai|cash/.test(m)) return 'CASH_ON_COUNTER';
    return 'QRIS';
  }
  if (/tunai|cash/.test(m)) return 'CASH_ON_COUNTER';
  if (/edc|card|debit|kredit|nontunai|kartu/.test(m)) return 'CARD_ON_COUNTER';
  if (/split|bagi|gabung/.test(m)) return 'SPLIT';
  if (/compliment|gratis|comp/.test(m)) return 'COMPLIMENT';
  return null;
}

export interface SettleInput {
  serverId: number;
  method: BePayMethod;
  amountPaid: number;
  changeAmount?: number;
  tipAmount?: number;
  voucherCode?: string;
  notes?: string;
  idempotencyKey?: string;
  /**
   * Ronde-3 Q1/Q2: customerId GO (int) bila member ditempel. Alias ESB
   * (prefix M/MC) DILARANG — guard di bawah hanya meneruskan int valid;
   * selain itu dihilangkan (settle jalan tanpa member, bukan kirim buta).
   */
  customerId?: number;
  /**
   * P1-2: id sesi kas W1 yang terbuka (liat beWorkforce.getCashSessionId).
   * Dikirim apa adanya bila diketahui agar BE mengatribusikan setoran ke
   * sesi yang benar; absen = BE me-resolve sendiri (sesi tunggal user/
   * merchant) atau menolak jujur bila register kasir diwajibkan.
   */
  cashSessionId?: number;
  /** P1-1: PIN supervisor transport-only (live; tak pernah dipersist). */
  pin?: string;
  /**
   * SESI-FINAL-APP: URL foto bukti bayar (https) dari upload terminal.
   * Diteruskan apa adanya bila https ≤2048; selain itu dihilangkan (settle
   * jalan tanpa proof — BE yang menolak jujur via 409 PROOF_REQUIRED).
   */
  proofUrl?: string;
}

/** Ronde-3 Q2: hasil settle + member block opsional (absen = kompat BE
 *  lama → pemanggil pakai perilaku lokal seperti hari ini). */
export interface SettleResult {
  replayed: boolean;
  member?: ParsedSettleMember['member'];
  memberDropped?: string;
}

export async function settlePosPayment(inp: SettleInput): Promise<GoResult<SettleResult>> {
  if (!Number.isFinite(inp.serverId) || inp.serverId <= 0) {
    return { ok: false, reason: 'blocked', message: wireTr('blocked') };
  }
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  const key = inp.idempotencyKey && inp.idempotencyKey.trim() ? inp.idempotencyKey.trim() : uuidv7();
  const pinClean = String(inp.pin ?? '').trim();
  const cashSid = Math.max(0, Math.round(Number(inp.cashSessionId) || 0));
  // Q1: hanya int GO yang diteruskan; alias/hasil parse gagal = dihilangkan.
  const custId = parseCustomerId(inp.customerId);
  // SESI-FINAL-APP: proofUrl hanya https ≤2048 (selain itu = dihilangkan, BE
  // menolak jujur via 409 PROOF_REQUIRED bila diwajibkan).
  const proofClean = /^https:\/\/.{1,2040}$/i.test(String(inp.proofUrl ?? '').trim())
    ? String(inp.proofUrl ?? '').trim().slice(0, 2048)
    : '';
  try {
    const res = await withTimeoutMs(
      apiFetch(ApiPath.merchantPosPayment, {
        method: 'POST',
        body: {
          orderId: inp.serverId,
          paymentMethod: inp.method,
          amountPaid: Math.max(0, Math.round(inp.amountPaid)),
          ...(inp.changeAmount !== undefined ? { changeAmount: Math.round(inp.changeAmount) } : {}),
          ...(inp.tipAmount ? { tipAmount: Math.round(inp.tipAmount) } : {}),
          ...(inp.voucherCode ? { voucherCode: inp.voucherCode } : {}),
          ...(inp.notes ? { notes: inp.notes.slice(0, 500) } : {}),
          ...(custId != null ? { customerId: custId } : {}),
          ...(pinClean ? { pin: pinClean } : {}),
          ...(cashSid > 0 ? { cashSessionId: cashSid } : {}),
          ...(proofClean ? { proofUrl: proofClean } : {}),
        },
        idempotencyKey: key,
      }),
    );
    if (res.fromDummy || res.status === 0) {
      return { ok: false, reason: 'offline', message: wireTr('offline') };
    }
    const { data } = unwrap<unknown>(res.data);
    const parsed = parseSettleMemberBlock(data);
    const withMember = parsed?.member ? { member: parsed.member } : {};
    const withDropped = parsed?.memberDropped ? { memberDropped: parsed.memberDropped } : {};
    if (res.ok) return { ok: true, data: { replayed: isReplaySuccess(data), ...withMember, ...withDropped } };
    if (res.status === 409 && isReplaySuccess(data ?? res.data)) {
      return { ok: true, data: { replayed: true, ...withMember, ...withDropped } };
    }
    const be = beErrorOf(data ?? res.data);
    // SESI-FINAL-APP: 409 PROOF_REQUIRED dilewatkan apa adanya (be.code) —
    // PayScreen menahannya sebagai hold + banner, BUKAN Success palsu.
    return {
      ok: false,
      reason: 'rejected',
      code: be.code || String(res.status),
      message: wireTr('rejected', { m: be.message || be.code || `HTTP ${res.status}` }),
    };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}

export async function refundPosPayment(
  serverId: number,
  reason?: string,
  amount?: number,
  idempotencyKey?: string,
  pin?: string,
): Promise<GoResult<{ replayed: boolean }>> {
  if (!Number.isFinite(serverId) || serverId <= 0) {
    return { ok: false, reason: 'blocked', message: wireTr('blocked') };
  }
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  const pinClean = String(pin ?? '').trim();
  try {
    const res = await withTimeoutMs(
      apiFetch(ApiPath.merchantPosRefund, {
        method: 'POST',
        body: {
          orderId: serverId,
          ...(reason ? { reason } : {}),
          ...(amount !== undefined && amount > 0 ? { amount: Math.round(amount) } : {}),
          ...(pinClean ? { pin: pinClean } : {}),
          idempotencyKey: idempotencyKey && idempotencyKey.trim() ? idempotencyKey.trim() : uuidv7(),
        },
      }),
    );
    if (res.fromDummy || res.status === 0) {
      return { ok: false, reason: 'offline', message: wireTr('offline') };
    }
    const { data } = unwrap<unknown>(res.data);
    if (res.ok) return { ok: true, data: { replayed: isReplaySuccess(data) } };
    if (res.status === 409 && isReplaySuccess(data ?? res.data)) {
      return { ok: true, data: { replayed: true } };
    }
    const be = beErrorOf(data ?? res.data);
    return {
      ok: false,
      reason: 'rejected',
      code: be.code || String(res.status),
      message: wireTr('rejected', { m: be.message || be.code || `HTTP ${res.status}` }),
    };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}

// ---------------------------------------------------------------------------
// Riwayat POS server mentah (pemetaan ke Transaction milik lib/history agar
// modul ini tak bergantung tipe layar).
// ---------------------------------------------------------------------------
export interface ServerHistoryItem {
  name: string;
  qty: number;
  price: number;
  note?: string;
}

export interface ServerHistoryEntry {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  tableNumber: string;
  customerName: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  createdAt: string;
  paidAt: string;
  items: ServerHistoryItem[];
}

export async function pullServerHistory(limit = 100): Promise<GoResult<ServerHistoryEntry[]>> {
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  try {
    const res = await withTimeoutMs(
      apiFetch(ApiPath.merchantPosHistory, {
        method: 'GET',
        params: { limit: Math.max(1, Math.min(500, limit)) },
      }),
    );
    if (res.fromDummy || !res.ok) {
      return res.fromDummy || res.status === 0
        ? { ok: false, reason: 'offline', message: wireTr('offline') }
        : { ok: false, reason: 'error', code: String(res.status), message: wireTr('rejected', { m: `HTTP ${res.status}` }) };
    }
    const { data } = unwrap<unknown>(res.data);
    const rows = Array.isArray(data)
      ? data
      : Array.isArray((data as { entries?: unknown })?.entries)
        ? (data as { entries: unknown[] }).entries
        : [];
    const out: ServerHistoryEntry[] = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const id = strOf(o.id ?? o.orderId ?? o.order_id);
      if (!id) continue;
      const rawItems = Array.isArray(o.items) ? o.items : [];
      const items: ServerHistoryItem[] = [];
      for (const it of rawItems) {
        if (!it || typeof it !== 'object') continue;
        const m = it as Record<string, unknown>;
        const name = strOf(m.menuName ?? m.menu_name ?? m.name) || '-';
        items.push({
          name,
          qty: Math.max(1, Math.round(Number(m.quantity ?? m.qty) || 1)),
          price: Math.round(Number(m.unitPrice ?? m.unit_price ?? m.price) || 0),
          ...(m.notes ?? m.note ? { note: strOf(m.notes ?? m.note) } : {}),
        });
      }
      out.push({
        id,
        orderNumber: strOf(o.orderNumber ?? o.order_number) || id,
        orderType: strOf(o.orderType ?? o.order_type),
        status: strOf(o.status).toUpperCase(),
        paymentStatus: strOf(o.paymentStatus ?? o.payment_status).toUpperCase(),
        paymentMethod: strOf(o.paymentMethod ?? o.payment_method),
        tableNumber: strOf(o.tableNumber ?? o.table_number),
        customerName: strOf(o.customerName ?? o.customer_name),
        subtotal: numOf(o.subtotal),
        discount: numOf(o.discountAmount ?? o.discount_amount ?? o.discount),
        tax: numOf(o.taxAmount ?? o.tax_amount ?? o.tax),
        total: numOf(o.totalAmount ?? o.total_amount ?? o.total),
        createdAt: strOf(o.createdAt ?? o.created_at),
        paidAt: strOf(o.paidAt ?? o.paid_at),
        items,
      });
    }
    return { ok: true, data: out };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}


// ---------------------------------------------------------------------------
// M1 (loyalty): member/loyalty + struk email via kontrak merchant Go.
// - searchCustomers: GET api/merchant/customers/search (?q,take) → baris
//   {id,name,email,phone,orderCount,totalSpent,pointsBalance,loyaltyMember}.
//   Poin = pointsBalance SERVER (server-wins); overlay lokal tak mencetak poin.
// - invoiceEmailEnabled: GET api/merchant/email-delivery-settings → gerbang
//   tombol kirim-struk (sendInvoiceEmail). Cache per sesi (pengaturan jarang
//   berubah; gagal fetch = null = pemanggil pakai jalur antrean lama).
// - sendPosReceiptEmail: POST api/merchant/orders/{id}/send-receipt {email}
//   (isPosInvoice, antrean completed-email). Tanpa serverId desimal = BLOCKED.
// TANPA PIN baru (tak perlu — lihat ApiPath merchantOrderSendReceipt).
// ---------------------------------------------------------------------------
export interface ServerCustomer {
  id: number;
  name: string;
  email: string;
  phone: string;
  orderCount: number;
  totalSpent: number;
  pointsBalance: number;
  loyaltyMember: boolean;
}

export async function searchServerCustomers(q: string, take = 20): Promise<GoResult<ServerCustomer[]>> {
  const query = String(q ?? '').trim();
  if (!query) return { ok: true, data: [] };
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  try {
    const res = await withTimeoutMs(
      apiFetch(ApiPath.merchantCustomerSearch, {
        method: 'GET',
        params: { q: query, take: Math.max(1, Math.min(50, Math.round(take) || 20)) },
      }),
    );
    if (res.fromDummy || res.status === 0) {
      return { ok: false, reason: 'offline', message: wireTr('offline') };
    }
    if (!res.ok) {
      const be = beErrorOf(res.data ?? null);
      return { ok: false, reason: 'rejected', code: be.code || String(res.status), message: wireTr('rejected', { m: be.message || be.code || `HTTP ${res.status}` }) };
    }
    const { data } = unwrap<unknown>(res.data);
    const rows = Array.isArray(data) ? data : [];
    const out: ServerCustomer[] = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      if (!isDecimalId(o.id)) continue;
      out.push({
        id: parseInt(String(o.id).trim(), 10),
        name: strOf(o.name),
        email: strOf(o.email),
        phone: strOf(o.phone),
        orderCount: numOf(o.orderCount ?? o.order_count),
        totalSpent: numOf(o.totalSpent ?? o.total_spent),
        pointsBalance: Math.max(0, numOf(o.pointsBalance ?? o.points_balance)),
        loyaltyMember: (o.loyaltyMember ?? o.loyalty_member) === true,
      });
    }
    return { ok: true, data: out };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}

let invoiceEmailCache: boolean | null = null;

export async function isInvoiceEmailEnabled(): Promise<boolean | null> {
  if (invoiceEmailCache !== null) return invoiceEmailCache;
  if (!isOnlineMode()) return null;
  try {
    const res = await withTimeoutMs(apiFetch(ApiPath.merchantEmailDeliverySettings, { method: 'GET' }));
    if (res.fromDummy || !res.ok) return null;
    const { data } = unwrap<{ emailDeliverySettings?: { sendInvoiceEmail?: unknown } }>(res.data);
    const flag = (data as { emailDeliverySettings?: { sendInvoiceEmail?: unknown } })?.emailDeliverySettings?.sendInvoiceEmail === true;
    invoiceEmailCache = flag;
    return flag;
  } catch {
    return null;
  }
}

export function resetInvoiceEmailCache(): void {
  invoiceEmailCache = null;
}

export async function sendPosReceiptEmail(
  serverId: number,
  email: string,
): Promise<GoResult<{ queued: boolean }>> {
  if (!Number.isFinite(serverId) || serverId <= 0) {
    return { ok: false, reason: 'blocked', message: wireTr('blocked') };
  }
  const mail = String(email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) {
    return { ok: false, reason: 'blocked', message: wireTr('blocked') };
  }
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  try {
    const res = await withTimeoutMs(
      apiFetch(String(ApiPath.merchantOrderSendReceipt).replace('{orderId}', encodeURIComponent(String(serverId))), {
        body: { email: mail },
      }),
    );
    if (res.fromDummy || res.status === 0) {
      return { ok: false, reason: 'offline', message: wireTr('offline') };
    }
    const { data } = unwrap<unknown>(res.data);
    if (res.ok) return { ok: true, data: { queued: true } };
    const be = beErrorOf(data ?? res.data);
    return { ok: false, reason: 'rejected', code: be.code || String(res.status), message: wireTr('rejected', { m: be.message || be.code || `HTTP ${res.status}` }) };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}

// ---------------------------------------------------------------------------
// AUTO-PRINT APP (detail penuh 1:1 website): GET
// api/merchant/orders/{orderId} (MerchantOrderDetailGet) — satu-satunya
// sumber ber-items LENGKAP: orderItems (+addons, notes), subtotal, discount,
// tax, serviceCharge, packagingFee, deliveryFee, tip, total, payment
// (method, amountPaid, changeAmount, paidBy) — menggantikan snapshot
// pullServerHistory untuk render job AUTO (riwayat tetap fallback).
// Non-desimal (no display TRX-…) = BLOCKED (BE readPathInt64 numerik saja;
// pemanggil jatuh ke fallback riwayat yang bisa padankan no display).
// Tak pernah melempar (offline = {ok:false, reason:'offline'}).
// ---------------------------------------------------------------------------
export interface ServerOrderDetailAddon {
  name: string;
  price: number;
  qty: number;
}

export interface ServerOrderDetailItem {
  name: string;
  qty: number;
  price: number;
  note?: string;
  addons: ServerOrderDetailAddon[];
}

export interface ServerOrderDetail {
  id: string;
  orderNumber: string;
  orderType: string;
  tableNumber: string;
  customerName: string;
  /** Nama kasir penyelesaian (payment.paidBy.name BE) — kosong bila absen. */
  cashierName: string;
  subtotal: number;
  discount: number;
  tax: number;
  service: number;
  packaging: number;
  delivery: number;
  tip: number;
  total: number;
  paymentMethod: string;
  amountPaid: number;
  changeAmount: number;
  createdAt: string;
  paidAt: string;
  /** Label diskon sumber voucher (orderDiscounts BE) — kosong bila tak ada. */
  voucherCode: string;
  items: ServerOrderDetailItem[];
}

export async function fetchMerchantOrderDetail(
  orderRef: string | number,
): Promise<GoResult<ServerOrderDetail>> {
  const ref = String(orderRef ?? '').trim();
  if (!isDecimalId(ref)) {
    return { ok: false, reason: 'blocked', message: wireTr('blocked') };
  }
  if (!isOnlineMode()) return { ok: false, reason: 'offline', message: wireTr('offline') };
  try {
    const path = String(ApiPath.merchantOrderDetailGet).replace('{orderId}', encodeURIComponent(ref));
    const res = await withTimeoutMs(apiFetch(path, { method: 'GET' }));
    if (res.fromDummy || res.status === 0) {
      return { ok: false, reason: 'offline', message: wireTr('offline') };
    }
    if (!res.ok) {
      const be = beErrorOf(res.data ?? null);
      return {
        ok: false,
        reason: 'error',
        code: be.code || String(res.status),
        message: wireTr('rejected', { m: be.message || be.code || `HTTP ${res.status}` }),
      };
    }
    const { data } = unwrap<unknown>(res.data);
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'error', code: 'BAD_RESPONSE', message: wireTr('rejected', { m: 'bad response' }) };
    }
    const o = data as Record<string, unknown>;
    if (!isDecimalId(o.id)) {
      return { ok: false, reason: 'error', code: 'BAD_RESPONSE', message: wireTr('rejected', { m: 'bad response' }) };
    }
    const pay = (o.payment ?? {}) as Record<string, unknown>;
    const paidBy = (pay.paidBy ?? {}) as Record<string, unknown>;
    const cust = (o.customer ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(o.orderItems) ? o.orderItems : [];
    const items: ServerOrderDetailItem[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      const name = strOf(m.menuName ?? m.menu_name ?? m.name) || '-';
      const qty = Math.max(1, Math.round(Number(m.quantity ?? m.qty) || 1));
      const unitRaw = Math.round(Number(m.menuPrice ?? m.menu_price ?? m.price) || 0);
      const subRaw = Math.round(Number(m.subtotal) || 0);
      const price = unitRaw > 0 ? unitRaw : subRaw > 0 && qty > 0 ? Math.round(subRaw / qty) : 0;
      const rawAddons = Array.isArray(m.addons) ? m.addons : [];
      const addons: ServerOrderDetailAddon[] = [];
      for (const ra of rawAddons) {
        if (!ra || typeof ra !== 'object') continue;
        const a = ra as Record<string, unknown>;
        const an = strOf(a.addonName ?? a.addon_name ?? a.name);
        if (!an) continue;
        addons.push({
          name: an,
          price: Math.max(0, Math.round(Number(a.addonPrice ?? a.addon_price ?? a.price) || 0)),
          qty: Math.max(1, Math.round(Number(a.quantity ?? a.qty) || 1)),
        });
      }
      items.push({
        name,
        qty,
        price: Math.max(0, price),
        ...(strOf(m.notes ?? m.note) ? { note: strOf(m.notes ?? m.note) } : {}),
        addons,
      });
    }
    let voucherCode = '';
    const rawDiscounts = Array.isArray(o.orderDiscounts) ? o.orderDiscounts : [];
    for (const rd of rawDiscounts) {
      if (!rd || typeof rd !== 'object') continue;
      const d = rd as Record<string, unknown>;
      if (/VOUCHER/i.test(strOf(d.source))) {
        const label = strOf(d.label);
        if (label) {
          voucherCode = label;
          break;
        }
      }
    }
    return {
      ok: true,
      data: {
        id: String(o.id).trim(),
        orderNumber: strOf(o.orderNumber ?? o.order_number) || String(o.id).trim(),
        orderType: strOf(o.orderType ?? o.order_type),
        tableNumber: strOf(o.tableNumber ?? o.table_number),
        customerName: strOf(cust.name ?? o.customerName ?? o.customer_name) || '-',
        cashierName: strOf(paidBy.name),
        subtotal: numOf(o.subtotal),
        discount: numOf(o.discountAmount ?? o.discount_amount ?? o.discount),
        tax: numOf(o.taxAmount ?? o.tax_amount ?? o.tax),
        service: numOf(o.serviceChargeAmount ?? o.service_charge_amount ?? o.service),
        packaging: numOf(o.packagingFeeAmount ?? o.packaging_fee_amount ?? o.packaging),
        delivery: numOf(o.deliveryFeeAmount ?? o.delivery_fee_amount ?? o.delivery),
        tip: numOf(o.tipAmount ?? o.tip_amount ?? o.tip),
        total: numOf(o.totalAmount ?? o.total_amount ?? o.total),
        paymentMethod: strOf(pay.paymentMethod ?? pay.payment_method ?? pay.requestedPaymentMethod),
        amountPaid: numOf(pay.amountPaid ?? pay.amount_paid ?? pay.amount),
        changeAmount: numOf(pay.changeAmount ?? pay.change_amount),
        createdAt: strOf(o.placedAt ?? o.placed_at ?? o.createdAt ?? o.created_at),
        paidAt: strOf(pay.paidAt ?? pay.paid_at ?? pay.customerPaidAt ?? o.completedAt ?? o.completed_at),
        voucherCode,
        items,
      },
    };
  } catch {
    return { ok: false, reason: 'offline', message: wireTr('offline') };
  }
}
