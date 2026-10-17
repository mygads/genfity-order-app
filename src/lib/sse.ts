/**
 * Klien SSE (Server-Sent Events) untuk feed display online-only
 * (SPEC-TERMINAL-SESSION §8: view_pelanggan ← E26 cart+QR dari kasir
 * pasangan; view_queue ← E27 feed branch; kasir/dapur/full_access memakai
 * WS dua-arah — lihat realtime.ts).
 *
 * Tanpa dependensi baru (aturan C1): streaming via fetch ReadableStream bila
 * didukung runtime (web/dev-client modern); fallback POLLING jujur (GET ulang
 * + Last-Event-ID + dedupe id) di runtime tanpa streaming (Expo Go/native).
 * Klien tak pernah melempar ke UI: status online/offline dilaporkan lewat
 * onStatus agar layar menampilkan banner (kunci i18n 'sse_offline' dipakai
 * layar via t()/useTranslation — modul ini hanya mengekspor SSE_OFFLINE_KEY
 * sebagai kontrak string, tanpa menambah kunci kamus).
 *
 * BE E26/E27 sebagian BELUM ADA: base kosong / env bukan custom / HTTP gagal
 * → status 'offline' + retry backoff, tanpa bypass diam-diam (butuh BE /
 * mode lokal). Jangan dial ke infra pihak ketiga (realtime-08).
 */
import { ApiPath, apiUrl, getBaseUrl, getServerEnv, getTerminal } from '../config/server';
import { getApiMode } from './apiSource';

export type SseStatus = 'connecting' | 'online' | 'offline';

export interface SseEvent {
  id: string;
  type: string;
  data: unknown;
  raw: string;
}

export type SseMessageHandler = (ev: SseEvent) => void;
export type SseStatusHandler = (status: SseStatus) => void;

/** Kunci i18n banner offline SSE (dirender layar, bukan modul ini). */
export const SSE_OFFLINE_KEY = 'sse_offline';

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;
const DEFAULT_POLL_MS = 8000;
const SEEN_CAP = 1000;

function backoffMs(retry: number): number {
  const n = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, retry), RETRY_MAX_MS);
  return n + Math.floor(Math.random() * 500);
}

function withId(path: string, id: string): string {
  const safe = encodeURIComponent(String(id ?? ''));
  return path.replace('{id}', safe).replace('{viewId}', safe).replace('{branchId}', safe);
}

/**
 * EventSource/fetch-SSE tak bisa menyetel header Authorization, sedangkan
 * backend WAJIB auth (TerminalEventsSSE → 401 tanpa konteks user; grup route
 * menerima bearerFromQueryParam("token") SEBELUM UserAuth — router.go).
 * Selipkan kredensial sesi (authToken JWT E01 dulu, fallback authKey
 * terminal-login — selaras server.ts resolveSessionToken +
 * terminalContract.ts:179) sebagai ?token= pada URL SSE; tanpa
 * token, URL dibiarkan apa adanya (server 401 jujur → status offline).
 * Lazy-require agar tak ada siklus impor (session tak mengimpor modul ini).
 * APP-FIXUP(R-sse-token-order): urutan disamakan authToken-dulu (sebelumnya
 * authKey-dulu, berlawanan dengan server.ts:342).
 */
function withQueryToken(url: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sess = require('../session') as typeof import('../session');
    const s = sess.getSession?.();
    const token = String(s?.authToken ?? s?.authKey ?? '').trim();
    if (!token) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  } catch {
    return url;
  }
}

/** Header SSE: Accept event-stream + konteks terminal (kontrak §2). */
function sseHeaders(extra?: Record<string, string>): Record<string, string> {
  const t = getTerminal();
  const h: Record<string, string> = { Accept: 'text/event-stream' };
  if (t.terminalCode) h['X-Terminal-Code'] = t.terminalCode;
  if (t.branchId) h['X-Branch-Id'] = t.branchId;
  if (extra) {
    for (const k of Object.keys(extra)) h[k] = extra[k];
  }
  return h;
}

/** Backend terkonfigurasi untuk SSE: Real Mode + env custom + base terisi. */
export function isSseConfigured(): boolean {
  try {
    return (
      getApiMode() === 'real' &&
      getServerEnv() === 'custom' &&
      getBaseUrl().trim().length > 0
    );
  } catch {
    return false;
  }
}

/** Parse satu blok SSE (field event:/data:/id:; data multi-baris digabung \n). */
export function parseSseBlock(block: string): SseEvent | null {
  const lines = String(block ?? '').split(/\r?\n/);
  let type = '';
  let id = '';
  const dataLines: string[] = [];
  let touched = false;
  for (const ln of lines) {
    if (ln.startsWith('event:')) {
      type = ln.slice(6).trim();
      touched = true;
    } else if (ln.startsWith('data:')) {
      dataLines.push(ln.slice(5).replace(/^ /, ''));
      touched = true;
    } else if (ln.startsWith('id:')) {
      id = ln.slice(3).trim();
      touched = true;
    } else if (ln.startsWith(':')) {
      touched = true; /* komentar/heartbeat SSE */
    }
  }
  if (!touched) return null;
  const raw = dataLines.join('\n');
  let data: unknown = raw;
  if (raw) {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      /* payload non-JSON: pakai mentah */
    }
  }
  return { id, type: type || 'message', data, raw };
}

/** Parse payload text SSE penuh menjadi daftar event. */
export function parseSseText(text: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of String(text ?? '').split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const ev = parseSseBlock(block);
    if (ev) out.push(ev);
  }
  return out;
}

type DecoderLike = {
  decode(input?: Uint8Array, opts?: { stream?: boolean }): string;
};

/** TextDecoder global (Hermes modern/web); null bila tak ada → mode polling. */
function makeDecoder(): DecoderLike | null {
  try {
    const Ctor = (globalThis as unknown as { TextDecoder?: new () => DecoderLike }).TextDecoder;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

interface StreamReaderLike {
  read(): Promise<{ done?: boolean; value?: Uint8Array }>;
  releaseLock(): void;
}

interface ByteStreamLike {
  getReader(): StreamReaderLike;
}

export interface SseClientOpts {
  onMessage?: SseMessageHandler;
  onStatus?: SseStatusHandler;
  /** Interval fallback polling (ms) bila streaming tak didukung. */
  pollMs?: number;
  headers?: Record<string, string>;
  /** D16: id feed (E26 per terminal / E27 per branch) untuk status per-feed. */
  feedId?: string;
}

export class SseClient {
  private url: string;
  private onMessage: SseMessageHandler | null;
  private onStatus: SseStatusHandler | null;
  private pollMs: number;
  private extraHeaders: Record<string, string>;
  private feedId: string;
  private status: SseStatus = 'offline';
  private running = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ctrl: AbortController | null = null;
  private lastEventId = '';
  private seen = new Set<string>();

  constructor(url: string, opts?: SseClientOpts) {
    this.url = String(url ?? '');
    this.onMessage = opts?.onMessage ?? null;
    this.onStatus = opts?.onStatus ?? null;
    this.pollMs = Math.max(2000, Math.floor(Number(opts?.pollMs) || DEFAULT_POLL_MS));
    this.extraHeaders = { ...(opts?.headers ?? {}) };
    this.feedId = String(opts?.feedId ?? '');
  }

  getStatus(): SseStatus {
    return this.status;
  }

  getLastEventId(): string {
    return this.lastEventId;
  }

  /** D16: id feed milik klien ini ('' = tak terdaftar per-feed). */
  getFeedId(): string {
    return this.feedId;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.retry = 0;
    this.setStatus('connecting');
    sseInstances.add(this);
    emitSseAggregate();
    recomputeFeed(this.feedId);
    void this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.ctrl?.abort();
    } catch {
      /* abaikan */
    }
    this.ctrl = null;
    sseInstances.delete(this);
    emitSseAggregate();
    recomputeFeed(this.feedId);
  }

  private setStatus(next: SseStatus): void {
    if (this.status === next) return;
    this.status = next;
    try {
      this.onStatus?.(next);
    } catch {
      /* listener tak boleh mematikan klien */
    }
    emitSseAggregate();
    recomputeFeed(this.feedId);
  }

  /** Catat id; false bila duplikat (agar poll ulang tak kirim ganda). */
  private remember(ev: SseEvent): boolean {
    if (ev.id) {
      this.lastEventId = ev.id;
      if (this.seen.has(ev.id)) return false;
      this.seen.add(ev.id);
      if (this.seen.size > SEEN_CAP) this.seen.clear();
    }
    return true;
  }

  private deliver(ev: SseEvent): void {
    if (!this.remember(ev)) return;
    try {
      this.onMessage?.(ev);
    } catch {
      /* handler tak boleh mematikan klien */
    }
  }

  private scheduleRetry(): void {
    if (!this.running || this.timer) return;
    this.retry += 1;
    this.setStatus('offline');
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.running) {
        this.setStatus('connecting');
        void this.connect();
      }
    }, backoffMs(this.retry));
  }

  private schedulePoll(): void {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.running) void this.connect();
    }, this.pollMs);
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    // Fail-CLOSED jujur: tanpa BE terkonfigurasi, laporkan offline (butuh BE /
    // mode lokal) tanpa badai fetch (realtime-08: jangan dial pihak ketiga).
    if (!this.url || !isSseConfigured()) {
      this.setStatus('offline');
      return;
    }
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    try {
      const headers = sseHeaders(this.extraHeaders);
      if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId;
      // Kredensial via ?token= (lihat withQueryToken) — header tak
      // tersedia untuk EventSource; backend menolak tanpa auth.
      const res = await fetch(withQueryToken(this.url), { method: 'GET', headers, signal: ctrl.signal });
      if (!res.ok) {
        this.scheduleRetry();
        return;
      }
      this.retry = 0;
      this.setStatus('online');
      const rawBody: unknown = (res as { body?: unknown }).body;
      const stream = rawBody as ByteStreamLike | null | undefined;
      const canStream =
        makeDecoder() !== null &&
        !!stream &&
        typeof stream.getReader === 'function';
      if (canStream && stream) {
        await this.readStream(stream, ctrl.signal);
        // Server menutup stream: reconnect backoff (SSE itu langganan).
        if (!ctrl.signal.aborted) this.scheduleRetry();
      } else {
        await this.readPoll(res);
        if (!ctrl.signal.aborted) this.schedulePoll();
      }
    } catch {
      if (!ctrl.signal.aborted) this.scheduleRetry();
    } finally {
      if (this.ctrl === ctrl) this.ctrl = null;
    }
  }

  private async readStream(stream: ByteStreamLike, signal: AbortSignal): Promise<void> {
    const dec = makeDecoder();
    if (!dec) return;
    const reader = stream.getReader();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) break;
        if (value) {
          buf += dec.decode(value, { stream: true });
          const parts = buf.split(/\r?\n\r?\n/);
          buf = parts.pop() ?? '';
          for (const p of parts) {
            if (!p.trim() || signal.aborted) continue;
            const ev = parseSseBlock(p);
            if (ev) this.deliver(ev);
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* abaikan */
      }
    }
  }

  private async readPoll(res: Response): Promise<void> {
    try {
      const text = await res.text();
      for (const ev of parseSseText(text)) this.deliver(ev);
    } catch {
      /* payload rusak: status tetap online, poll berikut mencoba lagi */
    }
  }
}

/** Langganan feed SSE per terminal E26 (cart-view/payment-qr → view_pelanggan). */
export function subscribeTerminalEvents(
  terminalId: string,
  cb: SseMessageHandler,
  opts?: { onStatus?: SseStatusHandler; pollMs?: number },
): () => void {
  const url = apiUrl(withId(ApiPath.terminalEvents, terminalId));
  const client = new SseClient(url, {
    onMessage: cb,
    onStatus: opts?.onStatus,
    pollMs: opts?.pollMs,
    feedId: terminalFeedId(terminalId),
  });
  client.start();
  return () => client.stop();
}

/** Langganan feed antrean SSE per branch E27 (queue-update/call/ready).
 * URL eksak kontrak IMPLEMENTED: {base}/api/v1/branches/{branchId}/queue-events
 * + ?token= via withQueryToken (ApiPath.queueEvents memakai {id} yang diganti
 * withId; id: qb-{branch}-{seq} didedupe di remember; version = sekuens hub). */
export function subscribeQueueEvents(
  branchId: string,
  cb: SseMessageHandler,
  opts?: { onStatus?: SseStatusHandler; pollMs?: number },
): () => void {
  const url = apiUrl(withId(ApiPath.queueEvents, branchId));
  const client = new SseClient(url, {
    onMessage: cb,
    onStatus: opts?.onStatus,
    pollMs: opts?.pollMs,
    feedId: queueFeedId(branchId),
  });
  client.start();
  return () => client.stop();
}

// ---------------------------------------------------------------------------
// Agregat status modul (dipakai display.ts ensureSse lane APP-EVENTS):
// live = ada ≥1 klien berjalan yang sedang online. Tak pernah melempar.
// ---------------------------------------------------------------------------

const sseInstances = new Set<SseClient>();
const sseLiveListeners = new Set<(live: boolean) => void>();

function sseAggregateLive(): boolean {
  try {
    for (const c of sseInstances) {
      if (c.getStatus() === 'online') return true;
    }
  } catch {
    /* abaikan — anggap offline */
  }
  return false;
}

function emitSseAggregate(): void {
  const live = sseAggregateLive();
  sseLiveListeners.forEach((cb) => {
    try {
      cb(live);
    } catch {
      /* listener tak boleh mematikan klien */
    }
  });
}

/**
 * Langganan status agregat SSE modul (true = ≥1 feed online).
 * Dipanggil segera dengan status kini; kembalikan fungsi unsubscribe.
 */
export function subscribeSseStatus(cb: (live: boolean) => void): () => void {
  sseLiveListeners.add(cb);
  try {
    cb(sseAggregateLive());
  } catch {
    /* abaikan */
  }
  return () => {
    sseLiveListeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// D16: status SSE per feed (bus display hanya konsumsi feed-nya sendiri).
// Agregat modul di atas dipertahankan untuk konsumen lama; feed di sini =
// terminal E26 / antrean E27 per id. Tak pernah melempar.
// ---------------------------------------------------------------------------

/** Kunci feed kanonis E26 per terminal. */
export function terminalFeedId(terminalId: string): string {
  return `term:${String(terminalId ?? '').trim()}`;
}

/** Kunci feed kanonis E27 per branch. */
export function queueFeedId(branchId: string): string {
  return `queue:${String(branchId ?? '').trim()}`;
}

const feedStates = new Map<string, SseStatus>();
const feedListeners = new Map<string, Set<SseStatusHandler>>();

/** Hitung ulang status satu feed dari klien berjalan (online > connecting > offline). */
function recomputeFeed(feedId: string): void {
  if (!feedId) return;
  let next: SseStatus = 'offline';
  try {
    for (const c of sseInstances) {
      if (c.getFeedId() !== feedId) continue;
      const s = c.getStatus();
      if (s === 'online') {
        next = 'online';
        break;
      }
      if (s === 'connecting') next = 'connecting';
    }
  } catch {
    next = 'offline';
  }
  const prev = feedStates.get(feedId);
  feedStates.set(feedId, next);
  if (prev === next) return;
  const set = feedListeners.get(feedId);
  if (!set) return;
  set.forEach((cb) => {
    try {
      cb(next);
    } catch {
      /* listener tak boleh mematikan klien */
    }
  });
}

/** Status terakhir feed ini ('offline' bila belum pernah ada klien). */
export function getSseFeedStatus(feedId: string): SseStatus {
  return feedStates.get(String(feedId ?? '')) ?? 'offline';
}

/**
 * Langganan status SATU feed (dipanggil segera dengan status kini;
 * kembalikan fungsi unsubscribe). Dipakai bus display + layar view agar
 * feed antrean tak menutupi feed terminal yang mati (dan sebaliknya).
 */
export function subscribeSseFeed(feedId: string, cb: SseStatusHandler): () => void {
  const key = String(feedId ?? '');
  let set = feedListeners.get(key);
  if (!set) {
    set = new Set();
    feedListeners.set(key, set);
  }
  set.add(cb);
  try {
    cb(getSseFeedStatus(key));
  } catch {
    /* abaikan */
  }
  return () => {
    try {
      feedListeners.get(key)?.delete(cb);
    } catch {
      /* abaikan */
    }
  };
}
