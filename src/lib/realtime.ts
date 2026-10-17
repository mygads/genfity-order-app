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
import { Alert, AppState } from 'react-native';
import { getWsUrl, getBaseUrl, notePong, isConnDead, noteReconnect } from '../config/server';
import { getApiMode } from './apiSource';
import type { TerminalTag } from './deviceRole';
import { resolveEffectiveTag } from './effectiveTag';

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
  // K1: SESSION_KICKED / takeover — sesi digantikan login lain: cabut sesi
  // lokal + beri tahu kasir (kunci kicked_msg), apa pun tag-nya.
  try {
    if (/kick|takeover/.test(String(msg?.type ?? '').toLowerCase())) {
      handleSessionKicked();
    }
  } catch {
    /* abaikan — lanjut dispatch */
  }
  // APP-EVENTS: gerbang tag sebelum fan-out — satu device satu tag, jadi
  // filter global sudah tepat (DB/poll lokal tetap jalan per layar).
  // C1: log-and-drop — tipe tak cocok dicatat lalu dibuang, bukan bypass diam.
  try {
    const tag = getRealtimeTag();
    if (!shouldDeliverToTag(tag, String(msg?.type ?? ''))) {
      if (__DEV__) {
        try {
          console.log(`[realtime] drop type=${String(msg?.type ?? '')} tag=${tag}`);
        } catch {
          /* logging tak boleh mematikan socket */
        }
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
 * APP-EVENTS: tag aktif realtime (R58: satu sumber via resolveEffectiveTag).
 */
export function getRealtimeTag(): TerminalTag {
  try {
    return resolveEffectiveTag();
  } catch {
    return 'full_access';
  }
}

/**
 * K1: perangkat lama yang sesinya digantikan login lain — logout lokal
 * (menandai pendingRevoke + stopRealtime) + Alert kicked_msg agar kasir tahu
 * mengapa layar kembali ke login. Tak pernah melempar.
 */
function handleSessionKicked(): void {
  let text: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tOf, getLang } = require('./i18n') as typeof import('./i18n');
    text = tOf('kicked_msg', getLang());
  } catch {
    text = null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sess = require('../session') as typeof import('../session');
    if (text) sess.setKickNotice?.(text);
    sess.logout?.();
  } catch {
    /* abaikan */
  }
  if (!text) return;
  try {
    Alert.alert(text);
  } catch {
    /* abaikan */
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
  // R48: jitter ala sse.ts agar reconnect serentak banyak device tak sinkron.
  return Math.min(1000 * 2 ** retry, 30000) + Math.floor(Math.random() * 500);
}

/** R48: jumlah percobaan ulang sebelum channel idle (hemat baterai). */
const MAX_RETRY = 12;

/** R48: true bila app foreground — tak ada gunanya dial saat background. */
function appForeground(): boolean {
  try {
    return AppState.currentState === 'active';
  } catch {
    return true;
  }
}

/**
 * R48: true bila jaringan device up (expo-network, best-effort → true bila
 * cek gagal agar perilaku lama bertahan di perangkat tanpa modul network).
 */
async function netUp(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Net = require('expo-network') as {
      getNetworkStateAsync?: () => Promise<{ isConnected?: boolean }>;
    };
    if (!Net?.getNetworkStateAsync) return true;
    const st = await Net.getNetworkStateAsync();
    return st?.isConnected !== false;
  } catch {
    return true;
  }
}

function connect(ch: Channel): void {
  // Hanya ke server milik sendiri (Real Mode) - jangan dial ketiga.
  if (getApiMode() !== 'real') return;
  // R48: tunda dial saat background — schedule mencoba lagi.
  if (!appForeground()) {
    schedule(ch);
    return;
  }
  const url = ch.url();
  if (!url) return;
  // R48: tunda dial saat jaringan mati — schedule mencoba lagi.
  void netUp().then((up) => {
    if (!up) {
      schedule(ch);
      return;
    }
    openSocket(ch, url);
  });
}

function openSocket(ch: Channel, url: string): void {
  try {
    ch.ws = new WebSocket(url);
  } catch {
    schedule(ch);
    return;
  }
  ch.ws.onopen = () => {
    // S15: reconnect (retry>0) = picu sinkronisasi ulang master via pemilik
    // realtime — lazy require agar nol tepi statis baru (tak ada siklus
    // server → master → sync → server). Connect pertama tak memicu pull
    // (master sudah ditarik alur login/boot).
    const reconnected = ch.retry > 0;
    ch.retry = 0;
    if (reconnected) {
      try {
        noteReconnect();
      } catch {
        /* stempel best-effort */
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('./master') as typeof import('./master');
        void m.pullMaster().catch(() => {
          /* gagal reconnect-pull = jadwal sync biasa yang menangani */
        });
      } catch {
        /* master belum siap — reconnect soket tetap sah */
      }
    }
    ch.beat = setInterval(() => {
      try {
        // S15: detak mati 90 dtk (tanpa pong) = tutup soket agar onclose
        // menjadwalkan reconnect (backoff), bukan diam setengah-mati.
        if (isConnDead()) {
          try {
            ch.ws?.close();
          } catch {
            /* onclose yang menjadwalkan */
          }
          return;
        }
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
      // S15: pong = detak koneksi (tanpa dispatch); mati 90 dtk = reconnect.
      if (msg && msg.type === 'PONG') {
        try {
          notePong();
        } catch {
          /* stempel best-effort */
        }
        return;
      }
      if (msg && msg.type) emit(msg);
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
  // R48: idle setelah MAX_RETRY — berhenti dial sampai startRealtime /
  // foreground membangunkan lagi (hemat baterai, bukan retry selamanya).
  if (ch.retry >= MAX_RETRY) return;
  ch.retry += 1;
  ch.timer = setTimeout(() => {
    ch.timer = null;
    connect(ch);
  }, backoff(ch.retry));
}

/** Nyalakan kedua channel. Panggil sekali setelah login. */
export function startRealtime(): void {
  channels.forEach((ch) => {
    if (ch.ws || ch.timer) return;
    ch.retry = 0;
    connect(ch);
  });
}

// R48: foreground membangunkan channel yang idle karena max-retry.
try {
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    channels.forEach((ch) => {
      if (ch.ws || ch.timer || ch.retry < MAX_RETRY) return;
      ch.retry = 0;
      connect(ch);
    });
  });
} catch {
  /* listener best-effort — tanpa ini channel tetap jalan via startRealtime */
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
