// Tripwire token-ke-SecureStore (C4, SESI-C APP): kunci statik bahwa authToken
// JWT E01 TAK PERNAH tersimpan plaintext di AsyncStorage — salinan persisten
// hanya di expo-secure-store (pola lib/pin.ts), memori Session.authToken tetap
// sumber sinkron pembaca bearer:
//  1. session.ts persist() men-strip authToken (scrubbed), tanpa bare
//     JSON.stringify(current); restore() migrasi-scrub token warisan pra-C4
//     (→ SecureStore + re-persist) dengan guard lintas-user (current===parsed)
//     + guard offline (sesi offline tak memegang token server).
//  2. saveSession mencerminkan SecureStore (ada = simpan, tanpa = buang anti
//     basi); loginEmployee + logout + sesi offline (via saveSession-tanpa-token)
//     membuang salinan (anti bocor lintas-user).
//  3. forceLogoutOnTokenLoss = buang SecureStore + clearGrant + logout +
//     revoke token-loss (klaim acceptance).
//  4. completeOnline { requireToken: true } HANYA di cabang E29-terverifikasi;
//     situs fallback lokal/offline/refetch/takeover TETAP tanpa requireToken
//     (login offline/L1 tak boleh diblokir); 'e01-no-token' → needBeText jujur.
//  5. Pembaca bearer sinkron tak tersentuh (server.ts authToken-dulu).
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

  const sess = read('session.ts');
  const login = read('screens/auth/LoginScreen.tsx');
  const server = read('config/server.ts');

  // 1. SecureStore + strip persist + migrasi restore.
  ok(/import \* as SecureStore from 'expo-secure-store'/.test(sess),
    'C4: session.ts impor expo-secure-store (pola pin.ts)');
  ok(/delete scrubbed\.authToken;\s*void setItem\(LS_SESSION, JSON\.stringify\(scrubbed\)\)/.test(sess),
    'C4: persist() strip authToken (scrubbed, bukan current mentah)');
  ok(!/setItem\(LS_SESSION, JSON\.stringify\(current\)\)/.test(sess),
    'C4: NOL tulis sesi-mentah-ke-AsyncStorage (plaintext token mati)');
  ok(/saveAuthTokenStore\(legacyToken\)/.test(sess) && /current === parsed/.test(sess),
    'C4: restore() migrasi token warisan → SecureStore + guard lintas-user');
  ok(/!current\.offline/.test(sess),
    'C4: hidrasi malas menolak sesi offline (offline tak memegang token)');
  ok(/LS_AUTH_TOKEN = 'genfity\.session\.authToken'/.test(sess),
    'C4: kunci salinan token terpisah (bukan LS_SESSION)');

  // 2. Cermin saveSession + buang di loginEmployee/logout.
  ok(/void saveAuthTokenStore\(current\.authToken\)/.test(sess) &&
    /else void clearAuthTokenStore\(\);/.test(sess),
    'C4: saveSession cermin SecureStore (ada=simpan, tanpa=buang anti-basi)');
  ok(/delete current\.authToken;[\s\S]{0,400}?void clearAuthTokenStore\(\);/.test(sess),
    'C4: loginEmployee buang salinan basi (anti bocor lintas-user)');
  ok(/export function logout[\s\S]{0,1500}?void clearAuthTokenStore\(\);/.test(sess),
    'C4: logout buang salinan SecureStore');

  // 3. Jalur token-hilang (klaim acceptance).
  ok(/export function forceLogoutOnTokenLoss\(reason\?: string\)/.test(sess),
    'C4: forceLogoutOnTokenLoss ada');
  ok(/forceLogoutOnTokenLoss[\s\S]{0,1200}?void clearAuthTokenStore\(\);[\s\S]{0,600}?clearGrant\(\);[\s\S]{0,600}?logout\(\);/.test(sess),
    'C4: token-hilang = buang SecureStore + clearGrant + logout');
  ok(/reason: reason \?\? 'token-loss'/.test(sess),
    'C4: revoke token-loss terjejak (beda dari logout normal)');

  // 4. Gerbang requireToken: SATU situs E29-terverifikasi; fallback lestari.
  ok(/opts\?\.requireToken && !authToken/.test(login),
    'C4: completeOnline gerbang requireToken (fail-closed)');
  ok(/forceLogoutOnTokenLoss\('e01-no-token'\)/.test(login) &&
    /throw new Error\('e01-no-token'\)/.test(login),
    "C4: payload-tak-lengkap = logout paksa + lempar 'e01-no-token'");
  ok(/completeOnline\(candidate\.payload, pin, ctx, deviceId, candidate\.username, pv\.pinVersion, undefined, \{ requireToken: true \}\)/.test(login),
    'C4: requireToken:true HANYA di cabang E29-terverifikasi (pv 2xx)');
  ok(/message === 'e01-no-token'\) \{\s*setPinError\(needBeText\(\)\);/.test(login),
    'C4: e01-no-token → pesan need-BE jujur (t(), bukan key mentah)');
  for (const [nm, re] of [
    ['fallback-lokal', /await completeOnline\(candidate\.payload, pin, ctx, deviceId, candidate\.username\);/],
    ['refetch', /await completeOnline\(p, pin, ctx, deviceId, candidate\.username, rpv\.reached \? rpv\.pinVersion : undefined\);/],
    ['takeover', /await completeOnline\(cur\.payload, cur\.pin, ctx, deviceId, uname\);/],
  ]) {
    ok(re.test(login),
      `C4: situs ${nm} ada dan TANPA requireToken (token opsional lestari)`);
  }
  // Tepat 3 kemunculan: definisi opts, gerbang opts?.requireToken, dan SATU
  // situs panggil { requireToken: true } (komentar sudah di-strip).
  ok((login.match(/requireToken/g) || []).length === 3,
    'C4: requireToken tepat 3x (def + gerbang + 1 situs E29) — fallback/refetch/takeover steril');

  // 5. Pembaca bearer sinkron tak tersentuh (sumber = memori).
  ok(/s\?\.authToken \?\? s\?\.authKey/.test(server),
    'C4: server.ts resolveSessionToken tetap authToken-dulu (memori)');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
