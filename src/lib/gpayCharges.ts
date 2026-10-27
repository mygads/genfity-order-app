/**
 * GPAY-POS-DYNAMIC: charge QRIS/VA dinamis untuk kasir via backend Go.
 * POST /api/merchant/gpay/charges → pay transaction (settlement ke tenant
 * merchant sendiri) → tampilkan qr_string ASLI provider sebagai QR + poll
 * GET /charges/{id} sampai paid/expired. Offline (apiMode local) = null,
 * layar memakai jalur mock lokal seperti sebelumnya.
 */
import { ApiPath } from '../config/server';
import { apiFetch, getApiMode } from './apiSource';

export type GpayChargeAttempt = {
  id: string;
  attempt_number: number;
  payment_method: string;
  status: string;
  payment_url?: string | null;
  qr_string?: string | null;
  va_number?: string | null;
  expires_at?: string | null;
  paid_at?: string | null;
  is_current?: boolean;
};

export type GpayCharge = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  client_reference: string;
  sale_reference?: string | null;
  expires_at?: string | null;
  paid_at?: string | null;
  current_attempt?: GpayChargeAttempt | null;
};

type Envelope<T> = { success: boolean; data: T; message?: string };

export async function createGpayCharge(input: {
  amount: number;
  payment_method: string;
  sale_reference: string;
  customer_name?: string;
  customer_email?: string;
}): Promise<GpayCharge | null> {
  if (getApiMode() !== 'real') return null;
  try {
    const res = await apiFetch<Envelope<GpayCharge>>(ApiPath.gpayChargeCreate, {
      method: 'POST',
      body: {
        amount: Math.round(input.amount),
        payment_method: input.payment_method,
        sale_reference: input.sale_reference,
        customer_name: input.customer_name ?? 'Walk-in customer',
        customer_email: input.customer_email ?? 'pos@genfity.com',
      },
    });
    if (!res.ok) return null;
    const env = res.data as Envelope<GpayCharge>;
    return env?.data ?? null;
  } catch {
    return null;
  }
}

export async function pollGpayCharge(id: string): Promise<GpayCharge | null> {
  if (getApiMode() !== 'real') return null;
  try {
    const res = await apiFetch<Envelope<GpayCharge>>(`${ApiPath.gpayChargeGet}/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    if (!res.ok) return null;
    const env = res.data as Envelope<GpayCharge>;
    return env?.data ?? null;
  } catch {
    return null;
  }
}

/** String ASCII → bytes tanpa TextEncoder (kompatibel Hermes lama). */
export function asciiToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
