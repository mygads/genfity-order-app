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
