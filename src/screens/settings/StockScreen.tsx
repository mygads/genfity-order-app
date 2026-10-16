import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

interface StockItem {
  id: string;
  name: string;
  group: string;
  stock: number;
  online: boolean;
  track: boolean;
}

const DEFAULT_ITEMS: StockItem[] = [
  { id: 'm1', name: 'Ayam Geprek Pelakor', group: 'Makanan Utama', stock: 24, online: true, track: true },
  { id: 'm2', name: 'Es Teh Manis', group: 'Minuman', stock: 60, online: true, track: true },
  { id: 'm3', name: 'Lele Goreng', group: 'Makanan Utama', stock: 2, online: false, track: true },
  { id: 'm4', name: 'Kopi Robusta', group: 'Minuman', stock: 5, online: true, track: true },
  { id: 'm5', name: 'Mie Goreng Jawa', group: 'Makanan Utama', stock: 0, online: false, track: true },
];

export default function StockScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [trackStock, setTrackStock] = useState(true);
  const [lowWarn, setLowWarn] = useState(true);
  const [lowLimit, setLowLimit] = useState('5');
  const [allowSellEmpty, setAllowSellEmpty] = useState(false);
  const [onlineSync, setOnlineSync] = useState(true);
  const [items, setItems] = useState<StockItem[]>(DEFAULT_ITEMS);
  const [query, setQuery] = useState('');

  const patch = (id: string, p: Partial<StockItem>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const bump = (id: string, d: number) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, stock: Math.max(0, x.stock + d) } : x)));

  const q = query.trim().toLowerCase();
  const list = items.filter((x) => !q || x.name.toLowerCase().includes(q) || x.group.toLowerCase().includes(q));
  const lowCount = items.filter((x) => x.stock <= Number(lowLimit) || 0).length;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Pengaturan Stok</Text>
        <Text style={styles.headerSub}>Stok lokal & stok menu online · {lowCount} item menipis</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pelacakan Stok</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Lacak stok menu</Text>
          <Switch value={trackStock} onValueChange={setTrackStock} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Peringatan stok menipis</Text>
          <Switch value={lowWarn} onValueChange={setLowWarn} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <Text style={styles.fieldLabel}>Batas stok menipis</Text>
        <TextInput style={styles.input} value={lowLimit} onChangeText={setLowLimit} keyboardType="numeric" placeholder="5" placeholderTextColor={colors.faint} />
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Tetap jual saat stok habis</Text>
          <Switch value={allowSellEmpty} onValueChange={setAllowSellEmpty} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Stok Menu Online</Text>
        <Text style={styles.cardSub}>Menu online (ESB order) ikut stok lokal bila sinkron aktif.</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Sinkron stok online</Text>
          <Switch value={onlineSync} onValueChange={setOnlineSync} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
      </View>

      <View style={styles.searchWrap}>
        <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Cari menu…" placeholderTextColor={colors.faint} />
      </View>

      {list.map((x) => {
        const low = x.stock <= (Number(lowLimit) || 0);
        return (
          <View key={x.id} style={[styles.card, low && styles.cardLow]}>
            <View style={styles.itemTop}>
              <Image source={require('../../../assets/images/empty_menu.webp')} style={styles.thumb} resizeMode="contain" />
              <View style={styles.itemLeft}>
                <Text style={styles.itemName}>{x.name}</Text>
                <Text style={styles.itemMeta}>
                  {x.group} · sisa {x.stock}{low ? ' · MENIPIS' : x.stock === 0 ? ' · HABIS' : ''}
                </Text>
              </View>
              <View style={styles.stepper}>
                <Pressable style={styles.stepBtn} onPress={() => bump(x.id, -1)}>
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.stepVal}>{x.stock}</Text>
                <Pressable style={styles.stepBtn} onPress={() => bump(x.id, 1)}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>Tampil di menu online</Text>
              <Switch value={x.online} onValueChange={(v) => patch(x.id, { online: v })} trackColor={{ true: colors.green, false: colors.stroke }} />
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>Lacak stok item ini</Text>
              <Switch value={x.track} onValueChange={(v) => patch(x.id, { track: v })} trackColor={{ true: colors.green, false: colors.stroke }} />
            </View>
          </View>
        );
      })}
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
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardLow: { borderColor: colors.red },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  fieldLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted, marginTop: 10 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.white,
    marginTop: 6,
  },
  searchWrap: { paddingHorizontal: 16, marginTop: 12 },
  itemTop: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 48, height: 48, marginRight: 10 },
  itemLeft: { flex: 1 },
  itemName: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  itemMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  stepVal: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, minWidth: 28, textAlign: 'center' },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 20 },
});
