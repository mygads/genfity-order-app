/**
 * A5: gerbang notifikasi verifikasi terminal (default-ON).
 *
 * BE-BELUM-ADA: belum ada server wiring — tidak ada pemanggil/enqueue/POST
 * di versi ini. Flag ini disiapkan agar saat endpoint BE verifikasi terminal
 * tersedia, situs emisi cukup memeriksa isTerminalVerifyNotifyEnabled()
 * sebelum memanggil notifyTerminalVerification (apiSource) — tanpa mengubah
 * perilaku default (ON) di instalasi lama.
 *
 * Penyimpanan: ms_setting ('Notify','TerminalVerify', '1'/'0'). Baris absen
 * (instalasi lama / belum diatur) = ON — perilaku default yang diinginkan.
 */
import { initDb, queryFirst, run } from './db';

export async function isTerminalVerifyNotifyEnabled(): Promise<boolean> {
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Notify' AND key2 = 'TerminalVerify' LIMIT 1`,
    );
    if (row == null || row.value1 == null) return true;
    return String(row.value1).trim() !== '0';
  } catch {
    return true;
  }
}

/** Set eksplisit (dipakai layar pengaturan bila kelak ada switch UI). */
export async function setTerminalVerifyNotifyEnabled(on: boolean): Promise<void> {
  try {
    await initDb();
    await run(
      `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Notify', 'TerminalVerify', ?, '1')
       ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
      [on ? '1' : '0'],
    );
  } catch {
    /* abaikan */
  }
}
