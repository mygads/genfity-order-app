const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Sama seperti verify/shot.cjs, tapi untuk Windows (Chrome terinstal, bukan headless-shell Linux).
const SCREENS = [
  'Login', 'Dashboard', 'Cashier', 'CartDetail', 'DineIn', 'CustomMenu', 'LoadOrder',
  'BillPreview', 'Receipt', 'Cancel', 'Tables', 'Booking', 'Member', 'Voucher',
  'QrScan', 'Pay', 'Qris', 'Edc', 'Success', 'Attendance', 'Shift', 'Recap',
  'EndShift', 'History', 'EsbOrder', 'Kitchen', 'Printers', 'Settings',
];
const PARAMS = {
  Pay: { total: 266000 },
  Qris: { total: 266000 },
  Edc: { total: 48900 },
  Success: { total: 266000, method: 'Tunai', cash: 300000, change: 34000 },
  Receipt: { total: 266000, method: 'Tunai' },
  CartDetail: { total: 122500 },
};

async function shot(device, dev) {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: dev.vp });
  const out = [];
  await page.goto('http://localhost:8902/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 90000 });
  await page.waitForTimeout(4000);
  for (const s of SCREENS) {
    if (s === 'Login') {
      await page.waitForTimeout(800);
    } else if (s === 'Dashboard') {
      await page.evaluate(() => window.__NAV__ && window.__NAV__.go('Dashboard'));
      await page.waitForTimeout(1500);
    } else {
      const p = PARAMS[s] ? JSON.stringify(PARAMS[s]) : 'undefined';
      await page.evaluate(new Function(`window.__NAV__ && window.__NAV__.go(${JSON.stringify(s)}, ${p})`));
      await page.waitForTimeout(1500);
    }
    const f = `docs/shots/${device}-${s}.png`;
    await page.screenshot({ path: f });
    out.push(f);
  }
  await browser.close();
  console.log(out.join('\n'));
}

(async () => {
  const which = process.argv[2] || 'phone';
  if (which === 'phone') await shot('phone', { vp: { width: 390, height: 844 } });
  else await shot('tablet', { vp: { width: 1024, height: 768 } });
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
