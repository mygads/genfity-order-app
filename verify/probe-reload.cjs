const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8904/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  // login via form (dummy mode: kredensial apapun lolos bila PIN >= 4)
  await page.evaluate(() => window.__NAV__ && window.__NAV__.goGuest('Login'));
  await page.waitForTimeout(1200);
  const inputs = page.locator('input');
  await inputs.nth(0).fill('reloadprobe');
  await inputs.nth(1).fill('9999');
  await page.getByText('Sign In', { exact: true }).click({ timeout: 15000 });
  await page.waitForTimeout(3000);
  const b1 = await page.evaluate(() => document.body.innerText.slice(0, 80).replace(/\n/g, ' | '));
  console.log('BEFORE-RELOAD:', b1);
  const ls1 = await page.evaluate(() => localStorage.getItem('genfity.session.current') || 'NULL');
  console.log('LS-BEFORE:', ls1.slice(0, 80));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  for (const t of [2, 4, 8]) {
    await page.waitForTimeout(t === 2 ? 2000 : t === 4 ? 2000 : 4000);
    const b = await page.evaluate(() => document.body.innerText.slice(0, 80).replace(/\n/g, ' | '));
    const ls = await page.evaluate(() => localStorage.getItem('genfity.session.current') || 'NULL');
    console.log(`T+${t}s body:`, b);
    console.log(`T+${t}s ls:`, ls.slice(0, 80));
  }
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
