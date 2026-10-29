// Cashier idle-timeout 30 menit + PIN re-auth untuk aksi sensitif.
// Best-practice kasir: sesi 24h/7d absolute tetap, tapi peran kasir auto-lock
// setelah 30 menit tanpa aktivitas. Re-auth via PIN staff/manager yang sudah ada
// (posPinGate + supervisor), bukan logout penuh agar shift tidak hilang.
export const CASHIER_IDLE_MS = 30 * 60_000;
export const CASHIER_WARN_MS = 60_000; // 1 menit peringatan sebelum lock

let lastActivityAt = Date.now();
let lockListeners = new Set<(locked: boolean) => void>();
let warnListeners = new Set<(secondsLeft: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let warned = false;

export function touchCashierActivity() {
  lastActivityAt = Date.now();
  warned = false;
}

export function timeSinceCashierActivity(): number {
  return Date.now() - lastActivityAt;
}

export function isCashierIdleLocked(): boolean {
  return timeSinceCashierActivity() >= CASHIER_IDLE_MS;
}

export function secondsUntilCashierLock(): number {
  const left = CASHIER_IDLE_MS - timeSinceCashierActivity();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

export function onCashierLockChange(fn: (locked: boolean) => void): () => void {
  lockListeners.add(fn);
  return () => { lockListeners.delete(fn); };
}

export function onCashierLockWarning(fn: (secondsLeft: number) => void): () => void {
  warnListeners.add(fn);
  return () => { warnListeners.delete(fn); };
}

/** Start background checker; panggil sekali saat shift/kasir aktif. Idempotent. */
export function startCashierIdleWatcher(): void {
  if (timer) return;
  timer = setInterval(() => {
    const idleFor = timeSinceCashierActivity();
    const left = CASHIER_IDLE_MS - idleFor;
    if (left <= CASHIER_WARN_MS && left > 0) {
      const s = Math.ceil(left / 1000);
      warnListeners.forEach((fn) => { try { fn(s); } catch {} });
      warned = true;
    }
    if (left <= 0) {
      lockListeners.forEach((fn) => { try { fn(true); } catch {} });
    }
  }, 5000);
}

export function stopCashierIdleWatcher(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Setelah PIN re-auth sukses, buka kunci tanpa reset shift. */
export function unlockCashierAfterPin(): void {
  touchCashierActivity();
  lockListeners.forEach((fn) => { try { fn(false); } catch {} });
}
