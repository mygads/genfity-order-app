// Tripwire RECAP-I18N: mengunci P4 (label umur jam-perangkat) + P5 (chip/label
// dinamis rekap & kasir) agar tak regresi ke hardcoded Indonesia.
// Kontrak yang dikunci (statik dari sumber; GAGAL bila perilaku dibalik):
//  (a) label umur stale display (QueueView/CustomerDisplay, dari Date.now())
//      via t('disp_age_s'/'disp_age_m') — NOL suffix mentah `${n}s`/`${n}m`.
//  (b) baris metode/mode rekap: count via t('unit_trx') — NOL '(N trx)'.
//  (c) NOL literal 'Kas bersih', 'terjual', 'Belum ada pembayaran.',
//      'Belum ada penjualan.' di RecapScreen (via rcp_net/rcp_sold/
//      rcp_no_pay/rcp_no_sales); fallback kategori SQL 'Lainnya' dipetakan
//      display via t('sync_kind_other').
//  (d) chip kategori kasir: label virtual 'Favorit' via t('cat_fav') — kunci
//      logika 'Favorit' tetap, hanya display yang diterjemahkan; NOL pola
//      `{c.name} ({catCount`.
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

  const recap = read('screens/shift/RecapScreen.tsx');
  const queue = read('screens/display/QueueViewScreen.tsx');
  const cust = read('screens/display/CustomerDisplayScreen.tsx');
  const cashier = read('screens/cashier/CashierScreen.tsx');
  const dict = readRaw('lib/i18n.ts');

  // ---- (a) label umur jam-perangkat via disp_age_* ----
  for (const [name, code] of [['QueueViewScreen', queue], ['CustomerDisplayScreen', cust]]) {
    ok(/t\('disp_age_s'\)\.replace\('\{n\}'/.test(code),
      `RI-a: ${name} umur-detik via t('disp_age_s') (strik; mutasi HARUS gagal)`);
    ok(/t\('disp_age_m'\)\.replace\('\{n\}'/.test(code),
      `RI-a: ${name} umur-menit via t('disp_age_m') (strik; mutasi HARUS gagal)`);
    ok(!/\$\{[^{}]*\}[sm]`/.test(code),
      `RI-a: ${name} NOL suffix mentah ` + '`${n}s`/`${n}m` di luar kamus');
  }
  ok(/disp_age_s: \{ id: '\{n\} dtk', en: '\{n\}s' \}/.test(dict),
    'RI-a: kunci disp_age_s berpasangan id/en lestari');
  ok(/disp_age_m: \{ id: '\{n\} mnt', en: '\{n\} min' \}/.test(dict),
    'RI-a: kunci disp_age_m berpasangan id/en lestari');

  // ---- (b) count (N trx) via unit_trx ----
  const trxHits = (recap.match(/\(\$\{[^}]*\} trx\)/g) || []).length;
  ok(trxHits === 0, `RI-b: NOL '(N trx)' mentah di RecapScreen (ketemu ${trxHits})`);
  ok(/t\('unit_trx'\)/.test(recap),
    'RI-b: RecapScreen memakai t(unit_trx) untuk count transaksi');

  // ---- (c) NOL literal rekap + mapping 'Lainnya' ----
  for (const lit of ['Kas bersih', 'terjual', 'Belum ada pembayaran.', 'Belum ada penjualan.']) {
    ok(!recap.includes(lit), `RI-c: NOL literal '${lit}' di RecapScreen`);
  }
  ok(/t\('rcp_net'\)\.replace\('\{n\}'/.test(recap),
    'RI-c: heroNet via t(rcp_net)');
  ok(recap.includes("t('rcp_no_pay')") && recap.includes("t('rcp_no_sales')") && recap.includes("t('rcp_sold')"),
    'RI-c: empty-state rekap via rcp_no_pay/rcp_no_sales/rcp_sold');
  ok(/r\.nama === 'Lainnya' \? t\('sync_kind_other'\)/.test(recap),
    'RI-c: fallback kategori SQL Lainnya dipetakan display via sync_kind_other');
  for (const k of ['rcp_net', 'rcp_no_pay', 'rcp_no_sales', 'rcp_sold']) {
    ok(new RegExp(`${k}: \\{ id: '[^']+', en: '[^']+' \\}`).test(dict),
      `RI-c: kunci ${k} berpasangan id/en lestari`);
  }

  // ---- (d) chip Favorit kasir via cat_fav (logika tak berubah) ----
  ok(/t\('cat_fav'\)/.test(cashier),
    'RI-d: chip kategori kasir memakai t(cat_fav) untuk label Favorit');
  ok(!/\{c\.name\} \(\{\s*catCount/.test(cashier),
    'RI-d: NOL pola `{c.name} ({catCount` mentah di chip kategori');
  ok(/c\.name === 'Favorit'/.test(cashier),
    'RI-d: kunci logika Favorit lestari (hanya display diterjemahkan)');
  ok(/cat_fav: \{ id: 'Favorit', en: 'Favorites' \}/.test(dict),
    'RI-d: kunci cat_fav berpasangan id/en lestari');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
