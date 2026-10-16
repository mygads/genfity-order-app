import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { from?: string } } };

type Occupied = { table: string; guest: string; items: number; total: number };
const OCCUPIED: Occupied[] = [
  { table: 'A-03', guest: 'Andini · 4 tamu', items: 5, total: 86400 },
  { table: 'B-01', guest: 'Rudi · 2 tamu', items: 2, total: 41000 },
  { table: 'VIP-1', guest: 'PT Maju Jaya · 10 tamu', items: 12, total: 486000 },
];
const EMPTY = ['A-05 (4 kursi)', 'B-02 (2 kursi)', 'C-01 (2 kursi)', 'T-01 (teras)'];

/**
 * Pindah Meja (move_table) — pindah seluruh transaksi ke meja lain.
 * Daftarkan route: MoveTable.
 */
export default function MoveTableScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [from, setFrom] = useState(route?.params?.from ?? OCCUPIED[0]?.table ?? 'A-03');
  const [to, setTo] = useState(EMPTY[0] as string);
  const [done, setDone] = useState(false);

  const src = OCCUPIED.find((o) => o.table === from);

  const move = () => {
    if (!src) return;
    setDone(true);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pindah Meja</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <Text style={styles.hint}>Seluruh item, catatan, dan total ikut pindah — meja asal jadi kosong.</Text>
        <Text style={styles.label}>Dari meja (terisi)</Text>
        <View style={styles.chips}>
          {OCCUPIED.map((o) => (
            <TouchableOpacity
              key={o.table}
              style={[styles.chip, from === o.table && styles.chipOn]}
              onPress={() => { setFrom(o.table); setDone(false); }}>
              <Text style={[styles.chipT, from === o.table && styles.chipTOn]}>{o.table}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {src && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Meja {src.table} · {src.guest}</Text>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Item</Text>
              <Text style={styles.cardVal}>{src.items} item</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Total berjalan</Text>
              <Text style={styles.cardVal}>{rp(src.total)}</Text>
            </View>
          </View>
        )}

        <Text style={styles.label}>Ke meja (kosong)</Text>
        <View style={styles.chips}>
          {EMPTY.map((t) => (
            <TouchableOpacity key={t} style={[styles.chip, to === t && styles.chipOn]} onPress={() => setTo(t)}>
              <Text style={[styles.chipT, to === t && styles.chipTOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {done && src ? (
          <Text style={styles.done}>Transaksi {src.table} ({rp(src.total)}) dipindahkan ke {to}.</Text>
        ) : null}

        <TouchableOpacity style={styles.primary} onPress={move}>
          <Text style={styles.primaryT}>Pindahkan Meja ›</Text>
        </TouchableOpacity>
        <View style={styles.links}>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}>
            <Text style={styles.link}>Lihat Denah Meja ›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Cashier', { table: to.split(' ')[0] })}>
            <Text style={styles.link}>Buka di Kasir ›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.navy, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  back: { color: colors.white, fontSize: 26, fontFamily: fonts.bold },
  headerTitle: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 16, textAlign: 'center' },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  cardLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  cardVal: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  done: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark, marginTop: 12 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
});
