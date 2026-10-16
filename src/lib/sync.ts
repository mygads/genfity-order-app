/**
 * Antrean sinkronisasi offline-first (fakta: APK memakai antrean sync
 * `tr_sync`-sejenis; implementasi di sini orisinal, kontrak body ikut
 * server Anda — default memakai path `order/finish` dkk dari server.ts).
 *
 * Aturan offline (Lampiran B dossier): baris kotor = `syncDate` NULL,
 * watermark push/pull per domain di `tr_sync`, outbox fisik di
 * `tr_esoprocessqueue`. Persistensi ringan (outbox JSON + last-sync)
 * memakai lib/storage.ts agar work di web + native.
 */
import { ApiPath, apiPost } from '../config/server';
import { markDirty, queryFirst, run } from './db';
import { getItem, setItem } from './storage';

export type SyncStatus = 'antre' | 'terkirim' | 'gagal';
export type SyncKind = 'order' | 'receipt' | 'attendance' | 'other';

export interface SyncItem {
  id: string;
  kind: SyncKind;
  payload: Record<string, unknown>;
  createdAt: string;
  status: SyncStatus;
  note?: string;
}

const LS_OUTBOX = 'genfity.sync.outbox';
const LS_LAST = 'genfity.sync.last';
const LS_LAST_MS = 'genfity.sync.lastMs';

/** Batas enforcement APK: >7 hari belum sync = wajib sync (E00044). */
export const FORCE_SYNC_DAYS = 7;
/** Batas peringatan dini APK: >3 hari. */
export const WARN_SYNC_DAYS = 3;

let outbox: SyncItem[] = [];
let lastSync = '';
let lastSyncMs = 0;
let hydrated = false;

function persist(): void {
  // Fire-and-forget: API modul ini sinkron (dipakai di initializer
  // useState layar), jadi tulis AsyncStorage tanpa menunggu.
  void setItem(LS_OUTBOX, JSON.stringify(outbox));
  void setItem(LS_LAST, lastSync);
  void setItem(LS_LAST_MS, String(lastSyncMs));
}

/** Gabungkan isi tersimpan tanpa menimpa item yang sudah ada di memori. */
function mergeStored(items: SyncItem[]): void {
  for (const s of items) {
    if (!outbox.some((o) => o.id === s.id)) outbox.push(s);
  }
}

function restore(): void {
  void getItem(LS_OUTBOX).then((raw) => {
    if (!raw) return;
    try {
      mergeStored(JSON.parse(raw) as SyncItem[]);
    } catch {
      /* abaikan — pakai memori */
    }
  });
  void getItem(LS_LAST).then((v) => {
    if (v && !lastSync) lastSync = v;
  });
  void getItem(LS_LAST_MS).then((v) => {
    const n = Number(v);
    if (v && !lastSyncMs && Number.isFinite(n)) lastSyncMs = n;
  });
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  restore();
}

function pathFor(kind: SyncKind): string {
  if (kind === 'receipt') return ApiPath.receiptEmail;
  if (kind === 'attendance') return ApiPath.clockIn;
  return ApiPath.pushOrderFinish;
}

export function enqueueSync(kind: SyncKind, payload: Record<string, unknown>): SyncItem {
  hydrate();
  const item: SyncItem = {
    id: `sync-${Date.now()}-${outbox.length + 1}`,
    kind,
    payload,
    createdAt: new Date().toISOString(),
    status: 'antre',
  };
  outbox = [...outbox, item];
  persist();
  return item;
}

export function listOutbox(): SyncItem[] {
  hydrate();
  return [...outbox];
}

export function pendingCount(): number {
  hydrate();
  return outbox.filter((i) => i.status === 'antre' || i.status === 'gagal').length;
}

export function getLastSync(): string {
  hydrate();
  return lastSync;
}

export interface PushResult {
  sent: number;
  failed: number;
}

/** Kirim semua item antre ke base URL aktif; gagal jaringan = status gagal. */
export async function pushAll(): Promise<PushResult> {
  hydrate();
  let sent = 0;
  let failed = 0;
  const next = [...outbox];
  for (const item of next) {
    if (item.status === 'terkirim') continue;
    try {
      const res = await apiPost(pathFor(item.kind), item.payload);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      item.status = 'terkirim';
      item.note = '';
      sent += 1;
      lastSyncMs = Date.now();
      lastSync = new Date().toLocaleString('id-ID');
    } catch (e) {
      item.status = 'gagal';
      item.note = e instanceof Error ? e.message : 'Gagal mengirim';
      failed += 1;
    }
  }
  outbox = next;
  persist();
  return { sent, failed };
}

// ---------------------------------------------------------------------------
// Fondasi data: outbox fisik + watermark tr_sync + auto-sync + enforcement
// ---------------------------------------------------------------------------

export type OutboxOp = 'insert' | 'update' | 'delete';

export interface Watermark {
  push: string;
  pull: string;
}

/**
 * Catat perubahan baris ke outbox fisik `tr_esoprocessqueue` sekaligus
 * tandai baris sumber kotor (syncDate=NULL) dan masukkan antrean ringan.
 * Tidak pernah melempar — kasir tidak boleh diblokir antrean.
 */
export async function enqueueOutbox(
  table: string,
  rowId: string,
  op: OutboxOp,
): Promise<void> {
  hydrate();
  try {
    await run(
      `INSERT INTO tr_esoprocessqueue (id, orderID, serverID, tableName, op, payload, status, createdAt)
       VALUES (?, ?, '', ?, ?, ?, 'antre', ?)`,
      [
        `q-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        rowId,
        table,
        op,
        JSON.stringify({ table, rowId, op }),
        new Date().toISOString(),
      ],
    );
  } catch {
    /* DB belum init — antrean ringan di bawah tetap jalan */
  }
  try {
    await markDirty(table, rowId);
  } catch {
    /* abaikan */
  }
  try {
    enqueueSync('other', { table, rowId, op });
  } catch {
    /* abaikan */
  }
}

/** Baca watermark push/pull satu domain dari `tr_sync`; kosong bila belum ada. */
export async function getWatermark(domain: string): Promise<Watermark> {
  try {
    const row = await queryFirst<{ pushDateTime: string | null; pullDateTime: string | null }>(
      'SELECT pushDateTime, pullDateTime FROM tr_sync WHERE syncType = ?',
      [domain],
    );
    return { push: row?.pushDateTime ?? '', pull: row?.pullDateTime ?? '' };
  } catch {
    return { push: '', pull: '' };
  }
}

/** Tulis (upsert) watermark push/pull satu domain ke `tr_sync`. */
export async function setWatermark(domain: string, mark: Partial<Watermark>): Promise<void> {
  const current = await getWatermark(domain);
  const push = mark.push ?? current.push;
  const pull = mark.pull ?? current.pull;
  try {
    await run(
      `INSERT INTO tr_sync (syncType, pushDateTime, pullDateTime) VALUES (?, ?, ?)
       ON CONFLICT (syncType) DO UPDATE SET pushDateTime = excluded.pushDateTime,
       pullDateTime = excluded.pullDateTime`,
      [domain, push, pull],
    );
  } catch {
    /* DB belum init — pemanggil boleh coba lagi nanti */
  }
}

export type AutoSyncCallback = () => void | Promise<void>;

/**
 * Jalankan `callback` berkala tiap `intervalMs` (Timer.periodic ala APK).
 * Kembalikan fungsi stop untuk membersihkan timer (pakai di useEffect).
 */
export function autoSync(intervalMs: number, callback: AutoSyncCallback): () => void {
  const ms = Math.max(1000, Math.floor(intervalMs));
  const timer = setInterval(() => {
    try {
      const r = callback();
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* jangan matikan timer karena satu galat */
    }
  }, ms);
  return () => clearInterval(timer);
}

/**
 * True bila `last` (ISO / ms / tampilan) lebih tua dari 7 hari, atau tidak
 * diketahui. Tanpa argumen memakai push terakhir modul ini.
 */
export function shouldForceSync(last?: string | number): boolean {
  let ms: number;
  if (typeof last === 'number') {
    ms = last;
  } else if (typeof last === 'string' && last) {
    ms = Date.parse(last);
  } else {
    hydrate();
    ms = lastSyncMs || Date.parse(lastSync);
  }
  if (!Number.isFinite(ms) || ms <= 0) return true;
  return Date.now() - ms > FORCE_SYNC_DAYS * 24 * 3600 * 1000;
}
