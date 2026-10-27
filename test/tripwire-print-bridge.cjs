// Tripwire print-bridge slice penuh (FULL, BE 50fd533): poller klaim-cetak-ack
// terminal — server menang penuh, tanpa fallback lintas-engine.
// Kunci statik (tanpa runtime RN), cermin gaya tripwire-pos-voucher-preview:
//  1. ApiPath trio menunjuk rute BE yang benar
//     (api/v1/terminals/{id}/print-jobs*, prefix api/ = bearer otomatis).
//  2. Siklus poll: claim → kirim byte → ack; hasil kirim menentukan ack
//     (PRINTED vs FAILED); pengecualian printFn TIDAK bocor (catch → FAILED).
//  3. Tanpa job (204/offline/dummy) = idle 'empty', TANPA antrean lokal
//     (SQLite tak kenal id job server); payload rusak = ack FAILED
//     INVALID_PAYLOAD (racun antrean jangan muter selamanya).
//  4. Modul tak mengimpor runtime native/printer (hanya `import type`);
//     printFn disuntik pemanggil (resolveDrainTarget print.ts).
//  5. fillPrintPath ganti dua placeholder {id} + {jobId}.
//  6. UI wiring: PrintersScreen memicu poller via tombol manual
//     (klaim ulang terminalCode ke id BE, kirim via printBytes, lapor statusMsg).
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

  const serverRaw = readRaw('config/server.ts');
  const pb = read('lib/printBridge.ts');
  const pbRaw = readRaw('lib/printBridge.ts');

  // 1. Path kontrak (mentahan — jebakan strip() s.d. `*/` berikutnya).
  ok(/terminalPrintEnqueue:\s*'api\/v1\/terminals\/\{id\}\/print-jobs'/.test(serverRaw),
    'PB: ApiPath.terminalPrintEnqueue = rute BE enqueue (prefix api/ = bearer)');
  ok(/terminalPrintClaim:\s*'api\/v1\/terminals\/\{id\}\/print-jobs\/claim'/.test(serverRaw),
    'PB: ApiPath.terminalPrintClaim = rute BE claim');
  ok(/terminalPrintAck:\s*'api\/v1\/terminals\/\{id\}\/print-jobs\/\{jobId\}\/ack'/.test(serverRaw),
    'PB: ApiPath.terminalPrintAck = rute BE ack (dua placeholder)');
  ok(!/:\s*'api\/merchant\/print-bridge\/terminal-jobs'/.test(serverRaw),
    'PB: tanpa ApiPath merchant (jalur kasir = terminal-auth, bukan rute kasir-403)');

  // 2. Urutan siklus + server-wins.
  ok(/export async function claimTerminalPrintJob/.test(pb),
    'PB: claimTerminalPrintJob ada');
  ok(/export async function ackTerminalPrintJob/.test(pb),
    'PB: ackTerminalPrintJob ada');
  ok(/export async function pollServerPrintJobs/.test(pb),
    'PB: pollServerPrintJobs ada');
  ok(/claimTerminalPrintJob\([\s\S]{0,80}?\)[\s\S]{0,400}?printFn\(/.test(pb) ||
    (pb.indexOf('claimTerminalPrintJob(terminalIdBe)') >= 0 && pb.indexOf('await printFn(target, bytes)') >= 0),
    'PB: siklus claim → printFn (klaim dulu, baru kirim byte)');
  ok(/await ackTerminalPrintJob\([\s\S]{0,120}?true\)/.test(pb),
    'PB: kirim ok → ack PRINTED');
  ok(/ackTerminalPrintJob\([\s\S]{0,160}?false/.test(pb),
    'PB: kirim gagal → ack FAILED');

  // 3. Fail-safe: idle + racun antrean + tanpa throw.
  ok(/fromDummy/.test(pb) && /state:\s*'empty'/.test(pb),
    'PB: 204/offline/dummy → idle empty (tanpa cetak saat ragu)');
  ok(/INVALID_PAYLOAD/.test(pb),
    'PB: payload rusak → ack FAILED INVALID_PAYLOAD (bukan retry buta)');
  ok(!/enqueuePrint\(|drainPrintQueue\(/.test(pb),
    'PB: TANPA fallback antrean lokal (SQLite tak kenal id job server)');
  const pollBody = pb.slice(pb.indexOf('export async function pollServerPrintJobs'));
  ok(/catch\s*\{/.test(pollBody) && /printFn threw|send-failed/.test(pollBody),
    'PB: pengecualian printFn ditangkap → FAILED (tak pernah throw)');
  ok(/409|lease/i.test(pollBody) || /leaseToken/.test(pollBody),
    'PB: lease diteruskan ke ack (server tolak basi via 409)');

  // 4. Tanpa runtime native/printer.
  ok(/import type\s*\{[^}]*\}\s*from '\.\.\/native\/printer'/.test(pbRaw),
    'PB: PrinterTarget/PrintResult hanya import type (terhapus saat kompil)');
  ok(!/^import\s*\{[^}]*\}\s*from '\.\.\/native\/printer'/m.test(pbRaw) &&
    !/require\(['"]\.\.\/native\/printer['"]\)/.test(pbRaw),
    'PB: TANPA impor nilai native/printer (poll semua runtime, diuji tanpa RN)');

  // 5. fillPrintPath ganti dua placeholder.
  ok(/export function fillPrintPath/.test(pb) && /\{jobId\}/.test(pb),
    'PB: fillPrintPath isi {id} + {jobId} (ack butuh dua)');

  // 6. UI wiring: PrintersScreen memicu poller (tanpa tombol = modul mati di HP).
  //    Mentahan (readRaw) agar strip tak menelan bukti.
  const screen = readRaw('screens/settings/PrintersScreen.tsx');
  const i18n = readRaw('lib/i18n.ts');
  ok(/from '\.\.\/\.\.\/lib\/printBridge'/.test(screen) && /pollServerPrintJobs/.test(screen),
    'PB-UI: PrintersScreen mengimpor pollServerPrintJobs (poller ada pemicu)');
  ok(/fetchBranchTerminals/.test(screen),
    'PB-UI: terminalCode klaim dipetakan ke id BE via fetchBranchTerminals');
  ok(screen.indexOf('pollServerPrintJobs(') >= 0 && screen.indexOf('printBytes(') >= 0,
    'PB-UI: poller dipanggil dengan printBytes (byte server ke printer nyata)');
  ok(/printers\.serverPull/.test(screen),
    'PB-UI: tombol tarik antrean memakai kunci i18n printers.serverPull');
  ok(/printers\.serverPull/.test(i18n) && /printers\.serverPulling/.test(i18n) &&
    /printers\.serverPrinted/.test(i18n) && /printers\.serverFailed/.test(i18n) &&
    /printers\.serverEmpty/.test(i18n) && /printers\.serverError/.test(i18n) &&
    /printers\.serverNeedClaim/.test(i18n),
    'PB-UI: tujuh kunci printers.server ada di i18n');

  // 7. KONTRAK FINAL AUTO (payload kosong dirender dari order server —
  //    jangan cetak buta, jangan ack palsu; pola server-wins F-008).
  ok(/export function isAutoPrintJob/.test(pb),
    'PB-AUTO: isAutoPrintJob ada (deteksi job AUTO)');
  ok(/String\(job\.source[^)]*\)[\s\S]{0,80}?toUpperCase\(\)[\s\S]{0,40}?===?\s*'AUTO'/.test(pb),
    'PB-AUTO: source=AUTO (case-insensitive) = AUTO');
  ok(/!String\(job\.payload[\s\S]{0,60}?trim\(\)/.test(pb) && /metadata\?\.orderId/.test(pb),
    'PB-AUTO: payload kosong + metadata.orderId ikut AUTO (byte kosong tak keluar kertas)');
  ok(/export async function printAutoServerJob/.test(pb),
    'PB-AUTO: printAutoServerJob ada (render dari order server)');
  ok(/fetchMerchantOrderDetail/.test(pb),
    'PB-AUTO: sumber utama = detail penuh order server (fetchMerchantOrderDetail, server-wins)');
  ok(/AUTO_NO_ORDER/.test(pb),
    'PB-AUTO: AUTO tanpa orderId → FAILED AUTO_NO_ORDER (jujur, bukan PRINTED palsu)');
  ok(/state:\s*'unavailable'/.test(pb) && /ORDER_UNAVAILABLE/.test(pb),
    'PB-AUTO: order tak tersedia (offline/not-found) → unavailable → ack FAILED ORDER_UNAVAILABLE');
  ok(/isAutoPrintJob\(job\)/.test(pollBody),
    'PB-AUTO: poll cabang AUTO sebelum kirim byte (klaim → render/ack, bukan cetak buta)');
  ok(pollBody.indexOf('isAutoPrintJob(job)') < pollBody.indexOf('await printFn(target, bytes)'),
    'PB-AUTO: cabang AUTO mendahului printFn (byte kosong tak pernah ke printer)');
  ok(/bytes\.length\s*===\s*0[\s\S]{0,300}?INVALID_PAYLOAD/.test(pollBody),
    'PB-AUTO: byte kosong non-AUTO → ack FAILED INVALID_PAYLOAD tanpa printFn (anti cetak-buta)');
  ok(/printDetailReceipt|printDetailKitchenTicket/.test(pb),
    'PB-AUTO: render customer vs kitchen dari detail server (templateType-aware)');
  ok(/templateType/.test(pb) && /kitchen/.test(pb),
    'PB-AUTO: templateType kitchen/customer dihomati (tiket dapur tak ke kasir)');
  // UI manual path: kontrak yang sama (bukan hanya poller).
  ok(/isAutoPrintJob\(job\)/.test(screen) && /printAutoServerJob\(job\)/.test(screen),
    'PB-AUTO-UI: PrintersScreen render AUTO via printAutoServerJob (bukan byte kosong)');
  ok(/ORDER_UNAVAILABLE/.test(screen),
    'PB-AUTO-UI: PrintersScreen ack FAILED ORDER_UNAVAILABLE saat order tak tersedia');
  ok(/bytes\.length\s*===\s*0[\s\S]{0,300}?INVALID_PAYLOAD/.test(screen),
    'PB-AUTO-UI: PrintersScreen tak siarkan byte kosong (INVALID_PAYLOAD, bukan PRINTED palsu)');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
