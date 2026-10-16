import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useLang } from '../../lib/i18n';
import DrawerMenu from '../../components/DrawerMenu';

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
      ongkir?: number;
      voucher?: { code: string; amount: number; kind?: string };
      customItem?: { name: string; price: number; qty: number; note?: string };
      itemNote?: { id: string; note: string };
      loadItems?: CartItem[];
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

type Product = { id: string; name: string; price: number; category: string; tags: string[]; fav?: boolean };

const CATEGORIES: { name: string; subs: string[] }[] = [
  { name: 'Favorit', subs: [] },
  { name: 'Minuman', subs: ['Dingin', 'Panas', 'Coffee', 'Shake'] },
  { name: 'Makanan', subs: ['Makanan Cepat', 'Makanan Ringan'] },
  { name: 'Dessert', subs: ['Cake', 'Puding'] },
  { name: 'Pasta', subs: ['Spaghetti', 'Macaroni'] },
  { name: 'Cake', subs: ['Slice', 'Whole'] },
];

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

const MODES = ['DINE IN', 'TAKE AWAY', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'];

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
  const { t } = useLang();
  const [activeCategory, setActiveCategory] = useState('Makanan');
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [customer, setCustomer] = useState('');
  const [mode, setMode] = useState('DINE IN');
  const [showModes, setShowModes] = useState(false);
  const catScrollRef = useRef<ScrollView>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [table, setTable] = useState(route?.params?.table ?? '');
  const [voucher, setVoucher] = useState<{ code: string; amount: number; kind?: string } | null>(
    route?.params?.voucher ?? null,
  );
  /** Ongkir - diisi via dialog tombol Ongkir, default 0, diteruskan ke CartDetail/Pay. */
  const [ongkir, setOngkir] = useState(Math.max(0, Number(route?.params?.ongkir) || 0));
  const [ongkirOpen, setOngkirOpen] = useState(false);
  const [ongkirDraft, setOngkirDraft] = useState('0');
  const [cart, setCart] = useState<CartItem[]>([
    {
      id: 'p11',
      name: 'Sudirman Coffee',
      basePrice: 12900,
      qty: 1,
      modifiers: [{ name: 'Creamy Pandan Kayu Manis', price: 7000 }],
      discount: 0,
    },
    { id: 'p6', name: 'test baru', basePrice: 20000, qty: 1, modifiers: [], discount: 0 },
    { id: 'p2', name: 'Ayam Goreng Dada', basePrice: 15000, qty: 3, modifiers: [], discount: 2500 },
  ]);
  // Editor catatan/diskon/void per item
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [discDraft, setDiscDraft] = useState('');
  // Drawer /home APK asli (order, table, shift, sales-history, detail-recap,
  // esb-order-dashboard, member, expense, petty-cash, settings).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Guard agar customItem yang sama tidak double-apply saat params di-merge ulang.
  const appliedCustom = useRef('');

  /** Terima kiriman layar lain: voucher, item custom, notes, hasil muat order, mode. */
  useEffect(() => {
    const p = route?.params;
    if (!p) return;
    if (p.table !== undefined) setTable(p.table);
    if (p.voucher) setVoucher(p.voucher);
    if (p.ongkir !== undefined) setOngkir(Math.max(0, Number(p.ongkir) || 0));
    if (p.mode && MODES.includes(p.mode)) {
      setMode(p.mode);
      setShowModes(false);
    }
    if (p.loadItems && p.loadItems.length > 0) {
      setCart(
        p.loadItems.map((c) => ({
          id: c.id,
          name: c.name,
          basePrice: c.basePrice,
          qty: Math.max(1, c.qty),
          modifiers: c.modifiers ?? [],
          discount: c.discount ?? 0,
          note: c.note,
        })),
      );
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
    () => CATEGORIES.find((c) => c.name === activeCategory)?.subs ?? [],
    [activeCategory],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PRODUCTS.filter((p) => {
      const matchCat = activeCategory === 'Favorit' ? p.fav : p.category === activeCategory;
      const matchSub = !activeSub || p.tags.includes(activeSub);
      const matchQuery = q.length === 0 || p.name.toLowerCase().includes(q);
      return matchCat && matchSub && matchQuery;
    });
  }, [activeCategory, activeSub, query]);

  /** Tablet 2-kolom strict: ganjil → tambah spacer agar item terakhir tidak melebar. */
  const gridData = useMemo<(Product | null)[]>(
    () => (isWide && filtered.length % 2 === 1 ? [...filtered, null] : filtered),
    [filtered, isWide],
  );

  /** Hanya item non-void yang dihitung. */
  const activeCart = useMemo(() => cart.filter((c) => !c.voided), [cart]);
  const voidCount = cart.length - activeCart.length;

  const qtyOf = (id: string) => cart.find((c) => c.id === id && !c.voided)?.qty ?? 0;

  /** D4: count produk per kategori untuk label chip `Nama (Npcs)` ala ref. */
  const catCount = (name: string) =>
    name === 'Favorit' ? PRODUCTS.filter((p) => p.fav).length : PRODUCTS.filter((p) => p.category === name).length;

  const addToCart = (p: Product) => {
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

  const decQty = (id: string) =>
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty: Math.max(1, c.qty - 1) } : c)));

  const removeItem = (id: string) => setCart((prev) => prev.filter((c) => c.id !== id));

  const voidItem = (id: string) => {
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, voided: true } : c)));
    setEditingId(null);
  };

  const unvoidItem = (id: string) =>
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, voided: false } : c)));

  const openEditor = (c: CartItem) => {
    setEditingId(c.id);
    setNoteDraft(c.note ?? '');
    setDiscDraft(c.discount > 0 ? String(c.discount) : '');
  };

  const saveEditor = () => {
    if (!editingId) return;
    const disc = Math.max(0, Number(discDraft.replace(/[^0-9]/g, '')) || 0);
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
  /** Voucher ongkir (GRATISONGKIR) memotong ongkir bila ongkir > 0, selain itu diskon flat. */
  const isOngkirVoucher = voucher?.kind === 'Ongkir' || voucher?.code === 'GRATISONGKIR';
  const useOngkirCut = !!isOngkirVoucher && ongkir > 0;
  const ongkirDiscount = useOngkirCut ? Math.min(voucher?.amount ?? 0, ongkir) : 0;
  const ongkirNet = ongkir - ongkirDiscount;
  const voucherAmt = useOngkirCut
    ? 0
    : Math.min(voucher?.amount ?? 0, Math.max(0, subtotalGross - discountTotal));
  const subtotal = subtotalGross - discountTotal - voucherAmt;
  const service = Math.round(subtotal * 0.05);
  /** PPN 11% inclusive (info-only): dasar sudah termasuk pajak. */
  const ppnIncl = Math.round((subtotal * 11) / 111);
  const bruto = subtotal + service + ongkirNet;
  /** Pembulatan ke kelipatan Rp 100 terdekat. */
  const total = Math.round(bruto / 100) * 100;
  const rounding = total - bruto;
  const itemCount = activeCart.reduce((s, c) => s + c.qty, 0);

  /** Qty cart per kategori - badge di chip agar footer lintas-kategori bisa diaudit sekilas. */
  const cartQtyByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of activeCart) {
      const p = PRODUCTS.find((x) => x.id === c.id);
      const cats = p ? [p.category, ...(p.fav ? ['Favorit'] : [])] : [];
      for (const k of cats) map[k] = (map[k] ?? 0) + c.qty;
    }
    return map;
  }, [activeCart]);

  const goCart = () =>
    navigation?.navigate('CartDetail', {
      items: cart,
      total,
      mode,
      table,
      ongkir,
      customer: customer.trim(),
      ...(voucher ? { voucher } : {}),
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
          <Text style={styles.dialogSub}>{t('ongkirNominal')}</Text>
          <TextInput
            style={styles.dialogInput}
            value={ongkirDraft}
            onChangeText={setOngkirDraft}
            keyboardType="numeric"
            placeholder={rp(0)}
            placeholderTextColor={colors.faint}
          />
          <View style={styles.dialogRow}>
            <TouchableOpacity style={styles.dialogGhost} onPress={() => setOngkirOpen(false)}>
              <Text style={styles.dialogGhostT}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dialogPrimary} onPress={saveOngkir}>
              <Text style={styles.dialogPrimaryT}>{t('save')}</Text>
            </TouchableOpacity>
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
  /** Simpan membawa payload agar muncul di Muat Order (dulu navigate tanpa params). */
  const goSaved = () =>
    navigation?.navigate('LoadOrder', {
      newOrder: {
        title: `${mode}${table ? ` · ${t('table')} ${table}` : ''} · ${customer.trim() || 'QoQi'}`,
        mode,
        ...(table ? { table } : {}),
        items: cart,
        ongkir,
      },
    });

  const today = new Date().toLocaleDateString('id-ID', {
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
        <TextInput
          style={styles.editorInput}
          value={noteDraft}
          onChangeText={setNoteDraft}
          placeholder={t('notePh')}
          placeholderTextColor={colors.faint}
        />
        <Text style={styles.editorLabel}>{t('discItemRp')}</Text>
        <TextInput
          style={styles.editorInput}
          value={discDraft}
          onChangeText={setDiscDraft}
          placeholder={rp(0)}
          placeholderTextColor={colors.faint}
          keyboardType="numeric"
        />
        <View style={styles.editorRow}>
          <TouchableOpacity style={styles.editorVoid} onPress={() => voidItem(c.id)}>
            <Text style={styles.editorVoidT}>{t('voidItem')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.editorSave} onPress={saveEditor}>
            <Text style={styles.editorSaveT}>{t('save')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}>
          <Image source={require('../../../assets/icons/burger.webp')} style={styles.hamburgerIcon} resizeMode="contain" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.outletName}>ESB Cabang Poris</Text>
          <View style={styles.shiftRow}>
            <View style={styles.shiftDot} />
            <Text style={styles.shiftText}>Gista | Shift Open</Text>
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
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>Online</Text>
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
        <Text style={styles.modeText}>
          {isWide ? t('modeTx') : mode} <Text style={styles.modeDim}>▾</Text>
        </Text>
      </TouchableOpacity>
      {isWide && (
        <View style={styles.customerWrap}>
          <TextInput
            style={styles.customerInput}
            placeholder="Info tambahan / nama customer"
            placeholderTextColor={colors.faint}
            value={customer}
            onChangeText={setCustomer}
          />
        </View>
      )}
      <TouchableOpacity style={styles.toolBtn} onPress={() => setShowSearch((v) => !v)}>
        <SearchGlyph size={17} color={colors.navy} />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.toolBtnWide, !isWide && styles.toolBtnWidePhone]} onPress={goSaved}>
        <Image source={require('../../../assets/icons/paper_icon.webp')} style={styles.toolIconSm} resizeMode="contain" />
        <Text style={styles.toolBtnWideText} numberOfLines={1}>{t('saved')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toolBtnWide, !isWide && styles.toolBtnWidePhone]}
        onPress={() => navigation?.navigate('CustomMenu')}>
        <Image source={require('../../../assets/icons/add_notes_black.webp')} style={styles.toolIconSm} resizeMode="contain" />
        <Text style={styles.toolBtnWideText} numberOfLines={1}>{t('custom')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toolBtnWide, !isWide && styles.toolBtnWidePhone]}
        onPress={openOngkir}>
        <Image source={require('../../../assets/icons/store_courier.webp')} style={styles.toolIconSm} resizeMode="contain" />
        <Text style={styles.toolBtnWideText} numberOfLines={1}>{t('ongkir')}{ongkir > 0 ? ` ${rp(ongkir)}` : ''}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toolBtnWide, !isWide && styles.toolBtnWidePhone]}
        onPress={() => navigation?.navigate('PromotionList', { returnTo: 'Cashier', subtotal })}>
        <Image source={require('../../../assets/icons/promo_blue.webp')} style={styles.toolIconSm} resizeMode="contain" />
        <Text style={styles.toolBtnWideText} numberOfLines={1}>
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
        onContentSizeChange={() => {
          // Default aktif = Makanan (chip ke-3): geser agar label pcs terlihat di phone.
          if (!isWide) catScrollRef.current?.scrollTo({ x: 120, animated: false });
        }}
        contentContainerStyle={[styles.catRow, !isWide && styles.catRowPhone]}
        style={styles.catScroll}>
        {CATEGORIES.map((c) => {
          const active = c.name === activeCategory;
          // Favorit virtual (overlap) - tanpa badge agar jumlah badge = Jumlah footer.
          const inCart = c.name === 'Favorit' ? 0 : (cartQtyByCat[c.name] ?? 0);
          return (
            <TouchableOpacity
              key={c.name}
              style={[styles.catChip, active && styles.catChipActive]}
              onPress={() => {
                setActiveCategory(c.name);
                setActiveSub(null);
              }}>
              <Text style={[styles.catText, active && styles.catTextActive]} numberOfLines={1}>
                {c.name} ({catCount(c.name)}pcs)
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
      <Text style={styles.crumbDim}> · {filtered.length} menu · PPN 11% incl, service excl</Text>
    </View>
  );

  /** Sub-tile + tile Semua: reset filter. Tile aktif: border orange + bg pale orange + teks orange. */
  const renderSubs = () =>
    subs.length > 0 ? (
      <View style={styles.subGrid}>
        <TouchableOpacity
          style={[styles.subTile, subs.length > 2 && (isWide ? styles.subTileEvenWide : styles.subTileEven), !activeSub && styles.subTileActive]}
          onPress={() => setActiveSub(null)}>
          <Text style={[styles.subTileText, !activeSub && styles.subTileTextActive]}>Semua</Text>
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
      key={isWide ? 'grid' : 'list'}
      data={isWide ? gridData : filtered}
      keyExtractor={(p) => (p ? p.id : '__spacer')}
      numColumns={isWide ? 2 : 1}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        if (!item) return <View style={styles.cardSpacer} />;
        const qty = qtyOf(item.id);
        const inCart = cart.find((c) => c.id === item.id);
        if (isWide) {
          return (
            <View style={styles.card}>
              <TouchableOpacity onPress={() => addToCart(item)} activeOpacity={0.7}>
                <MenuThumb size={64} />
                <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
                <View style={styles.cardFoot}>
                  <Text style={styles.cardPrice}>{rp(item.price)}</Text>
                  {qty > 0 ? (
                    <View style={styles.qtyBadge}>
                      <Text style={styles.qtyBadgeText}>{qty}</Text>
                    </View>
                  ) : (
                    <View style={styles.addBtn}>
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
            <View style={styles.row}>
              <TouchableOpacity onPress={() => addToCart(item)} activeOpacity={0.7} style={styles.rowMain}>
                <MenuThumb size={48} />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.rowPrice}>{rp(item.price)}</Text>
                  {inCart?.note ? <Text style={styles.rowNote} numberOfLines={1}>📝 {inCart.note}</Text> : null}
                  {inCart && inCart.discount > 0 ? (
                    <Text style={styles.rowDisc}>{t('discount')} -{rp(inCart.discount)}</Text>
                  ) : null}
                  {inCart?.voided ? <Text style={styles.voidBadge}>Void</Text> : null}
                </View>
              </TouchableOpacity>
              {qty > 0 ? (
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
                  {editingId === inCart.id ? 'Tutup editor ▴' : `✎ ${t('editNoteDisc')} ▾`}
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
          <Text style={styles.empty}>Menu tidak ditemukan</Text>
        </View>
      }
      ItemSeparatorComponent={!isWide ? () => <View style={styles.rowSep} /> : undefined}
    />
  );

  const renderCartPanel = () => (
    <View style={isWide ? styles.cartPanel : styles.cartHidden}>
      <View style={styles.cartHeader}>
        <Image source={require('../../../assets/icons/check_circle_green.webp')} style={styles.cartCheckIcon} resizeMode="contain" />
        <Text style={styles.cartTitle}>
          {mode}{table ? ` · ${t('table')} ${table}` : ''} - {itemCount} item - {customer.trim() || 'QoQi'}
        </Text>
      </View>
      <FlatList
        data={cart}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.cartList}
        ItemSeparatorComponent={() => <View style={styles.cartDivider} />}
        renderItem={({ item }) => (
          <View>
            <View style={[styles.cartRow, item.voided && styles.cartRowVoid]}>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepBtn, item.qty <= 1 && styles.stepBtnDisabled]}
                  onPress={() => decQty(item.id)}
                  disabled={item.qty <= 1}>
                  <Text style={[styles.stepTxt, item.qty <= 1 && styles.stepTxtDisabled]}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepQty}>{item.qty}</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => incQty(item.id)}>
                  <Text style={styles.stepTxt}>+</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cartInfo}>
                <Text style={[styles.cartName, item.voided && styles.voidName]}>
                  {item.name}
                  {item.voided ? ' (Void)' : ''}
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
                      {editingId === item.id ? 'Tutup ▴' : `✎ ${t('editNoteDisc')}`}
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
          <Text style={styles.totalVal}>{rp(ppnIncl)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('serviceExcl')}</Text>
          <Text style={styles.totalVal}>{rp(service)}</Text>
        </View>
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
          <Text style={styles.totalLabel}>Rounding</Text>
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
          <TouchableOpacity style={styles.btnPrint} onPress={() => navigation?.navigate('Receipt', { total, mode, ...(table ? { table } : {}) })}>
            <Image source={require('../../../assets/icons/print_blue.webp')} style={styles.btnIcon} resizeMode="contain" />
            <Text style={styles.btnPrintText}>{t('printReceipt')}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.btnPay, activeCart.length === 0 && styles.ctaDisabled]}
          disabled={activeCart.length === 0}
          onPress={goCart}>
          <Image source={require('../../../assets/icons/money_white.webp')} style={styles.btnIcon} resizeMode="contain" />
          <Text style={styles.btnPayText}>{t('pay')} | {rp(total)}</Text>
          <Text style={styles.btnPayArrow}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isWide) {
    return (
      <View style={styles.root}>
        {renderHeader()}
        <DrawerMenu
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          navigate={(r) => navigation?.navigate(r)}
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
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {renderHeader()}
      <DrawerMenu
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigate={(r) => navigation?.navigate(r)}
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
            placeholder="Cari menu…"
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
          style={[styles.cta, activeCart.length === 0 && styles.ctaDisabled]}
          disabled={activeCart.length === 0}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  hamburgerIcon: { width: 22, height: 22 },
  headerTitleWrap: { flex: 1, minWidth: 0 },
  outletName: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 },
  shiftDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  shiftText: { color: colors.navyTint, fontFamily: fonts.regular, fontSize: 12 },
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
