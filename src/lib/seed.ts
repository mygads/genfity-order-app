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
 * Data uji offline-first (cabang/resto, owner+kasir, member, voucher/promo,
 * shift terbuka, 2 order via saveSale nyata - 1 dimundurkan ke kemarin agar
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
import { initDb, queryFirst, run } from './db';
import type { BindParams } from './db';
import { loadPinRecord, savePinHash } from './pin';
import { saveSale } from './sales';
import type { SaleInput } from './payments';

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
  // PIN disimpan sebagai hash via SecureStore/AsyncStorage, bukan kolom DB.
  await run(
    `INSERT OR IGNORE INTO ms_posuser (id, username, branchId, role)
     VALUES ('u-admin', 'admin', 'B001', 'Merchant Owner')`,
  );
  try {
    const rec = await loadPinRecord('u-admin');
    if (!rec) await savePinHash('u-admin', '1234');
  } catch {
    /* seed PIN gagal — login masih coba fallback legacy */
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

  // 2 user uji cabang B001: owner (PIN 1111, akses penuh) + kasir
  // (PIN 2222, peran Staff dengan deny kunci sensitif). PIN hanya diisi bila
  // record belum ada (PIN yang diganti belakangan dihormati, tidak ditimpa).
  const testUsers: Array<[string, string, string]> = [
    ['u-owner', 'owner', 'Merchant Owner'],
    ['u-kasir', 'kasir', 'Merchant Staff'],
  ];
  const testPins: Record<string, string> = { 'u-owner': '1111', 'u-kasir': '2222' };
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
      /* abaikan — fallback legacy di apiSource */
    }
  }
  // Owner uji: satu baris wildcard allow-all per user (seperti u-admin).
  // Kasir uji SENGAJA tanpa baris per user agar jatuh ke template peran
  // 'Merchant Staff' (deny order.void/order.cancel/sale.refund/settings.edit).
  await run(
    `INSERT OR IGNORE INTO ms_posuseraccess (userId, accessKey, flagAllow)
     VALUES ('u-owner', '*', 1)`,
  );

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
       VALUES (?, ?, 'B001', 'TOPUP', ?, ?, 'u-owner', ?, ?)`,
      [`seed-dep-${id}`, id, bal, bal, nowSeed, nowSeed],
    );
    await run(
      `INSERT OR IGNORE INTO tr_membertransactionlog (id, memberId, trxType, amount, balanceAfter, userId, trxDate, syncDate)
       VALUES (?, ?, 'TOPUP', ?, ?, 'u-owner', ?, ?)`,
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

  // 2 order uji via jalur saveSale nyata (head + item + payment + tiket
  // dapur 'Baru'), masing-masing hanya bila nomornya belum ada.
  const seedOrders: SaleInput[] = [
    {
      method: 'cash',
      salesNum: 'SEED-001',
      grandTotal: 38850,
      subtotal: 35000,
      vatTotal: 3850,
      cash: 40000,
      change: 1150,
      mode: 'DINE IN',
      tableId: 'A1',
      memberId: 'M001',
      customer: 'Budi',
      items: [
        { id: 'm-nasi-goreng', name: 'Nasi Goreng', basePrice: 15000, qty: 2 },
        { id: 'm-es-teh-manis', name: 'Es Teh Manis', basePrice: 5000, qty: 1 },
      ],
      payments: [{ method: 'cash', amount: 38850 }],
    },
    {
      method: 'qris',
      salesNum: 'SEED-002',
      grandTotal: 17760,
      subtotal: 26000,
      discountTotal: 10000,
      vatTotal: 1760,
      mode: 'TAKE AWAY',
      customer: 'Sinta',
      voucherCode: 'HEMAT10K',
      items: [
        { id: 'm-ayam-bakar', name: 'Ayam Bakar', basePrice: 18000, qty: 1 },
        { id: 'm-kopi-tubruk', name: 'Kopi Tubruk', basePrice: 8000, qty: 1 },
      ],
      payments: [{ method: 'qris', amount: 17760 }],
    },
    // SEED-003: promo nominal reusable (HEMAT10 hanya ada di ms_promotion,
    // minSpend 50000) — membuktikan jalur fallback promo di backstop saveSale:
    // usage 'burn' tercatat, kuota tak tersentuh (promo tanpa kuota).
    // 51000 - 10000 = 41000 + PPN 11% (4510) = 45510.
    {
      method: 'qris',
      salesNum: 'SEED-003',
      grandTotal: 45510,
      subtotal: 51000,
      discountTotal: 10000,
      vatTotal: 4510,
      mode: 'TAKE AWAY',
      customer: 'Dewi',
      voucherCode: 'HEMAT10',
      items: [
        { id: 'm-ayam-bakar', name: 'Ayam Bakar', basePrice: 18000, qty: 2 },
        { id: 'm-nasi-goreng', name: 'Nasi Goreng', basePrice: 15000, qty: 1 },
      ],
      payments: [{ method: 'qris', amount: 45510 }],
    },
    // SEED-004: promo ongkir (ONGKIR10 hanya di ms_promotion) — ongkir bruto
    // 8000 dipotong penuh (ongkirCut 8000), neto tersimpan 0.
    // 21000 + PPN 11% (2310) + 0 = 23310; tunai 25000, kembali 1690.
    {
      method: 'cash',
      salesNum: 'SEED-004',
      grandTotal: 23310,
      subtotal: 21000,
      vatTotal: 2310,
      cash: 25000,
      change: 1690,
      mode: 'GOFOOD',
      customer: 'Agus',
      voucherCode: 'ONGKIR10',
      ongkir: 0,
      ongkirCut: 8000,
      items: [
        { id: 'm-kopi-tubruk', name: 'Kopi Tubruk', basePrice: 8000, qty: 2 },
        { id: 'm-es-teh-manis', name: 'Es Teh Manis', basePrice: 5000, qty: 1 },
      ],
      payments: [{ method: 'cash', amount: 23310 }],
    },
  ];
  for (const o of seedOrders) {
    try {
      const exists = await queryFirst<{ salesNum: string }>(
        `SELECT salesNum FROM tr_saleshead WHERE salesNum = ? LIMIT 1`,
        [o.salesNum ?? ''],
      );
      if (exists) continue;
      await saveSale(o);
      // Cap identitas cabang/user/shift uji (saveSale memakai terminal/sesi
      // aktif yang saat seed pertama kali masih kosong). Kolom shiftId
      // memang tidak ditulis saveSale (konsisten dengan penjualan kasir
      // nyata yang direkap per rentang waktu) — seed menautkannya agar
      // alur Shift/Rekap langsung bisa diuji.
      await run(
        `UPDATE tr_saleshead SET branchId = 'B001', terminalId = 'T001', userId = 'u-kasir',
           cashierName = 'kasir', shiftId = ? WHERE salesNum = ?`,
        [orderShiftId, o.salesNum ?? ''],
      );
    } catch {
      /* satu order gagal — lanjut ke order berikut, kasir tetap jalan */
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
    if (Number(exp?.n ?? 0) === 0) {
      const ed = new Date();
      ed.setDate(ed.getDate() - 1);
      const ep = (n: number): string => String(n).padStart(2, '0');
      const expDate =
        `${ed.getFullYear()}-${ep(ed.getMonth() + 1)}-${ep(ed.getDate())} 08:30:00`;
      await run(
        `INSERT OR IGNORE INTO tr_branchexpense
           (id, branchId, coaId, coaName, amount, note, userId, expenseDate,
            photoPath, syncDate, createdAt)
         VALUES ('EX-SEED-001', 'B001', 'coa-bahan-baku', 'Bahan Baku', 150000,
            'Belanja bahan baku harian', 'u-kasir', ?, NULL, ?, ?)`,
        [expDate, nowSeed, expDate],
      );
    }
  } catch {
    /* abaikan - layar Expense tetap punya empty-state */
  }

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

  // Stok awal + relasi cabang B002 (Ciputat) dan B003 (Bintaro) agar kasir
  // di cabang mana pun langsung punya menu. Jus Alpukat sengaja 3 =
  // demo peringatan restock di Dashboard. Baris yang qty-nya sudah diatur
  // merchant (atau ditandai habis) TIDAK disentuh.
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
         AND (qty IS NULL OR qty = 0) AND flagSoldOut = 0`,
      [stock, station, nowSeed, m.id],
    );
    for (const branchId of ['B002', 'B003']) {
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
 * Pengisian + laporan: jalankan ensureSeeded (idempoten, termasuk
 * self-healing CoA/RBAC/admin) lalu laporkan {seeded:true} bila DB
 * fresh/kosong sebelum pengisian, {seeded:false} bila data sudah ada.
 */
export async function seedIfEmpty(): Promise<{ seeded: boolean }> {
  await initDb();
  let fresh = true;
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
}
