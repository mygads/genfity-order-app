/**
 * Sinkronisasi konfigurasi POS merchant → seed lokal APP (audit-5d80).
 * Dipanggil fire-and-forget pasca-login (cermin syncCurrencyFromProfile):
 * best-effort, fail-silent — login tak diblokir bila gagal.
 *
 * KEBIJAKAN SYNC TRISISI (audit #4 — satu paragraf acuan):
 * - merchant-truth = server-wins-on-sync: lookup member, threshold stok,
 *   tax, fee/service, packaging, receipt prefs. Nilai server menimpa lokal
 *   tiap sync sukses (pengecualian TERDOKUMENTASI: threshold stok seed-hanya-
 *   bila-default, lihat bawah — terminal tak bisa baca endpoint owner-gated
 *   /menu/stock/settings, jadi kasir yang sudah mengkustom tak ditimpa).
 * - fisik-perangkat = local-wins SELALU: port/MAC printer, paper-size/autocut
 *   per-station, mapping station, preferensi acquirer EDC/QRIS. Server tak
 *   tahu alamat printer per-terminal (cermin master.ts:113-123).
 * - UX-perangkat = seed-once: timer meja, sound, sync opts, float shift.
 *   Ditulis hanya bila belum ada cfg lokal (kasir yang sudah mengatur tak
 *   ditimpa).
 *
 * Aturan server-wins yang disepakati:
 * - Stok (`genfity.stock.opts.lowLimit`): adopsi threshold merchant HANYA
 *   bila lokal masih default/belum dikustom kasir (StockScreen DEFAULT '5').
 *   Flag local-only lain (trackStock/lowWarn/allowSellEmpty/onlineSync)
 *   tak disentuh — tak ada padanannya di server (M9-3 local-only).
 *   CATATAN threshold (#7): endpoint owner-gated BE GET+PUT
 *   /menu/stock/settings ADA dan FE SUDAH punya editornya (InventoryPanel
 *   FE — temuan awal "tanpa editor FE" terkoreksi). Terminal APP tak bisa
 *   membacanya (owner-gated), jadi APP mempertahankan seed-sekali; owner
 *   yang mengubah threshold lewat FE akan terlihat di APP hanya bila kasir
 *   belum mengkustom (sengaja, bukan bug).
 * - Timer (`genfity.tabletimer.config`): seed HANYA bila belum ada cfg lokal
 *   (kasir yang sudah mengatur tak ditimpa).
 */
import { getJSON, setJSON } from './storage';
import { fetchTerminalPosConfig } from './terminalApi';

const STOCK_OPTS_KEY = 'genfity.stock.opts';
const STOCK_DEFAULT_LOW_LIMIT = '5'; // cermin StockScreen DEFAULT_OPTS
const TIMER_CFG_KEY = 'genfity.tabletimer.config';
/** Ronde-3 Q5: cache flag gate lookup member. Absen = enabled (boleh lookup). */
const MEMBER_LOOKUP_KEY = 'genfity.member.lookup';

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

  // Q5: cache flag gate lookup member (server-wins tiap sync sukses; gagal
  // sync = cache lama dipakai, belum pernah sync = enabled).
  try {
    await setJSON(MEMBER_LOOKUP_KEY, { enabled: r.data.memberLookupEnabled !== false });
  } catch {
    /* abaikan */
  }
  return true;
}

/** Q5: gate UI lookup/search member. Absen/error = enabled (kontrak). */
export async function getMemberLookupEnabled(): Promise<boolean> {
  try {
    const cur = await getJSON<{ enabled?: unknown } | null>(MEMBER_LOOKUP_KEY, null);
    if (!cur || cur.enabled === undefined || cur.enabled === null) return true;
    if (typeof cur.enabled === 'boolean') return cur.enabled;
    return String(cur.enabled).trim().toLowerCase() !== 'false';
  } catch {
    return true;
  }
}
