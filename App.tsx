import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, useNavigation, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, fonts, rp } from './src/theme';
import type { RootStackParamList } from './src/navigation/types';
import { getSession, hydrateTerminalState, getBinding, logout, peekPostLoginRoute, revokeKickedSession, setKickNotice, subscribeSession, takePostLoginRoute } from './src/session';
import { tr, useLang } from './src/lib/i18n';
import { initDb, queryFirst, run } from './src/lib/db';
import { seedIfEmpty } from './src/lib/seed';
import { loadServerState, getBranchId, getTerminal } from './src/config/server';
import { startRealtime, stopRealtime, onWsMessage } from './src/lib/realtime';
import { subscribeTerminalEvents } from './src/lib/sse';
import { getApiMode } from './src/lib/apiSource';
import { flushPendingRevokes } from './src/lib/sync';
import { pullMaster } from './src/lib/master';
import { registerPushToken, notifyLocal } from './src/lib/push';
import { FULL_FEATURE_TAGS, allowedRoutesFor, getDeviceRole, homeRouteFor, normalizeTag, parseDeviceRole, setDeviceRoleForTag, subscribeDeviceRole, type DeviceRole } from './src/lib/deviceRole';

import IntroScreen from './src/screens/install/IntroScreen';
import InstallScreen from './src/screens/install/InstallScreen';
import SelectBranchScreen from './src/screens/install/SelectBranchScreen';
import TerminalPickerScreen from './src/screens/install/TerminalPickerScreen';
import TerminalPinScreen from './src/screens/install/TerminalPinScreen';
import InstallProgressScreen from './src/screens/install/InstallProgressScreen';
import CreatePinScreen from './src/screens/install/CreatePinScreen';
import ForgotPinScreen from './src/screens/install/ForgotPinScreen';
import LoginScreen from './src/screens/auth/LoginScreen';
import QrHowScreen from './src/screens/auth/QrHowScreen';
import DashboardScreen from './src/screens/home/DashboardScreen';
import CashierScreen from './src/screens/cashier/CashierScreen';
import CartDetailScreen from './src/screens/cashier/CartDetailScreen';
import DineInScreen from './src/screens/cashier/DineInScreen';
import CustomMenuScreen from './src/screens/cashier/CustomMenuScreen';
import LoadOrderScreen from './src/screens/cashier/LoadOrderScreen';
import BillPreviewScreen from './src/screens/bill/BillPreviewScreen';
import ReceiptScreen from './src/screens/bill/ReceiptScreen';
import CancelScreen from './src/screens/bill/CancelScreen';
import TablesScreen from './src/screens/tables/TablesScreen';
import BookingScreen from './src/screens/booking/BookingScreen';
import MemberScreen from './src/screens/member/MemberScreen';
import VoucherScreen from './src/screens/member/VoucherScreen';
import QrScanScreen from './src/screens/scan/QrScanScreen';
import PayScreen from './src/screens/payment/PayScreen';
import QrisScreen from './src/screens/payment/QrisScreen';
import EdcScreen from './src/screens/payment/EdcScreen';
import SuccessScreen from './src/screens/payment/SuccessScreen';
import AttendanceScreen from './src/screens/shift/AttendanceScreen';
import ShiftScreen from './src/screens/shift/ShiftScreen';
import RecapScreen from './src/screens/shift/RecapScreen';
import EndShiftScreen from './src/screens/shift/EndShiftScreen';
import HistoryScreen from './src/screens/history/HistoryScreen';
import EsbOrderScreen from './src/screens/history/EsbOrderScreen';
import KitchenScreen from './src/screens/history/KitchenScreen';
import PrintersScreen from './src/screens/settings/PrintersScreen';
import SettingsScreen from './src/screens/settings/SettingsScreen';
import CustomerDisplayScreen from './src/screens/display/CustomerDisplayScreen';
import QueueViewScreen from './src/screens/display/QueueViewScreen';
import WebViewScreen from './src/screens/misc/WebViewScreen';
import SplitBillScreen from './src/screens/cashier/SplitBillScreen';
import MoveItemsScreen from './src/screens/cashier/MoveItemsScreen';
import MoveTableScreen from './src/screens/cashier/MoveTableScreen';
import PromotionListScreen from './src/screens/cashier/PromotionListScreen';
import MenuPrintingScreen from './src/screens/settings/MenuPrintingScreen';
import StockScreen from './src/screens/settings/StockScreen';
import TableTimerScreen from './src/screens/settings/TableTimerScreen';
import SyncScreen from './src/screens/settings/SyncScreen';
import LogScreen from './src/screens/settings/LogScreen';
import AboutScreen from './src/screens/settings/AboutScreen';
import HelpScreen from './src/screens/settings/HelpScreen';
import MenuManagementScreen from './src/screens/settings/MenuManagementScreen';
import IdleScreen from './src/screens/display/IdleScreen';
import TopupDepositScreen from './src/screens/member/TopupDepositScreen';
import PettyCashScreen from './src/screens/cash/PettyCashScreen';
import PettyCashFormScreen from './src/screens/cash/PettyCashFormScreen';
import PettyCashDetailScreen from './src/screens/cash/PettyCashDetailScreen';
import ExpenseScreen from './src/screens/cash/ExpenseScreen';
import AppAlertHost from './src/components/AppAlertHost';

void SplashScreen.preventAutoHideAsync();

// ---------------------------------------------------------------------------
// K1 — deteksi kick via event `takeover` SSE terminal (kebenaran BE
// terverifikasi 2026-10-17): kick = last-writer-wins — login baru menerima
// `tookOver` di respons terminal-login + event `takeover` di-fan-out pada
// feed SSE terminal; grant lama direvoke server-side TANPA menegakkan pada
// panggilan API device lama (jadi device lama TIDAK menerima 401 — 401 =
// gagal auth final → re-login, BUKAN bukti kick).
// SATU-SATUNYA langganan kick tingkat sesi: dipasang/dilepas oleh efek
// loggedIn/bound di bawah (cleanup tiap ganti binding → tak ada duplikat).
// Langganan SSE di display.ts (ensureSse) murni transport display dan tak
// menangani kick. Mode offline/lokal: no-op (butuh Real Mode + sesi +
// terminal ter-bound; SseClient pun fail-closed tanpa BE terkonfigurasi).
// Tak pernah melempar.
// ---------------------------------------------------------------------------

/** true bila event takeover SSE ini mengusir sesi aktif perangkat ini. */
function isTakeoverForMe(data: unknown): { forMe: boolean; kickedUserId: string } {
  try {
    const me = getSession();
    if (!me) return { forMe: false, kickedUserId: '' };
    const d = (data ?? {}) as Record<string, unknown>;
    // Bukan terminal kami → abaikan (feed sudah per-terminal; jaga-jaga bila
    // payload membawa identitas terminal lain).
    const evTerm = String(d.terminalId ?? d.terminalCode ?? '').trim();
    const b = getBinding();
    const myTermId = String(b?.terminalId ?? me.terminalId ?? '').trim();
    const myTermCode = String(b?.terminalCode ?? '').trim();
    if (evTerm && myTermId && evTerm !== myTermId && evTerm !== myTermCode) {
      return { forMe: false, kickedUserId: '' };
    }
    const myUserId = String(me.userId ?? '').trim();
    const myName = String(me.username ?? '').trim();
    const myDevice = String(b?.deviceId ?? me.deviceId ?? '').trim();
    // Bila event menyebut user yang ditendang: hanya kami yang bereaksi.
    const evKicked = String(d.kickedUserId ?? '').trim();
    if (evKicked) {
      const mine =
        (myUserId !== '' && evKicked === myUserId) ||
        (myName !== '' && evKicked === myName);
      return { forMe: mine, kickedUserId: evKicked };
    }
    // Tanpa kickedUserId eksplisit: user/device event ≠ milik sesi/binding
    // kami pada terminal ini = sesi kami digantikan login lain.
    const evUser = String(d.userId ?? d.username ?? '').trim();
    const evDevice = String(d.deviceId ?? '').trim();
    const userDiffers = evUser !== '' && evUser !== myUserId && evUser !== myName;
    const deviceDiffers = evDevice !== '' && myDevice !== '' && evDevice !== myDevice;
    return { forMe: userDiffers || deviceDiffers, kickedUserId: '' };
  } catch {
    return { forMe: false, kickedUserId: '' };
  }
}

/**
 * Pasang watcher takeover SSE untuk sesi aktif; kembalikan stop-fn (no-op
 * bila prasyarat tak terpenuhi). Event `takeover` untuk sesi kami →
 * notice kicked_msg + cabut sesi+grant lokal (revokeKickedSession).
 */
function startTakeoverWatch(): () => void {
  const noop = () => {};
  try {
    if (getApiMode() !== 'real') return noop;
    const me = getSession();
    const terminalId = String(getBinding()?.terminalId ?? me?.terminalId ?? '').trim();
    if (!me || !terminalId) return noop;
    return subscribeTerminalEvents(terminalId, (e) => {
      try {
        if (!/takeover/.test(String(e?.type ?? ''))) return;
        const { forMe, kickedUserId } = isTakeoverForMe(e?.data);
        if (!forMe) return;
        if (revokeKickedSession(kickedUserId || undefined)) {
          try {
            setKickNotice(tr('kicked_msg'));
          } catch {
            /* abaikan */
          }
        }
      } catch {
        /* handler tak boleh mematikan klien SSE */
      }
    });
  } catch {
    return noop;
  }
}

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Rute cabang tamu - dipakai jaring pengaman logout (di luarnya = stale authed). */
const GUEST_ROUTES = new Set([
  'Intro', 'Install', 'SelectBranch', 'BranchPicker', 'TerminalPicker', 'TerminalPin',
  'InstallProgress', 'CreatePin',
  'ForgotPin', 'Login', 'QrHow', 'WebView',
]);

// Judul header native selalu tengah di Android (DineIn, CustomMenu, dsb).
const screenOptions = {
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: colors.white,
  headerTitleStyle: { fontFamily: fonts.bold, fontSize: 16 },
  headerTitleAlign: 'center' as const,
  animation: 'default' as const,
};

/** Guard navigator: belum login hanya bisa buka alur intro/install/Login.
 * B2 (SPEC B1/R1): tamu yang belum ter-bound mulai di BindFlow
 * (BranchPicker), yang ter-bound mulai di Login. */
function GuardedStacks({ loggedIn, bound }: { loggedIn: boolean; bound: boolean }) {
  const { t } = useLang();
  const nav = useNavigation();
  /** Konsumsi rute pasca-login sekali-pakai (mis. QrScan dari kartu QR):
   * stack authed baru mount di render ini, dorong target di atas initial
   * (Dashboard/Shift) setelah navigator siap. */
  useEffect(() => {
    if (!loggedIn) return;
    const target = takePostLoginRoute();
    if (!target) return;
    const timer = setTimeout(() => {
      (nav.navigate as unknown as (name: string) => void)(target);
    }, 120);
    return () => clearTimeout(timer);
  }, [loggedIn, nav]);
  /** Soft-guard shift: instalasi fresh (tr_shiftlog kosong) bebas ke Dashboard/Cashier
   * agar demo/screenshot jalan; bila ada riwayat shift tapi tak ada yang open → mulai di Shift. */
  const [shiftClosed, setShiftClosed] = useState(false);
  /** Kunci peran perangkat: dapur mulai di Kitchen, view_pelanggan di
   * CustomerDisplay, view_queue di QueueView; rute di luar allowlist view
   * di-reset paksa ke beranda (kasir/dapur/full_access = fitur penuh). */
  const [deviceRole, setDeviceRoleState] = useState<DeviceRole>(() => getDeviceRole());
  useEffect(() => subscribeDeviceRole((r) => setDeviceRoleState(r)), []);
  /** Kunci peran perangkat (D3-04, E2 APP-FIXUP): gerbang shift berlaku untuk
   * semua tag fitur-penuh (kasir/dapur/full_access), bukan hanya 'kasir' —
   * perbandingan literal 'KASIR' huruf-kapital mati karena setDeviceRole selalu
   * menormalisasi ke tag kanonis lowercase. Legacy 'KASIR' tetap tercakup
   * karena normalizeTag memetakan alias legacy ke tag kanonis. Basis per-tag
   * dipertahankan via homeRouteFor (dapur → Kitchen); shiftClosed menimpa ke
   * Shift. view_queue mendarat di QueueView (terdaftar di stack authed). */
  // APP-FIXUP(E2): cek tag-aware via FULL_FEATURE_TAGS, bukan literal 'KASIR'.
  const deviceTag = normalizeTag(deviceRole);
  const homeBase = homeRouteFor(deviceRole) as 'Dashboard' | 'Shift' | 'Kitchen' | 'CustomerDisplay' | 'QueueView';
  const home: 'Dashboard' | 'Shift' | 'Kitchen' | 'CustomerDisplay' | 'QueueView' =
    (deviceTag !== null && FULL_FEATURE_TAGS.includes(deviceTag) && shiftClosed) ? 'Shift' : homeBase;
  useEffect(() => {
    if (!loggedIn) {
      setShiftClosed(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        await initDb();
        const total = await queryFirst<{ c: number }>('SELECT COUNT(*) AS c FROM tr_shiftlog');
        if (!alive) return;
        // Fresh install: shiftlog kosong → jangan blokir.
        if (!total || Number(total.c) === 0) {
          setShiftClosed(false);
          return;
        }
        const openRow = await queryFirst<{ c: number }>(
          // Baris absensi (status 'absen') dikecualikan: clock-in kehadiran
          // BUKAN shift kasir; tanpa filter, absen-masuk setelah shift tutup
          // (clockOut NULL) terbaca "open" dan gerbang navigator bocor.
          "SELECT COUNT(*) AS c FROM tr_shiftlog WHERE (status = 'open' OR clockOut IS NULL) AND (status IS NULL OR status <> 'absen')",
        );
        if (alive) setShiftClosed(Number(openRow?.c ?? 0) === 0);
      } catch {
        /* DB belum siap - jangan blokir kasir */
      }
    })();
    return () => {
      alive = false;
    };
  }, [loggedIn]);
  /** Jaring pengaman rute awal per flip login/logout. Teramati di web+HP:
   * state navigator kadang dipakai ulang lintas cabang tamu/authed sehingga
   * mendarat di Login authed bertumpuk-1 padahal initialRoute=Dashboard
   * (form tampak kereset, Sign In berikutnya diam). Koreksi sekali per flip;
   * no-op bila rute sudah benar. Pendorong Login yang disengaja (aliran
   * CreatePin) menaruh Dashboard/Shift di dasar tumpukan sehingga lolos. */
  useEffect(() => {
    type NavCtl = {
      getState?: () => { routes?: { name?: string }[]; index?: number };
      reset?: (s: { index: number; routes: { name: string }[] }) => void;
    };
    const n = nav as unknown as NavCtl;
    const curName = (): string | undefined => {
      try {
        const st = n.getState?.();
        if (!st || !Array.isArray(st.routes) || typeof st.index !== 'number') return undefined;
        return st.routes[st.index]?.name;
      } catch {
        return undefined;
      }
    };
    if (!loggedIn) {
      // Arah logout: tumpukan bekas-authed bisa menunjuk rute authed-only
      // (blank di cabang tamu) → kembalikan ke Intro.
      const timer = setTimeout(() => {
        try {
          const cur = curName();
          if (cur && !GUEST_ROUTES.has(cur)) n.reset?.({ index: 0, routes: [{ name: 'Intro' }] });
        } catch { /* abaikan */ }
      }, 150);
      return () => clearTimeout(timer);
    }
    // Target sekali-pakai (QrScan) dimiliki efek pending di atas.
    if (peekPostLoginRoute()) return;
    const timer = setTimeout(() => {
      try {
        const st = n.getState?.();
        const routes = st && Array.isArray(st.routes) ? st.routes : [];
        const cur = routes.length > 0 && typeof st?.index === 'number' ? routes[st.index]?.name : undefined;
        const bottom = routes.length > 0 ? routes[0]?.name : undefined;
        // Kunci peran: tag view (view_pelanggan/view_queue) tak boleh mendarat
        // di luar satu halamannya (mis. deep-link sisa sesi) - kembalikan ke
        // beranda peran. kasir/dapur/full_access = fitur penuh
        // (allowedRoutesFor null → lewati reset di bawah; deviceRole.ts kanonis).
        // F13: hanya bila home ada di stack aktif (stack authed sudah
        // mount); stack tamu yang masih transisi jangan di-reset.
        const allowed = allowedRoutesFor(deviceRole);
        if (allowed && cur && !allowed.has(cur)) {
          const names = routes.map((r) => r?.name);
          if (!names.includes(home)) return;
          n.reset?.({ index: 0, routes: [{ name: home }] });
          return;
        }
        if (cur === 'Login' && bottom !== 'Dashboard' && bottom !== 'Shift') {
          n.reset?.({ index: 0, routes: [{ name: home }] });
        }
      } catch { /* abaikan */ }
    }, 150);
    return () => clearTimeout(timer);
  }, [loggedIn, nav, shiftClosed, deviceRole, home]);
  /** Kunci peran kontinu: setiap perpindahan rute di luar peran langsung
   * dikembalikan ke beranda peran (deep-link, drawer sisa, dsb). Reset
   * berhenti sendiri karena beranda selalu diizinkan.
   * F13: hanya tegakkan di stack authed — butuh loggedIn DAN rute home ada
   * di stack aktif. Tanpa cek ini, stack tamu (tanpa CustomerDisplay/
   * Kitchen/ Dashboard) ikut di-reset ke beranda peran saat peran
   * view_pelanggan/view_queue aktif. */
  useEffect(() => {
    if (!loggedIn) return undefined;
    const allowed = allowedRoutesFor(deviceRole);
    if (!allowed) return undefined;
    const ctl = nav as unknown as {
      addListener?: (ev: string, cb: () => void) => () => void;
      getState?: () => { routes?: { name?: string }[]; index?: number };
      reset?: (s: { index: number; routes: { name: string }[] }) => void;
    };
    if (typeof ctl.addListener !== 'function') return undefined;
    const unsub = ctl.addListener('state', () => {
      setTimeout(() => {
        try {
          const st = ctl.getState?.();
          if (!st || !Array.isArray(st.routes) || typeof st.index !== 'number') return;
          // Stack tamu tak memuat rute home authed — bukan urusan kunci peran.
          const names = st.routes.map((r) => r?.name);
          if (!names.includes(home)) return;
          const cur = st.routes[st.index]?.name;
          if (cur && !allowed.has(cur)) ctl.reset?.({ index: 0, routes: [{ name: home }] });
        } catch { /* abaikan */ }
      }, 60);
    });
    return unsub;
  }, [nav, deviceRole, home, loggedIn]);
  if (!loggedIn) {
    return (
      // key eksplisit: tanpa ini React me-reuse state navigator tamu saat
      // bertukar ke stack authed (initialRoute diabaikan, terjebak di Login).
      // Sufiks bound: bind/unbind (R1 exit_branch) me-remount ke rute awal
      // yang benar (BindFlow vs Login).
      <Stack.Navigator key={`guest-${bound ? 'bound' : 'unbound'}`} initialRouteName={bound ? 'Login' : 'BranchPicker'} screenOptions={screenOptions}>
        <Stack.Screen name="Intro" component={IntroScreen} options={{ title: t('title_welcome'), headerShown: false }} />
        <Stack.Screen name="Install" component={InstallScreen} options={{ title: t('title_claim') }} />
        <Stack.Screen name="SelectBranch" component={SelectBranchScreen} options={{ title: t('title_branch'), headerShown: false }} />
        <Stack.Screen name="BranchPicker" component={SelectBranchScreen} options={{ title: t('title_branch'), headerShown: false }} />
        <Stack.Screen name="TerminalPicker" component={TerminalPickerScreen} options={{ headerShown: false }} />
        <Stack.Screen name="TerminalPin" component={TerminalPinScreen} options={{ headerShown: false }} />
        <Stack.Screen name="InstallProgress" component={InstallProgressScreen} options={{ title: t('title_setup'), headerBackVisible: false }} />
        <Stack.Screen name="CreatePin" component={CreatePinScreen} options={{ title: t('title_create_pin'), headerBackVisible: false }} />
        <Stack.Screen name="ForgotPin" component={ForgotPinScreen} options={{ title: t('title_forgot_pin') }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ title: t('title_login'), headerShown: false }} />
        <Stack.Screen name="QrHow" component={QrHowScreen} options={{ headerShown: false }} />
        <Stack.Screen name="WebView" component={WebViewScreen} options={{ title: t('title_web'), headerShown: false }} />
      </Stack.Navigator>
    );
  }
  return (
    <>
      {shiftClosed ? (
        <View style={guardStyles.notice}>
          <Text style={guardStyles.noticeT}>
            {t('dash_shift_closed')} - {t('shf_open_btn')}
          </Text>
        </View>
      ) : null}
      <Stack.Navigator
        key={`${deviceRole}-${shiftClosed ? 'shift-closed' : 'shift-ok'}`}
        initialRouteName={home}
        screenOptions={screenOptions}>
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: t('title_login'), headerShown: false }} />
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: t('title_dashboard'), headerShown: false }} />
      <Stack.Screen name="Cashier" component={CashierScreen} options={{ title: t('title_cashier'), headerShown: false }} />
      <Stack.Screen name="CartDetail" component={CartDetailScreen} options={{ title: t('title_cart'), headerShown: false }} />
      <Stack.Screen name="DineIn" component={DineInScreen} options={{ title: t('title_dinein'), headerShown: false }} />
      <Stack.Screen name="CustomMenu" component={CustomMenuScreen} options={{ title: t('title_custom'), headerShown: false }} />
      <Stack.Screen name="LoadOrder" component={LoadOrderScreen} options={{ title: t('title_saved'), headerShown: false }} />
      <Stack.Screen name="BillPreview" component={BillPreviewScreen} options={{ title: t('title_bill'), headerShown: false }} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} options={{ title: t('title_receipt'), headerShown: false }} />
      <Stack.Screen name="Cancel" component={CancelScreen} options={{ title: t('title_cancel'), headerShown: false }} />
      <Stack.Screen name="Tables" component={TablesScreen} options={{ title: t('title_tables'), headerShown: false }} />
      <Stack.Screen name="Booking" component={BookingScreen} options={{ title: t('title_booking'), headerShown: false }} />
      <Stack.Screen name="Member" component={MemberScreen} options={{ title: t('title_member'), headerShown: false }} />
      <Stack.Screen name="Voucher" component={VoucherScreen} options={{ title: t('title_voucher'), headerShown: false }} />
      <Stack.Screen name="QrScan" component={QrScanScreen} options={{ title: t('title_scan'), headerShown: false }} />
      <Stack.Screen name="Pay" component={PayScreen} options={{ title: t('title_pay'), headerShown: false }} />
      <Stack.Screen name="Qris" component={QrisScreen} options={{ title: t('title_qris'), headerShown: false }} />
      <Stack.Screen name="Edc" component={EdcScreen} options={{ title: t('title_edc'), headerShown: false }} />
      <Stack.Screen
        name="Success"
        component={SuccessScreen}
        options={{ title: t('title_success'), headerBackVisible: false, headerShown: false }}
      />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: t('title_attendance'), headerShown: false }} />
      <Stack.Screen name="Shift" component={ShiftScreen} options={{ title: t('title_shift'), headerShown: false }} />
      <Stack.Screen name="Recap" component={RecapScreen} options={{ title: t('title_recap'), headerShown: false }} />
      <Stack.Screen name="EndShift" component={EndShiftScreen} options={{ title: t('title_close'), headerShown: false }} />
      <Stack.Screen name="History" component={HistoryScreen} options={{ title: t('title_history'), headerShown: false }} />
      <Stack.Screen name="EsbOrder" component={EsbOrderScreen} options={{ title: t('title_esb'), headerShown: false }} />
      <Stack.Screen name="Kitchen" component={KitchenScreen} options={{ title: t('title_kitchen'), headerShown: false }} />
      <Stack.Screen name="Printers" component={PrintersScreen} options={{ title: t('title_printer'), headerShown: false }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: t('title_settings'), headerShown: false }} />
      <Stack.Screen name="CustomerDisplay" component={CustomerDisplayScreen} options={{ title: t('title_display'), headerShown: false }} />
      <Stack.Screen name="QueueView" component={QueueViewScreen} options={{ title: t('queue_title'), headerShown: false }} />
      <Stack.Screen name="WebView" component={WebViewScreen} options={{ title: t('title_web'), headerShown: false }} />
      <Stack.Screen name="SplitBill" component={SplitBillScreen} options={{ title: t('title_split'), headerShown: false }} />
      <Stack.Screen name="MoveItems" component={MoveItemsScreen} options={{ title: t('title_move_items'), headerShown: false }} />
      <Stack.Screen name="MoveTable" component={MoveTableScreen} options={{ title: t('title_move_table'), headerShown: false }} />
      <Stack.Screen name="PromotionList" component={PromotionListScreen} options={{ title: t('title_promo'), headerShown: false }} />
      <Stack.Screen name="MenuPrinting" component={MenuPrintingScreen} options={{ title: t('title_menu_print'), headerShown: false }} />
      <Stack.Screen name="Stock" component={StockScreen} options={{ title: t('title_stock'), headerShown: false }} />
      <Stack.Screen name="TableTimer" component={TableTimerScreen} options={{ title: t('title_timer'), headerShown: false }} />
      <Stack.Screen name="Sync" component={SyncScreen} options={{ title: t('title_sync'), headerShown: false }} />
      <Stack.Screen name="Log" component={LogScreen} options={{ title: t('title_log'), headerShown: false }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: t('title_about'), headerShown: false }} />
      <Stack.Screen name="Help" component={HelpScreen} options={{ title: t('title_help'), headerShown: false }} />
      <Stack.Screen name="MenuManagement" component={MenuManagementScreen} options={{ title: t('title_menu'), headerShown: false }} />
      <Stack.Screen name="Idle" component={IdleScreen} options={{ title: t('title_idle'), headerShown: false }} />
      <Stack.Screen name="TopupDeposit" component={TopupDepositScreen} options={{ title: t('title_topup'), headerShown: false }} />
      <Stack.Screen name="PettyCash" component={PettyCashScreen} options={{ title: t('title_petty'), headerShown: false }} />
      <Stack.Screen name="PettyCashForm" component={PettyCashFormScreen} options={{ title: t('title_petty_form'), headerShown: false }} />
      <Stack.Screen name="PettyCashDetail" component={PettyCashDetailScreen} options={{ title: t('title_petty_detail'), headerShown: false }} />
      <Stack.Screen name="Expense" component={ExpenseScreen} options={{ title: t('title_expense'), headerShown: false }} />
      </Stack.Navigator>
    </>
  );
}

export default function App() {
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const showNavHook = process.env.EXPO_PUBLIC_NAV_HOOK === '1';
  const [loaded] = useFonts({
    'HKGrotesk-Regular': require('./assets/fonts/HKGrotesk-Regular.ttf'),
    'HKGrotesk-Medium': require('./assets/fonts/HKGrotesk-Medium.ttf'),
    'HKGrotesk-SemiBold': require('./assets/fonts/HKGrotesk-SemiBold.ttf'),
    'HKGrotesk-Bold': require('./assets/fonts/HKGrotesk-Bold.ttf'),
  });
  const [loggedIn, setLoggedIn] = useState(() => getSession() !== null);
  /** B2: status binding device (SPEC §2). Unbound → BindFlow, bound → Login/tag home. */
  const [bound, setBound] = useState(() => getBinding() !== null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  useEffect(() => subscribeSession(() => {
    setLoggedIn(getSession() !== null);
    try {
      setBound(getBinding() !== null);
    } catch {
      /* binding tak terbaca — anggap unbound (fail-safe ke BindFlow) */
    }
  }), []);

  /** Boot B2: muat binding+grant tersimpan SEBELUM memilih rute awal agar
   * guard unbound→BindFlow / bound→Login tak menilai memori dingin
   * pasca-restart; tag binding diterapkan ke peran device (tag home). */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await loadServerState();
        const st = await hydrateTerminalState();
        // B11: restore sesi AsyncStorage berjalan async — tunggu selesai
        // SEBELUM memilih stack agar guard tak menilai memori dingin
        // pasca-restart (splash ditahan lewat booted di bawah).
        await new Promise<void>((resolve) => {
          let settled = false;
          let unsub: (() => void) | null = null;
          const finish = () => {
            if (settled) return;
            settled = true;
            try { unsub?.(); } catch { /* abaikan */ }
            resolve();
          };
          try {
            const u = subscribeSession(finish);
            unsub = u;
            // Sudah pulih sinkron: cabut listener yang baru dipasang.
            if (settled) {
              try { u(); } catch { /* abaikan */ }
            }
          } catch { finish(); return; }
          getSession(); // picu restore()
          setTimeout(finish, 1000);
        });
        if (!live) return;
        // S18: boot = momen online untuk mengirim utang revoke logout
        // (fire-and-forget, tak menahan splash).
        try { void flushPendingRevokes().catch(() => {}); } catch { /* abaikan */ }
        const b = st.binding;
        setBound(!!(b && b.terminalId));
        const tag = b?.tag ? parseDeviceRole(b.tag) : null;
        if (tag) {
          try {
            setDeviceRoleForTag(tag);
          } catch {
            /* peran bertahan */
          }
        }
      } catch {
        /* offline-first lokal: rute dipilih dari memori apa adanya */
      } finally {
        if (live) setBooted(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    loadServerState().catch(() => {});
    initDb()
      .then(async () => {
        try {
          await seedIfEmpty();
        } catch (e) {
          console.warn('[seed] seedIfEmpty failed', e);
        }
      })
      .catch(() => {});
    // WS self-order baru → notifikasi lokal + arahkan badge ESB Order.
    const off = onWsMessage((msg) => {
      if (msg.type === 'NEW_SELF_ORDER') {
        const p = msg.payload as { orderId?: string; tableNo?: string };
        void notifyLocal(
          tr('notif_online_title'),
          `${tr('notif_table_prefix')} ${String(p.tableNo ?? '-')} · ${String(p.orderId ?? '')}`,
          { route: 'EsbOrder' },
        );
      }
      // Kontrak §7.1: server menandai menu habis → cerminkan ke flagSoldOut lokal.
      if (msg.type === 'MENU_SOLDOUT') {
        const p = msg.payload as { menuId?: string; soldOut?: unknown };
        const menuId = String(p.menuId ?? '');
        if (!menuId) return;
        const sold = p.soldOut === true || Number(p.soldOut) === 1;
        void (async () => {
          try {
            await initDb();
            await run('UPDATE ms_branchmenu SET flagSoldOut = ? WHERE branchId = ? AND menuId = ?', [
              sold ? 1 : 0,
              getBranchId(),
              menuId,
            ]);
          } catch {
            /* DB belum siap - notifikasi tetap dikirim */
          }
          void notifyLocal(tr('ws.soldoutTitle'), `${menuId} - ${tr('ws.soldoutBody')}`, {
            route: 'MenuManagement',
            menuId,
          });
        })();
      }
      // Kontrak §7.1: status penjualan berubah (mis. PAID dari kanal online).
      if (msg.type === 'ORDER_STATUS') {
        const p = msg.payload as { salesNum?: string; status?: string };
        const salesNum = String(p.salesNum ?? '');
        const status = String(p.status ?? '');
        if (!salesNum || !status) return;
        void (async () => {
          try {
            await initDb();
            await run('UPDATE tr_saleshead SET status = ? WHERE salesNum = ?', [status, salesNum]);
          } catch {
            /* abaikan */
          }
          void notifyLocal(tr('ws.orderTitle'), `${salesNum} - ${status}`, {
            route: 'EsbOrder',
            salesNum,
          });
        })();
      }
      // Kontrak §7.2: self-order dilunasi pelanggan.
      if (msg.type === 'SELF_ORDER_PAID') {
        const p = msg.payload as { orderId?: string; paymentMethod?: string; amount?: unknown };
        const amount = Number(p.amount ?? 0);
        void notifyLocal(
          tr('ws.paidTitle'),
          `${String(p.orderId ?? '')} - ${String(p.paymentMethod ?? '')} - ${rp(Number.isFinite(amount) ? amount : 0)}`,
          { route: 'EsbOrder' },
        );
      }
      // Kontrak §7.1: pengumuman shift dari server.
      if (msg.type === 'SHIFT_NOTICE') {
        const p = msg.payload as { message?: string };
        void notifyLocal(tr('ws.shiftTitle'), String(p.message ?? ''), { route: 'Shift' });
      }
      // SPEC §7/Q13 KICK-NO-LOCAL-REVOKE + kick-no-live-notify: sesi perangkat
      // ini digantikan login lain → cabut sesi + grant lokal agar sesi basi tak
      // bisa dipakai lagi, lalu notif kick langsung (perangkat BARU sudah
      // dikabari via tookOver/kickedUserId di alur login/bind). Pencocokan
      // pola kick/takeover/revoke/logout di sini MURNI sisi-klien
      // (future-proof — server TAK PERNAH push frame SESSION_KICKED; deteksi
      // utama = event `takeover` SSE via startTakeoverWatch). Tanpa identitas
      // yang cocok dengan sesi aktif = abaikan (bukan untuk kami).
      if (/session|kick|takeover|revoke|logout/i.test(String(msg.type ?? ''))) {
        const p = msg.payload as {
          kickedUserId?: unknown; userId?: unknown; kicked?: unknown;
          wasKicked?: unknown; terminalId?: unknown;
        };
        const named = String(p.kickedUserId ?? p.userId ?? '').trim();
        const flagged = p.kicked === true || p.wasKicked === true;
        const term = String(p.terminalId ?? '').trim();
        const me = getSession();
        const myTerminal = (getBinding()?.terminalId ?? me?.terminalId ?? '').trim();
        const forMe =
          (!!named && (named === (me?.userId ?? '') || named === (me?.username ?? ''))) ||
          (flagged && (!term || (!!myTerminal && term === myTerminal)));
        if (forMe && revokeKickedSession(named || undefined)) {
          const body = tr('kicked_msg');
          try {
            setKickNotice(body);
          } catch {
            /* abaikan */
          }
          void notifyLocal(tr('takeover_title'), body, { route: 'Login' });
        }
      }
      // Kontrak §7.1: tarik ulang domain yang diminta server.
      if (msg.type === 'FORCE_PULL') {
        const p = msg.payload as { domains?: unknown };
        const domains = Array.isArray(p.domains)
          ? p.domains.filter((x): x is string => typeof x === 'string')
          : undefined;
        void pullMaster(domains)
          .then(() => notifyLocal(tr('sync.title'), tr('ws.pullDone'), { route: 'Sync' }))
          .catch(() => notifyLocal(tr('sync.title'), tr('ws.pullFail'), { route: 'Sync' }));
      }
    });
    return off;
  }, []);

  useEffect(() => {
    if (loggedIn) {
      startRealtime();
      const s = getSession();
      if (s) void registerPushToken(s.username, getTerminal().terminalCode);
      // K1: watcher takeover sesi (SATU-SATUNYA langganan kick sesi; display.ts
      // hanya transport display). Lihat startTakeoverWatch di bawah.
      const stopTakeover = startTakeoverWatch();
      return () => {
        try {
          stopTakeover?.();
        } catch {
          /* abaikan */
        }
      };
    } else {
      stopRealtime();
    }
    return undefined;
  }, [loggedIn, bound]);

  if (!loaded || !booted) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer
      ref={navRef}
      onReady={() => {
        if (!showNavHook) return;
        // Hook verifikasi visual (dev only, aktif bila EXPO_PUBLIC_NAV_HOOK=1)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__NAV__ = {          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          go: (name: string, params?: any) => {
            if (getSession() === null) {
              // JANGAN cetak sesi demo: identitas wajib dari login nyata
              // (kasir/2222 dsb. jalan offline-first). Tanpa sesi, arahkan
              // ke Login agar hook tak memalsukan identitas.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (navRef as any).navigate('Login' as never);
              return;
            }
            // B14 fail-closed: sesi tanpa ikatan terminal = ke alur klaim,
            // bukan rute authed (tanpa binding = tanpa konteks terminal).
            let boundNow = false;
            try {
              boundNow = getBinding() !== null;
            } catch {
              boundNow = false;
            }
            if (!boundNow) {
              // Dev-hook only: arahkan ke awal alur klaim B2 (BranchPicker,
              // selaras BIND_FLOW_ROUTE). No-op bila rute tak ada di stack aktif.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (navRef as any).navigate('BranchPicker' as never);
              return;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (navRef as any).navigate(name as never, params as never);
          },
          // Navigasi alur tamu (intro/install): keluar sesi dulu bila sedang login.
          goGuest: (name: string, params?: any) => {
            if (getSession() !== null) {
              logout();
              setTimeout(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (navRef as any).navigate(name as never, params as never);
              }, 300);
              return;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (navRef as any).navigate(name as never, params as never);
          },
        };
      }}>
      <StatusBar style="light" />
      <GuardedStacks loggedIn={loggedIn} bound={bound} />
      {/* S2-C308: host Modal appAlert agar failure-path Alert tampil di web. */}
      <AppAlertHost />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy },
});

/** Banner pesan soft-guard shift - Indonesia, token colors.* + fonts.* yang ada. */
const guardStyles = StyleSheet.create({
  notice: { backgroundColor: colors.paleAmber, paddingHorizontal: 16, paddingVertical: 10 },
  noticeT: { color: colors.amberDark, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center' },
});
