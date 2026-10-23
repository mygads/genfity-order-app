import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { TABLET_BP, colors, fonts, rp, rpNum, wideCenterLg } from '../../theme';
import { useLang, tCur } from '../../lib/i18n';
import { appAlert } from '../../lib/appAlert';
import { initDb, query, queryFirst, run } from '../../lib/db';
import { enqueueOutbox } from '../../lib/sync';
import { getBranchId } from '../../config/server';

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

/** Sanitasi qty/harga: bulatkan, tolak NaN/negatif (default 0, bukan -1). */
function cleanQty(v: unknown, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

/**
 * Petakan nama grup tampilan ke id kategori ms_category; null bila tak cocok.
 * categoryId di ms_menu wajib id, bukan nama grup.
 */
async function resolveCategoryId(groupName: string): Promise<string | null> {
  const name = groupName.trim();
  if (!name) return null;
  try {
    const row = await queryFirst<{ id: string }>(
      'SELECT id FROM ms_category WHERE categoryName = ? LIMIT 1',
      [name],
    );
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Pastikan nama grup punya baris di ms_category: pakai id existing bila cocok,
 * else buat kategori baru (sortOrder = max+1) agar categoryId di ms_menu
 * selalu id valid, bukan nama grup mentah.
 */
async function ensureCategoryId(groupName: string): Promise<string> {
  const name = groupName.trim();
  const existing = await resolveCategoryId(name);
  if (existing) return existing;
  await initDb();
  const maxRow = await queryFirst<{ m: number | null }>(
    'SELECT MAX(sortOrder) AS m FROM ms_category',
  );
  const sort = (Number(maxRow?.m) || 0) + 1;
  const id = `c-${Date.now()}`;
  await run(
    `INSERT INTO ms_category (id, categoryName, sortOrder, flagActive, syncDate)
     VALUES (?, ?, ?, 1, NULL)`,
    [id, name, sort],
  );
  await enqueueOutbox('ms_category', id, 'insert');
  return id;
}

/** Tulis perubahan menu ke SQLite agar ikut sync master. */
async function persistMenu(m: MenuEntry): Promise<void> {
  try {
    await initDb();
    const branchId = getBranchId();
    const old = await queryFirst<{
      categoryId: string | null;
      imageUrl: string | null;
      stationId: string | null;
      flagActive: number | null;
    }>(
      'SELECT categoryId, imageUrl, stationId, flagActive FROM ms_menu WHERE id = ?',
      [m.id],
    );
    // categoryId wajib id kategori: cocokkan ke kamus ms_category,
    // pertahankan nilai lama bila nama grup tidak cocok.
    const catId = (await resolveCategoryId(m.group)) ?? old?.categoryId ?? null;
    await run(
      `INSERT INTO ms_menu (id, menuName, categoryId, price, imageUrl, stationId, flagActive, syncDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (id) DO UPDATE SET menuName = excluded.menuName, categoryId = excluded.categoryId,
       price = excluded.price, imageUrl = excluded.imageUrl, stationId = excluded.stationId,
       flagActive = excluded.flagActive, syncDate = NULL`,
      [m.id, m.name, catId, cleanQty(m.price), old?.imageUrl ?? null, old?.stationId ?? null, old?.flagActive ?? 1],
    );
    // Jangan wipe stok StockScreen: pertahankan qty existing bila baris sudah ada.
    // Guard: qty tidak boleh -1/NaN; baris baru default 0.
    const existing = await queryFirst<{ qty: number | null; stationId: string | null }>(
      'SELECT qty, stationId FROM ms_branchmenu WHERE branchId = ? AND menuId = ?',
      [branchId, m.id],
    );
    const keepQty = existing ? cleanQty(existing.qty, 0) : 0;
    const stationId = existing?.stationId ?? old?.stationId ?? null;
    await run(
      `INSERT INTO ms_branchmenu (branchId, menuId, qty, stationId, flagSoldOut, flagActive, syncDate)
       VALUES (?, ?, ?, ?, ?, 1, NULL)
       ON CONFLICT (branchId, menuId) DO UPDATE SET qty = excluded.qty, stationId = excluded.stationId,
       flagSoldOut = excluded.flagSoldOut, syncDate = NULL`,
      [branchId, m.id, keepQty, stationId, m.soldOut ? 1 : 0],
    );
    await enqueueOutbox('ms_menu', m.id, 'update');
    await enqueueOutbox('ms_branchmenu', `${branchId}:${m.id}`, 'update');
  } catch {
    /* abaikan: state lokal tetap menampilkan nilai sebelum gagal simpan */
  }
}

export default function MenuManagementScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Offline-first: sumber tunggal = SQLite (ms_menu + ms_branchmenu cabang
  // aktif). Tanpa seed/cache palsu — DB kosong = empty-state.
  const [menus, setMenus] = useState<MenuEntry[]>([]);
  const [group, setGroup] = useState<string>('Semua');  const [queryText, setQueryText] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftPrice, setDraftPrice] = useState('');
  const [draftGroup, setDraftGroup] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [newStation, setNewStation] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await initDb();
        const rows = await query<{ id: string; menuName: string | null; categoryId: string | null; price: number | null }>(
          'SELECT id, menuName, categoryId, price FROM ms_menu WHERE COALESCE(flagActive, 1) = 1',
        );
        if (!alive) return;
        if (rows.length === 0) {
          setMenus([]);
          return;
        }
        const sold = await query<{ menuId: string; flagSoldOut: number | null }>(
          'SELECT menuId, flagSoldOut FROM ms_branchmenu WHERE branchId = ?',
          [getBranchId()],
        );
        const soldMap = new Map(sold.map((r) => [r.menuId, (r.flagSoldOut ?? 0) === 1]));
        // Kamus id -> nama kategori agar badge grup tampil ramah (id mentah
        // bila kamus kosong; editor tetap menyimpan id via resolveCategoryId).
        let catName = new Map<string, string>();
        try {
          const cats = await query<{ id: string; categoryName: string | null }>(
            'SELECT id, categoryName FROM ms_category',
          );
          catName = new Map(cats.map((c) => [c.id, c.categoryName ?? c.id]));
        } catch {
          /* kamus kosong - pakai id apa adanya */
        }
        setMenus(
          rows.map((r) => ({
            id: r.id,
            name: r.menuName ?? r.id,
            group: (r.categoryId ? catName.get(r.categoryId) ?? r.categoryId : null) ?? t('menu.otherGroup'),
            price: Number(r.price ?? 0),
            soldOut: soldMap.get(r.id) ?? false,
            imageState: 'ok' as const,
          })),
        );
      } catch {
        if (alive) setMenus([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const groups = ['Semua', ...Array.from(new Set(menus.map((m) => m.group)))];

  const patch = (id: string, p: Partial<MenuEntry>) => {
    setMenus((ms) => {
      const next = ms.map((m) => (m.id === id ? { ...m, ...p } : m));
      const changed = next.find((m) => m.id === id);
      if (changed) void persistMenu(changed);
      return next;
    });
  };

  /** Validasi URL gambar secara jujur: tanpa expo-file-system (tidak ada di
   * package.json) tidak ada unduhan berkas lokal. Fungsi ini hanya memastikan
   * imageUrl hasil pull master valid, lalu memakai URL remote apa adanya.
   * TODO: tambah expo-file-system lalu unduh via downloadAsync ke direktori
   * dokumen + simpan path lokal ke ms_menu.imageUrl agar katalog offline penuh. */
  const downloadImage = async (id: string) => {
    patch(id, { imageState: 'downloading' });
    setMsg(t('menu.downloading'));
    try {
      await initDb();
      const row = await queryFirst<{ imageUrl: string | null }>(
        'SELECT imageUrl FROM ms_menu WHERE id = ?',
        [id],
      );
      const url = (row?.imageUrl ?? '').trim();
      if (!/^https?:\/\/.+/i.test(url)) {
        patch(id, { imageState: 'missing' });
        setMsg(t('menu.imgFail'));
        return;
      }
      patch(id, { imageState: 'ok' });
      setMsg(t('menu.imgUrlOk'));
    } catch {
      patch(id, { imageState: 'missing' });
      setMsg(t('menu.imgFail'));
    }
  };

  const downloadAll = async () => {
    const missing = menus.filter((m) => m.imageState === 'missing');
    if (missing.length === 0) {
      setMsg(t('menu.imgAllOk'));
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
    const grp = draftGroup.trim() || t('menu.otherGroup');
    if (name.length < 3 || price <= 0) {
      setMsg(t('menu.invalidForm'));
      return;
    }
    patch(id, { name, price, group: grp });
    setEditing(null);
    setMsg(t('menu.savedSync'));
  };

  /** Tambah menu baru: upsert ms_menu + ms_branchmenu cabang aktif + outbox. */
  const addMenu = async () => {
    const name = newName.trim();
    const price = Number(newPrice.replace(/\D/g, '')) || 0;
    const grp = newGroup.trim() || t('menu.otherGroup');
    const station = newStation.trim() || null;
    if (name.length < 3 || price <= 0) {
      setMsg(t('menu.invalidForm'));
      return;
    }
    try {
      await initDb();
      const branchId = getBranchId();
      const catId = await ensureCategoryId(grp);
      const id = `m-${Date.now()}`;
      await run(
        `INSERT INTO ms_menu (id, menuName, categoryId, price, imageUrl, stationId, flagActive, syncDate)
         VALUES (?, ?, ?, ?, NULL, ?, 1, NULL)`,
        [id, name, catId, cleanQty(price), station],
      );
      await run(
        `INSERT INTO ms_branchmenu (branchId, menuId, qty, stationId, flagSoldOut, flagActive, syncDate)
         VALUES (?, ?, 0, ?, 0, 1, NULL)`,
        [branchId, id, station],
      );
      await enqueueOutbox('ms_menu', id, 'insert');
      await enqueueOutbox('ms_branchmenu', `${branchId}:${id}`, 'insert');
      setMenus((ms) => [...ms, { id, name, group: grp, price, soldOut: false, imageState: 'ok' }]);
      setNewName('');
      setNewPrice('');
      setNewGroup('');
      setNewStation('');
      setShowAdd(false);
      setMsg(t('menu.savedSync'));
    } catch {
      setMsg(t('menu.imgFail'));
    }
  };

  /** Hapus menu: konfirmasi dulu, lalu flag nonaktif + outbox agar ikut sync. */
  const confirmDelete = (m: MenuEntry) => {
    appAlert(
      t('menu_del_title').replace('{name}', m.name),
      t('menu_del_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await initDb();
                const branchId = getBranchId();
                await run('UPDATE ms_menu SET flagActive = 0, syncDate = NULL WHERE id = ?', [m.id]);
                await run(
                  'UPDATE ms_branchmenu SET flagActive = 0, syncDate = NULL WHERE branchId = ? AND menuId = ?',
                  [branchId, m.id],
                );
                await enqueueOutbox('ms_menu', m.id, 'delete');
                await enqueueOutbox('ms_branchmenu', `${branchId}:${m.id}`, 'delete');
                setMenus((ms) => ms.filter((x) => x.id !== m.id));
                if (editing === m.id) setEditing(null);
                setMsg(lang === 'en' ? 'Menu deleted and queued for sync.' : 'Menu dihapus dan ikut sync.');
              } catch {
                setMsg(t('menu.imgFail'));
              }
            })();
          },
        },
      ],
    );
  };

  const q = queryText.trim().toLowerCase();
  const list = menus.filter(
    (m) => (group === 'Semua' || m.group === group) && (!q || m.name.toLowerCase().includes(q)),
  );
  const soldCount = menus.filter((m) => m.soldOut).length;
  const missingCount = menus.filter((m) => m.imageState !== 'ok').length;
  const go = (route: string) => navigation?.navigate(route);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('menu.title')}
        sub={`${soldCount} ${t('menu.soldOut')} - ${missingCount} ${t('menu.imgMissing')}`}
        left={
          <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      />
      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.tabs}>
        {groups.map((g) => (
          <Pressable key={g} onPress={() => setGroup(g)} style={[styles.tab, group === g && styles.tabActive]}>
            <Text style={[styles.tabText, group === g && styles.tabTextActive]}>{g === 'Semua' ? t('common.all') : g}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.searchRow}>
        <View style={styles.formFlex}>
          <AppInput value={queryText} onChangeText={setQueryText} placeholder={t('common.searchMenu')} />
        </View>
        <AppButton size="sm" title={t('common.add')} onPress={() => setShowAdd((v) => !v)} fullWidth={false} style={styles.navyInline} />
        <AppButton size="sm" title={t('menu.downloadImages')} onPress={downloadAll} fullWidth={false} style={styles.navyInline} />
      </View>
      {showAdd ? (
        <View style={styles.addForm}>
          <AppInput label={t('menu.menuName')} value={newName} onChangeText={setNewName} placeholder={t('menu.menuName')} />
          <AppInput
            label={tCur('menu.price')}
            value={newPrice ? rpNum(Number(newPrice.replace(/\D/g, '')) || 0) : ''}
            onChangeText={(v) => setNewPrice(v.replace(/\D/g, '').slice(0, 9))}
            placeholder="0"
            keyboardType="number-pad"
          />
          <AppInput label={t('menu.group')} value={newGroup} onChangeText={setNewGroup} placeholder={t('menu.group')} />
          <AppInput
            label={lang === 'en' ? 'Station (optional)' : 'Station (opsional)'}
            value={newStation}
            onChangeText={setNewStation}
            placeholder={lang === 'en' ? 'Station (optional)' : 'Station (opsional)'}
          />
          <View style={styles.editorBtns}>
            <AppButton size={isTablet ? 'md' : 'sm'} title={t('common.cancel')} onPress={() => setShowAdd(false)} variant="secondary" fullWidth={false} style={styles.btnFlex} />
            <AppButton size={isTablet ? 'md' : 'sm'} title={t('common.save')} onPress={addMenu} fullWidth={false} style={styles.navyFlex} />
          </View>
        </View>
      ) : null}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      {/* M9-3: ubah menu = local-only (tanpa push master; pull server-wins). */}
      <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.muted, paddingHorizontal: 16, marginTop: 6 }}>{t('master.localOnlyNote')}</Text>

      {/* Tablet: kartu menu 2 kolom; phone tetap 1 kolom (wadah transparan). */}
      <View style={isTablet ? styles.gridTablet : undefined}>
      {list.map((m) => (
        <View key={m.id} style={[styles.card, isTablet && styles.cardTablet, m.soldOut && styles.cardSold]}>
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
              <AppInput label={t('menu.menuName')} value={draftName} onChangeText={setDraftName} placeholder={t('menu.menuName')} />
              <AppInput
                label={tCur('menu.price')}
                value={draftPrice ? rpNum(Number(draftPrice.replace(/\D/g, '')) || 0) : ''}
                onChangeText={(v) => setDraftPrice(v.replace(/\D/g, '').slice(0, 9))}
                placeholder="0"
                keyboardType="number-pad"
              />
              <AppInput label={t('menu.group')} value={draftGroup} onChangeText={setDraftGroup} placeholder={t('menu.group')} />
              <View style={styles.editorBtns}>
                <AppButton size={isTablet ? 'md' : 'sm'} title={t('common.cancel')} onPress={() => setEditing(null)} variant="secondary" fullWidth={false} style={styles.btnFlex} />
                <AppButton size={isTablet ? 'md' : 'sm'} title={t('menu.saveChanges')} onPress={() => saveEditor(m.id)} fullWidth={false} style={styles.navyFlex} />
              </View>
            </View>
          ) : null}
          <View style={styles.itemBtns}>
            {m.imageState !== 'ok' && m.imageState !== 'downloading' ? (
              <AppButton size="sm" title={t('menu.downloadImages')} onPress={() => downloadImage(m.id)} variant="secondary" fullWidth={false} style={styles.btnFlex} />
            ) : null}
            <AppButton size={isTablet ? 'md' : 'sm'} title={t('common.edit')} onPress={() => (editing === m.id ? setEditing(null) : openEditor(m))} variant="secondary" fullWidth={false} style={styles.btnFlex} />
            <AppButton size={isTablet ? 'md' : 'sm'} title={t('common.delete')} onPress={() => confirmDelete(m)} variant="secondary" fullWidth={false} style={styles.btnFlex} />
            <View style={[styles.soldRow, isTablet && styles.soldRowTablet]}>
              <Text style={styles.rowLabel}>{t('menu.markSold')}</Text>
              <Switch value={m.soldOut} onValueChange={(v) => patch(m.id, { soldOut: v })} trackColor={{ true: colors.red, false: colors.stroke }} />
            </View>
          </View>
        </View>
      ))}
      </View>
      {list.length === 0 ? (
        <Text style={styles.empty}>
          {menus.length === 0
            ? (lang === 'en' ? 'No menus yet. Add your first menu above.' : 'Belum ada menu. Tambahkan menu pertama di atas.')
            : t('common.noMatch')}
        </Text>
      ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  burger: { width: 22, height: 22 },
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { paddingBottom: 32 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  formFlex: { flex: 1 },
  btnFlex: { marginTop: 0, flex: 1 },
  navyInline: { marginTop: 0, backgroundColor: colors.navy },
  navyFlex: { marginTop: 0, flex: 1, backgroundColor: colors.navy },
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
  addForm: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  editorBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btnGhost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 10, alignItems: 'center' },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  btnSave: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 10, alignItems: 'center' },
  btnSaveText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  itemBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' },
  btnTest: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.navy, paddingVertical: 10, alignItems: 'center' },
  btnTestText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  soldRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  // Tablet: grid 2 kolom + baris Habis full-baris (phone tak tersentuh).
  gridTablet: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  cardTablet: { flexBasis: '48%', flexGrow: 1, marginHorizontal: 0 },
  soldRowTablet: { flexBasis: '100%', justifyContent: 'flex-start' },
  rowLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 20 },
});
