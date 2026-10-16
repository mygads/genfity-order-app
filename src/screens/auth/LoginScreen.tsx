import { useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { fonts, wideCenterSm } from '../../theme';
import { loginDemo } from '../../session';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack?: () => void;
};

type Props = { navigation?: Nav };

const BLUE = '#1E88E5';
const BLUE_PALE = '#E7F3FF';
const BLUE_ICON_BG = '#D2E7FF';
const ORANGE = '#F5820D';
const PEACH = '#F6C28B';
const GREY = '#757575';
const BORDER = '#E0E0E0';
const INPUT_BORDER = '#BDBDBD';
const ICON_GREY = '#9E9E9E';
const RED = '#D33A3F';
const TITLE_DARK = '#2B2B2B';

const QR_PATTERN = [
  1, 1, 1, 0, 1,
  1, 0, 1, 1, 0,
  1, 1, 0, 0, 1,
  0, 1, 1, 0, 1,
  1, 0, 1, 1, 1,
];

function PersonGlyph({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      <View
        style={{
          width: size * 0.42, height: size * 0.42, borderRadius: size * 0.21,
          borderWidth: 2, borderColor: color, marginBottom: 1,
        }}
      />
      <View
        style={{
          width: size * 0.8, height: size * 0.34, borderTopLeftRadius: size * 0.4,
          borderTopRightRadius: size * 0.4, borderWidth: 2, borderColor: color,
          borderBottomWidth: 0,
        }}
      />
    </View>
  );
}

function LockGlyph({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      <View
        style={{
          width: size * 0.52, height: size * 0.4, borderWidth: 2, borderColor: color,
          borderBottomWidth: 0, borderTopLeftRadius: 4, borderTopRightRadius: 4, marginBottom: -2,
        }}
      />
      <View
        style={{
          width: size * 0.78, height: size * 0.56, borderRadius: 3,
          borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: color }} />
      </View>
    </View>
  );
}

function QrGlyph({ color, cell = 6, gap = 2 }: { color: string; cell?: number; gap?: number }) {
  return (
    <View style={{ width: cell * 3 + gap * 2, height: cell * 3 + gap * 2 }}>
      {[0, 1, 2].map((r) => (
        <View key={r} style={{ flexDirection: 'row', marginBottom: r < 2 ? gap : 0 }}>
          {[0, 1, 2].map((c) => {
            const filled = (r === 0 || c === 0 || r === 2 || c === 2) && !(r === 1 && c === 1)
              ? (r + c) % 2 === 0
              : (r * 3 + c) % 2 === 1;
            return (
              <View
                key={c}
                style={{
                  width: cell, height: cell, marginRight: c < 2 ? gap : 0,
                  backgroundColor: filled ? color : 'transparent',
                  borderWidth: filled ? 0 : 1.5, borderColor: color, borderRadius: 1,
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function LoginScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [mode, setMode] = useState<'email' | 'qr'>('email');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [qrHelp, setQrHelp] = useState(false);
  const [help, setHelp] = useState(false);

  const filled = username.trim().length > 0 && password.length > 0;

  const goBack = () => {
    if (navigation?.goBack) navigation.goBack();
    else navigation?.navigate('Intro');
  };

  const submit = () => {
    if (!username.trim() || !password) return;
    if (password.length < 4) {
      setError(true);
      return;
    }
    setError(false);
    loginDemo();
    navigation?.navigate('Dashboard');
  };

  const scanQr = () => {
    loginDemo();
    navigation?.navigate('Dashboard');
  };

  const card = (which: 'email' | 'qr') => {
    const on = mode === which;
    return (
      <TouchableOpacity
        key={which}
        style={[styles.card, on ? styles.cardOn : styles.cardOff]}
        onPress={() => { setMode(which); setError(false); }}>
        <View style={[styles.iconBox, on ? styles.iconBoxOn : styles.iconBoxOff]}>
          {which === 'email'
            ? <PersonGlyph color={on ? BLUE : ICON_GREY} />
            : <QrGlyph color={on ? BLUE : ICON_GREY} />}
        </View>
        {which === 'email' ? (
          <Text style={[styles.cardLabel, on ? styles.cardLabelOn : styles.cardLabelOff]}>
            <Text style={styles.cardLabelBold}>Username</Text> atau{' '}
            <Text style={styles.cardLabelBold}>Email</Text>
          </Text>
        ) : (
          <Text style={[styles.cardLabel, styles.cardLabelBold, on ? styles.cardLabelOn : styles.cardLabelOff]}>
            Scan QR
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={12}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setHelp(true)} hitSlop={12}>
            <View style={styles.helpCircle}>
              <Text style={styles.helpGlyph}>?</Text>
            </View>
          </TouchableOpacity>
        </View>

        <Image
          source={require('../../../assets/images/esb_logo.webp')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Selamat Datang Juragan!</Text>
        <Text style={styles.sub}>Silakan masuk dengan akun Anda</Text>

        <View style={styles.cards}>
          {card('email')}
          {card('qr')}
        </View>

        {mode === 'email' ? (
          <View style={styles.form}>
            <Text style={styles.label}>
              Username atau Email<Text style={styles.star}>*</Text>
            </Text>
            <View style={[styles.inputBox, error && styles.inputBoxError]}>
              <PersonGlyph color={error ? RED : ICON_GREY} size={20} />
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={(t) => { setUsername(t); setError(false); }}
                placeholder="Masukkan Username atau Email Anda"
                placeholderTextColor={INPUT_BORDER}
                autoCapitalize="none"
              />
            </View>

            <Text style={[styles.label, styles.labelGap]}>
              Password<Text style={styles.star}>*</Text>
            </Text>
            <View style={[styles.inputBox, error && styles.inputBoxError]}>
              <LockGlyph color={error ? RED : ICON_GREY} size={20} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(false); }}
                placeholder="Masukkan Password Anda"
                placeholderTextColor={INPUT_BORDER}
                secureTextEntry={!showPass}
              />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)} hitSlop={10}>
                <Text style={styles.eye}>{showPass ? '◎' : '◡'}</Text>
              </TouchableOpacity>
            </View>

            {error ? (
              <View style={styles.errorRow}>
                <Text style={styles.errorGlyph}>▲</Text>
                <Text style={styles.errorText}>
                  Username atau Password yang Anda masukkan salah. Silakan coba kembali.
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.forgotLink}
              onPress={() => navigation?.navigate('ForgotPin')}>
              <Text style={styles.forgotLinkT}>Lupa PIN?</Text>
            </TouchableOpacity>

            <View style={styles.spacer} />
            <TouchableOpacity
              style={[styles.primary, !filled && styles.primaryIdle]}
              onPress={submit}>
              <Text style={styles.primaryT}>Masuk</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={styles.qrHint}>
              Pindai QR dari dashboard owner untuk masuk otomatis ke terminal ini.
            </Text>
            <View style={styles.scanBox}>
              <Text style={styles.scanGlyph}>▣</Text>
              <Text style={styles.scanText}>Bingkai QR masuk di sini</Text>
              <TouchableOpacity
                style={styles.scanBtn}
                onPress={() => setManualCode('ESB-PORIS-01')}>
                <Text style={styles.scanBtnT}>Simulasikan Hasil Pindai</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.label, styles.labelGap]}>Kode manual</Text>
            <View style={styles.inputBox}>
              <QrGlyph color={ICON_GREY} cell={5} />
              <TextInput
                style={styles.input}
                value={manualCode}
                onChangeText={setManualCode}
                placeholder="Masukkan kode dari dashboard"
                placeholderTextColor={INPUT_BORDER}
                autoCapitalize="characters"
              />
            </View>
            <View style={styles.spacer} />
            <TouchableOpacity style={styles.outline} onPress={() => setQrHelp((v) => !v)}>
              <Text style={styles.outlineT}>Cara mendapatkan QR</Text>
            </TouchableOpacity>
            {qrHelp ? (
              <View style={styles.qrHelpCard}>
                <Text style={styles.qrHelpT}>1. Masuk ke dashboard owner (web) sebagai pemilik usaha.</Text>
                <Text style={styles.qrHelpT}>2. Buka menu Perangkat → pilih terminal kasir.</Text>
                <Text style={styles.qrHelpT}>3. Pindai QR login yang tampil, atau salin kode manual ke sini.</Text>
              </View>
            ) : null}
            <TouchableOpacity style={styles.primary} onPress={scanQr}>
              <Text style={styles.primaryT}>Scan QR</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <Modal visible={help} transparent animationType="fade" onRequestClose={() => setHelp(false)}>
        <View style={styles.overlay}>
          <View style={styles.helpCard}>
            <View style={styles.helpGreen}>
              <View style={styles.helpLogoCircle}>
                <Text style={styles.helpLogoT}>ESB</Text>
              </View>
              <Text style={styles.helpGreenTitle}>ESB Restaurant Technology</Text>
              <Text style={styles.helpGreenSub}>PT. Esensi Solusi Buana</Text>
              <View style={styles.helpQr}>
                {QR_PATTERN.map((v, i) => (
                  <View
                    key={i}
                    style={{
                      width: 18, height: 18, margin: 1.5,
                      backgroundColor: v ? '#111' : '#FFFFFF',
                    }}
                  />
                ))}
              </View>
            </View>
            <Text style={styles.helpBody}>
              Silakan scan barcode di atas untuk bantuan langsung atau hubungi kami melalui nomor{' '}
              <Text style={styles.helpPhone}>0822-1066-6969</Text>
            </Text>
            <TouchableOpacity style={styles.primary} onPress={() => setHelp(false)}>
              <Text style={styles.primaryT}>Oke</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28, flexGrow: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { fontSize: 28, color: '#4A4A4A', fontFamily: fonts.bold, paddingRight: 12 },
  helpCircle: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#E4E4E4',
    alignItems: 'center', justifyContent: 'center',
  },
  helpGlyph: { fontSize: 20, color: '#FFFFFF', fontFamily: fonts.bold },
  logo: { width: 200, height: 68, alignSelf: 'center', marginTop: 14 },
  title: {
    fontFamily: fonts.bold, fontSize: 26, color: TITLE_DARK,
    textAlign: 'center', marginTop: 22,
  },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: GREY, textAlign: 'center', marginTop: 10 },
  cards: { flexDirection: 'row', gap: 12, marginTop: 26 },
  card: {
    flex: 1, height: 94, borderRadius: 12, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  cardOn: { backgroundColor: BLUE_PALE, borderColor: BLUE },
  cardOff: { backgroundColor: '#FFFFFF', borderColor: BORDER },
  iconBox: { width: 48, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  iconBoxOn: { backgroundColor: BLUE_ICON_BG },
  iconBoxOff: { backgroundColor: '#F1F3F5' },
  cardLabel: { fontSize: 13, fontFamily: fonts.regular },
  cardLabelBold: { fontFamily: fonts.bold },
  cardLabelOn: { color: BLUE },
  cardLabelOff: { color: ICON_GREY },
  form: { marginTop: 28, flex: 1 },
  label: { fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, marginBottom: 8 },
  labelGap: { marginTop: 18 },
  star: { color: RED },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    height: 52, borderRadius: 12, borderWidth: 1, borderColor: INPUT_BORDER,
    paddingHorizontal: 16, backgroundColor: '#FFFFFF',
  },
  inputBoxError: { borderColor: RED },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, height: '100%' },
  eye: { fontSize: 22, color: ICON_GREY, paddingLeft: 8 },
  errorRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'flex-start' },
  errorGlyph: { fontSize: 16, color: RED, marginTop: 2 },
  errorText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: RED, lineHeight: 19 },
  forgotLink: { alignSelf: 'flex-end', marginTop: 10, paddingVertical: 4 },
  forgotLinkT: { fontFamily: fonts.semibold, fontSize: 13, color: BLUE },
  spacer: { flex: 1, minHeight: 48 },
  primary: {
    backgroundColor: ORANGE, borderRadius: 16, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  primaryIdle: { backgroundColor: PEACH },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  outline: {
    borderWidth: 1.5, borderColor: BLUE, borderRadius: 16, height: 52,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', marginTop: 12,
  },
  outlineT: { fontFamily: fonts.bold, fontSize: 16, color: BLUE },
  qrHint: { fontFamily: fonts.regular, fontSize: 13, color: GREY, textAlign: 'center', lineHeight: 19 },
  scanBox: {
    borderWidth: 1.5, borderColor: BLUE, borderStyle: 'dashed', borderRadius: 14,
    alignItems: 'center', padding: 20, marginTop: 16, backgroundColor: '#FFFFFF',
  },
  scanGlyph: { fontSize: 40, color: TITLE_DARK },
  scanText: { fontFamily: fonts.medium, fontSize: 13, color: GREY, marginTop: 6 },
  scanBtn: {
    marginTop: 10, backgroundColor: BLUE_PALE, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  scanBtnT: { fontFamily: fonts.semibold, fontSize: 13, color: BLUE },
  qrHelpCard: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, padding: 14, marginTop: 12,
  },
  qrHelpT: { fontFamily: fonts.regular, fontSize: 13, color: TITLE_DARK, marginTop: 4, lineHeight: 18 },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  helpCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, width: '100%' },
  helpGreen: {
    backgroundColor: '#1FA855', borderRadius: 12, padding: 20, alignItems: 'center',
  },
  helpLogoCircle: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', marginTop: -48, marginBottom: 10,
  },
  helpLogoT: { fontFamily: fonts.bold, fontSize: 14, color: TITLE_DARK },
  helpGreenTitle: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF', textAlign: 'center' },
  helpGreenSub: { fontFamily: fonts.regular, fontSize: 13, color: '#FFFFFF', marginTop: 4 },
  helpQr: {
    backgroundColor: '#FFFFFF', borderRadius: 8, padding: 12, marginTop: 16,
    flexDirection: 'row', flexWrap: 'wrap', width: 138, justifyContent: 'center',
  },
  helpBody: {
    fontFamily: fonts.regular, fontSize: 13, color: '#333333',
    textAlign: 'center', lineHeight: 20, marginTop: 16, marginBottom: 4,
  },
  helpPhone: { fontFamily: fonts.bold },
});
