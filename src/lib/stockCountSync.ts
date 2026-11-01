/**
 * Opname-lite: dorong hasil hitung lokal ke draf server (audit-5d80).
 * ID lokal APP (string ESB) ≠ bigint server → cocokkan via nama
 * (trim + lowercase). Finalisasi tetap owner-only di dashboard.
 * Fail jujur: throw Error(status) agar UI tampilkan pesan, lokal tak diubah.
 */
import {
  createStockCount,
  fetchStockCountCurrent,
  fetchStockCountItems,
  submitStockCountItem,
} from './terminalApi';

export interface LocalCountedItem {
  name: string;
  stock: number;
}

export interface StockCountPushResult {
  countId: number;
  submitted: number;
  skipped: number;
  failed: number;
}

const normName = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export interface DraftCountItem {
  itemType: string;
  itemId: number;
  name: string;
}

/**
 * GAP-C (audit 2026-11-01): pencocokan nama sadar-tipe.
 * Dulu first-wins lintas tipe: "Teh Manis" versi menu vs addon (atau dua
 * varian senama) bisa mendaratkan qty menu ke baris ADDON. Sumber lokal
 * StockScreen = menu saja -> menangkan tipe MENU bila ada; baris non-MENU
 * senama = skip jujur (bukan submit-buta), dihitung sebagai skipped.
 * Murni (tanpa I/O) agar dikunci tripwire.
 */
export function matchDraftItem(
  draft: DraftCountItem[],
  name: string,
): DraftCountItem | null {
  const key = normName(name);
  if (!key) return null;
  let firstMenu: DraftCountItem | null = null;
  for (const it of draft) {
    if (!it || normName(it.name) !== key) continue;
    if (String(it.itemType ?? '').trim().toUpperCase() !== 'MENU') continue;
    if (!firstMenu) firstMenu = it;
    break;
  }
  // Menangkan MENU (sumber lokal = menu). Tanpa baris MENU = skip (null)
  // meski ada baris ADDON senama — submit-buta ke tipe salah = korupsi data.
  return firstMenu;
}

function cleanQty(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

export async function pushStockCount(
  terminalId: string,
  local: LocalCountedItem[],
): Promise<StockCountPushResult> {
  const id = (terminalId ?? '').trim();
  if (!id) throw new Error('no-terminal');

  const cur = await fetchStockCountCurrent(id);
  if (!cur.ok) throw new Error(`current:${cur.status ?? 'offline'}`);
  let countId = cur.data?.id ?? 0;
  if (!countId) {
    const created = await createStockCount(id, `Opname kasir ${new Date().toISOString().slice(0, 10)}`);
    if (!created.ok) throw new Error(`create:${created.status ?? 'offline'}`);
    if (!created.data?.id) throw new Error('create:empty');
    countId = created.data.id;
  }

  const draft = await fetchStockCountItems(id, countId);
  if (!draft.ok) throw new Error(`items:${draft.status ?? 'offline'}`);
  if (!draft.data) throw new Error('items:empty');
  let submitted = 0;
  let skipped = 0;
  let failed = 0;
  for (const it of local) {
    const match = matchDraftItem(draft.data, it.name);
    if (!match) {
      skipped += 1;
      continue;
    }
    try {
      const r = await submitStockCountItem(id, countId, {
        itemType: match.itemType,
        itemId: match.itemId,
        countedQty: cleanQty(it.stock),
      });
      if (r.ok) submitted += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { countId, submitted, skipped, failed };
}
