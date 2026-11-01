// Tripwire GAP-B (audit 2026-11-01): cashierIdle.ts WAJIB berkabel.
// Kunci statik: watcher start saat sesi aktif, sentuhan + pindah layar =
// aktivitas, kunci butuh grant valid (fail-open tanpa grant), overlay PIN
// re-auth tanpa logout (shift tetap berjalan).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (p) => strip(fs.readFileSync(path.join(ROOT, p), 'utf8'));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  const app = read('App.tsx');
  ok(/startCashierIdleWatcher\(\)/.test(app),
    'GAP-B: App start watcher idle saat sesi aktif');
  ok(/onCashierLockChange/.test(app), 'GAP-B: App langganan event kunci idle');
  ok(/onTouchStart/.test(app) && /touchCashierActivity/.test(app),
    'GAP-B: sentuhan layar = aktivitas (reset timer)');
  ok(/onStateChange/.test(app) && /touchCashierActivity/.test(app),
    'GAP-B: pindah layar = aktivitas');
  ok(/isGrantValid/.test(app),
    'GAP-B: kunci HANYA bila grant offline valid (tanpa grant = jangan kunci)');
  ok(/IdleLockOverlay/.test(app), 'GAP-B: overlay kunci dirender di root');

  const ov = read('src/components/IdleLockOverlay.tsx');
  ok(/verifyGrantPin/.test(ov), 'GAP-B: overlay verifikasi PIN grant offline');
  ok(/checkGrantLoginThrottle/.test(ov) && /noteGrantLoginFailure/.test(ov),
    'GAP-B: overlay pakai throttle anti brute-force');
  ok(/onLogout/.test(ov), 'GAP-B: overlay punya jalan keluar (logout)');

  const i18n = read('src/lib/i18n.ts');
  ok(/idle_title/.test(i18n) && /idle_wrong/.test(i18n),
    'GAP-B: kunci i18n idle-lock (id+en) ada');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(JSON.stringify(r));
  process.exit(r.failures.length ? 1 : 0);
}
