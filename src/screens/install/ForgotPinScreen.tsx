import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenterSm } from '../../theme';

type Nav = { goBack: () => void };

export default function ForgotPinScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [username, setUsername] = useState('gista.kasir');
  const [sent, setSent] = useState(false);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Image source={require('../../../assets/images/forget_pin.webp')} style={styles.hero} resizeMode="contain" />
      <Text style={styles.title}>Lupa PIN?</Text>
      {sent ? (
        <>
          <Text style={styles.desc}>
            Tautan reset PIN untuk <Text style={styles.bold}>{username || 'kasir'}</Text> telah
            dikirim ke email supervisor outlet. Ikuti tautan tersebut, lalu masuk
            dengan PIN baru Anda.
          </Text>
          <TouchableOpacity style={styles.primary} onPress={() => navigation?.goBack()}>
            <Text style={styles.primaryT}>Kembali Masuk ›</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.desc}>
            Masukkan username kasir. Supervisor outlet akan menerima instruksi
            reset PIN — PIN lama langsung dinonaktifkan.
          </Text>
          <Text style={styles.label}>Username kasir</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="cth. gista.kasir"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.primary, !username.trim() && styles.disabled]}
            onPress={() => setSent(true)}
            disabled={!username.trim()}>
            <Text style={styles.primaryT}>Kirim Instruksi Reset</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40, alignItems: 'center' },
  hero: { width: '100%', height: 180, marginTop: 12 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 12 },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 8, textAlign: 'center', lineHeight: 19 },
  bold: { fontFamily: fonts.bold, color: colors.text },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 16, marginBottom: 6, alignSelf: 'flex-start' },
  input: {
    width: '100%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: 10, padding: 12, fontFamily: fonts.medium, fontSize: 15, color: colors.text,
  },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 16, width: '100%' },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
});
