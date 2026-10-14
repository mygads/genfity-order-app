import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View , useWindowDimensions } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fonts, wideCenter } from '../../theme';
import { logout } from '../../session';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: { navigation: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [soundNewOrder, setSoundNewOrder] = useState(true);
  const [customerDisplay, setCustomerDisplay] = useState(false);
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(true);
  const [autoCut, setAutoCut] = useState(true);
  const [lang, setLang] = useState<'ID' | 'EN'>('ID');

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, isTablet && wideCenter]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Pengaturan</Text>
        <Text style={styles.headerSub}>Toko Maju Jaya • Cabang Pusat</Text>
      </View>

      <Text style={styles.groupLabel}>Perangkat</Text>
      <MenuRow
        title="Printer"
        sub="2 terhubung • Struk & Dapur"
        onPress={() => navigation.navigate('Printers')}
      />
      <MenuRow title="Tampilan Pelanggan" sub="Layar info pesanan untuk pelanggan" onPress={() => navigation.navigate('CustomerDisplay')} right={
        <Switch value={customerDisplay} onValueChange={setCustomerDisplay} trackColor={{ true: colors.green, false: colors.stroke }} />
      } />
      <MenuRow title="Pengaturan Cetakan" sub="Ukuran struk, footer, logo" onPress={() => navigation.navigate('Printers')} />
      <MenuRow title="Pengaturan Cetakan Menu" sub="Cetak per grup menu dapur" onPress={() => navigation.navigate('Kitchen')} />
      <MenuRow title="Pengaturan Meja" sub="Denah, kapasitas, status" onPress={() => navigation.navigate('Tables')} />

      <Text style={styles.groupLabel}>Pesanan</Text>
      <MenuRow
        title="Bunyi Pesanan Baru"
        sub="Memberikan info pesanan baru dengan suara"
        right={
          <Switch value={soundNewOrder} onValueChange={setSoundNewOrder} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />
      <MenuRow
        title="Cetak Otomatis Dapur"
        sub="Kirim tiket ke printer dapur saat bayar"
        right={
          <Switch value={autoPrintKitchen} onValueChange={setAutoPrintKitchen} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />
      <MenuRow
        title="Potong Otomatis"
        sub="Potong kertas otomatis setelah cetak"
        right={
          <Switch value={autoCut} onValueChange={setAutoCut} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />
      <MenuRow title="Tiket Dapur" sub="Lihat antrean masak" onPress={() => navigation.navigate('Kitchen')} />

      <Text style={styles.groupLabel}>Aplikasi</Text>
      <MenuRow
        title="Bahasa"
        sub={lang === 'ID' ? 'Indonesia' : 'English'}
        right={
          <View style={styles.langRow}>
            {(['ID', 'EN'] as const).map((l) => (
              <Pressable key={l} onPress={() => setLang(l)} style={[styles.lang, lang === l && styles.langActive]}>
                <Text style={[styles.langText, lang === l && styles.langTextActive]}>{l}</Text>
              </Pressable>
            ))}
          </View>
        }
      />
      <MenuRow title="Sinkronisasi Data" sub="Terakhir: 13 Okt 2026 12:00" />
      <MenuRow title="Tentang Aplikasi" sub="ESB POSLite Clone v1.0.0" />

      <MenuRow
        title="Pesanan ESB"
        sub="Pesanan online dari agregator"
        onPress={() => navigation.navigate('EsbOrder')}
      />

      <Pressable
        style={styles.logout}
        onPress={() => {
          logout();
          navigation.navigate('Login');
        }}>
        <Text style={styles.logoutText}>Keluar</Text>
      </Pressable>
      <Text style={styles.version}>v1.0.0 • posclone-rn</Text>
    </ScrollView>
  );
}

function MenuRow({
  title,
  sub,
  onPress,
  right,
}: {
  title: string;
  sub: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress} disabled={!onPress && !right}>
      <View style={styles.cardLeft}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{sub}</Text>
      </View>
      {right ?? (onPress ? <Text style={styles.chev}>›</Text> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 32 },
  header: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 18, paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  groupLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.navy,
    marginTop: 18,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardLeft: { flex: 1, paddingRight: 10 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  chev: { fontSize: 22, color: colors.faint, fontFamily: fonts.bold },
  langRow: { flexDirection: 'row', gap: 6 },
  lang: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  langActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  langText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  langTextActive: { color: colors.white },
  logout: {
    marginHorizontal: 16,
    marginTop: 22,
    borderRadius: 12,
    backgroundColor: colors.paleRed,
    paddingVertical: 13,
    alignItems: 'center',
  },
  logoutText: { fontFamily: fonts.bold, fontSize: 14, color: colors.red },
  version: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 12,
  },
});
