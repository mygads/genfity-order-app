/**
 * Status langganan untuk banner kasir (best-effort, info-only).
 *
 * - Hanya di Real mode (ada backend). Local/Dummy = null (diam).
 * - Cache 5 menit + in-flight dedup; TAK PERNAH melempar.
 * - Banner HANYA info: kasir/order/CTA tak boleh membaca state ini
 *   (cermin pola renderHoursBanner di CashierScreen).
 */
import { apiFetch, getApiMode, unwrap } from './apiSource';

export type BillingStage = 'NONE' | 'PAST_DUE' | 'READ_ONLY' | 'SUSPENDED';

export interface BillingStatus {
  stage: BillingStage;
  status: string;
  isProTrial: boolean;
  trialDaysRemaining: number | null;
  graceDaysRemaining: number | null;
}

const TTL_MS = 5 * 60 * 1000;
let cached: BillingStatus | null = null;
let cachedAt = 0;
let inflight: Promise<BillingStatus | null> | null = null;

function daysUntil(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86400000));
}

async function load(): Promise<BillingStatus | null> {
  try {
    if (getApiMode() !== 'real') return null;
    const res = await apiFetch<unknown>('api/merchant/subscription', { method: 'GET' });
    if (!res.ok || res.fromDummy) return null;
    const { data } = unwrap<Record<string, unknown>>(res.data);
    const sub = (data?.subscription ?? {}) as Record<string, unknown>;
    const rawStage = String(sub.suspendStage ?? 'NONE').toUpperCase();
    const stage: BillingStage =
      rawStage === 'PAST_DUE' || rawStage === 'READ_ONLY' || rawStage === 'SUSPENDED' ? rawStage : 'NONE';
    const status = String(sub.status ?? 'UNKNOWN');
    if (stage === 'NONE' && status !== 'SUSPENDED' && sub.isProTrial !== true) return null;
    return {
      stage: status === 'SUSPENDED' ? 'SUSPENDED' : stage,
      status,
      isProTrial: sub.isProTrial === true,
      trialDaysRemaining: daysUntil(sub.proTrialEndsAt),
      graceDaysRemaining: daysUntil(sub.graceEndsAt),
    };
  } catch {
    return null;
  }
}

/** Best-effort, cache 5 mnt, tak pernah melempar. null = diam (tanpa banner). */
export async function getBillingStatus(): Promise<BillingStatus | null> {
  try {
    if (Date.now() - cachedAt < TTL_MS) return cached;
    if (!inflight) {
      inflight = load().then((r) => {
        cached = r;
        cachedAt = Date.now();
        inflight = null;
        return r;
      });
    }
    return await inflight;
  } catch {
    return cached;
  }
}

/** Paksa refresh (mis. setelah topup berhasil). Tak pernah melempar. */
export async function refreshBillingStatus(): Promise<BillingStatus | null> {
  cachedAt = 0;
  return getBillingStatus();
}
