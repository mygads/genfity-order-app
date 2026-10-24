/**
 * P1-1b: gerbang PIN manajer ala FE (posPinGate.ts: shouldRequirePosPinGate +
 * withPosPin). APP membaca posBehaviorSettings dari pos-config terminal
 * (fetchTerminalPosConfig, cache TTL 5 mnt) lalu memutuskan apakah aksi
 * butuh PIN — PIN dikumpulkan via ManagerPinPrompt dan ditempel ke body
 * live SAJA (param pin posWire; antrean sync TAK pernah membawa pin).
 *
 * Fail-open false saat tak diketahui (tanpa binding / fetch gagal): server
 * sumber kebenaran — BE menjawab 400 PIN_REQUIRED jujur (drain fail-once +
 * catatan), bukan alasan memblokir kasir offline.
 */
import { getBoundSupervisorTerminalId } from './supervisor';
import { fetchTerminalPosConfig } from './terminalApi';

export type PosPinAction = 'payment' | 'refund' | 'void' | 'cancel' | 'edit';

const FLAG_OF: Record<PosPinAction, string> = {
  payment: 'requirePinForPayment',
  refund: 'requirePinForRefund',
  void: 'requirePinForVoid',
  cancel: 'requirePinForCancel',
  edit: 'requirePinForEdit',
};

let cacheAt = 0;
let cached: Record<string, unknown> | null = null;
const TTL_MS = 5 * 60_000;

async function loadPosBehavior(): Promise<Record<string, unknown> | null> {
  const now = Date.now();
  if (cached && now - cacheAt < TTL_MS) return cached;
  try {
    const terminalId = getBoundSupervisorTerminalId();
    if (!terminalId) return cached;
    const r = await fetchTerminalPosConfig(terminalId);
    if (!r.ok) return cached;
    cached = (r.data.posBehavior ?? {}) as Record<string, unknown>;
    cacheAt = now;
    return cached;
  } catch {
    return cached;
  }
}

/** True bila merchant mewajibkan PIN manajer untuk aksi ini. */
export async function requiresPosPin(action: PosPinAction): Promise<boolean> {
  try {
    const b = await loadPosBehavior();
    if (!b) return false;
    return b[FLAG_OF[action]] === true;
  } catch {
    return false;
  }
}

/** Paksa segarkan cache (mis. sesudah ganti/klaim ulang terminal). */
export function clearPosPinCache(): void {
  cached = null;
  cacheAt = 0;
}
