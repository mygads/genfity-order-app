const { chromium } = require('playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8908/';

async function shot(vp, out) {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 90000 });
  await page.waitForTimeout(4000);
  const hasNav = await page.evaluate(() => !!window.__NAV__);
  console.log('__NAV__ hook:', hasNav);
  if (hasNav) {
    await page.evaluate(() => window.__NAV__.go('Dashboard'));
    await page.waitForTimeout(2500);
    // Login admin/1234 (self-healing seed), lalu ke Dashboard.
    for (let i = 0; i < 4; i++) {
      const txt = await page.evaluate(() => document.body.innerText || '');
      if (!/Masuk Demo|Sign In/.test(txt)) break;
      if (/Masuk Demo/.test(txt)) {
        await page.getByText('Masuk Demo', { exact: true }).first().click().catch(() => {});
      } else {
        await page.getByPlaceholder('Enter your Username or Email').first().fill('admin').catch(() => {});
        await page.getByPlaceholder('Enter your Password').first().fill('1234').catch(() => {});
        await page.getByText('Sign In', { exact: true }).first().click().catch(() => {});
      }
      await page.waitForTimeout(3000);
    }
    // Tunggu login selesai (verifikasi server bisa lambat), lalu paksa Dashboard.
    await page.waitForFunction(() => /Transaksi Baru|Menu Utama|Masuk Demo|Sign In/.test(document.body.innerText || ''), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.__NAV__ && window.__NAV__.go('Dashboard'));
    await page.waitForTimeout(2500);
    const diag = await page.evaluate(() => ({
      txt: (document.body.innerText || '').slice(0, 300),
      navKeys: Object.keys(window.__NAV__ || {}),
    }));
    console.log('DIAG:', JSON.stringify(diag));
  } else {
    // Fallback: klik Continue lalu Masuk Demo secara tekstual.
    const cont = page.getByText('Continue', { exact: false }).first();
    if (await cont.count()) { await cont.click().catch(() => {}); await page.waitForTimeout(2000); }
    const demo = page.getByText('Masuk Demo', { exact: true }).first();
    await demo.waitFor({ timeout: 60000 }).catch(() => {});
    await demo.click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: out, fullPage: true });
  console.log('shot', out);
  await browser.close();
}

(async () => {
  await shot({ width: 390, height: 844 }, 'docs/ss-clone/phone-Dashboard-charts.png');
  await shot({ width: 1024, height: 768 }, 'docs/ss-clone/tablet-Dashboard-charts.png');
  console.log('DONE');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
