// Tripwire orderType kanonis (C1/C2): buildSalePayload + sync WAJIB emit
// enum backend Go (DINE_IN / TAKEAWAY / IN_STORE_ORDER / IN_STORE_SERVICE).
// TAKE_AWAY (underscore) DITOLAK backend (POS_VALIDATION_ERROR,
// orders_pos_create.go:196) — regresi ke bentuk underscore harus ketahuan CI.
// Dicek statik dari sumber (tanpa runtime RN).
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

  const pay = read('lib/payments.ts');
  const sync = read('lib/sync.ts');
  const seed = read('lib/seed.ts');

  // C1: normalizeSalesMode emit TAKEAWAY kanonis, NOL underscore.
  ok(/return 'TAKEAWAY'/.test(pay),
    'payments: normalizeSalesMode mengembalikan TAKEAWAY kanonis');
  ok(!/return 'TAKE_AWAY'/.test(pay),
    'payments: larangan return TAKE_AWAY (backend 400)');
  ok(!/TAKE_AWAY/.test(seed),
    'seed: tak ada salesMode TAKE_AWAY tersisa');
  // C1: fixture dummy ikut kanonis (server tak pernah kirim underscore).
  const fixture = fs.readFileSync(
    path.join(SRC, 'data/dummy/pull/main-get-sales.json'), 'utf8');
  ok(!/TAKE_AWAY/.test(fixture),
    'fixture: dummy pull tanpa TAKE_AWAY');

  // C2: goPosOrderType sadar merchant-type + sentinel UNSUPPORTED.
  ok(/function goPosOrderType\(raw\?: unknown, merchantType\?: unknown\)/.test(sync),
    'sync: goPosOrderType menerima merchantType');
  ok(/return 'UNSUPPORTED'/.test(sync),
    'sync: goPosOrderType punya sentinel UNSUPPORTED (BE menolak = BLOCKED jujur)');
  // C2: DELIVERY PRODUCT tak boleh dilipat ke TAKEAWAY — cabang PRODUCT
  // mengembalikan UNSUPPORTED untuk DELIVERY/agregator (BE menolak = BLOCKED
  // jujur); lipatan ke TAKEAWAY hanya milik RESTAURANT/tak-dikenal.
  ok(/PRODUCT/.test(sync) && /DELIVER/.test(sync) && /return 'UNSUPPORTED'/.test(sync),
    'sync: jalur DELIVERY PRODUCT terpisah dari lipatan TAKEAWAY');
  // C2: daftar mode per merchant-type ada (alias pickup eksplisit).
  const mt = read('lib/merchantType.ts');
  ok(/IN_STORE_PICKUP/.test(mt) && /HOME_SERVICE/.test(mt) && /IN_STORE_SERVICE/.test(mt),
    'merchantType: daftar mode PRODUCT/SERVICE eksplisit');
  ok(/RESTAURANT/.test(mt) && /fallback|default/i.test(readRaw('lib/merchantType.ts')),
    'merchantType: tak-dikenal default restaurant (ASUMSI terdokumentasi)');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  for (const f of r.failures) console.log('FAIL ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
