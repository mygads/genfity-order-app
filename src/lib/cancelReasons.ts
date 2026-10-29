/**
 * Preset alasan cancel/void/refund dari server (audit trisisi #5).
 *
 * Sumber kebenaran urutan: GET api/merchant/cancel-reasons (grup
 * /api/merchant, MerchantAuth — kasir/staff boleh baca) → baris lokal
 * ms_setting(Master, CancelReasons) → NOL preset server (pemanggil pakai
 * fallback hardcoded i18n).
 *
 * - Server (online): hanya is_active=true yang dipakai; nama di-trim,
 *   1-100 char, dedupe case-insensitive, urutan server dipertahankan
 *   (BE sudah ORDER BY merchant NULLS FIRST, sort_order, name).
 *   Hasil sukses (walau []) dipersist = server-wins-on-sync.
 * - Offline/gagal: baca cache; cache absen = {fromServer:false} agar
 *   pemanggil memakai fallback hardcoded (perilaku lama lestari).
 * - Modul TAK pernah melempar; tanpa markDirty (baris ini milik server).
 *
 * R4-DOCS(b) SoT CANCEL PRESET = ADVISORY: daftar di atas HANYA saran tombol
 * kasir — server menyimpan FREE-TEXT (CancelScreen menulis string `reason`
 * apa adanya + catatan opsional ke tr_cancelmenu.reasonId/reasonNote dan
 * POST order/finish void {reason}; tak divalidasi cocok preset). Preset boleh
 * usang/berbeda tanpa merusak void; JANGAN jadikan enum lateral
 * (allowlist penolakan) tanpa kontrak BE.
 */

import { ApiPath } from '../config/server';
import { apiFetch, getApiMode, unwrap } from './apiSource';
import { initDb, queryFirst, run } from './db';

/** Kunci cache snapshot preset server di ms_setting. */
export const CANCEL_REASON_CACHE_KEY1 = 'Master';
export const CANCEL_REASON_CACHE_KEY2 = 'CancelReasons';

/** Batas preset agar daftar tombol tak membanjiri layar kasir. */
export const MAX_SERVER_REASON_PRESETS = 50;

/** Panjang nama maksimum (cermin validasi BE validateOrderMasterName). */
const MAX_REASON_NAME_LENGTH = 100;

export interface CancelReasonPresetSource {
  /** Nama preset siap tampil (boleh [] bila server eksplisit kosong). */
  names: string[];
  /** true bila daftar berasal dari server/cache server (merchant-truth). */
  fromServer: boolean;
}

/**
 * Parse murni: saring baris cancel-reasons BE menjadi nama preset.
 * - Terima envelope {data:[...]} maupun array langsung.
 * - isActive===false dibuang (BE list sengaja memuat nonaktif untuk
 *   halaman CRUD admin; kasir hanya boleh yang aktif).
 * - isActive absen dianggap aktif (defensif; BE selalu mengirimnya).
 */
export function parseServerCancelReasonNames(data: unknown): string[] {
  const raw = data as { data?: unknown } | unknown[] | null | undefined;
  const rows = Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown } | null)?.data)
    ? ((raw as { data: unknown[] }).data)
    : [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const r = (row ?? {}) as Record<string, unknown>;
    if (r.isActive === false) continue;
    const name = String(r.name ?? '').trim();
    if (!name || name.length > MAX_REASON_NAME_LENGTH) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= MAX_SERVER_REASON_PRESETS) break;
  }
  return names;
}

/** Baca snapshot cache (null bila tak ada/rusak). */
export async function readCachedCancelReasonNames(): Promise<string[] | null> {
  try {
    await initDb();
    const row = await queryFirst<{ value1: string | null }>(
      `SELECT value1 FROM ms_setting WHERE key1 = ? AND key2 = ? LIMIT 1`,
      [CANCEL_REASON_CACHE_KEY1, CANCEL_REASON_CACHE_KEY2],
    );
    const raw = String(row?.value1 ?? '').trim();
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const names = parsed
      .map((v) => String(v ?? '').trim())
      .filter((v) => v.length > 0 && v.length <= MAX_REASON_NAME_LENGTH);
    return [...new Set(names.map((v) => v.toLowerCase()))].map(
      (k) => names.find((v) => v.toLowerCase() === k) ?? k,
    );
  } catch {
    return null;
  }
}

/** Persist snapshot server (server-wins; best-effort, tak melempar). */
async function persistCancelReasonNames(names: string[]): Promise<void> {
  try {
    await initDb();
    await run(
      `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES (?, ?, ?, ?)` +
        ` ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
      [CANCEL_REASON_CACHE_KEY1, CANCEL_REASON_CACHE_KEY2, JSON.stringify(names), new Date().toISOString()],
    );
  } catch {
    /* persist gagal: cache memori pemanggil tetap dipakai */
  }
}

/**
 * Ambil preset dari server SAJA (null bila offline/gagal — pemanggil lalu
 * baca cache). Sukses (termasuk []) dipersist + dikembalikan.
 */
export async function fetchServerCancelReasonNames(): Promise<string[] | null> {
  try {
    if (getApiMode() !== 'real') return null;
    const r = await apiFetch(ApiPath.merchantCancelReasons, { method: 'GET' });
    if (!r.ok || r.fromDummy) return null;
    const { data } = unwrap<unknown>(r.data);
    const names = parseServerCancelReasonNames(data);
    await persistCancelReasonNames(names);
    return names;
  } catch {
    return null;
  }
}

/**
 * Resolusi preset siap pakai layar kasir: server dulu, lalu cache,
 * lalu {names:[], fromServer:false} (= pemanggil pakai fallback i18n).
 */
export async function resolveCancelReasonPresets(verticalId?: unknown): Promise<CancelReasonPresetSource> {
  const online = await fetchServerCancelReasonNames().catch(() => null);
  if (online !== null) return { names: online, fromServer: true };
  const cached = await readCachedCancelReasonNames().catch(() => null);
  if (cached !== null) return { names: cached, fromServer: true };
  // Fase 3: fallback vertikal (server/cached kosong). Fashion: retur/tukar;
  // resto: salah input/dapur; jasa: jadwal ulang. Pemanggil tetap bisa tambah manual.
  try {
    const v = String(verticalId ?? '').trim().toUpperCase();
    if (v === 'FASHION') return { names: ['Retur 7 hari', 'Tukar size', 'Cacat produksi'], fromServer: false };
    if (v === 'SERVICE') return { names: ['Jadwal ulang', 'Komplain hasil'], fromServer: false };
    if (v === 'PULSA_DIGITAL') return { names: ['Salah nomor (refund)', 'Provider gangguan'], fromServer: false };
  } catch { /* abaikan */ }
  return { names: [], fromServer: false };
}
