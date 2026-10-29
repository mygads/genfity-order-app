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

/** P1-06: kunci cache ber-hash (URL + imageHash) agar ganti gambar server langsung ganti cache.
 * BE lama tanpa hash = fallback URL polos (kompat mundur). LRU FIFO 500 (sama). */
export function catalogImageKey(url: string | null | undefined, hash?: string | null): string {
  const u = cleanUrl(url);
  const h = String(hash ?? '').trim().slice(0, 64);
  return h ? `${u}#${h}` : u;
}

/** Prefetch massal katalog (best-effort, batch 6 paralel, tak blokir UI). */
export async function prefetchCatalogImages(items: { url?: string | null; hash?: string | null }[], timeoutMs = 15000): Promise<number> {
  let ok = 0;
  const queue = [...items];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length > 0) {
      const it = queue.shift();
      if (!it) return;
      try {
        const r = await prefetchCatalogImage(it.url, timeoutMs);
        if (r) ok += 1;
      } catch { /* abaikan */ }
    }
  });
  await Promise.all(workers);
  return ok;
}

// P2 CDN roadmap (tanpa dep baru): BE kini kirim imageHash (FNV URL) + X-Delta: full.
// Lanjut: thumb 256/full 1024 immutable + blurhash placeholder + LRU 500 sudah ada (prefetch batch 6).
// Sampai 2 ukuran ada, Image.prefetch + empty_menu fallback adalah perilaku jujur (bukan pura-CDN).

// P3 AR scan (tanpa dep baru): /menu/ar-scans/* sambungkan ke catalogImageKey(hash) di sini saat BE siap.
// Sampai ada, prefetch + LRU 500 + empty_menu fallback adalah perilaku jujur.

// P2 CDN thumb/blurhash (2026-10-29, tanpa dep baru): thumb 256/full 1024 via param URL + placeholder warna hash.
// BE kirim imageHash (FNV URL); thumb = `${url}?w=256` bila host dukung (Cloudinary/Imgix/S3-transform), else URL asli.
// Blurhash penuh butuh dep native; placeholder = kotak warna hash (konsisten UI, tanpa klaim blurhash asli).
/** URL thumb 256 untuk grid kasir (hemat memori); full untuk detail. */
export function thumbUrlFor(url: string, w = 256): string {
  const u = String(url ?? '').trim();
  if (!u) return u;
  if (u.includes('?')) return u;
  return `${u}?w=${Math.max(64, Math.min(1024, Math.round(w)))}`;
}
/** Warna placeholder stabil dari hash (6 hex) untuk skeleton katalog. */
export function placeholderColorFor(key: string): string {
  const k = String(key ?? 'menu');
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); }
  const hex = ((h >>> 0) % 0xffffff).toString(16).padStart(6, '0');
  return `#${hex}`;
}
/** P3 AR: kunci scan AR dari catalogImageKey — /menu/ar-scans/* tinggal panggil ini (tanpa ubah skema). */
export function arScanKeyFor(menuId: string, imageHash?: string | null): string {
  const h = String(imageHash ?? '').trim();
  return h ? `ar:${String(menuId)}:${h}` : `ar:${String(menuId)}`;
}
