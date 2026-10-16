import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, fonts, wideCenterSm } from '../../theme';
import { useLang } from '../../lib/i18n';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };

const NAVY = '#16215E';
const BLUE = '#1E88E5';
const ORANGE = '#F5820D';
const GREY = '#757575';
const BORDER = '#E0E0E0';
const DOT_OFF = '#D5D5D5';

const PAGES = [
  {
    img: require('../../../assets/images/scan_illustration.webp'),
    titleKey: 'g_intro_p1_title',
    descKey: 'g_intro_p1_desc',
  },
  {
    img: require('../../../assets/images/application_banner_phone.webp'),
    titleKey: 'g_intro_p2_title',
    descKey: 'g_intro_p2_desc',
  },
  {
    img: require('../../../assets/images/application_banner.webp'),
    titleKey: 'g_intro_p3_title',
    descKey: 'g_intro_p3_desc',
  },
  {
    img: require('../../../assets/images/claim_terminal.webp'),
    titleKey: 'g_intro_p4_title',
    descKey: 'g_intro_p4_desc',
  },
];

export default function IntroScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        showsVerticalScrollIndicator={false}>
        <Image
          source={require('../../../assets/images/esb_logo.webp')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Image source={PAGES[page].img} style={styles.hero} resizeMode="contain" />
        <Text style={styles.title}>{t(PAGES[page].titleKey)}</Text>
        <Text style={styles.desc}>{t(PAGES[page].descKey)}</Text>
        <View style={styles.spacer} />
        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => setPage(i)} hitSlop={8}>
              <View style={[styles.dot, i === page && styles.dotOn]} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={[styles.footer, isTablet && wideCenterSm]}>
        {last ? (
          <>
            <TouchableOpacity
              style={styles.outline}
              onPress={() => navigation?.navigate('Install')}>
              <Text style={styles.outlineT}>{t('g_intro_create')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primary}
              onPress={() => navigation?.navigate('Login')}>
              <Text style={styles.primaryT}>{t('g_intro_login')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.primary}
            onPress={() => setPage((p) => Math.min(p + 1, PAGES.length - 1))}>
            <Text style={styles.primaryT}>{t('g_intro_next')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 16, alignItems: 'center', flexGrow: 1 },
  logo: { width: 210, height: 72 },
  hero: { width: '100%', height: 230, marginTop: 28 },
  title: { fontFamily: fonts.bold, fontSize: 24, color: BLUE, textAlign: 'center', marginTop: 32 },
  desc: {
    fontFamily: fonts.regular, fontSize: 14, color: GREY,
    textAlign: 'center', marginTop: 12, lineHeight: 22, paddingHorizontal: 4,
  },
  spacer: { flex: 1, minHeight: 40 },
  dots: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: DOT_OFF },
  dotOn: { width: 26, backgroundColor: ORANGE },
  footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 28, gap: 12, backgroundColor: '#FFFFFF' },
  primary: {
    backgroundColor: ORANGE, borderRadius: 26, height: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  outline: {
    borderWidth: 1.5, borderColor: BLUE, borderRadius: 26, height: 52,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
  },
  outlineT: { fontFamily: fonts.bold, fontSize: 16, color: BLUE },
  skip: { fontFamily: fonts.medium, fontSize: 14, color: GREY, textAlign: 'center', paddingVertical: 8 },
});
