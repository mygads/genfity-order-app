/**
 * SESI-FINAL-APP K5: codec backup/restore MURNI (TANPA dependensi baru).
 *
 * Repo TIDAK memiliki expo-clipboard / expo-file-system / expo-sharing di
 * package.json, dan aturan sesi melarang install dep baru + melarang
 * Share/file — sehingga jalur kirim/terima backup via clipboard BERSTATUS
 * PARKED jujur (entri Settings dinonaktifkan + berlabel needs-dep).
 *
 * Modul ini adalah fondasi yang sudah bisa diuji SEKARANG: envelope
 * berversi + builder/parser toleran + fail-closed (tak pernah melempar).
 * Sintaks disengaja ERASABLE-ONLY (interface + anotasi tipe + `as` saja;
 * tanpa enum/namespace/decorator/parameter-property) agar tripwire dapat
 * mentranspile + menguji roundtrip runtime dari sumber asli ini.
 *
 * Batas: payload ≤ BACKUP_MAX_BYTES, hanya objek JSON-safe di `data`,
 * version HARUS == BACKUP_CODEC_VERSION (masa depan: migrasi eksplisit).
 */

export interface BackupEnvelope {
  version: number;
  exportedAt: string;
  data: Record<string, unknown>;
}

export type BackupParseResult =
  | { ok: true; envelope: BackupEnvelope }
  | { ok: false; error: string };

export const BACKUP_CODEC_VERSION = 1;

/** Batas aman tempel clipboard antar-aplikasi (256 KB). */
export const BACKUP_MAX_BYTES = 256 * 1024;

/** Bangun string backup dari data JSON-safe. Tak pernah melempar. */
export function buildBackupPayload(
  data: Record<string, unknown> | null | undefined,
): string {
  try {
    const safe = (
      data !== null && typeof data === 'object' && !Array.isArray(data)
        ? data
        : {}
    ) as Record<string, unknown>;
    const envelope: BackupEnvelope = {
      version: BACKUP_CODEC_VERSION,
      exportedAt: new Date().toISOString(),
      data: safe,
    };
    return JSON.stringify(envelope);
  } catch {
    // JSON-safe dijamin pemanggil; fallback jujur = envelope kosong berversi.
    return JSON.stringify({
      version: BACKUP_CODEC_VERSION,
      exportedAt: '',
      data: {},
    } as BackupEnvelope);
  }
}

/** Urai string backup → envelope berversi. Toleran kunci asing, ketat versi
 *  + bentuk. Tak pernah melempar (gagal = { ok: false, error }). */
export function parseBackupPayload(
  text: string | null | undefined,
): BackupParseResult {
  try {
    if (typeof text !== 'string' || text.trim() === '') {
      return { ok: false, error: 'empty_payload' };
    }
    if (text.length > BACKUP_MAX_BYTES) {
      return { ok: false, error: 'too_large' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'bad_envelope' };
    }
    const env = parsed as Record<string, unknown>;
    if (env['version'] !== BACKUP_CODEC_VERSION) {
      return { ok: false, error: 'unsupported_version' };
    }
    if (env['data'] === null || typeof env['data'] !== 'object' || Array.isArray(env['data'])) {
      return { ok: false, error: 'bad_data' };
    }
    const exportedAt =
      typeof env['exportedAt'] === 'string' ? (env['exportedAt'] as string) : '';
    return {
      ok: true,
      envelope: {
        version: BACKUP_CODEC_VERSION,
        exportedAt,
        data: env['data'] as Record<string, unknown>,
      },
    };
  } catch {
    return { ok: false, error: 'parse_failed' };
  }
}
