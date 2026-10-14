import { Alert, Platform } from 'react-native';

/**
 * Cetak struk ke printer.
 * Web (Expo web / verifikasi Playwright): buka dialog cetak OS sehingga
 * kasir bisa mencetak ke printer USB/LAN/PDF — ini "cetak nyata" sejauh
 * yang dimungkinkan tanpa driver BT/USB native.
 * Native: teruskan ke antrean printer default (mock) via dialog konfirmasi.
 */
export function printReceipt(printerName = 'Printer Kasir'): void {
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof window.print === 'function'
  ) {
    window.print();
    return;
  }
  Alert.alert('Cetak Struk', `Struk dikirim ke ${printerName}.`);
}

/**
 * Bagikan ringkasan struk: Web Share API → clipboard → dialog fallback.
 * Diam bila pengguna membatalkan dialog share.
 */
export async function shareReceipt(text: string): Promise<void> {
  const nav = (globalThis as unknown as {
    navigator?: {
      share?: (d: { title: string; text: string }) => Promise<void>;
      clipboard?: { writeText: (t: string) => Promise<void> };
    };
  }).navigator;
  try {
    if (nav?.share) {
      await nav.share({ title: 'Struk ESB POSLite', text });
      return;
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      Alert.alert('Disalin', 'Ringkasan struk disalin ke clipboard.');
      return;
    }
  } catch {
    return;
  }
  Alert.alert('Bagikan Struk', text);
}
