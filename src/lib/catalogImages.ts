/**
 * SESI-FINAL-APP K4: gambar katalog — TANPA dependensi baru.
 *
 * react-native bawaan menyediakan Image.prefetch(url) (cache disk RN) +
 * <Image source={{uri}}> dengan onError → pratinjau lokal graceful.
 * Tak ada endpoint menu gambar GO-terminal (hanya pull master ESB yang
 * mengisi ms_menu.imageUrl), jadi modul ini murni verifikasi + cache:
 * URL remote hanya dirender bila prefetch sukses; selain itu placeholder
 * lokal (tanpa ikon rusak, tanpa blokir alur).
 *
 * Murni + fail-closed: tanpa network/offline/timeout/URL-jelek = false,
 * tak pernah melempar.
 */
import { Image } from 'react-native';

const READY = new Set<string>();
const BAD = new Set<string>();
const MAX_CACHE = 500;

function cleanUrl(url: string | null | undefined): string {
  const u = String(url ?? '').trim();
  if (!/^https:\/\/.{1,2040}$/i.test(u)) return '';
  return u.slice(0, 2048);
}

function rememberReady(url: string): void {
  BAD.delete(url);
  READY.delete(url); // segarkan urutan insersi (FIFO)
  READY.add(url);
  if (READY.size > MAX_CACHE) {
    const oldest = READY.values().next().value as string | undefined;
    if (oldest) READY.delete(oldest);
  }
}

/** URL sudah terverifikasi prefetch sesi ini? (placeholder bila bukan.) */
export function isCatalogImageReady(url: string | null | undefined): boolean {
  const u = cleanUrl(url);
  return !!u && READY.has(u) && !BAD.has(u);
}

/** Tandai URL gagal render (<Image onError>) agar tak dirender remote lagi
 *  sesi ini (langsung placeholder). Tak pernah melempar. */
export function noteCatalogImageError(url: string | null | undefined): void {
  try {
    const u = cleanUrl(url);
    if (!u) return;
    READY.delete(u);
    BAD.add(u);
    if (BAD.size > MAX_CACHE) {
      const oldest = BAD.values().next().value as string | undefined;
      if (oldest) BAD.delete(oldest);
    }
  } catch {
    /* abaikan */
  }
}

/** Verifikasi URL gambar via Image.prefetch (cache disk RN) + timeout.
 *  true = boleh dirender remote; false = pakai placeholder lokal.
 *  Tak pernah melempar. */
export function prefetchCatalogImage(
  url: string | null | undefined,
  timeoutMs = 15000,
): Promise<boolean> {
  const u = cleanUrl(url);
  if (!u) return Promise.resolve(false);
  if (READY.has(u) && !BAD.has(u)) return Promise.resolve(true);
  if (BAD.has(u)) return Promise.resolve(false);
  const ms = Math.max(3000, Math.min(60000, Math.floor(timeoutMs) || 15000));
  return Promise.race([
    Image.prefetch(u).then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), ms);
    }),
  ])
    .then((ok) => {
      if (ok) rememberReady(u);
      return ok;
    })
    .catch(() => false);
}
