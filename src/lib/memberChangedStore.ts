/**
 * Ronde-3 trisisi member GO (Q4): banner persisten "Data member berubah".
 *
 * Alur: mirror settle (PayScreen inline / settleMirror QRIS-EDC) membandingkan
 * snapshot pra-settle vs block response pasca-settle. Bila berubah (atau
 * memberDropped) → `markMemberChanged(salesNum)`. SuccessScreen membaca via
 * `takeMemberChanged(orderNo)` saat mount (consume-once, tak banner ganda)
 * + `getSettleMemberView(orderNo)` untuk tampilan minimal Q3.
 *
 * Persist storage best-effort: mirror memakai setTimeout fire-and-forget,
 * response bisa datang SETELAH Success mount — in-memory saja hilang bila
 * proses restart, storage menutup celah itu. Kunci dibatasi 50 terakhir.
 */
import { parseSettleMemberBlock } from './memberRef';
import type { ParsedSettleMember } from './memberRef';
import { getJSON, setJSON } from './storage';

const CHANGED_KEY = 'genfity.member.changed';
const VIEW_KEY = 'genfity.member.view';

const memChanged = new Set<string>();
const memViews = new Map<string, { name: string; points: number; vouchers: number }>();

function noOf(v: unknown): string {
  return String(v ?? '').trim();
}

export async function markMemberChanged(salesNum: string): Promise<void> {
  const no = noOf(salesNum);
  if (!no) return;
  memChanged.add(no);
  try {
    const cur = await getJSON<string[]>(CHANGED_KEY, []);
    if (!cur.includes(no)) await setJSON(CHANGED_KEY, [...cur, no].slice(-50));
  } catch {
    /* abaikan: banner best-effort */
  }
}

/** Simpan tampilan minimal Q3 dari block response (nama samar + poin +
 *  voucher). Dipanggil mirror bersamaan dengan mark (berubah atau tidak —
 *  Success selalu bisa menampilkan kondisi pasca-settle bila diketahui). */
export async function saveSettleMemberView(
  salesNum: string,
  parsed: ParsedSettleMember | null,
): Promise<void> {
  const no = noOf(salesNum);
  if (!no || !parsed?.member) return;
  const view = {
    name: String(parsed.member.nameMasked ?? ''),
    points: parsed.member.pointsBalance,
    vouchers: parsed.member.vouchersValid,
  };
  memViews.set(no, view);
  try {
    const cur = await getJSON<Record<string, typeof view>>(VIEW_KEY, {});
    cur[no] = view;
    const keys = Object.keys(cur).slice(-50);
    const pruned: Record<string, typeof view> = {};
    for (const k of keys) pruned[k] = cur[k];
    await setJSON(VIEW_KEY, pruned);
  } catch {
    /* abaikan */
  }
}

/** Baca-dan-hapus flag berubah (consume-once). */
export async function takeMemberChanged(salesNum: string): Promise<boolean> {
  const no = noOf(salesNum);
  if (!no) return false;
  const mem = memChanged.has(no);
  if (mem) memChanged.delete(no);
  try {
    const cur = await getJSON<string[]>(CHANGED_KEY, []);
    if (cur.includes(no)) {
      await setJSON(
        CHANGED_KEY,
        cur.filter((x) => x !== no),
      );
      return true;
    }
  } catch {
    /* abaikan */
  }
  return mem;
}

/** Tampilan minimal Q3 untuk Success/struk (null = tak diketahui). */
export async function getSettleMemberView(
  salesNum: string,
): Promise<{ name: string; points: number; vouchers: number } | null> {
  const no = noOf(salesNum);
  if (!no) return null;
  if (memViews.has(no)) return memViews.get(no)!;
  try {
    const cur = await getJSON<Record<string, { name: string; points: number; vouchers: number }>>(
      VIEW_KEY,
      {},
    );
    return cur[no] ?? null;
  } catch {
    return null;
  }
}

/** Helper terpadu untuk mirror: parse body → simpan view → bandingkan vs
 *  snapshot pra-settle → tandai berubah. Mengembalikan {changed}. */
export async function recordSettleMemberResult(
  salesNum: string,
  body: unknown,
  prev: { customerId: number | null; pointsBalance: number | null; vouchersValid: number | null },
): Promise<{ changed: boolean }> {
  const parsed = parseSettleMemberBlock(body);
  await saveSettleMemberView(salesNum, parsed);
  if (!parsed || (!parsed.member && !parsed.memberDropped)) return { changed: false };
  const dropped = !!parsed.memberDropped && !parsed.member;
  const nextId = parsed.member ? parsed.member.customerId : null;
  let changed = dropped;
  if (!changed && prev.customerId != null && nextId != null && prev.customerId !== nextId) {
    changed = true;
  }
  if (
    !changed &&
    parsed.member &&
    prev.pointsBalance != null &&
    prev.pointsBalance !== parsed.member.pointsBalance
  ) {
    changed = true;
  }
  if (
    !changed &&
    parsed.member &&
    prev.vouchersValid != null &&
    prev.vouchersValid !== parsed.member.vouchersValid
  ) {
    changed = true;
  }
  if (changed) await markMemberChanged(salesNum);
  return { changed };
}
