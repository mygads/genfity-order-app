/**
 * EFF-08: foto kas/expense di-resize maks-1280px sisi-terpanjang sebelum
 * simpan/upload (kamera + galeri). Sebelumnya quality 0.5 TANPA resize —
 * foto resolusi penuh (12MP+) membengkakkan SQLite + payload sync.
 *
 * APP hanya API BE (tanpa DB langsung dari helper ini); tanpa kunci i18n
 * baru; uang tak disentuh. Fallback fail-closed: tanpa native module /
 * gagal resize = uri asli (perilaku lama), tak pernah melempar.
 */

const MAX_SIDE = 1280;

/** Resize sisi-terpanjang ke maks-1280px; kecil = uri asli (tanpa upscale). */
export async function preparePhoto(uri: string, width?: number, height?: number): Promise<string> {
  const src = String(uri ?? '').trim();
  if (!src) return src;
  try {
    const w = Math.round(Number(width) || 0);
    const h = Math.round(Number(height) || 0);
    if (w > 0 && h > 0 && Math.max(w, h) <= MAX_SIDE) return src;
    // Dimensi tak diketahui tapi file besar tetap coba resize aman (lebar
    // 1280 bisa upscale portrait — jadi tanpa dimensi = lewati, bukan tebak).
    if (!(w > 0 && h > 0)) return src;
    const action =
      w >= h ? { resize: { width: MAX_SIDE } } : { resize: { height: MAX_SIDE } };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const M = require('expo-image-manipulator') as {
      manipulateAsync?: (
        u: string,
        actions: unknown[],
        opts?: Record<string, unknown>,
      ) => Promise<{ uri?: string }>;
      SaveFormat?: { JPEG?: string };
      manipulate?: (u: string) => unknown;
    };
    if (M?.manipulateAsync) {
      const out = await M.manipulateAsync(src, [action], {
        compress: 0.7,
        format: M.SaveFormat?.JPEG ?? 'jpeg',
      });
      const next = String(out?.uri ?? '').trim();
      return next || src;
    }
    // API builder baru (bila legacy dihapus di SDK mendatang): feature-detect.
    if (typeof M?.manipulate === 'function') {
      const ctx = M.manipulate(src) as {
        resize?: (o: Record<string, number>) => unknown;
        renderAsync?: () => Promise<{ uri?: string }>;
      } | null;
      const sized =
        w >= h
          ? (ctx?.resize?.({ width: MAX_SIDE }) as typeof ctx)
          : (ctx?.resize?.({ height: MAX_SIDE }) as typeof ctx);
      const out = await sized?.renderAsync?.();
      const next = String(out?.uri ?? '').trim();
      return next || src;
    }
  } catch {
    /* fallback uri asli di bawah */
  }
  return src;
}
