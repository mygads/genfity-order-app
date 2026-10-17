/**
 * UUIDv7 (RFC 9562) + heks CSPRNG — tanpa dependensi baru.
 *
 * Keputusan Q7: PK sale/expense/outbox/doc = UUIDv7 (time-ordered, merge-safe
 * antar-device offline). Sumber acak WAJIB CSPRNG
 * (`crypto.getRandomValues`); bila tidak tersedia di runtime, THROW agar
 * kegagalan terlihat — jangan pernah fallback diam-diam ke Math.random
 * (audit 2026-10-17: UUID di atas Math.random menggugurkan jaminan unik
 * lintas-device yang menjadi fondasi Q7).
 *
 * Ketersediaan: Hermes (RN 0.86) + web (expo-sqlite) menyediakan
 * `globalThis.crypto.getRandomValues`. Bila probe runtime gagal di target
 * tertentu, tambah `expo-crypto` dan isi `randomBytes()` dari sana —
 * jangan tambal dengan Math.random.
 */

function randomBytes(n: number): Uint8Array {
  const g = globalThis as {
    crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  const fn = g.crypto?.getRandomValues?.bind(g.crypto);
  if (!fn) {
    throw new Error('CSPRNG tak tersedia (crypto.getRandomValues)');
  }
  const buf = new Uint8Array(n);
  fn(buf);
  return buf;
}

/** Heks acak CSPRNG sepanjang `len` char (salt PIN, deviceID, nonce). */
export function randomHex(len: number): string {
  const bytes = randomBytes(Math.ceil(len / 2));
  let s = '';
  for (let i = 0; i < bytes.length && s.length < len; i += 1) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s.slice(0, len);
}

/**
 * UUIDv7: 48-bit timestamp-ms big-endian + ver 0111 + 12-bit rand_a +
 * varian 10 + 62-bit rand_b (total 74 bit acak). Terurut waktu → indeks
 * SQLite/Postgres tetap performant (locality).
 */
export function uuidv7(): string {
  const now = Date.now();
  const rand = randomBytes(10);
  const b = new Uint8Array(16);
  // 48-bit timestamp big-endian (exact: Date.now() < 2^53).
  b[0] = Math.floor(now / 2 ** 40) & 0xff;
  b[1] = Math.floor(now / 2 ** 32) & 0xff;
  b[2] = Math.floor(now / 2 ** 24) & 0xff;
  b[3] = Math.floor(now / 2 ** 16) & 0xff;
  b[4] = Math.floor(now / 2 ** 8) & 0xff;
  b[5] = now & 0xff;
  // ver (0111) + 12-bit rand_a.
  b[6] = 0x70 | (rand[0] & 0x0f);
  b[7] = rand[1];
  // varian (10) + 62-bit rand_b.
  b[8] = 0x80 | (rand[2] & 0x3f);
  b[9] = rand[3];
  b[10] = rand[4];
  b[11] = rand[5];
  b[12] = rand[6];
  b[13] = rand[7];
  b[14] = rand[8];
  b[15] = rand[9];
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}
