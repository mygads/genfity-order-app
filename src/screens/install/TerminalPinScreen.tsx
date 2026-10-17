/**
 * B2 — TerminalPin (SPEC B1 langkah 3): entri PIN terminal lalu bind
 * atomik E03 via bindTerminal. Sukses → saveBinding (session, persist
 * lintas logout) + setTerminal (header request) + tag perangkat, lalu
 * Login. Fail-closed: PIN salah / offline / BE absen tak pernah membuat
 * binding — hanya pesan bind_failed / need_be / sup_offline yang jujur.
 * PIN tak pernah disimpan di device.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';
import { setTerminal } from '../../config/server';
import { saveBinding } from '../../session';
import { getDeviceId } from '../../lib/apiSource';
import { parseDeviceRole, setDeviceRoleForTag } from '../../lib/deviceRole';
import { bindTerminal } from '../../lib/terminalApi';
import { useLang } from '../../lib/i18n';
import AppButton from '../../components/AppButton';
import ScreenRoot from '../../components/ScreenRoot';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack?: () => void;
};

type Route = {
  params?: {
    branchId?: string;
    branchName?: string;
    terminalId?: string;
    terminalCode?: string;
    terminalName?: string;
    tag?: string;
  };
};

const GREY = '#757575';
const TITLE_DARK = '#2B2B2B';

export default function TerminalPinScreen({
  navigation,
  route,
}: {
  navigation?: Nav;
  route?: Route;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const p = route?.params ?? {};
  const branchId = (p.branchId ?? '').trim();
  const branchName = (p.branchName ?? '').trim() || branchId;
  const terminalId = (p.terminalId ?? '').trim();
  const terminalCode = (p.terminalCode ?? '').trim();
  const terminalName = (p.terminalName ?? '').trim() || terminalCode;
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [kicked, setKicked] = useState('');

  const submit = async () => {
    if (busy || done) return;
    if (pin.trim().length < 4) {
      setError(t('terminal_pin_hint'));
      return;
    }
    if (!terminalId || !branchId) {
      setError(t('bind_failed'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const deviceId = await getDeviceId();
      const r = await bindTerminal(terminalId, pin.trim(), deviceId);
      if (!r.ok) {
        setError(r.reason === 'need_be' ? t('need_be') : t('sup_offline'));
        return;
      }
      if (!r.data.bound) {
        setError(t('bind_failed'));
        return;
      }
      // Tag tak dikenal/kosong = explicit default 'full_access' (perilaku
      // terbuka legacy) — tak pernah '' diam-diam; saveBinding juga menegakkan.
      const tag = parseDeviceRole((r.data.tag || p.tag || '').trim()) ?? 'full_access';
      saveBinding({
        terminalId,
        terminalCode,
        branchId,
        branchName,
        merchantName: '',
        tag,
        ...(r.data.pairedKasirId ? { pairedKasirId: r.data.pairedKasirId } : {}),
        ...(r.data.pairedViewId ? { pairedViewId: r.data.pairedViewId } : {}),
        deviceId,
        boundAt: new Date().toISOString(),
      });
      // Kompatibel jalur lama: header request + query lokal tetap baca ini.
      setTerminal({ terminalCode, branchId, branchName });
      try {
        setDeviceRoleForTag(tag);
      } catch {
        /* peran bertahan — home guard tetap fail-safe */
      }
      if (r.data.kickedUserId) setKicked(r.data.kickedUserId);
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  const goLogin = () => {
    navigation?.navigate('Login');
  };

  return (
    <ScreenRoot style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          onPress={() => navigation?.goBack?.()}
          hitSlop={12}
          style={styles.backRow}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isTablet && styles.titleBig]}>
          {t('terminal_pin_title')}
        </Text>
        <Text style={[styles.desc, isTablet && styles.descBig]}>
          {branchName} · {terminalName}
        </Text>
        {!done ? (
          <>
            <Text style={[styles.desc, isTablet && styles.descBig]}>
              {t('terminal_pin_hint')}
            </Text>
            <TextInput
              style={styles.pinInput}
              value={pin}
              onChangeText={(v) => {
                setPin(v.replace(/[^0-9]/g, ''));
                setError('');
              }}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={12}
              editable={!busy}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <AppButton
              size="lg"
              title={t('terminal_pin_title')}
              onPress={submit}
              disabled={busy || pin.trim().length < 4}
              style={styles.primary}
            />
          </>
        ) : (
          <View style={styles.doneCard}>
            <Text style={styles.doneTitle}>{t('bind_success')}</Text>
            <Text style={styles.doneSub}>
              {branchName} · {terminalCode}
            </Text>
            {kicked ? <Text style={styles.doneSub}>{kicked}</Text> : null}
            <AppButton
              size="lg"
              title={t('title_login')}
              onPress={goLogin}
              style={styles.primary}
            />
          </View>
        )}
      </ScrollView>
    </ScreenRoot>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32, flexGrow: 1 },
  backRow: { alignSelf: 'flex-start', paddingRight: 16, paddingBottom: 8 },
  back: { fontSize: 28, color: '#4A4A4A', fontFamily: fonts.bold },
  title: { fontFamily: fonts.bold, fontSize: 20, color: TITLE_DARK },
  titleBig: { fontSize: 24 },
  desc: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: GREY,
    marginTop: 6,
    lineHeight: 19,
  },
  descBig: { fontSize: 15, lineHeight: 21 },
  pinInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 16,
    height: 56,
    fontFamily: fonts.bold,
    fontSize: 18,
    color: TITLE_DARK,
    letterSpacing: 6,
    textAlign: 'center',
    marginTop: 18,
  },
  error: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.red,
    textAlign: 'center',
    marginTop: 12,
  },
  primary: {
    backgroundColor: colors.orange,
    borderRadius: 22,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  doneCard: {
    backgroundColor: '#F4F8FF',
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 12,
    padding: 16,
    marginTop: 18,
  },
  doneTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  doneSub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: GREY,
    marginTop: 6,
    lineHeight: 19,
  },
});
