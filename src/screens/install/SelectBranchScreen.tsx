import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { fonts, wideCenterSm } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };

const NAVY = '#16215E';
const ORANGE = '#F5820D';
const GREY = '#757575';
const BORDER = '#E0E0E0';
const TITLE_DARK = '#2B2B2B';

const BRANCHES = [
  { name: 'ESB Cabang Poris', addr: 'Jl. Poris Raya No. 8, Tangerang', device: 'Terminal 01 · Kasir' },
  { name: 'ESB Cabang Ciputat', addr: 'Jl. Dewi Sartika No. 12, Tangsel', device: 'Terminal 02 · Kasir' },
  { name: 'ESB Cabang Bintaro', addr: 'Jl. Bintaro Utama No. 5, Tangsel', device: 'Terminal 03 · Kasir' },
];

export default function SelectBranchScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [branch, setBranch] = useState(BRANCHES[0].name);
  const [query, setQuery] = useState('');

  const list = BRANCHES.filter((b) =>
    (b.name + ' ' + b.addr).toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <View style={styles.root}>
      <View style={styles.arc} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Pilih cabang restoran Anda <Text style={styles.pin}>📍</Text></Text>
        <Text style={styles.desc}>Terminal ini akan ditautkan ke cabang berikut. Pastikan sesuai dengan lokasi perangkat.</Text>
        <View style={styles.searchBox}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Cari cabang..."
            placeholderTextColor="#BDBDBD"
          />
        </View>
        {list.map((b) => (
          <TouchableOpacity
            key={b.name}
            style={[styles.card, branch === b.name && styles.cardOn]}
            onPress={() => setBranch(b.name)}>
            <View style={[styles.avatar, branch === b.name && styles.avatarOn]}>
              <Text style={[styles.avatarT, branch === b.name && styles.avatarTOn]}>C</Text>
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
        {list.length === 0 ? (
          <Text style={styles.empty}>Cabang tidak ditemukan. Coba kata kunci lain.</Text>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, isTablet && wideCenterSm]}>
        <TouchableOpacity
          style={styles.primary}
          onPress={() => navigation?.navigate('InstallProgress', { branch })}>
          <Text style={styles.primaryT}>Pilih Cabang</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  arc: {
    position: 'absolute', top: -130, right: -130, width: 250, height: 250,
    borderRadius: 125, backgroundColor: '#1E88E5',
  },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, flexGrow: 1 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: TITLE_DARK, paddingRight: 70 },
  pin: { fontSize: 18 },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: GREY, marginTop: 6, lineHeight: 19, paddingRight: 80 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48,
    borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 14, backgroundColor: '#FFFFFF', marginTop: 14, marginBottom: 12,
  },
  searchGlyph: { fontSize: 20, color: '#9E9E9E' },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, height: '100%' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, padding: 14, marginBottom: 10,
  },
  cardOn: { borderColor: ORANGE, backgroundColor: '#FFF4E8' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EAF2FF', alignItems: 'center', justifyContent: 'center' },
  avatarOn: { backgroundColor: NAVY },
  avatarT: { fontFamily: fonts.bold, fontSize: 18, color: NAVY },
  avatarTOn: { color: '#FFFFFF' },
  info: { flex: 1 },
  name: { fontFamily: fonts.bold, fontSize: 15, color: TITLE_DARK },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: GREY, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: ORANGE },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: GREY, textAlign: 'center', marginTop: 24 },
  footer: { paddingHorizontal: 24, paddingBottom: 28, paddingTop: 8, backgroundColor: '#FFFFFF' },
  primary: {
    backgroundColor: ORANGE, borderRadius: 14, height: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
});
