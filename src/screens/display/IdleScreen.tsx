import { useEffect, useState } from 'react';import { AppState, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';import { DISPLAY_STALE_MS } from '../../lib/display';import { useLang,

type Lang } from '../../lib/i18n';import { getTimezoneShort } from '../../lib/timezone';import { useConnectivity } from '../../hooks/useConnectivity';import { ensureShiftOpen } from '../../lib/shiftGuard';import { initDb, query } from '../../lib/db';import { getBranchId, getTerminal } from '../../config/server';import { getBinding, subscribeSession } from '../../session';import { getDeviceRole, normalizeTag, subscribeDeviceRole, FULL_FEATURE_TAGS, VIEW_TAGS } from '../../lib/deviceRole';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };const PROMO_IMAGES = [
  require('../../../assets/images/application_banner.webp'), require('../../../assets/images/esb_logo_white.webp'), require('../../../assets/images/application_banner.webp'),];/** * Layar idle / display promosi saat kasir tidak dipakai. Ketuk utk kembali order. * Keputusan eksplisit: fullscreen tanpa ScreenHeader by design (display promosi * untuk pelanggan); toggle bahasa kecil di kanan atas untuk operator. * Tata letak meniru customer-display website: bar header (logo + status + jam), * banner promo full-bleed saat idle, kartu sambutan netral bila tanpa promo. *//** Jam kecil di bar header (komponen sendiri agar tick tak me-render ulang * seluruh layar). */
function ClockView({ isTablet }: { isTablet: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    <View style={styles.clockBox}>
      <Text style={[styles.clockText, isTablet && styles.clockTextBig]}>{`${p(now.getHours())}:${p(now.getMinutes())}`}</Text>
    </View>
  );
}export default function IdleScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, setLang, t, isLocked } = useLang(); const [idx, setIdx] = useState(0);
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
  /** D12+EFF-09: refresh hitungan antrean tiap 30 dtk, di-gate online +
   * bound (offline/unbound = lewati query, banner stale yang bicara). M9
   * dipertahankan: '' = unbound (tanpa fallback B001). */
  useEffect(() => {
    let live = true;
    const loadCount = async () => {
      // EFF-09 gate: offline = jangan query (angka lama + penanda stale).
      if (online === false) return;
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
    // C11 EFF-09: skip tick saat background (hemat SQLite wakeups; layar
    // display selalu foreground saat dipakai — AppState gate best-effort).
    const timer = setInterval(() => { try { if (AppState.currentState !== 'active') return; } catch { /* lanjut */ } void loadCount(); }, 30000);
    return () => { live = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);
  /** Notice gerbang shift saat ketuk kembali order (shift tutup → ke layar Shift). */
  const [gateNotice, setGateNotice] = useState('');

  const goCashier = () => {
    void (async () => {
      // GAP-10: kunci view di handler (bukan hanya CTA disembunyikan) — hanya
      // tag fitur-penuh (FULL_FEATURE_TAGS kanonis) lolos ke kasir; view/asing
      // ditolak via notice, tanpa silent fail.
      if (isViewLocked || activeTag === null || !(FULL_FEATURE_TAGS as string[]).includes(activeTag)) { setGateNotice(t('disp_locked_op')); return; }
      if (!(await ensureShiftOpen(navigation, `${t('dash_shift_closed')} - ${t('shf_open_btn')}`, setGateNotice))) return;
      setGateNotice('');
      navigation?.navigate('Cashier');
    })();
  };

  // EFF-09 dievaluasi: rotasi slide 5 dtk DIPERTAHANKAN — animasi UI lokal
  // murni (tanpa network/DB), bukan poll data; bukan bagian anggaran interval.
  const promos = dbPromos.length > 0 ? dbPromos : [{ id: 'shop', title: shopName, desc: t('idle_welcome') }]; useEffect(() => {
    const timer = setInterval(() => setIdx((i) => (i + 1) % promos.length), 5000);
    return () => clearInterval(timer);
  }, [promos.length]);

  const hasPromo = dbPromos.length > 0;
  const promo = promos[idx];

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      {isLocked ? null : (<View style={styles.langWrap}>{(['id', 'en'] as Lang[]).map((l) => (<TouchableOpacity key={l} onPress={() => setLang(l)} style={[styles.langBtn, lang === l && styles.langBtnOn]}><Text style={[styles.langT, lang === l && styles.langTOn]}>{l.toUpperCase()}</Text></TouchableOpacity> ))}</View>)}{online === false ? (
      <View style={styles.offlineBanner}>
        <Text style={styles.offlineBannerText}>{t('disp_offline_banner')}</Text>
      </View>
      ) : null}{branchUnbound ? (
      <View style={styles.offlineBanner}>
        <Text style={styles.offlineBannerText}>{t('terminal_unbound_hint')}</Text>
      </View>
      ) : null}<View style={styles.header}>
        <View style={styles.logoBox}>
          <Image source={require('../../../assets/genfity-logo-dark.png')} style={styles.logoBoxImg} resizeMode="contain" />
        </View>
        <View style={styles.headerTitle}>
          <Text style={[styles.headerShop, isTablet && styles.headerShopBig]} numberOfLines={1}>{shopName}</Text>
          <View style={[styles.pill, online === false && styles.pillOff]}>
            <View style={[styles.pillDot, online === false ? styles.pillDotOff : styles.pillDotOn]} />
            <Text style={[styles.pillText, online === false ? styles.pillTextOff : styles.pillTextOn]}>{online === false ? t('idle_status_offline') : t('idle_status_live')}</Text>
          </View>
        </View>
        <ClockView isTablet={isTablet} />
      </View>
      {hasPromo ? (
      <View style={[styles.promoHero, isTablet && styles.promoHeroTablet]}>
        <Image source={PROMO_IMAGES[idx % PROMO_IMAGES.length]} style={styles.promoBanner} resizeMode="cover" />
        <View style={styles.promoOverlay}>
          <Text style={[styles.promoTitleOver, isTablet && styles.promoTitleOverBig]} numberOfLines={2}>{promo.title}</Text>
          <Text style={[styles.promoDescOver, isTablet && styles.promoDescOverBig]} numberOfLines={2}>{promo.desc}</Text>
          <View style={styles.dotsOver}>
            {promos.map((p, i) => (
              <TouchableOpacity key={p.id} onPress={() => setIdx(i)} style={[styles.dot, i === idx && styles.dotActive]} />
            ))}
          </View>
        </View>
      </View>
      ) : (
      <View style={styles.welcomeCard}>
        <Text style={[styles.welcomeShop, isTablet && styles.welcomeShopBig]}>{shopName}</Text>
        <Text style={[styles.welcomeSub, isTablet && styles.welcomeSubBig]}>{t('idle_welcome')}</Text>
      </View>
      )}
      <View style={styles.infoRow}>
        <View style={[styles.infoBox, isTablet && styles.infoBoxTablet]}>
          <Text style={[styles.infoTitle, isTablet && styles.infoTitleBig]}>{t('idle_hours')}</Text>
          <Text style={[styles.infoSub, isTablet && styles.infoSubBig]}>{t('idle_hours_val').replace('{tz}', getTimezoneShort())}</Text>
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
  langWrap: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }, langBtn: { borderWidth: 1, borderColor: colors.navy, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.navy }, langBtnOn: { backgroundColor: colors.white, borderColor: colors.white }, langT: { fontFamily: fonts.bold, fontSize: 11, color: colors.navyTint }, langTOn: { color: colors.navy }, header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, backgroundColor: colors.navy, borderRadius: 14, padding: 10 },
  headerTitle: { flex: 1, minWidth: 0 },
  headerShop: { fontFamily: fonts.bold, fontSize: 17, color: colors.white },
  headerShopBig: { fontSize: 22 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.green, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillOff: { borderColor: colors.red },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillDotOn: { backgroundColor: colors.green },
  pillDotOff: { backgroundColor: colors.red },
  pillText: { fontFamily: fonts.bold, fontSize: 11 },
  pillTextOn: { color: colors.green },
  pillTextOff: { color: colors.red },
  clockBox: { backgroundColor: colors.navyDark, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  clockText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  clockTextBig: { fontSize: 17 },
  logoBox: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoBoxImg: { width: 36, height: 36 },
  welcomeCard: { backgroundColor: colors.navy, borderRadius: 16, padding: 28, marginTop: 12, alignItems: 'center' },
  welcomeShop: { fontFamily: fonts.bold, fontSize: 26, color: colors.white, textAlign: 'center' },
  welcomeShopBig: { fontSize: 34 },
  welcomeSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.navyTint, marginTop: 6, textAlign: 'center' },
  welcomeSubBig: { fontSize: 16 },
  promoHero: { height: 220, borderRadius: 16, overflow: 'hidden', marginTop: 12, backgroundColor: colors.navy },
  /* Tablet: banner promo lebih tinggi agar mengisi layar display. */
  promoHeroTablet: { height: 320 },
  promoBanner: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  promoOverlay: { flex: 1, justifyContent: 'flex-end', padding: 14, backgroundColor: 'rgba(0,0,0,0.35)' },
  promoTitleOver: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  promoTitleOverBig: { fontSize: 26 },
  promoDescOver: { fontFamily: fonts.regular, fontSize: 13, color: colors.white, marginTop: 2, opacity: 0.9 },
  promoDescOverBig: { fontSize: 15 },
  dotsOver: { flexDirection: 'row', gap: 8, marginTop: 10 },
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