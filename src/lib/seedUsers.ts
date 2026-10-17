/**
 * Jaring pengaman user uji — menegakkan keputusan "2 user saja" (admin +
 * kasir) untuk DB lama yang telanjur berisi u-owner.
 *
 * Latar: seed.ts dulu men-seed 3 user (u-admin, u-owner, u-kasir); kini
 * u-owner/owner sudah dibuang di hulu (testUsers di lib/seed.ts) dan literal
 * 'u-owner' pencatat topup awal member dialihkan ke 'u-admin'. Modul ini
 * dipertahankan sebagai pembersih DB lama: buang u-owner + alihkan jejaknya
 * ke 'u-admin'. Idempoten (aman jalan ulang) dan tak pernah melempar —
 * dipanggil dari ensureSeeded() SEBELUM gate flag seed (agar DB lama yang
 * flag-nya sudah '1' ikut bersih) dan dari LoginScreen.submit sebelum
 * validateEmployee(), sehingga u-owner tak pernah bisa dipakai login.
 */
import { run } from './db';

/** Buang u-owner + alihkan jejaknya ke u-admin. Idempoten, tak melempar. */
export async function trimTestUsers(): Promise<void> {
  const steps: Array<[string, string[]]> = [
    [`DELETE FROM ms_posuseraccess WHERE userId = ?`, ['u-owner']],
    [`UPDATE tr_memberdeposit SET userId = 'u-admin' WHERE userId = ?`, ['u-owner']],
    [`UPDATE tr_membertransactionlog SET userId = 'u-admin' WHERE userId = ?`, ['u-owner']],
    [`DELETE FROM ms_posuser WHERE id = ?`, ['u-owner']],
  ];
  for (const [sql, params] of steps) {
    try {
      await run(sql, params);
    } catch {
      /* tabel lama belum ada / baris sudah hilang — abaikan, login yang memutuskan */
    }
  }
  // Sabuk pengaman: PIN u-owner yang telanjur tersimpan ikut dibuang agar
  // tak ada kredensial yatim. Best-effort (modul pin tak pernah melempar
  // yang fatal, tapi tetap dibungkus).
  try {
    const { removePinHash } = await import('./pin');
    await removePinHash('u-owner');
  } catch {
    /* abaikan */
  }
}
