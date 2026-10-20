// Tripwire C8 Sesi-C QA3 (drain tanpa-padanan): kaki group-payment TANPA
// identitas server = BLOCKED jujur fail-once (pola S10) + tak trip breaker;
// UI SyncScreen menampilkan catatan; kunci-tunggal deposit lestari.
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

  const sync = read('lib/sync.ts');
  const syncRaw = readRaw('lib/sync.ts');

  // 1. Kaki grup tanpa identitas = fail-once 'gagal' + catatan, lalu skipped.
  ok(/gop === 'group-payment'/.test(sync) && /sync\.groupLegNoCounterpart/.test(sync),
    'sync: group-payment tanpa padanan → catatan sync.groupLegNoCounterpart');
  const grp = (sync.match(/gop === 'group-payment'[\s\S]{0,600}?if \(!path\)/) || [''])[0];
  ok(/item\.status = 'gagal'/.test(grp) && /if \(item\.status === 'gagal'\) return 'skipped'/.test(grp) && /return 'failed'/.test(grp),
    'sync: kaki grup fail-once S10 (gagal SEKALI, berikut skipped)');
  // 2. Cabang grup di atas fallback path (tanpa compat) — bukan sesudah kirim.
  ok(/!compat && item\.kind === 'order'/.test(sync),
    'sync: gerbang grup = !compat (tanpa padanan Go), sebelum pemakaian path');
  // 3. Breaker hanya di-trip 'failed': skipped tak menyentuh consecFails.
  const drain = (sync.match(/let consecFails = 0;[\s\S]{0,1500}?await sleepMs\(150\)/) || [''])[0];
  ok(/outcome === 'failed'[\s\S]{0,120}?consecFails \+= 1/.test(drain) && !/skipped[\s\S]{0,60}?consecFails/.test(drain),
    'drain: breaker hanya hitung failed — skipped (legs grup lanjutan) tak trip');
  // 4. Kunci-tunggal deposit lestari (fisik + ringan satu kunci dep-…).
  ok(/const depositKey = table === 'tr_memberdeposit'/.test(sync) && /const physCid = depositKey \|\| row\.id/.test(sync),
    'sync: fisik deposit = kunci-tunggal orderID (dep-…) lestari');
  ok(/const lightCid = saleCid \|\| depositRowId/.test(sync),
    'sync: ringan deposit = saleCid || depositRowId lestari');
  ok(/DEPOSIT_LOCAL_KINDS\.has\(k\)/.test(sync),
    'sync: deposit-lokal tetap cermin-lokal (tak tersentuh C8)');
  // 5. i18n ID + EN ada.
  const i18n = readRaw('lib/i18n.ts');
  ok(/'sync\.groupLegNoCounterpart':\s*\{\s*id:\s*'[^']+',\s*en:\s*'[^']+'/.test(i18n),
    'i18n: sync.groupLegNoCounterpart ID+EN ada');
  // 6. UI jujur: SyncScreen petakan + render note antrean.
  const scr = read('screens/settings/SyncScreen.tsx');
  ok(/note:\s*String\(o\.note/.test(scr),
    'syncscreen: QueueItem dipetakan dari o.note');
  ok(/\{q\.note \? <Text/.test(scr),
    'syncscreen: catatan fail-once dirender jujur di kartu antrean');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  r.failures.forEach((f) => console.log(`FAIL ${f}`));
  process.exit(r.failures.length ? 1 : 0);
}
