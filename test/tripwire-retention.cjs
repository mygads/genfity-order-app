// Tripwire C9 Sesi-C QA3 (retensi device): prune tr_printqueue 'cetak' > N
// hari + tr_esoprocessqueue 'lokal' > N hari, best-effort di drain/push,
// catatan UI jujur. Sisi BE (migrasi 00045) SENGAJA tak tersentuh — worktree
// APP tak membawa repo BE; purge/wont-fix dicatat di laporan, bukan kode.
// Dicek statik dari sumber (tanpa runtime RN) agar jalan di CI.
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

  const pq = read('lib/printqueue.ts');
  const pqRaw = readRaw('lib/printqueue.ts');
  const sync = read('lib/sync.ts');
  const syncRaw = readRaw('lib/sync.ts');

  // 1. Prune cetak: HANYA status 'cetak' + cutoff createdAt; tak pernah throw.
  ok(/export async function prunePrintQueue/.test(pq),
    'printqueue: prunePrintQueue diekspor');
  ok(/DELETE FROM tr_printqueue WHERE status = 'cetak' AND createdAt < \?/.test(pq),
    "printqueue: prune HANYA 'cetak' + cutoff (antre/gagal lestari)");
  ok(/PRINT_RETENTION_DAYS = 30/.test(pqRaw),
    'printqueue: PRINT_RETENTION_DAYS = 30 default eksplisit');
  // 2. Prune lokal: HANYA status 'lokal' + cutoff.
  ok(/export async function pruneLocalOnlyQueue/.test(sync),
    'sync: pruneLocalOnlyQueue diekspor');
  ok(/DELETE FROM tr_esoprocessqueue WHERE status = 'lokal' AND createdAt < \?/.test(sync),
    "sync: prune HANYA 'lokal' + cutoff (antre/gagal lestari)");
  ok(/LOCAL_ONLY_RETENTION_DAYS = 30/.test(syncRaw),
    'sync: LOCAL_ONLY_RETENTION_DAYS = 30 default eksplisit');
  // 3. Wiring best-effort: drain cetak + pushAll (try/catch, tak lempar).
  ok(/await prunePrintQueue\(\)/.test(pq) && /drain tetap jalan/.test(pqRaw),
    'printqueue: drainPrintQueue panggil prune best-effort');
  ok(/await pruneLocalOnlyQueue\(\)/.test(sync) && /drain tetap jalan/.test(syncRaw),
    'sync: pushAll panggil prune best-effort');
  // 4. i18n + catatan UI.
  const i18n = readRaw('lib/i18n.ts');
  ok(/'sync\.retentionNote':\s*\{\s*id:\s*'[^']*\{n\}[^']*',\s*en:\s*'[^']*\{n\}[^']*'/.test(i18n),
    'i18n: sync.retentionNote ID+EN dengan {n} ada');
  const scr = read('screens/settings/SyncScreen.tsx');
  ok(/sync\.retentionNote/.test(scr) && /LOCAL_ONLY_RETENTION_DAYS/.test(scr),
    'syncscreen: catatan retensi dirender jujur (bukan hardcode hari)');
  ok(/pendingPrintCount/.test(scr),
    'syncscreen: pendingPrintCount tetap (badge backlog cetak lestari)');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  r.failures.forEach((f) => console.log(`FAIL ${f}`));
  process.exit(r.failures.length ? 1 : 0);
}
