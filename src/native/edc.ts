/**
 * EDC BCA via intent ke aplikasi APOS (Castles/Ingenico/PAX/Verifone),
 * pola yang sama dipakai POSLite: lempar amount, terima approval code.
 * Jalan di dev-client Android; di iOS/web kembalikan need-dev-client.
 */
import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

export interface EdcResult {
  ok: boolean;
  approvalCode?: string;
  cardNo?: string;
  reason?: 'need-dev-client' | 'cancelled' | 'failed';
}

/** Paket APOS umum — pilih yang terinstal di terminal Anda. */
export const EDC_PACKAGES = [
  'com.bca.apos', // BCA APOS
  'id.co.bca.cpdroid', // fallback
];

export async function startEdcPayment(amount: number, txnRef: string): Promise<EdcResult> {
  if (Platform.OS !== 'android') return { ok: false, reason: 'need-dev-client' };
  try {
    const res = await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      packageName: EDC_PACKAGES[0],
      extra: {
        amount: String(Math.round(amount)),
        refNo: txnRef,
        transType: 'SALE',
      },
    });
    const extra = (res?.extra ?? {}) as Record<string, unknown>;
    if (extra.approvalCode) {
      return {
        ok: true,
        approvalCode: String(extra.approvalCode),
        cardNo: extra.cardNo ? String(extra.cardNo) : undefined,
      };
    }
    return { ok: false, reason: 'cancelled' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
