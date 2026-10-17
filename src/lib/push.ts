/**
 * Push notification: lokal langsung jalan (Expo Go OK), remote via
 * Expo Push Service setelah BE mengimplementasikan
 * `POST device/register-push` (lihat docs/API-CONTRACT.md §8).
 */
import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ApiPath } from '../config/server';
import { getNotif } from '../config/device';
import { apiFetch, getApiMode } from './apiSource';

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

/** Daftarkan token ke BE sendiri (kontrak §8). Gagal = antre retry, bukan diam. */
export async function registerPushToken(userId: string, terminalId: string): Promise<void> {
  rememberPending(userId, terminalId);
  const token = await getExpoPushToken();
  if (!token) {
    // Izin/token belum ada - coba lagi saat sync sukses via retryPendingPushToken.
    schedulePushRetry();
    return;
  }
  // Token push + userId adalah data sensitif: hanya ke server sendiri
  // (Real Mode). Dummy Mode tidak mengirim apa pun ke luar perangkat.
  if (getApiMode() !== 'real') {
    clearPending();
    return;
  }
  try {
    await apiFetch(ApiPath.pushRegister, {
      body: { userId, terminalId, expoPushToken: token, platform: Platform.OS },
    });
    clearPending();
  } catch {
    /* BE belum ada / offline - coba lagi saat sync sukses */
    schedulePushRetry();
  }
}

/** Antrean retry token push yang gagal diam-diam sebelumnya. */
let pendingPush: { userId: string; terminalId: string } | null = null;
let pushRetry = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function pushBackoff(n: number): number {
  return Math.min(1000 * 2 ** n, 30000);
}

function rememberPending(userId: string, terminalId: string): void {
  pendingPush = { userId, terminalId };
}

function clearPending(): void {
  pendingPush = null;
  pushRetry = 0;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
}

function schedulePushRetry(): void {
  if (!pendingPush || pushTimer) return;
  pushRetry += 1;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void retryPendingPushToken();
  }, pushBackoff(pushRetry));
}

/**
 * Ulangi pendaftaran token push yang tertunda. Panggil setelah sync sukses
 * (pushAll terkirim > 0) agar token tak gagal diam-diam saat offline awal.
 * Best-effort: true bila tak ada antrean atau kirim sukses, false bila gagal.
 */
export async function retryPendingPushToken(): Promise<boolean> {
  if (!pendingPush) return true;
  if (getApiMode() !== 'real') return true;
  const { userId, terminalId } = pendingPush;
  try {
    const token = await getExpoPushToken();
    if (!token) {
      schedulePushRetry();
      return false;
    }
    await apiFetch(ApiPath.pushRegister, {
      body: { userId, terminalId, expoPushToken: token, platform: Platform.OS },
    });
    clearPending();
    return true;
  } catch {
    schedulePushRetry();
    return false;
  }
}

/** Alias eksplisit untuk dipanggil dari alur sync sukses. */
export function notifyPushSyncSuccess(): void {
  void retryPendingPushToken();
}

/** Target opsional notifikasi lokal (C1 dispatcher sadar-tag, SPEC §9). */
export interface NotifyTarget {
  /** Hanya bunyikan bila tag perangkat aktif cocok (lowercase); kosong = semua. */
  tag?: string;
  /** Alias tag (nama kontrak lain); tag menang bila keduanya terisi. */
  targetTag?: string;
  /** Minta getar bila preferensi per-tag mengizinkan (stub: default mati). */
  vibrate?: boolean;
}

/** Tag terminal aktif untuk gating notifikasi (sesi → binding → full_access). */
function activeTag(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sess = require('../session') as typeof import('../session');
    const st = sess.getSessionTag?.();
    if (st) return String(st).toLowerCase();
    const b = sess.getBinding?.()?.tag;
    if (b) return String(b).toLowerCase();
  } catch {
    /* abaikan — fallback full_access */
  }
  return 'full_access';
}

/**
 * STUB preferensi suara per-tag (realtime-09): kini mewarisi toggle global
 * Pengaturan "Bunyi order baru" (soundNewOrder) agar perilaku tak berubah.
 * Preferensi per-tag (kasir/dapur beda bunyi) dicolok di sini kelak tanpa
 * mengubah pemanggil — baca dari terminal-settings/server bila BE siap.
 */
export function isTagSoundEnabled(_tag?: string): boolean {
  try {
    return getNotif().soundNewOrder !== false;
  } catch {
    return true;
  }
}

/**
 * STUB preferensi getar per-tag (realtime-09): default MATI (perilaku
 * eksisting tanpa getar). Nyalakan per tag di sini kelak (mis. dapur bergetar
 * saat KITCHEN_TICKET) tanpa mengubah pemanggil.
 */
export function isTagVibrateEnabled(_tag?: string): boolean {
  return false;
}

/** Notifikasi lokal: order online baru, sync warning, dsb. Bunyi mengikuti
 *  toggle Pengaturan "Bunyi order baru" (soundNewOrder) agar "masuk dan bunyi"
 *  benar-benar terjadi saat ON dan diam saat OFF. Param ke-4 opsional:
 *  string tag atau {tag/targetTag, vibrate} — notifikasi untuk tag lain
 *  dibuang diam-diam (dispatcher realtime sudah memfilter WS; ini lapis kedua
 *  untuk panggilan langsung). */
export async function notifyLocal(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  tagOrOpts?: string | NotifyTarget,
): Promise<void> {
  try {
    const want = (
      typeof tagOrOpts === 'string' ? tagOrOpts : (tagOrOpts?.tag ?? tagOrOpts?.targetTag ?? '')
    ).trim().toLowerCase();
    const here = activeTag();
    if (want && here !== 'full_access' && here !== want) return;
    const soundOn = isTagSoundEnabled(here);
    const buzz =
      (typeof tagOrOpts === 'object' && tagOrOpts?.vibrate === true) || isTagVibrateEnabled(here);
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: data ?? {}, ...(soundOn ? { sound: 'default' as const } : {}) },
      trigger: null,
    });
    if (buzz) {
      try {
        Vibration.vibrate(300);
      } catch {
        /* getar best-effort */
      }
    }
  } catch {
    /* abaikan */
  }
}
