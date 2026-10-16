#!/usr/bin/env node
/**
 * Hapus text-node spasi antar elemen JSX yang ditulis sebaris.
 *
 * Latar: gaya minified `... /> <DrawerMenu ... />` / `<View ...> <ScreenHeader ...`
 * menyisipkan string " " sebagai anak View. React Native mengabaikannya,
 * tetapi react-native-web melempar `Unexpected text node` (layar merah di
 * pratinjau web). Spasi ini murni format — tak ada efek visual di native.
 *
 * Varian yang ditangani (spasi [ \t]+ di antara):
 * - follower tag: `/>`, `}`, `)`, `>` + `<huruf` / `</` / `<>`
 *   (mis. `/> </View>`, `)} </View>`, `</Text> </Pressable>`);
 * - follower `{`: `/>`, `}`, `>` + `{`
 *   (mis. `</View> {kondisi && (`, `</Text> {foto ? ...}`);
 *   hanya pada baris bermarka JSX (`<huruf`, `</`, `<>`), `=> {` dilewati,
 *   generik TypeScript (mis. `Promise<T> {`) tak dihitung sebagai marka,
 *   dan leader `)` + `{` (mis. `if (x) {`) tak disentuh;
 * - leader `(` / `{` sebelum tag: `( <View>`, `{ <Touchable>`, `( <></>`.
 *
 * Batasan aman:
 * - tak menyentuh apapun di dalam <Text>...</Text> sebaris (spasi di sana
 *   bisa disengaja, mis. `{nama} <B>Telp</B>`);
 * - lewati baris dengan blok <Text> multi-baris (masuk daftar remaining);
 * - tutupi string ber-quote ('..' / ".." / `..` tanpa ${}) agar teks
 *   literal seperti 'a > < b' tak ikut berubah.
 *
 * Cara kerja: pola dicocokkan pada baris asli, tetapi rentang spasi yang
 * jatuh di dalam daerah lindung (isi <Text> sebaris / string ber-quote)
 * dilewati — yang dihapus hanya spasi antar-elemen di luar daerah lindung.
 * Karakter leader/follower tak pernah diubah, hanya whitespace yang dibuang.
 *
 * Pakai: node scripts/fix-jsx-space.cjs [--check]
 *   --check = hanya laporkan kandidat (file:baris), tanpa menulis.
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

/** Daerah lindung: <Text>...</Text> sebaris + string ber-quote (tanpa ${}). */
function textRanges(line) {
  const ranges = [];
  // 1. <Text ...>...</Text> sebaris.
  const textRe = /<Text[\s>][\s\S]*?<\/Text>/g;
  let m;
  while ((m = textRe.exec(line)) !== null) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

function strRanges(line) {
  const ranges = [];
  // 2. String ber-quote sebaris (abaikan template dengan ${}).
  const strRe = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g;
  let m;
  while ((m = strRe.exec(line)) !== null) {
    if (m[0].startsWith('`') && m[0].includes('${')) continue;
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function maskRangesFor(line) {
  return [...textRanges(line), ...strRanges(line)];
}

function masked(line) {
  return maskRanges(line, maskRangesFor(line));
}

function hasMultilineText(line) {
  const [buka, tutup] = hitungTagTeks(line);
  return buka !== tutup;
}

/**
 * Hitung tag <Text> pembuka vs penutup pada baris, dengan string ber-quote
 * ditutupi dulu agar tag di dalam literal (mis. '</Text>') tak mengacaukan
 * hitungan maupun pelacakan kedalaman blok.
 */
function hitungTagTeks(line) {
  const m = maskRanges(line, strRanges(line));
  const buka = (m.match(/<Text[\s>]/g) || []).length;
  const tutup = (m.match(/<\/Text>/g) || []).length;
  return [buka, tutup];
}

// Follower tag: pola lama `<huruf` diperluas dengan `</` dan `<>`.
const PAT_TAG = /(\/>|\}|\)|>)[ \t]+(<(>|[A-Za-z/]))/g;
// Follower `{`: tanpa `)` agar `if (x) {` murni JS tak tersentuh.
const PAT_BRACE = /(\/>|\}|>)[ \t]+(\{)/g;
// Leader `(` atau `{` sebelum tag.
const PAT_LEAD = /(\(|\{)[ \t]+(<(>|[A-Za-z/]))/g;
// Marka JSX: `</` selalu dihitung; `<huruf` / `<>` hanya bila TIDAK didahului
// karakter identifier / `]` / `)` agar generik TypeScript seperti
// `Promise<CancelItem[]>` atau `query<SaleMenuRow>(` tak dikira JSX.
const JSX_MARK = /<\/|(?<![A-Za-z0-9_$\]\)])<(>|[A-Za-z])/;

let filesFixed = 0;
let hitsTotal = 0;
const temuan = [];
const remaining = [];

for (const file of DIRS.flatMap((d) => [...walk(path.join(ROOT, d))])) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const rel = path.relative(ROOT, file);
  let changed = false;
  let textDepth = 0; // kedalaman blok <Text> multi-baris; baris di dalamnya dilewati
  const out = lines.map((line, idx) => {
    // Lacak blok <Text> lintas baris untuk SEMUA baris agar tak melenceng.
    const [buka, tutup] = hitungTagTeks(line);
    const diDalamBlok = textDepth > 0;
    textDepth = Math.max(0, textDepth + buka - tutup);
    PAT_TAG.lastIndex = 0;
    PAT_BRACE.lastIndex = 0;
    PAT_LEAD.lastIndex = 0;
    if (!PAT_TAG.test(line) && !PAT_BRACE.test(line) && !PAT_LEAD.test(line)) return line;
    const baris = idx + 1;
    if (buka !== tutup || diDalamBlok) {
      remaining.push(`${rel}:${baris}: ${line.trim().slice(0, 80)}`);
      return line;
    }
    const ranges = maskRangesFor(line);
    // Marka JSX dicek dengan string saja yang ditutupi: tag <Text> bukan
    // isi lindung sehingga baris `</Text> {...}` tetap dikenali sebagai JSX,
    // sedangkan `<` di dalam string literal tetap diabaikan.
    const cuts = []; // rentang whitespace [awal, akhir) yang dihapus
    const kumpul = (re, jaga) => {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line)) !== null) {
        if (jaga && !jaga(match)) continue;
        const awal = match.index + match[1].length;
        const akhir = match.index + match[0].length - match[2].length;
        if (akhir <= awal) continue;
        // Spasi di dalam daerah lindung (isi <Text> / string) dilewati.
        if (ranges.some(([a, b]) => awal < b && a < akhir)) continue;
        cuts.push([awal, akhir]);
      }
    };
    kumpul(PAT_TAG);
    kumpul(PAT_LEAD);
    // Varian (a): follower `{` — wajib ada marka JSX; `=> {` dilewati.
    if (JSX_MARK.test(maskRanges(line, strRanges(line)))) {
      kumpul(PAT_BRACE, (match) => !(match[1] === '>' && line[match.index - 1] === '='));
    }
    if (cuts.length === 0) return line;
    // Urutkan + buang yang tumpang tindih (jaga-jaga), lalu hapus dari belakang.
    cuts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const pakai = [];
    for (const c of cuts) {
      const t = pakai[pakai.length - 1];
      if (t && c[0] < t[1]) continue;
      pakai.push(c);
    }
    let hasil = line;
    for (let i = pakai.length - 1; i >= 0; i--) hasil = hasil.slice(0, pakai[i][0]) + hasil.slice(pakai[i][1]);
    changed = true;
    hitsTotal += pakai.length;
    temuan.push(`${rel}:${baris} (${pakai.length})`);
    return hasil;
  });
  if (changed && !CHECK) {
    fs.writeFileSync(file, out.join('\n'));
    filesFixed++;
  }
}

console.log(`file diubah: ${filesFixed}, spasi dibersihkan: ${hitsTotal}`);
if (CHECK && temuan.length > 0) {
  console.log('TEMUAN OTOMATIS (file:baris (jumlah spasi)):');
  for (const t of temuan) console.log(`  ${t}`);
}
if (remaining.length > 0) {
  console.log('PERLU MANUAL (blok <Text> multi-baris):');
  for (const r of remaining) console.log(`  ${r}`);
}
