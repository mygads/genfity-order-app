/**
 * Realtime ganda ala POSLite: device channel + self-order channel,
 * heartbeat 30 dtk, reconnect backoff, dispatch ke handler terdaftar.
 * Murni JS - jalan di Expo Go maupun dev-client. Di background Android,
 * pasang dengan ForegroundService dari modul native (modules/genfity-printer).
 *
 * APP-EVENTS (audit row 7, SPEC §9): dispatcher tag-keyed membungkus emit().
 * Tag mengatur ROUTING event, bukan feature gate (Q5 CLOSED): kasir/dapur/full
 * tetap melihat semua layar via drawer, tetapi push WS difilter per tag:
 * - online-order-incoming → kasir, full_access
 * - kitchen-incoming / order-accepted → dapur, full_access
 * - cart-view / payment-qr (scope pasangan kasir) → view_pelanggan
 * - queue-update / call / ready (scope branch) → view_queue
 * - SESSION_KICKED / targeted → selalu diteruskan (per perishable session)
 * - tak dikenal (generic) → hanya tag full-feature (fail-closed untuk view)
 * Layar view memakai SSE primer (lib/sse.ts); WS di sini sekunder untuk
 * kasir/dapur + fallback. Tak pernah melempar.
 */
import { getWsUrl, getBaseUrl } from '../config/server';
import { getApiMode } from './apiSource';
import { normalizeTag, type TerminalTag } from './deviceRole';

export type WsMessage = { type: string; payload: Record<string, unknown> };
export type WsHandler = (msg: WsMessage) => void;

const HEARTBEAT_MS = 30000;

interface Channel {
  name: string;
  url: () => string;
  ws: WebSocket | null;
  retry: number;
  timer: ReturnType<typeof setTimeout> | null;
  beat: ReturnType<typeof setInterval> | null;
}

const handlers = new Set<WsHandler>();
const channels: Channel[] = [
  { name: 'device', url: () => getWsUrl(), ws: null, retry: 0, timer: null, beat: null },
  {
    name: 'self-order',
    url: () => getBaseUrl().replace(/^http/, 'ws') + '/wss-self-order',
    ws: null, retry: 0, timer: null, beat: null,
  },
];

const statusListeners = new Set<(connected: boolean) => void>();

/** True bila minimal satu channel WS sedang OPEN. */
export function getWsConnected(): boolean {
  try {
    return channels.some((ch) => ch.ws !== null && ch.ws.readyState === WebSocket.OPEN);
  } catch {
    return false;
  }
}

/** Langganan perubahan status koneksi WS. Mengembalikan fungsi unsubscribe. */
export function subscribeWsStatus(cb: (connected: boolean) => void): () => void {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

function notifyWsStatus(): void {
  const connected = getWsConnected();
  statusListeners.forEach((cb) => {
    try {
      cb(connected);
    } catch {
      /* listener tidak boleh mematikan socket */
    }
  });
}

export function onWsMessage(fn: WsHandler): () => void {
  handlers.add(fn);
  return () => {
    handlers.delete(fn);
  };
}

function emit(msg: WsMessage): void {
  // APP-EVENTS: gerbang tag sebelum fan-out — satu device satu tag, jadi
  // filter global sudah tepat (DB/poll lokal tetap jalan per layar).
  // C1: log-and-drop — tipe tak cocok dicatat lalu dibuang, bukan bypass diam.
  try {
    const tag = getRealtimeTag();
    if (!shouldDeliverToTag(tag, String(msg?.type ?? ''))) {
      try {
        console.log(`[realtime] drop type=${String(msg?.type ?? '')} tag=${tag}`);
      } catch {
        /* logging tak boleh mematikan socket */
      }
      return;
    }
  } catch {
    return;
  }
  handlers.forEach((h) => {
    try {
      h(msg);
    } catch {
      /* handler tidak boleh mematikan socket */
    }
  });
}

/**
 * APP-EVENTS: tag aktif realtime (sesi > binding > perangkat; legacy/
 * kosong => full_access agar kasir lama tetap menerima event).
 */
export function getRealtimeTag(): TerminalTag {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sess = require('../session') as typeof import('../session');
    const st = sess.getSessionTag?.();
    if (st) return st;
    const b = normalizeTag(sess.getBinding?.()?.tag);
    if (b) return b;
  } catch {
    /* abaikan — fallback di bawah */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dr = require('./deviceRole') as typeof import('./deviceRole');
    return dr.resolveTerminalTag(dr.getDeviceRole());
  } catch {
    return 'full_access';
  }
}

/** Klasifikasi topik SPEC §9 dari string tipe WS warisan yang longgar. */
export type RealtimeTopic =
  | 'online-order'
  | 'kitchen'
  | 'display'
  | 'queue'
  | 'call'
  | 'session'
  | 'generic';

export function classifyWsTopic(rawType: unknown): RealtimeTopic {
  const t = String(rawType ?? '').toLowerCase();
  if (!t) return 'generic';
  if (/session|kick|takeover|revoke|logout/.test(t)) return 'session';
  // Panggilan/antrean siap: relevan untuk KEDUA board view (pelanggan +
  // antrean sama-sama menampilkan kolom Disiapkan/Siap Diambil).
  if (t === 'call' || t === 'ready' || /^(call|ready)[:_-]/.test(t)) return 'call';
  if (/cart|payment|qr|display_order|updatecustomerdisplay/.test(t)) return 'display';
  // Dapur eksplisit dulu (sebelum pola 'order' umum di bawah).
  if (/kitchen|ticket|order-accepted|order_accepted/.test(t)) return 'kitchen';
  if (/queue/.test(t)) return 'queue';
  if (/online|esb|self-order|self_order|incoming|new_order/.test(t)) return 'online-order';
  // Status order generik (mis. 'order-status', 'order/finish') milik kasir
  // (alur online-order), bukan dapur — kecuali sudah cocok dapur di atas.
  if (/order/.test(t)) return 'online-order';
  return 'generic';
}

/**
 * APP-EVENTS: bolehkah event tipe ini diteruskan ke tag ini?
 * full_access menerima KEDUA kaki (online-order + kitchen, Q1 CLOSED).
 */
export function shouldDeliverToTag(tag: TerminalTag, rawType: unknown): boolean {
  const topic = classifyWsTopic(rawType);
  if (topic === 'session') return true;
  // Panggilan berlaku untuk kedua view (board yang sama, scope berbeda).
  if (topic === 'call') return tag === 'view_pelanggan' || tag === 'view_queue';
  switch (tag) {
    case 'full_access':
      return topic === 'online-order' || topic === 'kitchen' || topic === 'generic';
    case 'kasir':
      return topic === 'online-order' || topic === 'generic';
    case 'dapur':
      return topic === 'kitchen' || topic === 'generic';
    case 'view_pelanggan':
      return topic === 'display';
    case 'view_queue':
      return topic === 'queue';
    default:
      return false;
  }
}

function backoff(retry: number): number {
  return Math.min(1000 * 2 ** retry, 30000);
}

function connect(ch: Channel): void {
  // Hanya ke server milik sendiri (Real Mode) - jangan dial ketiga.
  if (getApiMode() !== 'real') return;
  const url = ch.url();
  if (!url) return;
  try {
    ch.ws = new WebSocket(url);
  } catch {
    schedule(ch);
    return;
  }
  ch.ws.onopen = () => {
    ch.retry = 0;
    ch.beat = setInterval(() => {
      try {
        ch.ws?.send(JSON.stringify({ type: 'PING', payload: {} }));
      } catch {
        /* abaikan */
      }
    }, HEARTBEAT_MS);
    notifyWsStatus();
  };
  ch.ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as WsMessage;
      if (msg && msg.type && msg.type !== 'PONG') emit(msg);
    } catch {
      /* abaikan frame non-JSON */
    }
  };
  ch.ws.onclose = () => {
    schedule(ch);
    notifyWsStatus();
  };
  ch.ws.onerror = () => {
    try {
      ch.ws?.close();
    } catch {
      /* abaikan */
    }
  };
}

function schedule(ch: Channel): void {
  if (ch.beat) clearInterval(ch.beat);
  ch.beat = null;
  ch.ws = null;
  if (ch.timer) return;
  ch.retry += 1;
  ch.timer = setTimeout(() => {
    ch.timer = null;
    connect(ch);
  }, backoff(ch.retry));
}

/** Nyalakan kedua channel. Panggil sekali setelah login. */
export function startRealtime(): void {
  channels.forEach((ch) => {
    if (!ch.ws && !ch.timer) connect(ch);
  });
}

/** Matikan kedua channel (logout). */
export function stopRealtime(): void {
  channels.forEach((ch) => {
    if (ch.timer) clearTimeout(ch.timer);
    if (ch.beat) clearInterval(ch.beat);
    ch.timer = null;
    ch.beat = null;
    try {
      ch.ws?.close();
    } catch {
      /* abaikan */
    }
    ch.ws = null;
    ch.retry = 0;
  });
  notifyWsStatus();
}
