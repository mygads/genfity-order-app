import { initDb, queryFirst } from './db';

/** Status shift terakhir dari DB lokal (tr_shiftlog).
 * Cermin logika guard navigator di App.tsx: instalasi fresh (riwayat kosong)
 * bebas agar demo/screenshot jalan; ada riwayat tapi tak ada yang open
 * berarti shift tutup dan kasir wajib diblokir sampai buka shift. */
export interface ShiftStatus {
  open: boolean;
  clockIn: string | null;
  cashInDrawer: number;
}

/** Baris shift terakhir, atau null bila riwayat kosong / DB belum siap. */
export async function getShiftStatus(): Promise<ShiftStatus | null> {
  try {
    await initDb();
    const row = await queryFirst<{
      clockIn: string | null;
      clockOut: string | null;
      status: string | null;
      cashInDrawer: number | null;
    }>(
      'SELECT clockIn, clockOut, status, cashInDrawer FROM tr_shiftlog ORDER BY clockIn DESC LIMIT 1',
    );
    if (!row) return null;
    return {
      open: row.status === 'open' || !row.clockOut,
      clockIn: row.clockIn,
      cashInDrawer: Math.round(Number(row.cashInDrawer) || 0),
    };
  } catch {
    return null;
  }
}

/** true = boleh masuk kasir (shift buka, instalasi fresh, atau DB belum siap
 *  sehingga jangan blokir kasir). false = shift tutup. */
export async function hasOpenShift(): Promise<boolean> {
  const st = await getShiftStatus();
  return st === null ? true : st.open;
}

/** Gerbang masuk kasir lintas-layar: bila shift tutup, sampaikan pesan lewat
 *  onBlocked lalu arahkan ke layar Shift (pola sama seperti CTA Transaksi Baru
 *  di Dashboard). Kembalikan true bila boleh lanjut ke Cashier. */
export async function ensureShiftOpen(
  navigation:
    | { navigate: (screen: string, params?: Record<string, unknown>) => void }
    | undefined,
  blockedMsg: string,
  onBlocked?: (msg: string) => void,
): Promise<boolean> {
  if (await hasOpenShift()) return true;
  onBlocked?.(blockedMsg);
  navigation?.navigate('Shift');
  return false;
}
