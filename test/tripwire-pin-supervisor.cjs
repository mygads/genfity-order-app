// Tripwire PIN/supervisor (PP-012): jaga invarian keamanan yang tak boleh
// regresi tanpa ketahuan CI — dicek statik dari sumber (tanpa runtime RN):
//  1. authorizeSupervisor memakai AbortController + timeout (GAP-5).
//  2. PIN dicocokkan PENUH, tanpa slice(0,6) (R38).
//  3. Jalur offline/unconfigured fail-closed (ok:false, tanpa bakar attempt
//     untuk klasifikasi offline).
//  4. PIN supervisor tak pernah di-console.log / disimpan plaintext.
//  5. tOf tak mengembalikan key mentah (S4).
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  const sup = read('lib/supervisor.ts');
  const pin = read('lib/pin.ts');
  const i18n = read('lib/i18n.ts');

  // 1. Timeout abort nyata di authorizeSupervisor.
  ok(/new AbortController\(\)/.test(sup) && /setTimeout\(/.test(sup) && /ctrl\.abort\(\)/.test(sup),
    'supervisor: AbortController + setTimeout + abort() wajib ada');
  ok(/signal:\s*ctrl\.signal/.test(sup),
    'supervisor: signal diteruskan ke apiFetch (abort nyata, bukan race saja)');
  // 2. Tanpa pemotongan PIN.
  ok(!/slice\(0,\s*6\)/.test(sup),
    'supervisor: larangan slice(0,6) — PIN cocok penuh');
  // 3. Fail-closed: hasil offline/unconfigured membawa ok:false.
  ok(/code: 'offline', message: tOf\('sup_offline'\)/.test(sup),
    'supervisor: jalur offline mengembalikan code offline (fail-closed)');
  ok(/code: 'unconfigured'/.test(sup),
    'supervisor: jalur unconfigured ada (mode local/tanpa base URL)');
  ok(/attempts \+= 1/.test(sup) && /R35/.test(readRaw('lib/supervisor.ts')),
    'supervisor: penghitung attempt + klasifikasi offline-sebelum-hitung ada');
  // 4. PIN tak bocor ke log; verifyAttendancePin diekspor lib/pin.
  ok(!/console\.log\(.*pin/i.test(sup) && !/console\.log\(.*pin/i.test(pin),
    'supervisor+pin: tak ada console.log berisi PIN');
  ok(/export\s+(async\s+)?function\s+verifyAttendancePin/.test(pin),
    'pin: verifyAttendancePin diekspor');
  // 5. tOf tak bocorkan key mentah.
  ok(!/if \(!e\) return key/.test(i18n) && /return ''/.test(i18n),
    'i18n: tOf missing-key tak mengembalikan key mentah');
  // 6. Supervisor V1 (S7/PP-001): kontrak BE baru ter-wire; legacy NOL di
  //    alur void/eskalasi/compliment (shift screens dikecualikan: E29).
  const serverRaw = readRaw('config/server.ts');
  const dlg = read('components/SupervisorApprovalDialog.tsx');
  ok(/supervisorApproveV1:\s*'api\/v1\/terminals\/\{id\}\/supervisor-approve'/.test(serverRaw),
    'server: ApiPath.supervisorApproveV1 = kontrak BE baru');
  ok(/export\s+(async\s+)?function\s+authorizeSupervisorV1/.test(sup) && /supervisorPin:\s*clean/.test(sup) && /supervisorUserId/.test(sup),
    'supervisor: authorizeSupervisorV1 kirim identitas eksplisit (bukan {pin} saja)');
  ok(/actionMax:\s*64/.test(sup) && /refIdMax:\s*128/.test(sup) && /reasonMax:\s*500/.test(sup),
    'supervisor: batas action/refId/reason paritas BE');
  ok(/getBoundSupervisorTerminalId/.test(sup) && /terminalIdBe/.test(serverRaw),
    'supervisor: {id} path dari ID numerik BE binding (bukan terminalCode)');
  const v1screens = [
    'screens/cashier/CashierScreen.tsx',
    'screens/cashier/CartDetailScreen.tsx',
    'screens/bill/CancelScreen.tsx',
    'screens/history/HistoryScreen.tsx',
    'screens/booking/BookingScreen.tsx',
    'screens/payment/ExtraPaySection.tsx',
  ];
  const legacyUse = v1screens.filter((f) => /authorizeSupervisor\s*\(/.test(read(f)));
  ok(legacyUse.length === 0,
    'screens: void/eskalasi/compliment NOL authorizeSupervisor legacy' + (legacyUse.length ? ' (' + legacyUse.join(',') + ')' : ''));
  ok(/authorizeSupervisorV1/.test(dlg) && /verifyLocalEscalation/.test(dlg) && /fallbackAccessKey/.test(dlg),
    'dialog: SupervisorApprovalDialog = V1 + fallback lokal + hak eksplisit');
  // 7. AUDIT-V2 fixes (kill + non-killing, re-audit pasca-fix):
  //  a. 401 SUPERVISOR_PIN_* = faktor-PIN, BUKAN sesi mati (tanpa ini satu PIN
  //     supervisor salah me-logout kasir via unauthorizedHandler).
  //  b. Dummy Mode layani path V1 ber-{id} (demo-only; Real-mode offline tetap
  //     fail-closed sebelum unwrap).
  //  c. PIN V1 + dialog 4..8 paritas kebijakan BE (tanpa truncate diam-diam
  //     yang membakar lockout server).
  const apiSrc = readRaw('lib/apiSource.ts');
  ok(/PIN_FACTOR_401_RE\s*=\s*\/\^\(.*SUPERVISOR_PIN_/.test(apiSrc),
    'apiSource: 401 SUPERVISOR_PIN_* diklasifikasikan faktor-PIN (tanpa logout)');
  ok(/segs\[2\]\s*===\s*'terminals'/.test(apiSrc) && /supervisor-approve/.test(apiSrc) && /approvalId/.test(apiSrc),
    'apiSource: Dummy Mode layani V1 supervisor-approve (demo-only, envelope sukses)');
  ok(/clean\.length > 8/.test(sup),
    'supervisor: gate PIN V1 4..8 paritas BE');
  ok(/slice\(0,\s*8\)/.test(dlg) && /maxLength=\{8\}/.test(readRaw('components/SupervisorApprovalDialog.tsx')),
    'dialog: input PIN tanpa truncate 6-digit (maxLength 8)');
  // 8. COND-2 (PP-028, syarat merge): approval compliment WAJIB action persis
  //    COMPLIMENT_SETTLE + refId id-desimal order (satu char salah = settle
  //    403 permanen yang benar). Pin: konstanta kanonis (anti-literal di
  //    layar), ExtraPaySection memakai konstanta + kunci refId desimal,
  //    validator desimal menolak salesNum/nol-depan/negatif, dialog bisa
  //    mengunci refId (tampil statis).
  const extra = read('screens/payment/ExtraPaySection.tsx');
  ok(/export const SUPERVISOR_ACTION_COMPLIMENT_SETTLE = 'COMPLIMENT_SETTLE'/.test(readRaw('lib/supervisor.ts')),
    'supervisor: konstanta aksi kanonis COMPLIMENT_SETTLE persis');
  ok(/SUPERVISOR_ACTION_COMPLIMENT_SETTLE/.test(extra) && !/action=\{authFor === 'compliment' \? 'compliment'/.test(readRaw('screens/payment/ExtraPaySection.tsx')),
    'extrapay: compliment pakai konstanta kanonis (bukan literal compliment)');
  ok(/isDecimalOrderId/.test(extra) && /lockRefId=\{authFor === 'compliment' && isDecimalOrderId/.test(readRaw('screens/payment/ExtraPaySection.tsx')),
    'extrapay: refId dikunci hanya bila orderId desimal valid');
  ok(/export function isDecimalOrderId/.test(readRaw('lib/supervisor.ts')),
    'supervisor: validator isDecimalOrderId diekspor');
  // 8b. Runtime (regex PRODUKSI asli diekstrak dari sumber, bukan duplikat):
  // desimal murni lolos; nomor human-readable/nol-depan/negatif/kosong ditolak.
  const rxSrc = (readRaw('lib/supervisor.ts').match(/export function isDecimalOrderId[\s\S]*?return (\/.*?\/)\.test/) || [])[1];
  ok(!!rxSrc, 'supervisor: regex isDecimalOrderId terekstrak dari sumber');
  if (rxSrc) {
    const rx = eval(rxSrc);
    ok(rx.test('900001'), 'decimal-id: 900001 (id BE) lolos');
    ok(!rx.test('TRX-0001') && !rx.test('A3') && !rx.test(''), 'decimal-id: nomor human-readable/kosong ditolak');
    ok(!rx.test('0901') && !rx.test('-5') && !rx.test('0'), 'decimal-id: nol-depan/negatif/nol ditolak');
    ok(!rx.test('9'.repeat(20)), 'decimal-id: >19 digit ditolak');
  }
  ok(/lockRefId/.test(dlg) && /staticVal\}>\{refId/.test(dlg),
    'dialog: mode lockRefId render refId statis (tak bisa diubah pemohon)');
  // 9. C6 Sesi-C QA3 (owner-override server-verified): E29 dipanggil DULU di
  //    verifyOwnerOverridePin; penolakan server eksplisit (INVALID/LOCKED)
  //    = {ok:false} langsung TANPA fallback hash lokal; fallback lokal HANYA
  //    bila server tak terjangkau (!pv.reached) atau USER_PIN_NOT_SET.
  const login = read('screens/auth/LoginScreen.tsx');
  const loginRaw = readRaw('screens/auth/LoginScreen.tsx');
  ok(/callPinVerify\(termId\.trim\(\),\s*clean,\s*stageToken\)/.test(loginRaw),
    'override: E29 callPinVerify dipanggil DULU sebelum hash lokal');
  ok(/Server menolak eksplisit \(INVALID\/LOCKED\/lainnya\) = server menang/.test(loginRaw) &&
    /else if \(\!\(pv\.status === 400 && pv\.errorCode === 'USER_PIN_NOT_SET'\)\)[\s\S]{0,160}?return \{ ok: false \}/.test(login),
    'override: INVALID/LOCKED server = {ok:false} tanpa fallback lokal');
  ok(/Tak terjangkau → jatuh ke hash lokal di bawah/.test(loginRaw),
    'override: fallback hash lokal HANYA bila server tak terjangkau');
  ok(/USER_PIN_INVALID.*server menang|server menang — tampilkan pesan server jujur/.test(loginRaw),
    'staff-pin: jalur normal INVALID/LOCKED = server menang (tanpa gerbang lokal)');
  ok(/approvedBy = `owner:\$\{ov\.approverUserId\}`/.test(loginRaw) || /approvedBy = `owner:/.test(loginRaw),
    'override: attribution approvedBy owner:<id> dikunci ke sesi (jejak audit lokal)');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  for (const f of r.failures) console.log('FAIL ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
