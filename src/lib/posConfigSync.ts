/**
 * Sinkronisasi konfigurasi POS merchant → seed lokal APP (audit-5d80).
 * Dipanggil fire-and-forget pasca-login (cermin syncCurrencyFromProfile):
 * best-effort, fail-silent — login tak diblokir bila gagal.
 *
 * Aturan server-wins yang disepakati:
 * - Stok (`genfity.stock.opts.lowLimit`): adopsi threshold merchant HANYA
 *   bila lokal masih default/belum dikustom kasir (StockScreen DEFAULT '5').
 *   Flag local-only lain (trackStock/lowWarn/allowSellEmpty/onlineSync)
 *   tak disentuh — tak ada padanannya di server (M9-3 local-only).
 * - Timer (`genfity.tabletimer.config`): seed HANYA bila belum ada cfg lokal
 *   (kasir yang sudah mengatur tak ditimpa).
 */
import { getJSON, setJSON } from './storage';
import { fetchTerminalPosConfig } from './terminalApi';

const STOCK_OPTS_KEY = 'genfity.stock.opts';
const STOCK_DEFAULT_LOW_LIMIT = '5'; // cermin StockScreen DEFAULT_OPTS
const TIMER_CFG_KEY = 'genfity.tabletimer.config';

export async function syncPosConfigFromServer(terminalId: string): Promise<boolean> {
  const id = (terminalId ?? '').trim();
  if (!id) return false;
  let r;
  try {
    r = await fetchTerminalPosConfig(id);
  } catch {
    return false;
  }
  if (!r || !r.ok || r.fromDummy) return false;

  try {
    const local = await getJSON<Record<string, unknown>>(STOCK_OPTS_KEY, {});
    const cur = local.lowLimit === undefined || local.lowLimit === null ? '' : String(local.lowLimit);
    if (cur === '' || cur === STOCK_DEFAULT_LOW_LIMIT) {
      await setJSON(STOCK_OPTS_KEY, { ...local, lowLimit: String(r.data.defaultLowStockThreshold) });
    }
  } catch {
    /* best-effort: cache stok tetap dipakai */
  }

  try {
    const existing = await getJSON<Record<string, unknown> | null>(TIMER_CFG_KEY, null);
    if (existing === null || existing === undefined) {
      await setJSON(TIMER_CFG_KEY, {
        enabled: true,
        limit: String(r.data.timerDefaultLimitMin),
        warnBefore: String(r.data.timerWarnBeforeMin),
        startMode: 'duduk',
        autoExtend: false,
      });
    }
  } catch {
    /* best-effort: default TableTimerScreen tetap dipakai */
  }
  return true;
}
