// Bukti byte struk baru: kolom 48, raster logo, QR, base64.
// node verify/check.receipt.cjs
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function assert(c, msg) {
  if (!c) throw new Error(`ASSERT: ${msg}`);
}

const ROOT = path.resolve(__dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-'));
const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
execSync(
  `node ${JSON.stringify(tscBin)} ${JSON.stringify(path.join(ROOT, 'src/lib/escpos.ts'))} --outDir ${JSON.stringify(outDir)} --module commonjs --target es2020 --skipLibCheck`,
  { cwd: outDir, stdio: 'pipe' },
);
const escpos = require(path.join(outDir, 'escpos.js'));

/** Decode byte ESC/POS jadi baris teks (byte ≥128 jadi '?', LF pemisah). */
function lines(bytes) {
  return Buffer.from(bytes).toString('latin1').split('\n').map((l) => l.replace(/[^\x20-\x7e]/g, ''));
}

const base = {
  shop: 'TOKO',
  items: [{ name: 'Kopi', qty: 2, price: 10000 }],
  subtotal: 20000,
  total: 20000,
};

// 1. Default 32 kolom.
const b32 = lines(escpos.buildReceiptBytes(base));
assert(b32.some((l) => l === '-'.repeat(32)), 'separator 32 hilang');
const total32 = b32.find((l) => l.includes('TOTAL'));
// Baris TOTAL diawali byte tebal ESC E (0x45='E' ikut terbaca) + 32 kolom.
assert(total32 && total32.length === 33, `baris TOTAL bukan 32: ${JSON.stringify(total32)}`);

// 2. Kertas 80mm = 48 kolom.
const b48 = lines(escpos.buildReceiptBytes({ ...base, cols: 48 }));
assert(b48.some((l) => l === '-'.repeat(48)), 'separator 48 hilang');
const total48 = b48.find((l) => l.includes('TOTAL'));
assert(total48 && total48.length === 49, `baris TOTAL bukan 48: ${JSON.stringify(total48)}`);

// 3. Raster logo: header GS v 0 + dimensi benar (16px × 2 baris → xL=2, yL=2).
const logo = { widthPx: 16, heightPx: 2, base64: escpos.toBase64(Uint8Array.from([0xff, 0x00, 0xaa, 0x55])) };
const rhex = escpos.toHex(escpos.buildRasterImageBytes(logo, 32));
assert(rhex.startsWith('1b61011d76300002000200'), `header raster salah: ${rhex.slice(0, 24)}`);
assert(rhex.endsWith('ff00aa550a'), `data raster salah: ${rhex.slice(-10)}`);

// 4. QR: urutan GS ( k lengkap (model → ukuran → EC → simpan → cetak).
const qhex = escpos.toHex(escpos.buildQrBytes('A'));
assert(qhex.includes('1d286b040031413200'), 'fn pilih model 2 hilang');
assert(qhex.includes('1d286b0300314306'), 'fn ukuran modul hilang');
assert(qhex.includes('1d286b0300314531'), 'fn koreksi error hilang');
assert(qhex.includes('1d286b040031503041'), 'fn simpan data hilang');
assert(qhex.includes('1d286b0300315130'), 'fn cetak hilang');

// 5. fromBase64 pulang-pergi dengan toBase64.
const raw = Uint8Array.from([0, 1, 2, 250, 255, 16, 32]);
assert(Buffer.from(escpos.fromBase64(escpos.toBase64(raw))).equals(Buffer.from(raw)), 'base64 tak round-trip');

// 6. Struk penuh: logo + QR + 48 kolom dalam satu byte.
const full = escpos.toHex(escpos.buildReceiptBytes({ ...base, cols: 48, logo, qr: 'TRX-1' }));
assert(full.includes('1d763000'), 'logo tak ikut tercetak');
assert(full.includes('1d286b0300315130'), 'QR tak ikut tercetak');
// Tanpa logo/QR byte harus lebih pendek.
const plain = escpos.toHex(escpos.buildReceiptBytes({ ...base, cols: 48 }));
assert(full.length > plain.length, 'logo/QR tak menambah byte');

// 7. Tiket dapur ikut lebar kertas.
// Separator didahului perintah rata-kiri ESC a (0x61='a' ikut terbaca).
const kt = lines(escpos.buildKitchenTicketBytes({ station: 'DAPUR', no: 'A-1', cols: 48, items: [{ name: 'Mie', qty: 1 }] }));
assert(kt.some((l) => l.endsWith('-'.repeat(48))), 'separator tiket 48 hilang');

// 8. Konverter PNG→mono: rakit PNG 8x8 RGB (kiri hitam, kanan putih), uji script.
const zlib = require('zlib');
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
const PW = 8;
const PH = 8;
const prows = [];
for (let y = 0; y < PH; y++) {
  const row = Buffer.alloc(1 + PW * 3, 0);
  for (let x = 0; x < PW; x++) {
    const v = x < 4 ? 0 : 255;
    row[1 + x * 3] = v;
    row[1 + x * 3 + 1] = v;
    row[1 + x * 3 + 2] = v;
  }
  prows.push(row);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(PW, 0);
ihdr.writeUInt32BE(PH, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', zlib.deflateSync(Buffer.concat(prows))),
  pngChunk('IEND', Buffer.alloc(0)),
]);
const pngPath = path.join(outDir, 't.png');
fs.writeFileSync(pngPath, png);
const monoOut = execSync(
  `node ${JSON.stringify(path.join(ROOT, 'scripts/png2mono.cjs'))} ${JSON.stringify(pngPath)} 384 128`,
  { encoding: 'utf8' },
);
const img = JSON.parse(monoOut);
assert(img.widthPx === 8 && img.heightPx === 8, `dimensi mono salah: ${monoOut}`);
const bits = Buffer.from(img.base64, 'base64');
assert(bits.length === 8 && bits.every((b) => b === 0xf0), `pola mono salah: ${bits.toString('hex')}`);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('RECEIPT_OK 32/48 + raster + QR + base64 + png2mono');
