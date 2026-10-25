/**
 * Ronde-3 trisisi member GO (Q1–Q4): identitas member tunggal = customerId
 * (int GO). ID ESB (prefix M / MC) BOLEH jadi query pencarian, tapi BUKAN data
 * tersimpan sebagai ref transaksi dan BUKAN bagian payload settle/sync.
 *
 * Aturan yang ditegakkan modul ini:
 * - Q1: sale/transaksi menyimpan customerId (int). Alias lokal (prefix M/MC)
 *   hanya pointer ledger deposit turunan: `MC{customerId}` — deterministik dari
 *   customerId, bukan identitas independen.
 * - Q2: request settle/drain membawa `customerId` (int) bila member ditempel;
 *   response dibaca sebagai member block (toleran: field absen = kompat BE
 *   lama → perilaku lokal seperti hari ini, tanpa crash).
 * - Q4: snapshot tampilan member pra-settle vs block response pasca-settle —
 *   bila beda (poin/voucher berubah) ATAU ada memberDropped → banner persisten.
 * - Q5: gate UI lookup/search pada `memberLookupEnabled` dari pos-config
 *   (absen = enabled).
 *
 * Murni (tanpa impor DB/API) agar bisa diuji tripwire statis + unit.
 */
export const GO_CUSTOMER_ALIAS_PREFIX = 'MC';

/** GO customer id yang valid: int desimal > 0. Selain itu = bukan. */
export function parseCustomerId(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v <= 0) return null;
    return v;
  }
  const s = String(v ?? '').trim();
  if (!/^[0-9]+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Pointer ledger deposit lokal turunan dari customerId (satu-satunya sumber
 *  format `MC{id}` — JANGAN inline `MC${...}` di tempat lain). */
export function localMemberKeyForCustomer(customerId: number): string | null {
  if (!Number.isInteger(customerId) || customerId <= 0) return null;
  return `${GO_CUSTOMER_ALIAS_PREFIX}${customerId}`;
}

/** Balikan: kunci lokal `MC{id}` → customerId; selain itu null. */
export function customerIdFromLocalKey(key: unknown): number | null {
  const s = String(key ?? '').trim();
  const m = new RegExp(`^${GO_CUSTOMER_ALIAS_PREFIX}([0-9]+)$`).exec(s);
  if (!m) return null;
  return parseCustomerId(m[1]);
}

/** True = token member ALIAS (prefix M/MC/teks lain) — bukan customerId GO.
 *  Dipakai guard runtime + tripwire: alias TAK BOLEH masuk payload settle. */
export function isAliasMemberId(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'number') return parseCustomerId(v) === null;
  const s = String(v).trim();
  if (!s) return false;
  return parseCustomerId(s) === null;
}

// ---------------------------------------------------------------------------
// Q2: member block dari response settle (kontrak BE, kedua sisi pakai nama
// persis): `member: {customerId, nameMasked, pointsBalance, vouchersValid}`
// atau `memberDropped: "MEMBER_NOT_FOUND"`. Field boleh absen (kompat BE
// lama → null = perilaku lokal seperti hari ini, tanpa crash).
// ---------------------------------------------------------------------------
export interface SettleMemberBlock {
  customerId: number;
  nameMasked: string;
  pointsBalance: number;
  vouchersValid: number;
}

export interface ParsedSettleMember {
  member?: SettleMemberBlock;
  memberDropped?: string;
}

function numOr(v: unknown, fb: number): number {
  const n = Math.round(Number(v) || 0);
  return Number.isFinite(n) ? n : fb;
}

function strOr(v: unknown, fb = ''): string {
  return typeof v === 'string' ? v : v == null ? fb : String(v);
}

/** Parse toleran block member dari body response settle (sudah/belum unwrap
 *  envelope `{data}` — keduanya diterima). */
export function parseSettleMemberBlock(body: unknown): ParsedSettleMember | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const inner =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root;
  const droppedRaw = inner.memberDropped ?? root.memberDropped;
  const dropped = typeof droppedRaw === 'string' && droppedRaw.trim() ? droppedRaw.trim() : undefined;
  const rawMember = (inner.member ?? root.member) as Record<string, unknown> | null | undefined;
  if (!rawMember || typeof rawMember !== 'object') {
    return dropped ? { memberDropped: dropped } : null;
  }
  const customerId = parseCustomerId(rawMember.customerId ?? rawMember.customer_id);
  if (customerId == null) {
    return dropped ? { memberDropped: dropped } : null;
  }
  return {
    member: {
      customerId,
      nameMasked: strOr(rawMember.nameMasked ?? rawMember.name_masked, ''),
      pointsBalance: Math.max(0, numOr(rawMember.pointsBalance ?? rawMember.points_balance, 0)),
      vouchersValid: Math.max(0, numOr(rawMember.vouchersValid ?? rawMember.vouchers_valid, 0)),
    },
    ...(dropped ? { memberDropped: dropped } : {}),
  };
}

// ---------------------------------------------------------------------------
// Q4: snapshot-vs-response. Snapshot = tampilan member pra-settle;
// response = block pasca-settle. Beda (poin/voucher/customer berubah) ATAU
// ada memberDropped → banner persisten "Data member berubah, cek ulang".
// ---------------------------------------------------------------------------
export interface MemberViewSnapshot {
  customerId: number | null;
  pointsBalance: number | null;
  vouchersValid: number | null;
  dropped: boolean;
}

export function isMemberViewChanged(
  prev: MemberViewSnapshot | null | undefined,
  next: MemberViewSnapshot | null | undefined,
): boolean {
  if (!prev || !next) return false;
  if (next.dropped) return true;
  if ((prev.customerId ?? null) !== (next.customerId ?? null)) return true;
  if (prev.pointsBalance != null && next.pointsBalance != null && prev.pointsBalance !== next.pointsBalance) return true;
  if (prev.vouchersValid != null && next.vouchersValid != null && prev.vouchersValid !== next.vouchersValid) return true;
  return false;
}

/** Bangun snapshot dari block response (null = tak ada info member = tak
 *  bisa dibandingkan → pemanggil anggap tak-berubah). */
export function snapshotFromParsed(p: ParsedSettleMember | null): MemberViewSnapshot | null {
  if (!p) return null;
  if (p.memberDropped && !p.member) {
    return { customerId: null, pointsBalance: null, vouchersValid: null, dropped: true };
  }
  if (!p.member) return null;
  return {
    customerId: p.member.customerId,
    pointsBalance: p.member.pointsBalance,
    vouchersValid: p.member.vouchersValid,
    dropped: !!p.memberDropped,
  };
}

// ---------------------------------------------------------------------------
// Q3: tampilan minimal member (nama samar + poin + jumlah voucher).
// JANGAN tampilkan kontak penuh/riwayat di UI kasir.
// ---------------------------------------------------------------------------
/** Nama samar: nama depan utuh + kata berikut disingkat (`Budi Santoso` →
 *  `Budi S***`). Kata tunggal ≤2 huruf → `***`. */
export function maskMemberName(name: unknown): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  const head = parts[0];
  const tail = parts.slice(1).map((w) => `${w.charAt(0)}***`);
  const masked = [head.length <= 2 ? '***' : head, ...tail].join(' ');
  return masked;
}

// ---------------------------------------------------------------------------
// Q5: gate lookup/search member. Kontrak: pos-config `memberLookupEnabled`
// (absen = enabled). Baca top-level ATAU nested posBehaviorSettings /
// posBehavior (BE lama menaruh flag di posBehavior).
// ---------------------------------------------------------------------------
export function parseMemberLookupEnabled(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  const o = data as Record<string, unknown>;
  const nested =
    (o.posBehaviorSettings && typeof o.posBehaviorSettings === 'object'
      ? (o.posBehaviorSettings as Record<string, unknown>)
      : undefined) ??
    (o.posBehavior && typeof o.posBehavior === 'object'
      ? (o.posBehavior as Record<string, unknown>)
      : undefined);
  const cand = o.memberLookupEnabled ?? nested?.memberLookupEnabled;
  if (cand === undefined || cand === null) return true;
  if (typeof cand === 'boolean') return cand;
  if (typeof cand === 'number') return cand !== 0;
  const s = String(cand).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'ya' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'tidak' || s === 'no') return false;
  return true;
}
