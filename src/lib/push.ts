/**
 * Push notification: lokal langsung jalan (Expo Go OK), remote via
 * Expo Push Service setelah BE mengimplementasikan
 * `POST device/register-push` (lihat docs/API-CONTRACT.md §8).
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { apiPost } from '../config/server';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensurePushPermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

export async function getExpoPushToken(): Promise<string | null> {
  try {
    const ok = await ensurePushPermission();
    if (!ok) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('transaksi', {
        name: 'Transaksi',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const t = await Notifications.getExpoPushTokenAsync();
    return t.data;
  } catch {
    return null;
  }
}

/** Daftarkan token ke BE sendiri (kontrak §8). Gagal = abaikan (lokal tetap jalan). */
export async function registerPushToken(userId: string, terminalId: string): Promise<void> {
  const token = await getExpoPushToken();
  if (!token) return;
  try {
    await apiPost('device/register-push', {
      userId,
      terminalId,
      expoPushToken: token,
      platform: Platform.OS,
    });
  } catch {
    /* BE belum ada / offline — coba lagi saat sync */
  }
}

/** Notifikasi lokal: order online baru, sync warning, dsb. */
export async function notifyLocal(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: data ?? {} },
      trigger: null,
    });
  } catch {
    /* abaikan */
  }
}
