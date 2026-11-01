// Tripwire countdown 423 PIN-lockout (BE Retry-After + retryAfter body):
// jaga agar wiring countdown tak regresi tanpa ketahuan CI — dicek statik
// dari sumber (tanpa runtime RN):
//  1. Helper lib/pinLockout diekspor (parse header, baca body, suffix).
//  2. LoginScreen meneruskan header Retry-After stage-A + suffix pada
//     PIN_LOCKED (kedua cabang staged) dan USER_PIN_LOCKED (E29).
//  3. terminalApi.pinVerifyTerminalPin membawa retryAfterSec di cabang gagal.
//  4. supervisor memakai countdown server untuk pesan locked.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  const helper = readRaw('lib/pinLockout.ts');
  const login = readRaw('screens/auth/LoginScreen.tsx');
  const tapi = readRaw('lib/terminalApi.ts');
  const sup = readRaw('lib/supervisor.ts');

  // 1. Helper countdown ada dan defensif (tak pernah melempar).
  ok(/export function parseRetryAfterSeconds/.test(helper) && /export function bodyRetryAfterSeconds/.test(helper) && /export function lockCountdownSuffix/.test(helper),
    'pinLockout: parseRetryAfterSeconds + bodyRetryAfterSeconds + lockCountdownSuffix diekspor');
  // 2. Stage-A: header dibaca dari Response mentah (apiPost), disalurkan ke
  //    kedua cabang staged-PIN + E29.
  ok(/parseRetryAfterSeconds\(res\.headers/.test(login),
    'LoginScreen: Retry-After dibaca dari header Response stage-A');
  ok(/first\.retryAfterSec/.test(login) && /second\.retryAfterSec/.test(login),
    'LoginScreen: retryAfterSec dipakai di kedua cabang staged-PIN');
  ok(/pv\.retryAfterSec/.test(login) && /USER_PIN_LOCKED/.test(login) && /lockCountdownSuffix\(pv\.retryAfterSec/.test(login),
    'LoginScreen: E29 USER_PIN_LOCKED menampilkan suffix countdown');
  ok(/loginErr\.code === 'PIN_LOCKED' \? lockCountdownSuffix/.test(login),
    'LoginScreen: suffix hanya pada kode PIN_LOCKED (bukan REQUIRED/INVALID)');
  // 3. E29 inti membawa countdown lewat wrapper yang menghilangkan header.
  ok(/retryAfterSec: readTerminalErrorRetryAfter\(raw\)/.test(tapi),
    'terminalApi: cabang gagal pin-verify membawa retryAfterSec dari body');
  // 4. Supervisor: countdown server jujur di pesan (tanpa ubah throttle).
  ok(/bodyRetryAfterSeconds\(r\.data\)/.test(sup) && /locked\(serverRetrySec\)/.test(sup),
    'supervisor: countdown server diteruskan ke pesan locked');
  ok(/const LOCK_MS = 60_000/.test(sup) && /const MAX_ATTEMPTS = 5/.test(sup),
    'supervisor: throttle lokal tak berubah (hanya pesan yang memakai countdown server)');

  return { checks, failures };
}

module.exports = run;
