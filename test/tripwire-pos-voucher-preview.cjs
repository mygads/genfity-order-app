// Tripwire P1-2 (BE df15781): preview voucher merchant-Go order-less —
// server menang penuh, tanpa fallback lintas-engine.
// Kunci statik (tanpa runtime RN), cermin gaya tripwire lain:
//  1. ApiPath.merchantPosVoucherPreview menunjuk rute BE yang benar
//     (/api/merchant/orders/pos/validate-voucher-preview, prefix api/ =
//     bearer MerchantAuth otomatis; kasir ter-cover PermOrders).
//  2. validatePosVoucherPreview: server-wins; jawaban tak-valid server =
//     {ok:false, offline:false} + kode error (TANPA fallback ESB/lokal —
//     SQLite/ESB tak mengenal kode order_voucher_codes); offline/dummy =
//     {offline:true} agar pemanggil boleh lanjut alur ESB.
//  3. Mapper: mode APP → OrderType BE; item numerik → MenuID itu,
//     selainnya → MenuID 0 (kanon goPosItems sync.ts); kosong → null
//     (engine menghitung eligible dari items; tanpa items selalu 400 —
//     fakta lane E2E :18097 — pemanggil DILARANG call).
//  4. PayScreen.applyVoucher: GO dulu; GO-ok → pakai nominal server;
//     GO-tolak-definitif (bukan NOT_FOUND, bukan offline) → pesan i18n +
//     STOP; NOT_FOUND/offline → lanjut ESB. checkTender SENGAJA steril
//     (approval tender = universe ESB, bukan diskon GO).
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

  const server = read('config/server.ts');
  // strip() menelan baris di antara `/*` dalam komentar-baris (erp/member/*)
  // s.d. `*/` berikutnya — cek path memakai mentahan (kunci tanpa komentar).
  const serverRaw = readRaw('config/server.ts');
  const api = read('lib/apiSource.ts');
  const pay = read('screens/payment/PayScreen.tsx');

  // 1. Path kontrak.
  ok(/merchantPosVoucherPreview:\s*'api\/merchant\/orders\/pos\/validate-voucher-preview'/.test(serverRaw),
    'P12: ApiPath.merchantPosVoucherPreview = rute BE preview (prefix api/ = bearer)');
  ok(!/posValidatePreview/.test(serverRaw),
    'P12: tanpa alias path kedua (satu sumber kebenaran rute)');

  // 2. validatePosVoucherPreview: server-wins, tanpa fallback lintas-engine.
  ok(/export async function validatePosVoucherPreview/.test(api),
    'P12: validatePosVoucherPreview ada');
  ok(/merchantPosVoucherPreview/.test(api),
    'P12: preview memanggil ApiPath merchant (bukan path ESB)');
  ok(!/validateVoucherCodeLocal|validateVoucherCode\(code/.test(
    api.slice(api.indexOf('export async function validatePosVoucherPreview'))),
    'P12: preview TANPA fallback ESB/lokal di badan fungsi');
  ok(/offline:\s*true/.test(api),
    'P12: offline/dummy mengembalikan flag offline (pemanggil boleh lanjut ESB)');
  ok(/error:\s*String\(body\.error/.test(api),
    'P12: kode error server diteruskan (router NOT_FOUND vs tolak-definitif)');
  ok(/ok:\s*amount\s*>\s*0/.test(api),
    'P12: ok:true hanya bila discountAmount server > 0');

  // 3. Mapper.
  ok(/export function mapAppModeToGoOrderType/.test(api),
    'P12: mapper mode APP → OrderType BE ada');
  ok(/TAKE_AWAY.*TAKEAWAY|TAKEAWAY.*TAKE_AWAY/.test(api) && /DINE_IN/.test(api) && /IN_STORE_ORDER/.test(api),
    'P12: mapper mencakup DINE IN / TAKE AWAY / IN STORE ORDER');
  ok(/GOFOOD/.test(api) && /DELIVERY/.test(api),
    'P12: mapper marketplace → DELIVERY');
  ok(/export function mapSaleItemsToPreviewItems/.test(api),
    'P12: mapper item cart → preview items ada');
  ok(/\^\[0-9\]\+\$/.test(api),
    'P12: mapper id numerik → MenuID (kanon goPosItems)');
  ok(/menuId:\s*Number\.isFinite\(menuNum\)/.test(api) || /menuNum > 0 \? menuNum : 0/.test(api),
    'P12: mapper id non-numerik → MenuID 0 (custom diabaikan scope)');
  ok(/return out\.length > 0 \? out : null/.test(api),
    'P12: mapper kosong → null (pemanggil dilarang call tanpa items)');

  // 4. PayScreen wiring.
  ok(/validatePosVoucherPreview,\s*mapAppModeToGoOrderType,\s*mapSaleItemsToPreviewItems/.test(pay) ||
    (/validatePosVoucherPreview/.test(pay) && /mapSaleItemsToPreviewItems/.test(pay) && /mapAppModeToGoOrderType/.test(pay)),
    'P12: PayScreen impor trio preview');
  ok(/validatePosVoucherPreview\(\s*code,\s*goSubtotal,\s*goItems,\s*mapAppModeToGoOrderType\(orderMode\)/.test(pay),
    'P12: applyVoucher coba GO dulu dengan subtotal Σ items + orderType peta');
  ok(/g\.error !== 'VOUCHER_NOT_FOUND'/.test(pay),
    'P12: GO-tolak-definitif STOP; NOT_FOUND/offline lanjut ESB');
  ok(/!g\.offline/.test(pay),
    'P12: offline GO tidak dianggap penolakan (lanjut ESB)');
  ok(/kind:\s*''/.test(pay),
    'P12: hasil GO dicatat kind kosong (diskon belanja, bukan Ongkir)');
  const tenderZone = pay.slice(pay.indexOf('const checkTender'));
  ok(!/validatePosVoucherPreview|PosVoucher/.test(tenderZone),
    'P12: checkTender steril (approval tender = universe ESB)');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
