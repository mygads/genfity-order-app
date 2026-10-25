// Tripwire ronde-3 trisisi member GO (APP, aditif). Kunci statik:
//  GO-01: memberRef = sumber tunggal identitas + parse/compare/gate/mask.
//  GO-02: tanpa alias inline `MC${...}` di luar memberRef (satu produsen).
//  GO-03: MemberScreen resolve-before-attach (blokir + pesan, ctx customerId).
//  GO-04: customerId GO di payload settle/drain (order-create, group-visit,
//         immediate settle, antrean GO_OP_SETTLE); alias tak ikut payload.
//  GO-05: gate memberLookupEnabled (pos-config → cache → UI lookup).
//  GO-06: snapshot pra vs block pasca → banner persisten + view minimal.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
// Cermin tripwire-member-m1: strip komentar agar cuplikan `MC{...}` di
// komentar tak dihitung sebagai produsen alias.
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const raw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(raw(p));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // GO-01: API memberRef.
  const ref = read('lib/memberRef.ts');
  for (const fn of [
    'parseCustomerId',
    'localMemberKeyForCustomer',
    'customerIdFromLocalKey',
    'isAliasMemberId',
    'parseSettleMemberBlock',
    'snapshotFromParsed',
    'isMemberViewChanged',
    'parseMemberLookupEnabled',
    'maskMemberName',
  ]) {
    ok(new RegExp(`export function ${fn}`).test(ref), `GO-01: memberRef mengekspor ${fn}`);
  }
  ok(/GO_CUSTOMER_ALIAS_PREFIX/.test(ref), 'GO-01: prefix alias tunggal GO_CUSTOMER_ALIAS_PREFIX');

  // GO-02: satu-satunya produsen format `MC${...}` = memberRef.
  ok(/`MC\$\{/.test(raw('lib/memberRef.ts')), 'GO-02: memberRef memprodusi format MC{id}');
  for (const p of [
    'screens/member/MemberScreen.tsx',
    'screens/payment/PayScreen.tsx',
    'screens/payment/QrisScreen.tsx',
    'screens/payment/EdcScreen.tsx',
    'lib/sales.ts',
    'lib/settleMirror.ts',
    'lib/posWire.ts',
    'lib/payments.ts',
  ]) {
    ok(!/`MC\$\{/.test(read(p)), `GO-02: tanpa inline MC\${} di ${p}`);
  }

  // GO-03: resolve-before-attach di MemberScreen.
  const member = read('screens/member/MemberScreen.tsx');
  ok(/localMemberKeyForCustomer\(/.test(member), 'GO-03: MemberScreen parse kunci lokal MC{id}');
  ok(/localToServer/.test(member), 'GO-03: MemberScreen memetakan hasil resolve search');
  ok(/mem_attach_needs_go/.test(member), 'GO-03: MemberScreen memblokir tempel tanpa GO id');
  ok(/customerId/.test(member) && /memberPoin/.test(member), 'GO-03: ctx terapkan membawa customerId + memberPoin');

  // GO-04: customerId di payload.
  const payments = read('lib/payments.ts');
  ok(/parseCustomerId\(s\.customerId\)/.test(payments), 'GO-04: order-create hanya kirim customerId GO');
  ok(!/\.\.\.\(s\.memberId \? \{ memberId: s\.memberId \} : \{\}\)/.test(payments), 'GO-04: order-create tak kirim memberId alias');
  const sales = read('lib/sales.ts');
  ok(/l\.customerId != null \? \{ customerId: l\.customerId \} : \{\}/.test(sales), 'GO-04: group-visit sync hanya customerId');
  ok(/payments: legs\.map\(\(l\) => \(\{\s+method: l\.method/.test(sales), 'GO-04: peta payments tanpa memberId');
  const wire = read('lib/posWire.ts');
  ok(/customerId\?: number/.test(wire), 'GO-04: SettleInput membawa customerId');
  ok(/custId != null \? \{ customerId: custId \} : \{\}/.test(wire), 'GO-04: body settle membawa customerId');
  ok(/parseSettleMemberBlock\(data\)/.test(wire), 'GO-04: response settle diparse sebagai member block');
  const mirror = read('lib/settleMirror.ts');
  ok(/customerId: custId/.test(mirror) || /\.\.\.\(custId != null \? \{ customerId: custId \} : \{\}\)/.test(mirror),
    'GO-04: mirror QRIS/EDC teruskan customerId ke settle');
  ok(/op: GO_OP_SETTLE/.test(mirror) && /customerId/.test(mirror), 'GO-04: antrean GO_OP_SETTLE membawa customerId');
  const pay = read('screens/payment/PayScreen.tsx');
  ok(/recordSettleMemberResult\(/.test(pay), 'GO-04: mirror inline Pay mencatat hasil settle');

  // GO-05: gate memberLookupEnabled.
  const tapi = read('lib/terminalApi.ts');
  ok(/memberLookupEnabled/.test(tapi) && /parseMemberLookupEnabled/.test(tapi), 'GO-05: terminalApi parse memberLookupEnabled');
  const sync = read('lib/posConfigSync.ts');
  ok(/getMemberLookupEnabled/.test(sync), 'GO-05: posConfigSync mengekspor getMemberLookupEnabled');
  ok(/lookupEnabled/.test(member) && /mem_lookup_disabled/.test(member), 'GO-05: MemberScreen gate lookup + catatan');

  // GO-06: banner + view minimal.
  const store = read('lib/memberChangedStore.ts');
  for (const fn of ['markMemberChanged', 'takeMemberChanged', 'getSettleMemberView', 'recordSettleMemberResult']) {
    ok(new RegExp(`export async function ${fn}`).test(store), `GO-06: memberChangedStore mengekspor ${fn}`);
  }
  const success = read('screens/payment/SuccessScreen.tsx');
  ok(/takeMemberChanged/.test(success) && /getSettleMemberView/.test(success), 'GO-06: Success konsumsi flag + view member');
  ok(/mem_changed_banner/.test(success), 'GO-06: Success menampilkan banner berubah');
  ok(/maskMemberName/.test(pay), 'GO-06: Pay chip memakai nama samar');
  const receipt = read('screens/bill/ReceiptScreen.tsx');
  ok(/memberLine/.test(receipt), 'GO-06: Receipt menampilkan baris member minimal');
  ok(/memberLine/.test(success), 'GO-06: Success teruskan memberLine ke Receipt');

  // GO-07: i18n id+en lengkap.
  const i18n = read('lib/i18n.ts');
  for (const k of ['mem_go_points', 'mem_go_vouchers', 'mem_changed_banner', 'mem_attach_needs_go', 'mem_lookup_disabled']) {
    ok(new RegExp(k).test(i18n), `GO-07: i18n memuat ${k}`);
  }

  return { failures, checks };
}

module.exports = { run };
