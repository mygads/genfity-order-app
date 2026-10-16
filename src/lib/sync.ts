/**
 * Antrean sinkronisasi offline-first (fakta: APK memakai antrean sync
 * `tr_sync`-sejenis; implementasi di sini orisinal, kontrak body ikut
 * server Anda - default memakai path `order/finish` dkk dari server.ts).
 *
 * Aturan offline (Lampiran B dossier): baris kotor = `syncDate` NULL,
 * watermark push/pull per domain di `tr_sync`, outbox fisik di
 * `tr_esoprocessqueue`. Persistensi ringan (outbox JSON + last-sync)
 * memakai lib/storage.ts agar work di web + native.
 */
import { ApiPath, apiPost, getServerEnv } from '../config/server';
import { all, markDirty, queryFirst, run } from './db';
import { tr } from './i18n';
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
      /* abaikan - pakai memori */
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

/**
 * Endpoint push per tabel (kontrak §5). Tabel master (ms_*) tidak punya
 * endpoint push di kontrak (server menang untuk master, §4) sehingga
 * dikembalikan null oleh tablePushPath dan tidak dikirim ke order/finish.
 */
function tablePushPath(table: string): string | null {
  if (table === 'tr_branchexpense' || table === 'tr_branchexpensedocument') return ApiPath.pushExpense;
  if (table === 'tr_memberdeposit') return ApiPath.depositTopup;
  if (table === 'tr_shiftlog' || table === 'tr_shiftlogdetail') return ApiPath.pushShiftOpen;
  if (table.startsWith('ms_')) return null;
  if (table.startsWith('tr_')) return ApiPath.pushOrderFinish;
  return null;
}

function pathFor(kind: SyncKind, payload?: Record<string, unknown>): string | null {
  if (kind === 'receipt') return ApiPath.receiptEmail;
  if (kind === 'attendance') {
    const t = String(payload?.type ?? '');
    if (t === 'clock-out') return ApiPath.clockOut;
    return ApiPath.clockIn;
  }
  if (kind === 'other') {
    // Shift punya endpoint sendiri (dummy push/shift-open+close sudah ada):
    // JANGAN dilempar ke pushOrderFinish (endpoint salah).
    const op = String(payload?.op ?? '');
    if (op === 'shift-open') return ApiPath.pushShiftOpen;
    if (op === 'shift-close') return ApiPath.pushShiftClose;
    if (op === 'move-items') return ApiPath.moveItems;
    if (op === 'move-table') return ApiPath.moveTable;
    // Deposit / voucher memakai field `kind` di payload (bukan `op`).
    const k = String(payload?.kind ?? '');
    if (k === 'deposit-topup' || k === 'member-deposit') return ApiPath.depositTopup;
    if (k === 'voucher-validate') return ApiPath.voucherValidate;
    if (k === 'voucher-lock') return ApiPath.voucherLock;
    if (k === 'voucher-unlock') return ApiPath.voucherUnlock;
    if (k === 'voucher-burn') return ApiPath.voucherBurn;
    // Operasi berbasis tabel (antrean ringan enqueueOutbox): ikut tablePushPath.
    // Tabel master (ms_*) → null; kode meja booking ("A1") bukan nama tabel →
    // null juga. Null = tidak ada endpoint push → dilewati pushAll.
    const table = String(payload?.table ?? '');
    if (table) {
      const p = tablePushPath(table);
      if (p) return p;
    }
    return null;
  }
  const table = String(payload?.table ?? '');
  if (table) {
    const p = tablePushPath(table);
    // Tabel master (null) tidak pernah sampai sini: enqueueOutbox tidak
    // mengantrekan ms_* dan pushAll melewatinya (lihat TODO M9-3 di bawah).
    // Fallback ini hanya untuk antrean lama / tabel transaksi tak dikenal.
    if (p) return p;
  }
  return ApiPath.pushOrderFinish;
}

// TODO(M9-3): kontrak §5 belum mendefinisikan endpoint push master
// (sold-out / branch-menu / station). Bila BE menambahkannya (mis.
// main/update-branch-menu), daftarkan di ApiPath + tablePushPath dan
// aktifkan lagi antrean ringan untuk ms_* di enqueueOutbox.

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

/** Timestamp ms sync sukses terakhir (0 bila belum pernah). */
export function getLastSyncMs(): number {
  hydrate();
  return lastSyncMs;
}

export interface PushResult {
  sent: number;
  failed: number;
}

/**
 * Kirim semua item antre ke server MILIK SENDIRI (env Custom).
 * Env bawaan menunjuk infrastruktur pihak ketiga: push ke sana DITOLAK
 * agar data penjualan tak bocor - pilih Custom di Pengaturan › Server.
 */
interface PhysicalQueueRow {
  id: string;
  orderID: string;
  serverID: string;
  tableName: string;
  op: string;
  payload: string;
  status: string;
  createdAt: string;
}

/**
 * Kuras outbox fisik `tr_esoprocessqueue`: SELECT antre → POST per baris via
 * tablePushPath → DELETE yang sukses (UPDATE status='gagal' bila gagal) +
 * watermark push per tabel via setWatermark. Tidak pernah melempar
 * (offline-first): DB belum init / offline ditelan per baris.
 */
async function drainPhysicalQueue(): Promise<PushResult> {
  let sent = 0;
  let failed = 0;
  let rows: PhysicalQueueRow[] = [];
  try {
    rows = await all<PhysicalQueueRow>(
      `SELECT id, orderID, serverID, tableName, op, payload, status, createdAt
       FROM tr_esoprocessqueue WHERE status IN ('antre', 'gagal')
       ORDER BY createdAt ASC LIMIT 200`,
    );
  } catch {
    return { sent, failed };
  }
  for (const row of rows) {
    const table = String(row.tableName ?? '');
    // Master (ms_*) tidak punya endpoint push (§5/M9-3): biarkan antre lokal.
    if (!table || table.startsWith('ms_')) continue;
    const path = tablePushPath(table);
    if (!path) continue;
    try {
      let body: Record<string, unknown> = {};
      try {
        body = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
      } catch {
        body = {};
      }
      const res = await apiPost(
        path,
        { ...body, table, rowId: row.orderID, op: row.op, clientId: row.id },
        { idempotencyKey: row.id },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try {
        await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [row.id]);
      } catch {
        /* abaikan */
      }
      sent += 1;
      try {
        await setWatermark(table, { push: new Date().toISOString() });
      } catch {
        /* abaikan */
      }
    } catch {
      try {
        await run("UPDATE tr_esoprocessqueue SET status = 'gagal' WHERE id = ?", [row.id]);
      } catch {
        /* abaikan */
      }
      failed += 1;
    }
  }
  return { sent, failed };
}

export async function pushAll(): Promise<PushResult> {
  hydrate();
  if (getServerEnv() !== 'custom') {
    throw new Error('Pilih Server Custom (milik sendiri) di Pengaturan sebelum sync.');
  }
  let sent = 0;
  let failed = 0;
  // Kuras outbox fisik dulu (offline-first: gagal DB/jaringan per baris).
  try {
    const drained = await drainPhysicalQueue();
    sent += drained.sent;
    failed += drained.failed;
    if (drained.sent > 0) {
      lastSyncMs = Date.now();
      lastSync = new Date().toLocaleString('id-ID');
    }
  } catch {
    /* abaikan - antrean ringan di bawah tetap jalan */
  }
  // Prioritas kind: "other" (shift-open/shift-close) DULU, lalu "order",
  // lalu receipt/attendance. FIFO terjaga di dalam tiap grup.
  const next = [...outbox];
  const rank = (k: SyncKind): number => (k === 'other' ? 0 : k === 'order' ? 1 : 2);
  const queue = next
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.status !== 'terkirim')
    .sort((a, b) => rank(a.item.kind) - rank(b.item.kind) || a.idx - b.idx)
    .map(({ item }) => item);
  for (const item of queue) {
    // Perubahan master lokal (ms_*) tidak punya endpoint push di kontrak §5:
    // lewati agar tidak terkirim ke order/finish; baris tetap kotor
    // (syncDate NULL) + tercatat di tr_esoprocessqueue.
    const itemTable = String((item.payload as { table?: unknown })?.table ?? '');
    if (itemTable.startsWith('ms_')) {
      item.note = tr('sync.masterQueued');
      continue;
    }
    // kind "other" tanpa endpoint yang cocok (mis. booking lokal) dilewati
    // agar tidak terkirim ke endpoint salah; tetap antre + tercatat fisik.
    const path = pathFor(item.kind, item.payload);
    if (!path) {
      item.note = tr('sync.masterQueued');
      continue;
    }
    try {
      const res = await apiPost(path, { ...item.payload, clientId: item.id }, { idempotencyKey: item.id });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      item.status = 'terkirim';
      item.note = '';
      sent += 1;
      const nowIso = new Date().toISOString();
      lastSyncMs = Date.now();
      lastSync = new Date().toLocaleString('id-ID');
      try {
        await setWatermark(itemTable || item.kind, { push: nowIso });
      } catch {
        /* abaikan */
      }
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
 * Tidak pernah melempar - kasir tidak boleh diblokir antrean.
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
    /* DB belum init - antrean ringan di bawah tetap jalan */
  }
  try {
    await markDirty(table, rowId);
  } catch {
    /* abaikan */
  }
  // Tabel master tidak masuk antrean ringan: kontrak §5 tidak punya endpoint
  // push master sehingga pengiriman ke order/finish adalah endpoint salah
  // (M9-3). Perubahan tetap tersimpan lokal (syncDate NULL + outbox fisik).
  if (table.startsWith('ms_')) return;
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
    /* DB belum init - pemanggil boleh coba lagi nanti */
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
