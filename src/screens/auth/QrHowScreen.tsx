import type { ReactNode } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, fonts, wideCenterSm } from '../../theme';
import { useLang } from '../../lib/i18n';
import ScreenRoot from '../../components/ScreenRoot';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack?: () => void;
};

type Props = { navigation?: Nav };

const BLUE = '#1E88E5';
const HEADER_BLUE = '#1B7FD4';
const TITLE_DARK = '#2B2B2B';
const GREY = '#757575';
const DIVIDER = '#D8D8D8';

/**
 * Layar "Cara mendapatkan QR" - panduan 4 langkah + banner + thumbnail video
 * sesuai capture asli login-qr-how(1-4).png. Video belum bisa diputar offline
 * (butuh stream dari backend), jadi thumbnail tampil statis + penanda jelas.
 */
export default function QrHowScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();

  const goBack = () => {
    if (navigation?.goBack) navigation.goBack();
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={12}>
          <Text style={styles.headerBack}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('g_qrhow_title')}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        showsVerticalScrollIndicator={false}>
        <Image
          source={isTablet
            ? require('../../../assets/images/get_qr_banner_tablet.webp')
            : require('../../../assets/images/get_qr_banner.webp')}
          style={styles.banner}
          resizeMode="contain"
        />

        <Step
          n="1"
          thumb={require('../../../assets/images/get_qr_thumbnail_1.webp')}
          body={(
            <>
              <Text style={styles.stepLead}>
                {t('g_qrhow_visit')} <Text style={styles.link}>erp.esb.co.id</Text>
              </Text>
              <Bullet>
                <Text style={styles.stepText}>{t('g_qrhow_enter')} <Text style={styles.em}>{t('g_qrhow_username')}</Text> {t('g_qrhow_and')} <Text style={styles.em}>{t('g_qrhow_password')}</Text> {t('g_qrhow_yours')}</Text>
              </Bullet>
              <Bullet>
                <Text style={styles.stepText}>{t('g_qrhow_then_click')} <Text style={styles.em}>{t('g_qrhow_signin')}</Text></Text>
              </Bullet>
            </>
          )}
        />

        <Step
          n="2"
          thumb={require('../../../assets/images/get_qr_thumbnail_2.webp')}
          body={(
            <>
              <Text style={styles.stepLead}>{t('g_qrhow_s2_lead')}</Text>
              <Bullet>
                <Text style={styles.stepText}>{t('g_qrhow_tap')} <Text style={styles.em}>{t('g_qrhow_burger')}</Text> <BurgerGlyph /></Text>
              </Bullet>
              <Bullet>
                <Text style={styles.stepText}>{t('g_qrhow_tap_menu')} <Text style={styles.em}>{t('g_qrhow_master')}</Text></Text>
              </Bullet>
            </>
          )}
        />

        <Step
          n="3"
          thumb={require('../../../assets/images/get_qr_thumbnail_3.webp')}
          body={(
            <>
              <Text style={styles.stepLead}>{t('g_qrhow_s3_lead')}</Text>
              <Bullet>
                <Text style={styles.stepText}>{t('g_qrhow_tap')} <Text style={styles.em}>{t('g_qrhow_master_branch')}</Text></Text>
              </Bullet>
              <View style={styles.masterPill}>
                <Text style={styles.masterPillT}>{t('g_qrhow_master_branch')}</Text>
              </View>
            </>
          )}
        />

        <Step
          n="4"
          thumb={require('../../../assets/images/get_qr_thumbnail_4.webp')}
          last
          body={(
            <>
              <Text style={styles.stepLead}>{t('g_qrhow_at_page')} <Text style={styles.em}>{t('g_qrhow_master_branch')}</Text></Text>
              <Bullet>
                <Text style={styles.stepText}>{t('g_qrhow_choose')} <Text style={styles.em}>{t('g_qrhow_branch')}</Text></Text>
              </Bullet>
              <Bullet>
                <Text style={styles.stepText}>{t('g_qrhow_tap')} <Text style={styles.em}>{t('g_qrhow_qr_icon')}</Text></Text>
              </Bullet>
            </>
          )}
        />
      </ScrollView>
    </View>
  );
}

function Step({ n, thumb, body, last }: { n: string; thumb: unknown; body: ReactNode; last?: boolean }) {
  const { t } = useLang();
  return (
    <View>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          // fallback jujur sampai URL video disediakan BE/produk.
          Alert.alert(t('g_qrhow_title'), 'Video tutorial ' + t('dash_not_available'));
        }}>
        <Image source={thumb as never} style={styles.thumb} resizeMode="cover" />
        <View style={styles.playWrap} pointerEvents="none">
          <View style={styles.playCircle}>
            <Text style={styles.playGlyph}>▶</Text>
          </View>
        </View>
      </TouchableOpacity>
      <View style={styles.stepRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeT}>{n}</Text>
        </View>
        <View style={styles.stepBody}>{body}</View>
      </View>
      {!last && <View style={styles.divider} />}
    </View>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <View style={styles.bulletBody}>{children}</View>
    </View>
  );
}

function BurgerGlyph() {
  return (
    <View style={styles.burger}>
      <View style={styles.burgerLine} />
      <View style={styles.burgerLine} />
      <View style={styles.burgerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: HEADER_BLUE, paddingTop: 20, paddingBottom: 16, paddingHorizontal: 16,
  },
  headerBack: { fontSize: 26, color: '#FFFFFF', fontFamily: fonts.bold, paddingRight: 14 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: '#FFFFFF' },
  headerSpacer: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  banner: { width: '100%', height: 150, borderRadius: 16 },
  thumb: { width: '100%', height: 200, borderRadius: 16, marginTop: 20 },
  playWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  playCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  playGlyph: { fontSize: 22, color: BLUE, fontFamily: fonts.bold },
  stepRow: { flexDirection: 'row', marginTop: 16, gap: 12 },
  badge: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: BLUE,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeT: { fontFamily: fonts.bold, fontSize: 18, color: '#FFFFFF' },
  stepBody: { flex: 1 },
  stepLead: { fontFamily: fonts.regular, fontSize: 15, color: TITLE_DARK, lineHeight: 22 },
  stepText: { fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, lineHeight: 21 },
  em: { fontFamily: fonts.bold, fontStyle: 'italic' },
  link: { fontFamily: fonts.bold, fontStyle: 'italic', color: BLUE },
  bulletRow: { flexDirection: 'row', marginTop: 8, gap: 10, alignItems: 'flex-start' },
  bulletDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: BLUE, marginTop: 6 },
  bulletBody: { flex: 1 },
  masterPill: {
    alignSelf: 'flex-start', backgroundColor: '#1B9AAA', borderRadius: 6,
    paddingHorizontal: 22, paddingVertical: 10, marginTop: 10, marginLeft: 20,
  },
  masterPillT: { fontFamily: fonts.semibold, fontSize: 14, color: '#FFFFFF' },
  burger: {
    backgroundColor: '#F1F3F5', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8,
    gap: 3, marginLeft: 6,
  },
  burgerLine: { width: 22, height: 2.5, borderRadius: 1.5, backgroundColor: GREY },
  divider: { borderTopWidth: 1, borderTopColor: DIVIDER, marginTop: 20 },
});
