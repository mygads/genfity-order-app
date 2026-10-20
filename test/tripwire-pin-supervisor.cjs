// Tripwire PIN/supervisor (PP-012): jaga invarian keamanan yang tak boleh
// regresi tanpa ketahuan CI — dicek statik dari sumber (tanpa runtime RN):
//  1. authorizeSupervisor memakai AbortController + timeout (GAP-5).
//  2. PIN dicocokkan PENUH, tanpa slice(0,6) (R38).
//  3. Jalur offline/unconfigured fail-closed (ok:false, tanpa bakar attempt
//     untuk klasifikasi offline).
//  4. PIN supervisor tak pernah di-console.log / disimpan plaintext.
//  5. tOf tak mengembalikan key mentah (S4).
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

  const sup = read('lib/supervisor.ts');
  const pin = read('lib/pin.ts');
  const i18n = read('lib/i18n.ts');

  // 1. Timeout abort nyata di authorizeSupervisor.
  ok(/new AbortController\(\)/.test(sup) && /setTimeout\(/.test(sup) && /ctrl\.abort\(\)/.test(sup),
    'supervisor: AbortController + setTimeout + abort() wajib ada');
  ok(/signal:\s*ctrl\.signal/.test(sup),
    'supervisor: signal diteruskan ke apiFetch (abort nyata, bukan race saja)');
  // 2. Tanpa pemotongan PIN.
  ok(!/slice\(0,\s*6\)/.test(sup),
    'supervisor: larangan slice(0,6) — PIN cocok penuh');
  // 3. Fail-closed: hasil offline/unconfigured membawa ok:false.
  ok(/code: 'offline', message: tOf\('sup_offline'\)/.test(sup),
    'supervisor: jalur offline mengembalikan code offline (fail-closed)');
  ok(/code: 'unconfigured'/.test(sup),
    'supervisor: jalur unconfigured ada (mode local/tanpa base URL)');
  ok(/attempts \+= 1/.test(sup) && /R35/.test(readRaw('lib/supervisor.ts')),
    'supervisor: penghitung attempt + klasifikasi offline-sebelum-hitung ada');
  // 4. PIN tak bocor ke log; verifyAttendancePin diekspor lib/pin.
  ok(!/console\.log\(.*pin/i.test(sup) && !/console\.log\(.*pin/i.test(pin),
    'supervisor+pin: tak ada console.log berisi PIN');
  ok(/export\s+(async\s+)?function\s+verifyAttendancePin/.test(pin),
    'pin: verifyAttendancePin diekspor');
  // 5. tOf tak bocorkan key mentah.
  ok(!/if \(!e\) return key/.test(i18n) && /return ''/.test(i18n),
    'i18n: tOf missing-key tak mengembalikan key mentah');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  for (const f of r.failures) console.log('FAIL ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
