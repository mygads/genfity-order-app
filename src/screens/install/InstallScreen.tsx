import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenterSm } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };

export default function InstallScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const claim = () => {
    if (code.trim().length < 4) {
      setError('Masukkan kode klaim terminal (min. 4 karakter) atau pindai QR.');
      return;
    }
    setError('');
    navigation?.navigate('SelectBranch');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Image source={require('../../../assets/images/claim_terminal.webp')} style={styles.banner} resizeMode="contain" />
      <Text style={styles.title}>Klaim Terminal</Text>
      <Text style={styles.desc}>
        Pindai QR klaim dari dashboard owner atau masukkan kode terminal untuk
        menghubungkan perangkat ini ke outlet Anda.
      </Text>

      <View style={styles.scanBox}>
        <Text style={styles.scanGlyph}>▣</Text>
        <Text style={styles.scanText}>Bingkai QR klaim di sini</Text>
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => { setCode('ESB-PORIS-01'); setError(''); }}>
          <Text style={styles.scanBtnT}>Simulasikan Hasil Pindai</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Kode terminal</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(t) => { setCode(t); setError(''); }}
        placeholder="cth. ESB-PORIS-01"
        placeholderTextColor={colors.faint}
        autoCapitalize="characters"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.primary} onPress={claim}>
        <Text style={styles.primaryT}>Klaim Terminal ›</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setShowHelp((v) => !v)}>
        <Text style={styles.link}>Belum punya QR? Lihat cara mendapatkan ›</Text>
      </TouchableOpacity>
      {showHelp && (
        <View style={styles.helpCard}>
          <Image source={require('../../../assets/images/get_qr_banner.webp')} style={styles.helpImg} resizeMode="contain" />
          <Text style={styles.helpT}>1. Masuk ke dashboard owner (web) sebagai pemilik usaha.</Text>
          <Text style={styles.helpT}>2. Buka menu Perangkat → Tambah Terminal.</Text>
          <Text style={styles.helpT}>3. Pindai QR yang muncul, atau salin kode terminal ke sini.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40 },
  banner: { width: '100%', height: 150 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 16 },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 19 },
  scanBox: {
    borderWidth: 1.5, borderColor: colors.navy, borderStyle: 'dashed', borderRadius: 14,
    alignItems: 'center', padding: 20, marginTop: 16, backgroundColor: colors.card,
  },
  scanGlyph: { fontSize: 40, color: colors.navy },
  scanText: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 6 },
  scanBtn: { marginTop: 10, backgroundColor: colors.paleBlue, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  scanBtnT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
    padding: 12, fontFamily: fonts.bold, fontSize: 16, color: colors.text, letterSpacing: 1,
  },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginTop: 8 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 16 },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark, textAlign: 'center', marginTop: 14 },
  helpCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, marginTop: 12 },
  helpImg: { width: '100%', height: 120, marginBottom: 8 },
  helpT: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, marginTop: 4, lineHeight: 18 },
});
