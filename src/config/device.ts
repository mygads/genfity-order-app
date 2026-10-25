/**
 * Preferensi notifikasi perangkat (bukan station printer).
 *
 * R1: blok station DIHAPUS dari modul ini. Alasannya tiga:
 * 1. modul ini pakai `localStorage` (web-only) sehingga station tak persist
 *    di native murni;
 * 2. tak ada pemanggil (list/add/remove/setDefaultStation nol konsumen —
 *    PrintersScreen punya state + ms_station sendiri);
 * 3. duplikat `genfity.printer.stations` yang dipakai layar Printer.
 * Satu-satunya konsumen modul ini (getNotif/setNotif): SettingsScreen,
 * KitchenScreen, lib/push, lib/terminal.
 */

export interface NotifPrefs {
  soundNewOrder: boolean;
  autoPrintKitchen: boolean;
  customerDisplay: boolean;
}

const LS_NOTIF = 'genfity.device.notif';

const DEFAULT_NOTIF: NotifPrefs = {
  soundNewOrder: true,
  autoPrintKitchen: true,
  customerDisplay: false,
};

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
    const raw = lsGet(LS_NOTIF);
    if (raw) notif = { ...DEFAULT_NOTIF, ...(JSON.parse(raw) as NotifPrefs) };
  } catch {
    /* pakai default */
  }
}

function persist(): void {
  lsSet(LS_NOTIF, JSON.stringify(notif));
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
