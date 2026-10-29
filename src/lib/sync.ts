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
import { ApiPath, apiPost, apiPut, getCustomBaseUrl, getServerEnv, getTerminal } from '../config/server';
import { apiFetch } from './apiSource';
import { all, initDb, markClean, markDirty, queryFirst, run } from './db';
import { getLang, tr } from './i18n';
import { fmtDateInTz, fmtTimeInTz } from './datefmt';
import { getCachedMerchantType, getCachedVerticalId, normalizeMerchantType } from './posModes';
import { VERTICALS } from './verticals';
import { notifyPushSyncSuccess } from './push';
import { nextSalesNumRetry } from './salesNum';
import { getItem, setItem, getJSON } from './storage';
import { logoutRevoke } from './terminalApi';
// HP-E2E (2026-10-26): drain expense via handoff terminal (terminalExpense
// TAK mengimpor sync — arah impor satu arah, tanpa siklus).
import { boundTerminalId, isRemotePhoto, postExpenseToTerminal } from './terminalExpense';
import { uuidv7 } from './uuidv7';
import {
  ALLOWED_BE_TRANSITIONS,
  GO_OP_CANCEL,
  GO_OP_REFUND,
  GO_OP_RESV_CANCEL,
  GO_OP_MOVE_TABLE,
  GO_OP_SETTLE,
  GO_OP_STATUS,
  GO_OP_VOID,
  beErrorOf,
  isReplaySuccess,
  mapPayMethodToBe,
  type BePayMethod,
} from './posWire';
// W1 (SESI-FIX-APPW1): nama op + helper sesi-kas satu sumber di beWorkforce
// (arah impor sync -> beWorkforce, cermin posWire; beWorkforce TAK mengimpor
// sync agar tak ada siklus). Hanya INSERT di file ini — baris W2 tak diubah.
import {
  W1_OP_CASH_APPROVE,
  W1_OP_CASH_CLOSE,
  W1_OP_CASH_MOVE,
  W1_OP_CASH_OPEN,
  W1_OP_CLOCK_IN,
  W1_OP_CLOCK_OUT,
  W1_OP_EOD_CLOSE,
  clearCashSessionId,
  getCashSessionId,
  isServerSessionId,
  recordPendingCashClose,
  setCashSessionId,
} from './beWorkforce';
import {
  clearPendingRevoke as clearSessionPendingRevoke,
  getPendingRevoke as getSessionPendingRevoke,
  getSession as getCurrentSession,
} from '../session';

export type SyncStatus = 'antre' | 'terkirim' | 'gagal';
export type SyncKind = 'order' | 'receipt' | 'attendance' | 'other';

export interface SyncItem {
  id: string;
  kind: SyncKind;
  payload: Record<string, unknown>;
  createdAt: string;
  status: SyncStatus;
  note?: string;
  /** S21: true = cermin-lokal (LOCAL_OPS/deposit-lokal), tanpa POST server. */
  local?: boolean;
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

/**
 * Catat kontak server yang BERHASIL di luar jalur drain (mis. W1 immediate
 * clock-in/cash-open/clock-out/cash-close dari layar shift) sebagai bukti
 * kontak terakhir. Tanpa ini gate E00044 (syncWarnLevel dari module
 * lastSyncMs, yang hanya ditulis touchSuccess di dalam pushAll) tak bisa
 * bersih walau W1 immediate sukses — padahal server SUDAH dihubungi dan
 * baris shift/sesi kas SUDAH tercatat di sana.
 * HP-E2E-FIX-2 (2026-10-24): dipanggil dari ShiftScreen/EndShiftScreen,
 * bukan dari beWorkforce.ts (arah impor satu-arah sync→beWorkforce dijaga).
 */
export function noteServerContact(): void {
  lastSyncMs = Date.now();
  const d = new Date(lastSyncMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  lastSync =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  persist();
}

/** M13: janji restore boot. pushAll menunggu ini sebelum drain (re-drive)
 * agar item tersimpan tak terlewat balapan-hydrasi. */
let restorePromise: Promise<void> | null = null;

/**
 * Bersihkan SELURUH baris satu sale (head + kaki) saat payload ringannya
 * terbukti sampai ke server (2xx — termasuk 200 "Order already synced" untuk
 * retry client_id duplikat) atau server mengaku sudah punya baris kita
 * (duplicate-ack setelah klasifikasi 409, bukan 409 mentah).
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
 * Endpoint push per tabel. Tabel master (ms_*) local-only (M9-3): backend Go
 * tak punya endpoint push master generik dan pull master server-wins —
 * sehingga dikembalikan null dan tidak dikirim ke order/finish. (Kecuali
 * ms_branchmenu/ms_branchaddon: Opsi A memberi endpoint push terminal khusus
 * (ApiPath.pushBranchMenu) yang dikuras via pushBranchMenuPhysicalRow —
 * BUKAN via tablePushPath ini, karena butuh substitusi {id} terminal + baca
 * qty/ambang LIVE. Pull tetap server-wins sehingga dapat menimpa edit lokal.)
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
    // S3: pin-change = LOCAL_OP tanpa POST server (difinalkan di pushLightItem).
    if (t === 'pin-change') return null;
    if (t === 'clock-out') return ApiPath.clockOut;
    return ApiPath.clockIn;
  }
  if (kind === 'other') {
    // W1 (SESI-FIX-APPW1): op be-* SENGAJA jatuh ke null di sini — bukan
    // endpoint salah, melainkan dikuras drain-time oleh goWorkforceOp di bawah
    // (substitusi {sessionId} dari id sesi server tersimpan + replay-code W1
    // sendiri). Namespace 'be-' dijamin tak tabrakan op W2/ESB (beWorkforce).
    const opW1 = String(payload?.op ?? '');
    if (opW1 === W1_OP_CLOCK_IN || opW1 === W1_OP_CLOCK_OUT || opW1 === W1_OP_CASH_OPEN || opW1 === W1_OP_CASH_MOVE || opW1 === W1_OP_CASH_CLOSE || opW1 === W1_OP_EOD_CLOSE) return null;
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

// M9-3 (diputuskan, SEBAGIAN tertutup Opsi A): endpoint push master (sold-out
// / station) TIDAK didefinisikan — backend Go tak punya domain master
// (tanpa tabel menu di schema.sql) sehingga kontrak push-master butuh
// proyek lintas-repo tersendiri, bukan tambahan path di sini. Sebagai ganti:
// edit master = local-only jujur (status 'lokal' + kartu SyncScreen +
// master.localOnlyNote di layar penyunting). PENGECUALIAN Opsi A:
// ms_branchmenu + ms_branchaddon kini PUNYA endpoint (POST
// api/v1/terminals/{id}/branch-menu, BE TerminalBranchMenuUpdate, type
// menu|addon) — dikuras via pushBranchMenuPhysicalRow.
// Antrean RINGAN (light twin via pathFor/tablePushPath) tetap mati untuk
// SEMUA ms_* termasuk keduanya (butuh substitusi {id} + live-read yang
// hanya ada di drain fisik); yang aktif = antrean FISIK keduanya.

// ---------------------------------------------------------------------------
// GO-POS COMPAT (wire-app): backend Go TIDAK melayani path bentuk-ESB
// (order/finish, order/view, split-bill, move-items, posv1/..., v1/push/...,
// sales/receipt-email). Yang dilayani: POST api/merchant/orders/pos
// (create; orderType + items WAJIB — orders_pos_create.go:196-203) dan
// POST api/merchant/orders/{orderId}/group-bill/payments (router.go:335;
// butuh orderId server + shareId peserta). Ops sale-create diterjemahkan di
// sini menjadi body bentuk-POS; ops TANPA padanan backend tetap memakai path
// ESB (komentar eksplisit per-op di toGoPosRequest + daftar di laporan) —
// server menjawab 404 jujur → 'gagal' + retry, bukan sukses diam-diam.
// Kompat ini HANYA path + body; EXPO_PUBLIC_API_BASE_URL tak disentuh.
// Baris fisik (pushPhysicalRow) tetap ESB: payload-nya {table,rowId,op}
// tanpa bentuk sale sehingga tak bisa diterjemahkan (dilaporkan).
// ---------------------------------------------------------------------------

/** Path create POS Go (relatif; digabung ke custom base oleh apiUrl). */
const GO_POS_CREATE_PATH = 'api/merchant/orders/pos';

/**
 * Sentinel internal: mode kasir tak punya padanan orderType untuk merchant-type
 * aktif (backend Go pasti menolak). TAK PERNAH dikirim ke BE; pemanggil wajib
 * mem-BLOCKED jujur (fail-once + catatan, pola S10).
 */
export const UNSUPPORTED_ORDER_TYPE = 'UNSUPPORTED';

/**
 * Petakan mode kasir → enum orderType Go yang ketat, SADAR merchant-type
 * (C2 Sesi-C QA3; cermin validasi orders_pos_create.go:196 + gerbang
 * per-tipe :223-237). merchantType tak diisi = cache sesi (tak-dikenal =
 * default RESTAURANT, ASUMSI koordinator — perilaku lama lestari).
 * - RESTAURANT: DINE_IN→DINE_IN; TAKEAWAY/TAKE_AWAY→TAKEAWAY;
 *   DELIVERY/agregator→TAKEAWAY UNCONDITIONAL (proksi legacy: ongkir tetap
 *   tercatat terpisah di payload — perilaku pra-C2 persis, milik 550361a).
 *   KOREKSI-FLAG (owner 21-Okt, offer-time only): gate flag delivery ada di
 *   DAFTAR UI (kasir sembunyikan kanal delivery bila OFF), BUKAN di sini —
 *   sync buta-flag agar pesanan lama tetap mengalir walau flag mati belakangan.
 *   Varian IN_STORE dan HOME_SERVICE →UNSUPPORTED (logika TIPE, bukan flag).
 * - PRODUCT: IN_STORE_ORDER→IN_STORE_ORDER; IN_STORE_PICKUP→IN_STORE_PICKUP
 *   distinct (BOPIS Fase 3 — ambil-di-toko pisah di laporan; BE 00213+POS-create
 *   kini terima); TAKEAWAY/TAKE_AWAY→TAKEAWAY; DELIVERY/agregator/
 *   DINE_IN→UNSUPPORTED — SENGAJA tak dilipat ke TAKEAWAY (delivery ≠ takeaway;
 *   BE menolak = BLOCKED jujur).
 * - SERVICE: IN_STORE_SERVICE→IN_STORE_SERVICE; HOME_SERVICE→HOME_SERVICE
 *   (Fase 3 — teknisi datang, alamat di deliveryAddress; BE POS-create kini
 *   terima + validasi alamat ≤500 char).
 * Mode asing RESTAURANT → DINE_IN (default lama, lestari).
 */
function goPosOrderType(raw?: unknown, merchantType?: unknown): string {
  const mt = normalizeMerchantType(merchantType ?? getCachedMerchantType());
  const k = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (mt === 'PRODUCT') {
    // Fase 3 BOPIS: IN_STORE_PICKUP disimpan distinct (laporan pisah ambil-di-toko
    // vs makan-di-tempat; BE orders_pos_create kini terima keduanya).
    if (k === 'IN_STORE_ORDER') return 'IN_STORE_ORDER';
    if (k === 'IN_STORE_PICKUP') return 'IN_STORE_PICKUP';
    if (k === 'TAKE_AWAY' || k === 'TAKEAWAY') return 'TAKEAWAY';
    return UNSUPPORTED_ORDER_TYPE;
  }
  if (mt === 'SERVICE') {
    if (k === 'IN_STORE_SERVICE') return 'IN_STORE_SERVICE';
    // Fase 3: HOME_SERVICE via POS (teknisi datang; alamat di deliveryAddress).
    if (k === 'HOME_SERVICE') return 'HOME_SERVICE';
    return UNSUPPORTED_ORDER_TYPE;
  }
  // RESTAURANT + tak-dikenal (default restaurant, ASUMSI): perilaku pra-C2.
  // Collapse legacy UNCONDITIONAL (milik 550361a) — KOREKSI-FLAG: sync
  // buta-flag; pesanan lama mengalir apa pun status flag kini.
  if (k === 'DINE_IN') return 'DINE_IN';
  if (k === 'TAKE_AWAY' || k === 'TAKEAWAY') return 'TAKEAWAY';
  if (/DELIVER|ANTAR|KURIR|OJEK|GOFOOD|GRABFOOD|SHOPEEFOOD|ONLINE/.test(k)) return 'TAKEAWAY';
  if (k === 'IN_STORE_ORDER' || k === 'IN_STORE_PICKUP' || k === 'IN_STORE_SERVICE' || k === 'HOME_SERVICE') {
    return UNSUPPORTED_ORDER_TYPE;
  }
  return 'DINE_IN';
}

/**
 * Alasan BLOCKED untuk orderType UNSUPPORTED (teks i18n + nilai dinamis via
 * .replace — pola render tabel; dipanggil saat fail-once agar bahasa catatan
 * ikut bahasa sesi). null = didukung (tak ada alasan).
 */
export function orderTypeBlockReason(raw?: unknown, merchantType?: unknown): string | null {
  const mt = normalizeMerchantType(merchantType ?? getCachedMerchantType());
  if (goPosOrderType(raw, mt) !== UNSUPPORTED_ORDER_TYPE) return null;
  const mode = String(raw ?? '').trim() || '?';
  return tr('sync.orderTypeUnsupported').replace('{mode}', mode).replace('{type}', mt);
}

/**
 * Vertical Shell Fase 2: pagar payPolicy per vertikal (defense-in-depth;
 * UI sudah menyembunyikan tombolnya, sync menolak bila lolos).
 * - PREPAID (PULSA_DIGITAL): aksi hold/simpan-hutang/parked SELALU ditolak
 *   (SN/token tak bisa ditarik — tahan = rugi pasti). Guard berbasis aksi,
 *   bukan nominal: pemanggil (Simpan/Hold/Parked) sudah berarti ada utang.
 *   amountDue opsional hanya untuk pesan; bila diisi dan <=0 pun tetap tolak
 *   agar tak ada jalan pintas parked-diam untuk pulsa.
 * - DP (SERVICE): tak diblokir di sini (hint saja di PayScreen).
 * null = boleh lanjut.
 */
export function payPolicyBlockReason(vertical?: unknown, amountDue?: unknown): string | null {
  let vid = '';
  try { vid = String(vertical ?? getCachedVerticalId() ?? ''); } catch { vid = String(vertical ?? ''); }
  const cfg = (VERTICALS as Record<string, { payPolicy?: string }>)[vid];
  const policy = cfg?.payPolicy ?? '';
  if (policy === 'PREPAID') {
    void amountDue;
    return tr('pay.prepaidOnly');
  }
  return null;
}

/**
 * Petakan item sale app → item POS Go. menuId numerik → MENU (harga ikut
 * server, modifier/diskon dilipat ke notes sebagai jejak audit); selainnya
 * (id lokal 'p1' dsb) → CUSTOM {customName, customPrice} dengan harga satuan
 * = ((price + modifier) × qty − discount) / qty. Addons selalu [] (butuh
 * addonItemId numerik yang tak dimiliki katalog lokal). null = kosong/tak
 * valid (backend akan 400 → biarkan ESB, dilaporkan).
 */
function goPosItems(raw: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Record<string, unknown>[] = [];
  for (const it of raw) {
    const r = it as {
      menuId?: unknown; name?: unknown; qty?: unknown; price?: unknown;
      discount?: unknown; modifiers?: unknown; note?: unknown;
    };
    const qty = Math.max(1, Math.round(Number(r.qty) || 1));
    const price = Math.round(Number(r.price) || 0);
    const mods = Array.isArray(r.modifiers)
      ? (r.modifiers as { name?: unknown; price?: unknown }[])
      : [];
    const modTotal = mods.reduce((a, m) => a + Math.round(Number(m.price) || 0), 0);
    const disc = Math.round(Number(r.discount) || 0);
    const name = String(r.name ?? '').trim() || 'Item';
    const note = typeof r.note === 'string' ? r.note.trim() : '';
    const menuRaw = String(r.menuId ?? '').trim();
    const menuNum = /^[0-9]+$/.test(menuRaw) ? parseInt(menuRaw, 10) : NaN;
    if (Number.isFinite(menuNum) && menuNum > 0) {
      // MENU: server menilai dari master (server-wins pricing); selisih
      // modifier/diskon lokal dicatat di notes, rekonsiliasi di langkah bayar.
      const audit = [
        ...(note ? [note] : []),
        ...mods.map((m) => `+${String(m.name ?? '').trim() || 'modifier'}`),
        ...(disc > 0 ? [`disc-${disc}`] : []),
      ].join('; ');
      out.push({
        type: 'MENU',
        menuId: menuNum,
        quantity: qty,
        ...(audit ? { notes: audit.slice(0, 500) } : {}),
        addons: [],
      });
    } else {
      const unit = Math.max(0, Math.round(((price + modTotal) * qty - disc) / qty));
      out.push({
        type: 'CUSTOM',
        customName: name.slice(0, 200),
        customPrice: unit,
        quantity: qty,
        ...(note ? { notes: note.slice(0, 500) } : {}),
        addons: [],
      });
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Terjemahan Go-POS untuk satu item ringan. Kembali {path, body} bila ada
 * padanan backend, {unsupported} bila mode tak didukung merchant-type aktif
 * (C2: BE pasti menolak — JANGAN kirim, JANGAN jatuh ke path ESB 404-retry
 * buta; pushLightItem mem-BLOCKED jujur fail-once), null bila ops tetap ESB
 * (pathFor yang memutuskan).
 * - sale-create (kind 'order' tanpa op, bentuk buildSalePayload) → create POS
 *   {orderType, items, clientId/displayNo, tableNumber?, customer?}.
 *   Total/diskon/voucher/payments SENGAJA tak dibawa: server menghitung ulang
 *   (server-wins) dan rekonsiliasi terjadi di langkah bayar.
 * - group-payment legs → group-bill/payments (router.go:335) HANYA bila
 *   payload membawa {orderId, shareId} server; app tak pernah membuat
 *   group-bill shares sehingga legs kini TANPA identitas itu → null (tetap
 *   ESB, dilaporkan; bukan 400 berulang ke endpoint yang salah).
 * - Selainnya (split-bill tanpa orderId server, move-items/move-table tanpa
 *   endpoint pindah, view / view-by-qr / view-quick-service yang berarah
 *   display, order-error-log, delivery-push, terminal-verify, shift,
 *   voucher online/external, deposit, receipt, attendance=lane lain) → null
 *   (tetap ESB, dilaporkan).
 */
function toGoPosRequest(
  kind: SyncKind,
  payload: Record<string, unknown>,
  outboxId?: string,
): { path: string; body: Record<string, unknown> } | { unsupported: string } | null {
  if (kind !== 'order') return null;
  const p = payload as {
    op?: unknown; items?: unknown; mode?: unknown; salesMode?: unknown;
    tableId?: unknown; customer?: unknown; orderId?: unknown; order_id?: unknown;
    shareId?: unknown; share_id?: unknown; salesNum?: unknown;
    client_id?: unknown; clientId?: unknown;
    deliveryAddress?: unknown; address?: unknown; deliveryFee?: unknown; ongkir?: unknown;
    serviceDate?: unknown; serviceTime?: unknown; notes?: unknown;
  };
  const op = String(p.op ?? '');
  if (op === 'group-payment') {
    const orderId = String(p.orderId ?? p.order_id ?? '').trim();
    const shareId = String(p.shareId ?? p.share_id ?? '').trim();
    if (!/^[0-9]+$/.test(orderId) || !shareId) return null;
    // groupOrderBillPaymentRequest backend: paymentMethod ∈
    // {CASH_ON_COUNTER, CARD_ON_COUNTER, QRIS} + tenderedAmount wajib menutup
    // amount untuk tunai (0 untuk kartu/QRIS) + idempotencyKey 16-128 char.
    const legs = Array.isArray(payload.payments) ? payload.payments : [];
    const first = (legs[0] ?? {}) as { method?: unknown; amount?: unknown; approvalCode?: unknown };
    const mKey = String(first.method ?? payload.method ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
    const method = mKey === 'qris'
      ? 'QRIS'
      : (/tunai|cash/.test(mKey) || !mKey ? 'CASH_ON_COUNTER' : 'CARD_ON_COUNTER');
    const amount = Math.round(Number(first.amount) || 0);
    return {
      path: `api/merchant/orders/${orderId}/group-bill/payments`,
      body: {
        shareId,
        paymentMethod: method,
        amount,
        tenderedAmount: method === 'CASH_ON_COUNTER' ? amount : 0,
        // Idempotency key abadi backend = id antrean UUIDv7 (36 char).
        ...(outboxId ? { idempotencyKey: outboxId } : {}),
        ...((first.approvalCode ?? payload.approvalCode)
          ? { notes: String(first.approvalCode ?? payload.approvalCode).slice(0, 500) } : {}),
      },
    };
  }
  if (op || !Array.isArray(p.items)) return null;
  const items = goPosItems(p.items);
  if (!items) return null;
  // C2: routing orderType sadar merchant-type (cache sesi; tak-dikenal =
  // default restaurant, ASUMSI). UNSUPPORTED = BE pasti menolak → kembalikan
  // penanda (bukan null) agar tak jatuh ke path ESB.
  const merchantType = getCachedMerchantType();
  const orderType = goPosOrderType(p.mode ?? p.salesMode, merchantType);
  if (orderType === UNSUPPORTED_ORDER_TYPE) {
    return {
      unsupported:
        orderTypeBlockReason(p.mode ?? p.salesMode, merchantType) ?? 'orderType tak didukung',
    };
  }
  const cid = String(p.client_id ?? p.clientId ?? '').trim();
  const salesNum = String(p.salesNum ?? '').trim();
  const tableNumber = String(p.tableId ?? '').trim();
  const customer = String(p.customer ?? '').trim();
  // Fase 3: alamat + ongkir + jadwal + teknisi (BOPIS/HOME_SERVICE).
  const deliveryAddress = String(p.deliveryAddress ?? p.address ?? '').trim();
  const deliveryFeeRaw = Number(p.deliveryFee ?? p.ongkir ?? 0);
  const serviceDate = String(p.serviceDate ?? '').trim();
  const serviceTime = String(p.serviceTime ?? '').trim();
  const techNote = String(p.notes ?? '').trim();
  return {
    path: GO_POS_CREATE_PATH,
    body: {
      orderType,
      items,
      // displayNo tanpa clientId DITOLAK backend; clientId dipastikan di
      // pushLightItem (fallback id antrean UUIDv7) sebelum kirim.
      ...(cid ? { clientId: cid } : {}),
      ...(salesNum ? { displayNo: salesNum } : {}),
      ...(tableNumber ? { tableNumber } : {}),
      ...(customer ? { customer: { name: customer.slice(0, 200) } } : {}),
      ...(deliveryAddress ? { deliveryAddress: deliveryAddress.slice(0, 500) } : {}),
      ...(Number.isFinite(deliveryFeeRaw) && deliveryFeeRaw > 0 ? { deliveryFee: Math.round(deliveryFeeRaw) } : {}),
      ...(serviceDate ? { serviceDate } : {}),
      ...(serviceTime ? { serviceTime } : {}),
      // Fase 3 SERVICE: teknisi/DP (komposisi payments.buildSalePayload) ikut sebagai
      // notes untuk IN_STORE_SERVICE + HOME_SERVICE (BE tak punya kolom teknisi;
      // notes = satu-satunya kanal order-level yang BE simpan). Resto/product tak tersentuh.
      ...(techNote && (orderType === 'HOME_SERVICE' || orderType === 'IN_STORE_SERVICE') ? { notes: techNote.slice(0, 500) } : {}),
    },
  };
}

/**
 * W2 (wiring-2): terjemahan op merchant Go (kind 'other') → {path, body,
 * method} siap drain. null = bukan op W2 (lanjut routing ESB lama).
 * {blocked} = tanpa id server desimal / target status invalid → BLOCKED
 * jujur fail-once (S10), bukan retry buta ke endpoint yang salah. Body hanya
 * membawa field kontrak BE (orderId numerik di path/body — salesNum/TRX
 * lokal TAK PERNAH dipakai sebagai id).
 */
export interface GoMerchantOp {
  path: string;
  body: Record<string, unknown>;
  method: 'POST' | 'PUT';
  idemKey: string;
}

function goMerchantOp(
  item: SyncItem,
): GoMerchantOp | { blocked: string } | null {
  // P1-1 pagar PIN: body dibangun eksplisit per-field di bawah. PIN
  // supervisor live via settlePosPayment / refundPosPayment / postOrderVerdict
  // (param fungsi, tak dipersist) — A-P1-4: antrean GO_OP_SETTLE BOLEH
  // membawa pin HANYA bila pemanggil (PayScreen goSuccess→mirror) sudah
  // mengumpulkannya via ManagerPinPrompt; PIN diteruskan transport-only
  // (dipangkas) agar drain memfinalisasi, bukan memaksa kasir mengulang PIN
  // saat live gagal. PIN salah/berubah = fail-once PIN_REQUIRED jujur.
  const p = (item.payload ?? {}) as Record<string, unknown>;
  if (item.kind !== 'other') return null;
  const op = String(p.op ?? '');
  const W2_OPS = [GO_OP_SETTLE, GO_OP_REFUND, GO_OP_CANCEL, GO_OP_VOID, GO_OP_STATUS, GO_OP_RESV_CANCEL, GO_OP_MOVE_TABLE];
  if (!W2_OPS.includes(op)) return null;
  const sidRaw = String(p.serverId ?? '').trim();
  if (!/^[0-9]+$/.test(sidRaw)) {
    return { blocked: 'posWire: tanpa id order server (BLOCKED, bukan kirim buta)' };
  }
  const serverId = parseInt(sidRaw, 10);
  const reason = String(p.reason ?? '').trim();
  const withReason = reason ? { reason: reason.slice(0, 500) } : {};
  if (op === GO_OP_SETTLE) {
    const method = String(p.method ?? '').trim().toUpperCase();
    const amount = Math.max(0, Math.round(Number(p.amountPaid ?? p.amount) || 0));
    if (!['CASH_ON_COUNTER', 'CARD_ON_COUNTER', 'QRIS', 'SPLIT', 'COMPLIMENT', 'MANUAL_TRANSFER'].includes(method) || amount <= 0) {
      return { blocked: 'posWire: settle butuh method enum BE + nominal > 0' };
    }
    return {
      path: ApiPath.merchantPosPayment,
      body: {
        orderId: serverId,
        paymentMethod: method,
        amountPaid: amount,
        ...(p.changeAmount !== undefined ? { changeAmount: Math.round(Number(p.changeAmount) || 0) } : {}),
        // APP-9: ref transfer (approvalCode kaki) ikut sebagai notes agar
        // terekam di payments.notes/metadata BE, bukan hilang di jalan.
        ...(String(p.notes ?? '').trim() ? { notes: String(p.notes).trim().slice(0, 500) } : {}),
        ...(p.tipAmount ? { tipAmount: Math.round(Number(p.tipAmount) || 0) } : {}),
        ...(p.voucherCode ? { voucherCode: String(p.voucherCode).slice(0, 64) } : {}),
        // P1-2: teruskan sesi kas W1 bila pemanggil menyimpannya di payload
        // (cermin settlePosPayment); absen = BE me-resolve sendiri.
        ...(Math.round(Number(p.cashSessionId) || 0) > 0 ? { cashSessionId: Math.round(Number(p.cashSessionId)) } : {}),
        // A-P1-4: teruskan PIN antrean (transport-only, dipangkas) bila
        // pemanggil menyertakannya (PIN terverifikasi via prompt). Absen =
        // perilaku lama: server menuntut PIN = fail-once PIN_REQUIRED jujur.
        ...(String(p.pin ?? '').trim() ? { pin: String(p.pin).trim().slice(0, 128) } : {}),
      },
      method: 'POST',
      idemKey: String(p.clientId ?? item.id),
    };
  }
  if (op === GO_OP_REFUND) {
    return {
      path: ApiPath.merchantPosRefund,
      body: {
        orderId: serverId,
        ...withReason,
        ...(Number(p.amount) > 0 ? { amount: Math.round(Number(p.amount)) } : {}),
        idempotencyKey: item.id,
      },
      method: 'POST',
      idemKey: item.id,
    };
  }
  if (op === GO_OP_CANCEL) {
    return {
      path: ApiPath.merchantOrderCancel.replace('{id}', encodeURIComponent(String(serverId))),
      body: { ...withReason },
      method: 'POST',
      idemKey: item.id,
    };
  }
  if (op === GO_OP_VOID) {
    return {
      path: ApiPath.merchantOrderVoid.replace('{id}', encodeURIComponent(String(serverId))),
      body: { ...withReason },
      method: 'POST',
      idemKey: item.id,
    };
  }
  // P0-3 audit paritas: pindah meja diteruskan ke BE Go
  // (POST api/merchant/orders/{id}/move-table {tableNumber}) agar status
  // meja server tak basi (risiko double-seating). DINE_IN aktif saja (pagar
  // BE); 409 ORDER_CLOSED = replay-sukses via isReplaySuccess di drain.
  if (op === GO_OP_MOVE_TABLE) {
    const to = String(p.to ?? p.tableNumber ?? '').trim().slice(0, 20);
    if (!to) {
      return { blocked: 'posWire: move-table butuh meja tujuan' };
    }
    return {
      path: ApiPath.merchantOrderMoveTable.replace('{id}', encodeURIComponent(String(serverId))),
      body: { tableNumber: to },
      method: 'POST',
      idemKey: `${item.id}:move:${to}`,
    };
  }
  if (op === GO_OP_RESV_CANCEL) {
    return {
      path: ApiPath.merchantResvCancel.replace('{id}', encodeURIComponent(String(serverId))),
      body: { ...withReason },
      method: 'PUT',
      idemKey: item.id,
    };
  }
  // GO_OP_STATUS: target wajib enum BE dikenal + bukan CANCELLED (endpoint
  // status menolaknya; cancel lewat GO_OP_CANCEL). Pagar cermin BE di sini
  // agar item invalid fail-once cepat, bukan 400 berulang.
  const target = String(p.target ?? '').trim().toUpperCase();
  if (target === 'CANCELLED' || ALLOWED_BE_TRANSITIONS[target] === undefined) {
    return { blocked: `posWire: target status invalid (${target || '?'})` };
  }
  return {
    path: ApiPath.merchantOrderStatus.replace('{id}', encodeURIComponent(String(serverId))),
    body: { status: target, ...(p.note ? { note: String(p.note).slice(0, 500) } : {}) },
    method: 'PUT',
    idemKey: item.id,
  };
}

// ---------------------------------------------------------------------------
// W1 (SESI-FIX-APPW1, gas mode, aditif): penerjemah antrean shift/clock +
// sesi kas + tutup-hari ke kontrak merchant Go. Murni INSERT — goMerchantOp
// (W2) di atas tak tersentuh. Beda dari W2:
// - {sessionId} disubstitusi saat DRAIN dari id sesi server tersimpan
//   (getCashSessionId; payload antrean SENGAJA tanpa id/stamp agar tak basi
//   saat retry; absent = sah di server). Tanpa id sesi TAPI open masih antre
//   = {retry} (tunggu giliran FIFO — open selalu lebih dulu diantar drain
//   strict-createdAt); tanpa id sesi DAN tanpa open tertunda = {blocked}
//   fail-once jujur (S10, bukan antre-selamanya).
// - 409 replay W1 (SHIFT_ALREADY_OPEN / SHIFT_ALREADY_CLOSED / NO_OPEN_SHIFT /
//   SESSION_CLOSED / REVIEW_NOT_PENDING) = 'terkirim' idempoten (ditangani cabang drain di bawah —
//   isReplaySuccess W2 tak mengenal kode-kode ini).
// - Tutup-kas membawa isCashClose + sessionId agar 409 OPEN_POS_ORDERS bisa
//   dialihkan ke daftar pending-close (bukan hilang).
// - PIN tak pernah lewat sini: body antrean sudah dipoles stripPin di
//   beWorkforce; drain mem-POST apa adanya.
// ---------------------------------------------------------------------------

/** 409 = "sudah dalam keadaan target" untuk domain shift/kas W1. */
const W1_REPLAY_RE = /^(SHIFT_ALREADY_OPEN|SHIFT_ALREADY_CLOSED|NO_OPEN_SHIFT|SESSION_CLOSED|REVIEW_NOT_PENDING)$/;

export interface GoWorkforceOp {
  path: string;
  body: Record<string, unknown>;
  method: 'POST';
  idemKey: string;
  /** Dipanggil best-effort sekali saat 2xx/replay (mis. simpan id sesi hasil open). */
  onSent?: (body: unknown) => Promise<void> | void;
  /** true = tutup-kas (butuh alih pending-close bila OPEN_POS_ORDERS). */
  isCashClose?: boolean;
  /** Id sesi kas numerik yang dipakai di path (untuk alih pending-close). */
  sessionId?: string;
}

async function goWorkforceOp(
  item: SyncItem,
): Promise<GoWorkforceOp | { blocked: string } | { retry: string } | null> {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  if (item.kind !== 'other') return null;
  const op = String(p.op ?? '');
  if (
    op !== W1_OP_CLOCK_IN && op !== W1_OP_CLOCK_OUT && op !== W1_OP_CASH_OPEN &&
    op !== W1_OP_CASH_MOVE && op !== W1_OP_CASH_CLOSE && op !== W1_OP_CASH_APPROVE &&
    op !== W1_OP_EOD_CLOSE
  ) {
    return null;
  }
  const idemKey = item.id;
  if (op === W1_OP_CLOCK_IN) {
    return { path: ApiPath.merchantClockIn, body: {}, method: 'POST', idemKey };
  }
  if (op === W1_OP_CLOCK_OUT) {
    return { path: ApiPath.merchantClockOut, body: {}, method: 'POST', idemKey };
  }
  if (op === W1_OP_CASH_OPEN) {
    const cash = Math.round(Number(p.openingCash) || 0);
    if (!Number.isFinite(cash) || cash < 0) {
      return { blocked: 'beWorkforce: cash-open butuh openingCash >= 0' };
    }
    const note = String(p.note ?? '').trim();
    return {
      path: ApiPath.merchantCashOpen,
      body: { registerId: 0, openingCash: cash, ...(note ? { note: note.slice(0, 500) } : {}) },
      method: 'POST',
      idemKey,
      onSent: async (body) => {
        try {
          const inner = ((body as Record<string, unknown>)?.data ?? body) as Record<string, unknown>;
          const id = Math.round(Number(inner?.id) || 0);
          if (id > 0) await setCashSessionId(id);
        } catch {
          /* abaikan */
        }
      },
    };
  }
  if (op === W1_OP_EOD_CLOSE) {
    const date = String(p.date ?? '').trim();
    return {
      path: ApiPath.merchantEodClose,
      body: date ? { date } : {},
      method: 'POST',
      idemKey,
    };
  }
  // MOVE + CLOSE butuh id sesi kas server (drain-time lookup; payload antrean
  // tanpa id agar tak basi). Hint eksplisit payload didahulukan bila valid.
  const sidHint = String(p.serverSessionId ?? '').trim();
  const sid = isServerSessionId(sidHint) ? sidHint : await getCashSessionId();
  if (!sid) {
    const openPending = outbox.some(
      (o) => o.status !== 'terkirim' && o.kind === 'other' &&
        String(((o.payload ?? {}) as Record<string, unknown>).op ?? '') === W1_OP_CASH_OPEN,
    );
    if (openPending) return { retry: 'beWorkforce: menunggu sesi kas hasil open (retry)' };
    return { blocked: 'beWorkforce: tanpa id sesi kas server + tanpa open tertunda' };
  }
  if (op === W1_OP_CASH_MOVE) {
    const type = String(p.type ?? '').trim().toUpperCase();
    const amount = Math.round(Number(p.amount) || 0);
    const reason = String(p.reason ?? '').trim();
    if ((type !== 'PAID_IN' && type !== 'PAID_OUT' && type !== 'CASH_DROP') || amount <= 0 || !reason) {
      return { blocked: 'beWorkforce: move butuh type enum + amount > 0 + reason' };
    }
    return {
      path: ApiPath.merchantCashMove.replace('{sessionId}', encodeURIComponent(sid)),
      body: { type, amount, reason: reason.slice(0, 500) },
      method: 'POST',
      idemKey,
      sessionId: sid,
    };
  }
  // W1_OP_CASH_APPROVE (manager kedua; closer sendiri = 403 jujur di bawah).
  // Catatan wajib 1–500 char (aturan server); tanpa catatan valid = blocked.
  // 409 REVIEW_NOT_PENDING = sudah di-approve = replay-sukses (W1_REPLAY_RE).
  if (op === W1_OP_CASH_APPROVE) {
    const approveNote = String(p.note ?? '').trim();
    if (!approveNote) {
      return { blocked: 'beWorkforce: approve butuh note 1-500 char (aturan server)' };
    }
    return {
      path: ApiPath.merchantCashApprove.replace('{sessionId}', encodeURIComponent(sid)),
      body: { note: approveNote.slice(0, 500) },
      method: 'POST',
      idemKey,
      sessionId: sid,
    };
  }
  // W1_OP_CASH_CLOSE.
  const actual = Math.round(Number(p.actualCash) || 0);
  if (!Number.isFinite(actual) || actual < 0) {
    return { blocked: 'beWorkforce: cash-close butuh actualCash >= 0' };
  }
  const closeNote = String(p.note ?? '').trim();
  return {
    path: ApiPath.merchantCashClose.replace('{sessionId}', encodeURIComponent(sid)),
    body: { actualCash: actual, ...(closeNote ? { note: closeNote.slice(0, 500) } : {}) },
    method: 'POST',
    idemKey,
    isCashClose: true,
    sessionId: sid,
    onSent: async () => {
      try {
        await clearCashSessionId();
      } catch {
        /* abaikan */
      }
    },
  };
}

/**
 * S20: pastikan restore boot selesai sebelum persist agar enqueue pertama
 * sesudah boot tak menimpa item tersimpan di AsyncStorage.
 */async function ensureRestored(): Promise<void> {
  hydrate();
  if (restorePromise) {
    try {
      await restorePromise;
    } catch {
      /* best-effort — drain/persist tetap jalan */
    }
  }
}

export function enqueueSync(kind: SyncKind, payload: Record<string, unknown>, id?: string): SyncItem {
  hydrate();
  // S6: id eksplisit = twin berbagi client_id dengan POST immediate (tanpa
  // UUID ganda); idempotent — twin yang sama tak antre dua kali.
  if (typeof id === 'string' && id) {
    const prior = outbox.find((o) => o.id === id);
    if (prior) return prior;
  }
  const item: SyncItem = {
    // UUIDv7 (Q7): id antrean = idempotency key retry-aman lintas-device.
    id: typeof id === 'string' && id ? id : uuidv7(),
    kind,
    payload,
    createdAt: new Date().toISOString(),
    status: 'antre',
  };
  outbox = [...outbox, item];
  void ensureRestored().then(() => persist());
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
       ORDER BY CASE WHEN status = 'antre' THEN 0 ELSE 1 END, createdAt ASC LIMIT 200`,
    );
  } catch {
    return [];
  }
}

/**
 * Kontrak konflik push (ground truth, menggantikan anggapan lama "409 =
 * UNIQUE(client_id) duplikat"): retry client_id duplikat kembali sebagai 200
 * "Order already synced" (jalur 2xx biasa → terkirim). HTTP 409 HANYA untuk
 * SALE_DISPLAY_CONFLICT (display_no sudah dipakai order lain) — server TIDAK
 * punya baris kita, sehingga 409 mentah tak boleh dianggap terkirim (itu
 * menghilangkan penjualan). Hanya bukti-duplikat yang boleh duplicate-ack.
 */
type Conflict409Kind = 'duplicate' | 'display' | 'unknown';

interface Conflict409Info {
  kind: Conflict409Kind;
  /** Kode server apa adanya ('' bila tak ada) untuk catatan jujur. */
  code: string;
}

/** Batas terbitkan-ulang display_no per item saat 409 display-conflict. */
const MAX_DISPLAY_REISSUES = 2;

/**
 * Baca body respons 409. apiPost mengembalikan fetch Response mentah (status +
 * ok saja, tanpa body terparse), jadi kupas di sini: objek JSON bila bisa,
 * teks mentah bila bukan JSON, null bila kosong/tak terbaca. Body hanya bisa
 * dibaca sekali — panggil sekali per respons.
 */
async function readConflictBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

/**
 * Ambil field string dari body dengan beberapa ejaan umum (snake/camel +
 * envelope {data}/{error}); body string mentah dipakai apa adanya.
 */
function conflictField(body: unknown, ...names: string[]): string {
  const pick = (o: unknown): string => {
    if (!o || typeof o !== 'object') return '';
    const r = o as Record<string, unknown>;
    for (const n of names) {
      const v = r[n];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
    return '';
  };
  if (typeof body === 'string') return body.trim();
  if (!body || typeof body !== 'object') return '';
  const r = body as Record<string, unknown>;
  return (
    pick(body) ||
    pick(r.data) ||
    pick(r.error) ||
    pick((r.error as Record<string, unknown> | undefined)?.data)
  );
}

/**
 * Klasifikasikan body 409 terhadap client_id yang kita kirim.
 * - 'duplicate': bukti server sudah punya baris KITA (existingOrderId cocok
 *   dengan client_id kita, atau pesan sudah-ada/sudah-sync/UNIQUE client).
 * - 'display': SALE_DISPLAY_CONFLICT / bukti display_no — server TAK punya
 *   baris kita → terbitkan display_no baru + kirim ulang (bukan terkirim).
 * - 'unknown': tak ada bukti → 'gagal' jujur dengan kode, bukan terkirim.
 */
function classify409(body: unknown, ourClientId: string): Conflict409Info {
  const code = conflictField(body, 'code', 'errorCode', 'error_code', 'name');
  const message = conflictField(body, 'message', 'msg', 'errorMessage', 'error_message', 'detail');
  const existingId = conflictField(
    body,
    'existingOrderId',
    'existing_order_id',
    'existingClientId',
    'existing_client_id',
    'orderId',
    'order_id',
  );
  const cid = String(ourClientId ?? '').trim();
  // 1. Kode eksplisit backend untuk display_no yang dipakai order lain.
  if (/^sale_display_conflict$/i.test(code)) return { kind: 'display', code };
  // 2. Server menunjuk order yang sudah ada = baris KITA (client_id sama).
  if (cid && existingId && existingId === cid) return { kind: 'duplicate', code };
  const hay = `${code} ${message}`;
  // 3. Bukti display_no (ejaan apa pun) — server tak punya baris kita.
  if (/sale_display_conflict|display[\s_-]?no/i.test(hay)) return { kind: 'display', code };
  // 4. Bukti duplikat (sudah-ada / sudah-sync / UNIQUE client_id).
  if (/already[\s_-]?(exist|sync)|sudah[\s_-]?ada|duplikat|duplicate|unique[\s_-]?.*client|client[\s_-]?.*unique|client[\s_-]?.*exist/i.test(hay)) {
    return { kind: 'duplicate', code };
  }
  return { kind: 'unknown', code };
}

/** Label catatan jujur untuk 409 non-duplikat: "409 <KODE>" atau "409". */
function conflictTag(code: string): string {
  return code ? `409 ${code}` : '409';
}

/**
 * HP-E2E (2026-10-26): handoff drain-time satu expense → endpoint terminal Go.
 * Baris lokal menyimpan amount NEGATIF (konvensi ledger kas); kontrak BE
 * menuntut amount > 0 — postExpenseToTerminal menormalisasi abs() + guard
 * nol/NaN. clientExpenseId = uuid di balik prefix EX- (ExpenseScreen) atau
 * uuid mentah (PettyCash) — SAMA dengan handoff immediate-first layar,
 * sehingga retry/drain = replay idempoten (409-duplicate = sukses, tanpa
 * ledger ganda). Sukses → markClean + watermark; true = terkirim.
 * Tak pernah melempar; false = pemanggil menandai 'gagal' jujur (retry).
 */
async function drainExpenseToTerminal(rowId: string): Promise<boolean> {
  const id = String(rowId ?? '').trim();
  if (!id) return false;
  try {
    await initDb();
  } catch {
    return false;
  }
  let row: { id: string; amount: number | null; note: string | null; expenseDate: string | null; createdAt: string | null; photoPath: string | null } | null = null;
  try {
    row = await queryFirst(
      'SELECT id, amount, note, expenseDate, createdAt, photoPath FROM tr_branchexpense WHERE id = ?',
      [id],
    );
  } catch {
    return false;
  }
  if (!row) return false;
  const isExp = String(row.id ?? '').startsWith('EX-');
  try {
    const h = await postExpenseToTerminal({
      rowId: id,
      clientExpenseId: isExp ? String(row.id).slice(3) : String(row.id),
      kind: (isExp ? 'EXPENSE' : 'PETTY_CASH') as 'EXPENSE' | 'PETTY_CASH',
      amount: Math.round(Number(row.amount ?? 0) || 0),
      note: String(row.note ?? '').slice(0, 500),
      occurredAt: String(row.expenseDate ?? row.createdAt ?? new Date().toISOString()),
      // Foto lokal (file://) = omit — alur photoPending/retry yang mengurus;
      // remote (https, sudah di-upload) = ikut sebagai photoUrl.
      ...(isRemotePhoto(row.photoPath) ? { photoUrl: String(row.photoPath).trim().slice(0, 2048) } : {}),
    });
    if (h.posted !== true) return false;
    try {
      await markClean('tr_branchexpense', id);
    } catch {
      /* abaikan: server sudah pegang baris */
    }
    try {
      await setWatermark('tr_branchexpense', { push: new Date().toISOString() });
    } catch {
      /* abaikan */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * HP-E2E (2026-10-26): kuras satu baris fisik tr_branchexpense via handoff
 * terminal (bukan path ESB legacy — 404 vs Go). Sukses/409-duplikat =
 * 'sent' (DELETE antrean fisik + markClean + watermark); gagal = 'gagal'
 * jujur (retry push berikut). Baris DB hilang lokal (dihapus kasir) =
 * 'sent' + DELETE (tak ada yang bisa dikirim; cegah racun breaker S4).
 */
async function pushExpensePhysicalRow(row: PhysicalQueueRow): Promise<'sent' | 'failed'> {
  const rowId = String(row.orderID ?? '').trim();
  if (!rowId) {
    try {
      await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [row.id]);
    } catch {
      /* abaikan */
    }
    return 'sent';
  }
  let exists = false;
  try {
    await initDb();
    const hit = await queryFirst<{ id: string }>(
      'SELECT id FROM tr_branchexpense WHERE id = ?',
      [rowId],
    );
    exists = !!hit;
  } catch {
    return 'failed';
  }
  if (!exists) {
    try {
      await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [row.id]);
    } catch {
      /* abaikan */
    }
    return 'sent';
  }
  if (!(await drainExpenseToTerminal(rowId))) {
    try {
      await run("UPDATE tr_esoprocessqueue SET status = 'gagal' WHERE id = ?", [row.id]);
    } catch {
      /* abaikan */
    }
    return 'failed';
  }
  try {
    await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [row.id]);
  } catch {
    /* abaikan */
  }
  return 'sent';
}

/**
 * Opsi A penutup M9-3: kuras satu baris fisik ms_branchmenu (menu) /
 * ms_branchaddon (addon) via endpoint terminal Go
 * (POST api/v1/terminals/{id}/branch-menu, absolute-set type menu|addon).
 * 'sent' = DELETE + markClean + watermark; 'failed' = 'gagal' jujur (retry);
 * 'skipped' = racun _dead4xx (tak dihitung, tak trip breaker; kartu tetap
 * 'gagal'). Qty + ambang dibaca LIVE saat drain (bukan payload antrean)
 * sehingga edit beruntun koalesensi — last-write-wins aman.
 * 401 = apiFetch yang mengurus (silent-refresh sekali → logout); helper tak
 * pernah melempar agar drain tak mati.
 */
async function pushBranchMenuPhysicalRow(row: PhysicalQueueRow): Promise<'sent' | 'failed' | 'skipped'> {
  // APP-8: racun deterministik yang sudah ditandai = lewati diam-diam.
  try {
    if (row.payload) {
      const pm = JSON.parse(row.payload) as Record<string, unknown>;
      if (pm && typeof pm._dead4xx === 'string' && (pm._dead4xx as string)) return 'skipped';
    }
  } catch {
    /* payload rusak = coba kirim apa adanya di bawah */
  }
  const table = String(row.tableName ?? '');
  const isAddon = table === 'ms_branchaddon';
  const idCol = isAddon ? 'addonId' : 'menuId';
  const bodyType = isAddon ? 'addon' : 'menu';
  const composite = String(row.orderID ?? '').trim();
  const sep = composite.lastIndexOf(':');
  const branch = sep > 0 ? composite.slice(0, sep).trim() : '';
  const menuIdRaw = sep > 0 ? composite.slice(sep + 1).trim() : '';
  const numId = Number(menuIdRaw);
  if (!branch || !menuIdRaw || !Number.isFinite(numId) || Math.round(numId) <= 0) {
    // Baris racun (format id gabungan rusak) = DELETE agar tak starvasi drain.
    try {
      await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [row.id]);
    } catch {
      /* abaikan */
    }
    return 'sent';
  }
  const tid = boundTerminalId();
  if (!tid) return 'failed'; // unbound = retry setelah claim; baris utuh.
  let live: { qty: number | null; lowThreshold: number | null } | null = null;
  try {
    await initDb();
    live = await queryFirst<{ qty: number | null; lowThreshold: number | null }>(
      `SELECT qty, lowThreshold FROM ${isAddon ? 'ms_branchaddon' : 'ms_branchmenu'} WHERE branchId = ? AND ${idCol} = ?`,
      [branch, menuIdRaw],
    );
  } catch {
    return 'failed';
  }
  if (!live) {
    // Baris sumber dihapus lokal (menu dihapus) = tak ada yang dikirim.
    try {
      await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [row.id]);
    } catch {
      /* abaikan */
    }
    return 'sent';
  }
  const qty = Math.max(0, Math.round(Number(live.qty) || 0));
  const lt = live.lowThreshold === null || live.lowThreshold === undefined
    ? null
    : Math.max(0, Math.min(100000, Math.round(Number(live.lowThreshold))));
  const markFailed = async (dead?: string): Promise<'failed'> => {
    try {
      if (dead) {
        await run('UPDATE tr_esoprocessqueue SET status = ?, payload = ? WHERE id = ?', [
          'gagal',
          JSON.stringify({ table, rowId: composite, op: row.op, _dead4xx: dead }),
          row.id,
        ]);
      } else {
        await run("UPDATE tr_esoprocessqueue SET status = 'gagal' WHERE id = ?", [row.id]);
      }
    } catch {
      /* abaikan */
    }
    return 'failed';
  };
  const codeOf = (body: unknown): string => {
    try {
      const b = body as Record<string, unknown>;
      const v = b?.error ?? (b?.data as Record<string, unknown> | undefined)?.error;
      return typeof v === 'string' ? v.trim() : '';
    } catch {
      return '';
    }
  };
  try {
    const path = ApiPath.pushBranchMenu.replace('{id}', encodeURIComponent(tid));
    // P0-02: optimistic-lock BENAR — baseQty dari payload saat edit (bukan qty baru).
    // Tanpa base (edit lama/antre legacy) = tanpa baseQty agar BE perlakukan legacy tanpa false-409.
    let baseQty: number | null = null;
    try {
      const pm = row.payload ? JSON.parse(row.payload) as Record<string, unknown> : null;
      const b = pm ? Number((pm as Record<string, unknown>).baseQty) : NaN;
      if (Number.isFinite(b)) baseQty = Math.max(0, Math.round(b));
    } catch { /* tanpa base = legacy */ }
    const r = await apiFetch(path, {
      method: 'POST',
      body: {
        type: bodyType, id: Math.round(numId), stockQty: qty,
        ...(lt === null ? {} : { lowStockThreshold: lt }),
        ...(baseQty !== null ? { baseQty } : {}),
      },
    });
    // local/dummy/offline-buta = retry, bukan sukses palsu.
    if (!r || r.fromDummy) return markFailed();
    if (r.ok) {
      try {
        await run('DELETE FROM tr_esoprocessqueue WHERE id = ?', [row.id]);
      } catch {
        /* abaikan */
      }
      try {
        await markClean(table, composite);
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
    // Opname DRAFT berjalan di server = retry jujur (tanpa marker racun).
    if (r.status === 409 && /STOCK_COUNT_IN_PROGRESS/i.test(codeOf(r.data))) return markFailed();
    // P0-02: konflik optimistik = pull ulang lalu retry jujur (tanpa racun).
    if (r.status === 409 && /STOCK_CONFLICT/i.test(codeOf(r.data))) {
      try { const { pullMaster } = await import('./master'); await pullMaster(['menu', 'branchmenu']); } catch { /* abaikan */ }
      return markFailed();
    }
    // 4xx deterministik (menu tak dikenal/validasi) = racun: tandai _dead4xx
    // agar siklus berikut 'skipped' ala APP-8 (kartu tetap 'gagal').
    if (r.status >= 400 && r.status < 500) {
      return markFailed(`HTTP ${r.status}${codeOf(r.data) ? ` ${codeOf(r.data)}` : ''}`.slice(0, 32));
    }
    return markFailed();
  } catch {
    return markFailed();
  }
}

/**
 * Dorong satu baris fisik via tablePushPath (path endpoint tidak berubah).
 * 'sent' = DELETE + watermark; 'failed' = tandai 'gagal'; 'skipped' = master
 * lain (ms_* local-only M9-3) atau tanpa endpoint push — ms_branchmenu dan
 * ms_branchaddon DIKECUALIKAN (Opsi A: drain sendiri via
 * pushBranchMenuPhysicalRow). Untuk ms_* pemanggil (drain) memfinalkan
 * status 'lokal' — bukan antre, bukan gagal.
 *
 * HP-E2E (2026-10-26): tr_branchexpense TIDAK lewat tablePushPath — path ESB
 * legacy (v1/push/branch-expenses) 404 vs Go → 'gagal' tiap push + trip
 * breaker S4. Expense punya padanan Go (POST api/v1/terminals/{id}/expenses,
 * idempoten via clientExpenseId) → drain via pushExpensePhysicalRow di bawah.
 */
async function pushPhysicalRow(row: PhysicalQueueRow): Promise<'sent' | 'failed' | 'skipped'> {
  const table = String(row.tableName ?? '');
  // Opsi A (penutup M9-3): ms_branchmenu PUNYA endpoint push terminal
  // (ApiPath.pushBranchMenu) — kuras via helper di atas (baca qty LIVE saat
  // drain agar edit beruntun koalesensi, last-write-wins). ms_* LAIN tetap
  // local-only (tanpa endpoint push) + pull server-wins.
  if (table === 'ms_branchmenu' || table === 'ms_branchaddon') return pushBranchMenuPhysicalRow(row);
  // Master lain (ms_*, local-only M9-3): backend Go tak punya endpoint push
  // master dan pull server-wins menimpa edit lokal. Jangan kirim.
  if (!table || table.startsWith('ms_')) return 'skipped';
  // HP-E2E-FIX (2026-10-26): expense → handoff terminal Go (lihat helper).
  if (table === 'tr_branchexpense') return pushExpensePhysicalRow(row);
  // HP-E2E-FIX (2026-10-24, E2E HP Xiaomi): tr_shiftlog tanpa padanan Go —
  // absensi offline-only eksplisit (S9/PP-010, AttendanceScreen); data shift
  // dibawa W1 be-cash-open/be-cash-close ke endpoint Go workforce. Transport
  // ESB legacy (v1/push/shift) 404 vs Go + masuk hitungan breaker S4 (3 gagal
  // beruntun menjeda drain → antrean sale ikut starvasi). 'skipped' TANPA
  // transport → drain memfinalkan 'lokal' pola M9-3 di bawah (bukan antre,
  // bukan gagal; baris tetap tampil di Sync sebagai "Hanya di perangkat ini").
  if (table === 'tr_shiftlog') return 'skipped';
  // APP-8: baris fisik yang sudah 'gagal' deterministik (_dead4xx di payload,
  // dikupas dari wire body di bawah pola _conflict409) = 'skipped' (S10).
  // Kartu tetap 'gagal'; tanpa hitungan failed, tanpa trip breaker S4.
  if (String(row.status ?? '') === 'gagal' && row.payload) {
    try {
      const pm = JSON.parse(row.payload) as Record<string, unknown>;
      if (pm && typeof pm._dead4xx === 'string' && (pm._dead4xx as string)) return 'skipped';
    } catch {
      /* payload rusak = retry jujur di bawah */
    }
  }
  const path = tablePushPath(table);
  if (!path) return 'skipped';
  try {
    let body: Record<string, unknown> = {};
    try {
      body = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    // S22: baris deposit fisik hanya membawa {table,rowId,op} — perkaya dari
    // kolom nyata (memberId/amount/trxType) agar server tak terima body kosong.
    if (table === 'tr_memberdeposit') {
      try {
        const d = await queryFirst<{ memberId: string | null; amount: number | null; trxType: string | null }>(
          'SELECT memberId, amount, trxType FROM tr_memberdeposit WHERE id = ? LIMIT 1',
          [String(row.orderID ?? '')],
        );
        if (d) {
          body = {
            ...body,
            ...(d.memberId ? { memberId: d.memberId } : {}),
            ...(d.amount != null ? { amount: d.amount } : {}),
            ...(d.trxType ? { type: d.trxType } : {}),
          };
        }
      } catch {
        /* abaikan — body generik tetap dikirim */
      }
    }
    // DEPOSIT-SINGLE-POST: baris tr_memberdeposit berbagi kunci idempotensi
    // dengan POST langsung + light twin-nya (orderID = deposit key `dep-…`,
    // sama dengan ledger id). row.id fisik (=uuid antrean) tetap dipakai untuk
    // DELETE/markClean lokal di bawah. Non-deposit tak berubah (physCid=row.id).
    const depositKey = table === 'tr_memberdeposit' ? String(row.orderID ?? '').trim() : '';
    const physCid = depositKey || row.id;
    // Kunci `_…` di payload = catatan lokal (mis. _conflict409 di bawah), bukan
    // untuk server — kupas sebelum POST agar body wire tetap bersih.
    const wireBody: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!k.startsWith('_')) wireBody[k] = v;
    }
    // GAP-1: timeout abort eksplisit agar drain fisik tak gantung (lihat
    // apiPostWithTimeout di bawah — hoisted, aman dipakai di sini).
    const res = await apiPostWithTimeout(
      path,
      { ...wireBody, table, rowId: row.orderID, op: row.op, clientId: physCid, ...identityFields(physCid) },
      { idempotencyKey: physCid },
    );
    if (res.status === 409) {
      // 409 HANYA SALE_DISPLAY_CONFLICT (display_no dipakai order lain) —
      // server TIDAK punya baris ini. Jangan pernah anggap terkirim (itu
      // menghilangkan penjualan). Hanya bukti-duplikat (server sudah punya
      // baris dengan client_id SAMA) yang boleh duplicate-ack.
      const conflict = classify409(await readConflictBody(res), physCid);
      if (conflict.kind !== 'duplicate') {
        // Jujur gagal: server tak punya baris kita. Baris fisik tak punya
        // kolom note, jadi kode disimpan di payload (_conflict409 — dikupas
        // dari body POST pada retry berikutnya, bukan dikirim ke server).
        // Catatan: jalur fisik tak membawa payload sale sehingga tak bisa
        // terbitkan-ulang display_no di sini; twin ringan sale (bila ada)
        // menanganinya di pushLightItem.
        try {
          await run('UPDATE tr_esoprocessqueue SET status = ?, payload = ? WHERE id = ?', [
            'gagal',
            JSON.stringify({ ...wireBody, _conflict409: conflictTag(conflict.code) }),
            row.id,
          ]);
        } catch {
          try {
            await run("UPDATE tr_esoprocessqueue SET status = 'gagal' WHERE id = ?", [row.id]);
          } catch {
            /* abaikan */
          }
        }
        return 'failed';
      }
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
  } catch (e) {
    // APP-8: 4xx deterministik (404 kontrak/validasi) = tandai _dead4xx di
    // payload (dikupas dari wire body pola _conflict409) agar siklus berikut
    // 'skipped' — bukan 'failed' tiap push + trip breaker S4. 5xx/timeout/
    // jaringan = retry jujur (tanpa marker). Kartu fisik tetap 'gagal'.
    const msg = e instanceof Error ? e.message : '';
    try {
      if (/^HTTP 4\d\d\b/.test(msg.trim()) && row.payload) {
        try {
          const p = JSON.parse(row.payload) as Record<string, unknown>;
          await run('UPDATE tr_esoprocessqueue SET status = ?, payload = ? WHERE id = ?', [
            'gagal',
            JSON.stringify({ ...p, _dead4xx: msg.trim().slice(0, 32) }),
            row.id,
          ]);
        } catch {
          await run("UPDATE tr_esoprocessqueue SET status = 'gagal' WHERE id = ?", [row.id]);
        }
      } else {
        await run("UPDATE tr_esoprocessqueue SET status = 'gagal' WHERE id = ?", [row.id]);
      }
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
  // S3: ganti PIN = hash lokal di ms_posuser (+ updatePinOnServer bila online
  // di AttendanceScreen) — item sync-nya cermin-lokal, tanpa POST server.
  'pin-change',
]);

// Kind deposit tanpa endpoint khusus (kontrak hanya punya
// member-deposit-withdrawal/topup + inquiry-deposit): baris mutasi
// tr_memberdeposit-nya tetap terkirim via outbox fisik (jalur tabel generik),
// sehingga item ringan ini cukup ditandai terkirim-lokal. JANGAN arahkan ke
// endpoint topup — semantiknya berbalik (kredit vs debit).
const DEPOSIT_LOCAL_KINDS = new Set(['deposit-refund', 'deposit-withdraw']);

/** S4: jeda pacing antar-item drain. */
function sleepMs(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** S6: batas timeout immediate-first (dipakai withTimeout/postImmediate). */
export const IMMEDIATE_TIMEOUT_MS = 8000;

/**
 * S6: balapkan janji dengan timeout — menolak bila lewat batas. Tak pernah
 * menelan hasil; pemanggil memutuskan arti timeout (offline → antre twin).
 */
export function withTimeout<T>(promise: Promise<T>, ms = IMMEDIATE_TIMEOUT_MS): Promise<T> {
  const limit = Math.max(1000, Math.floor(ms));
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), limit);
    }),
  ]);
}

/**
 * GAP-1: POST antrean dengan timeout abort eksplisit (pola callStaffLogin
 * LoginScreen:266) — apiPost tanpa signal bisa gantung selamanya di
 * SYN-blackhole; di sini fetch benar-benar di-abort agar drain tak macet.
 * Timeout default IMMEDIATE_TIMEOUT_MS (8 dtk) selaras postImmediate.
 * AbortError dilempar ke pemanggil (push* memetakan ke 'failed' jujur).
 */
async function apiPostWithTimeout(
  path: string,
  body: Record<string, unknown>,
  opts: { idempotencyKey: string },
  ms = IMMEDIATE_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch {
      /* abaikan */
    }
  }, Math.max(1000, Math.floor(ms)));
  try {
    return await apiPost(path, body, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * W2: PUT antrean dengan timeout abort eksplisit (cermin apiPostWithTimeout)
 * untuk op merchant Go ber-metode PUT (resv-cancel, pos-status). Drain
 * POST-only sebelumnya tak bisa mengurasnya — tanpa ini retry offline
 * PUT macet selamanya.
 */
async function apiPutWithTimeout(
  path: string,
  body: Record<string, unknown>,
  opts: { idempotencyKey: string },
  ms = IMMEDIATE_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch {
      /* abaikan */
    }
  }, Math.max(1000, Math.floor(ms)));
  try {
    return await apiPut(path, body, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * S6 (immediate-first): coba POST langsung dengan timeout singkat. True hanya
 * bila server NYATA menjawab ok (dummy/offline/timeout = false → pemanggil
 * mengantrekan twin). Tak pernah melempar.
 */
export async function postImmediate(path: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await withTimeout(apiFetch(path, { body }));
    return res.ok && !res.fromDummy;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// APP-9 (HP-E2E 2026-10-26): perbaikan sale-lunas-tanpa-settle. Pra-APP-9,
// transfer bank MANUAL ("Mark as Paid") tak punya padanan enum BE sehingga
// drain-link (pushLightItem) SKIP settle secara diam-diam: order tiba di
// server (create terkirim) tapi payment PENDING selamanya, dan push berikut
// tak pernah memperbaikinya (tautan link-block hanya jalan sekali, tepat
// setelah create). Sapuan ini, dijalankan tiap awal pushAll (best-effort,
// tak pernah melempar), mengantren GO_OP_SETTLE untuk sale lokal yang:
// lunas-penuh + tertaut onlineOrderId numerik + TANPA baris settle apa pun
// di outbox (status apa saja — fail-once PIN dsb. dihormati, tak dibangkitkan).
// Idempoten: idemKey = client_id rantai sale; replay BE (kunci-sama =
// sukses-tersimpan, PAYMENT_ALREADY_RECORDED = replay-sukses) membuat
// enqueue-ganda aman. Campuran ber-transfer dilewati (semantik SPLIT BE =
// tunai+kartu, tak bisa mewakili transfer).
// ---------------------------------------------------------------------------
type StrandedSaleRow = {
  salesNum: string;
  client_id: string | null;
  grandTotal: number | null;
  paidAmount: number | null;
  onlineOrderId: string | null;
  tip: number | null;
  voucherCode: string | null;
  customerId: number | null;
};

async function repairUnsettledSales(): Promise<number> {
  try {
    await initDb();
  } catch {
    return 0;
  }
  let heads: StrandedSaleRow[];
  try {
    heads = await all<StrandedSaleRow>(
      `SELECT salesNum, client_id, grandTotal, paidAmount, onlineOrderId, tip, voucherCode, customerId
       FROM tr_saleshead
       WHERE onlineOrderId GLOB '[0-9]*'
         AND grandTotal > 0 AND paidAmount >= grandTotal
         AND UPPER(COALESCE(status, '')) NOT IN ('VOID', 'BATAL', 'CANCELLED', 'REFUNDED')`,
    );
  } catch {
    return 0;
  }
  if (!heads || heads.length === 0) return 0;
  let fixed = 0;
  for (const h of heads) {
    try {
      const no = String(h.salesNum ?? '').trim();
      const sid = parseInt(String(h.onlineOrderId ?? '').trim(), 10);
      const amt = Math.max(0, Math.round(Number(h.grandTotal) || 0));
      if (!no || !Number.isFinite(sid) || sid <= 0 || amt <= 0) continue;
      // Sudah punya settle (status apa pun) = bukan korban skip-diam — lewati.
      const dup = outbox.some(
        (o) =>
          String(((o.payload ?? {}) as { op?: unknown }).op ?? '') === GO_OP_SETTLE &&
          String(((o.payload ?? {}) as { salesNum?: unknown }).salesNum ?? '') === no,
      );
      if (dup) continue;
      let legs: Array<{ paymentMethod?: unknown; refNo?: unknown }>;
      try {
        legs = await all<{ paymentMethod?: unknown; refNo?: unknown }>(
          `SELECT paymentMethod, refNo FROM tr_salespayment WHERE salesNum = ?`,
          [no],
        );
      } catch {
        continue;
      }
      if (!legs || legs.length === 0) continue;
      const bem = legs.map((l) => mapPayMethodToBe(l.paymentMethod));
      if (!bem.every((m): m is BePayMethod => m != null)) continue;
      const uniq = [...new Set<string>(bem)];
      if (uniq.length !== 1 && uniq.includes('MANUAL_TRANSFER')) continue;
      const only = uniq.length === 1 ? String(uniq[0] ?? '') : '';
      const method =
        only === 'CASH_ON_COUNTER' || only === 'CARD_ON_COUNTER' || only === 'QRIS' ||
        only === 'COMPLIMENT' || only === 'MANUAL_TRANSFER'
          ? only
          : 'SPLIT';
      const ref = String(legs[0]?.refNo ?? '').trim();
      const tipN = Math.max(0, Math.round(Number(h.tip) || 0));
      const vch = String(h.voucherCode ?? '').trim();
      const cid = String(h.client_id ?? '').trim();
      enqueueSync('other', {
        op: GO_OP_SETTLE,
        serverId: sid,
        method,
        amountPaid: amt,
        ...(tipN > 0 ? { tipAmount: tipN } : {}),
        ...(vch ? { voucherCode: vch.slice(0, 64) } : {}),
        ...(ref && uniq.length === 1 ? { notes: ref.slice(0, 500) } : {}),
        ...(cid ? { clientId: cid } : {}),
        salesNum: no,
        at: new Date().toISOString(),
      });
      fixed += 1;
    } catch {
      /* lanjut baris berikut */
    }
  }
  return fixed;
}

export async function pushAll(): Promise<PushResult> {
  hydrate();
  if (getServerEnv() !== 'custom') {
    throw new Error('Pilih Server Custom (milik sendiri) di Pengaturan sebelum sync.');
  }
  // S5: custom tanpa URL = belum dikonfigurasi — tolak SEBELUM drain apa pun.
  if (!getCustomBaseUrl().trim()) {
    throw new Error(tr('sync_no_url'));
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
  // APP-9: antrekan settle untuk sale-lunas-tanpa-settle (korban skip-diam
  // pra-APP-9, mis. transfer MANUAL) sebelum drain berjalan.
  try {
    await repairUnsettledSales();
  } catch {
    /* best-effort */
  }
  let sent = 0;
  let failed = 0;
  const touchSuccess = (): void => {
    lastSyncMs = Date.now();
    // S4: cap waktu sync terakhir sadar-bahasa + sadar-zona-cabang (dulu
    // toLocaleString('id-ID') hardcode + jam perangkat).
    try {
      const now = new Date();
      lastSync = `${fmtDateInTz(now, getLang())} ${fmtTimeInTz(now)}`;
    } catch {
      lastSync = new Date().toISOString();
    }
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
  // S2: snapshot hanya id (+kunci urut); status ditulis ke array LIVE agar
  // enqueue di tengah drain (antar-await) selamat sampai persist akhir.
  const lightSnap = outbox
    .filter((item) => item.status !== 'terkirim')
    .map((item) => ({ id: item.id, createdAt: item.createdAt, shiftOpen: isShiftOpenItem(item) }));
  interface DrainEntry {
    createdAt: string;
    shiftOpen: boolean;
    physicalFirst: number;
    seq: number;
    row?: PhysicalQueueRow;
    lightId?: string;
  }
  const entries: DrainEntry[] = [
    ...rows.map((row, seq): DrainEntry => ({
      createdAt: String(row.createdAt ?? ''),
      shiftOpen: isShiftOpenRow(row),
      physicalFirst: 0,
      seq,
      row,
    })),
    ...lightSnap.map(({ id, createdAt, shiftOpen }, idx): DrainEntry => ({
      createdAt: String(createdAt ?? ''),
      shiftOpen,
      physicalFirst: 1,
      seq: idx,
      lightId: id,
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
  // S4: pacing ~150ms antar-item + breaker — 3 gagal beruntun = jeda drain
  // sampai siklus berikut (tulis antre tak pernah hilang, hanya ditunda).
  let consecFails = 0;
  for (const e of entries) {
    if (e.row) {
      const outcome = await pushPhysicalRow(e.row);
      if (outcome === 'sent') {
        sent += 1;
        consecFails = 0;
        touchSuccess();
      } else if (outcome === 'failed') {
        failed += 1;
        consecFails += 1;
      } else if (
        // Opsi A: ms_branchmenu/ms_branchaddon DIKECUALIKAN — sudah punya
        // drain sendiri (pushBranchMenuPhysicalRow); 'skipped' darinya = racun
        // _dead4xx yang kartunya tetap 'gagal' (bukan 'lokal').
        (String(e.row.tableName ?? '').startsWith('ms_') &&
          String(e.row.tableName ?? '') !== 'ms_branchmenu' &&
          String(e.row.tableName ?? '') !== 'ms_branchaddon') ||
        // HP-E2E-FIX (2026-10-24): tr_shiftlog ikut difinalkan 'lokal'
        // (lihat pushPhysicalRow — absensi offline-only, shift dibawa W1).
        String(e.row.tableName ?? '') === 'tr_shiftlog'
      ) {
        // Cermin master local-only (M9-3, tanpa endpoint push): finalkan
        // status 'lokal', BUKAN antre/gagal dan BUKAN delete-diam-diam.
        // 'lokal' = status terminal: keluar dari jendela LIMIT 200 (tak ada
        // starvasi drain), keluar dari badge pending (tak menggelembungkan
        // hitungan Sync), tapi barisnya TETAP ADA dan tampil di layar Sync
        // ("Hanya di perangkat ini") via listLocalOnly. Mutasi DB-nya tetap
        // kotor (syncDate NULL) + pull server tetap menang via REPLACE —
        // semantik ini dinyatakan jujur di UI (master.localOnlyNote).
        // Tabel non-ms_ LAIN tanpa endpoint tetap dibiarkan antre
        // (kontrak BE menyusul) — hanya tr_shiftlog yang dikecualikan di atas.
        try {
          await run("UPDATE tr_esoprocessqueue SET status = 'lokal' WHERE id = ?", [e.row.id]);
        } catch {
          /* abaikan */
        }
      }
      continue;
    }
    if (!e.lightId) continue;
    // S2: resolve ke objek LIVE (bisa hilang/terkirim antar-await) — lewati
    // bila sudah tak ada.
    const live = outbox.find((o) => o.id === e.lightId);
    if (!live || live.status === 'terkirim') continue;
    const outcome = await pushLightItem(live);
    if (outcome === 'sent') {
      sent += 1;
      consecFails = 0;
      touchSuccess();
    } else if (outcome === 'failed') {
      failed += 1;
      consecFails += 1;
    } else if (outcome === 'failed-once') {
      // C8: guard pra-ESB (counterpart-less: group-payment tanpa identitas
      // server dkk) — tally failed jujur SEKALI, tapi consecFails SENGAJA tak
      // tersentuh: transport tak dicoba, breaker hanya mengukur kesehatan
      // jaringan (kegagalan transport nyata di 'failed' di atas + catch bawah).
      failed += 1;
    }
    if (consecFails >= 3) break; // S4: jeda drain sampai siklus berikut
    await sleepMs(150); // S4: pacing antar-item
  }
  // S1: batasi memori — tulis antre ('antre'/'gagal') TAK PERNAH dibuang;
  // yang terkirim hanya 100 terakhir; total array ~500.
  const queued = outbox.filter((i) => i.status !== 'terkirim');
  let keptSent = outbox.filter((i) => i.status === 'terkirim');
  if (keptSent.length > 100) keptSent = keptSent.slice(-100);
  outbox = [...queued, ...keptSent];
  if (outbox.length > 500) {
    outbox = [...queued, ...keptSent.slice(outbox.length - 500)];
  }
  persist();
  // C9: retensi 'lokal' tiap akhir drain (best-effort; gagal = abaikan).
  // Purge server pos_offline_order_sync milik BE (migration 00045 —
  // catatan owner-need, bukan kode APP).
  try {
    await pruneLocalOnly();
  } catch {
    /* abaikan */
  }
  // S13: beri tahu subsistem push (token dsb.) setelah push sukses.
  if (sent > 0) {
    try {
      notifyPushSyncSuccess();
    } catch {
      /* abaikan */
    }
  }
  // S18: flush utang revoke logout (best-effort; gagal = tetap pending).
  try {
    await flushPendingRevokes();
  } catch {
    /* abaikan */
  }
  return { sent, failed };
}

/**
 * HP-E2E (2026-10-26, APP-8): fail-once untuk 4xx deterministik.
 * 'gagal' + catatan deterministik (tanpa '(retry)') = server PASTI menolak
 * lagi (validasi/404 kontrak/tak ada transisi/PIN) → siklus berikut 'skipped'
 * (kartu tetap tampil 'gagal' + alasan; tanpa hitungan failed, tanpa request
 * ulang, tanpa trip breaker S4). Catatan transien SELALU mengandung '(retry)'
 * (jaringan/timeout/5xx/429) → tetap di-retry. Pola S10/C8.
 */
function isDeterministicFailNote(note: unknown): boolean {
  const s = String(note ?? '').trim();
  if (!s || s.includes('(retry)')) return false;
  // APP-10 (HP-E2E 2026-10-26): 401/403/429 = TRANSIEN (token kedaluwarsa →
  // relogin sembuh; rate-limit → cooldown sembuh). TERBUKTI: settle transfer
  // order 9 gagal 401 saat token basi ("posWire: 401 — Authorization token
  // required") lalu di-skip SELAMANYA pasca-relogin — antrean mati diam-diam.
  // Kecualikan kode-transien dari fail-once; 4xx lain tetap final.
  // BILLING (2026-10-29): 402 INSUFFICIENT_DEPOSIT = TRANSIEN — saldo habis
  // sembuh setelah owner topup; jangan fail-once/skip agar antre offline
  // otomatis flush pasca-topup (kasir tetap jalan saat PAST_DUE/READ_ONLY).
  if (/INSUFFICIENT_DEPOSIT/i.test(s)) return false;
  if (/^(posWire|beWorkforce):/.test(s)) {
    if (/\b(401|402|403|429)\b/.test(s)) return false;
    return true;
  }
  if (/^HTTP 4\d\d\b/.test(s)) {
    if (/^HTTP (401|402|403|429)\b/.test(s)) return false;
    return true;
  }
  return false;
}

/**
 * Dorong satu item ringan (path endpoint tidak berubah). 'sent'/'failed' /
 * 'failed-once' dihitung pushAll; 'skipped' = master-local-only atau cermin
 * lokal (LOCAL_OPS/deposit-lokal → tandai terkirim, bukan antre selamanya)
 * atau counterpart-less yang SUDAH difinalkan-gagal sebelumnya.
 * C8: 'failed-once' = guard pra-ESB (tanpa path — transport TAK PERNAH
 * dicoba, mis. kaki group-payment tanpa {orderId, shareId} server): status
 * 'gagal' + note SEKALI (fail-once S10, tally failed jujur), tapi BUKAN
 * 'failed' transport sehingga breaker consecFails tak tersentuh — 3 item
 * counterpart-less baru tak boleh menjeda drain seolah jaringan putus.
 */
async function pushLightItem(item: SyncItem): Promise<'sent' | 'failed' | 'failed-once' | 'skipped'> {
  // APP-8: 4xx deterministik yang SUDAH 'gagal' = jangan kirim ulang tiap
  // push (siklus berikut 'skipped'; kartu tetap 'gagal' + alasan jujur).
  // Transien ('(retry)' di note) lolos ke jalur retry masing-masing.
  if (item.status === 'gagal' && isDeterministicFailNote(item.note)) return 'skipped';
  // Perubahan master lokal (ms_*) local-only (M9-3, tanpa endpoint push):
  // lewati agar tidak terkirim ke order/finish; baris tetap kotor
  // (syncDate NULL) + tercatat di tr_esoprocessqueue (status 'lokal' oleh
  // drain fisik). Tandai flag local ala S21 agar badge Sync menampilkannya
  // sebagai "lokal", bukan antre-selamanya. Hanya relevan untuk antrean
  // ringan warisan — enqueueOutbox tak lagi membuat twin ringan ms_*.
  const itemTable = String((item.payload as { table?: unknown })?.table ?? '');
  if (itemTable.startsWith('ms_')) {
    item.local = true;
    item.note = tr('sync.masterQueued');
    return 'skipped';
  }
  // kind "other" tanpa endpoint yang cocok: bedakan cermin-lokal /
  // deposit-lokal (tandai terkirim, bukan antre selamanya) dari yang
  // benar-benar menunggu endpoint (tetap antre + tercatat fisik).
  const rawPayloadEarly = (item.payload ?? {}) as Record<string, unknown>;
  // HP-E2E-FIX (2026-10-24, E2E HP Xiaomi): absensi + shift-legacy TANPA
  // padanan Go → finalkan lokal pola LOCAL_OPS/'terkirim' (bukan antre,
  // bukan gagal, tak trip breaker S4):
  // - kind 'attendance' (clock-in/out): offline-only eksplisit S9/PP-010 —
  //   endpoint BE clock-in/out mencatat AUTH-USER (titip-absen tak terpetakan)
  //   + grup /api/merchant memakai MerchantAuth (bukan token sesi kasir).
  //   Legacy ESB employee-attendance/(...) 404 vs Go.
  // - kind 'other' op 'shift-*' (shift-open/shift-close legacy): data shift
  //   dibawa W1 be-cash-open/be-cash-close ke Go workforce; item legacy ini
  //   ganda + ESB-nya (v1/push/shift) 404 vs Go.
  // 'skipped' + flag local → SyncScreen menampilkannya sebagai lokal
  // ("Hanya di perangkat ini"); drain lanjut ke item berikut (sale, W1/W2)
  // sehingga lastSyncMs bisa segar kembali dan gate E00044 terbuka jujur.
  if (
    item.kind === 'attendance' ||
    (item.kind === 'other' && String(rawPayloadEarly.op ?? '').startsWith('shift-')) ||
    (item.kind === 'other' &&
      String((rawPayloadEarly as { table?: unknown }).table ?? '') === 'tr_shiftlog')
  ) {
    // HP-E2E-FIX-2: twin ringan tr_shiftlog dari enqueueOutbox (payload
    // {table:'tr_shiftlog', op:'insert', ...}) tak punya padanan Go (shift
    // dibawa W1 ke workforce/cash-sessions; jalur fisiknya 404/skipped) —
    // finalkan lokal agar tak 'gagal' TIAP push.
    item.status = 'terkirim';
    item.local = true;
    item.note = tr('sync.localOnly');
    return 'skipped';
  }
  // HP-E2E (2026-10-26): twin ringan expense (op insert/update layar
  // Expense/PettyCash) → handoff terminal Go via drainExpenseToTerminal
  // (cermin drain fisik pushExpensePhysicalRow). Path legacy ESB
  // (v1/push/branch-expenses) 404 vs Go. Sukses = 'terkirim'; gagal =
  // 'gagal' jujur (retry — offline/transien adalah kasus utamanya).
  // Op expense-approve/expense-unapprove tak tersentuh (tanpa padanan BE).
  if (
    item.kind === 'other' &&
    itemTable === 'tr_branchexpense' &&
    (String(rawPayloadEarly.op ?? '') === 'insert' || String(rawPayloadEarly.op ?? '') === 'update')
  ) {
    const expRowId = String((rawPayloadEarly as { rowId?: unknown }).rowId ?? '').trim();
    if (await drainExpenseToTerminal(expRowId)) {
      item.status = 'terkirim';
      item.note = 'posWire: expense terkirim (idempoten)';
      return 'sent';
    }
    item.status = 'gagal';
    item.note = 'posWire: expense gagal (retry)';
    return 'failed';
  }
  // GO-POS COMPAT: sale-create diterjemahkan ke body bentuk-POS
  // (orderType/items/clientId-displayNo) menuju api/merchant/orders/pos;
  // group-payment dengan identitas server menuju group-bill/payments.
  // null = tanpa padanan backend → path ESB apa adanya (dilaporkan).
  const compat = toGoPosRequest(item.kind, rawPayloadEarly, item.id);
  // C2: orderType tak didukung merchant-type (BE pasti menolak) — BLOCKED
  // jujur fail-once pola S10: 'gagal' + catatan SEKALI, siklus berikut
  // skipped agar hitungan gagal/breaker tak bertambah tiap push. Bukan
  // 'skipped' langsung: kaki sale lokal tetap kotor (syncDate NULL) + kartu
  // Sync jujur menampilkan gagal + alasan (butuh tindakan/BE).
  if (compat && 'unsupported' in compat) {
    if (item.status === 'gagal') return 'skipped';
    item.status = 'gagal';
    item.note = (compat as { unsupported: string }).unsupported;
    return 'failed';
  }
  const path = compat ? compat.path : pathFor(item.kind, item.payload);
  // C8: kaki group-payment TANPA identitas server ({orderId, shareId} — app
  // tak pernah membuat group-bill shares) = ops-tanpa-padanan Go. Tanpa
  // cabang ini ia jatuh ke fallback pushOrderFinish ESB lalu 'gagal' TIAP
  // siklus (retry-buta + men-trip breaker drain 3-gagal-beruntun). BLOCKED
  // jujur fail-once pola S10: 'gagal' + catatan SEKALI, siklus berikut
  // skipped sehingga legs grup tak trip breaker. Deposit tak tersentuh
  // (kind/op berbeda; kunci-tunggal DEPOSIT-SINGLE-POST lestari di bawah).
  if (!compat && item.kind === 'order') {
    const gop = String(((item.payload ?? {}) as { op?: unknown }).op ?? '');
    if (gop === 'group-payment') {
      if (item.status === 'gagal') return 'skipped';
      item.status = 'gagal';
      item.note = tr('sync.groupLegNoCounterpart');
      return 'failed';
    }
  }
  if (!path) {
    const p = (item.payload ?? {}) as { op?: unknown; kind?: unknown; type?: unknown };
    const op = String(p.op ?? '');
    const k = String(p.kind ?? '');
    const tp = String(p.type ?? '');
    if (LOCAL_OPS.has(op) || LOCAL_OPS.has(tp) || DEPOSIT_LOCAL_KINDS.has(k)) {
      item.status = 'terkirim';
      // S21: penanda lokal-only untuk badge SyncScreen.
      item.local = true;
      item.note = tr(op || tp ? 'sync.localOnly' : 'sync.depositLocal');
      return 'skipped';
    }
    // W2 (wiring-2): op merchant Go punya drain sendiri (POST via
    // apiPostWithTimeout, PUT via apiPutWithTimeout). 409 replay/sudah-ada =
    // 'terkirim' (idempoten); 4xx berkode = final fail-once (S10, tak trip
    // breaker); jaringan/5xx/timeout = 'failed' (retry). 'gagal' jujur
    // membawa kode agar SyncScreen menampilkan alasan.
    const goWrap = goMerchantOp(item);
    if (goWrap && 'blocked' in goWrap) {
      if (item.status === 'gagal') return 'skipped';
      item.status = 'gagal';
      item.note = goWrap.blocked;
      return 'failed-once';
    }
    if (goWrap) {
      const go = goWrap as GoMerchantOp;
      let goRes: Response;
      try {
        goRes = go.method === 'PUT'
          ? await apiPutWithTimeout(go.path, go.body, { idempotencyKey: go.idemKey })
          : await apiPostWithTimeout(go.path, go.body, { idempotencyKey: go.idemKey });
      } catch {
        item.status = 'gagal';
        item.note = 'posWire: jaringan/timeout (retry)';
        return 'failed';
      }
      if (goRes.status === 409) {
        const cb = await readConflictBody(goRes);
        if (isReplaySuccess(cb)) {
          item.status = 'terkirim';
          item.note = 'posWire: replay/sudah-ada (idempoten)';
          try {
            const sNo = String(((item.payload ?? {}) as { salesNum?: unknown }).salesNum ?? '').trim();
            if (sNo) await markCleanSale(sNo);
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
        const be409 = beErrorOf(cb);
        item.status = 'gagal';
        item.note = `posWire: 409 ${be409.code || be409.message || 'konflik'}`.slice(0, 160);
        return 'failed-once';
      }
      if (goRes.ok) {
        item.status = 'terkirim';
        item.note = '';
        try {
          const sNo = String(((item.payload ?? {}) as { salesNum?: unknown }).salesNum ?? '').trim();
          if (sNo) await markCleanSale(sNo);
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
      if (goRes.status >= 500 || goRes.status === 429 || goRes.status === 0) {
        item.status = 'gagal';
        item.note = `posWire: HTTP ${goRes.status} (retry)`;
        return 'failed';
      }
      let beBody: unknown = null;
      try {
        beBody = (await goRes.json()) as unknown;
      } catch {
        beBody = null;
      }
      const be = beErrorOf(beBody);
      // BILLING (2026-10-29): 402 deposit habis = retry (tunggu topup owner),
      // bukan fail-once — antre offline harus flush otomatis pasca-topup.
      if (goRes.status === 402 || be.code === 'INSUFFICIENT_DEPOSIT') {
        item.status = 'gagal';
        item.note = `posWire: ${be.code || 402}${be.message ? ` — ${be.message}` : ''} (retry)`.slice(0, 160);
        return 'failed';
      }
      item.status = 'gagal';
      // P1-1: PIN supervisor live-only — antrean REFUND/CANCEL/VOID/STATUS
      // TAK pernah membawa PIN (goMerchantOp membangun body per-field tanpa
      // pin). A-P1-4: pengecualian SEMATA GO_OP_SETTLE — antrean BOLEH
      // membawa pin yang dikumpulkan via ManagerPinPrompt (transport-only).
      // Bila server menuntut PIN untuk op antrean (setelan berubah tengah
      // antre, atau PIN salah) = gagalkan jujur sekali: kasir ulangi aksi
      // secara live + PIN.
      item.note = (/^(PIN_REQUIRED|SUPERVISOR_PIN_)/.test(be.code)
        ? `posWire: ${be.code} — butuh PIN supervisor, ulangi live`
        : `posWire: ${be.code || goRes.status}${be.message ? ` — ${be.message}` : ''}`).slice(0, 160);
      return 'failed-once';
    }
    // W1 (SESI-FIX-APPW1): drain shift/kas/tutup-hari. Pola hasil cermin W2
    // di atas; beda: replay-code W1 sendiri (W1_REPLAY_RE) + alih 409
    // OPEN_POS_ORDERS pada tutup-kas ke pending-close (bukan hilang — kasir
    // selesaikan order dulu, flushPendingCashCloses() mengulanginya) +
    // {retry} tanpa-sesi = 'failed' (tunggu open FIFO, bukan fail-once).
    const wfWrap = await goWorkforceOp(item);
    if (wfWrap && ('blocked' in wfWrap || 'retry' in wfWrap)) {
      if (item.status === 'gagal') return 'skipped';
      item.status = 'gagal';
      if ('retry' in wfWrap) {
        item.note = (wfWrap as { retry: string }).retry;
        return 'failed';
      }
      item.note = (wfWrap as { blocked: string }).blocked;
      return 'failed-once';
    }
    if (wfWrap) {
      const wf = wfWrap as GoWorkforceOp;
      let wfRes: Response;
      try {
        wfRes = await apiPostWithTimeout(wf.path, wf.body, { idempotencyKey: wf.idemKey });
      } catch {
        item.status = 'gagal';
        item.note = 'beWorkforce: jaringan/timeout (retry)';
        return 'failed';
      }
      if (wfRes.status === 409) {
        const cb = await readConflictBody(wfRes);
        if (isReplaySuccess(cb) || W1_REPLAY_RE.test(beErrorOf(cb).code)) {
          item.status = 'terkirim';
          item.note = 'beWorkforce: replay/sudah-ada (idempoten)';
          try {
            if (wf.onSent) await wf.onSent(cb);
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
        const be409 = beErrorOf(cb);
        if (wf.isCashClose && be409.code === 'OPEN_POS_ORDERS') {
          // Alih ke pending-close: order belum lunas di sesi ini. Item fail-once
          // ber-note (bukan antre-selamanya); tutup diulang eksplisit via flush.
          try {
            const bp = (item.payload ?? {}) as Record<string, unknown>;
            await recordPendingCashClose({
              sessionId: wf.sessionId ?? '',
              actualCash: Math.max(0, Math.round(Number(bp.actualCash) || 0)),
              note: typeof bp.note === 'string' && bp.note.trim() ? bp.note.trim().slice(0, 500) : null,
              at: new Date().toISOString(),
            });
          } catch {
            /* abaikan */
          }
          item.status = 'gagal';
          item.note = 'beWorkforce: 409 OPEN_POS_ORDERS -> pending-close (selesaikan order dulu)';
          return 'failed-once';
        }
        item.status = 'gagal';
        item.note = `beWorkforce: 409 ${be409.code || be409.message || 'konflik'}`.slice(0, 160);
        return 'failed-once';
      }
      if (wfRes.ok) {
        let sentBody: unknown = null;
        try {
          sentBody = (await wfRes.json()) as unknown;
        } catch {
          sentBody = null;
        }
        try {
          if (wf.onSent) await wf.onSent(sentBody);
        } catch {
          /* abaikan */
        }
        item.status = 'terkirim';
        item.note = '';
        try {
          await setWatermark(itemTable || item.kind, { push: new Date().toISOString() });
        } catch {
          /* abaikan */
        }
        return 'sent';
      }
      if (wfRes.status >= 500 || wfRes.status === 429 || wfRes.status === 0) {
        item.status = 'gagal';
        item.note = `beWorkforce: HTTP ${wfRes.status} (retry)`;
        return 'failed';
      }
      let wfBody: unknown = null;
      try {
        wfBody = (await wfRes.json()) as unknown;
      } catch {
        wfBody = null;
      }
      const wbe = beErrorOf(wfBody);
      item.status = 'gagal';
      item.note = `beWorkforce: ${wbe.code || wfRes.status}${wbe.message ? ' - ' + wbe.message : ''}`.slice(0, 160);
      return 'failed-once';
    }
    // S10: kind 'other' tanpa endpoint (kontrak BE menyusul) — finalkan
    // 'gagal' SEKALI dengan catatan, bukan antre-selamanya. Siklus berikut
    // dilewati (skipped) agar hitungan gagal tak bertambah tiap push.
    // Legacy ms_* (return lebih awal di atas) tak tersentuh.
    // C8: 'failed-once' (bukan 'failed') — guard pra-ESB ini tak menyentuh
    // transport, jadi drain tak boleh menghitungnya ke breaker consecFails
    // (kaki group-payment counterpart-less dkk tak menjeda drain).
    if (item.status === 'gagal') return 'skipped';
    item.status = 'gagal';
    item.note = tr('sync.masterQueued');
    return 'failed-once';
  }
  try {
    // C1: client_id sale JANGAN PERNAH ditimpa id antrean. buildSalePayload
    // (payments.ts) membawa kunci upsert server (clientId/client_id UUIDv7
    // rantai Pay→Qris/Edc); menimpanya dengan id outbox memutus rekonsiliasi
    // + membuat retry melahirkan sale ganda di server. Hanya isi bila payload
    // belum punya; id antrean dibawa terpisah sebagai outboxId (idempotency
    // key header tetap = item.id, tak berubah).
    // GO-POS COMPAT: basis body = hasil terjemahan bila ada (bentuk-POS),
    // jika tidak payload ESB mentah; gabung identitas + idempotency di bawah
    // berlaku untuk keduanya (displayNo selalu berpasangan dengan clientId
    // final — syarat parsePOSSaleIdentity backend).
    const rawPayload = compat ? compat.body : ((item.payload ?? {}) as Record<string, unknown>);
    const saleCid = String(rawPayload.client_id ?? rawPayload.clientId ?? '').trim();
    // DEPOSIT-SINGLE-POST: light generik {table:'tr_memberdeposit',rowId,op}
    // (warisan enqueueOutbox) tak membawa clientId — pakai rowId (=deposit key
    // `dep-…`, sama dengan ledger id + fisik orderID) sebagai identitas klien
    // agar satu kunci dengan POST langsung + fisik. Header Idempotency-Key
    // tetap item.id (tak berubah). Logika sale C1 di atas tak tersentuh: sale
    // tak pernah bertable tr_memberdeposit, dan light 'deposit-topup' baru
    // sudah membawa clientId=key sehingga saleCid menang lebih dulu.
    const depositRowId =
      String(rawPayload.table ?? '') === 'tr_memberdeposit'
        ? String(rawPayload.rowId ?? '').trim()
        : '';
    const lightCid = saleCid || depositRowId;
    const sender = identityFields(lightCid || item.id);
    const body: Record<string, unknown> = lightCid
      // Touchup: normalisasi kunci campuran — BOTH clientId + client_id = lightCid
      // (uuid = lightCid tetap) agar server/campur-casing baca kunci yang sama.
      ? { ...rawPayload, ...sender, clientId: lightCid, client_id: lightCid, uuid: lightCid, outboxId: item.id }
      : { ...rawPayload, clientId: item.id, ...sender, outboxId: item.id };
    // Nomor display lokal (untuk pembersihan kaki sale + re-issue): payload
    // tak pernah dimutasi — retry memakai salinan sendBody agar nomor lokal
    // (struk/QR/DB) tetap, sedangkan yang dikirim ke server bisa baru.
    const origSalesNum = String(
      ((item.payload ?? {}) as { salesNum?: unknown }).salesNum ?? '',
    ).trim();
    let sendBody = body;
    // GAP-1: timeout abort eksplisit (cermin pushPhysicalRow di atas).
    let res = await apiPostWithTimeout(
      path,
      sendBody,
      { idempotencyKey: item.id },
    );
    let reissues = 0;
    let lastCode = '';
    // 409 = display_no dipakai order lain (server TAK punya baris kita):
    // terbitkan display_no segar via nextSalesNumRetry + kirim ulang dengan
    // client_id YANG SAMA (maks MAX_DISPLAY_REISSUES re-issue; habis itu
    // 'gagal' jujur — tak pernah 'terkirim'). Duplikat client_id tak sampai
    // sini: backend menjawab 200 "Order already synced" (jalur 2xx di bawah).
    // Re-issue hanya untuk payload sale (membawa salesNum/displayNo);
    // non-sale (deposit/shift/voucher/…) tak punya display_no → langsung gagal
    // jujur agar tak retry buta.
    while (res.status === 409) {
      const conflict = classify409(await readConflictBody(res), lightCid || item.id);
      lastCode = conflict.code;
      if (conflict.kind === 'duplicate') {
        // Server SUDAH punya item ini (client_id sama). Anggap terkirim
        // (duplicate-acked, terlihat di note) agar tak antre-selamanya.
        item.status = 'terkirim';
        item.note = tr('sync.duplicateAcked');
        try {
          // Server punya datanya → kaki sale ikut bersih (paritas 2xx).
          if (origSalesNum && (item.kind === 'order' || String((item.payload as { op?: unknown } | null)?.op ?? '') === 'group-payment')) {
            await markCleanSale(origSalesNum);
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
      const canReissue =
        conflict.kind === 'display' &&
        reissues < MAX_DISPLAY_REISSUES &&
        ('salesNum' in sendBody || 'displayNo' in sendBody);
      if (!canReissue) break;
      let fresh: string;
      try {
        fresh = await nextSalesNumRetry(2);
      } catch (e) {
        item.status = 'gagal';
        item.note = tr('sync.displayRenumberFailed').replace('{code}', lastCode || '?').replace('{err}', e instanceof Error ? e.message : 'galat');
        return 'failed';
      }
      reissues += 1;
      sendBody = { ...sendBody, displayNo: fresh };
      if ('salesNum' in sendBody) sendBody = { ...sendBody, salesNum: fresh };
      // GAP-1: retry re-issue ikut timeout yang sama (bukan tanpa batas).
      res = await apiPostWithTimeout(
        path,
        sendBody,
        { idempotencyKey: item.id },
      );
    }
    if (res.status === 409) {
      // Re-issue habis, 409 non-sale, atau kode tak dikenal: server tak punya
      // baris kita → 'gagal' jujur dengan kode, tak pernah 'terkirim'.
      item.status = 'gagal';
      item.note = tr('sync.displayConflict').replace('{code}', lastCode || '?');
      return 'failed';
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Sukses 2xx = tandai terkirim agar tak dikirim ulang tiap pushAll
    // (sebelumnya hanya 409 yang menandai → kirim-ganda ke server).
    // Duplikat client_id tiba di sini sebagai 200 "Order already synced"
    // (bukan 409) → ikut terkirim. Terverifikasi: tak perlu cabang khusus.
    item.status = 'terkirim';
    item.note = '';
    // HP-E2E-SETTLE (2026-10-25): tautkan order server kembali ke sale lokal.
    // Sebelumnya create 'terkirim' TANPA menyimpan id server → tautan
    // getServerOrderIdForSale() null selamanya → mirrorSettleToServer BLOCKED
    // → order BE PENDING walau kasir sudah lunas. Kini: tulis onlineOrderId +
    // antre GO_OP_SETTLE SEKALI (idempoten: idemKey = clientId sale; replay
    // 409 BE = 'terkirim'). Best-effort: gagal taut = create tetap terkirim.
    try {
      const lp = (item.payload ?? {}) as {
        op?: unknown; salesNum?: unknown; method?: unknown;
        grandTotal?: unknown; total?: unknown; tipTotal?: unknown;
        voucherCode?: unknown; approvalCode?: unknown;
        payments?: Array<{ approvalCode?: unknown }>;
      };
      const linkNo = String(lp.salesNum ?? '').trim();
      if (item.kind === 'order' && !String(lp.op ?? '') && linkNo) {
        let linkId = 0;
        try {
          const raw = (await res.json()) as { data?: unknown } | null;
          const inner =
            raw && typeof raw === 'object'
              ? ((raw.data ?? raw) as Record<string, unknown>)
              : ({} as Record<string, unknown>);
          const cand =
            inner.id ?? inner.orderId ?? (inner.order as { id?: unknown } | undefined)?.id;
          const n = typeof cand === 'number' ? cand : parseInt(String(cand ?? ''), 10);
          if (Number.isFinite(n) && n > 0) linkId = n;
        } catch {
          /* abaikan */
        }
        if (linkId > 0) {
          try {
            await run('UPDATE tr_saleshead SET onlineOrderId = ? WHERE salesNum = ?', [
              String(linkId),
              linkNo,
            ]);
          } catch {
            /* abaikan */
          }
          const beMethod = mapPayMethodToBe(lp.method);
          const amt = Math.max(0, Math.round(Number(lp.grandTotal ?? lp.total) || 0));
          if (beMethod && amt > 0) {
            const hasSettle = outbox.some(
              (o) =>
                o.status !== 'terkirim' &&
                String(((o.payload ?? {}) as { op?: unknown }).op ?? '') === GO_OP_SETTLE &&
                String(((o.payload ?? {}) as { salesNum?: unknown }).salesNum ?? '') === linkNo,
            );
            if (!hasSettle) {
              try {
                const tipN = Math.round(Number(lp.tipTotal) || 0);
                const vch = String(lp.voucherCode ?? '').trim();
                // APP-9: ref kaki (transfer "Mark as Paid", EDC approval)
                // ikut sebagai notes settle → payments.notes/metadata BE.
                const legs = Array.isArray(lp.payments) ? lp.payments : [];
                const ref = String(
                  (legs[0] ?? {}).approvalCode ?? lp.approvalCode ?? '',
                ).trim();
                enqueueSync('other', {
                  op: GO_OP_SETTLE,
                  serverId: linkId,
                  method: beMethod,
                  amountPaid: amt,
                  ...(tipN > 0 ? { tipAmount: tipN } : {}),
                  ...(vch ? { voucherCode: vch.slice(0, 64) } : {}),
                  ...(ref ? { notes: ref.slice(0, 500) } : {}),
                  ...(lightCid ? { clientId: lightCid } : {}),
                  salesNum: linkNo,
                  at: new Date().toISOString(),
                });
              } catch {
                /* abaikan */
              }
            }
          }
        }
      }
    } catch {
      /* abaikan */
    }
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

/** Baris local-only M9-3 (status 'lokal', ms_* tanpa endpoint push). */
export interface LocalOnlyRow {
  id: string;
  tableName: string;
  op: string;
  rowId: string;
  createdAt: string;
}

/** Jumlah baris local-only — tampil di SyncScreen, tak masuk badge pending. */
export async function countLocalOnly(): Promise<number> {
  try {
    const row = await queryFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tr_esoprocessqueue WHERE status = 'lokal'`,
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Daftar baris local-only terbaru (maks 50) untuk kartu SyncScreen. */
export async function listLocalOnly(limit = 50): Promise<LocalOnlyRow[]> {
  try {
    const n = Math.max(1, Math.min(200, Math.floor(limit) || 50));
    const rows = await all<{ id: string; tableName: string | null; op: string | null; orderID: string | null; createdAt: string | null }>(
      `SELECT id, tableName, op, orderID, createdAt FROM tr_esoprocessqueue
       WHERE status = 'lokal' ORDER BY createdAt DESC LIMIT ${n}`,
    );
    return rows.map((r) => ({
      id: String(r.id ?? ''),
      tableName: String(r.tableName ?? ''),
      op: String(r.op ?? ''),
      rowId: String(r.orderID ?? ''),
      createdAt: String(r.createdAt ?? ''),
    }));
  } catch {
    return [];
  }
}

/**
 * C9 (SESI-C): retensi baris 'lokal' esoprocessqueue — status terminal yang
 * informatif (kartu SyncScreen, maks 200 via listLocalOnly) tapi TAK PERNAH
 * dihapus drain (bukan antre/bukan gagal/bukan terkirim) sehingga tumbuh tanpa
 * batas. Pangkas ke `keep` terbaru (default 200 = jendela tampil penuh);
 * baris antre/gagal/terkirim TAK tersentuh. Best-effort, tak pernah melempar
 * (dipanggil tiap akhir pushAll).
 */
export async function pruneLocalOnly(keep = 200): Promise<number> {
  try {
    const n = Math.max(50, Math.min(1000, Math.floor(keep) || 200));
    // Tanpa initDb eksplisit (konvensi berkas ini — pushAll sudah menyentuh DB
    // via fetchPhysicalRows sebelum prune dipanggil).
    await run(
      `DELETE FROM tr_esoprocessqueue WHERE status = 'lokal' AND id NOT IN (
         SELECT id FROM tr_esoprocessqueue WHERE status = 'lokal'
         ORDER BY createdAt DESC LIMIT ${n}
       )`,
    );
    const row = await queryFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tr_esoprocessqueue WHERE status = 'lokal'`,
    );
    return row?.n ?? 0;
  } catch {
    return -1;
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

/**
 * S18: kirim utang revoke logout (O1/SPEC §7) via E06 logoutRevoke, lalu
 * bersihkan slot sync + session yang sudah dikonfirmasi server. Best-effort:
 * tak pernah melempar; yang gagal tetap pending untuk siklus berikut.
 * Dipanggil di akhir pushAll yang sukses; pemilik boot/login memanggil
 * langsung juga (diekspos agar layar di luar cakupan bisa memicu).
 */
export async function flushPendingRevokes(): Promise<void> {
  try {
    const jobs: { sessionId?: string; userId?: string }[] = [];
    try {
      for (const s of await getPendingRevoke()) {
        if (s) jobs.push({ sessionId: s });
      }
    } catch {
      /* abaikan */
    }
    let sessionSid = '';
    let sessionUid = '';
    let sessionMarkMs = 0;
    try {
      const sp = getSessionPendingRevoke();
      sessionSid = sp?.sessionId ?? '';
      sessionUid = sp?.userId ?? '';
      const mk = Date.parse(String(sp?.markedAt ?? ''));
      if (Number.isFinite(mk)) sessionMarkMs = mk;
      // HP-E2E-FIX-4 (2026-10-24, E2E HP Xiaomi): tanda revoke milik sesi LAMA
      // (ditandai sebelum login sesi berjalan) TIDAK BOLEH di-flush dengan
      // token sesi BARU — BE terminal-logout mengabaikan field
      // sessionId/userId dan me-revoke sesi BEARER (terminalApi.ts), sehingga
      // flush basi = bunuh diri sesi baru (login→flush→revoke→kick→tandai
      // lagi = lockout login permanen; terbukti id5 ACTIVE→REVOKED 1 detik
      // sesudah pin-verify). Tanda basi dibuang tanpa panggil jaringan: sesi
      // lama (bila masih ACTIVE server-side) bocor sampai kedaluwarsa — trade-
      // off diterima dan dicatat; pencabutan saat logout online (DrawerMenu E31
      // best-effort) tetap jalan bila jaringan tersedia saat itu. Tanpa sesi
      // berjalan (current null, mis. flush pushAll pasca-logout) guard nonaktif
      // — tanpa token tak ada bunuh diri yang mungkin (401 jujur, tetap pending).
      try {
        const cur = getCurrentSession();
        const loginMs = Date.parse(String(cur?.loginAt ?? ''));
        if (cur && Number.isFinite(loginMs) && sessionMarkMs > 0 && sessionMarkMs < loginMs) {
          try {
            clearSessionPendingRevoke();
          } catch {
            /* abaikan */
          }
          sessionSid = '';
          sessionUid = '';
        }
      } catch {
        /* abaikan — anggap tidak basi, perilaku lama dipertahankan */
      }
      if (sessionSid && !jobs.some((j) => j.sessionId === sessionSid)) {
        jobs.push({ sessionId: sessionSid });
      }
      // Slot session tanpa sessionId (hanya userId, mis. dari logout lokal).
      if (sessionUid && !sessionSid) jobs.push({ userId: sessionUid });
    } catch {
      /* abaikan */
    }
    if (jobs.length === 0) return;
    for (const job of jobs) {
      try {
        const r = await logoutRevoke(job);
        if (!r.ok) continue; // tetap pending — coba lagi siklus berikut
        if (job.sessionId) {
          try {
            await clearPendingRevoke(job.sessionId);
          } catch {
            /* abaikan */
          }
        }
        if (job.sessionId === sessionSid || (job.userId && job.userId === sessionUid)) {
          try {
            clearSessionPendingRevoke();
          } catch {
            /* abaikan */
          }
        }
      } catch {
        /* tetap pending — coba lagi siklus berikut */
      }
    }
  } catch {
    /* tak pernah melempar */
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

export async function enqueueOutboxWithPayload(
  table: string,
  rowId: string,
  op: OutboxOp,
  extraPayload: Record<string, unknown>,
): Promise<void> {
  // P0-02: simpan baseQty/baseUpdatedAt di payload fisik agar drain kirim optimistic-lock benar.
  try {
    const { uuidv7 } = await import('./uuidv7');
    const { run, queryFirst } = await import('./db');
    void queryFirst;
    await run(
      `INSERT INTO tr_esoprocessqueue (id, orderID, serverID, tableName, op, payload, status, createdAt)
       VALUES (?, ?, '', ?, ?, ?, 'antre', ?)`,
      [uuidv7(), rowId, table, op, JSON.stringify({ table, rowId, op, ...extraPayload }), new Date().toISOString()],
    );
    try { await markDirty(table, rowId); } catch { /* abaikan */ }
    if (!table.startsWith('ms_')) { try { enqueueSync('other', { table, rowId, op }); } catch { /* abaikan */ } }
    return;
  } catch { /* fallback ke jalur biasa */ }
  await enqueueOutbox(table, rowId, op);
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
  // Opsi A: fisik ms_branchmenu DIKURAS via pushBranchMenuPhysicalRow
  // (endpoint terminal khusus); ms_* lain tetap 'lokal' di drain.
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
//
// P2 roadmap (tanpa dep baru): WorkManager (Android)/BGTask (iOS) untuk antrean >0 saat background.
  // Jalur Expo: expo-task-manager + expo-background-fetch (opsional, belum dipasang agar bundle tetap kecil).
  // Sampai dipasang, foreground-only + EFF-09 skip (antrean 0) + banner block7/warn3 adalah perilaku jujur.
// SYNC-03 (C12, batas jujur — BUKAN background sync): timer ini HANYA hidup
// saat app foreground (JS timer suspend saat layar mati; repo ini SENGAJA
// tanpa TaskManager/BackgroundFetch — tak ada klaim "sync saat screen mati").
// Timing jujur: lastSyncMs HANYA ditulis pushAll yang sukses (pullMaster tak
// menyentuh); notifikasi/teks sukses HANYA bila sent>0 (notifyPushSyncSuccess
// di bawah); umur sync dihitung dari sumber yang sama (SyncScreen).
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
        // EFF-09 gate: tanpa antrean pending = lewati pushAll (hemat
        // baterai/radio). Antrean ringan via pendingCount; antrean fisik
        // (tr_esoprocessqueue) via COUNT — keduanya nol = diam.
        try {
          if (pendingCount() === 0) {
            let physical = 1;
            try {
              await initDb();
              const r = await queryFirst<{ n: number }>(
                `SELECT COUNT(*) AS n FROM tr_esoprocessqueue WHERE status = 'antre'`,
              );
              physical = Number(r?.n) || 0;
            } catch {
              physical = 1; // DB belum siap — anggap ada agar tak menahan sync
            }
            if (physical === 0) return;
          }
        } catch {
          /* gate best-effort — lanjut pushAll */
        }
        await pushAll();
      } catch {
        /* diam: coba lagi interval berikut */
      }
    })();
  }, 5 * 60 * 1000);
}

/** Kunci preferensi sync otomatis (satu sumber — dipakai SyncScreen). */
export const SYNC_OPTS_KEY = 'genfity.sync.opts';

/**
 * SYNC-02 (C12, SESI-C): pulihkan timer auto-sync dari preferensi tersimpan.
 * Sebelumnya timer HANYA dinyalakan saat SyncScreen dibuka — pasca-restart
 * auto-sync mati diam-diam meski toggle ON. Panggil sekali saat boot (App.tsx,
 * setelah restore sesi) + tiap login sukses (LoginScreen, samping
 * startRealtime) agar interval 5 menit benar-benar berjalan. Idempoten
 * (applyAutoSyncPrefs membersihkan timer lama). Best-effort, tak melempar.
 */
export async function restoreAutoSyncPrefs(): Promise<void> {
  try { const { registerBackgroundSync } = await import('./backgroundSync'); void registerBackgroundSync().catch(() => {}); } catch { /* modul bg tak terpasang = foreground-only */ }
  try {
    const o = await getJSON<{ autoSync: boolean; syncOnWifi: boolean }>(
      SYNC_OPTS_KEY,
      { autoSync: true, syncOnWifi: false },
    );
    // Audit 2026-10-26: opsi wifi-only dihapus — pulihkan selalu ke jaringan
    // apa pun (abaikan simpanan syncOnWifi lama agar tak mengunci wifi).
    applyAutoSyncPrefs({ auto: o.autoSync !== false, wifiOnly: false });
  } catch {
    /* preferensi tak terbaca — timer tetap mati, SyncScreen yang menyalakan */
  }
}

/** P2: ringkasan lag sync untuk dashboard FE operational-review (tanpa network). */
export async function getSyncLagSummary(): Promise<{ pending: number; dirty: number; lastMs: number; level: string }> {
  try {
    hydrate();
    const pending = outbox.filter((o) => o.status === 'antre' || o.status === 'gagal').length;
    let dirty = 0;
    try { dirty = await countDirtyRows(); } catch { /* abaikan */ }
    const lastMs = lastSyncMs || Date.parse(lastSync) || 0;
    return { pending, dirty, lastMs, level: syncWarnLevel() };
  } catch { return { pending: 0, dirty: 0, lastMs: 0, level: 'block7' }; }
}

// P2 Sentry roadmap (tanpa dep baru): bungkus drain/pushAll/pullMaster dengan captureException bila DSN terisi.
// Sampai DSN dipasang, tr_applog + LogScreen + readiness + syncWarnLevel adalah observability jujur (tanpa klaim crash-reporting).
// Jangan kirim PII (PIN/token) ke crash-report — scrub authToken/authKey/clientId sebelum kirim.
