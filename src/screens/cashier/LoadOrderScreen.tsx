import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

interface Saved { id: string; badge: string; mode: string; title: string; detail: string; }

const SEED: Saved[] = [
  { id: 'o1', badge: 'TA', mode: 'Take Away', title: 'Bawa Pulang · QoQi', detail: '2 item · ' + rp(33900) + ' · 13:10' },
  { id: 'o2', badge: 'DI', mode: 'Dine In', title: 'Dine In · Meja A5', detail: '4 item · ' + rp(87500) + ' · 12:48' },
  { id: 'o3', badge: 'OL', mode: 'Online', title: 'Online · GoFood #GO-88213', detail: '2 item · ' + rp(45800) + ' · 13:42' },
];

const FILTERS = ['Semua', 'Dine In', 'Take Away', 'Online'];

/** Order tersimpan (load_order) — muat kembali order yang disimpan dari kasir. */
export default function LoadOrderScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [orders, setOrders] = useState<Saved[]>(SEED);
  const [filter, setFilter] = useState('Semua');

  const shown = orders.filter((o) => filter === 'Semua' || o.mode === filter);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.hint}>Muat atau hapus order — order dengan perubahan belum disimpan akan diminta konfirmasi sebelum dimuat.</Text>
      <Text style={styles.sec}>Muat Order</Text>
      <Text style={styles.hint}>Order yang disimpan dari kasir dan belum dibayar.</Text>
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipOn]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipT, filter === f && styles.chipTOn]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {shown.length === 0 && (
        <View style={styles.emptyWrap}>
          <Image
            source={require('../../../assets/images/empty_order.webp')}
            style={styles.emptyImg}
            resizeMode="contain"
          />
          <Text style={styles.empty}>Daftar Transaksi Tersimpan kosong — order yang disimpan dari kasir akan muncul di sini.</Text>
        </View>
      )}
      {shown.map((o) => (
        <View key={o.id} style={styles.card}>
          <View style={styles.badge}><Text style={styles.badgeT}>{o.badge}</Text></View>
          <View style={styles.info}>
            <Text style={styles.title}>{o.title}</Text>
            <Text style={styles.detail}>{o.detail}</Text>
          </View>
          <TouchableOpacity style={styles.load} onPress={() => navigation?.navigate('Cashier')}>
            <Text style={styles.loadT}>Muat</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setOrders((l) => l.filter((x) => x.id !== o.id))}>
            <Text style={styles.del}>Hapus</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={styles.primary} onPress={() => navigation?.navigate('Cashier')}>
        <Text style={styles.primaryT}>+ Tambah Transaksi Baru</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 12, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  emptyWrap: { alignItems: 'center', paddingVertical: 24 },
  emptyImg: { width: 120, height: 120 },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, backgroundColor: colors.card, borderRadius: 10, padding: 14, marginTop: 8, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paleBlue, alignItems: 'center', justifyContent: 'center' },
  badgeT: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy },
  info: { flex: 1 },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  detail: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  load: { backgroundColor: colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  loadT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  del: { fontFamily: fonts.semibold, fontSize: 12, color: colors.faint },
  primary: { backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
