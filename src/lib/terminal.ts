/**
 * Setting per terminal (kontrak §4.2 + API-TERMINAL-CONTRACT §3).
 *
 * Dipanggil setelah klaim terminal (SettingsScreen.saveTerminal) agar printer
 * dan preferensi mengikuti konfigurasi server, bukan setting manual per tablet.
 * Server menang: nilai dari `ms_terminalsetting` menimpa lokal.
 * Best-effort: diam bila offline / bukan env Custom (pullMaster melempar).
 */
import { getTerminal } from '../config/server';
import { getNotif, setNotif } from '../config/device';
import { initDb, query } from './db';
import { getItem, getJSON, setItem, setJSON } from './storage';
import { pullMaster } from './master';
import { parseDeviceRole, setDeviceRole } from './deviceRole';

const LS_STATIONS = 'genfity.printer.stations';
const LS_RECEIPT_FOOTER = 'genfity.terminal.receiptFooter';

interface StationLite {
  id: string;
  isDefault?: boolean;
}

/** Kunci setting yang dikenal aplikasi (selainnya diabaikan, tetap tersimpan di SQLite). */
export const KNOWN_TERMINAL_KEYS = ['deviceRole', 'autoPrintKitchen', 'printerDefault', 'receiptFooter'] as const;

export interface TerminalSyncResult {
  ok: boolean;
  applied: string[];
  skipped: boolean;
}

/**
 * Tarik `terminalsettings` lalu terapkan kunci yang dikenal.
 * Tak pernah melempar; kembalikan ringkasan untuk pesan UI.
 */
export async function syncTerminalSettings(): Promise<TerminalSyncResult> {
  const applied: string[] = [];
  try {
    await pullMaster(['terminalsettings']);
  } catch {
    return { ok: false, applied, skipped: true };
  }
  try {
    await initDb();
    const t = getTerminal();
    const rows = await query<{ settingKey: string | null; settingValue: string | null; flag: number | null }>(
      // Cocok terminalCode klaim ATAU branchId: BE boleh mengunci baris
      // memakai terminalId asli (T001) atau kode klaim - keduanya lewat
      // body pull yang sama (terminalId = terminalCode).
      'SELECT settingKey, settingValue, flag FROM ms_terminalsetting WHERE terminalId IN (?, ?)',
      [t.terminalCode, t.branchId],
    );
    for (const r of rows) {
      const key = (r.settingKey ?? '').trim();
      if (!key || Number(r.flag) === 0) continue;
      const val = (r.settingValue ?? '').trim();
      if (key === 'deviceRole') {
        const role = parseDeviceRole(val);
        if (role) {
          setDeviceRole(role);
          applied.push(key);
        }
      } else if (key === 'autoPrintKitchen') {
        const on = val === '1' || val.toLowerCase() === 'true';
        if (getNotif().autoPrintKitchen !== on) setNotif({ autoPrintKitchen: on });
        applied.push(key);
      } else if (key === 'printerDefault') {
        if (val) {
          const stations = await getJSON<StationLite[]>(LS_STATIONS, []);
          if (stations.some((s) => s.id === val || s.id.toLowerCase() === val.toLowerCase())) {
            const target = stations.find((s) => s.id === val || s.id.toLowerCase() === val.toLowerCase());
            await setJSON(
              LS_STATIONS,
              stations.map((s) => ({ ...s, isDefault: s.id === target?.id })),
            );
            applied.push(key);
          }
        }
      } else if (key === 'receiptFooter') {
        await setItem(LS_RECEIPT_FOOTER, val);
        applied.push(key);
      }
    }
    return { ok: true, applied, skipped: false };
  } catch {
    return { ok: false, applied, skipped: true };
  }
}

/** Footer struk dari server ('' bila belum pernah sync). */
export async function getReceiptFooter(): Promise<string> {
  try {
    return (await getItem(LS_RECEIPT_FOOTER)) ?? '';
  } catch {
    return '';
  }
}
