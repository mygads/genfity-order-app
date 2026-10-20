// Tripwire printer (S10/PP-015): fixture + mock loopback + plug-last honesty.
// Dicek TANPA hardware/dev-client:
//  A. RUNTIME NYATA: escpos.ts asli (tanpa import — murni) ditranspile via
//     `typescript` dan builder-nya dijalankan di node atas fixture
//     test/fixtures/escpos-golden.json — byte diklaim dari kode produksi,
//     bukan duplikat logika.
//  B. PIN STATIK: transport loopback ditangani SEBELUM cek modul native
//     (jalan di Expo Go/web), jurnal disalin dua arah + dibatasi, antrean
//     (printqueue.envelopeOf) menerima target loopback, dan peringatan
//     "bukan bukti kertas keluar" tetap ada (anti-J-trap cetak-palsu).
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

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

const hexOf = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const textOf = (bytes) => Buffer.from(bytes).toString('latin1');

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // ---- A. Runtime: builder asli atas fixture ----
  const esc = loadTs('src/lib/escpos.ts');
  ok(typeof esc.buildReceiptBytes === 'function', 'escpos: buildReceiptBytes ada (runtime)');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'escpos-golden.json'), 'utf8'));

  const checkBytes = (bytes, tag, exp) => {
    const hex = hexOf(bytes);
    const text = textOf(bytes);
    if (exp.startsWith) ok(hex.startsWith(exp.startsWith), `${tag}: diawali ${exp.startsWith} (ESC @)`);
    if (exp.endsWith) ok(hex.endsWith(exp.endsWith), `${tag}: diakhiri ${exp.endsWith} (GS V potong)`);
    if (exp.notEndsWith) ok(!hex.endsWith(exp.notEndsWith), `${tag}: TIDAK diakhiri ${exp.notEndsWith} (cut=false)`);
    for (const t of exp.containsText || []) ok(text.includes(t), `${tag}: memuat teks "${t}"`);
    for (const t of exp.notContainsText || []) ok(!text.includes(t), `${tag}: bebas teks "${t}"`);
    for (const h of exp.notContainsHex || []) ok(!hex.includes(h), `${tag}: bebas byte ${h}`);
  };

  checkBytes(esc.buildReceiptBytes(fixture.receiptIDR.input), 'struk-IDR', fixture.receiptIDR.expect);
  checkBytes(esc.buildReceiptBytes(fixture.receiptAUD.input), 'struk-AUD', fixture.receiptAUD.expect);
  checkBytes(esc.buildReceiptBytes(fixture.receiptNoCut.input), 'struk-nocut', fixture.receiptNoCut.expect);
  checkBytes(esc.buildKitchenTicketBytes(fixture.kitchen.input), 'tiket-dapur', fixture.kitchen.expect);

  // Jalur payload antrean: base64 bolak-balik = byte identik (R14 ketat).
  const sample = esc.buildReceiptBytes(fixture.receiptIDR.input);
  const rt = esc.fromBase64(esc.toBase64(sample));
  ok(rt.length === sample.length && rt.every((b, i) => b === sample[i]), 'antrean: toBase64→fromBase64 identik');

  // Drawer-kick kanonis tak berubah diam-diam.
  ok(esc.toHex(esc.buildDrawerKickBytes()) === esc.DRAWER_KICK_HEX, 'drawer: kick bytes = DRAWER_KICK_HEX');

  // ---- B. Pin statik loopback + antrean + honesty ----
  const printer = readRaw('native/printer.ts');
  ok(/PrinterTransport = [^;]*'loopback'/.test(printer), 'printer: PrinterTransport memuat loopback');
  const body = (printer.match(/export async function printBytes[\s\S]*?\n\}/) || [''])[0];
  const loopIdx = body.indexOf("target.transport === 'loopback'");
  const nativeIdx = body.indexOf('const n = native()');
  ok(loopIdx !== -1 && nativeIdx !== -1 && loopIdx < nativeIdx,
    'printer: loopback ditangani SEBELUM cek modul native (jalan Expo Go/web)');
  ok(/Array\.from\(data\)/.test(body), 'printer: jurnal menyalin byte (bukan referensi)');
  ok(/LOOPBACK_CAP/.test(printer) && /\.shift\(\)/.test(printer), 'printer: jurnal dibatasi (entri tertua dibuang)');
  ok(/export function getLoopbackJournal/.test(printer) && /\[\.\.\.e\.bytes\]/.test(printer),
    'printer: getLoopbackJournal menyalin saat baca');
  ok(/export function clearLoopbackJournal/.test(printer), 'printer: clearLoopbackJournal ada');
  ok(/BUKAN BUKTI KERTAS KELUAR/.test(printer), 'printer: peringatan jujur loopback ≠ kertas keluar');
  const queue = readRaw('lib/printqueue.ts');
  ok(/t\.transport === 'loopback'/.test(queue), 'printqueue: envelopeOf menerima target loopback');

  // ---- C. C10: drain ikut test-print sukses + reconnect (resolver kind-aware milik main) ----
  const ps = readRaw('screens/settings/PrintersScreen.tsx');
  const testBody = (ps.match(/const testPrintStation[\s\S]*?\n  \};/) || [''])[0];
  ok(/drainPrintQueue/.test(testBody), 'c10: testPrintStation memicu drainPrintQueue');
  ok(/if \(res\.ok\)[\s\S]*drainPrintQueue\(/.test(testBody),
    'c10: drain test-print HANYA saat res.ok (uji gagal tak menguras)');
  ok(/\.catch\(/.test(testBody), 'c10: drain test-print best-effort (catch, tak lempar)');
  const rtc = readRaw('lib/realtime.ts');
  const openBody = (rtc.match(/ch\.ws\.onopen = \(\) => \{[\s\S]*?\n  \};/) || [''])[0];
  ok(/drainPrintQueue/.test(openBody), 'c10: reconnect worker memicu drainPrintQueue');
  ok(/require\('\.\/printqueue'\)/.test(openBody),
    'c10: reconnect drain lazy-require (nol tepi statis baru)');
  ok(/if \(reconnected\)[\s\S]*drainPrintQueue\(/.test(openBody),
    'c10: drain reconnect HANYA saat reconnect (connect pertama tak memicu)');
  const syncScr = readRaw('screens/settings/SyncScreen.tsx');
  ok(/pendingPrintCount/.test(syncScr), 'c10: pendingPrintCount tetap tampil (badge backlog lestari)');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  for (const f of r.failures) console.log('FAIL ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
