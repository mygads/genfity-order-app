// Tripwire 1:1 BE-FE-POS putaran 3: loopback byte ESC/POS asli + pin statik layar.
// A. RUNTIME: buildReceiptBytes/buildRasterImageBytes/buildQrBytes asli
//    (ditranspile dari src, tanpa duplikat logika) atas payload template-mode:
//    - tiap run teks murni <= cols (32 utk 58mm, 48 utk 80mm)
//    - "2 x Mie" berspasi + suffix each (tpl) vs "2x" legacy
//    - QR = blok GS ( k, logo = raster GS v 0 terpotong 384/576 dot
// B. STATIK: layar preview 1:1 (mono, 200/280, divider hitam, QR beneran,
//    cols dari template).
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const readSrc = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function loadTs(relPath) {
  const ts = require('typescript');
  const full = path.join(ROOT, relPath);
  const src = fs.readFileSync(full, 'utf8');
  if (/^\s*import\s/m.test(src)) throw new Error(`${relPath} punya import — tak bisa dimuat node polos`);
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(full, module);
  m.filename = full;
  m.paths = Module._nodeModulePaths(path.dirname(full));
  m._compile(out, full);
  return m.exports;
}

const hexOf = (b) => Buffer.from(b).toString('hex');
// Run teks murni: blok biner (raster/QR) dipotong dulu.
function textRuns(bytes) {
  const hex = hexOf(bytes);
  let cut = hex.indexOf('1d286b'); // GS ( k = awal blok QR
  const pre = cut < 0 ? hex : hex.slice(0, cut);
  const buf = Buffer.from(pre, 'hex');
  const runs = [];
  let cur = '';
  for (const byte of buf) {
    if (byte >= 0x20 && byte <= 0x7e) cur += String.fromCharCode(byte);
    else { if (cur) runs.push(cur); cur = ''; }
  }
  if (cur) runs.push(cur);
  return runs.filter((s) => s.trim().length > 1);
}

function tplPayload(cols, lang) {
  return {
    shop: 'WARUNG CONTOH', addr: 'Jl. Contoh 1', contact: '08123456789',
    trx: 'Order #7', typeLine: 'Dine In', datetime: '2026-11-01 10:00',
    currency: 'IDR', cols,
    items: [{ name: 'Mie Goreng', qty: 2, price: 25000, unitPrice: 25000, note: 'Pedas',
      addons: [{ name: 'Telur', price: 5000 }] }],
    subtotal: 50000, discount: 0, discountLabel: '', total: 60000,
    method: 'Cash', lang, thanks: 'Terima kasih',
    cashierFooter: 'Kasir1', qr: 'SALE|waco|7|60000', branding: 'Powered by Genfity',
  };
}

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => { checks++; if (!cond) failures.push(name); };

  const esc = loadTs('src/lib/escpos.ts');
  ok(typeof esc.buildReceiptBytes === 'function', 'escpos: builder runtime termuat');

  // ---- 80mm tpl EN ----
  const b48 = esc.buildReceiptBytes(tplPayload(48, 'en'));
  const hex48 = hexOf(b48);
  const runs48 = textRuns(b48);
  ok(runs48.length > 10, `80mm: cukup baris teks (${runs48.length})`);
  ok(runs48.every((s) => s.length <= 48), '80mm: tiap run teks <= 48 kolom');
  const t48 = runs48.join('\n');
  ok(t48.includes('2 x Mie'), '80mm tpl: qty berspasi "2 x Mie"');
  ok(t48.includes('each'), '80mm tpl: suffix each');
  ok(t48.includes('Cashier: Kasir1'), '80mm tpl: label footer kasir');
  ok(t48.includes('Track order'), '80mm tpl: label QR');
  ok(hex48.startsWith('1b40'), '80mm: diawali ESC @');
  ok(hex48.includes('1d286b'), '80mm: blok QR GS ( k ada');
  ok(hex48.endsWith('1d5600'), '80mm: diakhiri GS V potong');

  // ---- 58mm tpl ID ----
  const b32 = esc.buildReceiptBytes(tplPayload(32, 'id'));
  const runs32 = textRuns(b32);
  ok(runs32.every((s) => s.length <= 32), '58mm: tiap run teks <= 32 kolom');
  const t32 = runs32.join('\n');
  ok(t32.includes('2 x Mie'), '58mm tpl: qty berspasi');
  ok(t32.includes('per item'), '58mm tpl: suffix per item');
  ok(!hexOf(b32).includes('1d286b') === false, '58mm: QR tetap dicetak');

  // ---- legacy byte-identik ----
  const legacy = { shop: 'WARUNG', items: [{ name: 'Mie Goreng', qty: 2, price: 25000 }], subtotal: 50000, total: 50000, method: 'Cash' };
  const tleg = textRuns(esc.buildReceiptBytes(legacy)).join('\n');
  ok(tleg.includes('2x Mie'), 'legacy: "2x" tanpa spasi (byte-identik)');
  ok(!tleg.includes('each'), 'legacy: tanpa suffix each');

  // ---- nama panjang wrap 1:1 SplitText (bukan potong) ----
  const longName = 'Nasi Goreng Spesial Extra Pedas Manis Dengan Kerupuk Udang Besar Sekali';
  const bw = esc.buildReceiptBytes({ ...tplPayload(32, 'en'), items: [{ name: longName, qty: 1, price: 30000 }], subtotal: 30000, total: 30000 });
  const tw = textRuns(bw).join('\n');
  ok(tw.includes('Kerupuk'), 'wrap: nama panjang tidak terpotong');
  ok(textRuns(bw).every((s) => s.length <= 32), 'wrap: tiap baris wrap <= 32');

  // ---- raster logo clip 384/576 dot ----
  const big = { widthPx: 800, heightPx: 10, base64: Buffer.alloc(1000, 255).toString('base64') };
  const r48 = Buffer.from(esc.buildRasterImageBytes(big, 48));
  ok(r48[7] === 0x48 && r48[8] === 0x00, 'raster 80mm: rowBytes 72 (576 dot clip)');
  const r32 = Buffer.from(esc.buildRasterImageBytes(big, 32));
  ok(r32[7] === 0x30 && r32[8] === 0x00, 'raster 58mm: rowBytes 48 (384 dot clip)');

  // ---- B. pin statik layar ----
  const rs = readSrc('src/screens/bill/ReceiptScreen.tsx');
  const bp = readSrc('src/screens/bill/BillPreviewScreen.tsx');
  ok(rs.includes("fontFamily: 'monospace'"), 'ReceiptScreen: font mono kertas');
  ok(rs.includes('maxWidth: 200') && rs.includes('maxWidth: 280'), 'ReceiptScreen: lebar 200/280');
  ok(rs.includes("borderTopColor: '#000'"), 'ReceiptScreen: divider hitam');
  ok(rs.includes('paperColsForSize(tplEff.paperSize)'), 'ReceiptScreen: cols dari template');
  ok(rs.includes("from 'react-native-qrcode-svg'") && rs.includes('<QRCode'), 'ReceiptScreen: QR beneran');
  ok(bp.includes('maxWidth: 200') && bp.includes('maxWidth: 280'), 'BillPreview: lebar 200/280');
  ok(bp.includes("fontFamily: 'monospace'"), 'BillPreview: font mono kertas');
  ok(bp.includes("borderTopColor: '#000'"), 'BillPreview: divider hitam');
  ok(!rs.includes('wideCenterSm') && !bp.includes('wideCenterSm'), 'kertas tak lagi pakai 560');

  return { failures, checks };
}

module.exports = { run };
