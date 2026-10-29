// Tripwire R4-4: snapshot metode bayar server → filter PayScreen (APP side).
// Kunci RUNTIME (tanpa RN — parser murni, diuji dari sumber asli) + STATIK:
//  PM-01: absen (BE lama) = semua-true = tampil semua (NOL-regresi).
//  PM-02: toleran flat + nested (pos/*Behavior*/payment*) + snake_case;
//          string asing = absen (fail-visible, kasir tak terkunci).
//  PM-03: semua-false → yang digerbang (QRIS) tersembunyi, yang wajib
//          (tunai/member + dompet lain) tetap tampil.
//  PM-04: server-wins menimpa cache (tulis tanpa syarat, bukan seed-once).
//  PM-05: wiring terminalApi (pos-config) + posConfigSync (cache) + PayScreen
//          (kartu QRIS + reset pilihan).
//  PM-06: docs SoT (a) jam display-only, (b) preset advisory, (c) device-local.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
// NB: strip komentar TANPA merusak pola regex di dalam string (urutan:
// baris-komentar dulu, lalu blok — cermin tripwire-poswire-w2).
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

const ALL_TRUE = {
  payAtCashierEnabled: true,
  manualTransferEnabled: true,
  qrisEnabled: true,
  codEnabled: true,
  gpayEnabled: true,
};
const ALL_FALSE = {
  payAtCashierEnabled: false,
  manualTransferEnabled: false,
  qrisEnabled: false,
  codEnabled: false,
  gpayEnabled: false,
};

function loadRuntime() {
  // Transpile sumber ASLI (bukan salinan) → muat → uji perilaku nyata.
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  const src = readRaw('lib/paymentMethods.ts');
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', out.outputText)(mod, mod.exports);
  return mod.exports;
}

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };
  const eq = (a, b) => {
    try {
      assert.deepStrictEqual(a, b);
      return true;
    } catch {
      return false;
    }
  };

  const rt = loadRuntime();
  ok(typeof rt.parsePaymentMethods === 'function' && typeof rt.filterOnlineWallets === 'function',
    'PM-00: parsePaymentMethods + filterOnlineWallets diekspor (murni)');
  ok(eq(rt.PAYMENT_METHODS_DEFAULT, ALL_TRUE),
    'PM-00: default = semua-true (tampil semua)');

  // ---- PM-01: absen = semua tampil ----
  for (const [label, v] of [['undefined', undefined], ['null', null], ['{}', {}], ['{pos:{}}', { pos: {} }], ['string', 'acak'], ['array', []]]) {
    let got;
    try {
      got = rt.parsePaymentMethods(v);
    } catch {
      got = null;
    }
    ok(eq(got, ALL_TRUE), `PM-01: absen (${label}) → semua-true (BE lama tampil semua)`);
  }

  // ---- PM-02: toleran bentuk ----
  ok(eq(rt.parsePaymentMethods({ pos: { paymentMethods: { qris_enabled: false } } }),
    { ...ALL_TRUE, qrisEnabled: false }),
    'PM-02: nested pos.paymentMethods + snake_case terbaca');
  ok(eq(rt.parsePaymentMethods({ codEnabled: false }), { ...ALL_TRUE, codEnabled: false }),
    'PM-02: flat camelCase terbaca');
  ok(eq(rt.parsePaymentMethods({ posBehaviorSettings: { paymentMethods: { manual_transfer_enabled: false, gpayEnabled: false } } }),
    { ...ALL_TRUE, manualTransferEnabled: false, gpayEnabled: false }),
    'PM-02: nested posBehaviorSettings.paymentMethods terbaca');
  ok(eq(rt.parsePaymentMethods({ payment_settings: { pay_at_cashier_enabled: 'tidak' } }),
    { ...ALL_TRUE, payAtCashierEnabled: false }),
    "PM-02: string 'tidak' = false; snake nested payment_settings terbaca");
  ok(eq(rt.parsePaymentMethods({ paymentMethods: { qrisEnabled: 'ngawur' } }), ALL_TRUE),
    'PM-02: string asing = absen = true (fail-visible, bukan kunci-buta)');
  ok(eq(rt.parsePaymentMethods({ paymentMethods: { qrisEnabled: 0 } }),
    { ...ALL_TRUE, qrisEnabled: false }),
    'PM-02: angka 0 = false');
  // ---- Q4: paymentSettings EFEKTIF menang atas paymentMethods MENTAH ----
  // (putusan owner 25-Okt: satukan ke key efektif; mentah deprecated R4-4).
  ok(eq(rt.parsePaymentMethods({ paymentSettings: { qrisEnabled: false }, paymentMethods: { qrisEnabled: true } }),
    { ...ALL_TRUE, qrisEnabled: false }),
    'Q4-1: konflik qris, paymentSettings efektif menang (false)');
  ok(eq(rt.parsePaymentMethods({ paymentSettings: { qrisEnabled: true }, paymentMethods: { qrisEnabled: false } }),
    ALL_TRUE),
    'Q4-2: konflik qris, efektif true menimpa mentah false');
  ok(eq(rt.parsePaymentMethods({ paymentSettings: { qrisEnabled: false }, paymentMethods: { gpayEnabled: false, qrisEnabled: true } }),
    { ...ALL_TRUE, qrisEnabled: false, gpayEnabled: false }),
    'Q4-3: gap-fill, gpay (hanya di mentah) ikut false; qris ikut efektif');
  ok(eq(rt.parsePaymentMethods({ paymentMethods: { codEnabled: false } }),
    { ...ALL_TRUE, codEnabled: false }),
    'Q4-4: efektif absen, mentah fallback (cod false)');
  ok(eq(rt.parsePaymentMethods({ paymentSettings: {}, pos: {} }),
    ALL_TRUE),
    'Q4-5: efektif+mentah kosong, semua-true (legacy tampil)');
  ok(eq(rt.parsePaymentMethods({ payment_settings: { manual_transfer_enabled: 'tidak' }, paymentMethods: { manualTransferEnabled: true } }),
    { ...ALL_TRUE, manualTransferEnabled: false }),
    'Q4-6: snake payment_settings efektif menang atas mentah camel');

  // ---- PM-03: semua-false → gerbang jelas saja; wajib tetap tampil ----
  // P1-FINAL: gpayEnabled=false ikut menyembunyikan kartu gpay/genfity_pay/
  // gopay (ambigu GoPay-vs-Genfity-Pay diselesaikan: id Genfity Pay digerbang).
  const wallets = [{ id: 'ovo' }, { id: 'gopay' }, { id: 'qris' }, { id: 'dana' }, { id: 'genfity_pay' }];
  const cut = rt.filterOnlineWallets(wallets, ALL_FALSE);
  ok(eq(cut, [{ id: 'ovo' }, { id: 'dana' }]),
    'PM-03: semua-false → QRIS + gpay/gopay/genfity_pay tersembunyi, ovo/dana tampil');
  ok(eq(rt.filterOnlineWallets(wallets, ALL_TRUE), wallets),
    'PM-03: semua-true → daftar utuh (NOL-regresi)');
  ok(eq(rt.filterOnlineWallets(wallets, { ...ALL_TRUE, gpayEnabled: false }),
    [{ id: 'ovo' }, { id: 'qris' }, { id: 'dana' }]),
    'PM-03: gpay false saja → hanya kartu gpay-family hilang, QRIS tampil');
  const pay = read('screens/payment/PayScreen.tsx');
  ok(!/payAtCashierEnabled|manualTransferEnabled|codEnabled/.test(pay),
    'PM-03: tab tunai/member/lainnya TAK digerbang flag ambigu (wajib tampil)');
  ok(/gpayEnabled/.test(pay) && /qrisEnabled/.test(pay),
    'PM-03: hanya 2 gerbang JELAS (qris + gpay) dipakai PayScreen');

  // ---- PM-04: server-wins menimpa cache ----
  // Parser stateless + tulis-tanpa-syarat: payload server selalu menang.
  let cache = rt.parsePaymentMethods({});
  cache = { ...cache, ...rt.parsePaymentMethods({ paymentMethods: ALL_FALSE }) };
  ok(eq(cache, ALL_FALSE), 'PM-04: server false menimpa cache true (server-wins)');
  cache = { ...cache, ...rt.parsePaymentMethods({}) };
  ok(eq(cache, ALL_TRUE), 'PM-04: server absen (BE lama) mengembalikan tampil-semua');
  const sync = read('lib/posConfigSync.ts');
  const syncRaw = readRaw('lib/posConfigSync.ts');
  ok(/PAYMENT_METHODS_KEY = 'genfity\.pos\.paymentMethods'/.test(syncRaw),
    'PM-04: cache key genfity.pos.paymentMethods');
  ok(/setJSON\(PAYMENT_METHODS_KEY, r\.data \?\? \{\}\)/.test(syncRaw),
    'PM-04: sync tulis RAW TANPA SYARAT (server-wins; parse ditunda ke pembaca agar sinyal absen utuh)');
  ok(/export async function getPaymentMethods/.test(sync),
    'PM-04: getPaymentMethods diekspor modul posConfig');
  ok(/from ['"]\.\/paymentMethods['"]/.test(syncRaw),
    'PM-04: posConfig memakai parser murni paymentMethods (pola parsePayTabs)');

  // ---- PM-07: raw-store → strict fail-closed untuk layar baru (P1-FINAL) ----
  // Menyimpan hasil parse menghancurkan sinyal "absen" (parse selalu isi 5
  // boolean) → hasExplicitPaymentSnapshot selalu true → banner tak tampil.
  ok(rt.hasExplicitPaymentSnapshot({}) === false,
    'PM-07: raw kosong (BE lama) = tanpa snapshot eksplisit');
  ok(rt.hasExplicitPaymentSnapshot({ paymentMethods: { qrisEnabled: false } }) === true,
    'PM-07: raw berisi kunci = snapshot eksplisit');
  ok(eq(rt.parsePaymentMethodsStrict({}).methods, ALL_FALSE),
    'PM-07: strict + raw kosong = semua-false (fail-closed layar baru)');
  ok(rt.parsePaymentMethodsStrict({}).hasExplicitSnapshot === false,
    'PM-07: strict + raw kosong menandai butuh-sync');
  ok(eq(rt.parsePaymentMethodsStrict({ paymentMethods: ALL_TRUE }).methods, ALL_TRUE),
    'PM-07: strict + raw eksplisit = nilai server dipakai');

  // ---- PM-05: wiring ujung-ke-ujung ----
  const term = read('lib/terminalApi.ts');
  const termRaw = readRaw('lib/terminalApi.ts');
  ok(/paymentMethods: PaymentMethods/.test(term),
    'PM-05: TerminalPosConfig membawa paymentMethods');
  ok(/paymentMethods: parsePaymentMethods\(data\)/.test(term),
    'PM-05: fetchTerminalPosConfig parse snapshot (BE lama = default)');
  ok(/from ['"]\.\/paymentMethods['"]/.test(termRaw),
    'PM-05: terminalApi impor parser murni (tanpa siklus)');
  const payRaw = readRaw('screens/payment/PayScreen.tsx');
  ok(/getPaymentMethods/.test(pay) && /filterOnlineWallets/.test(pay),
    'PM-05: PayScreen konsumsi getPaymentMethods + filterOnlineWallets');
  ok(/visibleWallets\.map/.test(pay),
    'PM-05: grid online render visibleWallets (bukan WALLETS mentah)');
  ok(/w === 'qris' \? null/.test(payRaw),
    'PM-05: pilihan QRIS terpilih direset bila server menonaktifkan susulan');

  // ---- PM-06: docs SoT (komentar, NOL perilaku) ----
  ok(/R4-DOCS\(a\)/.test(readRaw('lib/timezone.ts')) && /DISPLAY-ONLY/.test(readRaw('lib/timezone.ts')),
    'PM-06a: jam operasional = display-only (timezone.ts; bukan IdleScreen karena kunci W1-05)');
  ok(/R4-DOCS\(b\)/.test(readRaw('lib/cancelReasons.ts')) && /FREE-TEXT/.test(readRaw('lib/cancelReasons.ts')),
    'PM-06b: cancel preset = advisory, server simpan free-text');
  ok(/R4-DOCS\(c\)/.test(readRaw('screens/settings/MenuPrintingScreen.tsx')) && /DEVICE-LOCAL/.test(readRaw('screens/settings/MenuPrintingScreen.tsx')),
    'PM-06c: menu-print routing = device-local (MenuPrintingScreen)');

  return { failures, checks };
}

module.exports = { run };
