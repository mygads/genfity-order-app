// Tripwire wiring-2 reservasi + status/history + settle/refund/void ke BE
// (SESI-FIX-APPW2, gas mode, aditif). Kunci statik:
//  W2-01: ApiPath merchant + apiPut + PUT branch + dual idempotency header.
//  W2-02: peta transisi BE eksak + CANCELLED tak pernah lewat status +
//         Selesai->READY (BUKAN COMPLETED) + invalid tanpa jaringan.
//  W2-03: BLOCKED-jujur (tanpa id server / tanpa padanan enum = diam).
//  W2-04: nama op GO_OP_* satu sumber posWire <-> drain sync.
//  W2-05: layar memanggil kontrak Go (bukan jalur lokal lama saja).
//  W2-06: refund satu kunci idempotensi immediate + antrean.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
// NB: baris-komentar dulu, baru blok — server.ts memuat '/*' di dalam
// komentar baris (mis. erp/member/*) yang mengecoh strip blok-dulu.
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p) => strip(fs.readFileSync(path.join(SRC, p), 'utf8'));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // W2-01: kontrak transport.
  const server = read('config/server.ts');
  for (const k of ['merchantResvList', 'merchantResvCancel', 'merchantOrdersActive',
    'merchantOrderStatus', 'merchantOrderCancel', 'merchantOrderVoid',
    'merchantPosHistory', 'merchantPosPayment', 'merchantPosRefund']) {
    ok(new RegExp(k).test(server), `W2-01: ApiPath memuat ${k}`);
  }
  ok(/export async function apiPut/.test(server), 'W2-01: apiPut diekspor dari config/server');
  ok(/Idempotency-Key/.test(server) && /X-Idempotency-Key/.test(server),
    'W2-01: dual header idempotensi (Idempotency-Key + X-Idempotency-Key)');
  const apiSource = read('lib/apiSource.ts');
  ok(/apiPut/.test(apiSource) && /'PUT'/.test(apiSource),
    'W2-01: apiSource cabang PUT via apiPut');

  // W2-02: mesin status.
  const wire = read('lib/posWire.ts');
  ok(/PENDING['"]?\s*:\s*\[[^\]]*ACCEPTED/.test(wire), 'W2-02: PENDING->[ACCEPTED]');
  ok(/ACCEPTED['"]?\s*:\s*\[[^\]]*IN_PROGRESS/.test(wire), 'W2-02: ACCEPTED->[IN_PROGRESS]');
  ok(/IN_PROGRESS['"]?\s*:\s*\[[^\]]*READY/.test(wire), 'W2-02: IN_PROGRESS->[READY]');
  ok(/READY['"]?\s*:\s*\[[^\]]*COMPLETED/.test(wire), 'W2-02: READY->[COMPLETED,SHIPPED]');
  ok(/CANCELLED/.test(wire) && /INVALID_TARGET|=== 'CANCELLED'/.test(wire),
    'W2-02: target CANCELLED dipagar di pushOrderStatus');
  ok(/if \(local === 'Diproses'\) return 'ACCEPTED'/.test(wire),
    'W2-02: Diproses->ACCEPTED');
  ok(/if \(local === 'Selesai'\) return 'READY'/.test(wire),
    'W2-02: Selesai->READY (bukan COMPLETED)');
  ok(!/beStatusForLocal\('Selesai'\)[^]*COMPLETED/.test(wire) || /BUKAN COMPLETED/.test(fs.readFileSync(path.join(SRC, 'lib/posWire.ts'), 'utf8')),
    'W2-02: tak ada padanan Selesai->COMPLETED');
  ok(/isAllowedBeTransition\(cur, t\)/.test(wire),
    'W2-02: transisi invalid ditolak lokal tanpa jaringan');
  ok(/same-status|cur === t|cur && cur === t/.test(wire),
    'W2-02: same-status = sukses tanpa kirim');
  ok(/export function isReplaySuccess/.test(wire) && /replayed/.test(wire),
    'W2-02: replay (409 idempoten) = sukses');

  // W2-03: BLOCKED-jujur.
  ok(/return null/.test(wire) && /getServerOrderIdForSale/.test(wire),
    'W2-03: tanpa id server desimal -> null (BLOCKED, tanpa kirim buta)');
  ok(/export function mapPayMethodToBe/.test(wire) && /return null;/.test(wire),
    'W2-03: metode tanpa padanan enum -> null (tanpa map diam-diam)');

  // W2-04: nama op satu sumber.
  const sync = read('lib/sync.ts');
  for (const op of ['GO_OP_SETTLE', 'GO_OP_REFUND', 'GO_OP_CANCEL', 'GO_OP_VOID', 'GO_OP_STATUS', 'GO_OP_RESV_CANCEL']) {
    ok(new RegExp(`\\b${op}\\b`).test(wire), `W2-04: posWire mengekspor ${op}`);
    ok(new RegExp(`\\b${op}\\b`).test(sync), `W2-04: drain sync memakai ${op}`);
  }
  ok(/apiPutWithTimeout|method: 'PUT'|method === 'PUT'/.test(sync),
    'W2-04: drain PUT-capable (op PUT ikut terkuras)');

  // W2-05: layar terhubung ke kontrak Go.
  const booking = read('screens/booking/BookingScreen.tsx');
  ok(/pullServerReservations/.test(booking) && /mergeServerResvs/.test(booking),
    'W2-05: BookingScreen pull+merge reservasi server');
  ok(/cancelServerReservation/.test(booking) && /GO_OP_RESV_CANCEL/.test(booking),
    'W2-05: BookingScreen batal server + antrean saat offline');
  const kitchen = read('screens/history/KitchenScreen.tsx');
  ok(/pushOrderStatus/.test(kitchen) && /GO_OP_STATUS/.test(kitchen),
    'W2-05: KitchenScreen cermin status + antrean');
  const esb = read('screens/history/EsbOrderScreen.tsx');
  ok(/pullActiveOrders/.test(esb) && /mapGoActiveToRow/.test(esb),
    'W2-05: EsbOrderScreen cermin order aktif server');
  ok(/pushOrderStatus/.test(esb) && /cancelMerchantOrder/.test(esb),
    'W2-05: EsbOrderScreen status/cancel ke BE + antrean');
  const pay = read('screens/payment/PayScreen.tsx');
  ok(/mirrorSettleToServer/.test(pay) && /settlePosPayment/.test(pay) && /GO_OP_SETTLE/.test(pay),
    'W2-05: PayScreen cermin settle + antrean');
  const histScr = read('screens/history/HistoryScreen.tsx');
  ok(/pullServerHistoryTxns/.test(histScr) && /mergeHistoryTxns/.test(histScr),
    'W2-05: HistoryScreen merge riwayat server (read-only)');
  const hist = read('lib/history.ts');
  ok(/cancelMerchantOrder/.test(hist) && /voidMerchantOrder/.test(hist) && /refundPosPayment/.test(hist),
    'W2-05: persistVoidDb cermin cancel->void->refund per settled-state');

  // W2-06: satu kunci refund.
  ok(/idempotencyKey\?: string/.test(wire),
    'W2-06: refundPosPayment terima kunci idempotensi eksplisit');
  ok(/rfKey/.test(hist) && /}, rfKey\)/.test(hist),
    'W2-06: hook void memakai satu kunci immediate + antrean (item.id)');

  return { failures, checks };
}

module.exports = { run };
