// Bukti login: isi admin/1234 di Login web, klik Sign In, pastikan lolos
// (sesi tersimpan, layar bukan lagi Login/error). Keluar 0 bila lolos.
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = process.env.VERIFY_PORT || '8904';
const URL = `http://localhost:${PORT}/`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const refused = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));
  page.on('requestfailed', (r) => refused.push((r.failure()?.errorText || '?') + ' :: ' + r.url().slice(0, 140)));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  const hook = await page.evaluate(() => !!window.__NAV__);
  if (!hook) throw new Error('__NAV__ hilang (server jalan tanpa EXPO_PUBLIC_NAV_HOOK=1?)');
  await page.evaluate(() => window.__NAV__.goGuest('Login'));
  await page.waitForTimeout(2000);
  const inputs = page.locator('input');
  const n = await inputs.count();
  console.log('INPUTS:', n);
  if (n < 2) throw new Error('kolom login tak ditemukan');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('1234');
  await page.waitForTimeout(500);
  await page.getByText('Sign In', { exact: true }).click({ timeout: 15000 });
  // Seed pertama (wasm + skema) bisa makan belasan detik — polling hingga
  // sesi muncul atau teks error final tampil (maks 60 dtk).
  let body = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    body = await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n/g, ' | '));
    const settled = /wrong username|tidak ada user lokal|no local users|username atau pin salah|dashboard|shift|kasir|logout|keluar/i.test(body);
    const lsYet = await page.evaluate(() => !!localStorage.getItem('genfity.session.current'));
    if ((settled && !/verifying|memeriksa/i.test(body)) || lsYet) break;
  }
  console.log('AFTER-SUBMIT:', body);
  await page.screenshot({ path: 'docs/ss-clone/phone-LoginProof.png' });
  const fail = /wrong username|tidak ada user lokal|no local users|username atau pin salah/i.test(body);
  const ls = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('genfity.session') || k.startsWith('genfity.pin'))) {
        out[k] = (localStorage.getItem(k) || '').slice(0, 80);
      }
    }
    return out;
  });
  console.log('LS:', JSON.stringify(ls));
  const dump = await page.evaluate(() => (window.__NAV__.dump ? window.__NAV__.dump() : null));
  console.log('NAVSTATE:', dump);
  console.log('ERRORS:', errors.length ? errors.slice(0, 8) : 'none');
  console.log('REFUSED:', refused.length ? refused.slice(0, 8) : 'none');
  await browser.close();
  if (fail) { console.error('LOGIN-GAGAL: pesan error masih tampil'); process.exit(1); }
  if (!ls['genfity.session.current']) { console.error('LOGIN-GAGAL: sesi tidak tersimpan'); process.exit(1); }
  console.log('LOGIN-LOLOS');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
