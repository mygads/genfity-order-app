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

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL:\n- ${r.failures.join('\n- ')}` : `PASS (${r.checks} checks)`);
  process.exit(r.failures.length ? 1 : 0);
}
