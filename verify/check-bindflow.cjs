// Verifikasi visual alur B2 BindFlow + Login pasca-fix D3 (i18n keys,
// guard unbound, PIN modal). Server: EXPO_PUBLIC_NAV_HOOK=1 di :8908.
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:8908/';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  const shot = async (name) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `verify/final/phone-B2-${name}.png` });
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\n/g, ' | '));
    console.log(name.toUpperCase() + ':', txt);
  };

  await page.evaluate(() => window.__NAV__.goGuest('BranchPicker'));
  await shot('branchpicker');
  await page.evaluate(() => window.__NAV__.goGuest('TerminalPicker', { branchId: 'B001', branchName: 'Genfity Cabang Poris' }));
  await shot('terminalpicker');
  await page.evaluate(() => window.__NAV__.goGuest('TerminalPin', { branchId: 'B001', branchName: 'Genfity Cabang Poris', terminalId: 'T01', terminalCode: 'KASIR-01', terminalName: 'Kasir 01', tag: 'kasir' }));
  await shot('terminalpin');
  await page.evaluate(() => window.__NAV__.goGuest('Login'));
  await shot('login');

  // Coba login seed admin/1234 → amati PIN modal / blokir unbound.
  // Catatan: input search BranchPicker masih di DOM (stack) tapi hidden —
  // bidik via placeholder Login yang visible.
  const uField = page.getByPlaceholder('Enter your Username or Email');
  const pField = page.getByPlaceholder('Enter your Password');
  if (await uField.count() > 0 && await pField.count() > 0) {
    await uField.nth(0).fill('admin');
    await pField.nth(0).fill('1234');
    await page.screenshot({ path: 'verify/final/phone-B2-loginfilled.png' });
    const btn = page.getByText('Sign In', { exact: true });
    try {
      await btn.nth(0).click({ timeout: 10000 });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: 'verify/final/phone-B2-afterlogin.png' });
      const t2 = await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n/g, ' | '));
      console.log('AFTERLOGIN:', t2);
    } catch (e) { console.log('LOGIN-CLICK-SKIP:', String(e).split('\n')[0].slice(0, 120)); }
  } else {
    console.log('LOGIN-INPUTS: tidak ada form (state unbound/prompt) — sesuai ekspektasi bila belum bind.');
  }
  console.log('PAGEERRORS:', errors.length ? errors.slice(0, 8) : 'none');
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
