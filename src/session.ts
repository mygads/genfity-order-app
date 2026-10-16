/**
 * Sesi kasir di memori + persistensi AsyncStorage (lib/storage.ts) agar
 * sesi bertahan restart di web + native. API tetap sinkron seperti semula.
 */
import { getItem, removeItem, setItem } from './lib/storage';

export interface Session {
  name: string;
  username: string;
  outlet: string;
  shift: string;
  clockIn: string;
  cash: number;
}

const DEMO: Session = {
  name: 'Gista',
  username: 'gista.kasir',
  outlet: 'ESB Cabang Poris',
  shift: 'Shift Pagi',
  clockIn: '08:57',
  cash: 200000,
};

const LS_SESSION = 'genfity.session.current';

let current: Session | null = null;
let restored = false;
type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function persist(): void {
  if (current) void setItem(LS_SESSION, JSON.stringify(current));
  else void removeItem(LS_SESSION);
}

/** Muat sesi tersimpan sekali di background; panggil emit bila ada. */
function restore(): void {
  if (restored) return;
  restored = true;
  void getItem(LS_SESSION).then((raw) => {
    if (!raw || current) return;
    try {
      current = JSON.parse(raw) as Session;
      emit();
    } catch {
      /* abaikan */
    }
  });
}

export function getSession(): Session | null {
  restore();
  return current;
}

export function isLoggedIn(): boolean {
  restore();
  return current !== null;
}

/** Simulasi login dev - tombol "Masuk Demo" di LoginScreen memanggil ini. */
export function loginDemo(): Session {
  restore();
  current = { ...DEMO };
  persist();
  emit();
  return current;
}

/**
 * Login karyawan tervalidasi server (T1): nama + username dari hasil
 * validateEmployee; outlet/shift/kas ikut sesi berjalan bila ada,
 * else default demo. loginDemo tetap ada untuk kompatibilitas alur lain.
 */
export function loginEmployee(e: { nama: string; username: string }): Session {
  restore();
  const base = current ?? DEMO;
  current = {
    ...base,
    name: e.nama.trim() || base.name,
    username: e.username.trim() || base.username,
  };
  persist();
  emit();
  return current;
}

export function logout(): void {
  current = null;
  postLoginRoute = null;
  persist();
  emit();
  // Matikan realtime + foreground service (pasangan startRealtime saat login).
  try {
    const { stopRealtime } = require('./lib/realtime') as typeof import('./lib/realtime');
    stopRealtime();
  } catch {
    /* abaikan */
  }
  try {
    const { setWsForeground } = require('./native/printer') as typeof import('./native/printer');
    void setWsForeground(false);
  } catch {
    /* abaikan */
  }
}

/**
 * Rute tujuan sekali-pakai setelah stack tamu -> authed berganti (mis. QrScan
 * dari kartu QR Login). Jangan navigate manual tepat setelah login: navigator
 * tamu tak mengenal rute authed sehingga NAVIGATE sinkron race dan error
 * "not handled by any navigator". GuardedStacks mengonsumsi ini sekali
 * saat stack authed mount; logout membuangnya.
 */
let postLoginRoute: string | null = null;

export function setPostLoginRoute(name: string): void {
  postLoginRoute = name;
}

export function takePostLoginRoute(): string | null {
  const r = postLoginRoute;
  postLoginRoute = null;
  return r;
}

/** Intip tanpa mengonsumsi (untuk jaring pengaman rute agar tak berebut target). */
export function peekPostLoginRoute(): string | null {
  return postLoginRoute;
}

export function subscribeSession(fn: Listener): () => void {
  restore();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
