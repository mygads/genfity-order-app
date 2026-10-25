// Tripwire HISTORY-BILLNO: kunci identitas struk ganda TrxNo/BillNo +
// badan struk sadar-currency + NOL label IDR mentah di luar kamus.
// Kontrak yang dikunci (tanpa runtime RN — dicek statik dari sumber;
// GAGAL bila perilaku dibalik):
//  (a) helper billNo() = no.replace(/^TRX/, 'BILL') + pencarian mencakup
//      BillNo (tak hanya TrxNo).
//  (b) kolom TrxNo/BillNo tablet: kartu compact (TrxNo=item.no,
//      BillNo=billNo(item)) + kolom tablet (Field TrxNo/BillNo).
//  (c) badan struk (buildReceiptBytes) HANYA via escMoney(n, r.currency) —
//      NOL escRp( mentah (IDR-only, residu PW-4). escRp sebagai fallback
//      escMoney + rp() theme disengaja, tak tersentuh.
//  (d) NOL literal 'Diskon (Rp)' di src/ di luar kamus i18n (mengunci P1:
//      kind claim voucher ikut currency cabang, bukan hardcode IDR).
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function listSrc(rel) {
  const out = [];
  const abs = path.join(SRC, rel);
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...listSrc(r));
    else if (/\.tsx?$/.test(e.name)) out.push(r);
  }
  return out;
}

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  const hist = read('screens/history/HistoryScreen.tsx');
  const esc = read('lib/escpos.ts');
  const escRaw = readRaw('lib/escpos.ts');

  // ---- (a) helper billNo() TRX→BILL + pencarian ----
  ok(/const billNo = \(t: Transaction\) => t\.no\.replace\(\/\^TRX\/, 'BILL'\)/.test(hist),
    'HB-a: helper billNo() = no.replace(/^TRX/, BILL) (strik; mutasi HARUS gagal)');
  ok(/billNo\(tr\)\.toLowerCase\(\)\.includes\(q\)/.test(hist),
    'HB-a: pencarian riwayat mencakup billNo (tak hanya TrxNo)');

  // ---- (b) kolom TrxNo/BillNo tablet ----
  ok(/\{t\('hist_col_trxno'\)\}: \{item\.no\}/.test(hist),
    'HB-b: kartu compact tampil TrxNo = item.no');
  ok(/\{t\('hist_col_billno'\)\}: \{billNo\(item\)\}/.test(hist),
    'HB-b: kartu compact tampil BillNo = billNo(item)');
  ok(/<Field label=\{t\('hist_col_trxno'\)\} value=\{item\.no\} \/>/.test(hist),
    'HB-b: kolom tablet TrxNo = item.no');
  ok(/<Field label=\{t\('hist_col_billno'\)\} value=\{billNo\(item\)\} \/>/.test(hist),
    'HB-b: kolom tablet BillNo = billNo(item)');

  // ---- (c) badan struk hanya via escMoney ----
  const bodyStart = escRaw.indexOf('export function buildReceiptBytes');
  const bodyEnd = escRaw.indexOf('export function buildKitchenTicketBytes');
  const body = bodyStart !== -1 && bodyEnd > bodyStart ? escRaw.slice(bodyStart, bodyEnd) : '';
  ok(body.length > 500,
    'HB-c: region buildReceiptBytes terisolasi (>500 char; pemindah fungsi HARUS update tripwire)');
  ok(body && !/escRp\(/.test(strip(body)),
    'HB-c: NOL escRp( mentah di badan struk (semua nominal via money()/escMoney)');
  ok(/const money = \(n: number\): string => escMoney\(n, r\.currency\)/.test(esc),
    'HB-c: helper money() = escMoney(n, r.currency) lestari');
  ok(/export function escMoney\(n: number, currency\?: string\)/.test(esc),
    'HB-c: escMoney(n, currency?) diekspor (fallback IDR = perilaku lama)');

  // ---- (d) NOL literal 'Diskon (Rp)' di luar kamus (mengunci P1) ----
  const offenders = [];
  for (const f of listSrc('.')) {
    if (f.replace(/\\/g, '/') === 'lib/i18n.ts') continue; // kamus = satu-satunya pemilik literal
    const code = read(f);
    if (code.includes("'Diskon (Rp)'") || code.includes('"Diskon (Rp)"')) {
      offenders.push(f);
    }
  }
  ok(offenders.length === 0,
    `HB-d: NOL literal 'Diskon (Rp)' di src/ di luar kamus${offenders.length ? ` (ketemu: ${offenders.join(', ')})` : ''}`);

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
