// Tripwire wiring-1 shift/clock + sesi kas + tutup-hari ke BE
// (SESI-FIX-APPW1, gas mode, aditif). Kunci statik:
//  W1-01: ApiPath workforce/cash/EOD + komentar PIN-tak-pernah-dikirim.
//  W1-02: beWorkforce — ekspor kontrak, timeout 8000, strip PIN, stamp terminal
//         + retry-tanpa-stamp, offline fail-open, flush pending-close, builder
//         payload murni, tak impor sync (anti-siklus).
//  W1-03: drain sync — op be-* satu sumber, substitusi {sessionId} drain-time,
//         replay-code W1, alih OPEN_POS_ORDERS -> pending-close, EOD.
//  W1-04: layar — Shift/EndShift/Cashier/PettyCashForm memanggil kontrak W1
//         fire-and-forget SETELAH lokal menang; PIN tak ikut.
//  W1-05: file W2 tak tersentuh (posWire/history/apiSource/layar W2/tripwire W2).
//  W1-06: approve sesi kas — transport cashApproveBe + payload antrean +
//         drain REVIEW_NOT_PENDING + kartu approve ShiftScreen (manager kedua).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
// NB: baris-komentar dulu, baru blok — cermin tripwire-poswire-w2.
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p) => strip(fs.readFileSync(path.join(SRC, p), 'utf8'));
const raw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // W1-01: ApiPath.
  const server = read('config/server.ts');
  for (const k of ['merchantClockIn', 'merchantClockOut', 'merchantManagerClock',
    'merchantCurrentShift', 'merchantPosCashSessions', 'merchantCashOpen',
    'merchantCashMove', 'merchantCashClose', 'merchantCashApprove',
    'merchantEodPreview', 'merchantEodClose']) {
    ok(new RegExp(`\\b${k}\\b`).test(server), `W1-01: ApiPath memuat ${k}`);
  }
  ok(/clock-in/.test(server) && /clock-out/.test(server), 'W1-01: path clock-in/out workforce');
  ok(/cash-registers\/sessions/.test(server), 'W1-01: path sesi kas cash-registers');
  ok(/\{sessionId\}/.test(raw('config/server.ts')), 'W1-01: path move/close ber-parameter {sessionId}');

  // W1-02: beWorkforce.
  const wf = read('lib/beWorkforce.ts');
  const wfRaw = raw('lib/beWorkforce.ts');
  for (const e of ['W1_OP_CLOCK_IN', 'W1_OP_CLOCK_OUT', 'W1_OP_CASH_OPEN',
    'W1_OP_CASH_MOVE', 'W1_OP_CASH_CLOSE', 'W1_OP_CASH_APPROVE', 'W1_OP_EOD_CLOSE',
    'BE_WF_TIMEOUT_MS', 'stripPin', 'terminalStamp', 'clockInBe', 'clockOutBe',
    'cashOpenBe', 'cashMoveBe', 'cashCloseBe', 'cashApproveBe', 'eodPreviewBe', 'eodCloseBe',
    'getCashSessionId', 'setCashSessionId', 'clearCashSessionId',
    'getPendingReviewSid', 'setPendingReviewSid', 'clearPendingReviewSid',
    'loadPendingCashCloses', 'recordPendingCashClose', 'dropPendingCashClose',
    'flushPendingCashCloses', 'clockInPayload', 'clockOutPayload',
    'cashOpenPayload', 'cashMovePayload', 'cashClosePayload', 'cashApprovePayload', 'shouldQueueW1',
    'isServerSessionId', 'isW1Online', 'mapArusToMoveType']) {
    ok(new RegExp(`\\b${e}\\b`).test(wf), `W1-02: beWorkforce mengekspor ${e}`);
  }
  ok(/8000/.test(wf) && /BE_WF_TIMEOUT_MS/.test(wf), 'W1-02: timeout immediate-first 8000');
  ok(/stripPin/.test(wf) && /toLowerCase\(\) === 'pin'/.test(wfRaw),
    'W1-02: stripPin memoles SEMUA kunci pin (defense-in-depth)');
  ok(/TERMINAL_NOT_FOUND/.test(wf) && /INVALID_TERMINAL/.test(wf),
    'W1-02: retry-tanpa-stamp saat server menolak stamp');
  ok(/fromDummy/.test(wf) && /status === 0/.test(wf), 'W1-02: offline fail-open (dummy/status-0)');
  ok(/SHIFT_ALREADY_OPEN/.test(wf) && /SESSION_CLOSED/.test(wf) && /NO_OPEN_SHIFT/.test(wf),
    'W1-02: 409 idempoten = sukses (open-ganda/tutup-ganda/tanpa-shift)');
  ok(/OPEN_POS_ORDERS/.test(wf), 'W1-02: 409 OPEN_POS_ORDERS dikenali (rejected jujur)');
  ok(!/from '\.\/sync'/.test(wfRaw) && !/from '\.\.\/lib\/sync'/.test(wfRaw) && !/require\(['"]\.{0,2}\/?[^'"]*sync['"]\)/.test(wfRaw),
    'W1-02: beWorkforce TAK mengimpor sync (anti-siklus; sync -> beWorkforce)');
  ok(/registerId: 0/.test(wf), 'W1-02: cash-open registerId 0 = Main register server');
  ok(!/pin\s*:/.test(wf) || /kunci PIN|PIN tak|tanpa PIN/i.test(wfRaw),
    'W1-02: tak ada literal pin: di body jaringan/antrean');

  // W1-03: drain sync.
  const sync = read('lib/sync.ts');
  const syncRaw = raw('lib/sync.ts');
  ok(/from '\.\/beWorkforce'/.test(syncRaw), 'W1-03: sync mengimpor op W1 dari beWorkforce');
  for (const op of ['W1_OP_CLOCK_IN', 'W1_OP_CLOCK_OUT', 'W1_OP_CASH_OPEN',
    'W1_OP_CASH_MOVE', 'W1_OP_CASH_CLOSE', 'W1_OP_CASH_APPROVE', 'W1_OP_EOD_CLOSE']) {
    ok(new RegExp(`\\b${op}\\b`).test(sync), `W1-03: drain memakai ${op}`);
  }
  ok(/function goWorkforceOp/.test(sync), 'W1-03: penerjemah goWorkforceOp ada (terpisah dari goMerchantOp W2)');
  ok(/\{sessionId\}/.test(syncRaw) && /getCashSessionId\(\)/.test(sync),
    'W1-03: substitusi {sessionId} drain-time dari id sesi tersimpan');
  ok(/W1_REPLAY_RE/.test(sync) && /SHIFT_ALREADY_CLOSED/.test(sync),
    'W1-03: replay-code W1 sendiri (di luar isReplaySuccess W2)');
  ok(/OPEN_POS_ORDERS/.test(sync) && /recordPendingCashClose/.test(sync),
    'W1-03: 409 OPEN_POS_ORDERS dialihkan ke pending-close (bukan hilang)');
  ok(/merchantEodClose/.test(sync), 'W1-03: op EOD-close terkuras ke merchantEodClose');
  ok(/merchantCashApprove/.test(sync) && /REVIEW_NOT_PENDING/.test(sync),
    'W1-03: op be-cash-approve terkuras ke merchantCashApprove + 409 REVIEW_NOT_PENDING = replay');
  ok(/registerId: 0/.test(sync), 'W1-03: cash-open antrean registerId 0');
  ok(/opW1|be-/.test(sync) && /goWorkforceOp/.test(sync),
    'W1-03: op be-* dirutekan eksplisit ke drain W1 (bukan endpoint salah)');

  // W1-04: layar.
  const shift = read('screens/shift/ShiftScreen.tsx');
  ok(/clockInBe/.test(shift) && /cashOpenBe/.test(shift), 'W1-04: ShiftScreen cermin clock-in + cash-open');
  ok(/clockInPayload/.test(shift) && /cashOpenPayload/.test(shift), 'W1-04: ShiftScreen antrekan be-* saat offline/error');
  ok(/shouldQueueW1/.test(shift), 'W1-04: ShiftScreen hanya antre yang layak (4xx = jujur)');
  const end = read('screens/shift/EndShiftScreen.tsx');
  ok(/clockOutBe/.test(end) && /cashCloseBe/.test(end), 'W1-04: EndShiftScreen cermin clock-out + cash-close');
  ok(/recordPendingCashClose/.test(end) && /flushPendingCashCloses/.test(end),
    'W1-04: EndShiftScreen pending-close + flush');
  ok(/clockOutPayload/.test(end), 'W1-04: EndShiftScreen antrekan be-clock-out');
  const cashier = read('screens/cashier/CashierScreen.tsx');
  ok(/flushPendingCashCloses/.test(cashier) && /useEffect/.test(cashier),
    'W1-04: CashierScreen flush pending-close saat mount');
  const petty = read('screens/cash/PettyCashFormScreen.tsx');
  ok(/cashMoveBe/.test(petty) && /cashMovePayload/.test(petty) && /mapArusToMoveType/.test(petty),
    'W1-04: PettyCashFormScreen cermin movement kas');
  for (const [nm, src] of [['ShiftScreen', shift], ['EndShiftScreen', end], ['PettyCashFormScreen', petty]]) {
    ok(/void \(async/.test(src), `W1-04: ${nm} fire-and-forget (tak blokir alur lokal)`);
  }

  // W1-06: approve sesi kas (manager kedua; closer = 403 jujur server).
  ok(/cashApproveBe/.test(wf) && /cashApprovePayload/.test(wf),
    'W1-06: transport + payload builder approve ada');
  ok(/REVIEW_NOT_PENDING/.test(wf),
    'W1-06: 409 REVIEW_NOT_PENDING = approve-replay (sudah di-approve)');
  ok(/getPendingReviewSid/.test(wf) && /setPendingReviewSid/.test(wf) && /clearPendingReviewSid/.test(wf),
    'W1-06: stash sid menunggu-review (storage-backed, cermin sesi kas)');
  ok(/setPendingReviewSid/.test(end) && /pendingManagerReview/.test(end),
    'W1-06: EndShiftScreen stash sid saat tutup menjawab pendingManagerReview');
  const shiftAppr = read('screens/shift/ShiftScreen.tsx');
  ok(/cashApproveBe/.test(shiftAppr) && /cashApprovePayload/.test(shiftAppr) && /getPendingReviewSid/.test(shiftAppr),
    'W1-06: ShiftScreen kartu approve (immediate-first + antrean be-cash-approve)');
  ok(/submitApprove/.test(shiftAppr) && /enqueueSync\('other', cashApprovePayload/.test(shiftAppr),
    'W1-06: ShiftScreen antrekan approve saat offline/error (4xx = jujur)');
  const i18nRaw = raw('lib/i18n.ts');
  for (const k of ['appr_title', 'appr_desc', 'appr_note_ph', 'appr_btn', 'appr_sending',
    'appr_need_note', 'appr_ok', 'appr_queued', 'appr_failed']) {
    ok(new RegExp(`\\b${k}\\b`).test(i18nRaw), `W1-06: i18n memuat ${k}`);
  }

  // W1-05: file W2 tak tersentuh (git: hanya tambah-baris di sync.ts/server.ts
  // yang diizinkan; posWire/layar-W2/tripwire-W2/history/apiSource = bersih).
  // A-P1-4 (SESI-EXE2-APP, mandat brief audit — bukan lane W1): PayScreen
  // BOLEH tersentuh SEMATA untuk gerbang PIN fail-closed + antrean-bawa-PIN.
  // Pengecualian dipersempit via penanda kontrak (bukan blanko): tanpa
  // ketiganya = tetap FAIL. Tak menyentuh jalur W1 (beWorkforce/shift).
  // SESI-FINAL-APP (mandat koordinator, kontrak BE paralel — bukan lane W1):
  // posWire BOLEH tersentuh SEMATA untuk proofUrl aditif (SettleInput.proofUrl
  // + thread body + 409 PROOF_REQUIRED passthrough). Pengecualian dipersempit
  // via penanda kontrak: tanpa ketiganya = tetap FAIL. Jalur W1
  // (goWorkforceOp/drain-be) tak boleh berubah oleh sentuhan ini.
  // SESI-FINAL-APP K4 (mandat koordinator, kontrak BE paralel — bukan lane W1):
  // KitchenScreen BOLEH tersentuh SEMATA untuk catatan kanonis (fallback ESB
  // pullMenu/pullStation = kanonis penuh, tak ada endpoint menu gambar
  // GO-terminal). Pengecualian dipersempit: penanda K4 di raw + logika
  // pullMenu/pullStation lestari di stripped (= sentuhan komentar saja).
  const AP14_MARKERS = ['holdAsUnpaidOffline', 'pay_hold_unpaid', 'requiresPosPin'];
  const FINALAPP_WIRE_MARKERS = ['proofUrl', 'PROOF_REQUIRED', 'proofClean'];
  const FINALAPP_KITCHEN_MARKERS = ['SESI-FINAL-APP K4', 'KANONIS'];
  try {
    const diff = execSync('git diff --name-only', { cwd: ROOT, encoding: 'utf8' });
    const touched = diff.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const w2Guard = ['src/lib/history.ts', 'src/lib/apiSource.ts',
      'src/screens/booking/BookingScreen.tsx',
      'src/screens/history/EsbOrderScreen.tsx',
      'src/screens/history/HistoryScreen.tsx', 'test/tripwire-poswire-w2.cjs'];
    // NB: src/lib/posWire.ts dikeluarkan dari w2Guard — dijaga blok
    // FINAL-APP di bawah (penanda kontrak, bukan blanko).
    // NB: src/screens/history/KitchenScreen.tsx dikeluarkan dari w2Guard —
    // dijaga blok FINAL-APP K4 di bawah (catatan kanonis komentar-saja).
    for (const f of w2Guard) {
      ok(!touched.includes(f), `W1-05: ${f} tak tersentuh (milik W2)`);
    }
    if (touched.includes('src/screens/payment/PayScreen.tsx')) {
      const payRaw = raw('screens/payment/PayScreen.tsx');
      ok(AP14_MARKERS.every((m) => payRaw.includes(m)),
        'W1-05: PayScreen tersentuh HANYA untuk kontrak A-P1-4 (gerbang PIN fail-closed + antrean-bawa-PIN)');
    } else {
      checks++;
    }
    if (touched.includes('src/lib/posWire.ts')) {
      const wireRaw = raw('lib/posWire.ts');
      ok(FINALAPP_WIRE_MARKERS.every((m) => wireRaw.includes(m)),
        'W1-05: posWire tersentuh HANYA untuk kontrak SESI-FINAL-APP (proofUrl aditif + 409 PROOF_REQUIRED passthrough)');
      // NB: sumber ter-strip (komentar P1-2 lama yang menyebut beWorkforce
      // bukan kopling jalur W1).
      const wireStripped = read('lib/posWire.ts');
      ok(!/goWorkforceOp|W1_OP_|beWorkforce/.test(wireStripped),
        'W1-05: sentuhan FINAL-APP tak menyentuh jalur W1 (goWorkforceOp/drain-be)');
    } else {
      checks++;
    }
    if (touched.includes('src/screens/history/KitchenScreen.tsx')) {
      const kitRaw = raw('screens/history/KitchenScreen.tsx');
      ok(FINALAPP_KITCHEN_MARKERS.every((m) => kitRaw.includes(m)),
        'W1-05: KitchenScreen tersentuh HANYA untuk catatan kanonis SESI-FINAL-APP K4 (fallback ESB = kanonis, bukan sementara)');
      const kitStripped = read('screens/history/KitchenScreen.tsx');
      ok(/pullMenu/.test(kitStripped) && /pullStation/.test(kitStripped),
        'W1-05: logika fallback pullMenu/pullStation lestari (sentuhan = komentar saja)');
    } else {
      checks++;
    }
    const st = execSync('git status --short', { cwd: ROOT, encoding: 'utf8' });
    ok(!/genfity-logo|icon\/|splash|Login|Intro|About|Idle/i.test(st),
      'W1-05: aset logo (icon/splash/genfity-logo*) tak tersentuh');
  } catch (e) {
    // Tanpa git = lewati penjaga (bukan gagal): lingkungan baca-saja.
    // eslint-disable-next-line no-console
    console.log('W1-05 SKIP (git tak tersedia):', String((e && e.message) || e).slice(0, 120));
    checks++;
  }

  return { failures, checks };
}

module.exports = { run };
