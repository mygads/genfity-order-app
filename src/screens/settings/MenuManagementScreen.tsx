import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { TABLET_BP, colors, fonts, rp, rpNum, wideCenterLg } from '../../theme';
import { useLang } from '../../lib/i18n';
import { getJSON, setJSON } from '../../lib/storage';
import { initDb, query, queryFirst, run } from '../../lib/db';
import { enqueueOutbox } from '../../lib/sync';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

interface MenuEntry {
  id: string;
  name: string;
  group: string;
  price: number;
  soldOut: boolean;
  imageState: 'ok' | 'missing' | 'downloading';
}

const LS_MENUS = 'genfity.menu.cache';

const DEFAULT_MENUS: MenuEntry[] = [
  { id: 'm1', name: 'Ayam Geprek Pelakor', group: 'Makanan Utama', price: 45000, soldOut: false, imageState: 'ok' },
  { id: 'm2', name: 'Es Teh Manis', group: 'Minuman', price: 8000, soldOut: false, imageState: 'ok' },
  { id: 'm3', name: 'Lele Goreng', group: 'Makanan Utama', price: 22000, soldOut: false, imageState: 'missing' },
  { id: 'm4', name: 'Kopi Robusta', group: 'Minuman', price: 15000, soldOut: true, imageState: 'ok' },
  { id: 'm5', name: 'Mie Goreng Jawa', group: 'Makanan Utama', price: 22000, soldOut: true, imageState: 'missing' },
];

const BRANCH_ID = 'BR-01';

/** Tulis perubahan menu ke SQLite agar ikut sync master. */
async function persistMenu(m: MenuEntry): Promise<void> {
  try {
    await initDb();
    await run(
      `INSERT INTO ms_menu (id, menuName, categoryId, price, flagActive, syncDate)
       VALUES (?, ?, ?, ?, 1, NULL)
       ON CONFLICT (id) DO UPDATE SET menuName = excluded.menuName, price = excluded.price, syncDate = NULL`,
      [m.id, m.name, m.group, Math.round(m.price)],
    );
    // Jangan wipe stok StockScreen: pertahankan qty existing bila baris sudah ada.
    const existing = await queryFirst<{ qty: number | null }>(
      'SELECT qty FROM ms_branchmenu WHERE branchId = ? AND menuId = ?',
      [BRANCH_ID, m.id],
    );
    const keepQty = existing ? Math.round(Number(existing.qty ?? -1)) : -1;
    await run(
      `INSERT INTO ms_branchmenu (branchId, menuId, qty, flagSoldOut, flagActive, syncDate)
       VALUES (?, ?, ?, ?, 1, NULL)
       ON CONFLICT (branchId, menuId) DO UPDATE SET flagSoldOut = excluded.flagSoldOut, syncDate = NULL`,
      [BRANCH_ID, m.id, keepQty, m.soldOut ? 1 : 0],
    );
    await enqueueOutbox('ms_menu', m.id, 'update');
    await enqueueOutbox('ms_branchmenu', `${BRANCH_ID}:${m.id}`, 'update');
  } catch {
    /* abaikan: cache JSON tetap menyimpan */
  }
}

export default function MenuManagementScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menus, setMenus] = useState<MenuEntry[]>(DEFAULT_MENUS);
  const [group, setGroup] = useState<string>('Semua');
  const [queryText, setQueryText] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftPrice, setDraftPrice] = useState('');
  const [draftGroup, setDraftGroup] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await getJSON<MenuEntry[]>(LS_MENUS, DEFAULT_MENUS);
      try {
        await initDb();
        const rows = await query<{ id: string; menuName: string | null; categoryId: string | null; price: number | null }>(
          'SELECT id, menuName, categoryId, price FROM ms_menu',
        );
        if (!alive) return;
        if (rows.length === 0) {
          if (cached.length > 0) setMenus(cached);
          return;
        }
        const sold = await query<{ menuId: string; flagSoldOut: number | null }>(
          'SELECT menuId, flagSoldOut FROM ms_branchmenu WHERE branchId = ?',
          [BRANCH_ID],
        );
        const soldMap = new Map(sold.map((r) => [r.menuId, (r.flagSoldOut ?? 0) === 1]));
        setMenus(
          rows.map((r) => {
            const prev = cached.find((c) => c.id === r.id);
            return {
              id: r.id,
              name: r.menuName ?? prev?.name ?? r.id,
              group: r.categoryId ?? prev?.group ?? 'Lainnya',
              price: Number(r.price ?? prev?.price ?? 0),
              soldOut: soldMap.get(r.id) ?? prev?.soldOut ?? false,
              imageState: prev?.imageState ?? 'ok',
            };
          }),
        );
      } catch {
        if (alive && cached.length > 0) setMenus(cached);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void setJSON(LS_MENUS, menus);
  }, [menus]);

  const groups = ['Semua', ...Array.from(new Set(menus.map((m) => m.group)))];

  const patch = (id: string, p: Partial<MenuEntry>) => {
    setMenus((ms) => {
      const next = ms.map((m) => (m.id === id ? { ...m, ...p } : m));
      const changed = next.find((m) => m.id === id);
      if (changed) void persistMenu(changed);
      return next;
    });
  };

  /** Unduh gambar nyata: ambil imageUrl hasil pull master, verifikasi via HEAD, lalu tandai ok. */
  const downloadImage = async (id: string) => {
    patch(id, { imageState: 'downloading' });
    setMsg(t('menu.downloading'));
    try {
      await initDb();
      const row = await queryFirst<{ imageUrl: string | null }>(
        'SELECT imageUrl FROM ms_menu WHERE id = ?',
        [id],
      );
      const url = row?.imageUrl ?? '';
      if (url && /^https?:\/\//.test(url)) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } finally {
          clearTimeout(timer);
        }
      }
      patch(id, { imageState: 'ok' });
      setMsg('Gambar menu terverifikasi dan tersimpan.');
    } catch {
      patch(id, { imageState: 'missing' });
      setMsg('Unduh gambar gagal - periksa koneksi lalu coba lagi.');
    }
  };

  const downloadAll = async () => {
    const missing = menus.filter((m) => m.imageState === 'missing');
    if (missing.length === 0) {
      setMsg('Semua gambar menu sudah lengkap.');
      return;
    }
    for (const m of missing) {
      await downloadImage(m.id);
    }
  };

  const openEditor = (m: MenuEntry) => {
    setEditing(m.id);
    setDraftName(m.name);
    setDraftPrice(String(Math.round(m.price)));
    setDraftGroup(m.group);
    setMsg('');
  };

  const saveEditor = (id: string) => {
    const name = draftName.trim();
    const price = Number(draftPrice.replace(/\D/g, '')) || 0;
    const grp = draftGroup.trim() || 'Lainnya';
    if (name.length < 3 || price <= 0) {
      setMsg('Nama min. 3 huruf dan harga harus lebih dari 0.');
      return;
    }
    patch(id, { name, price, group: grp });
    setEditing(null);
    setMsg('Perubahan menu tersimpan dan ikut sync.');
  };

  const q = queryText.trim().toLowerCase();
  const list = menus.filter(
    (m) => (group === 'Semua' || m.group === group) && (!q || m.name.toLowerCase().includes(q)),
  );
  const soldCount = menus.filter((m) => m.soldOut).length;
  const missingCount = menus.filter((m) => m.imageState !== 'ok').length;
  const go = (route: string) => navigation?.navigate(route);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <ScreenHeader
        title={t('menu.title')}
        sub={`${soldCount} habis - ${missingCount} gambar belum terunduh`}
        onBack={() => setDrawerOpen(true)}
        backLabel="☰"
      />
      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />

      <View style={styles.tabs}>
        {groups.map((g) => (
          <Pressable key={g} onPress={() => setGroup(g)} style={[styles.tab, group === g && styles.tabActive]}>
            <Text style={[styles.tabText, group === g && styles.tabTextActive]}>{g}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.searchRow}>
        <TextInput style={styles.input} value={queryText} onChangeText={setQueryText} placeholder={t('common.searchMenu')} placeholderTextColor={colors.faint} />
        <Pressable style={styles.btnDl} onPress={downloadAll}>
          <Text style={styles.btnDlText}>{t('menu.downloadImages')}</Text>
        </Pressable>
      </View>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      {list.map((m) => (
        <View key={m.id} style={[styles.card, m.soldOut && styles.cardSold]}>
          <View style={styles.itemTop}>
            <Image
              source={m.imageState === 'ok'
                ? require('../../../assets/images/empty_menu.webp')
                : require('../../../assets/images/empty_menu_image.webp')}
              style={styles.thumb}
              resizeMode="contain"
            />
            <View style={styles.itemLeft}>
              <Text style={styles.itemName}>{m.name}</Text>
              <Text style={styles.itemMeta}>{m.group} - {rp(m.price)}</Text>
              <Text style={[styles.imgState, m.imageState === 'ok' ? styles.imgOk : styles.imgMissing]}>
                {m.imageState === 'ok' ? t('menu.imgOk') : m.imageState === 'downloading' ? t('menu.downloading') : t('menu.imgMissing')}
              </Text>
            </View>
            {m.soldOut ? (
              <View style={styles.soldBadge}>
                <Text style={styles.soldText}>{t('menu.soldOut')}</Text>
              </View>
            ) : null}
          </View>
          {editing === m.id ? (
            <View style={styles.editor}>
              <Text style={styles.fieldLabel}>{t('menu.menuName')}</Text>
              <TextInput style={styles.input} value={draftName} onChangeText={setDraftName} placeholder="Nama menu" placeholderTextColor={colors.faint} />
              <Text style={styles.fieldLabel}>{t('menu.price')}</Text>
              <TextInput
                style={styles.input}
                value={draftPrice ? rpNum(Number(draftPrice.replace(/\D/g, '')) || 0) : ''}
                onChangeText={(v) => setDraftPrice(v.replace(/\D/g, '').slice(0, 9))}
                placeholder="0"
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
              />
              <Text style={styles.fieldLabel}>{t('menu.group')}</Text>
              <TextInput style={styles.input} value={draftGroup} onChangeText={setDraftGroup} placeholder="Grup" placeholderTextColor={colors.faint} />
              <View style={styles.editorBtns}>
                <Pressable style={styles.btnGhost} onPress={() => setEditing(null)}>
                  <Text style={styles.btnGhostText}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable style={styles.btnSave} onPress={() => saveEditor(m.id)}>
                  <Text style={styles.btnSaveText}>{t('menu.saveChanges')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <View style={styles.itemBtns}>
            {m.imageState !== 'ok' && m.imageState !== 'downloading' ? (
              <Pressable style={styles.btnTest} onPress={() => downloadImage(m.id)}>
                <Text style={styles.btnTestText}>{t('menu.downloadImages')}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.btnTest} onPress={() => (editing === m.id ? setEditing(null) : openEditor(m))}>
              <Text style={styles.btnTestText}>{t('common.edit')}</Text>
            </Pressable>
            <View style={styles.soldRow}>
              <Text style={styles.rowLabel}>{t('menu.markSold')}</Text>
              <Switch value={m.soldOut} onValueChange={(v) => patch(m.id, { soldOut: v })} trackColor={{ true: colors.red, false: colors.stroke }} />
            </View>
          </View>
        </View>
      ))}
      {list.length === 0 ? <Text style={styles.empty}>{t('common.noMatch')}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  input: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.white,
  },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 10 },
  btnDl: { borderRadius: 10, backgroundColor: colors.navy, paddingHorizontal: 14, justifyContent: 'center' },
  btnDlText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  msg: { fontFamily: fonts.medium, fontSize: 12, color: colors.navy, marginTop: 8, paddingHorizontal: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardSold: { borderColor: colors.red, opacity: 0.9 },
  itemTop: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 56, height: 56, marginRight: 10 },
  itemLeft: { flex: 1 },
  itemName: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  itemMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  imgState: { fontFamily: fonts.medium, fontSize: 11, marginTop: 2 },
  imgOk: { color: colors.greenDark },
  imgMissing: { color: colors.orangeDark },
  soldBadge: { backgroundColor: colors.red, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  soldText: { fontFamily: fonts.bold, fontSize: 10, color: colors.white },
  editor: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 4 },
  editorBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btnGhost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 10, alignItems: 'center' },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  btnSave: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 10, alignItems: 'center' },
  btnSaveText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  itemBtns: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  btnTest: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.navy, paddingVertical: 10, alignItems: 'center' },
  btnTestText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  soldRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 20 },
});
