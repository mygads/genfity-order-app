// Driver screenshot 15 layar lanjutan — phone 390x844.
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:8905';
const OUT = '/opt/data/home/shots';
const W = 390, H = 844;

const STEPS = [
  { file: '20-dinein.png', route: 'DineIn', params: { table: 'A-05' } },
  { file: '21-custommenu.png', route: 'CustomMenu' },
  { file: '22-loadorder.png', route: 'LoadOrder' },
  { file: '23-cancel.png', route: 'Cancel' },
  { file: '24-qrscan.png', route: 'QrScan' },
  { file: '25-edc.png', route: 'Edc', params: { total: 75000 } },
  { file: '26-attendance.png', route: 'Attendance' },
  { file: '27-recap.png', route: 'Recap' },
  { file: '28-voucher.png', route: 'Voucher' },
  { file: '29-esborder.png', route: 'EsbOrder' },
  { file: '30-kitchen.png', route: 'Kitchen' },
  { file: '31-settings.png', route: 'Settings' },
  { file: '32-printers.png', route: 'Printers' },
  { file: '33-billpreview.png', route: 'BillPreview' },
  { file: '34-cartdetail.png', route: 'CartDetail', params: { items: [{ id: 'c1', name: 'Ayam Goreng Dada', basePrice: 15000, qty: 2, modifiers: [], discount: 0 }], total: 30000 } },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/data/home/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByText('Masuk Demo', { exact: true }).first().waitFor({ timeout: 120000 });
  await page.getByText('Masuk Demo', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  const hasNav = await page.evaluate(() => !!window.__NAV__);
  console.log('__NAV__ hook:', hasNav);
  if (!hasNav) throw new Error('__NAV__ hilang');
  for (const s of STEPS) {
    await page.evaluate(([r, p]) => window.__NAV__.go(r, p), [s.route, s.params || undefined]);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${OUT}/${s.file}` });
    console.log(`shot ${s.file} route=${s.route}`);
  }
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
