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

/** A-P1-7: flag perilaku POS (BE merchant_pos_menu.go:85-89 — posPayImmediately,
 * requireTableNumberForDineIn, posCustomItems, posEditOrder). Konsumsi toleran:
 * endpoint merchant-auth /menu hanya bisa dibaca JWT merchant, terminal APP tak
 * bisa fetch langsung — cache ditulis DI SINI saat BE kelak mengekspos flag via
 * terminal pos-config (kunci flat ATAU nested posBehavior). Absen = default
 * legacy (perilaku hari ini), sehingga NOL-regresi sampai BE menambahkannya.
 * customItems/editOrder default TRUE (fitur sudah hidup); payImmediately/
 * requireTable default FALSE (alur lama: review keranjang, meja opsional). */
const POS_FLAGS_KEY = 'genfity.pos.flags';
export interface PosFlags {
  payImmediately: boolean;
  requireTable: boolean;
  customItems: boolean;
  editOrder: boolean;
}
const POS_FLAGS_DEFAULT: PosFlags = {
  payImmediately: false,
  requireTable: false,
  customItems: true,
  editOrder: true,
};
const asBool = (v: unknown, fb: boolean): boolean => {
  if (v === undefined || v === null) return fb;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'ya' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'tidak' || s === 'no') return false;
  return fb;
};
/** Baca satu flag dari beberapa alias (flat + nested posBehavior + snake_case)
 * karena bentuk pasti payload terminal BE belum final saat APP ditulis. */
function pickFlag(src: Record<string, unknown>, aliases: string[], fb: boolean): boolean {
  for (const k of aliases) {
    if (src[k] !== undefined && src[k] !== null) return asBool(src[k], fb);
  }
  const nested = src.posBehavior ?? src.pos_behavior ?? src.settings;
  if (nested && typeof nested === 'object') {
    const n = nested as Record<string, unknown>;
    for (const k of aliases) {
      if (n[k] !== undefined && n[k] !== null) return asBool(n[k], fb);
    }
  }
  return fb;
}
function parsePosFlags(raw: unknown): PosFlags {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    payImmediately: pickFlag(src, ['posPayImmediately', 'pos_pay_immediately', 'payImmediately', 'pay_immediately'], POS_FLAGS_DEFAULT.payImmediately),
    requireTable: pickFlag(src, ['requireTableNumberForDineIn', 'require_table_number_for_dine_in', 'requireTable', 'require_table'], POS_FLAGS_DEFAULT.requireTable),
    customItems: pickFlag(src, ['posCustomItems', 'pos_custom_items', 'customItems', 'custom_items'], POS_FLAGS_DEFAULT.customItems),
    editOrder: pickFlag(src, ['posEditOrder', 'pos_edit_order', 'editOrder', 'edit_order'], POS_FLAGS_DEFAULT.editOrder),
  };
}

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

  // A-P1-7: cache 4 flag perilaku POS (toleran: kunci flat/nested apa pun yang
  // kelak dikirim BE; tak ada = cache lama/default legacy dipertahankan).
  try {
    await setJSON(POS_FLAGS_KEY, parsePosFlags(r.data));
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

/** A-P1-7: baca 4 flag perilaku POS dari cache. Absen/error = default legacy
 * (payImmediately/requireTable OFF, customItems/editOrder ON). */
export async function getPosFlags(): Promise<PosFlags> {
  try {
    const cur = await getJSON<Partial<PosFlags> | null>(POS_FLAGS_KEY, null);
    if (!cur || typeof cur !== 'object') return { ...POS_FLAGS_DEFAULT };
    return {
      payImmediately: asBool(cur.payImmediately, POS_FLAGS_DEFAULT.payImmediately),
      requireTable: asBool(cur.requireTable, POS_FLAGS_DEFAULT.requireTable),
      customItems: asBool(cur.customItems, POS_FLAGS_DEFAULT.customItems),
      editOrder: asBool(cur.editOrder, POS_FLAGS_DEFAULT.editOrder),
    };
  } catch {
    return { ...POS_FLAGS_DEFAULT };
  }
}

/** A-P1-7: kasir → Pay langsung tanpa review keranjang (default OFF). */
export async function getPosPayImmediately(): Promise<boolean> {
  return (await getPosFlags()).payImmediately;
}

/** A-P1-7: DINE IN wajib nomor meja sebelum simpan/bayar (default OFF). */
export async function getRequireTableNumberForDineIn(): Promise<boolean> {
  return (await getPosFlags()).requireTable;
}

/** A-P1-7: tombol + penerimaan item kustom diizinkan (default ON = hidup). */
export async function getPosCustomItemsEnabled(): Promise<boolean> {
  return (await getPosFlags()).customItems;
}

/** A-P1-7: penerimaan loadItems (buka order tersimpan untuk diedit) (default ON). */
export async function getPosEditOrderEnabled(): Promise<boolean> {
  return (await getPosFlags()).editOrder;
}
