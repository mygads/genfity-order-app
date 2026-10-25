/**
 * Konfigurasi perangkat milik sendiri: station printer + preferensi
 * notifikasi. Cerminkan FAKTA skema `ms_station` APK (nama, peran,
 * tipe koneksi, alamat MAC/IP, kolom karakter, autocut, default)
 * tanpa menyalin kode aslinya.
 */

export type StationType = 'Bluetooth' | 'USB' | 'LAN';
export type StationRole = 'Kasir' | 'Dapur';

export interface Station {
  id: string;
  name: string;
  role: StationRole;
  type: StationType;
  /** MAC Bluetooth atau IP:port LAN; kosong untuk USB. */
  address: string;
  cols: 32 | 42;
  autocut: boolean;
  isDefault: boolean;
}

export interface NotifPrefs {
  soundNewOrder: boolean;
  autoPrintKitchen: boolean;
  customerDisplay: boolean;
}

const LS_STATIONS = 'genfity.device.stations';
const LS_NOTIF = 'genfity.device.notif';

const DEFAULT_STATIONS: Station[] = [
  {
    id: 'st-kasir',
    name: 'Printer Kasir',
    role: 'Kasir',
    type: 'Bluetooth',
    address: '',
    cols: 32,
    autocut: true,
    isDefault: true,
  },
  {
    id: 'st-dapur',
    name: 'Printer Dapur',
    role: 'Dapur',
    type: 'LAN',
    // #11: alamat default SENGAJA kosong (dulu 192.168.1.50:9100 basi) —
    // kasir wajib mengisi di layar Printer; IP basi bisa salah kirim cetakan.
    address: '',
    cols: 32,
    autocut: false,
    isDefault: false,
  },
];

const DEFAULT_NOTIF: NotifPrefs = {
  soundNewOrder: true,
  autoPrintKitchen: true,
  customerDisplay: false,
};

let stations: Station[] = [...DEFAULT_STATIONS];
let notif: NotifPrefs = { ...DEFAULT_NOTIF };
let hydrated = false;

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    /* abaikan */
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = lsGet(LS_STATIONS);
    if (raw) {
      const parsed = JSON.parse(raw) as Station[];
      if (Array.isArray(parsed) && parsed.length > 0) stations = parsed;
    }
  } catch {
    /* pakai default */
  }
  try {
    const raw = lsGet(LS_NOTIF);
    if (raw) notif = { ...DEFAULT_NOTIF, ...(JSON.parse(raw) as NotifPrefs) };
  } catch {
    /* pakai default */
  }
}

function persist(): void {
  lsSet(LS_STATIONS, JSON.stringify(stations));
  lsSet(LS_NOTIF, JSON.stringify(notif));
}

export function listStations(): Station[] {
  hydrate();
  return stations.map((s) => ({ ...s }));
}

export function addStation(s: Omit<Station, 'id'>): Station {
  hydrate();
  const item: Station = { ...s, id: `st-${Date.now()}` };
  stations = s.isDefault
    ? [...stations.map((x) => ({ ...x, isDefault: false })), item]
    : [...stations, item];
  persist();
  return item;
}

export function removeStation(id: string): void {
  hydrate();
  stations = stations.filter((s) => s.id !== id);
  persist();
}

export function setDefaultStation(id: string): void {
  hydrate();
  stations = stations.map((s) => ({ ...s, isDefault: s.id === id }));
  persist();
}

export function getNotif(): NotifPrefs {
  hydrate();
  return { ...notif };
}

export function setNotif(next: Partial<NotifPrefs>): NotifPrefs {
  hydrate();
  notif = { ...notif, ...next };
  persist();
  return { ...notif };
}
