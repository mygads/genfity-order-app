// Tripwire GAP-C (audit 2026-11-01): opname nama sadar-tipe.
// Kunci statik: matchDraftItem menangkan MENU, skip non-MENU senama
// (tanpa submit-buta lintas tipe), StockScreen jujur menu-only.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (p) => strip(fs.readFileSync(path.join(SRC, p), 'utf8'));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  const sc = read('lib/stockCountSync.ts');
  ok(/export function matchDraftItem/.test(sc),
    'GAP-C: matchDraftItem diekspor (murni, terkunci tripwire)');
  ok(/MENU/.test(sc) && !/byName/.test(sc),
    'GAP-C: pencocokan menangkan tipe MENU (tanpa first-wins lintas tipe)');
  ok(/matchDraftItem\(draft\.data/.test(sc),
    'GAP-C: pushStockCount memakai pencocokan sadar-tipe');

  const scr = read('screens/settings/StockScreen.tsx');
  ok(/stock\.opname_menu_only/.test(scr),
    'GAP-C: StockScreen jujur menu-only di UI');

  const i18n = read('lib/i18n.ts');
  ok(/stock_opname_menu_only/.test(i18n),
    'GAP-C: kunci i18n opname menu-only (id+en) ada');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(JSON.stringify(r));
  process.exit(r.failures.length ? 1 : 0);
}
