/**
 * A3: preferensi struk kasir (server-wins, offline-first).
 *
 * Prioritas efektif di ReceiptScreen: params eksplisit pemanggil (footer,
 * dkk.) > ms_setting ('Receipt', ...) > default (semua tampil).
 *
 * Ditulis oleh pull katalog masterGo dari blok merchant BE bila kuncinya ada
 * (pola kemasan A2; BE lama / belum pull = kunci absen = perilaku lama
 * persis). value1 = payload ('1'/'0' untuk boolean, teks untuk footer),
 * value2 = '1' (kolom flag, cermin Packaging).
 */
import { initDb, queryFirst, type BindParams } from './db';

export type ReceiptPrefs = {
  showTax: boolean;
  showFooter: boolean;
  showQris: boolean;
  footerText: string;
};

export const RECEIPT_PREFS_DEFAULT: ReceiptPrefs = {
  showTax: true,
  showFooter: true,
  showQris: true,
  footerText: '',
};

async function readFlag(key2: string): Promise<boolean | null> {
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Receipt' AND key2 = ? LIMIT 1`,
      [key2],
    );
    if (row == null || row.value1 == null) return null;
    const v = String(row.value1).trim();
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  } catch {
    return null;
  }
}

/** Baca preferensi efektif (async; default = semua tampil bila tak ada baris). */
export async function getReceiptPrefs(): Promise<ReceiptPrefs> {
  const [tax, footer, qris] = await Promise.all([
    readFlag('ShowTax'),
    readFlag('ShowFooter'),
    readFlag('ShowQris'),
  ]);
  let text = '';
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Receipt' AND key2 = 'FooterText' LIMIT 1`,
    );
    text = String(row?.value1 ?? '');
  } catch {
    text = '';
  }
  return {
    showTax: tax ?? RECEIPT_PREFS_DEFAULT.showTax,
    showFooter: footer ?? RECEIPT_PREFS_DEFAULT.showFooter,
    showQris: qris ?? RECEIPT_PREFS_DEFAULT.showQris,
    footerText: text,
  };
}

/** Blok merchant opsional (cermin GoMerchant masterGo) untuk persist server-wins. */
export type ReceiptMerchantBlock = {
  receiptShowTax?: boolean;
  receiptShowFooter?: boolean;
  receiptShowQris?: boolean;
  receiptFooterText?: string;
};

/**
 * Tulis preferensi server-wins ke ms_setting. HANYA bila BE mengirim minimal
 * satu kunci (kompat BE lama: tak ada kunci = tak ada tulis = lokal utuh).
 */
export async function persistReceiptPrefs(
  merchant: ReceiptMerchantBlock,
  run: (sql: string, params?: BindParams) => Promise<unknown>,
): Promise<void> {
  const hasAny =
    merchant.receiptShowTax !== undefined ||
    merchant.receiptShowFooter !== undefined ||
    merchant.receiptShowQris !== undefined ||
    merchant.receiptFooterText !== undefined;
  if (!hasAny) return;
  const put = async (key2: string, value1: string) => {
    await run(
      `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Receipt', ?, ?, '1')
       ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
      [key2, value1],
    );
  };
  if (merchant.receiptShowTax !== undefined) {
    await put('ShowTax', merchant.receiptShowTax === true ? '1' : '0');
  }
  if (merchant.receiptShowFooter !== undefined) {
    await put('ShowFooter', merchant.receiptShowFooter === true ? '1' : '0');
  }
  if (merchant.receiptShowQris !== undefined) {
    await put('ShowQris', merchant.receiptShowQris === true ? '1' : '0');
  }
  if (merchant.receiptFooterText !== undefined) {
    await put('FooterText', String(merchant.receiptFooterText ?? '').slice(0, 500));
  }
}
