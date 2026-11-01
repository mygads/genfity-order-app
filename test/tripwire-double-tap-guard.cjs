// Tripwire GAP-F (audit 2026-11-01): aksi tulis satu-ketuk WAJIB guard
// ketuk-ganda + id unik agar retry drain idempoten. Tanpa guard = dua baris
// booking / dua op sync dari satu niat (PayScreen goRef = pola rujukan).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (p) => strip(fs.readFileSync(path.join(SRC, p), 'utf8'));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // NB: BookingScreen.tsx milik lane W2 (w2Guard tripwire-shiftcash) -
  // pola yang sama (savingRef + id di booking-create) direkomendasikan
  // ke W2; tripwire ini TIDAK menuntutnya agar tak tabrakan lane.
  const end = read('screens/shift/EndShiftScreen.tsx');
  ok(/closingRef\.current/.test(end), 'GAP-I: EndShiftScreen guard tutup-ganda confirmClose()');

  const tbl = read('screens/tables/TablesScreen.tsx');
  ok(/bookingSavingRef\.current/.test(tbl), 'GAP-F: TablesScreen guard saveBooking()');
  ok(/'booking-create', \{ id:/.test(tbl), 'GAP-F: denah booking-create bawa id');
  ok(/'move-table'.*\{ id:|id: `tm-/.test(tbl), 'GAP-F: move/merge-table bawa id unik');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(JSON.stringify(r));
  process.exit(r.failures.length ? 1 : 0);
}
