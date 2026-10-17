// Probe: kenapa expo-sqlite web gagal — cek /worker, crossOriginIsolated,
// dan tangkap pesan error asli openDatabaseSync.
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const warns = [];
  const badReqs = [];
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.type() + ': ' + m.text().slice(0, 250)); });
  page.on('pageerror', (e) => warns.push('PAGEERROR: ' + String(e).slice(0, 250)));
  page.on('response', (r) => { if (r.status() >= 400) badReqs.push(r.status() + ' ' + r.url().slice(0, 120)); });
  page.on('requestfailed', (r) => badReqs.push('FAILED ' + r.url().slice(0, 120) + ' :: ' + (r.failure()?.errorText || '')));
  await page.goto('http://localhost:8905/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 180000 });
  await page.waitForTimeout(6000);
  const probe = await page.evaluate(async () => {
    const out = {};
    out.isolated = window.crossOriginIsolated;
    out.opfs = !!navigator.storage?.getDirectory;
    try {
      const r = await fetch(new URL('./worker', window.location.href).toString(), { method: 'HEAD' });
      out.workerHead = r.status;
    } catch (e) { out.workerHead = 'FETCH-ERR:' + String(e).slice(0, 100); }
    return out;
  });
  console.log('PROBE:', JSON.stringify(probe));
  console.log('WARNS:', warns.length ? warns.slice(0, 12) : 'none');
  console.log('BADREQ:', badReqs.length ? badReqs.slice(0, 12) : 'none');
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
