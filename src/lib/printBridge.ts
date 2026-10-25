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

/** Klaim satu job FIFO untuk terminal ini. */
export async function claimTerminalPrintJob(terminalIdBe: string | number): Promise<ClaimOutcome> {
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
