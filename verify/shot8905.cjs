const { chromium } = require('playwright-core');
const SHELL = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://localhost:8905/';

const PARAMS = {
  Pay: { total: 266000 },
  Success: { total: 266000, method: 'Tunai', cash: 300000, change: 34000 },
  Receipt: { total: 266000, method: 'Tunai' },
};

const PHONE_SCREENS = ['Login', 'Dashboard', 'Cashier', 'Pay', 'History', 'Receipt', 'Success', 'Member', 'Booking', 'Tables'];
const TABLET_SCREENS = ['Dashboard', 'Cashier', 'Pay', 'History'];

const PHONE_NAMES = { Login: 'phone-login', Dashboard: 'phone-dashboard', Cashier: 'phone-cashier', Pay: 'phone-pay-tunai', History: 'phone-history', Receipt: 'phone-receipt', Success: 'phone-success', Member: 'phone-member', Booking: 'phone-booking', Tables: 'phone-tables' };
const TABLET_NAMES = { Dashboard: 'tablet-dashboard', Cashier: 'tablet-cashier', Pay: 'tablet-pay-tunai', History: 'tablet-history' };

async function shoot(device, vp, screens, names) {
  const browser = await chromium.launch({ executablePath: SHELL, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: vp });
  const out = [];
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 90000 });
  await page.waitForTimeout(5000);
  for (const s of screens) {
    if (s === 'Login') {
      await page.waitForTimeout(800);
    } else {
      const p = PARAMS[s] ? JSON.stringify(PARAMS[s]) : 'undefined';
      await page.evaluate(new Function(`window.__NAV__ && window.__NAV__.go(${JSON.stringify(s)}, ${p})`));
      await page.waitForTimeout(1800);
    }
    const f = `verify/final/${names[s]}.png`;
    await page.screenshot({ path: f });
    out.push(f);
  }
  await browser.close();
  console.log(out.join('\n'));
}

(async () => {
  const which = process.argv[2] || 'phone';
  if (which === 'phone') await shoot('phone', { width: 390, height: 844 }, PHONE_SCREENS, PHONE_NAMES);
  else await shoot('tablet', { width: 834, height: 1112 }, TABLET_SCREENS, TABLET_NAMES);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
