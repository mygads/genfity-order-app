// Tripwire Adaptive Vertical Shell (audit multi-merchant 2026-10-29):
// 1 platform + 7 preset vertikal, bukan 1 UI untuk semua.
// Kunci invarian statik tanpa runtime RN.
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const BE = path.join(__dirname, '..', '..', 'services', 'genfity-order-services');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));
const readBE = (p) => fs.readFileSync(path.join(BE, p), 'utf8');

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => { checks++; if (!cond) failures.push(name); };

  const vert = readRaw('lib/verticals.ts');
  const modes = read('lib/posModes.ts');
  const cashier = readRaw('screens/cashier/CashierScreen.tsx');
  const cashierS = strip(cashier);
  const pay = readRaw('screens/payment/PayScreen.tsx');
  const cartD = readRaw('screens/cashier/CartDetailScreen.tsx');
  const drawer = readRaw('components/DrawerMenu.tsx');
  const dash = readRaw('screens/home/DashboardScreen.tsx');
  const settings = readRaw('screens/settings/SettingsScreen.tsx');
  const receipt = readRaw('lib/receiptTemplate.ts');
  const sync = readRaw('lib/sync.ts');
  const i18n = readRaw('lib/i18n.ts');
  const schema = readRaw('lib/dbSchema.ts');

  // 1. Taksonomi 7 vertikal
  for (const id of ['COFFEE','WARUNG_QSR','RESTO_FULL','FASHION','GROCERY','PULSA_DIGITAL','SERVICE'])
    ok(vert.includes(id), `VERTICAL: ${id} terdaftar di lib/verticals.ts`);
  ok(/export function isValidPhoneNumberID/.test(vert), 'VERTICAL: validasi nomor HP Indonesia ada');
  ok(/export function posModesForVertical/.test(modes), 'VERTICAL: posModesForVertical ada (preset > tipe)');
  ok(/getCachedVerticalId/.test(modes) && /setCachedVerticalId/.test(modes), 'VERTICAL: cache verticalId ada');
  ok(/syncVerticalIdFromProfile/.test(modes), 'VERTICAL: sync vertical dari profil ada');

  // 2. Cashier integrasi Fase 2 (bukan orphan)
  ok(/renderVerticalPanel/.test(cashier), 'CASHIER: renderVerticalPanel dipakai');
  ok(/PhoneTopupForm/.test(cashier), 'CASHIER: PhoneTopupForm terintegrasi (bukan orphan)');
  ok(/ServiceScheduleForm/.test(cashier), 'CASHIER: ServiceScheduleForm terintegrasi');
  ok(/ScanBar/.test(cashier), 'CASHIER: ScanBar terintegrasi (retail/grocery)');
  ok(/VariantPicker/.test(cashier), 'CASHIER: VariantPicker terintegrasi (fashion)');
  ok(/ModeBar/.test(cashier), 'CASHIER: ModeBar quick-switch dipakai (≤3 mode)');
  ok(/addPulsaToCart/.test(cashier), 'CASHIER: addPulsaToCart ada (nomor→nominal→keranjang)');
  ok(/payPolicyBlockReason\(getCachedVerticalId\(\)(,\s*0)?\)/.test(cashier), 'CASHIER: draft PREPAID diblokir (goSaved)');
  ok(/serviceDate/.test(cashier) && /serviceTime/.test(cashier) && /technician/.test(cashier), 'CASHIER: jadwal jasa dibawa ke Cart/Pay');
  ok(/PRODUCTS_DEV_FALLBACK/.test(cashier) && /__DEV__/.test(cashier), 'CASHIER: dummy F&B DEV-only (prod kosong = empty-state jujur)');

  // 3. Komponen reusable konsisten tema
  for (const f of ['components/cashier/ModeBar.tsx','components/cashier/CatalogGrid.tsx','components/cashier/CartPanel.tsx','components/vertical/ScanBar.tsx','components/vertical/VariantPicker.tsx','components/vertical/PhoneTopupForm.tsx','components/vertical/ServiceScheduleForm.tsx','components/vertical/VerticalOnboarding.tsx'])
    ok(fs.existsSync(path.join(SRC, f)), `COMP: ${f} ada`);
  ok(readRaw('components/vertical/ScanBar.tsx').includes('colors.') && readRaw('components/vertical/ScanBar.tsx').includes("from '../../theme'"), 'COMP: ScanBar pakai tema kanonis');
  ok(readRaw('components/cashier/ModeBar.tsx').includes('minHeight: 44') || readRaw('components/cashier/ModeBar.tsx').includes('minHeight:44'), 'COMP: ModeBar sentuh ≥44dp');

  // 4. Pay + Cart PREPAID
  ok(/payPolicyBlockReason/.test(pay), 'PAY: payPolicyBlockReason dipakai (hold PREPAID diblokir)');
  ok(/pay\.prepaidOnly/.test(pay), 'PAY: hint prepaidOnly tampil');
  ok(/payPolicyBlockReason\(getCachedVerticalId\(\)(,\s*0)?\)/.test(cartD), 'CART: draft PREPAID diblokir');
  ok(/payPolicyBlockReason/.test(sync), 'SYNC: payPolicyBlockReason ada (defense-in-depth)');

  // 5. Gating drawer/dashboard/settings
  ok(/getCachedVerticalId/.test(drawer), 'DRAWER: gating vertikal ada');
  ok(/getCachedVerticalId/.test(dash), 'DASHBOARD: gating vertikal ada');
  ok(/VERTICAL_SWITCH/.test(settings) || /verticalPickOpen/.test(settings), 'SETTINGS: ganti vertikal via PIN ada');

  // 6. Struk vertikal
  ok(/receiptPresetForVertical/.test(receipt), 'RECEIPT: preset per vertikal ada');
  ok(/PULSA_DIGITAL/.test(receipt) && /58mm/.test(receipt), 'RECEIPT: pulsa 58mm ada');
  ok(/pulsaNote/.test(readRaw('screens/bill/ReceiptScreen.tsx')), 'RECEIPT: SN pulsa monospace besar (pulsaNote)');

  // 7. i18n
  ok(/cashier\.emptyTitle/.test(i18n), 'I18N: empty-state jujur ada');
  ok(/pay\.prepaidOnly/.test(i18n) && /pay\.dpHint/.test(i18n), 'I18N: prepaid/dp hint ada');
  ok(/settings\.vertical/.test(i18n), 'I18N: jenis usaha ada');

  // 8. DB polimorfik FE
  ok(/kind TEXT DEFAULT 'MENU'/.test(schema), 'DB-FE: ms_menu kind ada');
  ok(/ALTER TABLE ms_menu ADD COLUMN kind/.test(schema), 'DB-FE: migrasi kind best-effort ada');

  // 9. BE
  try {
    ok(fs.existsSync(path.join(BE, 'internal/db/migrations/00213_merchant_vertical.sql')), 'BE: migrasi 00213 vertical ada');
    ok(fs.existsSync(path.join(BE, 'internal/db/migrations/00215_catalog_polymorphic.sql')), 'BE: migrasi 00215 polimorfik ada');
    const mv = readBE('internal/http/handlers/merchant_vertical.go');
    ok(/PULSA_DIGITAL/.test(mv), 'BE: vertical handler kenal PULSA_DIGITAL');
    const mig = readBE('internal/db/migrations/00215_catalog_polymorphic.sql');
    ok(/ADD COLUMN IF NOT EXISTS kind/.test(mig), 'BE: migrasi kind IF NOT EXISTS');
  } catch (e) { ok(false, 'BE: file migrasi/handler terbaca (' + e.message + ')'); }


  // Fase 3: BOPIS + HOME_SERVICE + modifier + kasbon + hybrid + laporan + retur
  ok(/IN STORE PICKUP/.test(vert), 'F3: FASHION/GROCERY tawar IN STORE PICKUP (BOPIS)');
  ok(/HOME SERVICE/.test(vert), 'F3: SERVICE tawar HOME SERVICE');
  ok(/deliveryAddress/.test(sync) && /deliveryFee/.test(sync), 'F3: sync bawa alamat + ongkir ke BE');
  ok(/IN_STORE_PICKUP/.test(sync) && /HOME_SERVICE/.test(sync), 'F3: goPosOrderType dukung PICKUP + HOME_SERVICE');
  ok(/MODIFIER_PRESETS/.test(readRaw('lib/verticals.ts')), 'F3: preset modifier 1-tap ada');
  ok(/toggleModifier/.test(cashier), 'F3: toggle modifier dipakai di editor');
  ok(/VERTICAL_POLICY/.test(readRaw('lib/verticals.ts')), 'F3: kebijakan retur/kasbon ada');
  ok(/kasbonBox/.test(pay), 'F3: CTA kasbon di Pay (limit + nama)');
  ok(/getHybridVerticals/.test(read('lib/posModes.ts')), 'F3: hybrid store ada');
  ok(/hybridView/.test(cashier), 'F3: hybrid chips di kasir');
  ok(fs.existsSync(path.join(SRC, 'lib/verticalReports.ts')), 'F3: verticalReports ada');
  ok(/insightFor/.test(readRaw('screens/home/DashboardScreen.tsx')), 'F3: kartu insight di dashboard');
  ok(/verticalId\?: unknown/.test(readRaw('lib/cancelReasons.ts')), 'F3: preset retur vertikal di cancelReasons');
  ok(/svcAddress/.test(cashier), 'F3: alamat home service di kasir');
  ok(/addressBox/.test(cashier), 'F3: input alamat konsisten tema');
  // Fase 3b: retur 7-hari + unitLabel + ongkir-laporan + konsistensi tema
  ok(/returnExpired/.test(readRaw('screens/bill/CancelScreen.tsx')) && /7 hari/.test(readRaw('screens/bill/CancelScreen.tsx')), 'F3b: retur 7-hari dienforce di Cancel (warning + blokir)');
  ok(/unitLabel/.test(cashier) && /rowLow/.test(cashier), 'F3b: unit pcs/kg + badge Stok menipis di list HP');
  ok(/unitLabel/.test(readRaw('components/cashier/CatalogGrid.tsx')), 'F3b: CatalogGrid tampilkan unit + low');
  ok(/colors\.primary/.test(readRaw('components/cashier/CartPanel.tsx')) && !/backgroundColor: colors\.navy/.test(readRaw('components/cashier/CartPanel.tsx')), 'F3b: CartPanel CTA primary (konsisten tema)');
  ok(/Ongkir agregator/.test(readRaw('lib/verticalReports.ts')), 'F3b: laporan pisah ongkir vs bersih');
  // Fase 3c (audit penutup): konsistensi tema + wiring preset + katalog + supervisor-override
  ok(/backgroundColor: colors\.primary/.test(readRaw('components/vertical/ScanBar.tsx')), 'F3c: ScanBar tombol scan primary (konsisten CTA)');
  ok(/color: colors\.navy/.test(readRaw('components/vertical/VariantPicker.tsx')), 'F3c: VariantPicker label navy (konsisten section header)');
  ok(/Pastikan online/.test(readRaw('components/vertical/PhoneTopupForm.tsx')), 'F3c: pulsa ingatkan online-check harga/stok provider');
  ok(/receiptPresetForVertical/.test(readRaw('screens/bill/ReceiptScreen.tsx')) && /paperNarrow/.test(readRaw('screens/bill/ReceiptScreen.tsx')), 'F3c: Receipt pakai preset vertikal (58mm pulsa + footer)');
  ok(/unitLabel\?\: string/.test(readRaw('lib/masterGo.ts')) && /UPDATE ms_menu SET unitLabel/.test(readRaw('lib/masterGo.ts')), 'F3c: pull katalog bawa unit/sku/provider (best-effort)');
  ok(/x\.jobs} job/.test(readRaw('lib/verticalReports.ts')), 'F3c: laporan jasa tampil job + omzet per teknisi');
  ok(/wajib lewat dialog supervisor/.test(readRaw('screens/bill/CancelScreen.tsx')), 'F3c: retur kedaluwarsa via supervisor (bukan hard-block buta)');
  ok(/superset/.test(cashier) && !/import CatalogGrid/.test(cashier), 'F3c: grid custom didokumenkan superset (tanpa import mati)');
  // Fase 3d (penutup rantai jasa): jadwal/teknisi/DP/alamat sampai ke BE + struk (BE 400 bila putus)
  ok(/policy === 'PREPAID'/.test(sync) && !/due > 0/.test(sync), 'F3d: PREPAID guard berbasis aksi (selalu tolak hold/parked)');
  ok(/HOME_SERVICE' || orderType === 'IN_STORE_SERVICE/.test(sync), 'F3d: notes teknisi/DP ikut untuk SERVICE (bukan HOME saja)');
  ok(/serviceDate\?: string/.test(readRaw('lib/payments.ts')) && /serviceDate: s\.serviceDate/.test(readRaw('lib/payments.ts')), 'F3d: SaleInput + payload bawa serviceDate ke antrean');
  ok(/technician\?: string/.test(readRaw('lib/payments.ts')) && /Teknisi/.test(readRaw('lib/payments.ts')), 'F3d: teknisi/DP dilipat ke notes payload');
  ok(/serviceDate \? \{ serviceDate \}/.test(cartD), 'F3d: CartDetail teruskan jadwal ke Pay');
  ok(/serviceDateParam/.test(pay) && /dpPercentParam/.test(pay), 'F3d: Pay baca jadwal/DP + teruskan ke sale & struk');
  ok(/svcLine/.test(readRaw('screens/bill/ReceiptScreen.tsx')) && /serviceInfo/.test(readRaw('screens/bill/ReceiptScreen.tsx')), 'F3d: struk tampilkan jadwal/teknisi/DP');
  ok(/serviceInfo\?: string/.test(readRaw('lib/escpos.ts')) && /r\.serviceInfo/.test(readRaw('lib/escpos.ts')), 'F3d: ESC/POS render serviceInfo');
  // Fase 3e (rantai penuh jasa): QRIS/EDC/BillPreview teruskan jadwal; switch vertikal selaras server
  ok(/serviceDateParam/.test(readRaw('screens/payment/QrisScreen.tsx')) && /dpPercentParam/.test(readRaw('screens/payment/QrisScreen.tsx')), 'F3e: QRIS teruskan jadwal/DP ke sale & struk');
  ok(/serviceDateParam/.test(readRaw('screens/payment/EdcScreen.tsx')) && /dpPercentParam/.test(readRaw('screens/payment/EdcScreen.tsx')), 'F3e: EDC teruskan jadwal/DP ke sale & struk');
  ok(/svcLineVal/.test(readRaw('screens/bill/BillPreviewScreen.tsx')) && /serviceDateVal/.test(readRaw('screens/bill/BillPreviewScreen.tsx')), 'F3e: BillPreview tampilkan + teruskan jadwal jasa');
  ok(/pushVerticalIdToServer/.test(read('lib/posModes.ts')), 'F3e: PUT verticalId ke server ada');
  ok(/pushVerticalIdToServer/.test(readRaw('screens/settings/SettingsScreen.tsx')) && /pushVerticalIdToServer/.test(readRaw('screens/home/DashboardScreen.tsx')), 'F3e: switch/onboarding selaraskan server (anti-mental)');
  ok(/hybridPickOpen/.test(readRaw('screens/settings/SettingsScreen.tsx')), 'F3e: hybrid via picker (bukan auto-toggle buta)');
  // Fase 3f (draft utuh jasa): simpan/muat draft bawa jadwal/teknisi/DP/alamat (anti-hilang saat Muat)
  ok(/serviceDate/.test(readRaw('screens/cashier/CartDetailScreen.tsx')) && /deliveryAddress/.test(readRaw('screens/cashier/CartDetailScreen.tsx')) && /JSON.stringify/.test(readRaw('screens/cashier/CartDetailScreen.tsx')), 'F3f: CartDetail goSave simpan jadwal/DP/alamat ke draft');
  ok(/serviceDate\?: string/.test(readRaw('screens/cashier/LoadOrderScreen.tsx')) && /deliveryFee\?: number/.test(readRaw('screens/cashier/LoadOrderScreen.tsx')), 'F3f: DraftPayload/Saved bawa 6 field jasa');
  ok(/o\.serviceDate \? \{ serviceDate/.test(readRaw('screens/cashier/LoadOrderScreen.tsx')) && /o\.deliveryFee \? \{ deliveryFee/.test(readRaw('screens/cashier/LoadOrderScreen.tsx')), 'F3f: muat() kembalikan jadwal/alamat ke Cashier');
  ok(/setSvcDate\(p\.serviceDate/.test(cashier) && /setSvcTech\(p\.technician/.test(cashier), 'F3f: Cashier restore jadwal/teknisi dari draft');
  ok(/Muat draft/.test(cashier) || /tak dibawa = reset/.test(cashier), 'F3f: Cashier reset field jasa saat draft tanpa jadwal (anti-bocor)');
  ok(/modeDisplayLabel/.test(readRaw('lib/posModes.ts')) && /Makan di Tempat/.test(readRaw('lib/posModes.ts')), 'F3f: label kasir Indonesia (display-only, payload BE Inggris)');
  ok(/modeDisplayLabel\(m\)/.test(readRaw('components/cashier/ModeBar.tsx')), 'F3f: ModeBar tampilkan label Indonesia');
  // F3g (vertical custom gate): FASHION/GROCERY/PULSA/SERVICE tak boleh item bebas
  ok(/customItems !== false/.test(cashier), 'F3g: Cashier hormati flags.customItems vertikal (Custom + empty-Tambah digate)');
  ok(/cashier\.pulsaOfflineWarn/.test(cashier) && /cashier\.pulsaOfflineWarn/.test(readRaw('lib/i18n.ts')), 'F3g: PULSA tampilkan warning offline i18n (onlineOnly jujur, ID+EN)');
  ok(/kitchen\.verticalNote/.test(readRaw('screens/history/KitchenScreen.tsx')) && /kitchen\.verticalNote/.test(readRaw('lib/i18n.ts')), 'F3g: Kitchen banner vertikal non-resto i18n (deep-link aman, fail-open)');
  ok(/RESTO_FULL.*SERVICE/.test(readRaw('screens/home/DashboardScreen.tsx')), 'F3g: Dashboard hanya tawarkan Booking untuk RESTO_FULL+SERVICE (W2-lane: banner in-screen milik W2, jangan sentuh BookingScreen)');
  ok(/vertical\.pickSub/.test(readRaw('lib/i18n.ts')) && /vertical\.start/.test(readRaw('lib/i18n.ts')) && /useLang/.test(readRaw('components/vertical/VerticalOnboarding.tsx')), 'F3g: Onboarding pakai i18n (ID+EN, konsisten dgn vertical.pickTitle)');
  ok(/verticalWarn/.test(readRaw('screens/history/KitchenScreen.tsx')), 'F3g: Kitchen warning pakai gaya amber sendiri (bukan hijau liveNotice)');
  ok(/footerEN/.test(readRaw('lib/receiptTemplate.ts')) && /verticalFooterForLang/.test(readRaw('screens/bill/ReceiptScreen.tsx')), 'F3g: footer struk vertikal dwibahasa ID+EN (konsisten i18n)');

  return { failures, checks };
}
module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
