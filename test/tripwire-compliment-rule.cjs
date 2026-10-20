// Tripwire OFFLINE-RULE + PP-026 + PP-022 (Sesi-C, gate koordinator):
//  1. OFFLINE-RULE: approval compliment WAJIB online + orderId desimal
//     (create-first). Kartu compliment nonaktif + pesan jelas bila offline /
//     tanpa order; refId kosong DILARANG dikirim (gate 3 lapis: tap,
//     dialog, authorizeSupervisorV1).
//  2. PP-026: saveEditor CashierScreen menolak diskon negatif eksplisit +
//     batas atas nominal = nilai bruto line (padanan jujur ">100%" untuk
//     field Rupiah). Server-side = RESIDU (belum diuji).
//  3. PP-022: watcher takeover K1 statik-ada (startTakeoverWatch +
//     isTakeoverForMe + revokeKickedSession + kicked_msg); bukti perilaku
//     = log E2E takeover (sesi kedua claim, sesi pertama revoke) — bukan
//     klaim file ini.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const readRaw = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const read = (p) => strip(readRaw(p));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  const i18n = readRaw('src/lib/i18n.ts');
  const sup = read('src/lib/supervisor.ts');
  const supRaw = readRaw('src/lib/supervisor.ts');
  const dlg = read('src/components/SupervisorApprovalDialog.tsx');
  const dlgRaw = readRaw('src/components/SupervisorApprovalDialog.tsx');
  const extra = read('src/screens/payment/ExtraPaySection.tsx');
  const extraRaw = readRaw('src/screens/payment/ExtraPaySection.tsx');
  const pay = read('src/screens/payment/PayScreen.tsx');
  const cash = read('src/screens/cashier/CashierScreen.tsx');
  const cashRaw = readRaw('src/screens/cashier/CashierScreen.tsx');

  // 1. Kunci i18n OFFLINE-RULE + PP-026 ada (id+en tak kosong).
  for (const k of ['xp_compliment_offline', 'xp_compliment_no_order', 'sup_v1_refid_need', 'disc_neg', 'disc_over_line']) {
    ok(new RegExp(k + ":\\s*\\{\\s*id:\\s*'[^']+',\\s*en:\\s*'[^']+'").test(i18n),
      'i18n: kunci ' + k + ' ada (id+en)');
  }

  // 2. Gate lib: compliment tanpa refId desimal ditolak SEBELUM kirim.
  ok(/action === SUPERVISOR_ACTION_COMPLIMENT_SETTLE && !isDecimalOrderId\(refId\)/.test(supRaw) &&
    /sup_v1_refid_need/.test(supRaw),
    'supervisor: gate OFFLINE-RULE (tolak kirim refId non-desimal untuk COMPLIMENT_SETTLE)');
  ok(/KECUALI[\s\S]{0,120}COMPLIMENT_SETTLE/.test(supRaw),
    'supervisor: komentar refId boleh-kosong mencatat pengecualian compliment');

  // 3. Dialog: blokir fallback lokal compliment + submit + petunjuk.
  ok(/SUPERVISOR_ACTION_COMPLIMENT_SETTLE/.test(dlg) && /isDecimalOrderId/.test(dlg),
    'dialog: impor konstanta aksi kanonis + validator desimal (tanpa literal)');
  ok(/if \(isCompliment\) \{\s*setMsg\(t\('xp_compliment_offline'\)\);\s*return;\s*\}/.test(dlgRaw) &&
    dlgRaw.indexOf("if (isCompliment)") < dlgRaw.indexOf('verifyLocalEscalation(pin, fallbackAccessKey)'),
    'dialog: fallback lokal DIBLOKIR untuk compliment (pesan offline, sebelum verifyLocalEscalation)');
  ok(/\(!isCompliment \|\| isDecimalOrderId\(refId\)\)/.test(dlg),
    'dialog: canSubmit menolak compliment dengan refId non-desimal');
  ok(/isCompliment && !isDecimalOrderId\(refId\)/.test(dlgRaw) && /sup_v1_refid_need/.test(dlgRaw),
    'dialog: petunjuk sup_v1_refid_need tampil bila refId belum desimal');

  // 4. ExtraPaySection: prop online + tap gate + kartu nonaktif + pesan.
  ok(/orderId\?: string; online\?: boolean \| null/.test(extraRaw),
    'extrapay: prop online?: boolean | null ada');
  ok(/if \(id === 'compliment'\) \{[\s\S]{0,400}xp_compliment_offline/.test(extraRaw) &&
    /if \(!orderIdDecimal\) \{[\s\S]{0,200}xp_compliment_no_order/.test(extraRaw),
    'extrapay: tap compliment ditolak bila offline / tanpa orderId desimal');
  ok(/disabled=\{dis\}/.test(extraRaw) && /cardDisabled/.test(extraRaw) && /opacity: 0\.45/.test(extraRaw),
    'extrapay: kartu compliment nonaktif visual bila diblokir');
  ok(/\{xpMsg \? <Text style=\{styles\.msg\}>\{xpMsg\}<\/Text> : null\}/.test(extraRaw),
    'extrapay: pesan penolakan dirender');
  ok(/<ExtraPaySection online=\{online\} onDone/.test(readRaw('src/screens/payment/PayScreen.tsx')),
    'payscreen: online diteruskan ke ExtraPaySection');
  void pay;

  // 5. PP-026: negatif eksplisit + cap line + pesan + reset.
  ok(/if \(\/-\/\.test\(raw\)\) \{\s*setDiscMsg\(t\('disc_neg'\)\);\s*return;\s*\}/.test(cashRaw),
    'cashier: diskon negatif DITOLAK eksplisit (bukan silent-clamp)');
  ok(/lineGross/.test(cash) && /if \(disc > lineGross\) \{\s*setDiscMsg\(t\('disc_over_line'\)\);\s*return;\s*\}/.test(cashRaw),
    'cashier: diskon > nilai bruto line DITOLAK (padanan >100% untuk nominal)');
  ok(/Math\.max\(0,/.test(cash) && /\{discMsg \? <Text style=\{styles\.editorErr\}>\{discMsg\}<\/Text> : null\}/.test(cashRaw),
    'cashier: parse non-negatif dipertahankan + pesan dirender (editorErr)');
  ok(/setDiscMsg\(''\)/.test(cash) && /RESIDU/.test(cashRaw),
    'cashier: pesan direset saat buka/sukses + RESIDU server-side dicatat jujur');

  // 6. PP-022 statik: rantai watcher kick utuh (perilaku dibuktikan log E2E).
  const app = read('App.tsx');
  const sess = read('src/session.ts');
  ok(/startTakeoverWatch/.test(app) && /isTakeoverForMe/.test(app) && /revokeKickedSession/.test(app) && /kicked_msg/.test(app),
    'pp022: App watcher (startTakeoverWatch + isTakeoverForMe + revoke + kicked_msg) ada');
  ok(/revokeKickedSession/.test(sess) && /clearGrant/.test(sess) && /current\s*=\s*null/.test(sess),
    'pp022: revokeKickedSession membersihkan sesi + grant (tanpa lempar)');
  ok(/tookOver/.test(readRaw('src/screens/auth/LoginScreen.tsx')) && /last-writer-wins/.test(readRaw('src/lib/terminalContract.ts')),
    'pp022: sisi penendang (tookOver) + kontrak last-writer-wins terdokumentasi');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  for (const f of r.failures) console.log('FAIL ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
