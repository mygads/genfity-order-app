import { useEffect, useState } from 'react';import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import { ApiPath } from '../../config/server';import { enqueueOutbox, enqueueSync, postImmediate } from '../../lib/sync';import { attemptsLeft, authorizeSupervisor, verifyLocalEscalation } from '../../lib/supervisor';import { initDb, markClean, query, queryFirst, run } from '../../lib/db';import { uuidv7 } from '../../lib/uuidv7';import { useLang } from '../../lib/i18n';import { getSession } from '../../session';import { requireAccess } from '../../lib/access';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav; route?: { params?: { orderId?: string; table?: string; cashier?: string; total?: number } } };/** Baris live tr_salesmenu dipakai langsung; tanpa data contoh. */type CancelItem = { id: string; name: string; price: number; qty: number };interface SaleMenuRow { id: string; menuId: string | null; menuName: string | null; qty: number | null; price: number | null; note: string | null; }/** Item live dari tr_salesmenu bila orderId cocok; [] bila DB kosong agar empty-state dipakai. Split fisik antar salesNum bukan urusan layar ini (milik penulis sales.ts). */async function loadSaleItems(salesNum: string): Promise<CancelItem[]> { try { await initDb(); const rows = await query<SaleMenuRow>( 'SELECT id, menuId, menuName, qty, price, note FROM tr_salesmenu WHERE salesNum = ? ORDER BY rowid', [salesNum], ); const seen = new Map<string, CancelItem>(); for (const r of rows) { const qty = Math.round(Number(r.qty) || 0); if (qty <= 0) continue; const id = String(r.menuId || r.id); const cur = seen.get(id); if (cur) { cur.qty += qty; } else { seen.set(id, { id, name: r.menuName ?? '-', price: Math.round(Number(r.price) || 0), qty }); } } return [...seen.values()]; } catch { return []; }} /** Penyesuaian head (diskon/service/tax) untuk sisa NET U7; nol bila DB kosong. */
async function loadHeadAdj(salesNum: string): Promise<{ discount: number; service: number; tax: number }> {
  try {
    await initDb();
    const h = await queryFirst<{ discount: number | null; serviceCharge: number | null; tax: number | null }>(
      'SELECT discount, serviceCharge, tax FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
      [salesNum],
    );
    return {
      discount: Math.max(0, Math.round(Number(h?.discount) || 0)),
      service: Math.max(0, Math.round(Number(h?.serviceCharge) || 0)),
      tax: Math.max(0, Math.round(Number(h?.tax) || 0)),
    };
  } catch {
    return { discount: 0, service: 0, tax: 0 };
  }
}/** * Simpan void (kontrak §5.1.1 action-flag): catat ke outbox tr_saleshead + antrean sync agar aman offline, * coba kirim POST order/finish {action:'void', no, reason} langsung bila online. *//** * Tulis void ke DB lokal dulu (sumber kebenaran offline), lalu outbox/sync/POST:
 * - satu baris tr_cancelmenu per item (alasan + user + syncDate NULL = kotor),
 * - qty tr_salesmenu dikurangi sejumlah void (baris habis = qty 0),
 * - tr_saleshead jadi 'void' bila tak ada sisa, 'open' + total dihitung ulang
 *   bila void sebagian.
 * Tak pernah melempar: outbox di persistVoid tetap jalan walau tulis lokal gagal. */
async function applyVoidLocal(
  orderId: string,
  lines: { id: string; qty: number }[],
  reason: string,
  approvedBy?: string,
): Promise<void> {
  const now = new Date().toISOString();
  // Jejak audit: utamakan penyetuju eskalasi bila diketahui, bukan sesi kasir.
  const approver = String(approvedBy ?? '').trim();
  const userId = approver || getSession()?.userId || getSession()?.username || '';
  await initDb();
  // Head asal (grand/voucher/member/cabang): void sebagian = grand dikurangi
  // nilai item yang dibatalkan (diskon/fee/pajak TETAP seperti semula — tanpa
  // hitung ulang dari subtotal yang menghapus diskon tercatat).
  let head: { branchId: string | null; grandTotal: number | null; voucherCode: string | null; memberId: string | null; status: string | null; tableNo: string | null } | null = null;
  try {
    head = await queryFirst<{ branchId: string | null; grandTotal: number | null; voucherCode: string | null; memberId: string | null; status: string | null; tableNo: string | null }>(
      'SELECT branchId, grandTotal, voucherCode, memberId, status, tableNo FROM tr_saleshead WHERE salesNum = ? LIMIT 1',
      [orderId],
    );
  } catch {
    /* abaikan */
  }
  // Idempotensi: head sudah 'void' (mis. via History) = tak ada yang
  // dibalikkan; persistVoid di bawah tetap mengantrekan sync/POST.
  if ((head?.status ?? '') === 'void') return;
  // Gerbang stok: saveSale hanya jalan saat bayar (kaki payment ada). Bill
  // open tanpa kaki bayar tak pernah memotong stok → tak boleh dikembalikan.
  let payCount = 0;
  try {
    const pc = await queryFirst<{ c: number | null }>(
      'SELECT COUNT(*) AS c FROM tr_salespayment WHERE salesNum = ?',
      [orderId],
    );
    payCount = Math.max(0, Math.round(Number(pc?.c) || 0));
  } catch {
    /* abaikan */
  }
  const wasPaid = (head?.status ?? '') === 'paid' || payCount > 0;
  let voidedGross = 0;
  for (const ln of lines) {
    const want = Math.max(0, Math.round(Number(ln.qty) || 0));
    if (!ln.id || want <= 0) continue;
    const rows = await query<{ id: string; menuId: string | null; menuName: string | null; qty: number | null; price: number | null; subtotal: number | null; discount: number | null }>(
      'SELECT id, menuId, menuName, qty, price, subtotal, discount FROM tr_salesmenu WHERE salesNum = ? AND (menuId = ? OR id = ?) ORDER BY rowid',
      [orderId, ln.id, ln.id],
    );
    let left = want;
    let menuName: string | null = null;
    for (const r of rows) {
      if (left <= 0) break;
      const have = Math.max(0, Math.round(Number(r.qty) || 0));
      if (have <= 0) continue;
      menuName = menuName ?? r.menuName;
      const cut = Math.min(have, left);
      const price = Math.max(0, Math.round(Number(r.price) || 0));
      // Prorata subtotal/diskon baris (bukan price×sisa): subtotal tersimpan
      // memuat modifier + diskon per-baris; tulis-ulang price×qty menghapus
      // keduanya dari sisa bill.
      const ratio = (have - cut) / have;
      const oldSub = Math.max(0, Math.round(Number(r.subtotal ?? price * have) || 0));
      const oldDisc = Math.max(0, Math.round(Number(r.discount) || 0));
      const newSub = Math.round(oldSub * ratio);
      const newDisc = Math.round(oldDisc * ratio);
      await run('UPDATE tr_salesmenu SET qty = ?, discount = ?, subtotal = ?, syncDate = NULL WHERE id = ?', [
        have - cut,
        newDisc,
        newSub,
        r.id,
      ]);
      // Addon/extras ikut mengecil sebaris induk (qty + subtotal), bukan utuh.
      try {
        await run(
          'UPDATE tr_salesmenuextra SET qty = ?, subtotal = ROUND(price * ?), syncDate = NULL WHERE salesMenuId = ?',
          [have - cut, have - cut, r.id],
        );
      } catch {
        /* abaikan */
      }
      try {
        await enqueueOutbox('tr_salesmenu', r.id, 'update');
      } catch {
        /* abaikan */
      }
      voidedGross += oldSub - newSub;
      // Stok kembali per qty yang dibatalkan (parsial maupun penuh seragam) —
      // hanya bila bill pernah bayar (saveSale memotong stok; bill open tanpa
      // kaki bayar tak memotong). Buka flag habis bila pulih. Best-effort.
      if (wasPaid) try {
        const branch = head?.branchId;
        const mid = r.menuId;
        if (branch && mid && cut > 0) {
          await run(
            'UPDATE ms_branchmenu SET qty = qty + ?, syncDate = NULL WHERE branchId = ? AND menuId = ? AND qty IS NOT NULL',
            [cut, branch, mid],
          );
          await run(
            'UPDATE ms_branchmenu SET flagSoldOut = 0, syncDate = NULL WHERE branchId = ? AND menuId = ? AND qty IS NOT NULL AND qty > 0 AND flagSoldOut = 1',
            [branch, mid],
          );
          try {
            await enqueueOutbox('ms_branchmenu', `${branch}:${mid}`, 'update');
          } catch {
            /* abaikan */
          }
        }
      } catch {
        /* abaikan */
      }
      left -= cut;
    }
    const voided = want - left;
    if (voided > 0) {
      const cid = uuidv7();
      await run(
        `INSERT INTO tr_cancelmenu (id, salesNum, menuId, menuName, qty, reasonId, reasonNote, userId, cancelDate, syncDate)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
        [cid, orderId, ln.id, menuName, voided, reason, userId || null, now],
      );
      try {
        await enqueueOutbox('tr_cancelmenu', cid, 'insert');
      } catch {
        /* abaikan */
      }
    }
  }
  // Hitung ulang head: sisa qty > 0 = open + grand baru; nol = void penuh.
  // restGross dari subtotal TERSIMPAN (memuat modifier), bukan price×qty.
  const rest = await query<{ qty: number | null; subtotal: number | null; price: number | null }>(
    'SELECT qty, subtotal, price FROM tr_salesmenu WHERE salesNum = ?',
    [orderId],
  );
  let restGross = 0;
  for (const r of rest) {
    const q = Math.max(0, Math.round(Number(r.qty) || 0));
    restGross += r.subtotal != null
      ? Math.max(0, Math.round(Number(r.subtotal) || 0))
      : q * Math.max(0, Math.round(Number(r.price) || 0));
  }
  const oldGrand = Math.max(0, Math.round(Number(head?.grandTotal) || 0));
  const newGrand = Math.max(0, oldGrand - voidedGross);
  const fullVoid = restGross <= 0 || newGrand <= 0;
  if (fullVoid) {
    await run('UPDATE tr_saleshead SET status = ?, grandTotal = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?', ['void', 0, now, orderId]);
    // Balikan void penuh (cermin persistVoidDb History G7): kuota kembali
    // HANYA untuk kode yang benar-benar terbakar (usage 'burn', head + kaki
    // tender); deposit kembali + ledger refund; dapur Batal.
    try {
      const burned = await query<{ voucherCode: string | null }>(
        `SELECT DISTINCT voucherCode FROM tr_salesvoucherusage
         WHERE salesNum = ? AND status = 'burn'`,
        [orderId],
      );
      for (const b of burned) {
        const code = String(b.voucherCode ?? '').trim();
        if (!code) continue;
        try {
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
        } catch {
          /* abaikan */
        }
      }
    } catch {
      /* abaikan */
    }
    try {
      if (head?.memberId) {
        const pays = await query<{ paymentMethod: string | null; amount: number | null }>(
          'SELECT paymentMethod, amount FROM tr_salespayment WHERE salesNum = ?',
          [orderId],
        );
        const depBack = Math.round(
          pays
            .filter((p) => /deposit/i.test(p.paymentMethod ?? ''))
            .reduce((a, p) => a + Math.max(0, Number(p.amount) || 0), 0),
        );
        if (depBack > 0) {
          const cur = await queryFirst<{ depositBalance: number | null }>(
            'SELECT depositBalance FROM ms_member WHERE id = ? LIMIT 1',
            [head.memberId],
          );
          const after = Math.max(0, Math.round(Number(cur?.depositBalance) || 0)) + depBack;
          await run('UPDATE ms_member SET depositBalance = ?, syncDate = NULL WHERE id = ?', [after, head.memberId]);
          try {
            await enqueueOutbox('ms_member', head.memberId, 'update');
          } catch {
            /* abaikan */
          }
          const rid = uuidv7();
          await run(
            `INSERT INTO tr_memberdeposit (id, memberId, branchId, trxType, amount, balanceAfter, userId, trxDate, syncDate)
             VALUES (?, ?, ?, 'refund', ?, ?, ?, ?, NULL)`,
            [rid, head.memberId, head.branchId ?? null, depBack, after, userId || null, now],
          );
          try {
            await enqueueOutbox('tr_memberdeposit', rid, 'insert');
          } catch {
            /* abaikan */
          }
          try {
            enqueueSync('other', { kind: 'deposit-refund', memberId: head.memberId, nominal: depBack });
          } catch {
            /* abaikan */
          }
        }
      }
    } catch {
      /* abaikan */
    }
    try {
      await run(`UPDATE tr_kitchenticket SET status = 'Batal', updatedAt = ?, syncDate = NULL WHERE salesNum = ?`, [now, orderId]);
      try {
        await enqueueOutbox('tr_kitchenticket', `kt-${orderId}`, 'update');
      } catch {
        /* abaikan */
      }
    } catch {
      /* abaikan */
    }
    // Meja dibebaskan (paritas SuccessScreen): hanya bila tak dipakai bill
    // 'open' lain agar tak membebaskan meja yang sudah diduduki order baru.
    if (head?.tableNo) try {
      const other = await queryFirst<{ c: number | null }>(
        `SELECT COUNT(*) AS c FROM tr_saleshead
         WHERE TRIM(tableNo) = TRIM(?) AND salesNum <> ? AND status = 'open'`,
        [head.tableNo, orderId],
      );
      if (Math.round(Number(other?.c) || 0) <= 0) {
        await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE TRIM(tableNo) = TRIM(?)', ['kosong', head.tableNo]);
        try {
          enqueueSync('other', { op: 'table-clear', table: head.tableNo, at: now });
        } catch {
          /* abaikan */
        }
      }
    } catch {
      /* abaikan */
    }
  } else {
    await run('UPDATE tr_saleshead SET status = ?, subtotal = ?, grandTotal = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?', ['open', restGross, newGrand, now, orderId]);
  }
  // Lebih bayar (sudah dibayar > grand baru, mis. void setelah lunas) = baris
  // Refund negatif agar SUM payment = grand baru; head paidAmount ikut neto.
  // Void parsial atas deposit: deposit yang sudah tender tak diutak-atik.
  // Status lunas-dipertahankan: bill yang tetap genap (paid >= grand baru,
  // mis. void parsial setelah lunas penuh) kembali 'paid' agar tak keluar
  // dari rekap kas yang memfilter status lunas; yang kurang bayar tetap 'open'.
  try {
    const prow = await queryFirst<{ s: number | null }>(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM tr_salespayment WHERE salesNum = ?',
      [orderId],
    );
    const paidTotal = Math.max(0, Math.round(Number(prow?.s) || 0));
    const target = fullVoid ? 0 : newGrand;
    if (paidTotal > target) {
      const over = paidTotal - target;
      const rid = uuidv7();
      await run(
        `INSERT INTO tr_salespayment (id, salesNum, paymentMethod, amount,
          tendered, changeAmount, refNo, syncDate, createdAt)
         VALUES (?, ?, 'Refund', ?, 0, 0, ?, NULL, ?)`,
        [rid, orderId, -over, reason || null, now],
      );
      await run('UPDATE tr_saleshead SET paidAmount = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?', [target, now, orderId]);
    }
    if (!fullVoid && paidTotal >= target) {
      await run('UPDATE tr_saleshead SET status = ?, updatedAt = ?, syncDate = NULL WHERE salesNum = ?', ['paid', now, orderId]);
    }
  } catch {
    /* abaikan */
  }
  try {
    await enqueueOutbox('tr_saleshead', orderId, 'update');
  } catch {
    /* abaikan */
  }
}
async function persistVoid( orderId: string, voidLines: { id: string; qty: number }[], reason: string, approvedBy?: string,): Promise<void> {
  try {
    await applyVoidLocal(orderId, voidLines, reason, approvedBy);
  } catch {
    /* tulis lokal gagal - twin di bawah tetap jalan */
  }
  // S6 immediate-first: coba POST langsung (timeout singkat) dengan client_id
  // twin; twin ringan (id SAMA) hanya bila immediate gagal.
  // GAP-15 (2026-10-17, terverifikasi): approvedBy (userId approver eskalasi)
  // dibawa di KEDUA jalur sync — body POST immediate
  // {action:'void', ..., approvedBy} di bawah DAN payload antrean
  // enqueueSync('order', {action:'void', ..., approvedBy}) — pushLightItem
  // (lib/sync.ts) menyebar ...rawPayload apa adanya ke body ESB (payload void
  // tanpa `op`/items tak tersentuh terjemahan Go-POS), jadi field ini tiba di
  // server. Kolom approvedBy sisi server (Go backend, repo terpisah) tak bisa
  // dipastikan dari repo app ini — payload best-effort + jujur; daya tahan
  // lokal dijamin via tr_cancelmenu.userId (applyVoidLocal memakai approver
  // bila ada, bukan sesi kasir).
  const twinId = uuidv7();
  let sent = false;
  try {
    sent = await postImmediate(ApiPath.pushOrderFinish, {
      action: 'void', no: orderId, salesNum: orderId, voidLines, reason,
      client_id: twinId, ...(approvedBy ? { approvedBy } : {}),
    });
  } catch {
    sent = false;
  }
  if (sent) {
    try {
      await markClean('tr_saleshead', orderId);
    } catch {
      /* abaikan */
    }
  } else {
    try {
      enqueueSync('order', {
        action: 'void', salesNum: orderId, no: orderId, voidLines, reason,
        client_id: twinId, ...(approvedBy ? { approvedBy } : {}),
      }, twinId);
    } catch { /* abaikan */ }
  }
}export default function CancelScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const orderId = (route?.params?.orderId ?? '').trim();
  const tableNo = route?.params?.table ?? '';
  const cashier = route?.params?.cashier ?? '';
  /** Total resmi pemanggil; 0 bila tak ada (mock 86400 tak lagi dipakai). */
  const paramTotal = Math.max(0, Math.round(Number(route?.params?.total) || 0));
  /** Live-only: mulai kosong (tanpa mock); DB kosong = empty-state, bukan fallback mock. */ const [items, setItems] = useState<CancelItem[]>([]); const [voidQty, setVoidQty] = useState<Record<string, number>>({}); const [loaded, setLoaded] = useState(false); /** Penyesuaian head untuk sisa NET U7. */ const [headAdj, setHeadAdj] = useState({ discount: 0, service: 0, tax: 0 }); /** Muat baris live tr_salesmenu; kosong/tanpa orderId = tetap [] + tandai loaded. */ useEffect(() => { let alive = true; if (!orderId) { setItems([]); setVoidQty({}); setHeadAdj({ discount: 0, service: 0, tax: 0 }); setLoaded(true); return () => { alive = false; }; } void Promise.all([loadSaleItems(orderId), loadHeadAdj(orderId)]).then(([rows, adj]) => { if (!alive) return; setItems(rows); const zero: Record<string, number> = {}; for (const r of rows) zero[r.id] = 0; setVoidQty(zero); setHeadAdj(adj); setLoaded(true); }); return () => { alive = false; }; }, [orderId]);
  const REASONS = [t('cx_reason_1'), t('cx_reason_2'), t('cx_reason_3'), t('cx_reason_4')];
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [authMsg, setAuthMsg] = useState(''); const [confirming, setConfirming] = useState(false); const [done, setDone] = useState(false);

  const step = (id: string, delta: number, max: number) => setVoidQty((q) => { const next = Math.min(max, Math.max(0, (q[id] ?? 0) + delta)); return { ...q, [id]: next }; }); const picked = items.filter((i) => (voidQty[i.id] ?? 0) > 0); const voidTotal = picked.reduce((s, i) => s + i.price * (voidQty[i.id] ?? 0), 0);
  /** Total live (jumlah item) bila pemanggil tak mengirim total; tanpa mock. */
  const liveTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const orderTotal = paramTotal > 0 ? paramTotal : liveTotal;
  // U7: sisa NET proporsional — porsi diskon/service/tax milik baris void =
  // voidSubtotal/orderSubtotal × (discount+service+tax).
  const adjTotal = headAdj.discount + headAdj.service + headAdj.tax;
  const voidShare = liveTotal > 0 && voidTotal > 0 ? (voidTotal / liveTotal) * adjTotal : 0;
  const remain = orderTotal - voidTotal - voidShare;
  /** DB nol-baris / tanpa orderId = empty-state (bukan ITEMS/SPLITS/TRX-047 mock). */
  const isEmptyOrder = loaded && (items.length === 0 || !orderId);

  // PIN eskalasi 4-6 digit: seed uji 4 digit (1111/2222/1234) lolos ke
  // authorizeSupervisor (server tetap menuntut 6) + fallback lokal.
  const canConfirm = picked.length > 0 && pin.replace(/\D/g, '').length >= 4 && !confirming; /** * Konfirmasi void: otorisasi supervisor via server, fallback eskalasi * lokal saat offline (fail-closed untuk PIN salah/tanpa hak); lalu * simpan via outbox + antrean sync. */ const confirm = () => {
   if (!canConfirm) return; setConfirming(true); setAuthMsg(''); void requireAccess(getSession()?.userId || getSession()?.username || '', 'order.cancel').then((gate) => {
        // Gate RBAC order.cancel: deny = eskalasi ke PIN supervisor di bawah
        // (bukan hard block); fail-open (allow/db-unready) lanjut tanpa catatan.
        if (!gate.ok) setAuthMsg(t('void_need_pin').replace('{r}', gate.reason));
        return authorizeSupervisor(pin); }).then((res) => {
        // Offline-first: server tak terjangkau -> cocokkan PIN lokal milik
        // pemegang hak order.cancel (owner); PIN staf/salah tetap ditolak.
        if (!res.ok && (res.code === 'offline' || res.code === 'unconfigured')) {
          return verifyLocalEscalation(pin, 'order.cancel');
        }
        return res; }).then((res) => { if (!res.ok) {
        // Terkunci sementara: pesan sudah lokal via kamus (sup_locked + detik).
        setAuthMsg(res.code === 'locked' ? res.message : `${res.message} (${attemptsLeft()} ${t('cx_attempts')})`); setConfirming(false); return;
   } const lines = picked.map((i) => ({ id: i.id, qty: voidQty[i.id] ?? 0 })); void persistVoid(orderId, lines, reason, (res as { userId?: string }).userId).finally(() => { setConfirming(false); setDone(true);
 }); }); };

  /** Empty-state: DB nol-baris / tanpa orderId — tanpa ITEMS/SPLITS/TRX-047 mock.
   * Teks netral ID/EN (tanpa kunci i18n baru), gaya teks empty yang sudah ada. */
  if (!loaded || isEmptyOrder) { return (
    <View style={styles.root}><ScreenHeader title={t('cx_title')} sub={orderId ? `Order ${orderId}` : undefined} onBack={() => navigation?.goBack?.()} /><ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>{!loaded ? t('cx_loading') : t('cx_not_found')}</Text>
        {loaded && orderId ? (<Text style={styles.meta}>{t('cx_order_missing').replace('{o}', orderId)}</Text>) : null}
      </View>
    </ScrollView>
  </View> ); }

  /** Cetak rincian void ke struk dengan data order asal (id/meja/kasir/total). */ const printVoid = () => { navigation?.navigate('Receipt', { no: orderId, table: tableNo, cashier, total: voidTotal, voidLines: picked.map((i) => ({ name: i.name, qty: voidQty[i.id] ?? 0, price: i.price })), reason, }); }; return (
    <View style={styles.root}><ScreenHeader title={t('cx_title')} sub={`${t('cx_order_of').replace('{o}', orderId)} - ${tableNo} - ${cashier}`} onBack={() => navigation?.goBack?.()} /><ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <Text style={styles.meta}>{t('cx_order_of').replace('{o}', orderId)} - {tableNo} - {cashier} - {rp(orderTotal)}</Text>
      <Text style={styles.sec}>{t('cx_title')}</Text>
      <Text style={styles.hint}>{t('cx_pick_hint')}</Text>

      {/* Tablet: dua kolom (kiri item+alasan+input, kanan ringkasan+aksi+split). */}
      <View style={isTablet && styles.cols}>
      <View style={isTablet && styles.colMain}>
      {items.map((i) => { const q = voidQty[i.id] ?? 0; const on = q > 0; return (
        <View key={i.id} style={[styles.item, on && styles.itemOn]}><View style={styles.itemInfo}><Text style={styles.itemName}>{i.qty}x {i.name}</Text><Text style={styles.itemPrice}>{rp(i.price)}</Text></View><View style={styles.stepper}><TouchableOpacity style={[styles.stepBtn, isTablet && styles.stepBtnTablet]} onPress={() => step(i.id, -1, i.qty)} hitSlop={isTablet ? 12 : 8}>
          <Text style={[styles.stepTxt, isTablet && styles.stepTxtTablet]}>-</Text></TouchableOpacity>
          <Text style={styles.stepVal}>{q}</Text><TouchableOpacity style={[styles.stepBtn, isTablet && styles.stepBtnTablet]} onPress={() => step(i.id, 1, i.qty)} hitSlop={isTablet ? 12 : 8}>
          <Text style={[styles.stepTxt, isTablet && styles.stepTxtTablet]}>+</Text>
        </TouchableOpacity>
      </View></View> ); })}

      <Text style={styles.label}>{t('cx_reason')}</Text>
      {REASONS.map((r) => (
        <TouchableOpacity key={r} style={[styles.reason, reason === r && styles.reasonOn]} onPress={() => setReason(r)}>
          <Text style={[styles.reasonT, reason === r && styles.reasonTOn]}>{r}</Text>
        </TouchableOpacity>
      ))}
      <AppInput label={t('c_note_opt')} value={note} onChangeText={setNote} placeholder={t('cx_note_ph')} />
      <AppInput label={t('cx_pin')} value={pin} onChangeText={(txt) => { setPin(txt.replace(/\D/g, '').slice(0, 6)); setAuthMsg(''); }} placeholder={t('cx_pin_ph')} keyboardType="numeric" maxLength={6} secureTextEntry />

      {authMsg ? <Text style={styles.authErr}>{authMsg}</Text> : null}
      </View>
      <View style={isTablet && styles.colSide}>
      <View style={styles.summary}>
        <Text style={styles.sumTitle}>{t('cx_confirm_split')}</Text>
        <Text style={styles.sumLine}>{picked.length} item ({rp(voidTotal)}) {t('cx_to_cancel')}</Text>
        <Text style={styles.sumNote}>{t('cx_stock_back')}</Text>
        <View style={styles.row}><Text style={styles.item2}>{t('cx_order_of').replace('{o}', orderId)} - {tableNo} - {cashier}</Text></View>
        <View style={styles.row}><Text style={styles.item2}>{t('cx_total_before')}</Text><Text style={styles.price}>{rp(orderTotal)}</Text></View>
        <View style={styles.row}><Text style={styles.item2}>{t('cx_voided')}</Text><Text style={styles.disc}>-{rp(voidTotal)}</Text></View>
        <View style={styles.row}><Text style={styles.totalL}>{t('cx_remain')}</Text><Text style={styles.totalV}>{rp(remain)}</Text></View>
        <Text style={styles.sumHint}>{t('cx_to_pay')}</Text>{remain > 0 ? (<TouchableOpacity onPress={() => navigation?.navigate('Pay', { total: remain, salesNum: orderId, splitGroup: true, orderTotal: remain, items: items.filter((x) => (x.qty - (voidQty[x.id] ?? 0)) > 0).map((x) => ({ id: x.id, name: x.name, basePrice: x.price, qty: x.qty - (voidQty[x.id] ?? 0) })) })}><Text style={styles.link}>{t('cx_remain')} {rp(remain)} ›</Text></TouchableOpacity> ) : null}
      </View>

      <View style={styles.actions}>
        <AppButton title={t('c_back')} variant="secondary" onPress={() => navigation?.goBack()} fullWidth={false} size="md" style={styles.actionBtn} />
        <AppButton title={confirming ? '...' : `${t('cx_yes_void')} ›`} variant="danger" disabled={!canConfirm} onPress={confirm} fullWidth={false} size="md" style={styles.actionBtn} />
      </View>
      {done && <Text style={styles.done}>{t('cx_done')}</Text>}{done && (
      <AppButton title={t('cx_void_print')} onPress={printVoid} size="md" /> )}<TouchableOpacity onPress={() => navigation?.navigate('History')}>
        <Text style={styles.link}>{t('cx_history')}</Text>
      </TouchableOpacity>
      </View>
      </View>
    </ScrollView>
  </View> );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12 }, langTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 }, burger: { width: 22, height: 22 }, body: { padding: 16, paddingBottom: 40 },
  meta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  meta2: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 16 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  itemOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  itemInfo: { flex: 1 },

  itemName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  itemPrice: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 }, stepBtn: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', }, stepTxt: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy }, stepVal: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, minWidth: 18, textAlign: 'center' }, label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 14, marginBottom: 6 },
  // Tablet: stepper penuhi target sentuh 48px + dua kolom proporsional.
  stepBtnTablet: { width: 48, height: 48, borderRadius: 12 },
  stepTxtTablet: { fontSize: 18 },
  cols: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  colMain: { flex: 1.2, minWidth: 0 },
  colSide: { flex: 1, minWidth: 0 },
  reason: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.card, marginTop: 6 },
  reasonOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  reasonT: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  reasonTOn: { color: colors.orangeDark },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 14, color: colors.text, },
  authErr: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red, marginTop: 6 }, summary: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.line },
  sumTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  sumLine: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, marginTop: 6 },
  sumNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  sumHint: { fontFamily: fonts.medium, fontSize: 12, color: colors.navy, marginTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  item2: { fontFamily: fonts.regular, fontSize: 13, color: colors.text },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  disc: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  totalL: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  totalV: { fontFamily: fonts.bold, fontSize: 16, color: colors.orangeDark },
  cancelT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, marginTop: 0 },
  primary: { flex: 1, backgroundColor: colors.red, borderRadius: 10, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  done: { fontFamily: fonts.semibold, fontSize: 13, color: colors.greenDark, marginTop: 12 },
  printVoidBtn: { backgroundColor: colors.navy, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 10, }, printVoidTxt: { fontFamily: fonts.bold, fontSize: 14, color: colors.white }, link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark, marginTop: 10 }, emptyWrap: { alignItems: 'center', paddingVertical: 32 }, empty: { textAlign: 'center', marginTop: 12, fontFamily: fonts.regular, fontSize: 14, color: colors.muted },});