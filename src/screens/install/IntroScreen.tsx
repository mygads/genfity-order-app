import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { fonts, wideCenterSm } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };

const NAVY = '#16215E';
const BLUE = '#1E88E5';
const ORANGE = '#F5820D';
const GREY = '#757575';
const BORDER = '#E0E0E0';
const DOT_OFF = '#D5D5D5';

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
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        showsVerticalScrollIndicator={false}>
        <Image
          source={require('../../../assets/images/esb_logo.webp')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Image source={PAGES[page].img} style={styles.hero} resizeMode="contain" />
        <Text style={styles.title}>{PAGES[page].title}</Text>
        <Text style={styles.desc}>{PAGES[page].desc}</Text>
        <View style={styles.spacer} />
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
              <Text style={styles.primaryT}>Masuk ke POS</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.primary}
            onPress={() => setPage((p) => Math.min(p + 1, PAGES.length - 1))}>
            <Text style={styles.primaryT}>Lanjutkan  ›</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 16, alignItems: 'center', flexGrow: 1 },
  logo: { width: 210, height: 72 },
  hero: { width: '100%', height: 230, marginTop: 28 },
  title: { fontFamily: fonts.bold, fontSize: 24, color: BLUE, textAlign: 'center', marginTop: 32 },
  desc: {
    fontFamily: fonts.regular, fontSize: 14, color: GREY,
    textAlign: 'center', marginTop: 12, lineHeight: 22, paddingHorizontal: 4,
  },
  spacer: { flex: 1, minHeight: 40 },
  dots: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: DOT_OFF },
  dotOn: { width: 26, backgroundColor: ORANGE },
  footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 28, gap: 12, backgroundColor: '#FFFFFF' },
  primary: {
    backgroundColor: ORANGE, borderRadius: 26, height: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  outline: {
    borderWidth: 1.5, borderColor: BLUE, borderRadius: 26, height: 52,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
  },
  outlineT: { fontFamily: fonts.bold, fontSize: 16, color: BLUE },
  skip: { fontFamily: fonts.medium, fontSize: 14, color: GREY, textAlign: 'center', paddingVertical: 8 },
});
