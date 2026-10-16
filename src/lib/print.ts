import { Alert, Platform } from 'react-native';
import { buildReceiptBytes, type EscReceipt } from './escpos';
import { getJSON } from './storage';
import { printBytes, type PrinterTarget } from '../native/printer';

export type PrintOutcome =
  | { ok: true; bytes: number; printer: string }
  | { ok: false; reason: 'no-printer' | 'need-dev-client' | 'connect-failed' | 'send-failed'; detail?: string };

interface StoredStation {
  id: string;
  name: string;
  role: string;
  conn: 'Bluetooth' | 'LAN' | 'Star';
  address: string;
  isDefault?: boolean;
  connected?: boolean;
}

const LS_STATIONS = 'genfity.printer.stations';

/** Target kirim dari stasiun default (kasir) yang tersimpan di pengaturan. */
async function defaultStation(): Promise<{ target: PrinterTarget; name: string } | null> {
  try {
    const stations = await getJSON<StoredStation[]>(LS_STATIONS, []);
    const d =
      stations.find((s) => s.isDefault && s.connected) ??
      stations.find((s) => s.isDefault) ??
      stations.find((s) => s.role === 'Kasir') ??
      stations[0];
    if (!d) return null;
    if (d.conn === 'LAN') {
      const [host, portRaw] = d.address.split(':');
      const h = (host ?? '').trim();
      if (!h) return null;
      return {
        target: { transport: 'lan', host: h, port: Number(portRaw ?? 9100) || 9100 },
        name: d.name,
      };
    }
    if (d.conn === 'Star') {
      const m = d.address.match(/(\d+)\s*\/\s*(\d+)/);
      return {
        target: {
          transport: 'usb',
          vendorId: m ? Number(m[1]) : 0,
          productId: m ? Number(m[2]) : 0,
        },
        name: d.name,
      };
    }
    if (!d.address.trim()) return null;
    return { target: { transport: 'bt', address: d.address.trim() }, name: d.name };
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
  const bytes = buildReceiptBytes(r);
  const d = await defaultStation();
  if (!d) {
    Alert.alert(
      'Cetak Struk',
      'Belum ada printer terhubung. Atur di Pengaturan → Printer lalu coba lagi.',
    );
    return { ok: false, reason: 'no-printer' };
  }
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
