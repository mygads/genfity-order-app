/**
 * Bus sinkronisasi tampilan pelanggan (fakta APK: update display lewat
 * WS/event `updateCustomerDisplaySalesMenu`, bukan kabel serial).
 * Implementasi orisinal best-effort: pelanggan lokal selalu sinkron antar
 * layar; dorong WS dicoba bila URL WS terkonfigurasi, gagal diam-diam.
 */
import { getServerEnv, getTerminal, getWsUrl } from '../config/server';

export type DisplayEvent =
  | { type: 'call'; ticket: string }
  | { type: 'ready'; ticket: string };

type Listener = (e: DisplayEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let beat: ReturnType<typeof setInterval> | null = null;

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
  socket = null;
  if (retryTimer) return;
  if (listeners.size === 0) return;
  retry += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    ensureSocket();
  }, backoff(retry));
}

export function subscribeDisplay(fn: Listener): () => void {
  listeners.add(fn);
  ensureSocket();
  return () => {
    listeners.delete(fn);
  };
}

function emitLocal(e: DisplayEvent): void {
  listeners.forEach((l) => {
    try {
      l(e);
    } catch {
      /* jangan jatuhkan pengirim */
    }
  });
}

function ensureSocket(): void {
  try {
    // Hanya ke server milik sendiri (env Custom). Env bawaan menunjuk
    // infrastruktur pihak ketiga - jangan dial tanpa kredensial merchant.
    if (getServerEnv() !== 'custom') return;
    if (socket) return;
    const url = getWsUrl();
    if (!url) return;
    const ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
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
        if (data && (data.type === 'call' || data.type === 'ready') && typeof data.ticket === 'string') {
          emitLocal(data);
        }
      } catch {
        /* abaikan payload asing */
      }
    };
    ws.onclose = () => {
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
