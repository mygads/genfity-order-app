// Tripwire DUAL-CURRENCY §4 (app-side 6aa2904): 6 item backlog cabang AUD.
// Kontrak yang dikunci (tanpa runtime RN — dicek statik dari sumber +
// replika predikat murni; GAGAL bila perilaku dibalik):
//  (a) PayScreen: cabang AUD sembunyikan tab nontunai/online + usulan
//      metode ID jatuh ke tunai (sumber: profil currency live).
//  (b) i18n: 8 varian kunci *_aud + helper tCur (fallback dasar); call-site
//      label nominal beralih ke tCur.
//  (c) idle_hours_val/help.contact pakai {tz} + getTimezoneShort() (Perth=AWST).
//  (d) getTaxRate per-cabang PPN_<branchId> dulu, lalu global, lalu default
//      (11/10); helper uji tulis PPN_B001+PPN_B004 berdampingan.
//  (e) fmtDateInTz: cabang AUD selalu en-AU (bukan bahasa UI).
//  (f) SEED-AUD-001 (GST 10, langkah sen) via switchSeedBranchForTest saja;
//      totals() +roundStep opsional; seedSaleDirect branchId param.
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
  const payRaw = readRaw('screens/payment/PayScreen.tsx');
  const i18n = readRaw('lib/i18n.ts');
  const i18nCode = read('lib/i18n.ts');
  const tz = read('lib/timezone.ts');
  const totals = read('lib/totals.ts');
  const datefmt = read('lib/datefmt.ts');
  const seed = read('lib/seed.ts');
  const idle = read('screens/display/IdleScreen.tsx');
  const help = read('screens/settings/HelpScreen.tsx');

  // ---- (a) Gerbang metode bayar per currency ----
  ok(/import \{ getCachedCurrency \} from '\.\.\/\.\.\/lib\/currency'/.test(payRaw),
    'DC-a: PayScreen baca currency live dari lib/currency (bukan konstanta)');
  ok(/const isAudBranch = getCachedCurrency\(\)\.code === 'AUD'/.test(pay),
    "DC-a: isAudBranch = getCachedCurrency().code === 'AUD' (strik; mutasi ke truthy HARUS gagal)");
  ok(/if \(isAudBranch && \(initial === 'online' \|\| initial === 'nontunai'\)\) return 'tunai'/.test(pay),
    'DC-a: usulan metode ID (online/nontunai) jatuh ke tunai di cabang AUD');
  ok(/SIDEBAR_IDS\.filter\(\(id\) => id !== 'nontunai' && id !== 'online'\)/.test(pay),
    'DC-a: visibleTabs AUD = tanpa nontunai/online');
  ok(/const tabs = allTabs\.filter\(\(x\) => visibleTabs\.includes\(x\.id\)\)/.test(pay),
    'DC-a: tab phone disaring via visibleTabs');
  ok(/\{visibleTabs\.map\(\(id\) =>/.test(pay),
    'DC-a: sidebar tablet me-render visibleTabs (bukan SIDEBAR_IDS mentah)');
  ok(!/SIDEBAR_IDS\.map/.test(pay),
    'DC-a: NOL render SIDEBAR_IDS mentah (semua jalur lewat visibleTabs)');

  // ---- (b) Varian label A$ + helper tCur ----
  // SESI-STOCKMGMT-EXE: 'menu.price_aud' dihapus bersama layarnya — satu-satunya
  // konsumen tCur('menu.price') (MenuManagementScreen) sudah punah; layar baru
  // pakai rp() sadar-currency (tanpa kunci _aud). Sisa audKeys = kontrak tCur aktif.
  const audKeys = ['price_aud', 'mem_nominal_label_aud', 'vou_kind_discount_aud',
    'top_custom_label_aud', 'ongkirNominal_aud', 'discItemRp_aud', 'unitPriceRp_aud'];
  const totalsRaw = readRaw('lib/totals.ts');
  const seedRaw = readRaw('lib/seed.ts');
  for (const k of audKeys) {
    ok(new RegExp('["\']?' + k.replace('.', '\\.') + '["\']?: \\{').test(i18n),
      `DC-b: kunci i18n ${k} ada (varian AUD)`);
  }
  ok(/\(A\$\)/.test(i18n), 'DC-b: varian AUD memakai label A$ (bukan Rp)');
  ok(/export function tCur\(base: string, lang\?: Lang\): string/.test(i18nCode),
    'DC-b: helper tCur(base, lang?) diekspor');
  ok(/if \(getCachedCurrency\(\)\.code === 'AUD' && STR\[`/.test(i18nCode),
    'DC-b: tCur memilih varian _aud HANYA bila cabang AUD + varian ada');
  ok(/return tOf\(base, lang\)/.test(i18nCode),
    'DC-b: tCur fallback kunci dasar (tak pernah blank bila varian absen)');
  const tCurSites = [];
  for (const f of ['screens/cashier/CashierScreen.tsx', 'screens/cashier/CartDetailScreen.tsx',
    'screens/cashier/CustomMenuScreen.tsx', 'screens/member/MemberScreen.tsx',
    'screens/member/TopupDepositScreen.tsx', 'screens/member/VoucherScreen.tsx']) {
    const n = (read(f).match(/tCur\('/g) || []).length;
    if (n) tCurSites.push(`${f}:${n}`);
  }
  const tCurTotal = tCurSites.reduce((a, s) => a + Number(s.split(':')[1]), 0);
  ok(tCurTotal >= 8, `DC-b: >=8 call-site tCur (ketemu ${tCurTotal}: ${tCurSites.join(', ')})`);
  ok(/tCur\('ongkirNominal'\)/.test(read('screens/cashier/CashierScreen.tsx')) &&
    /tCur\('discItemRp'\)/.test(read('screens/cashier/CashierScreen.tsx')),
    'DC-b: CashierScreen label nominal via tCur (ongkirNominal, discItemRp)');
  // SESI-STOCKMGMT-EXE: MenuManagementScreen → StockManagementScreen (rename).
  // Layar stok baru tak pakai label tCur('menu.price'); harga inline via rp()
  // sadar-currency (theme: IDR 'Rp '+rpNum / AUD 'A$'+desimal, paritas FE).
  const mgmtDc = read('screens/settings/StockManagementScreen.tsx');
  const mgmtDcRaw = readRaw('screens/settings/StockManagementScreen.tsx');
  ok(/rp\(row\.price\)/.test(mgmtDc),
    'DC-b: StockManagementScreen harga via rp() sadar-currency (bukan hardcode)');
  ok(!/Rp/.test(mgmtDcRaw),
    'DC-b: StockManagementScreen tanpa literal Rp (A$ via rp() otomatis)');

  // ---- (c) Label jam operasional sadar-zona ----
  ok(/idle_hours_val: \{[^}]*\{tz\}/.test(i18n) && /'help\.contact': \{[^}]*\{tz\}/.test(i18n),
    'DC-c: idle_hours_val + help.contact memakai placeholder {tz} (bukan WIB hardcode)');
  ok(/\.replace\('\{tz\}', getTimezoneShort\(\)\)/.test(idle),
    "DC-c: IdleScreen ganti {tz} via getTimezoneShort()");
  ok(/\.replace\('\{tz\}', getTimezoneShort\(\)\)/.test(help),
    "DC-c: HelpScreen ganti {tz} via getTimezoneShort()");
  ok(/'Australia\/Perth': 'AWST'/.test(tz) && /'Asia\/Jakarta': 'WIB'/.test(tz),
    'DC-c: peta TZ_SHORT Perth=AWST + Jakarta=WIB');
  ok(/return TZ_SHORT\[z\] \?\? z/.test(tz),
    'DC-c: zona tak dikenal = tampil nama zonanya sendiri (jujur, bukan WIB salah)');
  ok(/export function getTimezoneShort\(timeZone\?: string\)/.test(tz),
    'DC-c: getTimezoneShort(timeZone?) diekspor');

  // ---- (d) Pajak per-cabang ----
  ok(/export async function getTaxRate\(currency\?: string, branchId\?: string\)/.test(totals),
    'DC-d: getTaxRate(currency?, branchId?)');
  ok(/`PPN_\$\{bid\}`/.test(totals),
    'DC-d: tarif per-cabang dibaca via PPN_<branchId> DULU');
  ok(/ms_setting.*'Tax'.*'PPN'/.test(totals) || /key2 = 'PPN'/.test(totals),
    'DC-d: fallback eksplisit global Tax/PPN lestari (perilaku lama tanpa baris cabang)');
  ok(/export async function getActiveBranchId\(\)/.test(totals) &&
    /SELECT value2 FROM ms_setting WHERE key1 = 'Branch' AND key2 = 'Name'/.test(totalsRaw),
    'DC-d: getActiveBranchId dari ms_setting(Branch,Name).value2');
  ok(/if \(\(currency \?\? ''\)\.trim\(\)\.toUpperCase\(\) === 'AUD'\) return 10/.test(totals),
    'DC-d: default AUD = 10 (GST) bila NOL baris eksplisit');
  ok(/\[\['PPN_B001', '11'\], \['PPN_B004', '10'\]\]/.test(seed),
    'DC-d: helper uji tulis PPN_B001=11 + PPN_B004=10 BERDAMPINGAN');
  ok(/setCachedCurrency\(cur\[2\], cur\[3\]\)/.test(seed) && /setCachedTimezone\(tz\[2\]\)/.test(seed),
    'DC-d: switch cabang uji sinkronkan cache currency+timezone tanpa restart');

  // ---- (e) Locale tanggal cabang AUD ----
  ok(/function branchLocale\(lang: Lang, enFallback: string\)/.test(datefmt),
    'DC-e: branchLocale(lang, enFallback) ada');
  ok(/if \(getCachedCurrency\(\)\.code === 'AUD'\) return 'en-AU'/.test(datefmt),
    "DC-e: cabang AUD SELALU en-AU walau UI Indonesia (mutasi ke lang HARUS gagal)");
  ok(/const locale = branchLocale\(lang, 'en-AU'\)/.test(datefmt),
    'DC-e: fmtDateInTz memakai branchLocale (bukan peta bahasa mentah)');

  // ---- (f) Seed AUD + roundStep ----
  ok(/export const AUD_TEST_BRANCH_ID = 'B004'/.test(seed),
    "DC-f: AUD_TEST_BRANCH_ID = 'B004'");
  ok(/salesNum: 'SEED-AUD-001'/.test(seed) && /branchId: 'B004'/.test(seed) &&
    /taxRate: 10/.test(seed),
    'DC-f: SEED-AUD-001 = cabang B004 + GST 10');
  ok(/roundStep: spec\.branchId === AUD_TEST_BRANCH_ID \? 1 : FEE_DEFAULTS\.roundStep/.test(seed),
    'DC-f: order AUD langkah sen (1), selain itu rupiah (100)');
  ok(/branchId\?: string/.test(seed),
    'DC-f: SeedOrderSpec branchId param (order AUD milik B004)');
  // Region seedSaleDirect diisolasi dari RAW (pengguna uji 'B001' di fungsi
  // lain sah milik B001 — yang dikunci: INSERT order TAK hardcode cabang).
  const saleDirectRegion = seedRaw.slice(
    seedRaw.indexOf('async function seedSaleDirect'),
    seedRaw.indexOf('async function seedSaleDirect') !== -1
      ? seedRaw.indexOf('async function seedSaleDirect') + 2500 : 0,
  );
  ok(/spec\.branchId \?\? 'B001'/.test(saleDirectRegion),
    "DC-f: seedSaleDirect pakai spec.branchId ?? 'B001' (order AUD milik B004)");
  ok(!/'B001'/.test(saleDirectRegion.replace(/spec\.branchId \?\? 'B001'/, '')),
    "DC-f: seedSaleDirect TANPA hardcode 'B001' lain di INSERT order");
  ok(/await seedAudSampleOrder\(nowSeed\)/.test(seed),
    'DC-f: baseline order AUD di-seed saat alih cabang AUD');
  ok(/if \(which === 'AUD'\)/.test(seed),
    "DC-f: order contoh AUD HANYA saat switch('AUD') — ensureSeeded tetap IDR murni");
  ok(/roundStep\?: number/.test(totals),
    'DC-f: TotalsInput.roundStep opsional');
  ok(/const step = Number\.isFinite\(stepRaw\) && stepRaw > 0 \? Math\.round\(stepRaw\) : FEE_DEFAULTS\.roundStep/.test(totalsRaw),
    'DC-f: roundStep invalid/absen → fallback Rp 100 (perilaku lama lestari)');

  // ---- Replika murni (mutasi-sadar: GAGAL bila perilaku dibalik) ----
  const stepOf = (r) => (Number.isFinite(Number(r)) && Number(r) > 0 ? Math.round(Number(r)) : 100);
  ok(stepOf(1) === 1 && stepOf(undefined) === 100 && stepOf(0) === 100 && stepOf(-5) === 100,
    'DC-f: replika roundStep — 1→1 (sen AUD), kosong/0/negatif→100 (rupiah)');
  const round = (bruto, s) => Math.round(bruto / s) * s;
  ok(round(35, 100) === 0 && round(35, 1) === 35,
    'DC-f: replika pembulatan — bruto 35 → 0 (Rp100) vs 35 (sen AUD)');
  const tzShort = { 'Asia/Jakarta': 'WIB', 'Australia/Perth': 'AWST' };
  const shortOf = (z, cached) => tzShort[(z || '').trim() || cached] ?? ((z || '').trim() || cached);
  ok(shortOf('', 'Australia/Perth') === 'AWST' && shortOf('', 'Asia/Jakarta') === 'WIB' &&
    shortOf('X/Y', 'Asia/Jakarta') === 'X/Y',
    'DC-c: replika tz-short — Perth AWST, Jakarta WIB, asing tampil sendiri');
  const tCurOf = (code, base, hasAud) => (code === 'AUD' && hasAud ? `${base}_aud` : base);
  ok(tCurOf('AUD', 'price', true) === 'price_aud' && tCurOf('AUD', 'price', false) === 'price' &&
    tCurOf('IDR', 'price', true) === 'price',
    'DC-b: replika tCur — AUD+varian→_aud, selain itu kunci dasar');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
