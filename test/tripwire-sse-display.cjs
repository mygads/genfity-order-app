// Tripwire SSE/display (S8/PW-3): jaga invarian transport yang tak boleh
// regresi tanpa ketahuan CI — dicek statik dari sumber (tanpa runtime RN):
//  1. Path kontrak E26/E27 + ?token= (auth SSE tanpa header).
//  2. Mapper E26 (call/ready/queue/client_id) + konsumen E27.
//  3. Mesin klien SSE: parse blok, Last-Event-ID, dedupe, backoff.
//  4. callNext LOKAL-ONLY (tanpa POST — server-ack butuh endpoint BE, owner).
//  5. WS SEKUNDER: hanya start bila SSE primer tak live (verdict PP-004).
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
  const sse = read('lib/sse.ts');
  const disp = read('lib/display.ts');
  const custRaw = readRaw('screens/display/CustomerDisplayScreen.tsx');
  const queueRaw = readRaw('screens/display/QueueViewScreen.tsx');

  // 1. Path kontrak E26/E27 paritas BE router (…/queue-events, …/events).
  ok(/terminalEvents:\s*'api\/v1\/terminals\/\{id\}\/events'/.test(serverRaw),
    'server: ApiPath.terminalEvents = E26 paritas BE');
  ok(/queueEvents:\s*'api\/v1\/branches\/\{id\}\/queue-events'/.test(serverRaw),
    'server: ApiPath.queueEvents = E27 paritas BE');
  // 2. Auth SSE via ?token= (EventSource tak bisa set header Authorization).
  ok(/withQueryToken/.test(sse) && /token=/.test(sse),
    'sse: kredensial sesi disisipkan sebagai ?token=');
  ok(/export function subscribeTerminalEvents/.test(sse) && /export function subscribeQueueEvents/.test(sse),
    'sse: subscribe E26 per-terminal + E27 per-branch diekspor');
  // 3. Konsumen: bus display ← E26, QueueView ← E27.
  ok(/subscribeTerminalEvents/.test(disp),
    'display: bus konsumsi feed E26 primer');
  ok(/subscribeQueueEvents/.test(queueRaw),
    'queueview: layar antrean konsumsi feed E27 primer');
  // 4. Mapper E26: lengan call/ready/queue + client_id snake+camel BE.
  ok(/call/.test(disp) && /ready/.test(disp) && /queue/.test(disp) && /client_id/.test(disp) && /clientId/.test(disp),
    'display: mapper E26 tangani call/ready/queue + client_id/clientId');
  ok(/preparing/.test(queueRaw) && /queue-update/.test(queueRaw) && /version/.test(queueRaw),
    'queueview: snapshot preparing/ready + sekuens version E27');
  // 5. Mesin klien: parse blok SSE, Last-Event-ID, dedupe id, backoff retry.
  ok(/parseSseBlock/.test(sse) && /Last-Event-ID/.test(sse) && /seen/.test(sse) && /backoffMs/.test(sse),
    'sse: parse + resume Last-Event-ID + dedupe + backoff ada');
  // 6. callNext LOKAL-ONLY: siaran bus tanpa POST (server-ack = owner BE).
  ok(/publishDisplay\(\{\s*type:\s*'call'/.test(custRaw) && !/apiFetch/.test(custRaw) && !/ApiPath/.test(custRaw),
    'display: callNext lokal-only tanpa POST (tanpa invent kontrak BE)');
  // 7. WS SEKUNDER (verdict PP-004): start hanya bila SSE primer tak live.
  ok(/if \(sseOk && isBackendConfigured/.test(custRaw),
    'display: WS sekunder digerbang SSE-live (bukan primer)');

  return { checks, failures };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(`checks: ${r.checks}, failures: ${r.failures.length}`);
  for (const f of r.failures) console.log('FAIL ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
