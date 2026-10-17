const { chromium } = require('playwright-core');

const EXE = 'C:\\Users\\USER\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const BASE = 'http://127.0.0.1:8905/';

const SHOTS = [
  { route: 'Member', file: 'docs/ss-clone/phone-Member.png' },
  { route: 'Voucher', file: 'docs/ss-clone/phone-Voucher.png' },
  { route: 'Settings', file: 'docs/ss-clone/phone-Settings.png' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  // login/session bootstrap via Dashboard (hook auto-loginDemo when session empty)
  await page.evaluate(() => window.__NAV__ && window.__NAV__.go('Dashboard'));
  await page.waitForTimeout(2500);
  const out = [];
  for (const s of SHOTS) {
    await page.evaluate((r) => window.__NAV__ && window.__NAV__.go(r), s.route);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: s.file });
    out.push(s.file);
  }
  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
