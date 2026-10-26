// Poller print-bridge slice penuh (FULL, BE 50fd533): antrean cetak terminal.
// Satu siklus = claim → kirim byte ke printer → ack. Tak pernah throw:
// offline/antre-kosong = idle ('empty'), error auth/server = 'error'
// (permukaan auth ditangani layar lain; poller tak boleh mencetak saat ragu).
//
// Aturan server-wins (cermin validatePosVoucherPreview P1-2):
// - Klaim 200 → job milik server; cetak lalu ack sesuai hasil kirim.
// - Tanpa job (204/offline) → idle, TANPA fallback lokal (SQLite tak kenal
//   id job server; antrean lokal tetap milik printqueue.ts).
// - Ack lease basi (409) → catat, jangan retry buta (job kembali ke antrean
//   saat lease kedaluwarsa via klaim berikut).
// - printFn disuntik pemanggil (resolveDrainTarget print.ts) agar modul ini
//   tak mengimpor native/printer dan tetap bisa diuji tanpa runtime RN.

import { ApiPath } from '../config/server';
import { apiFetch, unwrap } from './apiSource';
import { fromBase64 } from './escpos';
import type { PrinterTarget, PrintResult } from '../native/printer';

export interface ServerPrintJob {
  id: number;
  orderId: string | null;
  attempt: number;
  idempotencyKey: string;
  source: string;
  payload: string;
  payloadHash: string;
  leaseToken: string;
  leaseExpiresInSeconds: number;
}

export type ClaimOutcome =
  | { state: 'job'; job: ServerPrintJob }
  | { state: 'empty' }
  | { state: 'error'; status: number };

export type PollOutcome =
  | { state: 'printed'; jobId: number }
  | { state: 'failed'; jobId: number; serverStatus: string }
  | { state: 'empty' }
  | { state: 'error'; status: number };

/** Isi placeholder {id} (+{jobId} opsional) ala pathWithId tanpa impor posWire. */
export function fillPrintPath(tmpl: string, terminalId: string | number, jobId?: string | number): string {
  let out = String(tmpl).replace('{id}', encodeURIComponent(String(terminalId)));
  if (jobId !== undefined) out = out.replace('{jobId}', encodeURIComponent(String(jobId)));
  return out;
}

function asJob(raw: unknown): ServerPrintJob | null {
  const u = unwrap<Record<string, unknown>>(raw);
  const j = (u.data as Record<string, unknown>)?.job as Record<string, unknown> | undefined;
  if (!j || typeof j.id !== 'number' || typeof j.payload !== 'string' || typeof j.leaseToken !== 'string') return null;
  return {
    id: j.id,
    orderId: typeof j.orderId === 'string' ? j.orderId : null,
    attempt: typeof j.attempt === 'number' ? j.attempt : 0,
    idempotencyKey: typeof j.idempotencyKey === 'string' ? j.idempotencyKey : '',
    source: typeof j.source === 'string' ? j.source : '',
    payload: j.payload,
    payloadHash: typeof j.payloadHash === 'string' ? j.payloadHash : '',
    leaseToken: j.leaseToken,
    leaseExpiresInSeconds: typeof j.leaseExpiresInSeconds === 'number' ? j.leaseExpiresInSeconds : 0,
  };
}

export interface FanoutJob {
  destinationId: number;
  destinationName: string;
  kind: string;
  jobId: number;
  duplicate: boolean;
}

export interface FanoutOutcome {
  ok: boolean;
  terminalId?: string;
  jobs: FanoutJob[];
  error?: string;
}

/**
 * Fan-out cetak (BE kontrak baru): POST
 * /api/v1/terminals/{id}/print-fanout
 * {orderId?,idempotencyKey,source:'MANUAL'|'AUTO',payloadBase64,metadata?} →
 * 201 {data:{terminalId,jobs:[{destinationId,destinationName,kind,jobId,
 * duplicate}]}}. Station kind dapur otomatis dikecualikan BE untuk MANUAL.
 * Tak pernah melempar: offline/BE-error = {ok:false} (pemanggil fallback ke
 * antrean lokal printqueue).
 */
export async function postPrintFanout(
  terminalIdBe: string | number,
  input: {
    idempotencyKey: string;
    source: 'MANUAL' | 'AUTO';
    payloadBase64: string;
    orderId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<FanoutOutcome> {
  if (!String(terminalIdBe ?? '').trim()) return { ok: false, jobs: [], error: 'terminalId required' };
  if (!input.idempotencyKey.trim() || !input.payloadBase64.trim()) {
    return { ok: false, jobs: [], error: 'idempotencyKey + payloadBase64 required' };
  }
  let r;
  try {
    r = await apiFetch(fillPrintPath(ApiPath.terminalPrintFanout, terminalIdBe), {
      method: 'POST',
      body: {
        ...(input.orderId ? { orderId: input.orderId } : {}),
        idempotencyKey: input.idempotencyKey,
        source: input.source,
        payloadBase64: input.payloadBase64,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
  } catch {
    return { ok: false, jobs: [], error: 'offline' };
  }
  if (!r.ok) return { ok: false, jobs: [], error: 'fanout failed' };
  const u = unwrap<Record<string, unknown>>(r.data);
  const d = (u.data ?? {}) as Record<string, unknown>;
  const jobs = Array.isArray(d.jobs) ? d.jobs : [];
  return {
    ok: true,
    terminalId: typeof d.terminalId === 'string' ? d.terminalId : undefined,
    jobs: jobs
      .map((j) => {
        if (!j || typeof j !== 'object') return null;
        const o = j as Record<string, unknown>;
        const jobId = Number(o.jobId ?? o.id);
        const destId = Number(o.destinationId);
        if (!Number.isFinite(jobId) || !Number.isFinite(destId)) return null;
        return {
          destinationId: Math.round(destId),
          destinationName: typeof o.destinationName === 'string' ? o.destinationName : '',
          kind: typeof o.kind === 'string' ? o.kind : '',
          jobId: Math.round(jobId),
          duplicate: o.duplicate === true,
        } satisfies FanoutJob;
      })
      .filter((j): j is FanoutJob => j !== null),
  };
}

/**
 * Tugas G: fan-out OTOMATIS struk pasca-bayar (source AUTO).
 * Dipanggil fire-and-forget dari ReceiptScreen.doPrint saat autoPrint
 * pasca-Success (bukan cetak manual — manual tak membuat server jobs).
 * - idempotencyKey = client_id rantai bayar (stabil per sale; BE dedup
 *   per station `{base}:station-{destinationId}`, replay ganda aman).
 * - orderId = id order server numerik bila tertaut (BE menolak non-numerik;
 *   tanpa tautan = dihilangkan, bukan 'TRX-…' display).
 * - terminalIdBe diresolve dari klaim device (branchId+terminalCode →
 *   daftar terminal cabang); tanpa klaim/BE-id = {ok:false} jujur.
 * - Gagal/offline = fallback antrean lokal persisten (kind 'receipt',
 *   target null → drain kind-aware; tak pernah melempar). Anti-ganda:
 *   pemanggil meneruskan `alreadyQueued` dari outcome lokal (jalur lokal
 *   print.ts SUDAH mengantre per-station saat kirim gagal) — fallback di
 *   sini hanya jalan bila lokal BELUM mengantre.
 */
export async function fanoutReceiptAuto(input: {
  orderNo: string;
  clientId: string;
  payloadBase64: string;
  /** true = jalur lokal SUDAH mengantre byte ini (outcome `queued`) —
   * fallback lokal dilewati agar drain tak mencetak ganda. */
  alreadyQueued?: boolean;
}): Promise<FanoutOutcome> {
  const fail = (error: string): FanoutOutcome => ({ ok: false, jobs: [], error });
  const payloadBase64 = String(input?.payloadBase64 ?? '').trim();
  const clientId = String(input?.clientId ?? '').trim().slice(0, 120);
  const orderNo = String(input?.orderNo ?? '').trim();
  if (!payloadBase64 || !clientId) return fail('payload + clientId required');
  try {
    // Lazy-require: terminalApi mengimpor session (lazy) — impor statis di
    // sini berisiko siklus modul saat app boot (pola sama session.ts).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTerminal } = require('../config/server') as typeof import('../config/server');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fetchBranchTerminals } = require('./terminalApi') as typeof import('./terminalApi');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getServerOrderIdForSale } = require('./posWire') as typeof import('./posWire');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { enqueuePrint } = require('./printqueue') as typeof import('./printqueue');
    const g = getTerminal();
    const termCode = String(g?.terminalCode ?? '').trim().toUpperCase();
    const branchId = String(g?.branchId ?? '').trim();
    if (!termCode || !branchId) return fail('terminal-unclaimed');
    const list = await fetchBranchTerminals(branchId);
    if (!list.ok) return fail(`fleet-${list.status}`);
    const hit = list.data.terminals.find(
      (x) => String(x.terminalCode ?? '').trim().toUpperCase() === termCode,
    );
    const beId = String(hit?.terminalId ?? '').trim();
    if (!beId) return fail('no-terminal-id');
    let orderId: string | undefined;
    try {
      const sid = await getServerOrderIdForSale(orderNo);
      if (typeof sid === 'number' && Number.isFinite(sid) && sid > 0) orderId = String(Math.round(sid));
    } catch {
      /* tanpa tautan server = orderId dihilangkan */
    }
    const r = await postPrintFanout(beId, {
      ...(orderId ? { orderId } : {}),
      idempotencyKey: clientId,
      source: 'AUTO',
      payloadBase64,
      metadata: { salesNum: orderNo, origin: 'payment-auto' },
    });
    if (!r.ok && !input.alreadyQueued) {
      // Fallback offline: byte selamat di antrean lokal persisten.
      try {
        const { fromBase64: b64dec } = require('./escpos') as typeof import('./escpos');
        await enqueuePrint(b64dec(payloadBase64), null, { kind: 'receipt', label: `auto-fanout:${orderNo}` });
      } catch {
        /* antre lokal gagal pun tak melempar — outcome jujur di bawah */
      }
    }
    return r;
  } catch {
    return fail('offline');
  }
}

/** Klaim satu job FIFO untuk terminal ini. */export async function claimTerminalPrintJob(terminalIdBe: string | number): Promise<ClaimOutcome> {
  if (!String(terminalIdBe ?? '').trim()) return { state: 'error', status: 400 };
  const r = await apiFetch(fillPrintPath(ApiPath.terminalPrintClaim, terminalIdBe), { method: 'POST', body: {} });
  if (!r.ok) {
    // 204 (json kosong) + offline + dummy → fromDummy; 401/403/5xx → error.
    if (r.fromDummy) return { state: 'empty' };
    return { state: 'error', status: r.status };
  }
  const job = asJob(r.data);
  return job ? { state: 'job', job } : { state: 'empty' };
}

export interface EnqueueOutcome {
  ok: boolean;
  jobId?: number;
  status?: string;
  duplicate?: boolean;
  error?: string;
}

/** Enqueue byte ESC-POS (sudah base64) ke terminal — jalur kasir yang jujur. */
export async function enqueueTerminalPrintJob(
  terminalIdBe: string | number,
  input: { idempotencyKey: string; payloadBase64: string; source?: string; maxAttempts?: number },
): Promise<EnqueueOutcome> {
  if (!String(terminalIdBe ?? '').trim()) return { ok: false, error: 'terminalId required' };
  if (!input.idempotencyKey.trim() || !input.payloadBase64.trim()) {
    return { ok: false, error: 'idempotencyKey + payloadBase64 required' };
  }
  const r = await apiFetch(fillPrintPath(ApiPath.terminalPrintEnqueue, terminalIdBe), {
    method: 'POST',
    body: { idempotencyKey: input.idempotencyKey, source: input.source ?? 'MANUAL', payloadBase64: input.payloadBase64, maxAttempts: input.maxAttempts },
  });
  if (!r.ok) return { ok: false, error: 'enqueue failed' };
  const u = unwrap<Record<string, unknown>>(r.data);
  const d = u.data as Record<string, unknown>;
  const id = typeof d?.id === 'number' ? d.id : Number(d?.id);
  if (!Number.isFinite(id)) return { ok: false, error: 'bad response' };
  return { ok: true, jobId: id, status: typeof d?.status === 'string' ? d.status : undefined, duplicate: (r.data as { duplicate?: boolean })?.duplicate };
}

/** Ack hasil cetak; printed=false wajib sertakan errorCode agar BE catat. */
export async function ackTerminalPrintJob(
  terminalIdBe: string | number,
  jobId: number,
  leaseToken: string,
  printed: boolean,
  errorCode?: string,
  lastError?: string,
): Promise<{ ok: boolean; status?: string }> {
  const r = await apiFetch(fillPrintPath(ApiPath.terminalPrintAck, terminalIdBe, jobId), {
    method: 'POST',
    body: printed
      ? { leaseToken, status: 'PRINTED' }
      : { leaseToken, status: 'FAILED', errorCode: errorCode ?? 'PRINT_FAILED', lastError: lastError ?? 'Printer reported failure' },
  });
  if (!r.ok) return { ok: false };
  const u = unwrap<Record<string, unknown>>(r.data);
  const j = (u.data as Record<string, unknown>)?.job as Record<string, unknown> | undefined;
  const s = j?.status;
  return { ok: true, status: typeof s === 'string' ? s : undefined };
}

/**
 * Satu siklus poller: claim → kirim byte → ack.
 * - printed → ack PRINTED → {printed}.
 * - kirim gagal/exception → ack FAILED (printer siap retry via BE backoff).
 * - decode base64 rusak → ack FAILED INVALID_PAYLOAD (racun antrean jangan
 *   muter selamanya; BE habiskan attempt lalu FAILED final).
 */
export async function pollServerPrintJobs(
  terminalIdBe: string | number,
  target: PrinterTarget,
  printFn: (target: PrinterTarget, bytes: Uint8Array) => Promise<PrintResult>,
): Promise<PollOutcome> {
  const claimed = await claimTerminalPrintJob(terminalIdBe);
  if (claimed.state !== 'job') return claimed;
  const { job } = claimed;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(job.payload);
  } catch {
    const ack = await ackTerminalPrintJob(terminalIdBe, job.id, job.leaseToken, false, 'INVALID_PAYLOAD', 'Payload is not valid base64');
    return { state: 'failed', jobId: job.id, serverStatus: ack.status ?? 'QUEUED' };
  }
  let sent: PrintResult;
  try {
    sent = await printFn(target, bytes);
  } catch {
    sent = { ok: false, reason: 'send-failed', detail: 'printFn threw' };
  }
  if (sent.ok) {
    await ackTerminalPrintJob(terminalIdBe, job.id, job.leaseToken, true);
    return { state: 'printed', jobId: job.id };
  }
  const ack = await ackTerminalPrintJob(
    terminalIdBe,
    job.id,
    job.leaseToken,
    false,
    sent.reason === 'need-dev-client' ? 'NO_PRINTER_MODULE' : 'PRINT_FAILED',
    sent.detail ?? sent.reason,
  );
  return { state: 'failed', jobId: job.id, serverStatus: ack.status ?? 'QUEUED' };
}
