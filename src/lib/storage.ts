/**
 * Wrapper AsyncStorage yang aman untuk web + native.
 *
 * - Di web, AsyncStorage memakai driver localStorage; di native memakai
 *   penyimpanan asinkron bawaan - pemanggil tidak perlu peduli platform.
 * - Setiap kegagalan (paket belum ter-link, storage penuh, mode privat)
 *   jatuh ke fallback memori agar alur kasir tidak pernah crash.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mem = new Map<string, string>();

/** Ambil string; null bila tidak ada / gagal. */
export async function getItem(key: string): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(key);
    if (v !== null) {
      mem.set(key, v);
      return v;
    }
  } catch {
    /* abaikan - pakai fallback memori di bawah */
  }
  return mem.get(key) ?? null;
}

/** Simpan string; selalu mengisi cache memori walau AsyncStorage gagal. */
export async function setItem(key: string, value: string): Promise<void> {
  mem.set(key, value);
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    /* abaikan - nilai tetap tersedia di memori sesi ini */
  }
}

/** Hapus kunci dari AsyncStorage dan cache memori. */
export async function removeItem(key: string): Promise<void> {
  mem.delete(key);
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* abaikan */
  }
}

/** Ambil JSON; kembalikan `fallback` bila kosong / rusak / gagal. */
export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Simpan nilai sebagai JSON. */
export async function setJSON(key: string, value: unknown): Promise<void> {
  try {
    await setItem(key, JSON.stringify(value));
  } catch {
    /* abaikan - setItem sudah menelan galatnya sendiri */
  }
}
