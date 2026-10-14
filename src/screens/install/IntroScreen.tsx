import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenterSm } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };

const PAGES = [
  {
    img: require('../../../assets/images/scan_illustration.webp'),
    title: 'Pembayaran modern',
    desc: 'Ciptakan pengalaman membayar yang cepat, praktis, dan aman bagi konsumen. Tinggal scan QRIS Dinamis, transaksi berhasil!',
  },
  {
    img: require('../../../assets/images/application_banner_phone.webp'),
    title: 'Laporan bisnis yang akurat',
    desc: 'Kontrol penuh bisnis Anda dengan laporan lengkap yang mudah dipahami dan raih keuntungan semakin besar.',
  },
  {
    img: require('../../../assets/images/application_banner.webp'),
    title: 'Kelola pembukuan',
    desc: 'Kegiatan melacak pemasukan dan pengeluaran bisnis belum pernah semudah ini! Dengan ESB POSLite, pembukuan jadi lebih rapi dan terorganisir.',
  },
  {
    img: require('../../../assets/images/claim_terminal.webp'),
    title: 'Toko online ESB Order',
    desc: 'Jangkau lebih banyak konsumen, tampilkan produk secara menarik, dan tingkatkan efisiensi proses penjualan Anda.',
  },
];

export default function IntroScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
        <Image source={PAGES[page].img} style={styles.hero} resizeMode="contain" />
        <Text style={styles.title}>{PAGES[page].title}</Text>
        <Text style={styles.desc}>{PAGES[page].desc}</Text>
        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => setPage(i)} hitSlop={8}>
              <View style={[styles.dot, i === page && styles.dotOn]} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={[styles.footer, isTablet && wideCenterSm]}>
        {last ? (
          <>
            <TouchableOpacity
              style={styles.outline}
              onPress={() => navigation?.navigate('Install')}>
              <Text style={styles.outlineT}>Buat Akun POSLite</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primary}
              onPress={() => navigation?.navigate('Login')}>
              <Text style={styles.primaryT}>Masuk ke POS ›</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.primary}
              onPress={() => setPage((p) => Math.min(p + 1, PAGES.length - 1))}>
              <Text style={styles.primaryT}>Lanjut ›</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation?.navigate('Login')}>
              <Text style={styles.skip}>Lewati</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 24, paddingTop: 72, alignItems: 'center' },
  hero: { width: '100%', height: 240 },
  title: { fontFamily: fonts.bold, fontSize: 22, color: colors.navy, textAlign: 'center', marginTop: 24 },
  desc: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  dots: { flexDirection: 'row', gap: 8, marginTop: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotOn: { width: 24, backgroundColor: colors.orange },
  footer: { padding: 20, gap: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 15, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  outline: { borderWidth: 1.5, borderColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center' },
  outlineT: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  skip: { fontFamily: fonts.semibold, fontSize: 14, color: colors.muted, textAlign: 'center', padding: 6 },
});
