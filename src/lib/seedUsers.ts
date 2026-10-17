/**
 * Trim user uji — menegakkan keputusan "2 user saja" (admin + kasir) TANPA
 * menyentuh lib/seed.ts (lane beku/dirty milik worker).
 *
 * Latar: seed.ts men-seed 3 user (u-admin, u-owner, u-kasir). Keputusan produk:
 * u-owner/1111 dibuang; baris seed yang mencatat userId 'u-owner' (topup awal
 * member) dialihkan ke 'u-admin'. Modul ini idempoten (aman jalan ulang) dan
 * tak pernah melempar — dipanggil dari LoginScreen.submit setelah
 * ensureSeeded() dan SEBELUM validateEmployee(), sehingga u-owner tak pernah
 * bisa dipakai login.
 *
 * CATATAN UNTUK MASA DEPAN: bila lane seed.ts sudah bebas/merge, lipat logika
 * ini ke hulu (hapus blok testUsers u-owner di seed + ganti literal
 * 'u-owner' -> 'u-admin' di seed member), lalu HAPUS modul ini dan
 * pemanggilannya di LoginScreen.
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
