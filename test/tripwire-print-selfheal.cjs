// Tripwire self-healing cetak (C10, SESI-C APP): kunci statik bahwa antrean
// cetak terkuras di SETIAP momen jalur-terbukti-hidup, bukan hanya piggyback
// cetak-sukses:
//  1. Piggyback cetak-sukses lestari (print.ts: receipt/kitchen/queue-slip +
//     resolveDrainTarget diekspor untuk dipakai lane lain).
//  2. Test-print sukses (PrintersScreen.testPrintStation) memicu drainPrintQueue
//     (HANYA saat res.ok — test-gagal tak menguras).
//  3. Reconnect realtime (retry>0, bukan connect pertama) memicu drainPrintQueue
//     via lazy-require (nol tepi statis baru), best-effort tak melempar.
//  4. Batas jujur: tanpa-target tetap antre (bukan gagal); kind kitchen TAK
//     PERNAH jatuh ke kasir (resolveDrainTarget).
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

  const print = read('lib/print.ts');
  const printers = read('screens/settings/PrintersScreen.tsx');
  const realtime = read('lib/realtime.ts');
  const pq = read('lib/printqueue.ts');

  // 1. Piggyback cetak-sukses + ekspor resolver.
  ok(/export async function resolveDrainTarget/.test(print),
    'C10: resolveDrainTarget diekspor (dipakai lane test-print/reconnect)');
  ok((print.match(/void drainPrintQueue\(\{ resolveTarget: resolveDrainTarget \}\)/g) || []).length >= 3,
    'C10: piggyback cetak-sukses lestari (receipt + kitchen + queue-slip)');

  // 2. Test-print sukses → drain.
  ok(/if \(res\.ok\) void drainPrintQueue\(\{ resolveTarget: resolveDrainTarget \}\)/.test(printers),
    'C10: testPrintStation sukses → drainPrintQueue (jalur terbukti hidup)');
  ok(/from '\.\.\/\.\.\/lib\/printqueue'/.test(printers),
    'C10: PrintersScreen mengimpor drainPrintQueue (tanpa siklus: screen layer)');

  // 3. Reconnect realtime → drain (lazy, best-effort, bukan connect pertama).
  ok(/if \(reconnected\) \{[\s\S]{0,1200}?drainPrintQueue\(\{ resolveTarget: pr\.resolveDrainTarget \}\)/.test(realtime),
    'C10: reconnect (retry>0) → drainPrintQueue (connect pertama tidak)');
  ok(/require\('\.\/printqueue'\)/.test(realtime) && /require\('\.\/print'\)/.test(realtime),
    'C10: lazy-require printqueue+print (nol tepi statis baru)');

  // 4. Batas jujur lestari (strip() membuang komentar — jangkar pada kode).
  ok(/if \(!target\) \{\s*continue;/.test(pq),
    'C10: tanpa-target tetap antre (bukan gagal, bukan hilang)');
  ok(/TIDAK PERNAH jatuh ke/.test(pq) || /role !== 'Kasir'/.test(print),
    'C10: kitchen TAK PERNAH ke kasir (kind-aware lestari)');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
