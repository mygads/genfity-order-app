import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, wideCenterSm } from '../../theme';
import { loginDemo } from '../../session';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  reset?: (state: unknown) => void;
};

type Props = { navigation?: Nav };

const OUTLETS = ['ESB Cabang Poris', 'ESB Cabang Ciputat', 'ESB Cabang Bintaro'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

export default function LoginScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [outlet, setOutlet] = useState(OUTLETS[0]);
  const [username, setUsername] = useState('gista.kasir');
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');

  const press = (k: string) => {
    setError('');
    if (k === 'C') setPin('');
    else if (k === '⌫') setPin(pin.slice(0, -1));
    else if (pin.length < 4) setPin(pin + k);
  };

  const submit = () => {
    if (pin.length > 0 && pin.length < 4) {
      setError('PIN salah. Coba lagi.');
      return;
    }
    loginDemo();
    if (navigation?.navigate) navigation.navigate('Dashboard');
  };

  const demo = () => {
    loginDemo();
    if (navigation?.navigate) navigation.navigate('Dashboard');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Text style={styles.brand}>ESB POSLite</Text>
      <Text style={styles.sub}>Login Kasir · v3.2.1 · Online</Text>
      <Text style={styles.welcome}>Selamat Datang</Text>
      <Text style={styles.hint}>Masuk untuk mulai berjualan hari ini.</Text>

      <Text style={styles.label}>Outlet</Text>
      <View style={styles.outlets}>
        {OUTLETS.map((o) => (
          <TouchableOpacity
            key={o}
            style={[styles.outlet, outlet === o && styles.outletOn]}
            onPress={() => setOutlet(o)}>
            <Text style={[styles.outletText, outlet === o && styles.outletTextOn]}>{o}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Username</Text>
      <TextInput style={styles.input} value={username} onChangeText={setUsername} />

      <Text style={styles.label}>PIN (4 digit)</Text>
      <View style={styles.pinRow}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.pinDot, pin[i] && styles.pinDotOn]}>
            <Text style={styles.pinChar}>{pin[i] ? '●' : '○'}</Text>
          </View>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.pinHelp}>Lupa PIN? Minta reset ke supervisor outlet ›</Text>

      <View style={styles.keys}>
        {KEYS.map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.key, (k === 'C' || k === '⌫') && styles.keyUtil]}
            onPress={() => press(k)}>
            <Text style={[styles.keyText, (k === 'C' || k === '⌫') && styles.keyUtilText]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.check} onPress={() => setRemember(!remember)}>
        <Text style={styles.checkBox}>{remember ? '☑' : '☐'}</Text>
        <Text style={styles.checkText}>Ingat outlet & username saja (bukan PIN)</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.primary, pin.length < 4 && styles.primaryDisabled]}
        onPress={submit}
        disabled={pin.length < 4}
        accessibilityState={{ disabled: pin.length < 4 }}>
        <Text style={styles.primaryText}>
          {pin.length === 0 ? 'Masuk — isi PIN 4 digit' : pin.length < 4 ? `Masuk (${pin.length}/4)` : 'Masuk ›'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.demo} onPress={demo}>
        <Text style={styles.demoText}>Masuk Demo</Text>
      </TouchableOpacity>
      <Text style={styles.foot}>Hanya username yang diingat di perangkat ini · PIN tidak pernah disimpan</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 48 },
  brand: { fontFamily: fonts.bold, fontSize: 26, color: colors.navy, textAlign: 'center' },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 4 },
  welcome: { fontFamily: fonts.bold, fontSize: 20, color: colors.text, marginTop: 20 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 16, marginBottom: 8 },
  outlets: { gap: 8 },
  outlet: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, backgroundColor: colors.card },
  outletOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  outletText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  outletTextOn: { color: colors.orangeDark },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  pinRow: { flexDirection: 'row', gap: 10 },
  pinDot: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  pinDotOn: { borderColor: colors.navy, backgroundColor: colors.paleBlue },
  pinChar: { fontSize: 20, color: colors.navy },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginTop: 8 },
  pinHelp: { fontFamily: fonts.semibold, fontSize: 12, color: colors.orangeDark, marginTop: 6 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  key: { width: '31%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  keyText: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  keyUtil: { backgroundColor: colors.bg },
  keyUtilText: { color: colors.red },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  checkBox: { fontSize: 18, color: colors.navy },
  checkText: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  demo: { backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 10 },
  demoText: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  foot: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 16 },
});
