/**
 * Sinkron fleet terminal cabang (tugas A/B): GET fleet BE → cache lokal
 * offline-first; update destination (terminalId+kind / receiptTemplateId)
 * ditulis server + cermin ke cache.
 *
 * Kebijakan (cermin posConfigSync):
 * - server = sumber kebenaran binding (terminalId+kind per destination);
 *   lokal = cache offline-first (tampil + dipakai saat offline).
 * - Tulis server gagal = cache lokal tetap (jujur: statusMsg layar bilang
 *   gagal; sync ulang saat online).
 * - Tak pernah melempar ke pemanggil UI (fail jujur {ok:false}).
 */
import { getJSON, setJSON } from './storage';
import {
  fetchTerminalFleet,
  updatePrintDestination,
  type FleetStation,
  type FleetStationKind,
  type FleetTerminal,
  type UpdateDestinationInput,
} from './terminalApi';

export type { FleetStation, FleetStationKind, FleetTerminal };

export const FLEET_CACHE_KEY = 'genfity.pos.fleet';

export interface FleetCache {
  branchId: string;
  syncedAt: string;
  terminals: FleetTerminal[];
}

/** Baca cache fleet (null = belum pernah sync). Tak pernah melempar. */
export async function getFleetCache(): Promise<FleetCache | null> {
  try {
    const cur = await getJSON<FleetCache | null>(FLEET_CACHE_KEY, null);
    if (!cur || typeof cur !== 'object' || !Array.isArray(cur.terminals)) return null;
    return cur;
  } catch {
    return null;
  }
}

/**
 * Tarik fleet cabang dari BE lalu tulis cache (server-wins tiap sync sukses;
 * gagal sync = cache lama dipakai). Kembali {ok, terminals}.
 */
export async function syncFleetFromServer(
  branchId: string,
): Promise<{ ok: boolean; terminals: FleetTerminal[]; status?: number }> {
  const id = (branchId ?? '').trim();
  if (!id) return { ok: false, terminals: [] };
  let r;
  try {
    r = await fetchTerminalFleet(id);
  } catch {
    return { ok: false, terminals: [] };
  }
  if (!r.ok) return { ok: false, terminals: [], status: r.status };
  try {
    await setJSON(FLEET_CACHE_KEY, {
      branchId: id,
      syncedAt: new Date().toISOString(),
      terminals: r.data.terminals,
    } satisfies FleetCache);
  } catch {
    /* cache gagal ditulis — hasil fetch tetap dipakai sesi ini */
  }
  return { ok: true, terminals: r.data.terminals };
}

/** Station fleet milik terminal ini (cocok terminalCode, case-insensitive). */
export function fleetStationsForTerminal(
  cache: FleetCache | null,
  terminalCode: string,
): FleetStation[] {
  if (!cache) return [];
  const want = (terminalCode ?? '').trim().toUpperCase();
  if (!want) return [];
  for (const t of cache.terminals) {
    if (String(t.terminalCode ?? '').trim().toUpperCase() === want) return t.stations;
  }
  return [];
}

/**
 * Sinkron satu station lokal ke BE: cari destinationId fleet milik terminal
 * ini yang namanya cocok (case-insensitive); bila tepat satu → PATCH
 * update-destination + cermin kind/template ke cache. Nol/ganda = {ok:false,
 * reason:'no-match'|'ambiguous'} (jujur, tanpa tebak destination).
 */
export async function syncStationToServer(
  branchId: string,
  terminalCode: string,
  stationName: string,
  terminalIdBe: string,
  update: Omit<UpdateDestinationInput, 'terminalId'>,
): Promise<{ ok: boolean; reason?: string; destinationId?: number }> {
  const cache = await getFleetCache();
  const stations = fleetStationsForTerminal(cache, terminalCode);
  const want = (stationName ?? '').trim().toLowerCase();
  const hits = stations.filter(
    (s) => s.destinationName.trim().toLowerCase() === want && want !== '',
  );
  if (hits.length === 0) return { ok: false, reason: 'no-match' };
  if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
  const dest = hits[0] as FleetStation;
  const beId = Number(terminalIdBe);
  let r;
  try {
    r = await updatePrintDestination(dest.destinationId, {
      ...(Number.isFinite(beId) ? { terminalId: Math.round(beId) } : {}),
      ...update,
    });
  } catch {
    return { ok: false, reason: 'offline', destinationId: dest.destinationId };
  }
  if (!r.ok) return { ok: false, reason: 'server', destinationId: dest.destinationId };
  // Cermin ke cache agar UI offline-first konsisten.
  try {
    const cur = await getFleetCache();
    if (cur) {
      for (const t of cur.terminals) {
        for (const s of t.stations) {
          if (s.destinationId !== dest.destinationId) continue;
          if (update.kind !== undefined) s.kind = update.kind;
          if (update.receiptTemplateId !== undefined) s.receiptTemplateId = update.receiptTemplateId;
          if (update.selected !== undefined) s.selected = update.selected;
        }
      }
      await setJSON(FLEET_CACHE_KEY, cur);
    }
  } catch {
    /* cermin best-effort */
  }
  return { ok: true, destinationId: dest.destinationId };
}
