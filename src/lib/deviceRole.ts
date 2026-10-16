/**
 * Peran perangkat (device role): 1 perangkat = 1 peran.
 *
 * - KASIR: alur penuh (kasir, meja, bayar, riwayat, pengaturan).
 * - DAPUR: hanya layar dapur + pengaturan (terima tiket push, auto-print).
 * - DISPLAY: hanya layar pelanggan + pengaturan (terima event push).
 *
 * Kunci peran ini murni sisi aplikasi (nav/drawer lock). Nilai default
 * KASIR agar perangkat lama tanpa setting tetap jalan penuh (mundur-kompatibel).
 * Server boleh menetapkan peran via setting per terminal `deviceRole`
 * (diterapkan syncTerminalSettings, server menang).
 */
import { getItem, setItem } from './storage';

export type DeviceRole = 'KASIR' | 'DAPUR' | 'DISPLAY';

const LS_ROLE = 'genfity.device.role';

const VALID: DeviceRole[] = ['KASIR', 'DAPUR', 'DISPLAY'];

let role: DeviceRole = 'KASIR';
let hydrated = false;

const listeners = new Set<(r: DeviceRole) => void>();

function restore(): void {
  void getItem(LS_ROLE).then((v) => {
    if (v && (VALID as string[]).includes(v)) {
      role = v as DeviceRole;
      listeners.forEach((cb) => {
        try {
          cb(role);
        } catch {
          /* abaikan */
        }
      });
    }
  });
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  restore();
}

/** Peran perangkat aktif (sinkron, default KASIR bila belum diset). */
export function getDeviceRole(): DeviceRole {
  hydrate();
  return role;
}

/** Validasi string asing (mis. dari server) menjadi DeviceRole; null bila tak dikenal. */
export function parseDeviceRole(v: unknown): DeviceRole | null {
  const s = String(v ?? '').trim().toUpperCase();
  return (VALID as string[]).includes(s) ? (s as DeviceRole) : null;
}

/** Simpan peran perangkat (tak pernah melempar). */
export function setDeviceRole(next: DeviceRole): void {
  hydrate();
  role = next;
  void setItem(LS_ROLE, next);
  listeners.forEach((cb) => {
    try {
      cb(role);
    } catch {
      /* abaikan */
    }
  });
}

/** Langganan perubahan peran (untuk kunci navigasi reaktif). Langsung
 * dipanggil sekali dengan nilai saat ini agar tak kehilangan restore yang
 * selesai sebelum subscribe (AsyncStorage web resolve dalam microtask). */
export function subscribeDeviceRole(cb: (r: DeviceRole) => void): () => void {
  listeners.add(cb);
  hydrate();
  try {
    cb(role);
  } catch {
    /* abaikan */
  }
  return () => {
    listeners.delete(cb);
  };
}

/** Rute beranda per peran. */
export function homeRouteFor(roleName: DeviceRole): string {
  if (roleName === 'DAPUR') return 'Kitchen';
  if (roleName === 'DISPLAY') return 'CustomerDisplay';
  return 'Dashboard';
}

/** Rute yang boleh dibuka tiap peran terkunci; KASIR = semua (tanpa batas).
 * Utilitas (QrScan klaim, Sync, Log, About, Help) selalu lolos agar perangkat
 * terkunci tetap bisa diklaim/didiagnosis; transaksi tetap dikunci. */
const UTIL_ROUTES = ['Login', 'Settings', 'QrScan', 'Sync', 'Log', 'About', 'Help'];

export function allowedRoutesFor(roleName: DeviceRole): Set<string> | null {
  if (roleName === 'DAPUR') {
    return new Set([...UTIL_ROUTES, 'Kitchen', 'Printers', 'Receipt']);
  }
  if (roleName === 'DISPLAY') {
    return new Set([...UTIL_ROUTES, 'CustomerDisplay', 'Idle']);
  }
  return null;
}
