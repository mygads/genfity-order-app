// Tripwire SESI-STOCKMGMT-EXE: layar "Stock Management" APP = cermin FE
// InventoryPanel (menu + addon/varian, stepper, ambang, tandai-habis = set
// qty 0). Mengunci: route StockManagement terdaftar & MenuManagement punah;
// kunci stockMgmt.* ada + kunci yatim menu.* dibersihkan; lib kanonis
// stockWrite dipakai kedua layar stok; drain Opsi A table-aware addon;
// gate decrement penjualan + gate kasir konsisten BE.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => { checks++; if (!cond) failures.push(name); };

  const app = strip(fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8'));
  const types = read('navigation/types.ts');
  const drawer = read('components/DrawerMenu.tsx');
  const i18n = readRaw('lib/i18n.ts');

  // ---- SM-ROUTE: StockManagement terdaftar, MenuManagement punah ----
  ok(/name="StockManagement"/.test(app) && /StockManagement:/.test(types),
    'SM-ROUTE-1: route StockManagement terdaftar (App + types)');
  ok(/route: 'StockManagement'/.test(drawer),
    'SM-ROUTE-2: drawer menunjuk StockManagement');
  ok(!/MenuManagement/.test(app) && !/MenuManagement/.test(types) && !/MenuManagement/.test(drawer),
    'SM-ROUTE-3: tak ada sisa rujukan MenuManagement (App/types/drawer)');
  ok(/route: 'StockManagement'/.test(app),
    'SM-ROUTE-4: rute notif WS mengarah StockManagement');
  ok(!fs.existsSync(path.join(SRC, 'screens/settings/MenuManagementScreen.tsx')),
    'SM-ROUTE-5: file MenuManagementScreen.tsx sudah dihapus');

  // ---- SM-KEYS: kunci baru ada, kunci yatim bersih ----
  const needKeys = ['stockMgmt.title', 'stockMgmt.tabAll', 'stockMgmt.tabMenu',
    'stockMgmt.tabAddon', 'stockMgmt.filterHealthy', 'stockMgmt.filterLow',
    'stockMgmt.filterOut', 'stockMgmt.markOut', 'stockMgmt.threshold',
    'stockMgmt.useGlobal', 'stockMgmt.tracked', 'stockMgmt.untracked',
    'stockMgmt.readonlyNote', 'nav_menu_mgmt'];
  const missingKeys = needKeys.filter((k) => !i18n.includes(`'${k}'`) && !i18n.includes(`${k}:`));
  ok(missingKeys.length === 0, `SM-KEYS-1: kunci stockMgmt/nav ada (${missingKeys.join(',') || 'lengkap'})`);
  const orphanKeys = ['title_menu:', "'menu.title'", "'menu.downloadImages'",
    "'menu.markSold'", "'menu.price'", "'menu.group'", 'menu_del_title',
    "'menu.otherGroup'", "'menu.price_aud'", "'menu.emptyCatalog'",
    "'menu.readonlyCatalog'"];
  const hitOrphan = orphanKeys.filter((k) => i18n.includes(k));
  ok(hitOrphan.length === 0, `SM-KEYS-2: kunci yatim menu.* bersih (${hitOrphan.join(',') || 'bersih'})`);
  ok(i18n.includes("'menu.soldOut'"),
    'SM-KEYS-3: menu.soldOut dipertahankan (dipakai CashierScreen)');

  // ---- SM-LIB: lib kanonis stockWrite ----
  const lib = read('lib/stockWrite.ts');
  const needExports = ['persistBranchQty', 'setBranchThreshold', 'deriveSoldOut',
    'cleanThreshold', 'getAllLocalFlags', 'setLocalFlags', 'branchTables'];
  const missingExp = needExports.filter((e) => !lib.includes(e));
  ok(missingExp.length === 0, `SM-LIB-1: ekspor stockWrite lengkap (${missingExp.join(',') || 'lengkap'})`);
  ok(!/setManualSoldOut/.test(lib),
    'SM-LIB-2: tanpa override manual (tak ada di FE/BE)');
  ok(/genfity\.stock\.addonCache/.test(lib),
    'SM-LIB-3: flag addon di cache terpisah (tak tertimpa wholesale-write Stok)');
  ok(/tracked && qty<=0/.test(lib.replace(/\s+/g, '')) || /deriveSoldOut/.test(lib),
    'SM-LIB-4: derivasi Habis kanonis dilacak && qty<=0');

  // ---- SM-USE: kedua layar pakai lib bersama ----
  const stock = read('screens/settings/StockScreen.tsx');
  ok(/persistBranchQty/.test(stock),
    'SM-USE-1: StockScreen pakai persistBranchQty (lib kanonis)');
  ok(!/INSERT INTO ms_branchmenu/.test(stock),
    'SM-USE-2: StockScreen tanpa SQL tulis sendiri (via lib)');
  const mgmt = read('screens/settings/StockManagementScreen.tsx');
  ok(/persistBranchQty/.test(mgmt) && /setBranchThreshold/.test(mgmt) && /getAllLocalFlags/.test(mgmt),
    'SM-USE-3: StockManagement pakai persist+threshold+bulk-flags');
  ok(/saveQty\(0\)/.test(mgmt),
    'SM-USE-4: Tandai Habis = set qty 0 (cermin FE, bukan flag)');
  ok(/GROUP_CONCAT/.test(mgmt),
    'SM-USE-5: kartu addon cantumkan menu induk (Varian)');

  // ---- SM-SYNC: drain Opsi A table-aware addon ----
  const sync = read('lib/sync.ts');
  ok(/ms_branchaddon/.test(sync) && /bodyType/.test(sync) && /'addon'/.test(sync),
    'SM-SYNC-1: drain kenali ms_branchaddon dengan type addon');
  ok(/lowStockThreshold/.test(sync),
    'SM-SYNC-2: ambang ikut di-push (kontrak BE lowStockThreshold)');
  ok(/markClean\(table/.test(sync),
    'SM-SYNC-3: markClean pakai nama tabel aktual (menu/addon)');

  // ---- SM-SCHEMA + gate kasir/penjualan ----
  const schema = read('lib/dbSchema.ts');
  ok(/ms_branchaddon/.test(schema) && /lowThreshold/.test(schema),
    'SM-SCHEMA-1: tabel ms_branchaddon + kolom lowThreshold ada');
  ok(/trackStock/.test(schema),
    'SM-SCHEMA-2: kolom trackStock server ada di master');
  const sales = read('lib/sales.ts');
  ok(/trackStock/.test(sales) && /deviceTrack/.test(sales),
    'SM-SALE-1: decrement penjualan gate trackStock server + opt perangkat');
  const cashier = read('screens/cashier/CashierScreen.tsx');
  ok(/soldOut && !sellEmpty/.test(cashier),
    'SM-SALE-2: kasir hormati allowSellEmpty tanpa ubah flag');

  return { failures, checks };
}

module.exports = { run };
