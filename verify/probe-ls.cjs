const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.goto('http://localhost:8904/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const keys = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out.push(k + ' :: ' + (localStorage.getItem(k) || '').slice(0, 60));
    }
    return out;
  });
  console.log('LS-KEYS:', JSON.stringify(keys, null, 1).slice(0, 2000));
  console.log('PAGEERRORS:', errs.length ? errs : 'none');
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
