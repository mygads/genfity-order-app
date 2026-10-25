/**
 * A11: duduki/kosongkan meja via endpoint terminal
 * (POST /api/v1/terminals/{id}/tables/{tableId}/transition) + occupiedSince.
 *
 * Kontrak BE (final 2026-10-25):
 * - POST .../tables/{tableId}/transition {status:OCCUPIED|AVAILABLE,guestName?,partySize?1-40}
 *   → {id,tableNumber,status,statusSince,guestName,partySize}; 409 TABLE_CAPACITY_EXCEEDED.
 * - occupiedSince (statusSince) = sumber timer seated (server-menang);
 *   offline/tak-terjangkau = fallback lokal (tulis-lokal + antrean sync tetap jalan).
 *
 * Id-mapping gap (PARKED BE-BUTUH-LIST): kontrak memakai tableId NUMERIK
 * server; ms_table.id lokal bisa string seed ('T-A01')/uuid. Helper me-resolve
 * via ms_table (tableNo/id → id); non-numerik = {posted:false,
 * reason:'no-numeric-id'} → pemanggil fallback jalur lama. Tanpa endpoint LIST
 * tabel terminal, APP tak bisa memetakan id string → numerik.
 * - 409-capacity = konflik server-menang: catat server-note agar TablesScreen
 *   menampilkan banner; mutasi lokal tetap jalan (offline-first, kasir tak diblokir).
 * - Tak pernah melempar; gagal = {posted:false} (fallback milik pemanggil).
 */
import { getApiMode } from './apiSource';
import { getBinding } from '../session';
import { transitionTerminalTable } from './terminalApi';
import { getJSON, setJSON } from './storage';
import { initDb, queryFirst } from './db';

export const TABLE_SERVER_NOTE_KEY = 'genfity.tables.serverNote';
const SEATED_KEY = 'genfity.tables.seatedMin';

export interface TableTransitionHandoff {
  posted: boolean;
  statusSince: string;
  /** Menit sejak statusSince (server-menang), -1 bila tak diketahui. */
  seatedMin: number;
  conflict: '' | 'capacity';
  reason: '' | 'unbound' | 'dummy' | 'no-numeric-id' | 'offline' | 'rejected';
}

const NOT_POSTED: TableTransitionHandoff = {
  posted: false, statusSince: '', seatedMin: -1, conflict: '', reason: 'offline',
};

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
function boundTerminalId(): string {
  try {
    return (getBinding()?.terminalId ?? '').trim();
  } catch {
    return '';
  }
}

/** Resolve tableRef (nomor 'A-01'/id lokal) → {localId, numericId|null}. */
async function resolveTableIds(tableRef: string): Promise<{ localId: string; numericId: number | null }> {
  const ref = String(tableRef ?? '').trim();
  if (/^\d+$/.test(ref)) return { localId: ref, numericId: Number(ref) };
  try {
    await initDb();
    const row = await queryFirst<{ id: string | null }>(
      'SELECT id FROM ms_table WHERE TRIM(tableNo) = TRIM(?) OR id = ? LIMIT 1',
      [ref, ref],
    );
    const lid = String(row?.id ?? ref);
    return { localId: lid, numericId: /^\d+$/.test(lid) ? Number(lid) : null };
  } catch {
    return { localId: ref, numericId: null };
  }
}

function seatedMinSince(statusSince: string): number {
  try {
    const t = Date.parse(statusSince);
    if (!Number.isFinite(t)) return -1;
    return Math.max(0, Math.floor((Date.now() - t) / 60000));
  } catch {
    return -1;
  }
}

/** Duduki/kosongkan meja di server terminal (immediate-first, best-effort).
 * Tak pernah melempar; gagal = {posted:false} (fallback lokal milik pemanggil). */
export async function postTableTransition(inp: {
  tableRef: string;
  status: 'OCCUPIED' | 'AVAILABLE';
  guestName?: string;
  partySize?: number;
}): Promise<TableTransitionHandoff> {
  const tid = boundTerminalId();
  if (!tid) return { ...NOT_POSTED, reason: 'unbound' };
  try {
    if (getApiMode() !== 'real') return { ...NOT_POSTED, reason: 'dummy' };
  } catch {
    return { ...NOT_POSTED, reason: 'dummy' };
  }
  const ref = String(inp.tableRef ?? '').trim();
  if (!ref) return { ...NOT_POSTED, reason: 'rejected' };
  const { localId, numericId } = await resolveTableIds(ref);
  if (numericId === null) return { ...NOT_POSTED, reason: 'no-numeric-id' };
  try {
    const r = await withTimeoutMs(
      transitionTerminalTable(tid, numericId, {
        status: inp.status,
        ...(inp.guestName ? { guestName: inp.guestName } : {}),
        ...(inp.partySize ? { partySize: inp.partySize } : {}),
      }),
    );
    if (!r || r.fromDummy) return { ...NOT_POSTED, reason: 'offline' };
    if (!r.ok) {
      // 409 TABLE_CAPACITY_EXCEEDED = konflik server-menang → catat note banner.
      const code = String(r.errorCode ?? '').toUpperCase();
      if (r.status === 409 && inp.status === 'OCCUPIED' && code.includes('CAPACITY')) {
        try {
          await setJSON(TABLE_SERVER_NOTE_KEY, 'capacity');
        } catch {
          /* abaikan */
        }
        return { ...NOT_POSTED, reason: 'rejected', conflict: 'capacity' };
      }
      return { ...NOT_POSTED, reason: r.status === 404 || r.status === 0 ? 'offline' : 'rejected' };
    }
    const since = String(r.data.statusSince ?? '');
    const mins = seatedMinSince(since);
    // occupiedSince server-menang: tulis snapshot seated agar TablesScreen
    // memakai durasi server saat muat berikut (fallback lokal bila -1).
    if (inp.status === 'OCCUPIED' && mins >= 0 && localId) {
      try {
        const snap = await getJSON<Record<string, number>>(SEATED_KEY, {});
        snap[localId] = mins;
        await setJSON(SEATED_KEY, snap);
      } catch {
        /* abaikan: tick lokal tetap jalan */
      }
    }
    if (inp.status === 'AVAILABLE') {
      try {
        await setJSON(TABLE_SERVER_NOTE_KEY, '');
      } catch {
        /* abaikan */
      }
    }
    return { posted: true, statusSince: since, seatedMin: mins, conflict: '', reason: '' };
  } catch {
    return { ...NOT_POSTED, reason: 'offline' };
  }
}
