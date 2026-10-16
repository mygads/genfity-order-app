#!/usr/bin/env node
/**
 * Hapus text-node spasi antar elemen JSX yang ditulis sebaris.
 *
 * Latar: gaya minified `... /> <DrawerMenu ... />` / `<View ...> <ScreenHeader ...`
 * menyisipkan string " " sebagai anak View. React Native mengabaikannya,
 * tetapi react-native-web melempar `Unexpected text node` (layar merah di
 * pratinjau web). Spasi ini murni format — tak ada efek visual di native.
 *
 * Batasan aman:
 * - tak menyentuh apapun di dalam <Text>...</Text> sebaris (spasi di sana
 *   bisa disengaja, mis. `{nama} <B>Telp</B>`);
 * - lewati baris dengan blok <Text> multi-baris;
 * - tutupi string ber-quote ('..' / ".." / `..` tanpa ${}) agar teks
 *   literal seperti 'a > < b' tak ikut berubah.
 *
 * Pakai: node scripts/fix-jsx-space.cjs [--check]
 *   --check = hanya laporkan kandidat, tanpa menulis.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['src/screens', 'src/components', 'src/layout', 'src/navigation', 'src/app'].filter((d) =>
  fs.existsSync(path.join(ROOT, d)),
);
const CHECK = process.argv.includes('--check');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.tsx')) yield p;
  }
}

/** Tutupi rentang [s,e) dengan spasi agar tak diproses (panjang sama). */
function maskRanges(line, ranges) {
  const chars = [...line];
  for (const [s, e] of ranges) {
    for (let i = s; i < e && i < chars.length; i++) chars[i] = ' ';
  }
  return chars.join('');
}

function masked(line) {
  const ranges = [];
  // 1. <Text ...>...</Text> sebaris.
  const textRe = /<Text[\s>][\s\S]*?<\/Text>/g;
  let m;
  while ((m = textRe.exec(line)) !== null) ranges.push([m.index, m.index + m[0].length]);
  // 2. String ber-quote sebaris (abaikan template dengan ${}).
  const strRe = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g;
  while ((m = strRe.exec(line)) !== null) {
    if (m[0].startsWith('`') && m[0].includes('${')) continue;
    ranges.push([m.index, m.index + m[0].length]);
  }
  return maskRanges(line, ranges);
}

function hasMultilineText(line) {
  const opens = (line.match(/<Text[\s>]/g) || []).length;
  const closes = (line.match(/<\/Text>/g) || []).length;
  return opens !== closes;
}

const PAT = /(\/>|\}|\)|>)[ \t]+(<[A-Za-z])/g;

let filesFixed = 0;
let hitsTotal = 0;
const remaining = [];

for (const file of DIRS.flatMap((d) => [...walk(path.join(ROOT, d))])) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let changed = false;
  const out = lines.map((line) => {
    PAT.lastIndex = 0;
    if (!PAT.test(line)) return line;
    if (hasMultilineText(line)) {
      remaining.push(`${path.relative(ROOT, file)}: ${line.trim().slice(0, 80)}`);
      return line;
    }
    // Masking mempertahankan panjang baris, jadi offset mask == offset asli.
    const m = masked(line);
    PAT.lastIndex = 0;
    let match;
    const cuts = []; // rentang whitespace [awal, akhir) yang dihapus
    while ((match = PAT.exec(m)) !== null) {
      cuts.push([match.index + match[1].length, match.index + match[0].length - match[2].length]);
    }
    if (cuts.length === 0) return line;
    const chars = [...line];
    for (let i = cuts.length - 1; i >= 0; i--) chars.splice(cuts[i][0], cuts[i][1] - cuts[i][0]);
    changed = true;
    hitsTotal += cuts.length;
    return chars.join('');
  });
  if (changed && !CHECK) {
    fs.writeFileSync(file, out.join('\n'));
    filesFixed++;
  }
}

console.log(`file diubah: ${filesFixed}, spasi dibersihkan: ${hitsTotal}`);
if (remaining.length > 0) {
  console.log('PERLU MANUAL (blok <Text> multi-baris):');
  for (const r of remaining) console.log(`  ${r}`);
}
