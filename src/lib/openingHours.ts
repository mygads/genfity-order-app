/**
 * SESI-R5-APP — jam operasional merchant dari GET pos-config terminal.
 * Putusan owner Q1: jam = buka-tutup order ONLINE customer saja; kasir
 * fleksibel + BANNER info TANPA blokir (NOL gate pada settle/create).
 *
 * KONTRAK BE (dipatok SESI-R5-BE, paralel):
 *   openingHours: [{dayOfWeek: int (0=Minggu..6=Sabtu, samakan dgn BE
 *   day_of_week), openTime: "HH:MM"|null, closeTime: "HH:MM"|null,
 *   isClosed: bool}]; merchant tanpa jam → [] (banner TIDAK tampil —
 *   jujur, bukan placeholder).
 *
 * Modul MURNI (nol-impor, erasable-only) agar dapat ditranspile + diuji
 * runtime oleh tripwire-opening-hours apa adanya (cermin paymentMethods).
 *
 * Semantik isOutsideOnlineHours (didokumentasikan; midnight-cross diputus):
 * - hours absen/bukan-array/kosong → FALSE (tak ada data = tak ada banner).
 * - Hari ini tanpa entry (tabel ada tapi hari tak terdaftar) → TRUE
 *   (konvensi tabel jam: hari tak terdaftar = tutup).
 * - Entry isClosed → TRUE.
 * - openTime+closeTime dua-dua null (entry ada, tak dikonfigurasi) → FALSE
 *   (buka seharian; jangan mengklaim tutup dari data parsial).
 * - Satu null → FALSE (konfigurasi parsial → jangan mengklaim tutup).
 * - closeTime > openTime (rentang normal): di luar bila now < open ATAU
 *   now >= close (tepat saat buka = di dalam; tepat saat tutup = di luar).
 * - closeTime <= openTime (rentang LEWAT TENGAH MALAM, mis. 22:00–02:00):
 *   di dalam bila now >= open ATAU now < close; di luar bila
 *   close <= now < open. Contoh: buka 22:00, tutup 02:00 → 23:00 di dalam,
 *   01:00 di dalam, 03:00 di luar, 21:00 di luar.
 */

/** Satu baris jam operasional harian (kontrak BE; null = tak dikonfigurasi). */
export interface OpeningHour {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

/** Default = tak ada data = banner tidak tampil (jujur, bukan placeholder). */
export const OPENING_HOURS_DEFAULT: OpeningHour[] = [];

/** Kunci pembungkus yang dipindai (kontrak `openingHours` + varian). */
const CONTAINER_KEYS = [
  'pos',
  'posBehavior',
  'posBehaviorSettings',
  'pos_behavior',
  'pb',
  'paymentSettings',
  'payment_settings',
  'settings',
];

/** Kunci array snapshot di dalam tiap kontainer. */
const SNAPSHOT_KEYS = ['openingHours', 'opening_hours'];

/** Tafsir satu nilai ke boolean; undefined = absen/tak-dikenal. */
function asBoolLoose(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return undefined;
    return v !== 0;
  }
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'ya' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'tidak' || s === 'no') return false;
  return undefined;
}

/** "HH:MM" 24-jam valid → menit-sejak-tengah-malam; selain itu null. */
function asMinutes(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** dayOfWeek kontrak 0=Minggu..6=Sabtu; string numerik ikut diterima. */
function asDay(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 6) return null;
  return n;
}

/** Sanitasi satu entry; rusak → null (entry dibuang, tabel tetap jalan). */
function cleanEntry(r: unknown): OpeningHour | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const day = asDay(o.dayOfWeek ?? o.day_of_week ?? o.day ?? o.weekday);
  if (day === null) return null;
  const openTime = asMinutes(o.openTime ?? o.open_time ?? o.open);
  const closeTime = asMinutes(o.closeTime ?? o.close_time ?? o.close);
  return {
    dayOfWeek: day,
    openTime: openTime === null ? null : String(o.openTime ?? o.open_time ?? o.open).trim().slice(0, 5),
    closeTime: closeTime === null ? null : String(o.closeTime ?? o.close_time ?? o.close).trim().slice(0, 5),
    isClosed: asBoolLoose(o.isClosed ?? o.is_closed ?? o.closed) === true,
  };
}

/** Kumpulkan array kandidat dari root + kontainer (toleran flat + nested). */
function collectArrays(root: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  for (const k of SNAPSHOT_KEYS) {
    if (Array.isArray(root[k])) out.push(root[k]);
  }
  for (const ck of CONTAINER_KEYS) {
    const c = root[ck];
    if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      for (const k of SNAPSHOT_KEYS) {
        if (Array.isArray(o[k])) out.push(o[k]);
      }
    }
  }
  return out;
}

/**
 * Parse murni snapshot jam operasional: toleran flat + nested + snake_case.
 * Tak pernah melempar; absen/rusak total = [] (banner tidak tampil).
 */
export function parseOpeningHours(raw: unknown): OpeningHour[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  const seen = new Map<number, OpeningHour>();
  for (const arr of collectArrays(root)) {
    for (const r of arr as unknown[]) {
      const e = cleanEntry(r);
      if (e && !seen.has(e.dayOfWeek)) seen.set(e.dayOfWeek, e);
    }
  }
  return [...seen.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

const WD_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Hari lokal 0=Minggu..6=Sabtu + menit-sejak-tengah-malam (tz opsional). */
function localDayAndMinutes(now: Date, timezone?: string): { day: number; minutes: number } {
  const tz = (timezone ?? '').trim();
  if (!tz) return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    let wd = '';
    let hh = 0;
    let mm = 0;
    for (const p of parts) {
      if (p.type === 'weekday') wd = p.value.toLowerCase().slice(0, 3);
      else if (p.type === 'hour') hh = Number(p.value) % 24;
      else if (p.type === 'minute') mm = Number(p.value);
    }
    const day = WD_SHORT.indexOf(wd);
    if (day < 0 || !Number.isFinite(hh) || !Number.isFinite(mm)) {
      return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
    }
    return { day, minutes: hh * 60 + mm };
  } catch {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

/**
 * TRUE bila `now` berada di luar jam order online (banner tampil).
 * Murni; tak pernah melempar (input asing = FALSE = tak ada banner).
 */
export function isOutsideOnlineHours(
  now: Date,
  hours: OpeningHour[] | null | undefined,
  timezone?: string,
): boolean {
  try {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false;
    if (!Array.isArray(hours) || hours.length === 0) return false;
    const { day, minutes } = localDayAndMinutes(now, timezone);
    const e = hours.find((h) => h && h.dayOfWeek === day);
    if (!e) return true;
    if (e.isClosed === true) return true;
    const open = asMinutes(e.openTime);
    const close = asMinutes(e.closeTime);
    if (open === null && close === null) return false;
    if (open === null || close === null) return false;
    if (close > open) return minutes < open || minutes >= close;
    return minutes >= close && minutes < open;
  } catch {
    return false;
  }
}
