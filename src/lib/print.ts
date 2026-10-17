import { Alert, Platform } from 'react-native';
import { buildKitchenTicketBytes, buildQueueSlipBytes, buildReceiptBytes, type EscKitchenTicket, type EscQueueSlip, type EscReceipt } from './escpos';
import { getTerminal } from '../config/server';
import { getJSON } from './storage';
import { openCashDrawer, printBytes, type PrinterTarget } from '../native/printer';
import { getBinding, getSessionTag } from '../session';
import { drainPrintQueue, enqueuePrint, type QueuedPrintKind } from './printqueue';

export type PrintOutcome =
  | { ok: true; bytes: number; printer: string }
  // `queued` = byte aman di `tr_printqueue` (offline/printer putus), BUKAN
  // sudah keluar kertas. Layar yang bisa diedit (ReceiptScreen) menampilkan
  // status pending dari flag ini; penjaga lama (`res.ok && res.bytes > 0`)
  // tetap tidak menaikkan printedCount / menendang laci untuk job antre.
  | { ok: false; reason: 'no-printer' | 'need-dev-client' | 'connect-failed' | 'send-failed'; detail?: string; queued?: true; queuedId?: string };

interface StoredStation {
  id: string;
  name: string;
  role: string;
  conn: 'Bluetooth' | 'LAN' | 'Star';
  address: string;
  /** Lebar kertas station (32/48) — diteruskan ke builder ESC/POS. */
  cpl?: 32 | 48;
  isDefault?: boolean;
  connected?: boolean;
  /**
   * Binding terminal (APP-PRINTER, audit row 11): station = address book yang
   * diikat ke satu terminalCode (+branchId via PrintersScreen). Tanpa binding
   * = warisan global, tetap bisa dipakai semua terminal (fallback).
   * 1 device = 1 terminal = 1 printer: printer aktif = station terikat
   * terminal klaim device ini.
   */
  terminalCode?: string;
  branchId?: string;
}

const LS_STATIONS = 'genfity.printer.stations';

/**
 * Petakan satu station tersimpan ke target kirim (BT MAC / BLE `BLE:MAC` /
 * LAN IP:port / USB VID/PID).
 */
function targetOf(d: StoredStation): PrinterTarget | null {
  if (d.conn === 'LAN') {
    const [host, portRaw] = d.address.split(':');
    const h = (host ?? '').trim();
    if (!h) return null;
    return { transport: 'lan', host: h, port: Number(portRaw ?? 9100) || 9100 };
  }
  if (d.conn === 'Star') {
    const m = d.address.match(/(\d+)\s*\/\s*(\d+)/);
    return {
      transport: 'usb',
      vendorId: m ? Number(m[1]) : 0,
      productId: m ? Number(m[2]) : 0,
    };
  }
  const addr = d.address.trim();
  if (!addr) return null;
  // Konvensi UI: alamat diawali `BLE:` = printer thermal BLE (Nordic UART).
  if (addr.toUpperCase().startsWith('BLE:')) {
    const mac = addr.slice(4).trim();
    if (!mac) return null;
    return { transport: 'ble', address: mac };
  }
  return { transport: 'bt', address: addr };
}

/**
 * Terminal aktif (APP-PRINTER, audit row 11): seleksi printer di-scope ke
 * {branchId, terminalCode} klaim device ini. Station terikat terminal itu
 * menang; station warisan tanpa binding = fallback global.
 */
function activeScope(): { branchId: string; terminalCode: string } {
  try {
    const t = getTerminal();
    return {
      branchId: String(t.branchId ?? '').trim(),
      terminalCode: String(t.terminalCode ?? '').trim().toUpperCase(),
    };
  } catch {
    return { branchId: '', terminalCode: '' };
  }
}

/** 0 = terikat terminal aktif, 1 = warisan tanpa binding, 2 = milik terminal lain. */
function scopeRank(s: StoredStation, scope: { branchId: string; terminalCode: string }): number {
  const st = (s.terminalCode ?? '').trim().toUpperCase();
  if (st && scope.terminalCode && st === scope.terminalCode) return 0;
  if (!st) return 1;
  return 2;
}

/**
 * Antrekan cetak persisten (APP-PRINTER, audit row 11): gagal kirim = antre
 * di tr_printqueue via `lib/printqueue.ts` (envelope `{target,name,kind,
 * label,retries}` + drain FIFO), BUKAN Alert-and-drop. Tak pernah melempar —
 * null bila SQLite gagal (dialog di atas sudah menjelaskan ke kasir).
 *
 * @returns id antrean (UUIDv7) atau null bila gagal ditulis.
 */
async function enqueuePrintJob(
  bytes: Uint8Array,
  target: PrinterTarget | null,
  opts: { name?: string; kind: QueuedPrintKind; label?: string },
): Promise<string | null> {
  try {
    return await enqueuePrint(bytes, target, opts);
  } catch {
    return null;
  }
}

/** Target kirim dari stasiun default (kasir) yang tersimpan di pengaturan. */
async function defaultStation(): Promise<{ target: PrinterTarget; name: string; cols: 32 | 48 } | null> {
  try {
    const stations = await getJSON<StoredStation[]>(LS_STATIONS, []);
    const scope = activeScope();
    // Station milik terminal lain disembunyikan dari pool kandidat.
    const pool = stations.filter((s) => scopeRank(s, scope) < 2);
    const bound = pool.filter((s) => scopeRank(s, scope) === 0);
    const d =
      bound.find((s) => s.isDefault && s.connected) ??
      bound.find((s) => s.isDefault) ??
      bound.find((s) => s.role === 'Kasir') ??
      bound[0] ??
      pool.find((s) => s.isDefault && s.connected) ??
      pool.find((s) => s.isDefault) ??
      pool.find((s) => s.role === 'Kasir') ??
      pool[0];
    if (!d) return null;
    const target = targetOf(d);
    if (!target) return null;
    return { target, name: d.name, cols: d.cpl === 48 ? 48 : 32 };
  } catch {
    return null;
  }
}

/**
 * Cari station dapur/checker: cocokkan id kanonis (ST-DAPUR/st-dapur/…)
 * atau peran, tanpa peduli huruf. Kembalikan target + nama bila alamat ada.
 */
async function kitchenStation(want: string): Promise<{ target: PrinterTarget; name: string; cols: 32 | 48 } | null> {
  try {
    const stations = await getJSON<StoredStation[]>(LS_STATIONS, []);
    const scope = activeScope();
    // Scope terminal dulu (milik terminal lain disembunyikan), baru cocokkan peran.
    const pool = stations.filter((s) => scopeRank(s, scope) < 2);
    const bound = pool.filter((s) => scopeRank(s, scope) === 0);
    const key = want.trim().toLowerCase();
    const role = /check/.test(key) ? 'checker' : /label/.test(key) ? 'label' : /dapur|kitchen|bar/.test(key) ? 'dapur' : '';
    const pick = (arr: StoredStation[]) =>
      arr.find((s) => s.id.toLowerCase() === key) ??
      arr.find((s) => role && s.role.toLowerCase() === role) ??
      arr.find((s) => role && s.id.toLowerCase().includes(role === 'dapur' ? 'dapur' : role)) ??
      null;
    const d = pick(bound) ?? pick(pool);
    if (!d) return null;
    const target = targetOf(d);
    if (!target) return null;
    return { target, name: d.name, cols: d.cpl === 48 ? 48 : 32 };
  } catch {
    return null;
  }
}

/** Cari station address book by id kanonis ATAU nama tampilan (case-insensitive). */
async function stationByKey(key: string): Promise<{ target: PrinterTarget; name: string; cols: 32 | 48 } | null> {
  const k = key.trim().toLowerCase();
  if (!k) return null;
  try {
    const stations = await getJSON<StoredStation[]>(LS_STATIONS, []);
    const d =
      stations.find((s) => s.id.toLowerCase() === k) ??
      stations.find((s) => s.name.trim().toLowerCase() === k) ??
      null;
    if (!d) return null;
    const target = targetOf(d);
    if (!target) return null;
    return { target, name: d.name, cols: d.cpl === 48 ? 48 : 32 };
  } catch {
    return null;
  }
}

/**
 * Resolver target pengganti untuk `drainPrintQueue`: petunjuk nama station
 * (baris antrean lawas) dulu, lalu target aktif ter-scoping (terminalCode,
 * branchId). null = printer belum dipair — baris tetap antre.
 */
async function resolveDrainTarget(hint: { name: string; kind: QueuedPrintKind }): Promise<{ target: PrinterTarget; name: string } | null> {
  if (hint.name) {
    const byName = await stationByKey(hint.name);
    if (byName) return { target: byName.target, name: byName.name };
  }
  const d = await defaultStation();
  return d ? { target: d.target, name: d.name } : null;
}

// ---------------------------------------------------------------------------
// Varian cetak by tag (printer-variant-selection-not-tag-driven).
// ---------------------------------------------------------------------------

/** Varian konten cetak pilihan tag terminal (SPEC-TERMINAL-SESSION §1). */
export type PrintVariant = 'receipt' | 'kitchen';

/**
 * Tag → varian: `dapur` = tiket dapur tanpa harga; kasir/full_access (dan
 * tag view lain / unknown / legacy) = struk kasir ber-harga. Sumber tag: argumen
 * eksplisit dulu, lalu sesi (backfill binding), lalu binding device
 * (persist lintas logout). Tak pernah melempar.
 */
export function variantForTag(tag?: unknown): PrintVariant {
  const explicit = String(tag ?? '').trim().toLowerCase();
  if (explicit) return explicit === 'dapur' ? 'kitchen' : 'receipt';
  let t = '';
  try {
    t = String(getSessionTag() ?? '').toLowerCase();
  } catch {
    t = '';
  }
  if (!t || t === 'full_access') {
    try {
      t = (getBinding()?.tag ?? '').trim().toLowerCase() || t;
    } catch {
      /* abaikan */
    }
  }
  return t === 'dapur' ? 'kitchen' : 'receipt';
}

export interface TagPrintInput {
  /** Struk kasir ber-harga (dipakai varian receipt). */
  receipt?: EscReceipt;
  /** Tiket dapur tanpa harga (dipakai varian kitchen). */
  ticket?: EscKitchenTicket;
  /** Slip antrean tanpa harga (dipakai bila receipt+ticket absen). */
  queue?: EscQueueSlip;
  /** Override station id/nama eksplisit (tanpa ini = target aktif 1:1). */
  station?: string;
  /** Override tag eksplisit (tanpa ini = tag sesi/binding). */
  tag?: string;
}

/**
 * Dispatcher varian by-tag (pengganti heuristik per-layar): dapur →
 * `buildKitchenTicketBytes`, selainnya → `buildReceiptBytes`. Fallback
 * jujur: varian butuh payload yang tak disediakan → pakai payload yang ada
 * (tak pernah gagal hanya karena varian).
 */
export async function printForTag(input: TagPrintInput): Promise<PrintOutcome> {
  const variant = variantForTag(input.tag);
  if (variant === 'kitchen' && input.ticket) {
    return printKitchenTicket(input.station ?? input.ticket.station, input.ticket);
  }
  if (input.receipt) {
    return printReceiptData(
      input.receipt,
      input.station ? { stationId: input.station } : undefined,
    );
  }
  // Fallback: payload varian tak disediakan — pakai yang ada.
  if (input.ticket) {
    return printKitchenTicket(input.station ?? input.ticket.station, input.ticket);
  }
  if (input.queue) {
    return printQueueSlip(input.queue);
  }
  return { ok: false, reason: 'send-failed', detail: 'printForTag: tanpa payload' };
}

/**
 * Cetak struk nyata (PAY-04): rakit ESC/POS 32-kolom + kirim ke printer
 * default. Web (Expo web / Playwright): dialog cetak OS. Native: BT/LAN/USB
 * via modul printer; tanpa dev-client / tanpa printer terkonfigurasi =
 * dialog penjelas, bukan cetak diam-diam.
 */
export async function printReceiptData(r: EscReceipt, opts?: { stationId?: string }): Promise<PrintOutcome> {
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof window.print === 'function'
  ) {
    window.print();
    return { ok: true, bytes: 0, printer: 'OS print' };
  }
  // Override station eksplisit (dipertahankan) → target aktif 1:1 ter-scoping.
  const d = opts?.stationId
    ? (await stationByKey(opts.stationId)) ?? (await defaultStation())
    : await defaultStation();
  if (!d) {
    Alert.alert(
      'Cetak Struk',
      'Belum ada printer terhubung. Atur di Pengaturan → Printer lalu coba lagi.',
    );
    // Tanpa target pun byte MASUK antrean (tanpa-target): tercetak otomatis
    // saat printer dipair (drain + resolveDrainTarget) — bukan hilang.
    const bytes = buildReceiptBytes({ ...r, cols: r.cols ?? 32 });
    const queuedId = await enqueuePrintJob(bytes, null, {
      kind: 'receipt',
      label: r.trx ?? '',
    });
    if (queuedId) return { ok: false, reason: 'no-printer', queued: true, queuedId };
    return { ok: false, reason: 'no-printer' };
  }
  // Lebar kertas ikut station (chip 32/48 di Pengaturan Printer) kecuali
  // pemanggil sudah menentukan sendiri.
  const bytes = buildReceiptBytes({ ...r, cols: r.cols ?? d.cols });
  const res = await printBytes(d.target, bytes);
  if (!res.ok) {
    Alert.alert(
      'Cetak Struk',
      res.reason === 'need-dev-client'
        ? `Pratinjau ${bytes.length} byte siap. Kirim nyata ke ${d.name} butuh dev-client (modul native).`
        : `Kirim ke ${d.name} gagal: ${res.detail ?? res.reason}. Pekerjaan disimpan di antrean cetak.`,
    );
    // APP-PRINTER: gagal = antre persisten + outcome `queued` (status pending
    // eksplisit untuk layar), bukan Alert-and-drop.
    const queuedId = await enqueuePrintJob(bytes, d.target, {
      name: d.name,
      kind: 'receipt',
      label: r.trx ?? '',
    });
    if (queuedId) return { ok: false, reason: res.reason, detail: res.detail, queued: true, queuedId };
    return { ok: false, reason: res.reason, detail: res.detail };
  }
  // Sukses kirim = momen kuras piggyback antrean (best-effort; reconnect /
  // test-print memicu drain eksplisit dari lane-nya masing-masing).
  void drainPrintQueue({ resolveTarget: resolveDrainTarget });
  return { ok: true, bytes: res.bytes, printer: d.name };
}

/**
 * Cetak tiket dapur/checker ke station perannya (bukan printer kasir).
 * `station`: id kanonis ('ST-DAPUR') atau nama peran ('Dapur'/'Checker') —
 * override eksplisit dipertahankan; bila tak ketemu, jatuh ke target aktif
 * 1:1 (bukan Alert langsung). Gagal kirim → antrean + outcome `queued`.
 */
export async function printKitchenTicket(station: string, t: EscKitchenTicket): Promise<PrintOutcome> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
    return { ok: true, bytes: 0, printer: 'OS print' };
  }
  const d = (await kitchenStation(station)) ?? (await defaultStation());
  if (!d) {
    Alert.alert(
      'Cetak Tiket Dapur',
      `Station "${station}" belum punya alamat printer. Atur di Pengaturan → Printer lalu coba lagi.`,
    );
    // Tanpa target pun byte MASUK antrean (tanpa-target) — bukan hilang.
    const bytes = buildKitchenTicketBytes({ ...t, station, cols: t.cols ?? 32 });
    const queuedId = await enqueuePrintJob(bytes, null, {
      kind: 'kitchen',
      label: t.no,
    });
    if (queuedId) return { ok: false, reason: 'no-printer', queued: true, queuedId };
    return { ok: false, reason: 'no-printer' };
  }
  // Lebar kertas ikut station dapur kecuali pemanggil menentukan sendiri.
  const bytes = buildKitchenTicketBytes({ ...t, station, cols: t.cols ?? d.cols });
  const res = await printBytes(d.target, bytes);
  if (!res.ok) {
    Alert.alert(
      'Cetak Tiket Dapur',
      res.reason === 'need-dev-client'
        ? `Tiket ${bytes.length} byte siap. Kirim nyata ke ${d.name} butuh dev-client (modul native).`
        : `Kirim ke ${d.name} gagal: ${res.detail ?? res.reason}. Pekerjaan disimpan di antrean cetak.`,
    );
    // APP-PRINTER: gagal = antre persisten + outcome `queued`, bukan Alert-and-drop.
    const queuedId = await enqueuePrintJob(bytes, d.target, {
      name: d.name,
      kind: 'kitchen',
      label: t.no,
    });
    if (queuedId) return { ok: false, reason: res.reason, detail: res.detail, queued: true, queuedId };
    return { ok: false, reason: res.reason, detail: res.detail };
  }
  void drainPrintQueue({ resolveTarget: resolveDrainTarget });
  return { ok: true, bytes: res.bytes, printer: d.name };
}

/**
 * Cetak slip antrean pelanggan (APP-PRINTER, audit row 11, dipakai view_queue):
 * nomor antrean + cabang + waktu, tanpa harga. Gagal = antre persisten.
 */
export async function printQueueSlip(q: EscQueueSlip): Promise<PrintOutcome> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
    return { ok: true, bytes: 0, printer: 'OS print' };
  }
  const d = await defaultStation();
  if (!d) {
    Alert.alert(
      'Cetak Antrean',
      'Belum ada printer terhubung. Atur di Pengaturan → Printer lalu coba lagi.',
    );
    // Tanpa target pun byte MASUK antrean (tanpa-target) — bukan hilang.
    const bytes = buildQueueSlipBytes({ ...q, cols: q.cols ?? 32 });
    const queuedId = await enqueuePrintJob(bytes, null, {
      kind: 'queue',
      label: q.queueNo,
    });
    if (queuedId) return { ok: false, reason: 'no-printer', queued: true, queuedId };
    return { ok: false, reason: 'no-printer' };
  }
  const bytes = buildQueueSlipBytes({ ...q, cols: q.cols ?? d.cols });
  const res = await printBytes(d.target, bytes);
  if (!res.ok) {
    Alert.alert(
      'Cetak Antrean',
      res.reason === 'need-dev-client'
        ? `Slip ${bytes.length} byte siap. Kirim nyata ke ${d.name} butuh dev-client (modul native).`
        : `Kirim ke ${d.name} gagal: ${res.detail ?? res.reason}. Pekerjaan disimpan di antrean cetak.`,
    );
    const queuedId = await enqueuePrintJob(bytes, d.target, {
      name: d.name,
      kind: 'queue',
      label: q.queueNo,
    });
    if (queuedId) return { ok: false, reason: res.reason, detail: res.detail, queued: true, queuedId };
    return { ok: false, reason: res.reason, detail: res.detail };
  }
  void drainPrintQueue({ resolveTarget: resolveDrainTarget });
  return { ok: true, bytes: res.bytes, printer: d.name };
}

/**
 * Tendang laci kas via printer default. Best-effort (false = tak ada
 * printer native / gagal) - pemanggil (struk tunai) boleh abaikan.
 */
export async function openDefaultDrawer(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const d = await defaultStation();
  if (!d) return false;
  return openCashDrawer(d.target);
}

/**
 * Kompat lama: tanpa data struk hanya dialog info (tidak pura-pura mencetak).
 */
export function printReceipt(printerName = 'Printer Kasir'): void {
  Alert.alert('Cetak Struk', `Printer ${printerName} - buka struk lalu cetak dari tombol Cetak.`);
}

/**
 * Bagikan ringkasan struk: Web Share API → clipboard → dialog fallback.
 * Diam bila pengguna membatalkan dialog share.
 */
export async function shareReceipt(text: string): Promise<void> {
  const nav = (globalThis as unknown as {
    navigator?: {
      share?: (d: { title: string; text: string }) => Promise<void>;
      clipboard?: { writeText: (t: string) => Promise<void> };
    };
  }).navigator;
  try {
    if (nav?.share) {
      await nav.share({ title: 'Struk Genfity Order App', text });
      return;
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      Alert.alert('Disalin', 'Ringkasan struk disalin ke clipboard.');
      return;
    }
  } catch {
    return;
  }
  Alert.alert('Bagikan Struk', text);
}
