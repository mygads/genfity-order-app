/**
 * B2 — TerminalPin (SPEC B1 langkah 3): entri PIN terminal lalu bind
 * atomik E03 via bindTerminal. Sukses → adoptTerminalBinding (kontrak
 * antar-paket: logout + clearGrant + tulis SEMUA store binding sekaligus),
 * lalu Login. Fail-closed: PIN salah / offline / BE absen / tag tak dikenal
 * tak pernah membuat binding — hanya pesan bind_failed / need_be /
 * sup_offline yang jujur. PIN tak pernah disimpan di device.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';
import { adoptTerminalBinding } from '../../session';
import { getDeviceId } from '../../lib/apiSource';
import { parseDeviceRole, setDeviceRoleForTag } from '../../lib/deviceRole';
import { bindTerminal, validateTerminalPin } from '../../lib/terminalApi';
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
      // E02: pre-check PIN tanpa efek dulu; pre-check tak terjangkau
      // (offline) boleh lanjut ke bind (fail-closed di sana) hanya dengan
      // pesan offline yang jujur — tanpa bypass diam-diam.
      try {
        const pre = await validateTerminalPin(terminalId, pin.trim());
        if (pre.ok && !pre.data.valid) {
          setError(t('bind_failed'));
          return;
        }
        if (!pre.ok) setError(t('need_be'));
      } catch {
        setError(t('need_be'));
      }
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
      // F11 fail-closed: tag kosong/tak dikenal → tolak bind (bind_failed).
      // JANGAN default 'full_access' diam-diam — tag adalah gerbang keamanan.
      const tag = parseDeviceRole((r.data.tag || p.tag || '').trim());
      if (!tag) {
        setError(t('bind_failed'));
        return;
      }
      // Kontrak antar-paket: adoptTerminalBinding = logout + clearGrant +
      // tulis SEMUA store binding (sesi, kontrak, server) sekaligus — JANGAN
      // setTerminal/saveBinding terpisah agar tak ada store yang tertinggal.
      // REBIND-STALE-GRANT: grant basi terminal sebelumnya ikut dicabut di
      // dalamnya (logout menandai pendingRevoke untuk flush E06/E07).
      try {
        await adoptTerminalBinding({
          terminalId,
          terminalCode,
          branchId,
          branchName,
          merchantName: branchName,
          tag,
          deviceId,
        });
      } catch {
        setError(t('bind_failed'));
        return;
      }
      // Cermin peran dari tag tervalidasi yang SAMA (store peran bukan bagian
      // adopt) — home guard tetap fail-safe bila ini gagal.
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
