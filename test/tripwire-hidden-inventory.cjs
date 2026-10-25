// Tripwire SESI-UXB1-APP: 4 fitur inventori (Pemasok/Supplier, Pesanan
// Pembelian/PO, Resep/Recipe, Transfer Stok) DISEMBUNYIKAN dari UI kasir.
// Putusan produk: belum dibutuhkan — HIDE bukan hapus. Di APP tidak ada
// layar/route/i18n untuk keempatnya (tidak seperti FE web yang punya rute
// inventory/*), jadi tripwire ini mengunci KETIADAAN itu di semua titik
// tampil: drawer, kartu dashboard, settings, allowlist tag, navigator,
// dict i18n. Bila suatu hari dibuka lagi, pola re-enable yang diharapkan:
// tambah Stack.Screen di App.tsx + route di navigation/types.ts +
// entri drawer/i18n, LALU longgarkan cek HI-* di bawah per fitur.
// FLAG BUKA: hapus/ubah cek HI yang relevan + catat di SESSION-LOCK.
// HIDE (HI): keempat fitur tak muncul di permukaan tampil mana pun.
// ROUTE (RT): tak ada route terdaftar; penjaga anti-overhide memastikan
// tetangga sah (Stok menu + Transfer Bank) tetap ada dan tak ikut hilang.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

// Pola spesifik-inventori (disengaja SEMPIT agar tak false-positive pada
// tetangga sah: layar Stok menu-stock + metode bayar Transfer Bank).
const FEATS = [
  { id: 'Supplier', re: /suppliers?|pemasok/i },
  { id: 'PurchaseOrder', re: /purchase[\s_-]?orders?|pesanan[\s_-]?pembelian/i },
  { id: 'Recipe', re: /\brecipes?\b|\bresep\b/i },
  { id: 'StockTransfer', re: /stock[\s_-]?transfers?|transfer[\s_-]?stok/i },
];
// Permukaan tampil kasir: drawer + kartu dashboard + settings + allowlist
// tag + tipe route + registrasi Stack + kamus i18n.
const SURFACES = [
  'components/DrawerMenu.tsx',
  'screens/home/DashboardScreen.tsx',
  'screens/settings/SettingsScreen.tsx',
  'lib/deviceRole.ts',
  'navigation/types.ts',
  'lib/i18n.ts',
];
const APP_TSX = 'App.tsx';

function walkScreens() {
  const out = [];
  const dir = path.join(SRC, 'screens');
  for (const d of fs.readdirSync(dir)) {
    const p = path.join(dir, d);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (!st.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(p).filter((x) => x.endsWith('.tsx')); } catch { continue; }
    for (const f of files) out.push(`screens/${d}/${f}`);
  }
  return out;
}

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => { checks++; if (!cond) failures.push(name); };

  // ---- HIDE: tiap fitur absen di semua permukaan tampil ----
  for (const feat of FEATS) {
    const hit = [];
    for (const s of SURFACES) {
      try { if (feat.re.test(read(s))) hit.push(s); } catch { /* abaikan */ }
    }
    try { if (feat.re.test(strip(fs.readFileSync(path.join(ROOT, APP_TSX), 'utf8')))) hit.push(APP_TSX); } catch { /* abaikan */ }
    ok(hit.length === 0, `HI-${feat.id}: tak ada entry nav/teks/allowlist (${hit.join(',') || 'bersih'})`);
  }

  // ---- HIDE: tak ada navigate() ke layar keempat fitur di seluruh screens ----
  const navHit = [];
  for (const f of walkScreens()) {
    try {
      const code = read(f);
      for (const feat of FEATS) {
        const navRe = new RegExp(`navigate\\s*\\(\\s*['"][^'"]*(?:${feat.re.source})`, 'i');
        if (navRe.test(code)) navHit.push(`${f}:${feat.id}`);
      }
    } catch { /* abaikan */ }
  }
  ok(navHit.length === 0, `HI-NAV: tak ada navigate() ke 4 fitur (${navHit.join(',') || 'bersih'})`);

  // ---- ROUTE: tak ada deklarasi route ----
  const types = read('navigation/types.ts');
  const app = strip(fs.readFileSync(path.join(ROOT, APP_TSX), 'utf8'));
  const routeHit = [];
  for (const feat of FEATS) {
    if (feat.re.test(types)) routeHit.push(`types:${feat.id}`);
    const scrRe = new RegExp(`Stack\\.Screen[^>]*name=["'][^"']*(?:${feat.re.source})`, 'i');
    if (scrRe.test(app)) routeHit.push(`App:${feat.id}`);
  }
  ok(routeHit.length === 0, `RT-ROUTE: tak ada route terdaftar (${routeHit.join(',') || 'bersih'})`);

  // ---- ROUTE (anti-overhide): tetangga sah tetap ada ----
  ok(/name="Stock"/.test(app) && /Stock:/.test(types),
    'RT-KEEP-1: layar Stok menu-stock tetap terdaftar (hide tak overhide)');
  const i18nRaw = readRaw('lib/i18n.ts');
  ok(/pay_method_transfer/.test(i18nRaw) && /xp_m_transfer/.test(i18nRaw),
    'RT-KEEP-2: metode bayar Transfer Bank tetap di i18n (hide tak overhide)');

  return { failures, checks };
}

module.exports = { run };
