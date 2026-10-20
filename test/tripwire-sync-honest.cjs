// Tripwire sync-jujur (C12, SESI-C APP): SYNC-02 auto-sync benar dipanggil +
// SYNC-03 teks/timing push jujur + tanpa klaim background-sync. Kunci statik:
//  SYNC-02: SYNC_OPTS_KEY satu sumber (lib/sync, dipakai SyncScreen — tanpa
//    literal duplikat); restoreAutoSyncPrefs (baca preferensi → apply)
//    dipanggil saat boot App.tsx + tiap login sukses LoginScreen (3 jalur:
//    online, offline-grant, sukses umum), bukan hanya saat SyncScreen dibuka.
//  SYNC-03: notifyPushSyncSuccess HANYA bila sent>0; teks doPush memakai
//    hitungan nyata (sent/failed) + pesan gagal saat throw; lastSyncMs HANYA
//    ditulis pushAll (master.ts tak menyentuh); repo SENGAJA tanpa
//    TaskManager/BackgroundFetch — timer auto-sync foreground-only, tak ada
//    klaim "sync saat screen mati".
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (p) => strip(fs.readFileSync(path.join(SRC, p), 'utf8'));

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // SYNC-02: kunci + restore + pemanggil.
  const sync = read('lib/sync.ts');
  ok(/export const SYNC_OPTS_KEY = 'genfity\.sync\.opts'/.test(sync),
    'C12 SYNC-02: SYNC_OPTS_KEY diekspor dari lib/sync (satu sumber)');
  ok(/export async function restoreAutoSyncPrefs/.test(sync) && /applyAutoSyncPrefs\(\{ auto:/.test(sync),
    'C12 SYNC-02: restoreAutoSyncPrefs baca preferensi → apply');
  const scr = read('screens/settings/SyncScreen.tsx');
  ok(/SYNC_OPTS_KEY/.test(scr) && !/genfity\.sync\.opts/.test(scr),
    'C12 SYNC-02: SyncScreen pakai SYNC_OPTS_KEY (tanpa literal duplikat)');
  const app = strip(fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8'));
  ok(/restoreAutoSyncPrefs\(\)/.test(app),
    'C12 SYNC-02: boot App.tsx memulihkan timer auto-sync');
  const login = read('screens/auth/LoginScreen.tsx');
  ok((login.match(/restoreAutoSyncPrefs\(\)/g) || []).length >= 3,
    'C12 SYNC-02: LoginScreen pulihkan timer di 3 jalur login sukses');

  // SYNC-03: teks/timing jujur.
  ok(/if \(sent > 0\)[\s\S]{0,300}?notifyPushSyncSuccess\(\)/.test(sync),
    'C12 SYNC-03: sinyal sukses HANYA bila sent>0 (tanpa klaim kosong)');
  ok(/sync_push_done/.test(scr) && /r\.sent/.test(scr) && /r\.failed/.test(scr) && /sync_push_fail/.test(scr),
    'C12 SYNC-03: teks push = hitungan nyata sent/failed + pesan gagal jujur');
  ok(/lastSyncMs = Date\.now\(\)/.test(sync),
    'C12 SYNC-03: lastSyncMs ditulis alur push');
  const master = read('lib/master.ts');
  ok(!/lastSyncMs/.test(master),
    'C12 SYNC-03: pullMaster tak menyentuh lastSyncMs (umur tak berbohong pasca-pull)');

  // SYNC-03: tanpa infrastruktur background-sync (foreground-only eksplisit).
  const files = walk(SRC, []);
  const bgHits = files.filter((f) => {
    try {
      const c = strip(fs.readFileSync(f, 'utf8'));
      return /TaskManager|BackgroundFetch|registerTaskAsync|expo-task-manager|expo-background-fetch/.test(c);
    } catch {
      return false;
    }
  });
  ok(bgHits.length === 0,
    `C12 SYNC-03: nol background-task infra (foreground-only jujur)${bgHits.length ? ` — ${bgHits.join(', ')}` : ''}`);

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
