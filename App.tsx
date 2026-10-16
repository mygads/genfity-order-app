import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colors, fonts, rp } from './src/theme';
import type { RootStackParamList } from './src/navigation/types';
import { getSession, loginDemo, logout, subscribeSession } from './src/session';
import { tr, useLang } from './src/lib/i18n';
import { initDb, queryFirst, run } from './src/lib/db';
import { loadServerState, getBranchId, getTerminal } from './src/config/server';
import { startRealtime, stopRealtime, onWsMessage } from './src/lib/realtime';
import { pullMaster } from './src/lib/master';
import { registerPushToken, notifyLocal } from './src/lib/push';

import IntroScreen from './src/screens/install/IntroScreen';
import InstallScreen from './src/screens/install/InstallScreen';
import SelectBranchScreen from './src/screens/install/SelectBranchScreen';
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

void SplashScreen.preventAutoHideAsync();

const Stack = createNativeStackNavigator<RootStackParamList>();

// Judul header native selalu tengah di Android (DineIn, CustomMenu, dsb).
const screenOptions = {
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: colors.white,
  headerTitleStyle: { fontFamily: fonts.bold, fontSize: 16 },
  headerTitleAlign: 'center' as const,
  animation: 'default' as const,
};

/** Guard navigator: belum login hanya bisa buka alur intro/install/Login. */
function GuardedStacks({ loggedIn }: { loggedIn: boolean }) {
  const { t } = useLang();
  /** Soft-guard shift: instalasi fresh (tr_shiftlog kosong) bebas ke Dashboard/Cashier
   * agar demo/screenshot jalan; bila ada riwayat shift tapi tak ada yang open → mulai di Shift. */
  const [shiftClosed, setShiftClosed] = useState(false);
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
          "SELECT COUNT(*) AS c FROM tr_shiftlog WHERE status = 'open' OR clockOut IS NULL",
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
  if (!loggedIn) {
    return (
      <Stack.Navigator initialRouteName="Intro" screenOptions={screenOptions}>
        <Stack.Screen name="Intro" component={IntroScreen} options={{ title: t('title_welcome'), headerShown: false }} />
        <Stack.Screen name="Install" component={InstallScreen} options={{ title: t('title_claim') }} />
        <Stack.Screen name="SelectBranch" component={SelectBranchScreen} options={{ title: t('title_branch'), headerShown: false }} />
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
        key={shiftClosed ? 'shift-closed' : 'shift-ok'}
        initialRouteName={shiftClosed ? 'Shift' : 'Dashboard'}
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

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  useEffect(() => subscribeSession(() => setLoggedIn(getSession() !== null)), []);

  useEffect(() => {
    loadServerState().catch(() => {});
    initDb().catch(() => {});
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
    } else {
      stopRealtime();
    }
  }, [loggedIn]);

  if (!loaded) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navRef}
      onReady={() => {
        if (!showNavHook) return;
        // Hook verifikasi visual (dev only, aktif bila EXPO_PUBLIC_NAV_HOOK=1)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__NAV__ = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          go: (name: string, params?: any) => {
            if (getSession() === null) {
              loginDemo();
              setTimeout(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (navRef as any).navigate(name as never, params as never);
              }, 300);
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
      <GuardedStacks loggedIn={loggedIn} />
    </NavigationContainer>
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
