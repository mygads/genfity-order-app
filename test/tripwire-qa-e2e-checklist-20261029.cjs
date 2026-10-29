// QA E2E checklist §7 — verifikasi statik semua alur (tanpa device).
// E2E manual device tetap wajib, tapi file ini memastikan kode pendukung tiap checklist ada.
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
function run() {
  const failures = []; let checks = 0;
  const ok = (c, n) => { checks++; if (!c) failures.push(n); };
  const login = readRaw('screens/auth/LoginScreen.tsx');
  ok(/grant-stale-pin-changed/.test(login), 'QA install/login: stale deny ada');
  ok(/checkGrantStaleDeny/.test(login), 'QA login: checkGrantStaleDeny dipanggil');
  const install = readRaw('screens/install/InstallProgressScreen.tsx');
  ok(/pullMaster/.test(install), 'QA install: progress nyata pullMaster');
  const cashier = readRaw('screens/cashier/CashierScreen.tsx');
  ok(/dbError/.test(cashier), 'QA cashier: DB error vs empty-state');
  ok(/PRODUCTS_DEV_FALLBACK/.test(cashier), 'QA cashier: tanpa fiksi prod');
  const pay = readRaw('screens/payment/PayScreen.tsx');
  ok(/syncBlocked/.test(pay) || /syncWarnLevel/.test(pay), 'QA pay: block7 kunci EDC/QRIS');
  ok(/holdAsUnpaidOffline|hold.*[Uu]npaid/.test(pay), 'QA pay: hold unpaid jujur');
  const kitchen = readRaw('screens/history/KitchenScreen.tsx');
  ok(/broadcastKitchenBump/.test(kitchen), 'QA KDS: bump lintas device');
  ok(/stationOf/.test(kitchen), 'QA KDS: station routing');
  const qr = readRaw('screens/scan/QrScanScreen.tsx');
  ok(/perlu online/.test(qr), 'QA scan: perlu-online eksplisit');
  const receipt = readRaw('screens/bill/ReceiptScreen.tsx');
  ok(/openWaShare|waShareUrl/.test(receipt) || /shareReceipt/.test(receipt), 'QA receipt: share + WA redirect (tanpa gateway)');
  const posWire = readRaw('lib/posWire.ts');
  ok(/waShareUrl/.test(posWire) && /openWaShare/.test(posWire), 'QA receipt: helper WA redirect ada');
  ok(!/genfity-wa/.test(posWire), 'QA receipt: tanpa gateway WA');
  ok(/clientSessionUuid/.test(posWire), 'QA shift: settle bawa sesi yatim');
  ok(/kitchenBump/.test(readRaw('config/server.ts')), 'QA KDS: ApiPath kitchenBump');
  ok(/backgroundSync|registerBackgroundSync/.test(readRaw('lib/sync.ts')), 'QA sync: background wiring');
  ok(/thumbUrlFor|placeholderColorFor/.test(readRaw('lib/catalogImages.ts')), 'QA katalog: thumb + placeholder');
  ok(/arScanKeyFor/.test(readRaw('lib/catalogImages.ts')), 'QA AR: kunci scan');
  ok(/initMonitor|reportError/.test(fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')), 'QA observability: monitor wired');
  return { failures, checks };
}
module.exports = { run };
