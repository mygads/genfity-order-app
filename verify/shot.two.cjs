// Screenshot terarah: node verify/shot.two.cjs <phone|tablet> <Port> <Layar...>
// Contoh: node verify/shot.two.cjs phone 8902 Settings Printers
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const PARAMS = {
  Pay: { total: 266000 },
  Qris: { total: 266000 },
  Edc: { total: 48900 },
  Success: { total: 266000, method: 'Tunai', cash: 300000, change: 34000 },
  Receipt: { total: 266000, method: 'Tunai' },
  CartDetail: { total: 122500, items: [{ id: 'm1', name: 'Nasi Goreng Spesial', basePrice: 25000, qty: 2, modifiers: [], discount: 0 }, { id: 'm2', name: 'Es Teh Manis', basePrice: 8000, qty: 2, modifiers: [], discount: 0 }] },
  WebView: { url: 'https://www.esb.id/esbposlite/registration/', title: 'Pendaftaran POS' },
};

const GUEST = new Set(['Intro', 'Install', 'SelectBranch', 'InstallProgress', 'CreatePin', 'ForgotPin', 'Login']);

async function shot(device, vp, screens, port) {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: vp });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const hook = await page.evaluate(() => !!window.__NAV__);
  if (!hook) throw new Error('__NAV__ hilang — pastikan EXPO_PUBLIC_NAV_HOOK=1');
  await page.evaluate(() => window.__NAV__.go('Dashboard'));
  await page.waitForTimeout(1500);
  for (const s of screens) {
    const p = PARAMS[s] ? JSON.stringify(PARAMS[s]) : 'undefined';
    const fn = GUEST.has(s) ? 'goGuest' : 'go';
    await page.evaluate(new Function(`window.__NAV__ && window.__NAV__.${fn}(${JSON.stringify(s)}, ${p})`));
    await page.waitForTimeout(1800);
    const f = `docs/shots/${device}-${s}.png`;
    await page.screenshot({ path: f });
    console.log('OK', f);
  }
  await browser.close();
}

(async () => {
  const which = process.argv[2] || 'phone';
  const port = process.argv[3] || '8902';
  const screens = process.argv.slice(4);
  if (screens.length === 0) throw new Error('Sebutkan minimal satu layar');
  const vp = which === 'phone' ? { width: 390, height: 844 } : { width: 1024, height: 768 };
  await shot(which, vp, screens, port);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
