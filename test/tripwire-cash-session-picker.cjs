// Tripwire GAP-A (audit 2026-11-01): SELECTION_REQUIRED tak boleh buntu di
// perangkat kasir-only. Kunci statik: pemilih sesi di perangkat ada
// (CashSessionSheet), PayScreen membuka sheet + retry idempoten saat
// SELECTION, pesan "FE Laci kas" bukan satu-satunya jalan.
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

  const sheet = read('components/CashSessionSheet.tsx');
  ok(/listOpenCashSessionsBe/.test(sheet) && /chooseCashSessionId/.test(sheet),
    'GAP-A: CashSessionSheet daftar sesi OPEN + adopsi pilihan');
  ok(/onPicked/.test(sheet), 'GAP-A: CashSessionSheet memicu retry via onPicked');

  const pay = read('screens/payment/PayScreen.tsx');
  ok(/CashSessionSheet/.test(pay) && /sessSheetOpen/.test(pay),
    'GAP-A: PayScreen merender pemilih sesi kas');
  ok(/isSelectionRequiredCodeW2/.test(pay),
    'GAP-A: PayScreen mendeteksi SELECTION (bukan antre-buta)');
  ok(/sessRetryRef/.test(pay) && /idempotencyKey: r\.clientId/.test(pay),
    'GAP-A: retry sesi memakai clientId SAMA (idempoten server)');

  const i18n = read('lib/i18n.ts');
  ok(/cashsess_title/.test(i18n) && /cashsess_hint/.test(i18n),
    'GAP-A: kunci i18n pemilih sesi (id+en) ada');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(JSON.stringify(r));
  process.exit(r.failures.length ? 1 : 0);
}
