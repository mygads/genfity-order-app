const { chromium } = require('playwright-core');
const { copyFileSync } = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Capture 5 layar backlog 7.1.1 (tablet 2-panel) → verify/ + verify/final/
const SCREENS = ['Login', 'Receipt', 'Success', 'Member', 'Booking'];
const PARAMS = {
  Success: { total: 266000, method: 'Tunai', cash: 300000, change: 34000 },
  Receipt: { total: 266000, method: 'Tunai' },
};
const JOBS = [
  { device: 'phone', vp: { width: 390, height: 844 } },
  { device: 'tablet', vp: { width: 1024, height: 768 } },
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const job of JOBS) {
    const page = await browser.newPage({ viewport: job.vp });
    await page.goto('http://localhost:8902/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 90000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.__NAV__ && window.__NAV__.go('Dashboard'));
    await page.waitForTimeout(2500);
    for (const s of SCREENS) {
      const p = PARAMS[s] ? JSON.stringify(PARAMS[s]) : 'undefined';
      await page.evaluate(new Function(`window.__NAV__ && window.__NAV__.go(${JSON.stringify(s)}, ${p})`));
      await page.waitForTimeout(3500);
      if (s === 'Member') {
        // Pilih member pertama agar panel detail (tablet) / footer (phone) tampil
        await page.getByText('Budi Santoso').first().click().catch(() => {});
        await page.waitForTimeout(1200);
      }
      const tmp = `docs/shots/${job.device}-${s}.png`;
      await page.screenshot({ path: tmp });
      copyFileSync(tmp, `verify/${job.device}-${s}.png`);
      copyFileSync(tmp, `verify/final/${job.device}-${s.toLowerCase()}.png`);
      console.log(tmp);
    }
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
