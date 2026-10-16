import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type StationId = 'kasir' | 'dapur' | 'checker' | 'label' | 'none';

interface MenuRoute {
  id: string;
  group: string;
  items: number;
  station: StationId;
  printLabel: boolean;
}

const STATIONS: { id: StationId; label: string }[] = [
  { id: 'kasir', label: 'Kasir' },
  { id: 'dapur', label: 'Dapur' },
  { id: 'checker', label: 'Checker' },
  { id: 'label', label: 'Label' },
  { id: 'none', label: 'Jangan Cetak' },
];

const DEFAULT_ROUTES: MenuRoute[] = [
  { id: 'r1', group: 'Makanan Utama', items: 24, station: 'dapur', printLabel: false },
  { id: 'r2', group: 'Makanan Ringan', items: 12, station: 'dapur', printLabel: false },
  { id: 'r3', group: 'Minuman', items: 18, station: 'checker', printLabel: false },
  { id: 'r4', group: 'Dessert', items: 8, station: 'checker', printLabel: false },
  { id: 'r5', group: 'Paket / Bundle', items: 6, station: 'dapur', printLabel: true },
];

export default function MenuPrintingScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [routes, setRoutes] = useState<MenuRoute[]>(DEFAULT_ROUTES);
  const [topMargin, setTopMargin] = useState('2');
  const [showPaymentInfo, setShowPaymentInfo] = useState(false);
  const [showSalesTime, setShowSalesTime] = useState(true);

  const patch = (id: string, p: Partial<MenuRoute>) =>
    setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const stationLabel = (id: StationId) => STATIONS.find((s) => s.id === id)?.label ?? id;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cetakan Menu</Text>
        <Text style={styles.headerSub}>Routing cetak per grup menu → station dapur/checker</Text>
      </View>

      {routes.map((r) => (
        <View key={r.id} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.cardLeft}>
              <Text style={styles.groupName}>{r.group}</Text>
              <Text style={styles.groupMeta}>{r.items} menu · cetak ke {stationLabel(r.station)}</Text>
            </View>
            <Image source={require('../../../assets/images/empty_menu.webp')} style={styles.thumb} resizeMode="contain" />
          </View>
          <View style={styles.chipRow}>
            {STATIONS.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => patch(r.id, { station: s.id })}
                style={[styles.chip, r.station === s.id && styles.chipActive]}>
                <Text style={[styles.chipText, r.station === s.id && styles.chipTextActive]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>Cetak label stiker utk grup ini</Text>
            <Switch value={r.printLabel} onValueChange={(v) => patch(r.id, { printLabel: v })} trackColor={{ true: colors.green, false: colors.stroke }} />
          </View>
        </View>
      ))}

      <View style={styles.card}>
        <Text style={styles.groupName}>Opsi Tiket Dapur</Text>
        <Text style={styles.groupMeta}>Margin atas & info tambahan pada tiket masak.</Text>
        <Text style={styles.fieldLabel}>Margin atas (baris kosong)</Text>
        <TextInput
          style={styles.input}
          value={topMargin}
          onChangeText={setTopMargin}
          keyboardType="numeric"
          placeholder="2"
          placeholderTextColor={colors.faint}
        />
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Tampilkan info pembayaran</Text>
          <Switch value={showPaymentInfo} onValueChange={setShowPaymentInfo} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Tampilkan jam penjualan</Text>
          <Switch value={showSalesTime} onValueChange={setShowSalesTime} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
      </View>
      <Text style={styles.foot}>Perubahan tersimpan otomatis di perangkat (mock in-memory).</Text>
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
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardLeft: { flex: 1, paddingRight: 10 },
  groupName: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  groupMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  thumb: { width: 56, height: 56 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  chipText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  chipTextActive: { color: colors.white },
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
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14 },
});
