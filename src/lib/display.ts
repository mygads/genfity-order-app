/**
 * Bus sinkronisasi tampilan pelanggan (fakta APK: update display lewat
 * WS/event `updateCustomerDisplaySalesMenu`, bukan kabel serial).
 * Implementasi orisinal best-effort: pelanggan lokal selalu sinkron antar
 * layar; dorong WS dicoba bila URL WS terkonfigurasi, gagal diam-diam.
 *
 * APP-EVENTS (TRANSPORT CLOSED 2026-10-17, audit row 8/12-partial):
 * - Primer SSE per-terminal (E26, tag-filtered server-side) via lib/sse.ts —
 *   satu arah untuk view; view_pelanggan memakai scope kasir pasangan
 *   (pairedKasirId) bila ada.
 * - Sekunder WS dua-arah (socket eksisting di bawah) untuk kasir/dapur.
 * - Fallback poll SQLite tetap milik layar (berpenanda stale di layar).
 * - Same-device tanpa roundtrip server: saveSale memanggil
 *   notifySaleSavedLocal() (lihat lib/sales.ts) agar CustomerDisplay +
 *   KitchenScreen se-device tampil instan saat offline.
 */
import { apiUrl, getTerminal, getWsUrl } from '../config/server';
import { getApiMode } from './apiSource';
import { normalizeTag } from './deviceRole';
// APP-R3 touchup: impor statis aman — sse.ts hanya bergantung pada
// config/server + apiSource (tak mengimpor display, tanpa siklus).
import { isSseConfigured, subscribeSseFeed, subscribeTerminalEvents, terminalFeedId } from './sse';

export type DisplayOrderItem = { name: string; qty: number; price: number };

export type DisplayEvent =
  | { type: 'call'; ticket: string }
  | { type: 'ready'; ticket: string }
  /** Order berjalan dari server (DISPLAY_ORDER, kontrak terminal §5):
   * antrean + rincian item + total ikut kasir. */
  | { type: 'order'; ticket: string; items: DisplayOrderItem[]; total?: number; status?: string; clientId?: string };

type Listener = (e: DisplayEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let beat: ReturnType<typeof setInterval> | null = null;

/** Waktu event display terakhir (ms epoch) — dasar banner umur-data layar. */
let lastDisplayAt = 0;

/** Heartbeat + backoff ala realtime.ts agar bridge tak putus diam-diam. */
const HEARTBEAT_MS = 30000;

function backoff(n: number): number {
  return Math.min(1000 * 2 ** n, 30000);
}

function stopBeat(): void {
  if (beat) clearInterval(beat);
  beat = null;
}

/** Jadwalkan sambung ulang dengan backoff; diam bila tak ada konsumen. */
function scheduleReconnect(): void {
  stopBeat();
  setWsLive(false);
  socket = null;
  if (retryTimer) return;
  if (listeners.size === 0) return;
  retry += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    ensureSocket();
  }, backoff(retry));
}

/** D7: robek soket WS + heartbeat + retryTimer (tanpa reconnect yatim).
 * Dipanggil saat konsumen terakhir lepas; onclose dari close() manual
 * jatuh ke scheduleReconnect yang diam (listeners kosong). */
function teardownSocket(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  stopBeat();
  retry = 0;
  try {
    socket?.close();
  } catch {
    /* abaikan */
  }
  socket = null;
  setWsLive(false);
}

export function subscribeDisplay(fn: Listener): () => void {
  listeners.add(fn);
  ensureSocket();
  ensureSse();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      teardownSse();
      teardownSocket();
    }
  };
}

function emitLocal(e: DisplayEvent): void {
  try {
    lastDisplayAt = Date.now();
  } catch {
    /* jam tak tersedia — event tetap disebar */
  }
  listeners.forEach((l) => {
    try {
      l(e);
    } catch {
      /* jangan jatuhkan pengirim */
    }
  });
}

/** Normalisasi rincian item asing → DisplayOrderItem (tanpa nama = buang). */
function toOrderItems(raw: unknown): DisplayOrderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DisplayOrderItem[] = [];
  for (const it of raw) {
    const r = it as { name?: unknown; qty?: unknown; price?: unknown };
    if (!r || typeof r.name !== 'string') continue;
    out.push({
      name: r.name,
      qty: Math.max(1, Math.round(Number(r.qty) || 1)),
      price: Math.round(Number(r.price) || 0),
    });
  }
  return out;
}

function ensureSocket(): void {
  try {
    // Hanya ke server milik sendiri (Real Mode = EXPO_PUBLIC_API_BASE_URL).
    // Local/dummy offline-first: tanpa dial; non-custom: infra pihak ketiga.
    if (getApiMode() !== 'real') return;
    if (socket) return;
    const url = getWsUrl();
    if (!url) return;
    const ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      setWsLive(true);
      stopBeat();
      beat = setInterval(() => {
        try {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'PING', terminal: getTerminal().terminalCode }));
        } catch {
          /* abaikan - reconnect via onclose */
        }
      }, HEARTBEAT_MS);
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as DisplayEvent;
        if (!data || typeof data.ticket !== 'string') {
          // Nama server DISPLAY_ORDER (kontrak terminal §4.2) dipetakan ke
          // event order lokal agar tak tergantung socket mana yang ditarget.
          const raw = data as unknown as { type?: unknown; ticket?: unknown; items?: unknown; total?: unknown; status?: unknown };
          if (raw && raw.type === 'DISPLAY_ORDER') {
            const ticket = String(raw.ticket ?? '').trim();
            const items = toOrderItems(raw.items);
            if (ticket && items.length > 0) {
              emitLocal({
                type: 'order',
                ticket,
                items,
                ...(typeof raw.total === 'number' ? { total: raw.total } : {}),
                ...(typeof raw.status === 'string' ? { status: raw.status } : {}),
              });
            }
          }
          return;
        }
        if (data.type === 'call' || data.type === 'ready') {
          emitLocal(data);
        } else if (data.type === 'order') {
          const items = toOrderItems(data.items);
          if (items.length === 0) return;
          emitLocal({
            type: 'order',
            ticket: data.ticket,
            items,
            ...(typeof data.total === 'number' ? { total: data.total } : {}),
            ...(typeof data.status === 'string' ? { status: data.status } : {}),
          });
        }
      } catch {
        /* abaikan payload asing */
      }
    };
    ws.onclose = () => {
      setWsLive(false);
      scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* abaikan */
      }
      scheduleReconnect();
    };
    socket = ws;
  } catch {
    socket = null;
  }
}

/** Siarkan event ke layar lain + WS (best-effort, tak pernah melempar). */
export function publishDisplay(e: DisplayEvent): void {
  emitLocal(e);
  try {
    const url = getWsUrl();
    if (!url) return;
    ensureSocket();
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({ ...e, terminal: getTerminal().terminalCode }));
    }
  } catch {
    /* offline - tampilan lokal tetap sinkron */
  }
}

/** Siarkan order berjalan (dipakai kasir setelah saveSale / update cart). */
export function publishDisplayOrder(
  ticket: string,
  items: DisplayOrderItem[],
  total?: number,
  status?: string,
): void {
  publishDisplay({
    type: 'order',
    ticket,
    items,
    ...(total === undefined ? {} : { total }),
    ...(status === undefined ? {} : { status }),
  });
}

/** Waktu event display terakhir (ms epoch; 0 = belum ada event). */
export function getLastDisplayAt(): number {
  return lastDisplayAt;
}

// ---------------------------------------------------------------------------
// Umur data (SPEC §8: poll fallback "berpenanda stale" + banner umur data).
// D13+M1: dataAgeLabel + OFFLINE_STALE_KEY DIHAPUS (nol pemanggil; kunci
// 'offline_stale' tak ada di kamus) — layar memakai t('disp_stale').
// dataAgeMs dipertahankan sebagai util murni tanpa kunci i18n.
// ---------------------------------------------------------------------------

/** Ambang basi tampilan display (diselaraskan heartbeat 30 dtk). */
export const DISPLAY_STALE_MS = 30000;

/** Umur data (ms) dari timestamp; -1 bila tak diketahui (tanpa klaim). */
export function dataAgeMs(ts: number | string | null | undefined, nowMs = Date.now()): number {
  try {
    const ms = typeof ts === 'number' ? ts : Date.parse(String(ts ?? ''));
    if (!Number.isFinite(ms) || ms <= 0) return -1;
    return Math.max(0, Math.floor(nowMs - ms));
  } catch {
    return -1;
  }
}

// ---------------------------------------------------------------------------
// APP-EVENTS: SSE primer + status live + bus sale lokal same-device.
// ---------------------------------------------------------------------------

type LiveListener = (live: boolean) => void;
const liveListeners = new Set<LiveListener>();
let wsLive = false;
let sseLiveFlag = false;
let sseUnsub: (() => void) | null = null;
let sseForId = '';

function emitLive(): void {
  const live = wsLive || sseLiveFlag;
  liveListeners.forEach((cb) => {
    try {
      cb(live);
    } catch {
      /* abaikan */
    }
  });
}

/** True bila minimal satu kaki realtime (SSE/WS) sedang live. */
export function isDisplayLive(): boolean {
  return wsLive || sseLiveFlag;
}

/** Langganan status live display (SSE primer, WS sekunder). */
export function subscribeDisplayLive(cb: LiveListener): () => void {
  liveListeners.add(cb);
  try {
    cb(isDisplayLive());
  } catch {
    /* abaikan */
  }
  return () => {
    liveListeners.delete(cb);
  };
}

function setWsLive(v: boolean): void {
  if (wsLive === v) return;
  wsLive = v;
  emitLive();
}

function setSseLive(v: boolean): void {
  if (sseLiveFlag === v) return;
  sseLiveFlag = v;
  emitLive();
}

/**
 * TerminalId untuk feed SSE: view_pelanggan memakai kasir pasangan
 * (aturan 1:1, scope cart-view milik kasir); sisanya terminal sendiri.
 * '' = belum ter-bound / kontrak absen => SSE dilewati (poll fallback).
 * APP-FIXUP (fix-sse2 M5): diekspor agar view memakai resolusi terminal SSE
 * yang SAMA dengan bus (pairedKasirId untuk view_pelanggan, SPEC §11.4).
 */
export function resolveDisplaySseTerminalId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sess = require('../session') as typeof import('../session');
    const b = sess.getBinding?.();
    const tag = normalizeTag(b?.tag);
    if (tag === 'view_pelanggan') {
      const paired = String(b?.pairedKasirId ?? '').trim();
      if (paired) return paired;
    }
    const tid = String(b?.terminalId ?? b?.terminalCode ?? '').trim();
    if (tid) return tid;
  } catch {
    /* abaikan — fallback klaim lama di bawah */
  }
  try {
    return String(getTerminal().terminalCode ?? '').trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// D1: namespace pairedKasirId vs kolom terminalId (CLOSED 2026-10-17).
// FAKTA: kolom lokal tr_saleshead.terminalId berisi terminalCode (sales.ts
// menulis t.terminalCode, mis. "K01"); pairedKasirId berisi id BE dari
// bind/E09 (mis. "T01", fixture branch-terminals.json). Predikat
// `terminalId = pairedKasirId` tak pernah cocok lintas namespace.
// PILIHAN: samakan di sisi BACA — resolve kode kasir pasangan via daftar
// terminal E09 (cache per branch+id). Kabel SSE tak disentuh (URL tetap id
// BE) dan tulisan kolom tak diubah (milik lane lain + butuh backfill).
// Gagal resolve (offline/BE absen) = id mentah = kosong jujur (fail-closed).
// ---------------------------------------------------------------------------

const pairedCodeCache = new Map<string, string>();

/** Kode terminal kasir pasangan untuk predikat SQLite lokal (D1). */
export async function resolvePairedKasirCode(branchId: string, pairedKasirId: string): Promise<string> {
  const pid = String(pairedKasirId ?? '').trim();
  if (!pid) return '';
  const key = `${String(branchId ?? '').trim()}::${pid}`;
  const hit = pairedCodeCache.get(key);
  if (hit) return hit;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require('./terminalApi') as typeof import('./terminalApi');
    const r = await api.fetchBranchTerminals(String(branchId ?? '').trim());
    if (r && r.ok) {
      for (const t of r.data.terminals) {
        if (String(t?.terminalId ?? '').trim() === pid) {
          const code = String(t?.terminalCode ?? '').trim();
          if (code) {
            pairedCodeCache.set(key, code);
            return code;
          }
        }
      }
    }
  } catch {
    /* offline/BE absen — fallback id mentah di bawah */
  }
  return pid;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = String(x ?? '').trim();
    if (s) out.push(s);
  }
  return out;
}

/**
 * JB-4: parser snapshot/tunggal antrean TUNGGAL — dipakai mapSseToDisplay
 * (E26 bus) + QueueViewScreen.applyEvent (E27) agar duplikasi logika hilang
 * (satu kebenaran). Perilaku disalin persis dari kedua sisi: daftar memakai
 * `preparing ?? tickets` / `ready`; done = status ready|done|call.
 */
export function parseQueuePayload(
  d: Record<string, unknown>,
  fallbackStatus = '',
): {
  preparing: string[];
  ready: string[];
  hasPrep: boolean;
  hasReady: boolean;
  ticket: string;
  done: boolean;
} {
  const src = (d ?? {}) as Record<string, unknown>;
  const preparing = strList(src.preparing ?? src.tickets);
  const ready = strList(src.ready);
  const ticket = String(
    src.ticket ?? src.code ?? src.no ?? src.salesNum ?? '',
  ).trim();
  const status = String(src.status ?? fallbackStatus ?? '').trim();
  return {
    preparing,
    ready,
    hasPrep: Array.isArray(src.preparing),
    hasReady: Array.isArray(src.ready),
    ticket,
    done: /^(ready|done|call)$/i.test(status),
  };
}

/** Petakan satu event SSE (E26) menjadi 0..N DisplayEvent lokal. */
function mapSseToDisplay(type: string, data: unknown): DisplayEvent[] {
  // Backend membingkai SETIAP frame sebagai `event: message` dengan JSON
  // envelope {type, data} (terminal.go:958 snapshot terminal.state, :980
  // live fan-out + hub terminalEventEnvelope terminal.event) — tipe semantik
  // ada di data.type BERSARANG, bukan nama event SSE luar. Kupas envelope
  // dulu; bila tanpa envelope (frame semantik langsung), pakai nama luar.
  let t = String(type ?? '').toLowerCase();
  let d = (data ?? {}) as Record<string, unknown>;
  if (d && typeof d === 'object' && typeof d.type === 'string' && 'data' in d) {
    t = String(d.type).toLowerCase();
    d = ((d.data ?? {}) as Record<string, unknown>);
  }
  const ticket = String(d.ticket ?? d.code ?? d.no ?? d.salesNum ?? '').trim();
  // D6: wired, activates when BE includes client_id — payload E26/E27
  // (kontrak API-TERMINAL-CONTRACT §4.2 + fixture queue-events.json) kini
  // dipetakan ke event order (clientId) di sini lalu diteruskan ke
  // openTag/liveClientId layar bila hadir; aman no-op bila absen (QR live
  // tetap dari kaki lokal notifySaleSavedLocal + kolom SQLite client_id).
  if (/^(call)$/.test(t)) {
    return ticket ? [{ type: 'call', ticket }] : [];
  }
  if (/^(ready)$/.test(t)) {
    return ticket ? [{ type: 'ready', ticket }] : [];
  }
  // Snapshot antrean (queue-update / preparing+ready): kipas menjadi
  // call/ready individual (dedupe milik layar, max 6 per kaki). JB-4: via
  // parseQueuePayload tunggal (bukan parser kedua).
  const q = parseQueuePayload(d);
  if (/queue/.test(t) && (q.preparing.length > 0 || q.ready.length > 0)) {
    const out: DisplayEvent[] = [];
    for (const tk of q.preparing.slice(0, 6)) out.push({ type: 'order', ticket: tk, items: [] });
    for (const tk of q.ready.slice(0, 6)) out.push({ type: 'ready', ticket: tk });
    return out;
  }
  const items = toOrderItems(d.items);
  if (ticket && (/display|order|cart|payment|qr/.test(t) || items.length > 0)) {
    if (items.length === 0 && !/display|order|cart|payment|qr/.test(t)) return [];
    // D6: client_id SSE (snake_case BE maupun camelCase) — wired, aktif
    // saat BE menyertakannya; absen = field dilepas (no-op).
    const sseClientId = String(d.client_id ?? d.clientId ?? '').trim();
    return [
      {
        type: 'order',
        ticket,
        items,
        ...(sseClientId ? { clientId: sseClientId } : {}),
        ...(typeof d.total === 'number' ? { total: d.total } : {}),
        ...(typeof d.status === 'string' ? { status: d.status } : {}),
      },
    ];
  }
  return [];
}

/**
 * APP-FIXUP (fix-sse2 M5): SATU keputusan TRANSPORT backend untuk feed SSE.
 * Menyatukan cek ganda yang dulu tersebar (isSseConfigured ala lib/sse.ts vs
 * terminalEventsUrl ala lib/terminalContract.ts) — kedua modul pemilik BUKAN
 * lane paket ini (sse READ-ONLY, kontrak milik task BE), jadi unifikasi
 * tinggal di sini: Real Mode + env custom + base terisi (SSE) DAN url events
 * kontrak per terminalId non-kosong. Tak pernah melempar.
 */
export function isBackendConfigured(terminalId: string): boolean {
  try {
    if (!isSseConfigured()) return false;
  } catch {
    return false;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tc = require('./terminalContract') as typeof import('./terminalContract');
    if (!tc.terminalEventsUrl(String(terminalId ?? '').trim())) return false;
  } catch {
    return false;
  }
  return true;
}

/** Nyalakan SSE primer bila ada konsumen + terminal + kontrak. Idempoten. */
function ensureSse(): void {
  if (listeners.size === 0) return;
  // APP-FIXUP (fix-sse2 M5): satu keputusan TRANSPORT via isBackendConfigured
  // (dulu dua cek tersebar: getApiMode + terminalEventsUrl). Fail-closed
  // offline bila tak terkonfigurasi (WS dua-arah + poll SQLite fallback milik
  // layar tetap jalan; isDisplayLive memantulkan WS saja).
  const id = resolveDisplaySseTerminalId();
  if (!id || !isBackendConfigured(id)) {
    setSseLive(false);
    return;
  }
  if (sseUnsub && sseForId === id) return;
  teardownSse();
  try {
    sseForId = id;
    // D16: konsumsi status feed milik terminal ini saja (bukan agregat modul).
    const unsubStatus = subscribeSseFeed(terminalFeedId(id), (s) => setSseLive(s === 'online'));
    const unsubFeed = subscribeTerminalEvents(id, (e) => {
      try {
        const mapped = mapSseToDisplay(e.type, e.data);
        for (const m of mapped) emitLocal(m);
      } catch {
        /* abaikan payload asing */
      }
    });
    sseUnsub = () => {
      try {
        unsubFeed();
      } catch {
        /* abaikan */
      }
      try {
        unsubStatus();
      } catch {
        /* abaikan */
      }
    };
  } catch {
    sseUnsub = null;
    sseForId = '';
    setSseLive(false);
  }
}

function teardownSse(): void {
  try {
    sseUnsub?.();
  } catch {
    /* abaikan */
  }
  sseUnsub = null;
  sseForId = '';
  setSseLive(false);
}

/** Paksa re-resolve SSE (dipanggil setelah (re)bind terminal). Idempoten:
 * feed yang sama tak di-teardown (anti reconnect storm saat dipanggil
 * periodik oleh layar, D10). */
export function refreshDisplayTransport(): void {
  if (listeners.size === 0) return;
  try {
    const id = resolveDisplaySseTerminalId();
    if (id && id === sseForId) return;
  } catch {
    /* lanjut re-resolve di bawah */
  }
  sseForId = '';
  ensureSse();
}

// ---------------------------------------------------------------------------
// Bus sale lokal same-device (audit row 12: kasir→dapur satu device tanpa
// roundtrip server). Dipanggil saveSale via notifySaleSavedLocal; dapur +
// display layar yang sama tampil instan saat offline.
// ---------------------------------------------------------------------------

export interface LocalSaleItem {
  name: string;
  qty: number;
  subtotal: number;
}

export interface LocalSaleInfo {
  salesNum: string;
  clientId: string;
  total: number;
  itemCount: number;
  items: LocalSaleItem[];
}

type LocalSaleListener = (s: LocalSaleInfo) => void;
const localSaleListeners = new Set<LocalSaleListener>();

/** Langganan sale lokal same-device (KitchenScreen refresh tiket offline). */
export function subscribeLocalSale(fn: LocalSaleListener): () => void {
  localSaleListeners.add(fn);
  return () => {
    localSaleListeners.delete(fn);
  };
}

/**
 * Dipanggil saveSale setelah COMMIT (kontrak lib/sales.ts). Tak pernah
 * melempar; penjualan tetap sah walau display lane gagal.
 */
export function notifySaleSavedLocal(info: {
  salesNum: string;
  clientId: string;
  total: number;
  itemCount: number;
  items: LocalSaleItem[];
}): void {
  try {
    const salesNum = String(info?.salesNum ?? '').trim();
    if (!salesNum) return;
    const items: DisplayOrderItem[] = [];
    for (const raw of info?.items ?? []) {
      const name = String(raw?.name ?? '').trim();
      if (!name) continue;
      const qty = Math.max(1, Math.round(Number(raw?.qty) || 1));
      const sub = Math.max(0, Math.round(Number(raw?.subtotal) || 0));
      items.push({ name, qty, price: qty > 0 ? Math.round(sub / qty) : 0 });
    }
    if (items.length > 0) {
      emitLocal({
        type: 'order',
        ticket: salesNum,
        items,
        total: Math.round(Number(info?.total) || 0),
        status: 'open',
      });
    }
    const payload: LocalSaleInfo = {
      salesNum,
      clientId: String(info?.clientId ?? ''),
      total: Math.round(Number(info?.total) || 0),
      itemCount: Math.max(0, Math.round(Number(info?.itemCount) || 0)),
      items: items.map((it) => ({
        name: it.name,
        qty: it.qty,
        subtotal: it.qty * it.price,
      })),
    };
    localSaleListeners.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        /* listener tak boleh menggagalkan sale */
      }
    });
  } catch {
    /* display lane belum siap — penjualan tetap sah */
  }
}
