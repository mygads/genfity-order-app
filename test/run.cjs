// Runner uji ringan APP (PP-012): jalankan semua test/tripwire-*.cjs,
// agregat hasil, exit != 0 bila ada yang gagal. Tanpa dependensi runtime
// (statik + node murni) agar jalan di CI tanpa emulator/dev-client.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => /^tripwire-.*\.cjs$/.test(f)).sort();
if (!files.length) {
  console.error('test/run: tak ada tripwire-*.cjs');
  process.exit(2);
}
let fail = 0;
for (const f of files) {
  try {
    const mod = require(path.join(dir, f));
    const run = typeof mod === 'function' ? mod : mod.run;
    const res = run();
    const bad = (res && res.failures) || [];
    if (bad.length) {
      fail += bad.length;
      for (const b of bad) console.log(`FAIL [${f}] ${b}`);
    } else {
      console.log(`PASS [${f}] (${(res && res.checks) || '?'} checks)`);
    }
  } catch (e) {
    fail += 1;
    console.log(`FAIL [${f}] exception: ${e && e.message}`);
  }
}
console.log(fail ? `RESULT: ${fail} kegagalan` : 'RESULT: semua tripwire lolos');
process.exit(fail ? 1 : 0);
