import { useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';import AppButton from '../../components/AppButton';
import ScreenRoot from '../../components/ScreenRoot';
import { loginDemo } from '../../session';import { createPinOnServer } from '../../lib/apiSource';import { savePinHash } from '../../lib/pin';import { useLang } from '../../lib/i18n';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };type Props = { navigation?: Nav; route?: { params?: { branch?: string; userId?: string } } };const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];export default function CreatePinScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const branch = route?.params?.branch ?? 'ESB Cabang Poris';
  const { t } = useLang(); const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const [saving, setSaving] = useState(false); const active = pin.length < 4 ? 'pin' : 'confirm';
  const val = active === 'pin' ? pin : confirm;
  const setVal = active === 'pin' ? setPin : setConfirm;

  // PIN dikirim sekali ke server via apiSource (Dummy Mode offline / backend
  // asli bila env terisi), lalu disimpan sebagai HASH via SecureStore - PIN
  // plaintext tidak pernah disimpan. Verifikasi login tetap revalidasi ke
  // server (validateEmployee), bukan PIN lokal saja.
  // userId dari params bila pemanggil sudah validate employee, else akun
  // demo Gista (U07) agar alur install-langsung tetap jalan.
  const userId = route?.params?.userId ?? 'U07';
  const submitPin = async (matched: string) => { setSaving(true); setError(''); try { const r = await createPinOnServer(userId, matched); if (!r.ok) throw new Error('create-pin gagal'); await savePinHash(userId, matched); setOk(true); } catch { setError(t('inst_pin_fail')); setPin(''); setConfirm(''); } finally { setSaving(false); } };
  const press = (k: string) => {
    if (saving) return; setError('');
    if (k === 'C') setVal('');
    else if (k === '⌫') setVal(val.slice(0, -1));
    else if (val.length < 4) {
      const next = val + k;
      setVal(next);
      if (next.length === 4 && active === 'confirm') {
        if (next === pin) void submitPin(next);
        else {
          setError(t('inst_pin_mismatch'));
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
        <Text style={styles.title}>{t('inst_pin_done_title')}</Text>
        <Text style={styles.desc}>{t('inst_pin_done_desc').replace('{b}', branch)}</Text>
        <AppButton
          size="md"
          title={t('inst_pin_enter')}
          onPress={() => { loginDemo(); navigation?.navigate('Login'); }}
          style={styles.primary}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Text style={styles.title}>{t('inst_pin_title')}</Text>
      <Text style={styles.desc}>
        {branch} · {active === 'pin' ? t('inst_pin_new') : t('inst_pin_confirm')}
      </Text>
      <View style={styles.pinRow}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.pinDot, val[i] && styles.pinDotOn]}>
            <Text style={styles.pinChar}>{val[i] ? '●' : '○'}</Text>
          </View>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saving ? <Text style={styles.saving}>{t('inst_pin_saving')}</Text> : null}<View style={styles.keys}>
        {KEYS.map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.key, (k === 'C' || k === '⌫') && styles.keyUtil]}
            onPress={() => press(k)}>
            <Text style={[styles.keyT, (k === 'C' || k === '⌫') && styles.keyUtilT]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.foot}>{t('inst_pin_secure')}</Text>
    </ScrollView>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingBottom: 32, alignItems: 'center' },
  hero: { width: 160, height: 160, marginTop: 48 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 16, textAlign: 'center' },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  pinRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  pinDot: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  pinDotOn: { borderColor: colors.navy, backgroundColor: colors.paleBlue },
  pinChar: { fontSize: 20, color: colors.navy },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginTop: 8 },
  saving: { fontFamily: fonts.medium, fontSize: 13, color: colors.navy, marginTop: 8 }, keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16, justifyContent: 'center' },
  key: { width: '31%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  keyT: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  keyUtil: { backgroundColor: colors.bg },
  keyUtilT: { color: colors.red },
  primary: { backgroundColor: colors.orange, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 20, width: '100%' },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  foot: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 16 },});