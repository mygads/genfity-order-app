import { useEffect, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import { useLang,

type Lang } from '../../lib/i18n';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };const PROMO_DISCOUNT = 5000;const PROMO_PACK_PRICE = 55000;const PROMO_IMAGES = [
  require('../../../assets/images/application_banner.webp'), require('../../../assets/images/esb_logo_white.webp'), require('../../../assets/images/application_banner.webp'),];/** * Layar idle / display promosi saat kasir tidak dipakai. Ketuk utk kembali order. * Keputusan eksplisit: fullscreen tanpa ScreenHeader by design (display promosi * untuk pelanggan); toggle bahasa kecil di kanan atas untuk operator. */export default function IdleScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, setLang, t } = useLang(); const [idx, setIdx] = useState(0);

  const promos = [ { id: 'p1', title: t('idle_promo1_title'), desc: `${t('idle_promo1_pre')}${rp(PROMO_DISCOUNT)}${t('idle_promo1_post')}` }, { id: 'p2', title: t('idle_promo2_title'), desc: `${t('idle_promo2_pre')}${rp(PROMO_PACK_PRICE)}` }, { id: 'p3', title: t('idle_promo3_title'), desc: t('idle_promo3_desc') }, ]; useEffect(() => {
    const timer = setInterval(() => setIdx((i) => (i + 1) % promos.length), 5000);
    return () => clearInterval(timer);
  }, [promos.length]);

  const promo = promos[idx];

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.langWrap}> {(['id', 'en'] as Lang[]).map((l) => ( <TouchableOpacity key={l} onPress={() => setLang(l)} style={[styles.langBtn, lang === l && styles.langBtnOn]}> <Text style={[styles.langT, lang === l && styles.langTOn]}>{l.toUpperCase()}</Text> </TouchableOpacity> ))} </View> <View style={styles.hero}>
        <Image source={require('../../../assets/images/esb_logo_white.webp')} style={styles.logo} resizeMode="contain" />
        <Text style={[styles.shop, isTablet && styles.shopBig]}>{t('disp_shop')}</Text>
        <Text style={[styles.heroSub, isTablet && styles.heroSubBig]}>{t('idle_welcome')}</Text>
      </View>
      <View style={styles.promoCard}>
        <Image source={PROMO_IMAGES[idx]} style={styles.promoImg} resizeMode="contain" />
        <Text style={[styles.promoTitle, isTablet && styles.promoTitleBig]}>{promo.title}</Text>
        <Text style={[styles.promoDesc, isTablet && styles.promoDescBig]}>{promo.desc}</Text>
        <View style={styles.dots}>
          {promos.map((p, i) => (
            <TouchableOpacity key={p.id} onPress={() => setIdx(i)} style={[styles.dot, i === idx && styles.dotActive]} />
          ))}
        </View>
      </View>
      <View style={styles.infoRow}>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>{t('idle_hours')}</Text>
          <Text style={[styles.infoSub, isTablet && styles.infoSubBig]}>{t('idle_hours_val')}</Text>
        </View>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>{t('idle_wifi')}</Text>
          <Text style={[styles.infoSub, isTablet && styles.infoSubBig]}>ESB-PORIS</Text>
        </View>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>{t('idle_queue')}</Text>
          <Text style={[styles.infoSub, isTablet && styles.infoSubBig]}>{t('idle_queue_val')}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.cta} onPress={() => navigation?.navigate('Cashier')}>
        <Text style={[styles.ctaText, isTablet && styles.ctaTextBig]}>{t('idle_cta')}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>{t('idle_hint')}</Text>
    </ScrollView>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navyDark },
  body: { padding: 16, paddingBottom: 40 },
  langWrap: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }, langBtn: { borderWidth: 1, borderColor: colors.navy, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.navy }, langBtnOn: { backgroundColor: colors.white, borderColor: colors.white }, langT: { fontFamily: fonts.bold, fontSize: 11, color: colors.navyTint }, langTOn: { color: colors.navy }, hero: { alignItems: 'center', marginTop: 20 },
  logo: { width: 130, height: 64 },
  shop: { fontFamily: fonts.bold, fontSize: 24, color: colors.white, marginTop: 8, textAlign: 'center' },
  shopBig: { fontSize: 30 }, heroSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.navyTint, marginTop: 4, textAlign: 'center' },
  heroSubBig: { fontSize: 16 }, promoCard: { backgroundColor: colors.white, borderRadius: 16, padding: 18, marginTop: 20, alignItems: 'center' },
  promoImg: { width: '100%', height: 150 },
  promoTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 12, textAlign: 'center' },
  promoTitleBig: { fontSize: 24 }, promoDesc: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginTop: 4, textAlign: 'center' },
  promoDescBig: { fontSize: 16 }, dots: { flexDirection: 'row', gap: 8, marginTop: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.line },
  dotActive: { backgroundColor: colors.orange },
  infoRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  infoBox: { flex: 1, backgroundColor: colors.navy, borderRadius: 12, padding: 12, alignItems: 'center' },
  infoTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  infoSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 2, textAlign: 'center' },
  infoSubBig: { fontSize: 13 }, cta: { backgroundColor: colors.orange, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  ctaText: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  ctaTextBig: { fontSize: 18 }, hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 10 },});