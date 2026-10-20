// Tripwire guard pra-ESB + breaker (C8, SESI-C APP): kunci statik bahwa item
// counterpart-less (tanpa path endpoint — transport TAK PERNAH dicoba, mis.
// kaki group-payment tanpa {orderId, shareId} server) difinalkan fail-once
// ('gagal' + note SEKALI, lalu skipped) TANPA menyentuh breaker consecFails:
//  1. pushLightItem S10 mengembalikan 'failed-once' (bukan 'failed') untuk
//     cabang tanpa-path; status 'gagal' + note SEKALI lestari (fail-once).
//  2. Drain menghitung 'failed-once' ke tally failed TAPI consecFails tak
//     tersentuh (3 item counterpart-less baru tak menjeda drain).
//  3. Kegagalan transport NYATA tetap 'failed' + men-trip breaker (catch
//     pushLightItem; cabang 'failed' drain).
//  4. Gerbang identitas group-payment utuh (tanpa orderId/shareId → null →
//     guard, bukan 400 berulang ke endpoint salah).
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

  // 1. S10 fail-once via 'failed-once'.
  ok(/pushLightItem\(item: SyncItem\): Promise<'sent' \| 'failed' \| 'failed-once' \| 'skipped'>/.test(sync),
    "C8: pushLightItem mengenal outcome 'failed-once'");
  ok(/if \(item\.status === 'gagal'\) return 'skipped';\s*item\.status = 'gagal';\s*item\.note = tr\('sync\.masterQueued'\);\s*return 'failed-once';/.test(sync),
    'C8: tanpa-path = gagal+note SEKALI lalu failed-once (fail-once lestari)');

  // 2. Breaker steril dari counterpart-less.
  ok(/else if \(outcome === 'failed-once'\) \{\s*failed \+= 1;\s*\}/.test(sync),
    'C8: failed-once → tally failed, consecFails TAK tersentuh (breaker steril)');
  ok(/if \(outcome === 'sent'\) \{\s*sent \+= 1;\s*consecFails = 0;\s*touchSuccess\(\);\s*\} else if \(outcome === 'failed'\) \{\s*failed \+= 1;\s*consecFails \+= 1;/.test(sync),
    'C8: sent reset / failed-trip breaker lestari untuk hasil transport');

  // 3. Transport nyata tetap men-trip breaker.
  ok(/catch \(e\) \{\s*item\.status = 'gagal';[\s\S]{0,200}?return 'failed';/.test(sync),
    "C8: catch transport tetap 'failed' (breaker hidup untuk outage nyata)");

  // 4. Gerbang identitas group-payment utuh.
  ok(/if \(!\/\^\[0-9\]\+\$\/\.test\(orderId\) \|\| !shareId\) return null;/.test(sync),
    'C8: group-payment tanpa orderId/shareId → null (ke guard, bukan 400)');
  ok(/LOCAL_OPS\.has\(op\) \|\| LOCAL_OPS\.has\(tp\) \|\| DEPOSIT_LOCAL_KINDS\.has\(k\)/.test(sync),
    'C8: cermin-lokal/deposit-lokal tetap skipped-terkirim (tak tersentuh)');

  // 5. SC port C8 (dilipat dari tripwire-drain-no-counterpart.cjs — bukan file
  //    baru): kaki group-payment TANPA padanan Go (!compat) = BLOCKED jujur
  //    fail-once pola S10 + tak trip breaker; SyncScreen merender catatan.
  ok(/gop === 'group-payment'/.test(sync) && /sync\.groupLegNoCounterpart/.test(sync),
    'sync: group-payment tanpa padanan → catatan sync.groupLegNoCounterpart');
  const grp = (sync.match(/gop === 'group-payment'[\s\S]{0,600}?if \(!path\)/) || [''])[0];
  ok(/item\.status = 'gagal'/.test(grp) && /if \(item\.status === 'gagal'\) return 'skipped'/.test(grp) && /return 'failed'/.test(grp),
    'sync: kaki grup fail-once S10 (gagal SEKALI, berikut skipped)');
  ok(/!compat && item\.kind === 'order'/.test(sync),
    'sync: gerbang grup = !compat (tanpa padanan Go), sebelum pemakaian path');
  const drain = (sync.match(/let consecFails = 0;[\s\S]{0,1500}?await sleepMs\(150\)/) || [''])[0];
  ok(/outcome === 'failed'[\s\S]{0,120}?consecFails \+= 1/.test(drain) && !/skipped[\s\S]{0,60}?consecFails/.test(drain),
    'drain: breaker hanya hitung failed — skipped (legs grup lanjutan) tak trip');
  ok(/const depositKey = table === 'tr_memberdeposit'/.test(sync) && /const physCid = depositKey \|\| row\.id/.test(sync),
    'sync: fisik deposit = kunci-tunggal orderID (dep-…) lestari');
  ok(/const lightCid = saleCid \|\| depositRowId/.test(sync),
    'sync: ringan deposit = saleCid || depositRowId lestari');
  ok(/DEPOSIT_LOCAL_KINDS\.has\(k\)/.test(sync),
    'sync: deposit-lokal tetap cermin-lokal (tak tersentuh C8)');
  const i18n = readRaw('lib/i18n.ts');
  ok(/'sync\.groupLegNoCounterpart':\s*\{\s*id:\s*'[^']+',\s*en:\s*'[^']+'/.test(i18n),
    'i18n: sync.groupLegNoCounterpart ID+EN ada');
  const scr = read('screens/settings/SyncScreen.tsx');
  ok(/note:\s*String\(o\.note/.test(scr),
    'syncscreen: QueueItem dipetakan dari o.note');
  ok(/\{q\.note \? <Text/.test(scr),
    'syncscreen: catatan fail-once dirender jujur di kartu antrean');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
