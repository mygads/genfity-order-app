// Lanjutan B2: isi PIN staff 1234 di modal → bukti fail-closed unbound.
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));
  await page.goto('http://localhost:8908/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__NAV__.goGuest('Login'));
  await page.waitForTimeout(1200);
  await page.getByPlaceholder('Enter your Username or Email').nth(0).fill('admin');
  await page.getByPlaceholder('Enter your Password').nth(0).fill('1234');
  await page.getByText('Sign In', { exact: true }).nth(0).click({ timeout: 10000 });
  await page.waitForTimeout(2000);
  const pin = page.getByPlaceholder('Staff PIN');
  if (await pin.count() > 0) {
    await pin.nth(0).fill('1234');
    await page.waitForTimeout(400);
    // Tombol Sign In di dalam modal = kemunculan kedua teks 'Sign In'.
    await page.getByText('Sign In', { exact: true }).nth(1).click({ timeout: 10000 });
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: 'verify/final/phone-B2-pinsubmit.png' });
  const t = await page.evaluate(() => document.body.innerText.slice(0, 320).replace(/\n/g, ' | '));
  console.log('PINSUBMIT:', t);
  console.log('PAGEERRORS:', errors.length ? errors.slice(0, 8) : 'none');
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
