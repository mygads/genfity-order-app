const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://localhost:8904/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__NAV__ && window.__NAV__.goGuest('Login'));
  await page.waitForTimeout(1500);
  const inputs = page.locator('input');
  await inputs.nth(0).click();
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor };
  });
  console.log('FOCUSED:', JSON.stringify(st));
  await page.screenshot({ path: 'docs/ss-clone/phone-LoginFocus.png' });
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
