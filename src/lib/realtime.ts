/**
 * Realtime ganda ala POSLite: device channel + self-order channel,
 * heartbeat 30 dtk, reconnect backoff, dispatch ke handler terdaftar.
 * Murni JS - jalan di Expo Go maupun dev-client. Di background Android,
 * pasang dengan ForegroundService dari modul native (modules/genfity-printer).
 */
import { getServerEnv, getWsUrl, getBaseUrl } from '../config/server';

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
  handlers.forEach((h) => {
    try {
      h(msg);
    } catch {
      /* handler tidak boleh mematikan socket */
    }
  });
}

function backoff(retry: number): number {
  return Math.min(1000 * 2 ** retry, 30000);
}

function connect(ch: Channel): void {
  // Hanya ke server milik sendiri (env Custom) - jangan dial ketiga.
  if (getServerEnv() !== 'custom') return;
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
