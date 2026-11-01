// Tripwire GAP-E (audit 2026-11-01): diskon per-item >20% WAJIB eskalasi PIN
// owner (anti-fraud kasir). requiresDiscountPin tak boleh yatim: CashierScreen
// menggerbang via SupervisorApprovalDialog + kunci akses 'order.discount'
// fail-closed (seed deny Staff, Owner wildcard-allow).
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

  const acc = read('lib/access.ts');
  ok(/'order\.discount'/.test(acc), 'GAP-E: kunci order.discount dikenal');
  ok(/SENSITIVE_KEYS[\s\S]*?'order\.discount'/.test(acc),
    'GAP-E: order.discount fail-closed (SENSITIVE_KEYS)');

  const seed = read('lib/seed.ts');
  ok(/order\.discount/.test(seed), 'GAP-E: seed deny Staff untuk order.discount');

  const sup = read('lib/supervisor.ts');
  ok(/SUPERVISOR_ACTION_ORDER_DISCOUNT/.test(sup),
    'GAP-E: aksi kanonis ORDER_DISCOUNT diekspor');

  const scr = read('screens/cashier/CashierScreen.tsx');
  ok(/discApprove/.test(scr) && /SUPERVISOR_ACTION_ORDER_DISCOUNT/.test(scr),
    'GAP-E: CashierScreen staging diskon >20% ke dialog supervisor');
  ok(/lineGross > 0 && disc \/ lineGross > 0\.2/.test(scr),
    'GAP-E: ambang 20% ditegakkan di editor diskon (saveEditor)');
  ok(/fallbackAccessKey="order\.discount"/.test(scr),
    'GAP-E: fallback lokal pakai kunci order.discount');

  const i18n = read('lib/i18n.ts');
  ok(/disc_appr_title/.test(i18n), 'GAP-E: kunci i18n dialog diskon (id+en) ada');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(JSON.stringify(r));
  process.exit(r.failures.length ? 1 : 0);
}
