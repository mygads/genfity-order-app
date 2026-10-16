/**
 * Bus sinkronisasi tampilan pelanggan (fakta APK: update display lewat
 * WS/event `updateCustomerDisplaySalesMenu`, bukan kabel serial).
 * Implementasi orisinal best-effort: pelanggan lokal selalu sinkron antar
 * layar; dorong WS dicoba bila URL WS terkonfigurasi, gagal diam-diam.
 */
import { getServerEnv, getTerminal, getWsUrl } from '../config/server';

export type DisplayOrderItem = { name: string; qty: number; price: number };

export type DisplayEvent =
  | { type: 'call'; ticket: string }
  | { type: 'ready'; ticket: string }
  /** Order berjalan dari server (DISPLAY_ORDER, kontrak terminal §5):
   * antrean + rincian item + total ikut kasir. */
  | { type: 'order'; ticket: string; items: DisplayOrderItem[]; total?: number; status?: string };

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
