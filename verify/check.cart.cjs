// Verifikasi DOM: CartDetail terisi memuat tautan Pratinjau Bill, console bersih.
// node verify/check.cart.cjs <Port>
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ITEMS = [
  { id: 'm1', name: 'Nasi Goreng Spesial', basePrice: 25000, qty: 2, modifiers: [], discount: 0 },
  { id: 'm2', name: 'Es Teh Manis', basePrice: 8000, qty: 2, modifiers: [], discount: 0 },
];

(async () => {
  const port = process.argv[2] || '8907';
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.evaluate(
    ([items]) => window.__NAV__.go('CartDetail', { items, total: 122500 }),
    [ITEMS],
  );
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  const checks = {
    hasItems: text.includes('Nasi Goreng Spesial') && text.includes('Es Teh Manis'),
    hasPreviewLink: text.includes('Pratinjau Bill'),
    hasSplit: text.includes('Bagi Bill'),
  };
  console.log(JSON.stringify({ checks, consoleErrors: errors }, null, 2));
  // Klik tautan Pratinjau Bill → pastikan sampai di BillPreview
  await page.getByText('Pratinjau Bill').first().click();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log('AFTER_CLICK_HEAD:', JSON.stringify(after.slice(0, 120)));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
