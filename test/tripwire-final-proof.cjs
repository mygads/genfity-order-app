// Tripwire SESI-FINAL-APP K3: payment proof wajib (merchant requirePaymentProof).
// Kunci statik (tanpa runtime RN — dicek dari sumber):
//  P-01: state proof (requireProof/proofUri/proofUrl/proofBusy) + cache
//        getRequirePaymentProof saat mount (absen = OFF = perilaku lama).
//  P-02: takeProof via ImagePicker (kamera→galeri) + preparePhoto (tanpa dep baru).
//  P-03: goSuccessGated gerbang proof — metode GO-mirrored + requireProof:
//        upload-dulu bila ada proofUri; tanpa proofUrl = HOLD + banner
//        (TANPA goSuccess, TANPA Success palsu).
//  P-04: proofUrl ditempel ke settlePosPayment + antrean GO_OP_SETTLE.
//  P-05: renderProof + styles (kartu + pratinjau + status) dirender di ScrollView.
//  P-06: lane BLOCKED (deposit/member/transfer, tanpa padanan enum) = tanpa
//        proof-gate (PARKED jujur: proof tak bisa ditempel tanpa settle).
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

  const pay = read('screens/payment/PayScreen.tsx');
  const payRaw = readRaw('screens/payment/PayScreen.tsx');

  // ---- P-01: state + cache ----
  ok(/const \[requireProof, setRequireProof\]/.test(pay),
    'P-01: state requireProof ada');
  ok(/const \[proofUri, setProofUri\]/.test(pay) && /const \[proofUrl, setProofUrl\]/.test(pay) && /const \[proofBusy, setProofBusy\]/.test(pay),
    'P-01: state proofUri/proofUrl/proofBusy ada');
  ok(/getRequirePaymentProof/.test(pay),
    'P-01: baca cache getRequirePaymentProof saat mount (absen=OFF)');

  // ---- P-02: capture ----
  ok(/ImagePicker\.launchCameraAsync/.test(pay) && /ImagePicker\.launchImageLibraryAsync/.test(pay),
    'P-02: takeProof kamera→galeri (tanpa dep baru)');
  ok(/preparePhoto\(a\.uri, a\.width, a\.height\)/.test(payRaw),
    'P-02: resize via preparePhoto (cermin ExpenseScreen)');

  // ---- P-03: gate ----
  ok(/if \(requireProof\)/.test(pay),
    'P-03: goSuccessGated gerbang requireProof');
  ok(/uploadExpensePhotoFirst\(proofUri\)/.test(payRaw),
    'P-03: upload-dulu saat ada proofUri (endpoint upload K1)');
  ok(/pay_proof_upload_fail/.test(pay) && /pay_proof_required/.test(pay),
    'P-03: tanpa proofUrl = HOLD + banner (bukan goSuccess)');
  ok(/if \(!url\) \{/.test(payRaw),
    'P-03: url kosong = return sebelum PIN/goSuccess (tanpa Success palsu)');

  // ---- P-04: threading ----
  ok(/proofClean/.test(pay) && /proofUrl: proofClean/.test(pay),
    'P-04: proofUrl https≤2048 ditempel ke settlePosPayment');
  ok(/GO_OP_SETTLE/.test(pay) && /proofUrl: proofClean/.test(payRaw),
    'P-04: proofUrl ikut antrean GO_OP_SETTLE (drain finalisasi DENGAN bukti)');

  // ---- P-05: UI ----
  ok(/const renderProof = \(\) =>/.test(payRaw),
    'P-05: renderProof ada');
  ok(/\{renderProof\(\)\}/.test(payRaw),
    'P-05: renderProof dipanggil di ScrollView');
  ok(/proofCard/.test(pay) && /proofImg/.test(pay) && /proofOk/.test(pay),
    'P-05: styles proofCard/proofImg/proofOk ada');
  ok(/pay_proof_take/.test(pay) && /pay_proof_retake/.test(pay) && /pay_proof_uploaded/.test(pay) && /pay_proof_uploading/.test(pay),
    'P-05: kunci i18n proof dipakai di UI');

  // ---- P-06: BLOCKED lanes skip ----
  ok(/if \(!mapPayMethodToBe\(method\)\)/.test(payRaw),
    'P-06: lane BLOCKED (deposit/member) tanpa proof-gate (PARKED jujur)');

  return { failures, checks };
}

module.exports = { run };
