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

const ICONS = {
  userBlue: require('../../../assets/icons/login_username_blue.webp'),
  userGray: require('../../../assets/icons/login_username_gray.webp'),
  qrBlue: require('../../../assets/icons/login_scanqr_blue.webp'),
  qrGray: require('../../../assets/icons/login_scanqr_gray.webp'),
  username: require('../../../assets/icons/username.webp'),
  password: require('../../../assets/icons/password.webp'),
  show: require('../../../assets/icons/password_show.webp'),
  hide: require('../../../assets/icons/password_hide.webp'),
  fail: require('../../../assets/icons/fail_red.webp'),
  waQr: require('../../../assets/images/whatsapp_qr.webp'),
  logo: require('../../../assets/images/esb_logo.webp'),
};

/**
 * Ilustrasi tablet + QR ala layar login-qr asli (aproksimasi: tidak ada aset
 * ilustrasi ini di bundle, jadi digambar dari View + matriks QR deterministik).
 */
function QrTabletArt() {
  const N = 11;
  const cells: boolean[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const inFinder = (r < 4 && c < 4) || (r < 4 && c >= N - 4) || (r >= N - 4 && c < 4);
      if (inFinder) {
        const lr = r >= N - 4 ? r - (N - 4) : r;
        const lc = c >= N - 4 ? c - (N - 4) : c;
        cells.push(lr === 0 || lr === 3 || lc === 0 || lc === 3 || (lr >= 1 && lr <= 2 && lc >= 1 && lc <= 2));
      } else {
        cells.push((r * 31 + c * 17 + 5) % 7 < 3);
      }
    }
  }
  return (
    <View style={styles.tablet}>
      <View style={styles.tabletScreen}>
        <View style={styles.tabletQr}>
          <View style={styles.miniQr}>
            {cells.map((on, i) => (
              <View key={i} style={[styles.miniCell, on && styles.miniCellOn]} />
            ))}
          </View>
        </View>
      </View>
      <View style={styles.tabletDot} />
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
    // Kunci sesi demo dulu (guard navigator butuh login), lalu pindai QR asli
    // di layar kamera QrScan; hasil pindaian meneruskan ke alur kasir.
    loginDemo();
    navigation?.navigate('QrScan');
  };

  const card = (which: 'email' | 'qr') => {
    const on = mode === which;
    return (
      <TouchableOpacity
        key={which}
        style={[styles.card, on ? styles.cardOn : styles.cardOff]}
        onPress={() => { setMode(which); setError(false); }}>
        <View style={[styles.iconBox, on ? styles.iconBoxOn : styles.iconBoxOff]}>
          <Image
            source={which === 'email' ? (on ? ICONS.userBlue : ICONS.userGray) : on ? ICONS.qrBlue : ICONS.qrGray}
            style={styles.iconImg}
            resizeMode="contain"
          />
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
              <Image
                source={ICONS.username}
                style={[styles.fieldIcon, error && { tintColor: RED }]}
                resizeMode="contain"
              />
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
              <Image
                source={ICONS.password}
                style={[styles.fieldIcon, error && { tintColor: RED }]}
                resizeMode="contain"
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(false); }}
                placeholder="Masukkan Password Anda"
                placeholderTextColor={INPUT_BORDER}
                secureTextEntry={!showPass}
              />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)} hitSlop={10}>
                <Image
                  source={showPass ? ICONS.hide : ICONS.show}
                  style={styles.eyeIcon}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            </View>

            {error ? (
              <View style={styles.errorRow}>
                <Image source={ICONS.fail} style={styles.errorIcon} resizeMode="contain" />
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
            <View style={styles.qrHero}>
              <QrTabletArt />
            </View>
            <View style={styles.spacer} />
            <TouchableOpacity style={styles.outline} onPress={() => navigation?.navigate('QrHow')}>
              <Text style={styles.outlineT}>Cara mendapatkan QR</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primary, styles.scanGlow]} onPress={scanQr}>
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
                <Image source={ICONS.logo} style={styles.helpLogoImg} resizeMode="contain" />
              </View>
              <Text style={styles.helpGreenTitle}>ESB Restaurant Technology</Text>
              <Text style={styles.helpGreenSub}>PT. Esensi Solusi Buana</Text>
              <Image source={ICONS.waQr} style={styles.helpQrImg} resizeMode="contain" />
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
  iconImg: { width: 26, height: 26 },
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
    height: 56, borderRadius: 14, borderWidth: 1, borderColor: INPUT_BORDER,
    paddingHorizontal: 16, backgroundColor: '#FFFFFF',
  },
  inputBoxError: { borderColor: RED },
  fieldIcon: { width: 22, height: 22 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, height: '100%' },
  eyeIcon: { width: 24, height: 24 },
  errorRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'flex-start' },
  errorIcon: { width: 20, height: 20, marginTop: 1 },
  errorText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: RED, lineHeight: 19 },
  forgotLink: { alignSelf: 'flex-end', marginTop: 10, paddingVertical: 4 },
  forgotLinkT: { fontFamily: fonts.semibold, fontSize: 13, color: BLUE },
  spacer: { flex: 1, minHeight: 48 },
  primary: {
    backgroundColor: ORANGE, borderRadius: 28, height: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  primaryIdle: { backgroundColor: PEACH },
  scanGlow: {
    shadowColor: ORANGE, shadowOpacity: 0.45, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  outline: {
    borderWidth: 1.5, borderColor: BLUE, borderRadius: 28, height: 56,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', marginTop: 12,
  },
  outlineT: { fontFamily: fonts.bold, fontSize: 16, color: BLUE },
  qrHero: { alignItems: 'center', marginTop: 48 },
  tablet: {
    width: 280, height: 200, borderRadius: 18, backgroundColor: '#111111',
    alignItems: 'center', justifyContent: 'center',
  },
  tabletScreen: {
    width: 252, height: 172, borderRadius: 4, backgroundColor: '#BEE3F8',
    alignItems: 'center', justifyContent: 'center',
  },
  tabletQr: {
    backgroundColor: '#FFFFFF', borderRadius: 8, padding: 10,
    borderTopWidth: 3, borderTopColor: RED,
  },
  miniQr: { width: 99, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#FFFFFF' },
  miniCell: { width: 9, height: 9 },
  miniCellOn: { backgroundColor: '#111111' },
  tabletDot: {
    position: 'absolute', right: 8, top: '50%', width: 6, height: 6,
    borderRadius: 3, backgroundColor: '#444444', marginTop: -3,
  },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  helpCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, width: '100%' },
  helpGreen: {
    backgroundColor: '#1FA855', borderRadius: 12, padding: 20, alignItems: 'center',
  },
  helpLogoCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', marginTop: -52, marginBottom: 10,
  },
  helpLogoImg: { width: 44, height: 16 },
  helpGreenTitle: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF', textAlign: 'center' },
  helpGreenSub: { fontFamily: fonts.regular, fontSize: 13, color: '#FFFFFF', marginTop: 4 },
  helpQrImg: {
    backgroundColor: '#FFFFFF', borderRadius: 8, marginTop: 16,
    width: 190, height: 190,
  },
  helpBody: {
    fontFamily: fonts.regular, fontSize: 13, color: '#333333',
    textAlign: 'center', lineHeight: 20, marginTop: 16, marginBottom: 4,
  },
  helpPhone: { fontFamily: fonts.bold },
});
