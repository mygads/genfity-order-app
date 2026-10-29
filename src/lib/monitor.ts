// Crash monitor optional (2026-10-29): @sentry/react-native bila terpasang + SENTRY_DSN terisi.
// Tanpa keduanya = no-op jujur. Scrub PII: authToken/authKey/refreshToken/clientId/PIN tak pernah dikirim.
let enabled = false;
function scrub(v: unknown): unknown {
  try {
    const s = JSON.stringify(v);
    if (!s) return v;
    const cleaned = s.replace(/"(authToken|authKey|refreshToken|clientId|staffPin|pin)"\s*:\s*"[^"]*"/g, '"$1":"[redacted]"');
    return JSON.parse(cleaned);
  } catch { return '[unserializable]'; }
}
export function initMonitor(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native') as { init?: (o: Record<string, unknown>) => void };
    const dsn = String((process as unknown as { env?: Record<string, string> }).env?.SENTRY_DSN ?? '').trim();
    if (!dsn || typeof Sentry?.init !== 'function') return;
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
    enabled = true;
  } catch { enabled = false; }
}
export function reportError(err: unknown, ctx?: Record<string, unknown>): void {
  try {
    if (!enabled) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native') as { captureException?: (e: unknown, c?: unknown) => void };
    if (typeof Sentry?.captureException === 'function') Sentry.captureException(err, { extra: scrub(ctx ?? {}) });
  } catch { /* no-op */ }
}
export function isMonitorEnabled(): boolean { return enabled; }
