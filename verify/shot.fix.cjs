const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Capture ulang layar yang rawan lag navigasi, dengan wait lebih panjang.
const JOBS = [
  { device: 'tablet', vp: { width: 1024, height: 768 }, screens: ['Success', 'Receipt', 'Qris', 'Edc'] },
];
const PARAMS = {
  Qris: { total: 266000 },
  Edc: { total: 48900 },
  Success: { total: 266000, method: 'Tunai', cash: 300000, change: 34000 },
  Receipt: { total: 266000, method: 'Tunai' },
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const job of JOBS) {
    const page = await browser.newPage({ viewport: job.vp });
    await page.goto('http://localhost:8902/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 90000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.__NAV__ && window.__NAV__.go('Dashboard'));
    await page.waitForTimeout(2500);
    for (const s of job.screens) {
      const p = PARAMS[s] ? JSON.stringify(PARAMS[s]) : 'undefined';
      await page.evaluate(new Function(`window.__NAV__ && window.__NAV__.go(${JSON.stringify(s)}, ${p})`));
      await page.waitForTimeout(3500);
      const f = `docs/shots/${job.device}-${s}.png`;
      await page.screenshot({ path: f });
      console.log(f);
    }
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
