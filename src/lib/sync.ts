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
import { ApiPath, apiPost, getServerEnv, getTerminal } from '../config/server';
import { all, markClean, markDirty, queryFirst, run } from './db';
import { tr } from './i18n';
import { getItem, setItem } from './storage';
import { uuidv7 } from './uuidv7';

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

/** M13: janji restore boot. pushAll menunggu ini sebelum drain (re-drive)
 * agar item tersimpan tak terlewat balapan-hydrasi. */
let restorePromise: Promise<void> | null = null;

/**
 * Bersihkan SELURUH baris satu sale (head + kaki) saat payload ringannya
 * terbukti sampai ke server (2xx) atau server mengaku sudah punya (409).
 * Tanpa ini hanya tr_saleshead yang bersih (markClean di bawah) sedangkan
 * menu/extra/payment/voucherusage/info/platformfee/kitchen tetap
 * syncDate NULL selamanya → badge dirty SyncScreen tumbuh tanpa batas
 * (+8..15/sale) walau server sudah lengkap. Payload ringan memang membawa
 * semua data itu (buildSalePayload: items, payments, voucherCode,
 * approvedBy, ongkirCut, platformFee), jadi aman dibersihkan sekaligus.
 * Baris yang berubah SESUDAH push (advance dapur, void, leg grup baru)
 * mengotori dirinya sendiri lagi via syncDate=NULL + enqueue jalurnya
 * masing-masing, jadi tak ikut tersapu.
 */
const SALE_CLEAN_TABLES = [
  'tr_saleshead',
  'tr_salesmenu',
  'tr_salesmenuextra',
  'tr_salespayment',
  'tr_salesvoucherusage',
  'tr_salesinfo',
  'tr_platformfee',
  'tr_kitchenticket',
] as const;

async function markCleanSale(salesNum: string): Promise<void> {
  const no = String(salesNum ?? '').trim();
  if (!no) return;
  const stamp = new Date().toISOString();
  for (const t of SALE_CLEAN_TABLES) {
    try {
      // Nama tabel dari daftar statis (bukan input user) — aman.
      await run(`UPDATE "${t}" SET syncDate = ? WHERE salesNum = ? AND syncDate IS NULL`, [stamp, no]);
    } catch {
      /* tabel/kolom belum ada di instalasi lama — abaikan */
    }
  }
}

function restore(): void {
  if (restorePromise) return;
  restorePromise = (async () => {
    try {
      const raw = await getItem(LS_OUTBOX);
      if (raw) {
        try {
          mergeStored(JSON.parse(raw) as SyncItem[]);
        } catch {
          /* abaikan - pakai memori */
        }
      }
    } catch {
      /* storage gagal - pakai memori */
    }
    try {
      const v = await getItem(LS_LAST);
      if (v && !lastSync) lastSync = v;
    } catch {
      /* abaikan */
    }
    try {
      const v = await getItem(LS_LAST_MS);
      const n = Number(v);
      if (v && !lastSyncMs && Number.isFinite(n)) lastSyncMs = n;
    } catch {
      /* abaikan */
    }
  })();
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
    // Shift punya endpoint sendiri (dummy push/v1-push-shift sudah ada):
    // JANGAN dilempar ke pushOrderFinish (endpoint salah).
    const op = String(payload?.op ?? '');
    if (op === 'shift-open') return ApiPath.pushShiftOpen;
    if (op === 'shift-close') return ApiPath.pushShiftClose;
    if (op === 'move-items') return ApiPath.moveItems;
    if (op === 'move-table') return ApiPath.moveTable;
    // REA-FIX-A: op push baru (kontrak §5.2/§5.3/§5.6).
    if (op === 'voucher-online-claim') return ApiPath.voucherOnlineClaim;
    if (op === 'voucher-online-validate') return ApiPath.voucherOnlineValidate;
    if (op === 'external-voucher-burn') return ApiPath.extVoucherBurn;
    if (op === 'external-voucher-unburn') return ApiPath.extVoucherUnburn;
    if (op === 'external-voucher-validate') return ApiPath.extVoucherValidate;
    if (op === 'order-error-log') return ApiPath.orderErrorLog;
    if (op === 'delivery-push') return ApiPath.deliveryPushData;
    if (op === 'terminal-verify') return ApiPath.terminalVerifyNotify;
    // Future-proof: varian order tambahan (kontrak §5 / ApiPath). Belum ada
    // producer enqueueSync untuk op-op ini — routing disiapkan agar tak jatuh
    // ke endpoint salah bila kelak dipakai. Murni aditif, tanpa ubah op lama.
    if (op === 'split-bill') return ApiPath.splitBill;
    if (op === 'view') return ApiPath.pushOrderView;
    if (op === 'view-by-qr') return ApiPath.orderViewByQr;
    if (op === 'view-quick-service') return ApiPath.orderViewQuickService;
    // Reserved: no producer yet.
    if (op === 'voucher-template-claim') return ApiPath.voucherTemplateClaim;
    // Deposit / voucher memakai field `kind` di payload (bukan `op`).
    const k = String(payload?.kind ?? '');
    if (k === 'deposit-topup' || k === 'member-deposit') return ApiPath.depositTopup;
    // GAP-FIX: member-register offline (MemberScreen) sebelumnya jatuh ke null
    // dan tak pernah terkirim.
    if (k === 'member-register') return ApiPath.registerMember;
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
    // UUIDv7 (Q7): id antrean = idempotency key retry-aman lintas-device.
    id: uuidv7(),
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
 * Identitas pengirim Q7 (§12 SPEC): setiap body push membawa `client_id` +
 * `uuid` (keduanya = id baris UUIDv7: time-ordered, unik lintas-device),
 * `branchId`, dan `terminalCode` dari klaim terminal aktif. Kunci camelCase
 * `clientId` dipertahankan apa adanya (kontrak lama) — field baru ADITIF,
 * path endpoint tidak berubah.
 */
function identityFields(clientId: string): Record<string, string> {
  let branchId = '';
  let terminalCode = '';
  try {
    const t = getTerminal();
    branchId = t.branchId ?? '';
    terminalCode = t.terminalCode ?? '';
  } catch {
    /* klaim belum ada — kirim kosong, jangan blokir antrean */
  }
  return { client_id: clientId, branchId, terminalCode, uuid: clientId };
}

/**
 * SATU-SATUNYA pengecualian FIFO yang diizinkan (temuan
 * offline-kind-rank-breaks-fifo): baris shift-open boleh dikuras duluan
 * HANYA bila server mensyaratkan shift terbuka sebelum menerima push lain.
 * Kontrak BE E01–E28 belum ada sehingga syarat itu belum diketahui —
 * pengecualian MATI (false) dan drain murni FIFO createdAt ASC. Jangan tambah
 * pengecualian kind lain tanpa kontrak BE tertulis.
 */
const SHIFT_OPEN_FIRST_IF_SERVER_REQUIRES = false;

function isShiftOpenRow(row: PhysicalQueueRow): boolean {
  return (
    (row.tableName === 'tr_shiftlog' || row.tableName === 'tr_shiftlogdetail') &&
    row.op === 'insert'
  );
}

function isShiftOpenItem(item: SyncItem): boolean {
  return String((item.payload as { op?: unknown } | null)?.op ?? '') === 'shift-open';
}

/** Ambil baris antrean fisik yang belum terkirim, createdAt ASC. */
async function fetchPhysicalRows(): Promise<PhysicalQueueRow[]> {
  try {
    return await all<PhysicalQueueRow>(
      `SELECT id, orderID, serverID, tableName, op, payload, status, createdAt
       FROM tr_esoprocessqueue WHERE status IN ('antre', 'gagal')
       ORDER BY createdAt ASC LIMIT 200`,
    );
  } catch {
    return [];
  }
}

/**
 * Dorong satu baris fisik via tablePushPath (path endpoint tidak berubah).
 * 'sent' = DELETE + watermark; 'failed' = tandai 'gagal'; 'skipped' = master
 * (ms_*, server-wins §4/M9-3) atau tanpa endpoint push — biarkan antre lokal,
 * jangan hitung gagal.
 */
async function pushPhysicalRow(row: PhysicalQueueRow): Promise<'sent' | 'failed' | 'skipped'> {
  const table = String(row.tableName ?? '');
  // Master (ms_*) tidak punya endpoint push (§5/M9-3): biarkan antre lokal.
  if (!table || table.startsWith('ms_')) return 'skipped';
  const path = tablePushPath(table);
  if (!path) return 'skipped';
  try {
    let body: Record<string, unknown> = {};
    try {
      body = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    const res = await apiPost(
      path,
      { ...body, table, rowId: row.orderID, op: row.op, clientId: row.id, ...identityFields(row.id) },
      { idempotencyKey: row.id },
    );
    if (res.status === 409) {
      // BE menegakkan UNIQUE(client_id): 409 = server SUDAH punya baris ini
      // (timeout sesudah commit / kirim-ganda / enqueue ganda). Anggap
      // terkirim (duplicate-acked) agar tak antre-selamanya + watermark jalan.
      try {
        await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [row.id]);
      } catch {
        /* abaikan */
      }
      try {
        await markClean(table, String(row.orderID ?? ''));
      } catch {
        /* abaikan */
      }
      try {
        await setWatermark(table, { push: new Date().toISOString() });
      } catch {
        /* abaikan */
      }
      return 'sent';
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try {
      await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [row.id]);
    } catch {
      /* abaikan */
    }
    // Baris sumber ikut bersih (syncDate) agar badge dirty tak menumpuk
    // selamanya; tanpa ini antrean terkuras tapi semua baris tetap "kotor".
    try {
      await markClean(table, String(row.orderID ?? ''));
    } catch {
      /* abaikan */
    }
    try {
      await setWatermark(table, { push: new Date().toISOString() });
    } catch {
      /* abaikan */
    }
    return 'sent';
  } catch {
    try {
      await run("UPDATE tr_esoprocessqueue SET status = 'gagal' WHERE id = ?", [row.id]);
    } catch {
      /* abaikan */
    }
    return 'failed';
  }
}

// Operasi cermin-lokal tanpa endpoint push di kontrak §5 (status meja di
// ms_table + data booking di AsyncStorage): tak ada yang perlu dikirim —
// tandai terkirim-lokal agar badge antrean tak menumpuk selamanya. Mutasi
// DB-nya tetap kotor (syncDate NULL) + tercatat di outbox fisik.
const LOCAL_OPS = new Set([
  'table-occupy',
  'table-clear',
  'merge-table',
  'order-hold-toggle',
  'table-add',
  'table-delete',
  'booking-create',
  'booking-update',
  'booking-cancel',
]);

// Kind deposit tanpa endpoint khusus (kontrak hanya punya
// member-deposit-withdrawal/topup + inquiry-deposit): baris mutasi
// tr_memberdeposit-nya tetap terkirim via outbox fisik (jalur tabel generik),
// sehingga item ringan ini cukup ditandai terkirim-lokal. JANGAN arahkan ke
// endpoint topup — semantiknya berbalik (kredit vs debit).
const DEPOSIT_LOCAL_KINDS = new Set(['deposit-refund', 'deposit-withdraw']);

export async function pushAll(): Promise<PushResult> {
  hydrate();
  if (getServerEnv() !== 'custom') {
    throw new Error('Pilih Server Custom (milik sendiri) di Pengaturan sebelum sync.');
  }
  // M13 re-drive kepala-kotor: tunggu restore boot selesai sebelum drain.
  // Tanpa ini pushAll pertama setelah boot bisa menguras SEBELUM item
  // tersimpan masuk memori (balapan-hydrasi) → badge antrean bohong.
  // Jendela rugi SISA (terdokumentasi, bukan ditutup): crash tepat di antara
  // enqueueSync (memori) dan tulis AsyncStorage persist() = item ringan itu
  // hilang; baris fisik + flag kotor DB (syncDate NULL) tetap selamat karena
  // ditulis sinkron via SQLite. persist() tetap fire-and-forget karena
  // pemanggilnya sinkron (initializer useState layar).
  if (restorePromise) {
    try {
      await restorePromise;
    } catch {
      /* restore best-effort - drain memori tetap jalan */
    }
  }
  let sent = 0;
  let failed = 0;
  const touchSuccess = (): void => {
    lastSyncMs = Date.now();
    lastSync = new Date().toLocaleString('id-ID');
  };
  // Drain GABUNGAN (temuan offline-kind-rank-breaks-fifo + causal FIFO per
  // bill): antrean fisik DAN ringan dikuras dalam SATU urutan strict by
  // createdAt ASC — sale selalu sebelum void/pay-change/move-nya walau keduanya
  // tercatat di antrean berbeda. Pengurutan ulang by kind ("other" dulu)
  // DIHAPUS; satu-satunya pengecualian adalah shift-open dan itu pun hanya
  // bila SHIFT_OPEN_FIRST_IF_SERVER_REQUIRES hidup (mati saat ini).
  // Baris gagal TIDAK menghentikan drain (offline-first): ditandai 'gagal',
  // dilewati, dicoba lagi di push berikutnya.
  const rows = await fetchPhysicalRows();
  const next = [...outbox];
  const light = next
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.status !== 'terkirim');
  interface DrainEntry {
    createdAt: string;
    shiftOpen: boolean;
    physicalFirst: number;
    seq: number;
    row?: PhysicalQueueRow;
    item?: SyncItem;
  }
  const entries: DrainEntry[] = [
    ...rows.map((row, seq): DrainEntry => ({
      createdAt: String(row.createdAt ?? ''),
      shiftOpen: isShiftOpenRow(row),
      physicalFirst: 0,
      seq,
      row,
    })),
    ...light.map(({ item, idx }): DrainEntry => ({
      createdAt: String(item.createdAt ?? ''),
      shiftOpen: isShiftOpenItem(item),
      physicalFirst: 1,
      seq: idx,
      item,
    })),
  ];
  entries.sort((a, b) => {
    if (SHIFT_OPEN_FIRST_IF_SERVER_REQUIRES && a.shiftOpen !== b.shiftOpen) {
      return a.shiftOpen ? -1 : 1;
    }
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    // createdAt seri (resolusi ms): baris fisik dulu — produsen selalu
    // mencatat fisik sebelum cermin ringannya (history.ts/sales.ts).
    if (a.physicalFirst !== b.physicalFirst) return a.physicalFirst - b.physicalFirst;
    return a.seq - b.seq;
  });
  for (const e of entries) {
    if (e.row) {
      const outcome = await pushPhysicalRow(e.row);
      if (outcome === 'sent') {
        sent += 1;
        touchSuccess();
      } else if (outcome === 'failed') {
        failed += 1;
      } else if (String(e.row.tableName ?? '').startsWith('ms_')) {
        // Cermin master (server-wins §5/M9-3, tanpa endpoint push): hapus dari
        // antrean fisik agar tak menumpuk selamanya, menggelembungkan badge
        // Sync, dan menutupi baris tr_* di balik jendela LIMIT 200 (starvasi
        // drain permanen — baris skip tak pernah keluar jendela). Mutasi DB-nya
        // tetap kotor (syncDate NULL) + pull server tetap menang via REPLACE.
        // Tabel non-ms_ tanpa endpoint dibiarkan antre (kontrak BE menyusul).
        try {
          await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [e.row.id]);
        } catch {
          /* abaikan */
        }
      }
      continue;
    }
    if (!e.item) continue;
    const outcome = await pushLightItem(e.item);
    if (outcome === 'sent') {
      sent += 1;
      touchSuccess();
    } else if (outcome === 'failed') {
      failed += 1;
    }
  }
  outbox = next;
  persist();
  return { sent, failed };
}

/**
 * Dorong satu item ringan (path endpoint tidak berubah). 'sent'/'failed'
 * dihitung pushAll; 'skipped' = master-menunggu-endpoint atau cermin lokal
 * (LOCAL_OPS/deposit-lokal → tandai terkirim, bukan antre selamanya).
 */
async function pushLightItem(item: SyncItem): Promise<'sent' | 'failed' | 'skipped'> {
  // Perubahan master lokal (ms_*) tidak punya endpoint push di kontrak §5:
  // lewati agar tidak terkirim ke order/finish; baris tetap kotor
  // (syncDate NULL) + tercatat di tr_esoprocessqueue.
  const itemTable = String((item.payload as { table?: unknown })?.table ?? '');
  if (itemTable.startsWith('ms_')) {
    item.note = tr('sync.masterQueued');
    return 'skipped';
  }
  // kind "other" tanpa endpoint yang cocok: bedakan cermin-lokal /
  // deposit-lokal (tandai terkirim, bukan antre selamanya) dari yang
  // benar-benar menunggu endpoint (tetap antre + tercatat fisik).
  const path = pathFor(item.kind, item.payload);
  if (!path) {
    const p = (item.payload ?? {}) as { op?: unknown; kind?: unknown };
    const op = String(p.op ?? '');
    const k = String(p.kind ?? '');
    if (LOCAL_OPS.has(op) || DEPOSIT_LOCAL_KINDS.has(k)) {
      item.status = 'terkirim';
      item.note = tr(op ? 'sync.localOnly' : 'sync.depositLocal');
      return 'skipped';
    }
    item.note = tr('sync.masterQueued');
    return 'skipped';
  }
  try {
    // C1: client_id sale JANGAN PERNAH ditimpa id antrean. buildSalePayload
    // (payments.ts) membawa kunci upsert server (clientId/client_id UUIDv7
    // rantai Pay→Qris/Edc); menimpanya dengan id outbox memutus rekonsiliasi
    // + membuat retry melahirkan sale ganda di server. Hanya isi bila payload
    // belum punya; id antrean dibawa terpisah sebagai outboxId (idempotency
    // key header tetap = item.id, tak berubah).
    const rawPayload = (item.payload ?? {}) as Record<string, unknown>;
    const saleCid = String(rawPayload.client_id ?? rawPayload.clientId ?? '').trim();
    const sender = identityFields(saleCid || item.id);
    const body: Record<string, unknown> = saleCid
      // Touchup: normalisasi kunci campuran — BOTH clientId + client_id = saleCid
      // (uuid = saleCid tetap) agar server/campur-casing baca kunci yang sama.
      ? { ...rawPayload, ...sender, clientId: saleCid, client_id: saleCid, uuid: saleCid, outboxId: item.id }
      : { ...rawPayload, clientId: item.id, ...sender, outboxId: item.id };
    const res = await apiPost(
      path,
      body,
      { idempotencyKey: item.id },
    );
    if (res.status === 409) {
      // 409 = server SUDAH punya item ini (UNIQUE client_id). Anggap terkirim
      // (duplicate-acked, terlihat di note) agar tak antre-selamanya.
      item.status = 'terkirim';
      item.note = tr('sync.duplicateAcked');
      try {
        // Server punya datanya → kaki sale ikut bersih (paritas 2xx).
        const p = (item.payload ?? {}) as { op?: unknown; salesNum?: unknown };
        const sNo = String(p.salesNum ?? '').trim();
        if (sNo && (item.kind === 'order' || String(p.op ?? '') === 'group-payment')) {
          await markCleanSale(sNo);
        }
      } catch {
        /* abaikan */
      }
      try {
        await setWatermark(itemTable || item.kind, { push: new Date().toISOString() });
      } catch {
        /* abaikan */
      }
      return 'sent';
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Sukses 2xx = tandai terkirim agar tak dikirim ulang tiap pushAll
    // (sebelumnya hanya 409 yang menandai → kirim-ganda ke server).
    item.status = 'terkirim';
    item.note = '';
    // Head sale ikut bersih bila payload-nya audited order/group-payment;
    // kaki fisik (bila ada) dibersihkan jalurnya sendiri per baris.
    try {
      const p = (item.payload ?? {}) as { op?: unknown; salesNum?: unknown };
      const sNo = String(p.salesNum ?? '').trim();
      if (sNo && (item.kind === 'order' || String(p.op ?? '') === 'group-payment')) {
        // Seluruh kaki sale (bukan cuma head) — lihat markCleanSale.
        await markCleanSale(sNo);
      }
    } catch {
      /* abaikan */
    }
    try {
      await setWatermark(itemTable || item.kind, { push: new Date().toISOString() });
    } catch {
      /* abaikan */
    }
    return 'sent';
  } catch (e) {
    item.status = 'gagal';
    item.note = e instanceof Error ? e.message : 'Gagal mengirim';
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Backlog gabungan untuk SyncScreen (temuan offline-ms-edits-stuck-invisible):
// kasir harus melihat BOTH antrean ringan + fisik/dirty, bukan satu saja.
// ---------------------------------------------------------------------------

/** Jumlah baris antrean fisik `tr_esoprocessqueue` yang belum terkirim. */
export async function countPhysicalQueue(): Promise<number> {
  try {
    const row = await queryFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tr_esoprocessqueue WHERE status IN ('antre', 'gagal')`,
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Total baris kotor (syncDate NULL) di semua tabel lokal. Dihitung dinamis
 * dari sqlite_master agar tabel baru otomatis ikut tanpa daftar statis;
 * nama tabel divalidasi pola identifier (anti-injeksi).
 */
export async function countDirtyRows(): Promise<number> {
  try {
    const tables = await all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%syncDate%'`,
    );
    let total = 0;
    for (const t of tables) {
      const name = String(t.name ?? '');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      try {
        const row = await queryFirst<{ n: number }>(
          `SELECT COUNT(*) AS n FROM "${name}" WHERE syncDate IS NULL`,
        );
        total += row?.n ?? 0;
      } catch {
        /* kolom tak cocok — lewati */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Logout offline (flow O1 §7 SPEC): revoke server-side (E06) tak terjangkau
 * saat offline → sessionId ditandai pendingRevoke dan dicoba lagi saat
 * online. E06 BELUM ADA di BE sehingga flush jaringan belum
 * diimplementasikan: daftar ini persisten (hanya dihapus saat revoke
 * sukses) dan SyncScreen menampilkannya sebagai indikator jujur
 * "needs BE / mode lokal", bukan bypass diam-diam.
 */
const LS_REVOKE = 'genfity.sync.pendingRevoke';

export async function getPendingRevoke(): Promise<string[]> {
  try {
    const raw = await getItem(LS_REVOKE);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function markPendingRevoke(sessionId: string): Promise<void> {
  const id = String(sessionId ?? '').trim();
  if (!id) return;
  try {
    const cur = await getPendingRevoke();
    if (!cur.includes(id)) {
      cur.push(id);
      await setItem(LS_REVOKE, JSON.stringify(cur));
    }
  } catch {
    /* storage gagal — pemanggil (logout) tetap lanjut offline */
  }
}

export async function clearPendingRevoke(sessionId?: string): Promise<void> {
  try {
    if (sessionId === undefined) {
      await setItem(LS_REVOKE, JSON.stringify([]));
      return;
    }
    const cur = (await getPendingRevoke()).filter((s) => s !== sessionId);
    await setItem(LS_REVOKE, JSON.stringify(cur));
  } catch {
    /* abaikan */
  }
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
/**
 * Inti fisik outbox (#22): baris `tr_esoprocessqueue` + tandai kotor — tanpa
 * menyentuh AsyncStorage. Dipakai di dalam transaksi SQLite agar baris outbox
 * ikut rollback bila tulis gagal total; pemanggil mem-flush antrean ringan
 * secara terpisah setelah COMMIT.
 */
export async function enqueueOutboxPhysical(
  table: string,
  rowId: string,
  op: OutboxOp,
): Promise<void> {
  try {
    await run(
      `INSERT INTO tr_esoprocessqueue (id, orderID, serverID, tableName, op, payload, status, createdAt)
       VALUES (?, ?, '', ?, ?, ?, 'antre', ?)`,
      [
        // UUIDv7 (Q7): id fisik = clientId + Idempotency-Key saat drain.
        uuidv7(),
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
}

export async function enqueueOutbox(
  table: string,
  rowId: string,
  op: OutboxOp,
): Promise<void> {
  hydrate();
  await enqueueOutboxPhysical(table, rowId, op);
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

/**
 * Level umur sync dari timestamp sukses terakhir (kontrak §2/§10.4):
 * 'ok' | 'warn3' (>3 hari, E00043) | 'block7' (>7 hari/tak diketahui, E00044).
 * Dipakai SyncScreen (banner) + gate kasir/Pay (blokir transaksi).
 */
export function syncWarnLevel(lastMs?: number): 'ok' | 'warn3' | 'block7' {
  hydrate();
  const ms =
    typeof lastMs === 'number' && lastMs > 0
      ? lastMs
      : lastSyncMs || Date.parse(lastSync);
  if (!Number.isFinite(ms) || ms <= 0) return 'block7';
  const age = Date.now() - ms;
  if (age > FORCE_SYNC_DAYS * 24 * 3600 * 1000) return 'block7';
  if (age > WARN_SYNC_DAYS * 24 * 3600 * 1000) return 'warn3';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Sinkronisasi otomatis (toggle di SyncScreen - sebelumnya toggle hanya
// tersimpan tanpa efek). Interval 5 menit, diam-diam: pushAll() + menelan
// galat (bukan Custom env / offline = lewati). wifiOnly = cek tipe jaringan
// via expo-network bila tersedia.
// ---------------------------------------------------------------------------

let autoTimer: ReturnType<typeof setInterval> | null = null;

async function wifiOk(wifiOnly: boolean): Promise<boolean> {
  if (!wifiOnly) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Net = require('expo-network') as {
      getNetworkStateAsync?: () => Promise<{ type?: string; isConnected?: boolean }>;
    };
    if (!Net?.getNetworkStateAsync) return true;
    const st = await Net.getNetworkStateAsync();
    if (st.isConnected === false) return false;
    const t = String(st.type ?? '').toUpperCase();
    // UNKNOWN = tak bisa diklasifikasi (mis. web) → izinkan, bukan blokir.
    if (!t || t === 'UNKNOWN' || t === 'NONE') return t !== 'NONE';
    return t === 'WIFI' || t === 'ETHERNET';
  } catch {
    return true;
  }
}

/**
 * Terapkan preferensi sync otomatis dari SyncScreen. Panggil tiap toggle
 * berubah (dan sekali saat layar dibuka). Idempoten: timer lama dibersihkan.
 */
export function applyAutoSyncPrefs(opts: { auto: boolean; wifiOnly: boolean }): void {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  if (!opts.auto) return;
  const wifiOnly = opts.wifiOnly;
  autoTimer = setInterval(() => {
    void (async () => {
      try {
        if (getServerEnv() !== 'custom') return;
        if (!(await wifiOk(wifiOnly))) return;
        // Tanpa gate pendingCount: antrean fisik (tr_esoprocessqueue) hanya
        // terlihat di dalam pushAll, bukan di outbox ringan.
        await pushAll();
      } catch {
        /* diam: coba lagi interval berikut */
      }
    })();
  }, 5 * 60 * 1000);
}
