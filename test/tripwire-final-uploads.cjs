// Tripwire SESI-FINAL-APP K1: kontrak upload terminal + flag requirePaymentProof
// + proofUrl plumbing (posWire/settleMirror) + kunci i18n pay_proof_*.
// Kunci statik (tanpa runtime RN — dicek dari sumber):
//  U-01: kontrak transport ApiPath.terminalUploads (POST multipart, 201 {url}).
//  U-02: uploadTerminalFile — FormData {file{uri,name,type}}, X-Terminal-Code/
//        X-Branch-Id + bearer lazy, timeout, parse 201 {url} toleran, fail
//        jujur (non-real/https-sudah/offline = ok:false, tanpa sukses palsu).
//  U-03: TerminalPosConfig.requirePaymentProof + parseRequirePaymentProof
//        toleran (top-level + nested posBehavior/payment + snake_case; absen=OFF).
//  U-04: posConfigSync cache REQUIRE_PROOF + getRequirePaymentProof (OFF default).
//  U-05: SettleInput.proofUrl + body thread + 409 PROOF_REQUIRED passthrough;
//        settleMirror.proofUrl aditif (settle + antrean GO_OP_SETTLE).
//  U-06: kunci i18n pay_proof_* + expense.photoAttached/photoUploadFail dwibahasa.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
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

  // ---- U-01: kontrak transport ----
  const server = read('config/server.ts');
  ok(/terminalUploads:\s*'api\/v1\/terminals\/\{id\}\/uploads'/.test(server),
    'U-01: ApiPath.terminalUploads = api/v1/terminals/{id}/uploads');

  // ---- U-02: uploadTerminalFile ----
  const tapi = read('lib/terminalApi.ts');
  const tapiRaw = readRaw('lib/terminalApi.ts');
  ok(/export async function uploadTerminalFile/.test(tapi),
    'U-02: uploadTerminalFile diekspor');
  ok(/new FormData\(\)/.test(tapi) && /form\.append\('file'/.test(tapi),
    'U-02: multipart FormData {file}');
  ok(/X-Terminal-Code/.test(tapi) && /X-Branch-Id/.test(tapi),
    'U-02: header terminal-code + branch-id');
  ok(/201/.test(tapi) && /readUploadUrl/.test(tapi),
    'U-02: 201 {url} diparse toleran');
  ok(/getApiMode\(\) !== 'real'/.test(tapi),
    'U-02: mode non-real = ok:false (tanpa sukses palsu)');
  ok(/\^https\?:/.test(tapiRaw) || /https\?:\\\/\\\//.test(tapiRaw),
    'U-02: uri sudah-remote bukan tugas uploader');
  ok(/25000/.test(tapiRaw),
    'U-02: timeout upload 25 dtk');

  // ---- U-03: requirePaymentProof parse ----
  ok(/requirePaymentProof: boolean/.test(tapi),
    'U-03: TerminalPosConfig.requirePaymentProof ada');
  ok(/export function parseRequirePaymentProof/.test(tapi),
    'U-03: parseRequirePaymentProof diekspor');
  ok(/paymentSettings/.test(tapi) && /require_payment_proof/.test(tapi),
    'U-03: parser baca nested payment + snake_case (absen=OFF)');

  // ---- U-04: posConfigSync cache ----
  const sync = read('lib/posConfigSync.ts');
  ok(/REQUIRE_PROOF_KEY/.test(sync) && /genfity\.pos\.requireProof/.test(readRaw('lib/posConfigSync.ts')),
    'U-04: cache genfity.pos.requireProof ditulis saat sync');
  ok(/export async function getRequirePaymentProof/.test(sync),
    'U-04: getRequirePaymentProof diekspor (absen=OFF)');

  // ---- U-05: proofUrl plumbing ----
  const wire = read('lib/posWire.ts');
  const wireRaw = readRaw('lib/posWire.ts');
  ok(/proofUrl\?: string/.test(wire),
    'U-05: SettleInput.proofUrl ada');
  ok(/proofClean/.test(wire) && /proofUrl: proofClean/.test(wire),
    'U-05: proofUrl https≤2048 diteruskan ke body (lainnya dihilangkan)');
  ok(/PROOF_REQUIRED/.test(wireRaw),
    'U-05: 409 PROOF_REQUIRED dilewatkan (bukan Success palsu)');
  const mir = read('lib/settleMirror.ts');
  ok(/proofUrl\?: string/.test(mir) && /proofClean/.test(mir),
    'U-05: settleMirror proofUrl aditif (settle + antrean GO_OP_SETTLE)');

  // ---- U-06: i18n ----
  const i18n = readRaw('lib/i18n.ts');
  for (const k of ['pay_proof_required', 'pay_proof_title', 'pay_proof_take',
    'pay_proof_retake', 'pay_proof_uploading', 'pay_proof_uploaded',
    'pay_proof_upload_fail', 'pay_proof_hold']) {
    ok(new RegExp(k + ": \\{ id: '[^']+', en: '[^']+' \\}").test(i18n),
      `U-06: ${k} dwibahasa (id+en)`);
  }
  ok(/'expense\.photoAttached': \{ id: '[^']+', en: '[^']+' \}/.test(i18n),
    'U-06: expense.photoAttached dwibahasa');
  ok(/'expense\.photoUploadFail': \{ id: '[^']+', en: '[^']+' \}/.test(i18n),
    'U-06: expense.photoUploadFail dwibahasa');

  return { failures, checks };
}

module.exports = { run };
