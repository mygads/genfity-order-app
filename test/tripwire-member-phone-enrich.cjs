// Tripwire pengayaan telepon member POS-side (MEM-PHONE, tanpa ubah BE).
// Saat pullMaster member, loyalty member (tanpa nomor) dicocokkan dengan
// customers/search (punya nomor) secara preservasi; telepon hanya diisi bila
// match yakin 1:1. Kunci:
//  MP-01: helper murni diekspor (normalizeMemberName, phoneDigits,
//    isUsablePhone, parseBeCustomers, matchCustomerForMember,
//    decideEnrichedPhone) + tipe BeCustomerCandidate.
//  MP-02: match 1:1 yakin — nama ternormalisasi sama persis +
//    loyaltyMember true + nomor valid + TEPAT SATU (bukan-1 = null).
//  MP-03: preservasi SQL — donasi NULL/'' pertahankan lokal; lokal-isi
//    pertahankan lokal; hanya lokal-kosong + donasi valid yang diisi.
//  MP-04: pullBeMembers panggil customers/search per nama (best-effort per
//    baris; 404 search = NULL; 401 = fail-closed sesi).
//  MP-05: tanpa ubah skema + tanpa sentuh Login/SelectBranch.
//  MP-06: tabel fixture match/no-match (mirror JS aturan terdokumentasi).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
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

  const lib = read('lib/masterBe.ts');
  const libRaw = raw('lib/masterBe.ts');

  // MP-01: helper murni diekspor.
  for (const fn of [
    'normalizeMemberName',
    'phoneDigits',
    'isUsablePhone',
    'parseBeCustomers',
    'matchCustomerForMember',
    'decideEnrichedPhone',
  ]) {
    ok(new RegExp(`export function ${fn}`).test(lib), `MP-01: masterBe mengekspor ${fn} (murni)`);
  }
  ok(/export interface BeCustomerCandidate/.test(lib), 'MP-01: masterBe mengekspor tipe BeCustomerCandidate');

  // MP-02: syarat kumulatif 1:1.
  ok(/loyaltyMember === true/.test(lib), 'MP-02: match mensyaratkan loyaltyMember true');
  ok(/normalizeMemberName\(c\.name\) === want/.test(lib), 'MP-02: match mensyaratkan nama ternormalisasi sama persis');
  ok(/isUsablePhone\(c\.phone\)/.test(lib), 'MP-02: match mensyaratkan nomor valid');
  ok(/hits\.length !== 1/.test(lib), 'MP-02: bukan-1 (nol/duplikat) = null (no-match)');
  ok(/Poin SENGAJA bukan filter/.test(libRaw), 'MP-02: poin didokumentasikan bukan filter (drift antar panggilan)');

  // MP-03: preservasi SQL + helper.
  ok(/WHEN excluded\.phone IS NULL OR excluded\.phone = '' THEN ms_member\.phone/.test(lib),
    'MP-03: donasi NULL/kosong = pertahankan lokal');
  ok(/WHEN ms_member\.phone IS NOT NULL AND ms_member\.phone <> '' THEN ms_member\.phone/.test(lib),
    'MP-03: lokal-isi = pertahankan lokal (tak ditimpa donasi)');
  ok(/ELSE excluded\.phone END/.test(lib), 'MP-03: hanya lokal-kosong + donasi valid yang diisi');
  ok(/String\(localPhone\)\.trim\(\) !== ''/.test(lib), 'MP-03: decideEnrichedPhone mengembalikan null bila lokal terisi');
  ok(!/phone = excluded\.phone[,;\s]*$/.test(lib), 'MP-03: tak ada timpa-buta phone = excluded.phone');

  // MP-04: wiring pengayaan di pullBeMembers.
  ok(/async function beSearchCustomers/.test(lib), 'MP-04: helper beSearchCustomers ada (q,take -> customers/search)');
  ok(/ApiPath\.pullGoCustomers/.test(lib), 'MP-04: pengayaan memakai path pullGoCustomers (tanpa path baru)');
  ok(/beSearchCustomers\(m\.memberName, 50\)/.test(lib), 'MP-04: pullBeMembers mencari per nama (take 50 = batas BE)');
  ok(/matchCustomerForMember\(m, parseBeCustomers\(found\)\)/.test(lib), 'MP-04: pullBeMembers parse + match 1:1 per baris');
  ok(/instanceof BeEndpointMissing/.test(lib), 'MP-04: 404 search = NULL (best-effort, bukan gagal)');
  ok(/Sesi kedaluwarsa/.test(lib), 'MP-04: 401 pengayaan = fail-closed sesi (dilempar)');
  ok(/pengayaan telepon/.test(libRaw), 'MP-04: kegagalan non-401 dicatat warn + donasi NULL (preservasi)');

  // MP-05: batasan kepemilikan.
  ok(!/CREATE TABLE|ALTER TABLE/i.test(lib), 'MP-05: tanpa CREATE/ALTER TABLE (skema utuh)');
  ok(!/screens\//.test(libRaw), 'MP-05: adapter tak menyentuh layar (Login/SelectBranch aman)');

  // MP-06: fixture match/no-match (mirror JS aturan; cermin fungsi murni).
  const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const digs = (v) => String(v ?? '').replace(/[^0-9]/g, '');
  const usable = (v) => {
    const t = String(v ?? '');
    if (!t.trim()) return false;
    if (/[*xX\u2022]/.test(t)) return false;
    const d = digs(t);
    return d.length >= 9 && d.length <= 16;
  };
  const match = (memberName, cands) => {
    const want = norm(memberName);
    if (!want) return null;
    const hits = (cands || []).filter(
      (c) => c && c.loyaltyMember === true && norm(c.name) === want && usable(c.phone),
    );
    return hits.length === 1 ? hits[0] : null;
  };
  const decide = (local, m) => {
    if (local !== undefined && local !== null && String(local).trim() !== '') return null;
    const c = String(m ?? '').trim();
    return usable(c) ? c : null;
  };

  const budi = { id: 7, name: 'Budi Santoso', phone: '0812-3456-789', pointsBalance: 1200, loyaltyMember: true };
  ok(match('Budi Santoso', [budi])?.id === 7, 'MP-06 MATCH: nama persis + loyalty + nomor valid -> isi');
  ok(match('  SITI  Aminah ', [{ id: 9, name: 'siti aminah', phone: '+628123456789', pointsBalance: 0, loyaltyMember: true }])?.id === 9,
    'MP-06 MATCH: normalisasi spasi/kapital + digit +62 -> isi');
  ok(match('Budi Santoso', [{ ...budi, pointsBalance: 500 }])?.id === 7,
    'MP-06 MATCH: poin drift (0 vs 500) tetap isi bila tunggal (bukan filter)');
  ok(match('Budi Santoso', [{ ...budi, name: 'Budi Santoso Wijaya' }]) === null,
    'MP-06 NO-MATCH: nama lebih panjang (substring BE) bukan sama persis');
  ok(match('Budi Santoso', [{ ...budi, loyaltyMember: false }]) === null,
    'MP-06 NO-MATCH: kandidat non-loyalty tak boleh mendonorkan nomor');
  ok(match('Budi Santoso', [{ ...budi, phone: '' }]) === null,
    'MP-06 NO-MATCH: kandidat tanpa nomor = tak ada donasi');
  ok(match('Budi Santoso', [{ ...budi, phone: '0812-****-789' }]) === null,
    'MP-06 NO-MATCH: nomor termask tak valid');
  ok(match('Budi Santoso', [budi, { ...budi, id: 8, phone: '081999999999' }]) === null,
    'MP-06 NO-MATCH: dua kandidatValid nama-sama = ambigu, preservasi');
  ok(match('Budi Santoso', []) === null, 'MP-06 NO-MATCH: nol kandidat = preservasi');
  ok(match('   ', [budi]) === null, 'MP-06 NO-MATCH: nama member kosong = lewati');
  ok(decide('081999', '0812-3456-789') === null, 'MP-06 PRESERVASI: lokal-isi tak ditimpa donasi');
  ok(decide('', '0812-3456-789') === '0812-3456-789', 'MP-06 PRESERVASI: lokal-kosong + donasi valid -> isi');
  ok(decide(null, null) === null, 'MP-06 PRESERVASI: donasi NULL tak menghapus lokal');
  ok(decide('', '0812-**-789') === null, 'MP-06 PRESERVASI: donasi mask tak diisi');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
