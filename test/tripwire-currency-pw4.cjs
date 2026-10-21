// Tripwire PW-4 currency/tz/clock/i18n (PP-006/PP-010/PP-011/PP-012):
// paritas format AUD + struk sadar-tz/currency + residu Rp/hardcode.
// Statik dari sumber (tanpa runtime RN), cermin gaya tripwire lain.
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

  const theme = read('theme/index.ts');
  const themeRaw = readRaw('theme/index.ts');
  const escpos = read('lib/escpos.ts');
  const i18nRaw = readRaw('lib/i18n.ts');
  const shift = read('screens/shift/ShiftScreen.tsx');
  const shiftRaw = readRaw('screens/shift/ShiftScreen.tsx');
  const voucher = read('screens/member/VoucherScreen.tsx');
  const cashier = read('screens/cashier/CashierScreen.tsx');
  const cart = read('screens/cashier/CartDetailScreen.tsx');
  const topup = read('screens/member/TopupDepositScreen.tsx');
  const receipt = read('screens/bill/ReceiptScreen.tsx');
  const history = read('lib/history.ts');
  const member = read('screens/member/MemberScreen.tsx');
  const sync = read('lib/sync.ts');

  // 1. Format AUD identik dashboard: A$ + grouping koma + 2 desimal TANPA spasi.
  ok(/A\$\$\{grouped\}\.\$\{dec\}/.test(themeRaw) || /A\$\`?\$\{grouped\}/.test(themeRaw),
    'PW4: theme format AUD A$+grouping+2desimal ada');
  ok(!/'A\$ ' \+/.test(theme) && !/`A\$ /.test(theme),
    'PW4: theme tanpa "A$ " berspasi (paritas dashboard A$10.50)');
  ok(/\.toFixed\(2\)/.test(theme), 'PW4: theme desimal-aware (bug round integer mati)');
  ok(/escMoney/.test(escpos) && /A\$\$\{grouped\}\.\$\{dec\}/.test(readRaw('lib/escpos.ts')),
    'PW4: escpos escMoney AUD mirroring theme');
  ok(/money\(r\./.test(escpos) || /escMoney\(/.test(escpos),
    'PW4: badan struk thermal lewat escMoney(currency)');
  ok(/currency: getCachedCurrency\(\)\.code/.test(receipt),
    'PW4: ReceiptScreen teruskan currency cabang ke cetak thermal');

  // 2. Kunci i18n AUD ada (A$ di id+en); jalur EN/AUD bebas Rp.
  for (const k of ['vou_kind_discount_aud', 'discItemAud', 'unitPriceAud', 'top_custom_label_aud']) {
    ok(new RegExp(k + ":\\s*\\{\\s*id:\\s*'[^']*A\\$[^']*',\\s*en:\\s*'[^']*A\\$[^']*'").test(i18nRaw),
      `PW4: i18n ${k} id+en pakai A$`);
  }
  for (const k of ['vou_kind_discount', 'discItemRp', 'unitPriceRp', 'top_custom_label']) {
    ok(new RegExp(k + ":\\s*\\{[^}]*en:\\s*'[^']*'").test(i18nRaw),
      `PW4: i18n ${k} ada`);
  }
  // Kunci IDR dasar sahih mengandung Rp (dipakai hanya saat currency IDR);
  // invarian = jalur tampil EN/AUD tak pernah menyentuh label Rp mentah
  // (dicek grup 3: semua titik tampil pilih kunci ikut currency) + tanpa
  // literal '(Rp)' di kode layar (komentar sudah dikupas strip()).
  const screens = [voucher, cashier, cart, topup, shift, member, receipt,
    read('screens/cashier/SplitBillScreen.tsx'),
    read('screens/cashier/PromotionListScreen.tsx'),
    read('screens/bill/BillPreviewScreen.tsx'),
    read('screens/payment/PayScreen.tsx'),
    read('screens/shift/EndShiftScreen.tsx')].join('\n');
  ok(!/\(Rp\)/.test(screens), 'PW4: tanpa literal (Rp) di jalur layar');
  ok(!/shf_zero_hint:[^}]*en:\s*'[^']*rupiah[^']*'/i.test(i18nRaw),
    'PW4: i18n shf_zero_hint.en bebas kata rupiah');

  // 3. Layar pilih label ikut currency cabang (bukan kunci Rp mentah).
  ok(/vou_kind_discount_aud/.test(voucher), 'PW4: VoucherScreen label ikut currency');
  ok(!/'Diskon \(Rp\)'/.test(voucher), 'PW4: VoucherScreen tanpa hardcode Diskon (Rp)');
  ok(/discItemAud/.test(cashier), 'PW4: CashierScreen label diskon ikut currency');
  ok(/unitPriceAud/.test(cart), 'PW4: CartDetailScreen label harga ikut currency');
  ok(/top_custom_label_aud/.test(topup), 'PW4: TopupDepositScreen label ikut currency');
  ok(/QUICK_AUD/.test(topup) && /MIN_TOPUP_AUD/.test(topup),
    'PW4: TopupDepositScreen chip+minimum ikut currency');

  // 4. ShiftScreen: tanpa teks Indonesia hardcode; chip+maks ikut currency.
  ok(/t\('shf_att_link'\)/.test(shift), 'PW4: ShiftScreen tautan absensi lewat i18n');
  ok(/t\('shf_pin_hint'\)/.test(shift), 'PW4: ShiftScreen hint PIN lewat i18n');
  ok(!/Belum absen\? Catat/.test(shiftRaw), 'PW4: ShiftScreen tanpa hardcode teks absensi');
  ok(!/PIN kasir untuk membuka shift/.test(shiftRaw), 'PW4: ShiftScreen tanpa hardcode hint PIN');
  ok(/QUICK_NOMINAL_AUD/.test(shift) && /MAX_KAS_AWAL_AUD/.test(shift),
    'PW4: ShiftScreen chip+maks kas awal ikut currency');

  // 5. Sadar zona-merchant: fmtShift tz-param; struk + laporan pakai InTz.
  ok(/getCachedTimezone\(\)/.test(shift), 'PW4: ShiftScreen fmtShift pakai zona cabang');
  ok(/fmtDateInTz/.test(receipt) && /fmtTimeInTz/.test(receipt),
    'PW4: ReceiptScreen header tanggal sadar-zona-cabang');
  ok(/fmtSalesDateInTz/.test(history), 'PW4: history riwayat ikut zona merchant');
  ok(/fmtDateInTz\(new Date\(\), lang\)/.test(member), 'PW4: MemberScreen cap tanggal ikut zona merchant');
  ok(/fmtDateInTz\(d, lang\)/.test(voucher), 'PW4: VoucherScreen tanggal berlaku ikut zona merchant');
  ok(/fmtDateInTz\(now/.test(sync) || /fmtDateInTz/.test(sync),
    'PW4: sync cap waktu ikut zona merchant');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  for (const f of r.failures) console.log('FAIL ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
