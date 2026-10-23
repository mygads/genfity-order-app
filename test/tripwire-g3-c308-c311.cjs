// Tripwire G3 C308/C309/C310/C311: kunci 4 fix Lane C Sesi 2 di main.
// Tanpa runtime RN (statik dari sumber) + SATU probe runtime C308 wajib:
// modul appAlert.ts dieksekusi sungguhan di node (ditranspile via
// typescript repo, react-native di-stub OS='web') — GAGAL bila perilaku
// dibalik (sunyi di web = regresi ke Alert.alert NO-OP).
//
//  (a) C308 appAlert: web tak pernah memanggil Alert.alert; tiap panggilan
//      memancarkan AppAlertRequest ke subscriber; antre FIFO; dismiss
//      menguras antrean hingga null; tak pernah melempar. Host
//      <AppAlertHost/> terpasang di App.tsx; NOL Alert.alert mentah di src
//      di luar appAlert.ts.
//  (b) C309 i18n payments: 8 kunci xp_m_* ada, tiap kunci punya id+en
//      non-kosong dan BERBEDA (menjerat campur EN/ID); EXTRA_METHODS hanya
//      merujuk kunci yang ada; ExtraPaySection render via xmLabel(m, t).
//  (c) C310 salesNum: salesNum.ts daun murni (tak impor ./sales, ./sync,
//      ./payments, ./display); sync.ts impor ./salesNum; sales.ts
//      ekspor-ulang dari ./salesNum (tak ada definisi nomor ganda).
//  (d) C311 seed-gate: seed.ts ekspor isSeedReady/whenSeedReady +
//      menandai seedDone; LoginScreen impor keduanya, menunggu
//      whenSeedReady(8000) dan fail-open (isSeedReady() || timeout).
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function listSrc(rel) {
  const out = [];
  const abs = path.join(SRC, rel);
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...listSrc(r));
    else if (/\.tsx?$/.test(e.name)) out.push(r);
  }
  return out;
}

/** Eksekusi appAlert.ts asli dengan react-native stub (OS web). */
function loadAppAlertWeb() {
  const ts = require('typescript');
  const src = readRaw('lib/appAlert.ts');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  });
  const alertCalls = [];
  const stubRN = { Platform: { OS: 'web' }, Alert: { alert: (...a) => void alertCalls.push(a) } };
  const origLoad = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req === 'react-native') return stubRN;
    return origLoad.call(this, req, parent, isMain);
  };
  try {
    const m = new Module('appAlert-probe', null);
    m.filename = path.join(SRC, 'lib', 'appAlert.probe.js');
    m.paths = Module._nodeModulePaths(path.join(SRC, 'lib'));
    m._compile(outputText, m.filename);
    return { mod: m.exports, alertCalls };
  } finally {
    Module._load = origLoad;
  }
}

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // ---- (a) C308 statik ----
  const host = readRaw('components/AppAlertHost.tsx');
  ok(/subscribeAppAlert/.test(host) && /dismissAppAlert/.test(host), 'C308 host langganan+tutup via appAlert');
  const appRoot = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
  ok(/<AppAlertHost\s*\/>/.test(appRoot), 'C308 <AppAlertHost/> terpasang di App.tsx');
  const rawAlert = listSrc('.').filter(
    (f) => f.replace(/\\/g, '/') !== 'lib/appAlert.ts' && /Alert\.alert/.test(read(f)),
  );
  ok(rawAlert.length === 0, `C308 NOL Alert.alert mentah di src (temuan: ${rawAlert.join(',') || 'nihil'})`);
  for (const cs of ['screens/auth/QrHowScreen.tsx', 'screens/install/SelectBranchScreen.tsx', 'lib/print.ts']) {
    ok(/from '[^']*\/appAlert'/.test(read(cs)), `C308 call-site ${cs} via appAlert`);
  }

  // ---- (a) C308 probe runtime (wajib) ----
  try {
    const { mod, alertCalls } = loadAppAlertWeb();
    const seen = [];
    const unsub = mod.subscribeAppAlert((req) => void seen.push(req ? req.title : null));
    ok(seen.length === 1 && seen[0] === null, 'C308 runtime subscriber terima null awal');
    mod.appAlert('T1', 'M1');
    ok(alertCalls.length === 0, 'C308 runtime web TAK memanggil Alert.alert');
    ok(seen.length === 2 && seen[1] === 'T1', 'C308 runtime appAlert pancarkan request ke subscriber');
    mod.appAlert('T2', 'M2', [{ text: 'OK' }], { cancelable: false });
    ok(seen.length === 2, 'C308 runtime request ke-2 antre (satu dialog dalam satu waktu)');
    mod.dismissAppAlert();
    ok(seen.length === 3 && seen[2] === 'T2', 'C308 runtime dismiss tampilkan antrean FIFO');
    mod.dismissAppAlert();
    ok(seen.length === 4 && seen[3] === null, 'C308 runtime antrean habis → null');
    let threw = false;
    try {
      mod.appAlert('T3');
      mod.dismissAppAlert();
    } catch {
      threw = true;
    }
    ok(!threw, 'C308 runtime tak pernah melempar');
    unsub();
  } catch (e) {
    ok(false, `C308 runtime probe exception: ${e && e.message}`);
  }

  // ---- (b) C309 ----
  const i18n = readRaw('lib/i18n.ts');
  const keys = [
    'xp_m_transfer', 'xp_m_transfer_d', 'xp_m_deposit', 'xp_m_deposit_d',
    'xp_m_compliment', 'xp_m_compliment_d', 'xp_m_nonsales', 'xp_m_nonsales_d',
  ];
  for (const k of keys) {
    const m = i18n.match(new RegExp(`${k}:\\s*\\{\\s*id:\\s*'([^']*)',\\s*en:\\s*'([^']*)'\\s*\\}`));
    ok(!!m && m[1].length > 0 && m[2].length > 0, `C309 kunci ${k} punya id+en non-kosong`);
    if (m) ok(m[1] !== m[2], `C309 kunci ${k} EN≠ID (menjerat campur lokal)`);
  }
  const pay = read('lib/payments.ts');
  for (const k of keys) ok(pay.includes(`'${k}'`), `C309 EXTRA_METHODS merujuk ${k}`);
  const section = read('screens/payment/ExtraPaySection.tsx');
  ok(/xmLabel\(m,\s*t\)/.test(section), 'C309 ExtraPaySection render via xmLabel(m, t)');

  // ---- (c) C310 ----
  const leaf = read('lib/salesNum.ts');
  for (const bad of ['./sales', './sync', './payments', './display']) {
    ok(!new RegExp(`from\\s*'${bad.replace('./', '\\./')}'`).test(leaf), `C310 salesNum.ts tak impor ${bad}`);
  }
  ok(/from '\.\/salesNum'/.test(read('lib/sync.ts')), 'C310 sync.ts impor ./salesNum');
  const sales = read('lib/sales.ts');
  ok(/from '\.\/salesNum'/.test(sales) && /export \{[^}]*nextSalesNum/.test(sales), 'C310 sales.ts ekspor-ulang dari ./salesNum');

  // ---- (d) C311 ----
  const seed = read('lib/seed.ts');
  ok(/export function isSeedReady/.test(seed), 'C311 seed.ts ekspor isSeedReady');
  ok(/export function whenSeedReady/.test(seed), 'C311 seed.ts ekspor whenSeedReady');
  ok(/seedDone\s*=\s*true/.test(seed), 'C311 seed.ts menandai seedDone');
  const login = read('screens/auth/LoginScreen.tsx');
  ok(/isSeedReady,\s*whenSeedReady/.test(login) || /whenSeedReady,\s*isSeedReady/.test(login) || (login.includes('isSeedReady') && login.includes('whenSeedReady')), 'C311 LoginScreen impor gate seed');
  ok(/await whenSeedReady\(/.test(login), 'C311 LoginScreen menunggu whenSeedReady');
  ok(/isSeedReady\(\)\s*\|\|/.test(login), 'C311 LoginScreen fail-open (isSeedReady() || timeout)');

  return { failures, checks };
}

module.exports = { run };
