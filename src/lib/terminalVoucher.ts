/**
 * A12: burn/release voucher via endpoint terminal
 * (POST /api/v1/terminals/{id}/vouchers/burn|release) — siap-kontrak.
 *
 * Kontrak BE (final 2026-10-25):
 * - POST .../vouchers/burn {code,orderClientId,idempotencyKey} → {ok,redemptionId};
 *   duplikat idempotencyKey = sukses (BE mengembalikan redemption yang sama).
 * - POST .../vouchers/release {idempotencyKey} → {ok,released}.
 * - idempotencyKey per-voucher-per-transaksi: diterbitkan SEKALI (uuidv7) dan
 *   dipersist pra-kirim di `genfity.voucher.idem.{orderClientId}.{CODE}`;
 *   retry memakai kunci yang SAMA. Release on cancel/void memakai kunci itu.
 * - BE-ADA (ronde-2 2026-10-25 mendarat: TerminalVoucherBurn/Release
 *   terdaftar di router + handler kontrak-final; terverifikasi ulang):
 *   sukses = {posted:true}; offline / dummy-mode = {posted:false} → pemanggil
 *   fallback jalur lokal lama (kuota ms_voucher + usage tak berubah).
 * - Tak pernah melempar; sukses terminal tak mengubah perilaku lokal
 *   (catat redemptionId via setJSON, best-effort).
 */
import { getApiMode } from './apiSource';
import { getBinding } from '../session';
import { burnTerminalVoucher, releaseTerminalVoucher } from './terminalApi';
import { getJSON, setJSON } from './storage';
import { uuidv7 } from './uuidv7';

export interface VoucherBurnHandoff {
  posted: boolean;
  redemptionId: string;
  duplicate: boolean;
}

export interface VoucherReleaseHandoff {
  posted: boolean;
  released: boolean;
}

const NOT_BURNED: VoucherBurnHandoff = { posted: false, redemptionId: '', duplicate: false };
const NOT_RELEASED: VoucherReleaseHandoff = { posted: false, released: false };

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

function idemStoreKey(orderClientId: string, code: string): string {
  return `genfity.voucher.idem.${orderClientId}.${code.toUpperCase()}`;
}

function redemptionStoreKey(orderClientId: string, code: string): string {
  return `genfity.voucher.redemption.${orderClientId}.${code.toUpperCase()}`;
}

function preflight(): string {
  const tid = boundTerminalId();
  if (!tid) return '';
  try {
    if (getApiMode() !== 'real') return '';
  } catch {
    return '';
  }
  return tid;
}

/** Bakar voucher di server terminal (immediate-first, best-effort).
 * Tak pernah melempar; gagal = {posted:false} (fallback lokal milik pemanggil). */
export async function burnVoucherAtTerminal(inp: {
  code: string;
  orderClientId: string;
}): Promise<VoucherBurnHandoff> {
  const tid = preflight();
  const code = String(inp.code ?? '').trim();
  const ocid = String(inp.orderClientId ?? '').trim();
  if (!tid || !code || !ocid) return NOT_BURNED;
  // IdempotencyKey SEKALI per-voucher-per-transaksi, persist pra-kirim.
  let key = '';
  try {
    key = await getJSON<string>(idemStoreKey(ocid, code), '');
    if (!key) {
      key = uuidv7();
      await setJSON(idemStoreKey(ocid, code), key);
    }
  } catch {
    return NOT_BURNED;
  }
  if (!key) return NOT_BURNED;
  try {
    const r = await withTimeoutMs(
      burnTerminalVoucher(tid, { code: code.toUpperCase(), orderClientId: ocid, idempotencyKey: key }),
    );
    if (!r || !r.ok || r.fromDummy) return NOT_BURNED;
    const rid = String(r.data.redemptionId ?? '').trim();
    if (rid) {
      try {
        await setJSON(redemptionStoreKey(ocid, code), rid);
      } catch {
        /* abaikan: catat best-effort */
      }
    }
    return { posted: true, redemptionId: rid, duplicate: false };
  } catch {
    return NOT_BURNED;
  }
}

/** Lepas voucher di server terminal (cancel/void; best-effort).
 * Tak pernah melempar; gagal = {posted:false} (fallback lokal milik pemanggil). */
export async function releaseVoucherAtTerminal(inp: {
  orderClientId: string;
  code?: string;
  idempotencyKey?: string;
}): Promise<VoucherReleaseHandoff> {
  const tid = preflight();
  const ocid = String(inp.orderClientId ?? '').trim();
  if (!tid || !ocid) return NOT_RELEASED;
  let key = String(inp.idempotencyKey ?? '').trim();
  const code = String(inp.code ?? '').trim();
  if (!key && code) {
    try {
      key = await getJSON<string>(idemStoreKey(ocid, code), '');
    } catch {
      /* abaikan */
    }
  }
  if (!key) return NOT_RELEASED;
  try {
    const r = await withTimeoutMs(releaseTerminalVoucher(tid, key));
    if (!r || !r.ok || r.fromDummy) return NOT_RELEASED;
    return { posted: true, released: r.data.released !== false };
  } catch {
    return NOT_RELEASED;
  }
}
