/**
 * A10: handoff expense/petty-cash → endpoint terminal
 * (POST /api/v1/terminals/{id}/expenses) — tutup 2 ledger kas sisi APP.
 *
 * Kontrak:
 * - clientExpenseId = uuidv7 SEKALI per expense, persist pra-kirim:
 *   ExpenseScreen id `EX-<uuid>` → strip prefix; PettyCashForm id baris
 *   sudah uuid mentah → pakai langsung. Retry memakai id yang SAMA.
 * - 409-duplicate = sukses (catat id server via setJSON).
 * - Endpoint ADA (BE TerminalExpenseCreate, terima + gema photoUrl ≤2048).
 * - SESI-FINAL-APP: endpoint upload-file terminal ADA (K1: POST
 *   /api/v1/terminals/{id}/uploads multipart → 201 {url}) → alur upload-DULU:
 *   foto lokal diunggah SEBELUM handoff; sukses = kirim photoUrl; gagal/
 *   offline = photoPending (marker storage + banner) + retry ringan saat
 *   online kembali (re-post idempoten clientExpenseId yang SAMA — 409 =
 *   sukses, tanpa ledger ganda; pending dihapus HANYA bila server menggema
 *   photoUrl / duplikat sukses).
 * - Offline / dummy-mode = {posted:false} → pemanggil fallback jalur ESB lama
 *   (outbox + drain dipertahankan polanya; perilaku tak berubah).
 * - Sukses terminal = pemanggil LEWATI enqueue ESB (tutup ledger ganda).
 */
import { getApiMode } from './apiSource';
import { getBinding } from '../session';
import { createTerminalExpense, uploadTerminalFile, type TerminalExpenseKind } from './terminalApi';
import { initDb, queryFirst, run } from './db';
import { getJSON, setJSON } from './storage';

/** A-P1-6: foto lokal = remote-URL? Hanya https? yang boleh jadi photoUrl. */
export function isRemotePhoto(u: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(u ?? '').trim());
}

/** Indeks storage foto-menunggu-upload (drain masa depan; BE endpoint PARKED). */
const PHOTO_PENDING_INDEX = 'genfity.expense.photoPending.index';
const photoPendingKey = (rowId: string): string => `genfity.expense.photoPending.${rowId}`;

/** Tandai foto lokal menunggu upload server (durable, tanpa outbox ganda).
 *  Tak pernah melempar. Drain upload kelak membaca indeks ini. */
export async function markPhotoPending(rowId: string, docPath: string): Promise<void> {
  try {
    const at = new Date().toISOString();
    await setJSON(photoPendingKey(rowId), { expenseId: rowId, docPath, at });
    const idx = await getJSON<string[]>(PHOTO_PENDING_INDEX, []);
    if (!idx.includes(rowId)) await setJSON(PHOTO_PENDING_INDEX, [...idx, rowId]);
  } catch {
    /* best-effort */
  }
}

/** Hapus marker pending (dipanggil HANYA setelah server menggema photoUrl /
 *  duplikat sukses — bukan saat upload lokal sukses). Tak pernah melempar. */
export async function clearPhotoPending(rowId: string): Promise<void> {
  try {
    const idx = await getJSON<string[]>(PHOTO_PENDING_INDEX, []);
    if (idx.includes(rowId)) {
      await setJSON(
        PHOTO_PENDING_INDEX,
        idx.filter((x) => x !== rowId),
      );
    }
    await setJSON(photoPendingKey(rowId), null);
  } catch {
    /* best-effort */
  }
}

/** Baca antrean pending (terbatas; untuk retry + banner). Tak pernah melempar. */
export async function listPhotoPending(limit = 20): Promise<Array<{ rowId: string; docPath: string }>> {
  try {
    const idx = await getJSON<string[]>(PHOTO_PENDING_INDEX, []);
    const out: Array<{ rowId: string; docPath: string }> = [];
    for (const rowId of idx.slice(0, Math.max(1, Math.min(50, limit)))) {
      try {
        const m = await getJSON<{ docPath?: unknown } | null>(photoPendingKey(rowId), null);
        const p = String(m?.docPath ?? '').trim();
        if (p) out.push({ rowId, docPath: p });
      } catch {
        /* lewati entri rusak */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** SESI-FINAL-APP: unggah foto lokal ke endpoint upload terminal (K1).
 *  Kembalikan URL https (≤2048) atau '' bila gagal/offline/unbound.
 *  Tak pernah melempar; gagal = pemanggil fallback photoPending. */
export async function uploadExpensePhotoFirst(localUri: string): Promise<string> {
  const src = String(localUri ?? '').trim();
  if (!src || isRemotePhoto(src)) return isRemotePhoto(src) ? src.slice(0, 2048) : '';
  const tid = boundTerminalId();
  if (!tid) return '';
  try {
    if (getApiMode() !== 'real') return '';
  } catch {
    return '';
  }
  try {
    const r = await uploadTerminalFile(tid, src);
    if (!r || !r.ok || r.fromDummy) return '';
    const url = String(r.data.url ?? '').trim();
    return /^https:\/\/.{1,2040}$/i.test(url) ? url.slice(0, 2048) : '';
  } catch {
    return '';
  }
}

type ExpenseRowLite = {
  id: string;
  amount: number | null;
  note: string | null;
  expenseDate: string | null;
  createdAt: string | null;
  photoPath: string | null;
};

/** SESI-FINAL-APP: retry ringan foto-pending saat online kembali.
 *  Per baris: upload docPath → re-post idempoten (clientExpenseId SAMA) +
 *  photoUrl → pending dihapus HANYA bila server menggema photoUrl / cevap
 *  duplikat sukses; DB lokal photoPath/docPath dimutakhirkan ke URL remote.
 *  Fire-and-forget dari focus/mount layar; tak pernah melempar.
 *  Kembalikan jumlah baris yang lunas-pending. */
export async function retryPendingExpensePhotos(limit = 10): Promise<number> {
  let settled = 0;
  let pend: Array<{ rowId: string; docPath: string }>;
  try {
    pend = await listPhotoPending(limit);
  } catch {
    return 0;
  }
  if (pend.length === 0) return 0;
  const tid = boundTerminalId();
  if (!tid) return 0;
  try {
    if (getApiMode() !== 'real') return 0;
  } catch {
    return 0;
  }
  try {
    await initDb();
  } catch {
    return 0;
  }
  for (const { rowId, docPath } of pend) {
    try {
      // Sudah remote (mis. ditulis layar lain) = bukan tugas retry.
      if (isRemotePhoto(docPath)) {
        await clearPhotoPending(rowId);
        settled += 1;
        continue;
      }
      const url = await uploadExpensePhotoFirst(docPath);
      if (!url) continue; // offline/gagal = tetap pending, coba lain waktu
      const row = await queryFirst<ExpenseRowLite>(
        'SELECT id, amount, note, expenseDate, createdAt, photoPath FROM tr_branchexpense WHERE id = ?',
        [rowId],
      );
      if (!row) {
        await clearPhotoPending(rowId); // baris hilang lokal = nothing to attach
        continue;
      }
      const isExp = String(row.id ?? '').startsWith('EX-');
      const h = await postExpenseToTerminal({
        rowId,
        clientExpenseId: isExp ? String(row.id).slice(3) : String(row.id),
        kind: (isExp ? 'EXPENSE' : 'PETTY_CASH') as TerminalExpenseKind,
        amount: Math.round(Number(row.amount ?? 0)),
        note: String(row.note ?? '').slice(0, 500),
        occurredAt: String(row.expenseDate ?? row.createdAt ?? new Date().toISOString()),
        photoUrl: url,
      });
      if (!h.posted) continue; // gagal post = tetap pending
      const echoed = String(h.photoUrl ?? '').trim();
      // Pending lunas HANYA bila server menggema photoUrl ATAU duplikat
      // sukses (re-post idempoten = server sudah pegang baris ini).
      if (echoed === url || h.duplicate || (echoed && isRemotePhoto(echoed))) {
        const finalUrl = echoed && isRemotePhoto(echoed) ? echoed.slice(0, 2048) : url;
        try {
          await run('UPDATE tr_branchexpense SET photoPath = ? WHERE id = ?', [finalUrl, rowId]);
          await run("UPDATE tr_branchexpensedocument SET docPath = ? WHERE expenseId = ? AND docType = 'photo'", [finalUrl, rowId]);
        } catch {
          /* DB lokal gagal tulis: marker tetap dihapus (server sudah pegang) */
        }
        await clearPhotoPending(rowId);
        settled += 1;
      }
      // Tanpa gema = tetap pending (jujur: foto mungkin belum menempel).
    } catch {
      /* lanjut baris berikut */
    }
  }
  return settled;
}

export interface ExpenseHandoffInput {
  rowId: string;
  clientExpenseId: string;
  kind: TerminalExpenseKind;
  amount: number;
  note: string;
  occurredAt: string;
  /** URL foto remote (https) — SESI-FINAL-APP: diisi dari uploadExpensePhotoFirst
   *  (upload-dulu) atau foto yang memang sudah remote; lokal = undefined +
   *  pemanggil menandai photoPending + retry saat online kembali. */
  photoUrl?: string;
}

export interface ExpenseHandoff {
  posted: boolean;
  serverId: string;
  duplicate: boolean;
  /** Gema photoUrl server ('' bila tak ada / tak dikirim). */
  photoUrl: string;
}

const NOT_POSTED: ExpenseHandoff = { posted: false, serverId: '', duplicate: false, photoUrl: '' };

function withTimeoutMs<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  const limit = Math.max(1000, Math.floor(ms));
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), limit);
    }),
  ]);
}

/** Id terminal terikat (binding), '' bila unbound. */
export function boundTerminalId(): string {
  try {
    return (getBinding()?.terminalId ?? '').trim();
  } catch {
    return '';
  }
}

/** Coba POST expense ke endpoint terminal (immediate-first, best-effort).
 * Tak pernah melempar; gagal = {posted:false} (fallback ESB milik pemanggil). */
export async function postExpenseToTerminal(inp: ExpenseHandoffInput): Promise<ExpenseHandoff> {
  const tid = boundTerminalId();
  if (!tid) return NOT_POSTED;
  try {
    if (getApiMode() !== 'real') return NOT_POSTED; // local/dummy = fallback ESB, jangan fake sukses
  } catch {
    return NOT_POSTED;
  }
  const cid = String(inp.clientExpenseId ?? '').trim();
  if (!cid) return NOT_POSTED;
  try {
    const r = await withTimeoutMs(
      createTerminalExpense(tid, {
        clientExpenseId: cid,
        kind: inp.kind,
        amount: Math.round(inp.amount),
        note: String(inp.note ?? '').slice(0, 500),
        occurredAt: inp.occurredAt,
        // A-P1-6: kirim photoUrl HANYA bila remote; >2048 char = omit
        // (kontrak BE 400) + pemanggil menandai photoPending.
        ...(isRemotePhoto(inp.photoUrl) && String(inp.photoUrl).trim().length <= 2048
          ? { photoUrl: String(inp.photoUrl).trim() }
          : {}),
      }),
    );
    if (!r || !r.ok || r.fromDummy) return NOT_POSTED;
    const serverId = String(r.data.id ?? '').trim();
    if (serverId) {
      try {
        await setJSON(`genfity.expense.server.${inp.rowId}`, serverId);
      } catch {
        /* abaikan: catat best-effort */
      }
    }
    return { posted: true, serverId, duplicate: r.data.duplicate === true, photoUrl: String(r.data.photoUrl ?? '') };
  } catch {
    return NOT_POSTED;
  }
}
