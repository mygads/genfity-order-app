// Driver screenshot POSClone-RN - phone 390x844, via playwright-core + chrome-headless-shell.
// 1) Klik "Masuk Demo" (klik teks tombol), 2) navigasi tiap route via __NAV__.go, 3) screenshot.
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:8905';
const OUT = '/opt/data/home/shots';
const W = 390, H = 844;

const STEPS = [
  { file: '01-login.png', route: null }, // layar awal (sebelum login)
  { file: '02-dashboard.png', route: 'Dashboard' },
  { file: '03-cashier.png', route: 'Cashier' },
  { file: '04-pay.png', route: 'Pay', params: { total: 75000 } },
  { file: '05-receipt.png', route: 'Receipt', params: { no: 'TRX-0001', total: 75000, method: 'Tunai' } },
  { file: '06-success.png', route: 'Success', params: { total: 75000, method: 'Tunai', cash: 100000, change: 25000 } },
  { file: '07-history.png', route: 'History' },
  { file: '08-member.png', route: 'Member' },
  { file: '09-booking.png', route: 'Booking' },
  { file: '10-tables.png', route: 'Tables' },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/data/home/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Tunggu bundle + teks "Masuk Demo" (maks 120 dtk)
  await page.getByText('Masuk Demo', { exact: true }).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-login.png` });
  console.log('shot 01-login.png');

  // (1) LOGIN via klik teks tombol "Masuk Demo" - setara CDP Runtime.evaluate klik
  await page.getByText('Masuk Demo', { exact: true }).first().click();
  await page.waitForTimeout(2500);

  const hasNav = await page.evaluate(() => !!window.__NAV__);
  console.log('__NAV__ hook:', hasNav);
  if (!hasNav) throw new Error('EXPO_PUBLIC_NAV_HOOK tidak aktif - __NAV__ hilang');

  for (const s of STEPS.slice(1)) {
    await page.evaluate(([r, p]) => window.__NAV__.go(r, p), [s.route, s.params || undefined]);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${OUT}/${s.file}` });
    const title = await page.title().catch(() => '');
    console.log(`shot ${s.file} route=${s.route} title=${title}`);
  }
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
