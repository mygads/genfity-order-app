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
    // infrastruktur pihak ketiga — jangan dial tanpa kredensial merchant.
    if (getServerEnv() !== 'custom') return;
    if (socket) return;
    const url = getWsUrl();
    if (!url) return;
    const ws = new WebSocket(url);
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
      socket = null;
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* abaikan */
      }
      socket = null;
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
    /* offline — tampilan lokal tetap sinkron */
  }
}
