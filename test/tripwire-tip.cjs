// Tripwire tip v1 (fitur tip/gratuity pelanggan, 2026-10): rantai tip end-to-end
//  1. PayScreen: state tip (tipMode/tipCustom/tipBase/tipAmount), payable += tip,
//     input tipTotal + nav tip ke Qris/Edc/Success/Member; split grup paksa 0.
//  2. QrisScreen + EdcScreen: single input tipTotal + Success tip; grup TANPA tip.
//  3. SuccessScreen: baca tip + baris pratinjau + receiptParams tip.
//  4. ReceiptScreen: baca tip + subtotal mundur − tip + baris kertas +
//     share-text + payload thermal tip.
//  5. escpos: interface + baris 'Tip' setelah Service.
//  6. master pull: cols ↔ map parity ('tip' di kedua sisi, cermin voucher).
//  7. sales: getSaleTip + move-menempel (tip ikut bill, grand konservasi).
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

  const pay = read('screens/payment/PayScreen.tsx');
  const payFlat = pay.replace(/\s+/g, ' ');
  const qris = read('screens/payment/QrisScreen.tsx');
  const qrisRaw = readRaw('screens/payment/QrisScreen.tsx');
  const edc = read('screens/payment/EdcScreen.tsx');
  const success = read('screens/payment/SuccessScreen.tsx');
  const receipt = read('screens/bill/ReceiptScreen.tsx');
  const escpos = read('lib/escpos.ts');
  const escposRaw = readRaw('lib/escpos.ts');
  const master = read('lib/master.ts');
  const sales = read('lib/sales.ts');
  const payments = read('lib/payments.ts');
  const i18n = readRaw('lib/i18n.ts');
  const history = read('screens/history/HistoryScreen.tsx');
  const member = read('screens/member/MemberScreen.tsx');
  const cancelRaw = readRaw('screens/bill/CancelScreen.tsx');

  // 1. PayScreen: state + payable + sebaran.
  ok(/tipMode/.test(pay) && /tipCustom/.test(pay), 'TIP: PayScreen state tipMode/tipCustom ada');
  ok(/tipBase/.test(pay), 'TIP: PayScreen tipBase (cap = subtotal item) ada');
  ok(/isSplitGroup \? 0 :/.test(pay), 'TIP: PayScreen split grup paksa tip 0');
  ok(/payable.*tipAmount|tipAmount.*payable/.test(payFlat) || /total - boxBelanjaAmt - boxOngkirCut \+ tipAmount/.test(pay),
    'TIP: PayScreen payable += tipAmount');
  ok(/tipTotal: tipAmount/.test(pay), 'TIP: PayScreen single input tipTotal ada');
  ok((pay.match(/\.\.\.\(tipAmount > 0 \? \{ tip: tipAmount \} : \{\}\)/g) || []).length >= 3,
    'TIP: PayScreen nav tip ke Qris/Edc/Success (+Member) >= 3 sebaran');
  ok(/p\?\.tip != null \? \{ tip: p\.tip \} : \{\}/.test(member) || /\.\.\.\(tipAmount > 0 \? \{ tip: tipAmount \} : \{\}\)/.test(pay),
    'TIP: rantai Member↔Pay tip lestari');

  // 2. Qris/Edc single + grup-eksklusi.
  ok(/tipParam/.test(qris), 'TIP: QrisScreen baca tipParam ada');
  ok(/tipTotal: tipParam/.test(qris), 'TIP: QrisScreen single input tipTotal ada');
  ok(/tip: tipParam/.test(qris), 'TIP: QrisScreen Success tip ada');
  ok(/tipParam/.test(edc), 'TIP: EdcScreen baca tipParam ada');
  ok(/tipTotal: tipParam/.test(edc), 'TIP: EdcScreen single input tipTotal ada');
  ok(/tip: tipParam/.test(edc), 'TIP: EdcScreen Success tip ada');
  ok(/p\.tip \? \{ tip: p\.tip \} : \{\}/.test(edc), 'TIP: EdcScreen back-nav ke Pay bawa tip');
  // Grup split: gInput (visitPay/orderTotalFull) TANPA tipTotal — tip grup = 0.
  const qrisGroup = qrisRaw.slice(0, qrisRaw.indexOf('const input: SaleInput'));
  ok(!/tipTotal/.test(strip(qrisGroup)), 'TIP: QrisScreen grup gInput TANPA tipTotal');
  ok(!/tipTotal: tipParam/.test(edc.slice(0, edc.indexOf('payments: [...fwdSplits'))),
    'TIP: EdcScreen grup gInput TANPA tipTotal');

  // 3. SuccessScreen.
  ok(/tip\?: number/.test(success), 'TIP: SuccessScreen Props tip ada');
  ok(/pay_tip_row/.test(success), 'TIP: SuccessScreen baris pratinjau pay_tip_row ada');
  ok(/\+{rp\(tip\)}/.test(success), 'TIP: SuccessScreen pratinjau +tip ada');
  ok(/\.\.\.\(tip > 0 \? \{ tip \} : \{\}\)/.test(success), 'TIP: SuccessScreen receiptParams tip ada');

  // 4. ReceiptScreen.
  ok(/tip\?: number/.test(receipt), 'TIP: ReceiptScreen Props tip ada');
  ok(/- feeESB - tip\)/.test(receipt), 'TIP: ReceiptScreen subtotal mundur − tip');
  ok(/pay_tip_row/.test(receipt), 'TIP: ReceiptScreen baris kertas pay_tip_row ada');
  ok(/pay_tip_row.*\+|\+.*pay_tip_row/.test(receipt.replace(/\n/g, ' ')), 'TIP: ReceiptScreen share-text +tip ada');
  ok(/\.\.\.\(tip > 0 \? \{ tip \} : \{\}\)/.test(receipt), 'TIP: ReceiptScreen payload thermal tip ada');

  // 5. escpos.
  ok(/tip\?: number/.test(escpos), 'TIP: escpos EscReceipt.tip ada');
  ok(/row2\(out, 'Tip'/.test(escposRaw), "TIP: escpos baris 'Tip' ada");

  // 6. master pull parity + payments payload.
  ok(/'tip'/.test(master), 'TIP: master cols pull ada tip');
  ok(/r\.tip \?\? r\.tipAmount/.test(master), 'TIP: master map pull ada tip/tipAmount');
  ok(/tipAmount/.test(payments), 'TIP: payments buildSalePayload tipAmount ada');

  // 7. sales lib + i18n + history + cancel.
  ok(/getSaleTip/.test(sales), 'TIP: sales getSaleTip ada');
  ok(/tip: number/.test(sales), 'TIP: sales HeadTotals.tip ada');
  ok(/n\(src\.tip\)|src\.tip/.test(sales), 'TIP: sales move-menempel src tip ada');
  ok(/n\(dest\?\.tip/.test(sales), 'TIP: sales move-menempel dest tip ada');
  for (const k of ['pay_tip_title', 'pay_tip_sub', 'pay_tip_none', 'pay_tip_custom', 'pay_tip_added', 'pay_tip_row']) {
    ok(new RegExp(k).test(i18n), `TIP: i18n kunci ${k} ada`);
  }
  ok(/getSaleTip/.test(history), 'TIP: HistoryScreen reprint bawa tip via getSaleTip');
  ok(/tip/.test(cancelRaw), 'TIP: CancelScreen komentar konservasi tip ada');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
