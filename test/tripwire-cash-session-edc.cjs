// Tripwire GAP-D (audit 2026-11-01): paritas pemilih sesi kas lane EDC/QRIS.
// settleMirror helper WAJIB meneruskan SELECTION ke pemanggil
// (onSelectionRequired); EdcScreen membuka CashSessionSheet + retry idempoten.
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

  const mir = read('lib/settleMirror.ts');
  ok(/onSelectionRequired/.test(mir) && /isSelectionRequiredCodeW2/.test(mir),
    'GAP-D: settleMirror teruskan SELECTION ke pemanggil');

  const edc = read('screens/payment/EdcScreen.tsx');
  ok(/CashSessionSheet/.test(edc) && /sessSheetOpen/.test(edc),
    'GAP-D: EdcScreen render pemilih sesi kas');
  ok(/onSelectionRequired/.test(edc), 'GAP-D: EdcScreen pasang hook seleksi');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(JSON.stringify(r));
  process.exit(r.failures.length ? 1 : 0);
}
