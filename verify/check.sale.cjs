// Bukti tier-penuh: jual tunai → outbox berisi payload kontrak §5.
// node verify/check.sale.cjs <Port>
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ITEMS = [
  { id: 'm1', name: 'Nasi Goreng Spesial', basePrice: 25000, qty: 2, modifiers: [], discount: 0 },
  { id: 'm2', name: 'Es Teh Manis', basePrice: 8000, qty: 2, modifiers: [], discount: 0 },
];

function assert(c, msg) {
  if (!c) throw new Error(`ASSERT: ${msg}`);
}

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
  await page.evaluate(([items]) => window.__NAV__.go('Pay', { total: 66000, items }), [ITEMS]);
  await page.waitForTimeout(1800);
  await page.getByText('Uang Pas', { exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.getByText(/^Bayar Rp/, { exact: false }).first().click();
  await page.waitForTimeout(2000);
  const body = await page.evaluate(() => document.body.innerText);
  assert(/berhasil/i.test(body), 'tidak sampai di layar sukses');

  const outbox = await page.evaluate(() => {
    const raw = localStorage.getItem('genfity.sync.outbox');
    return raw ? JSON.parse(raw) : [];
  });
  const order = outbox.filter((o) => o.kind === 'order').pop();
  assert(order, 'outbox order kosong');
  const p = order.payload;
  assert(p.method === 'Tunai', `method=${p.method}`);
  assert(p.total === 66000 && p.grandTotal === 66000, `total=${p.total}`);
  assert(Array.isArray(p.items) && p.items.length === 2, 'items!=2');
  assert(p.items[0].menuId === 'm1' && p.items[0].qty === 2 && p.items[0].price === 25000, 'item0 salah');
  assert(Array.isArray(p.payments) && p.payments.length === 1, 'payments!=1');
  assert(p.payments[0].method === 'Tunai' && p.payments[0].amount === 66000, 'payment salah');
  assert(p.cash === 66000 && p.change === 0, 'cash/change salah');
  assert(typeof p.ts === 'string' && typeof order.id === 'string', 'ts/id hilang');
  assert(!('cardNumber' in p || 'pin' in p || 'cvv' in p), 'data sensitif bocor');
  assert(errors.length === 0, `console kotor: ${errors.join(' | ')}`);
  console.log('SALE_OK', JSON.stringify({ id: order.id, method: p.method, total: p.total, items: p.items.length }));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
