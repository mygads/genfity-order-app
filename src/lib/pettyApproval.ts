import { getJSON, setJSON } from './storage';
import { enqueueOutbox } from './sync';

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

/** Tandai disetujui: tulis kanonis + outbox, lalu siarkan ke semua layar. */
export async function markApproved(id: string): Promise<void> {
  try {
    const cur = await getJSON<Record<string, boolean>>(APPROVAL_KEY, {});
    cur[id] = true;
    await setJSON(APPROVAL_KEY, cur);
    await enqueueOutbox('tr_branchexpense', id, 'update');
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
