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
}

export class SseClient {
  private url: string;
  private onMessage: SseMessageHandler | null;
  private onStatus: SseStatusHandler | null;
  private pollMs: number;
  private extraHeaders: Record<string, string>;
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
  }

  getStatus(): SseStatus {
    return this.status;
  }

  getLastEventId(): string {
    return this.lastEventId;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.retry = 0;
    this.setStatus('connecting');
    sseInstances.add(this);
    emitSseAggregate();
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
      const res = await fetch(this.url, { method: 'GET', headers, signal: ctrl.signal });
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
  });
  client.start();
  return () => client.stop();
}

/** Langganan feed antrean SSE per branch E27 (queue-update/call/ready). */
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
