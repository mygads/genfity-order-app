const { chromium } = require('playwright-core');
const { copyFileSync } = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Ronde "gas": alur install/klaim (guest) + layar yang berubah.
const JOBS = [
  { device: 'phone', vp: { width: 390, height: 844 } },
  { device: 'tablet', vp: { width: 1024, height: 768 } },
];

async function snap(page, job, name) {
  const tmp = `docs/shots/${job.device}-${name}.png`;
  await page.screenshot({ path: tmp });
  copyFileSync(tmp, `verify/${job.device}-${name}.png`);
  console.log(tmp);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  for (const job of JOBS) {
    const page = await browser.newPage({ viewport: job.vp });
    await page.goto('http://localhost:8902/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.body && document.body.innerText.length > 50, null, { timeout: 90000 });
    await page.waitForTimeout(4000);

    const guest = async (s, wait = 3500, p) => {
      const q = p ? JSON.stringify(p) : 'undefined';
      await page.evaluate(new Function(`window.__NAV__ && window.__NAV__.goGuest(${JSON.stringify(s)}, ${q})`));
      await page.waitForTimeout(wait);
    };
    const go = async (s, wait = 3500, p) => {
      const q = p ? JSON.stringify(p) : 'undefined';
      await page.evaluate(new Function(`window.__NAV__ && window.__NAV__.go(${JSON.stringify(s)}, ${q})`));
      await page.waitForTimeout(wait);
    };

    // --- Alur tamu ---
    await guest('Intro');
    await snap(page, job, 'Intro');
    // Maju ke halaman 4 (CTA klaim/masuk)
    for (let i = 0; i < 3; i++) {
      await page.getByText('Lanjut ›').click().catch(() => {});
      await page.waitForTimeout(600);
    }
    await snap(page, job, 'IntroLast');
    await guest('Install');
    await snap(page, job, 'Install');
    await guest('SelectBranch');
    await snap(page, job, 'SelectBranch');
    await guest('InstallProgress', 1500, { branch: 'ESB Cabang Poris' });
    await snap(page, job, 'InstallProgress');
    await guest('CreatePin', 2000, { branch: 'ESB Cabang Poris' });
    await snap(page, job, 'CreatePin');
    await guest('ForgotPin');
    await snap(page, job, 'ForgotPin');

    // --- Layar berubah (login dulu via go) ---
    await go('Login');
    await snap(page, job, 'Login');
    await go('Recap');
    await snap(page, job, 'Recap');
    await go('Cashier');
    await snap(page, job, 'Cashier');
    await go('Member');
    await page.getByText('Budi Santoso').first().click().catch(() => {});
    await page.waitForTimeout(1000);
    await page.getByText('Deposit / Top Up').first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await snap(page, job, 'MemberDeposit');

    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
