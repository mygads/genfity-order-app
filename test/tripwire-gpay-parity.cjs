// Tripwire GPAY-PARITY: charge Genfity Pay dinamis kasir (GF-POS-*) wajib
// terpetakan GPAY_QRIS/VA sampai ke BE, bukan terbaur QRIS statis.
// GP-01: BePayMethod mencakup GPAY_* (paritas enum + CHECK tender BE).
// GP-02: mapPayMethodToBe memetakan label gpay eksplisit + kaki ber-charge.
// GP-03: drain sync mengizinkan GPAY_* (settle antre tak BLOCKED).
// GP-04: QrisScreen melabeli mirror GPAY + menitipkan charge id ke kaki.
// GP-05: drain grup membawa charge ref + campuran gpay dilewati jujur.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p) => strip(fs.readFileSync(path.join(SRC, p), 'utf8'));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  const wire = read('lib/posWire.ts');
  ok(/'GPAY_QRIS'/.test(wire) && /'GPAY_VA'/.test(wire),
    'GP-01: BePayMethod mencakup GPAY_QRIS/VA (paritas enum BE)');
  ok(/gpayqris/.test(wire) && /gpayva/.test(wire),
    'GP-02: mapPayMethodToBe memetakan label gpay eksplisit (gopay mock lama tak cocok)');
  ok(/gpayChargeId/.test(wire),
    'GP-02: mapPayMethodToBe menerima charge ref untuk kaki QRIS drain');

  const sync = read('lib/sync.ts');
  ok(/GPAY_QRIS/.test(sync) && /GPAY_VA/.test(sync),
    'GP-03: drain sync mengizinkan GPAY_* (settle antre tak BLOCKED)');

  const qris = read('screens/payment/QrisScreen.tsx');
  ok(/gpay_qris/.test(qris) && /gpayChargeId/.test(qris),
    'GP-04: QrisScreen melabeli mirror GPAY + menitipkan charge id ke kaki');

  const sales = read('lib/sales.ts');
  ok(/gpayChargeId/.test(sales) && /gpayMix/.test(sales),
    'GP-05: drain grup membawa charge ref + campuran gpay dilewati jujur');

  return { failures, checks };
}

module.exports = { run };
