/**
 * Lapisan printer: SATU interface untuk 3 transport.
 *
 * - LAN (Wi-Fi/Ethernet, IP+port): murni JS via react-native-tcp-socket - JALAN.
 * - BT SPP klasik (MAC bonded): modul native `GenfityPrinter` (Kotlin,
 *   modules/genfity-printer) - aktif setelah `npx expo prebuild` + EAS build.
 * - USB serial (VID/PID): modul native yang sama via UsbManager bulk-transfer.
 *
 * Di Expo Go / web (modul native tak ada): kirim ditolak halus dengan
 * status `need-dev-client`, dan panggil `onPreview` agar layar tetap bisa
 * menampilkan pratinjau struk. Byte ESC/POS dirakit di src/lib/escpos.ts.
 */
import { Platform } from 'react-native';

export type PrinterTransport = 'lan' | 'bt' | 'usb';
export type PrintResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: 'need-dev-client' | 'connect-failed' | 'send-failed'; detail?: string };

export interface PrinterTarget {
  transport: PrinterTransport;
  address?: string; // BT MAC
  host?: string; // LAN IP
  port?: number; // LAN port (default 9100)
  vendorId?: number; // USB VID
  productId?: number; // USB PID
}

interface NativePrinter {
  printBt?: (mac: string, base64: string) => Promise<number>;
  printUsb?: (vid: number, pid: number, base64: string) => Promise<number>;
  listBondedBt?: () => Promise<Array<{ name: string; mac: string }>>;
  openDrawer?: (target: string) => Promise<boolean>;
}

// Modul native hanya ada di dev-client; di Expo Go/web: undefined.
function native(): NativePrinter | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('../specs/GenfityPrinter').default;
    return (m ?? null) as NativePrinter | null;
  } catch {
    return null;
  }
}

/** True bila modul native printer tersedia (dev-client / APK produksi). */
export function hasNativePrinter(): boolean {
  return native() !== null;
}

function bytesToBinary(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number);
  return s;
}

function toBase64(bytes: Uint8Array): string {
  // btoa tersedia di Hermes/JSC/web
  // eslint-disable-next-line no-undef
  return typeof btoa !== 'undefined' ? btoa(bytesToBinary(bytes)) : '';
}

async function printLan(host: string, port: number, data: Uint8Array): Promise<PrintResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TcpSocket = require('react-native-tcp-socket').default;
    await new Promise<void>((resolve, reject) => {
      const client = TcpSocket.createConnection({ host, port }, () => {
        client.write(bytesToBinary(data), undefined, () => {
          client.destroy();
          resolve();
        });
      });
      client.on('error', (e: unknown) => reject(e instanceof Error ? e : new Error('tcp error')));
      setTimeout(() => reject(new Error('tcp timeout')), 15000);
    });
    return { ok: true, bytes: data.length };
  } catch (e) {
    return { ok: false, reason: 'connect-failed', detail: e instanceof Error ? e.message : 'LAN gagal' };
  }
}

/** Daftar printer BT yang sudah di-pair (butuh dev-client; Expo Go → list kosong). */
export async function listBondedBtPrinters(): Promise<Array<{ name: string; mac: string }>> {
  const n = native();
  if (!n?.listBondedBt) return [];
  try {
    return await n.listBondedBt();
  } catch {
    return [];
  }
}

/** Kirim byte ESC/POS ke target. */
export async function printBytes(target: PrinterTarget, data: Uint8Array): Promise<PrintResult> {
  if (target.transport === 'lan' && target.host) {
    return printLan(target.host, target.port ?? 9100, data);
  }
  const n = native();
  if (!n) return { ok: false, reason: 'need-dev-client' };
  try {
    const b64 = toBase64(data);
    if (target.transport === 'bt' && target.address && n.printBt) {
      const bytes = await n.printBt(target.address, b64);
      return { ok: true, bytes };
    }
    if (target.transport === 'usb' && n.printUsb) {
      const bytes = await n.printUsb(target.vendorId ?? 0, target.productId ?? 0, b64);
      return { ok: true, bytes };
    }
    return { ok: false, reason: 'send-failed', detail: 'transport tak didukung modul' };
  } catch (e) {
    return { ok: false, reason: 'send-failed', detail: e instanceof Error ? e.message : 'kirim gagal' };
  }
}

/** Buka laci kas (pulse drawer). Di web selalu false. */
export async function openCashDrawer(target: PrinterTarget): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const n = native();
  if (!n?.openDrawer) return false;
  try {
    return await n.openDrawer(JSON.stringify(target));
  } catch {
    return false;
  }
}
