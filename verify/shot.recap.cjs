const { chromium } = require('playwright-core');
const { copyFileSync } = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const job of [
    { device: 'phone', vp: { width: 390, height: 844 } },
    { device: 'tablet', vp: { width: 1024, height: 768 } },
  ]) {
    const page = await browser.newPage({ viewport: job.vp });
    await page.goto('http://localhost:8902/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 90000 });
    await page.waitForTimeout(4000);
    const nav = async (s, wait = 3000, p) => {
      const q = p ? JSON.stringify(p) : 'undefined';
      await page.evaluate(new Function(`window.__NAV__ && window.__NAV__.goGuest(${JSON.stringify(s)}, ${q})`));
      await page.waitForTimeout(wait);
    };
    for (const s of ['CreatePin', 'ForgotPin', 'Login']) {
      await nav(s);
      const tmp = `docs/shots/${job.device}-${s}.png`;
      await page.screenshot({ path: tmp });
      copyFileSync(tmp, `verify/${job.device}-${s}.png`);
      console.log(tmp, 'OK');
    }
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
