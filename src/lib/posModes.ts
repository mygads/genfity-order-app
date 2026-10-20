/**
 * Mode kasir per merchant-type (C2, SESI-C APP).
 *
 * Matriks POS-create BE — orders_pos_create.go:196 (gate umum) + :224-250
 * (gate per tipe):
 *   RESTAURANT: DINE_IN | TAKEAWAY
 *   PRODUCT:    IN_STORE_ORDER | TAKEAWAY
 *   SERVICE:    IN_STORE_SERVICE
 * UI kasir menawarkan HANYA kanal yang diterima BE untuk tipe itu. Agregator
 * (GOFOOD/GRABFOOD/SHOPEEFOOD) adalah label kanal → TAKEAWAY di lapisan sync
 * (kurir-bawa-pulang; goPosOrderType), bukan enum BE.
 *
 * Penyimpangan sadar dari brief C2: brief meminta DELIVERY (RESTAURANT/
 * PRODUCT) + IN_STORE_PICKUP (PRODUCT) + HOME_SERVICE (SERVICE) di daftar
 * tawar. Ketiganya 400 POS_VALIDATION_ERROR di POS create (bukti baris BE di
 * atas) → menawarkannya = tombol yang selalu BLOCKED. Bila produk
 * menghendaki DELIVERY via POS, itu owner-need ke BE (endpoint + field alamat),
 * bukan yang bisa diperbaiki APP. Lihat laporan SESI-C C2.
 */
import { apiFetch, unwrap } from './apiSource';
import { initDb, queryFirst, run } from './db';

/** Tipe merchant kanonis BE (CLAUDE.md §5 + orders_pos_create.go:224-250). */
export type PosMerchantType = 'RESTAURANT' | 'PRODUCT' | 'SERVICE';

/**
 * Normalisasi tipe merchant. Default RESTAURANT bila tak diketahui =
 * [ASUMSI] koordinator SESI-C (restaurant = default; penolakan BE atas
 * orderType hasil mapping ditandai BLOCKED jujur pola S10, bukan diganti
 * diam-diam).
 */
export function normalizeMerchantType(raw?: unknown): PosMerchantType {
  const k = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (k === 'PRODUCT' || k === 'PRODUK' || k === 'RETAIL' || k === 'BARANG') return 'PRODUCT';
  if (k === 'SERVICE' || k === 'SERVIS' || k === 'JASA' || k === 'LAYANAN') return 'SERVICE';
  return 'RESTAURANT';
}

/**
 * Daftar mode UI per tipe (label ber-spasi, kompatibel normalizeSalesMode:
 * 'IN STORE ORDER' → 'IN_STORE_ORDER', dst.). RESTAURANT identik dengan daftar
 * lama (tanpa perubahan perilaku); PRODUCT/SERVICE = kanal POS-create BE.
 */
export const POS_MODES_BY_TYPE: Record<PosMerchantType, string[]> = {
  RESTAURANT: ['DINE IN', 'TAKE AWAY', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'],
  PRODUCT: ['IN STORE ORDER', 'TAKE AWAY'],
  SERVICE: ['IN STORE SERVICE'],
};

/** Daftar tawar untuk tipe merchant (tak dikenal → RESTAURANT, lihat [ASUMSI]). */
export function posModesFor(rawType?: unknown): string[] {
  return POS_MODES_BY_TYPE[normalizeMerchantType(rawType)];
}

/** true bila label mode ditawarkan untuk tipe merchant itu. */
export function isPosModeOffered(rawType: unknown, mode?: unknown): boolean {
  const m = String(mode ?? '').trim();
  if (!m) return false;
  return posModesFor(rawType).some((o) => o.toUpperCase() === m.toUpperCase());
}

/**
 * Parser forward-compat tipe merchant dari body E01 terminal-login.
 * Fakta 2026-10-20: BE E01 BELUM mengirim merchantType di tahap mana pun
 * (API-TERMINAL-CONTRACT.md tanpa merchantType; NormBranch/NormTerminal di
 * LoginScreen tanpa kunci tipe) → hasil '' = tak diketahui; pemanggil
 * mempertahankan prev/default (jangan mengarang RESTAURANT di sini —
 * defaulting milik normalizeMerchantType di titik baca). Hanya kunci
 * merchant* eksplisit yang diterima ('type' generik milik entitas lain —
 * tipe terminal/grant/dokumen — dan tak boleh dibaca sebagai tipe merchant).
 * Bila BE kelak mengirimnya (owner-need C2), binding mempelajarinya tanpa
 * perubahan kode.
 */
/**
 * Rantai server-profile (R2 SC-QA3 rekonsiliasi — port SATU hal dari
 * merchantType.ts sc yang dihapus; TANPA daftar mode sc, TANPA normalisasi
 * sc — normalisasi = milik main di atas).
 *
 * Urutan sumber tipe merchant: profil server → binding E01 (dibaca via
 * readMerchantTypeFromLoginBody di titik login) → RESTAURANT (default di
 * normalizeMerchantType). Cache in-memory + persist ms_setting
 * (key1='Merchant', key2='Type'), cermin lib/currency.ts. Best-effort tanpa
 * throw; SENGAJA tanpa markDirty (baris milik server/pull).
 */
let cachedMerchantType: PosMerchantType = 'RESTAURANT';

/** Baca cache tipe merchant sesi (sinkron agar bisa dipakai render/sync). */
export function getCachedMerchantType(): PosMerchantType {
  return cachedMerchantType;
}

/** Tulis cache eksplisit (normalisasi milik main — gabung alias). */
export function setCachedMerchantType(raw: unknown): PosMerchantType {
  cachedMerchantType = normalizeMerchantType(raw);
  return cachedMerchantType;
}

/**
 * R1 (SC-QA3 rekonsiliasi, putusan owner A): flag delivery-enabled merchant.
 * SEARCH FACT (2026-10-21, kutip baris-per-baris):
 * - BE `GET /api/merchant/profile` MENGEMBALIKAN flag ini:
 *   services/.../handlers/merchant_profile.go:1285
 *   `"isDeliveryEnabled": row.IsDeliveryEnabled,` (kolom merchants.
 *   is_delivery_enabled, default false; migration 00001:412,547).
 * - BE POS-create TAK PERNAH membaca flag ini (orders_pos_create.go: NOL
 *   kemunculan is_delivery_enabled; gate = enum :196-197 + per-tipe :223-237).
 *   Flag mengatur storefront-delivery/pricing/zona (delivery_pricing.go,
 *   customer_reservations.go:604 `if !isDeliveryEnabled`), BUKAN
 *   penerimaan POS-create.
 * - APP TAK membaca flag ini (grep src NOL isDelivery/is_delivery) — rantai
 *   profil di bawah (api/merchant/profile, dipakai syncMerchantTypeFromProfile)
 *   hanya mengupas merchantType.
 * GATE JUJUR (flag ada → gate + tripwire): runtuh DELIVERY/agregator→TAKEAWAY
 * RESTAURANT di goPosOrderType hanya bila flag true; false eksplisit =
 * UNSUPPORTED (BLOCKED fail-once + alasan, pola S10) — pesanan delivery yang
 * dicatat diam-diam sebagai takeaway = data tak jujur (tanpa alamat/kurir;
 * domain kurir-vs-gosend/grab + ongkir API = PARKED, bukan dibangun di sini).
 * Daftar UI (POS_MODES_BY_TYPE) TAK berubah — tanpa label DELIVERY di daftar
 * mana pun (ikut main). Default true = perilaku lama lestari bila flag belum
 * pernah tersinkron (offline/BE lama): hanya opt-out eksplisit merchant yang
 * menggerbang ([ASUMSI] R1, didokumentasi di sini, bukan dikarang diam-diam).
 */
let cachedDeliveryEnabled: boolean = true;

/** Baca cache flag delivery sesi (default true = legacy lestari, lihat atas). */
export function getCachedDeliveryEnabled(): boolean {
  return cachedDeliveryEnabled;
}

/** Tulis cache eksplisit (boolean() longgar: 'false'/0/false → false). */
export function setCachedDeliveryEnabled(raw: unknown): boolean {
  if (typeof raw === 'string') {
    const k = raw.trim().toLowerCase();
    cachedDeliveryEnabled = !(k === '' || k === 'false' || k === '0' || k === 'no' || k === 'off');
  } else {
    cachedDeliveryEnabled = raw == null ? true : Boolean(raw);
  }
  return cachedDeliveryEnabled;
}

/** Kupas field flag dari payload profil (toleran dua bentuk envelope). */
function readDeliveryEnabledFromProfile(data: Record<string, unknown>): unknown {
  for (const key of ['isDeliveryEnabled', 'is_delivery_enabled']) {
    if (key in data) return data[key];
  }
  for (const nest of ['merchant', 'branch', 'profile', 'data']) {
    const inner = data[nest];
    if (inner && typeof inner === 'object') {
      const rec = inner as Record<string, unknown>;
      for (const key of ['isDeliveryEnabled', 'is_delivery_enabled']) {
        if (key in rec) return rec[key];
      }
    }
  }
  return undefined;
}

/** Persist cache ke ms_setting(Merchant, Delivery) ('1'/'0'). */
async function persistDeliveryEnabled(on: boolean): Promise<void> {
  await initDb();
  await run(
    `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Merchant', 'Delivery', ?, ?)` +
      ` ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
    [on ? '1' : '0', ''],
  );
}

/** Muat flag dari baris lokal (true bila tak ada baris = legacy lestari). */
async function loadDeliveryEnabledLocal(): Promise<boolean> {
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Merchant' AND key2 = 'Delivery' LIMIT 1`,
    );
    const raw = (row?.value1 ?? '').trim();
    if (!raw) return true;
    return raw !== '0';
  } catch {
    return true;
  }
}

/** Kupas field tipe dari payload profil (toleran dua bentuk envelope). */
function readMerchantTypeFromProfile(data: Record<string, unknown>): string {
  for (const key of ['merchantType', 'merchant_type', 'type']) {
    const direct = data[key];
    if (typeof direct === 'string' && direct.trim()) return direct;
  }
  for (const nest of ['merchant', 'branch', 'profile', 'data']) {
    const inner = data[nest];
    if (inner && typeof inner === 'object') {
      const rec = inner as Record<string, unknown>;
      for (const key of ['merchantType', 'merchant_type', 'type']) {
        const c = rec[key];
        if (typeof c === 'string' && c.trim()) return c;
      }
    }
  }
  return '';
}

/** Persist cache ke ms_setting(Merchant, Type). */
async function persistMerchantType(code: PosMerchantType): Promise<void> {
  await initDb();
  await run(
    `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Merchant', 'Type', ?, ?)` +
      ` ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
    [code, ''],
  );
}

/**
 * Sinkronisasi merchant-type: server dulu, lalu baris lokal, lalu fallback
 * RESTAURANT. Best-effort tanpa throw (cermin syncCurrencyFromProfile).
 */
export async function syncMerchantTypeFromProfile(): Promise<PosMerchantType> {
  // R1: baseline flag delivery dari baris lokal; server menimpa bila ada.
  cachedDeliveryEnabled = await loadDeliveryEnabledLocal();
  try {
    const r = await apiFetch('api/merchant/profile', { method: 'GET' });
    if (r.ok && !r.fromDummy) {
      const { data } = unwrap<Record<string, unknown>>(r.data);
      const flagRaw = readDeliveryEnabledFromProfile(data ?? {});
      if (flagRaw !== undefined) {
        const on = setCachedDeliveryEnabled(flagRaw);
        try {
          await persistDeliveryEnabled(on);
        } catch {
          /* persist gagal: cache tetap di-set */
        }
      }
      const raw = readMerchantTypeFromProfile(data ?? {});
      if (raw.trim()) {
        const code = normalizeMerchantType(raw);
        try {
          await persistMerchantType(code);
        } catch {
          /* persist gagal: cache tetap di-set */
        }
        cachedMerchantType = code;
        return cachedMerchantType;
      }
    }
  } catch {
    /* offline / BE belum ada: jatuh ke baris lokal */
  }
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Merchant' AND key2 = 'Type' LIMIT 1`,
    );
    const raw = (row?.value1 ?? '').trim();
    if (raw) {
      cachedMerchantType = normalizeMerchantType(raw);
      return cachedMerchantType;
    }
  } catch {
    /* DB gagal: jatuh ke fallback */
  }
  cachedMerchantType = 'RESTAURANT';
  return cachedMerchantType;
}

export function readMerchantTypeFromLoginBody(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const MERCHANT_KEYS = ['merchantType', 'merchant_type', 'merchanttype'];
  const b = body as Record<string, unknown>;
  for (const k of MERCHANT_KEYS) {
    const v = b[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const nested = [b['session'], b['merchant'], b['branch'], b['terminal']];
  for (const n of nested) {
    if (n && typeof n === 'object') {
      for (const k of MERCHANT_KEYS) {
        const v = (n as Record<string, unknown>)[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    }
  }
  return '';
}
