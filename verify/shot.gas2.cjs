const { chromium } = require('playwright-core');
const { copyFileSync } = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Ronde gas-2: split-bill, meja, ESC/POS, foto expense, customer display.
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
    const go = async (s, wait = 3500, p) => {
      const q = p ? JSON.stringify(p) : 'undefined';
      await page.evaluate(new Function(`window.__NAV__ && window.__NAV__.go(${JSON.stringify(s)}, ${q})`));
      await page.waitForTimeout(wait);
    };
    const snap = async (name) => {
      const tmp = `docs/shots/${job.device}-${name}.png`;
      await page.screenshot({ path: tmp });
      copyFileSync(tmp, `verify/${job.device}-${name}.png`);
      console.log(tmp, 'OK');
    };

    await go('BillPreview');
    await page.getByText('Per Item', { exact: true }).click().catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      [...document.querySelectorAll('div')]
        .filter((e) => e.scrollHeight > e.clientHeight + 50)
        .forEach((e) => { e.scrollTop = e.scrollHeight; });
    });
    await page.waitForTimeout(600);
    await snap('BillSplit');

    await go('Tables');
    await page.getByText('A2', { exact: true }).click().catch(() => {});
    await page.waitForTimeout(1000);
    await snap('TablesMove');
    await page.getByText('Tutup', { exact: true }).click().catch(() => {});
    await page.waitForTimeout(800);

    await go('Printers');
    await page.getByText('Uji Cetak').first().click().catch(() => {});
    await page.waitForTimeout(1800);
    await snap('PrintersEsc');

    await go('Recap');
    await page.evaluate(() => {
      [...document.querySelectorAll('div')]
        .filter((e) => e.scrollHeight > e.clientHeight + 50)
        .forEach((e) => { e.scrollTop = e.scrollHeight; });
    });
    await page.waitForTimeout(600);
    await snap('RecapPhoto');

    await go('CustomerDisplay');
    await snap('CustomerDisplay');

    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
