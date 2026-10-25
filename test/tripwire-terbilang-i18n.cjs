// Tripwire PP-013 (terbilang + i18n minim): kunci dua acceptance tanpa
// runtime RN — dicek statik dari sumber:
//  1. Terbilang-ID tak tampil di merchant EN/AUD: satu-satunya builder
//     kata-angka Indonesia hidup di ShiftScreen, dan titik render-nya
//     digerbang `lang === 'id'` (cabang lain = rp format-currency).
//  2. tOf tak bocorkan key mentah: missing-key = string kosong (bukan key),
//     dan semua key t()/tOf() yang dipakai ShiftScreen terdaftar di kamus.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
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

  const shiftRaw = readRaw('screens/shift/ShiftScreen.tsx');
  const shift = strip(shiftRaw);

  // 1a. Builder terbilang-ID ada + bersufiks 'rupiah' (ciri ID, bukan EN).
  ok(/const terbilang = \(n: number\): string/.test(shift),
    'terbilang: builder terbilang-ID didefinisikan (ShiftScreen)');
  ok(/return `\$\{sebut\(n\)[^`]*\} rupiah`/.test(shift),
    'terbilang: output bersufiks "rupiah" (tak tampil untuk EN/AUD)');
  // 1b. Titik render digerbang bahasa: ID → terbilang, selainnya → rp().
  ok(/lang === 'id' \? terbilang\(kasAwalNum\) : rp\(kasAwalNum\)/.test(shift),
    'terbilang: render gerbang lang===' + "'id'" + ' ? terbilang : rp');
  // 1c. Tak ada builder kata-angka Indonesia kedua di luar ShiftScreen
  //     (pola: kata[] + 'belas'/'puluh'/'ratus'/'ribu'/'juta'/'miliar').
  const numWordFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      if (/belas/.test(s) && /puluh/.test(s) && /ratus/.test(s) && /ribu/.test(s)) {
        numWordFiles.push(path.relative(SRC, p));
      }
    }
  };
  walk(SRC);
  ok(numWordFiles.length === 1 && /ShiftScreen\.tsx$/.test(numWordFiles[0] || ''),
    'terbilang: builder kata-angka hanya di ShiftScreen (ditemukan: ' + (numWordFiles.join(', ') || 'nihil') + ')');

  // 2a. tOf fail-closed: missing-key = string kosong, bukan key mentah.
  const i18n = read('lib/i18n.ts');
  ok(!/if \(!e\) return key/.test(i18n) && /return ''/.test(i18n),
    'i18n: tOf missing-key tak mengembalikan key mentah');
  // 2b. Semua key t()/tOf() harfiah di ShiftScreen terdaftar di kamus STR
  //     (key dinamis = jebakan tOf — wajib nol di layar ini).
  const used = new Set();
  const re = /\bt(?:Of)?\(\s*['"]([A-Za-z0-9_.]+)['"]/g;
  let m;
  while ((m = re.exec(shiftRaw))) used.add(m[1]);
  ok(used.size > 0, 'i18n: ShiftScreen memakai key kamus harfiah (' + used.size + ' key)');
  const i18nRaw = readRaw('lib/i18n.ts');
  const missing = [...used].filter((k) => !new RegExp('(^|[^A-Za-z0-9_.])' + k.replace(/\./g, '\\.') + '\\s*:').test(i18nRaw));
  ok(missing.length === 0,
    'i18n: semua key ShiftScreen terdaftar di kamus' + (missing.length ? ' (hilang: ' + missing.join(', ') + ')' : ''));

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  for (const f of r.failures) console.log('FAIL ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
