// Tripwire SESI-FINAL-APP K5: codec backup/restore murni (tanpa dep baru).
// Kunci statik + RUNTIME (tanpa RN — codec murni, diuji dari sumber asli):
//  B-01: lib/backupCodec — ekspor builder/parser + versi; NOL impor (tanpa
//        expo-clipboard/file-system/sharing; Share/file dilarang).
//  B-02: sintaks erasable-only (tanpa enum/namespace) agar dapat
//        ditranspile + diuji roundtrip apa adanya.
//  B-03: RUNTIME roundtrip nyata: build → parse → deep-equal; sampah /
//        versi-asing / kebesaran / non-objek = { ok:false } (fail-closed,
//        tak pernah melempar).
//  B-04: Settings — entri backup ADA + disabled jujur (tanpa onPress/go +
//        tanpa Clipboard/Share), sub berlabel needs-dep.
//  B-05: kunci i18n backup ID+EN ada.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function loadCodecRuntime() {
  // Transpile sumber ASLI (bukan salinan) → muat → uji perilaku nyata.
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  const src = readRaw('lib/backupCodec.ts');
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

  // ---- B-01: kontrak + nol-impor ----
  const codec = read('lib/backupCodec.ts');
  const codecRaw = readRaw('lib/backupCodec.ts');
  ok(/export function buildBackupPayload/.test(codec) && /export function parseBackupPayload/.test(codec),
    'B-01: build + parse diekspor');
  ok(/BACKUP_CODEC_VERSION/.test(codec) && /BACKUP_MAX_BYTES/.test(codec),
    'B-01: versi + batas diekspor');
  ok(!/^\s*import\s/m.test(codecRaw) && !/require\s*\(/.test(codecRaw),
    'B-01: NOL impor (murni, tanpa dep)');
  ok(!/expo-clipboard|expo-file-system|expo-sharing|Clipboard\.|Share\.|FileSystem\./.test(codec),
    'B-01: tanpa clipboard/share/file (dep tak ada — PARKED jujur)');

  // ---- B-02: erasable-only ----
  ok(/export interface BackupEnvelope/.test(codec),
    'B-02: envelope bertipe interface (erasable)');
  ok(!/\benum\s+\w/.test(codecRaw) && !/\bnamespace\s+\w/.test(codecRaw),
    'B-02: tanpa enum/namespace (transpile-aman)');
  ok(!/constructor\s*\(.*(private|protected|public|readonly)\s+\w/.test(codecRaw),
    'B-02: tanpa parameter-property (transpile-aman)');

  // ---- B-03: RUNTIME roundtrip nyata ----
  try {
    const rt = loadCodecRuntime();
    ok(typeof rt.buildBackupPayload === 'function' && typeof rt.parseBackupPayload === 'function',
      'B-03: runtime memuat build + parse dari sumber asli');
    const sample = { theme: 'gelap', nota: 'Toko Maju — 100% ✓', nested: { a: [1, 2, { b: null }], c: true }, n: 42 };
    let text = '';
    let threw = false;
    try {
      text = rt.buildBackupPayload(sample);
    } catch { threw = true; }
    ok(!threw && typeof text === 'string' && text.length > 0,
      'B-03: build tak melempar');
    const back = rt.parseBackupPayload(text);
    ok(back && back.ok === true,
      'B-03: parse hasil build = ok');
    try {
      assert.deepStrictEqual(back.envelope.data, sample);
      ok(true, 'B-03: roundtrip deep-equal');
    } catch { ok(false, 'B-03: roundtrip deep-equal'); }
    ok(back.envelope.version === rt.BACKUP_CODEC_VERSION,
      'B-03: versi envelope = BACKUP_CODEC_VERSION');
    const bads = [
      ['sampah-bukan-json{{{', 'invalid_json'],
      ['', 'empty_payload'],
      [JSON.stringify({ version: 999, exportedAt: '', data: {} }), 'unsupported_version'],
      [JSON.stringify({ version: 1, exportedAt: '', data: [1, 2] }), 'bad_data'],
      [JSON.stringify({ version: 1 }), 'bad_data'],
      ['123', 'bad_envelope'],
    ];
    for (const [input, code] of bads) {
      let r = null;
      let t = false;
      try { r = rt.parseBackupPayload(input); } catch { t = true; }
      ok(!t && r && r.ok === false && r.error === code,
        `B-03: tolak jujur (${code})`);
    }
    let bigThrow = false;
    let bigRes = null;
    try { bigRes = rt.parseBackupPayload('x'.repeat(rt.BACKUP_MAX_BYTES + 1)); } catch { bigThrow = true; }
    ok(!bigThrow && bigRes && bigRes.ok === false && bigRes.error === 'too_large',
      'B-03: tolak kebesaran (too_large)');
    let nullThrow = false;
    let nullRes = null;
    try { nullRes = rt.parseBackupPayload(null); } catch { nullThrow = true; }
    ok(!nullThrow && nullRes && nullRes.ok === false,
      'B-03: null = gagal jujur (tak melempar)');
  } catch (e) {
    ok(false, `B-03: runtime roundtrip gagal dimuat (${String((e && e.message) || e).slice(0, 100)})`);
  }

  // ---- B-04: Settings disabled jujur ----
  const sett = read('screens/settings/SettingsScreen.tsx');
  const settRaw = readRaw('screens/settings/SettingsScreen.tsx');
  ok(/settings\.backup/.test(sett),
    'B-04: entri backup ADA di Settings (dataHelp)');
  ok(!/expo-clipboard|Clipboard\.|Share\.share|expo-sharing/.test(sett),
    'B-04: tanpa Clipboard/Share di Settings (tak ada jalur kirim)');
  // NB: segmen = JSX baris itu saja (raw, dari t('settings.backup') sampai
  // penutup />) — komentar penjelas di ATAS baris tak ikut diuji.
  const rowIdx = settRaw.indexOf("t('settings.backup')");
  const rowEnd = rowIdx >= 0 ? settRaw.indexOf('/>', rowIdx) : -1;
  const rowSeg = rowIdx >= 0 && rowEnd > rowIdx ? settRaw.slice(rowIdx, rowEnd) : '';
  ok(rowIdx >= 0 && rowEnd > rowIdx && !/onPress/.test(rowSeg) && !/go\(/.test(rowSeg),
    'B-04: baris backup SENGAJA tanpa onPress (disabled, tanpa chevron)');
  ok(/SESI-FINAL-APP K5/.test(settRaw) && /PARKED/.test(settRaw),
    'B-04: catatan PARKED jujur (needs-dep) di sumber');

  // ---- B-05: i18n ----
  const i18nRaw = readRaw('lib/i18n.ts');
  ok(/'settings\.backup'/.test(i18nRaw) && /'settings\.backupSub'/.test(i18nRaw),
    'B-05: kunci backup + backupSub ada');
  const bLine = i18nRaw.split('\n').find((l) => l.includes("'settings.backup'") && !l.includes('backupSub')) || '';
  ok(/id:\s*'/.test(bLine) && /en:\s*'/.test(bLine),
    'B-05: ID+EN terisi (tanpa hardcode di layar)');

  return { failures, checks };
}

module.exports = { run };
