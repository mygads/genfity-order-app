import { useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';import AppButton from '../../components/AppButton';
import ScreenRoot from '../../components/ScreenRoot';
import { createPinOnServer, getApiMode } from '../../lib/apiSource';import { savePinHash } from '../../lib/pin';import { clearPinChangeRequired } from '../../lib/supervisor';import { useLang } from '../../lib/i18n';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };type Props = { navigation?: Nav; route?: { params?: { branch?: string; userId?: string } } };const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];/** B9: PIN lemah — semua berulang atau berurutan umum. */
const WEAK_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321']);
const isWeakPin = (p: string): boolean => WEAK_PINS.has(p);export default function CreatePinScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const branch = route?.params?.branch ?? 'Genfity Cabang Poris';
  const { t } = useLang(); const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const [saving, setSaving] = useState(false); const active = pin.length < 4 ? 'pin' : 'confirm';
  const val = active === 'pin' ? pin : confirm;
  const setVal = active === 'pin' ? setPin : setConfirm;

  // PIN LEGACY ALUR INSTALL (paket app-login, audit row 5): PIN yang dibuat
  // di sini = PIN admin perangkat pertama (jalur server lama via apiSource),
  // BUKAN PIN terminal kontrak (binding branch→terminal→PIN-terminal di
  // InstallScreen via lib/terminalContract.ts) dan BUKAN PIN staff modal
  // pasca-login (Q11 di LoginScreen). Tiga PIN terpisah; jangan disatukan.
  // PIN dikirim sekali ke server via apiSource (backend asli bila env
  // terisi; Local Mode langsung simpan hash lokal di bawah), lalu disimpan
  // sebagai HASH via SecureStore - PIN plaintext tidak pernah disimpan.
  // Verifikasi login tetap revalidasi ke server (validateEmployee) saat
  // online, bukan PIN lokal saja.
  // userId dari params bila pemanggil sudah validate employee, else akun
  // admin perangkat ('u-admin' seed) karena alur install membuat PIN admin
  // pertama — BUKAN 'U07' (id fiktif fixture dummy yang sudah disapu seed).
  const userId = route?.params?.userId ?? 'u-admin';
  // A-P0-1: PIN baru dari manusia membersihkan flag wajib-ganti (seed acak /
  // reset) agar eskalasi supervisor dibuka kembali untuk akun ini.
  const clearMustChange = async (uid: string) => { try { await clearPinChangeRequired(uid); } catch { /* best-effort */ } };
  const submitPin = async (matched: string) => { setSaving(true); setError(''); try { if (!userId) throw new Error('tanpa user'); if (getApiMode() === 'local') { await savePinHash(userId, matched); await clearMustChange(userId); setOk(true); return; } const r = await createPinOnServer(userId, matched); if (!r.ok) throw new Error('create-pin gagal'); await savePinHash(userId, matched); await clearMustChange(userId); setOk(true); } catch { setError(t('inst_pin_fail')); setPin(''); setConfirm(''); } finally { setSaving(false); } };
  const press = (k: string) => {
    if (saving) return; setError('');
    if (k === 'C') setVal('');
    else if (k === '⌫') setVal(val.slice(0, -1));
    else if (val.length < 4) {
      const next = val + k;
      setVal(next);
      if (next.length === 4 && active === 'confirm') {
        if (next === pin) {
          // B9: tolak PIN lemah (berulang/berurutan).
          if (isWeakPin(next)) {
            setError(t('pin_weak'));
            setPin('');
            setConfirm('');
          } else void submitPin(next);
        }
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
      <ScreenRoot style={styles.root}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
        <Image source={require('../../../assets/images/process_success.webp')} style={[styles.hero, isTablet && styles.heroBig]} resizeMode="contain" />
        <Text style={styles.title}>{t('inst_pin_done_title')}</Text>
        <Text style={styles.desc}>{t('inst_pin_done_desc').replace('{b}', branch)}</Text>
        <AppButton
          size="md"
          title={t('inst_pin_enter')}
          onPress={() => { navigation?.navigate('Login'); }}
          style={styles.primary}
        />
      </ScrollView>
      </ScreenRoot>
    );
  }

  return (
    <ScreenRoot style={styles.root}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Text style={styles.title}>{t('inst_pin_title')}</Text>
      <Text style={styles.desc}>
        {branch} · {active === 'pin' ? t('inst_pin_new') : t('inst_pin_confirm')}
      </Text>
      <View style={styles.pinRow}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.pinDot, val[i] && styles.pinDotOn, isTablet && styles.pinDotBig]}>
            <Text style={styles.pinChar}>{val[i] ? '●' : '○'}</Text>
          </View>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saving ? <Text style={styles.saving}>{t('inst_pin_saving')}</Text> : null}<View style={[styles.keys, isTablet && styles.keysBig]}>
        {KEYS.map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.key, (k === 'C' || k === '⌫') && styles.keyUtil]}
            onPress={() => press(k)}>
            <Text style={[styles.keyT, (k === 'C' || k === '⌫') && styles.keyUtilT, isTablet && styles.keyTBig]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.foot}>{t('inst_pin_secure')}</Text>
    </ScrollView>
    </ScreenRoot>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingBottom: 32, alignItems: 'center' },
  hero: { width: 160, height: 160, marginTop: 48 },
  /** Skala tablet: dot + keypad + hero sukses membesar (phone tetap). */
  heroBig: { width: 200, height: 200 },
  pinDotBig: { width: 68, height: 68, borderRadius: 12 },
  keyTBig: { fontSize: 20 },
  keysBig: { gap: 12 },
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