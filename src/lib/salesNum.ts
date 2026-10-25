/**
 * Nomor display tersegmen + gate terminal Q7 (SPEC §12) — pecahan dari
 * sales.ts (S2-C310). sales.ts mengimpor enqueue* dari sync.ts sedangkan
 * sync.ts mengimpor nextSalesNumRetry dari sales.ts (require-cycle dua arah);
 * fungsi nomor-display tinggal di sini agar sync.ts hanya mengimpor modul
 * daun ini. sales.ts mengimpor-ulang + mengekspor-ulang dari sini demi
 * kompatibilitas importir lama (layar kasir/POS, seed).
 * Daun murni: hanya config server + db — JANGAN impor ./sales, ./sync,
 * ./payments, atau ./display dari sini.
 */
import { getTerminal } from '../config/server';
import { initDb, query, queryFirst, run, withTransaction } from './db';
import { getItem } from './storage';

/**
 * Kode terminal kanonis Q7: unik per branch, kapital, maks 8 char (lebar
 * struk 58mm). Validasi penuh milik BE (create-terminal); klien hanya
 * menegakkan format sebelum menerbitkan nomor.
 */
export const TERMINAL_CODE_RE = /^[A-Z0-9]{1,8}$/;

export function normalizeTerminalCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

/** true bila device sudah terikat terminal valid — syarat boleh jualan (Q7). */
export function isTerminalBound(): boolean {
  const t = getTerminal();
  const term = normalizeTerminalCode(t.terminalCode);
  const branch = String(t.branchId ?? '').trim();
  return TERMINAL_CODE_RE.test(term) && branch.length > 0;
}

function terminalUnboundError(): Error {
  const e = new Error('Terminal belum diklaim - klaim terminal dulu sebelum jualan.');
  (e as { code?: string }).code = 'terminal-unbound';
  return e;
}

/**
 * Nomor display tersegmen Q7 (SPEC §12, inti dari nextSalesNum): menerbitkan
 * `TRX-{BRANCH}-{TERM}-{YYYYMMDD}-{NNNN}-{DEVTAG}` untuk branch+terminal eksplisit.
 * Melempar terminalUnboundError bila salah satunya kosong/invalid — tanpa
 * fallback B001. Counter harian per (terminalCode, tanggal) di tr_sales_seq,
 * transaksional, init dari MAX suffix lokal (format baru + adopsi format
 * lama hari ini); NNNN 4-digit zero-padded, overflow lanjut 5 digit alami.
 *
 * A-P2-10: segmen DEVTAG (4 hex kapital dari device-id stabil install,
 * cermin apiSource.getDeviceId; absen = '0000' = perilaku unik-seperti-dulu
 * untuk instalasi pra-device-id). DB lokal per-device sehingga counter NNNN
 * tak bisa koordinasi antar-device offline: tanpa DEVTAG, dua device di
 * terminal yang sama mencetak NNNN kembar lalu tabrakan di UNIQUE display_no
 * server (BE displayNo = string unik opaque, tanpa validasi format — aman
 * diperpanjang; tripwire-history hanya menuntut awalan ^TRX).
 */
/**
 * Tag device 4-hex kapital untuk segmen DEVTAG nomor display (A-P2-10).
 * Baca read-only kunci milik apiSource ('genfity.device.id', 16-hex stabil
 * per install — dibuat di alur install/login, selalu ada sebelum jualan
 * karena klaim terminal butuh login). Daun murni: tak impor apiSource
 * (hindari require-cycle); absen/invalid = '0000' (jujur, unik-seperti-dulu).
 */
export async function deviceTag(): Promise<string> {
  try {
    const cur = await getItem('genfity.device.id');
    if (cur && /^[0-9a-f]{16}$/.test(cur)) return cur.slice(0, 4).toUpperCase();
  } catch {
    /* storage gagal = fallback di bawah */
  }
  return '0000';
}

export async function nextDisplayNumber(branchCode: unknown, terminalCode: unknown): Promise<string> {
  const term = normalizeTerminalCode(terminalCode);
  const branch = String(branchCode ?? '').trim().toUpperCase();
  if (!TERMINAL_CODE_RE.test(term) || !branch) throw terminalUnboundError();
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  await initDb();
  // A-P2-10: tag dibaca SEKALI di luar transaksi (tetap untuk INSERT + return).
  const dev = await deviceTag();
  let n = 1;
  await withTransaction(async () => {
    const row = await queryFirst<{ lastN: number | null }>(
      'SELECT lastN FROM tr_sales_seq WHERE terminalCode = ? AND ymd = ?',
      [term, ymd],
    );
    if (row && Number.isFinite(Number(row.lastN))) {
      n = Math.max(1, Math.round(Number(row.lastN)) + 1);
    } else {
      // Init: MAX suffix untuk prefix baru + adopsi MAX format lama hari ini
      // (TRX-YYYYMMDD-NNN global-per-device, split -A/-B) agar tak mundur.
      // SEED-xxx / TRX-{timestamp} diabaikan (tak terparse = tak dihitung).
      let mx = 0;
      try {
        const heads = await query<{ salesNum: string | null }>('SELECT salesNum FROM tr_saleshead');
        const prefix = `TRX-${branch}-${term}-${ymd}-`;
        for (const h of heads) {
          const sn = String(h?.salesNum ?? '');
          if (sn.startsWith(prefix)) {
            const tail = sn.slice(prefix.length).split('-')[0];
            if (/^\d+$/.test(tail)) mx = Math.max(mx, parseInt(tail, 10) || 0);
          } else {
            const m = sn.match(/^TRX-(\d{8})-(\d+)(?:-[A-Z])?$/);
            if (m && m[1] === ymd) mx = Math.max(mx, parseInt(m[2], 10) || 0);
          }
        }
      } catch {
        /* tabel kosong - mulai dari 1 */
      }
      n = mx + 1;
    }
    await run(
      `INSERT INTO tr_sales_seq (terminalCode, ymd, lastN, deviceTag) VALUES (?, ?, ?, ?)
       ON CONFLICT (terminalCode, ymd) DO UPDATE SET lastN = excluded.lastN, deviceTag = excluded.deviceTag`,
      // Kolom deviceTag belum ada di instalasi lama sebelum migrasi jalan —
      // pernyataan ini dieksekusi SETELAH initDb (migrasi best-effort); bila
      // migrasi gagal total, INSERT 4-kolom melempar → tangkap pemanggil
      // (nextSalesNumRetry hanya retry konflik-unik; galat skema diteruskan
      // jujur, bukan nomor fiktif). Praktiknya migrasi ADD COLUMN idempoten.
      [term, ymd, n, dev],
    );
  });
  // A-P2-10: segmen DEVTAG di ekor (prefix lama utuh → adopsi-MAX + tripwire
  // ^TRX tak pecah; tail split('-')[0] tetap NNNN untuk format lama maupun baru).
  return `TRX-${branch}-${term}-${ymd}-${String(n).padStart(4, '0')}-${dev}`;
}

/**
 * Nomor display permanen Q7: TRX-{BRANCH}-{TERM}-{YYYYMMDD}-{NNNN}-{DEVTAG}.
 * NNNN = counter harian per (terminalCode, tanggal) di SQLite tr_sales_seq —
 * transaksional (ketuk-ganda tak bikin nomor ganda), tahan reinstall
 * (bukan AsyncStorage), init dari MAX suffix lokal yang tahan 4 format lama.
 * DEVTAG (A-P2-10) = 4-hex device agar dua device satu terminal tak kembar.
 * padStart(4), overflow >9999 lanjut 5 digit alami (UNIQUE server atas
 * string penuh; pecahan split -A/-B di atas satu NNN induk, T3-opsi-a).
 * ymd = kalender lokal; sale lewat tengah malam ikut ymd baru dengan
 * shiftId lama tetap menempel (T2-opsi-a).
 */
export async function nextSalesNum(): Promise<string> {
  const t = getTerminal();
  return nextDisplayNumber(t.branchId, t.terminalCode);
}

/**
 * Terbitkan nomor display dengan retry terbatas L2 (maks 3x): dua device
 * bisa menerbitkan nomor sama lalu tabrakan di PK/UNIQUE salesNum saat head
 * INSERT (balapan seq antar-device offline). Retry = terbitkan nomor segar
 * berikutnya. HANYA galat konflik (unique/conflict/constraint/locked) yang
 * di-retry; gate terminal-unbound dan galat lain langsung dilempar.
 */
export async function nextSalesNumRetry(attempts = 3): Promise<string> {
  let last: unknown = null;
  for (let i = 0; i < Math.max(1, attempts); i += 1) {
    try {
      return await nextSalesNum();
    } catch (e) {
      last = e;
      if ((e as { code?: string })?.code === 'terminal-unbound') throw e;
      const msg = String((e as Error)?.message ?? '');
      if (!/unique|conflict|constraint|busy|locked/i.test(msg)) throw e;
    }
  }
  throw last instanceof Error ? last : new Error('gagal menerbitkan nomor display');
}
