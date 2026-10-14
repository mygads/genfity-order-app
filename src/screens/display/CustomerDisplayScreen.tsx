import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenterLg } from '../../theme';

/**
 * Layar kedua / mode pajangan untuk pelanggan: nomor antrean Disiapkan vs
 * Siap Diambil. Dibuka dari Pengaturan → Tampilan Pelanggan.
 */
const READY0 = ['A-01', 'A-03'];
const PREP0 = ['A-04', 'A-05', 'A-06'];

export default function CustomerDisplayScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [ready, setReady] = useState<string[]>(READY0);
  const [prep, setPrep] = useState<string[]>(PREP0);

  const callNext = () => {
    if (prep.length === 0) return;
    const [next, ...rest] = prep;
    setPrep(rest);
    setReady((r) => [next, ...r].slice(0, 6));
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.hero}>
        <Text style={styles.shop}>ESB CABANG PORIS</Text>
        <Text style={styles.heroSub}>Nomor pesanan Anda tampil di bawah</Text>
      </View>

      <View style={[styles.cols, !isTablet && styles.colsPhone]}>
        <View style={styles.col}>
          <Text style={styles.colTitle}>⏳ Disiapkan</Text>
          {prep.length === 0 && <Text style={styles.empty}>—</Text>}
          {prep.map((n) => (
            <View key={n} style={styles.ticketPrep}>
              <Text style={[styles.ticketNo, isTablet && styles.ticketNoBig]}>{n}</Text>
            </View>
          ))}
        </View>
        <View style={styles.col}>
          <Text style={styles.colTitle}>🔔 Siap Diambil</Text>
          {ready.length === 0 && <Text style={styles.empty}>—</Text>}
          {ready.map((n, i) => (
            <View key={n} style={[styles.ticketReady, i === 0 && styles.ticketFirst]}>
              <Text style={[styles.ticketNo, styles.ticketNoReady, isTablet && styles.ticketNoBig]}>{n}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.promo}>
        <Text style={styles.promoT}>Promo: QOQI10 — diskon Rp 5.000 untuk member GOLD</Text>
      </View>

      <TouchableOpacity style={styles.primary} onPress={callNext} disabled={prep.length === 0}>
        <Text style={styles.primaryT}>
          {prep.length === 0 ? 'Semua pesanan siap' : `Panggil ${prep[0]} ›`}
        </Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Mode demo — antrean dikelola kasir di layar utama.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navyDark },
  body: { padding: 16, paddingBottom: 40 },
  hero: { alignItems: 'center', marginTop: 12 },
  shop: { fontFamily: fonts.bold, fontSize: 22, color: colors.white },
  heroSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  cols: { flexDirection: 'row', gap: 12, marginTop: 16 },
  colsPhone: { flexDirection: 'column' },
  col: { flex: 1 },
  colTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.white, marginBottom: 8 },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.navyTint },
  ticketPrep: {
    backgroundColor: colors.navy,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    alignItems: 'center',
  },
  ticketReady: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    alignItems: 'center',
  },
  ticketFirst: { borderWidth: 3, borderColor: colors.orange },
  ticketNo: { fontFamily: fonts.bold, fontSize: 28, color: colors.white },
  ticketNoReady: { color: colors.navy },
  ticketNoBig: { fontSize: 40 },
  promo: {
    backgroundColor: colors.orange,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  promoT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white, textAlign: 'center' },
  primary: { backgroundColor: colors.white, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 10 },
});
