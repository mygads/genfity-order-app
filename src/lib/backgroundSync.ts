// Background sync optional (2026-10-29): expo-task-manager + expo-background-fetch bila terpasang.
// Tanpa dep baru di package.json: dynamic require + fail-open. Foreground-only + EFF-09 + banner tetap jujur.
const TASK = 'genfity-sync-drain';
let registered = false;
export function backgroundTaskName(): string { return TASK; }
export function isBackgroundSyncAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tm = require('expo-task-manager') as { defineTask?: unknown };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bf = require('expo-background-fetch') as { registerTaskAsync?: unknown };
    return typeof tm?.defineTask === 'function' && typeof bf?.registerTaskAsync === 'function';
  } catch { return false; }
}
export async function registerBackgroundSync(): Promise<boolean> {
  if (registered || !isBackgroundSyncAvailable()) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tm = require('expo-task-manager') as { defineTask: (n: string, fn: () => Promise<unknown>) => void };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bf = require('expo-background-fetch') as { registerTaskAsync: (n: string, o: Record<string, unknown>) => Promise<void> };
    tm.defineTask(TASK, async () => {
      try {
        const { pendingCount, pushAll } = await import('./sync');
        if (pendingCount() > 0) await pushAll().catch(() => {});
      } catch { /* abaikan */ }
    });
    await bf.registerTaskAsync(TASK, { minimumInterval: 15 * 60, stopOnTerminate: false, startOnBoot: true });
    registered = true;
    return true;
  } catch { return false; }
}
