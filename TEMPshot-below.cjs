const { chromium } = require('playwright-core');
const CHROME = 'C:\Program Files\Google\Chrome\Application\chrome.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://localhost:8907/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  for (const s of ['SplitBill', 'Booking', 'CustomMenu']) {
    await page.evaluate((x) => window.__NAV__ && window.__NAV__.go(x), s);
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `docs/ss-clone/phone-${s}-below.png` });
    console.log('OK', s);
  }
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
