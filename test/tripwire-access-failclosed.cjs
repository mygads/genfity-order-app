// Tripwire fail-closed RBAC (C5, SESI-C APP): kunci statik atas hierarki akses
// di src/lib/access.ts — 4 kunci sensitif DENY bila (a) tanpa baris akses
// (step-4 default, seed menjamin owner wildcard-allow + staff deny eksplisit
// di seed.ts:545-568 sehingga cabang ini hanya menjerat user tanpa baris)
// atau (b) DB belum siap (catch). 'petty.approve' (Q18) + kunci non-sensitif
// tetap fail-open; requireEscalationAccess (PIN owner) tetap fail-closed.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
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

  // 1. SENSITIVE_KEYS = tepat 4 kunci, tanpa petty.approve.
  ok(/SENSITIVE_KEYS[^=]*=\s*new Set\(\[\s*'order\.void',\s*'order\.cancel',\s*'sale\.refund',\s*'settings\.edit',\s*\]\)/.test(acc),
    'C5: SENSITIVE_KEYS tepat 4 kunci (order.void/order.cancel/sale.refund/settings.edit)');
  ok(!/SENSITIVE_KEYS[^;]*petty/.test(acc),
    'C5: petty.approve (Q18) BUKAN kunci sensitif (tetap fail-open)');

  // 2. Step-4 decideHierarchy: sensitif → default-deny, non-sensitif → default-allow.
  ok(/if \(SENSITIVE_KEYS\.has\(accessKey\)\) \{\s*return \{ ok: false, reason: 'default-deny' \};/.test(acc),
    'C5: step-4 tanpa baris = default-deny untuk kunci sensitif');
  ok(/warnFailOpenOnce\('default-allow', userId, accessKey\);\s*return \{ ok: true, reason: 'default-allow' \};/.test(acc),
    'C5: step-4 default-allow lestari untuk kunci non-sensitif');
  // Hirarki eksplisit (1-3) tak tersentuh: exact → wildcard → role.
  ok(/explicit-allow/.test(acc) && /wildcard-allow/.test(acc) && /role-wildcard-allow/.test(acc),
    'C5: cabang eksplisit/wildcard/role (langkah 1-3) tak tersentuh');

  // 3. Catch DB-tak-siap: sensitif deny, non-sensitif allow.
  ok(/if \(SENSITIVE_KEYS\.has\(accessKey\)\) return false;/.test(acc),
    'C5: hasAccess catch → false untuk kunci sensitif');
  ok(/if \(SENSITIVE_KEYS\.has\(accessKey\)\) return \{ ok: false, reason: 'db-unready' \};/.test(acc),
    'C5: requireAccess catch → db-unready deny untuk kunci sensitif');
  ok(/warnFailOpenOnce\('db-unready', userId, accessKey\);\s*return true;/.test(acc) &&
    /warnFailOpenOnce\('db-unready', userId, accessKey\);\s*return \{ ok: true, reason: 'db-unready' \};/.test(acc),
    'C5: catch db-unready fail-open lestari untuk kunci non-sensitif');

  // 4. Rujukan fail-closed utuh: requireEscalationAccess + terminal gates.
  // (strip() membuang komentar — jangkar murni pada pola catch→deny.)
  ok(/requireEscalationAccess[\s\S]{0,1500}?catch \{\s*return \{ ok: false, reason: 'db-unready' \};/.test(acc),
    'C5: requireEscalationAccess (PIN owner) tetap fail-closed');
  ok(/grant ada tapi terminal\/user tak cocok atau kedaluwarsa => DENY/.test(acc.replace(/\n/g, ' ')) ||
    /grant-mismatch/.test(acc),
    'C5: gerbang grant terminal (langkah 0) tak tersentuh');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
