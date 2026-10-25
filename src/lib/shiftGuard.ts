import { initDb, queryFirst } from './db';
import { getBranchId } from '../config/server';

/** Status shift terakhir dari DB lokal (tr_shiftlog).
 * A-P1-5 fail-closed: null HANYA berarti instalasi fresh (riwayat kosong
 * total) — dan fresh pun wajib buka shift via hasOpenShift (false).
 * DB-error TIDAK lagi null-bebas: dikembalikan sebagai status tutup dengan
 * flag dbError agar pemanggil memblokir + menampilkan pesan DB, bukan pesan
 * shift-tutup yang menyesatkan. Cermin guard navigator di App.tsx TIDAK
 * diubah (soft-guard rute awal; demo/screenshot tetap mendarat Dashboard,
 * tetapi semua pintu kasir/deposit digerbang di sini). */
export interface ShiftStatus {
  open: boolean;
  clockIn: string | null;
  cashInDrawer: number;
  /** true = baris ini adalah kegagalan baca DB (blokir + pesan DB). */
  dbError?: boolean;
}

/** Baris shift terakhir, atau null bila riwayat kosong / DB belum siap. */
/** Baris shift terakhir (absensi dikecualikan), atau status tutup bila riwayat
 *  hanya berisi absensi, atau null bila instalasi fresh (riwayat kosong total).
 *  DB-error BUKAN null (A-P1-5): status tutup + flag dbError (fail-closed).
 *  null = fresh = hasOpenShift false (wajib buka shift). */
export async function getShiftStatus(): Promise<ShiftStatus | null> {
  try {
    await initDb();
    const row = await queryFirst<{
      clockIn: string | null;
      clockOut: string | null;
      status: string | null;
      cashInDrawer: number | null;
    }>(
      // Baris absensi (status 'absen') dikecualikan: clock-in/out kehadiran
      // BUKAN shift kasir; tanpa filter, absen-masuk setelah shift tutup
      // (clockOut NULL) terbaca "open" dan gerbang kasir bocor.
      // Lingkup cabang: shift open cabang LAIN tak boleh membuka kasir
      // cabang ini (perangkat = 1 cabang; baris lama tanpa branchId = milik kami).
      'SELECT clockIn, clockOut, status, cashInDrawer FROM tr_shiftlog WHERE (status IS NULL OR status <> \'absen\') AND (branchId = ? OR branchId IS NULL OR branchId = \'\') ORDER BY clockIn DESC LIMIT 1',
      [getBranchId()],
    );
    if (row) {
      return {
        open: row.status === 'open' || !row.clockOut,
        clockIn: row.clockIn,
        cashInDrawer: Math.round(Number(row.cashInDrawer) || 0),
      };
    }
    // Tanpa baris shift: bedakan fresh install (bebas) vs hanya-absensi
    // (kasir sudah absen tapi belum pernah buka shift → tetap wajib buka shift).
    const total = await queryFirst<{ c: number }>('SELECT COUNT(*) AS c FROM tr_shiftlog');
    if (total && Number(total.c) > 0) {
      return { open: false, clockIn: null, cashInDrawer: 0 };
    }
    return null;
  } catch {
    // A-P1-5: DB-error = BLOKIR (fail-closed), bukan bebas. null dicadangkan
    // untuk fresh-install saja; pemanggil membedakan via flag dbError untuk
    // menampilkan pesan DB (bukan "shift tutup").
    return { open: false, clockIn: null, cashInDrawer: 0, dbError: true };
  }
}

/** true = boleh masuk kasir (shift buka). false = shift tutup, instalasi
 *  fresh (wajib buka shift dulu, A-P1-5), atau DB belum siap (fail-closed). */
export async function hasOpenShift(): Promise<boolean> {
  const st = await getShiftStatus();
  return st === null ? false : st.open;
}

/** Klasifikasi blokir untuk pemilihan pesan (A-P1-5): 'fresh' = instalasi
 *  baru wajib buka shift; 'db-error' = DB belum siap (pesan DB, tanpa pesan
 *  shift-tutup); 'closed' = shift tutup biasa; null = boleh lanjut. */
export type ShiftBlockKind = 'fresh' | 'db-error' | 'closed';

export async function getShiftBlockKind(): Promise<ShiftBlockKind | null> {
  const st = await getShiftStatus();
  if (st === null) return 'fresh';
  if (st.dbError) return 'db-error';
  return st.open ? null : 'closed';
}

/** Gerbang masuk kasir lintas-layar: bila shift tutup/fresh, sampaikan pesan
 *  lewat onBlocked lalu arahkan ke layar Shift (pola sama seperti CTA Transaksi
 *  Baru di Dashboard). DB-error: sampaikan dbErrorMsg (atau blockedMsg) TANPA
 *  navigasi — layar Shift pun butuh DB, kasir cukup diam + pesan + bisa coba
 *  lagi. Kembalikan true bila boleh lanjut ke Cashier. */
export async function ensureShiftOpen(
  navigation:
    | { navigate: (screen: string, params?: Record<string, unknown>) => void }
    | undefined,
  blockedMsg: string,
  onBlocked?: (msg: string) => void,
  dbErrorMsg?: string,
): Promise<boolean> {
  const kind = await getShiftBlockKind();
  if (kind === null) return true;
  if (kind === 'db-error') {
    onBlocked?.(dbErrorMsg ?? blockedMsg);
    return false;
  }
  onBlocked?.(blockedMsg);
  navigation?.navigate('Shift');
  return false;
}

/* --- Pemancar perubahan shift (HP-E2E 2026-10-24) ---
 * Latar: soft-guard `shiftClosed` di App.tsx hanya dihitung saat login.
 * Setelah shift dibuka, strip kuning basi tetap tampil di SEMUA layar authed
 * (menggeser navy header ke bawah → gap tak konsisten antar-layar).
 * Layar Shift/EndShift memanggil notifyShiftChanged() setelah tulis lokal
 * sukses; App berlangganan dan menghitung ulang guard. Tanpa impor App
 * (anti-siklus). */

type ShiftListener = () => void;

const shiftListeners = new Set<ShiftListener>();

export function subscribeShiftGuard(fn: ShiftListener): () => void {
  shiftListeners.add(fn);
  return () => {
    shiftListeners.delete(fn);
  };
}

export function notifyShiftChanged(): void {
  for (const fn of [...shiftListeners]) {
    try {
      fn();
    } catch {
      /* abaikan */
    }
  }
}
