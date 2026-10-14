/**
 * Generator byte ESC/POS untuk struk thermal 58mm/80mm (32 kolom).
 * Murni TypeScript — tanpa dependensi native — sehingga bisa dipakai di
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
  items: EscItem[];
  subtotal: number;
  discount?: number;
  service?: number;
  total: number;
  method?: string;
  footer?: string;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
export const ESC_COLS = 32;

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

/** Susun byte ESC/POS lengkap (termasuk inisialisasi + potong kertas). */
export function buildReceiptBytes(r: EscReceipt): Uint8Array {
  const out: number[] = [];
  push(out, ESC, 0x40); // init
  push(out, ESC, 0x61, 1); // rata tengah
  push(out, GS, 0x21, 0x11); // judul 2x
  text(out, r.shop);
  push(out, GS, 0x21, 0x00); // ukuran normal
  if (r.addr) text(out, r.addr);
  if (r.trx) text(out, r.trx);
  if (r.cashier) text(out, r.cashier);
  push(out, ESC, 0x61, 0); // rata kiri
  text(out, '-'.repeat(ESC_COLS));
  for (const i of r.items) {
    row2(out, `${i.qty}x ${i.name}`, escRp(i.qty * i.price));
  }
  text(out, '-'.repeat(ESC_COLS));
  row2(out, 'Subtotal', escRp(r.subtotal));
  if (r.discount) row2(out, 'Diskon', `-${escRp(r.discount).replace('Rp ', 'Rp ')}`);
  if (r.service) row2(out, 'Service 5%', escRp(r.service));
  push(out, ESC, 0x45, 1); // tebal
  row2(out, 'TOTAL', escRp(r.total));
  push(out, ESC, 0x45, 0);
  if (r.method) row2(out, 'Bayar', r.method);
  push(out, ESC, 0x61, 1);
  text(out, r.footer ?? 'Terima kasih');
  push(out, LF, LF, LF, LF);
  push(out, GS, 0x56, 0x00); // potong kertas
  return Uint8Array.from(out);
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
  // MTU BLE kecil — potong 100 byte per tulis.
  for (let i = 0; i < bytes.length; i += 100) {
    await chr.writeValue(bytes.slice(i, i + 100));
  }
  return device.name ?? 'printer';
}
