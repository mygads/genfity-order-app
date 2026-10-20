// Tripwire PARKIR eskalasi-PIN (C6, SESI-C APP): kunci statik bahwa jalur
// verifikasi PIN hanya-hash-lokal di verifyOwnerOverridePin (LoginScreen)
// SENGAJA dipertahankan (PARKIR, bukan dead-code) untuk login offline —
// dengan pengaman berlapis yang tak boleh dilepas diam-diam:
//  1. Marker PARKIR + owner-need E29 (keputusan kebijakan offline) ada di kode.
//  2. Server-menang-bila-terjangkau: penolakan eksplisit E29 (INVALID/LOCKED)
//     = return gagal TANPA fallback lokal (lockout server tak bisa di-bypass).
//  3. Fallback lokal SELALU diikuti gerbang owner-only requireEscalationAccess
//     (PIN staff biasa/typo bukan owner → gagal).
//  4. Throttle brute-force pin.ts utuh (5x salah → kunci 60 dtk).
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

  const loginRaw = readRaw('screens/auth/LoginScreen.tsx');
  const login = read('screens/auth/LoginScreen.tsx');
  const pin = read('lib/pin.ts');

  // 1. Marker PARKIR + owner-need E29 (komentar — baca mentah).
  ok(/C6 \(SESI-C, PARKIR/.test(loginRaw),
    'C6: marker PARKIR ada di jalur fallback (bukan dead-code)');
  ok(/owner-need E29/.test(loginRaw),
    'C6: owner-need E29 tercatat (keputusan kebijakan offline menunggu owner)');
  ok(/tripwire-pin-escalation-parkir\.cjs/.test(loginRaw),
    'C6: marker menunjuk tripwire pelindung ini');

  // 2. Server menang bila terjangkau (tanpa fallback lokal).
  ok(/Server menolak eksplisit[\s\S]{0,300}?return \{ ok: false \};/.test(loginRaw),
    'C6: penolakan E29 eksplisit = gagal langsung (lockout tak bisa di-bypass)');
  ok(/USER_PIN_NOT_SET/.test(login) && /NOT_SET → lanjut cek lokal/.test(loginRaw),
    'C6: HANYA NOT_SET (belum enroll) yang lanjut ke cek lokal');

  // 3. Fallback lokal selalu di bawah gerbang owner-only.
  ok(/v = await verifyAttendancePin\(clean\)[\s\S]{0,600}?requireEscalationAccess\(v\.userId, 'settings\.edit'\)/.test(login),
    'C6: hash-lokal SELALU diikuti gerbang requireEscalationAccess owner-only');
  ok(/if \(!gate\.ok\) return \{ ok: false \};/.test(login),
    'C6: gerbang gagal = override gagal (jalur normal yang memverdict)');

  // 4. Throttle anti-brute-force utuh.
  ok(/PIN_MAX_ATTEMPTS = 5/.test(pin) && /PIN_LOCK_MS = 60_000/.test(pin),
    'C6: throttle 5x/60 dtk pin.ts utuh (perisai fallback offline)');
  ok(/pinAttempts \+= 1/.test(pin),
    'C6: tebakan salah membakar attempt (throttle hidup)');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
