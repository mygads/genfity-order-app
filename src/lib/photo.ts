/**
 * SC-QA3 P5 (konvergen f52cfe2 kita + 7235cb0 sibling C11 EFF-08): satu-satunya
 * pintu resize foto bukti sebelum simpan/upload (kamera + galeri) — menutup
 * `unbounded-photo-growth` (foto 12MP+ membengkakkan SQLite + payload sync).
 *
 * Bentuk lengkap: resize maks-1280px sisi-terpanjang + JPEG 0.7, tanpa
 * upscale, orientasi dinormalkan pipeline decode→re-encode, fallback URI asli
 * + log jujur (tak pernah melempar), tanpa batas byte eksplisit (lihat
 * catatan di bawah). Tanpa duplikasi: helper kanonis = preparePhoto
 * (call-site Expense/PettyCash kamera+galeri sudah memakainya dengan
 * dimensi picker; Display/Idle/Queue/Attendance/Tables tak memakai foto).
 *
 * DELTA vs sibling (dipilih sadar, bukan salin buta):
 * - Nama preparePhoto dipertahankan (bukan shrinkReceiptPhoto) — call-site +
 *   tripwire-eff-battery sudah menguncinya; signature (uri, width?, height?)
 *   superset sibling (uri, maxWidth) karena butuh dimensi untuk no-upscale.
 * - require() malas + feature-detect dua API (legacy manipulateAsync +
 *   builder manipulate) — sibling import statis builder-only; bentuk kita
 *   tetap jalan bila modul belum ter-link di dev-client lama.
 * - No-upscale dipertahankan (sibling selalu resize ke 1280 = upscale foto
 *   kecil); dimensi tak diketahui = lewati, bukan tebak.
 *
 * APP hanya API BE (tanpa DB langsung dari helper ini); tanpa kunci i18n
 * baru (log di bawah log-dev, bukan teks UI); uang tak disentuh.
 */

/** Sisi-terpanjang maks foto bukti (kecil = URI asli, tanpa upscale). */
export const PHOTO_MAX_SIDE = 1280;

const MAX_SIDE = PHOTO_MAX_SIDE;

/** Kualitas JPEG bukti foto (0-1; 0.7 ≈ 150-300KB untuk struk/kwitansi). */
export const PHOTO_JPEG_QUALITY = 0.7;

/**
 * Resize sisi-terpanjang ke maks-1280px + JPEG terkompresi; kecil = URI asli
 * (tanpa upscale).
 *
 * Orientasi: output adalah JPEG yang di-encode ulang dari bitmap hasil
 * decode platform (decoder menerapkan tag orientasi EXIF saat decode),
 * sehingga foto portrait/landscape tersimpan tegak dan tag orientasi sumber
 * tak terbawa — tanpa opsi EXIF eksplisit (API manipulator tak menyediakannya;
 * JANGAN invent field di sini).
 *
 * Batas byte: SENGAJA tanpa cek ukuran file eksplisit — modul file-size
 * (expo-file-system) bukan dependensi repo; batas dimensi + JPEG 0.7 sudah
 * membatasi output pada orde ratusan KB. Tambah modul = keputusan owner +
 * rebuild native, di luar scope slice ini.
 *
 * Fallback fail-closed + log jujur: tanpa native module / gagal resize =
 * URI asli (perilaku lama) + console.warn agar kegagalan terlihat di log,
 * bukan diam. Tak pernah melempar.
 */
export async function preparePhoto(uri: string, width?: number, height?: number): Promise<string> {
  const src = String(uri ?? '').trim();
  if (!src) return src;
  try {
    const w = Math.round(Number(width) || 0);
    const h = Math.round(Number(height) || 0);
    if (w > 0 && h > 0 && Math.max(w, h) <= MAX_SIDE) return src;
    // Dimensi tak diketahui tapi file besar tetap coba resize aman (lebar
    // 1280 bisa upscale portrait — jadi tanpa dimensi = lewati, bukan tebak).
    if (!(w > 0 && h > 0)) {
      console.warn('[photo] dimensi tak diketahui — lewati resize, pakai URI asli');
      return src;
    }
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
        compress: PHOTO_JPEG_QUALITY,
        format: M.SaveFormat?.JPEG ?? 'jpeg',
      });
      const next = String(out?.uri ?? '').trim();
      if (!next) console.warn('[photo] resize legacy hasil kosong — pakai URI asli');
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
      if (!next) console.warn('[photo] resize builder hasil kosong — pakai URI asli');
      return next || src;
    }
    console.warn('[photo] expo-image-manipulator tak tersedia — pakai URI asli');
  } catch (e) {
    // Fallback + log jujur di bawah (return src); alur simpan tak putus.
    console.warn('[photo] resize gagal — pakai URI asli:', e instanceof Error ? e.message : e);
  }
  return src;
}
