// Bukti drawer-kick: byte builder TS == DRAWER_KICK_HEX == byte di Java.
// node verify/check.drawer.cjs
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function assert(c, msg) {
  if (!c) throw new Error(`ASSERT: ${msg}`);
}

const ROOT = path.resolve(__dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawer-'));
// Pakai biner typescript milik repo langsung (npx dari tmpdir salah resolve
// ke paket `tsc` lain); cwd = outDir agar tsconfig proyek tak terbaca.
const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
execSync(
  `node ${JSON.stringify(tscBin)} ${JSON.stringify(path.join(ROOT, 'src/lib/escpos.ts'))} --outDir ${JSON.stringify(outDir)} --module commonjs --target es2020 --skipLibCheck`,
  { cwd: outDir, stdio: 'pipe' },
);
const escpos = require(path.join(outDir, 'escpos.js'));
const built = escpos.buildDrawerKickBytes();
const hex = escpos.toHex(built);
assert(hex === escpos.DRAWER_KICK_HEX, `builder!=HEX: ${hex}`);
assert(hex === '1b401b700032c8', `bukan ESC/POS kick standar: ${hex}`);

// Oracle independen: byte dari sumber Java modul native.
const java = fs.readFileSync(
  path.join(ROOT, 'modules/genfity-printer/android/GenfityPrinterModule.java'),
  'utf8',
);
const m = java.match(/DRAWER_KICK\s*=\s*new byte\[\]\s*\{([^}]+)\}/);
assert(m, 'DRAWER_KICK tidak ada di Java');
const jbytes = [...m[1].matchAll(/0x([0-9a-fA-F]{2})|\(byte\)\s*0x([0-9a-fA-F]{2})/g)].map(
  (x) => (x[1] ?? x[2]).toLowerCase(),
);
assert(jbytes.join('') === hex, `Java!=TS: ${jbytes.join('')}`);
assert(jbytes.includes('70') && jbytes.includes('1b'), 'bukan perintah ESC p');
fs.rmSync(outDir, { recursive: true, force: true });
console.log('DRAWER_OK', hex);
