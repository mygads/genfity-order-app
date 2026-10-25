/**
 * A10: handoff expense/petty-cash → endpoint terminal
 * (POST /api/v1/terminals/{id}/expenses) — tutup 2 ledger kas sisi APP.
 *
 * Kontrak:
 * - clientExpenseId = uuidv7 SEKALI per expense, persist pra-kirim:
 *   ExpenseScreen id `EX-<uuid>` → strip prefix; PettyCashForm id baris
 *   sudah uuid mentah → pakai langsung. Retry memakai id yang SAMA.
 * - 409-duplicate = sukses (catat id server via setJSON).
 * - BE-BELUM-ADA (2026-10-25: endpoint belum ada di router BE) / offline /
 *   dummy-mode = {posted:false} → pemanggil fallback jalur ESB lama
 *   (outbox + drain dipertahankan polanya; perilaku tak berubah).
 * - Sukses terminal = pemanggil LEWATI enqueue ESB (tutup ledger ganda).
 */
import { getApiMode } from './apiSource';
import { getBinding } from '../session';
import { createTerminalExpense, type TerminalExpenseKind } from './terminalApi';
import { setJSON } from './storage';

export interface ExpenseHandoffInput {
  rowId: string;
  clientExpenseId: string;
  kind: TerminalExpenseKind;
  amount: number;
  note: string;
  occurredAt: string;
}

export interface ExpenseHandoff {
  posted: boolean;
  serverId: string;
  duplicate: boolean;
}

const NOT_POSTED: ExpenseHandoff = { posted: false, serverId: '', duplicate: false };

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
    return { posted: true, serverId, duplicate: r.data.duplicate === true };
  } catch {
    return NOT_POSTED;
  }
}
