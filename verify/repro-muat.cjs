const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 412, height: 860 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || /text node|Alert/i.test(m.text())) logs.push(m.text().slice(0, 200)); });
  page.on('dialog', async (d) => { logs.push('DIALOG:' + d.type() + ':' + (d.message() || '').slice(0, 120)); await d.accept(); });
  await page.goto('http://localhost:8904', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__NAV__ && document.body.innerText.length > 50, null, { timeout: 90000 });
  await page.evaluate(() => window.__NAV__.go('LoadOrder'));
  await page.waitForTimeout(1500);
  const hasMuat = await page.getByText('Muat', { exact: false }).count();
  console.log('MUAT-BUTTONS:', hasMuat);
  await page.screenshot({ path: 'docs/ss-clone/phone-LoadOrder.png' });
  if (hasMuat > 0) {
    await page.getByText('Muat', { exact: false }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'docs/ss-clone/phone-AfterMuat.png' });
    const body = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log('AFTER-MUAT-BODY:', JSON.stringify(body));
  }
  console.log('LOGS:', JSON.stringify(logs.slice(0, 12)));
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
