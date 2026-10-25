/**
 * UUIDv7 (RFC 9562) + heks CSPRNG — tanpa dependensi baru.
 *
 * Keputusan Q7: PK sale/expense/outbox/doc = UUIDv7 (time-ordered, merge-safe
 * antar-device offline). Sumber acak UTAMA = CSPRNG
 * (`crypto.getRandomValues`).
 *
 * HP-E2E-FIX (2026-10-24, E2E HP Xiaomi): crypto.getRandomValues TAK ADA di
 * WebView/dev-client perangkat ini (probe: typeof === 'undefined') — THROW
 * Q7 mematikan SELURUH alur kasir (contract deviceId → LS_device, salt PIN,
 * UUID order/outbox). Fallback Math.random + console.warn (BUKAN diam-diam):
 * ID tetap time-ordered + 74-bit acak sehingga risiko tabrakan praktis nihil
 * untuk skala POS; jauh lebih aman dari crash. Bila target lain terbukti
 * sama, pasang `expo-crypto` dan isi randomBytes() dari sana.
 */

function randomBytes(n: number): Uint8Array {
  const g = globalThis as {
    crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  const fn = g.crypto?.getRandomValues?.bind(g.crypto);
  if (!fn) {
    // Fallback non-CSPRNG — lihat catatan Q7 di header (warn, tak diam-diam).
    // eslint-disable-next-line no-console
    console.warn('[uuidv7] crypto.getRandomValues tak tersedia — fallback Math.random (non-CSPRNG)');
    const buf = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) buf[i] = Math.floor(Math.random() * 256);
    return buf;
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
