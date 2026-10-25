// Tripwire M1 loyalty member (APP, gas mode, aditif). Kunci statik:
//  M1-01: ApiPath loyalty (search/deposit via customers/search + postDepositOnce).
//  M1-02: tanpa jalur tulis earn lokal (poin milik loyalty server).
//  M1-03: poin server-menang (pull/search/inquiry menimpa overlay lama).
//  M1-04: customer MC{serverId} dimaterialisasi ke ms_member + email.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
// NB: baris-komentar dulu, baru blok — server.ts memuat '/*' di dalam
// komentar baris yang mengecoh strip blok-dulu.
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p) => strip(fs.readFileSync(path.join(SRC, p), 'utf8'));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // M1-01: kontrak transport.
  const server = read('config/server.ts');
  ok(/merchantCustomerSearch/.test(server), 'M1-01: ApiPath memuat merchantCustomerSearch');
  ok(/merchantEmailDeliverySettings/.test(server), 'M1-01: ApiPath memuat merchantEmailDeliverySettings');
  ok(/merchantOrderSendReceipt/.test(server), 'M1-01: ApiPath memuat merchantOrderSendReceipt');
  const wire = read('lib/posWire.ts');
  const member = read('screens/member/MemberScreen.tsx');
  ok(/export async function searchServerCustomers/.test(wire), 'M1-01: searchServerCustomers diekspor dari posWire');
  ok(/export async function isInvoiceEmailEnabled/.test(wire), 'M1-01: isInvoiceEmailEnabled diekspor dari posWire');
  ok(/export async function sendPosReceiptEmail/.test(wire), 'M1-01: sendPosReceiptEmail diekspor dari posWire');
  const deposit = read('lib/deposit.ts');
  ok(/export async function postDepositOnce/.test(deposit), 'M1-01: lib/deposit mengekspor postDepositOnce');
  ok(/postDepositOnce/.test(member), 'M1-01: MemberScreen deposit tetap via postDepositOnce (satu jalur tulis)');

  // M1-02: tanpa earn lokal.
  ok(!/1 poin per Rp1\.000/.test(member), 'M1-02: tak ada earn 1 poin per Rp1.000');
  ok(!/void addPoints\(mid/.test(member), 'M1-02: tak ada earn inline pasca-topup/deposit');

  // M1-03: server-menang.
  ok(/server-wins|server menang/i.test(fs.readFileSync(path.join(SRC, 'screens/member/MemberScreen.tsx'), 'utf8')),
    'M1-03: komentar server-wins tercatat di MemberScreen');
  ok(/cacheServerPoints/.test(member), 'M1-03: MemberScreen memakai cacheServerPoints');
  ok(/searchServerCustomers/.test(member), 'M1-03: MemberScreen memanggil searchServerCustomers');

  // M1-04: materialisasi + email. Ronde-3: satu-satunya produsen format
  // MC{id} = localMemberKeyForCustomer (lib/memberRef); MemberScreen memakai
  // helper itu, bukan inline `MC${...}`.
  ok(/localMemberKeyForCustomer\(/.test(member), 'M1-04: MemberScreen materialisasi via localMemberKeyForCustomer');
  ok(!/`MC\$\{/.test(member), 'M1-04: MemberScreen tanpa inline MC${} (produsen tunggal memberRef)');
  ok(/m\.email|email: /.test(member), 'M1-04: MemberScreen membaca/menulis email');
  const schema = read('lib/dbSchema.ts');
  ok(/ms_member ADD COLUMN email TEXT|email TEXT/.test(schema), 'M1-04: skema ms_member memuat kolom email');
  const i18n = read('lib/i18n.ts');
  for (const k of ['mem_email_label', 'mem_email_ph', 'mem_email_bad', 'hist_mail_sent', 'hist_mail_off']) {
    ok(new RegExp(k).test(i18n), `M1-04: i18n memuat ${k}`);
  }
  const receipt = read('screens/bill/ReceiptScreen.tsx');
  ok(/isInvoiceEmailEnabled/.test(receipt) && /sendPosReceiptEmail/.test(receipt),
    'M1-04: ReceiptScreen kirim struk via server dengan gerbang invoice-email');

  return { failures, checks };
}

module.exports = { run };
