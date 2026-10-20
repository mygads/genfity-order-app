// Tripwire efisiensi baterai (SC-QA3 P3 hibrida R3-B): EFF-08 resize foto
// bukti + EFF-09 timer gating. Kunci statik:
//  EFF-08 (milik sc): expo-image-manipulator terinstal; lib/photo.ts
//    satu-satunya pintu resize via helper kanonis preparePhoto (maks-1280
//    tanpa-upscale + JPEG terkompresi, best-effort fallback URI asli);
//    SEMUA call-site picker membungkus setPhoto via preparePhoto
//    (ExpenseScreen kamera+galeri, PettyCashFormScreen galeri+kamera).
//    shrinkReceiptPhoto + RECEIPT_PHOTO_* DITOLAK (R3-B ikut owner B).
//  EFF-09 (milik main C11): Attendance tick 60 dtk + tampil HM (fmtClock detik
//    DIHAPUS); Idle loadCount 30 dtk + Tables tick menit di-gate AppState
//    background; display 10 dtk → 60 dtk fallback (jalur live event-driven +
//    banner basi); auto-pushAll 5 mnt di-gate custom-env + wifiOnly (tanpa gate
//    pendingCount by design — antrean fisik hanya terlihat di dalam pushAll);
//    flushPendingRevokes early-return saat kosong; status realtime idle
//    tersurface via useConnectivity.wsConnected ke badge layar.
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

  // EFF-08: lib terinstal + helper kanonis.
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch {
    pkg = {};
  }
  ok(!!(pkg.dependencies && pkg.dependencies['expo-image-manipulator']),
    'C11 EFF-08: expo-image-manipulator di dependencies');
  const photo = read('lib/photo.ts');
  ok(/export async function preparePhoto/.test(photo),
    'SC EFF-08: lib/photo.ts mengekspor preparePhoto (kanonis kita; P5 konvergen)');
  ok(/MAX_SIDE/.test(photo) && /1280/.test(photo) && /JPEG|jpeg/.test(photo) && /compress/.test(photo),
    'SC EFF-08: resize maks-1280 tanpa-upscale + JPEG terkompresi');
  ok(/return next \|\| src;/.test(photo) && /return src;/.test(photo),
    'SC EFF-08: gagal resize = fallback URI asli (best-effort, tak melempar)');

  // EFF-08: semua call-site picker terbungkus.
  const expense = read('screens/cash/ExpenseScreen.tsx');
  ok((expense.match(/preparePhoto\(/g) || []).length >= 2,
    'SC EFF-08: ExpenseScreen kamera + galeri via preparePhoto');
  const form = read('screens/cash/PettyCashFormScreen.tsx');
  ok((form.match(/preparePhoto\(/g) || []).length >= 2,
    'SC EFF-08: PettyCashFormScreen pickPhoto + takePhoto via preparePhoto');

  // EFF-09: Attendance 60 dtk + HM.
  const att = read('screens/shift/AttendanceScreen.tsx');
  ok(/setInterval\(\(\) => setNow\(new Date\(\)\), 60000\)/.test(att),
    'C11 EFF-09: Attendance tick 60 dtk (bukan 1 dtk)');
  ok(!/const fmtClock =/.test(att) && /fmtClockHM\(now, lang\)/.test(att),
    'C11 EFF-09: jam-live HM (fmtClock detik dihapus)');

  // EFF-09: Idle + Tables AppState gate.
  const idle = read('screens/display/IdleScreen.tsx');
  ok(/AppState\.currentState !== 'active'/.test(idle) && /void loadCount\(\); \}, 30000\)/.test(idle),
    'C11 EFF-09: Idle loadCount 30 dtk di-gate background');
  const tables = read('screens/tables/TablesScreen.tsx');
  ok(/AppState\.currentState !== 'active'/.test(tables) && /setTables\(\(list\) =>/.test(tables),
    'C11 EFF-09: Tables tick menit di-gate background (snapshot hemat)');

  // EFF-09: display fallback 60 dtk, live event-driven, basi eksplisit.
  const cust = read('screens/display/CustomerDisplayScreen.tsx');
  ok(/void poll\(\); \}, 60000\)/.test(cust),
    'C11 EFF-09: CustomerDisplay fallback poll 60 dtk (bukan 10 dtk)');
  ok(/liveAtRef\.current/.test(cust) && /DISPLAY_STALE_MS/.test(cust) && /showStaleBanner/.test(cust),
    'C11 EFF-09: CustomerDisplay live event-driven + skip-saat-segar + banner basi');
  const queue = read('screens/display/QueueViewScreen.tsx');
  ok(/if \(sseConfigured && sseLive\) return undefined;/.test(queue),
    'C11 EFF-09: QueueView tanpa interval sama sekali saat SSE live');
  ok(/const timer = setInterval\(\(\) => \{\s*void poll\(\);\s*\}, 60000\)/.test(queue) && /showStaleBanner/.test(queue),
    'C11 EFF-09: QueueView fallback 60 dtk + banner basi');

  // EFF-09: pushAll gates + revoke early-return.
  const sync = read('lib/sync.ts');
  ok(/if \(getServerEnv\(\) !== 'custom'\) return;/.test(sync) && /await wifiOk\(wifiOnly\)/.test(sync),
    'C11 EFF-09: auto-pushAll di-gate custom-env + wifiOnly');
  ok(/5 \* 60 \* 1000/.test(sync),
    'C11 EFF-09: auto-pushAll tetap 5 menit (bukan lebih agresif)');
  ok(/if \(jobs\.length === 0\) return;/.test(sync),
    'C11 EFF-09: flushPendingRevokes early-return saat kosong (nol network)');

  // EFF-09: realtime idle tersurface ke badge.
  const conn = read('hooks/useConnectivity.ts');
  ok(/wsConnected/.test(conn),
    'C11 EFF-09: useConnectivity mengekspos wsConnected (idle/dead-conn ke UI)');
  const cashier = read('screens/cashier/CashierScreen.tsx');
  ok(/wsConnected/.test(cashier),
    'C11 EFF-09: badge koneksi mengonsumsi wsConnected (idle terlihat kasir)');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
