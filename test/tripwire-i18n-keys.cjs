// Tripwire kunci i18n (blank-UI): setiap t('kunci')/tOf('kunci') statis HARUS
// ada di kamus src/lib/i18n.ts. Kunci hilang = tOf mengembalikan '' (S4:
// tanpa raw-key leak) sehingga teks UI tampil KOSONG — mis. banner konflik
// 409 meja dan baris info opname pernah blank karena salah ejaan namespace
// (tbl.tableConflict vs tbl_table_conflict). Dicek statik tanpa runtime RN.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // 1. Kumpulkan kunci kamus (flat, quoted, dan multi-key sebaris).
  const dict = strip(readRaw('lib/i18n.ts'));
  const keys = new Set();
  const re = /['"]?([-A-Za-z0-9_.]+)['"]?\s*:\s*\{/g;
  let m;
  while ((m = re.exec(dict)) !== null) keys.add(m[1]);
  ok(keys.size > 1000, `i18n: kamus terbaca (${keys.size} kunci)`);
  for (const seed of ['tbl_table_conflict', 'stock_opname_menu_only', 'login_fail', 'need_be']) {
    ok(keys.has(seed), `i18n: kunci kanonis '${seed}' ada di kamus`);
  }

  // 2. Kumpulkan pemakaian statis t()/tOf()/pickKey().
  const used = new Map(); // key -> file pertama
  const files = walk(SRC, []);
  const pat = /\b(?:t|tOf)\s*\(\s*(['"])([-A-Za-z0-9_.]+)\1/g;
  const patPick = /\bpickKey\s*\(\s*t\s*,\s*(['"])([-A-Za-z0-9_.]+)\1(?:\s*,\s*(['"])([-A-Za-z0-9_.]+)\3)?/g;
  for (const f of files) {
    const rel = path.relative(SRC, f);
    const code = strip(fs.readFileSync(f, 'utf8'));
    let mm;
    pat.lastIndex = 0;
    while ((mm = pat.exec(code)) !== null) {
      if (!used.has(mm[2])) used.set(mm[2], rel);
    }
    patPick.lastIndex = 0;
    while ((mm = patPick.exec(code)) !== null) {
      if (!used.has(mm[2])) used.set(mm[2], rel);
      if (mm[4] && !used.has(mm[4])) used.set(mm[4], rel);
    }
  }
  ok(used.size > 500, `i18n: pemakaian statis terbaca (${used.size} kunci)`);

  // 3. Setiap kunci statis wajib ada di kamus.
  const missing = [...used.entries()].filter(([k]) => !keys.has(k));
  ok(missing.length === 0,
    missing.length === 0
      ? 'i18n: semua kunci t()/tOf()/pickKey() statis ada di kamus (tanpa blank-UI)'
      : `i18n: ${missing.length} kunci hilang → UI blank: ` +
        missing.slice(0, 10).map(([k, f]) => `'${k}' @${f}`).join(', '));

  return { checks, failures };
}

module.exports = run;
