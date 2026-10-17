import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ScreenRoot from '../../components/ScreenRoot';
import { useLang } from '../../lib/i18n';
import { getApiMode } from '../../lib/apiSource';
import { loadBinding, requestPinReset } from '../../lib/terminalContract';
// APP-FIXUP (fix-app-contract D1): merchantId (scope body pin-reset server)
// diambil dari binding/sesi — perangkat tak menyimpan merchant id terpisah.
import {
  getBinding as getSessionBinding,
  getSession,
  hydrateTerminalState,
} from '../../session';

type Nav = { goBack: () => void };

/** B9: PIN lemah — semua berulang atau berurutan umum. */
const WEAK_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321']);
const isWeakPin = (p: string): boolean => WEAK_PINS.has(p);

export default function ForgotPinScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang();
  const [username, setUsername] = useState('');
  // APP-FIXUP (fix-app-contract D1): kontrak fix-be butuh PIN baru langsung
  // di body {merchantId, pin, username?/userId?} — bukan alur tautan email.
  // PIN hanya hidup di state komponen (tak pernah disimpan) + dibersihkan
  // tiap sukses. Label literal ID/EN netral, tanpa kunci i18n baru (lane beku).
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sent, setSent] = useState<'no' | 'ok' | 'offline'>('no');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Jujur offline-first: tanpa server (local/dummy) tak ada "instruksi"
  // yang bisa dikirim — tunjukkan arahan reset via owner, bukan klaim palsu.
  const offline = getApiMode() !== 'real';

  // Fix CONFIRMED-3 (audit row 16, paket app-login) + D1 (fix-app-contract):
  // call NYATA ke POST /api/v1/staff/{id}/pin-reset (owner-only) dengan body
  // {merchantId, pin, username}. ok → sent 'ok'; kontrak tak terjangkau →
  // sent 'offline' (arahan owner, jujur); server menolak → pesan galat
  // (BUKAN sukses palsu).
  const send = async () => {
    const u = username.trim();
    if (!u || busy) return;
    // Konvensi PIN staff perangkat: numerik, minimal 4 digit (ala keypad
    // CreatePin 4-dot + seed 1234/1111/2222); kebijakan atas milik server.
    if (!/^\d{4,}$/.test(pin)) {
      setErr(
        lang === 'id'
          ? 'PIN minimal 4 digit angka.'
          : 'PIN must be at least 4 digits.',
      );
      return;
    }
    if (pin !== confirm) {
      setErr(
        lang === 'id'
          ? 'PIN baru dan konfirmasi tidak sama.'
          : 'New PIN and confirmation do not match.',
      );
      return;
    }
    // B9: tolak PIN lemah (berulang/berurutan).
    if (isWeakPin(pin)) {
      setErr(t('pin_weak'));
      return;
    }
    setBusy(true); setErr('');
    try {
      // Scope merchant = branch binding (sesi diutamakan, kontrak fallback):
      // perangkat tak menyimpan merchant id terpisah (model cabang tunggal).
      await hydrateTerminalState().catch(() => {});
      const b = await loadBinding().catch(() => null);
      const merchantId = (
        getSessionBinding()?.branchId ??
        b?.branchId ??
        getSession()?.branchId ??
        ''
      ).trim();
      if (!merchantId) {
        setErr(t('forgot_unbound'));
        return;
      }
      const r = await requestPinReset({ userIdOrUsername: u, merchantId, newPin: pin });
      if (r.ok) { setSent('ok'); setPin(''); setConfirm(''); return; }
      if (r.offline) { setSent('offline'); return; }
      setErr(t('forgot_rejected'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenRoot style={styles.root}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Image source={require('../../../assets/images/forget_pin.webp')} style={[styles.hero, isTablet && styles.heroBig]} resizeMode="contain" />
      <Text style={[styles.title, isTablet && styles.titleBig]}>{t('g_forgot_title')}</Text>
      {sent !== 'no' ? (
        <>
          <Text style={[styles.desc, isTablet && styles.descBig]}>
            {/* APP-FIXUP (fix-app-contract D1): salinan sukses jujur untuk
                reset langsung — alur lama mengklaim "tautan dikirim ke email
                supervisor" padahal body baru menyetel PIN langsung. */}
            {sent === 'offline' || offline ? t('g_forgot_offline') : (
              <>{t('forgot_reset_ok').replace('{user}', username || t('g_forgot_cashier_fb'))}</>
            )}
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
          <Text style={[styles.desc, isTablet && styles.descBig]}>
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
          {/* APP-FIXUP (fix-app-contract D1): PIN baru + konfirmasi untuk body
              {merchantId, pin, username}. Literal netral, tanpa kunci baru. */}
          <Text style={styles.label}>{lang === 'id' ? 'PIN baru' : 'New PIN'}</Text>
          <View style={styles.inputWrap}>
            <AppInput
              boxStyle={styles.input}
              style={styles.inputText}
              value={pin}
              onChangeText={(v) => setPin(v.replace(/[^\d]/g, ''))}
              placeholder={lang === 'id' ? 'Min. 4 digit angka' : 'Min. 4 digits'}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={12}
            />
          </View>
          <Text style={styles.label}>{lang === 'id' ? 'Konfirmasi PIN baru' : 'Confirm new PIN'}</Text>
          <View style={styles.inputWrap}>
            <AppInput
              boxStyle={styles.input}
              style={styles.inputText}
              value={confirm}
              onChangeText={(v) => setConfirm(v.replace(/[^\d]/g, ''))}
              placeholder={lang === 'id' ? 'Ulangi PIN baru' : 'Repeat new PIN'}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={12}
            />
          </View>
          <AppButton
            size="md"
            title={busy ? (lang === 'id' ? 'Mengirim...' : 'Sending...') : t('g_forgot_send')}
            onPress={send}
            disabled={!username.trim() || !pin || !confirm || busy}
            style={styles.primary}
          />
          {err ? <Text style={styles.error}>{err}</Text> : null}
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
  /** Skala tablet: hero + judul + deskripsi membesar (phone tetap). */
  heroBig: { height: 240 },
  titleBig: { fontSize: 24 },
  descBig: { fontSize: 15, lineHeight: 22 },
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
  /** Galat penolakan server (paket app-login; literal, tanpa kunci baru). */
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, textAlign: 'center', marginTop: 12 },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
});
