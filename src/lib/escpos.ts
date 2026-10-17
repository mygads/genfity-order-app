/**
 * Generator byte ESC/POS untuk struk thermal 58mm/80mm (32 kolom).
 * Murni TypeScript - tanpa dependensi native - sehingga bisa dipakai di
 * web (unduh .bin / kirim via Web Bluetooth BLE) maupun native.
 */

export interface EscItem {
  name: string;
  qty: number;
  price: number;
}

export interface EscReceipt {
  shop: string;
  addr?: string;
  trx?: string;
  cashier?: string;
  datetime?: string;
  items: EscItem[];
  subtotal: number;
  discount?: number;
  /** Service charge eksklusif (Rp). Label cetak "Service 5%". */
  service?: number;
  /** PPN inklusif 11/111 - info-only, TIDAK menambah total. */
  tax?: number;
  /** Fee platform ESB/marketplace 5% (kontrak §5). */
  feeESB?: number;
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
  total: number;
  method?: string;
  /** Tunai diterima (Rp). */
  paid?: number;
  /** Kembalian (Rp). */
  change?: number;
  footer?: string;
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

/** Susun byte ESC/POS lengkap (termasuk inisialisasi + potong kertas). */
export function buildReceiptBytes(r: EscReceipt): Uint8Array {
  const cols = r.cols === 48 ? ESC_COLS_WIDE : ESC_COLS;
  const out: number[] = [];
  push(out, ESC, 0x40); // init
  if (r.logo) {
    // Logo header monokrom di paling atas (builder sudah rata tengah).
    for (const b of buildRasterImageBytes(r.logo, cols)) out.push(b);
  }
  push(out, ESC, 0x61, 1); // rata tengah
  push(out, GS, 0x21, 0x11); // judul 2x
  text(out, r.shop);
  push(out, GS, 0x21, 0x00); // ukuran normal
  if (r.addr) text(out, r.addr);
  if (r.trx) text(out, r.trx);
  if (r.cashier) text(out, r.cashier);
  if (r.datetime) text(out, r.datetime);
  if (r.unpaid) text(out, '** BELUM BAYAR **');
  push(out, ESC, 0x61, 0); // rata kiri
  text(out, '-'.repeat(cols));
  for (const i of r.items) {
    row2(out, `${i.qty}x ${i.name}`, escRp(i.qty * i.price), cols);
  }
  text(out, '-'.repeat(cols));
  // Urutan ala POSLite = rumus kanonik totals.ts: subtotal(net) → service
  // eksklusif → PPN info-only → feeESB → voucher → ongkir → rounding → total.
  row2(out, 'Subtotal', escRp(r.subtotal), cols);
  if (r.discount) row2(out, 'Diskon', `-${escRp(r.discount)}`, cols);
  if (r.service) row2(out, 'Service 5%', escRp(r.service), cols);
  if (r.tax) row2(out, 'PPN (Inkl.)', escRp(r.tax), cols);
  if (r.feeESB) row2(out, 'Fee Layanan', escRp(r.feeESB), cols);
  if (r.voucherCode || r.voucherAmount) {
    row2(out, `Voucher ${r.voucherCode ?? ''}`.trimEnd(), r.voucherAmount ? `-${escRp(r.voucherAmount)}` : '-', cols);
  }
  if (r.ongkir) row2(out, 'Ongkir', escRp(r.ongkir), cols);
  if (r.ongkirCut) row2(out, 'Potongan Ongkir', `-${escRp(r.ongkirCut)}`, cols);
  if (r.rounding) row2(out, 'Pembulatan', escRp(r.rounding), cols);
  push(out, ESC, 0x45, 1); // tebal
  row2(out, 'TOTAL', escRp(r.total), cols);
  push(out, ESC, 0x45, 0);
  if (r.method) row2(out, 'Bayar', r.paid ? `${r.method} ${escRp(r.paid)}` : r.method, cols);
  if (r.change) row2(out, 'Kembali', escRp(r.change), cols);
  if (r.qr) {
    // QR di bawah rincian bayar, sebelum footer (ala POSLite).
    for (const b of buildQrBytes(r.qr)) out.push(b);
  }
  push(out, ESC, 0x61, 1);
  text(out, r.footer ?? 'Terima kasih');
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
}

/** Tiket dapur/checker: tanpa harga (opsional total estimasi), tanpa potong? tetap potong. */
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
  if (t.table) text(out, `Meja: ${t.table}`);
  if (t.mode) text(out, t.mode);
  if (t.time) text(out, t.time);
  if (t.cashier) text(out, t.cashier);
  push(out, ESC, 0x61, 0);
  text(out, '-'.repeat(cols));
  for (const i of t.items) {
    push(out, ESC, 0x45, 1);
    text(out, `${i.qty}x ${i.name}`);
    push(out, ESC, 0x45, 0);
    if (i.note) text(out, `  * ${i.note}`);
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
