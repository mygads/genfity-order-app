/**
 * Antrean cetak persisten (C3 printer lane, menutup `printer-offline-queue-missing`).
 *
 * - Tabel `tr_printqueue(id, payload, target, status, createdAt)` didefinisikan
 *   di `lib/dbSchema.ts` (Wave1, HEADER TABEL SAJA); file ini adalah logika
 *   drain-nya. `initDb()` dipanggil di setiap entry agar instalasi lama ikut
 *   dapat tabelnya tanpa migrasi khusus.
 * - Kosakata status = outbox (`'antre' | 'cetak' | 'gagal'`), drain FIFO
 *   `ORDER BY createdAt ASC` (meniru `sync.ts`: baris gagal tidak menghentikan
 *   drain, dicoba lagi di drain berikut).
 * - `payload` = byte ESC/POS dalam base64 (via `escpos.toBase64/fromBase64`
 *   agar jalan di semua runtime); `target` = envelope JSON
 *   `{target, name, kind, label, retries}` — retry count tinggal di envelope
 *   karena skema Wave1 tidak punya kolom retry (tanpa ubah skema).
 * - ID = UUIDv7 (Q7, sama seperti outbox sync) — unik lintas-device.
 * - Politik: modul ini TIDAK mengimpor `lib/print.ts` (menghindari siklus
 *   import): target pengganti saat antrean butuh resolusi ulang (mis. antrean
 *   dibuat saat `no-printer`) disuntik pemanggil via `DrainDeps.resolveTarget`.
 */

import { all, initDb, queryFirst, run } from './db';
import { fromBase64, toBase64 } from './escpos';
import { printBytes, type PrinterTarget } from '../native/printer';
import { uuidv7 } from './uuidv7';

export type PrintQueueStatus = 'antre' | 'cetak' | 'gagal';

/** Batas coba ulang sebelum baris ditandai 'gagal' (tetap dicoba di drain berikut). */
export const PRINT_QUEUE_MAX_RETRIES = 5;

/** Jenis payload antrean (label audit, bukan routing). */
export type QueuedPrintKind = 'receipt' | 'kitchen' | 'queue' | 'raw';

/**
 * Envelope kolom `target`: target kirim + metadata + retry count.
 * `target: null` = antrean dibuat tanpa printer (no-printer); drain memakai
 * `DrainDeps.resolveTarget` (target aktif `print.ts`) saat mengurasnya.
 */
export interface PrintTargetEnvelope {
  target: PrinterTarget | null;
  name: string;
  kind: QueuedPrintKind;
  label: string;
  retries: number;
}

export interface QueuedPrintRow {
  id: string;
  payload: string;
  target: string;
  status: string;
  createdAt: string;
}

export interface DrainResult {
  attempted: number;
  sent: number;
  failed: number;
  remaining: number;
}

export interface DrainTarget {
  target: PrinterTarget;
  name: string;
}

export interface DrainDeps {
  /**
   * Pengirim byte (default `printBytes` modul native). Disuntik di uji agar
   * drain bisa diverifikasi tanpa hardware.
   */
  send?: (target: PrinterTarget, bytes: Uint8Array) => Promise<{ ok: boolean }>;
  /**
   * Resolusi target pengganti untuk baris tanpa target (dibuat saat
   * no-printer). `print.ts` mengisi dengan station-by-nama (petunjuk `hint`,
   * baris format lawas) lalu target aktif ter-scoping (terminalCode,
   * branchId); null = tetap antre, coba drain berikut.
   */
  resolveTarget?: (hint: { name: string; kind: QueuedPrintKind }) => Promise<DrainTarget | null>;
}

function envelopeOf(raw: string): PrintTargetEnvelope {
  const fb: PrintTargetEnvelope = {
    target: null,
    name: '',
    kind: 'raw',
    label: '',
    retries: 0,
  };
  if (!raw) return fb;
  const trimmed = raw.trim();
  if (trimmed && !trimmed.startsWith('{')) {
    // Format lawas (sebelum unifikasi antrean): kolom target = nama station
    // tampilan, bukan envelope JSON. Nama dipertahankan sebagai petunjuk
    // `resolveTarget`; baris sembuh-sendiri ke envelope saat drain berikut.
    return { ...fb, name: trimmed };
  }
  try {
    const p = JSON.parse(raw) as Partial<PrintTargetEnvelope>;
    const retries = Math.max(0, Math.floor(Number(p.retries) || 0));
    const t = p.target as PrinterTarget | null | undefined;
    const okTarget =
      t !== null &&
      t !== undefined &&
      typeof t === 'object' &&
      (t.transport === 'lan' ||
        t.transport === 'bt' ||
        t.transport === 'ble' ||
        t.transport === 'usb' ||
        // S10/PP-015: loopback = target sah (fixture/uji tanpa hardware).
        // Tanpa ini, cetak antre bertarget loopback kehilangan target saat
        // drain (jadi null → macet 'antre' selamanya, bukan 'gagal' jujur).
        t.transport === 'loopback');
    return {
      target: okTarget ? (t as PrinterTarget) : null,
      name: typeof p.name === 'string' ? p.name : '',
      kind:
        p.kind === 'receipt' ||
        p.kind === 'kitchen' ||
        p.kind === 'queue' ||
        p.kind === 'raw'
          ? p.kind
          : p.kind === 'queue-slip'
            ? 'queue' // label lawas → kanonis (tanpa ubah skema)
            : 'raw',
      label: typeof p.label === 'string' ? p.label : '',
      retries,
    };
  } catch {
    return fb;
  }
}

/**
 * Dekode kolom payload: format baru = base64 byte ESC/POS langsung; format
 * lawas (sebelum unifikasi) = JSON `{kind, bytesB64}`.
 * null = baris rusak — lewati tanpa menghentikan drain.
 */
function bytesOfPayload(raw: string): Uint8Array | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const p = JSON.parse(trimmed) as { bytesB64?: unknown };
      if (typeof p.bytesB64 === 'string' && p.bytesB64.length > 0) {
        const b = fromBase64(p.bytesB64);
        return b.length > 0 ? b : null;
      }
      return null;
    } catch {
      return null;
    }
  }
  try {
    const b = fromBase64(trimmed);
    return b.length > 0 ? b : null;
  } catch {
    return null;
  }
}

/**
 * Masukkan byte ESC/POS ke antrean persisten. Tak pernah menampilkan UI —
 * pemanggil (`lib/print.ts`) yang mengembalikan status pending ke layar.
 * Melempar bila SQLite gagal (pemanggil fallback ke Alert jujur).
 *
 * @returns id antrean (UUIDv7).
 */
export async function enqueuePrint(
  bytes: Uint8Array,
  target: PrinterTarget | null,
  opts?: { name?: string; kind?: QueuedPrintKind; label?: string },
): Promise<string> {
  await initDb();
  const id = uuidv7();
  const env: PrintTargetEnvelope = {
    target,
    name: (opts?.name ?? '').trim(),
    kind: opts?.kind ?? 'raw',
    label: (opts?.label ?? '').trim(),
    retries: 0,
  };
  await run(
    `INSERT INTO tr_printqueue (id, payload, target, status, createdAt)
     VALUES (?, ?, ?, 'antre', ?)`,
    [id, toBase64(bytes), JSON.stringify(env), new Date().toISOString()],
  );
  return id;
}

/** Jumlah cetakan yang belum keluar (status antre/gagal). Tak pernah melempar. */
export async function pendingPrintCount(): Promise<number> {
  try {
    await initDb();
    const row = await queryFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tr_printqueue WHERE status IN ('antre', 'gagal')`,
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Kuras antrean FIFO (`createdAt ASC`, maks 50 baris per drain — meniru batas
 * 200 baris `sync.ts` dengan nilai lebih kecil karena byte cetak berat).
 * Wiring saat ini (terverifikasi grep): HANYA piggyback tiap cetak sukses
 * (`lib/print.ts`:393,:443,:488). Belum ada wiring drain saat sukses
 * test-print `PrintersScreen.testPrintStation` (langsung `printBytes`,
 * tanpa drain) dan belum ada drain saat worker reconnect (milik lane
 * realtime). `pendingPrintCount` sudah diekspor dan DITAMPILKAN di
 * `SyncScreen` (baris `tr_printqueue`) — backlog cetak terlihat. Baris gagal ditandai
 * 'gagal' + retry count naik, drain lanjut (tidak berhenti). Tak melempar.
 */
export async function drainPrintQueue(deps?: DrainDeps): Promise<DrainResult> {
  const out: DrainResult = { attempted: 0, sent: 0, failed: 0, remaining: 0 };
  try {
    await initDb();
  } catch {
    return out;
  }
  let rows: QueuedPrintRow[] = [];
  try {
    rows = await all<QueuedPrintRow>(
      `SELECT id, payload, target, status, createdAt FROM tr_printqueue
       WHERE status IN ('antre', 'gagal') ORDER BY createdAt ASC LIMIT 50`,
    );
  } catch {
    return out;
  }
  const send = deps?.send ?? printBytes;
  for (const row of rows) {
    const bytes = bytesOfPayload(row.payload ?? '');
    if (!bytes) {
      // Baris rusak (payload tak bisa didekode dua format) — lewati tanpa
      // menghentikan drain; dicoba lagi di drain berikut bila sembuh.
      continue;
    }
    const env = envelopeOf(row.target ?? '');
    let target = env.target;
    let name = env.name;
    if (!target && deps?.resolveTarget) {
      try {
        const alt = await deps.resolveTarget({ name, kind: env.kind });
        if (alt) {
          target = alt.target;
          if (!name) name = alt.name;
        }
      } catch {
        /* abaikan — baris tetap antre */
      }
    }
    if (!target) {
      // Tanpa target (dibuat saat no-printer, printer belum dipair):
      // bukan gagal kirim — biarkan antre untuk drain berikut.
      continue;
    }
    out.attempted += 1;
    let ok = false;
    try {
      ok = (await send(target, bytes)).ok === true;
    } catch {
      ok = false;
    }
    try {
      if (ok) {
        await run(`UPDATE tr_printqueue SET status = 'cetak' WHERE id = ?`, [row.id]);
        out.sent += 1;
      } else {
        const retries = env.retries + 1;
        const status: PrintQueueStatus =
          retries >= PRINT_QUEUE_MAX_RETRIES ? 'gagal' : 'antre';
        await run(`UPDATE tr_printqueue SET target = ?, status = ? WHERE id = ?`, [
          JSON.stringify({ ...env, target, name, retries }),
          status,
          row.id,
        ]);
        out.failed += 1;
      }
    } catch {
      /* abaikan — hitungan attempted/sent/failed tetap jujur */
    }
  }
  out.remaining = await pendingPrintCount();
  return out;
}
