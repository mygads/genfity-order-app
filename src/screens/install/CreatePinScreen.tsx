import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenterSm } from '../../theme';
import { loginDemo } from '../../session';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };
type Props = { navigation?: Nav; route?: { params?: { branch?: string } } };

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

export default function CreatePinScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const branch = route?.params?.branch ?? 'ESB Cabang Poris';
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const active = pin.length < 4 ? 'pin' : 'confirm';
  const val = active === 'pin' ? pin : confirm;
  const setVal = active === 'pin' ? setPin : setConfirm;

  const press = (k: string) => {
    setError('');
    if (k === 'C') setVal('');
    else if (k === '⌫') setVal(val.slice(0, -1));
    else if (val.length < 4) {
      const next = val + k;
      setVal(next);
      if (next.length === 4 && active === 'confirm') {
        if (next === pin) setOk(true);
        else {
          setError('Konfirmasi PIN tidak sama. Ulangi.');
          setPin('');
          setConfirm('');
        }
      }
    }
  };

  if (ok) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
        <Image source={require('../../../assets/images/process_success.webp')} style={styles.hero} resizeMode="contain" />
        <Text style={styles.title}>Terminal Siap!</Text>
        <Text style={styles.desc}>{branch} berhasil ditautkan. PIN kasir tersimpan di perangkat ini — gunakan untuk masuk.</Text>
        <TouchableOpacity
          style={styles.primary}
          onPress={() => { loginDemo(); navigation?.navigate('Login'); }}>
          <Text style={styles.primaryT}>Masuk ke POS ›</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Text style={styles.title}>Buat PIN Kasir</Text>
      <Text style={styles.desc}>
        {branch} · {active === 'pin' ? 'Masukkan 4 digit PIN baru.' : 'Ulangi PIN untuk konfirmasi.'}
      </Text>
      <View style={styles.pinRow}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.pinDot, val[i] && styles.pinDotOn]}>
            <Text style={styles.pinChar}>{val[i] ? '●' : '○'}</Text>
          </View>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.keys}>
        {KEYS.map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.key, (k === 'C' || k === '⌫') && styles.keyUtil]}
            onPress={() => press(k)}>
            <Text style={[styles.keyT, (k === 'C' || k === '⌫') && styles.keyUtilT]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.foot}>PIN hanya tersimpan di perangkat ini (demo)</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40, alignItems: 'center' },
  hero: { width: 160, height: 160, marginTop: 48 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 16, textAlign: 'center' },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  pinRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  pinDot: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  pinDotOn: { borderColor: colors.navy, backgroundColor: colors.paleBlue },
  pinChar: { fontSize: 20, color: colors.navy },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginTop: 8 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16, justifyContent: 'center' },
  key: { width: '31%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  keyT: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  keyUtil: { backgroundColor: colors.bg },
  keyUtilT: { color: colors.red },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 20, width: '100%' },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  foot: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 16 },
});
