/**
 * Seed lokal sekali-jalan untuk fondasi offline (tanpa server).
 *
 * ensureSeeded(): initDb dulu, cek flag ms_setting(key1='seed',
 * key2='local', value1) — bila sudah '1' langsung return. Bila belum,
 * isi master minimal + user admin lokal (PIN 1234 via savePinHash),
 * lalu set flag seed=1. Idempoten dan aman jalan ulang: semua INSERT OR
 * IGNORE, plus blok sapu-dummy di awal (ID eksak untuk ID dummy murni;
 * bersidik-jari ID + nama-fixture untuk ID generik yang dipakai ulang
 * seed seperti V001/V002, agar edit merchant via CRUD tak pernah ditimpa).
 *
 * Data uji offline-first (cabang/resto, admin+kasir, member, voucher/promo,
 * shift terbuka, 4 order contoh via saveSale/direct-insert - 1 dimundurkan
 * ke kemarin agar
 * History/Dashboard/Rekap ada baseline) disisip TANPA gate flag — sama
 * seperti CoA/RBAC/admin — agar DB lama ikut dapat; idempoten via
 * INSERT OR IGNORE + cek keberadaan.
 *
 * API: seedIfEmpty() = pengisian + lapor {seeded}; ensureSeeded() = titik
 * wiring startup (App.tsx, setelah initDb sebelum guard), tak melempar.
 *
 * Pengecualian: 6 CoA expense di ms_coa disisip TANPA gate flag (jalan
 * tiap panggil) agar DB lama yang sudah flag seed=1 tetap dapat CoA.
 *
 * Nama kolom diambil verbatim dari SCHEMA di lib/db.ts (ms_posuser tidak
 * punya kolom nama/flagActive; ms_setting memakai value1/value2).
 */
import { initDb, query, queryFirst, run } from './db';
import type { BindParams } from './db';
import { loadPinRecord, removePinHash, savePinHash } from './pin';
import { assertVoucherUsable, isTerminalBound, queueNoOf, saveSale } from './sales';
import type { SaleInput } from './payments';
import { normalizeMethod } from './payments';
import { isMarketplaceMode, totals, FEE_DEFAULTS } from './totals';
import type { TotalsResult } from './totals';
import { setCachedCurrency } from './currency';
import { setCachedTimezone } from './timezone';
import { uuidv7 } from './uuidv7';
import { trimTestUsers } from './seedUsers';

// S2-C311: gate kesiapan seed — App.tsx menjalankan seedIfEmpty fire-and-forget
// sehingga login bisa jalan sebelum ms_posuser ter-seed. Pelacakan modul ini
// menandai 'upaya seed selesai' (berhasil maupun gagal) agar pemanggil bisa
// menunggu tanpa menggantung selamanya (fail-open ke jalur error normal).
let seedDone = false;
const seedWaiters: Array<() => void> = [];

export function isSeedReady(): boolean {
  return seedDone;
}

export function whenSeedReady(timeoutMs = 8000): Promise<boolean> {
  if (seedDone) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(seedDone);
      }
    }, Math.max(0, timeoutMs));
    const fn = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(true);
      }
    };
    seedWaiters.push(fn);
  });
}

function markSeedDone(): void {
  if (seedDone) return;
  seedDone = true;
  const w = seedWaiters.splice(0);
  for (const fn of w) {
    try {
      fn();
    } catch {
      /* abaikan */
    }
  }
}

const SEED_MENUS: Array<{ id: string; name: string; cat: string; price: number }> = [
  { id: 'm-nasi-goreng', name: 'Nasi Goreng', cat: 'c-makanan', price: 15000 },
  { id: 'm-ayam-geprek', name: 'Ayam Geprek', cat: 'c-makanan', price: 12000 },
  { id: 'm-mie-goreng', name: 'Mie Goreng', cat: 'c-makanan', price: 13000 },
  { id: 'm-ayam-bakar', name: 'Ayam Bakar', cat: 'c-makanan', price: 18000 },
  { id: 'm-lele-goreng', name: 'Lele Goreng', cat: 'c-makanan', price: 10000 },
  { id: 'm-es-teh-manis', name: 'Es Teh Manis', cat: 'c-minuman', price: 5000 },
  { id: 'm-kopi-tubruk', name: 'Kopi Tubruk', cat: 'c-minuman', price: 8000 },
  { id: 'm-jus-alpukat', name: 'Jus Alpukat', cat: 'c-minuman', price: 12000 },
  { id: 'm-soda-gembira', name: 'Soda Gembira', cat: 'c-minuman', price: 10000 },
  { id: 'm-air-mineral', name: 'Air Mineral', cat: 'c-minuman', price: 3000 },
  { id: 'm-pisang-goreng', name: 'Pisang Goreng', cat: 'c-snack', price: 10000 },
  { id: 'm-tahu-crispy', name: 'Tahu Crispy', cat: 'c-snack', price: 8000 },
];

const SEED_TABLES = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

const SEED_PAYMENTS: Array<{ id: string; name: string; type: string; order: number }> = [
  { id: 'pm-tunai', name: 'Tunai', type: 'cash', order: 1 },
  { id: 'pm-qris', name: 'QRIS', type: 'qris', order: 2 },
  { id: 'pm-transfer', name: 'Transfer Bank', type: 'transfer', order: 3 },
  { id: 'pm-edc', name: 'EDC', type: 'edc', order: 4 },
];

/** Spesifikasi order contoh — angka final SELALU dihitung via totals() (L25). */
interface SeedOrderSpec {
  salesNum: string;
  method: string;
  mode: string;
  tableId?: string;
  memberId?: string;
  customer?: string;
  voucherCode?: string;
  voucherKind?: string;
  voucherAmount?: number;
  voucherMinSpend?: number;
  ongkir?: number;
  cash?: number;
  items: Array<{ id: string; name: string; basePrice: number; qty: number }>;
  /** Tarif pajak eksplisit per order (default 11 PPN; order AUD = 10 GST). */
  taxRate?: number;
  /** Cabang pemilik order (default 'B001'; order AUD = 'B004'). */
  branchId?: string;
}

const SEED_SPECS: SeedOrderSpec[] = [
  {
    salesNum: 'SEED-001', method: 'cash', mode: 'DINE IN', tableId: 'A1',
    memberId: 'M001', customer: 'Budi', cash: 40000,
    items: [
      { id: 'm-nasi-goreng', name: 'Nasi Goreng', basePrice: 15000, qty: 2 },
      { id: 'm-es-teh-manis', name: 'Es Teh Manis', basePrice: 5000, qty: 1 },
    ],
  },
  {
    salesNum: 'SEED-002', method: 'qris', mode: 'TAKE AWAY', customer: 'Sinta',
    voucherCode: 'HEMAT10K', voucherAmount: 10000,
    items: [
      { id: 'm-ayam-bakar', name: 'Ayam Bakar', basePrice: 18000, qty: 1 },
      { id: 'm-kopi-tubruk', name: 'Kopi Tubruk', basePrice: 8000, qty: 1 },
    ],
  },
  // SEED-003: promo nominal reusable (HEMAT10 hanya ada di ms_promotion,
  // minSpend 50000) — membuktikan jalur fallback promo di backstop saveSale:
  // usage 'burn' tercatat, kuota tak tersentuh (promo tanpa kuota).
  {
    salesNum: 'SEED-003', method: 'qris', mode: 'TAKE AWAY', customer: 'Dewi',
    voucherCode: 'HEMAT10', voucherAmount: 10000, voucherMinSpend: 50000,
    items: [
      { id: 'm-ayam-bakar', name: 'Ayam Bakar', basePrice: 18000, qty: 2 },
      { id: 'm-nasi-goreng', name: 'Nasi Goreng', basePrice: 15000, qty: 1 },
    ],
  },
  // SEED-004: promo ongkir (ONGKIR10 hanya di ms_promotion) — ongkir bruto
  // 8000 dipotong penuh (ongkirCut 8000), neto tersimpan 0.
  {
    salesNum: 'SEED-004', method: 'cash', mode: 'GOFOOD', customer: 'Agus',
    voucherCode: 'ONGKIR10', voucherKind: 'ongkir', voucherAmount: 10000,
    ongkir: 8000, cash: 25000,
    items: [
      { id: 'm-kopi-tubruk', name: 'Kopi Tubruk', basePrice: 8000, qty: 2 },
      { id: 'm-es-teh-manis', name: 'Es Teh Manis', basePrice: 5000, qty: 1 },
    ],
  },
];

function seedCanon(spec: SeedOrderSpec): TotalsResult {
  const gross = spec.items.reduce((a, it) => a + it.basePrice * it.qty, 0);
  return totals({
    gross,
    discount: 0,
    voucher: spec.voucherCode
      ? {
          code: spec.voucherCode,
          ...(spec.voucherKind ? { kind: spec.voucherKind } : {}),
          ...(spec.voucherAmount ? { amount: spec.voucherAmount } : {}),
          ...(spec.voucherMinSpend ? { minSpend: spec.voucherMinSpend } : {}),
        }
      : null,
    ongkir: spec.ongkir ?? 0,
    esbOrder: isMarketplaceMode(spec.mode),
    taxRate: spec.taxRate ?? 11,
    // Cabang AUD (B004) = langkah sen (1); selain itu rupiah (100).
    roundStep: spec.branchId === AUD_TEST_BRANCH_ID ? 1 : FEE_DEFAULTS.roundStep,
  });
}

/** SaleInput saveSale untuk jalur bound (angka = hasil totals() kanonis). */
function seedSaleInput(spec: SeedOrderSpec, canon: TotalsResult): SaleInput {
  return {
    method: spec.method,
    salesNum: spec.salesNum,
    grandTotal: canon.total,
    subtotal: canon.subtotalGross,
    // Representasi L8: discount head INCLUDES voucher.
    discountTotal: canon.voucherAmt,
    vatTotal: canon.taxIncl,
    serviceTotal: canon.service,
    ...(canon.feeESB > 0 ? { feeESB: canon.feeESB } : {}),
    ...(canon.rounding !== 0 ? { rounding: canon.rounding } : {}),
    ...(spec.cash !== undefined ? { cash: spec.cash, change: Math.max(0, spec.cash - canon.total) } : { change: 0 }),
    mode: spec.mode,
    ...(spec.tableId ? { tableId: spec.tableId } : {}),
    ...(spec.memberId ? { memberId: spec.memberId } : {}),
    ...(spec.customer ? { customer: spec.customer } : {}),
    items: spec.items.map((it) => ({ id: it.id, name: it.name, basePrice: it.basePrice, qty: it.qty })),
    payments: [{ method: spec.method, amount: canon.total }],
    ...(spec.voucherCode ? { voucherCode: spec.voucherCode } : {}),
    ...(canon.ongkirNet > 0 ? { ongkir: canon.ongkirNet } : {}),
    ...(canon.ongkirCut > 0 ? { ongkirCut: canon.ongkirCut } : {}),
  };
}

/**
 * Sisip baris order contoh LANGSUNG (L9): dipakai saat device unbound
 * (saveSale melempar terminal-unbound — fail-closed) sehingga order contoh
 * tetap lahir di instalasi segar. Cermin tulisan saveSale (head + item +
 * payment + usage/kuota via backstop yang sama + tiket dapur + info ongkirCut
 * + platformFee) dengan syncDate NULL (= kotor, ikut push). Idempoten via
 * cek keberadaan di pemanggil. Tak melempar yang fatal: galat dicatat jujur
 * via console.warn agar terlihat di log startup.
 */
async function seedSaleDirect(spec: SeedOrderSpec, canon: TotalsResult, nowSeed: string): Promise<void> {
  const r = (x: number) => Math.round(x);
  const no = spec.salesNum;
  let clientId: string;
  try {
    clientId = uuidv7();
  } catch (e) {
    // P14: tanpa CSPRNG tak ada client_id merge-safe — fallback jujur ke
    // salesNum (bukan Math.random) + catat, agar seed tak menggugurkan Q7 diam-diam.
    console.warn(`[seed] CSPRNG gagal untuk ${no}, client_id = salesNum: ${e instanceof Error ? e.message : e}`);
    clientId = no;
  }
  const gross = canon.subtotalGross;
  let voucherOk = false;
  let burnAmount = 0;
  if (spec.voucherCode) {
    const chk = await assertVoucherUsable(spec.voucherCode, gross);
    voucherOk = chk.ok;
    burnAmount = chk.ok ? chk.amount : 0;
  }
  const voucherAmt = voucherOk
    ? (spec.voucherKind === 'ongkir' ? 0 : Math.min(canon.voucherAmt, gross))
    : 0;
  const paid = canon.total;
  const tendered = spec.cash ?? paid;
  await run(
    `INSERT INTO tr_saleshead (salesNum, client_id, branchId, terminalId, userId, shiftId, salesDate,
      salesMode, subtotal, discount, tax, serviceCharge, platformFee, rounding,
      voucherAmount, voucherCode, grandTotal, paidAmount, changeAmount,
      paymentMethod, memberId, tableNo, customerName, ongkir,
      status, queueNumber, cashierName, createdAt, updatedAt, syncDate)
     VALUES (?, ?, ?, 'T001', 'u-kasir', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, 'kasir', ?, ?, NULL)`,
    [
      no, clientId, spec.branchId ?? 'B001', nowSeed,
      spec.mode === 'DINE IN' ? 'DINE_IN' : spec.mode === 'TAKE AWAY' ? 'TAKEAWAY' : spec.mode,
      gross, voucherAmt,
      canon.taxIncl, canon.service,
      canon.feeESB, canon.rounding,
      voucherAmt, spec.voucherCode ?? null,
      canon.total, paid,
      Math.max(0, tendered - paid), normalizeMethod(spec.method),
      spec.memberId ?? null, spec.tableId ?? null, spec.customer ?? null, canon.ongkirNet,
      queueNoOf(no) ?? no, nowSeed, nowSeed,
    ],
  );
  let idx = 0;
  for (const it of spec.items) {
    // Stasiun cermin blok stok seed (minuman → kasir, lainnya → dapur).
    const station = it.id.includes('teh') || it.id.includes('kopi') || it.id.includes('jus')
      || it.id.includes('soda') || it.id.includes('mineral') ? 'st-kasir' : 'st-dapur';
    const smId = `${no}-seed-${idx}`;
    await run(
      `INSERT INTO tr_salesmenu (id, salesNum, client_id, menuId, menuName, qty, price,
        discount, subtotal, note, stationId, status, syncDate, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, 'served', NULL, ?)`,
      [smId, no, clientId, it.id, it.name, it.qty, r(it.basePrice), r(it.basePrice * it.qty), station, nowSeed],
    );
    idx += 1;
  }
  await run(
    `INSERT INTO tr_salespayment (id, salesNum, client_id, paymentMethod, amount,
      tendered, changeAmount, refNo, syncDate, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    [`${no}-pay`, no, clientId, spec.method, paid, r(tendered), Math.max(0, r(tendered - paid)), nowSeed],
  );
  if (spec.voucherCode) {
    if (voucherOk) {
      await run(
        `INSERT INTO tr_salesvoucherusage (id, salesNum, client_id, voucherCode, voucherAmount, status, syncDate)
         VALUES (?, ?, ?, ?, ?, 'burn', NULL)`,
        [`${no}-sv`, no, clientId, spec.voucherCode, burnAmount],
      );
      await run(
        `UPDATE ms_voucher SET quota = quota - 1, syncDate = NULL
          WHERE UPPER(voucherCode) = UPPER(?) AND quota > 0`,
        [spec.voucherCode],
      );
      await run(
        `UPDATE ms_voucher SET status = 'used', syncDate = NULL
          WHERE UPPER(voucherCode) = UPPER(?) AND quota IS NOT NULL AND quota <= 0
            AND (status IS NULL OR status = 'available')`,
        [spec.voucherCode],
      );
    } else {
      await run(
        `INSERT INTO tr_salesvoucherusage (id, salesNum, client_id, voucherCode, voucherAmount, status, syncDate)
         VALUES (?, ?, ?, ?, 0, 'rejected', NULL)`,
        [`${no}-sv`, no, clientId, spec.voucherCode],
      );
    }
  }
  if (canon.ongkirCut > 0) {
    await run(
      `INSERT INTO tr_salesinfo (id, salesNum, client_id, infoKey, infoValue, syncDate)
       VALUES (?, ?, ?, 'ongkirCut', ?, NULL)`,
      [`${no}-si-ongkir`, no, clientId, String(r(canon.ongkirCut))],
    );
  }
  if (canon.feeESB > 0) {
    await run(
      `INSERT INTO tr_platformfee (id, salesNum, client_id, platform, feeAmount, syncDate)
       VALUES (?, ?, ?, 'total', ?, NULL)`,
      [`${no}-pf`, no, clientId, r(canon.feeESB)],
    );
  }
  await run(
    `INSERT OR IGNORE INTO tr_kitchenticket (id, ticketNo, salesNum, client_id, status, createdAt, updatedAt, syncDate)
     VALUES (?, ?, ?, ?, 'Baru', ?, ?, NULL)`,
    [`kt-${no}`, no, no, clientId, nowSeed, nowSeed],
  );
}

/**
 * R34 CLOSED (2026-10-17): migrasi satu-kali kolom legacy pinHash/password
 * ms_posuser → record hash SecureStore (lib/pin.ts hashPin/verifyPinHash;
 * algoritma TIDAK diubah). Dijalankan tiap startup TANPA gate flag seed
 * (DB lama yang flag seed-nya sudah '1' ikut termigrasi), idempoten via flag
 * ms_setting ('Security','PinMigrationV1') = '1'.
 *
 * Per baris dengan pinHash/password NOT NULL: simpan savePinHash(id,
 * pinHash ?? password) DULU (kolom legacy berisi PIN pembanding plaintext);
 * HANYA setelah SecureStore sukses, NULL-kan kedua kolom. Bila tulis
 * SecureStore gagal untuk suatu baris, baris itu DIPERTAHANKAN (fail-open —
 * login lama tetap jalan) dan flag TIDAK diset sehingga startup berikut
 * mencoba lagi. Kolom DB dibiarkan ada (deprecated, tak pernah dibaca lagi —
 * lihat komentar skema di lib/dbSchema.ts oleh pemiliknya).
 */
async function migrateLegacyPinColumns(): Promise<void> {
  try {
    const done = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'Security' AND key2 = 'PinMigrationV1' LIMIT 1`,
    );
    if (done?.value1 === '1') return;
    let rows: Array<{ id: string; pinHash: string | null; password: string | null }>;
    try {
      rows = await query<{ id: string; pinHash: string | null; password: string | null }>(
        `SELECT id, pinHash, password FROM ms_posuser WHERE pinHash IS NOT NULL OR password IS NOT NULL`,
      );
    } catch {
      // Tabel/kolom belum ada — coba lagi saat startup berikut.
      return;
    }
    let failed = 0;
    for (const r of rows) {
      try {
        const existing = await loadPinRecord(r.id);
        if (!existing) {
          const plain = r.pinHash ?? r.password ?? '';
          if (!plain) {
            await run(`UPDATE ms_posuser SET pinHash = NULL, password = NULL WHERE id = ?`, [r.id]);
            continue;
          }
          await savePinHash(r.id, plain);
        }
        await run(`UPDATE ms_posuser SET pinHash = NULL, password = NULL WHERE id = ?`, [r.id]);
      } catch (e) {
        failed += 1;
        console.warn(`[seed] migrasi PIN legacy ${r.id} gagal, baris dipertahankan: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (failed > 0) return;
    await run(
      `INSERT OR IGNORE INTO ms_setting (key1, key2, value1) VALUES ('Security', 'PinMigrationV1', '1')`,
    );
    await run(
      `UPDATE ms_setting SET value1 = '1' WHERE key1 = 'Security' AND key2 = 'PinMigrationV1'`,
    );
  } catch (e) {
    console.warn(`[seed] migrateLegacyPinColumns dilewati: ${e instanceof Error ? e.message : e}`);
  }
}

export async function ensureSeeded(): Promise<void> {
  await initDb();
  const nowSeed = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const todaySeed = nowSeed.slice(0, 10);

  // --- Sapu dummy (cache replay pull-dummy ber-ID pendek) ---
  // DB yang pernah dimasuki replay dummy pull tercemar dua cara: baris dummy
  // ber-ID SAMA dengan seed (M001/M002, V001/V002) membuat INSERT OR IGNORE
  // kalah, dan shift OPEN dummy S20261016P membuat cek "belum ada shift
  // terbuka" selalu menemukan shift sehingga shift seed tak pernah dibuat.
  // Sapu HANYA ID eksak di bawah — tanpa pola/wildcard — sehingga data buatan
  // user aman (terverifikasi di layar pemilik):
  //   - member buatan user = `M` + 6 digit Date.now() (MemberScreen:456),
  //     takkan sama dengan 'M003' (4 char);
  //   - menu buatan user = `m-${Date.now()}` huruf kecil (MenuManagementScreen),
  //     takkan sama dengan 'M001'..'M008' huruf besar;
  //   - meja tak punya jalur buat-buat lokal (denah hanya dari seed/pull);
  //   - shift buatan user = `shift-${Date.now()}` (ShiftScreen);
  //   - penjualan kasir nyata = `TRX-YYYYMMDD-NNN` hari berjalan
  //     (sales.ts nextSalesNum), sedangkan yang disapu hanya tiga nomor
  //     2026-10-16 eksak milik dummy.
  // Idempoten: DELETE eksak aman jalan ulang. Anak transaksi disapu by
  // salesNum eksak, detail shift by shiftId eksak, branchmenu by (B001, M00x).
  const DUMMY_MENU_IDS = ['M001', 'M002', 'M003', 'M004', 'M005', 'M006', 'M007', 'M008'];
  const DUMMY_SALES_NUMS = ['TRX-20261016-011', 'TRX-20261016-012', 'TRX-20261016-013'];
  const DUMMY_SHIFT_IDS = ['S20261016P', 'S20261015M'];
  const menuMarks = DUMMY_MENU_IDS.map(() => '?').join(', ');
  const salesMarks = DUMMY_SALES_NUMS.map(() => '?').join(', ');
  const shiftMarks = DUMMY_SHIFT_IDS.map(() => '?').join(', ');
  // Anak dulu, induk kemudian (SQLite tanpa FK, tapi rapi bila dibaca ulang).
  const sweep: Array<[string, BindParams]> = [
    [`DELETE FROM tr_salesmenuextra WHERE salesNum IN (${salesMarks})`, DUMMY_SALES_NUMS],
    [`DELETE FROM tr_salesmenu WHERE salesNum IN (${salesMarks})`, DUMMY_SALES_NUMS],
    [`DELETE FROM tr_salespayment WHERE salesNum IN (${salesMarks})`, DUMMY_SALES_NUMS],
    [`DELETE FROM tr_salesvoucherusage WHERE salesNum IN (${salesMarks})`, DUMMY_SALES_NUMS],
    [`DELETE FROM tr_salesinfo WHERE salesNum IN (${salesMarks})`, DUMMY_SALES_NUMS],
    [`DELETE FROM tr_platformfee WHERE salesNum IN (${salesMarks})`, DUMMY_SALES_NUMS],
    [`DELETE FROM tr_cancelmenu WHERE salesNum IN (${salesMarks})`, DUMMY_SALES_NUMS],
    [`DELETE FROM tr_kitchenticket WHERE salesNum IN (${salesMarks})`, DUMMY_SALES_NUMS],
    [`DELETE FROM tr_saleshead WHERE salesNum IN (${salesMarks})`, DUMMY_SALES_NUMS],
    [`DELETE FROM tr_shiftlogdetail WHERE shiftId IN (${shiftMarks})`, DUMMY_SHIFT_IDS],
    [`DELETE FROM tr_shiftlog WHERE id IN (${shiftMarks})`, DUMMY_SHIFT_IDS],
    [`DELETE FROM ms_branchmenu WHERE branchId = 'B001' AND menuId IN (${menuMarks})`, DUMMY_MENU_IDS],
    [`DELETE FROM ms_menu WHERE id IN (${menuMarks})`, DUMMY_MENU_IDS],
    ['DELETE FROM ms_table WHERE id IN (?, ?, ?, ?)', ['T-A01', 'T-A05', 'T-B03', 'T-C02']],
    ['DELETE FROM ms_voucher WHERE id IN (?, ?)', ['V003', 'V004']],
    ['DELETE FROM ms_member WHERE id = ?', ['M003']],
    ['DELETE FROM ms_posuser WHERE id IN (?, ?, ?)', ['U07', 'U08', 'U01']],
    // Baris akses milik user dummy ikut disapu (tanpa ini sisa yatim;
    // inert tapi mengotori ms_posuseraccess bila dihitung).
    ['DELETE FROM ms_posuseraccess WHERE userId IN (?, ?, ?)', ['U07', 'U08', 'U01']],
    // Sapu bersidik-jari (ID + nama fixture dummy): ID generik (P001, ST-*,
    // COA001-005) bisa dipakai ulang server asli suatu hari — hapus HANYA
    // bila namanya cocok fixture dummy. Paparan nyata terverifikasi via
    // pembaca: PromotionList (ms_promotion flagActive=1), ExpenseScreen
    // (ms_coa flagActive=1), PrintersScreen/station-pull (ms_station).
    // (terminalsettings v11 + menuonline SENGAJA tak disapu: kunci 'ReceiptHeader'/
    // 'AutoPrintKitchen' tak cocok KNOWN_TERMINAL_KEYS terminal.ts yang
    // case-sensitive, dan tak ada layar membaca ms_menuonline.)
    [`DELETE FROM ms_promotion WHERE id IN (?, ?, ?) AND promoName IN (?, ?, ?)`,
      ['P001', 'P002', 'P003', 'Diskon 10 persen member GOLD', 'Potongan 10000 semua payment', 'Gratis ongkir s.d. 10000']],
    [`DELETE FROM ms_station WHERE id IN (?, ?) AND stationName IN (?, ?)`,
      ['ST-KASIR', 'ST-DAPUR', 'Printer Kasir', 'Printer Dapur']],
    [`DELETE FROM ms_coa WHERE id IN (?, ?, ?, ?, ?) AND coaName IN (?, ?, ?, ?, ?)`,
      ['COA001', 'COA002', 'COA003', 'COA004', 'COA005', 'Belanja Bahan Baku', 'Gas LPG', 'Plastik dan Tissue', 'Listrik dan Air', 'Modal Kas (Kas Masuk)']],
    // Repair ID yang dipakai ulang seed tapi nilainya masih versi dummy
    // (cache dummy tertulis sebelum seed; REPLACE lama menutupinya tiap
    // startup). Syarat nama-dummy ganda = baris pull server asli (nama
    // lain) dan edit merchant TIDAK tersentuh.
    [`UPDATE ms_voucher SET voucherCode = ?, voucherName = ?, amount = ?,
       quota = ?, validFrom = '2026-01-01 00:00:00',
       validTo = '2027-12-31 23:59:59', status = 'available', syncDate = ?
       WHERE id = ? AND voucherName = ?`,
      ['HEMAT10K', 'Potongan Rp10.000', 10000, 50, nowSeed, 'V001', 'Potongan 10000']],
    [`UPDATE ms_voucher SET voucherCode = ?, voucherName = ?, amount = ?,
       quota = ?, validFrom = '2026-01-01 00:00:00',
       validTo = '2027-12-31 23:59:59', status = 'available', syncDate = ?
       WHERE id = ? AND voucherName = ?`,
      ['GRATISONGKIR', 'Gratis ongkir s.d. Rp10.000', 10000, 100, nowSeed, 'V002', 'Gratis ongkir s.d. 10000']],
    // 'ESB Cabang Poris' adalah nama fixture dummy (main-get-branch-settings):
    // kembalikan ke identitas seed; merchant yang mengganti nama lain aman.
    [`UPDATE ms_setting SET value1 = 'Genfity Cabang Poris', syncDate = ?
       WHERE key1 = 'Branch' AND key2 = 'Name' AND value1 = 'ESB Cabang Poris'`,
      [nowSeed]],
    // ID contoh lama tak terlihat ExpenseScreen (filter id LIKE 'EX-%'):
    // migrasikan ke prefix EX- agar muncul; ID milik merchant (EX-*) aman.
    [`UPDATE tr_branchexpense SET id = 'EX-SEED-001' WHERE id = 'seed-exp-001'`, []],
  ];
  for (const [sql, params] of sweep) {
    try {
      await run(sql, params);
    } catch {
      /* baris tak ada / tabel lama belum ada — idempoten, dilengkapi jalan ulang */
    }
  }
  // Rekam PIN milik user dummy ikut dibersihkan dari SecureStore/AsyncStorage
  // (tanpa ini sisa yatim; login tetap gagal karena baris ms_posuser sudah
  // disapu, tapi storage tak mengendap). Idempoten bila kunci tak ada.
  for (const uid of ['U07', 'U08', 'U01']) {
    try {
      await removePinHash(uid);
    } catch {
      /* abaikan */
    }
  }

  // R34: migrasi kolom legacy pinHash/password → hash SecureStore. Ungated
  // (DB lama ikut), idempoten via flag sendiri, fail-open per baris.
  await migrateLegacyPinColumns();

  // 6 CoA expense default (ms_coa: id, coaName, coaType, flagActive,
  // syncDate). SENGAJA tanpa gate flag seed agar DB lama yang sudah
  // ter-seed tetap dapat CoA; INSERT OR IGNORE = idempoten, aman jalan
  // ulang (pull server tetap menang via master.ts bila tersedia).
  const coa: Array<[string, string]> = [
    ['coa-operasional', 'Operasional'],
    ['coa-bahan-baku', 'Bahan Baku'],
    ['coa-gaji', 'Gaji'],
    ['coa-utilitas', 'Utilitas'],
    ['coa-sewa', 'Sewa'],
    ['coa-lainnya', 'Lainnya'],
  ];
  for (const [id, name] of coa) {
    await run(
      `INSERT OR IGNORE INTO ms_coa (id, coaName, coaType, flagActive)
       VALUES (?, ?, 'expense', 1)`,
      [id, name],
    );
  }

  // RBAC fondasi (ms_posuserrole + ms_posuseraccess). SENGAJA tanpa gate
  // flag seed (seperti CoA di atas) agar DB lama yang sudah flag seed=1
  // tetap dapat role/akses; INSERT OR IGNORE = idempoten, aman jalan ulang
  // (pull server via master.ts domain 'useraccess' tetap menang untuk baris
  // per-user karena INSERT OR REPLACE).
  //
  // Model peran hanya 2 (kanonis, sama dengan ROLE_OWNER/ROLE_STAFF di
  // lib/access.ts): 'Merchant Owner' (akses penuh) dan 'Merchant Staff'
  // (dibatasi + eskalasi PIN Owner).
  const roles: Array<[string, string]> = [
    ['Merchant Owner', 'Merchant Owner'],
    ['Merchant Staff', 'Merchant Staff'],
  ];
  for (const [id, name] of roles) {
    await run(
      `INSERT OR IGNORE INTO ms_posuserrole (id, roleName, flagActive)
       VALUES (?, ?, 1)`,
      [id, name],
    );
  }

  // Admin lokal: satu baris wildcard allow-all per user (dibaca access.ts
  // hasAccess sebagai wildcard-allow; bertahan walau baris user hilang).
  await run(
    `INSERT OR IGNORE INTO ms_posuseraccess (userId, accessKey, flagAllow)
     VALUES ('u-admin', '*', 1)`,
  );

  // Merchant Owner: satu baris wildcard allow-all (dibaca access.ts
  // hasAccess sebagai role-wildcard-allow).
  await run(
    `INSERT OR IGNORE INTO ms_posuseraccess (userId, accessKey, flagAllow)
     VALUES ('Merchant Owner', '*', 1)`,
  );

  // Kunci aksi sensitif yang deny-nya dimiliki peran Merchant Staff.
  // Baris peran (userId = nama peran kanonis) adalah template default
  // offline: access.ts jatuh kembali dari userId ke peran (via
  // normalizeRole) bila user tak punya baris sendiri.
  const sensitiveKeys = ['order.void', 'order.cancel', 'sale.refund', 'settings.edit'];
  for (const k of sensitiveKeys) {
    await run(
      `INSERT OR IGNORE INTO ms_posuseraccess (userId, accessKey, flagAllow)
       VALUES ('Merchant Staff', ?, 0)`,
      [k],
    );
  }

  // Pastikan baris admin lokal ber-role Merchant Owner HANYA bila role kosong
  // (DB lama mungkin berbeda); role hasil pull server tidak pernah ditimpa
  // (GAP-11).
  await run(`UPDATE ms_posuser SET role = 'Merchant Owner' WHERE id = 'u-admin' AND (role IS NULL OR role = '')`);

  // Admin lokal dijamin ADA + punya PIN, SENGAJA tanpa gate flag seed
  // (seperti CoA dan RBAC di atas): instalasi lama yang flag seed-nya sudah
  // '1' sebelum baris admin ada tidak akan pernah dapat user admin bila ikut
  // gate — itulah penyebab login admin/1234 gagal total di instalasi lama
  // maupun saat record PIN hilang (mis. storage dibersihkan) sementara baris
  // user tetap ada. INSERT OR IGNORE + seed PIN hanya bila record belum ada
  // (PIN yang diganti belakangan via Lupa PIN dihormati, tidak ditimpa).
  // ms_posuser: id, username, pinHash, password, authKey, branchId, role.
  // PIN disimpan sebagai hash via SecureStore/AsyncStorage, bukan kolom DB
  // (kolom pinHash/password legacy selalu NULL pasca-migrasi R34).
  await run(
    `INSERT OR IGNORE INTO ms_posuser (id, username, branchId, role)
     VALUES ('u-admin', 'admin', 'B001', 'Merchant Owner')`,
  );
  try {
    const rec = await loadPinRecord('u-admin');
    if (!rec) await savePinHash('u-admin', '1234');
  } catch {
    /* seed PIN gagal — migrasi/startup berikut mencoba lagi */
  }

  // --- Data uji offline-first (tanpa server): identitas cabang/resto,
  // user, member, voucher/promo, shift terbuka, dan 2 order contoh.
  // SENGAJA tanpa gate flag seed (seperti CoA/RBAC/admin di atas) agar
  // instalasi lama yang flag-nya sudah '1' ikut dapat data uji; semua
  // idempoten (INSERT OR IGNORE + cek keberadaan) sehingga aman dijalankan
  // ulang. Pull server via master.ts tetap menang bila backend tersedia
  // (INSERT OR REPLACE menimpa baris seed).
  // Identitas cabang/resto + pengaturan kasir (bentuk sama seperti pull
  // main/get-branch-settings -> ms_setting; OR IGNORE melindungi baris
  // hasil pull server bila sudah ada).
  const branchSettings: Array<[string, string, string, string]> = [
    ['Branch', 'Name', 'Genfity Cabang Poris', 'B001'],
    ['Branch', 'Currency', 'IDR', 'id'],
    ['Rounding', 'Mode', 'NEAREST', 'NEAREST|UP|DOWN'],
    ['Rounding', 'NearestValue', '100', 'rupiah'],
    ['Service', 'Charge', '5', 'persen eksklusif'],
  ];
  for (const [k1, k2, v1, v2] of branchSettings) {
    await run(
      `INSERT OR IGNORE INTO ms_setting (key1, key2, value1, value2, syncDate)
       VALUES (?, ?, ?, ?, ?)`,
      [k1, k2, v1, v2, nowSeed],
    );
  }

  // Stasiun kerja (Dapur + Kasir) agar stationId menu valid.
  const stations: Array<[string, string, number]> = [
    ['st-dapur', 'Dapur', 1],
    ['st-kasir', 'Kasir', 0],
  ];
  for (const [id, name, def] of stations) {
    await run(
      `INSERT OR IGNORE INTO ms_station (id, stationName, flagDefault, flagActive, syncDate)
       VALUES (?, ?, ?, 1, ?)`,
      [id, name, def, nowSeed],
    );
  }
  // Menu lama yang stationId-nya masih kosong -> Dapur (idempoten).
  await run(
    `UPDATE ms_menu SET stationId = 'st-dapur' WHERE stationId IS NULL OR stationId = ''`,
  );

  // 1 user uji cabang B001: kasir (PIN 2222, peran Staff dengan deny kunci
  // sensitif). PIN hanya diisi bila record belum ada (PIN yang diganti
  // belakangan dihormati, tidak ditimpa). u-owner/owner DIBUANG (keputusan
  // "2 user saja": admin + kasir) — sisa baris lama dibersihkan trimTestUsers
  // di bawah (jaring pengaman DB lama).
  const testUsers: Array<[string, string, string]> = [
    ['u-kasir', 'kasir', 'Merchant Staff'],
  ];
  const testPins: Record<string, string> = { 'u-kasir': '2222' };
  for (const [id, username, role] of testUsers) {
    await run(
      `INSERT OR IGNORE INTO ms_posuser (id, username, branchId, role)
       VALUES (?, ?, 'B001', ?)`,
      [id, username, role],
    );
    try {
      const rec = await loadPinRecord(id);
      if (!rec) await savePinHash(id, testPins[id]);
    } catch {
      /* abaikan — verifikasi hanya via hash SecureStore (R34) */
    }
  }
  // Kasir uji SENGAJA tanpa baris per user agar jatuh ke template peran
  // 'Merchant Staff' (deny order.void/order.cancel/sale.refund/settings.edit).

  // 2 member uji (selaras fallback MEMBER_DEPOSIT_DB di PayScreen).
  // INSERT OR IGNORE (bukan REPLACE): REPLACE lama me-reset saldo hasil
  // topup CRUD merchant tiap startup. ID M001/M002 yang masih bernilai
  // dummy diperbaiki di blok repair sapu di atas (nama fixture identik
  // dengan seed sehingga baris dummy tak perlu dibedakan).
  const members: Array<[string, string, string, number]> = [
    ['M001', 'Budi Santoso', '081234567890', 150000],
    ['M002', 'Sinta Dewi', '081398765432', 500000],
  ];
  for (const [id, name, phone, bal] of members) {
    await run(
      `INSERT OR IGNORE INTO ms_member (id, memberName, phone, depositBalance, syncDate)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, phone, bal, nowSeed],
    );
    await run(
      `INSERT OR IGNORE INTO tr_memberdeposit (id, memberId, branchId, trxType, amount, balanceAfter, userId, trxDate, syncDate)
       VALUES (?, ?, 'B001', 'TOPUP', ?, ?, 'u-admin', ?, ?)`,
      [`seed-dep-${id}`, id, bal, bal, nowSeed, nowSeed],
    );
    await run(
      `INSERT OR IGNORE INTO tr_membertransactionlog (id, memberId, trxType, amount, balanceAfter, userId, trxDate, syncDate)
       VALUES (?, ?, 'TOPUP', ?, ?, 'u-admin', ?, ?)`,
      [`seed-mtl-${id}`, id, bal, bal, nowSeed, nowSeed],
    );
  }

  // 2 voucher + 2 promo uji yang masih berlaku (selaras dummy pull).
  // INSERT OR IGNORE (bukan REPLACE): REPLACE lama menimpa status/kuota
  // hasil burn/claim CRUD merchant tiap startup. Baris V001/V002 yang
  // masih bernama versi dummy diperbaiki di blok repair sapu di atas.
  // V003/V004 dummy disapu di blok sapu di atas.
  const vouchers: Array<[string, string, string, number, number]> = [
    ['V001', 'HEMAT10K', 'Potongan Rp10.000', 10000, 50],
    ['V002', 'GRATISONGKIR', 'Gratis ongkir s.d. Rp10.000', 10000, 100],
  ];
  for (const [id, code, name, amount, quota] of vouchers) {
    await run(
      `INSERT OR IGNORE INTO ms_voucher (id, voucherCode, voucherName, amount, quota, validFrom, validTo, status, syncDate)
       VALUES (?, ?, ?, ?, ?, '2026-01-01 00:00:00', '2027-12-31 23:59:59', 'available', ?)`,
      [id, code, name, amount, quota, nowSeed],
    );
  }
  const promos: Array<[string, string, string, string, number, number, number]> = [
    ['prm-hemat10', 'HEMAT10', 'Promo Hemat Rp10.000', 'nominal', 10000, 10000, 50000],
    ['prm-ongkir10', 'ONGKIR10', 'Gratis ongkir Rp10.000', 'ongkir', 10000, 10000, 0],
  ];
  for (const [id, code, name, type, value, maxAmt, minSpend] of promos) {
    await run(
      `INSERT OR IGNORE INTO ms_promotion (id, promoCode, promoName, promoType, value, maxAmount, minSpend, validFrom, validTo, flagActive, syncDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01 00:00:00', '2027-12-31 23:59:59', 1, ?)`,
      [id, code, name, type, value, maxAmt, minSpend, nowSeed],
    );
  }

  // Shift pagi TERBUKA milik kasir uji — hanya bila belum ada shift terbuka
  // (kasir nyata yang sudah buka shift tidak diganggu). Baris absensi
  // (status 'absen') dikecualikan: clock-in kehadiran BUKAN shift kasir,
  // order uji tak boleh ditempel ke baris absen.
  const openShift = await queryFirst<{ id: string }>(
    `SELECT id FROM tr_shiftlog WHERE clockOut IS NULL AND (status IS NULL OR status <> 'absen') LIMIT 1`,
  );
  let orderShiftId: string | null = openShift?.id ?? null;
  if (!openShift) {
    orderShiftId = 'seed-shift-pagi';
    await run(
      `INSERT OR IGNORE INTO tr_shiftlog (id, branchId, terminalId, userId, shiftName, clockIn, clockOut, cashInDrawer, totalSales, cashActual, cashDiff, status, syncDate)
       VALUES (?, 'B001', 'T001', 'u-kasir', 'Shift Pagi', ?, NULL, 200000, 0, 0, 0, 'open', ?)`,
      [orderShiftId, `${todaySeed} 08:00:00`, nowSeed],
    );
  }

  // 4 order contoh (L9/L25): jalur utama = saveSale nyata (head + item +
  // payment + tiket dapur 'Baru') bila device bound; bila UNBOUND (instalasi
  // segar belum klaim terminal — saveSale fail-closed melempar
  // terminal-unbound) = sisip baris langsung via seedSaleDirect dengan
  // matematika kanonis totals() yang sama + penomoran SEED-xxx. Masing-masing
  // hanya bila nomornya belum ada; SEED-001 dimundurkan ke kemarin agar
  // History/Dashboard/Rekap ada baseline.
  for (const spec of SEED_SPECS) {
    try {
      const exists = await queryFirst<{ salesNum: string }>(
        `SELECT salesNum FROM tr_saleshead WHERE salesNum = ? LIMIT 1`,
        [spec.salesNum],
      );
      if (exists) continue;
      const canon = seedCanon(spec);
      if (isTerminalBound()) {
        try {
          await saveSale(seedSaleInput(spec, canon));
        } catch (e) {
          // Bound tapi saveSale gagal (termasuk terminal-unbound di tengah
          // jalan): fallback baris-langsung yang jujur + catat
          // (dulu: skip diam-diam).
          console.warn(`[seed] saveSale ${spec.salesNum} gagal, fallback direct: ${e instanceof Error ? e.message : e}`);
          await seedSaleDirect(spec, canon, nowSeed);
        }
      } else {
        await seedSaleDirect(spec, canon, nowSeed);
      }
      // Cap identitas cabang/user/shift uji (saveSale memakai terminal/sesi
      // aktif yang saat seed pertama kali masih kosong; jalur direct memakai
      // identitas uji sejak lahir sehingga UPDATE ini no-op untuknya). Kolom
      // shiftId memang tidak ditulis saveSale (konsisten dengan penjualan
      // kasir nyata yang direkap per rentang waktu) — seed menautkannya agar
      // alur Shift/Rekap langsung bisa diuji.
      await run(
        `UPDATE tr_saleshead SET branchId = 'B001', terminalId = 'T001', userId = 'u-kasir',
           cashierName = 'kasir', shiftId = ? WHERE salesNum = ?`,
        [orderShiftId, spec.salesNum],
      );
    } catch (e) {
      // Satu order gagal total — catat jujur lalu lanjut (kasir tetap jalan).
      console.warn(`[seed] order ${spec.salesNum} dilewati: ${e instanceof Error ? e.message : e}`);
    }
  }

  // SEED-001 dimundurkan ke kemarin siang (hanya bila masih 'paid' - order
  // yang sudah divoid/refund user dihormati) agar History, Dashboard
  // (baseline kemarin), dan Rekap langsung berisi dua hari.
  try {
    const yd = new Date();
    yd.setDate(yd.getDate() - 1);
    const yp = (n: number): string => String(n).padStart(2, '0');
    const stamp =
      `${yd.getFullYear()}-${yp(yd.getMonth() + 1)}-${yp(yd.getDate())} 12:30:00`;
    await run(
      `UPDATE tr_saleshead SET salesDate = ?, createdAt = ?, updatedAt = ?
       WHERE salesNum = 'SEED-001' AND status = 'paid'`,
      [stamp, stamp, stamp],
    );
    await run(`UPDATE tr_salesmenu SET createdAt = ? WHERE salesNum = 'SEED-001'`, [stamp]);
    await run(`UPDATE tr_salespayment SET createdAt = ? WHERE salesNum = 'SEED-001'`, [stamp]);
    await run(
      `UPDATE tr_kitchenticket SET createdAt = ?, updatedAt = ? WHERE salesNum = 'SEED-001'`,
      [stamp, stamp],
    );
  } catch {
    /* abaikan - kedua order tetap hari ini, kasir tetap jalan */
  }

  // 1 pengeluaran contoh (kemarin pagi - tak mengganggu hitung kas shift
  // hari ini di EndShiftScreen). Hanya bila tabel masih kosong.
  try {
    const exp = await queryFirst<{ n: number }>(
      'SELECT COUNT(*) AS n FROM tr_branchexpense',
    );
    // Sisip-sekali (anti-rebirth): hanya saat seed pertama (flag belum '1').
    // COUNT==0 saja tak cukup — merchant yang menghapus SEMUA pengeluaran
    // akan melihat demo EX-SEED-001 bangkit tiap restart.
    const seedFlag = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = 'seed' AND key2 = 'local' LIMIT 1`,
    );
    if (Number(exp?.n ?? 0) === 0 && seedFlag?.value1 !== '1') {
      const ed = new Date();
      ed.setDate(ed.getDate() - 1);
      const ep = (n: number): string => String(n).padStart(2, '0');
      const expDate =
        `${ed.getFullYear()}-${ep(ed.getMonth() + 1)}-${ep(ed.getDate())} 08:30:00`;
      await run(
        `INSERT OR IGNORE INTO tr_branchexpense
           (id, branchId, coaId, coaName, amount, note, userId, expenseDate,
            photoPath, syncDate, createdAt)
         VALUES ('EX-SEED-001', 'B001', 'coa-bahan-baku', 'Bahan Baku', -150000,
            'Belanja bahan baku harian', 'u-kasir', ?, NULL, ?, ?)`,
        [expDate, nowSeed, expDate],
      );
    }
  } catch {
    /* abaikan - layar Expense tetap punya empty-state */
  }

  // Jaring pengaman u-owner (DB lama): buang user uji owner + alihkan
  // jejaknya ke u-admin. Idempoten, tak melempar. SENGAJA sebelum gate flag
  // seed di bawah: DB lama yang flag-nya sudah '1' (early-return) ikut bersih
  // — di ujung fungsi panggilan ini takkan tercapai untuk mereka.
  await trimTestUsers();

  const flag = await queryFirst<{ value1: string | null }>(
    `SELECT value1 FROM ms_setting WHERE key1 = 'seed' AND key2 = 'local' LIMIT 1`,
  );
  if (flag?.value1 === '1') return;

  // Pajak PPN 11% (ms_setting: key1, key2, value1, value2, syncDate).
  // syncDate dicap agar baris seed dianggap sudah sinkron (bukan dirty).
  await run(
    `INSERT OR IGNORE INTO ms_setting (key1, key2, value1, syncDate) VALUES ('Tax', 'PPN', '11', ?)`,
    [nowSeed],
  );

  // (User admin lokal dijamin di blok tanpa-gate di atas, bukan di sini.)

  // 3 kategori (ms_category: id, categoryName, sortOrder, flagActive, syncDate).
  const cats: Array<[string, string, number]> = [
    ['c-makanan', 'Makanan', 1],
    ['c-minuman', 'Minuman', 2],
    ['c-snack', 'Snack', 3],
  ];
  for (const [id, name, sort] of cats) {
    await run(
      `INSERT OR IGNORE INTO ms_category (id, categoryName, sortOrder, flagActive, syncDate)
       VALUES (?, ?, ?, 1, ?)`,
      [id, name, sort, nowSeed],
    );
  }

  // 12 menu + relasi cabang B001 (ms_menu: id, menuName, categoryId, price,
  // imageUrl, stationId, flagActive, syncDate; ms_branchmenu: branchId,
  // menuId, stationId, qty, flagSoldOut, flagActive, syncDate).
  for (const m of SEED_MENUS) {
    await run(
      `INSERT OR IGNORE INTO ms_menu (id, menuName, categoryId, price, flagActive, syncDate)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [m.id, m.name, m.cat, m.price, nowSeed],
    );
    await run(
      `INSERT OR IGNORE INTO ms_branchmenu (branchId, menuId, flagActive, syncDate)
       VALUES ('B001', ?, 1, ?)`,
      [m.id, nowSeed],
    );
  }

  // Stok awal + relasi cabang B002 (Ciputat), B003 (Bintaro), dan B004 (cabang
  // uji AUD — lihat AUD_TEST_BRANCH + switchSeedBranchForTest di bawah) agar
  // kasir di cabang mana pun langsung punya menu. Jus Alpukat sengaja 3 =
  // demo peringatan restock di Dashboard. Syarat stationId KOSONG memastikan
  // isi-ulang hanya untuk baris segar seed (INSERT di atas tak mengisi qty /
  // station → qty default skema 0 + stationId NULL): baris yang sudah tersentuh
  // merchant/kasir (stationId terisi, atau ditandai habis) TIDAK disentuh.
  // Tanpa gate station ini, kombinasi qty=0 + flagSoldOut=0 yang sah
  // (allowSellEmpty / online=true di layar Stok, atau buka-kembali item habis)
  // akan bangkit ke stok seed tiap restart — juga menimpa stationId pilihan
  // merchant. Setelah terisi sekali, stationId terkunci dari seed selamanya.
  const seedStock: Record<string, number> = {
    'm-nasi-goreng': 40,
    'm-ayam-geprek': 35,
    'm-mie-goreng': 30,
    'm-ayam-bakar': 25,
    'm-lele-goreng': 20,
    'm-es-teh-manis': 60,
    'm-kopi-tubruk': 50,
    'm-jus-alpukat': 3,
    'm-soda-gembira': 25,
    'm-air-mineral': 100,
    'm-pisang-goreng': 20,
    'm-tahu-crispy': 15,
  };
  for (const m of SEED_MENUS) {
    const stock = seedStock[m.id] ?? 20;
    const station = m.cat === 'c-minuman' ? 'st-kasir' : 'st-dapur';
    await run(
      `UPDATE ms_branchmenu SET qty = ?, stationId = ?, syncDate = ?
       WHERE branchId = 'B001' AND menuId = ?
         AND (qty IS NULL OR qty = 0) AND flagSoldOut = 0
         AND (stationId IS NULL OR stationId = '')`,
      [stock, station, nowSeed, m.id],
    );
    for (const branchId of ['B002', 'B003', 'B004']) {
      await run(
        `INSERT OR IGNORE INTO ms_branchmenu
           (branchId, menuId, stationId, qty, flagSoldOut, flagActive, syncDate)
         VALUES (?, ?, ?, ?, 0, 1, ?)`,
        [branchId, m.id, station, stock, nowSeed],
      );
    }
  }

  // 9 meja (ms_table: id, tableNo, sectionId, capacity, status, syncDate).
  for (const t of SEED_TABLES) {
    await run(`INSERT OR IGNORE INTO ms_table (id, tableNo, syncDate) VALUES (?, ?, ?)`, [t, t, nowSeed]);
  }
  // Lengkapi denah lama yang section/kapasitasnya masih kosong (JANGAN
  // timpa denah yang sudah diatur merchant via layar Tables).
  const tableMeta: Record<string, [string, number]> = {
    A1: ['Dalam', 4], A2: ['Dalam', 4], A3: ['Dalam', 4],
    B1: ['Dalam', 2], B2: ['Dalam', 2], B3: ['Dalam', 2],
    C1: ['Teras', 4], C2: ['Teras', 4], C3: ['Teras', 6],
  };
  for (const t of SEED_TABLES) {
    const meta = tableMeta[t] ?? ['Dalam', 4];
    await run(
      `UPDATE ms_table SET sectionId = ?, capacity = ?,
         status = COALESCE(status, 'kosong'), syncDate = COALESCE(syncDate, ?)
       WHERE id = ? AND (sectionId IS NULL OR sectionId = '')`,
      [meta[0], meta[1], nowSeed, t],
    );
  }

  // 4 metode bayar (ms_paymentmethod: id, methodName, methodType,
  // flagActive, sortOrder, voucherCategoryID, voucherSourceID, syncDate).
  for (const p of SEED_PAYMENTS) {
    await run(
      `INSERT OR IGNORE INTO ms_paymentmethod (id, methodName, methodType, flagActive, sortOrder, syncDate)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [p.id, p.name, p.type, p.order, nowSeed],
    );
  }

  // Tandai seed selesai (INSERT lalu UPDATE agar idempoten bila baris
  // sudah ada dengan nilai lain).
  await run(
    `INSERT OR IGNORE INTO ms_setting (key1, key2, value1) VALUES ('seed', 'local', '1')`,
  );
  await run(
    `UPDATE ms_setting SET value1 = '1' WHERE key1 = 'seed' AND key2 = 'local'`,
  );
}

/**
 * Cabang uji AUD (B004) untuk pengujian dual-currency lokal.
 *
 * DB lokal hanya memegang SATU cabang aktif (ms_setting Branch Name/Currency
 * + Tax PPN global) — tak ada tabel ms_branch — sehingga "cabang kedua" di
 * sini = (a) relasi ms_branchmenu B004 yang di-seed otomatis di ensureSeeded
 * (aditif, INSERT OR IGNORE, tak mengubah seed IDR), + (b) helper eksplisit
 * switchSeedBranchForTest() di bawah untuk mengaktifkan cabang uji.
 *
 * SENGAJA tak jalan otomatis di ensureSeeded: default instalasi segar tetap
 * IDR (Cabang Poris, PPN 11). Pajak per-cabang didukung via baris
 * ms_setting('Tax', 'PPN_<branchId>') (getTaxRate() memilih per cabang aktif;
 * baris global Tax/PPN tetap cermin cabang aktif) — helper menulis kedua
 * tarif (B001=11, B004=10) sehingga keduanya hidup berdampingan; timezone
 * cabang ikut ditulis (Branch/Timezone) + cache diset tanpa perlu restart;
 * lihat docs/DUAL-CURRENCY-STATUS.md.
 */
export const AUD_TEST_BRANCH_ID = 'B004';

/** Baris ms_setting aktif per cabang uji: [key1, key2, value1, value2]. */
const SEED_BRANCH_ROWS: Record<'IDR' | 'AUD', [string, string, string, string][]> = {
  IDR: [
    ['Branch', 'Name', 'Genfity Cabang Poris', 'B001'],
    ['Branch', 'Currency', 'IDR', 'id'],
    ['Branch', 'Timezone', 'Asia/Jakarta', ''],
    ['Tax', 'PPN', '11', ''],
  ],
  AUD: [
    ['Branch', 'Name', 'Genfity Sydney (Uji AUD)', 'B004'],
    ['Branch', 'Currency', 'AUD', 'en-AU'],
    ['Branch', 'Timezone', 'Australia/Perth', ''],
    ['Tax', 'PPN', '10', ''],
  ],
};

/**
 * Order contoh cabang AUD (DUAL-CURRENCY §4f): baseline History/Dashboard
 * cabang uji — GST 10 + langkah sen (1), harga dolar utuh (totals() integer).
 * Hanya di-seed dari switchSeedBranchForTest('AUD'), BUKAN ensureSeeded,
 * agar instalasi segar tetap IDR murni. Idempoten via cek salesNum.
 */
const SEED_AUD_SPEC: SeedOrderSpec = {
  salesNum: 'SEED-AUD-001', method: 'cash', mode: 'TAKE AWAY', customer: 'Jack',
  branchId: 'B004', taxRate: 10, cash: 50,
  items: [
    { id: 'm-ayam-bakar', name: 'Ayam Bakar', basePrice: 25, qty: 1 },
    { id: 'm-kopi-tubruk', name: 'Kopi Tubruk', basePrice: 5, qty: 2 },
  ],
};

async function seedAudSampleOrder(nowSeed: string): Promise<void> {
  const exists = await queryFirst<{ salesNum: string }>(
    `SELECT salesNum FROM tr_saleshead WHERE salesNum = ? LIMIT 1`,
    [SEED_AUD_SPEC.salesNum],
  );
  if (exists) return;
  const canon = seedCanon(SEED_AUD_SPEC);
  await seedSaleDirect(SEED_AUD_SPEC, canon, nowSeed);
  const openShift = await queryFirst<{ id: string }>(
    `SELECT id FROM tr_shiftlog WHERE clockOut IS NULL AND (status IS NULL OR status <> 'absen') LIMIT 1`,
  );
  await run(
    `UPDATE tr_saleshead SET branchId = ?, terminalId = 'T001', userId = 'u-kasir',
       cashierName = 'kasir', shiftId = ? WHERE salesNum = ?`,
    [SEED_AUD_SPEC.branchId ?? 'B004', openShift?.id ?? 'seed-shift-pagi', SEED_AUD_SPEC.salesNum],
  );
}

/**
 * Alihkan cabang aktif seed untuk pengujian (HANYA instalasi dev/uji — fungsi
 * ini SENGAJA menimpa baris ms_setting, termasuk nama cabang yang mungkin
 * sudah diganti merchant). Idempoten, aman jalan ulang. Tak melempar yang
 * fatal (gagal tulis = catat + lanjut). Kembalikan ke IDR dengan
 * switchSeedBranchForTest('IDR').
 */
export async function switchSeedBranchForTest(which: 'IDR' | 'AUD'): Promise<void> {
  await initDb();
  const nowSeed = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const rows = SEED_BRANCH_ROWS[which] ?? SEED_BRANCH_ROWS.IDR;
  for (const [k1, k2, v1, v2] of rows) {
    try {
      await run(
        `INSERT OR IGNORE INTO ms_setting (key1, key2, value1, value2, syncDate)
         VALUES (?, ?, ?, ?, ?)`,
        [k1, k2, v1, v2, nowSeed],
      );
      await run(
        `UPDATE ms_setting SET value1 = ?, value2 = ?, syncDate = ?
         WHERE key1 = ? AND key2 = ?`,
        [v1, v2, nowSeed, k1, k2],
      );
    } catch (e) {
      console.warn(`[seed] switch cabang uji ${which} (${k1}/${k2}) gagal: ${e instanceof Error ? e.message : e}`);
    }
  }
  // Pajak per-cabang berdampingan (DUAL-CURRENCY §4d): kedua tarif hidup
  // bersamaan sebagai baris PPN_<branchId> (getTaxRate() memilih per cabang
  // aktif); baris global Tax/PPN di atas tetap cermin cabang aktif (kompatibel
  // pembaca lama). Idempoten via pola INSERT-or-UPDATE yang sama.
  for (const [k2, v1] of [['PPN_B001', '11'], ['PPN_B004', '10']] as const) {
    try {
      await run(
        `INSERT OR IGNORE INTO ms_setting (key1, key2, value1, value2, syncDate)
         VALUES ('Tax', ?, ?, '', ?)`,
        [k2, v1, nowSeed],
      );
      await run(
        `UPDATE ms_setting SET value1 = ?, syncDate = ? WHERE key1 = 'Tax' AND key2 = ?`,
        [v1, nowSeed, k2],
      );
    } catch (e) {
      console.warn(`[seed] switch cabang uji ${which} (Tax/${k2}) gagal: ${e instanceof Error ? e.message : e}`);
    }
  }
  // Sinkronkan cache in-memory agar layar langsung memakai cabang baru tanpa
  // restart (restart tetap valid — baris lokal dibaca ulang saat boot/login).
  const active = SEED_BRANCH_ROWS[which] ?? SEED_BRANCH_ROWS.IDR;
  const cur = active.find(([k1, k2]) => k1 === 'Branch' && k2 === 'Currency');
  const tz = active.find(([k1, k2]) => k1 === 'Branch' && k2 === 'Timezone');
  try {
    if (cur) setCachedCurrency(cur[2], cur[3]);
    if (tz) setCachedTimezone(tz[2]);
  } catch {
    /* cache gagal: baris DB tetap benar, dibaca ulang saat restart */
  }
  // Baseline order AUD untuk History/Dashboard cabang uji (hanya saat AUD).
  if (which === 'AUD') {
    try {
      await seedAudSampleOrder(nowSeed);
    } catch (e) {
      console.warn(`[seed] order contoh AUD gagal: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/**
 * Pengisian + laporan: jalankan ensureSeeded (idempoten, termasuk
 * self-healing CoA/RBAC/admin) lalu laporkan {seeded:true} bila DB
 * fresh/kosong sebelum pengisian, {seeded:false} bila data sudah ada.
 */
export async function seedIfEmpty(): Promise<{ seeded: boolean }> {
  await initDb();
  let fresh = true;
  try {
    try {
      const flag = await queryFirst<{ value1: string | null }>(
        `SELECT value1 FROM ms_setting WHERE key1 = 'seed' AND key2 = 'local' LIMIT 1`,
      );
      const users = await queryFirst<{ n: number }>(
        'SELECT COUNT(*) AS n FROM ms_posuser',
      );
      fresh = flag?.value1 !== '1' || Number(users?.n ?? 0) === 0;
    } catch {
      fresh = true;
    }
    await ensureSeeded();
    return { seeded: fresh };
  } finally {
    // S2-C311: tandai upaya seed selesai agar login tak jalan di DB setengah-seed.
    markSeedDone();
  }
}
