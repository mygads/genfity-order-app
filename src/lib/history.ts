/**
 * Riwayat penjualan dari SQLite (RIW-01/02): baca tr_saleshead + item +
 * pembayaran, dan persist void ke tr_cancelmenu. Bentuk baris dipetakan ke
 * tipe `Transaction` (src/data/mock.ts) agar layar tidak berubah.
 */
import { ApiPath } from '../config/server';
import { getSession } from '../session';
import { initDb, markClean, query, queryFirst, run } from './db';
import { enqueueOutbox, enqueueSync, postImmediate } from './sync';
import { fmtSalesDate } from './datefmt';
import { uuidv7 } from './uuidv7';
import type { Transaction, TxnStatus } from '../data/mock';

/** Formatter tanggal kanonik pindah ke lib/datefmt (locale-aware id/en). */
export { fmtSalesDate };

/** salesMode kontrak (DINE_IN/…) → label kartu ('Dine In', …). */
export function modeLabel(salesMode?: string | null): string {
  const k = (salesMode ?? '').toUpperCase();
  if (/DINE/.test(k)) return 'Dine In';
  if (/TAKE/.test(k)) return 'Take Away';
  if (/DELIVER/.test(k)) return 'Delivery';
  if (!k) return 'Dine In';
  return k.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

function dbStatus(s?: string | null): TxnStatus {
  if (s === 'void') return 'Void';
  if (s === 'paid') return 'Selesai';
  return 'Batal';
}

interface HeadRow {
  salesNum: string;
  salesDate: string | null;
  salesMode: string | null;
  tableNo: string | null;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  grandTotal: number | null;
  paymentMethod: string | null;
  cashierName: string | null;
  status: string | null;
}

interface ItemRow {
  menuName: string | null;
  qty: number | null;
  price: number | null;
  note: string | null;
}

/**
 * Muat riwayat terbaru dari DB. Gagal/DB kosong → [] (layar memakai
 * fallback demo). Tidak pernah melempar.
 */
export async function loadHistory(limit = 300): Promise<Transaction[]> {
  try {
    await initDb();
    const heads = await query<HeadRow>(
      `SELECT salesNum, salesDate, salesMode, tableNo, subtotal, discount, tax,
              grandTotal, paymentMethod, cashierName, status
       FROM tr_saleshead ORDER BY salesDate DESC LIMIT ?`,
      [Math.max(1, limit)],
    );
    const out: Transaction[] = [];
    for (const h of heads) {
      let items: ItemRow[] = [];
      let pay: { paymentMethod: string | null } | null = null;
      try {
        items = await query<ItemRow>(
          'SELECT menuName, qty, price, note FROM tr_salesmenu WHERE salesNum = ?',
          [h.salesNum],
        );
      } catch {
        /* abaikan */
      }
      try {
        pay = await queryFirst<{ paymentMethod: string | null }>(
          'SELECT paymentMethod FROM tr_salespayment WHERE salesNum = ? LIMIT 1',
          [h.salesNum],
        );
      } catch {
        /* abaikan */
      }
      const { date, time } = fmtSalesDate(h.salesDate ?? '');
      out.push({
        id: h.salesNum,
        no: h.salesNum,
        date,
        time,
        cashier: h.cashierName ?? '-',
        ...(h.tableNo ? { table: h.tableNo } : {}),
        mode: modeLabel(h.salesMode),
        items: items.map((it) => ({
          name: it.menuName ?? '-',
          qty: Math.round(it.qty ?? 0),
          price: Math.round(it.price ?? 0),
          ...(it.note ? { note: it.note } : {}),
        })),
        subtotal: Math.round(h.subtotal ?? 0),
        discount: Math.round(h.discount ?? 0),
        tax: Math.round(h.tax ?? 0),
        total: Math.round(h.grandTotal ?? 0),
        payment: pay?.paymentMethod ?? h.paymentMethod ?? 'Tunai',
        status: dbStatus(h.status),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Void penuh: head → 'void' + satu baris tr_cancelmenu per item + outbox/sync
 * + POST server bila online. Tidak pernah melempar.
 * approvedBy = userId penyetuju eskalasi (bila diketahui dari hasil
 * verifyLocalEscalation); fallback = sesi kasir. Tanpa ini jejak audit selalu
 * menuduh kasir padahal supervisor yang menyetujui.
 */
export async function persistVoidDb(salesNum: string, reason: string, approvedBy?: string): Promise<void> {
  const now = new Date().toISOString();
  // Kolom userId wajib id user (bukan nama tampilan) — selaras saveSale.
  // Utamakan penyetuju eskalasi yang diketahui, bukan sesi kasir.
  const approver = String(approvedBy ?? '').trim();
  const userId = approver || (getSession()?.userId || getSession()?.username || '').trim();
  try {
    await initDb();
    // Idempotensi + gerbang stok: void ganda (mis. CancelScreen lalu History)
    // tak boleh mengembalikan stok/kuota/deposit dua kali; stok hanya kembali
    // bila saveSale pernah jalan (kaki bayar ada) — bill 'open' tanpa bayar
    // tak pernah memotong stok.
    let preStatus = '';
    let preTableNo: string | null = null;
    let payCount = 0;
    let paidTotal = 0;
    try {
      const pre = await queryFirst<{ status: string | null; tableNo: string | null }>(
        'SELECT status, tableNo FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
        [salesNum],
      );
      preStatus = String(pre?.status ?? '');
      preTableNo = pre?.tableNo ?? null;
    } catch {
      /* abaikan */
    }
    try {
      const pc = await queryFirst<{ c: number | null }>(
        'SELECT COUNT(*) AS c FROM tr_salespayment WHERE salesNum = ?',
        [salesNum],
      );
      payCount = Math.max(0, Math.round(Number(pc?.c) || 0));
      const ps = await queryFirst<{ s: number | null }>(
        'SELECT COALESCE(SUM(amount), 0) AS s FROM tr_salespayment WHERE salesNum = ?',
        [salesNum],
      );
      paidTotal = Math.max(0, Math.round(Number(ps?.s) || 0));
    } catch {
      /* abaikan */
    }
    const alreadyVoid = preStatus === 'void';
    const stockBack = !alreadyVoid && (preStatus === 'paid' || payCount > 0);
    await run(
      `UPDATE tr_saleshead SET status = 'void', grandTotal = 0, paidAmount = 0, updatedAt = ?, syncDate = NULL
       WHERE salesNum = ?`,
      [now, salesNum],
    );
    let items: { id: string; menuId: string | null; menuName: string | null; qty: number | null }[] = [];
    try {
      items = await query(
        'SELECT id, menuId, menuName, qty FROM tr_salesmenu WHERE salesNum = ?',
        [salesNum],
      );
    } catch {
      /* abaikan */
    }
    // Idempotensi baris: void ganda tak boleh menulis tr_cancelmenu dua kali
    // (head zeroing di atas idempoten, tapi INSERT baris tidak).
    if (!alreadyVoid) {
    for (const it of items) {
      try {
        const cid = uuidv7();
        await run(
          `INSERT INTO tr_cancelmenu (id, salesNum, menuId, menuName, qty,
            reasonId, reasonNote, userId, cancelDate, syncDate)
           VALUES (?, ?, ?, ?, ?, 'VOID', ?, ?, ?, NULL)`,
          [
            cid,
            salesNum, it.menuId, it.menuName, it.qty ?? 0,
            reason, userId || null, now,
          ],
        );
        try {
          await enqueueOutbox('tr_cancelmenu', cid, 'insert');
        } catch {
          /* abaikan */
        }
      } catch {
        /* abaikan */
      }
    }
    }
    // Balikan void (bug G7: sebelumnya void hanya menandai head). Best-effort
    // per bagian: kegagalan satu bagian tak menggagalkan void.
    let vHead: { branchId: string | null; memberId: string | null; voucherCode: string | null } | null = null;
    try {
      vHead = await queryFirst<{ branchId: string | null; memberId: string | null; voucherCode: string | null }>(
        'SELECT branchId, memberId, voucherCode FROM tr_saleshead WHERE salesNum = ?',
        [salesNum],
      );
    } catch {
      /* abaikan */
    }
    // 1) Stok kembali + buka flag habis bila qty pulih — hanya bila saveSale
    // pernah jalan (stockBack); bill open tanpa kaki bayar tak memotong stok.
    for (const it of (stockBack ? items : [] as typeof items)) {
      try {
        const branch = vHead?.branchId;
        const backQty = Math.max(0, Math.round(Number(it.qty) || 0));
        if (branch && it.menuId && backQty > 0) {
          await run(
            'UPDATE ms_branchmenu SET qty = qty + ?, syncDate = NULL WHERE branchId = ? AND menuId = ? AND qty IS NOT NULL',
            [backQty, branch, it.menuId],
          );
          await run(
            'UPDATE ms_branchmenu SET flagSoldOut = 0, syncDate = NULL WHERE branchId = ? AND menuId = ? AND qty IS NOT NULL AND qty > 0 AND flagSoldOut = 1',
            [branch, it.menuId],
          );
          try {
            await enqueueOutbox('ms_branchmenu', `${branch}:${it.menuId}`, 'update');
          } catch {
            /* abaikan */
          }
        }
      } catch {
        /* abaikan */
      }
    }
    // 2) Kuota voucher kembali + status available lagi — HANYA untuk kode
    // yang benar-benar terbakar (usage 'burn'). Yang 'rejected' tak pernah
    // menyentuh kuota sehingga tak boleh +1 (backstop saveSale #1/#2).
    // Ambil dari usage agar kaki tender ikut pulih, bukan cuma head.
    // Void ganda (head sudah 'void') = lewati agar tak +1 dua kali.
    if (!alreadyVoid) try {
      const burned = await query<{ voucherCode: string | null }>(
        `SELECT DISTINCT voucherCode FROM tr_salesvoucherusage
         WHERE salesNum = ? AND status = 'burn'`,
        [salesNum],
      );
      for (const b of burned) {
        const code = String(b.voucherCode ?? '').trim();
        if (!code) continue;
        await run(
          `UPDATE ms_voucher SET quota = quota + 1, status = 'available', syncDate = NULL
            WHERE UPPER(voucherCode) = UPPER(?)`,
          [code],
        );
        try {
          await enqueueOutbox('ms_voucher', code.toUpperCase(), 'update');
        } catch {
          /* abaikan */
        }
      }
    } catch {
      /* abaikan */
    }
    // 3) Deposit kembali ke saldo member + ledger refund (lewati bila void ganda).
    if (!alreadyVoid) try {
      if (vHead?.memberId) {
        const pays = await query<{ paymentMethod: string | null; amount: number | null }>(
          'SELECT paymentMethod, amount FROM tr_salespayment WHERE salesNum = ?',
          [salesNum],
        );
        const depBack = Math.round(
          pays
            .filter((p) => /deposit/i.test(p.paymentMethod ?? ''))
            .reduce((a, p) => a + Math.max(0, Number(p.amount) || 0), 0),
        );
        if (depBack > 0) {
          const cur = await queryFirst<{ depositBalance: number | null }>(
            'SELECT depositBalance FROM ms_member WHERE id = ? LIMIT 1',
            [vHead.memberId],
          );
          const after = Math.max(0, Math.round(Number(cur?.depositBalance) || 0)) + depBack;
          await run('UPDATE ms_member SET depositBalance = ?, syncDate = NULL WHERE id = ?', [after, vHead.memberId]);
          try {
            await enqueueOutbox('ms_member', vHead.memberId, 'update');
          } catch {
            /* abaikan */
          }
          const rid = uuidv7();
          await run(
            `INSERT INTO tr_memberdeposit (id, memberId, branchId, trxType, amount, balanceAfter, userId, trxDate, syncDate)
             VALUES (?, ?, ?, 'refund', ?, ?, ?, ?, NULL)`,
            [rid, vHead.memberId, vHead.branchId ?? null, depBack, after, userId || null, now],
          );
          try {
            await enqueueOutbox('tr_memberdeposit', rid, 'insert');
          } catch {
            /* abaikan */
          }
          try {
            enqueueSync('other', { kind: 'deposit-refund', memberId: vHead.memberId, nominal: depBack });
          } catch {
            /* abaikan */
          }
        }
      }
    } catch {
      /* abaikan */
    }
    // 4) Tiket dapur disembunyikan (loader Kitchen melewati status Batal; lewati bila void ganda).
    if (!alreadyVoid) try {
      await run(`UPDATE tr_kitchenticket SET status = 'Batal', updatedAt = ?, syncDate = NULL WHERE salesNum = ?`, [now, salesNum]);
      try {
        await enqueueOutbox('tr_kitchenticket', `kt-${salesNum}`, 'update');
      } catch {
        /* abaikan */
      }
    } catch {
      /* abaikan (dapur) */
    }
    // 5) Bersih-bersih finansial void penuh (paritas CancelScreen): baris
    // Refund negatif agar SUM payment = 0 + meja dibebaskan bila tak dipakai
    // bill 'open' lain (agar tak membebaskan meja order baru).
    if (!alreadyVoid) try {
      if (paidTotal > 0) {
        const rid = uuidv7();
        await run(
          `INSERT INTO tr_salespayment (id, salesNum, paymentMethod, amount,
            tendered, changeAmount, refNo, syncDate, createdAt)
           VALUES (?, ?, 'Refund', ?, 0, 0, ?, NULL, ?)`,
          [rid, salesNum, -paidTotal, reason || null, now],
        );
      }
    } catch {
      /* abaikan */
    }
    if (!alreadyVoid && preTableNo) try {
      const other = await queryFirst<{ c: number | null }>(
        `SELECT COUNT(*) AS c FROM tr_saleshead
         WHERE TRIM(tableNo) = TRIM(?) AND salesNum <> ? AND status = 'open'`,
        [preTableNo, salesNum],
      );
      if (Math.round(Number(other?.c) || 0) <= 0) {
        await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE TRIM(tableNo) = TRIM(?)', ['kosong', preTableNo]);
        try {
          enqueueSync('other', { op: 'table-clear', table: preTableNo, at: now });
        } catch {
          /* abaikan */
        }
      }
    } catch {
      /* abaikan */
    }
  } catch {
    /* DB gagal - antrean di bawah tetap jalan */
  }
  // S6 immediate-first: coba POST langsung (timeout singkat) dengan client_id
  // twin; antrean (fisik + ringan, id twin SAMA, tanpa UUID ganda) hanya bila
  // immediate gagal. Kaki refund deposit di atas tetap diantrekan apa adanya.
  const twinId = uuidv7();
  let sent = false;
  try {
    sent = await postImmediate(ApiPath.pushOrderFinish, {
      action: 'void', no: salesNum, reason, client_id: twinId,
      ...(approver ? { approvedBy: approver } : {}),
    });
  } catch {
    sent = false;
  }
  if (sent) {
    // Server sudah punya datanya — head ikut bersih agar badge dirty jujur.
    try {
      await markClean('tr_saleshead', salesNum);
    } catch {
      /* abaikan */
    }
  } else {
    try {
      await enqueueOutbox('tr_saleshead', salesNum, 'update');
    } catch {
      /* abaikan */
    }
    try {
      enqueueSync('order', {
        action: 'void', salesNum, no: salesNum, reason, client_id: twinId,
        ...(approver ? { approvedBy: approver } : {}),
      }, twinId);
    } catch {
      /* abaikan */
    }
  }
}

/** Ganti metode bayar: payment + head ikut terupdate + outbox/sync/server. */
export async function persistPayChangeDb(salesNum: string, method: string): Promise<void> {
  // Bill split (multi-baris tr_salespayment): jangan timpa rincian split
  // menjadi satu metode (bug G6) — cukup head yang ikut metode terakhir.
  try {
    await initDb();
    let rows = 0;
    try {
      const c = await queryFirst<{ c: number }>('SELECT COUNT(*) AS c FROM tr_salespayment WHERE salesNum = ?', [salesNum]);
      rows = Number(c?.c) || 0;
    } catch {
      /* abaikan: anggap baris tunggal */
    }
    if (rows <= 1) {
      await run('UPDATE tr_salespayment SET paymentMethod = ?, syncDate = NULL WHERE salesNum = ?', [method, salesNum]);
    }
    await run('UPDATE tr_saleshead SET paymentMethod = ?, syncDate = NULL WHERE salesNum = ?', [method, salesNum]);
  } catch {
    /* abaikan */
  }
  try {
    await enqueueOutbox('tr_saleshead', salesNum, 'update');
  } catch {
    /* abaikan */
  }
  // S6 immediate-first: coba POST langsung (timeout singkat) dengan client_id
  // twin; twin ringan (id SAMA) hanya bila immediate gagal. Outbox fisik di
  // atas tetap dicatat (kendaraan retry + penanda kotor).
  const payTwinId = uuidv7();
  let paySent = false;
  try {
    paySent = await postImmediate(ApiPath.pushOrderFinish, {
      action: 'change-payment', no: salesNum, method, client_id: payTwinId,
    });
  } catch {
    paySent = false;
  }
  if (paySent) {
    try {
      await markClean('tr_saleshead', salesNum);
    } catch {
      /* abaikan */
    }
  } else {
    try {
      enqueueSync('order', {
        action: 'change-payment', salesNum, no: salesNum, method, client_id: payTwinId,
      }, payTwinId);
    } catch {
      /* abaikan */
    }
  }
}
