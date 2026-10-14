import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenterSm } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type Tab = 'Voucher' | 'Member';

export default function QrScanScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [tab, setTab] = useState<Tab>('Voucher');
  const [code, setCode] = useState('VC-DISKON10K');
  const [result, setResult] = useState(true);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Text style={styles.hint}>Voucher · Member · QRIS</Text>
      <View style={styles.frame}>
        <Text style={styles.frameIcon}>▦</Text>
        <Text style={styles.frameT}>Pindai Kode QR</Text>
        <Text style={styles.frameS}>Arahkan kamera ke QR voucher atau kartu member pelanggan.</Text>
      </View>
      <View style={styles.tabs}>
        {(['Voucher', 'Member'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
            <Text style={[styles.tabT, tab === t && styles.tabTOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {result ? (
        <View style={styles.card}>
          <Text style={styles.code}>{code}</Text>
          <Text style={styles.desc}>{tab === 'Voucher' ? 'Voucher · Potongan ' + rp(10000) + ' · Berlaku s/d 31 Des 2026' : 'Member QoQi · GOLD · 342 poin'}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.ghost} onPress={() => setResult(false)}>
              <Text style={styles.ghostT}>Scan Ulang</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={() => navigation?.navigate('Cashier')}>
              <Text style={styles.primaryT}>Gunakan</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={styles.empty}>Belum ada hasil scan — arahkan kamera atau masukkan kode manual.</Text>
      )}
      <Text style={styles.label}>Atau masukkan kode manual</Text>
      <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="VC-XXXX" autoCapitalize="characters" />
      <TouchableOpacity style={styles.primary} onPress={() => setResult(true)}>
        <Text style={styles.primaryT}>Cek Kode</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  frame: { backgroundColor: colors.navy, borderRadius: 14, padding: 22, alignItems: 'center', marginTop: 12 },
  frameIcon: { fontSize: 40, color: colors.white },
  frameT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white, marginTop: 8 },
  frameS: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 4 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 14 },
  tab: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, alignItems: 'center', backgroundColor: colors.card },
  tabOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  tabT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  tabTOn: { color: colors.orangeDark },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  code: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primary: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 10 },
  primaryT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 13, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 12 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.bold, fontSize: 15, color: colors.text },
});
