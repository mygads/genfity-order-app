import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { TABLET_BP, colors, fonts, rp } from '../../theme';
import { useFocusEffect } from '@react-navigation/native';
import { useLang, tCur } from '../../lib/i18n';
import { useConnectivity } from '../../hooks/useConnectivity';
import DrawerMenu from '../../components/DrawerMenu';
import SupervisorApprovalDialog from '../../components/SupervisorApprovalDialog';
import { SUPERVISOR_ACTION_ORDER_VOID } from '../../lib/supervisor';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import { initDb, query as queryDb, queryFirst, run } from '../../lib/db';
import { getJSON } from '../../lib/storage';
import { dbNowLocal } from '../../lib/datefmt';
import { getBinding, getSession } from '../../session';
import { requireAccess, requireTerminalAccess } from '../../lib/access';
import { ApiPath, getTerminal } from '../../config/server';
import { apiFetch, getApiMode, unwrap } from '../../lib/apiSource';
import { TAX_DEFAULT, defaultOngkirForMode, getPackagingFee, getTaxRate, isMarketplaceMode, totals, voucherExtras } from '../../lib/totals';
import { getCachedDeliveryEnabled, isDeliveryChannelLabel, posModesFor, subscribeDeliveryFlag } from '../../lib/posModes';
import type { NavVoucher } from '../../navigation/types';
import { syncWarnLevel } from '../../lib/sync';import { flushPendingCashCloses } from '../../lib/beWorkforce';
import { nextSalesNum } from '../../lib/sales';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      table?: string;
      mode?: string;
      customer?: string;
      tamu?: number;
      memberId?: string;
      ongkir?: number;
      voucher?: NavVoucher;
      /** Kode voucher mentah (mis. dari scan kamera) - divalidasi ke DB lokal di bawah. */
      voucherCode?: string;
      customItem?: { name: string; price: number; qty: number; note?: string };
      itemNote?: { id: string; note: string };
      loadItems?: CartItem[];
      salesNum?: string;
    };
  };
};

export type CartModifier = { name: string; price: number };
export type CartItem = {
  id: string;
  name: string;
  basePrice: number;
  qty: number;
  modifiers: CartModifier[];
  discount: number;
  /** Catatan per item - diteruskan ke KDS / struk dapur. */
  note?: string;
  /** Item void tetap tampil di daftar tapi tidak dihitung ke total. */
  voided?: boolean;
};

type Product = { id: string; name: string; price: number; category: string; tags: string[]; fav?: boolean; soldOut?: boolean };

const CATEGORIES: { name: string; subs: string[] }[] = [
  { name: 'Favorit', subs: [] },
  { name: 'Minuman', subs: ['Dingin', 'Panas', 'Coffee', 'Shake'] },
  { name: 'Makanan', subs: ['Makanan Cepat', 'Makanan Ringan'] },
  { name: 'Dessert', subs: ['Cake', 'Puding'] },
  { name: 'Pasta', subs: ['Spaghetti', 'Macaroni'] },
  { name: 'Cake', subs: ['Slice', 'Whole'] },
];

/** Last-resort absolut bila query DB melempar; array kosong DB tetap tampil empty-state. */
const PRODUCTS: Product[] = [
  { id: 'p1', name: 'Ayam Geprek Pelakor', price: 45000, category: 'Makanan', tags: ['Makanan Cepat'], fav: true },
  { id: 'p2', name: 'Ayam Goreng Dada', price: 15000, category: 'Makanan', tags: ['Makanan Cepat'] },
  { id: 'p3', name: 'Ayam Goreng Paha', price: 5000, category: 'Makanan', tags: ['Makanan Cepat'] },
  { id: 'p4', name: 'Bebek Dada 1st', price: 15000, category: 'Makanan', tags: ['Makanan Ringan'] },
  { id: 'p5', name: 'Maria 2', price: 1000, category: 'Makanan', tags: ['Makanan Ringan'] },
  { id: 'p6', name: 'test baru', price: 20000, category: 'Makanan', tags: ['Makanan Ringan'], fav: true },
  { id: 'p7', name: 'Kopi Susu Gula Aren', price: 22000, category: 'Minuman', tags: ['Coffee', 'Dingin'], fav: true },
  { id: 'p8', name: 'Americano Ice', price: 18000, category: 'Minuman', tags: ['Coffee', 'Dingin'] },
  { id: 'p9', name: 'Teh Manis Panas', price: 8000, category: 'Minuman', tags: ['Panas'] },
  { id: 'p10', name: 'Paket Nasi + Ayam', price: 28000, category: 'Makanan', tags: ['Makanan Cepat'] },
  { id: 'p11', name: 'Sudirman Coffee', price: 12900, category: 'Minuman', tags: ['Coffee', 'Dingin'], fav: true },
  { id: 'p12', name: 'Choco Shake', price: 25000, category: 'Minuman', tags: ['Shake', 'Dingin'] },
  { id: 'p13', name: 'Cheese Cake Slice', price: 32000, category: 'Cake', tags: ['Slice'] },
  { id: 'p14', name: 'Spaghetti Bolognese', price: 35000, category: 'Pasta', tags: ['Spaghetti'] },
  { id: 'p15', name: 'Puding Coklat', price: 12000, category: 'Dessert', tags: ['Puding'] },
];

/** M9: cabang aktif = terminal yang diklaim; '' = unbound (fail-closed — tanpa
 * fallback diam-diam 'B001'; query di bawah + banner unbound menanganinya). */

/** Petakan categoryId master (C01.. / nama grup lokal) ke chip kategori kasir.
 * TODO: bangun chip kategori dinamis dari ms_category bila backend menambah grup baru. */
const CATEGORY_OF: Record<string, string> = {
  C01: 'Makanan',
  C02: 'Makanan',
  C03: 'Minuman',
  C04: 'Makanan',
  'Makanan Utama': 'Makanan',
  'Makanan Ringan': 'Makanan',
  Minuman: 'Minuman',
  Dessert: 'Dessert',
  Cake: 'Cake',
  Pasta: 'Pasta',
  Snack: 'Snack',
};

function mapCategory(raw: string | null): string {
  const v = (raw ?? '').trim();
  if (!v) return 'Makanan';
  if (CATEGORY_OF[v]) return CATEGORY_OF[v];
  if (CATEGORIES.some((c) => c.name === v)) return v;
  return 'Makanan';
}

/** Item void tidak dihitung ke total. */
export const itemTotal = (c: CartItem) =>
  c.voided ? 0 : (c.basePrice + c.modifiers.reduce((s, m) => s + m.price, 0)) * c.qty - c.discount;

export const unitPrice = (c: CartItem) => c.basePrice + c.modifiers.reduce((s, m) => s + m.price, 0);

/** Vektor kaca pembesar - tidak ada aset magnifier di APK, jadi digambar tajam via View. */
function SearchGlyph({ size = 16, color = colors.navy }: { size?: number; color?: string }) {
  const r = size * 0.62;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: r,
          height: r,
          borderRadius: r / 2,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.47,
          top: size * 0.62,
          width: size * 0.44,
          height: 2.4,
          borderRadius: 1.2,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

/** Placeholder foto menu - katalog lokal belum ada foto, pakai aset kosong bawaan. */
function MenuThumb({ size = 52 }: { size?: number }) {
  return (
    <Image
      source={require('../../../assets/images/empty_menu_image.webp')}
      style={{ width: size, height: size, borderRadius: 8 }}
      resizeMode="cover"
    />
  );
}

export default function CashierScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= TABLET_BP;
  const { lang, t } = useLang();
  const { online, wsConnected } = useConnectivity();
  // Badge 3-state (mirror DashboardScreen): hijau+Online bila jaringan & WS up,
  // amber+Offline bila jaringan mati, abu+Offline (mode lokal) bila tak diketahui (null)/WS putus.
  // 'Offline' netral EN/ID (tanpa kunci i18n baru).
  const connLabel = online === false ? 'Offline' : online && wsConnected ? t('badge_online') : 'Offline';
  const connDot = online === false ? styles.onlineDotAmber : online && wsConnected ? undefined : styles.onlineDotGrey;
  const [activeCategory, setActiveCategory] = useState('Makanan');
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [customer, setCustomer] = useState(route?.params?.customer ?? '');
  /** C2: daftar mode per merchant-type dari binding (RESTAURANT default bila
   * tak diketahui — [ASUMSI] koordinator). Dihitung per render (murah, murni)
   * agar re-bind lintas-tipe langsung tercermin tanpa restart.
   * KOREKSI-FLAG (owner 21-Okt, offer-time only): kanal delivery (GOFOOD/
   * GRABFOOD/SHOPEEFOOD/DELIVERY) disembunyikan bila flag OFF. Flag dibaca ke
   * STATE + langganan (bukan const statis) agar daftar mutakhir saat profil
   * tersinkron sesudah layar dibuka. Mode terpilih yang lama tetap mengalir
   * via collapse legacy (pesanan lama tak di-BLOCKED oleh flag). */
  const [deliveryOn, setDeliveryOn] = useState(getCachedDeliveryEnabled());
  useEffect(() => subscribeDeliveryFlag(setDeliveryOn), []);
  // W1 (SESI-FIX-APPW1): ulangi tutup-kas tertunda tiap layar kasir dibuka
  // (efek terpisah — langganan delivery di atas tak tersentuh). Best-effort,
  // tak pernah melempar; offline = tetap pending untuk mount berikut.
  useEffect(() => {
    void (async () => {
      try {
        await flushPendingCashCloses();
      } catch {
        /* abaikan */
      }
    })();
  }, []);
  const MODES = (() => {
    const all = posModesFor(getBinding()?.merchantType);
    return deliveryOn ? all : all.filter((m) => !isDeliveryChannelLabel(m));
  })();
  const [mode, setMode] = useState(() => {
    const init = String(route?.params?.mode ?? '').trim();
    if (init && MODES.includes(init)) return init;
    return MODES[0] ?? 'DINE IN';
  });
  const [showModes, setShowModes] = useState(false);
  const catScrollRef = useRef<ScrollView>(null);
  /** Posisi x tiap chip kategori (phone) - untuk scroll chip aktif ke view saat diketuk. */
  const chipX = useRef<Record<string, number>>({});
  /** Phone: geser baris kategori agar chip yang diketuk terlihat; default x=0 (chip pertama). */
  const scrollToChip = (name: string) => {
    if (isWide) return;
    catScrollRef.current?.scrollTo({ x: Math.max(0, (chipX.current[name] ?? 0) - 16), animated: true });
  };
  const [showSearch, setShowSearch] = useState(false);
  const [table, setTable] = useState(route?.params?.table ?? '');
  const [voucher, setVoucher] = useState<NavVoucher | null>(
    route?.params?.voucher ?? null,
  );
  /** Pesan validasi kode voucher mentah (scan) - ditampil jujur, bukan diam. */
  const [voucherMsg, setVoucherMsg] = useState('');
  /** Ongkir - bawaan per mode dari FEE_DEFAULTS, bisa diubah via dialog tombol Ongkir, diteruskan ke CartDetail/Pay. */
  const [ongkir, setOngkir] = useState(Math.max(0, Number(route?.params?.ongkir ?? defaultOngkirForMode('DINE IN')) || 0));
  const [ongkirOpen, setOngkirOpen] = useState(false);
  const [ongkirDraft, setOngkirDraft] = useState(String(defaultOngkirForMode('DINE IN')));
  /** Member terpilih - diteruskan ke CartDetail/Pay agar poin + deposit nempel. */
  const [memberId, setMemberId] = useState(route?.params?.memberId ?? '');
  /** Nomor struk draft: bawaan LoadOrder saat muat ulang, atau diterbitkan saat Simpan. */
  const [salesNum, setSalesNum] = useState<string>(
    typeof route?.params?.salesNum === 'string' ? route.params.salesNum : '',
  );
  /** Tarif pajak setting-driven (ms_setting Tax/PPN, fallback 11). */
  const [taxRate, setTaxRate] = useState(TAX_DEFAULT);
  /** G5: sinyal E00044 (kontrak §2/§10.4): >7 hari tanpa sync = BLOKIR Bayar
   * (tombol Bayar/CTA mati + banner blokir beraksi Sync di bawah).
   * Local Mode (tanpa server untuk sync): banner TIDAK tampil - tak ada
   * server yang bisa di-sync, dan kasir harus tetap bisa dipakai. */
  const syncBlocked = syncWarnLevel() === 'block7' && getApiMode() !== 'local';
  /** Gerbang grant terminal E00045 (Q6): TANPA grant valid (kedaluwarsa /
   * mismatch / no-grant) = layar blokir + tombol Masuk Ulang (fail-closed).
   * Login pertama wajib online untuk menerbitkan grant; tak ada jalan
   * pra-grant. Tak pernah memblokir karena gate gagal dibaca (fail-open
   * baca, login yang memutuskan). */
  const [grantDenied, setGrantDenied] = useState(false);
  /** G3: cek grant terminal — dipakai ulang saat mount DAN setiap fokus layar
   * (kembali dari Install/klaim ulang), plus tombol "Coba Lagi" di layar blokir. */
  const recheckGrant = useCallback(async () => {
    let left = 3;
    while (left > 0) {
      try {
        const uid = (getSession()?.userId ?? '').trim();
        const tid = (getBinding()?.terminalId ?? '').trim();
        // restore() session/binding async fire-and-forget: cold start bisa baca
        // null di cek pertama — tunggu 1.5 dtk lalu coba lagi (maks 3x) agar
        // blokir E00045 tetap muncul walau restore belum selesai.
        if ((!uid || !tid) && left > 1) {
          await new Promise<void>((res) => setTimeout(res, 1500));
          left -= 1;
          continue;
        }
        if (!uid || !tid) return;
        const r = await requireTerminalAccess(uid, tid);
        // Fail-closed penuh: 'no-grant' ikut memblokir (tanpa pass pra-grant).
        setGrantDenied(!r.ok);
        return;
      } catch {
        /* gate tak terbaca - fail-open, login gate yang memutuskan */
        return;
      }
    }
  }, []);
  useEffect(() => {
    void recheckGrant();
  }, [recheckGrant]);
  useFocusEffect(
    useCallback(() => {
      void recheckGrant();
    }, [recheckGrant]),
  );
  const renderSyncBlock = () =>
    syncBlocked ? (
      <TouchableOpacity style={styles.modeNote} onPress={() => navigation?.navigate('Sync')}>
        <Text style={styles.modeNoteT}>{t('sync.blocked')} - {t('sync.openSync')} ›</Text>
      </TouchableOpacity>
    ) : null;
  /** M9: '' = unbound — banner jujur di bawah header (tanpa fallback B001). */
  const branchUnbound = (() => {
    try {
      return !(getTerminal().branchId ?? '').trim();
    } catch {
      return true;
    }
  })();
  /** B10: branch unbound — banner blokir + tombol Klaim Terminal (fail-closed:
   *  CTA Bayar ikut mati via branchUnbound, klaim diarahkan ke Install). */
  const renderUnboundNotice = () =>
    branchUnbound ? (
      <View style={styles.modeNote}>
        <Text style={styles.modeNoteT}>{t('terminal_unbound_title')}</Text>
        <Text style={styles.modeNoteT}>{t('terminal_unbound_hint')}</Text>
        <AppButton title={t('inst_claim_btn')} onPress={() => navigation?.navigate('Install')} />
      </View>
    ) : null;
  useEffect(() => {
    let alive = true;
    void getTaxRate().then((r) => {
      if (alive) setTaxRate(r);
    });
    return () => {
      alive = false;
    };
  }, []);
  /** Biaya kemasan setting-driven (ms_setting Packaging/Fee dari info
   * merchant; DINE IN / kosong / tak dikenal = 0). Muat ulang tiap mode
   * berubah agar toolbar total selalu kanonis. */
  const [packagingFee, setPackagingFee] = useState(0);
  useEffect(() => {
    let alive = true;
    void getPackagingFee(mode).then((v) => {
      if (alive) setPackagingFee(v);
    });
    return () => {
      alive = false;
    };
  }, [mode]);
  // Keranjang mulai kosong (offline-first): diisi dari menu yang diketuk /
  // draft atau order yang dibuka (loadItems/salesNum), bukan 3 item contoh.
  // DB kosong + tanpa draft = empty-state kasir yang jujur.
  const [cart, setCart] = useState<CartItem[]>([]);
  /** Muat order saat keranjang terisi: tahan dulu, minta konfirmasi hapus keranjang. */
  const [pendingLoad, setPendingLoad] = useState<CartItem[] | null>(null);
  const appliedLoad = useRef('');
  // Editor catatan/diskon/void per item
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [discDraft, setDiscDraft] = useState('');
  // PP-026: pesan validasi diskon per-item (negatif / melebihi nilai line).
  const [discMsg, setDiscMsg] = useState('');
  /** Eskalasi void: gate RBAC order.void, deny -> dialog persetujuan supervisor
   * V1 (kontrak BE baru; S7). Gate-throw (DB error) tetap buka dialog —
   * persetujuan server otoritatif, fallback lokal dialog fail-closed sendiri
   * (pola guardVoidOpen HistoryScreen/CancelScreen). */
  const [voidTarget, setVoidTarget] = useState<{ id: string; wantVoid: boolean } | null>(null);
  // Drawer /home APK asli (order, table, shift, sales-history, detail-recap,
  // esb-order-dashboard, member, expense, petty-cash, settings).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Guard agar customItem yang sama tidak double-apply saat params di-merge ulang.
  const appliedCustom = useRef('');

  /** Katalog live dari SQLite (ms_menu + ms_branchmenu.flagSoldOut cabang aktif).
   * null = belum dimuat; [] = DB kosong (seed+pull kosong) -> empty-state menu;
   * PRODUCTS const hanya last-resort bila query DB sendiri melempar. */
  const [dbProducts, setDbProducts] = useState<Product[] | null>(null);
  const [dbFailed, setDbFailed] = useState(false);
  // Audit-5d80 stock wiring: hormati opt allowSellEmpty layar Stok
  // (LS_OPTS 'genfity.stock.opts'). Muat ulang tiap fokus agar perubahan
  // di layar Stok langsung berlaku tanpa restart kasir.
  const [sellEmpty, setSellEmpty] = useState(false);
  useFocusEffect(useCallback(() => {
    let on = true;
    void getJSON<{ allowSellEmpty?: boolean }>('genfity.stock.opts', {}).then((o) => {
      if (on) setSellEmpty(o?.allowSellEmpty === true);
    });
    return () => { on = false; };
  }, []));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await initDb();
        // M9: '' = unbound (tanpa fallback B001) — peta sold-out kosong, jujur.
        const branchId = (getTerminal().branchId ?? '').trim();
        let rows = await queryDb<{ id: string; menuName: string | null; categoryId: string | null; price: number | null }>(
          'SELECT id, menuName, categoryId, price FROM ms_menu WHERE flagActive = 1',
        );
        let sold = await queryDb<{ menuId: string; flagSoldOut: number | null }>(
          'SELECT menuId, flagSoldOut FROM ms_branchmenu WHERE branchId = ?',
          [branchId],
        );
        if (rows.length === 0) {
          // Seed awal dari dummy pull master (main-get-menu + main-get-branch-menu).
          try {
            const at = new Date().toISOString();
            const res = await apiFetch(ApiPath.pullMenu, { method: 'GET' });
            const { data } = unwrap<{ items?: Record<string, unknown>[] }>(res.data);
            // Sekat dummy: hanya cache ke SQLite bila data server asli
            // (r.fromDummy = lewati tulis, lindungi seed/data asli).
            const items = !res.fromDummy && Array.isArray(data?.items) ? data.items : [];
            for (const it of items) {
              const id = String(it.menuId ?? it.id ?? '').trim();
              if (!id) continue;
              const price = Number(it.price);
              await run(
                'INSERT OR REPLACE INTO ms_menu (id, menuName, categoryId, price, imageUrl, stationId, flagActive, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                  id,
                  it.name === undefined || it.name === null ? null : String(it.name),
                  it.categoryId === undefined || it.categoryId === null ? null : String(it.categoryId),
                  Number.isFinite(price) ? Math.round(price) : 0,
                  it.imageUrl === undefined || it.imageUrl === null ? null : String(it.imageUrl),
                  it.stationId === undefined || it.stationId === null ? null : String(it.stationId),
                  it.flagActive === undefined || it.flagActive === null ? 1 : Number(it.flagActive) ? 1 : 0,
                  at,
                ],
              );
            }
            const resB = await apiFetch(ApiPath.pullBranchMenu, { method: 'GET' });
            const { data: dataB } = unwrap<{ items?: Record<string, unknown>[] }>(resB.data);
            // Sekat dummy: sama seperti pullMenu di atas.
            const itemsB = !resB.fromDummy && Array.isArray(dataB?.items) ? dataB.items : [];
            for (const it of itemsB) {
              const menuId = String(it.menuId ?? '').trim();
              if (!menuId) continue;
              // M9: tanpa konteks cabang (unbound) jangan seed baris cabang fiktif.
              const seedBranch = String(it.branchId ?? branchId).trim();
              if (!seedBranch) continue;
              const qty = Number(it.qty);
              await run(
                'INSERT OR REPLACE INTO ms_branchmenu (branchId, menuId, stationId, qty, flagSoldOut, flagActive, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                  seedBranch,
                  menuId,
                  it.stationId === undefined || it.stationId === null ? null : String(it.stationId),
                  Number.isFinite(qty) ? Math.round(qty) : 0,
                  it.flagSoldOut === undefined || it.flagSoldOut === null ? 0 : Number(it.flagSoldOut) ? 1 : 0,
                  it.flagActive === undefined || it.flagActive === null ? 1 : Number(it.flagActive) ? 1 : 0,
                  at,
                ],
              );
            }
          } catch {
            /* seed gagal - fallback PRODUCTS di bawah tetap jalan */
          }
          rows = await queryDb<{ id: string; menuName: string | null; categoryId: string | null; price: number | null }>(
            'SELECT id, menuName, categoryId, price FROM ms_menu WHERE flagActive = 1',
          );
          sold = await queryDb<{ menuId: string; flagSoldOut: number | null }>(
            'SELECT menuId, flagSoldOut FROM ms_branchmenu WHERE branchId = ?',
            [branchId],
          );
        }
        if (!alive) return;
        if (rows.length === 0) { if (alive) setDbProducts([]); return; }
        const soldMap = new Map(sold.map((r) => [r.menuId, (r.flagSoldOut ?? 0) === 1]));
        // Kamus id -> nama kategori (pola MenuManagementScreen) agar chip/label
        // memakai nama ramah; jatuh ke id mentah bila kamus kosong.
        let catName = new Map<string, string>();
        try {
          const cats = await queryDb<{ id: string; categoryName: string | null }>(
            'SELECT id, categoryName FROM ms_category',
          );
          catName = new Map(cats.map((c) => [c.id, c.categoryName ?? c.id]));
        } catch {
          /* kamus kosong - pakai id apa adanya */
        }
        setDbProducts(
          rows.map((r) => ({
            id: r.id,
            name: r.menuName ?? r.id,
            price: Math.max(0, Math.round(Number(r.price) || 0)),
            category: mapCategory(r.categoryId ? (catName.get(r.categoryId) ?? r.categoryId) : null),
            tags: [],
            soldOut: soldMap.get(r.id) ?? false,
          })),
        );
      } catch {
        /* Query DB melempar - PRODUCTS const sebagai last resort absolut. */
        if (alive) setDbFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Katalog aktif: live SQLite; [] saat DB kosong (empty-state grid); PRODUCTS hanya bila query melempar. */
  const catalog = dbProducts ?? (dbFailed ? PRODUCTS : []);

  /** Chip kategori diderivasi dari baris live (distinct category); CATEGORIES
   * const hanya sebagai FALLBACK bila rows kosong. Subs live kosong (tags []). */
  const categories = useMemo(() => {
    if (dbProducts && dbProducts.length > 0) {
      const seen: string[] = [];
      for (const p of dbProducts) {
        if (p.category && !seen.includes(p.category)) seen.push(p.category);
      }
      if (seen.length === 0) return CATEGORIES;
      const hasFav = dbProducts.some((p) => p.fav);
      return [
        ...(hasFav ? [{ name: 'Favorit', subs: [] as string[] }] : []),
        ...seen.map((name) => ({ name, subs: [] as string[] })),
      ];
    }
    return CATEGORIES;
  }, [dbProducts]);

  /** Bila katalog live tidak memuat kategori aktif lama, pindah ke chip pertama. */
  useEffect(() => {
    if (!dbProducts || dbProducts.length === 0) return;
    if (!categories.some((c) => c.name === activeCategory)) {
      setActiveCategory(categories[0]?.name ?? 'Makanan');
      setActiveSub(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbProducts]);

  /** Status shift nyata cabang aktif dari tr_shiftlog (open bila status open /
   * belum clockOut). null = DB kosong → fallback menganggap buka agar kasir
   * tetap bisa dipakai; hasHistory menandai ada riwayat shift. Baris absensi
   * (status 'absen') dikecualikan agar clock-in kehadiran tak terbaca open;
   * riwayat yang hanya berisi absensi = belum pernah buka shift → tutup. */
  const [shiftInfo, setShiftInfo] = useState<{ open: boolean; hasHistory: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await initDb();
        // M9: '' = unbound (tanpa fallback B001) — status shift tak terisi.
        const branchId = (getTerminal().branchId ?? '').trim();
        const row = await queryFirst<{ clockOut: string | null; status: string | null }>(
          'SELECT clockOut, status FROM tr_shiftlog WHERE branchId = ? AND (status IS NULL OR status <> \'absen\') ORDER BY clockIn DESC LIMIT 1',
          [branchId],
        );
        if (!alive) return;
        if (row) {
          setShiftInfo({ open: row.status === 'open' || !row.clockOut, hasHistory: true });
          return;
        }
        const total = await queryFirst<{ c: number }>(
          'SELECT COUNT(*) AS c FROM tr_shiftlog WHERE branchId = ?',
          [branchId],
        );
        if (alive && total && Number(total.c) > 0) {
          setShiftInfo({ open: false, hasHistory: true });
        }
      } catch {
        /* DB belum siap - fallback buka */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Header ala DashboardScreen: outlet dinamis + nama kasir sesi + status shift nyata. */
  const sess = getSession();
  const outletName = sess?.outlet || getTerminal().branchName || 'Genfity Cabang Poris';
  const shiftOpen = shiftInfo?.open ?? true;
  const shiftLabel = `${sess?.name ?? sess?.username ?? ''} | ${shiftOpen ? t('dash_shift_open') : t('dash_shift_closed')}`;

  /** Terima kiriman layar lain: voucher, item custom, notes, hasil muat order, mode. */
  useEffect(() => {
    const p = route?.params;
    if (!p) return;
    if (p.table !== undefined) setTable(p.table);
    if (p.voucher) setVoucher(p.voucher);
    // Kode voucher mentah (scan kamera QrScan tanpa check()): validasi ke
    // ms_voucher lokal lalu fallback ms_promotion; tak dikenal = diabaikan
    // + pesan, bukan voucher fiksi. Window pakai waktu lokal (dbNowLocal).
    if (typeof p.voucherCode === 'string' && p.voucherCode.trim() && !p.voucher) {
      const rawCode = p.voucherCode.trim();
      void (async () => {
        try {
          await initDb();
          const row = await queryFirst<{ voucherName: string | null; amount: number | null; quota: number | null; validFrom: string | null; validTo: string | null; status: string | null }>(
            'SELECT voucherName, amount, quota, validFrom, validTo, status FROM ms_voucher WHERE UPPER(voucherCode) = UPPER(?) LIMIT 1',
            [rawCode],
          );
          // Cek penuh selaras validateVoucherCodeLocal: status + kuota +
          // jendela validitas + nominal > 0.
          const nowLocal = dbNowLocal();
          const usable = !!row
            && (row.status ?? '').toLowerCase() === 'available'
            && Math.round(Number(row.quota) || 0) > 0
            && Math.max(0, Math.round(Number(row.amount) || 0)) > 0
            && !(row.validFrom && row.validFrom > nowLocal)
            && !(row.validTo && row.validTo < nowLocal);
          if (usable) {
            setVoucher({ code: rawCode.toUpperCase(), amount: Math.max(0, Math.round(Number(row.amount) || 0)) });
            setVoucherMsg('');
          } else if (!row) {
            // Bukan voucher kuota: coba promo reusable (cermin saveSale backstop).
            // Persen diteruskan utuh (rate+cap) agar totals() hitung persen,
            // bukan flat sebesar cap.
            const promo = await queryFirst<{ promoName: string | null; promoType: string | null; value: number | null; maxAmount: number | null; minSpend: number | null; validFrom: string | null; validTo: string | null; flagActive: number | null }>(
              'SELECT promoName, promoType, value, maxAmount, minSpend, validFrom, validTo, flagActive FROM ms_promotion WHERE UPPER(promoCode) = UPPER(?) LIMIT 1',
              [rawCode],
            );
            const pType = String(promo?.promoType ?? 'nominal').toLowerCase();
            const pValue = Math.max(0, Math.round(Number(promo?.value) || 0));
            const pCap = Math.max(0, Math.round(Number(promo?.maxAmount ?? pValue) || 0));
            const pAmt = pType === 'percent' ? pCap : pValue;
            const pUsable = !!promo
              && Number(promo.flagActive ?? 0) === 1
              && pAmt > 0
              && !(promo.validFrom && promo.validFrom > nowLocal)
              && !(promo.validTo && promo.validTo < nowLocal);
            if (pUsable) {
              const pMin = Math.max(0, Math.round(Number(promo.minSpend) || 0));
              setVoucher({
                code: rawCode.toUpperCase(),
                amount: pAmt,
                kind: pType === 'ongkir' ? 'Ongkir' : pType === 'percent' ? 'Member' : 'Voucher',
                ...(pType === 'percent' ? { rate: Math.min(100, pValue), maxAmount: pCap } : {}),
                ...(pMin > 0 ? { minSpend: pMin } : {}),
              });
              setVoucherMsg('');
            } else {
              setVoucher(null);
              setVoucherMsg(t('scan_unknown_voucher'));
            }
          } else {
            setVoucher(null);
            setVoucherMsg(t('scan_unknown_voucher'));
          }
        } catch {
          /* DB belum siap - abaikan kode */
        }
      })();
    }
    if (p.memberId !== undefined) setMemberId(p.memberId ?? '');
    if (typeof p.salesNum === 'string' && p.salesNum.trim()) setSalesNum(p.salesNum.trim());
    /** Booking oper nama + jumlah tamu - gabung ke kolom info (bisa diedit kasir). */
    if (p.customer !== undefined || p.tamu !== undefined) {
      const nm = (p.customer ?? '').trim();
      const nx = Math.max(0, Number(p.tamu) || 0);
      setCustomer(nx > 0 ? (nm ? `${nm} (${nx} ${t('guests')})` : `${nx} ${t('guests')}`) : nm);
    }
    if (p.ongkir !== undefined) setOngkir(Math.max(0, Number(p.ongkir) || 0));
    if (p.mode && MODES.includes(p.mode)) {
      setMode(p.mode);
      setShowModes(false);
    }
    if (p.loadItems && p.loadItems.length > 0) {
      const mapped = p.loadItems.map((c) => ({
        id: c.id,
        name: c.name,
        basePrice: c.basePrice,
        qty: Math.max(1, c.qty),
        modifiers: c.modifiers ?? [],
        discount: c.discount ?? 0,
        note: c.note,
      }));
      const key = JSON.stringify(p.loadItems);
      if (appliedLoad.current !== key) {
        appliedLoad.current = key;
        // Keranjang masih ada isinya = jangan timpa diam-diam: tahan + modal
        // konfirmasi (batal = keranjang lama tetap, muat diabaikan).
        if (cart.some((c) => !c.voided)) {
          setPendingLoad(mapped);
        } else {
          setCart(mapped);
        }
      }
    }
    if (p.itemNote) {
      const { id, note } = p.itemNote;
      setCart((prev) => prev.map((c) => (c.id === id ? { ...c, note: note || undefined } : c)));
    }
    if (p.customItem) {
      const key = JSON.stringify(p.customItem);
      if (appliedCustom.current !== key) {
        appliedCustom.current = key;
        const ci = p.customItem;
        const id = `custom-${Date.now()}`;
        setCart((prev) => [
          ...prev,
          { id, name: ci.name, basePrice: ci.price, qty: Math.max(1, ci.qty), modifiers: [], discount: 0, note: ci.note },
        ]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params]);

  const subs = useMemo(
    () => categories.find((c) => c.name === activeCategory)?.subs ?? [],
    [activeCategory, categories],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((p) => {
      const matchCat = activeCategory === 'Favorit' ? p.fav : p.category === activeCategory;
      const matchSub = !activeSub || p.tags.includes(activeSub);
      const matchQuery = q.length === 0 || p.name.toLowerCase().includes(q);
      return matchCat && matchSub && matchQuery;
    });
  }, [activeCategory, activeSub, query, catalog]);

  /** Tablet adaptif: 2 kolom di portrait, 3 kolom di landscape lebar (1024+); tambah spacer agar baris terakhir rata. */
  const numCols = !isWide ? 1 : width >= 1024 ? 3 : 2;
  const gridData = useMemo<(Product | null)[]>(
    () => {
      if (!isWide) return filtered;
      const rem = filtered.length % numCols;
      if (rem === 0) return filtered;
      return [...filtered, ...Array<Product | null>(numCols - rem).fill(null)];
    },
    [filtered, isWide, numCols],
  );

  /** Hanya item non-void yang dihitung. */
  const activeCart = useMemo(() => cart.filter((c) => !c.voided), [cart]);
  const voidCount = cart.length - activeCart.length;

  const qtyOf = (id: string) => cart.find((c) => c.id === id && !c.voided)?.qty ?? 0;

  /** D4: count produk per kategori untuk label chip `Nama (Npcs)` ala ref. */
  const catCount = (name: string) =>
    name === 'Favorit' ? catalog.filter((p) => p.fav).length : catalog.filter((p) => p.category === name).length;

  const addToCart = (p: Product) => {
    // allowSellEmpty = staf boleh jual item kosong (badge habis tetap tampil).
    if (p.soldOut && !sellEmpty) return;
    setCart((prev) => {
      const found = prev.find((c) => c.id === p.id);
      if (found)
        return prev.map((c) =>
          c.id === p.id ? { ...c, qty: c.qty + 1, voided: false } : c,
        );
      return [...prev, { id: p.id, name: p.name, basePrice: p.price, qty: 1, modifiers: [], discount: 0 }];
    });
  };

  const incQty = (id: string) =>
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty: c.qty + 1 } : c)));

  /** Kurangi qty; di 1 -> item dihapus (kasir cepat, tanpa dialog:
   * Alert.alert no-op di web dan butuh dua ketukan di HP). Item void
   * tidak ikut hapus agar tetap bisa di-restore. */
  const decQty = (id: string) =>
    setCart((prev) => {
      const cur = prev.find((c) => c.id === id);
      if (cur && cur.qty <= 1 && !cur.voided) return prev.filter((c) => c.id !== id);
      return prev.map((c) => (c.id === id ? { ...c, qty: Math.max(1, c.qty - 1) } : c));
    });

  const removeItem = (id: string) => setCart((prev) => prev.filter((c) => c.id !== id));

  /** Terapkan void/unvoid langsung (dipakai gate-ok dan sesudah PIN supervisor ok). */
  const applyVoid = (id: string, wantVoid: boolean) => {
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, voided: wantVoid } : c)));
    if (wantVoid) setEditingId(null);
  };

  /** Gate RBAC order.void: allow/db-unready langsung terap; deny eskalasi ke
   * dialog persetujuan supervisor V1 (S7: kontrak BE baru, legacy NOL). */
  const requestVoid = async (id: string, wantVoid: boolean) => {
    try {
      const s = getSession();
      const gate = await requireAccess(s?.userId || s?.username || '', 'order.void');
      if (gate.ok) {
        applyVoid(id, wantVoid);
        return;
      }
    } catch {
      // Fail-closed catatan: dialog dibuka agar supervisor (otoritatif via
      // server) bisa memutuskan; fallback lokal dialog fail-closed sendiri.
    }
    setVoidTarget({ id, wantVoid });
  };

  const voidItem = (id: string) => {
    void requestVoid(id, true);
  };

  const unvoidItem = (id: string) => {
    void requestVoid(id, false);
  };

  /** Persetujuan supervisor V1 ok (server approvalId / lokal userId) → terapkan
   * void/unvoid target tertunda. Identitas penyetuju tersedia di hasil bila
   * pemanggil butuh audit (di sini void keranjang lokal: cukup terap). */
  const approveVoid = () => {
    const target = voidTarget;
    if (!target) return;
    applyVoid(target.id, target.wantVoid);
    setVoidTarget(null);
  };

  const openEditor = (c: CartItem) => {
    setEditingId(c.id);
    setNoteDraft(c.note ?? '');
    setDiscDraft(c.discount > 0 ? String(c.discount) : '');
    setDiscMsg('');
  };

  /**
   * PP-026 (definisi koordinator): validasi lokal batas diskon per-item.
   * Field ini nominal Rupiah (bukan persen) — padanan jujur ">100%" adalah
   * diskon melebihi nilai bruto line. Negatif DITOLAK eksplisit dengan pesan
   * (dulu diam-diam jadi 0 via Math.max). RESIDU jujur: validasi server-side
   * belum diuji — BE boleh punya batas sendiri; klaim = lokal saja.
   */
  const saveEditor = () => {
    if (!editingId) return;
    const raw = discDraft.trim();
    if (/-/.test(raw)) {
      setDiscMsg(t('disc_neg'));
      return;
    }
    const disc = Math.max(0, Number(raw.replace(/[^0-9]/g, '')) || 0);
    const item = activeCart.find((c) => c.id === editingId);
    const lineGross = item
      ? (item.basePrice + item.modifiers.reduce((m, x) => m + x.price, 0)) * item.qty
      : 0;
    if (disc > lineGross) {
      setDiscMsg(t('disc_over_line'));
      return;
    }
    setDiscMsg('');
    setCart((prev) =>
      prev.map((c) =>
        c.id === editingId ? { ...c, note: noteDraft.trim() || undefined, discount: disc } : c,
      ),
    );
    setEditingId(null);
  };

  const subtotalGross = activeCart.reduce(
    (s, c) => s + (c.basePrice + c.modifiers.reduce((m, x) => m + x.price, 0)) * c.qty,
    0,
  );
  const discountTotal = activeCart.reduce((s, c) => s + c.discount, 0);
  /** Rumus kanonis via helper - nama variabel render dipertahankan agar diff minimal. */
  const {
    voucherAmt,
    subtotal,
    service,
    taxIncl,
    feeESB,
    packaging,
    ongkirCut: ongkirDiscount,
    ongkirNet,
    bruto,
    total,
    rounding,
  } = totals({ gross: subtotalGross, discount: discountTotal, voucher: voucher ?? undefined, ongkir, packaging: packagingFee, esbOrder: isMarketplaceMode(mode), taxRate });
  const isOngkirVoucher = voucher?.kind === 'Ongkir' || voucher?.code === 'GRATISONGKIR';
  const useOngkirCut = !!isOngkirVoucher && ongkir > 0;
  const itemCount = activeCart.reduce((s, c) => s + c.qty, 0);

  /** Qty cart per kategori - badge di chip agar footer lintas-kategori bisa diaudit sekilas. */
  const cartQtyByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of activeCart) {
      const p = catalog.find((x) => x.id === c.id);
      const cats = p ? [p.category, ...(p.fav ? ['Favorit'] : [])] : [];
      for (const k of cats) map[k] = (map[k] ?? 0) + c.qty;
    }
    return map;
  }, [activeCart, catalog]);

  const goCart = () =>
    navigation?.navigate('CartDetail', {
      items: cart,
      total,
      mode,
      table,
      ongkir,
      ...(packaging > 0 ? { packaging } : {}),
      customer: customer.trim(),
      ...(memberId.trim() ? { memberId: memberId.trim() } : {}),
      ...(voucher ? { voucher } : {}),
      ...(salesNum.trim() ? { salesNum: salesNum.trim() } : {}),
    });
  /** Dialog nominal ongkir - dibuka dari tombol Ongkir di toolbar. */
  const openOngkir = () => {
    setOngkirDraft(String(ongkir));
    setOngkirOpen(true);
  };
  const saveOngkir = () => {
    setOngkir(Math.max(0, Number(String(ongkirDraft).replace(/[^0-9]/g, '')) || 0));
    setOngkirOpen(false);
  };

  /** Mode marketplace (antar via kurir pihak ketiga) - tampilkan info penyiapan. */
  const isMarketplace = mode === 'GOFOOD' || mode === 'GRABFOOD' || mode === 'SHOPEEFOOD';

  const renderOngkirDialog = () => (
    <Modal visible={ongkirOpen} transparent animationType="fade" onRequestClose={() => setOngkirOpen(false)}>
      <View style={styles.dialogOverlay}>
        <View style={styles.dialogCard}>
          <Text style={styles.dialogTitle}>{t('ongkirTitle')}</Text>
          <Text style={styles.dialogSub}>{tCur('ongkirNominal')}</Text>
          <AppInput
            boxStyle={styles.dialogInput}
            style={styles.fieldText}
            value={ongkirDraft}
            onChangeText={setOngkirDraft}
            keyboardType="numeric"
            placeholder={rp(0)}
          />
          <View style={styles.dialogRow}>
            <AppButton
              size="sm"
              variant="secondary"
              title={t('cancel')}
              onPress={() => setOngkirOpen(false)}
              fullWidth={false}
              style={[styles.dialogGhost, { marginTop: 0 }]}
              textStyle={styles.dialogGhostT}
            />
            <AppButton
              size="sm"
              title={t('save')}
              onPress={saveOngkir}
              fullWidth={false}
              style={[styles.dialogPrimary, { marginTop: 0 }]}
              textStyle={styles.dialogPrimaryT}
            />
          </View>
        </View>
      </View>
    </Modal>
  );

  // S7: eskalasi void via dialog persetujuan supervisor V1 (kontrak BE baru;
  // legacy PIN-modal {pin} NOL — Real mode 404).
  const renderVoidDialog = () => (
    <SupervisorApprovalDialog
      visible={voidTarget !== null}
      action={SUPERVISOR_ACTION_ORDER_VOID}
      refId={voidTarget?.id ?? ''}
      fallbackAccessKey="order.void"
      onApproved={() => approveVoid()}
      onCancel={() => setVoidTarget(null)}
    />
  );

  /** Konfirmasi ganti keranjang terisi dengan order yang dimuat. */
  const confirmPendingLoad = () => {
    if (pendingLoad) setCart(pendingLoad);
    setPendingLoad(null);
  };
  const renderLoadDialog = () => (
    <Modal visible={pendingLoad !== null} transparent animationType="fade" onRequestClose={() => setPendingLoad(null)}>
      <View style={styles.dialogOverlay}>
        <View style={styles.dialogCard}>
          <Text style={styles.dialogTitle}>{t('loadConfirmTitle')}</Text>
          <Text style={styles.dialogSub}>{t('loadConfirmBody').replace('{n}', String(pendingLoad?.filter((c) => !c.voided).length ?? 0))}</Text>
          <View style={styles.dialogRow}>
            <AppButton
              size="sm"
              variant="secondary"
              title={t('cancel')}
              onPress={() => setPendingLoad(null)}
              fullWidth={false}
              style={[styles.dialogGhost, { marginTop: 0 }]}
              textStyle={styles.dialogGhostT}
            />
            <AppButton
              size="sm"
              title={t('loadAction')}
              onPress={confirmPendingLoad}
              fullWidth={false}
              style={[styles.dialogPrimary, { marginTop: 0 }]}
              textStyle={styles.dialogPrimaryT}
            />
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderModeNote = () =>
    isMarketplace ? (
      <View style={styles.modeNote}>
        <Text style={styles.modeNoteT}>{t('modeMarketplaceNoteA')}{mode}{t('modeMarketplaceNoteB')}</Text>
      </View>
    ) : null;
  /** Simpan membawa payload + salesNum agar muncul di Muat Order (dulu navigate tanpa params). */
  const goSaved = () => {
    void (async () => {
      let num = salesNum.trim();
      if (!num) {
        try {
          num = await nextSalesNum();
        } catch {
          num = t('saved-fallback-num').replace('{t}', String(Date.now()));
        }
        setSalesNum(num);
      }
      navigation?.navigate('LoadOrder', {
        newOrder: {
          title: `${mode}${table ? ` · ${t('table')} ${table}` : ''} · ${customer.trim() || t('guestFallback')}`,
          mode,
          ...(table ? { table } : {}),
          items: cart,
          ongkir,
          salesNum: num,
          // Rantai draft utuh: voucher/member/tamu ikut agar tak hilang saat dimuat (G4).
          // Rate/cap/minSpend promo percent ikut agar totals() tujuan hitung persen (#15).
          ...(voucher ? { voucher: { code: voucher.code, amount: voucher.amount, ...(voucher.kind ? { kind: voucher.kind } : {}), ...voucherExtras(voucher) } } : {}),
          ...(memberId ? { memberId } : {}),
          ...(customer.trim() ? { customer: customer.trim() } : {}),
        },
      });
    })();
  };

  const today = new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  /** Panel editor catatan + diskon + void per item. */
  const renderItemEditor = (c: CartItem) => {
    if (editingId !== c.id) return null;
    return (
      <View style={styles.editor}>
        <Text style={styles.editorLabel}>{t('noteKitchen')}</Text>
        <AppInput
          boxStyle={styles.editorInput}
          style={styles.fieldText}
          value={noteDraft}
          onChangeText={setNoteDraft}
          placeholder={t('notePh')}
        />
        <Text style={styles.editorLabel}>{tCur('discItemRp')}</Text>
        <AppInput
          boxStyle={styles.editorInput}
          style={styles.fieldText}
          value={discDraft}
          onChangeText={setDiscDraft}
          placeholder={rp(0)}
          keyboardType="numeric"
        />
        {discMsg ? <Text style={styles.editorErr}>{discMsg}</Text> : null}
        <View style={styles.editorRow}>
          <AppButton
            size="sm"
            variant="secondary"
            title={t('voidItem')}
            onPress={() => voidItem(c.id)}
            fullWidth={false}
            style={[styles.editorVoid, { marginTop: 0, backgroundColor: 'transparent', borderColor: colors.red }]}
            textStyle={styles.editorVoidT}
          />
          <AppButton
            size="sm"
            title={t('save')}
            onPress={saveEditor}
            fullWidth={false}
            style={[styles.editorSave, { marginTop: 0, backgroundColor: colors.navy }]}
            textStyle={styles.editorSaveT}
          />
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
          <Image source={require('../../../assets/icons/burger.webp')} style={styles.hamburgerIcon} resizeMode="contain" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.outletName}>{outletName}</Text>
          <View style={styles.shiftRow}>
            <View style={[styles.shiftDot, !shiftOpen && styles.shiftDotClosed]} />
            <Text style={styles.shiftText}>{shiftLabel}</Text>
          </View>
        </View>
      </View>
      <View style={styles.headerRight}>
        {isWide && (
          <View style={styles.headerDateWrap}>
            <Image source={require('../../../assets/icons/calendar.webp')} style={styles.dateIcon} resizeMode="contain" />
            <Text style={styles.headerDate}>{today}</Text>
          </View>
        )}
        <View style={styles.onlineBadge}>
          <View style={[styles.onlineDot, connDot]} />
          <Text style={styles.onlineText}>{connLabel}</Text>
        </View>
      </View>
    </View>
  );

  const renderToolbar = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.toolbarScroll}
      contentContainerStyle={styles.toolbar}>
      <TouchableOpacity style={styles.modeBtn} onPress={() => setShowModes((v) => !v)}>
        <Image source={require('../../../assets/icons/icon_category.webp')} style={styles.toolIcon} resizeMode="contain" />
        <Text style={[styles.modeText, isWide && styles.modeTextBig]}>
          {isWide ? t('modeTx') : mode} <Text style={styles.modeDim}>▾</Text>
        </Text>
      </TouchableOpacity>
      {isWide && (
        <View style={styles.customerWrap}>
          <AppInput
            boxStyle={styles.customerBox}
            style={styles.customerInput}
            placeholder={t('cust_name_ph')}
            value={customer}
            onChangeText={setCustomer}
          />
        </View>
      )}
      <TouchableOpacity style={[styles.toolBtn, isWide && styles.toolBtnBig]} onPress={() => setShowSearch((v) => !v)}>
        <SearchGlyph size={17} color={colors.navy} />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.toolBtnWide, !isWide && styles.toolBtnWidePhone, isWide && styles.toolBtnWideBig]} onPress={goSaved}>
        <Image source={require('../../../assets/icons/paper_icon.webp')} style={styles.toolIconSm} resizeMode="contain" />
        <Text style={[styles.toolBtnWideText, isWide && styles.toolBtnWideTextBig]} numberOfLines={1}>{t('saved')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toolBtnWide, !isWide && styles.toolBtnWidePhone, isWide && styles.toolBtnWideBig]}
        onPress={() => navigation?.navigate('CustomMenu')}>
        <Image source={require('../../../assets/icons/add_notes_black.webp')} style={styles.toolIconSm} resizeMode="contain" />
        <Text style={[styles.toolBtnWideText, isWide && styles.toolBtnWideTextBig]} numberOfLines={1}>{t('custom')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toolBtnWide, !isWide && styles.toolBtnWidePhone, isWide && styles.toolBtnWideBig]}
        onPress={openOngkir}>
        <Image source={require('../../../assets/icons/store_courier.webp')} style={styles.toolIconSm} resizeMode="contain" />
        <Text style={[styles.toolBtnWideText, isWide && styles.toolBtnWideTextBig]} numberOfLines={1}>{t('ongkir')}{ongkir > 0 ? ` ${rp(ongkir)}` : ''}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toolBtnWide, !isWide && styles.toolBtnWidePhone, isWide && styles.toolBtnWideBig]}
        onPress={() => navigation?.navigate('PromotionList', { returnTo: 'Cashier', subtotal })}>
        <Image source={require('../../../assets/icons/promo_blue.webp')} style={styles.toolIconSm} resizeMode="contain" />
        <Text style={[styles.toolBtnWideText, isWide && styles.toolBtnWideTextBig]} numberOfLines={1}>
          {voucher ? voucher.code : t('promo')}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderCats = () => (
    <View style={!isWide ? styles.catWrapPhone : styles.catWrapWide}>
      <ScrollView
        ref={catScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.catRow, !isWide && styles.catRowPhone]}
        style={styles.catScroll}>
        {categories.map((c) => {
          const active = c.name === activeCategory;
          // Favorit virtual (overlap) - tanpa badge agar jumlah badge = Jumlah footer.
          const inCart = c.name === 'Favorit' ? 0 : (cartQtyByCat[c.name] ?? 0);
          return (
            <TouchableOpacity
              key={c.name}
              style={[styles.catChip, active && styles.catChipActive, isWide && styles.catChipBig]}
              onLayout={(e) => { chipX.current[c.name] = e.nativeEvent.layout.x; }}
              onPress={() => {
                setActiveCategory(c.name);
                setActiveSub(null);
                scrollToChip(c.name);
              }}>
              <Text style={[styles.catText, active && styles.catTextActive]} numberOfLines={1}>
                {(c.name === 'Favorit' ? t('cat_fav') : c.name)} ({catCount(c.name)}pcs)
              </Text>
              {inCart > 0 && (
                <View style={styles.catCartBadge}>
                  <Text style={styles.catCartBadgeText}>{inCart}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {!isWide && (
        <View style={styles.catEdge} pointerEvents="none">
          <View style={styles.catEdgeDot}>
            <Text style={styles.catEdgeArrow}>›</Text>
          </View>
        </View>
      )}
    </View>
  );

  const renderBreadcrumb = () => (
    <View style={styles.crumbRow}>
      <Text style={styles.crumbActive}>{activeCategory}</Text>
      {activeSub && (
        <>
          <Text style={styles.crumbDim}> {'›'} </Text>
          <Text style={styles.crumbActive}>{activeSub}</Text>
        </>
      )}
      <Text style={styles.crumbDim}> · {filtered.length} menu · PPN {taxRate}% incl, service excl</Text>
    </View>
  );

  /** Sub-tile + tile Semua: reset filter. Tile aktif: border orange + bg pale orange + teks orange. */
  const renderSubs = () =>
    subs.length > 0 ? (
      <View style={styles.subGrid}>
        <TouchableOpacity
          style={[styles.subTile, subs.length > 2 && (isWide ? styles.subTileEvenWide : styles.subTileEven), !activeSub && styles.subTileActive]}
          onPress={() => setActiveSub(null)}>
          <Text style={[styles.subTileText, !activeSub && styles.subTileTextActive]}>{t('c_all')}</Text>
        </TouchableOpacity>
        {subs.map((s) => {
          const active = activeSub === s;
          const even = subs.length > 2;
          return (
            <TouchableOpacity
              key={s}
              style={[styles.subTile, even && (isWide ? styles.subTileEvenWide : styles.subTileEven), active && styles.subTileActive]}
              onPress={() => setActiveSub((prev) => (prev === s ? null : s))}>
              <Text style={[styles.subTileText, active && styles.subTileTextActive]}>{s}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    ) : null;

  const renderMenu = () => (
    <FlatList
      key={isWide ? `grid-${numCols}` : 'list'}
      data={isWide ? gridData : filtered}
      keyExtractor={(p, idx) => (p ? p.id : `__spacer-${idx}`)}
      numColumns={numCols}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        if (!item) return <View style={styles.cardSpacer} />;
        const qty = qtyOf(item.id);
        const inCart = cart.find((c) => c.id === item.id);
        if (isWide) {
          return (
            <View style={[styles.card, item.soldOut && styles.cardSoldOut]}>
              <TouchableOpacity onPress={() => addToCart(item)} activeOpacity={0.7} disabled={item.soldOut && !sellEmpty}>
                <MenuThumb size={isWide ? 80 : 64} />
                <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
                <View style={styles.cardFoot}>
                  <Text style={styles.cardPrice}>{rp(item.price)}</Text>
                  {item.soldOut ? (
                    <View style={styles.soldBadge}>
                      <Text style={styles.soldText}>{t('menu.soldOut')}</Text>
                    </View>
                  ) : qty > 0 ? (
                    <View style={styles.qtyBadge}>
                      <Text style={styles.qtyBadgeText}>{qty}</Text>
                    </View>
                  ) : (
                    <View style={[styles.addBtn, isWide && styles.addBtnBig]}>
                      <Text style={styles.addBtnText}>+</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
              {inCart && !inCart.voided && (
                <TouchableOpacity onPress={() => openEditor(inCart)} style={styles.cardEdit}>
                  <Text style={styles.cardEditT}>
                    {inCart.note ? `📝 ${inCart.note}` : `✎ ${t('editNoteDisc')}`}
                    {inCart.discount > 0 ? ` · -${rp(inCart.discount)}` : ''}
                  </Text>
                </TouchableOpacity>
              )}
              {inCart?.voided && (
                <TouchableOpacity onPress={() => unvoidItem(inCart.id)} style={styles.cardEdit}>
                  <Text style={styles.voidRestoreT}>{t('voidRestore')}</Text>
                </TouchableOpacity>
              )}
              {renderItemEditor(inCart ?? { id: item.id, name: item.name, basePrice: item.price, qty: 0, modifiers: [], discount: 0 })}
            </View>
          );
        }
        return (
          <View>
            <View style={[styles.row, item.soldOut && styles.rowSoldOut]}>
              <TouchableOpacity onPress={() => addToCart(item)} activeOpacity={0.7} style={styles.rowMain} disabled={item.soldOut && !sellEmpty}>
                <MenuThumb size={48} />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.rowPrice}>{rp(item.price)}</Text>
                  {inCart?.note ? <Text style={styles.rowNote} numberOfLines={1}>📝 {inCart.note}</Text> : null}
                  {inCart && inCart.discount > 0 ? (
                    <Text style={styles.rowDisc}>{t('discount')} -{rp(inCart.discount)}</Text>
                  ) : null}
                  {inCart?.voided ? <Text style={styles.voidBadge}>{t('hist_st_void')}</Text> : null}
                </View>
              </TouchableOpacity>
              {item.soldOut ? (
                <View style={styles.soldBadge}>
                  <Text style={styles.soldText}>{t('menu.soldOut')}</Text>
                </View>
              ) : qty > 0 ? (
                <View style={styles.stepperInline}>
                  <TouchableOpacity style={styles.stepBtnSm} onPress={() => decQty(item.id)}>
                    <Text style={styles.stepTxtSm}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepQtySm}>{qty}</Text>
                  <TouchableOpacity style={styles.stepBtnSm} onPress={() => incQty(item.id)}>
                    <Text style={styles.stepTxtSm}>+</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.addBtnLg} onPress={() => addToCart(item)}>
                  <Text style={styles.addBtnLgText}>+ {t('addMenu')}</Text>
                </TouchableOpacity>
              )}
            </View>
            {inCart && !inCart.voided && (
              <TouchableOpacity
                onPress={() => (editingId === inCart.id ? setEditingId(null) : openEditor(inCart))}
                style={styles.rowEditBtn}>
                <Text style={styles.rowEditT}>
                  {editingId === inCart.id ? t('cartEditEditor') : `✎ ${t('editNoteDisc')} ▾`}
                </Text>
              </TouchableOpacity>
            )}
            {inCart?.voided && (
              <TouchableOpacity onPress={() => unvoidItem(inCart.id)} style={styles.rowEditBtn}>
                <Text style={styles.voidRestoreT}>{t('voidRestore')}</Text>
              </TouchableOpacity>
            )}
            {inCart ? renderItemEditor(inCart) : null}
          </View>
        );
      }}
      ListEmptyComponent={
        <View style={styles.emptyWrap}>
          <Image
            source={require('../../../assets/images/empty_menu.webp')}
            style={styles.emptyImg}
            resizeMode="contain"
          />
          <Text style={styles.empty}>{t('common.noMatch')}</Text>
        </View>
      }
      ItemSeparatorComponent={!isWide ? () =><View style={styles.rowSep} /> : undefined}
    />
  );

  const renderCartPanel = () => (
    <View style={isWide ? [styles.cartPanel, { width: Math.min(400, width * 0.36) }] : styles.cartHidden}>
      <View style={styles.cartHeader}>
        <Image source={require('../../../assets/icons/check_circle_green.webp')} style={styles.cartCheckIcon} resizeMode="contain" />
        <Text style={styles.cartTitle}>
          {mode}{table ? ` · ${t('table')} ${table}` : ''} - {itemCount} {t('hist_items')} - {customer.trim() || t('guestFallback')}{salesNum.trim() ? ` · ${salesNum.trim()}` : ''}
        </Text>
      </View>
      <FlatList
        data={cart}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.cartList}
        ItemSeparatorComponent={() =><View style={styles.cartDivider} />}
        renderItem={({ item }) => (
          <View>
            <View style={[styles.cartRow, item.voided && styles.cartRowVoid]}>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepBtn, item.voided && styles.stepBtnDisabled, isWide && styles.stepBtnBig]}
                  onPress={() => decQty(item.id)}
                  disabled={item.voided}>
                  <Text style={[styles.stepTxt, item.voided && styles.stepTxtDisabled]}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepQty}>{item.qty}</Text>
                <TouchableOpacity style={[styles.stepBtn, isWide && styles.stepBtnBig]} onPress={() => incQty(item.id)}>
                  <Text style={styles.stepTxt}>+</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cartInfo}>
                <Text style={[styles.cartName, item.voided && styles.voidName]}>
                  {item.name}
                  {item.voided ? ` (${t('hist_st_void')})` : ''}
                </Text>
                {item.modifiers.length === 0 ? (
                  <Text style={styles.cartUnit}>@ {rp(item.basePrice)}</Text>
                ) : (
                  <Text style={styles.cartUnit}>
                    {rp(item.basePrice)} + {item.modifiers.map((m) => rp(m.price)).join(' + ')} = {rp(unitPrice(item))}/pcs
                  </Text>
                )}
                {item.modifiers.map((m, i) => (
                  <Text key={i} style={styles.cartMod}>
                    + {m.name} + {rp(m.price)}
                  </Text>
                ))}
                {item.note ? <Text style={styles.cartNote}>📝 {item.note}</Text> : null}
                {item.discount > 0 && (
                  <Text style={styles.cartDisc}>{t('discount')} -{rp(item.discount)}</Text>
                )}
                {item.voided ? (
                  <TouchableOpacity onPress={() => unvoidItem(item.id)}>
                    <Text style={styles.voidRestoreT}>{t('restoreItem')}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => (editingId === item.id ? setEditingId(null) : openEditor(item))}>
                    <Text style={styles.cartEditLink}>
                      {editingId === item.id ? t('cartEditClose') : `✎ ${t('editNoteDisc')}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.cartRight}>
                <TouchableOpacity style={styles.cartXBtn} onPress={() => removeItem(item.id)} hitSlop={8}>
                  <Image source={require('../../../assets/icons/close.webp')} style={styles.cartXIcon} resizeMode="contain" />
                </TouchableOpacity>
                <Text style={styles.cartPrice}>{rp(itemTotal(item))}</Text>
              </View>
            </View>
            {renderItemEditor(item)}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t('cartEmpty')}</Text>}
      />
      <View style={styles.totals}>
        <View style={styles.totalsSeparator} />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('subtotalGross')}</Text>
          <Text style={styles.totalVal}>{rp(subtotalGross)}</Text>
        </View>
        {discountTotal > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('itemDiscount')}</Text>
            <Text style={[styles.totalVal, styles.discVal]}>-{rp(discountTotal)}</Text>
          </View>
        )}
        {voucherMsg ? (
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.red }]}>{voucherMsg}</Text>
          </View>
        ) : null}
        {voucher && !useOngkirCut && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Voucher {voucher.code}</Text>
            <TouchableOpacity onPress={() => setVoucher(null)}>
              <Text style={[styles.totalVal, styles.discVal]}>-{rp(voucherAmt)} ✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {voidCount > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('voidRow')}</Text>
            <Text style={styles.totalVal}>{voidCount} {t('voidNotCounted')}</Text>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('subtotalNet')}</Text>
          <Text style={styles.totalVal}>{rp(subtotal)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('taxIncl')}</Text>
          <Text style={styles.totalVal}>{rp(taxIncl)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('serviceExcl')}</Text>
          <Text style={styles.totalVal}>{rp(service)}</Text>
        </View>
        {feeESB > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('feeESB')}</Text>
            <Text style={styles.totalVal}>{rp(feeESB)}</Text>
          </View>
        )}
        {packaging > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('packaging')}</Text>
            <Text style={styles.totalVal}>{rp(packaging)}</Text>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('deliveryFee')}</Text>
          <Text style={styles.totalVal}>{rp(ongkirNet)}</Text>
        </View>
        {ongkirDiscount > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Voucher {voucher?.code} (ongkir)</Text>
            <TouchableOpacity onPress={() => setVoucher(null)}>
              <Text style={[styles.totalVal, styles.discVal]}>-{rp(ongkirDiscount)} ✕</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('rounding')}</Text>
          <Text style={styles.totalVal}>{rp(rounding)}</Text>
        </View>
        <View style={[styles.totalRow, styles.grandRow]}>
          <Text style={styles.grandLabel}>{t('total')}</Text>
          <Text style={styles.grandVal}>{rp(total)}</Text>
        </View>
      </View>
      <View style={styles.cartActions}>
        <View style={styles.cartActionsRow}>
          <TouchableOpacity style={styles.btnSave} onPress={goSaved}>
            <Image source={require('../../../assets/icons/export.webp')} style={styles.btnIcon} resizeMode="contain" />
            <Text style={styles.btnSaveText}>{t('save')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnPrint} onPress={() => navigation?.navigate('Receipt', {
            total, mode,
            items: activeCart,
            discount: discountTotal + voucherAmt,
            ...(voucher ? { voucherCode: voucher.code } : {}),
            ...(table ? { table } : {}),
            ...(customer.trim() ? { customer: customer.trim() } : {}),
            ...(memberId.trim() ? { memberId: memberId.trim() } : {}),
            ongkir: ongkirNet,
            ...(service > 0 ? { service } : {}),
            ...(taxIncl > 0 ? { tax: taxIncl } : {}),
            ...(rounding !== 0 ? { rounding } : {}),
            ...(feeESB > 0 ? { feeESB } : {}),
            ...(packaging > 0 ? { packaging } : {}),
          })}>
            <Image source={require('../../../assets/icons/print_blue.webp')} style={styles.btnIcon} resizeMode="contain" />
            <Text style={styles.btnPrintText}>{t('printReceipt')}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.btnPay, (activeCart.length === 0 || branchUnbound || syncBlocked) && styles.ctaDisabled]}
          disabled={activeCart.length === 0 || branchUnbound || syncBlocked}
          onPress={goCart}>
          <Image source={require('../../../assets/icons/money_white.webp')} style={styles.btnIcon} resizeMode="contain" />
          <Text style={styles.btnPayText} numberOfLines={1} adjustsFontSizeToFit>{t('pay')} | {rp(total)}</Text>
          <Text style={styles.btnPayArrow}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  /** Jaring pengaman grant terminal E00045: cermin shiftBlocked — grant
   *  kedaluwarsa/tak cocok → layar blokir + Masuk Ulang (re-auth online),
   *  bukan grid kasir. Tanpa grant (pra-grant) lolos ke shiftBlocked biasa. */
  if (grantDenied) {
    return (
      <View style={styles.root}>
        {renderHeader()}
        <DrawerMenu
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          navigate={(r) => navigation?.navigate(r)}
          outlet={outletName}
          user={shiftLabel}
        />
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedTitle}>{t('grant_blocked')}</Text>
          <Text style={styles.blockedSub}>{`${t('grant_code_block')}: ${t('grant_blocked_msg')}`}</Text>
          <AppButton title={t('edc_retry')} onPress={() => void recheckGrant()} />
          <AppButton title={t('grant_open_login')} onPress={() => navigation?.navigate('Login')} />
        </View>
      </View>
    );
  }

  /** Jaring pengaman lintas-entry: lolos gerbang (mis. denah Tables) dengan shift tutup
   *  → tampilkan layar blokir + tombol Buka Shift, bukan grid kasir. Instalasi fresh
   *  (tanpa riwayat) dan DB belum siap tetap bebas agar demo/screenshot jalan. */
  const shiftBlocked = !!shiftInfo?.hasHistory && !shiftInfo.open;
  if (shiftBlocked) {
    return (
      <View style={styles.root}>
        {renderHeader()}
        <DrawerMenu
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          navigate={(r) => navigation?.navigate(r)}
          outlet={outletName}
          user={shiftLabel}
        />
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedTitle}>{t('dash_shift_closed')}</Text>
          <Text style={styles.blockedSub}>{`${t('dash_shift_closed')} - ${t('shf_open_btn')}`}</Text>
          <AppButton title={t('shf_open_btn')} onPress={() => navigation?.navigate('Shift')} />
        </View>
      </View>
    );
  }

  if (isWide) {
    return (
      <View style={styles.root}>
        {renderHeader()}
        {renderSyncBlock()}
        {renderUnboundNotice()}
        <DrawerMenu
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          navigate={(r) => navigation?.navigate(r)}
          outlet={outletName}
          user={shiftLabel}
        />
        <View style={styles.bodyRow}>
          <View style={styles.catalog}>
            {renderToolbar()}
            {showModes && (
              <View style={styles.modeDropdown}>
                {MODES.map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.modeOption, m === mode && styles.modeOptionActive]}
                    onPress={() => {
                      setMode(m);
                      setShowModes(false);
                      if (m === 'DINE IN') navigation?.navigate('DineIn', { mode: m, ...(table ? { table } : {}) });
                    }}>
                    <Text style={[styles.modeOptionText, m === mode && styles.modeOptionTextActive]}>
                      {m}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {renderModeNote()}
            {showSearch && (
              <View style={styles.searchWrap}>
                <SearchGlyph size={15} color={colors.faint} />
                <TextInput
                  style={styles.search}
                  placeholder={t('searchMenu')}
                  placeholderTextColor={colors.faint}
                  value={query}
                  onChangeText={setQuery}
                />
              </View>
            )}
            {renderCats()}
            {renderBreadcrumb()}
            {renderSubs()}
            <View style={styles.menuFlex}>{renderMenu()}</View>
          </View>
          {renderCartPanel()}
        </View>
        {renderOngkirDialog()}
        {renderVoidDialog()}
        {renderLoadDialog()}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {renderHeader()}
      {renderSyncBlock()}
      {renderUnboundNotice()}
      <DrawerMenu
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigate={(r) => navigation?.navigate(r)}
        outlet={outletName}
        user={shiftLabel}
      />
      {renderToolbar()}
      {showModes && (
        <View style={styles.modeDropdown}>
          {MODES.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeOption, m === mode && styles.modeOptionActive]}
              onPress={() => {
                setMode(m);
                setShowModes(false);
                if (m === 'DINE IN') navigation?.navigate('DineIn', { mode: m, ...(table ? { table } : {}) });
              }}>
              <Text style={[styles.modeOptionText, m === mode && styles.modeOptionTextActive]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {renderModeNote()}
      {renderCats()}
      {renderBreadcrumb()}
      {renderSubs()}
      {(showSearch || query.length > 0) && (
        <View style={styles.searchWrap}>
          <SearchGlyph size={15} color={colors.faint} />
          <TextInput
            style={styles.search}
            placeholder={t('searchMenu')}
            placeholderTextColor={colors.faint}
            value={query}
            onChangeText={setQuery}
          />
        </View>
      )}
      <View style={styles.menuFlex}>{renderMenu()}</View>

      {/* CTA bawah BIRU: Jumlah + Lihat Pesanan + total */}
      <View style={styles.ctaWrap}>
        {(() => {
          const visibleQty = filtered.reduce((s, p) => s + qtyOf(p.id), 0);
          const hiddenQty = itemCount - visibleQty;
          const visibleSum = filtered.reduce((s, p) => s + (activeCart.find((c) => c.id === p.id)?.qty ?? 0) * p.price, 0);
          return hiddenQty > 0 ? (
            <Text style={styles.ctaNote}>
              {visibleQty} item {activeCategory} ({rp(visibleSum)}) + {hiddenQty} item kategori lain = {itemCount} item
            </Text>
          ) : null;
        })()}
        {voucher ? (
          <Text style={styles.ctaNote}>
            {useOngkirCut
              ? `Voucher ${voucher.code} · ${t('deliveryFee')} -${rp(ongkirDiscount)}`
              : `Voucher ${voucher.code} (-${rp(voucherAmt)})`}
          </Text>
        ) : null}
        {ongkir > 0 && !voucher ? (
          <Text style={styles.ctaNote}>{t('deliveryFee')} {rp(ongkirNet)} - {t('needOngkirHint')}</Text>
        ) : null}
        <TouchableOpacity
          style={[styles.cta, (activeCart.length === 0 || branchUnbound || syncBlocked) && styles.ctaDisabled]}
          disabled={activeCart.length === 0 || branchUnbound || syncBlocked}
          onPress={goCart}
          activeOpacity={0.85}>
          <View style={styles.ctaCount}>
            <Text style={styles.ctaCountLabel}>{t('amountCount')}</Text>
            <Text style={styles.ctaCountValue}>{itemCount}</Text>
          </View>
          <View style={styles.ctaDivider} />
          <Text style={styles.ctaText}>
            {t('viewOrder')} | {rp(total)}
          </Text>
          <Text style={styles.ctaArrow}>›</Text>
        </TouchableOpacity>
      </View>
      {renderOngkirDialog()}
      {renderVoidDialog()}
      {renderLoadDialog()}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  /* Header khusus kasir: metrik disamakan ScreenHeader (minHeight 56,
   *  paddingHorizontal 12, paddingBottom 12, hitSlop 12) agar tinggi navy
   *  identik semua layar. Beda disengaja: judul rata kiri (outlet + shift),
   *  tombol burger (layar akar tanpa back), badge koneksi kanan.
   *  HP-E2E 2026-10-24. */
  header: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 56,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  hamburgerIcon: { width: 22, height: 22 },
  headerTitleWrap: { flex: 1, minWidth: 0 },
  outletName: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 },
  shiftDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  shiftDotClosed: { backgroundColor: colors.red },
  shiftText: { color: colors.navyTint, fontFamily: fonts.regular, fontSize: 12 },
  /* Layar blokir jaring pengaman shift tutup: pesan tengah + tombol Buka Shift. */
  blockedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  blockedTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.text, textAlign: 'center' },
  blockedSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 8, marginBottom: 16, textAlign: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  headerDateWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateIcon: { width: 22, height: 22 },
  headerDate: { color: colors.navyTint, fontFamily: fonts.regular, fontSize: 12 },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 6,
  },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.white },
  onlineDotAmber: { backgroundColor: colors.amber },
  onlineDotGrey: { backgroundColor: colors.stroke },
  onlineText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 12 },
  bodyRow: { flex: 1, flexDirection: 'row' },
  catalog: { flex: 1, minWidth: 0 },
  menuFlex: { flex: 1 },
  toolbarScroll: { flexGrow: 0, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingRight: 20,
    gap: 8,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: colors.white,
    flexShrink: 1,
    minWidth: 0,
  },
  toolIcon: { width: 16, height: 16 },
  toolIconSm: { width: 14, height: 14 },
  modeText: { fontFamily: fonts.bold, fontSize: 11, color: colors.navy, flexShrink: 1 },
  /* Varian tablet: teks toolbar 11 ke 13 agar terbaca di layar lebar. */
  modeTextBig: { fontSize: 13 },
  modeDim: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  customerWrap: {
    flex: 1,
    minWidth: 110,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.white,
  },
  customerInput: {
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    outlineStyle: 'none' as never,
  },
  /** Kotak AppInput di toolbar customer: transparan tanpa border (bungkus luar yg membingkai). */
  customerBox: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 0,
    height: 40,
  },
  /** Teks di dalam AppInput: medium ala form lama. */
  fieldText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  toolBtn: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    flexShrink: 0,
  },
  toolBtnWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
    justifyContent: 'center',
    backgroundColor: colors.white,
    flexShrink: 0,
  },
  toolBtnWideText: { fontFamily: fonts.medium, fontSize: 11, color: colors.navy, flexShrink: 0 },
  /* Varian tablet: target sentuh min 48px (toolBtn 38 ke 48, teks 11 ke 13). */
  toolBtnBig: { width: 48, height: 48 },
  toolBtnWideBig: { height: 48, minHeight: 48 },
  toolBtnWideTextBig: { fontSize: 13 },
  toolBtnWidePhone: { paddingHorizontal: 7, gap: 4 },
  modeDropdown: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  modeOption: { paddingHorizontal: 16, paddingVertical: 10 },
  modeOptionActive: { backgroundColor: colors.paleBlue },
  modeOptionText: { fontFamily: fonts.regular, fontSize: 14, color: colors.text },
  modeOptionTextActive: { fontFamily: fonts.semibold, color: colors.navy },
  catScroll: { flexGrow: 0, backgroundColor: 'transparent' },
  catWrapPhone: { position: 'relative' },
  catRow: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, gap: 8, alignItems: 'center' },
  catRowPhone: { paddingRight: 44 },
  catChip: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexShrink: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
  },
  /* Varian tablet: chip kategori min 48px. */
  catChipBig: { minHeight: 48, paddingVertical: 12 },
  catEdge: {
    position: 'absolute',
    right: 6,
    top: 8,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  catEdgeDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catEdgeArrow: { color: colors.navy, fontFamily: fonts.bold, fontSize: 15, lineHeight: 17 },
  catChipActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  catCartBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  catCartBadgeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 11 },
  catWrapWide: { paddingRight: 4 },
  catText: { fontFamily: fonts.medium, fontSize: 13, color: colors.navy },
  catTextActive: { color: colors.white, fontFamily: fonts.semibold },
  crumbRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 8, flexWrap: 'wrap' },
  crumbDim: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint },
  crumbActive: { fontFamily: fonts.semibold, fontSize: 12, color: colors.blue },
  subGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  subTile: {
    flex: 1,
    minWidth: 110,
    backgroundColor: colors.paleBlue,
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  subTileEven: { flexGrow: 0, flexShrink: 1, flexBasis: '48%', maxWidth: '48%', minWidth: 0 },
  subTileEvenWide: { flexGrow: 0, flexShrink: 1, flexBasis: '24%', maxWidth: '24%', minWidth: 0 },
  subTileActive: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  subTileText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, textAlign: 'center' },
  subTileTextActive: { fontFamily: fonts.semibold, color: colors.orangeDark },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    marginHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  search: {
    flex: 1,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    outlineStyle: 'none' as never,
  },
  list: { padding: 12, paddingBottom: 16 },
  rowSep: { height: 1, backgroundColor: colors.line, marginHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  rowInfo: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  rowPrice: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text, marginTop: 2 },
  rowNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.blue, marginTop: 2 },
  rowDisc: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 2 },
  rowEditBtn: { backgroundColor: colors.white, paddingHorizontal: 16, paddingVertical: 6 },
  rowEditT: { fontFamily: fonts.medium, fontSize: 12, color: colors.blue },
  voidBadge: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.red,
    marginTop: 2,
  },
  voidName: { textDecorationLine: 'line-through', color: colors.faint },
  voidRestoreT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.greenDark },
  stepperInline: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  stepBtnSm: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.navy, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  stepTxtSm: { color: colors.navy, fontFamily: fonts.bold, fontSize: 18 },
  stepQtySm: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, minWidth: 24, textAlign: 'center' },
  addBtnLg: { borderWidth: 1, borderColor: colors.orange, borderRadius: 20, paddingHorizontal: 14, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  addBtnLgText: { color: colors.orange, fontFamily: fonts.bold, fontSize: 13 },
  soldBadge: {
    backgroundColor: colors.red,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
    flexShrink: 0,
  },
  soldText: { fontFamily: fonts.bold, fontSize: 10, color: colors.white },
  cardSoldOut: { opacity: 0.75, borderColor: colors.red },
  rowSoldOut: { opacity: 0.75 },
  qtyBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  qtyBadgeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 12 },
  card: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    margin: 6,
    minWidth: 0,
  },
  cardSpacer: { flex: 1, margin: 6, minWidth: 0 },
  cardName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, minHeight: 38, flexShrink: 1, marginTop: 8 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 },
  cardPrice: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy, flex: 1, minWidth: 0 },
  cardEdit: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  cardEditT: { fontFamily: fonts.medium, fontSize: 12, color: colors.blue },
  addBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  addBtnText: { color: colors.white, fontFamily: fonts.bold, fontSize: 16, lineHeight: 18 },
  /* Varian tablet: tombol +/- kartu dan stepper cart 26 ke 44-48. */
  addBtnBig: { width: 48, height: 48, borderRadius: 24 },
  stepBtnBig: { width: 44, height: 44, borderRadius: 22 },
  emptyWrap: { alignItems: 'center', paddingVertical: 32 },
  emptyImg: { width: 120, height: 120 },
  empty: { textAlign: 'center', marginTop: 12, fontFamily: fonts.regular, fontSize: 14, color: colors.faint },
  editor: {
    backgroundColor: colors.paleBlue,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  editorLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy, marginTop: 6 },
  // PP-026: pesan validasi diskon per-item.
  editorErr: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 4 },
  editorInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 9,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
    marginTop: 4,
  },
  editorRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  editorVoid: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  editorVoidT: { fontFamily: fonts.bold, fontSize: 13, color: colors.red },
  editorSave: {
    flex: 2,
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  editorSaveT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  cartHidden: { display: 'none' },
  cartPanel: {
    width: 320,
    backgroundColor: colors.white,
    borderLeftWidth: 1,
    borderLeftColor: colors.line,
  },
  cartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  cartCheckIcon: { width: 18, height: 18, flexShrink: 0 },
  cartTitle: { flex: 1, minWidth: 0, fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  cartList: { paddingVertical: 4 },
  cartDivider: { height: 1, backgroundColor: colors.line, marginHorizontal: 14 },
  cartRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  cartRowVoid: { opacity: 0.6 },
  stepper: { alignItems: 'center', gap: 2, flexShrink: 0, paddingTop: 1 },
  stepBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.navy,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { borderColor: colors.line },
  stepTxt: { color: colors.navy, fontFamily: fonts.bold, fontSize: 15, lineHeight: 17 },
  stepTxtDisabled: { color: colors.faint },
  stepQty: { fontFamily: fonts.bold, fontSize: 13, color: colors.text, minWidth: 26, textAlign: 'center' },
  cartInfo: { flex: 1, minWidth: 0 },
  cartName: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, flexShrink: 1 },
  cartUnit: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginTop: 2 },
  cartMod: { fontFamily: fonts.regular, fontSize: 11, color: colors.blue, marginTop: 1, flexShrink: 1 },
  cartNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.blue, marginTop: 1 },
  cartDisc: { fontFamily: fonts.medium, fontSize: 11, color: colors.red, marginTop: 1 },
  cartEditLink: { fontFamily: fonts.medium, fontSize: 11, color: colors.blue, marginTop: 3 },
  cartRight: { alignItems: 'flex-end', gap: 4, flexShrink: 0, maxWidth: 120 },
  cartXBtn: { padding: 8, marginTop: -8, marginRight: -8 },
  cartXIcon: { width: 13, height: 13 },
  cartPrice: { fontFamily: fonts.bold, fontSize: 13, color: colors.text, textAlign: 'right', maxWidth: 112 },
  totals: { borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 4 },
  totalsSeparator: { height: 1, backgroundColor: colors.line, marginBottom: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 2, gap: 12 },
  totalLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, flexShrink: 1 },
  totalVal: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, textAlign: 'right', maxWidth: 170, flexShrink: 1 },
  discVal: { color: colors.red },
  grandRow: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 6, paddingTop: 8 },
  grandLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  grandVal: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy, textAlign: 'right', maxWidth: 180, flexShrink: 1 },
  cartActions: { padding: 12, gap: 8 },
  cartActionsRow: { flexDirection: 'row', gap: 8 },
  btnSave: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    minWidth: 0,
  },
  btnSaveText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orange, flexShrink: 1 },
  btnPrint: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.blue,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    minWidth: 0,
  },
  btnPrintText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.blue, flexShrink: 1 },
  btnIcon: { width: 17, height: 17, flexShrink: 0 },
  btnPay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.blueDark,
    borderWidth: 1.5,
    borderColor: colors.blueDark,
    borderRadius: 10,
    paddingVertical: 11,
  },
  btnPayText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15, flexShrink: 1 },
  btnPayArrow: { color: colors.white, fontSize: 20, fontFamily: fonts.bold },
  ctaWrap: { padding: 12, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, gap: 6 },
  ctaNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, textAlign: 'center' },
  cta: {
    backgroundColor: colors.blueDark,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaCount: { alignItems: 'center', marginRight: 12, flexShrink: 0 },
  ctaCountLabel: { color: colors.white, fontFamily: fonts.regular, fontSize: 11, opacity: 0.85 },
  ctaCountValue: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  ctaDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.4)', marginRight: 12, flexShrink: 0 },
  ctaText: { flex: 1, minWidth: 0, color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  ctaArrow: { color: colors.white, fontSize: 22, fontFamily: fonts.bold, flexShrink: 0 },
  modeNote: {
    backgroundColor: colors.paleAmber,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  modeNoteT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.amberDark, textAlign: 'center' },
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, textAlign: 'center' },
  dialogSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4 },
  dialogInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 11,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
    marginTop: 12,
    textAlign: 'center',
  },
  dialogRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  dialogGhost: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  dialogGhostT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  dialogPrimary: {
    flex: 1,
    backgroundColor: colors.orange,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  dialogPrimaryT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
});
