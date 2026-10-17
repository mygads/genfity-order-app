/**
 * Deposit single-post: direct-or-one-light dengan kunci idempotensi bersama.
 *
 * Satu tap topup/deposit menghasilkan SATU kunci (`dep-` + UUIDv7) yang dipakai
 * di SEMUA kanal menuju `member-deposit-withdrawal/topup`: POST langsung
 * (body.clientId/client_id/uuid + header Idempotency-Key), baris fisik outbox
 * (tr_esoprocessqueue.orderID), dan light twin (id + body.clientId). Kontrak
 * konflik backend: retry client_id duplikat kembali 200 "Order already
 * synced" (posted/twin-ack via jalur 2xx); HTTP 409 HANYA SALE_DISPLAY_CONFLICT
 * (display_no dipakai order lain — deposit tak punya display_no, jadi 409 di
 * sini = tak dikenal → twin maju agar deposit tak hilang diam-diam).
 *
 * Tanpa teks user-facing baru (komentar saja, tanpa i18n).
 */
import { ApiPath } from '../config/server';
import { apiFetch } from './apiSource';
import { uuidv7 } from './uuidv7';

/** Kunci idempotensi deposit: `dep-` + UUIDv7 (total ~40 char, batas 128). */
export function newDepositKey(): string {
  return `dep-${uuidv7()}`;
}

export interface DepositPost {
  key: string;
  memberId: string;
  amount: number;
  method: string;
  note?: string;
}

/**
 * POST topup deposit SEKALI dengan kunci bersama. posted=true hanya bila
 * server NYATA menjawab ok. posted=false bila dummy/lokal/offline/gagal ATAU
 * 409 — pemanggil lalu mengantrekan SATU light twin dengan kunci yang sama.
 * 409 tetap dihitung twin (bukan posted) karena semantik 409 milik backend:
 * bila 409 memang duplikat, twin 409-ack tanpa kredit ganda; bila 409 non-
 * duplikat, twin menyelamatkan deposit dari hilang diam-diam. Tak melempar.
 */
export async function postDepositOnce({
  key,
  memberId,
  amount,
  method,
  note,
}: DepositPost): Promise<{ posted: boolean }> {
  try {
    const r = await apiFetch(ApiPath.depositTopup, {
      // Kunci identitas tiga ejaan (kontrak Q7 + drain): server boleh dedupe
      // via kolom/casing mana pun — ketiganya = kunci yang sama.
      body: { memberId, amount, paymentMethod: method, note: note ?? '', clientId: key, client_id: key, uuid: key },
      idempotencyKey: key,
    });
    // Dummy/lokal = bukan jawaban server (jaringan real-mode yang gagal jatuh
    // ke dummy): JANGAN anggap posted agar light twin tetap antre untuk push.
    if (r.fromDummy) return { posted: false };
    if (r.ok) return { posted: true };
    // 409 (SALE_DISPLAY_CONFLICT / tak dikenal — duplikat client_id kembali
    // 200, bukan 409) → twin berkunci-sama yang maju; aman dua arah (lihat dok
    // fungsi). Klasifikasi 409 push fisik/light ada di sync.ts.
    return { posted: false };
  } catch {
    return { posted: false };
  }
}
