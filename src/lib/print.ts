import { Platform } from 'react-native';
import { appAlert } from './appAlert';
import { buildKitchenTicketBytes, buildQueueSlipBytes, buildReceiptBytes, toBase64, type EscKitchenTicket, type EscQueueSlip, type EscReceipt } from './escpos';
import { getTerminal } from '../config/server';
import { getJSON } from './storage';
import { openCashDrawer, printBytes, type PrinterTarget } from '../native/printer';
import { isViewOnlyTag, resolveEffectiveTag } from './effectiveTag';
import { drainPrintQueue, enqueuePrint, type QueuedPrintKind } from './printqueue';

/** S4-APP-337 display-only: teks alert cetak via kunci i18n prn_* (id+en); kontrak outcome tak berubah. */
function prn(key: string, vars?: Record<string, string | number>): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tOf, getLang } = require('./i18n') as typeof import('./i18n');
  let s = tOf(key, getLang());
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  }
  return s;
}

export type PrintOutcome =
  // `payloadBase64` (tugas G): byte struk yang dirender — pemanggil
  // fan-out AUTO memakainya ulang tanpa render ganda. Hanya diisi jalur
  // struk (bukan tiket/slip; bukan web-OS-print yang tanpa byte).
  | { ok: true; bytes: number; printer: string; payloadBase64?: string }
  // `queued` = byte aman di `tr_printqueue` (offline/printer putus), BUKAN
  // sudah keluar kertas. Layar yang bisa diedit (ReceiptScreen) menampilkan
  // status pending dari flag ini; penjaga lama (`res.ok && res.bytes > 0`)
  // tetap tidak menaikkan printedCount / menendang laci untuk job antre.
  | { ok: false; reason: 'no-printer' | 'need-dev-client' | 'connect-failed' | 'send-failed'; detail?: string; queued?: true; queuedId?: string; payloadBase64?: string };

interface StoredStation {
  id: string;
  name: string;
  role: string;
  conn: 'Bluetooth' | 'LAN' | 'Star';
  address: string;
  /** Lebar kertas station (32/48) — diteruskan ke builder ESC/POS. */
  cpl?: 32 | 48;
  /** Potong kertas otomatis — diteruskan ke builder via `cut` (R10). */
  autocut?: boolean;
  isDefault?: boolean;
  connected?: boolean;
  /**
   * Kind server (kasir/dapur/keduanya; fleet sync tugas A): 'dapur' =
   * dikecualikan dari broadcast struk kasir. Absen = 'keduanya' (kecuali
   * role Dapur warisan = 'dapur'), lihat effectiveKind di bawah.
   */
  kind?: 'kasir' | 'dapur' | 'keduanya';
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

/**
 * R1: ranking per PASANGAN {branchId, terminalCode} — terminalCode cocok
 * tetapi branchId beda = milik terminal lain (2), bukan binding aktif.
 * 0 = terikat terminal aktif, 1 = warisan tanpa binding, 2 = milik terminal lain.
 */
function scopeRank(s: StoredStation, scope: { branchId: string; terminalCode: string }): number {
  const st = (s.terminalCode ?? '').trim().toUpperCase();
  if (st && scope.terminalCode && st === scope.terminalCode) {
    const sb = (s.branchId ?? '').trim();
    if (!sb || !scope.branchId || sb === scope.branchId) return 0;
    return 2;
  }
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

/** Hasil resolusi station: target kirim + nama + lebar kertas + autocut + peran. */
interface ResolvedStation {
  target: PrinterTarget;
  name: string;
  cols: 32 | 48;
  /** station.autocut (undefined = ikut setelan global autocut). */
  autocut?: boolean;
  /** Peran station (Kasir/Dapur/…) — dipakai drain kind-aware (R3). */
  role: string;
}

/** Setelan potong-kertas global (SettingsScreen.AUTOCUT_KEY), default true. */
async function globalAutocut(): Promise<boolean> {
  try {
    return await getJSON<boolean>('genfity.settings.autocut', true);
  } catch {
    return true;
  }
}

/** Target kirim dari stasiun default (kasir) yang tersimpan di pengaturan. */
async function defaultStation(): Promise<ResolvedStation | null> {
  try {
    const stations = await getJSON<StoredStation[]>(LS_STATIONS, []);
    const scope = activeScope();
    // Station milik terminal lain disembunyikan dari pool kandidat.
    const pool = stations.filter((s) => scopeRank(s, scope) < 2);
    const bound = pool.filter((s) => scopeRank(s, scope) === 0);
    // R8: `connected` = penanda preferensi manual ("favorit"), BUKAN hasil
    // verifikasi liveness — kirim gagal tetap antre persisten, bukan drop.
    // S12-guard: posisi fallback buta-role (bound[0]/pool[0]) tidak boleh
    // mendaratkan struk kasir ke station dapur/checker/label — lebih baik
    // tetap antre daripada salah-cetak. isDefault/isDefault+connected/Kasir
    // eksplisit tetap dihormati (niat user); role kosong/unknown = boleh
    // (station legacy tanpa role).
    const nonKitchenFallback = (arr: StoredStation[]) =>
      arr.find((s) => !/dapur|kitchen|bar|checker|label/i.test(String(s.role ?? '')));
    const cands = [
      bound.find((s) => s.isDefault && s.connected),
      bound.find((s) => s.isDefault),
      bound.find((s) => s.role === 'Kasir'),
      nonKitchenFallback(bound),
      pool.find((s) => s.isDefault && s.connected),
      pool.find((s) => s.isDefault),
      pool.find((s) => s.role === 'Kasir'),
      nonKitchenFallback(pool),
    ];
    // R7: lewati station tanpa alamat (targetOf null) — coba kandidat
    // berikutnya yang bisa dikirimi, bukan gagal karena pilihan pertama buntu.
    const seen = new Set<string>();
    for (const d of cands) {
      if (!d || seen.has(d.id)) continue;
      seen.add(d.id);
      const target = targetOf(d);
      if (!target) continue;
      return { target, name: d.name, cols: d.cpl === 48 ? 48 : 32, autocut: d.autocut, role: d.role };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Kind efektif satu station (tugas C): kind eksplisit fleet (tugas A) menang;
 * tanpa kind = role Dapur warisan → 'dapur', selainnya 'keduanya' (default
 * picker kind). Dipakai broadcast struk (kecuali 'dapur') + tiket dapur.
 */
export type StationKind = 'kasir' | 'dapur' | 'keduanya';

export function effectiveKind(s: { kind?: unknown; role?: unknown }): StationKind {
  const k = String(s.kind ?? '').trim().toLowerCase();
  if (k === 'dapur' || k === 'kitchen') return 'dapur';
  if (k === 'kasir' || k === 'cashier' || k === 'counter') return 'kasir';
  if (k === 'keduanya' || k === 'both') return 'keduanya';
  const role = String(s.role ?? '').trim().toLowerCase();
  if (/dapur|kitchen|bar/.test(role)) return 'dapur';
  return 'keduanya';
}

/**
 * SEMUA station terikat terminal aktif untuk struk kasir (tugas C):
 * pool rank 0 (bound) + kind efektif BUKAN dapur + target kirim valid.
 * Urutan: isDefault dulu, lalu sisanya (stabil). Kosong = tak ada yang layak
 * (pemanggil fallback ke defaultStation legacy / antre tanpa-target).
 */
export async function boundReceiptStations(): Promise<ResolvedStation[]> {
  try {
    const stations = await getJSON<StoredStation[]>(LS_STATIONS, []);
    const scope = activeScope();
    const bound = stations.filter((s) => scopeRank(s, scope) === 0);
    const eligible = bound.filter((s) => effectiveKind(s) !== 'dapur');
    eligible.sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true));
    const out: ResolvedStation[] = [];
    const seen = new Set<string>();
    for (const s of eligible) {
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      const target = targetOf(s);
      if (!target) continue;
      out.push({ target, name: s.name, cols: s.cpl === 48 ? 48 : 32, autocut: s.autocut, role: s.role });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Cari station dapur/checker: cocokkan id kanonis (ST-DAPUR/st-dapur/…)
 * atau peran, tanpa peduli huruf. Kembalikan target + nama bila alamat ada.
 */
async function kitchenStation(want: string): Promise<ResolvedStation | null> {
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
    return { target, name: d.name, cols: d.cpl === 48 ? 48 : 32, autocut: d.autocut, role: d.role };
  } catch {
    return null;
  }
}

/** Cari station address book by id kanonis ATAU nama tampilan (case-insensitive).
 * R2: ter-scoping terminal aktif secara default (milik terminal lain tak
 * terlihat); `scoped: false` hanya untuk diagnostik. */
async function stationByKey(key: string, opts?: { scoped?: boolean }): Promise<ResolvedStation | null> {
  const k = key.trim().toLowerCase();
  if (!k) return null;
  try {
    const stations = await getJSON<StoredStation[]>(LS_STATIONS, []);
    const scope = activeScope();
    const pool = opts?.scoped === false ? stations : stations.filter((s) => scopeRank(s, scope) < 2);
    const d =
      pool.find((s) => s.id.toLowerCase() === k) ??
      pool.find((s) => s.name.trim().toLowerCase() === k) ??
      null;
    if (!d) return null;
    const target = targetOf(d);
    if (!target) return null;
    return { target, name: d.name, cols: d.cpl === 48 ? 48 : 32, autocut: d.autocut, role: d.role };
  } catch {
    return null;
  }
}

/**
 * Resolver target pengganti untuk `drainPrintQueue`, sadar-jenis (R3):
 * - kind 'kitchen' → station-by-nama peran dapur, lalu station dapur/
 *   checker/label ter-scoping, atau TETAP ANTRE (null). TIDAK PERNAH jatuh ke
 *   printer kasir agar tiket dapur tak keluar di kertas struk ber-harga.
 * - receipt/queue/raw → station-by-nama (baris antrean lawas) lalu default kasir.
 * Diekspor (C10): dipakai piggyback test-print (PrintersScreen) + reconnect
 * realtime agar antrean terkuras saat jalur printer terbukti hidup.
 */
export async function resolveDrainTarget(hint: { name: string; kind: QueuedPrintKind }): Promise<{ target: PrinterTarget; name: string } | null> {
  if (hint.kind === 'kitchen') {
    if (hint.name) {
      const byName = await stationByKey(hint.name);
      // Hanya station peran dapur yang boleh menampung tiket dapur.
      if (byName && byName.role !== 'Kasir') return { target: byName.target, name: byName.name };
    }
    const k =
      (await kitchenStation('dapur')) ??
      (await kitchenStation('checker')) ??
      (await kitchenStation('label'));
    return k ? { target: k.target, name: k.name } : null;
  }
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
 * Tag → varian (R58 via resolveEffectiveTag; SPEC-TERMINAL-SESSION §1):
 * `dapur` + tag view (view_pelanggan/view_queue) = tiket dapur tanpa harga;
 * kasir/full_access/unknown/legacy = struk kasir ber-harga. Tak melempar.
 */
export function variantForTag(tag?: unknown): PrintVariant {
  const t = resolveEffectiveTag(tag);
  return t === 'dapur' || isViewOnlyTag(t) ? 'kitchen' : 'receipt';
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
 * Dispatcher varian by-tag (R5): tag view (pelanggan/antrean) TIDAK PERNAH
 * menerima struk ber-harga — hanya tiket dapur / slip antrean (tanpa harga);
 * bila keduanya absen, TOLAK jujur (Alert + outcome gagal), bukan fallback ke
 * struk. Tag kasir/dapur/full/unknown: dapur → tiket bila ada; selainnya struk
 * bila ada; fallback jujur ke payload yang ada (tak pernah gagal hanya karena
 * varian); tanpa payload apa pun → tolak.
 */
export async function printForTag(input: TagPrintInput): Promise<PrintOutcome> {
  const tag = resolveEffectiveTag(input.tag);
  if (isViewOnlyTag(tag)) {
    if (input.ticket) {
      return printKitchenTicket(input.station ?? input.ticket.station, input.ticket);
    }
    if (input.queue) {
      return printQueueSlip(input.queue);
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tOf, getLang } = require('./i18n') as typeof import('./i18n');
      appAlert(tOf('hist_deny_title', getLang()), tOf('kit_print_fail', getLang()));
    } catch {
      /* abaikan — outcome di bawah tetap jujur */
    }
    return { ok: false, reason: 'send-failed', detail: 'printForTag: tag view menolak struk ber-harga' };
  }
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
 * Cetak struk nyata (PAY-04): rakit ESC/POS + BROADCAST ke SEMUA station
 * terikat terminal (tugas C; kind dapur dikecualikan). Satu aksi kasir =
 * render sekali per kombinasi (cols,cut), kirim per station (paper size /
 * cpl / autocut per station tetap dipakai). Web (Expo web / Playwright):
 * dialog cetak OS. Native: BT/LAN/USB via modul printer; tanpa dev-client /
 * tanpa printer terkonfigurasi = dialog penjelas, bukan cetak diam-diam.
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
  if (opts?.stationId) {
    return printReceiptToSingle(
      r,
      (await stationByKey(opts.stationId)) ?? (await defaultStation()),
    );
  }
  // Broadcast: semua station terikat non-dapur. Kosong (belum ada binding) =
  // fallback legacy defaultStation tunggal agar setup lama tak pecah.
  const targets = await boundReceiptStations();
  if (targets.length === 0) {
    return printReceiptToSingle(r, await defaultStation());
  }
  if (targets.length === 1) {
    return printReceiptToSingle(r, targets[0] as ResolvedStation);
  }
  // Render sekali per (cols,cut) — byte dirakit per grup, bukan per station.
  const groups = new Map<string, { cols: 32 | 48; cut: boolean; bytes: Uint8Array; stations: ResolvedStation[] }>();
  for (const t of targets) {
    const cols = r.cols ?? t.cols;
    const cut = r.cut ?? t.autocut ?? (await globalAutocut());
    const key = `${cols}/${cut ? 1 : 0}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        cols,
        cut,
        bytes: buildReceiptBytes({ ...r, cols, cut }),
        stations: [],
      };
      groups.set(key, g);
    }
    g.stations.push(t);
  }
  let sentBytes = 0;
  let sentCount = 0;
  const sentNames: string[] = [];
  const failedNames: string[] = [];
  let lastReason = '';
  let lastDetail: string | undefined;
  let needDevClient = false;
  for (const g of groups.values()) {
    for (const t of g.stations) {
      let res;
      try {
        res = await printBytes(t.target, g.bytes);
      } catch {
        res = { ok: false, reason: 'send-failed', detail: 'printFn threw' } as const;
      }
      if ((res as { ok: boolean }).ok) {
        sentBytes += (res as { ok: true; bytes: number }).bytes;
        sentCount += 1;
        sentNames.push(t.name);
      } else {
        const fr = res as { ok: false; reason: string; detail?: string };
        failedNames.push(t.name);
        lastReason = fr.reason;
        lastDetail = fr.detail;
        if (fr.reason === 'need-dev-client') needDevClient = true;
        // Gagal per station = antre persisten (target station itu; drain
        // kind-aware mengurasnya saat jalur hidup) — bukan Alert-and-drop.
        await enqueuePrintJob(g.bytes, t.target, {
          name: t.name,
          kind: 'receipt',
          label: r.trx ?? '',
        });
      }
    }
  }
  if (sentCount > 0) {
    if (failedNames.length > 0) {
      appAlert(
        prn('prn_receipt_title'),
        prn('prn_send_fail', { p: failedNames.join(', '), e: lastDetail ?? lastReason }),
      );
    }
    // Sukses kirim = momen kuras piggyback antrean (best-effort).
    void drainPrintQueue({ resolveTarget: resolveDrainTarget });
    // Tugas G: byte grup pertama = payload fan-out AUTO (satu payload per
    // request; varian lebar kertas per station milik jalur lokal saja).
    const firstBytes = groups.values().next().value?.bytes as Uint8Array | undefined;
    return {
      ok: true,
      bytes: sentBytes,
      printer: sentNames.join(', '),
      ...(firstBytes ? { payloadBase64: toBase64(firstBytes) } : {}),
    };
  }
  appAlert(
    prn('prn_receipt_title'),
    needDevClient
      ? prn('prn_preview_receipt', { n: String(groups.values().next().value?.bytes.length ?? 0), p: failedNames.join(', ') })
      : prn('prn_send_fail', { p: failedNames.join(', '), e: lastDetail ?? lastReason }),
  );
  const failBytes = groups.values().next().value?.bytes as Uint8Array | undefined;
  return {
    ok: false,
    reason: 'send-failed',
    detail: lastDetail ?? lastReason,
    ...(failBytes ? { payloadBase64: toBase64(failBytes) } : {}),
  };
}

/**
 * Jalur tunggal (override station eksplisit / fallback legacy): perilaku lama
 * — kirim 1:1, gagal = antre persisten + outcome `queued`.
 */
async function printReceiptToSingle(r: EscReceipt, d: ResolvedStation | null): Promise<PrintOutcome> {
  if (!d) {
    appAlert(
      prn('prn_receipt_title'),
      prn('prn_no_printer'),
    );
    // Tanpa target pun byte MASUK antrean (tanpa-target): tercetak otomatis
    // saat printer dipair (drain + resolveDrainTarget) — bukan hilang.
    const bytes = buildReceiptBytes({ ...r, cols: r.cols ?? 32, cut: r.cut ?? (await globalAutocut()) });
    const queuedId = await enqueuePrintJob(bytes, null, {
      kind: 'receipt',
      label: r.trx ?? '',
    });
    if (queuedId) return { ok: false, reason: 'no-printer', queued: true, queuedId };
    return { ok: false, reason: 'no-printer' };
  }
  // Lebar kertas ikut station (chip 32/48 di Pengaturan Printer) kecuali
  // pemanggil sudah menentukan sendiri. R10: cut = payload ?? station ?? global.
  const bytes = buildReceiptBytes({ ...r, cols: r.cols ?? d.cols, cut: r.cut ?? d.autocut ?? (await globalAutocut()) });
  // Tugas G: byte payload diikutkan ke outcome untuk fan-out AUTO.
  const payloadBase64 = toBase64(bytes);
  const res = await printBytes(d.target, bytes);
  if (!res.ok) {
    appAlert(
      prn('prn_receipt_title'),
      res.reason === 'need-dev-client'
        ? prn('prn_preview_receipt', { n: bytes.length, p: d.name })
        : prn('prn_send_fail', { p: d.name, e: res.detail ?? res.reason }),
    );
    // APP-PRINTER: gagal = antre persisten + outcome `queued` (status pending
    // eksplisit untuk layar), bukan Alert-and-drop.
    const queuedId = await enqueuePrintJob(bytes, d.target, {
      name: d.name,
      kind: 'receipt',
      label: r.trx ?? '',
    });
    if (queuedId) return { ok: false, reason: res.reason, detail: res.detail, queued: true, queuedId, payloadBase64 };
    return { ok: false, reason: res.reason, detail: res.detail, payloadBase64 };
  }
  // Sukses kirim = momen kuras piggyback antrean (best-effort; reconnect /
  // test-print memicu drain eksplisit dari lane-nya masing-masing).
  void drainPrintQueue({ resolveTarget: resolveDrainTarget });
  return { ok: true, bytes: res.bytes, printer: d.name, payloadBase64 };
}

/**
 * Cetak tiket dapur/checker ke station perannya (bukan printer kasir).
 * `station`: id kanonis ('ST-DAPUR') atau nama peran ('Dapur'/'Checker') —
 * override eksplisit dipertahankan. R4: station tak ketemu = antre persisten
 * (kind kitchen; drain kind-aware TIDAK PERNAH ke kasir) + Alert jujur —
 * TANPA fallback diam-diam ke printer struk. Gagal kirim → antrean + `queued`.
 */
export async function printKitchenTicket(station: string, t: EscKitchenTicket): Promise<PrintOutcome> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
    return { ok: true, bytes: 0, printer: 'OS print' };
  }
  const d = await kitchenStation(station);
  if (!d) {
    appAlert(
      prn('prn_kitchen_title'),
      prn('prn_kitchen_no_station', { s: station }),
    );
    // Tanpa target pun byte MASUK antrean (tanpa-target) — bukan hilang.
    const bytes = buildKitchenTicketBytes({ ...t, station, cols: t.cols ?? 32, cut: t.cut ?? (await globalAutocut()) });
    const queuedId = await enqueuePrintJob(bytes, null, {
      kind: 'kitchen',
      label: t.no,
    });
    if (queuedId) return { ok: false, reason: 'no-printer', queued: true, queuedId };
    return { ok: false, reason: 'no-printer' };
  }
  // Lebar kertas ikut station dapur kecuali pemanggil menentukan sendiri.
  const bytes = buildKitchenTicketBytes({ ...t, station, cols: t.cols ?? d.cols, cut: t.cut ?? d.autocut ?? (await globalAutocut()) });
  const res = await printBytes(d.target, bytes);
  if (!res.ok) {
    appAlert(
      prn('prn_kitchen_title'),
      res.reason === 'need-dev-client'
        ? prn('prn_preview_kitchen', { n: bytes.length, p: d.name })
        : prn('prn_send_fail', { p: d.name, e: res.detail ?? res.reason }),
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
    appAlert(
      prn('prn_queue_title'),
      prn('prn_no_printer'),
    );
    // Tanpa target pun byte MASUK antrean (tanpa-target) — bukan hilang.
    const bytes = buildQueueSlipBytes({ ...q, cols: q.cols ?? 32, cut: q.cut ?? (await globalAutocut()) });
    const queuedId = await enqueuePrintJob(bytes, null, {
      kind: 'queue',
      label: q.queueNo,
    });
    if (queuedId) return { ok: false, reason: 'no-printer', queued: true, queuedId };
    return { ok: false, reason: 'no-printer' };
  }
  const bytes = buildQueueSlipBytes({ ...q, cols: q.cols ?? d.cols, cut: q.cut ?? d.autocut ?? (await globalAutocut()) });
  const res = await printBytes(d.target, bytes);
  if (!res.ok) {
    appAlert(
      prn('prn_queue_title'),
      res.reason === 'need-dev-client'
        ? prn('prn_preview_queue', { n: bytes.length, p: d.name })
        : prn('prn_send_fail', { p: d.name, e: res.detail ?? res.reason }),
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
  appAlert(prn('prn_receipt_title'), prn('prn_receipt_compat', { p: printerName }));
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
      appAlert(prn('prn_copied_title'), prn('prn_copied_body'));
      return;
    }
  } catch {
    return;
  }
  appAlert(prn('prn_share_title'), text);
}
