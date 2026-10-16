// Bukti Sync nyata: Pull tanpa server → pesan gagal jujur, tanpa crash.
// node verify/check.sync.cjs <Port>
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function assert(c, msg) {
  if (!c) throw new Error(`ASSERT: ${msg}`);
}

(async () => {
  const port = process.argv[2] || '8909';
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Derau jaringan browser (CORS/fetch gagal) bukan bug aplikasi: yang
  // dihitung hanya pageerror + console error non-jaringan.
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to fetch|CORS|ERR_|net::|WebSocket/i.test(t)) return;
    errors.push(`console: ${t}`);
  });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__NAV__.go('Sync'));
  await page.waitForTimeout(1500);
  let text = await page.evaluate(() => document.body.innerText);
  assert(text.includes('Antrean Offline'), 'layar Sync tidak tampil');
  await page.getByText('Pull Sekarang', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  text = await page.evaluate(() => document.body.innerText);
  assert(/Pull gagal|Pull selesai/.test(text), 'tidak ada hasil pull yang jujur');
  assert(/Server Custom/.test(text), 'penjaga env Custom tidak tampil');
  console.log('PULL_MSG:', JSON.stringify(text.match(/Pull (gagal.*|selesai.*)/)?.[0] ?? '-'));
  await page.getByText('Push Sekarang', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  text = await page.evaluate(() => document.body.innerText);
  assert(/Push selesai|Push gagal/.test(text), 'tidak ada hasil push yang jujur');
  console.log('PUSH_MSG:', JSON.stringify(text.match(/Push (gagal.*|selesai.*)/)?.[0] ?? '-'));
  assert(errors.length === 0, `console kotor: ${errors.join(' | ')}`);
  console.log('SYNC_OK');
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
