import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenterLg } from '../../theme';

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

const DEFAULT_MENUS: MenuEntry[] = [
  { id: 'm1', name: 'Ayam Geprek Pelakor', group: 'Makanan Utama', price: 45000, soldOut: false, imageState: 'ok' },
  { id: 'm2', name: 'Es Teh Manis', group: 'Minuman', price: 8000, soldOut: false, imageState: 'ok' },
  { id: 'm3', name: 'Lele Goreng', group: 'Makanan Utama', price: 22000, soldOut: false, imageState: 'missing' },
  { id: 'm4', name: 'Kopi Robusta', group: 'Minuman', price: 15000, soldOut: true, imageState: 'ok' },
  { id: 'm5', name: 'Mie Goreng Jawa', group: 'Makanan Utama', price: 22000, soldOut: true, imageState: 'missing' },
];

const groups = ['Semua', 'Makanan Utama', 'Minuman'] as const;

export default function MenuManagementScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [menus, setMenus] = useState<MenuEntry[]>(DEFAULT_MENUS);
  const [group, setGroup] = useState<(typeof groups)[number]>('Semua');
  const [query, setQuery] = useState('');
  const [msg, setMsg] = useState('');

  const patch = (id: string, p: Partial<MenuEntry>) =>
    setMenus((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));

  /** Unduh gambar menu (stub): simulasi progres in-memory. */
  const downloadImage = (id: string) => {
    patch(id, { imageState: 'downloading' });
    setMsg('Mengunduh gambar menu…');
    setTimeout(() => {
      patch(id, { imageState: 'ok' });
      setMsg('Gambar menu terunduh.');
    }, 1500);
  };

  const downloadAll = () => {
    const missing = menus.filter((m) => m.imageState === 'missing');
    if (missing.length === 0) {
      setMsg('Semua gambar menu sudah lengkap.');
      return;
    }
    missing.forEach((m) => patch(m.id, { imageState: 'downloading' }));
    setMsg(`Mengunduh ${missing.length} gambar…`);
    setTimeout(() => {
      setMenus((ms) => ms.map((m) => (m.imageState === 'downloading' ? { ...m, imageState: 'ok' } : m)));
      setMsg('Semua gambar terunduh.');
    }, 2000);
  };

  const q = query.trim().toLowerCase();
  const list = menus.filter(
    (m) => (group === 'Semua' || m.group === group) && (!q || m.name.toLowerCase().includes(q)),
  );
  const soldCount = menus.filter((m) => m.soldOut).length;
  const missingCount = menus.filter((m) => m.imageState !== 'ok').length;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Manajemen Menu</Text>
        <Text style={styles.headerSub}>{soldCount} habis · {missingCount} gambar belum terunduh</Text>
      </View>

      <View style={styles.tabs}>
        {groups.map((g) => (
          <Pressable key={g} onPress={() => setGroup(g)} style={[styles.tab, group === g && styles.tabActive]}>
            <Text style={[styles.tabText, group === g && styles.tabTextActive]}>{g}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.searchRow}>
        <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Cari menu…" placeholderTextColor={colors.faint} />
        <Pressable style={styles.btnDl} onPress={downloadAll}>
          <Text style={styles.btnDlText}>Unduh Gambar</Text>
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
              <Text style={styles.itemMeta}>{m.group} · {rp(m.price)}</Text>
              <Text style={[styles.imgState, m.imageState === 'ok' ? styles.imgOk : styles.imgMissing]}>
                {m.imageState === 'ok' ? 'Gambar tersedia' : m.imageState === 'downloading' ? 'Mengunduh…' : 'Gambar belum ada'}
              </Text>
            </View>
            {m.soldOut ? (
              <View style={styles.soldBadge}>
                <Text style={styles.soldText}>HABIS</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.itemBtns}>
            {m.imageState !== 'ok' && m.imageState !== 'downloading' ? (
              <Pressable style={styles.btnTest} onPress={() => downloadImage(m.id)}>
                <Text style={styles.btnTestText}>Unduh Gambar</Text>
              </Pressable>
            ) : null}
            <View style={styles.soldRow}>
              <Text style={styles.rowLabel}>Tandai habis</Text>
              <Switch value={m.soldOut} onValueChange={(v) => patch(m.id, { soldOut: v })} trackColor={{ true: colors.red, false: colors.stroke }} />
            </View>
          </View>
        </View>
      ))}
      {list.length === 0 ? <Text style={styles.empty}>Tidak ada menu yang cocok.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },
  header: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 16, paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
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
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.white,
  },
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
  itemBtns: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  btnTest: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.navy, paddingVertical: 10, alignItems: 'center' },
  btnTestText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  soldRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 20 },
});
