import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { TABLET_BP, colors, fonts } from '../theme';
import { logout } from '../session';
import { useLang } from '../lib/i18n';
import { initDb, queryFirst } from '../lib/db';

interface DrawerItem {
  label: string;
  sub: string;
  route: string;
  icon: number;
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
  /** Menimpa status shift DB bila diberikan (true = buka). */
  shiftOpen?: boolean;
}

export default function DrawerMenu({ visible, onClose, navigate, outlet, user, shiftOpen: shiftOpenProp }: Props) {
  const { lang, setLang, t } = useLang();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  // Drawer Android asli meluncur dari KIRI - samakan (sebelumnya panel di kanan).
  // Lebar adaptif: 300 phone, 340 tablet.
  const drawerW = isTablet ? 340 : 300;
  // Drawer tampil/hilang SEKEtika tanpa animasi apa pun (keputusan produk:
  // slide + scrim terbaca sebagai dua animasi berurutan di HP).
  // Modal tetap animationType="none". Buka-tutup dikontrol murni oleh `visible`.
  if (!visible) return null;
  // Status shift nyata ala CashierScreen (tr_shiftlog): hijau = buka,
  // merah = tutup, kuning = belum termuat/DB kosong. Prop shiftOpen menimpa.
  const [shiftDbOpen, setShiftDbOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (shiftOpenProp !== undefined || !visible) return;
    let alive = true;
    (async () => {
      try {
        await initDb();
        const row = await queryFirst<{ clockOut: string | null; status: string | null }>(
          'SELECT clockOut, status FROM tr_shiftlog ORDER BY clockIn DESC LIMIT 1',
        );
        if (!alive) return;
        setShiftDbOpen(row ? row.status === 'open' || !row.clockOut : null);
      } catch {
        /* DB belum siap - dot tetap kuning (tak diketahui) */
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, shiftOpenProp]);
  const shiftOpen = shiftOpenProp ?? shiftDbOpen;
  // Ikon nav_* bawaan APK: 8 berkas utk 10 item - Tables memakai nav_order
  // (sama-sama permukaan order) dan Expense memakai nav_petty_cash
  // (sama-sama arus kas keluar); Member memakai nav_attendance (direktori orang).
  const ITEMS: DrawerItem[] = [
    { label: t('nav_order'), sub: t('nav_cashier'), route: 'Cashier', icon: require('../../assets/icons/nav_order.webp') },
    { label: t('nav_tables'), sub: t('nav_layout_sub'), route: 'Tables', icon: require('../../assets/icons/nav_order.webp') },
    { label: t('nav_shift'), sub: t('nav_shift_sub'), route: 'Shift', icon: require('../../assets/icons/nav_shift.webp') },
    { label: t('nav_history'), sub: t('nav_history_sub'), route: 'History', icon: require('../../assets/icons/nav_sales_recap.webp') },
    { label: t('nav_recap'), sub: t('nav_recap_sub'), route: 'Recap', icon: require('../../assets/icons/nav_detail_recap.webp') },
    { label: t('nav_esb'), sub: t('nav_online_orders'), route: 'EsbOrder', icon: require('../../assets/icons/nav_esb_order_dashboard.webp') },
    { label: t('nav_member'), sub: t('nav_member_sub'), route: 'Member', icon: require('../../assets/icons/nav_attendance.webp') },
    { label: t('nav_expense'), sub: t('nav_expense_sub'), route: 'Expense', icon: require('../../assets/icons/nav_petty_cash.webp') },
    { label: t('nav_petty'), sub: t('nav_petty_sub'), route: 'PettyCash', icon: require('../../assets/icons/nav_petty_cash.webp') },
    { label: t('nav_settings'), sub: t('nav_settings_sub'), route: 'Settings', icon: require('../../assets/icons/nav_setting.webp') },
  ];
  const go = (route: string) => {
    onClose();
    navigate(route);
  };
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={[styles.panel, { width: drawerW }]}>
          <View style={styles.head}>
            <Text style={[styles.outlet, isTablet && styles.outletTablet]}>{outlet ?? 'ESB Cabang Poris'}</Text>
            <View style={styles.shiftRow}>
              <View
                style={[
                  styles.shiftDot,
                  shiftOpen === false && styles.shiftDotClosed,
                  shiftOpen === null && styles.shiftDotUnknown,
                ]}
              />
              <Text style={styles.shiftText}>{user ?? t('drawer_demo_user')}</Text>
            </View>
          </View>
          {ITEMS.map((m) => (
            <Pressable key={m.route} style={styles.row} onPress={() => go(m.route)}>
              <Image source={m.icon} style={styles.rowIcon} resizeMode="contain" />
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
              try {
                // Reset tumpukan ke Login selagi navigator app masih mount,
                // baru keluar sesi → guest stack mount segar; tombol back
                // tak bisa kembali masuk ke app.
                navigation.reset({ index: 0, routes: [{ name: 'Login' as never }] });
              } catch {
                navigate('Login');
              } finally {
                logout();
              }
            }}>
            <Text style={styles.logoutText}>{t('action_logout')}</Text>
          </Pressable>
        </View>
        <View style={styles.scrimWrap}>
          <Pressable style={styles.scrim} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  scrimWrap: { flex: 1, opacity: 0.55 },
  scrim: { flex: 1, backgroundColor: colors.navyDark },
  panel: { backgroundColor: colors.white, paddingBottom: 24 },
  head: { backgroundColor: colors.navy, paddingTop: 56, paddingBottom: 18, paddingHorizontal: 18 },
  outlet: { fontFamily: fonts.bold, fontSize: 17, color: colors.white },
  outletTablet: { fontSize: 19 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  shiftDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green, marginRight: 6 },
  shiftDotClosed: { backgroundColor: colors.red },
  shiftDotUnknown: { backgroundColor: colors.amber },
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
  rowIcon: { width: 30, height: 30, marginRight: 12 },
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
