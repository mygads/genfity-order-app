import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ScreenRoot from '../../components/ScreenRoot';
import { useLang } from '../../lib/i18n';

type Nav = { goBack: () => void };

export default function ForgotPinScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [username, setUsername] = useState('gista.kasir');
  const [sent, setSent] = useState(false);

  return (
    <ScreenRoot style={styles.root}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Image source={require('../../../assets/images/forget_pin.webp')} style={styles.hero} resizeMode="contain" />
      <Text style={styles.title}>{t('g_forgot_title')}</Text>
      {sent ? (
        <>
          <Text style={styles.desc}>
            {t('g_forgot_sent_pre')} <Text style={styles.bold}>{username || t('g_forgot_cashier_fb')}</Text>{' '}
            {t('g_forgot_sent_post')}
          </Text>
          <AppButton
            size="md"
            title={t('g_forgot_back')}
            onPress={() => navigation?.goBack()}
            style={styles.primary}
          />
        </>
      ) : (
        <>
          <Text style={styles.desc}>
            {t('g_forgot_desc')}
          </Text>
          <Text style={styles.label}>{t('g_forgot_label')}</Text>
          <View style={styles.inputWrap}>
            <AppInput
              boxStyle={styles.input}
              style={styles.inputText}
              value={username}
              onChangeText={setUsername}
              placeholder={t('g_forgot_ph')}
              autoCapitalize="none"
            />
          </View>
          <AppButton
            size="md"
            title={t('g_forgot_send')}
            onPress={() => setSent(true)}
            disabled={!username.trim()}
            style={styles.primary}
          />
        </>
      )}
    </ScrollView>
    </ScreenRoot>
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
    borderRadius: 10, padding: 12, fontFamily: fonts.medium, fontSize: 14, color: colors.text,
  },
  /** Teks di dalam AppInput: medium ala form lama. */
  inputText: { fontFamily: fonts.medium },
  /** Pembungkus AppInput agar selebar form di container tengah. */
  inputWrap: { width: '100%' },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 16, width: '100%' },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
});
