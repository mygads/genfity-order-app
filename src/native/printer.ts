/**
 * Lapisan printer: SATU interface untuk 4 transport.
 *
 * - LAN (Wi-Fi/Ethernet, IP+port): murni JS via react-native-tcp-socket - JALAN.
 * - BT SPP klasik (MAC bonded): modul native `GenfityPrinter`
 *   (modules/genfity-printer) - aktif setelah `npx expo prebuild` + EAS build.
 * - BLE thermal (Nordic UART, MAC `BLE:`): modul native yang sama (GATT).
 * - USB serial (VID/PID): modul native yang sama via UsbManager bulk-transfer.
 *
 * Di Expo Go / web (modul native tak ada): kirim ditolak halus dengan
 * status `need-dev-client`, dan panggil `onPreview` agar layar tetap bisa
 * menampilkan pratinjau struk. Byte ESC/POS dirakit di src/lib/escpos.ts.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import GenfityPrinterSpec, { type UsbDeviceInfo } from '../specs/GenfityPrinter';

export type PrinterTransport = 'lan' | 'bt' | 'ble' | 'usb' | 'loopback';
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
  printBle?: (mac: string, base64: string) => Promise<number>;
  printUsb?: (vid: number, pid: number, base64: string) => Promise<number>;
  requestUsbPermission?: (vid: number, pid: number) => Promise<boolean>;
  listBondedBt?: () => Promise<Array<{ name: string; mac: string }>>;
  listUsbDevices?: () => Promise<UsbDeviceInfo[]>;
  scanBlePrinters?: () => Promise<Array<{ name: string; mac: string }>>;
  openDrawer?: (target: string) => Promise<boolean>;
  startWsService?: () => Promise<boolean>;
  stopWsService?: () => Promise<boolean>;
}

// Modul native hanya ada di dev-client/APK produksi; di Expo Go/web:
// src/specs/GenfityPrinter me-resolve null (NativeModules kosong).
function native(): NativePrinter | null {
  return (GenfityPrinterSpec ?? null) as NativePrinter | null;
}

/** True bila modul native printer tersedia (dev-client / APK produksi). */
export function hasNativePrinter(): boolean {
  return native() !== null;
}

/**
 * Jurnal loopback S10/PP-015 (fixture + mock cetak tanpa hardware).
 * Satu entri = satu pemanggilan `printBytes` bertarget loopback.
 * `bytes` disalin saat tulis DAN saat baca (pemanggil tak bisa merusak jurnal).
 * Memori saja — hilang saat reload; bukan antrean persisten (itu `printqueue`).
 */
export interface LoopbackPrint {
  at: string;
  bytes: number[];
}

/** Batas jurnal (memori): entri tertua dibuang bila penuh. */
export const LOOPBACK_CAP = 20;

/** Target loopback kanonis untuk fixture/uji (jangan jadi station produksi). */
export const LOOPBACK_TARGET: PrinterTarget = { transport: 'loopback' };

const loopbackJournal: LoopbackPrint[] = [];

export function getLoopbackJournal(): LoopbackPrint[] {
  return loopbackJournal.map((e) => ({ at: e.at, bytes: [...e.bytes] }));
}

export function clearLoopbackJournal(): void {
  loopbackJournal.length = 0;
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

/** Daftar printer BT yang sudah di-pair (butuh dev-client; Expo Go → list kosong).
 * E2E-HP (2026-10-26): tanpa BLUETOOTH_CONNECT, getBondedDevices() kosong /
 * melempar SecurityException → minta izin DULU. Ditolak = [] (pemanggil
 * membedakan via ensureBtPermission + pesan printers.btDenied). */
export async function listBondedBtPrinters(): Promise<Array<{ name: string; mac: string }>> {
  const n = native();
  if (!n?.listBondedBt) return [];
  if (!(await ensureBtPermission())) return [];
  try {
    return await n.listBondedBt();
  } catch {
    return [];
  }
}

/** Daftar device USB tersambung (butuh dev-client; Expo Go → list kosong). */
export async function listUsbDevices(): Promise<UsbDeviceInfo[]> {
  const n = native();
  if (!n?.listUsbDevices) return [];
  try {
    return await n.listUsbDevices();
  } catch {
    return [];
  }
}

/** Minta izin BT bila perlu (Android 12+: SCAN+CONNECT; Android lama: lokasi).
 * Dipakai pindai BLE, daftar bonded klasik, DAN kirim BT/BLE — tanpa
 * BLUETOOTH_CONNECT, getBondedDevices() kosong + RFCOMM melempar
 * SecurityException (temuan E2E-HP 2026-10-26: granted=false permanen
 * karena izin tak pernah diminta; pemindaian selalu "tidak ditemukan").
 * Tiap request dibatasi timeout: dialog izin yang hilang/dibuang sistem tanpa
 * hasil (temuan E2E-HP: dialog CONNECT ke-2 lenyap 90ms, promise tak pernah
 * settle → layar "Scanning..." selamanya) tak boleh menggantung UI. */
const BT_PERMISSION_TIMEOUT_MS = 30000;

async function requestBtPermission(
  perm: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS],
): Promise<boolean> {
  try {
    const res = await Promise.race([
      PermissionsAndroid.request(perm),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('BT_PERMISSION_TIMEOUT')), BT_PERMISSION_TIMEOUT_MS),
      ),
    ]);
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function ensureBtPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const api = Number(Platform.Version);
    const perms =
      api >= 31
        ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    for (const p of perms) {
      if (!(await requestBtPermission(p))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pindai printer BLE ±8 detik (butuh dev-client + izin; Expo Go → kosong).
 * false = izin ditolak / tanpa modul.
 */
export async function listBlePrinters(): Promise<Array<{ name: string; mac: string }>> {
  if (Platform.OS === 'web') return [];
  const n = native();
  if (!n?.scanBlePrinters) return [];
  if (!(await ensureBtPermission())) return [];
  try {
    return await n.scanBlePrinters();
  } catch {
    return [];
  }
}

/** Kirim byte ESC/POS ke target. */
export async function printBytes(target: PrinterTarget, data: Uint8Array): Promise<PrintResult> {
  // S10/PP-015 loopback: tangkap byte ke jurnal memori agar byte ESC/POS bisa
  // diverifikasi tanpa hardware (fixture + uji drain). Cabang ini SENGAJA di
  // paling atas — jalan identik di Expo Go/web/dev-client (tanpa modul native).
  // SUKSES DI SINI BUKAN BUKTI KERTAS KELUAR: klaim cetak fisik butuh perangkat
  // + dev-client/APK (daftar colok-akhir: docs/PRINTER-PLUGLAST.md).
  if (target.transport === 'loopback') {
    loopbackJournal.push({ at: new Date().toISOString(), bytes: Array.from(data) });
    while (loopbackJournal.length > LOOPBACK_CAP) loopbackJournal.shift();
    return { ok: true, bytes: data.length };
  }
  if (target.transport === 'lan' && target.host) {
    return printLan(target.host, target.port ?? 9100, data);
  }
  const n = native();
  if (!n) return { ok: false, reason: 'need-dev-client' };
  try {
    const b64 = toBase64(data);
    if (target.transport === 'bt' && target.address && n.printBt) {
      // E2E-HP (2026-10-26): tanpa BLUETOOTH_CONNECT, RFCOMM melempar
      // SecurityException → pastikan izin DULU agar pesan gagalnya jujur
      // (butuh-izin) bukan "connect-failed" misterius. Marker detail
      // BT_PERMISSION_DENIED dipetakan ke i18n di PrintersScreen.
      if (!(await ensureBtPermission())) {
        return { ok: false, reason: 'connect-failed', detail: 'BT_PERMISSION_DENIED' };
      }
      const bytes = await n.printBt(target.address, b64);
      return { ok: true, bytes };
    }
    if (target.transport === 'ble' && target.address && n.printBle) {
      if (!(await ensureBtPermission())) {
        return { ok: false, reason: 'connect-failed', detail: 'BT_PERMISSION_DENIED' };
      }
      const bytes = await n.printBle(target.address, b64);
      return { ok: true, bytes };
    }
    if (target.transport === 'usb' && n.printUsb) {
      const vid = target.vendorId ?? 0;
      const pid = target.productId ?? 0;
      try {
        const bytes = await n.printUsb(vid, pid, b64);
        return { ok: true, bytes };
      } catch (e) {
        // Izin USB belum diberikan (dialog sistem, sekali sampai dicabut):
        // minta sekali lalu coba ulang satu kali. Penolakan pengguna =
        // send-failed dengan detail jujur (bukan diam).
        const msg = e instanceof Error ? e.message : '';
        if (n.requestUsbPermission && /USB_NO_PERMISSION|USB_DENIED|permission/i.test(msg)) {
          const granted = await requestUsbPermission(vid, pid);
          if (granted) {
            const bytes = await n.printUsb(vid, pid, b64);
            return { ok: true, bytes };
          }
        }
        throw e;
      }
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

/**
 * Minta izin USB sistem untuk device VID/PID (dialog Android, sekali sampai
 * dicabut). false = Expo Go/web (tanpa modul), ditolak pengguna, atau device
 * tak tersambung. Panggil sebelum printUsb pertama / saat t('...') gagal
 * USB_NO_PERMISSION.
 */
export async function requestUsbPermission(vendorId: number, productId: number): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const n = native();
  if (!n?.requestUsbPermission) return false;
  try {
    return await n.requestUsbPermission(vendorId, productId);
  } catch {
    return false;
  }
}

/**
 * Foreground service WS realtime (Android dev-client/APK). Best-effort:
 * false di Expo Go/web atau bila modul tak menyediakan - realtime JS
 * (lib/realtime.ts) tetap jalan selama aplikasi foreground.
 */
export async function setWsForeground(on: boolean): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const n = native();
  try {
    if (on && n?.startWsService) return await n.startWsService();
    if (!on && n?.stopWsService) return await n.stopWsService();
  } catch {
    /* abaikan */
  }
  return false;
}
