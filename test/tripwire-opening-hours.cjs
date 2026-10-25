// Tripwire SESI-R5-APP: jam operasional order ONLINE → banner kasir TANPA blokir.
// Putusan owner Q1: jam = buka-tutup order ONLINE customer; kasir fleksibel.
// Kunci RUNTIME (tanpa RN — parser murni, diuji dari sumber asli) + STATIK:
//   OH-01: dalam-jam → false (banner tak tampil).
//   OH-02: luar-jam → true (banner tampil).
//   OH-03: isClosed → true; tepat-buka = dalam, tepat-tutup = luar.
//   OH-04: [] / null / garbage → false (absen = tak ada banner, jujur).
//   OH-05: overnight close<=open (22:00–02:00) = rentang lewat tengah malam
//           ( midnight-cross DIPUTUS: di dalam bila now>=open ATAU now<close).
//   OH-06: parse toleran flat+nested+snake_case; entry rusak dibuang per-entry.
//   OH-07: teks banner id+en di kamus i18n (id+en, non-empty, distinct).
//   OH-08: wiring terminalApi (field+parse) + banner CashierScreen kondisional.
//   OH-09: NOL gate — banner info-only: tanpa CTA/blokir; posConfigSync TAK
//           disentuh (kontrak misi: BACA SAJA); settle/create tak tersentuh.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function loadRuntime() {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  const src = readRaw('lib/openingHours.ts');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', out.outputText)(mod, mod.exports);
  return mod.exports;
}

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => { checks++; if (!cond) failures.push(name); };
  const eq = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { return false; } };

  const rt = loadRuntime();
  ok(typeof rt.parseOpeningHours === 'function' && typeof rt.isOutsideOnlineHours === 'function',
    'OH-00: parseOpeningHours + isOutsideOnlineHours diekspor (murni)');
  ok(eq(rt.OPENING_HOURS_DEFAULT, []), 'OH-00: default = [] (banner tidak tampil)');

  // 2026-10-25 = Minggu (dayOfWeek 0). WIB = UTC+7 (tanpa DST, deterministik).
  const SUN = [{ dayOfWeek: 0, openTime: '08:00', closeTime: '17:00', isClosed: false }];
  const at = (iso) => new Date(iso);

  // ---- OH-01/02: dalam vs luar jam (tz eksplisit, TZ-independen) ----
  ok(rt.isOutsideOnlineHours(at('2026-10-25T03:00:00Z'), SUN, 'Asia/Jakarta') === false,
    'OH-01: Minggu 10:00 WIB di dalam jam 08–17 → false');
  ok(rt.isOutsideOnlineHours(at('2026-10-25T14:00:00Z'), SUN, 'Asia/Jakarta') === true,
    'OH-02: Minggu 21:00 WIB di luar jam 08–17 → true');
  // ---- OH-03: isClosed + batas tepat ----
  ok(rt.isOutsideOnlineHours(at('2026-10-25T03:00:00Z'),
    [{ dayOfWeek: 0, openTime: '08:00', closeTime: '17:00', isClosed: true }], 'Asia/Jakarta') === true,
    'OH-03: isClosed → true walau di rentang buka');
  ok(rt.isOutsideOnlineHours(at('2026-10-25T01:00:00Z'), SUN, 'Asia/Jakarta') === false,
    'OH-03: tepat 08:00 WIB (open) = di dalam → false');
  ok(rt.isOutsideOnlineHours(at('2026-10-25T10:00:00Z'), SUN, 'Asia/Jakarta') === true,
    'OH-03: tepat 17:00 WIB (close) = di luar → true');
  // Hari tak terdaftar di tabel berisi → tutup (konvensi tabel jam).
  ok(rt.isOutsideOnlineHours(at('2026-10-25T03:00:00Z'), SUN, 'UTC') === true,
    'OH-03: 03:00 UTC Minggu = sebelum buka → true');
  ok(rt.isOutsideOnlineHours(at('2026-10-26T03:00:00Z'), SUN, 'Asia/Jakarta') === true,
    'OH-03: Senin (tanpa entry, tabel ada) = tutup → true');

  // ---- OH-04: absen = tak ada banner ----
  for (const [label, v] of [['[]', []], ['null', null], ['undefined', undefined], ['string', 'acak'], ['obj', {}]]) {
    let got;
    try { got = rt.isOutsideOnlineHours(at('2026-10-25T14:00:00Z'), v, 'Asia/Jakarta'); }
    catch { got = 'THROW'; }
    ok(got === false, `OH-04: hours (${label}) → false (tak ada data = tak ada banner)`);
  }
  ok(eq(rt.parseOpeningHours(null), []) && eq(rt.parseOpeningHours('acak'), []) && eq(rt.parseOpeningHours({}), []),
    'OH-04: parse garbage → []');

  // ---- OH-05: overnight 22:00–02:00 (midnight-cross diputus, terdokumentasi) ----
  const NIGHT = [
    { dayOfWeek: 0, openTime: '22:00', closeTime: '02:00', isClosed: false },
    { dayOfWeek: 1, openTime: '22:00', closeTime: '02:00', isClosed: false },
  ];
  ok(rt.isOutsideOnlineHours(at('2026-10-25T16:00:00Z'), NIGHT, 'Asia/Jakarta') === false,
    'OH-05: Minggu 23:00 WIB (rentang 22–02) = di dalam → false');
  ok(rt.isOutsideOnlineHours(at('2026-10-25T18:00:00Z'), NIGHT, 'Asia/Jakarta') === false,
    'OH-05: Senin 01:00 WIB (rentang 22–02) = di dalam → false');
  ok(rt.isOutsideOnlineHours(at('2026-10-25T20:00:00Z'), NIGHT, 'Asia/Jakarta') === true,
    'OH-05: Senin 03:00 WIB (rentang 22–02) = di luar → true');
  ok(rt.isOutsideOnlineHours(at('2026-10-25T14:00:00Z'), NIGHT, 'Asia/Jakarta') === true,
    'OH-05: Minggu 21:00 WIB (rentang 22–02) = di luar → true');

  // ---- OH-06: parse toleran ----
  ok(eq(rt.parseOpeningHours({ openingHours: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false }] }),
    [{ dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false }]),
    'OH-06: flat openingHours terbaca');
  ok(eq(rt.parseOpeningHours({ pos: { openingHours: [{ day_of_week: '2', open_time: '10:00', close_time: '20:00' }] } }),
    [{ dayOfWeek: 2, openTime: '10:00', closeTime: '20:00', isClosed: false }]),
    'OH-06: nested pos.openingHours + snake_case + string day terbaca');
  ok(eq(rt.parseOpeningHours({ opening_hours: [{ dayOfWeek: 3, openTime: null, closeTime: null }] }),
    [{ dayOfWeek: 3, openTime: null, closeTime: null, isClosed: false }]),
    'OH-06: snake opening_hours + null times terbaca (buka seharian)');
  const mixed = rt.parseOpeningHours({ openingHours: [
    { dayOfWeek: 4, openTime: '08:00', closeTime: '17:00' },
    { dayOfWeek: 7, openTime: '08:00', closeTime: '17:00' },
    { dayOfWeek: 'x', openTime: '08:00', closeTime: '17:00' },
    { dayOfWeek: 5, openTime: '25:00', closeTime: '17:00' },
    'rusak',
    null,
  ]});
  ok(eq(mixed, [
    { dayOfWeek: 4, openTime: '08:00', closeTime: '17:00', isClosed: false },
    { dayOfWeek: 5, openTime: null, closeTime: '17:00', isClosed: false },
  ]), 'OH-06: entry rusak dibuang per-entry (day 7/string, non-obj); jam invalid → null');
  ok(eq(rt.parseOpeningHours({ openingHours: [
    { dayOfWeek: 6, openTime: '08:00', closeTime: '12:00' },
    { dayOfWeek: 6, openTime: '13:00', closeTime: '17:00' },
  ] }), [{ dayOfWeek: 6, openTime: '08:00', closeTime: '12:00', isClosed: false }]),
    'OH-06: duplikat hari → entry pertama menang (deterministik)');
  // tz eksplisit vs lokal: instant sama, zona beda → hasil beda (tz dipakai).
  ok(rt.isOutsideOnlineHours(at('2026-10-25T02:00:00Z'), SUN, 'Asia/Jakarta') === false
    && rt.isOutsideOnlineHours(at('2026-10-25T02:00:00Z'), SUN, 'UTC') === true,
    'OH-06: 02:00Z = 09:00 WIB dalam vs 02:00 UTC luar (tz dihormati)');
  // lokal-tanpa-tz: kalender 25-Okt-2026 = Minggu di zona mana pun.
  ok(rt.isOutsideOnlineHours(new Date(2026, 9, 25, 10, 0, 0), SUN) === false
    && rt.isOutsideOnlineHours(new Date(2026, 9, 25, 20, 0, 0), SUN) === true,
    'OH-06: tanpa tz pakai waktu lokal perangkat (10:00 dalam, 20:00 luar)');
  ok(rt.isOutsideOnlineHours('bukan-tanggal', SUN, 'Asia/Jakarta') === false,
    'OH-06: now asing → false (tak pernah melempar)');

  // ---- OH-07: teks banner id+en ----
  const i18nRaw = readRaw('lib/i18n.ts');
  const m = i18nRaw.match(/hours_outside_banner:\s*\{\s*id:\s*'([^']*)',\s*en:\s*'([^']*)'\s*\}/);
  ok(!!m && m[1].length > 0 && m[2].length > 0 && m[1] !== m[2],
    'OH-07: kunci hours_outside_banner ada, id+en non-empty + distinct');
  ok(!!m && /kasir/i.test(m[1]) && /counter/i.test(m[2]),
    'OH-07: teks menyebut kasir/counter tetap melayani (info, bukan blokir)');

  // ---- OH-08: wiring ----
  const term = read('lib/terminalApi.ts');
  const termRaw = readRaw('lib/terminalApi.ts');
  ok(/from ['"]\.\/openingHours['"]/.test(termRaw), 'OH-08: terminalApi impor parser murni openingHours');
  ok(/openingHours: OpeningHour\[\]/.test(term), 'OH-08: TerminalPosConfig membawa openingHours');
  ok(/openingHours: parseOpeningHours\(data\)/.test(term), 'OH-08: fetchTerminalPosConfig parse snapshot (BE lama = [])');
  const cash = read('screens/cashier/CashierScreen.tsx');
  const cashRaw = readRaw('screens/cashier/CashierScreen.tsx');
  const mounts = (cashRaw.match(/\{renderHoursBanner\(\)\}/g) || []).length;
  ok(/const renderHoursBanner/.test(cash) && mounts === 2,
    `OH-08: renderHoursBanner didefinisikan + dipasang 2 titik (wide+phone), ketemu ${mounts}`);
  ok(/onlineHours\.length > 0 && isOutsideOnlineHours/.test(cash),
    'OH-08: banner kondisional (non-empty && outside; kosong/absen = tak render)');
  ok(/t\(['"]hours_outside_banner['"]\)/.test(cash), 'OH-08: banner pakai teks i18n hours_outside_banner');
  ok(/getBoundSupervisorTerminalId/.test(cash) && /fetchTerminalPosConfig/.test(cash),
    'OH-08: banner baca snapshot via fetchTerminalPosConfig + id kanonis supervisor');

  // ---- OH-09: NOL gate ----
  ok(!/openingHours|OpeningHour|isOutsideOnlineHours/.test(read('lib/posConfigSync.ts')),
    'OH-09: posConfigSync TAK disentuh (BACA SAJA — nol referensi openingHours)');
  const bannerFn = (cashRaw.match(/const renderHoursBanner[\s\S]*?: null;/) || [''])[0];
  ok(!/AppButton|navigate|settle|createOrder|blocked/.test(bannerFn),
    'OH-09: banner info-only (tanpa CTA/navigate/settle/blocked di render-nya)');
  const setters = (cashRaw.match(/setOnlineHours/g) || []).length;
  ok(setters === 2, `OH-09: setOnlineHours hanya di state + callback fetch (${setters}x; tak dibaca alur settle/create)`);
  const users = [];
  for (const f of fs.readdirSync(path.join(SRC, 'screens')).flatMap((d) => {
    const p = path.join(SRC, 'screens', d);
    try { return fs.readdirSync(p).filter((x) => x.endsWith('.tsx')).map((x) => `screens/${d}/${x}`); }
    catch { return []; }
  })) {
    try { if (/isOutsideOnlineHours/.test(readRaw(f))) users.push(f); } catch { /* abaikan */ }
  }
  ok(users.length === 1 && users[0] === 'screens/cashier/CashierScreen.tsx',
    `OH-09: selector hanya dipakai 1 mount kasir (${users.join(',') || 'tak ada'})`);

  return { failures, checks };
}

module.exports = { run };
