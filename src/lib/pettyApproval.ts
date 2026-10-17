import { getJSON, setJSON } from './storage';
import { enqueueOutbox, enqueueSync } from './sync';

/**
 * Status approve expense/petty cash lintas layar (F7).
 *
 * Dulu dua kunci berbeda untuk tabel yang sama (`tr_branchexpense`):
 * PettyCash pakai `genfity.petty.approved`, Expense pakai
 * `genfity.expense.approved` - approve di satu layar tak terlihat di layar
 * lain. Kini SATU kunci kanonis + gabung-baca lawas + siaran in-memory,
 * sehingga approve dari layar mana pun langsung tercermin di semua daftar
 * tanpa focus-listener (navigasi kustom tak menyediakan event focus).
 */

/** Kunci kanonis status approve (tulis baru selalu ke sini). */
export const APPROVAL_KEY = 'genfity.expense.approved';
/** Kunci lawas PettyCash - hanya dibaca (migrasi gabung) agar data lama tak hilang. */
const LEGACY_PETTY_KEY = 'genfity.petty.approved';

type ApprovalListener = (id: string) => void;
const listeners = new Set<ApprovalListener>();

/** Peta approve gabungan kanonis + lawas (OR) - tak pernah throw. */
export async function getApprovals(): Promise<Record<string, boolean>> {
  try {
    const [cur, legacy] = await Promise.all([
      getJSON<Record<string, boolean>>(APPROVAL_KEY, {}),
      getJSON<Record<string, boolean>>(LEGACY_PETTY_KEY, {}),
    ]);
    return { ...legacy, ...cur };
  } catch {
    return {};
  }
}

/** Rincian audit approval (app-shift 2026-10-17, row-17 petty): siapa + kapan.
 * Kunci boolean kanonis di atas tak berubah (kompatibel baca lawas
 * PettyCash/Expense); identitas approver tercatat di kunci detail terpisah. */
export interface ApprovalDetail {
  by: string;
  at: string;
}
const DETAIL_KEY = 'genfity.expense.approved.detail';

/** Rincian approve satu expense; null bila belum pernah di-approve ber-PIN. */
export async function getApprovalDetail(id: string): Promise<ApprovalDetail | null> {
  try {
    const all = await getJSON<Record<string, ApprovalDetail>>(DETAIL_KEY, {});
    return all[id] ?? null;
  } catch {
    return null;
  }
}

/** Tandai disetujui: tulis kanonis + outbox, lalu siarkan ke semua layar.
 * approvedBy = userId pemilik PIN eskalasi (verifyLocalEscalation). Bila diisi
 * (jalur ExpenseScreen ber-PIN): rincian audit by+at disimpan + satu item sync
 * 'other' (op expense-approve) diantrekan agar identitas approver ikut
 * terkirim. Tanpa approvedBy = jalur lawas (PettyCashScreen/Detail) yang
 * perilakunya tak berubah. */
export async function markApproved(id: string, approvedBy?: string): Promise<void> {
  const at = new Date().toISOString();
  try {
    const cur = await getJSON<Record<string, boolean>>(APPROVAL_KEY, {});
    cur[id] = true;
    await setJSON(APPROVAL_KEY, cur);
    if (approvedBy) {
      try {
        const det = await getJSON<Record<string, ApprovalDetail>>(DETAIL_KEY, {});
        det[id] = { by: approvedBy, at };
        await setJSON(DETAIL_KEY, det);
      } catch {
        /* abaikan: flag boolean di atas tetap sah */
      }
    }
    await enqueueOutbox('tr_branchexpense', id, 'update');
    if (approvedBy) {
      try {
        enqueueSync('other', { table: 'tr_branchexpense', rowId: id, op: 'expense-approve', approvedBy, approvedAt: at });
      } catch {
        /* abaikan: outbox fisik di atas tetap jalan */
      }
    }
  } catch {
    /* abaikan: state optimistis pemanggil tetap jalan */
  }
  for (const fn of listeners) {
    try {
      fn(id);
    } catch {
      /* abaikan satu listener rusak */
    }
  }
}

/** Langganan approve lintas layar - kembalikan fungsi unsubscribe. */
export function subscribeApprovals(fn: ApprovalListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
