/**
 * Pembungkus Alert lintas-platform (S2-C308).
 *
 * `Alert.alert()` dari react-native-web adalah NO-OP di web sehingga semua
 * jalur failure yang memakainya sunyi total. Pembungkus ini meneruskan ke
 * `Alert.alert` di native, dan di web memancarkan permintaan ke
 * `AppAlertHost` (dipasang di App.tsx) yang menampilkannya sebagai Modal.
 * Tak pernah melempar.
 */
import { Alert, Platform, type AlertButton } from 'react-native';

/** Permintaan dialog yang dirender AppAlertHost di web. */
export interface AppAlertRequest {
  title: string;
  message?: string;
  buttons: AlertButton[];
  cancelable: boolean;
}

export type { AlertButton };

type Listener = (req: AppAlertRequest | null) => void;

const listeners = new Set<Listener>();
let current: AppAlertRequest | null = null;
const queue: AppAlertRequest[] = [];

function emit(): void {
  listeners.forEach((fn) => {
    try {
      fn(current);
    } catch {
      /* abaikan — satu pelanggan gagal tak boleh mematikan yang lain */
    }
  });
}

/** Langganan permintaan dialog aktif (dipakai AppAlertHost). */
export function subscribeAppAlert(fn: Listener): () => void {
  listeners.add(fn);
  // Kirim status terkini agar host yang baru mount langsung sinkron.
  try {
    fn(current);
  } catch {
    /* abaikan */
  }
  return () => {
    listeners.delete(fn);
  };
}

/** Tutup dialog aktif dan tampilkan antrean berikutnya bila ada. */
export function dismissAppAlert(): void {
  current = queue.shift() ?? null;
  emit();
}

/**
 * Pengganti `Alert.alert` di semua call-site: native terus ke Alert.alert,
 * web dirender sebagai Modal via AppAlertHost.
 */
export function appAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: { cancelable?: boolean },
): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons, options);
    return;
  }
  const req: AppAlertRequest = {
    title,
    message,
    buttons: buttons ?? [],
    cancelable: options?.cancelable !== false,
  };
  if (current) {
    // Satu dialog dalam satu waktu; sisanya antre berurutan.
    queue.push(req);
    return;
  }
  current = req;
  emit();
}
