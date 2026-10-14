import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenterSm } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };

const BRANCHES = [
  { name: 'ESB Cabang Poris', addr: 'Jl. Poris Raya No. 8, Tangerang', device: 'Terminal 01 · Kasir' },
  { name: 'ESB Cabang Ciputat', addr: 'Jl. Dewi Sartika No. 12, Tangsel', device: 'Terminal 02 · Kasir' },
  { name: 'ESB Cabang Bintaro', addr: 'Jl. Bintaro Utama No. 5, Tangsel', device: 'Terminal 03 · Kasir' },
];

export default function SelectBranchScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [branch, setBranch] = useState(BRANCHES[0].name);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Text style={styles.title}>Pilih Cabang</Text>
      <Text style={styles.desc}>Terminal ini akan ditautkan ke cabang berikut. Pastikan sesuai dengan lokasi perangkat.</Text>
      {BRANCHES.map((b) => (
        <TouchableOpacity
          key={b.name}
          style={[styles.card, branch === b.name && styles.cardOn]}
          onPress={() => setBranch(b.name)}>
          <View style={[styles.avatar, branch === b.name && styles.avatarOn]}>
            <Text style={[styles.avatarT, branch === b.name && styles.avatarTOn]}>{b.name.charAt(4)}</Text>
          </View>
          <View style={styles.info}>
            <Text style={styles.name}>{b.name}</Text>
            <Text style={styles.meta}>{b.addr}</Text>
            <Text style={styles.meta}>{b.device}</Text>
          </View>
          <View style={[styles.radio, branch === b.name && styles.radioOn]}>
            {branch === b.name && <View style={styles.radioDot} />}
          </View>
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={styles.primary}
        onPress={() => navigation?.navigate('InstallProgress', { branch })}>
        <Text style={styles.primaryT}>Lanjut Penyiapan ›</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, marginBottom: 12, lineHeight: 19 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card,
    borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 14, marginBottom: 10,
  },
  cardOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.paleBlue, alignItems: 'center', justifyContent: 'center' },
  avatarOn: { backgroundColor: colors.navy },
  avatarT: { fontFamily: fonts.bold, fontSize: 18, color: colors.navy },
  avatarTOn: { color: colors.white },
  info: { flex: 1 },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.orange },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 8 },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
});
