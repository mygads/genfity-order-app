// Tripwire mode kasir per merchant-type (C1+C2+C3, SESI-C APP): kunci invarian
// tanpa runtime RN — dicek statik dari sumber:
//  1. C1: normalizeSalesMode TAK PERNAH emit 'TAKE_AWAY' (BE POS create
//     orders_pos_create.go:196 menolaknya); seed lokal konsisten TAKEAWAY;
//     kompat inbound TAKE_AWAY lama dipertahankan HANYA di goPosOrderType.
//  2. C2 (merchant-aware, R1-A/R2): daftar tawar per tipe = kanal POS-create
//     BE (RESTAURANT 5 label lama; PRODUCT tanpa DINE IN; SERVICE tanpa
//     DINE IN/DELIVERY/HOME_SERVICE); CashierScreen + DineInScreen TAK ADA
//     const MODES hardcoded (wajib lewat posModesFor dari binding);
//     goPosOrderType SADAR merchant-type: PRODUCT IN_STORE_*→IN_STORE_ORDER,
//     TAKEAWAY→TAKEAWAY, DELIVERY/agregator/DINE_IN→UNSUPPORTED (delivery ≠
//     takeaway, BLOCKED jujur); SERVICE HANYA IN_STORE_SERVICE
//     (HOME_SERVICE→UNSUPPORTED, owner-need BE); RESTAURANT perilaku pra-C2
//     (agregator→TAKEAWAY, IN_STORE_*/HOME_SERVICE→UNSUPPORTED,
//     asing→DINE_IN); toGoPosRequest menggerbang UNSUPPORTED (tak dikirim BE).
//  R1 KOREKSI-FLAG (21-Okt, offer-time only): collapse agregator→TAKEAWAY
//     UNCONDITIONAL (sync buta-flag; pesanan lama mengalir); flag menggerbang
//     DAFTAR UI reaktif (Cashier+DineIn sembunyikan kanal delivery bila OFF).
//  3. C3: modeLabel memuat cabang IN_STORE_PICKUP/IN_STORE_ORDER/
//     IN_STORE_SERVICE/HOME_SERVICE + SERVICE persis (tanpa fallthrough generik).
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
  const payRaw = readRaw('lib/payments.ts');
  const sync = read('lib/sync.ts');
  const hist = read('lib/history.ts');
  const seed = read('lib/seed.ts');
  const modes = read('lib/posModes.ts');
  const modesRaw = readRaw('lib/posModes.ts');
  const cashier = read('screens/cashier/CashierScreen.tsx');
  const dinein = read('screens/cashier/DineInScreen.tsx');

  // 1a. C1: tak ada emit TAKE_AWAY di payments.ts (return + literal).
  ok(!/TAKE_AWAY/.test(pay),
    'C1: payments.ts NOL literal TAKE_AWAY (emit wajib TAKEAWAY kanonis)');
  ok(/return 'TAKEAWAY'/.test(pay),
    'C1: normalizeSalesMode me-return TAKEAWAY');
  // 1b. seed lokal konsisten.
  ok(!/'TAKE_AWAY'/.test(seed),
    'C1: seed.ts NOL TAKE_AWAY (seed lokal TAKEAWAY)');
  // 1c. kompat inbound lama HANYA di sync goPosOrderType.
  ok(/k === 'TAKE_AWAY' \|\| k === 'TAKEAWAY'/.test(sync),
    'C2: goPosOrderType terima TAKE_AWAY warisan → TAKEAWAY (kompat antrean lama)');
  ok(/goPosOrderType\(p\.mode \?\? p\.salesMode, merchantType\)/.test(sync),
    'C2: toGoPosRequest orderType lewat goPosOrderType SADAR merchant-type (R1-A/R2)');
  ok(/if \(orderType === UNSUPPORTED_ORDER_TYPE\)/.test(sync),
    'C2: toGoPosRequest menggerbang UNSUPPORTED (BLOCKED jujur, tak dikirim ke BE)');

  // 2a. Daftar tawar per tipe.
  ok(/RESTAURANT:\s*\['DINE IN',\s*'TAKE AWAY',\s*'GOFOOD',\s*'GRABFOOD',\s*'SHOPEEFOOD'\]/.test(modes),
    'C2: RESTAURANT = 5 label lama (tanpa perubahan perilaku)');
  ok(/PRODUCT:\s*\['IN STORE ORDER',\s*'TAKE AWAY'\]/.test(modes),
    'C2: PRODUCT = IN STORE ORDER + TAKE AWAY (kanal POS-create BE)');
  ok(/SERVICE:\s*\['IN STORE SERVICE'\]/.test(modes),
    'C2: SERVICE = IN STORE SERVICE saja (satu-satunya kanal POS SERVICE)');
  // 2b. Layar tak hardcode MODES.
  ok(!/const MODES = \[/.test(cashier),
    'C2: CashierScreen NOL const MODES hardcoded (wajib posModesFor)');
  ok(!/const MODES = \[/.test(dinein),
    'C2: DineInScreen NOL const MODES hardcoded (wajib posModesFor)');
  ok(/posModesFor\(getBinding\(\)\?\.merchantType\)/.test(cashier),
    'C2: CashierScreen MODES dari posModesFor(binding merchantType)');
  ok(/posModesFor\(getBinding\(\)\?\.merchantType\)/.test(dinein),
    'C2: DineInScreen MODES dari posModesFor(binding merchantType)');
  // 2c. Cabang collapse goPosOrderType.
  ok(/k === 'IN_STORE_PICKUP'\) return 'IN_STORE_ORDER'/.test(sync),
    'C2: IN_STORE_PICKUP → IN_STORE_ORDER (kanal POS terdekat)');
  ok(/if \(mt === 'SERVICE'\) \{\s*\n\s*if \(k === 'IN_STORE_SERVICE'\) return 'IN_STORE_SERVICE';\s*\n\s*return UNSUPPORTED_ORDER_TYPE;/.test(sync),
    'C2: SERVICE = HANYA IN_STORE_SERVICE; HOME_SERVICE→UNSUPPORTED (owner-need BE)');
  ok(/if \(k === 'TAKE_AWAY' \|\| k === 'TAKEAWAY'\) return 'TAKEAWAY';\s*\n\s*return UNSUPPORTED_ORDER_TYPE;/.test(sync),
    'C2: PRODUCT DELIVERY/agregator/DINE_IN→UNSUPPORTED (delivery ≠ takeaway)');
  ok(/GOFOOD\|GRABFOOD\|SHOPEEFOOD\|ONLINE/.test(sync) && /return 'TAKEAWAY'/.test(sync),
    'C2: agregator/DELIVERY → TAKEAWAY (kurir-bawa-pulang collapse)');
  ok(/return 'DINE_IN';\s*\n\}/.test(sync),
    'C2: default DINE_IN ([ASUMSI] restaurant-default) tetap ada');
  // R1: rantai flag tetap dikunci (kupas profil + cache + default-true).
  ok(/readDeliveryEnabledFromProfile/.test(modes) && /isDeliveryEnabled/.test(modes),
    'R1: posModes mengupas isDeliveryEnabled dari payload profil');
  ok(/getCachedDeliveryEnabled/.test(modes) && /Merchant', 'Delivery/.test(modes),
    'R1: flag delivery di-cache + persist ms_setting(Merchant, Delivery)');
  ok(/cachedDeliveryEnabled: boolean = true/.test(modes) || /loadDeliveryEnabledLocal\(\)/.test(modes),
    'R1: default flag true = legacy lestari (hanya opt-out eksplisit menyembunyikan)');
  // R1 KOREKSI-FLAG (owner 21-Okt, offer-time only): collapse legacy
  // UNCONDITIONAL (pesanan lama mengalir apa pun flag kini); gate = DAFTAR
  // UI reaktif (Cashier+DineIn sembunyikan kanal delivery bila flag OFF).
  ok(/if \(\/DELIVER\|ANTAR\|KURIR\|OJEK\|GOFOOD\|GRABFOOD\|SHOPEEFOOD\|ONLINE\/\.test\(k\)\) return 'TAKEAWAY';/.test(sync),
    'R1: runtuh DELIVERY/agregator→TAKEAWAY UNCONDITIONAL (pesanan lama mengalir)');
  ok(!/getCachedDeliveryEnabled/.test(sync),
    'R1: goPosOrderType TAK memakai flag (sync buta-flag; gate milik UI)');
  ok(/subscribeDeliveryFlag\(/.test(cashier) && /isDeliveryChannelLabel\(m\)/.test(cashier),
    'R1: CashierScreen langganan flag + saring kanal delivery (reaktif)');
  ok(/subscribeDeliveryFlag\(/.test(dinein) && /isDeliveryChannelLabel\(m\)/.test(dinein),
    'R1: DineInScreen langganan flag + saring kanal delivery (reaktif)');
  ok(/useState\(getCachedDeliveryEnabled\(\)\)/.test(cashier) && /useState\(getCachedDeliveryEnabled\(\)\)/.test(dinein),
    'R1: flag dibaca ke STATE (bukan const statis) — daftar mutakhir saat sync tiba');
  ok(/export function subscribeDeliveryFlag/.test(modes) && /export function isDeliveryChannelLabel/.test(modes),
    'R1: posModes mengekspor subscribe + penanda kanal delivery');
  // 2d. Binding membawa merchantType (bukan hardcode layar).
  ok(/merchantType\?: string/.test(read('session.ts')) &&
    /normalizeMerchantType\(b\.merchantType/.test(read('session.ts')),
    'C2: session Binding persist merchantType ternormalisasi');
  ok(/readMerchantTypeFromLoginBody\(second\.body\)/.test(read('screens/auth/LoginScreen.tsx')),
    'C2: LoginScreen adopsi merchantType dari body E01 (forward-compat)');
  // 2e. Komentar deviasi jujur (brief vs BE) wajib ada agar tak "diperbaiki"
  //     menjadi daftar yang 400 di POS create.
  ok(/owner-need/i.test(modesRaw),
    'C2: posModes.ts mendokumentasikan owner-need DELIVERY-via-POS');

  // 3. C3: cabang label.
  ok(/IN_STORE_PICKUP/.test(hist) && /IN_STORE_ORDER/.test(hist) &&
    /IN_STORE_SERVICE/.test(hist) && /HOME_SERVICE/.test(hist),
    'C3: modeLabel memuat cabang IN_STORE_* + HOME_SERVICE');
  ok(/k === 'SERVICE'\) return 'Service'/.test(hist),
    'C3: modeLabel memetakan SERVICE persis (sesudah HOME_SERVICE/IN_STORE_SERVICE)');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
