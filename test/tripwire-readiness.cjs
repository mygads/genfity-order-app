// Tripwire S-READINESS (SPEC-TERMINAL-SESSION §11, app-side 77f0bf3):
// gerbang shift server-side di flow login terminal.
// Kontrak yang dikunci (tanpa runtime RN — dicek statik dari sumber +
// replika predikat murni):
//  1. fetchTerminalReadiness (lib/terminalApi.ts): GET
//     api/v1/terminals/{id}/readiness (+deviceId opsional) → unwrap →
//     {needsShift, needsCash, shiftOpen, cashOpen, grantValid} dengan
//     perbandingan STRIK (=== true); {ok:false}/dummy = fail jujur.
//  2. LoginScreen.completeOnline: pasca-saveSession, tanya readiness
//     best-effort (withTimeout 8000 + catch→null); gate 'Shift' HANYA bila
//     server eksplisit (ok && !fromDummy && needsShift||needsCash);
//     selain itu fail-open (gerbang shift lokal App.tsx yang memutuskan).
//  3. Offline tak tersentuh: completeOffline TANPA readiness/postLoginRoute.
//  4. Tanpa navigate manual dari stack tamu; tanpa kunci i18n baru.
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

  // NOTE: server.ts dibaca MENTAH (strip komentar standar melahap baris
  // ApiPath — file ini punya pola komentar blok tak-seimbang; baris target
  // di bawah tak punya komentar sebaris sehingga raw aman).
  const server = readRaw('config/server.ts');
  const tapi = read('lib/terminalApi.ts');
  const tapiRaw = readRaw('lib/terminalApi.ts');
  const login = read('screens/auth/LoginScreen.tsx');
  const loginRaw = readRaw('screens/auth/LoginScreen.tsx');
  const i18n = readRaw('lib/i18n.ts');

  // ---- 1. Kontrak endpoint + fetchTerminalReadiness ----
  ok(/terminalReadiness: 'api\/v1\/terminals\/\{id\}\/readiness'/.test(server),
    'S-READINESS: ApiPath.terminalReadiness = api/v1/terminals/{id}/readiness');
  ok(/export interface TerminalReadiness/.test(tapi) &&
    /needsShift: boolean/.test(tapi) && /needsCash: boolean/.test(tapi) &&
    /shiftOpen: boolean/.test(tapi) && /cashOpen: boolean/.test(tapi) &&
    /grantValid: boolean/.test(tapi),
    'S-READINESS: interface TerminalReadiness = 5 boolean (needsShift/needsCash/shiftOpen/cashOpen/grantValid)');
  ok(/export async function fetchTerminalReadiness\(\s*terminalId: string,\s*opts\?: \{ deviceId\?: string \}/.test(tapi),
    'S-READINESS: fetchTerminalReadiness(terminalId, opts?: {deviceId})');
  ok(/withId\(ApiPath\.terminalReadiness, terminalId\)/.test(tapi) &&
    /method: 'GET'/.test(tapi),
    'S-READINESS: GET + withId(ApiPath.terminalReadiness, terminalId)');
  ok(/\.\.\.\(dev \? \{ params: \{ deviceId: dev \} \} : \{\}\)/.test(tapi),
    'S-READINESS: deviceId dikirim HANYA bila non-kosong (tanpanya grant valid:false ala BE)');
  // Fail-open jujur: {ok:false}/dummy BUKAN status tertutup.
  ok(/if \(!r\.ok \|\| r\.fromDummy\)/.test(tapi) &&
    /return fail<TerminalReadiness>\(r\.status, r\.fromDummy\)/.test(tapi),
    'S-READINESS: !ok/dummy → fail(status, fromDummy) jujur (bukan needsShift palsu)');
  ok(/unwrap<Record<string, unknown>>\(r\.data\)/.test(tapi),
    'S-READINESS: unwrap envelope kontrak-Go (pola fetchOccupant)');
  // MUTASI-SADAR: perbandingan WAJIB strik — truthy (!!/Boolean) akan
  // meloloskan string 'false'/angka 1 dari BE sebagai gate Shift.
  ok(/needsShift: data\.needsShift === true/.test(tapi),
    'S-READINESS: needsShift === true (strik; mutasi ke truthy HARUS gagal tes ini)');
  ok(/needsCash: data\.needsCash === true/.test(tapi),
    'S-READINESS: needsCash === true (strik; mutasi ke truthy HARUS gagal tes ini)');
  ok(/shiftOpen: shift\.open === true/.test(tapi) && /cashOpen: cash\.open === true/.test(tapi),
    'S-READINESS: shift.open/cash.open === true (strik)');
  ok(/grantValid: grant\.valid === true/.test(tapi),
    'S-READINESS: grant.valid === true (strik; tanpa deviceId = false)');
  ok(/fromDummy: false/.test(tapi),
    'S-READINESS: hasil sukses fromDummy:false');

  // ---- 2. Wiring completeOnline ----
  ok(/fetchTerminalReadiness/.test(login) && /from '\.\.\/\.\.\/lib\/terminalApi'/.test(loginRaw),
    'S-READINESS: LoginScreen impor fetchTerminalReadiness dari lib/terminalApi');
  ok(/setPostLoginRoute,/.test(loginRaw) && /from '\.\.\/\.\.\/session'/.test(loginRaw),
    'S-READINESS: LoginScreen impor setPostLoginRoute dari session');
  const onlineRegion = loginRaw.slice(
    loginRaw.indexOf('async function completeOnline('),
    loginRaw.indexOf('async function completeOffline('),
  );
  ok(onlineRegion.length > 500, 'S-READINESS: region completeOnline terisolasi untuk asersi urutan');
  ok(onlineRegion.indexOf('saveSession(sess);') !== -1 &&
    onlineRegion.indexOf('saveSession(sess);') < onlineRegion.indexOf("setPostLoginRoute('Shift')"),
    'S-READINESS: readiness DITANYA PASCA-saveSession (bearer sesi tersedia untuk apiFetch)');
  ok(/const rr = await withTimeout\(\s*fetchTerminalReadiness\(/.test(onlineRegion),
    'S-READINESS: tanya readiness via withTimeout(fetchTerminalReadiness(...))');
  ok(/,\s*8000,\s*\)\.catch\(\(\) => null\)/.test(onlineRegion),
    'S-READINESS: timeout 8000 + catch→null (tak terjangkau = null, bukan blokir)');
  ok(/readinessTermId\.trim\(\)/.test(onlineRegion) && /if \(readinessTermId\.trim\(\)\)/.test(onlineRegion),
    'S-READINESS: terminalId kosong → tak ditanya (tanpa GET sampah)');
  ok(/deviceId\.trim\(\) \? \{ deviceId: deviceId\.trim\(\) \} : undefined/.test(onlineRegion),
    'S-READINESS: deviceId diteruskan ter-trim, kosong → undefined');
  // MUTASI-SADAR: gate WAJIB konjungsi ok && !dummy && (shift||cash).
  // Menghapus !fromDummy = dummy ikut menggate; menghapus ok = offline
  // menggate — keduanya HARUS gagal tes ini.
  ok(/if \(rr && rr\.ok && !rr\.fromDummy && \(rr\.data\.needsShift \|\| rr\.data\.needsCash\)\)/.test(onlineRegion),
    'S-READINESS: gate = rr.ok && !fromDummy && (needsShift||needsCash) (mutasi penghapus syarat HARUS gagal)');
  ok(/setPostLoginRoute\('Shift'\)/.test(onlineRegion),
    "S-READINESS: gate terpenuhi → setPostLoginRoute('Shift') sekali-pakai");
  ok(!/navigation\.navigate/.test(onlineRegion),
    'S-READINESS: TANPA navigate manual (rute dikonsumsi GuardedStacks App.tsx; stack tamu tak kenal rute authed)');
  ok(/\} catch \{\s*\/\* fail-open/.test(onlineRegion) || /\} catch \{\s*\n\s*\/\* fail-open/.test(onlineRegion),
    'S-READINESS: blok dibungkus try/catch fail-open (gerbang shift lokal yang memutuskan)');

  // ---- 3. Offline tak tersentuh ----
  const offlineRegion = loginRaw.slice(loginRaw.indexOf('async function completeOffline('));
  ok(!/fetchTerminalReadiness/.test(strip(offlineRegion)),
    'S-READINESS: completeOffline TANPA fetchTerminalReadiness (offline tak lewat gerbang server)');
  ok(!/setPostLoginRoute/.test(strip(offlineRegion)),
    'S-READINESS: completeOffline TANPA setPostLoginRoute');

  // ---- 4. Tanpa kunci i18n baru ----
  ok(!/readiness/i.test(i18n),
    'S-READINESS: NOL kunci i18n readiness (aturan wave: pakai key existing)');

  // ---- 5. Tabel kebenaran predikat gate (replika kontrak — GAGAL bila
  // perilaku dibalik: shift-tertutup wajib gate, sisanya fail-open) ----
  const gate = (rr) => !!(rr && rr.ok && !rr.fromDummy && (rr.data.needsShift || rr.data.needsCash));
  ok(gate({ ok: true, fromDummy: false, data: { needsShift: true, needsCash: false } }) === true,
    'S-READINESS: shift-closed (needsShift) → GATE Shift');
  ok(gate({ ok: true, fromDummy: false, data: { needsShift: false, needsCash: true } }) === true,
    'S-READINESS: cash-closed (needsCash) → GATE Shift');
  ok(gate({ ok: true, fromDummy: false, data: { needsShift: false, needsCash: false } }) === false,
    'S-READINESS: shift+cash open → LOLOS (tanpa gate)');
  ok(gate({ ok: false, fromDummy: false, data: { needsShift: true, needsCash: true } }) === false,
    'S-READINESS: unknown ({ok:false}) → FAIL-OPEN walau flag true');
  ok(gate({ ok: true, fromDummy: true, data: { needsShift: true, needsCash: false } }) === false,
    'S-READINESS: dummy → FAIL-OPEN walau needsShift true');
  ok(gate(null) === false, 'S-READINESS: timeout (null) → FAIL-OPEN');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
