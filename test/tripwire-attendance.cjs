// Tripwire absensi/shift (S9/PP-010): jaga keputusan eksplisit yang tak boleh
// regresi tanpa ketahuan CI — dicek statik dari sumber (tanpa runtime RN):
//  1. AttendanceScreen OFFLINE-ONLY eksplisit (tanpa POST clock BE; banner jujur).
//  2. Gerbang absensi buka-shift (paritas gerbang tutup-shift).
//  3. Ganti PIN tetap jujur (server bila online + antre bila offline).
// Putusan owner 20-Okt: offline-only = FINAL (PP-010 PARTIAL-by-design).
// Wiring BE (clock-in/out+GPS+attendance_enabled) DIPARKIR — prereq hilang:
// B1 token-compat, B2 on-behalf binding, B3 expo-location. Jangan wire parsial.
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

  const i18nRaw = readRaw('lib/i18n.ts');
  const attRaw = readRaw('screens/shift/AttendanceScreen.tsx');
  const att = read('screens/shift/AttendanceScreen.tsx');
  const shift = read('screens/shift/ShiftScreen.tsx');
  const endShift = read('screens/shift/EndShiftScreen.tsx');

  // 1. Banner offline-only: kunci id+en + dipakai layar.
  ok(/att_offline_only:\s*\{\s*id:\s*'[^']+',\s*en:\s*'[^']+'/.test(i18nRaw),
    'i18n: att_offline_only id+en ada');
  ok(/t\('att_offline_only'\)/.test(att),
    'attendance: banner offline-only eksplisit dirender');
  // 2. Tanpa POST clock BE dari layar (MerchantAuth/titip/GPS belum diputuskan
  //    owner — panggil buta = risiko logout-401 + clock atas user salah).
  //    Cek sumber TANPA komentar (alasan offline-only didokumentasikan di
  //    komentar — itu bukan pemanggilan).
  ok(!/workforce\/shifts\/clock/.test(att),
    'attendance: NOL POST workforce clock BE (offline-only eksplisit)');
  // 3. Gerbang absensi buka-shift: absen-hari-ini milik pembuka, pesan = tautan.
  ok(/shf_att_link/.test(shift) && /status = 'absen'/.test(shift) && /clockedToday/.test(shift),
    'shift: buka-shift digerbang absensi hari-ini (paritas tutup-shift)');
  // 4. Gerbang tutup-shift dipertahankan (regresi = shift tutup tanpa absen).
  ok(/endshift_no_attendance/.test(endShift),
    'endshift: gerbang absensi tutup-shift dipertahankan');
  // 5. Ganti PIN jujur: coba server (timeout) + selalu antre pin-change.
  ok(/updatePinOnServer/.test(att) && /pin-change/.test(att),
    'attendance: ganti PIN server-bila-online + antre (tanpa sukses palsu)');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  for (const f of r.failures) console.log('FAIL ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
