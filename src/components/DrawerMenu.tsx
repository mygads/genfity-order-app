import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../theme';
import { logout } from '../session';
import { useLang } from '../lib/i18n';

interface DrawerItem {
  label: string;
  sub: string;
  route: string;
}

// Isi drawer = menu /home APK asli (Lampiran A dossier):
// order, table, booking, shift, sales-history, detail-recap, esb-order-dashboard,
// member, expense, petty-cash, settings.
// Label diisi di dalam komponen via t() agar siap EN dan ID.

interface Props {
  visible: boolean;
  onClose: () => void;
  navigate: (screen: string) => void;
  outlet?: string;
  user?: string;
}

export default function DrawerMenu({ visible, onClose, navigate, outlet, user }: Props) {
  const { lang, setLang, t } = useLang();
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  // Drawer Android asli meluncur dari KIRI - samakan (sebelumnya panel di kanan).
  // Lebar adaptif: 300 phone, 340 tablet.
  const drawerW = isTablet ? 340 : 300;
  // Satu nilai progress (0 tertutup → 1 terbuka) menggerakkan panel DAN scrim
  // sekaligus, jadi keduanya selalu sinkron dalam satu clock animasi.
  // Modal sendiri pakai animationType="none" agar tidak ada animasi fade ganda.
  const progress = useRef(new Animated.Value(0)).current;
  // Tetap me-mount selama animasi tutup berjalan, baru unmount setelah selesai.
  const [rendered, setRendered] = useState(visible);
  useEffect(() => {
    let anim: Animated.CompositeAnimation | undefined;
    if (visible) {
      setRendered(true);
      anim = Animated.timing(progress, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      anim.start();
    } else if (rendered) {
      anim = Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      });
      anim.start(({ finished }) => {
        // finished=false berarti animasi disela (mis. dibuka lagi dengan cepat):
        // jangan unmount agar reversal berjalan mulus dari posisi saat ini.
        if (finished) setRendered(false);
      });
    }
    // Hentikan animasi sebelumnya saat toggle cepat → tidak ada flicker/tumpuk.
    return () => anim?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, progress]);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-drawerW, 0] });
  const scrimOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] });
  if (!rendered) return null;
  const ITEMS: DrawerItem[] = [
    { label: t('nav_order'), sub: t('nav_cashier'), route: 'Cashier' },
    { label: t('nav_tables'), sub: t('nav_layout_sub'), route: 'Tables' },
    { label: t('nav_shift'), sub: t('nav_shift_sub'), route: 'Shift' },
    { label: t('nav_history'), sub: t('nav_history_sub'), route: 'History' },
    { label: t('nav_recap'), sub: t('nav_recap_sub'), route: 'Recap' },
    { label: t('nav_esb'), sub: t('nav_online_orders'), route: 'EsbOrder' },
    { label: t('nav_member'), sub: t('nav_member_sub'), route: 'Member' },
    { label: t('nav_expense'), sub: t('nav_expense_sub'), route: 'Expense' },
    { label: t('nav_petty'), sub: t('nav_petty_sub'), route: 'PettyCash' },
    { label: t('nav_settings'), sub: t('nav_settings_sub'), route: 'Settings' },
  ];
  const go = (route: string) => {
    onClose();
    navigate(route);
  };
  return (
    <Modal visible={rendered} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.panel, { width: drawerW, transform: [{ translateX }] }]}>
          <View style={styles.head}>
            <Text style={[styles.outlet, isTablet && styles.outletTablet]}>{outlet ?? 'ESB Cabang Poris'}</Text>
            <View style={styles.shiftRow}>
              <View style={styles.shiftDot} />
              <Text style={styles.shiftText}>{user ?? t('drawer_demo_user')}</Text>
            </View>
          </View>
          {ITEMS.map((m) => (
            <Pressable key={m.route} style={styles.row} onPress={() => go(m.route)}>
              <View style={styles.rowLeft}>
                <Text style={styles.rowLabel}>{m.label}</Text>
                <Text style={styles.rowSub}>{m.sub}</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))}
          <View style={styles.langRow}>
            {(['id', 'en'] as const).map((l) => (
              <Pressable
                key={l}
                style={[styles.langBtn, lang === l && styles.langBtnOn]}
                onPress={() => setLang(l)}>
                <Text style={[styles.langT, lang === l && styles.langTOn]}>
                  {l === 'id' ? t('c_id') : t('c_en')}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={styles.logout}
            onPress={() => {
              onClose();
              logout();
              navigate('Login');
            }}>
            <Text style={styles.logoutText}>{t('action_logout')}</Text>
          </Pressable>
        </Animated.View>
        <Animated.View style={[styles.scrimWrap, { opacity: scrimOpacity }]}>
          <Pressable style={styles.scrim} onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  scrimWrap: { flex: 1 },
  scrim: { flex: 1, backgroundColor: colors.navyDark },
  panel: { backgroundColor: colors.white, paddingBottom: 24 },
  head: { backgroundColor: colors.navy, paddingTop: 56, paddingBottom: 18, paddingHorizontal: 18 },
  outlet: { fontFamily: fonts.bold, fontSize: 17, color: colors.white },
  outletTablet: { fontSize: 19 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  shiftDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green, marginRight: 6 },
  shiftText: { fontFamily: fonts.medium, fontSize: 12, color: colors.navyTint },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLeft: { flex: 1 },
  rowLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  chev: { fontSize: 22, color: colors.faint, fontFamily: fonts.bold },
  langRow: { flexDirection: 'row', gap: 8, marginHorizontal: 18, marginTop: 18 },
  langBtn: {
    flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center', backgroundColor: colors.card,
  },
  langBtnOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  langT: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  langTOn: { color: colors.white },
  logout: {
    marginHorizontal: 18,
    marginTop: 18,
    borderRadius: 12,
    backgroundColor: colors.paleRed,
    paddingVertical: 13,
    alignItems: 'center',
  },
  logoutText: { fontFamily: fonts.bold, fontSize: 14, color: colors.red },
});
