import React, { useEffect, useState } from 'react';import {
  AppState, Image, Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import DrawerMenu from '../../components/DrawerMenu';import { useLang } from '../../lib/i18n';import { initDb, query, run } from '../../lib/db';import { getJSON, setJSON } from '../../lib/storage';import { enqueueOutbox, enqueueSync } from '../../lib/sync';import { TABLE_TIMER_TIM_KEY, canonTableNo } from '../settings/TableTimerScreen';type Props = { navigation?: any };type TableStatus = 'kosong' | 'terisi' | 'dipesan' | 'gabung';type Table = {
  id: string;
  no: string;
  section: string;
  kapasitas: number;
  status: TableStatus;
  total?: number;
  namaTamu?: string;
  /** Menit sejak tamu duduk - timer durasi meja terisi (dipulihkan dari storage). */
  seatedMin?: number;};
/** Denah dibaca dari ms_table (seed mengisi 9 meja); kosong = empty-state. */
const SECTIONS = ['Semua', 'Dalam', 'Teras', 'VIP'];/** Snapshot timer meja agar durasi bertahan saat aplikasi dibuka ulang. */const SEATED_KEY = 'genfity.tables.seatedMin';/** Status hold order per id meja agar bertahan saat aplikasi dibuka ulang. */const HELD_KEY = 'genfity.tables.held';const STATUS_META: Record<TableStatus, { bg: string; fg: string }> = {
  kosong: { bg: colors.paleGreen, fg: colors.green },
  terisi: { bg: colors.paleRed, fg: colors.red },
  dipesan: { bg: colors.paleOrange, fg: colors.orange },
  gabung: { bg: colors.paleBlue, fg: colors.navy },};const STATUS_LABEL_KEY: Record<TableStatus, string> = {
  kosong: 'tbl.stKosong',
  terisi: 'tbl.stTerisi',
  dipesan: 'tbl.stDipesan',
  gabung: 'tbl.stGabung',};/** Label tampil seksi (S4-APP-334 display-only): nilai sectionId kontrak ('Semua'/'Dalam'/...) tetap disimpan apa adanya. */const SECTION_LABEL_KEY: Record<string, string> = {
  Semua: 'tmr_sec_semua',
  Dalam: 'tmr_sec_dalam',
  Teras: 'tmr_sec_teras',
  VIP: 'tmr_sec_vip',};/** Petakan nilai seksi kontrak ke label bahasa aktif; seksi custom tak dikenal tampil apa adanya. */function secLabel(sec: string, t: (k: string) => string): string {
  const k = SECTION_LABEL_KEY[sec];
  return k ? t(k) : sec;}/** Format durasi duduk ala POSLite: "25 mnt" / "1 jam 10 mnt". */function fmtDurasi(min?: number, minLbl = 'mnt', hrLbl = 'jam'): string {
  if (min === undefined) return '';
  if (min < 60) return `${min} ${minLbl}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} ${hrLbl}` : `${h} ${hrLbl} ${m} ${minLbl}`;}
/** Samakan nomor meja lokal ke kanonis TableTimer ("A-01" dan "A1" sama). */
function normNo(raw: string): string {
  return canonTableNo(raw);
}
interface TimerStoreRow { id: string; elapsed: number; limit: number }
/** Tulis elapsed satu nomor meja ke persist TableTimer (F2, best-effort).
 * Diam bila store TableTimer belum ada (belum pernah dibuka). */
async function writeTimerStore(no: string, elapsed: number): Promise<void> {
  try {
    const cur = await getJSON<TimerStoreRow[]>(TABLE_TIMER_TIM_KEY, []);
    if (!Array.isArray(cur) || cur.length === 0) return;
    const target = normNo(no);
    await setJSON(
      TABLE_TIMER_TIM_KEY,
      cur.map((x) => (canonTableNo(x.id) === target ? { ...x, elapsed } : x)),
    );
  } catch { /* abaikan: snapshot SEATED_KEY tetap jadi fallback */ }}/** Catat mutasi meja ke antrean sync (offline-first, tidak memblokir UI). */function queueTableOp(op: string, payload: Record<string, unknown>): void { try { enqueueSync('other', { op, ...payload, at: new Date().toISOString() });
}

catch { /* antrean belum siap */ }}/** Petakan status BE (free/occupied/reserved/...) ke status denah lokal. */function mapBeStatus(raw: unknown): TableStatus { const v = String(raw ?? '').trim().toLowerCase(); if (v === 'occupied' || v === 'busy' || v === 'terisi' || v === 'isi') return 'terisi'; if (v === 'reserved' || v === 'booked' || v === 'booking' || v === 'res' || v === 'reservasi' || v === 'dipesan') return 'dipesan'; if (v === 'merged' || v === 'merge' || v === 'combined' || v === 'join' || v === 'gabung') return 'gabung'; return 'kosong'; }type MsTableRow = { id: string; tableNo: string | null; sectionId: string | null; capacity: number | null; status: string | null };/** Tulis status balik ke ms_table (best-effort, tak memblokir UI). */function persistTableStatus(tb: { id: string; no: string }, status: TableStatus): void { void (async () => { try { await initDb(); await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE id = ? OR TRIM(tableNo) = ?', [status, tb.id, tb.no]); } catch { /* master belum tersedia */ } })(); }/** Denah meja - section, status, timer durasi, hold order, transaksi cepat (QS). */export default function TablesScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [tables, setTables] = useState<Table[]>([]); const [liveSections, setLiveSections] = useState<string[] | null>(null);
  const [section, setSection] = useState('Semua');
  const [filter, setFilter] = useState<'semua' | TableStatus>('semua');
  const [selected, setSelected] = useState<Table | null>(null);
  const [moveMode, setMoveMode] = useState<'pindah' | 'gabung' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  /** Peringatan batal meja (mis. masih ada bill terbuka) - tampil di modal detail. */
  const [cancelWarn, setCancelWarn] = useState('');
  const [bookingVisible, setBookingVisible] = useState(false);
  const [namaBooking, setNamaBooking] = useState('');
  const [jamBooking, setJamBooking] = useState('');
  const [pax, setPax] = useState('');
  const [bookingWarn, setBookingWarn] = useState(''); /** Hold order: order ditahan, meja tetap terisi tapi ditandai. */
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [qsCount, setQsCount] = useState(0);
  /** Kelola meja (pengaturan denah): tambah + hapus meja master. */
  const [manageOpen, setManageOpen] = useState(false);
  const [newNo, setNewNo] = useState('');
  const [newSection, setNewSection] = useState('Dalam');
  const [newKap, setNewKap] = useState('');
  const [manageWarn, setManageWarn] = useState('');
  const [confirmDelTable, setConfirmDelTable] = useState<string | null>(null);

  // Hold order dipulihkan dari storage agar bertahan saat aplikasi dibuka ulang.
  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        const h = await getJSON<Record<string, boolean>>(HELD_KEY, {});
        if (on && h) setHeld(h);
      } catch {
        /* abaikan */
      }
    })();
    return () => {
      on = false;
    };
  }, []);
  // F2: sumber utama = persist TableTimer (elapsed per nomor meja, tick 10 dtk);
  // fallback = snapshot lama SEATED_KEY agar durasi lama tak hilang.
  useEffect(() => { let on = true; (async () => { let byNo: Record<string, number> = {}; try { const tim = await getJSON<TimerStoreRow[]>(TABLE_TIMER_TIM_KEY, []); if (Array.isArray(tim)) { for (const x of tim) { const el = Number(x?.elapsed); const no = canonTableNo(String(x?.id ?? '')); if (no && Number.isFinite(el) && el >= 0) byNo[no] = el; } } } catch { /* abaikan: pakai fallback */ } let saved: Record<string, number> = {}; try { saved = await getJSON<Record<string, number>>(SEATED_KEY, {}); } catch { /* abaikan */ } if (!on) return; setTables((list) => list.map((tb) => tb.status === 'terisi' || tb.status === 'gabung' ? { ...tb, seatedMin: byNo[normNo(tb.no)] ?? saved[tb.id] ?? tb.seatedMin } : tb, ), ); })().catch(() => undefined); return () => { on = false; }; }, []);
  // Live: denah dari ms_table (id, tableNo, sectionId, capacity, status) pola
  // MoveTableScreen; DB kosong = daftar kosong (empty-state di grid).
  useEffect(() => { let on = true; (async () => { try { await initDb(); const rows = await query<MsTableRow>('SELECT id, tableNo, sectionId, capacity, status FROM ms_table LIMIT 60'); if (!on) return; if (rows.length === 0) { setTables([]); setLiveSections(['Semua']); return; } const byNo = new Map<string, Table>(); let byTim: Record<string, number> = {}; try { const tim = await getJSON<TimerStoreRow[]>(TABLE_TIMER_TIM_KEY, []); if (Array.isArray(tim)) { for (const x of tim) { const el = Number(x?.elapsed); const k = canonTableNo(String(x?.id ?? '')); if (k && Number.isFinite(el) && el >= 0) byTim[k] = el; } } } catch { /* abaikan */ } let saved: Record<string, number> = {}; try { saved = await getJSON<Record<string, number>>(SEATED_KEY, {}); } catch { /* abaikan */ } const liveTables: Table[] = rows.map((r) => { const no = normNo(String(r.tableNo || r.id || '')); const fb = byNo.get(no); const st = mapBeStatus(r.status); const tb: Table = { id: String(r.id), no, section: String(r.sectionId || fb?.section || ''), kapasitas: Number(r.capacity) || fb?.kapasitas || 0, status: st }; if (st === 'terisi' || st === 'gabung') { const m = byTim[normNo(no)] ?? saved[String(r.id)]; if (m !== undefined) tb.seatedMin = m; } return tb; }); if (!on) return; setTables(liveTables); const secs: string[] = []; for (const tb of liveTables) { if (tb.section && !secs.includes(tb.section)) secs.push(tb.section); } setLiveSections(['Semua', ...secs]); } catch { /* SQLite belum siap - fallback konstanta tetap tampil */ } })().catch(() => undefined); return () => { on = false; }; }, []);
  // Timer durasi: tiap menit tambah 1 menit utk meja terisi/gabung + simpan snapshot.
  // Cermin ke store TableTimer via max-merge (monoton naik, anti-mundur) agar
  // TableTimerScreen ikut melihat durasi terbaru; best-effort, tak memblokir tick.
  // Toleransi +1 menit: tick Tables kasar (bulat) - jangan timpa presisi tick
  // 10-detik TableTimerScreen tiap menit; hanya perbaiki bila store basi/tertinggal.
  // EFF-09 dievaluasi: tick durasi duduk 60 dtk DIPERTAHANKAN — hitung lokal
  // murni (tanpa network/DB/poll server), presisi menit sesuai tampilan menit.
  useEffect(() => {
    const timer = setInterval(() => {
      // C11 EFF-09: skip tick+snapshot saat background (hemat storage writes;
      // presisi milik tick 10-dtk TableTimerScreen yang foreground).
      try { if (AppState.currentState !== 'active') return; } catch { /* lanjut */ }
      setTables((list) =>
        { const next = list.map((tb) =>
          tb.status === 'terisi' || tb.status === 'gabung'
            ? { ...tb, seatedMin: (tb.seatedMin ?? 0) + 1 }
            : tb,

      );
    const snap: Record<string, number> = {}; for (const tb of next) { if (tb.seatedMin !== undefined && (tb.status === 'terisi' || tb.status === 'gabung')) { snap[tb.id] = tb.seatedMin; } } void setJSON(SEATED_KEY, snap);
    void (async () => { try { const cur = await getJSON<TimerStoreRow[]>(TABLE_TIMER_TIM_KEY, []); if (!Array.isArray(cur) || cur.length === 0) return; let dirty = false; const merged = cur.map((x) => { const tb = next.find((t) => normNo(t.no) === canonTableNo(x.id)); const el = tb?.seatedMin; if (tb && (tb.status === 'terisi' || tb.status === 'gabung') && el !== undefined && el > Number(x.elapsed) + 1) { dirty = true; return { ...x, elapsed: Math.round(el * 100) / 100 }; } return x; }); if (dirty) await setJSON(TABLE_TIMER_TIM_KEY, merged); } catch { /* abaikan */ } })();
    return next; }); }, 60000);
    return () => clearInterval(timer);
  }, []);

  const shown = tables.filter(
    (tb) =>
      (section === 'Semua' || tb.section === section) &&
      (filter === 'semua' || tb.status === filter),
  );

  const openDetail = (tb: Table) => {
    setSelected(tb);
    setMoveMode(null);
    setConfirmCancel(false);
  };

  const closeModal = () => {
    setSelected(null);
    setMoveMode(null);
    setConfirmCancel(false);
    setCancelWarn('');
  };

  /** Buka order meja: meja terisi memuat draft tersimpannya ke kasir (item +
   * mode/ongkir/voucher/member ikut), meja kosong mulai order baru. */
  const openTableOrder = async (tb: Table): Promise<void> => {
    const base = { table: tb.no };
    if (tb.status === 'kosong') {
      navigation?.navigate?.('Cashier', base);
      return;
    }
    try {
      await initDb();
      const rows = await query<{ payload: string }>(
        'SELECT payload FROM tr_draftorder ORDER BY createdAt DESC',
      );
      for (const r of rows) {
        try {
          const p = JSON.parse(r.payload) as {
            table?: unknown; items?: unknown; mode?: unknown; ongkir?: unknown;
            salesNum?: unknown; voucher?: unknown; memberId?: unknown; customer?: unknown;
          };
          if (!p || typeof p.table !== 'string' || p.table.trim() !== tb.no) continue;
          if (!Array.isArray(p.items) || p.items.length === 0) continue;
          navigation?.navigate?.('Cashier', {
            loadItems: p.items,
            ...(typeof p.mode === 'string' && p.mode ? { mode: p.mode } : {}),
            table: tb.no,
            ...(typeof p.ongkir === 'number' ? { ongkir: p.ongkir } : {}),
            ...(typeof p.salesNum === 'string' && p.salesNum.trim() ? { salesNum: p.salesNum.trim() } : {}),
            ...(p.voucher && typeof p.voucher === 'object' ? { voucher: p.voucher } : {}),
            ...(typeof p.memberId === 'string' && p.memberId.trim() ? { memberId: p.memberId.trim() } : {}),
            ...(typeof p.customer === 'string' && p.customer.trim() ? { customer: p.customer.trim() } : {}),
          });
          return;
        } catch {
          /* baris korup - lewati */
        }
      }
    } catch {
      /* DB belum siap - mulai order baru */
    }
    navigation?.navigate?.('Cashier', base);
  };

  /** Pindah: tamu+total pindah ke meja kosong. Gabung: total digabung ke meja terisi. */
  const applyMove = (target: Table) => {
    if (!selected) return;
    const sel = selected;
    setTables((list) =>
      list.map((tb) => {
        if (moveMode === 'pindah') {
          if (tb.id === target.id)
            return { ...tb, status: 'terisi' as TableStatus, namaTamu: sel.namaTamu, total: sel.total, seatedMin: sel.seatedMin ?? 0 };
          if (tb.id === sel.id)
            return { ...tb, status: 'kosong' as TableStatus, namaTamu: undefined, total: undefined, seatedMin: undefined };
          return tb;
        }
        // gabung
        if (tb.id === target.id)
          return {
            ...tb,
            status: 'gabung' as TableStatus,
            total: (tb.total ?? 0) + (sel.total ?? 0),
            namaTamu: `${tb.no}+${sel.no}${tb.namaTamu ? ` · ${tb.namaTamu}` : ''}`,
          };
        if (tb.id === sel.id)
          return { ...tb, status: 'gabung' as TableStatus, namaTamu: `${sel.no}+${target.no}`, total: undefined };
        return tb;
      }),
    );
    queueTableOp(moveMode === 'pindah' ? 'move-table' : 'merge-table', { from: sel.no, to: target.no, total: sel.total ?? 0, }); if (moveMode === 'pindah') { persistTableStatus(target, 'terisi'); persistTableStatus(sel, 'kosong'); } else { persistTableStatus(target, 'gabung'); persistTableStatus(sel, 'gabung'); }
    // Bill SQLite ikut pindah agar "pembayaran meja" tetap benar offline (dulu
    // hanya memori + ms_table sehingga bill yatim di meja asal): pindah maupun
    // gabung memindahkan bill terbuka (bukan paid/void) ke meja tujuan.
    void (async () => {
      try {
        await initDb();
        const open = await query<{ salesNum: string }>(
          "SELECT salesNum FROM tr_saleshead WHERE TRIM(COALESCE(tableNo,'')) = TRIM(?) AND status NOT IN ('paid','void')",
          [sel.no],
        );
        if (open.length === 0) return;
        await run(
          "UPDATE tr_saleshead SET tableNo = ?, syncDate = NULL WHERE TRIM(COALESCE(tableNo,'')) = TRIM(?) AND status NOT IN ('paid','void')",
          [target.no, sel.no],
        );
        for (const b of open) {
          try {
            await enqueueOutbox('tr_saleshead', b.salesNum, 'update');
          } catch {
            /* abaikan */
          }
        }
      } catch {
        /* abaikan: status denah tetap berubah */
      }
    })();
    closeModal();
    // F2: pindahkan elapsed ke entri timer tujuan, nolkan asal (best-effort).
    if (moveMode === 'pindah') {
      void writeTimerStore(target.no, sel.seatedMin ?? 0);
      void writeTimerStore(sel.no, 0);
    }
  };

  const cancelTable = () => {
    if (!selected) return;
    if (!confirmCancel) {
      setConfirmCancel(true);
      setCancelWarn('');
      return;
    }
    const id = selected.id;
    const no = selected.no;
    // Jangan kosongkan meja yang masih punya bill terbuka (dulu bill yatim tak
    // bisa dibayar per meja): kasir harus lunasi/void dulu.
    void (async () => {
      try {
        await initDb();
        const open = await query<{ c: number }>(
          "SELECT COUNT(*) AS c FROM tr_saleshead WHERE TRIM(COALESCE(tableNo,'')) = TRIM(?) AND status NOT IN ('paid','void')",
          [no],
        );
        if ((open[0]?.c ?? 0) > 0) {
          setCancelWarn(t('tbl_warn_open_bill').replace('{no}', no));
          setConfirmCancel(false);
          return;
        }
      } catch {
        /* DB belum siap - lanjutkan pengosongan denah */
      }
      setTables((list) =>
        list.map((tb) =>
          tb.id === id ? { ...tb, status: 'kosong' as TableStatus, namaTamu: undefined, total: undefined, seatedMin: undefined } : tb,
        ),
      );
      queueTableOp('table-clear', { table: no }); persistTableStatus({ id, no }, 'kosong'); closeModal();
      // F2: nolkan entri timer agar durasi tak terbaca basi (best-effort).
      void writeTimerStore(no, 0);
    })();
  };

  const toggleHold = () => {
    if (!selected) return;
    const id = selected.id;
    // Hold bertahan saat aplikasi dibuka ulang (dulu memori saja).
    setHeld((h) => {
      const next = { ...h, [id]: !h[id] };
      void (async () => {
        try {
          await setJSON(HELD_KEY, next);
        } catch {
          /* abaikan */
        }
      })();
      return next;
    });
  queueTableOp('order-hold-toggle', { table: selected.no, held: !held[id] }); };

  /** Transaksi cepat (QS): order tanpa meja - langsung buka kasir mode TAKE AWAY. */
  const quickTransaction = () => {
    setQsCount((n) => n + 1);
    navigation?.navigate?.('Cashier');
  };

  const moveTargets = tables.filter((tb) =>
    !selected || tb.id === selected.id
      ? false
      : moveMode === 'pindah'
        ? tb.status === 'kosong'
        : tb.status === 'terisi',
  );

  /** Simpan booking: tandai meja sebagai dipesan di denah + antre sync. */ const saveBooking = () => {
    if (!namaBooking.trim()) { setBookingWarn(t('tbl_bk_need_name')); return; } if (!jamBooking.trim()) { setBookingWarn(t('tbl_bk_need_time')); return; } setBookingWarn(''); const label = `${namaBooking.trim()} · ${jamBooking.trim()}`; if (selected) { const selId = selected.id; const selNo = selected.no; setTables((list) => list.map((tb) => tb.id === selId ? { ...tb, status: 'dipesan' as TableStatus, namaTamu: label } : tb, ), ); queueTableOp('booking-create', { table: selNo, name: namaBooking.trim(), time: jamBooking.trim(), pax: pax.trim() || null });
    // Sinkron ke master meja bila tersedia (best-effort, tidak memblokir).
    void (async () => { try { await initDb(); await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE tableNo = ?', ['dipesan', selNo]); } catch { /* master belum tersedia */ } })(); }
  setBookingVisible(false);
    setSelected(null);
    setNamaBooking('');
    setJamBooking('');
    setPax('');
  };

  /** Tambah meja master: validasi nomor unik + kapasitas, tulis ms_table + outbox/sync. */
  const addTable = () => {
    const no = normNo(newNo);
    const kap = Math.max(0, Math.round(Number(newKap) || 0));
    if (!no) {
      setManageWarn(t('tbl_warn_no'));
      return;
    }
    if (kap <= 0) {
      setManageWarn(t('tbl_warn_cap'));
      return;
    }
    if (tables.some((tb) => normNo(tb.no) === no)) {
      setManageWarn(t('tbl_warn_exists').replace('{no}', no));
      return;
    }
    const section = newSection.trim() || 'Dalam';
    setManageWarn('');
    const id = `t-${Date.now()}`;
    setTables((list) =>
      [...list, { id, no, section, kapasitas: kap, status: 'kosong' as TableStatus }].sort((a, b) =>
        a.no.localeCompare(b.no),
      ),
    );
    setNewNo('');
    setNewKap('');
    void (async () => {
      try {
        await initDb();
        await run(
          'INSERT OR IGNORE INTO ms_table (id, tableNo, sectionId, capacity, status, syncDate) VALUES (?, ?, ?, ?, ?, NULL)',
          [id, no, section, kap, 'kosong'],
        );
        try {
          await enqueueOutbox('ms_table', id, 'insert');
        } catch {
          /* abaikan */
        }
        queueTableOp('table-add', { id, table: no, section, capacity: kap });
      } catch {
        /* abaikan: denah memori tetap tampil */
      }
    })();
  };

  /** Hapus meja master (dua ketuk): hanya meja kosong tanpa bill terbuka. */
  const delTable = (tb: Table) => {
    if (confirmDelTable !== tb.id) {
      setConfirmDelTable(tb.id);
      setManageWarn('');
      return;
    }
    setConfirmDelTable(null);
    if (tb.status !== 'kosong') {
      setManageWarn(t('tbl_warn_not_empty').replace('{no}', tb.no).replace('{st}', tb.status));
      return;
    }
    void (async () => {
      try {
        await initDb();
        const open = await query<{ c: number }>(
          "SELECT COUNT(*) AS c FROM tr_saleshead WHERE TRIM(COALESCE(tableNo,'')) = TRIM(?) AND status NOT IN ('paid','void')",
          [tb.no],
        );
        if ((open[0]?.c ?? 0) > 0) {
          setManageWarn(t('tbl_warn_open_bill_del').replace('{no}', tb.no));
          return;
        }
        await run('DELETE FROM ms_table WHERE id = ?', [tb.id]);
        try {
          await enqueueOutbox('ms_table', tb.id, 'delete');
        } catch {
          /* abaikan */
        }
        queueTableOp('table-delete', { id: tb.id, table: tb.no });
        setTables((list) => list.filter((x) => x.id !== tb.id));
        void writeTimerStore(tb.no, 0);
      } catch {
        setManageWarn(t('tbl_del_fail'));
      }
    })();
  };

  return (
    <View style={s.root}>
      <ScreenHeader
        title={t('title_tables')}
        left={
          <TouchableOpacity
            onPress={() => setDrawerOpen(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('action_open_menu')}>
            <Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      /><View style={s.legend}>
        {(Object.keys(STATUS_META) as TableStatus[]).map((k) => (
          <View key={k} style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: STATUS_META[k].fg }]} />
            <Text style={[s.legendTxt, isTablet && s.legendTxtBig]}>{t(STATUS_LABEL_KEY[k])}</Text>
          </View>
        ))}
        <View style={s.legendRight}>
        {qsCount > 0 && <Text style={s.qsNote}>{t('tbl.qsNote').replace('{n}', String(qsCount))}</Text>}
        <TouchableOpacity onPress={() => { setManageOpen(true); setManageWarn(''); setConfirmDelTable(null); }} style={s.qsBtn}>
          <Text style={[s.qsTxt, isTablet && s.qsTxtBig]}>{t('tbl_manage')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={quickTransaction} style={s.qsBtn}>
          <Text style={[s.qsTxt, isTablet && s.qsTxtBig]}>{t('tbl_quick')}</Text>
        </TouchableOpacity>
        </View>
      </View>

      {/* Satu baris filter: satu chip "Semua" mereset seksi + status;
          logika filter di `shown` tak berubah (dua dimensi tetap digabung). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filters}
        style={s.filtersScroll}>
        <TouchableOpacity
          style={[s.filterChip, section === 'Semua' && filter === 'semua' && s.filterActive]}
          onPress={() => { setSection('Semua'); setFilter('semua'); }}>
          <Text style={[s.filterTxt, section === 'Semua' && filter === 'semua' && s.filterTxtActive, isTablet && s.filterTxtBig]}>{t('tmr_sec_semua')}</Text>
        </TouchableOpacity>
        {(liveSections ?? SECTIONS).filter((sec) => sec !== 'Semua').map((sec) => (
          <TouchableOpacity
            key={sec}
            style={[s.filterChip, section === sec && s.filterActive]}
            onPress={() => setSection(sec)}>
            <Text style={[s.filterTxt, section === sec && s.filterTxtActive, isTablet && s.filterTxtBig]}>{secLabel(sec, t)}</Text>
          </TouchableOpacity>
        ))}
        <View style={s.filterSep} />
        {(['kosong', 'terisi', 'dipesan', 'gabung'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[s.filterChip, filter === f && s.filterActive]}
            onPress={() => setFilter(f)}>
            <Text style={[s.filterTxt, filter === f && s.filterTxtActive, isTablet && s.filterTxtBig]}>
              {t(STATUS_LABEL_KEY[f])}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[s.grid, isTablet && wideCenterLg]}>
        {shown.length === 0 && (
          <View style={s.emptyWrap}>
            <Text style={[s.emptyTxt, isTablet && s.emptyTxtBig]}>{t('tbl_empty')}</Text>
          </View>
        )}
        {shown.map((tb) => {
          const meta = STATUS_META[tb.status];
          const isHeld = !!held[tb.id];
          return (
            <TouchableOpacity
              key={tb.id}
              style={[s.tableCard, isTablet && s.tableCardTablet, { backgroundColor: meta.bg }, isHeld && s.tableHeld]}
              onPress={() => openDetail(tb)}>
              <Text style={[s.tableNo, isTablet && s.tableNoBig]}>{tb.no}</Text>
              <Text style={[s.tableStatus, { color: meta.fg }, isTablet && s.tableStatusBig]}>{t(STATUS_LABEL_KEY[tb.status])}</Text>
              <Text style={[s.tableCap, isTablet && s.tableCapBig]}>{t('tbl_cap_pax').replace('{n}', String(tb.kapasitas))}</Text>
              {tb.total ? (
                <Text style={[s.tableTotal, isTablet && s.tableTotalBig]}>{rp(tb.total)}</Text>
              ) : null}
              {tb.seatedMin !== undefined && (tb.status === 'terisi' || tb.status === 'gabung') ? (
                <Text style={[s.tableDur, isTablet && s.tableDurBig]}>{t('tbl_timer').replace('{d}', fmtDurasi(tb.seatedMin, t('tbl.min'), t('tbl.hour')))}</Text>
              ) : null}
              {isHeld ? <Text style={s.holdBadge}>{t('tbl_hold')}</Text> : null}
              {tb.namaTamu ? (
                <Text style={[s.tableGuest, isTablet && s.tableGuestBig]} numberOfLines={1}>
                  {tb.namaTamu}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Detail / aksi meja */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={closeModal}>
        {/* Ketuk area gelap di luar kartu = tutup (kartu menahan sentuhan sendiri). */}
        <Pressable style={s.modalBg} onPress={closeModal}>
          <View style={[s.modalCard, isTablet && s.modalCardTablet]} onStartShouldSetResponder={() => true}>
            {selected ? (
              moveMode ? (
                <>
                  <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>
                    {moveMode === 'pindah' ? t('tbl_move_from').replace('{no}', selected.no) : t('tbl_merge_with').replace('{no}', selected.no)}
                  </Text>
                  <Text style={[s.modalHint, isTablet && s.modalHintBig]}>
                    {moveMode === 'pindah'
                      ? t('tbl_move_hint_empty')
                      : t('tbl_move_hint_filled')}
                  </Text>
                  {moveTargets.length === 0 && (
                    <Text style={[s.modalHint, isTablet && s.modalHintBig]}>
                      {moveMode === 'pindah' ? t('tbl_no_empty') : t('tbl_no_filled')}
                    </Text>
                  )}
                  {moveTargets.map((tb) => (
                    <TouchableOpacity key={tb.id} style={s.targetRow} onPress={() => applyMove(tb)}>
                      <Text style={[s.targetNo, isTablet && s.targetNoBig]}>{t('tbl_table_no').replace('{no}', tb.no)}</Text>
                      <Text style={[s.targetMeta, isTablet && s.targetMetaBig]}>
                        {t(STATUS_LABEL_KEY[tb.status])} • {t('tbl_cap_pax').replace('{n}', String(tb.kapasitas))}
                        {tb.total ? ` • ${rp(tb.total)}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setMoveMode(null)}>
                    <Text style={[s.cancelTxt, isTablet && s.cancelTxtBig]}>{t('c_back')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
              <>
                <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>{t('tbl_table_no').replace('{no}', selected.no)}</Text>
                <Text style={[s.modalHint, isTablet && s.modalHintBig]}>
                  {t(STATUS_LABEL_KEY[selected.status])} • {secLabel(selected.section, t)} • {t('tbl_cap_pax').replace('{n}', String(selected.kapasitas))}
                  {selected.namaTamu ? ` • ${selected.namaTamu}` : ''}
                  {selected.total ? ` • ${rp(selected.total)}` : ''}
                  {selected.seatedMin !== undefined ? ` • ${fmtDurasi(selected.seatedMin, t('tbl.min'), t('tbl.hour'))}` : ''}
                  {held[selected.id] ? ` • ${t('tbl_hold')}` : ''}
                </Text>
                <AppButton
                  title={selected.status === 'kosong' ? t('tbl_create_order') : t('tbl_open_order')}
                  onPress={() => {
                    const tb = selected;
                    closeModal();
                    void openTableOrder(tb);
                  }}
                />
                <View style={s.actionRow}>
                  <AppButton title={t('tbl_book')} variant="secondary" onPress={() => setBookingVisible(true)} fullWidth={false} style={s.actionBtn} />
                  {selected.status !== 'kosong' && (
                    <AppButton title={held[selected.id] ? t('tbl_resume_order') : t('tbl_hold_order')} variant="secondary" onPress={toggleHold} fullWidth={false} style={s.actionBtn} />
                  )}
                </View>
                <View style={s.actionRow}>
                  {selected.status !== 'kosong' && (
                    <AppButton
                      title={t('tbl_move')}
                      variant="secondary"
                      onPress={() => {
                        closeModal();
                        navigation?.navigate?.('MoveTable', { from: selected.no });
                      }}
                      fullWidth={false}
                      style={s.actionBtn}
                    />
                  )}
                  {selected.status === 'terisi' && (
                    <AppButton title={t('tbl_merge')} variant="secondary" onPress={() => setMoveMode('gabung')} fullWidth={false} style={s.actionBtn} />
                  )}
                </View>
                {selected.status !== 'kosong' && (
                  <View style={s.actionRow}>
                    <AppButton
                      title={t('tbl_move_items')}
                      variant="secondary"
                      onPress={() => {
                        closeModal();
                        navigation?.navigate?.('MoveItems', { from: selected.no });
                      }}
                      fullWidth={false}
                      style={s.actionBtn}
                    />
                    <AppButton
                      title={confirmCancel ? t('tbl_confirm_again') : t('tbl_cancel_table')}
                      variant="danger"
                      onPress={cancelTable}
                      fullWidth={false}
                      style={s.actionBtn}
                    />
                  </View>
                )}
                {cancelWarn ? <Text style={s.warn}>{cancelWarn}</Text> : null}
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={closeModal}>
                  <Text style={[s.cancelTxt, isTablet && s.cancelTxtBig]}>{t('cm_close')}</Text>
                </TouchableOpacity>
              </>
              )
            ) : null}
          </View>
        </Pressable>
      </Modal>

      {/* Booking */}
      <Modal visible={bookingVisible} transparent animationType="slide" onRequestClose={() => setBookingVisible(false)}>
        <Pressable style={s.modalBg} onPress={() => setBookingVisible(false)}>
          <View style={[s.modalCard, isTablet && s.modalCardTablet]} onStartShouldSetResponder={() => true}>
            <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>
              {t('tbl_book')}{selected ? ` ${selected.no}` : ''}
            </Text>
            <Text style={[s.modalHint, isTablet && s.modalHintBig]}>{t('tbl_book_hint')}</Text>
            <AppInput
              placeholder={t('tbl_bk_name_ph')}
              value={namaBooking}
              onChangeText={setNamaBooking}
            />
            <View style={s.inputRow}>
              <View style={[s.inputHalf, s.inputHalfWrap]}>
                <AppInput
                  placeholder={t('tbl_bk_time_ph')}
                  value={jamBooking}
                  onChangeText={setJamBooking}
                />
              </View>
              <View style={[s.inputHalf, s.inputHalfWrap]}>
                <AppInput
                  placeholder={t('tbl_bk_pax_ph')}
                  keyboardType="number-pad"
                  value={pax}
                  onChangeText={setPax}
                />
              </View>
            </View>
            {bookingWarn ? <Text style={s.warn}>{bookingWarn}</Text> : null}<AppButton title={t('tbl_save_book')} onPress={saveBooking} />
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => setBookingVisible(false)}>
              <Text style={[s.cancelTxt, isTablet && s.cancelTxtBig]}>{t('cm_cancel')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
      {/* Kelola meja (pengaturan denah): tambah + hapus meja master. */}
      <Modal visible={manageOpen} transparent animationType="slide" onRequestClose={() => setManageOpen(false)}>
        <Pressable style={s.modalBg} onPress={() => setManageOpen(false)}>
          <View style={[s.modalCard, isTablet && s.modalCardTablet]} onStartShouldSetResponder={() => true}>
            <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>
              {t('tbl_manage_title')}
            </Text>
            <Text style={[s.modalHint, isTablet && s.modalHintBig]}>{t('tbl_manage_hint')}</Text>
            {/* M9-3: tambah/hapus meja = local-only (tanpa push master). */}
            <Text style={[s.modalHint, isTablet && s.modalHintBig]}>{t('master.localOnlyNote')}</Text>
            <View style={s.inputRow}>
              <View style={[s.inputHalf, s.inputHalfWrap]}>
                <AppInput
                  placeholder={t('tbl_new_no_ph')}
                  value={newNo}
                  onChangeText={setNewNo}
                />
              </View>
              <View style={[s.inputHalf, s.inputHalfWrap]}>
                <AppInput
                  placeholder={t('tbl_new_cap_ph')}
                  keyboardType="number-pad"
                  value={newKap}
                  onChangeText={(v) => setNewKap(v.replace(/[^0-9]/g, ''))}
                />
              </View>
            </View>
            <AppInput
              placeholder={t('tbl_new_sec_ph')}
              value={newSection}
              onChangeText={setNewSection}
            />
            {manageWarn ? <Text style={s.warn}>{manageWarn}</Text> : null}
            <AppButton title={t('tbl_add_table')} onPress={addTable} />
            <Text style={[s.modalHint, isTablet && s.modalHintBig]}>{t('tbl_del_hint')}</Text>
            {tables.map((tb) => (
              <View key={tb.id} style={s.targetRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.targetNo, isTablet && s.targetNoBig]}>{t('tbl_table_no').replace('{no}', tb.no)}</Text>
                  <Text style={[s.targetMeta, isTablet && s.targetMetaBig]}>
                    {t(STATUS_LABEL_KEY[tb.status])} • {secLabel(tb.section, t)} • {t('tbl_cap_pax').replace('{n}', String(tb.kapasitas))}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => delTable(tb)} hitSlop={10}>
                  <Text style={[s.cancelTxt, isTablet && s.cancelTxtBig, { color: colors.red }]}>
                    {confirmDelTable === tb.id ? t('tbl_del_confirm') : t('delete')}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => setManageOpen(false)}>
              <Text style={[s.cancelTxt, isTablet && s.cancelTxtBig]}>{t('cm_close')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={(r) => { navigation?.navigate?.(r); }} /></View>
  );}const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  burger: { width: 22, height: 22 },

  qsBtn: { backgroundColor: colors.orange, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  qsTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  legendTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  qsNote: { fontSize: 12, fontFamily: fonts.semibold, color: colors.orangeDark },
  legendRight: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', gap: 8 },
  filtersScroll: { flexGrow: 0 },
  filters: { flexDirection: 'row', padding: 12, paddingRight: 20, alignItems: 'center' },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginRight: 8,
    flexShrink: 0,
  },
  filterActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  filterTxtActive: { color: colors.white },
  filterSep: { width: 1, height: 22, backgroundColor: colors.line, marginRight: 8 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    paddingBottom: 24,
  },
  emptyWrap: { width: '100%', alignItems: 'center', paddingVertical: 32 },
  emptyTxt: { fontSize: 13, fontFamily: fonts.medium, color: colors.faint },
  tableCard: {
    width: '30%',
    margin: '1.66%',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    minHeight: 110,
    justifyContent: 'center',
  },
  /* Tablet: denah 4 kolom rapat (21.5% + margin = muat 4 per baris). */
  tableCardTablet: { width: '21.5%', minHeight: 128, padding: 16 },
  tableHeld: { borderWidth: 2, borderColor: colors.amber },
  tableNo: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },
  tableStatus: { fontSize: 12, fontFamily: fonts.bold, marginTop: 2 },
  tableCap: { fontSize: 11, fontFamily: fonts.regular, color: colors.muted },
  tableTotal: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.navy,
    marginTop: 4,
  },
  tableDur: { fontSize: 11, fontFamily: fonts.semibold, color: colors.orangeDark, marginTop: 2 },
  holdBadge: { fontSize: 11, fontFamily: fonts.bold, color: colors.amberDark, marginTop: 2 },
  tableGuest: { fontSize: 11, fontFamily: fonts.medium, color: colors.muted },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
  },
  modalHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryTxt: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  actionRow: { flexDirection: 'row', marginTop: 8 },
  actionBtn: { flex: 1, marginTop: 0, marginHorizontal: 4 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  secondaryTxt: { fontSize: 13, fontFamily: fonts.medium, color: colors.navy },
  dangerBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  dangerTxt: { fontSize: 13, fontFamily: fonts.medium, color: colors.red },
  dangerBtnSolid: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.red,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  dangerSolidTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.white },
  targetRow: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  targetNo: { fontSize: 15, fontFamily: fonts.bold, color: colors.navy },
  targetMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  cancelBtn: { marginTop: 10, padding: 10, alignItems: 'center' },
  cancelTxt: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  inputRow: { flexDirection: 'row' },
  inputHalf: { flex: 1, marginHorizontal: 4 },
  inputHalfWrap: { marginTop: 10 },
  /* Varian tablet (breakpoint TABLET_BP): teks +1..4pt agar proporsional di layar lebar. */
  emptyTxtBig: { fontSize: 14 },
  legendTxtBig: { fontSize: 13 },
  qsTxtBig: { fontSize: 14 },
  filterTxtBig: { fontSize: 13 },
  tableNoBig: { fontSize: 24 },
  tableStatusBig: { fontSize: 13 },
  tableCapBig: { fontSize: 12 },
  tableTotalBig: { fontSize: 14 },
  tableDurBig: { fontSize: 12 },
  tableGuestBig: { fontSize: 12 },
  modalCardTablet: { maxWidth: 640, width: '100%', alignSelf: 'center' },
  modalTitleBig: { fontSize: 19 },
  modalHintBig: { fontSize: 14 },
  primaryTxtBig: { fontSize: 16 },
  secondaryTxtBig: { fontSize: 14 },
  dangerTxtBig: { fontSize: 14 },
  dangerSolidTxtBig: { fontSize: 14 },
  targetNoBig: { fontSize: 16 },
  targetMetaBig: { fontSize: 13 },
  cancelTxtBig: { fontSize: 15 },
warn: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red, marginTop: 8, textAlign: 'center' },});