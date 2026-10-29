/**
 * Tulis stok cabang + flag lokal per-item, dipakai BERSAMA StockScreen dan
 * StockManagementScreen agar derivasi Habis konsisten.
 *
 * Aturan kanonis (cermin BE/FE):
 * - BE tak punya flag sold-out manual; habis = track_stock && stock_qty <= 0
 *   (filter publik menus.sql + isAvailable addon + FE InventoryPanel).
 *   Satu-satunya "Tandai Habis" = set qty 0 (FE InventoryPanel
 *   handleMarkOutOfStock), sehingga web↔APP konsisten.
 * - flagSoldOut lokal = derivasi itu. Pull server-wins menulis ulang qty dari
 *   server; override manual lintas pull dinyatakan VOLATIL.
 * - track EFEKTIF = opt global trackStock && toggle lokal per-item (cache
 *   LS_STOCK / LS_ADDON, local-only) && trackStock server (ms_menu/ms_addon,
 *   server-wins). BE track_stock master tetap dikelola di dashboard web;
 *   toggle lokal hanya mengatur perilaku perangkat (derivasi Habis +
 *   decrement penjualan).
 * - allowSellEmpty TIDAK mengubah flag (kasir menggerbang sendiri);
 *   flag selalu jujur agar konsisten lintas layar.
 */
import { getBranchId } from '../config/server';
import { initDb, queryFirst, run } from './db';
import { getJSON, setJSON } from './storage';
import { enqueueOutbox } from './sync';

export type StockKind = 'menu' | 'addon';

const LS_MENU = 'genfity.stock.cache';
const LS_ADDON = 'genfity.stock.addonCache';

function cacheKey(kind: StockKind): string {
  return kind === 'addon' ? LS_ADDON : LS_MENU;
}

interface LocalItemFlags {
  id: string;
  kind?: StockKind;
  online?: boolean;
  track?: boolean;
}

/** Sanitasi qty: bulatkan, tolak NaN/negatif (default 0). */
export function cleanQty(v: unknown, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

/** Sanitasi ambang rendah: integer 0..100000, null = ikut default global. */
export function cleanThreshold(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100000, Math.round(n)));
}

/** Derivasi Habis kanonis: dilacak && qty <= 0. */
export function deriveSoldOut(tracked: boolean, qty: number): 0 | 1 {
  return tracked && qty <= 0 ? 1 : 0;
}

async function readLocalFlags(kind: StockKind): Promise<LocalItemFlags[]> {
  try {
    const arr = await getJSON<LocalItemFlags[]>(cacheKey(kind), []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Flag lokal per-item (online/track). Entri lama tanpa kind = menu. */
export async function getLocalFlags(kind: StockKind, id: string): Promise<{ online: boolean; track: boolean }> {
  const arr = await readLocalFlags(kind);
  const hit = arr.find((x) => String(x.id) === String(id) && (x.kind ?? 'menu') === kind);
  return { online: hit?.online ?? true, track: hit?.track ?? true };
}

/** Peta id → flag lokal, sekali baca (hindari N+1 getJSON saat render daftar). */
export async function getAllLocalFlags(kind: StockKind): Promise<Map<string, { online: boolean; track: boolean }>> {
  const arr = await readLocalFlags(kind);
  const map = new Map<string, { online: boolean; track: boolean }>();
  for (const x of arr) {
    if ((x.kind ?? 'menu') !== kind) continue;
    map.set(String(x.id), { online: x.online ?? true, track: x.track ?? true });
  }
  return map;
}

export async function setLocalFlags(kind: StockKind, id: string, p: Partial<{ online: boolean; track: boolean }>): Promise<void> {
  const arr = await readLocalFlags(kind);
  const key = String(id);
  const i = arr.findIndex((x) => String(x.id) === key && (x.kind ?? 'menu') === kind);
  if (i >= 0) {
    arr[i] = { ...arr[i], kind, ...(p.online !== undefined ? { online: p.online } : {}), ...(p.track !== undefined ? { track: p.track } : {}) };
  } else {
    arr.push({ id: key, kind, online: p.online ?? true, track: p.track ?? true });
  }
  try {
    await setJSON(cacheKey(kind), arr);
  } catch {
    /* abaikan */
  }
}

interface BranchTables {
  branch: string;
  idCol: string;
  master: string;
}

/** Peta tabel cabang vs master per jenis (pola drain Opsi A di sync.ts). */
function branchTables(kind: StockKind): BranchTables {
  return kind === 'addon'
    ? { branch: 'ms_branchaddon', idCol: 'addonId', master: 'ms_addon' }
    : { branch: 'ms_branchmenu', idCol: 'menuId', master: 'ms_menu' };
}

/**
 * Tulis qty absolut ke tabel cabang + enqueue push Opsi A.
 * tracked dilacak-efektif dihitung dari: opt global && toggle lokal &&
 * trackStock server. Tak dilacak → qty tetap disimpan + antre, flag Habis
 * existing dipertahankan (bukan dihitung).
 */
export async function persistBranchQty(
  kind: StockKind,
  id: string,
  qty: number,
  opts: { globalTrack: boolean; localTrack?: boolean },
): Promise<void> {
  await initDb();
  const branchId = getBranchId();
  const { branch, idCol, master } = branchTables(kind);
  const clean = cleanQty(qty, 0);
  let serverTrack = 1;
  try {
    const t = await queryFirst<{ trackStock: number | null }>(
      `SELECT trackStock FROM ${master} WHERE id = ?`,
      [id],
    );
    if (t && t.trackStock !== null && t.trackStock !== undefined) serverTrack = Number(t.trackStock) ? 1 : 0;
  } catch {
    /* anggap dilacak (perilaku lama) */
  }
  const localTrack = opts.localTrack ?? (await getLocalFlags(kind, id)).track;
  const tracked = opts.globalTrack && localTrack && serverTrack === 1;
  let soldOut: number;
  if (tracked) {
    soldOut = deriveSoldOut(true, clean);
  } else {
    try {
      const cur = await queryFirst<{ flagSoldOut: number | null }>(
        `SELECT flagSoldOut FROM ${branch} WHERE branchId = ? AND ${idCol} = ?`,
        [branchId, id],
      );
      soldOut = (cur?.flagSoldOut ?? 0) === 1 ? 1 : 0;
    } catch {
      soldOut = 0;
    }
  }
  // P0-02 optimistic-lock: tangkap baseQty SEBELUM tulis (untuk 409 STOCK_CONFLICT).
  // Tanpa base = BE perlakukan legacy (tanpa cek) — jangan pernah kirim baseQty == qty baru.
  let baseQty: number | null = null;
  try {
    const prev = await queryFirst<{ qty: number | null }>(
      `SELECT qty FROM ${branch} WHERE branchId = ? AND ${idCol} = ?`,
      [branchId, id],
    );
    if (prev && prev.qty !== null && prev.qty !== undefined) baseQty = Math.max(0, Math.round(Number(prev.qty) || 0));
  } catch { /* tanpa base = legacy */ }
  await run(
    `INSERT INTO ${branch} (branchId, ${idCol}, qty, flagSoldOut, flagActive, syncDate)
     VALUES (?, ?, ?, ?, 1, NULL)
     ON CONFLICT(branchId, ${idCol}) DO UPDATE SET qty = excluded.qty,
       flagSoldOut = excluded.flagSoldOut, syncDate = NULL`,
    [branchId, id, clean, soldOut],
  );
  try {
    const { enqueueOutboxWithPayload } = await import('./sync');
    if (baseQty !== null) await enqueueOutboxWithPayload(branch, `${branchId}:${id}`, 'update', { baseQty });
    else await enqueueOutbox(branch, `${branchId}:${id}`, 'update');
  } catch {
    try { await enqueueOutbox(branch, `${branchId}:${id}`, 'update'); } catch { /* abaikan: qty lokal tetap tersimpan */ }
  }
}

/** Ambang rendah per-item (null = ikut default global). Ikut di-push Opsi A. */
export async function setBranchThreshold(kind: StockKind, id: string, threshold: number | null): Promise<void> {
  await initDb();
  const branchId = getBranchId();
  const { branch, idCol } = branchTables(kind);
  await run(
    `INSERT INTO ${branch} (branchId, ${idCol}, qty, lowThreshold, flagActive, syncDate)
     VALUES (?, ?, 0, ?, 1, NULL)
     ON CONFLICT(branchId, ${idCol}) DO UPDATE SET lowThreshold = excluded.lowThreshold, syncDate = NULL`,
    [branchId, id, threshold],
  );
  try {
    await enqueueOutbox(branch, `${branchId}:${id}`, 'update');
  } catch {
    /* abaikan */
  }
}
