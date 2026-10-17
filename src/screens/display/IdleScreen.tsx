import { useEffect, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';import { DISPLAY_STALE_MS } from '../../lib/display';import { useLang,

type Lang } from '../../lib/i18n';import { useConnectivity } from '../../hooks/useConnectivity';import { ensureShiftOpen } from '../../lib/shiftGuard';import { initDb, query } from '../../lib/db';import { getBranchId, getTerminal } from '../../config/server';import { getBinding, subscribeSession } from '../../session';import { getDeviceRole, normalizeTag, subscribeDeviceRole, VIEW_TAGS } from '../../lib/deviceRole';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };const PROMO_IMAGES = [
  require('../../../assets/images/application_banner.webp'), require('../../../assets/images/esb_logo_white.webp'), require('../../../assets/images/application_banner.webp'),];/** * Layar idle / display promosi saat kasir tidak dipakai. Ketuk utk kembali order. * Keputusan eksplisit: fullscreen tanpa ScreenHeader by design (display promosi * untuk pelanggan); toggle bahasa kecil di kanan atas untuk operator. */export default function IdleScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, setLang, t } = useLang(); const [idx, setIdx] = useState(0);
  /** APP-EVENTS (§11.4): sadar konektivitas — banner offline + penanda stale. */
  const { online } = useConnectivity();
  // Display-lock SPEC §10: kedua tag view terkunci = tanpa entri kasir.
  // CTA kembali-order hanya untuk profil full (kasir/dapur/full_access).
  const [, setTagTick] = useState(0);
  useEffect(() => {
    const un1 = subscribeSession(() => setTagTick((x) => x + 1));
    const un2 = subscribeDeviceRole(() => setTagTick((x) => x + 1));
    return () => {
      un1();
      un2();
    };
  }, []);
  const boundTag = (() => {
    try {
      return normalizeTag(getBinding()?.tag);
    } catch {
      return null;
    }
  })();
  const activeTag = boundTag ?? normalizeTag(getDeviceRole());
  const isViewLocked = activeTag !== null && (VIEW_TAGS as string[]).includes(activeTag);
  /** M9: '' = unbound (tanpa fallback B001) — banner jujur + hitungan dilewati. */
  const branchUnbound = (() => {
    try {
      return !getBranchId();
    } catch {
      return true;
    }
  })();
  /** Nama cabang live dari klaim terminal; fallback label generik. */
  const shopName = (() => {
    try {
      const b = (getTerminal().branchName ?? '').trim();
      return b || t('disp_shop');
    } catch { return t('disp_shop'); }
  })();
  /** Order terbuka cabang ini (live, bukan angka contoh). */
  const [openCount, setOpenCount] = useState(0);
  /** Waktu hitungan antrean terakhir (penanda stale saat offline). */
  const [countAt, setCountAt] = useState<number | null>(null);
  /** SSID Wi-Fi hanya bila merchant mengaturnya di ms_setting; bila tak ada,
   * kotak Wi-Fi disembunyikan (tanpa SSID contoh). */
  const [wifiSsid, setWifiSsid] = useState('');
  /** Promo live dari ms_promotion (aktif + berlaku hari ini); kosong = slide netral toko. */
  const [dbPromos, setDbPromos] = useState<Array<{ id: string; title: string; desc: string }>>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await initDb();
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        const now = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        const rows = await query<{ promoCode: string | null; promoName: string | null }>(
          `SELECT promoCode, promoName FROM ms_promotion WHERE flagActive = 1 AND (validFrom IS NULL OR validFrom = '' OR validFrom <= ?) AND (validTo IS NULL OR validTo = '' OR validTo >= ?) ORDER BY promoCode LIMIT 6`,
          [now, now],
        );
        if (!live) return;
        setDbPromos(
          rows
            .filter((r) => ((r.promoName ?? r.promoCode ?? '') as string).trim())
            .map((r) => ({ id: String(r.promoCode ?? r.promoName), title: String(r.promoCode ?? ''), desc: String(r.promoName ?? '') })),
        );
      } catch { /* tanpa promo — slide netral toko dipakai */ }
      // D12: hitungan antrean pindah ke efek interval 30 dtk di bawah
      // (efek ini hanya muat awal: promo + wifi).
      try {
        const ws = await query<{ value1: string | null }>(
          `SELECT value1 FROM ms_setting WHERE key1 = 'Network' AND key2 = 'WifiSsid' LIMIT 1`,
        );
        if (live) setWifiSsid((ws[0]?.value1 ?? '').trim());
      } catch { /* tanpa SSID — kotak disembunyikan */ }
    })();
    return () => { live = false; };
  }, []);
  /** D12: refresh hitungan antrean tiap 30 dtk. M9 dipertahankan: '' =
   * unbound (tanpa fallback B001) — hitungan dilewati agar tak menampilkan
   * antrean cabang lain; banner unbound tampil di bawah. */
  useEffect(() => {
    let live = true;
    const loadCount = async () => {
      try {
        let branchId = '';
        try { branchId = getBranchId(); } catch { branchId = ''; }
        if (!branchId) return;
        const cnt = await query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM tr_saleshead WHERE (status IS NULL OR status <> 'paid') AND branchId = ?`,
          [branchId],
        );
        if (live) {
          setOpenCount(Number(cnt[0]?.n) || 0);
          setCountAt(Date.now());
        }
      } catch { /* hitungan opsional */ }
    };
    void loadCount();
    const timer = setInterval(() => { void loadCount(); }, 30000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  /** Notice gerbang shift saat ketuk kembali order (shift tutup → ke layar Shift). */
  const [gateNotice, setGateNotice] = useState('');

  const goCashier = () => {
    void (async () => {
      if (!(await ensureShiftOpen(navigation, `${t('dash_shift_closed')} - ${t('shf_open_btn')}`, setGateNotice))) return;
      setGateNotice('');
      navigation?.navigate('Cashier');
    })();
  };

  const promos = dbPromos.length > 0 ? dbPromos : [{ id: 'shop', title: shopName, desc: t('idle_welcome') }]; useEffect(() => {
    const timer = setInterval(() => setIdx((i) => (i + 1) % promos.length), 5000);
    return () => clearInterval(timer);
  }, [promos.length]);

  const promo = promos[idx];

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.langWrap}>{(['id', 'en'] as Lang[]).map((l) => (<TouchableOpacity key={l} onPress={() => setLang(l)} style={[styles.langBtn, lang === l && styles.langBtnOn]}><Text style={[styles.langT, lang === l && styles.langTOn]}>{l.toUpperCase()}</Text></TouchableOpacity> ))}</View>{online === false ? (
      <View style={styles.offlineBanner}>
        <Text style={styles.offlineBannerText}>{t('disp_offline_banner')}</Text>
      </View>
      ) : null}{branchUnbound ? (
      <View style={styles.offlineBanner}>
        <Text style={styles.offlineBannerText}>{t('terminal_unbound_hint')}</Text>
      </View>
      ) : null}<View style={styles.hero}>
        <Image source={require('../../../assets/images/esb_logo_white.webp')} style={[styles.logo, isTablet && styles.logoTablet]} resizeMode="contain" />
        <Text style={[styles.shop, isTablet && styles.shopBig]}>{shopName}</Text>
        <Text style={[styles.heroSub, isTablet && styles.heroSubBig]}>{t('idle_welcome')}</Text>
      </View>
      <View style={styles.promoCard}>
        <Image source={PROMO_IMAGES[idx % PROMO_IMAGES.length]} style={[styles.promoImg, isTablet && styles.promoImgTablet]} resizeMode="contain" />
        <Text style={[styles.promoTitle, isTablet && styles.promoTitleBig]}>{promo.title}</Text>
        <Text style={[styles.promoDesc, isTablet && styles.promoDescBig]}>{promo.desc}</Text>
        <View style={styles.dots}>
          {promos.map((p, i) => (
            <TouchableOpacity key={p.id} onPress={() => setIdx(i)} style={[styles.dot, i === idx && styles.dotActive]} />
          ))}
        </View>
      </View>
      <View style={styles.infoRow}>
        <View style={[styles.infoBox, isTablet && styles.infoBoxTablet]}>
          <Text style={[styles.infoTitle, isTablet && styles.infoTitleBig]}>{t('idle_hours')}</Text>
          <Text style={[styles.infoSub, isTablet && styles.infoSubBig]}>{t('idle_hours_val')}</Text>
        </View>
        {wifiSsid ? (
          <View style={[styles.infoBox, isTablet && styles.infoBoxTablet]}>
            <Text style={[styles.infoTitle, isTablet && styles.infoTitleBig]}>{t('idle_wifi')}</Text>
            <Text style={[styles.infoSub, isTablet && styles.infoSubBig]}>{wifiSsid}</Text>
          </View>
        ) : null}
        <View style={[styles.infoBox, isTablet && styles.infoBoxTablet]}>
          <Text style={[styles.infoTitle, isTablet && styles.infoTitleBig]}>{t('idle_queue')}</Text>
          <Text style={[styles.infoSub, isTablet && styles.infoSubBig]}>{openCount} {t('idle_queue_suffix')}</Text>
        </View>
      </View>
      {countAt !== null && (online === false || Date.now() - countAt > DISPLAY_STALE_MS) ? (
        <Text style={styles.staleText}>{t('idle_stale_queue')}</Text>
      ) : null}
      {isViewLocked ? null : (
      <TouchableOpacity style={styles.cta} onPress={goCashier}>
        <Text style={[styles.ctaText, isTablet && styles.ctaTextBig]}>{t('idle_cta')}</Text>
      </TouchableOpacity>
      )}
      <Text style={styles.hint}>{t('idle_hint')}</Text>
      {gateNotice ? <Text style={[styles.hint, { color: colors.red }]}>{gateNotice}</Text> : null}
    </ScrollView>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navyDark },
  body: { padding: 16, paddingBottom: 40 },
  langWrap: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }, langBtn: { borderWidth: 1, borderColor: colors.navy, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.navy }, langBtnOn: { backgroundColor: colors.white, borderColor: colors.white }, langT: { fontFamily: fonts.bold, fontSize: 11, color: colors.navyTint }, langTOn: { color: colors.navy }, hero: { alignItems: 'center', marginTop: 20 },
  logo: { width: 130, height: 64 },
  /* Tablet: logo lebih besar agar terbaca dari jauh. */
  logoTablet: { width: 180, height: 88 },
  shop: { fontFamily: fonts.bold, fontSize: 24, color: colors.white, marginTop: 8, textAlign: 'center' },
  shopBig: { fontSize: 36 }, heroSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.navyTint, marginTop: 4, textAlign: 'center' },
  heroSubBig: { fontSize: 16 }, promoCard: { backgroundColor: colors.white, borderRadius: 16, padding: 18, marginTop: 20, alignItems: 'center' },
  promoImg: { width: '100%', height: 150 },
  /* Tablet: gambar promo lebih tinggi agar mengisi layar display. */
  promoImgTablet: { height: 240 },
  promoTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 12, textAlign: 'center' },
  promoTitleBig: { fontSize: 24 }, promoDesc: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginTop: 4, textAlign: 'center' },
  promoDescBig: { fontSize: 16 }, dots: { flexDirection: 'row', gap: 8, marginTop: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.line },
  dotActive: { backgroundColor: colors.orange },
  infoRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  infoBox: { flex: 1, backgroundColor: colors.navy, borderRadius: 12, padding: 12, alignItems: 'center' },
  /* Tablet: kotak info lebih lega di layar display pelanggan. */
  infoBoxTablet: { padding: 16 },
  infoTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  infoTitleBig: { fontSize: 15 },
  infoSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 2, textAlign: 'center' },
  infoSubBig: { fontSize: 13 }, cta: { backgroundColor: colors.orange, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  ctaText: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  ctaTextBig: { fontSize: 18 }, offlineBanner: { backgroundColor: colors.red, borderRadius: 10, padding: 10, marginTop: 8, alignItems: 'center' },
  offlineBannerText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white, textAlign: 'center' },
  staleText: { fontFamily: fonts.medium, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 6 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 10 },});