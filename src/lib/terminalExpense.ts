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
 *   Yang BELUM ADA = endpoint upload-file terminal (BE hanya terima URL
 *   string; pola upload-proof publik terikat order, tak bisa dipakai expense;
 *   /upload/* butuh merchant-auth) → foto lokal = photoPending (marker
 *   storage + banner), PARKED di laporan (BE menyusul).
 * - Offline / dummy-mode = {posted:false} → pemanggil fallback jalur ESB lama
 *   (outbox + drain dipertahankan polanya; perilaku tak berubah).
 * - Sukses terminal = pemanggil LEWATI enqueue ESB (tutup ledger ganda).
 */
import { getApiMode } from './apiSource';
import { getBinding } from '../session';
import { createTerminalExpense, type TerminalExpenseKind } from './terminalApi';
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

export interface ExpenseHandoffInput {
  rowId: string;
  clientExpenseId: string;
  kind: TerminalExpenseKind;
  amount: number;
  note: string;
  occurredAt: string;
  /** A-P1-6: URL foto remote (https) bila ada; lokal = undefined + pemanggil
   *  menandai photoPending (tanpa endpoint upload terminal di BE — PARKED). */
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
