import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { TABLET_BP, colors, fonts } from '../theme';
import { getSession, getBinding, logout, subscribeSession } from '../session';
import { getBranchId } from '../config/server';
import { useLang } from '../lib/i18n';
import { allowedRoutesFor, getDeviceRole, normalizeTag, subscribeDeviceRole } from '../lib/deviceRole';
import { initDb, queryFirst } from '../lib/db';
import { logoutRevoke } from '../lib/terminalApi';

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
  // Route aktif untuk highlight menu — baca aman, fallback undefined bila di luar navigator.
  // Hook dipanggil tanpa syarat di atas early-return agar urutan hooks stabil.
  let activeRoute: string | undefined;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    activeRoute = useNavigationState((s) => s?.routes?.[s?.index ?? 0]?.name);
  } catch {
    activeRoute = undefined;
  }
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  // Drawer Android asli meluncur dari KIRI - samakan (sebelumnya panel di kanan).
  // Lebar adaptif: 300 phone, proporsional di tablet (maks 400).
  const drawerW = isTablet ? Math.min(400, width * 0.42) : 300;
  // Status shift nyata ala CashierScreen (tr_shiftlog): hijau = buka,
  // merah = tutup, kuning = belum termuat/DB kosong. Prop shiftOpen menimpa.
  // Hooks WAJIB di atas early-return: keluar sebelum hooks membuat React
  // melempar "Rendered more hooks than during the previous render".
  const [shiftDbOpen, setShiftDbOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (shiftOpenProp !== undefined || !visible) return;
    let alive = true;
    (async () => {
      try {
        await initDb();
        const row = await queryFirst<{ clockOut: string | null; status: string | null }>(
          // Baris absensi (status 'absen') dikecualikan agar clock-in kehadiran
          // tak menyalakan dot hijau shift (clockOut NULL terbaca "open").
          // Lingkup cabang: shift cabang lain tak boleh menyalakan dot kami.
          'SELECT clockOut, status FROM tr_shiftlog WHERE (status IS NULL OR status <> \'absen\') AND (branchId = ? OR branchId IS NULL OR branchId = \'\') ORDER BY clockIn DESC LIMIT 1',
          [getBranchId()],
        );
        if (!alive) return;
        if (row) {
          setShiftDbOpen(row.status === 'open' || !row.clockOut);
          return;
        }
        // Tanpa baris shift: hanya-absensi (belum pernah buka shift) = tutup/merah.
        const total = await queryFirst<{ c: number }>('SELECT COUNT(*) AS c FROM tr_shiftlog');
        if (alive) setShiftDbOpen(total && Number(total.c) > 0 ? false : null);
      } catch {
        /* DB belum siap - dot tetap kuning (tak diketahui) */
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, shiftOpenProp]);
  const shiftOpen = shiftOpenProp ?? shiftDbOpen;
  // S4-APP-312 carry-over (crash-blocker verifikasi drawer): hooks tag-tick
  // WAJIB di atas early-return `if (!visible) return null` — di bawahnya
  // menambah hooks saat drawer dibuka → "Rendered more hooks...".
  const [, setTagTick] = useState(0);
  useEffect(() => {
    const un1 = subscribeSession(() => setTagTick((x) => x + 1));
    const un2 = subscribeDeviceRole(() => setTagTick((x) => x + 1));
    return () => {
      un1();
      un2();
    };
  }, []);
  // Nama user: prop pemanggil dulu, lalu sesi login nyata. Kunci demo i18n
  // hanya last-resort (tanpa sesi = drawer tak bisa dibuka dari layar auth).
  const sessUser = (() => {
    if (user) return user;
    try {
      const s = getSession();
      if (!s) return undefined;
      const nm = (s.name || s.username || '').trim();
      return nm ? `${nm} | ${s.shift}` : undefined;
    } catch {
      return undefined;
    }
  })();
  // Drawer tampil/hilang SEKEtika tanpa animasi apa pun (keputusan produk:
  // slide + scrim terbaca sebagai dua animasi berurutan di HP).
  // Modal tetap animationType="none". Buka-tutup dikontrol murni oleh `visible`.
  if (!visible) return null;
  // Ikon nav_* bawaan APK: 8 berkas utk 10 item - Tables memakai nav_order
  // (sama-sama permukaan order) dan Expense memakai nav_petty_cash
  // (sama-sama arus kas keluar); Member memakai nav_attendance (direktori orang).
  const ITEMS: DrawerItem[] = [
    // Dashboard memakai ikon nav_esb_order_dashboard.webp bersama EsbOrder/CustomerDisplay
    // (reuse ikon yang sudah ada, tanpa berkas baru).
    { label: t('nav_dashboard'), sub: t('nav_dashboard_sub'), route: 'Dashboard', icon: require('../../assets/icons/nav_esb_order_dashboard.webp') },
    { label: t('nav_order'), sub: t('nav_cashier'), route: 'Cashier', icon: require('../../assets/icons/nav_order.webp') },
    { label: t('nav_tables'), sub: t('nav_layout_sub'), route: 'Tables', icon: require('../../assets/icons/nav_order.webp') },
    { label: t('nav_shift'), sub: t('nav_shift_sub'), route: 'Shift', icon: require('../../assets/icons/nav_shift.webp') },
    { label: t('nav_history'), sub: t('nav_history_sub'), route: 'History', icon: require('../../assets/icons/nav_sales_recap.webp') },
    { label: t('nav_recap'), sub: t('nav_recap_sub'), route: 'Recap', icon: require('../../assets/icons/nav_detail_recap.webp') },
    { label: t('nav_esb'), sub: t('nav_online_orders'), route: 'EsbOrder', icon: require('../../assets/icons/nav_esb_order_dashboard.webp') },
    { label: t('nav_kitchen'), sub: t('nav_kitchen_sub'), route: 'Kitchen', icon: require('../../assets/icons/nav_order.webp') },
    { label: t('nav_menu_mgmt'), sub: t('nav_menu_mgmt_sub'), route: 'MenuManagement', icon: require('../../assets/icons/nav_sales_recap.webp') },
    { label: t('nav_member'), sub: t('nav_member_sub'), route: 'Member', icon: require('../../assets/icons/nav_attendance.webp') },
    { label: t('nav_expense'), sub: t('nav_expense_sub'), route: 'Expense', icon: require('../../assets/icons/nav_petty_cash.webp') },
    { label: t('nav_petty'), sub: t('nav_petty_sub'), route: 'PettyCash', icon: require('../../assets/icons/nav_petty_cash.webp') },
    { label: t('nav_settings'), sub: t('nav_settings_sub'), route: 'Settings', icon: require('../../assets/icons/nav_setting.webp') },
  ];
  // Display-lock SPEC §10 (Wave1): drawer mengikuti tag terminal binding
  // (session.getBinding), fallback ke tag perangkat. kasir/dapur/full_access =
  // default-allow (menu penuh, nav-lock DAPUR/DISPLAY lama dicabut);
  // view_pelanggan = HANYA CustomerDisplay (nama layar eksisting untuk
  // CustomerView); view_queue = HANYA QueueView. Tanpa Settings/role-switch
  // untuk kedua tag view; keluar hanya via aksi owner terautentikasi (Q14).
  // Tag tak dikenal = daftar kosong (fail-closed).
  // (tagTick hooks dipindah ke atas early-return — lih. catatan di shiftOpen.)
  const boundTag = (() => {
    try {
      return normalizeTag(getBinding()?.tag);
    } catch {
      return null;
    }
  })();
  const activeTag = boundTag ?? normalizeTag(getDeviceRole());
  const allow = activeTag ? allowedRoutesFor(activeTag) : null;
  /* APP-EVENTS: label antrean via kunci kamus (queue_title/queue_branch). */
  const QUEUE_ONLY: DrawerItem[] = [
    {
      label: t('queue_title'),
      sub: t('queue_branch'),
      route: 'QueueView',
      icon: require('../../assets/icons/nav_esb_order_dashboard.webp'),
    },
  ];
  /* APP-EVENTS (SPEC §10): view_pelanggan = HANYA CustomerDisplay
   * (kunci nav_display eksisting; ikon reuse dashboard). */
  const CUSTOMER_ONLY: DrawerItem[] = [
    {
      label: t('nav_display'),
      sub: t('nav_display_sub'),
      route: 'CustomerDisplay',
      icon: require('../../assets/icons/nav_esb_order_dashboard.webp'),
    },
  ];
  const VISIBLE: DrawerItem[] =
    allow === null
      ? ITEMS
      : allow.has('QueueView')
        ? QUEUE_ONLY
        : allow.has('CustomerDisplay')
          ? CUSTOMER_ONLY
          : ITEMS.filter((m) => allow.has(m.route));
  const go = (route: string) => {
    // Gerbang kasir + dapur (Q4: view bebas-shift, dapur WAJIB shift terbuka):
    // shift tutup (status live dibaca tiap drawer dibuka) → tutup drawer
    // lalu arahkan buka shift dulu, bukan ke kasir/dapur.
    if ((route === 'Cashier' || route === 'Kitchen') && shiftOpen === false) {
      onClose();
      navigate('Shift');
      return;
    }
    onClose();
    navigate(route);
  };
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={[styles.panel, { width: drawerW }]}>
          <View style={styles.head}>
            <Text style={[styles.outlet, isTablet && styles.outletTablet]}>{outlet ?? t('outlet_fallback')}</Text>
            <View style={styles.shiftRow}>
              <View
                style={[
                  styles.shiftDot,
                  shiftOpen === false && styles.shiftDotClosed,
                  shiftOpen === null && styles.shiftDotUnknown,
                ]}
              />
              <Text style={styles.shiftText}>{sessUser ?? t('drawer_demo_user')}</Text>
            </View>
          </View>
          {/* Daftar menu digulir agar tombol bahasa/logout tak terpotong
              di tablet landscape pendek; footer bahasa + logout tetap di bawah. */}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {VISIBLE.map((m) => {
              const active = m.route === activeRoute;
              return (
                <Pressable key={m.route} style={[styles.row, active && styles.rowActive]} onPress={() => go(m.route)}>
                  <Image source={m.icon} style={[styles.rowIcon, isTablet && styles.rowIconTablet]} resizeMode="contain" />
                  <View style={styles.rowLeft}>
                    <Text style={[styles.rowLabel, isTablet && styles.rowLabelTablet, active && styles.rowLabelActive]}>{m.label}</Text>
                    <Text style={[styles.rowSub, isTablet && styles.rowSubTablet]}>{m.sub}</Text>
                  </View>
                  <Text style={styles.chev}>›</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.langRow}>
            {(['id', 'en'] as const).map((l) => (
              <Pressable
                key={l}
                style={[styles.langBtn, lang === l && styles.langBtnOn, isTablet && styles.langBtnTablet]}
                onPress={() => setLang(l)}>
                <Text style={[styles.langT, lang === l && styles.langTOn]}>
                  {l === 'id' ? t('c_id') : t('c_en')}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={[styles.logout, isTablet && styles.logoutTablet]}
            onPress={() => {
              onClose();
              // S18: revoke server-side best-effort (fire-and-forget; logout
              // lokal tetap instan, utang revoke ditandai logout() seperti biasa
              // dan di-flush pushAll berikutnya).
              // E31 fase-1a: terminal-logout best-effort (revoke sesi + grant
              // triple server, device TETAP bound untuk fast-login) — gagal
              // jaringan = abaikan, logout lokal tetap jalan.
              try {
                const s = getSession();
                const dev = (s?.deviceId || '').trim();
                const who = (s?.userId || s?.username || '').trim();
                // E (dedupe 2026-10-17): SATU POST ke /auth/terminal-logout —
                // logoutRevoke + terminalLogout menunjuk endpoint yang sama;
                // dua panggilan = revoke ganda sia-sia. deviceId eksplisit
                // dari sesi (logoutRevoke resolve sendiri bila kosong).
                if (dev || who) {
                  void logoutRevoke({
                    ...(who ? { userId: who } : {}),
                    ...(dev ? { deviceId: dev } : {}),
                  }).catch(() => {});
                }
              } catch {
                /* abaikan — logout lokal tetap jalan */
              }
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
  // maxHeight agar ScrollView daftar bisa menggulir di layar pendek.
  panel: { backgroundColor: colors.white, paddingBottom: 24, maxHeight: '100%' },
  // Pembungkus daftar menu yg bisa digulir (footer bahasa/logout tetap di bawah).
  list: { flex: 1 },
  listContent: { paddingBottom: 8 },
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
  // Baris menu aktif: latar navy muda + label navy tebal.
  rowActive: { backgroundColor: colors.paleBlue },
  rowIcon: { width: 30, height: 30, marginRight: 12 },
  // Tablet: ikon + teks menu lebih besar agar proporsional dibaca.
  rowIconTablet: { width: 34, height: 34 },
  rowLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  rowLabelActive: { color: colors.navy, fontFamily: fonts.bold },
  rowLabelTablet: { fontSize: 16 },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  rowSubTablet: { fontSize: 13 },
  chev: { fontSize: 22, color: colors.faint, fontFamily: fonts.bold },
  langRow: { flexDirection: 'row', gap: 8, marginHorizontal: 18, marginTop: 18 },
  langBtn: {
    flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center', backgroundColor: colors.card,
  },
  // Tablet: target sentuh min 48px.
  langBtnTablet: { minHeight: 48, paddingVertical: 14 },
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
  // Tablet: target sentuh min 48px.
  logoutTablet: { minHeight: 48, paddingVertical: 14 },
  logoutText: { fontFamily: fonts.bold, fontSize: 14, color: colors.red },
});
