/**
 * Adapter pull master jalur-Go (PULLMASTER-6DOMAIN, 2026-10-27).
 *
 * Latar: domain ESB-legacy di master.ts (main/get-*, v1/pull/*, esb_api/*)
 * 404 di backend Go :8086 (curl tanpa token: 404; path api/* digerbang
 * MerchantAuth/UserAuth sehingga butuh sesi). Modul ini memetakan endpoint
 * BE nyata per domain ke tabel lokal ms_*:
 *
 *   menu       -> api/merchant/pos/menu            (masterGo.pullGoCatalog)
 *   table      -> api/merchant/table-management    (MerchantTableManagementGet)
 *   promotion  -> api/merchant/orders/pos/voucher-templates (MerchantPOSVoucherTemplates)
 *   member     -> api/merchant/loyalty/members     (MerchantLoyaltyMembersList)
 *                + pengayaan telepon POS-side via api/merchant/customers/search
 *                (MerchantCustomerSearch, punya nomor; loyalty tak mengirim nomor;
 *                TANPA ubah BE — murni sisi-POS, best-effort).
 *   voucher    -> api/merchant/order-vouchers/templates + .../{id}/codes
 *   expensecoa -> api/merchant/chart-of-accounts   (F-020 live; 404 -> missing-endpoint fallback)
 *
 * Server menang; watermark per domain dipakai bersama master.ts. 404 =
 * endpoint belum ada -> status 'missing-endpoint' (fail-loud, domain lain
 * tetap jalan; expensecoa memakai fallback ini bila BE lama tanpa rute);
 * 401 = sesi kedaluwarsa (fail-closed, melempar); 5xx/parse melempar.
 * Tanpa CREATE TABLE / ubah skema.
 * Pengayaan telepon member: preservasi — NULL tak menimpa lokal, nomor lokal
 * yang sudah ada tak ditimpa; telepon hanya diisi bila match yakin 1:1
 * (nama ternormalisasi sama persis + loyaltyMember + nomor valid + tunggal).
 */
import { ApiPath, apiGet } from '../config/server';
import { initDb, run } from './db';
import { setWatermark } from './sync';

export type BePullKey = 'table' | 'promotion' | 'member' | 'voucher' | 'expensecoa';

/** Kunci domain yang DITANGANI adapter ini (menu ditangani masterGo). */
export const BE_PULL_KEYS: readonly BePullKey[] = [
  'table',
  'promotion',
  'member',
  'voucher',
  'expensecoa',
];

export type BeDomainStatus = 'live' | 'missing-endpoint' | 'forbidden';

export interface BeDomainResult {
  key: BePullKey;
  status: BeDomainStatus;
  /** Baris tertulis ke SQLite (0 bila missing-endpoint). */
  count: number;
  at: string;
  /** Catatan jujur (gap pemetaan / tripwire). */
  note?: string;
}

/** Tripwire: endpoint BE belum ada — tak melempar, tercatat + dilewati. */
export class BeEndpointMissing extends Error {
  readonly key: BePullKey;
  constructor(key: BePullKey) {
    super(`Pull-BE ${key}: endpoint belum ada (404)`);
    this.name = 'BeEndpointMissing';
    this.key = key;
  }
}

/** Tripwire: 403 dari BE (kasir tak punya izin baca domain) — dicatat ke
 * `skipped` seperti missing-endpoint, bukan gagal total. */
export class BeForbidden extends Error {
  readonly key: BePullKey;
  constructor(key: BePullKey) {
    super(`Pull-BE ${key}: tanpa izin baca (403)`);
    this.name = 'BeForbidden';
    this.key = key;
  }
}

const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const str = (v: unknown): string | null =>
  v === undefined || v === null ? null : String(v);

const flag = (v: unknown, d = 1): number =>
  v === undefined || v === null ? d : Number(v) ? 1 : 0;

type Row = Record<string, unknown>;

/** Envelope Go: {success, data} atau {success, data:{...}}; array langsung. */
function rowsOf(body: unknown): Row[] {
  if (Array.isArray(body)) return body as Row[];
  if (body && typeof body === 'object') {
    const b = body as { success?: boolean; data?: unknown };
    if (Array.isArray(b.data)) return b.data as Row[];
  }
  return [];
}

async function beGet(path: string, key: BePullKey): Promise<Row[] | { nested: unknown }> {
  const res = await apiGet(path, { limit: 500 });
  if (res.status === 404) throw new BeEndpointMissing(key);
  if (res.status === 401) {
    throw new Error(`Sesi kedaluwarsa (401) — login ulang sebelum sync ${key}.`);
  }
  if (res.status === 403) throw new BeForbidden(key);
  if (!res.ok) throw new Error(`Pull-BE ${key}: HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as { success?: boolean; data?: unknown };
    if (b.success === false) throw new Error(`Pull-BE ${key}: respons success=false`);
    if (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) {
      return { nested: b.data };
    }
    return rowsOf(body);
  }
  return rowsOf(body);
}

/** customers/search per nama (pengayaan telepon POS-side): {q,take} -> baris. */
async function beSearchCustomers(q: string, take = 50): Promise<Row[]> {
  const query = String(q ?? '').trim();
  if (!query) return [];
  const res = await apiGet(ApiPath.pullGoCustomers, {
    q: query,
    take: Math.max(1, Math.min(50, Math.round(take) || 50)),
  });
  if (res.status === 404) throw new BeEndpointMissing('member');
  if (res.status === 401) {
    throw new Error('Sesi kedaluwarsa (401) — login ulang sebelum sync member.');
  }
  if (!res.ok) throw new Error(`Pull-BE member: HTTP ${res.status} (customers/search)`);
  const body = (await res.json()) as unknown;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as { success?: boolean; data?: unknown };
    if (b.success === false) throw new Error('Pull-BE member: respons success=false (customers/search)');
    return rowsOf(body);
  }
  return rowsOf(body);
}

// ---------------------------------------------------------------------------
// Parser MURNI per domain (diekspor untuk tripwire statik + uji): input =
// bentuk JSON persis respons handler BE, output = baris siap upsert.
// ---------------------------------------------------------------------------

export interface BeTableRow {
  id: string;
  tableNo: string;
  sectionId: string;
  capacity: number;
  status: string;
}

/** api/merchant/table-management -> {floors:[{id, tables:[...]}]}. */
export function parseBeTables(nested: unknown): BeTableRow[] {
  const out: BeTableRow[] = [];
  const d = (nested ?? {}) as { floors?: unknown };
  if (!Array.isArray(d.floors)) return out;
  for (const f of d.floors as Row[]) {
    const floorId = str(f.id) ?? '';
    const tables = (f as { tables?: unknown }).tables;
    if (!Array.isArray(tables)) continue;
    for (const t of tables as Row[]) {
      const id = str(t.id) ?? '';
      if (!id) continue;
      out.push({
        id,
        tableNo: str(t.tableNumber) ?? '',
        sectionId: floorId,
        capacity: num(t.seats),
        status: str(t.status) ?? '',
      });
    }
  }
  return out;
}

export interface BePromoRow {
  id: string;
  promoCode: string;
  promoName: string;
  promoType: string;
  value: number;
  maxAmount: number;
  minSpend: number;
  validFrom: string | null;
  validTo: string | null;
  flagActive: number;
}

/** api/merchant/orders/pos/voucher-templates -> [{id,name,discountType,...}]. */
export function parseBePromos(rows: Row[]): BePromoRow[] {
  const out: BePromoRow[] = [];
  for (const r of rows) {
    const id = str(r.id) ?? '';
    if (!id) continue;
    // discountType BE: 'PERCENT' | 'FIXED' (+ legacy 'PERCENTAGE' di validasi).
    const rawType = String(r.discountType ?? '').trim().toUpperCase();
    const promoType = rawType === 'FIXED' || rawType === 'FIXED_AMOUNT' ? 'FIXED' : 'PERCENT';
    out.push({
      id,
      // Template tak punya kode klaim per-template; kode hidup di
      // order-voucher-codes (domain voucher). Prefix TPL- menandai agregat.
      promoCode: `TPL-${id}`,
      promoName: str(r.name) ?? '',
      promoType,
      value: num(r.discountValue),
      maxAmount: num(r.maxDiscountAmount),
      minSpend: num(r.minOrderAmount),
      validFrom: str(r.validFrom),
      validTo: str(r.validUntil),
      flagActive: 1,
    });
  }
  return out;
}

export interface BeMemberRow {
  id: string;
  memberName: string;
  depositBalance: number;
}

/** api/merchant/loyalty/members -> [{id,name,status,pointsBalance,...}]. */
export function parseBeMembers(rows: Row[]): BeMemberRow[] {
  const out: BeMemberRow[] = [];
  for (const r of rows) {
    const id = str(r.id) ?? '';
    if (!id) continue;
    // Hanya keanggotaan ACTIVE yang turun ke kasir; status lain dilewati
    // eksplisit (bukan gagal) agar daftar member kasir tetap tepercaya.
    if (r.status !== undefined && r.status !== null && String(r.status) !== 'ACTIVE') continue;
    out.push({
      id,
      memberName: str(r.name) ?? '',
      depositBalance: num(r.pointsBalance),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pengayaan telepon member POS-side (TANPA ubah BE).
//
// Latar: loyalty/members tak mengirim nomor (id = membership lm.id, tanpa
// customer_id), sedangkan customers/search PUNYA nomor (id = customer id).
// Kedua ruang-id tak bisa di-join langsung, jadi pencocokan lewat atribut:
// nama ternormalisasi + flag loyaltyMember + nomor valid + ketunggalan.
// Best-effort: gagal/offline saat pengayaan = telepon preservasi (NULL),
// baris loyalty tetap tersimpan; 401 tetap fail-closed (sesi).
// ---------------------------------------------------------------------------

/** Kandidat customer dari customers/search (punya telepon). */
export interface BeCustomerCandidate {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  pointsBalance: number;
  loyaltyMember: boolean;
}

/** Normalisasi nama untuk pencocokan: huruf kecil, spasi tunggal, trim. */
export function normalizeMemberName(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digit telepon (buang spasi/strip/plus/titik; cermin L21 master.ts). */
export function phoneDigits(phone: unknown): string {
  return String(phone ?? '').replace(/[^0-9]/g, '');
}

/** Nomor layak donasi: ada, tanpa karakter mask, digit 9..16. */
export function isUsablePhone(phone: unknown): boolean {
  const s = String(phone ?? '');
  if (!s.trim()) return false;
  if (/[*xX\u2022]/.test(s)) return false;
  const d = phoneDigits(s);
  return d.length >= 9 && d.length <= 16;
}

/** customers/search -> kandidat (baris id tak-desimal dilewati). */
export function parseBeCustomers(rows: Row[]): BeCustomerCandidate[] {
  const out: BeCustomerCandidate[] = [];
  for (const r of rows) {
    const n = Number(r.id);
    if (!Number.isInteger(n) || n <= 0) continue;
    out.push({
      id: n,
      name: str(r.name) ?? '',
      phone: str(r.phone),
      email: str(r.email),
      pointsBalance: num(r.pointsBalance ?? r.points_balance),
      loyaltyMember: r.loyaltyMember === true || r.loyalty_member === true,
    });
  }
  return out;
}

/**
 * Cocokkan satu loyalty member ke TEPAT SATU kandidat customer (1:1 yakin).
 * Syarat kumulatif: nama ternormalisasi sama persis + loyaltyMember true +
 * nomor valid. Bukan-1 (nol/lebih-dari-satu) = null (no-match, preservasi).
 * Poin SENGAJA bukan filter (drift antar dua panggilan); ketunggalan nama
 * di himpunan loyalty = jaminan 1:1.
 */
export function matchCustomerForMember(
  member: BeMemberRow,
  candidates: BeCustomerCandidate[],
): BeCustomerCandidate | null {
  const want = normalizeMemberName(member.memberName);
  if (!want) return null;
  const hits = (candidates ?? []).filter(
    (c) =>
      c &&
      c.loyaltyMember === true &&
      normalizeMemberName(c.name) === want &&
      isUsablePhone(c.phone),
  );
  if (hits.length !== 1) return null;
  return hits[0];
}

/**
 * Keputusan preservasi: kembalikan nomor donasi HANYA bila lokal kosong dan
 * donasi valid; selain itu null (= TETAP pakai ms_member.phone, tak timpa).
 * Tak pernah mengembalikan perintah hapus — NULL donasi = preservasi.
 * Runtime pullBeMembers memakai SQL CASE untuk sisi lokal-isi (tanpa SELECT
 * tambahan); helper ini dipakai uji + konsumsi UI.
 */
export function decideEnrichedPhone(
  localPhone: unknown,
  matchedPhone: unknown,
): string | null {
  if (localPhone !== undefined && localPhone !== null && String(localPhone).trim() !== '') {
    return null;
  }
  const cand = String(matchedPhone ?? '').trim();
  if (!isUsablePhone(cand)) return null;
  return cand;
}

export interface BeVoucherRow {
  id: string;
  voucherCode: string;
  voucherName: string;
  amount: number;
  quota: number;
  validFrom: string | null;
  validTo: string | null;
  status: string;
}

/**
 * Kode voucher per template + konteks template induk.
 * BE tak punya kuota maksimum (hanya used_count) -> semantik sekali-pakai:
 * quota = 1 bila isActive && usedCount<=0, else 0. Penegakan kuota final
 * tetap di server saat settle (validate-voucher); kolom lokal untuk saring
 * ketersediaan offline.
 */
export function parseBeVoucherCodes(
  codes: Row[],
  template: { name: string; discountValue: unknown; validFrom: unknown; validUntil: unknown },
): BeVoucherRow[] {
  const out: BeVoucherRow[] = [];
  for (const c of codes) {
    const id = str(c.id) ?? '';
    const code = str(c.code) ?? '';
    if (!id || !code) continue;
    const active = c.isActive !== false;
    const used = num(c.usedCount) > 0;
    out.push({
      id,
      voucherCode: code,
      voucherName: template.name,
      amount: num(template.discountValue),
      quota: active && !used ? 1 : 0,
      validFrom: str(c.validFrom) ?? str(template.validFrom),
      validTo: str(c.validUntil) ?? str(template.validUntil),
      status: !active ? 'inactive' : used ? 'used' : 'active',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pull per domain: fetch -> parse -> upsert -> watermark.
// ---------------------------------------------------------------------------

async function pullBeTables(): Promise<Omit<BeDomainResult, 'key'>> {
  const body = await beGet(ApiPath.pullGoTables, 'table');
  const nested = (body as { nested?: unknown }).nested ?? body;
  const rows = parseBeTables(nested);
  const now = new Date().toISOString();
  for (const t of rows) {
    await run(
      `INSERT INTO "ms_table" (id, tableNo, sectionId, capacity, status, syncDate)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET tableNo = excluded.tableNo, sectionId = excluded.sectionId,
         capacity = excluded.capacity, status = excluded.status, syncDate = excluded.syncDate`,
      [t.id, t.tableNo, t.sectionId, t.capacity, t.status, now],
    );
  }
  await setWatermark('table', { pull: now });
  return { status: 'live', count: rows.length, at: now };
}

async function pullBePromos(): Promise<Omit<BeDomainResult, 'key'>> {
  const body = await beGet(ApiPath.pullGoPromoTemplates, 'promotion');
  const rows = parseBePromos(Array.isArray(body) ? body : []);
  const now = new Date().toISOString();
  for (const p of rows) {
    await run(
      `INSERT INTO "ms_promotion" (id, promoCode, promoName, promoType, value, maxAmount,
         minSpend, validFrom, validTo, flagActive, syncDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET promoCode = excluded.promoCode, promoName = excluded.promoName,
         promoType = excluded.promoType, value = excluded.value, maxAmount = excluded.maxAmount,
         minSpend = excluded.minSpend, validFrom = excluded.validFrom, validTo = excluded.validTo,
         flagActive = excluded.flagActive, syncDate = excluded.syncDate`,
      [p.id, p.promoCode, p.promoName, p.promoType, p.value, p.maxAmount, p.minSpend,
        p.validFrom, p.validTo, p.flagActive, now],
    );
  }
  await setWatermark('promotion', { pull: now });
  return {
    status: 'live',
    count: rows.length,
    at: now,
    note: 'Agregat template (tanpa kode klaim; kode hidup di domain voucher).',
  };
}

async function pullBeMembers(): Promise<Omit<BeDomainResult, 'key'>> {
  const body = await beGet(ApiPath.pullGoMembers, 'member');
  const rows = parseBeMembers(Array.isArray(body) ? body : []);
  const now = new Date().toISOString();
  let enriched = 0;
  for (const m of rows) {
    // Pengayaan telepon POS-side: kandidat via customers/search (q = nama
    // persis; take 50 = batas BE, minim risiko truncasi), lalu match 1:1
    // yakin. Best-effort per baris: gagal = NULL (preservasi); 404 search =
    // NULL; 401 = fail-closed sesi (dilempar seperti jalur pull).
    let donor: string | null = null;
    if (normalizeMemberName(m.memberName)) {
      try {
        const found = await beSearchCustomers(m.memberName, 50);
        const hit = matchCustomerForMember(m, parseBeCustomers(found));
        // Lokal diasumsikan kosong di sini (hemat 1 SELECT/baris);
        // preservasi nomor-lokal-isi ditegakkan SQL CASE di bawah.
        donor = decideEnrichedPhone(null, hit ? hit.phone : null);
        if (donor) enriched += 1;
      } catch (e) {
        if (e instanceof BeEndpointMissing) {
          donor = null;
        } else if (e instanceof Error && /Sesi kedaluwarsa/.test(e.message)) {
          throw e;
        } else {
          console.warn(`[pull-be] member: pengayaan telepon ${m.id} dilewati (${e instanceof Error ? e.message : e})`);
          donor = null;
        }
      }
    }
    // Cermin proteksi L21 master.ts: saldo lokal kotor (syncDate NULL =
    // topup/burn belum push) dipertahankan. Telepon preservasi dua arah:
    // (a) donasi NULL/'' = pertahankan lokal; (b) lokal sudah terisi =
    // pertahankan lokal; hanya lokal KOSONG + donasi valid yang diisi.
    await run(
      `INSERT INTO "ms_member" (id, memberName, phone, email, depositBalance, syncDate)
       VALUES (?, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         memberName = excluded.memberName,
         phone = CASE
           WHEN excluded.phone IS NULL OR excluded.phone = '' THEN ms_member.phone
           WHEN ms_member.phone IS NOT NULL AND ms_member.phone <> '' THEN ms_member.phone
           ELSE excluded.phone END,
         depositBalance = CASE WHEN ms_member.syncDate IS NULL THEN ms_member.depositBalance ELSE excluded.depositBalance END,
         syncDate = CASE WHEN ms_member.syncDate IS NULL THEN NULL ELSE excluded.syncDate END`,
      [m.id, m.memberName, donor, m.depositBalance, now],
    );
  }
  await setWatermark('member', { pull: now });
  return {
    status: 'live',
    count: rows.length,
    at: now,
    note: `Saldo = pointsBalance; telepon diisi ${enriched}/${rows.length} via customers/search 1:1 (preservasi: NULL/lokal-isi tak ditimpa).`,
  };
}

async function pullBeVouchers(): Promise<Omit<BeDomainResult, 'key'>> {
  const tplBody = await beGet(ApiPath.pullGoVoucherTemplates, 'voucher');
  const templates = (Array.isArray(tplBody) ? tplBody : []).filter(
    (t) => t.is_active !== false,
  );
  // Batasi N+1: 25 template terbaru x 200 kode (cermin take BE, clamp 1..500).
  const capped = templates.slice(0, 25);
  const now = new Date().toISOString();
  let count = 0;
  for (const t of capped) {
    const tid = str(t.id) ?? '';
    if (!tid) continue;
    const path = `${ApiPath.pullGoVoucherTemplates}/${encodeURIComponent(tid)}/codes`;
    let codes: Row[];
    try {
      const b = await beGet(path, 'voucher');
      codes = Array.isArray(b) ? b : [];
    } catch (e) {
      if (e instanceof BeEndpointMissing) continue;
      throw e;
    }
    const rows = parseBeVoucherCodes(codes, {
      name: String(t.name ?? ''),
      discountValue: t.discount_value ?? t.discountValue,
      validFrom: t.valid_from ?? t.validFrom,
      validUntil: t.valid_until ?? t.validUntil,
    });
    for (const v of rows) {
      // Cermin proteksi L10 master.ts: burn lokal belum push (syncDate NULL)
      // mempertahankan quota + status + syncDate lokal.
      await run(
        `INSERT INTO "ms_voucher" (id, voucherCode, voucherName, amount, quota, validFrom, validTo, status, syncDate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           voucherCode = excluded.voucherCode, voucherName = excluded.voucherName,
           amount = excluded.amount, validFrom = excluded.validFrom, validTo = excluded.validTo,
           quota = CASE WHEN ms_voucher.syncDate IS NULL THEN ms_voucher.quota ELSE excluded.quota END,
           status = CASE WHEN ms_voucher.syncDate IS NULL THEN ms_voucher.status ELSE excluded.status END,
           syncDate = CASE WHEN ms_voucher.syncDate IS NULL THEN NULL ELSE excluded.syncDate END`,
        [v.id, v.voucherCode, v.voucherName, v.amount, v.quota, v.validFrom, v.validTo, v.status, now],
      );
      count += 1;
    }
  }
  await setWatermark('voucher', { pull: now });
  return {
    status: 'live',
    count,
    at: now,
    note: 'Kuota = semantik sekali-pakai (BE hanya used_count); penegakan final di server saat settle.',
  };
}

export interface BeCoaRow {
  id: string;
  coaName: string;
  coaType: string;
  flagActive: number;
}

/**
 * api/merchant/chart-of-accounts -> [{coaId,coaName,type,flagActive}].
 * Murni (diekspor untuk tripwire). Kunci identik dummy pull POS
 * (v1-pull-expense-chart-of-accounts.json) + pemetaan master.ts
 * ([coaId,coaName,type,flagActive]) agar tulis langsung ke ms_coa.
 */
export function parseBeCoa(rows: Row[]): BeCoaRow[] {
  const out: BeCoaRow[] = [];
  for (const r of rows) {
    const id = str(r.coaId) ?? '';
    if (!id) continue;
    out.push({
      id,
      coaName: str(r.coaName) ?? '',
      coaType: str(r.type) ?? '',
      flagActive: flag(r.flagActive, 1),
    });
  }
  return out;
}

async function pullBeCoa(): Promise<Omit<BeDomainResult, 'key'>> {
  const body = await beGet(ApiPath.pullGoCoa, 'expensecoa');
  const rows = parseBeCoa(Array.isArray(body) ? body : []);
  const now = new Date().toISOString();
  for (const c of rows) {
    await run(
      `INSERT INTO "ms_coa" (id, coaName, coaType, flagActive, syncDate)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET coaName = excluded.coaName, coaType = excluded.coaType,
         flagActive = excluded.flagActive, syncDate = excluded.syncDate`,
      [c.id, c.coaName, c.coaType, c.flagActive, now],
    );
  }
  await setWatermark('expensecoa', { pull: now });
  return { status: 'live', count: rows.length, at: now };
}

/**
 * Tarik satu domain BE. 404 -> BeEndpointMissing (tripwire: endpoint belum
 * ada); pemanggil agregat (master.ts) mencatatnya ke `skipped`, bukan gagal.
 */
export async function pullBeDomain(key: BePullKey): Promise<BeDomainResult> {
  await initDb();
  try {
    if (key === 'expensecoa') return { key, ...(await pullBeCoa()) };
    if (key === 'table') return { key, ...(await pullBeTables()) };
    if (key === 'promotion') return { key, ...(await pullBePromos()) };
    if (key === 'member') return { key, ...(await pullBeMembers()) };
    return { key, ...(await pullBeVouchers()) };
  } catch (e) {
    if (e instanceof BeEndpointMissing) {
      const at = new Date().toISOString();
      console.warn(`[pull-be] ${key}: endpoint BE belum ada (404) — dilewati.`);
      return { key, status: 'missing-endpoint', count: 0, at, note: 'HTTP 404 dari BE.' };
    }
    if (e instanceof BeForbidden) {
      const at = new Date().toISOString();
      console.warn(`[pull-be] ${key}: tanpa izin baca (403) — dilewati, catat ke skipped.`);
      return { key, status: 'forbidden', count: 0, at, note: 'HTTP 403 dari BE (izin peran tak cukup).' };
    }
    throw e;
  }
}

/** Tarik beberapa/semua domain BE sekaligus (agregat tripwire-friendly). */
export async function pullBeMaster(only?: BePullKey[]): Promise<BeDomainResult[]> {
  const keys = !only || only.length === 0 ? [...BE_PULL_KEYS] : only.filter((k) => (BE_PULL_KEYS as readonly string[]).includes(k));
  const out: BeDomainResult[] = [];
  for (const k of keys) out.push(await pullBeDomain(k));
  return out;
}
