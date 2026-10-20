// Tripwire save-then-record (C7, SESI-C APP): kunci urutan tulis-DB-dulu
// (pola L1 PayScreen) di SEMUA layar bayar — recordSale-DULU = twin yatim
// bila saveSale gagal sesudah record (retry gandakan sale server):
//  1. QrisScreen + EdcScreen: NOL pola recordSale(x) sebelum try-saveSale;
//     tiap saveSale gagal non-unbound = fail-closed (pay_issue_fail + return,
//     TANPA Success palsu).
//  2. PayScreen referensi utuh: saveSale-dulu lalu recordSale (grup + single).
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  const pay = read('screens/payment/PayScreen.tsx');
  const payRaw = readRaw('screens/payment/PayScreen.tsx');
  const qris = read('screens/payment/QrisScreen.tsx');
  const qrisRaw = readRaw('screens/payment/QrisScreen.tsx');
  const edc = read('screens/payment/EdcScreen.tsx');

  // 1. NOL recordSale-sebelum-saveSale di QRIS/EDC (grup gInput + single input).
  for (const [name, src] of [['QrisScreen', qris], ['EdcScreen', edc]]) {
    ok(!/recordSale\((gInput|input)\);\s*\n\s*try\s*\{\s*\n?\s*await saveSale/.test(src),
      `C7: ${name} NOL recordSale-DULU (save-then-record wajib)`);
    ok(!/recordSale\((gInput|input)\); try \{ await saveSale/.test(src.replace(/\n/g, ' ')),
      `C7: ${name} NOL recordSale-DULU sebaris (save-then-record wajib)`);
    // Fail-closed: tiap catch saveSale non-unbound = alert + return.
    const catches = (src.match(/catch \(e\) \{/g) || []).length;
    const failClosed = (src.match(/pay_issue_fail/g) || []).length;
    ok(catches > 0 && failClosed >= 2,
      `C7: ${name} fail-closed pay_issue_fail di jalur grup+single (${failClosed}/${catches} catch)`);
  }
  // 2. Referensi PayScreen utuh.
  ok(/await saveSale\(gInput\);\s*\n\s*recordSale\(gInput\)/.test(pay),
    'C7: PayScreen grup save-then-record utuh');
  ok(/\}\s*\n\s*\/\/ L1: antre HANYA setelah tulis DB sukses/.test(qrisRaw) ||
    /recordSale\(input\);\s*\n\s*\} catch/.test(qris),
    'C7: QrisScreen single recordSale di dalam try sesudah saveSale');
  // NB: strip() membuang komentar baris — jangkar L1 dicek di sumber mentah.
  ok(/await saveSale\(input\);[\s\S]{0,1200}?\/\/ L1: antre HANYA setelah tulis DB sukses[^\n]*\n\s*recordSale\(input\);/.test(payRaw),
    'C7: PayScreen single save-then-record utuh');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
