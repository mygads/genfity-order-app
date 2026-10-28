/**
 * Tarik master dari server ke SQLite (kontrak §4 + §8).
 * Per domain: baca watermark pull → GET ?since&limit → upsert
 * (INSERT OR REPLACE, syncDate = waktu pull = bersih) → tulis watermark.
 * Server menang untuk master; hanya jalan saat base URL terisi.
 */
import { ApiPath, apiGet, getBaseUrl, getBranchId, getServerEnv } from '../config/server';
import { getApiMode } from './apiSource';
import { initDb, queryFirst, run } from './db';
import { getWatermark, setWatermark } from './sync';
import { getItem, setItem } from './storage';
import { GoCatalogUnavailable, pullGoCatalog } from './masterGo';
import { BE_PULL_KEYS, pullBeDomain, type BePullKey } from './masterBe';

type Row = Record<string, string | number | null>;

interface Domain {
  key: string;
  path: string;
  table: string;
  cols: string[];
  map: (r: Row) => (string | number | null)[];
  /** Klausa ON CONFLICT kustom; default INSERT OR REPLACE. */
  upsert?: string;
  /** INSERT OR IGNORE bila true (lindungi baris lokal: penjualan). */
  ignoreExisting?: boolean;
  /** Lewati baris bila kolom pertama hasil map kosong. */
  requireFirst?: boolean;
  /** Hook pasca-baris (mis. menu: soldOut -> ms_branchmenu). */
  after?: (r: Row, now: string) => Promise<void>;
}

const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

const flag = (v: unknown, d = 1): number => (v === undefined || v === null ? d : Number(v) ? 1 : 0);

const DOMAINS: Domain[] = [
  {
    key: 'menu',
    path: ApiPath.pullMenu,
    table: 'ms_menu',
    cols: ['id', 'menuName', 'categoryId', 'price', 'imageUrl', 'stationId', 'flagActive'],
    map: (r) => [str(r.menuId) ?? '', str(r.name), str(r.categoryId), num(r.price), str(r.imageUrl), str(r.stationId), flag(r.flagActive)],
    requireFirst: true,
    // Field soldOut kontrak §4 JANGAN dibuang: cerminkan ke flagSoldOut
    // ms_branchmenu. qty tidak disentuh (domain branchmenu yang mengisinya).
    // L20: hook ikut menyegarkan flagActive (dulu hanya flagSoldOut —
    // menu yang dinonaktifkan server tetap tampil aktif selamanya).
    after: async (r, now) => {
      const menuId = str(r.menuId) ?? '';
      if (!menuId) return;
      const sold = flag(r.soldOut, 0);
      await run(
        `INSERT INTO ms_branchmenu (branchId, menuId, qty, flagSoldOut, flagActive, syncDate)
         VALUES (?, ?, 0, ?, ?, ?)
         ON CONFLICT (branchId, menuId) DO UPDATE SET flagSoldOut = excluded.flagSoldOut, flagActive = excluded.flagActive`,
        [getBranchId(), menuId, sold, flag(r.flagActive), now],
      );
    },
  },
  {
    key: 'branchmenu',
    path: ApiPath.pullBranchMenu,
    table: 'ms_branchmenu',
    cols: ['branchId', 'menuId', 'stationId', 'qty', 'flagSoldOut', 'flagActive'],
    map: (r) => [str(r.branchId) ?? '', str(r.menuId) ?? '', str(r.stationId), num(r.qty), flag(r.flagSoldOut, 0), flag(r.flagActive)],
  },
  {
    key: 'branchsettings',
    path: ApiPath.pullBranchSettings,
    table: 'ms_setting',
    cols: ['key1', 'key2', 'value1', 'value2'],
    map: (r) => [str(r.key1) ?? '', str(r.key2) ?? '', str(r.value1), str(r.value2)],
    requireFirst: true,
  },
  {
    key: 'user',
    path: ApiPath.pullUser,
    table: 'ms_posuser',
    cols: ['id', 'username', 'branchId', 'role'],
    map: (r) => [str(r.userId) ?? '', str(r.username), str(r.branchId), str(r.role)],
    requireFirst: true,
    // Upsert parsial: JANGAN timpa authKey lokal. R34: kolom legacy
    // pinHash/password sengaja di-NULL-kan tiap pull (belt-and-suspenders
    // bila server kelak menggemakan nilai lama) — verifikasi PIN murni via
    // hash SecureStore (lib/pin.ts).
    upsert: 'ON CONFLICT(id) DO UPDATE SET username = excluded.username, branchId = excluded.branchId, role = excluded.role, pinHash = NULL, password = NULL, syncDate = excluded.syncDate',
  },
  {
    // RBAC: hak akses per user dari server (kontrak clean-room
    // main/get-user-access). Server menang (INSERT OR REPLACE default);
    // baris template peran lokal ('Merchant Owner'/'Merchant Staff' dari
    // seed, dibaca access.ts via normalizeRole) aman karena server hanya
    // mengirim userId asli.
    key: 'useraccess',
    path: ApiPath.pullUserAccess,
    table: 'ms_posuseraccess',
    cols: ['userId', 'accessKey', 'flagAllow'],
    map: (r) => [str(r.userId) ?? '', str(r.accessKey ?? r.key), flag(r.flagAllow, 1)],
    requireFirst: true,
  },
  {
    key: 'table',
    path: ApiPath.pullTable,
    table: 'ms_table',
    cols: ['id', 'tableNo', 'sectionId', 'capacity', 'status'],
    map: (r) => [str(r.tableId) ?? '', str(r.tableNo), str(r.section), num(r.capacity), str(r.status)],
  },
  {
    key: 'station',
    path: ApiPath.pullStation,
    table: 'ms_station',
    cols: ['id', 'stationName', 'printerName', 'connection', 'printerType', 'charPerLine', 'flagDefault', 'flagActive'],
    map: (r) => [str(r.stationId ?? r.id) ?? '', str(r.stationName), str(r.printerName), str(r.connection), str(r.printerType), num(r.charPerLine, 32), flag(r.flagDefault, 0), flag(r.flagActive)],
    // Upsert parsial: alamat printer (printerPort = MAC BT / IP:port LAN) dan
    // pilihan connection/autocut adalah konfigurasi PER-TERMINAL milik layar
    // Printer (PrintersScreen.persistStation) - server tak tahu MAC BT tablet
    // ini. Pull hanya memperbarui kolom milik server agar alamat lokal tak
    // terhapus (INSERT OR REPLACE polos akan me-NULL-kan printerPort).
    upsert: 'ON CONFLICT(id) DO UPDATE SET stationName = excluded.stationName, printerName = excluded.printerName, printerType = excluded.printerType, charPerLine = excluded.charPerLine, flagDefault = excluded.flagDefault, flagActive = excluded.flagActive, syncDate = excluded.syncDate',
  },
  {
    key: 'paymentmethod',
    path: ApiPath.pullPaymentMethod,
    table: 'ms_paymentmethod',
    cols: ['id', 'methodName', 'methodType', 'flagActive', 'sortOrder'],
    map: (r) => [str(r.methodId ?? r.id) ?? '', str(r.name), str(r.type), flag(r.flagActive), num(r.sortOrder)],
  },
  {
    key: 'member',
    path: ApiPath.pullMember,
    table: 'ms_member',
    cols: ['id', 'memberName', 'phone', 'depositBalance'],
    map: (r) => [str(r.memberId) ?? '', str(r.name), str(r.phoneMasked ?? r.phone), num(r.balance ?? r.depositBalance)],
    // L21: server menang KECUALI dua lindung lokal —
    // (a) saldo: baris lokal syncDate NULL (topup/burn belum push) MEMPERTAHANKAN
    //     depositBalance + tetap kotor (syncDate NULL) agar push berikutnya
    //     mengirimnya; saldo server hanya menang untuk baris bersih;
    // (b) telepon: nomor masuk yang tampak termask (karakter mask *, x, • —
    //     format phoneMasked server; dummy "0812-3456-7890" bertanda strip
    //     TAPI berdigit penuh sehingga lolos sebagai nomor nyata) atau yang
    //     digitnya LEBIH SEDIKIT dari lokal tak menimpa nomor lokal yang
    //     lebih lengkap. Nama selalu ikut server.
    upsert: `ON CONFLICT(id) DO UPDATE SET
      memberName = excluded.memberName,
      phone = CASE
        WHEN excluded.phone LIKE '%*%' OR excluded.phone LIKE '%x%'
          OR excluded.phone LIKE '%X%' OR excluded.phone LIKE '%•%' THEN ms_member.phone
        WHEN ms_member.phone IS NOT NULL AND ms_member.phone <> ''
          AND length(replace(replace(replace(replace(excluded.phone, ' ', ''), '-', ''), '+', ''), '.', ''))
            < length(replace(replace(replace(replace(ms_member.phone, ' ', ''), '-', ''), '+', ''), '.', '')) THEN ms_member.phone
        ELSE excluded.phone END,
      depositBalance = CASE WHEN ms_member.syncDate IS NULL THEN ms_member.depositBalance ELSE excluded.depositBalance END,
      syncDate = CASE WHEN ms_member.syncDate IS NULL THEN NULL ELSE excluded.syncDate END`,
  },
  {
    key: 'voucher',
    path: ApiPath.pullVoucher,
    table: 'ms_voucher',
    cols: ['id', 'voucherCode', 'voucherName', 'amount', 'quota', 'validFrom', 'validTo', 'status'],
    map: (r) => [
      str(r.voucherId) ?? '', str(r.code), str(r.name), num(r.amount), num(r.quota),
      str(r.validFrom), str(r.validTo), str(r.status),
    ],
    requireFirst: true,
    // L10: REPLACE server HANYA bila tak ada burn lokal yang belum push
    // (syncDate NULL = kuota lokal sudah turun via saveSale/append dan wajib
    // ikut push dulu). Bila burn lokal menggantung: deskriptif (nama/amount/
    // jendela) ikut server, TAPI quota + status + syncDate lokal dipertahankan
    // (tetap kotor) dan konflik dicatat jujur di log — pull berikutnya setelah
    // push akan menyelaraskan. Tanpa ini pull menimpa kuota yang sudah
    // terbakar offline sehingga voucher bisa dipakai ulang tanpa batas.
    upsert: `ON CONFLICT(id) DO UPDATE SET
      voucherCode = excluded.voucherCode, voucherName = excluded.voucherName,
      amount = excluded.amount, validFrom = excluded.validFrom, validTo = excluded.validTo,
      quota = CASE WHEN ms_voucher.syncDate IS NULL THEN ms_voucher.quota ELSE excluded.quota END,
      status = CASE WHEN ms_voucher.syncDate IS NULL THEN ms_voucher.status ELSE excluded.status END,
      syncDate = CASE WHEN ms_voucher.syncDate IS NULL THEN NULL ELSE excluded.syncDate END`,
    // L10 (lanjutan): catat konflik secara jujur — baris yang tetap kotor
    // setelah upsert = burn lokal belum push yang dipertahankan.
    after: async (r) => {
      try {
        const id = str(r.voucherId) ?? '';
        if (!id) return;
        const row = await queryFirst<{ syncDate: string | null }>(
          'SELECT syncDate FROM ms_voucher WHERE id = ? LIMIT 1',
          [id],
        );
        if (row && row.syncDate === null) {
          console.warn(`[pull-voucher] burn lokal belum push dipertahankan: ${id}`);
        }
      } catch {
        /* abaikan */
      }
    },
  },
  {
    key: 'sales',
    path: ApiPath.pullSales,    table: 'tr_saleshead',
    cols: ['salesNum', 'client_id', 'branchId', 'terminalId', 'userId', 'salesDate', 'salesMode', 'tableNo',
      'customerName', 'subtotal', 'discount', 'tax', 'serviceCharge', 'tip', 'voucherAmount', 'voucherCode',
      'platformFee', 'rounding', 'grandTotal', 'paidAmount', 'changeAmount', 'paymentMethod',
      'ongkir', 'status', 'memberId', 'shiftId', 'queueNumber'],
    map: (r) => {
      // client_id kosong dari server (riwayat lama/terminal lain/BE yang belum
      // upsert-by-client) dinormalisasi ke salesNum — cermin backfill lokal di
      // dbSchema. Tanpa ini semua baris tanpa client_id memetakan ke '' dan
      // baris ke-2 dst lenyap diam-diam oleh UNIQUE(client_id)+OR IGNORE.
      const no = str(r.salesNum) ?? '';
      const cid = str(r.client_id ?? r.clientId) ?? '';
      return [
      no, cid || no, str(r.branchId), str(r.terminalId), str(r.userId),
      str(r.salesDate), str(r.salesMode), str(r.tableNo), str(r.customerName),
      num(r.subtotal), num(r.discount), num(r.tax), num(r.serviceCharge),
      // Tip v1 (kolom pull 2026-10): server lama tak mengirim = 0 via num();
      // baris tip dari server lain (online order) ikut tersimpan untuk struk.
      num((r.tip ?? r.tipAmount)),
      num(r.voucherAmount), str(r.voucherCode), num(r.platformFee), num(r.rounding),
      num(r.grandTotal), num(r.paidAmount), num(r.changeAmount), str(r.paymentMethod),
      num(r.ongkir), str(r.status) ?? 'paid',
      // L19: identitas + antrean ikut pull (kolom sudah ada di skema head).
      str(r.memberId), str(r.shiftId), str(r.queueNumber),
      ];
    },
    requireFirst: true,
    // INSERT OR IGNORE: nomor lokal bisa tabrakan dengan nomor server;
    // baris lokal (terutama yang syncDate NULL / belum push) tidak boleh
    // tertimpa riwayat pull. client_id ikut tersimpan (Q7, upsert-by-client
    // sisi server); kontrak konflik: duplikat client_id kembali 200 "Order
    // already synced" (jalur 2xx → terkirim), 409 HANYA SALE_DISPLAY_CONFLICT
    // (display_no dipakai order lain — server tak punya baris kita; re-issue
    // + kirim ulang di sync.ts, tak pernah terkirim diam-diam). Sampai BE
    // final, mode transisi terima-dua-format.
    ignoreExisting: true,
    after: async (r, now) => {
      const salesNum = str(r.salesNum) ?? '';
      if (!salesNum) return;
      // L19: anak pull memakai client_id head (normalisasi yang sama dengan
      // map di atas) agar join server-by-client konsisten.
      const headCid = str(r.client_id ?? r.clientId) || salesNum;
      const raw = (r as unknown as { items?: unknown }).items;
      if (!Array.isArray(raw)) return;
      let idx = 0;
      for (const it of raw) {
        const m = it as Row;
        const menuId = str(m.menuId) ?? '';
        if (!menuId) continue;
        const qty = num(m.qty, 1);
        const price = num((m.unitPrice ?? m.price) as unknown as string | number | null);
        const disc = num(m.discount);
        await run(
          `INSERT OR IGNORE INTO tr_salesmenu
           (id, salesNum, client_id, menuId, menuName, qty, price, discount, subtotal, note, syncDate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`${salesNum}:i${idx}`, salesNum, headCid, menuId, str(m.name),
            qty, price, disc, qty * price - disc, str(m.note), now],
        );
        idx += 1;
      }
    },
  },
  {
    // REA-11: log shift dari server (kontrak §4.1).
    key: 'shiftlog',
    path: ApiPath.pullShiftLog,
    table: 'tr_shiftlog',
    cols: ['id', 'branchId', 'terminalId', 'userId', 'shiftName', 'clockIn', 'clockOut',
      'cashInDrawer', 'totalSales', 'cashActual', 'cashDiff', 'status'],
    map: (r) => [
      str(r.shiftId ?? r.id) ?? '', str(r.branchId), str(r.terminalId), str(r.userId),
      str(r.shiftName), str(r.clockIn), str(r.clockOut),
      num(r.cashInDrawer ?? r.startCash), num(r.totalSales),
      num(r.cashActual ?? r.endCash), num(r.cashDiff ?? r.diff),
      str(r.status) ?? 'OPEN',
    ],
    requireFirst: true,
    // INSERT OR IGNORE seperti sales: baris shift lokal (terutama yang masih
    // OPEN / syncDate NULL) tidak boleh tertimpa riwayat pull.
    ignoreExisting: true,
  },
  {
    // REA-12: setting per terminal (kontrak §4.2). Server menang; baris klaim
    // lokal ('flagClaimed') aman karena server tak mengirim settingKey itu.
    key: 'terminalsettings',
    path: ApiPath.pullTerminalSettings,
    table: 'ms_terminalsetting',
    cols: ['terminalId', 'settingKey', 'settingValue', 'flag'],
    map: (r) => [
      str(r.terminalId) ?? '', str(r.settingKey) ?? '',
      str(r.settingValue), flag(r.flag, 0),
    ],
    requireFirst: true,
  },
  {
    // F9: promosi (kontrak §4; path FAKTA main/get-promotion + dummy tersedia).
    // Server menang; kolom type/value/maxAmount/minSpend/validitas dipakai
    // layar kasir untuk validasi voucher/promo lokal.
    key: 'promotion',
    path: ApiPath.pullPromotion,
    table: 'ms_promotion',
    cols: ['id', 'promoCode', 'promoName', 'promoType', 'value', 'maxAmount',
      'minSpend', 'validFrom', 'validTo', 'flagActive'],
    map: (r) => [
      str(r.promoId) ?? '', str(r.code), str(r.name), str(r.type),
      num(r.value), num(r.maxAmount), num(r.minSpend),
      str(r.validFrom), str(r.validTo), flag(r.flagActive),
    ],
    requireFirst: true,
  },
  {
    // F9: bagan akun biaya (path FAKTA v1/pull/expense-chart-of-accounts +
    // dummy tersedia). Dipakai ExpenseScreen sebagai daftar akun.
    key: 'expensecoa',
    path: ApiPath.pullExpenseCoa,
    table: 'ms_coa',
    cols: ['id', 'coaName', 'coaType', 'flagActive'],
    map: (r) => [str(r.coaId) ?? '', str(r.coaName), str(r.type), flag(r.flagActive)],
    requireFirst: true,
  },
  {
    // F9: mapping menu online gofood/grab (path FAKTA
    // v1/pull/get-menu-online + dummy tersedia).
    key: 'menuonline',
    path: ApiPath.pullMenuOnline,
    table: 'ms_menuonline',
    cols: ['menuId', 'menuName', 'price', 'stock', 'gofoodId', 'grabId', 'flagActive'],
    map: (r) => [
      str(r.menuId) ?? '', str(r.name), num(r.price), num(r.stock),
      str(r.gofoodId), str(r.grabId), flag(r.flagActive),
    ],
    requireFirst: true,
  },
];

// ---------------------------------------------------------------------------
// Referensi REA-16/REA-17 untuk pemilik layar (tidak dipakai master.ts).
// ---------------------------------------------------------------------------

/** [FAKTA] 9 acquirer QRIS dari string pool APK (REA-17). */
export const QRIS_ACQUIRERS = [
  'qrisbni', 'qrisbri', 'qriscimb', 'qrisdki', 'qrisesb',
  'qrisgpay', 'qrisnobu', 'qrisshopee', 'qrisyukk',
] as const;

/** [FAKTA] kunci prefs native dari classes.dex (REA-16). */
export const NATIVE_PREF_KEYS = {
  bluetoothPrinter: 'bluetooth_printer',
  usbPrinter: 'usb_printer',
  bcaApos: 'bca_apos',
  bcaAposCallback: 'bca_apos_callback',
  cameraCheck: 'camera_check',
  autoTimeCheck: 'check_auto_time_setting',
  uvcScanner: 'usb_uvc_scanner',
} as const;
// TODO(QrisScreen, pemilik layar payment): pakai QRIS_ACQUIRERS + key i18n
// qris_acq_* untuk label metode bayar.
// TODO(PrintersScreen/EdcScreen, pemilik layar settings/payment): pakai
// NATIVE_PREF_KEYS untuk modul EDC/printer native.

// F9 SELESAI: 3 domain kontrak §4 yang tabelnya belum ada kini ditarik via
// tabel agregat minimal (CREATE TABLE IF NOT EXISTS di db.ts, aman untuk DB
// lama tanpa migrasi kolom):
// - promotion -> ms_promotion (path FAKTA main/get-promotion)
// - expense-chart-of-accounts -> ms_coa (path FAKTA
//   v1/pull/expense-chart-of-accounts)
// - menu-online -> ms_menuonline (path FAKTA v1/pull/get-menu-online)
// FORCE_PULL {domains: ['promotion'|'expensecoa'|'menuonline']} menjemputnya
// otomatis. Tabel relasional detail (8 ms_promotion_*, 6 gofood/grab,
// template/package, 4 special-price) tetap SENGAJA tidak dibuat (REA-15).

function rowsOf(body: unknown): Row[] {
  if (Array.isArray(body)) return body as Row[];
  if (body && typeof body === 'object') {
    const b = body as { ok?: boolean; data?: unknown };
    if (Array.isArray(b.data)) return b.data as Row[];
    const d = b.data as { items?: unknown };
    if (d && Array.isArray(d.items)) return d.items as Row[];
  }
  return [];
}

export interface PullResult {
  total: number;
  per: Record<string, number>;
  /** Domain ESB-legacy yang 404 di backend Go (kontrak tak ada) — dilewati
   * eksplisit, bukan gagal. Diisi hanya bila katalog Go terbukti (goOk). */
  skipped: string[];
  at: string;
}

/**
 * Tarik semua domain master - HANYA ke server milik sendiri (env Custom)
 * DAN hanya dalam Real Mode (EXPO_PUBLIC_API_BASE_URL terisi).
 * Bila mode BUKAN 'real' (local/dummy), kembalikan hasil kosong TANPA
 * menulis apa pun ke SQLite - dummy pull tidak boleh mengotori seed/data
 * asli. Guard ini sekaligus melindungi semua pemanggil (Settings/Sync
 * manual, terminal.ts syncTerminalSettings) tanpa mengubah file mereka.
 * Melempar bila bukan Custom / respons cacat (hanya di Real Mode).
 * Bila `only` diisi (mis. dari WS FORCE_PULL {domains}), hanya domain
 * bernama itu yang ditarik; nama tak dikenal (mis. promotion yang tabelnya
 * belum ada, lihat TODO M9-4) diabaikan diam-diam.
 */
export async function pullMaster(only?: string[]): Promise<PullResult> {
  if (getApiMode() !== 'real') {
    return { total: 0, per: {}, skipped: [], at: new Date().toISOString() };
  }
  if (getServerEnv() !== 'custom' || !getBaseUrl()) {
    throw new Error('Pilih Server Custom (milik sendiri) di Pengaturan sebelum sync.');
  }
  await initDb();
  // P0-2 audit paritas: domain katalog (menu, branchmenu) diutamakan ke
  // kontrak Go (/pos/menu) agar harga/stok tak basi vs backend Go. Bila BE
  // bukan Go (404) → jatuh kembali ke domain ESB di bawah. Watermark
  // 'menu'/'branchmenu' dipakai bersama oleh kedua jalur.
  const per: Record<string, number> = {};
  const skipped: string[] = [];
  let targets = !only || only.length === 0
    ? DOMAINS
    : DOMAINS.filter((d) => only.includes(d.key));
  const goTargets = targets.filter((d) => d.key === 'menu' || d.key === 'branchmenu');
  // E2E-HP (2026-10-26): bukti backend adalah Go (katalog Go sukses) —
  // prasyarat melewati domain ESB-legacy yang 404 (kontrak tak ada).
  let goOk = false;
  if (goTargets.length > 0) {
    try {
      const go = await pullGoCatalog();
      Object.assign(per, go.per);
      goOk = true;
      targets = targets.filter((d) => d.key !== 'menu' && d.key !== 'branchmenu' && d.key !== 'branchsettings');
    } catch (e) {
      if (!(e instanceof GoCatalogUnavailable)) throw e;
      // Bukan backend Go — lanjut jalur ESB seperti semula.
    }
  }
  const beKeys = BE_PULL_KEYS as readonly string[];
  for (const d of targets) {
    // PULLMASTER-6DOMAIN (2026-10-27): backend terbukti Go (goOk) -> domain
    // table/promotion/member/voucher/expensecoa DITARIK via adapter BE nyata
    // (lib/masterBe.ts), BUKAN path ESB-legacy (main/get-*, v1/pull/*) yang
    // 404 di BE Go. missing-endpoint (fallback bila BE lama tanpa rute,
    // mis. expensecoa pra-F-016) dicatat ke `skipped` + warn (tripwire),
    // bukan gagal. Tanpa goOk (BE
    // bukan Go) alur legacy di bawah tak berubah.
    if (goOk && beKeys.includes(d.key)) {
      const r = await pullBeDomain(d.key as BePullKey);
      if (r.status === 'missing-endpoint' || r.status === 'forbidden') {
        skipped.push(`${d.key}(${r.status}${r.note ? `: ${r.note}` : ''})`);
        continue;
      }
      per[d.key] = r.count;
      continue;
    }
    const wm = await getWatermark(d.key);
    const res = await apiGet(d.path, { ...(wm.pull ? { since: wm.pull } : {}), limit: 200 });
    if (!res.ok) {
      // E2E-HP (2026-10-26): backend Go tak punya endpoint ESB-legacy
      // (main/..., esb_api/..., v1/pull/...) → 404 = kontrak tak ada, BUKAN
      // data rusak. ms_setting sudah diisi jalur Go (masterGo menulis
      // Branch/Currency, Tax/PPN, Packaging/Fee, Service, Rounding), jadi
      // branchsettings dilewati di atas tanpa kehilangan data. Domain lain
      // yang 404 ikut dilewati eksplisit + tercatat; 5xx/jaringan/parse
      // tetap melempar (fail-closed). Pull eksplisit per-domain (`only`,
      // mis. terminalsettings) tanpa bukti Go tetap ketat seperti semula.
      if (res.status === 404 && goOk) {
        skipped.push(d.key);
        continue;
      }
      throw new Error(`Pull ${d.key}: HTTP ${res.status}`);
    }
    const rows = rowsOf(await res.json());
    const now = new Date().toISOString();
    const marks = d.cols.map(() => '?').join(', ');
    for (const r of rows) {
      const mapped = d.map(r);
      if (d.requireFirst && !mapped[0]) continue;
      if (d.upsert) {
        await run(
          `INSERT INTO "${d.table}" (${d.cols.join(', ')}, syncDate) VALUES (${marks}, ?) ${d.upsert}`,
          [...mapped, now],
        );
      } else if (d.ignoreExisting) {
        await run(
          `INSERT OR IGNORE INTO "${d.table}" (${d.cols.join(', ')}, syncDate) VALUES (${marks}, ?)`,
          [...mapped, now],
        );
      } else {
        await run(
          `INSERT OR REPLACE INTO "${d.table}" (${d.cols.join(', ')}, syncDate) VALUES (${marks}, ?)`,
          [...mapped, now],
        );
      }
      if (d.after) {
        try {
          await d.after(r, now);
        } catch {
          /* hook tambahan gagal - baris utama tetap tersimpan */
        }
      }
    }
    per[d.key] = rows.length;
    await setWatermark(d.key, { pull: now });
  }
  const total = Object.values(per).reduce((a, b) => a + b, 0);
  const at = new Date().toISOString();
  // W-FULL §14: stempel pull-otomatis (boot/reconnect/manual) agar layar Sync
  // tak lagi "Last pull: Never" walau pull sukses — pull manual doPull tetap
  // menimpa labelnya sendiri seperti semula.
  void setItem(LS_LAST_PULL_OK, at).catch(() => {});
  return { total, per, skipped, at };
}

/** Kunci stempel pull-master terakhir yang sukses (otomatis maupun manual). */
const LS_LAST_PULL_OK = 'genfity.sync.lastPullOk';

/** Baca stempel pull-master terakhir yang sukses (ISO); null bila belum pernah. */
export async function getLastPullOk(): Promise<string | null> {
  try {
    return await getItem(LS_LAST_PULL_OK);
  } catch {
    return null;
  }
}
