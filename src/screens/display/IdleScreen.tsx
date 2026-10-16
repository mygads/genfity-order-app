import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenterLg } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

const PROMOS = [
  { id: 'p1', title: 'Promo QOQI10', desc: 'Diskon Rp 5.000 untuk member GOLD', image: require('../../../assets/images/application_banner.webp') },
  { id: 'p2', title: 'Paket Hemat Ber-2', desc: 'Nasi goreng + 2 es teh · Rp 55.000', image: require('../../../assets/images/esb_logo_white.webp') },
  { id: 'p3', title: 'Jam Ramai 12.00', desc: 'Gratis es teh tiap pembelian ayam geprek', image: require('../../../assets/images/application_banner.webp') },
];

/** Layar idle / display promosi saat kasir tidak dipakai. Ketuk utk kembali order. */
export default function IdleScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % PROMOS.length), 5000);
    return () => clearInterval(t);
  }, []);

  const promo = PROMOS[idx];

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.hero}>
        <Image source={require('../../../assets/images/esb_logo_white.webp')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.shop}>ESB CABANG PORIS</Text>
        <Text style={styles.heroSub}>Selamat datang — silakan order di kasir</Text>
      </View>
      <View style={styles.promoCard}>
        <Image source={promo.image} style={styles.promoImg} resizeMode="contain" />
        <Text style={styles.promoTitle}>{promo.title}</Text>
        <Text style={styles.promoDesc}>{promo.desc}</Text>
        <View style={styles.dots}>
          {PROMOS.map((p, i) => (
            <TouchableOpacity key={p.id} onPress={() => setIdx(i)} style={[styles.dot, i === idx && styles.dotActive]} />
          ))}
        </View>
      </View>
      <View style={styles.infoRow}>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Jam Buka</Text>
          <Text style={styles.infoSub}>08.00 – 22.00 WIB</Text>
        </View>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Wi-Fi</Text>
          <Text style={styles.infoSub}>ESB-PORIS</Text>
        </View>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Antrean</Text>
          <Text style={styles.infoSub}>3 disiapkan</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.cta} onPress={() => navigation?.navigate('Cashier')}>
        <Text style={styles.ctaText}>Ketuk untuk Memesan ›</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Mode pajangan — layar tetap menyala (keep-awake) via dev-client.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navyDark },
  body: { padding: 16, paddingBottom: 40 },
  hero: { alignItems: 'center', marginTop: 20 },
  logo: { width: 130, height: 64 },
  shop: { fontFamily: fonts.bold, fontSize: 24, color: colors.white, marginTop: 8 },
  heroSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.navyTint, marginTop: 4 },
  promoCard: { backgroundColor: colors.white, borderRadius: 16, padding: 18, marginTop: 20, alignItems: 'center' },
  promoImg: { width: '100%', height: 150 },
  promoTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 12 },
  promoDesc: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginTop: 4, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginTop: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.line },
  dotActive: { backgroundColor: colors.orange },
  infoRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  infoBox: { flex: 1, backgroundColor: colors.navy, borderRadius: 12, padding: 12, alignItems: 'center' },
  infoTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  infoSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 2 },
  cta: { backgroundColor: colors.orange, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  ctaText: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 10 },
});
