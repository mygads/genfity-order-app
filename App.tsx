import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colors } from './src/theme';
import type { RootStackParamList } from './src/navigation/types';
import { getSession, loginDemo, logout, subscribeSession } from './src/session';
import { initDb } from './src/lib/db';
import { loadServerState, getTerminal } from './src/config/server';
import { startRealtime, stopRealtime, onWsMessage } from './src/lib/realtime';
import { registerPushToken, notifyLocal } from './src/lib/push';

import IntroScreen from './src/screens/install/IntroScreen';
import InstallScreen from './src/screens/install/InstallScreen';
import SelectBranchScreen from './src/screens/install/SelectBranchScreen';
import InstallProgressScreen from './src/screens/install/InstallProgressScreen';
import CreatePinScreen from './src/screens/install/CreatePinScreen';
import ForgotPinScreen from './src/screens/install/ForgotPinScreen';
import LoginScreen from './src/screens/auth/LoginScreen';
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

const screenOptions = {
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: '#fff',
  headerTitleStyle: { fontFamily: 'HKGrotesk-Bold' },
  animation: 'default' as const,
};

/** Guard navigator: belum login hanya bisa buka alur intro/install/Login. */
function GuardedStacks({ loggedIn }: { loggedIn: boolean }) {
  if (!loggedIn) {
    return (
      <Stack.Navigator initialRouteName="Intro" screenOptions={screenOptions}>
        <Stack.Screen name="Intro" component={IntroScreen} options={{ title: 'Selamat Datang', headerShown: false }} />
        <Stack.Screen name="Install" component={InstallScreen} options={{ title: 'Klaim Terminal' }} />
        <Stack.Screen name="SelectBranch" component={SelectBranchScreen} options={{ title: 'Pilih Cabang' }} />
        <Stack.Screen name="InstallProgress" component={InstallProgressScreen} options={{ title: 'Menyiapkan', headerBackVisible: false }} />
        <Stack.Screen name="CreatePin" component={CreatePinScreen} options={{ title: 'Buat PIN', headerBackVisible: false }} />
        <Stack.Screen name="ForgotPin" component={ForgotPinScreen} options={{ title: 'Lupa PIN' }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Masuk', headerShown: false }} />
        <Stack.Screen name="WebView" component={WebViewScreen} options={{ title: 'Halaman Web', headerShown: false }} />
      </Stack.Navigator>
    );
  }
  return (
    <Stack.Navigator initialRouteName="Dashboard" screenOptions={screenOptions}>
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Masuk', headerShown: false }} />
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard', headerShown: false }} />
      <Stack.Screen name="Cashier" component={CashierScreen} options={{ title: 'Kasir', headerShown: false }} />
      <Stack.Screen name="CartDetail" component={CartDetailScreen} options={{ title: 'Detail Pesanan', headerShown: false }} />
      <Stack.Screen name="DineIn" component={DineInScreen} options={{ title: 'Dine In' }} />
      <Stack.Screen name="CustomMenu" component={CustomMenuScreen} options={{ title: 'Menu Custom' }} />
      <Stack.Screen name="LoadOrder" component={LoadOrderScreen} options={{ title: 'Order Tersimpan' }} />
      <Stack.Screen name="BillPreview" component={BillPreviewScreen} options={{ title: 'Pratinjau Bill' }} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} options={{ title: 'Struk' }} />
      <Stack.Screen name="Cancel" component={CancelScreen} options={{ title: 'Pembatalan' }} />
      <Stack.Screen name="Tables" component={TablesScreen} options={{ title: 'Meja', headerShown: false }} />
      <Stack.Screen name="Booking" component={BookingScreen} options={{ title: 'Booking', headerShown: false }} />
      <Stack.Screen name="Member" component={MemberScreen} options={{ title: 'Member', headerShown: false }} />
      <Stack.Screen name="Voucher" component={VoucherScreen} options={{ title: 'Voucher', headerShown: false }} />
      <Stack.Screen name="QrScan" component={QrScanScreen} options={{ title: 'Scan QR' }} />
      <Stack.Screen name="Pay" component={PayScreen} options={{ title: 'Pembayaran', headerShown: false }} />
      <Stack.Screen name="Qris" component={QrisScreen} options={{ title: 'QRIS', headerShown: false }} />
      <Stack.Screen name="Edc" component={EdcScreen} options={{ title: 'EDC', headerShown: false }} />
      <Stack.Screen
        name="Success"
        component={SuccessScreen}
        options={{ title: 'Berhasil', headerBackVisible: false }}
      />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Absensi' }} />
      <Stack.Screen name="Shift" component={ShiftScreen} options={{ title: 'Shift', headerShown: false }} />
      <Stack.Screen name="Recap" component={RecapScreen} options={{ title: 'Rekap Shift' }} />
      <Stack.Screen name="EndShift" component={EndShiftScreen} options={{ title: 'Tutup Shift', headerShown: false }} />
      <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Riwayat Transaksi', headerShown: false }} />
      <Stack.Screen name="EsbOrder" component={EsbOrderScreen} options={{ title: 'ESB Order' }} />
      <Stack.Screen name="Kitchen" component={KitchenScreen} options={{ title: 'Tiket Dapur' }} />
      <Stack.Screen name="Printers" component={PrintersScreen} options={{ title: 'Printer' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Pengaturan' }} />
      <Stack.Screen name="CustomerDisplay" component={CustomerDisplayScreen} options={{ title: 'Tampilan Pelanggan', headerShown: false }} />
      <Stack.Screen name="WebView" component={WebViewScreen} options={{ title: 'Halaman Web', headerShown: false }} />
      <Stack.Screen name="SplitBill" component={SplitBillScreen} options={{ title: 'Bagi Bill', headerShown: false }} />
      <Stack.Screen name="MoveItems" component={MoveItemsScreen} options={{ title: 'Pindah Item', headerShown: false }} />
      <Stack.Screen name="MoveTable" component={MoveTableScreen} options={{ title: 'Pindah Meja', headerShown: false }} />
      <Stack.Screen name="PromotionList" component={PromotionListScreen} options={{ title: 'Promo', headerShown: false }} />
      <Stack.Screen name="MenuPrinting" component={MenuPrintingScreen} options={{ title: 'Cetakan Menu' }} />
      <Stack.Screen name="Stock" component={StockScreen} options={{ title: 'Stok' }} />
      <Stack.Screen name="TableTimer" component={TableTimerScreen} options={{ title: 'Timer Meja' }} />
      <Stack.Screen name="Sync" component={SyncScreen} options={{ title: 'Sinkronisasi' }} />
      <Stack.Screen name="Log" component={LogScreen} options={{ title: 'Log' }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: 'Tentang' }} />
      <Stack.Screen name="Help" component={HelpScreen} options={{ title: 'Bantuan' }} />
      <Stack.Screen name="MenuManagement" component={MenuManagementScreen} options={{ title: 'Menu' }} />
      <Stack.Screen name="Idle" component={IdleScreen} options={{ title: 'Layar Idle', headerShown: false }} />
      <Stack.Screen name="TopupDeposit" component={TopupDepositScreen} options={{ title: 'Topup Deposit' }} />
      <Stack.Screen name="PettyCash" component={PettyCashScreen} options={{ title: 'Kas Kecil' }} />
      <Stack.Screen name="PettyCashForm" component={PettyCashFormScreen} options={{ title: 'Form Kas Kecil' }} />
      <Stack.Screen name="PettyCashDetail" component={PettyCashDetailScreen} options={{ title: 'Detail Kas Kecil' }} />
      <Stack.Screen name="Expense" component={ExpenseScreen} options={{ title: 'Pengeluaran' }} />
    </Stack.Navigator>
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
          'Order online baru',
          `Meja ${String(p.tableNo ?? '-')} · ${String(p.orderId ?? '')}`,
          { route: 'EsbOrder' },
        );
      }
      if (msg.type === 'FORCE_PULL') setLoggedIn(getSession() !== null);
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
