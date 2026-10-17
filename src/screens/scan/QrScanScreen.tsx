import { useEffect, useRef, useState } from 'react';import { Image, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { CameraView, useCameraPermissions } from 'expo-camera';import ScreenHeader from '../../components/ScreenHeader';import { TABLET_BP, colors, fonts, rp, wideCenterSm } from '../../theme';import { useLang } from '../../lib/i18n';import { ensureShiftOpen } from '../../lib/shiftGuard';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type ScanTab = 'claim' | 'esb' | 'member' | 'voucher';const TABS: ScanTab[] = ['claim', 'esb', 'member', 'voucher'];const TAB_DEFAULT_CODE: Record<ScanTab, string> = {
  claim: '', esb: 'GNF-88121', member: 'MBR-QOQI-342', voucher: 'VC-DISKON10K',};const TAB_PLACEHOLDER: Record<ScanTab, string> = {
  claim: 'TRM-XXXX-XXXX',
  esb: 'GNF-XXXXX',
  member: 'MBR-XXXX',
  voucher: 'VC-XXXX',};export default function QrScanScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [tab, setTab] = useState<ScanTab>('voucher');
  const [code, setCode] = useState('VC-DISKON10K');
  const [result, setResult] = useState(true);
  const [msg, setMsg] = useState('');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  // Auto-start kamera saat mount (parity POSLite: izin -> kamera langsung buka; web tetap manual).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (autoStarted.current) return;
    autoStarted.current = true;
    (async () => {
      if (permission?.granted) { setMsg(''); setScanning(true); return; }
      try {
        const res = await requestPermission();
        if (res.granted) { setMsg(''); setScanning(true); }
        else setMsg(t('scan_denied'));
      } catch { setMsg(t('scan_denied')); }
    })();
  }, []);

  const tabLabel = (x: ScanTab) => x === 'claim' ? t('scan_tab_claim') : x === 'esb' ? t('scan_tab_esb') : x === 'member' ? t('scan_tab_member') : t('scan_tab_voucher'); const tabHint = (x: ScanTab) => x === 'claim' ? t('scan_hint_claim') : x === 'esb' ? t('scan_hint_esb') : x === 'member' ? t('scan_hint_member') : t('scan_hint_voucher'); const toggleScan = async () => {
    if (scanning) {
      setScanning(false);
      return;
    }
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setMsg(t('scan_denied'));
        return;
      }
    }
    setMsg('');
    setScanning(true);
  };

  const pickTab = (x: ScanTab) => {
    setTab(x);
    setResult(false);
    setMsg('');
    setCode(TAB_DEFAULT_CODE[x]);
  };

  const check = () => {
    if (!code.trim()) {
      setMsg(t('scan_need_code'));
      setResult(false);
      return;
    }
    setMsg('');
    setResult(true);
  };

  const useCode = async () => {
    if (code.trim().length < 3) { setMsg(t('scan_short')); setResult(false); return; } if (tab === 'claim') {
      navigation?.navigate('Install');
      return;
    }
    if (tab === 'esb') {
      navigation?.navigate('EsbOrder');
      return;
    }
    // Gerbang kasir: shift tutup → pesan + buka shift dulu.
    if (!(await ensureShiftOpen(navigation, `${t('dash_shift_closed')} - ${t('shf_open_btn')}`, setMsg))) return;
    navigation?.navigate('Cashier');
  };

  const descFor = () => {
    if (tab === 'voucher') return `${t('scan_desc_voucher_pre')}${rp(10000)}${t('scan_desc_voucher_post')}`;
    if (tab === 'member') return t('scan_desc_member');
    if (tab === 'esb') return t('scan_desc_esb');
    return t('scan_desc_claim');
  };

  return (
    <View style={styles.root}><ScreenHeader title={t('scan_title')} onBack={() => navigation?.goBack()} /><ScrollView  contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Text style={[styles.hint, isTablet && styles.hintBig]}>{t('scan_camera_manual')}</Text>
      <View style={styles.frame}>
        {scanning ? (
          <CameraView
            style={[styles.camera, isTablet && styles.cameraTablet]}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              setCode(String(data));
              setResult(true);
              setMsg('');
              setScanning(false);
            }}
          />
        ) : (
          <Image source={require('../../../assets/images/invalid_qr.webp')} style={[styles.frameImg, isTablet && styles.frameImgTablet]} resizeMode="contain" />
        )}
        <Text style={[styles.frameT, isTablet && styles.frameTBig]}>{t('scan_frame_title')}</Text>
        <Text style={[styles.frameS, isTablet && styles.frameSBig]}>{tabHint(tab)}</Text>
        <TouchableOpacity style={[styles.scanBtn, isTablet && styles.scanBtnTablet]} onPress={toggleScan}>
          <Text style={styles.scanBtnT}>{scanning ? t('scan_camera_off') : t('scan_camera_on')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.tabs}>
        {TABS.map((x) => (
          <TouchableOpacity key={x} style={[styles.tab, tab === x && styles.tabOn]} onPress={() => pickTab(x)}>
            <Text style={[styles.tabT, isTablet && styles.tabTBig, tab === x && styles.tabTOn]}>{tabLabel(x)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {result ? (
        <View style={styles.card}>
          <Text style={[styles.code, isTablet && styles.codeBig]}>{code || '-'}</Text>
          <Text style={[styles.desc, isTablet && styles.descBig]}>{descFor()}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.ghost} onPress={() => setResult(false)}>
              <Text style={styles.ghostT}>{t('scan_rescan')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={() => void useCode()}>
              <Text style={styles.primaryT}>{t('scan_use')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={styles.empty}>{t('scan_empty')}</Text>
      )}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <Text style={styles.label}>{`${t('scan_manual_pre')}${tabLabel(tab)}${t('scan_manual_post')}`}</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        placeholder={TAB_PLACEHOLDER[tab]}
        placeholderTextColor={colors.faint}
        autoCapitalize="characters"
      />
      <TouchableOpacity style={styles.primary} onPress={check}>
        <Text style={[styles.primaryT, isTablet && styles.primaryTBig]}>{t('scan_check')}</Text>
      </TouchableOpacity>
    </ScrollView>
  </View> );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  langBtn: { borderWidth: 1, borderColor: colors.navyTint, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }, langT: { fontFamily: fonts.bold, fontSize: 11, color: colors.white }, hint: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  hintBig: { fontSize: 14 }, frame: { backgroundColor: colors.navy, borderRadius: 14, padding: 22, alignItems: 'center', marginTop: 12 },
  frameImg: { width: 120, height: 90 },
  camera: { width: 220, height: 160, borderRadius: 10, overflow: 'hidden' },
  // Tablet: viewfinder proporsional 4:3 (400x300) + target sentuh 48px; phone tetap.
  cameraTablet: { width: '100%', maxWidth: 400, height: 300 },
  frameImgTablet: { width: 180, height: 135 },
  scanBtnTablet: { minHeight: 48, justifyContent: 'center' },
  scanBtn: { marginTop: 10, borderWidth: 1, borderColor: colors.navyTint, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 },
  scanBtnT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  frameT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white, marginTop: 8 },
  frameTBig: { fontSize: 19 }, frameS: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 4 },
  frameSBig: {  fontSize: 13 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  tab: { flexGrow: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, alignItems: 'center', backgroundColor: colors.card, minWidth: '22%' },
  tabOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  tabT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
  tabTBig: { fontSize: 13 }, tabTOn: { color: colors.orangeDark },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  code: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  codeBig: { fontSize: 19 }, desc: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4 },
  descBig: { fontSize: 14 }, actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primary: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 10 },
  primaryT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
  primaryTBig: { fontSize: 15 }, ghost: { flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 13, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 12 },
  msg: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.bold, fontSize: 14, color: colors.text, outlineStyle: 'none' as never },});