import { useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';import { useLang } from '../../lib/i18n';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };export default function AboutScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;

  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const go = (route: string) => navigation?.navigate(route); return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <ScreenHeader title={t('settings.about')} left={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
          <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
        </TouchableOpacity>
      } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} /><View style={styles.hero}>{/* Tablet: hero full-bleed, isi dibatasi 560. */}<View style={isTablet ? styles.heroInner : undefined}>
        <Image source={require('../../../assets/images/esb_logo_white.webp')} style={styles.logo} resizeMode="contain" />
        <Text style={[styles.appName, isTablet && { fontSize: 26 }]}>Genfity Order</Text>
        <Text style={styles.version}>{t('about.version')}</Text>
        <Text style={styles.heroSub}>{t('about.heroSub')}</Text>
        </View>
      </View>
      <View style={isTablet ? wideCenterSm : undefined}>
      <View style={styles.card}>
        <Row label={t('about.package')} value="Genfity Order (Expo RN)" />
        <Row label={t('about.branch')} value="Genfity Cabang Poris - BR-01" />
        <Row label={t('about.terminal')} value="TRM-001" />
        <Row label={t('about.env')} value={t('about.envVal')} />
        <Row label={t('about.printer')} value="BT SPP - LAN - Star" />
      </View>
      <View style={styles.card}>
        <Text style={[styles.cardTitle, isTablet && { fontSize: 17 }]}>{t('about.title')}</Text>
        <Text style={[styles.cardText, isTablet && { fontSize: 14 }]}>{t('about.body')}</Text>
      </View>
      <Text style={styles.foot}>{t('about.foot')}</Text>
      </View>
    </ScrollView>
  );}function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );}const styles = StyleSheet.create({
  burger: { width: 22, height: 22 },
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },
  hero: { backgroundColor: colors.navy, paddingTop: 24, paddingBottom: 24, paddingHorizontal: 16, alignItems: 'center' },
  // Tablet: isi hero ditengahkan max 560 walau hero full-bleed (phone tak tersentuh).
  heroInner: { width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center' },
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