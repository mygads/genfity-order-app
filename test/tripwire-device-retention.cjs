// Tripwire retensi device (C9, SESI-C APP): kunci statik bahwa antrean lokal
// tak tumbuh tanpa batas, tanpa menghapus yang informatif:
//  1. Print sukses = DELETE langsung (bukan UPDATE 'cetak'); drain menyapu
//     warisan 'cetak' pra-C9; yang hidup hanya antre/gagal.
//  2. pendingPrintCount lestari (antre/gagal) — badge SyncScreen tak berubah.
//  3. pruneLocalOnly: 'lokal' esoprocessqueue dipangkas ke N terbaru; antre/
//     gagal/terkirim tak tersentuh; dipanggil tiap akhir pushAll (best-effort).
//  4. Purge server pos_offline_order_sync (migration 00045) milik BE — di APP
//     hanya catatan (bukan kode); tripwire menegaskan TAK ADA sentuhan migrasi
//     BE di berkas APP yang diubah.
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

  const pq = read('lib/printqueue.ts');
  const sync = read('lib/sync.ts');

  // 1. Print sukses DELETE + sapu warisan.
  ok(!/SET status = 'cetak'/.test(pq),
    "C9: NOL tulis status 'cetak' baru (sukses = DELETE)");
  ok(/DELETE FROM tr_printqueue WHERE id = \?/.test(pq),
    'C9: sukses drain = DELETE baris (retensi device)');
  ok(/DELETE FROM tr_printqueue WHERE status = 'cetak'/.test(pq),
    "C9: sapu warisan 'cetak' pra-C9 tiap drain (best-effort)");

  // 2. pendingPrintCount lestari.
  ok(/export async function pendingPrintCount/.test(pq) &&
    /WHERE status IN \('antre', 'gagal'\)/.test(pq),
    'C9: pendingPrintCount lestari (antre/gagal — badge Sync tak berubah)');

  // 3. pruneLocalOnly.
  ok(/export async function pruneLocalOnly\(keep = 200\)/.test(sync),
    'C9: pruneLocalOnly ada (default 200 = jendela tampil penuh)');
  ok(/DELETE FROM tr_esoprocessqueue WHERE status = 'lokal' AND id NOT IN/.test(sync.replace(/\s+/g, ' ')),
    "C9: prune HANYA 'lokal' di luar N terbaru (antre/gagal tak tersentuh)");
  ok(/await pruneLocalOnly\(\);/.test(sync),
    'C9: prune dipanggil tiap akhir pushAll (best-effort)');
  ok(/export async function listLocalOnly/.test(sync),
    'C9: listLocalOnly (kartu SyncScreen) tak tersentuh');

  // 4. Batas APP: tak ada migrasi BE di sini (purge 00045 = catatan owner-need
  // di komentar saja — komentar sudah di-strip, jadi sumber-stripped steril).
  ok(!/pos_offline_order_sync/.test(sync) && !/goose/i.test(sync),
    'C9: purge server 00045 hanya catatan komentar (bukan kode migrasi APP)');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
