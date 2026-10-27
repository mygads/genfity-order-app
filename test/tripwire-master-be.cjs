// Tripwire pull-master 6 domain jalur-Go (PULLMASTER-6DOMAIN, 2026-10-27).
// Kunci statik (tanpa runtime RN — dicek dari sumber):
//  MB-01: tiap domain ber-endpoint dipetakan ke rute BE nyata di router.go.
//  MB-02: ApiPath pullGo* memakai prefix api/ (bearer sesi otomatis).
//  MB-03: parser murni menutupi envelope BE ({success,data}, floors-nesting).
//  MB-04: expensecoa LIVE via pullGoCoa (F-020); 404 -> missing-endpoint fallback (bukan throw).
//  MB-05: wiring master.ts hanya saat goOk (fallback legacy lestari).
//  MB-06: adapter tak menyentuh skema (tanpa CREATE TABLE) & tak menyentuh
//          Login/SelectBranch.
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..');
const BE = path.join(APP, '..', 'services', 'genfity-order-services');
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const readApp = (p) => strip(fs.readFileSync(path.join(APP, p), 'utf8'));
const readAppRaw = (p) => fs.readFileSync(path.join(APP, p), 'utf8');
const readBe = (p) => fs.readFileSync(path.join(BE, p), 'utf8');

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // ---- MB-01: rute BE nyata terdaftar di router.go ----
  const router = readBe('internal/http/router.go');
  ok(router.includes('"/pos/menu"') && router.includes('MerchantPOSMenuGet'),
    'MB-01: menu -> GET /pos/menu (MerchantPOSMenuGet)');
  ok(router.includes('"/table-management"') && router.includes('MerchantTableManagementGet'),
    'MB-01: table -> GET /table-management (MerchantTableManagementGet)');
  ok(router.includes('"/orders/pos/voucher-templates"') && router.includes('MerchantPOSVoucherTemplates'),
    'MB-01: promotion -> GET /orders/pos/voucher-templates');
  ok(router.includes('"/loyalty/members"') && router.includes('MerchantLoyaltyMembersList'),
    'MB-01: member -> GET /loyalty/members');
  ok(router.includes('"/order-vouchers/templates"') && router.includes('MerchantOrderVoucherTemplatesList'),
    'MB-01: voucher -> GET /order-vouchers/templates');
  ok(router.includes('"/chart-of-accounts"') && router.includes('MerchantChartOfAccountsList'),
    'MB-01: expensecoa -> GET /chart-of-accounts (MerchantChartOfAccountsList)');

  // ---- MB-02: ApiPath pullGo* ----
  const server = readApp('src/config/server.ts');
  ok(/pullGoTables:\s*'api\/merchant\/table-management'/.test(server), 'MB-02: pullGoTables');
  ok(/pullGoPromoTemplates:\s*'api\/merchant\/orders\/pos\/voucher-templates'/.test(server), 'MB-02: pullGoPromoTemplates');
  ok(/pullGoVoucherTemplates:\s*'api\/merchant\/order-vouchers\/templates'/.test(server), 'MB-02: pullGoVoucherTemplates');
  ok(/pullGoMembers:\s*'api\/merchant\/loyalty\/members'/.test(server), 'MB-02: pullGoMembers');
  ok(/pullGoCustomers:\s*'api\/merchant\/customers\/search'/.test(server), 'MB-02: pullGoCustomers');
  ok(/pullGoCoa:\s*'api\/merchant\/chart-of-accounts'/.test(server), 'MB-02: pullGoCoa (F-020 live pasca-F-016)');
  ok(/function needsSessionBearer/.test(server), 'MB-02: prefix api/ = bearer sesi otomatis');

  // ---- MB-03: parser murni ----
  const lib = readApp('src/lib/masterBe.ts');
  const libRaw = readAppRaw('src/lib/masterBe.ts');
  for (const fn of ['parseBeTables', 'parseBePromos', 'parseBeMembers', 'parseBeVoucherCodes', 'parseBeCoa']) {
    ok(new RegExp(`export function ${fn}`).test(lib), `MB-03: ${fn} diekspor (murni)`);
  }
  ok(/d\.floors/.test(lib) && /tableNumber/.test(lib), 'MB-03: parseBeTables membuka floors-nesting');
  ok(/discountType/.test(lib) && /TPL-/.test(libRaw), 'MB-03: promo = agregat template (kode di domain voucher)');
  ok(/!=='ACTIVE'/.test(libRaw) || /!== 'ACTIVE'/.test(lib), 'MB-03: member non-ACTIVE dilewati eksplisit');
  ok(/usedCount/.test(lib) && /penegakan final di server/.test(libRaw), 'MB-03: kuota voucher semantik sekali-pakai, jujur');

  // ---- MB-04: tripwire expensecoa ----
  ok(/class BeEndpointMissing/.test(lib), 'MB-04: BeEndpointMissing didefinisikan');
  ok(/status: 'missing-endpoint'/.test(lib), 'MB-04: 404 -> missing-endpoint (bukan throw)');
  ok(/status === 401/.test(lib), 'MB-04: 401 tetap melempar (fail-closed sesi)');
  ok(/key === 'expensecoa'/.test(lib), 'MB-04: expensecoa di-route di pullBeDomain (fallback 404 -> missing-endpoint)');
  ok(/pullBeCoa/.test(lib) && /ApiPath\.pullGoCoa/.test(lib), 'MB-04: expensecoa live via pullBeCoa (pullGoCoa)');
  ok(/ms_coa/.test(lib) && /setWatermark\('expensecoa'/.test(lib), 'MB-04: pullBeCoa upsert ms_coa + watermark');

  // ---- MB-05: wiring goOk-only ----
  const master = readApp('src/lib/master.ts');
  ok(/pullBeDomain/.test(master) && /BE_PULL_KEYS/.test(master), 'MB-05: master.ts memakai adapter BE');
  ok(/if \(goOk && beKeys\.includes\(d\.key\)\)/.test(master), 'MB-05: adapter hanya saat goOk (fallback legacy lestari)');
  ok(/skipped\.push\(d\.key\)/.test(master), 'MB-05: missing-endpoint -> skipped');

  // ---- MB-06: batasan kepemilikan ----
  ok(!/CREATE TABLE/i.test(lib), 'MB-06: adapter tanpa CREATE TABLE (skema utuh)');
  ok(!/from ['"][^'"]*screens\/(auth\/LoginScreen|install\/SelectBranchScreen)['"]/.test(libRaw), 'MB-06: adapter tak mengimpor layar Login/SelectBranch');

  return { failures, checks };
}

module.exports = { run };
