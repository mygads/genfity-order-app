import { useState } from 'react';import { Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, wideCenter } from '../../theme';import { useLang } from '../../lib/i18n';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };/** 8 FAQ lewat key kamus (help_faqN_q/a) agar ikut bahasa aktif. */const FAQS: { q: string; a: string }[] = [
  { q: 'help_faq1_q', a: 'help_faq1_a' },
  { q: 'help_faq2_q', a: 'help_faq2_a' },
  { q: 'help_faq3_q', a: 'help_faq3_a' },
  { q: 'help_faq4_q', a: 'help_faq4_a' },
  { q: 'help_faq5_q', a: 'help_faq5_a' },
  { q: 'help_faq6_q', a: 'help_faq6_a' },
  { q: 'help_faq7_q', a: 'help_faq7_a' },
  { q: 'help_faq8_q', a: 'help_faq8_a' },
];export default function HelpScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [open, setOpen] = useState<number | null>(0);

  const go = (route: string) => navigation?.navigate(route); return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <ScreenHeader title={t('help.title')} sub={t('help.sub')} left={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
          <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
        </TouchableOpacity>
      } /> <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <View key={f.q} style={styles.card}>
            <Pressable onPress={() => setOpen(isOpen ? null : i)} style={styles.qRow}>
              <Text style={[styles.q, isTablet && { fontSize: 16 }]}>{t(f.q)}</Text>
              <Text style={styles.chev}>{isOpen ? '-' : '+'}</Text>
            </Pressable>
            {isOpen ? <Text style={[styles.a, isTablet && { fontSize: 14 }]}>{t(f.a)}</Text> : null}
          </View>
        );
      })}
      <View style={styles.card}>
        <Text style={styles.q}>{t('help.more')}</Text>
        <Text style={styles.a}>{t('help.contact')}</Text>
      </View>
    </ScrollView>
  );}const styles = StyleSheet.create({
  burger: { width: 22, height: 22 },
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  qRow: { flexDirection: 'row', alignItems: 'center' },
  q: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.navy, paddingRight: 8 },
  chev: { fontFamily: fonts.bold, fontSize: 16, color: colors.faint },
  a: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 8 },});