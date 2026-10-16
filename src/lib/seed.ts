/**
 * Seed lokal sekali-jalan untuk fondasi offline (tanpa server).
 *
 * ensureSeeded(): initDb dulu, cek flag ms_setting(key1='seed',
 * key2='local', value1) — bila sudah '1' langsung return. Bila belum,
 * isi master minimal + user admin lokal (PIN 1234 via savePinHash),
 * lalu set flag seed=1. Semua INSERT OR IGNORE agar aman jalan ulang.
 *
 * Pengecualian: 6 CoA expense di ms_coa disisip TANPA gate flag (jalan
 * tiap panggil) agar DB lama yang sudah flag seed=1 tetap dapat CoA.
 *
 * Nama kolom diambil verbatim dari SCHEMA di lib/db.ts (ms_posuser tidak
 * punya kolom nama/flagActive; ms_setting memakai value1/value2).
 */
import { initDb, queryFirst, run } from './db';
import { savePinHash } from './pin';

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
  const roles: Array<[string, string]> = [
    ['admin', 'admin'],
    ['kasir', 'kasir'],
    ['supervisor', 'supervisor'],
  ];
  for (const [id, name] of roles) {
    await run(
      `INSERT OR IGNORE INTO ms_posuserrole (id, roleName, flagActive)
       VALUES (?, ?, 1)`,
      [id, name],
    );
  }

  // Admin lokal: satu baris wildcard allow-all (dibaca access.ts hasAccess).
  await run(
    `INSERT OR IGNORE INTO ms_posuseraccess (userId, accessKey, flagAllow)
     VALUES ('u-admin', '*', 1)`,
  );

  // Kunci aksi sensitif yang deny-nya dimiliki peran kasir dan allow-nya
  // dimiliki peran supervisor (PIN-override). Baris peran (userId = nama
  // peran) adalah template default offline: access.ts jatuh kembali dari
  // userId ke peran bila user tak punya baris sendiri.
  const sensitiveKeys = ['order.void', 'order.cancel', 'sale.refund', 'settings.edit'];
  for (const k of sensitiveKeys) {
    await run(
      `INSERT OR IGNORE INTO ms_posuseraccess (userId, accessKey, flagAllow)
       VALUES ('kasir', ?, 0)`,
      [k],
    );
  }
  for (const k of sensitiveKeys) {
    await run(
      `INSERT OR IGNORE INTO ms_posuseraccess (userId, accessKey, flagAllow)
       VALUES ('supervisor', ?, 1)`,
      [k],
    );
  }

  // Pastikan baris admin lokal ber-role admin (DB lama mungkin berbeda).
  await run(`UPDATE ms_posuser SET role = 'admin' WHERE id = 'u-admin'`);

  const flag = await queryFirst<{ value1: string | null }>(
    `SELECT value1 FROM ms_setting WHERE key1 = 'seed' AND key2 = 'local' LIMIT 1`,
  );
  if (flag?.value1 === '1') return;

  // Pajak PPN 11% (ms_setting: key1, key2, value1, value2, syncDate).
  await run(
    `INSERT OR IGNORE INTO ms_setting (key1, key2, value1) VALUES ('Tax', 'PPN', '11')`,
  );

  // Satu user admin lokal (ms_posuser: id, username, pinHash, password,
  // authKey, branchId, role, syncDate). PIN disimpan sebagai hash via
  // SecureStore/AsyncStorage, bukan di kolom DB.
  await run(
    `INSERT OR IGNORE INTO ms_posuser (id, username, branchId, role)
     VALUES ('u-admin', 'admin', 'B001', 'admin')`,
  );
  await savePinHash('u-admin', '1234');

  // 3 kategori (ms_category: id, categoryName, sortOrder, flagActive, syncDate).
  const cats: Array<[string, string, number]> = [
    ['c-makanan', 'Makanan', 1],
    ['c-minuman', 'Minuman', 2],
    ['c-snack', 'Snack', 3],
  ];
  for (const [id, name, sort] of cats) {
    await run(
      `INSERT OR IGNORE INTO ms_category (id, categoryName, sortOrder, flagActive)
       VALUES (?, ?, ?, 1)`,
      [id, name, sort],
    );
  }

  // 12 menu + relasi cabang B001 (ms_menu: id, menuName, categoryId, price,
  // imageUrl, stationId, flagActive, syncDate; ms_branchmenu: branchId,
  // menuId, stationId, qty, flagSoldOut, flagActive, syncDate).
  for (const m of SEED_MENUS) {
    await run(
      `INSERT OR IGNORE INTO ms_menu (id, menuName, categoryId, price, flagActive)
       VALUES (?, ?, ?, ?, 1)`,
      [m.id, m.name, m.cat, m.price],
    );
    await run(
      `INSERT OR IGNORE INTO ms_branchmenu (branchId, menuId, flagActive)
       VALUES ('B001', ?, 1)`,
      [m.id],
    );
  }

  // 9 meja (ms_table: id, tableNo, sectionId, capacity, status, syncDate).
  for (const t of SEED_TABLES) {
    await run(`INSERT OR IGNORE INTO ms_table (id, tableNo) VALUES (?, ?)`, [t, t]);
  }

  // 4 metode bayar (ms_paymentmethod: id, methodName, methodType,
  // flagActive, sortOrder, voucherCategoryID, voucherSourceID, syncDate).
  for (const p of SEED_PAYMENTS) {
    await run(
      `INSERT OR IGNORE INTO ms_paymentmethod (id, methodName, methodType, flagActive, sortOrder)
       VALUES (?, ?, ?, 1, ?)`,
      [p.id, p.name, p.type, p.order],
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
