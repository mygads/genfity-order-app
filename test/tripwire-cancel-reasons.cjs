// Tripwire cancel-reasons server-driven (audit trisisi #5, APP side).
// Kunci statik (tanpa runtime RN — dicek dari sumber):
//  CR-01: kontrak transport ApiPath.merchantCancelReasons (GET, MerchantAuth).
//  CR-02: parse murni — envelope {data} + array langsung, isActive=false
//          dibuang, trim, 1-100 char, dedupe case-insensitive, cap 50.
//  CR-03: urutan kebenaran server → cache ms_setting(Master, CancelReasons)
//          → fallback; mode selain real = null (offline jujur); tak melempar.
//  CR-04: CancelScreen memakai preset server + fallback hardcoded lestari +
//          hint saat server eksplisit kosong.
//  CR-05: kunci i18n cx_server_empty dwibahasa.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
// NB: strip komentar TANPA merusak pola regex di dalam string (urutan:
// baris-komentar dulu, lalu blok — cermin tripwire-poswire-w2).
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // ---- CR-01: kontrak transport ----
  const server = read('config/server.ts');
  ok(/merchantCancelReasons:\s*'api\/merchant\/cancel-reasons'/.test(server),
    'CR-01: ApiPath.merchantCancelReasons = api/merchant/cancel-reasons');
  ok(/method:\s*'GET'/.test(readRaw('lib/cancelReasons.ts')) || /'GET'/.test(read('lib/cancelReasons.ts')),
    'CR-01: fetch preset via GET (bukan POST)');
  ok(/MerchantAuth/.test(read('config/server.ts')) || /merchant/i.test(server),
    'CR-01: path di grup merchant (MerchantAuth: staff boleh baca)');

  // ---- CR-02: parse murni ----
  const lib = read('lib/cancelReasons.ts');
  const libRaw = readRaw('lib/cancelReasons.ts');
  ok(/export function parseServerCancelReasonNames/.test(lib),
    'CR-02: parseServerCancelReasonNames diekspor (murni, tanpa IO)');
  ok(/r\.isActive === false/.test(lib) && /continue/.test(lib),
    'CR-02: isActive=false dibuang (list BE memuat nonaktif utk CRUD admin)');
  ok(/String\(r\.name \?\? ''\)\.trim\(\)/.test(libRaw),
    'CR-02: nama di-trim + toleran null');
  ok(/name\.length > MAX_REASON_NAME_LENGTH/.test(lib) || /length > 100/.test(lib),
    'CR-02: nama >100 char dibuang (cermin validasi BE)');
  ok(/seen\.has\(key\)/.test(lib) && /toLowerCase\(\)/.test(lib),
    'CR-02: dedupe case-insensitive (urutan server dipertahankan)');
  ok(/MAX_SERVER_REASON_PRESETS/.test(lib) && /50/.test(libRaw),
    'CR-02: cap 50 preset (layanan kasir tak dibanjiri)');
  ok(/Array\.isArray\(\(raw as \{ data/.test(libRaw) || /Array\.isArray\(raw\)/.test(lib),
    'CR-02: terima array langsung maupun envelope {data}');

  // ---- CR-03: urutan kebenaran + cache ----
  ok(/getApiMode\(\) !== 'real'/.test(lib),
    'CR-03: mode selain real = null (offline jujur, tanpa network)');
  ok(/fromDummy/.test(lib),
    'CR-03: respons dummy tak pernah dipersist/dianggap server');
  ok(/CANCEL_REASON_CACHE_KEY1 = 'Master'/.test(libRaw) && /CANCEL_REASON_CACHE_KEY2 = 'CancelReasons'/.test(libRaw),
    'CR-03: cache di ms_setting(Master, CancelReasons)');
  ok(/ON CONFLICT\(key1, key2\) DO UPDATE/.test(lib),
    'CR-03: persist upsert (server-wins-on-sync)');
  ok(/export async function resolveCancelReasonPresets/.test(lib),
    'CR-03: resolveCancelReasonPresets diekspor (server → cache → fallback)');
  ok(/fromServer: false/.test(lib),
    'CR-03: tanpa server/cache = fromServer:false (pemanggil pakai fallback i18n)');

  // ---- CR-04: CancelScreen ----
  const cx = read('screens/bill/CancelScreen.tsx');
  ok(/resolveCancelReasonPresets/.test(cx),
    'CR-04: CancelScreen resolve preset server');
  ok(/serverReasons \?\? FALLBACK_REASONS/.test(readRaw('screens/bill/CancelScreen.tsx')) || /serverReasons \?\? FALLBACK_REASONS/.test(cx),
    'CR-04: REASONS = server ?? fallback (fallback hardcoded lestari)');
  ok(/cx_reason_1/.test(cx) && /cx_reason_4/.test(cx),
    'CR-04: fallback cx_reason_1..4 lestari (offline/tanpa-cache)');
  ok(/cx_server_empty/.test(cx),
    'CR-04: hint saat server eksplisit kosong (bukan tombol kosong)');
  ok(/prev === FALLBACK_REASONS\[0\]/.test(readRaw('screens/bill/CancelScreen.tsx')),
    'CR-04: preset server tak menimpa pilihan manual kasir');

  // ---- CR-05: i18n ----
  const i18n = readRaw('lib/i18n.ts');
  ok(/cx_server_empty: \{ id: '[^']+', en: '[^']+' \}/.test(i18n),
    'CR-05: cx_server_empty dwibahasa (id+en)');

  return { failures, checks };
}

module.exports = { run };
