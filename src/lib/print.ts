import { Alert, Platform } from 'react-native';
import { buildKitchenTicketBytes, buildReceiptBytes, type EscKitchenTicket, type EscReceipt } from './escpos';
import { getJSON } from './storage';
import { openCashDrawer, printBytes, type PrinterTarget } from '../native/printer';

export type PrintOutcome =
  | { ok: true; bytes: number; printer: string }
  | { ok: false; reason: 'no-printer' | 'need-dev-client' | 'connect-failed' | 'send-failed'; detail?: string };

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

/** Target kirim dari stasiun default (kasir) yang tersimpan di pengaturan. */
async function defaultStation(): Promise<{ target: PrinterTarget; name: string; cols: 32 | 48 } | null> {
  try {
    const stations = await getJSON<StoredStation[]>(LS_STATIONS, []);
    const d =
      stations.find((s) => s.isDefault && s.connected) ??
      stations.find((s) => s.isDefault) ??
      stations.find((s) => s.role === 'Kasir') ??
      stations[0];
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
    const key = want.trim().toLowerCase();
    const role = /check/.test(key) ? 'checker' : /label/.test(key) ? 'label' : /dapur|kitchen|bar/.test(key) ? 'dapur' : '';
    const d =
      stations.find((s) => s.id.toLowerCase() === key) ??
      stations.find((s) => role && s.role.toLowerCase() === role) ??
      stations.find((s) => role && s.id.toLowerCase().includes(role === 'dapur' ? 'dapur' : role)) ??
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
 * Cetak struk nyata (PAY-04): rakit ESC/POS 32-kolom + kirim ke printer
 * default. Web (Expo web / Playwright): dialog cetak OS. Native: BT/LAN/USB
 * via modul printer; tanpa dev-client / tanpa printer terkonfigurasi =
 * dialog penjelas, bukan cetak diam-diam.
 */
export async function printReceiptData(r: EscReceipt): Promise<PrintOutcome> {
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof window.print === 'function'
  ) {
    window.print();
    return { ok: true, bytes: 0, printer: 'OS print' };
  }
  const d = await defaultStation();
  if (!d) {
    Alert.alert(
      'Cetak Struk',
      'Belum ada printer terhubung. Atur di Pengaturan → Printer lalu coba lagi.',
    );
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
        : `Kirim ke ${d.name} gagal: ${res.detail ?? res.reason}.`,
    );
    return { ok: false, reason: res.reason, detail: res.detail };
  }
  return { ok: true, bytes: res.bytes, printer: d.name };
}

/**
 * Cetak tiket dapur/checker ke station perannya (bukan printer kasir).
 * `station`: id kanonis ('ST-DAPUR') atau nama peran ('Dapur'/'Checker').
 */
export async function printKitchenTicket(station: string, t: EscKitchenTicket): Promise<PrintOutcome> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
    return { ok: true, bytes: 0, printer: 'OS print' };
  }
  const d = await kitchenStation(station);
  if (!d) {
    Alert.alert(
      'Cetak Tiket Dapur',
      `Station "${station}" belum punya alamat printer. Atur di Pengaturan → Printer lalu coba lagi.`,
    );
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
        : `Kirim ke ${d.name} gagal: ${res.detail ?? res.reason}.`,
    );
    return { ok: false, reason: res.reason, detail: res.detail };
  }
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
      await nav.share({ title: 'Struk ESB POSLite', text });
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
