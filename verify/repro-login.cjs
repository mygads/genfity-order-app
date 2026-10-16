// Repro: isi kredensial random di Login, klik submit, amati hasil + console error.
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));
  await page.goto('http://localhost:8902/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const hook = await page.evaluate(() => !!window.__NAV__);
  if (!hook) throw new Error('__NAV__ hilang');
  await page.evaluate(() => window.__NAV__.goGuest('Login'));
  await page.waitForTimeout(1500);
  // Isi dua TextInput pertama (username + password) dengan kredensial random.
  const inputs = page.locator('input');
  const n = await inputs.count();
  console.log('INPUTS:', n);
  if (n >= 2) {
    await inputs.nth(0).fill('acak_' + Date.now());
    await inputs.nth(1).fill('9999');
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/ss-clone/phone-LoginFilled.png' });
  // Klik tombol submit via teks (TouchableOpacity RN-web tak selalu role=button).
  const btn = page.getByText('Sign In', { exact: true });
  await btn.click({ timeout: 15000 });
  for (const ms of [300, 900, 2000]) {
    await page.waitForTimeout(ms === 300 ? 300 : ms === 900 ? 600 : 1100);
    const b = await page.evaluate(() => document.body.innerText.slice(0, 120).replace(/\n/g, ' | '));
    console.log(`T+${ms}:`, b);
  }
  await page.waitForTimeout(2000);
  const body1 = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n/g, ' | '));
  console.log('AFTER-SUBMIT:', body1);
  await page.screenshot({ path: 'docs/ss-clone/phone-AfterLogin.png' });
  const ls = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('genfity.session')) out[k] = (localStorage.getItem(k) || '').slice(0, 120);
    }
    return out;
  });
  console.log('SESSION-LS:', JSON.stringify(ls));
  // Uji saklar live vs restore: reload; bila sesi pulih, Dashboard harus tampil.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const body2 = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n/g, ' | '));
  console.log('AFTER-RELOAD:', body2);
  console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
