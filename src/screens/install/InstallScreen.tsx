import { useEffect, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import { setTerminal, WEB_URLS } from '../../config/server';import { validateTerminal, fetchPosVersion, notifyTerminalVerification } from '../../lib/apiSource';import { useLang } from '../../lib/i18n';
import ScreenRoot from '../../components/ScreenRoot';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav; route?: { params?: { code?: string } } };const GREY = '#757575';const STEP_KEYS = ['inst_step1', 'inst_step2', 'inst_step3'];export default function InstallScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [code, setCode] = useState(route?.params?.code ?? '');
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const [checking, setChecking] = useState(false);
  // WIRE REA-12: versi POS server (best-effort - kosong = dummy/offline).
  const [posVer, setPosVer] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const v = await fetchPosVersion();
        if (!live || v.fromDummy || !v.latestVersion) return;
        setPosVer(`v${v.latestVersion} / min v${v.minVersion}`);
      } catch { /* offline - tanpa info versi */ }
    })();
    return () => { live = false; };
  }, []);
  // Klaim via lapisan apiSource (Dummy Mode offline / backend asli bila env
  // terisi). Kode terminal yang lolos disimpan ke setTerminal untuk header
  // request berikutnya.
  const claim = async () => {
    if (checking) return; if (code.trim().length < 4) {
      setError(t('inst_code_short'));
      return;
    }
    setChecking(true); setError('');
    try { const r = await validateTerminal(code.trim().toUpperCase()); if (!r.valid || !r.branchId) { setError(t('inst_claim_invalid')); return; } setTerminal({ terminalCode: code.trim().toUpperCase(), branchId: r.branchId, branchName: r.branchName, }); try { await notifyTerminalVerification('verified'); } catch { /* notify best-effort - klaim tetap lanjut */ } navigation?.navigate('SelectBranch');
  } catch { setError(t('inst_claim_invalid')); } finally { setChecking(false); } };

  return (
    <ScreenRoot style={styles.root}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
      showsVerticalScrollIndicator={false}>
      <Image source={require('../../../assets/images/claim_terminal.webp')} style={[styles.banner, isTablet && styles.bannerBig]} resizeMode="contain" />
      <Text style={[styles.title, isTablet && styles.titleBig]}>{t('inst_title')}</Text>
      <Text style={[styles.desc, isTablet && styles.descBig]}>
        {t('inst_desc')}
      </Text>
      {posVer ? <Text style={[styles.desc, isTablet && styles.descBig]}>POS {posVer}</Text> : null}

      <View style={styles.stepsCard}>
        {STEP_KEYS.map((k, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumT}>{i + 1}</Text>
            </View>
            <Text style={[styles.stepT, isTablet && styles.stepTBig]}>{t(k)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.scanBox}>
        <Text style={styles.scanGlyph}>▣</Text>
        <Text style={[styles.scanText, isTablet && styles.scanTextBig]}>{t('inst_scan_frame')}</Text>
        <TouchableOpacity
          style={[styles.scanBtn, isTablet && styles.scanBtnBig]}
          onPress={() => { setCode('GNF-PORIS-01'); setError(''); }}>
          <Text style={styles.scanBtnT}>{t('inst_sim_scan')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('inst_code_label')}</Text>
      <AppInput
        boxStyle={styles.input}
        style={styles.inputText}
        value={code}
        onChangeText={(t) => { setCode(t); setError(''); }}
        placeholder={t('inst_code_ph')}
        autoCapitalize="characters"
        error={error}
      />

      <AppButton
        size="md"
        title={checking ? t('inst_claim_checking') : `${t('inst_claim_btn')} ›`}
        onPress={claim}
        disabled={checking}
        style={styles.primary}
      />

      <AppButton
        size="md"
        variant="secondary"
        title={`${t('inst_web_btn')} ›`}
        onPress={() => navigation?.navigate('WebView', { url: WEB_URLS.register, title: t('inst_web_title') })}
        style={styles.webBtn}
        textStyle={styles.webBtnT}
      />

      <TouchableOpacity onPress={() => setShowHelp((v) => !v)}>
        <Text style={styles.link}>{`${t('inst_no_qr')} ›`}</Text>
      </TouchableOpacity>
      {showHelp && (
        <View style={styles.helpCard}>
          <Image source={require('../../../assets/images/get_qr_banner.webp')} style={styles.helpImg} resizeMode="contain" />
          <Text style={styles.helpT}>{t('inst_help1')}</Text>
          <Text style={styles.helpT}>{t('inst_help2')}</Text>
          <Text style={styles.helpT}>{t('inst_help3')}</Text>
        </View>
      )}
    </ScrollView>
    </ScreenRoot>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 },
  banner: { width: '100%', height: 150 },
  /** Skala tablet: banner + teks membesar, tombol scan penuhi sentuh 48px (phone tetap). */
  bannerBig: { height: 210 },
  titleBig: { fontSize: 24 },
  descBig: { fontSize: 15, lineHeight: 21 },
  stepTBig: { fontSize: 15, lineHeight: 21 },
  scanTextBig: { fontSize: 15 },
  labelBig: { fontSize: 14 },
  scanBtnBig: { minHeight: 48, paddingVertical: 14 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 16 },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: GREY, marginTop: 6, lineHeight: 19 },
  stepsCard: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line,
    borderRadius: 12, padding: 14, marginTop: 14, gap: 10,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumT: { fontFamily: fonts.bold, fontSize: 13, color: '#FFFFFF' },
  stepT: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: '#2B2B2B', lineHeight: 18 },
  scanBox: {
    borderWidth: 1.5, borderColor: colors.navy, borderStyle: 'dashed', borderRadius: 14,
    alignItems: 'center', padding: 20, marginTop: 14, backgroundColor: '#FFFFFF',
  },
  scanGlyph: { fontSize: 40, color: colors.navy },
  scanText: { fontFamily: fonts.medium, fontSize: 13, color: GREY, marginTop: 6 },
  scanBtn: { marginTop: 10, backgroundColor: '#EAF2FF', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  scanBtnT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: '#2B2B2B', marginTop: 18, marginBottom: 8 },
  input: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 10,
    paddingHorizontal: 16, height: 52, fontFamily: fonts.bold, fontSize: 14, color: '#2B2B2B', letterSpacing: 1,
  },
  /** Teks di dalam AppInput: tebal + spasi huruf ala kode terminal. */
  inputText: { fontFamily: fonts.bold, letterSpacing: 1 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: '#D33A3F', marginTop: 8 },
  primary: {
    backgroundColor: colors.orange, borderRadius: 14, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 18,
  },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  primaryIdle: { opacity: 0.6 }, link: { fontFamily: fonts.semibold, fontSize: 13, color: '#D96F00', textAlign: 'center', marginTop: 14 },
  helpCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, marginTop: 12 },
  helpImg: { width: '100%', height: 120, marginBottom: 8 },
  helpT: { fontFamily: fonts.regular, fontSize: 13, color: '#2B2B2B', marginTop: 4, lineHeight: 18 },
  webBtn: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: colors.navy, borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  webBtnT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },});