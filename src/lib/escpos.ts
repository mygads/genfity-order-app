/**
 * Generator byte ESC/POS untuk struk thermal 58mm/80mm (32 kolom).
 * Murni TypeScript - tanpa dependensi native - sehingga bisa dipakai di
 * web (unduh .bin / kirim via Web Bluetooth BLE) maupun native.
 */

export interface EscItem {
  name: string;
  qty: number;
  price: number;
  /** Harga satuan (@ Rp) ala website showUnitPrice; absen = tak dirender
   * (byte-identik legacy). */
  unitPrice?: number;
  /** Catatan item (★ di website; `*` ASCII di thermal). APP-11: hanya diisi
   * bila template aktif + showItemNotes; legacy tak mengoper = tak tampil. */
  note?: string;
  /** Modifier/addon (nama + harga satuan). APP-11: hanya diisi bila template
   * aktif + showAddons; harga satuan tampil bila showAddonPrices. */
  addons?: { name: string; price: number }[];
}

export interface EscReceipt {
  shop: string;
  addr?: string;
  trx?: string;
  cashier?: string;
  /** 1:1 BE: baris tipe order + meja ("Dine In - Table 5") setelah trx.
   * Template-mode diisi pemanggil; legacy tak mengoper = tak dirender. */
  typeLine?: string;
  /** 1:1 BE: nama/telepon pelanggan sebagai baris tengah sendiri setelah
   * deliveryAddr (BE: setelah blok antar). Legacy tak mengoper. */
  customerName?: string;
  customerPhone?: string;
  datetime?: string;
  /** Kode currency cabang ('IDR'/'AUD') — S4: struk ikut format cabang
   * (default = perilaku IDR lama bila absen). */
  currency?: string;
  items: EscItem[];
  subtotal: number;
  discount?: number;
  /** Service charge eksklusif (Rp). Label default "Service 5%" (legacy);
   * pemanggil sadar-server mengisi serviceLabel dari serviceLabel() totals.ts
   * (audit trisisi #1: 'Service {r}%' / 'Service (tetap)' / '+ estimasi'). */
  service?: number;
  /** Label baris service untuk struk thermal; absen = 'Service 5%' legacy. */
  serviceLabel?: string;
  /** Tip/gratuity pelanggan (Rp) — terusan penuh, bukan komponen total berjalan. */
  tip?: number;
  /** PPN inklusif 11/111 - info-only, TIDAK menambah total. */
  tax?: number;
  /** Fee platform ESB/marketplace 5% (kontrak §5). */
  feeESB?: number;
  /** Biaya kemasan nominal (Rp utuh) — komponen bruto cermin ongkir. */
  packaging?: number;
  voucherCode?: string;
  voucherAmount?: number;
  ongkir?: number;
  /** Potongan ongkir voucher (Rp): dicetak sebagai baris "-Potongan Ongkir"
   * setelah baris Ongkir (bruto). Tanpa ini struk thermal tak menjumlah
   * (bruto + total-neto tak berimbang). */
  ongkirCut?: number;
  /** Pratinjau belum bayar: cetak penanda BELUM BAYAR di kepala struk. */
  unpaid?: boolean;
  /** Pembulatan ke Rp 100 (bisa negatif). */
  rounding?: number;
  /** Lebar kertas: 32 (58mm, default) atau 48 (80mm) kolom. */
  cols?: 32 | 48;
  /** Logo header monokrom (dibuat via scripts/png2mono.cjs). */
  logo?: EscMonoImage;
  /** Data QR yang dicetak di bawah struk (mis. nomor transaksi). */
  qr?: string;
  /** Potong kertas di akhir (R10): default true; false = tanpa GS V (printer
   *  label / station tanpa autocut). Diisi pemanggil dari station.autocut ??
   *  setelan global autocut. */
  cut?: boolean;
  /** Kontak header (telpon/email) dari template website (showPhone/showEmail).
   * Dirender di HEADER center ala BE (bukan footer). Absen = disembunyikan
   * (BE juga sembunyikan bila merchant tak punya nomor/email). */
  contact?: string;
  /** Catatan pesanan level order (showOrderNotes). Absen/kosong = tak dirender. */
  orderNote?: string;
  /** Nama kasir versi footer ala BE (showCashierName). `cashier` tetap header
   * (info meja/pelanggan); field ini footer. Absen = tak dirender. */
  cashierFooter?: string;
  /** Telpon footer ala website (showFooterPhone). Absen = tak dirender. */
  footerPhone?: string;
  /** APP-11: baris terima-kasih. undefined = 'Terima kasih' (legacy
   * BE-lama tanpa template); string kosong = sembunyikan (template
   * showThankYouMessage=false / default kanonik BE). */
  thanks?: string;
  /** APP-11: baris branding "Powered by Genfity" (template
   * showGenfityBranding). Absen = tak dirender (byte-identik legacy). */
  branding?: string;
  /** APP-11: sembunyikan baris Subtotal / TOTAL (template showSubtotal /
   * showTotal mati). Absen/false = tampil (byte-identik legacy). */
  hideSubtotal?: boolean;
  hideTotal?: boolean;
  total: number;
  method?: string;
  /** Tunai diterima (Rp). */
  paid?: number;
  /** Kembalian (Rp). */
  change?: number;
  footer?: string;
  /** Bahasa label 1:1 BE receiptLabels. Absen = legacy Indonesia byte-identik.
   * Pemanggil template SELALU mengoper (dari receiptLanguage). */
  lang?: 'id' | 'en';
  /** Alamat antar + instruksi (DELIVERY) 1:1 BE. Absen = tak dirender. */
  deliveryAddr?: string;
  /** Vertical Shell Fase 3: info jadwal/teknisi/DP jasa (1-2 baris pra-format,
   * label sudah Indonesia). Absen = tak dirender (byte-identik legacy). */
  serviceInfo?: string;
  /** Label diskon sumber voucher 1:1 BE DiscountLabel ("Diskon (CODE)").
   * Template-mode: pemanggil mengisi ini (bukan voucherCode) bila diskon>0. */
  discountLabel?: string;
  /** Baris info pra-format caller (label i18n sudah termasuk di string):
   * approval EDC, member, split. Absen = tak dirender. */
  approval?: string;
  member?: string;
  splitText?: string;
  /** Blok void (superset POS lokal): judul + rincian + alasan. */
  voidTitle?: string;
  voidLines?: { name: string; qty: number; price: number }[];
  voidReason?: string;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
export const ESC_COLS = 32;
/** 80mm ≈ 48 kolom font A. */
export const ESC_COLS_WIDE = 48;

/**
 * Bitmap monokrom untuk logo header: 1 bit/piksel, bit-1 = titik hitam,
 * MSB dulu per baris. Lihat scripts/png2mono.cjs untuk konverter PNG.
 */
export interface EscMonoImage {
  widthPx: number;
  heightPx: number;
  /** Byte bitmap, panjang = ceil(widthPx/8) * heightPx, dikode base64. */
  base64: string;
}

function ascii(s: string): number[] {
  // ESC/POS klasik = 1 byte/karakter; transliterasi sederhana ke ASCII.
  const map: Record<string, string> = {
    '×': 'x',
    '–': '-',
    '—': '-',
    '•': '-',
    '›': '>',
    '‹': '<',
    '✓': 'v',
    '✕': 'x',
    '★': '*',
    '☆': '*',
  };
  return [...s.normalize('NFKD').replace(/[̀-ͯ]/g, '')].map((c) => {
    const code = c.codePointAt(0) ?? 63;
    if (code < 128) return code;
    const rep = map[c] ?? '?';
    return rep.charCodeAt(0);
  });
}

function push(out: number[], ...bytes: number[]) {
  for (const b of bytes) out.push(b & 0xff);
}

function text(out: number[], s: string) {
  push(out, ...ascii(s), LF);
}

/** "Rp 45.000" ala Indonesia (tanpa Intl agar konsisten di semua platform). */
export function escRp(n: number): string {
  const neg = n < 0;
  const digits = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}Rp ${digits}`;
}

/**
 * Uang struk sadar-currency di samping escRp (escRp TAK diubah):
 * IDR (atau tak diketahui/asing) = perilaku escRp persis;
 * AUD = 'A$' + grouping koma + 2 desimal TANPA spasi (paritas dashboard FE
 * `A$10.50` + rp()/formatCurrency() S2).
 */
export function escMoney(n: number, currency?: string): string {
  if ((currency ?? '').trim().toUpperCase() === 'AUD') {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
    const neg = v < 0;
    const [int, dec] = Math.abs(v).toFixed(2).split('.');
    const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${neg ? '-' : ''}A$${grouped}.${dec}`;
  }
  return escRp(n);
}

function row2(out: number[], left: string, right: string, cols = ESC_COLS) {
  const l = [...left].slice(0, cols).join('');
  const r = [...right].slice(0, cols).join('');
  const space = Math.max(1, cols - l.length - r.length);
  text(out, `${l}${' '.repeat(space)}${r}`);
}

/** Decode base64 → byte (tanpa atob agar jalan di semua runtime).
 * R14: validasi ketat — karakter di luar alfabet base64 atau panjang yang
 * mustahil (sisa 1 char modulo 4) melempar, bukan dibersihkan diam-diam.
 * Pemanggil antrean (printqueue.bytesOfPayload) sudah try/catch → baris rusak
 * dilewati; pemanggil lain wajib memastikan input valid. */
export function fromBase64(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  if (/[^A-Za-z0-9+/=\s]/.test(b64)) {
    throw new Error('fromBase64: karakter bukan base64');
  }
  const clean = b64.replace(/\s/g, '');
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (clean.length % 4 === 1) {
    throw new Error('fromBase64: panjang base64 tak valid');
  }
  const out: number[] = [];
  for (let i = 0; i + 3 < clean.length + 3 && i < clean.length; i += 4) {
    const v = (c: string) => (c === '=' || c === undefined ? 0 : abc.indexOf(c));
    const n =
      (v(clean[i] as string) << 18) |
      (v(clean[i + 1] as string) << 12) |
      (v(clean[i + 2] as string) << 6) |
      v(clean[i + 3] as string);
    out.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  }
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Uint8Array.from(out.slice(0, out.length - pad));
}

/**
 * Perintah cetak bitmap `GS v 0` (raster normal), rata tengah.
 * BATASAN (R11): lebar dipotong ke 384 dot (58mm) / 576 dot (80mm) bila
 * kelebihan — piksel di luar batas DIBUANG, bukan diskala; logo > batas harus
 * dikecilkan dulu (scripts/png2mono.cjs). Baris pendek di-pad NOL (putih).
 */
export function buildRasterImageBytes(img: EscMonoImage, cols: number): Uint8Array {
  const maxDots = cols >= 48 ? 576 : 384;
  const w = Math.min(Math.max(8, Math.floor(img.widthPx)), maxDots);
  const h = Math.max(1, Math.floor(img.heightPx));
  const rowBytes = Math.ceil(w / 8);
  const src = fromBase64(img.base64);
  const srcRow = Math.max(1, Math.ceil(img.widthPx / 8));
  const out: number[] = [];
  push(out, ESC, 0x61, 1); // rata tengah
  push(out, GS, 0x76, 0x30, 0x00, rowBytes & 0xff, (rowBytes >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rowBytes; x++) {
      const sx = y * srcRow + x;
      out.push(sx < src.length ? (src[sx] as number) : 0);
    }
  }
  push(out, LF);
  return Uint8Array.from(out);
}

/**
 * Perintah QR Model 2 (`GS ( k`): pilih model → ukuran modul → koreksi
 * error M → simpan data → cetak. Rata tengah.
 * BATASAN (R12): data dipotong ke 512 byte agar muat di memori printer —
 * payload lebih panjang (mis. QR verbose) TERCETAK SEBAGIAN tanpa error;
 * pemanggil wajib menjaga payload tetap pendek (QR sale = client_id + no).
 */
export function buildQrBytes(data: string): Uint8Array {
  const raw = ascii(data).slice(0, 512);
  const out: number[] = [];
  const fn = (f: number, payload: number[]) => {
    const len = payload.length + 2;
    push(out, GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, f, ...payload);
  };
  push(out, ESC, 0x61, 1);
  fn(0x41, [0x32, 0x00]); // model 2
  fn(0x43, [0x06]); // modul 6 dot (terbaca di 58mm maupun 80mm)
  fn(0x45, [0x31]); // koreksi error M (15%)
  push(out, GS, 0x28, 0x6b, (raw.length + 3) & 0xff, ((raw.length + 3) >> 8) & 0xff, 0x31, 0x50, 0x30, ...raw);
  fn(0x51, [0x30]); // cetak
  push(out, LF);
  return Uint8Array.from(out);
}

/** Pecah teks panjang per kolom thermal (wrap sederhana + paragraf \n).
 * 1:1 BE SplitText: nama panjang dibungkus (bukan dipotong) untuk footer,
 * kontak, dan catatan. Baris item tetap row2 potong (kolom angka). */
function wrapCols(s: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of String(s ?? '').split('\n')) {
    const words = para.split(' ').filter((w) => w.length > 0);
    if (words.length === 0) {
      if (para.length === 0) continue;
      // Paragraf tanpa spasi: potong per cols.
      for (let i = 0; i < para.length; i += cols) out.push(para.slice(i, i + cols));
      continue;
    }
    let line = '';
    for (const w of words) {
      if (w.length > cols) {
        if (line) { out.push(line); line = ''; }
        for (let i = 0; i < w.length; i += cols) out.push(w.slice(i, i + cols));
        continue;
      }
      const cand = line ? `${line} ${w}` : w;
      if (cand.length > cols) { out.push(line); line = w; }
      else line = cand;
    }
    if (line) out.push(line);
  }
  return out;
}

/** Susun byte ESC/POS lengkap (termasuk inisialisasi + potong kertas).
 *
 * 1:1 BE (PDF/HTML/bridge buildBridgeReceiptLines):
 * - Urutan: Subtotal → Tax → Service → (Tip/PlatformFee superset) →
 *   Kemasan → Ongkir → Potongan-Ongkir → Diskon(+label) → Rounding → TOTAL →
 *   Payment/AmountPaid/Change → info (approval/member/split/void) →
 *   divider footer → kasir/thanks/custom/QR(+label)/brand.
 * - `lang` terisi (template-mode): label bilingual receiptLabels,
 *   qty "N x Nama", "@ Rp each/per item", split Payment/AmountPaid,
 *   prefix "Kasir:/Cashier:", label QR Track/Scan, divider header ganda,
 *   wrap nama panjang ala SplitText.
 * - `lang` absen (legacy): byte-identik perilaku lama (label Indonesia,
 *   "Nx", merge Bayar, tanpa label QR).
 */
export function buildReceiptBytes(r: EscReceipt): Uint8Array {
  const cols = r.cols === 48 ? ESC_COLS_WIDE : ESC_COLS;
  const out: number[] = [];
  const tpl = r.lang === 'id' || r.lang === 'en';
  const L = (id: string, en: string, legacy: string): string =>
    r.lang === 'en' ? en : r.lang === 'id' ? id : legacy;
  push(out, ESC, 0x40); // init
  if (r.logo) {
    // Logo header monokrom di paling atas (builder sudah rata tengah).
    for (const b of buildRasterImageBytes(r.logo, cols)) out.push(b);
  }
  push(out, ESC, 0x61, 1); // rata tengah
  push(out, GS, 0x21, 0x11); // judul 2x
  // APP-11: shop kosong = baris nama disembunyikan (template showMerchantName
  // mati); legacy selalu mengoper non-kosong sehingga byte-identik.
  if (r.shop) text(out, r.shop);
  push(out, GS, 0x21, 0x00); // ukuran normal
  if (r.addr) text(out, r.addr);
  // 1:1 BE: kontak header (telpon/email) center setelah alamat, sebelum trx.
  if (r.contact) {
    for (const line of wrapCols(r.contact, cols)) text(out, line);
  }
  // 1:1 BE: divider header antara blok merchant dan blok order. Legacy satu
  // divider sebelum item (kondisi di bawah dipertahankan).
  if (
    tpl &&
    (r.shop || r.addr || r.contact) &&
    (r.trx || r.typeLine || r.cashier || r.datetime || r.deliveryAddr || r.customerName || r.customerPhone || r.unpaid)
  ) {
    text(out, '-'.repeat(cols));
  }
  if (r.trx) text(out, r.trx);
  // 1:1 BE: tipe+meja setelah nomor order; pelanggan setelah blok antar.
  // Legacy hanya memakai cashier (zona digabung) — urutan legacy tak berubah.
  if (r.typeLine) text(out, r.typeLine);
  if (r.cashier) text(out, r.cashier);
  if (r.datetime) text(out, r.datetime);
  // 1:1 BE: blok alamat antar DELIVERY setelah datetime, sebelum divider item.
  if (r.deliveryAddr) {
    for (const line of wrapCols(r.deliveryAddr, cols)) text(out, line);
  }
  for (const line of wrapCols(r.customerName ?? '', cols)) text(out, line);
  for (const line of wrapCols(r.customerPhone ?? '', cols)) text(out, line);
  if (r.serviceInfo) {
    for (const line of wrapCols(r.serviceInfo, cols)) text(out, line);
  }
  if (r.unpaid) text(out, r.lang === 'en' ? '** UNPAID **' : '** BELUM BAYAR **');
  push(out, ESC, 0x61, 0); // rata kiri
  text(out, '-'.repeat(cols));
  // S4: semua nominal struk lewat escMoney(currency cabang) — escRp mentah
  // IDR-only dilarang di badan struk (residu PW-4).
  const money = (n: number): string => escMoney(n, r.currency);
  // Baris item: template-mode wrap nama panjang ala BE SplitText (harga di
  // kanan baris terakhir); legacy potong ala row2 byte-identik.
  const itemRow = (left: string, right: string) => {
    if (!tpl) {
      row2(out, left, right, cols);
      return;
    }
    if (!right) {
      for (const line of wrapCols(left, cols)) text(out, line);
      return;
    }
    const lines = wrapCols(left, cols);
    if (lines.length === 0) {
      row2(out, left, right, cols);
      return;
    }
    for (let idx = 0; idx < lines.length - 1; idx++) text(out, lines[idx] as string);
    const last = (lines[lines.length - 1] ?? '') as string;
    if (last.length + 1 + right.length <= cols) {
      row2(out, last, right, cols);
    } else {
      if (last) text(out, last);
      text(out, `${' '.repeat(Math.max(0, cols - right.length))}${right}`);
    }
  };
  // 1:1 BE: "2 x Mie" (spasi). Legacy "2x" byte-identik.
  const qtyName = (qty: number, name: string): string =>
    tpl ? `${qty} x ${name}` : `${qty}x ${name}`;
  const eachSuffix = r.lang === 'en' ? 'each' : r.lang === 'id' ? 'per item' : '';
  for (const i of r.items) {
    itemRow(qtyName(i.qty, i.name), money(i.qty * i.price));
    // 1:1 BE: "@ Rp 25.000 each/per item" (Unit = harga satuan terformat).
    if (typeof i.unitPrice === 'number') {
      text(out, `  @ ${money(i.unitPrice)}${eachSuffix ? ` ${eachSuffix}` : ''}`);
    }
    if (i.note) text(out, `  * ${i.note}`);
    for (const a of i.addons ?? []) {
      // Harga addon: kanan bila >0 (cermin kertas `+ nama Rp`), nama saja
      // bila 0 (showAddonPrices mati di pemanggil).
      if (a.price > 0) itemRow(`  + ${a.name}`, money(a.price * i.qty));
      else if (tpl) {
        for (const line of wrapCols(`  + ${a.name}`, cols)) text(out, line);
      } else text(out, `  + ${a.name}`);
    }
  }
  text(out, '-'.repeat(cols));
  // Urutan kanonik 1:1 BE (PDF/HTML/bridge buildBridgeReceiptLines):
  // Subtotal → Tax → Service → Packaging → Delivery → Discount → TOTAL →
  // Payment/Paid/Change. Superset POS/FE (tip/feeESB/voucher/ongkirCut/
  // rounding/unpaid) disisip tanpa mengubah urutan relatif baris BE:
  // Subtotal → Tax → Service → Tip → PlatformFee → Kemasan → (Voucher info
  // legacy) → Ongkir → Potongan-Ongkir → Diskon(+label) → Rounding → TOTAL.
  // Catatan order setelah divider item ala BE (sebelum payment).
  if (r.orderNote) {
    for (const line of wrapCols(`${L('Catatan pesanan: ', 'Order note: ', 'Catatan: ')}${r.orderNote}`, cols)) text(out, line);
    text(out, '-'.repeat(cols));
  }
  // APP-11: hideSubtotal/hideTotal = toggle website; legacy tak mengoper.
  // 1:1 BE: Diskon selalu setelah Delivery (bukan kedua) agar struk kasir
  // berurut sama dengan PDF/bridge; Tax tepat setelah Subtotal.
  if (!r.hideSubtotal) row2(out, 'Subtotal', money(r.subtotal), cols);
  if (r.tax) row2(out, L('Pajak', 'Tax', 'PPN (Inkl.)'), money(r.tax), cols);
  if (r.service) row2(out, r.serviceLabel ?? L('Biaya Layanan', 'Service Charge', 'Service 5%'), money(r.service), cols);
  if (r.tip) row2(out, 'Tip', `+${money(r.tip)}`, cols);
  if (r.feeESB) row2(out, L('Fee Layanan', 'Platform Fee', 'Fee Layanan'), money(r.feeESB), cols);
  if (r.packaging) row2(out, L('Biaya Kemasan', 'Packaging Fee', 'Kemasan'), money(r.packaging), cols);
  // 1:1 BE: voucher adalah DiscountLabel ("Diskon (CODE)"), bukan baris
  // ganda. Template-mode + diskon>0: kode ikut label diskon (pemanggil
  // mengisi discountLabel, tak mengoper voucherCode). Baris Voucher terpisah
  // hanya legacy / nominal tanpa diskon.
  if ((r.voucherCode || r.voucherAmount) && !r.discountLabel) {
    row2(out, `Voucher ${r.voucherCode ?? ''}`.trimEnd(), r.voucherAmount ? `-${money(r.voucherAmount)}` : '-', cols);
  }
  if (r.ongkir) row2(out, L('Biaya Pengantaran', 'Delivery Fee', 'Ongkir'), money(r.ongkir), cols);
  if (r.ongkirCut) row2(out, L('Potongan Ongkir', 'Delivery Discount', 'Potongan Ongkir'), `-${money(r.ongkirCut)}`, cols);
  if (r.discount) {
    const base = L('Diskon', 'Discount', 'Diskon');
    row2(out, r.discountLabel ? `${base} (${r.discountLabel})` : base, `-${money(r.discount)}`, cols);
  }
  if (r.rounding) row2(out, L('Pembulatan', 'Rounding', 'Pembulatan'), money(r.rounding), cols);
  // 1:1 BE bridge (buildBridgeReceiptLines): divider sebelum TOTAL bila TOTAL
  // tampil. Hanya mode template; legacy byte-identik tanpa divider.
  if (tpl && !r.hideTotal) text(out, '-'.repeat(cols));
  if (!r.hideTotal) {
    push(out, ESC, 0x45, 1); // tebal
    row2(out, 'TOTAL', money(r.total), cols);
    push(out, ESC, 0x45, 0);
  }
  // 1:1 BE: Payment dan AmountPaid baris terpisah. Legacy gabung byte-identik.
  if (tpl) {
    if (r.method) row2(out, L('Pembayaran', 'Payment', 'Bayar'), r.method, cols);
    if (r.paid) row2(out, L('Jumlah Dibayar', 'Amount Paid', 'Bayar'), money(r.paid), cols);
  } else if (r.method) {
    row2(out, 'Bayar', r.paid ? `${r.method} ${money(r.paid)}` : r.method, cols);
  }
  if (r.change) row2(out, L('Kembalian', 'Change', 'Kembali'), money(r.change), cols);
  // Superset POS lokal (jejak audit rantai bayar): approval/member/split/
  // void. Pra-format caller; kiri rata. Absen = tak dirender.
  if (r.approval) {
    for (const line of wrapCols(r.approval, cols)) text(out, line);
  }
  if (r.member) {
    for (const line of wrapCols(r.member, cols)) text(out, line);
  }
  if (r.splitText) {
    for (const line of wrapCols(r.splitText, cols)) text(out, line);
  }
  if (r.voidTitle || (r.voidLines && r.voidLines.length > 0) || r.voidReason) {
    if (r.voidTitle) text(out, r.voidTitle);
    for (const l of r.voidLines ?? []) {
      itemRow(qtyName(l.qty, l.name), `-${money(l.qty * l.price)}`);
    }
    if (r.voidReason) {
      for (const line of wrapCols(r.voidReason, cols)) text(out, line);
    }
  }
  // 1:1 BE: divider footer sebelum blok footer (kasir/thanks/custom/QR/brand).
  const hasFooter = Boolean(r.cashierFooter || r.thanks !== '' || r.footer || r.footerPhone || r.qr || r.branding);
  if (hasFooter) text(out, '-'.repeat(cols));
  push(out, ESC, 0x61, 1);
  // APP-11: thanks/branding dari template; default 'Terima kasih' menjaga
  // byte-identik legacy bila pemanggil tak mengoper thanks (arsip lama).
  // Mode template SELALU mengoper thanks eksplisit ('' bila toggle mati).
  // 1:1 BE: footer kasir berlabel ("Kasir: nama").
  if (r.cashierFooter) {
    const labeled = tpl ? `${L('Kasir', 'Cashier', '')}${L(': ', ': ', '')}${r.cashierFooter}` : r.cashierFooter;
    for (const line of wrapCols(labeled, cols)) text(out, line);
  }
  const thanks = r.thanks === undefined ? 'Terima kasih' : r.thanks;
  if (thanks) {
    for (const line of wrapCols(thanks, cols)) text(out, line);
  }
  if (r.footer) {
    for (const line of wrapCols(r.footer, cols)) text(out, line);
  }
  if (r.footerPhone) {
    for (const line of wrapCols(r.footerPhone, cols)) text(out, line);
  }
  if (r.qr) {
    // 1:1 BE: label Track order + QR tracking + Scan to track, sebelum brand.
    if (tpl) text(out, L('Lacak pesanan', 'Track order', ''));
    for (const b of buildQrBytes(r.qr)) out.push(b);
    if (tpl) text(out, L('Scan untuk lacak pesanan', 'Scan to track your order', ''));
  }
  if (r.branding) {
    for (const line of wrapCols(r.branding, cols)) text(out, line);
  }
  push(out, LF, LF, LF, LF);
  if (r.cut !== false) push(out, GS, 0x56, 0x00); // potong kertas
  return Uint8Array.from(out);
}

export interface EscKitchenTicket {
  station: string;
  no: string;
  /** Lebar kertas: 32 (58mm, default) atau 48 (80mm) kolom. */
  cols?: 32 | 48;
  /** Potong kertas di akhir (R10): default true; false = tanpa GS V. */
  cut?: boolean;
  table?: string;
  mode?: string;
  time?: string;
  cashier?: string;
  items: { name: string; qty: number; note?: string }[];
  /** 1:1 template dapur (KITCHEN_TICKET). Absen = tampil (legacy). */
  showTable?: boolean;
  showMode?: boolean;
  showTime?: boolean;
  showCashierName?: boolean;
  showItemNotes?: boolean;
  /** Catatan order (showOrderNotes). Absen/kosong = tak dirender. */
  orderNote?: string;
  /** Bahasa label 1:1 BE. Absen = legacy Indonesia byte-identik. */
  lang?: 'id' | 'en';
}

/** Tiket dapur/checker: tanpa harga (slip kerja), tetap potong. 1:1
 * template KITCHEN_TICKET: showTable/showMode/showTime/showCashierName/
 * showItemNotes/showOrderNotes digerbang pemanggil (print.ts) dari
 * KitchenTemplateJSON; legacy tak mengoper = semua tampil. */
export function buildKitchenTicketBytes(t: EscKitchenTicket): Uint8Array {
  const cols = t.cols === 48 ? ESC_COLS_WIDE : ESC_COLS;
  const out: number[] = [];
  push(out, ESC, 0x40);
  push(out, ESC, 0x61, 1);
  push(out, GS, 0x21, 0x11);
  text(out, t.station.toUpperCase());
  push(out, GS, 0x21, 0x00);
  push(out, ESC, 0x45, 1);
  text(out, t.no);
  push(out, ESC, 0x45, 0);
  if (t.table && t.showTable !== false) text(out, `Meja: ${t.table}`);
  if (t.mode && t.showMode !== false) text(out, t.mode);
  if (t.time && t.showTime !== false) text(out, t.time);
  if (t.cashier && t.showCashierName !== false) text(out, t.cashier);
  push(out, ESC, 0x61, 0);
  text(out, '-'.repeat(cols));
  const tpl = t.lang === 'id' || t.lang === 'en';
  for (const i of t.items) {
    push(out, ESC, 0x45, 1);
    // 1:1 BE "N x Nama" (template-mode); legacy "Nx" byte-identik.
    for (const line of wrapCols(tpl ? `${i.qty} x ${i.name}` : `${i.qty}x ${i.name}`, cols)) text(out, line);
    push(out, ESC, 0x45, 0);
    if (i.note && t.showItemNotes !== false) {
      for (const line of wrapCols(`  * ${i.note}`, cols)) text(out, line);
    }
  }
  if (t.orderNote) {
    text(out, '-'.repeat(cols));
    const prefix = t.lang === 'en' ? 'Order note: ' : t.lang === 'id' ? 'Catatan pesanan: ' : 'Catatan: ';
    for (const line of wrapCols(`${prefix}${t.orderNote}`, cols)) text(out, line);
  }
  text(out, '-'.repeat(cols));
  push(out, LF, LF, LF, LF);
  if (t.cut !== false) push(out, GS, 0x56, 0x00);
  return Uint8Array.from(out);
}

/**
 * Slip antrean pelanggan (APP-PRINTER, audit row 11): nomor antrean + cabang
 * + waktu (+ meja/mode opsional). SENGAJA tanpa harga/total/item — slip ini
 * untuk panggilan antrean, bukan struk bayar. Dipakai view_queue + printer
 * kasir saat mode antrean aktif.
 */
export interface EscQueueSlip {
  queueNo: string;
  branch: string;
  /** Lebar kertas: 32 (58mm, default) atau 48 (80mm) kolom. */
  cols?: 32 | 48;
  /** Potong kertas di akhir (R10): default true; false = tanpa GS V. */
  cut?: boolean;
  time?: string;
  table?: string;
  mode?: string;
  terminalCode?: string;
}

/** Byte ESC/POS slip antrean (tanpa harga, tetap potong kertas). */
export function buildQueueSlipBytes(q: EscQueueSlip): Uint8Array {
  const cols = q.cols === 48 ? ESC_COLS_WIDE : ESC_COLS;
  const out: number[] = [];
  push(out, ESC, 0x40);
  push(out, ESC, 0x61, 1);
  push(out, GS, 0x21, 0x11);
  text(out, 'ANTREAN');
  push(out, GS, 0x21, 0x00);
  push(out, ESC, 0x45, 1);
  text(out, q.queueNo);
  push(out, ESC, 0x45, 0);
  text(out, q.branch);
  if (q.time) text(out, q.time);
  if (q.table) text(out, `Meja: ${q.table}`);
  if (q.mode) text(out, q.mode);
  if (q.terminalCode) text(out, `Terminal: ${q.terminalCode}`);
  push(out, ESC, 0x61, 1);
  text(out, 'Mohon tunggu panggilan');
  push(out, LF, LF, LF, LF);
  if (q.cut !== false) push(out, GS, 0x56, 0x00);
  return Uint8Array.from(out);
}

/**
 * Byte tendangan laci kas standar ESC/POS: INIT + `ESC p m t1 t2`
 * (pin konektor 0, on 50ms, off 200ms). Sama persis dengan
 * DRAWER_KICK di GenfityPrinterModule.java - satu sumber kebenaran
 * dalam bentuk yang bisa diuji (`verify/check.drawer.cjs`).
 */
export const DRAWER_KICK_HEX = '1b401b700032c8';

export function buildDrawerKickBytes(): Uint8Array {
  return Uint8Array.from([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x32, 0xc8]);
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  // btoa tersedia di web & Hermes modern; fallback manual bila tidak ada.
  const g = globalThis as unknown as { btoa?: (s: string) => string };
  if (g.btoa) return g.btoa(s);
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i);
    const b = s.charCodeAt(i + 1);
    const c = s.charCodeAt(i + 2);
    const n = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    out +=
      abc[(n >> 18) & 63] +
      abc[(n >> 12) & 63] +
      (Number.isNaN(b) ? '=' : abc[(n >> 6) & 63]) +
      (Number.isNaN(c) ? '=' : abc[n & 63]);
  }
  return out;
}

/** Unduh byte sebagai file .bin (hanya web; no-op di native). */
export function downloadBin(bytes: Uint8Array, filename: string): boolean {
  try {
    const g = globalThis as unknown as { document?: Document; URL?: typeof URL };
    if (!g.document || !g.URL) return false;
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
    const url = g.URL.createObjectURL(blob);
    const a = g.document.createElement('a');
    a.href = url;
    a.download = filename;
    g.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => g.URL!.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kirim byte ke printer thermal via Web Bluetooth (profil BLE Nordic UART
 * 6E400001-… yang dipakai banyak printer thermal BLE). Hanya Chrome/
 * Edge + HTTPS/localhost. Melempar Error berbahasa Indonesia bila gagal.
 */
export async function sendOverWebBluetooth(bytes: Uint8Array): Promise<string> {
  const nav = globalThis as unknown as {
    navigator?: {
      bluetooth?: {
        requestDevice: (opts: unknown) => Promise<{
          gatt?: {
            connect: () => Promise<{
              getPrimaryService: (uuid: string) => Promise<{
                getCharacteristic: (uuid: string) => Promise<{
                  writeValue: (v: Uint8Array) => Promise<void>;
                }>;
              }>;
            }>;
          };
          name?: string;
        }>;
      };
    };
  };
  const bt = nav.navigator?.bluetooth;
  if (!bt) throw new Error('Browser ini tidak mendukung Web Bluetooth (pakai Chrome/Edge).');
  const device = await bt.requestDevice({
    filters: [{ services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] }],
    optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'],
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error('Gagal konek GATT ke printer.');
  const svc = await server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
  const chr = await svc.getCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e');
  // MTU BLE kecil - potong 100 byte per tulis.
  for (let i = 0; i < bytes.length; i += 100) {
    await chr.writeValue(bytes.slice(i, i + 100));
  }
  return device.name ?? 'printer';
}
