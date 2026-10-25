// Tripwire SESI-FINAL-APP K2: expense foto upload-dulu + retry pending.
// Kunci statik (tanpa runtime RN — dicek dari sumber):
//  E-01: uploadExpensePhotoFirst — pakai uploadTerminalFile K1, unbound/
//        non-real/https = '' jujur (tanpa sukses palsu), URL dipotong 2048.
//  E-02: clearPhotoPending + listPhotoPending (indeks storage, terbatas).
//  E-03: retryPendingExpensePhotos — re-post idempoten clientExpenseId SAMA,
//        pending lunas HANYA saat server gema photoUrl / duplikat sukses;
//        DB lokal dimutakhirkan ke URL remote; tak pernah melempar.
//  E-04: ExpenseScreen — upload-dulu sebelum handoff, DB lokal → URL remote,
//        banner photoUploadFail saat gagal, retry saat mount + fokus.
//  E-05: PettyCashFormScreen — upload-dulu, finalPhoto/finalPending di layar
//        hasil, retry saat mount.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$').replace(/\/\*[\s\S]*?\*\//g, '');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // ---- E-01: upload-first helper ----
  const lib = read('lib/terminalExpense.ts');
  const libRaw = readRaw('lib/terminalExpense.ts');
  ok(/export async function uploadExpensePhotoFirst/.test(lib),
    'E-01: uploadExpensePhotoFirst diekspor');
  ok(/uploadTerminalFile/.test(lib),
    'E-01: upload via uploadTerminalFile K1 (bukan fetch mentah baru)');
  ok(/boundTerminalId\(\)/.test(lib) && /getApiMode\(\) !== 'real'/.test(lib),
    'E-01: unbound/non-real = gagal jujur (tanpa sukses palsu)');
  ok(/isRemotePhoto\(src\)/.test(libRaw),
    'E-01: uri sudah-remote bukan tugas uploader');
  ok(!/photoPending.*PARKED|PARKED.*photoPending/.test(libRaw) || /SESI-FINAL-APP/.test(libRaw),
    'E-01: komentar PARKED lama diperbarui (kontrak K1)');

  // ---- E-02: pending index helpers ----
  ok(/export async function clearPhotoPending/.test(lib),
    'E-02: clearPhotoPending diekspor');
  ok(/export async function listPhotoPending/.test(lib),
    'E-02: listPhotoPending diekspor (terbatas)');

  // ---- E-03: retry ringan ----
  ok(/export async function retryPendingExpensePhotos/.test(lib),
    'E-03: retryPendingExpensePhotos diekspor');
  ok(/clientExpenseId/.test(lib) && /slice\(3\)/.test(libRaw),
    'E-03: re-post idempoten clientExpenseId SAMA (EX- dikupas)');
  ok(/h\.duplicate/.test(lib) && /echoed/.test(lib),
    'E-03: pending lunas HANYA saat gema photoUrl / duplikat sukses');
  ok(/UPDATE tr_branchexpense SET photoPath/.test(libRaw) && /UPDATE tr_branchexpensedocument SET docPath/.test(libRaw),
    'E-03: DB lokal dimutakhirkan ke URL remote');
  ok(/catch \{\s*\/\* lanjut baris berikut \*\//.test(libRaw) || /lanjut baris berikut/.test(libRaw),
    'E-03: satu baris gagal tak menggugurkan antrean (tak melempar)');

  // ---- E-04: ExpenseScreen ----
  const exp = read('screens/cash/ExpenseScreen.tsx');
  const expRaw = readRaw('screens/cash/ExpenseScreen.tsx');
  ok(/uploadExpensePhotoFirst/.test(exp) && /retryPendingExpensePhotos/.test(exp),
    'E-04: ExpenseScreen impor upload-first + retry');
  ok(/remotePhoto = await uploadExpensePhotoFirst/.test(expRaw),
    'E-04: upload-DULU sebelum handoff (bukan photoPending-only)');
  ok(/UPDATE tr_branchexpense SET photoPath/.test(expRaw),
    'E-04: baris lokal dimutakhirkan ke URL remote');
  ok(/expense\.photoUploadFail/.test(expRaw),
    'E-04: banner upload-fail jujur (bukan sukses palsu)');
  ok(/addListener\?\.\('focus'/.test(expRaw) && /retryPendingExpensePhotos\(\)\.then/.test(expRaw),
    'E-04: retry saat mount + fokus (daftar dimuat ulang bila ada yang lunas)');

  // ---- E-05: PettyCashFormScreen ----
  const petty = read('screens/cash/PettyCashFormScreen.tsx');
  const pettyRaw = readRaw('screens/cash/PettyCashFormScreen.tsx');
  ok(/uploadExpensePhotoFirst/.test(petty) && /retryPendingExpensePhotos/.test(petty),
    'E-05: PettyCashForm impor upload-first + retry');
  ok(/remotePhoto = await uploadExpensePhotoFirst/.test(pettyRaw),
    'E-05: upload-DULU sebelum handoff');
  ok(/finalPhoto/.test(petty) && /finalPending/.test(petty),
    'E-05: layar hasil pakai finalPhoto/finalPending (URL remote bila sukses)');

  return { failures, checks };
}

module.exports = { run };
