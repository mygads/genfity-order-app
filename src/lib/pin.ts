/**
 * PIN kasir: hash KDF + penyimpanan aman.
 *
 * CORONG TIGA PIN (AUDIT-ALIGNMENT-TERMINAL baris 5, paket app-model —
 * dokumentasi saja, tak ada perubahan format penyimpanan):
 * - PIN terminal = mengikat device↔terminal (sekali per device, bertahan
 *   melewati logout); disimpan sebagai Binding (session.ts) + kontrak
 *   terminalContract.ts — tak pernah plaintext.
 * - PIN staff = login, absensi, buka/tutup shift. verifyAttendancePin di bawah
 *   adalah BENIH corong ini (dipakai verifyLocalEscalation + alur absensi).
 * - PIN owner = eskalasi void/cancel/kompliment via authorizeSupervisor
 *   (lib/supervisor.ts -> supervisorApprove server); pemakaian tercatat/audit.
 * Satu hash per user saat ini dipakai semua jalur lokal (PARTIAL yang
 * diketahui); pemisahan kredensial penuh menunggu backend (paket be-terminal)
 * + alur login (paket app-login). Format record {salt, iter, hash} di bawah
 * TIDAK diubah paket ini.
 *
 * Aturan:
 * - PIN plaintext TIDAK PERNAH disimpan di mana pun (bukan di state
 *   persisten, bukan di AsyncStorage, bukan di body log).
 * - Yang disimpan hanya record {salt, iter, hash} via expo-secure-store bila
 *   tersedia; bila tidak tersedia (mis. web) jatuh ke AsyncStorage dengan
 *   penanda TODO agar build produksi memakai dev-client.
 * - Verifikasi login WAJIB revalidasi ke server (validateEmployee di
 *   lib/apiSource.ts) - hash lokal bukan satu-satunya gerbang.
 */

// expo-secure-store terdaftar di package.json (native + web).
import * as SecureStore from 'expo-secure-store';
import { initDb, query } from './db';
import { getItem, removeItem, setItem } from './storage';
import { randomHex as randomHexCsprng } from './uuidv7';

export interface PinRecord {
  v: number;
  iter: number;
  salt: string;
  hash: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// SHA-256 murni (tanpa dependensi baru) - input ASCII (PIN + salt hex).
// ---------------------------------------------------------------------------

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Hex(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    bytes.push(input.charCodeAt(i) & 0xff);
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // Panjang 64-bit big-endian (cukup 32-bit untuk PIN/salt pendek).
  bytes.push(0, 0, 0, 0);
  bytes.push(
    (bitLen >>> 24) & 0xff,
    (bitLen >>> 16) & 0xff,
    (bitLen >>> 8) & 0xff,
    bitLen & 0xff,
  );
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Array<number>(64);
  for (let c = 0; c < bytes.length; c += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] =
        (bytes[c + i * 4] << 24) |
        (bytes[c + i * 4 + 1] << 16) |
        (bytes[c + i * 4 + 2] << 8) |
        bytes[c + i * 4 + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0;
    let b = h1;
    let cc = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & cc) ^ (b & cc);
      const t2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = cc;
      cc = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + cc) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// KDF: salt acak + iterasi SHA-256 berantai.
// ---------------------------------------------------------------------------

const PIN_ITER = 2000;

function randomHex(len: number): string {
  // CSPRNG (Q7): salt PIN 64-bit tak boleh dari Math.random yang prediktabel.
  return randomHexCsprng(len);
}

/** Turunkan record hash dari PIN (PIN asli tidak dikembalikan). */
export function hashPin(pin: string, salt?: string): {
  salt: string;
  hash: string;
  iter: number;
} {
  const s = salt ?? randomHex(16);
  let h = sha256Hex(`${s}:${pin}`);
  for (let i = 1; i <= PIN_ITER; i += 1) {
    h = sha256Hex(`${h}:${pin}:${i}`);
  }
  return { salt: s, hash: h, iter: PIN_ITER };
}

/** Cocokkan PIN kandidat dengan record tersimpan (tanpa membocorkan PIN). */
export function verifyPinHash(pin: string, rec: PinRecord): boolean {
  if (!rec || rec.iter <= 0 || !rec.salt || !rec.hash) return false;
  const { hash } = hashPin(pin, rec.salt);
  if (hash.length !== rec.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) {
    diff |= hash.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  }
  return diff === 0;
}

function pinKey(userId: string): string {
  return `genfity.pin.${userId}`;
}

/**
 * Simpan hash PIN (bukan PIN) ke SecureStore; fallback AsyncStorage bila
 * SecureStore tak tersedia.
 * TODO: di web SecureStore memakai localStorage biasa - build produksi harus
 * memakai dev-client agar penyimpanan benar-benar terenkripsi OS-level.
 */
export async function savePinHash(userId: string, pin: string): Promise<void> {
  const r = hashPin(pin);
  const rec: PinRecord = {
    v: 1,
    iter: r.iter,
    salt: r.salt,
    hash: r.hash,
    updatedAt: new Date().toISOString(),
  };
  const raw = JSON.stringify(rec);
  const key = pinKey(userId);
  try {
    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.setItemAsync(key, raw);
      return;
    }
  } catch {
    /* jatuh ke fallback di bawah */
  }
  // TODO: SecureStore tidak tersedia - hash tersimpan di AsyncStorage biasa.
  await setItem(key, raw);
}

/** Muat record hash PIN; null bila belum pernah dibuat. */
export async function loadPinRecord(userId: string): Promise<PinRecord | null> {
  const key = pinKey(userId);
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (raw) return JSON.parse(raw) as PinRecord;
  } catch {
    /* coba fallback di bawah */
  }
  const fb = await getItem(key);
  if (!fb) return null;
  try {
    return JSON.parse(fb) as PinRecord;
  } catch {
    return null;
  }
}

/** Buang record hash PIN (SecureStore + fallback); idempoten, tak melempar. */
export async function removePinHash(userId: string): Promise<void> {
  const key = pinKey(userId);
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* lanjut ke fallback di bawah */
  }
  try {
    await removeItem(key);
  } catch {
    /* abaikan */
  }
}

export interface AttendanceVerify {
  /** true = cocok, false = user ada tapi PIN salah / throttle terkunci, null = tabel kosong/belum siap. */
  ok: boolean | null;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Attempt-throttle modul (R33, audit 2026-10-17): 5x salah beruntun mengunci
// 60 detik. Penghitung TERPISAH dari supervisor (PIN_ATTEMPTS_* di bawah,
// bukan LS_SUP_*). In-memory per proses — guard brute-force lokal, bukan
// otorisasi; kunci kedaluwarsa memberi jendela baru (decay).
// ---------------------------------------------------------------------------

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 60_000;

let pinAttempts = 0;
let pinLockedUntil = 0;

/** Sisa detik kunci throttle PIN; 0 bila tidak dikunci. */
export function pinLockRemainingSec(): number {
  return Math.max(0, Math.ceil((pinLockedUntil - Date.now()) / 1000));
}

export function isPinLocked(): boolean {
  return pinLockRemainingSec() > 0;
}

export function pinAttemptsLeft(): number {
  return Math.max(0, PIN_MAX_ATTEMPTS - pinAttempts);
}

/**
 * Verifikasi PIN absensi ke ms_posuser (RIW-05/17): cocokkan hash lokal
 * (SecureStore) untuk tiap user. R34 CLOSED (2026-10-17): cabang plaintext
 * legacy + auto-upgrade DIHAPUS — kolom pinHash/password ms_posuser selalu
 * NULL pasca-migrasi satu-kali (migrateLegacyPinColumns di lib/seed.ts, flag
 * ms_setting Security/PinMigrationV1) dan pull tak lagi menuliskannya
 * (master.ts). Tidak pernah melempar (gagal DB → null).
 */
export async function verifyAttendancePin(pin: string): Promise<AttendanceVerify> {
  const clean = pin.replace(/[^0-9]/g, '');
  if (!clean) return { ok: null };
  // Kunci kedaluwarsa memberi jendela baru (decay); kunci aktif menolak
  // TANPA verifikasi dan TANPA membakar attempt baru.
  if (pinLockedUntil !== 0 && !isPinLocked()) {
    pinAttempts = 0;
    pinLockedUntil = 0;
  }
  if (isPinLocked()) return { ok: false };
  try {
    await initDb();
    const users = await query<{ id: string }>('SELECT id FROM ms_posuser');
    if (users.length === 0) return { ok: null };
    for (const u of users) {
      try {
        const rec = await loadPinRecord(u.id);
        if (rec && verifyPinHash(clean, rec)) {
          pinAttempts = 0;
          pinLockedUntil = 0;
          return { ok: true, userId: u.id };
        }
      } catch {
        /* lanjut kandidat berikut */
      }
    }
    // HP-E2E-FIX (2026-10-24, E2E HP Xiaomi): user sesi kasir tak tercatat di
    // ms_posuser (master user milik Go; kontrak pull-user belum ada — pull
    // master tak membawa user, seed lokal hanya user demo). Sebelum menilai
    // PIN salah, coba userId sesi aktif: pasca-login-staged-B, PIN milik sesi
    // adalah identitas paling otoritatif. Import statis dilarang (session.ts
    // mengimpor pin.ts — siklus); dynamic import hanya di jalur fallback ini
    // (terbukti jalan di dev-client Hermes pada E2E HP).
    try {
      const { getSession, verifyGrantPin } = await import('../session');
      const sess = getSession();
      const sid = sess?.userId || sess?.username;
      // HP-E2E-FIX-3 (2026-10-24): grant aktif DULU — hash PIN sesi login ini
      // (staffPinHash) adalah pembanding paling otoritatif. Record
      // loadPinRecord di-seed completeLogin di bawah kunci s.userId yang
      // belum tentu sama dengan userId sesi berjalan ('2' vs email), sehingga
      // cuma-coba-satu-sid BISA MISS walau PIN benar (terbukti di E2E HP:
      // PIN sesi 5678 ditolak tutup-shift offline). verifyGrantPin tak
      // membakar tally PIN (jalur terpisah) dan mengembalikan userId sesi
      // yang cocok dengan baris absen U6 (userId ATAU cashierName).
      try {
        if (typeof verifyGrantPin === 'function' && verifyGrantPin(clean)) {
          if (sid) {
            pinAttempts = 0;
            pinLockedUntil = 0;
            return { ok: true, userId: sid };
          }
        }
      } catch {
        /* lanjut ke kandidat record di bawah */
      }
      for (const cand of [sess?.userId, sess?.username]) {
        if (!cand || cand === sid) continue;
        try {
          const rec = await loadPinRecord(cand);
          if (rec && verifyPinHash(clean, rec)) {
            pinAttempts = 0;
            pinLockedUntil = 0;
            return { ok: true, userId: cand };
          }
        } catch {
          /* lanjut kandidat berikut */
        }
      }
      if (sid) {
        const rec = await loadPinRecord(sid);
        if (rec && verifyPinHash(clean, rec)) {
          pinAttempts = 0;
          pinLockedUntil = 0;
          return { ok: true, userId: sid };
        }
      }
    } catch {
      /* lanjut ke penilaian PIN-salah di bawah */
    }
    // R34 CLOSED (2026-10-17): cabang plaintext legacy + auto-upgrade
    // DIHAPUS. Kolom pembanding kini selalu NULL (migrasi satu-kali
    // migrateLegacyPinColumns di lib/seed.ts + upsert master.ts yang
    // me-NULL-kan kolom legacy tiap pull); verifikasi murni via hash
    // SecureStore di atas.
    // PIN salah = tebakan → bakar 1 attempt; capai batas → kunci 60 detik.
    pinAttempts += 1;
    if (pinAttempts >= PIN_MAX_ATTEMPTS) pinLockedUntil = Date.now() + PIN_LOCK_MS;
    return { ok: false };
  } catch {
    // DB belum siap/gagal = BUKAN tebakan → jangan bakar attempt (fail-closed
    // tetap: null = tolak-lembut, pemanggil wajib menangani sebagai offline).
    return { ok: null };
  }
}
