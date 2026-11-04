// Cek pembaruan APK POS dari manifest yang diterbitkan CI (build-apk.yml,
// job publish-vps -> https://order.genfity.com/downloads/genfity-order.json).
// Offline-first: semua gagal jaringan = { available: false }, tanpa throw,
// agar kasir tetap bisa jualan tanpa internet.
import appJson from '../../app.json';

export const UPDATE_MANIFEST_URL =
  'https://order.genfity.com/downloads/genfity-order.json';
export const LATEST_APK_URL =
  'https://order.genfity.com/downloads/genfity-order.apk';

export type UpdateManifest = {
  version: string;
  commit: string;
  minimumSupportedVersion: string;
  signingCertificateSha256: string;
  apkSha256: string;
  downloadUrl: string;
};

export type UpdateCheck =
  | { available: true; version: string; downloadUrl: string }
  | { available: false; error: boolean };

export function getLocalVersion(): string {
  try {
    const v = (appJson as { expo?: { version?: string } })?.expo?.version;
    return typeof v === 'string' && v ? v : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Banding versi numerik per segmen: -1 (a<b), 0, 1 (a>b). Non-numerik diabaikan.
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export async function checkForAppUpdate(
  timeoutMs = 8000,
): Promise<UpdateCheck> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(UPDATE_MANIFEST_URL, { signal: ctrl.signal });
    if (!res.ok) return { available: false, error: true };
    const m = (await res.json()) as Partial<UpdateManifest>;
    if (!m || typeof m.version !== 'string' || !m.version) {
      return { available: false, error: true };
    }
    if (compareVersions(getLocalVersion(), m.version) < 0) {
      return {
        available: true,
        version: m.version,
        downloadUrl:
          typeof m.downloadUrl === 'string' && m.downloadUrl
            ? m.downloadUrl
            : LATEST_APK_URL,
      };
    }
    return { available: false, error: false };
  } catch {
    return { available: false, error: true };
  } finally {
    clearTimeout(timer);
  }
}
