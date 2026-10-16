import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenterSm } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

export default function AboutScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <View style={styles.hero}>
        <Image source={require('../../../assets/images/esb_logo_white.webp')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.appName}>Genfity Order</Text>
        <Text style={styles.version}>Versi 1.0.0 (build 761)</Text>
        <Text style={styles.heroSub}>Aplikasi kasir restoran & ritel — offline-first</Text>
      </View>
      <View style={styles.card}>
        <Row label="Paket" value="posclone-rn (Expo RN)" />
        <Row label="Cabang" value="ESB Cabang Poris · BR-01" />
        <Row label="Terminal" value="TRM-001" />
        <Row label="Lingkungan" value="Production" />
        <Row label="Printer" value="BT SPP · LAN · Star" />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tentang</Text>
        <Text style={styles.cardText}>
          Genfity Order membantu kasir mencatat pesanan, mencetak struk dan tiket dapur,
          mengelola member, serta sinkron ke server saat online. Cetak berjalan 100% lokal
          (Bluetooth/LAN) tanpa internet; kirim nyata membutuhkan dev-client.
        </Text>
      </View>
      <Text style={styles.foot}>© 2026 Genfity • Dibuat dengan Expo + React Native</Text>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },
  hero: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 24, paddingHorizontal: 16, alignItems: 'center' },
  logo: { width: 120, height: 60 },
  appName: { fontFamily: fonts.bold, fontSize: 22, color: colors.white, marginTop: 10 },
  version: { fontFamily: fonts.medium, fontSize: 13, color: colors.orange, marginTop: 4 },
  heroSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4, textAlign: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  cardText: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  rowValue: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 16 },
});
