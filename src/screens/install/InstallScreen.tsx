import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { fonts, wideCenterSm } from '../../theme';
import { WEB_URLS } from '../../config/server';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };

const NAVY = '#16215E';
const BLUE = '#1E88E5';
const ORANGE = '#F5820D';
const GREY = '#757575';
const BORDER = '#E0E0E0';

const STEPS = [
  'Buka dashboard owner, masuk ke menu Perangkat.',
  'Pindai QR klaim atau salin kode terminal.',
  'Tekan “Klaim Terminal” untuk menautkan perangkat.',
];

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
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
      showsVerticalScrollIndicator={false}>
      <Image source={require('../../../assets/images/claim_terminal.webp')} style={styles.banner} resizeMode="contain" />
      <Text style={styles.title}>Klaim Terminal</Text>
      <Text style={styles.desc}>
        Pindai QR klaim dari dashboard owner atau masukkan kode terminal untuk
        menghubungkan perangkat ini ke outlet Anda.
      </Text>

      <View style={styles.stepsCard}>
        {STEPS.map((s, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumT}>{i + 1}</Text>
            </View>
            <Text style={styles.stepT}>{s}</Text>
          </View>
        ))}
      </View>

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
        placeholderTextColor="#BDBDBD"
        autoCapitalize="characters"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.primary} onPress={claim}>
        <Text style={styles.primaryT}>Klaim Terminal ›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.webBtn}
        onPress={() => navigation?.navigate('WebView', { url: WEB_URLS.register, title: 'Pendaftaran POS' })}>
        <Text style={styles.webBtnT}>Daftar Akun via Web ›</Text>
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
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 },
  banner: { width: '100%', height: 150 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: NAVY, marginTop: 16 },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: GREY, marginTop: 6, lineHeight: 19 },
  stepsCard: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, padding: 14, marginTop: 14, gap: 10,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: NAVY,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumT: { fontFamily: fonts.bold, fontSize: 13, color: '#FFFFFF' },
  stepT: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: '#2B2B2B', lineHeight: 18 },
  scanBox: {
    borderWidth: 1.5, borderColor: NAVY, borderStyle: 'dashed', borderRadius: 14,
    alignItems: 'center', padding: 20, marginTop: 14, backgroundColor: '#FFFFFF',
  },
  scanGlyph: { fontSize: 40, color: NAVY },
  scanText: { fontFamily: fonts.medium, fontSize: 13, color: GREY, marginTop: 6 },
  scanBtn: { marginTop: 10, backgroundColor: '#EAF2FF', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  scanBtnT: { fontFamily: fonts.semibold, fontSize: 13, color: NAVY },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: '#2B2B2B', marginTop: 18, marginBottom: 8 },
  input: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BDBDBD', borderRadius: 12,
    paddingHorizontal: 16, height: 52, fontFamily: fonts.bold, fontSize: 15, color: '#2B2B2B', letterSpacing: 1,
  },
  error: { fontFamily: fonts.medium, fontSize: 13, color: '#D33A3F', marginTop: 8 },
  primary: {
    backgroundColor: ORANGE, borderRadius: 14, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 18,
  },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: '#D96F00', textAlign: 'center', marginTop: 14 },
  helpCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 14, marginTop: 12 },
  helpImg: { width: '100%', height: 120, marginBottom: 8 },
  helpT: { fontFamily: fonts.regular, fontSize: 13, color: '#2B2B2B', marginTop: 4, lineHeight: 18 },
  webBtn: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: NAVY, borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  webBtnT: { fontFamily: fonts.bold, fontSize: 14, color: NAVY },
});
