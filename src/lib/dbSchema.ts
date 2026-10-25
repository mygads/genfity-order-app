/**
 * Skema SQLite + migrasi kolom, dipakai BERSAMA oleh db.ts (native) dan
 * db.web.ts (web/WASM). Satu sumber agar web dan native tidak pernah drift:
 * tambah tabel/kolom cukup di sini, kedua platform ikut.
 *
 * Dipindah verbatim dari lib/db.ts (tanpa perubahan isi).
 */

export const SCHEMA_STATEMENTS: string[] = [
  // --- Konfig KV + sesi + terminal (Lampiran B) ---
  `CREATE TABLE IF NOT EXISTS ms_setting (
    key1 TEXT NOT NULL, key2 TEXT NOT NULL, value1 TEXT, value2 TEXT, syncDate TEXT,
    PRIMARY KEY (key1, key2))`,
  `CREATE TABLE IF NOT EXISTS ms_posuser (
    id TEXT PRIMARY KEY, username TEXT, pinHash TEXT, password TEXT, authKey TEXT,
    branchId TEXT, role TEXT, syncDate TEXT)`,
  // R34 DEPRECATED: pinHash/password always NULL — PIN verification is SecureStore-only (lib/pin.ts).
  `CREATE TABLE IF NOT EXISTS ms_terminalsetting (
    terminalId TEXT NOT NULL, settingKey TEXT NOT NULL, settingValue TEXT,
    flag INTEGER DEFAULT 0, syncDate TEXT,
    PRIMARY KEY (terminalId, settingKey))`,
  `CREATE TABLE IF NOT EXISTS ms_station (
    id TEXT PRIMARY KEY, stationName TEXT, printerName TEXT, printerPort TEXT,
    connection TEXT, printerType TEXT, printerMode TEXT, charPerLine INTEGER DEFAULT 32,
    localIdentifier TEXT, flagDefault INTEGER DEFAULT 0, flagActive INTEGER DEFAULT 1,
    flagAutocut INTEGER DEFAULT 1, flagOpenCashdrawer INTEGER DEFAULT 0, syncDate TEXT)`,

  // --- Inti transaksi ---
  // client_id (Q7 CLOSED, SPEC §12 aditif): UUIDv7 stabil per sale, PK
  // merge-safe lintas-device. salesNum = nomor display tersegmen
  // TRX-{BRANCH}-{TERM}-{YYYYMMDD}-{NNNN} (PK lokal + tampil di struk; join
  // anak, pull INSERT OR IGNORE, seed tak berubah); server upsert by
  // client_id, UNIQUE(display_no) + 409 terlihat untuk konflik nomor.
  // Tabel anak membawa client_id NULL-able (cadangan merge lane BE; join
  // lokal tetap via salesNum, server resolve via head client_id).
  `CREATE TABLE IF NOT EXISTS tr_saleshead (
    salesNum TEXT PRIMARY KEY, client_id TEXT, branchId TEXT, terminalId TEXT, userId TEXT, shiftId TEXT,
    salesDate TEXT, salesMode TEXT, tableNo TEXT, customerName TEXT,
    subtotal REAL DEFAULT 0, discount REAL DEFAULT 0, discountName TEXT,
    tax REAL DEFAULT 0, serviceCharge REAL DEFAULT 0, tip REAL DEFAULT 0,
    voucherAmount REAL DEFAULT 0, voucherCode TEXT, promotionVoucherCode TEXT,
    -- promotionVoucherCode = CADANGAN yang disengaja tak dipakai (audit 2026-10):
    -- kode terapan (voucher kuota maupun promo reusable) tercatat di SATU kolom
    -- voucherCode agar riwayat/void/struk/sync tak bercabang; asal kode selalu
    -- bisa ditelusur via ms_voucher/ms_promotion. Jangan tulis/baca kolom ini
    -- tanpa memperbarui receipt/history/void/sync-mapping (master.ts) sekalian.
    platformFee REAL DEFAULT 0, rounding REAL DEFAULT 0, grandTotal REAL DEFAULT 0,
    paidAmount REAL DEFAULT 0, changeAmount REAL DEFAULT 0,
    paymentMethod TEXT, paymentType TEXT, memberId TEXT,
    ongkir REAL DEFAULT 0,
    packaging REAL DEFAULT 0,
    status TEXT DEFAULT 'open', note TEXT, queueNumber TEXT, refNum TEXT,
    externalId TEXT, onlineOrderId TEXT, cashierName TEXT,
    createdAt TEXT, updatedAt TEXT, syncDate TEXT, printedCount INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS tr_salesmenu (
    id TEXT PRIMARY KEY, salesNum TEXT, client_id TEXT, menuId TEXT, menuName TEXT,
    qty REAL DEFAULT 0, price REAL DEFAULT 0, discount REAL DEFAULT 0,
    subtotal REAL DEFAULT 0, note TEXT, stationId TEXT, status TEXT,
    promotionVoucherCode TEXT, syncDate TEXT, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_salesmenuextra (
    id TEXT PRIMARY KEY, salesMenuId TEXT, salesNum TEXT, client_id TEXT, extraId TEXT, extraName TEXT,
    qty REAL DEFAULT 0, price REAL DEFAULT 0, subtotal REAL DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_salespayment (
    id TEXT PRIMARY KEY, salesNum TEXT, client_id TEXT, paymentMethod TEXT, paymentType TEXT,
    amount REAL DEFAULT 0, tendered REAL DEFAULT 0, changeAmount REAL DEFAULT 0,
    refNo TEXT, edcBatch TEXT, syncDate TEXT, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_salesvoucherusage (
    id TEXT PRIMARY KEY, salesNum TEXT, client_id TEXT, voucherCode TEXT, voucherAmount REAL DEFAULT 0,
    status TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_salesinfo (
    id TEXT PRIMARY KEY, salesNum TEXT, client_id TEXT, infoKey TEXT, infoValue TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_platformfee (
    id TEXT PRIMARY KEY, salesNum TEXT, client_id TEXT, platform TEXT, feeAmount REAL DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_cancelmenu (
    id TEXT PRIMARY KEY, salesNum TEXT, client_id TEXT, menuId TEXT, menuName TEXT, qty REAL DEFAULT 0,
    reasonId TEXT, reasonNote TEXT, userId TEXT, cancelDate TEXT, syncDate TEXT)`,
  // A5: jejak void-penuh lokal (LOCAL-ONLY, SENGAJA tanpa sync/outbox):
  // head dinolkan saat void penuh sehingga nominal asli hilang dari ledger;
  // arsip ini menyimpan snapshot-nya untuk audit kasir. Idempoten per salesNum
  // (helper memakai INSERT OR REPLACE id `void-{salesNum}`).
  `CREATE TABLE IF NOT EXISTS tr_voidtrail (
    id TEXT PRIMARY KEY, salesNum TEXT, branchId TEXT,
    grandTotal REAL DEFAULT 0, discount REAL DEFAULT 0, service REAL DEFAULT 0,
    feeESB REAL DEFAULT 0, packaging REAL DEFAULT 0, tip REAL DEFAULT 0, ongkir REAL DEFAULT 0,
    reasonId TEXT, reasonNote TEXT, userId TEXT, voidDate TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_shiftlog (
    id TEXT PRIMARY KEY, branchId TEXT, terminalId TEXT, userId TEXT, shiftName TEXT,
    clockIn TEXT, clockOut TEXT, cashInDrawer REAL DEFAULT 0, totalSales REAL DEFAULT 0,
    cashActual REAL DEFAULT 0, cashDiff REAL DEFAULT 0, cashierName TEXT,
    status TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_shiftlogdetail (
    id TEXT PRIMARY KEY, shiftId TEXT, paymentMethod TEXT,
    totalAmount REAL DEFAULT 0, totalTrx INTEGER DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_memberdeposit (
    id TEXT PRIMARY KEY, memberId TEXT, branchId TEXT, trxType TEXT, amount REAL DEFAULT 0,
    balanceAfter REAL DEFAULT 0, userId TEXT, trxDate TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_branchexpense (
    id TEXT PRIMARY KEY, branchId TEXT, coaId TEXT, coaName TEXT, amount REAL DEFAULT 0,
    note TEXT, userId TEXT, expenseDate TEXT, photoPath TEXT, syncDate TEXT, createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_branchexpensedocument (
    id TEXT PRIMARY KEY, expenseId TEXT, docPath TEXT, docType TEXT, syncDate TEXT)`,

  // --- Sync / audit (tanpa syncDate - ini infrastrukturnya) ---
  `CREATE TABLE IF NOT EXISTS tr_sync (
    syncType TEXT PRIMARY KEY, pushDateTime TEXT, pullDateTime TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_esoprocessqueue (
    id TEXT PRIMARY KEY, orderID TEXT, serverID TEXT, tableName TEXT, op TEXT,
    payload TEXT, status TEXT DEFAULT 'antre', createdAt TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_transactionlogapi (
    id TEXT PRIMARY KEY, url TEXT, method TEXT, reqBody TEXT,
    resCode INTEGER DEFAULT 0, resBody TEXT, createdAt TEXT)`,

  // --- Master katalog ---
  `CREATE TABLE IF NOT EXISTS ms_branchmenu (
    branchId TEXT NOT NULL, menuId TEXT NOT NULL, stationId TEXT, qty REAL DEFAULT 0,
    flagSoldOut INTEGER DEFAULT 0, flagActive INTEGER DEFAULT 1, syncDate TEXT,
    PRIMARY KEY (branchId, menuId))`,
  `CREATE TABLE IF NOT EXISTS ms_menu (
    id TEXT PRIMARY KEY, menuName TEXT, categoryId TEXT, price REAL DEFAULT 0,
    imageUrl TEXT, stationId TEXT, flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_category (
    id TEXT PRIMARY KEY, categoryName TEXT, sortOrder INTEGER DEFAULT 0,
    flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_table (
    id TEXT PRIMARY KEY, tableNo TEXT, sectionId TEXT, capacity INTEGER DEFAULT 0,
    status TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_paymentmethod (
    id TEXT PRIMARY KEY, methodName TEXT, methodType TEXT,
    flagActive INTEGER DEFAULT 1, sortOrder INTEGER DEFAULT 0,
    voucherCategoryID TEXT, voucherSourceID TEXT, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_member (
    id TEXT PRIMARY KEY, memberName TEXT, phone TEXT, email TEXT,
    depositBalance REAL DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_voucher (
    id TEXT PRIMARY KEY, voucherCode TEXT, voucherName TEXT, amount REAL DEFAULT 0,
    quota INTEGER DEFAULT 0, validFrom TEXT, validTo TEXT, status TEXT, syncDate TEXT)`,

  // --- REA-15 prioritas murah (dossier Lampiran F.4 antrean 9) ---
  // Catatan jujur: tabel relasional detail gofood/grab (6 tabel) +
  // template/package + 8 tabel promosi + 4 special-price SENGAJA tidak dibuat
  // di sini (berat, butuh kontrak pull dan relasi ke master lain; lihat TODO
  // di bawah). Agregat minimal F9 (ms_promotion, ms_coa, ms_menuonline)
  // dibuat di akhir SCHEMA karena dummy pull + path-nya tersedia.
  `CREATE TABLE IF NOT EXISTS ms_notes (
    id TEXT PRIMARY KEY, noteName TEXT, categoryId TEXT,
    flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_notescategory (
    id TEXT PRIMARY KEY, categoryName TEXT,
    flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_posuseraccess (
    userId TEXT NOT NULL, accessKey TEXT NOT NULL, flagAllow INTEGER DEFAULT 1,
    syncDate TEXT, PRIMARY KEY (userId, accessKey))`,
  `CREATE TABLE IF NOT EXISTS ms_posuserrole (
    id TEXT PRIMARY KEY, roleName TEXT,
    flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_cashmethod (
    id TEXT PRIMARY KEY, methodName TEXT,
    flagActive INTEGER DEFAULT 1, sortOrder INTEGER DEFAULT 0, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS tr_membertransactionlog (
    id TEXT PRIMARY KEY, memberId TEXT, trxType TEXT, amount REAL DEFAULT 0,
    balanceAfter REAL DEFAULT 0, userId TEXT, trxDate TEXT, syncDate TEXT)`,
  // Tiket dapur minimal (REA-FIX-B kitchen): id + salesNum + status + waktu.
  // Sumber mock tetap di data/mock.ts; tabel ini hanya menimpa STATUS
  // yang sudah di-advance agar bertahan saat aplikasi dibuka ulang.
  `CREATE TABLE IF NOT EXISTS tr_kitchenticket (
    id TEXT PRIMARY KEY, ticketNo TEXT, salesNum TEXT, client_id TEXT, status TEXT,
    createdAt TEXT, updatedAt TEXT, syncDate TEXT)`,
  // F9: tabel agregat minimal untuk 3 domain pull kontrak §4 (dummy JSON
  // tersedia). Server menang untuk master (§4): hanya ditulis via pullMaster,
  // tidak pernah di-push (lihat tablePushPath di sync.ts).
  `CREATE TABLE IF NOT EXISTS ms_promotion (
    id TEXT PRIMARY KEY, promoCode TEXT, promoName TEXT, promoType TEXT,
    value REAL DEFAULT 0, maxAmount REAL DEFAULT 0, minSpend REAL DEFAULT 0,
    validFrom TEXT, validTo TEXT, flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_coa (
    id TEXT PRIMARY KEY, coaName TEXT, coaType TEXT,
    flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  `CREATE TABLE IF NOT EXISTS ms_menuonline (
    menuId TEXT PRIMARY KEY, menuName TEXT, price REAL DEFAULT 0,
    stock REAL DEFAULT 0, gofoodId TEXT, grabId TEXT,
    flagActive INTEGER DEFAULT 1, syncDate TEXT)`,
  // Log aplikasi lokal (LogScreen): tulis-lokal saja, tanpa syncDate/push.
  `CREATE TABLE IF NOT EXISTS tr_applog (
    id TEXT PRIMARY KEY, level TEXT, tag TEXT, message TEXT, detail TEXT,
    time TEXT, createdAt TEXT)`,
  // Draft pesanan kasir yang tersimpan lokal (belum jadi tr_saleshead):
  // tulis-lokal, ikut pola syncDate NULL = kotor.
  `CREATE TABLE IF NOT EXISTS tr_draftorder (
    id TEXT PRIMARY KEY, payload TEXT NOT NULL,
    createdAt TEXT, updatedAt TEXT, syncDate TEXT)`,
  // Counter nomor display harian per terminal (Q7, T2-opsi-a): tabel khusus
  // agar transaksional (bukan KV yang bisa dioverwrite pull-server).
  // ymd = kalender lokal YYYYMMDD; sale lewat tengah malam ikut ymd baru
  // dengan shiftId lama tetap menempel (atribusi shift != tanggal nomor).
  `CREATE TABLE IF NOT EXISTS tr_sales_seq (
    terminalCode TEXT NOT NULL, ymd TEXT NOT NULL, lastN INTEGER DEFAULT 0,
    PRIMARY KEY (terminalCode, ymd))`,
  // Antrean cetak persisten (Fase 3 printer lane): HEADER TABEL SAJA di sini;
  // logika drain diimplementasikan lane printer belakangan (jangan drain di
  // lane ini). status: 'antre' | 'cetak' | 'gagal' (kosakata = outbox).
  // C9: 'cetak' warisan — drain kini DELETE saat sukses + menyapu 'cetak' lama;
  // baris hidup hanya antre/gagal. Skema TAK diubah (kompatibel mundur).
  `CREATE TABLE IF NOT EXISTS tr_printqueue (
    id TEXT PRIMARY KEY, payload TEXT, target TEXT,
    status TEXT DEFAULT 'antre', createdAt TEXT)`,
];

/**
 * Migrasi kolom bertahap untuk database lama: satu ADD COLUMN per statement
 * (SQLite tidak mendukung IF NOT EXISTS untuk ADD COLUMN di semua versi,
 * jadi kegagalan "duplicate column" ditelan initDb).
 */
export const MIGRATION_STATEMENTS: string[] = [
  'ALTER TABLE tr_saleshead ADD COLUMN ongkir REAL DEFAULT 0',
  // Kemasan per bill (A2): aditif untuk instalasi lama (gagal = sudah ada).
  // Menempel pada bill cermin ongkir/tip — pindah item tak memindahkannya.
  'ALTER TABLE tr_saleshead ADD COLUMN packaging REAL DEFAULT 0',
  'ALTER TABLE tr_salesvoucherusage ADD COLUMN voucherAmount REAL DEFAULT 0',
  'ALTER TABLE tr_shiftlog ADD COLUMN cashActual REAL DEFAULT 0',
  'ALTER TABLE tr_shiftlog ADD COLUMN cashDiff REAL DEFAULT 0',
  'ALTER TABLE tr_shiftlog ADD COLUMN cashierName TEXT',
  // REA-15: kolom promo + autocut untuk instalasi lama (gagal = sudah ada).
  'ALTER TABLE tr_saleshead ADD COLUMN promotionVoucherCode TEXT',
  'ALTER TABLE tr_salesmenu ADD COLUMN promotionVoucherCode TEXT',
  'ALTER TABLE ms_paymentmethod ADD COLUMN voucherCategoryID TEXT',
  'ALTER TABLE ms_paymentmethod ADD COLUMN voucherSourceID TEXT',
  'ALTER TABLE ms_station ADD COLUMN flagAutocut INTEGER DEFAULT 1',
  // #18: atribusi shift per penjualan untuk instalasi lama (gagal = sudah ada).
  'ALTER TABLE tr_saleshead ADD COLUMN shiftId TEXT',
  // Tip pelanggan per sale (fitur tip v1, 2026-10): aditif untuk instalasi
  // lama (gagal = sudah ada). Grand total sudah termasuk tip sehingga ledger
  // lama tetap balance; kolom ini untuk rincian struk/riwayat/sync.
  'ALTER TABLE tr_saleshead ADD COLUMN tip REAL DEFAULT 0',
  // Q7: client_id UUIDv7 aditif untuk instalasi lama (gagal = sudah ada).
  'ALTER TABLE tr_saleshead ADD COLUMN client_id TEXT',
  // Q7: client_id NULL-able cadangan di tabel anak sale (gagal = sudah ada).
  'ALTER TABLE tr_salesmenu ADD COLUMN client_id TEXT',
  'ALTER TABLE tr_salesmenuextra ADD COLUMN client_id TEXT',
  'ALTER TABLE tr_salespayment ADD COLUMN client_id TEXT',
  'ALTER TABLE tr_salesvoucherusage ADD COLUMN client_id TEXT',
  'ALTER TABLE tr_salesinfo ADD COLUMN client_id TEXT',
  'ALTER TABLE tr_platformfee ADD COLUMN client_id TEXT',
  'ALTER TABLE tr_cancelmenu ADD COLUMN client_id TEXT',
  'ALTER TABLE tr_kitchenticket ADD COLUMN client_id TEXT',
  // Backfill deterministik: baris lama client_id = salesNum (unik karena PK,
  // stabil lintas-retry). Baris baru selalu UUIDv7 dari saveSale.
  'UPDATE tr_saleshead SET client_id = salesNum WHERE client_id IS NULL',
  // Indeks client_id untuk upsert/pull-by-client: di MIGRASI (best-effort),
  // bukan skema — loop skema initDb tanpa try/catch, sehingga CREATE INDEX
  // atas kolom yang belum ada di instalasi lama melempar dan mem-brick
  // seluruh initDb. Di sini kolom sudah ADD + backfill; UNIQUE aman karena
  // backfill menyalin salesNum (PK, unik). Gagal = sudah ada.
  `CREATE INDEX IF NOT EXISTS idx_saleshead_client ON tr_saleshead(client_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_saleshead_client_unique ON tr_saleshead(client_id)`,
  // M1 (loyalty): email capture member untuk instalasi lama (gagal = sudah ada).
  'ALTER TABLE ms_member ADD COLUMN email TEXT',
  // A5: tabel arsip void-penuh lokal untuk instalasi lama (IF NOT EXISTS =
  // idempoten; gagal = sudah ada).
  `CREATE TABLE IF NOT EXISTS tr_voidtrail (
    id TEXT PRIMARY KEY, salesNum TEXT, branchId TEXT,
    grandTotal REAL DEFAULT 0, discount REAL DEFAULT 0, service REAL DEFAULT 0,
    feeESB REAL DEFAULT 0, packaging REAL DEFAULT 0, tip REAL DEFAULT 0, ongkir REAL DEFAULT 0,
    reasonId TEXT, reasonNote TEXT, userId TEXT, voidDate TEXT, syncDate TEXT)`,
];
