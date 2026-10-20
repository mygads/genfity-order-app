/**
 * Resize bukti foto sebelum simpan (C11 EFF-08, menutup `unbounded-photo-growth`).
 *
 * Foto kamera 12MP (4000x3000, ~3-5MB) disimpan sebagai URI lokal untuk kas
 * kecil/Expense/arCR — tanpa resize, storage device + waktu backup membengkak
 * tanpa batas. Helper ini satu-satunya pintu resize: kecilkan ke lebar maks
 * (panjang mengikuti rasio) + JPEG terkompresi, dipakai ketiga call-site
 * picker (PettyCamera, PettyLibrary, Expense pickPhoto).
 *
 * Best-effort: gagal resize (modul belum ter-link di dev-client lama, dsb)
 * = kembalikan URI asli agar alur simpan tak putus. Tak pernah melempar.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Lebar maks bukti foto (panjang mengikuti rasio asli). */
export const RECEIPT_PHOTO_MAX_WIDTH = 1280;

/** Kompresi JPEG bukti foto (0-1; 0.7 = ~150-300KB untuk struk/kwitansi). */
export const RECEIPT_PHOTO_COMPRESS = 0.7;

/**
 * Kecilkan foto bukti ke lebar maks + JPEG terkompresi.
 *
 * @returns URI hasil resize, atau URI asli bila resize gagal.
 */
export async function shrinkReceiptPhoto(
  uri: string,
  maxWidth: number = RECEIPT_PHOTO_MAX_WIDTH,
): Promise<string> {
  try {
    if (!uri) return uri;
    const ref = await ImageManipulator.manipulate(uri)
      .resize({ width: maxWidth })
      .renderAsync();
    const out = await ref.saveAsync({
      compress: RECEIPT_PHOTO_COMPRESS,
      format: SaveFormat.JPEG,
    });
    return out?.uri || uri;
  } catch {
    return uri;
  }
}
