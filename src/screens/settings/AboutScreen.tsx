import { useEffect, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';import { useLang } from '../../lib/i18n';import { getBranchId, getServerEnv, getTerminal } from '../../config/server';import { initDb, query } from '../../lib/db';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };export default function AboutScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;

  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false);
  // Identitas live: cabang + terminal dari klaim terminal, printer dari
  // ms_station aktif; '-' jujur bila belum ada (tanpa contoh Poris/TRM-001).
  // M9: '' = unbound (tanpa fallback B001); label unbound di bawah.
  let branchId = '';
  let branchName = '';
  let terminalCode = '';
  let serverEnv = '';
  try { branchId = getBranchId(); } catch { /* default */ }
  try {
    const term = getTerminal();
    branchName = (term.branchName ?? '').trim();
    terminalCode = (term.terminalCode ?? '').trim();
    if ((term.branchId ?? '').trim()) branchId = term.branchId.trim();
  } catch { /* default */ }
  try { serverEnv = getServerEnv(); } catch { /* label i18n */ }
  const branchLabel = branchName ? `${branchName} - ${branchId}` : (branchId || t('terminal_unbound_title'));
  const [printerLabel, setPrinterLabel] = useState('-');
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        await initDb();
        const rows = await query<{ stationName: string | null }>(
          'SELECT stationName FROM ms_station WHERE flagActive = 1 ORDER BY flagDefault DESC LIMIT 3',
        );
        if (!on) return;
        const names = rows.map((r) => (r.stationName ?? '').trim()).filter(Boolean);
        if (names.length > 0) setPrinterLabel(names.join(' · '));
      } catch { /* '-' jujur */ }
    })();
    return () => { on = false; };
  }, []); const go = (route: string) => navigation?.navigate(route); return (
    <View style={styles.root}>
      <ScreenHeader title={t('settings.about')} left={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
          <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
        </TouchableOpacity>
      } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <View style={styles.hero}>{/* Tablet: hero full-bleed, isi dibatasi 1024. */}<View style={isTablet ? styles.heroInner : undefined}>
        <Image source={require('../../../assets/genfity-logo-dark.png')} style={styles.logo} resizeMode="contain" />
        <Text style={[styles.appName, isTablet && { fontSize: 26 }]}>Genfity Order</Text>
        <Text style={styles.version}>{t('about.version')}</Text>
        <Text style={styles.heroSub}>{t('about.heroSub')}</Text>
        </View>
      </View>
      <View style={isTablet ? wideCenterLg : undefined}>
      <View style={styles.card}>
        <Row label={t('about.package')} value="Genfity Order (Expo RN)" />
        <Row label={t('about.branch')} value={branchLabel} />
        <Row label={t('about.terminal')} value={terminalCode || '-'} />
        <Row label={t('about.env')} value={serverEnv || t('about.envVal')} />
        <Row label={t('about.printer')} value={printerLabel} />
      </View>
      <View style={styles.card}>
        <Text style={[styles.cardTitle, isTablet && { fontSize: 17 }]}>{t('about.title')}</Text>
        <Text style={[styles.cardText, isTablet && { fontSize: 14 }]}>{t('about.body')}</Text>
      </View>
      <Text style={styles.foot}>{t('about.foot')}</Text>
      </View>
      </ScrollView>
    </View>
  );}function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );}const styles = StyleSheet.create({
  burger: { width: 22, height: 22 },
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { paddingBottom: 32 },
  hero: { backgroundColor: colors.navy, paddingTop: 24, paddingBottom: 24, paddingHorizontal: 16, alignItems: 'center' },
  // Tablet: isi hero ditengahkan max 1024 walau hero full-bleed (phone tak tersentuh).
  heroInner: { width: '100%', maxWidth: 1024, alignSelf: 'center', alignItems: 'center' },
  logo: { width: 120, height: 60 },
  appName: { fontFamily: fonts.bold, fontSize: 22, color: colors.white, marginTop: 10 },
  version: { fontFamily: fonts.medium, fontSize: 13, color: colors.orange, marginTop: 4 },
  heroSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4, textAlign: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  cardText: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  rowValue: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 16 },});