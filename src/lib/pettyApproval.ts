import { getJSON, setJSON } from './storage';
import { getSession } from '../session';
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

/** Tandai disetujui: tulis kanonis + rincian audit + outbox, lalu siarkan.
 * R28 (audit 2026-10-17): approvedBy pemanggil DIABAIKAN — approver WAJIB
 * userId sesi terverifikasi (getSession userId, fallback username). Tanpa
 * sesi = GAGAL-KERAS (throw) agar tak ada jalur approve boolean-tanpa-
 * identitas yang lolos diam-diam. Param kedua dipertahankan (opsional) agar
 * pemanggil lama tetap kompil; nilainya tidak dipakai. Rincian audit by+at
 * selalu disimpan (kolom boolean kanonis di atas dipertahankan apa adanya
 * agar baca lawas PettyCash/Expense tetap kompatibel) + satu item sync
 * 'other' (op expense-approve) agar identitas approver ikut terkirim. */
export async function markApproved(id: string, _approvedBy?: string): Promise<void> {
  const cleanId = String(id ?? '').trim();
  void _approvedBy; // R28: identitas pemanggil tak dipercaya — selalu dari sesi.
  const sess = getSession();
  const approver = String(sess?.userId ?? sess?.username ?? '').trim();
  if (!cleanId || !approver) {
    throw new Error(
      '[pettyApproval] markApproved butuh id + sesi login terverifikasi — approve tanpa identitas sesi ditolak.',
    );
  }
  const at = new Date().toISOString();
  try {
    const cur = await getJSON<Record<string, boolean>>(APPROVAL_KEY, {});
    cur[cleanId] = true;
    await setJSON(APPROVAL_KEY, cur);
    try {
      const det = await getJSON<Record<string, ApprovalDetail>>(DETAIL_KEY, {});
      det[cleanId] = { by: approver, at };
      await setJSON(DETAIL_KEY, det);
    } catch {
      /* abaikan: flag boolean di atas tetap sah */
    }
    await enqueueOutbox('tr_branchexpense', cleanId, 'update');
    try {
      enqueueSync('other', { table: 'tr_branchexpense', rowId: cleanId, op: 'expense-approve', approvedBy: approver, approvedAt: at });
    } catch {
      /* abaikan: outbox fisik di atas tetap jalan */
    }
  } catch {
    /* abaikan: state optimistis pemanggil tetap jalan */
  }
  for (const fn of listeners) {
    try {
      fn(cleanId);
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

type RevokeListener = (id: string) => void;
const revokeListeners = new Set<RevokeListener>();

/** Cabut persetujuan (revoke/unapprove, R28): hapus flag kanonis + rincian
 * audit + outbox/sync (op expense-unapprove), lalu siarkan ke listener
 * revoke. Identitas pencabut dari sesi terverifikasi (fail-closed bila tanpa
 * sesi). Listener terpisah dari approve agar layar tak salah menandai
 * disetujui saat revoke disiarkan. */
export async function unapprove(id: string): Promise<void> {
  const cleanId = String(id ?? '').trim();
  const sess = getSession();
  const revokedBy = String(sess?.userId ?? sess?.username ?? '').trim();
  if (!cleanId || !revokedBy) {
    throw new Error(
      '[pettyApproval] unapprove butuh id + sesi login terverifikasi.',
    );
  }
  const at = new Date().toISOString();
  try {
    const cur = await getJSON<Record<string, boolean>>(APPROVAL_KEY, {});
    delete cur[cleanId];
    await setJSON(APPROVAL_KEY, cur);
    try {
      const det = await getJSON<Record<string, ApprovalDetail>>(DETAIL_KEY, {});
      delete det[cleanId];
      await setJSON(DETAIL_KEY, det);
    } catch {
      /* abaikan: flag boolean di atas tetap sah */
    }
    await enqueueOutbox('tr_branchexpense', cleanId, 'update');
    try {
      enqueueSync('other', { table: 'tr_branchexpense', rowId: cleanId, op: 'expense-unapprove', revokedBy, revokedAt: at });
    } catch {
      /* abaikan: outbox fisik di atas tetap jalan */
    }
  } catch {
    /* abaikan */
  }
  for (const fn of revokeListeners) {
    try {
      fn(cleanId);
    } catch {
      /* abaikan satu listener rusak */
    }
  }
}

/** Langganan revoke lintas layar - kembalikan fungsi unsubscribe. */
export function subscribeApprovalRevokes(fn: RevokeListener): () => void {
  revokeListeners.add(fn);
  return () => {
    revokeListeners.delete(fn);
  };
}
