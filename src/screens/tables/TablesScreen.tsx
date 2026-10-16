import React, { useEffect, useState } from 'react';import {
  Image, Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { useLang } from '../../lib/i18n';import { initDb, run } from '../../lib/db';import { getJSON, setJSON } from '../../lib/storage';import { enqueueSync } from '../../lib/sync';type Props = { navigation?: any };type TableStatus = 'kosong' | 'terisi' | 'dipesan' | 'gabung';type Table = {
  id: string;
  no: string;
  section: string;
  kapasitas: number;
  status: TableStatus;
  total?: number;
  namaTamu?: string;
  /** Menit sejak tamu duduk - timer durasi meja terisi (dipulihkan dari storage). */
  seatedMin?: number;};const TABLES: Table[] = [
  { id: '1', no: 'A1', section: 'Dalam', kapasitas: 2, status: 'kosong' },
  { id: '2', no: 'A2', section: 'Dalam', kapasitas: 2, status: 'terisi', total: 185000, namaTamu: 'Budi', seatedMin: 25 },
  { id: '3', no: 'A3', section: 'Dalam', kapasitas: 4, status: 'kosong' },
  { id: '4', no: 'A4', section: 'Dalam', kapasitas: 4, status: 'dipesan', namaTamu: 'Sinta · 19:00' },
  { id: '5', no: 'B1', section: 'Teras', kapasitas: 4, status: 'terisi', total: 96000, namaTamu: 'Andi', seatedMin: 48 },
  { id: '6', no: 'B2', section: 'Teras', kapasitas: 6, status: 'gabung', namaTamu: 'B2+B3 · 12 tamu', seatedMin: 70 },
  { id: '7', no: 'B3', section: 'Teras', kapasitas: 6, status: 'gabung', namaTamu: 'B2+B3 · 12 tamu', seatedMin: 70 },
  { id: '8', no: 'C1', section: 'VIP', kapasitas: 2, status: 'kosong' },
  { id: '9', no: 'C2', section: 'VIP', kapasitas: 8, status: 'dipesan', namaTamu: 'Rapat · 20:00' },];const SECTIONS = ['Semua', 'Dalam', 'Teras', 'VIP'];/** Snapshot timer meja agar durasi bertahan saat aplikasi dibuka ulang. */const SEATED_KEY = 'genfity.tables.seatedMin';const STATUS_META: Record<TableStatus, { label: string; bg: string; fg: string }> = {
  kosong: { label: 'Tersedia', bg: colors.paleGreen, fg: colors.green },
  terisi: { label: 'Terisi', bg: colors.paleRed, fg: colors.red },
  dipesan: { label: 'Dipesan', bg: colors.paleOrange, fg: colors.orange },
  gabung: { label: 'Gabung', bg: colors.paleBlue, fg: colors.navy },};/** Format durasi duduk ala POSLite: "25 mnt" / "1 jam 10 mnt". */function fmtDurasi(min?: number): string {
  if (min === undefined) return '';
  if (min < 60) return `${min} mnt`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} jam` : `${h} jam ${m} mnt`;}/** Catat mutasi meja ke antrean sync (offline-first, tidak memblokir UI). */function queueTableOp(op: string, payload: Record<string, unknown>): void { try { enqueueSync('other', { op, ...payload, at: new Date().toISOString() });
}

catch { /* antrean belum siap */ }}/** Denah meja - section, status, timer durasi, hold order, transaksi cepat (QS). */export default function TablesScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [tables, setTables] = useState<Table[]>(TABLES);
  const [section, setSection] = useState('Semua');
  const [filter, setFilter] = useState<'semua' | TableStatus>('semua');
  const [selected, setSelected] = useState<Table | null>(null);
  const [moveMode, setMoveMode] = useState<'pindah' | 'gabung' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [bookingVisible, setBookingVisible] = useState(false);
  const [namaBooking, setNamaBooking] = useState('');
  const [jamBooking, setJamBooking] = useState('');
  const [pax, setPax] = useState('');
  const [bookingWarn, setBookingWarn] = useState(''); /** Hold order: order ditahan, meja tetap terisi tapi ditandai. */
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [qsCount, setQsCount] = useState(0);

  // Pulihkan snapshot timer meja dari storage saat layar dibuka.
  useEffect(() => { let on = true; void getJSON<Record<string, number>>(SEATED_KEY, {}).then((saved) => { if (!on) return; setTables((list) => list.map((tb) => saved[tb.id] !== undefined && (tb.status === 'terisi' || tb.status === 'gabung') ? { ...tb, seatedMin: saved[tb.id] } : tb, ), ); }); return () => { on = false; }; }, []);
  // Timer durasi: tiap menit tambah 1 menit utk meja terisi/gabung + simpan snapshot.
  useEffect(() => {
    const timer = setInterval(() => {
      setTables((list) =>
        { const next = list.map((tb) =>
          tb.status === 'terisi' || tb.status === 'gabung'
            ? { ...tb, seatedMin: (tb.seatedMin ?? 0) + 1 }
            : tb,

      );
    const snap: Record<string, number> = {}; for (const tb of next) { if (tb.seatedMin !== undefined && (tb.status === 'terisi' || tb.status === 'gabung')) { snap[tb.id] = tb.seatedMin; } } void setJSON(SEATED_KEY, snap); return next; }); }, 60000);
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
    queueTableOp(moveMode === 'pindah' ? 'move-table' : 'merge-table', { from: sel.no, to: target.no, total: sel.total ?? 0, }); closeModal();
  };

  const cancelTable = () => {
    if (!selected) return;
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    const id = selected.id;
    const no = selected.no; setTables((list) =>
      list.map((tb) =>
        tb.id === id ? { ...tb, status: 'kosong' as TableStatus, namaTamu: undefined, total: undefined, seatedMin: undefined } : tb,
      ),
    );
    queueTableOp('table-clear', { table: no }); closeModal();
  };

  const toggleHold = () => {
    if (!selected) return;
    const id = selected.id;
    setHeld((h) => ({ ...h, [id]: !h[id] }));
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
    if (!namaBooking.trim()) { setBookingWarn('Isi nama pelanggan dulu.'); return; } if (!jamBooking.trim()) { setBookingWarn('Isi jam reservasi dulu.'); return; } setBookingWarn(''); const label = `${namaBooking.trim()} · ${jamBooking.trim()}`; if (selected) { const selId = selected.id; const selNo = selected.no; setTables((list) => list.map((tb) => tb.id === selId ? { ...tb, status: 'dipesan' as TableStatus, namaTamu: label } : tb, ), ); queueTableOp('booking-create', { table: selNo, name: namaBooking.trim(), time: jamBooking.trim(), pax: pax.trim() || null });
    // Sinkron ke master meja bila tersedia (best-effort, tidak memblokir).
    void (async () => { try { await initDb(); await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE tableNo = ?', ['dipesan', selNo]); } catch { /* master belum tersedia */ } })(); }
  setBookingVisible(false);
    setSelected(null);
    setNamaBooking('');
    setJamBooking('');
    setPax('');
  };

  return (
    <View style={s.root}>
      <ScreenHeader title={t('title_tables')} onBack={() => navigation?.goBack?.()} right={ <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}> <Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
        </TouchableOpacity>

      } /> <View style={s.legend}>
        {(Object.keys(STATUS_META) as TableStatus[]).map((k) => (
          <View key={k} style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: STATUS_META[k].fg }]} />
            <Text style={[s.legendTxt, isTablet && s.legendTxtBig]}>{STATUS_META[k].label}</Text>
          </View>
        ))}
        <View style={s.legendRight}>
        {qsCount > 0 && <Text style={s.qsNote}>{qsCount} QS shift ini</Text>}
        <TouchableOpacity onPress={quickTransaction} style={s.qsBtn}>
          <Text style={[s.qsTxt, isTablet && s.qsTxtBig]}>+ QS</Text>
        </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filters}
        style={s.filtersScroll}>
        {SECTIONS.map((sec) => (
          <TouchableOpacity
            key={sec}
            style={[s.filterChip, section === sec && s.filterActive]}
            onPress={() => setSection(sec)}>
            <Text style={[s.filterTxt, section === sec && s.filterTxtActive, isTablet && s.filterTxtBig]}>{sec}</Text>
          </TouchableOpacity>
        ))}
        <View style={s.filterSep} />
        {(['semua', 'kosong', 'terisi', 'dipesan', 'gabung'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[s.filterChip, filter === f && s.filterActive]}
            onPress={() => setFilter(f)}>
            <Text style={[s.filterTxt, filter === f && s.filterTxtActive, isTablet && s.filterTxtBig]}>
              {f === 'semua' ? 'Semua' : STATUS_META[f].label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[s.grid, isTablet && wideCenterLg]}>
        {shown.map((tb) => {
          const meta = STATUS_META[tb.status];
          const isHeld = !!held[tb.id];
          return (
            <TouchableOpacity
              key={tb.id}
              style={[s.tableCard, { backgroundColor: meta.bg }, isHeld && s.tableHeld]}
              onPress={() => openDetail(tb)}>
              <Text style={[s.tableNo, isTablet && s.tableNoBig]}>{tb.no}</Text>
              <Text style={[s.tableStatus, { color: meta.fg }, isTablet && s.tableStatusBig]}>{meta.label}</Text>
              <Text style={[s.tableCap, isTablet && s.tableCapBig]}>{tb.kapasitas} tamu</Text>
              {tb.total ? (
                <Text style={[s.tableTotal, isTablet && s.tableTotalBig]}>{rp(tb.total)}</Text>
              ) : null}
              {tb.seatedMin !== undefined && (tb.status === 'terisi' || tb.status === 'gabung') ? (
                <Text style={[s.tableDur, isTablet && s.tableDurBig]}>Timer {fmtDurasi(tb.seatedMin)}</Text>
              ) : null}
              {isHeld ? <Text style={s.holdBadge}>Hold</Text> : null}
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
        <View style={s.modalBg}>
          <View style={[s.modalCard, isTablet && s.modalCardTablet]}>
            {selected ? (
              moveMode ? (
                <>
                  <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>
                    {moveMode === 'pindah' ? `Pindah dari Meja ${selected.no}` : `Gabung Meja ${selected.no}`}
                  </Text>
                  <Text style={[s.modalHint, isTablet && s.modalHintBig]}>
                    {moveMode === 'pindah'
                      ? 'Pilih meja kosong tujuan - tamu dan total ikut pindah.'
                      : 'Pilih meja terisi tujuan - total digabungkan.'}
                  </Text>
                  {moveTargets.length === 0 && (
                    <Text style={[s.modalHint, isTablet && s.modalHintBig]}>
                      {moveMode === 'pindah' ? 'Tidak ada meja kosong.' : 'Tidak ada meja terisi lain.'}
                    </Text>
                  )}
                  {moveTargets.map((tb) => (
                    <TouchableOpacity key={tb.id} style={s.targetRow} onPress={() => applyMove(tb)}>
                      <Text style={[s.targetNo, isTablet && s.targetNoBig]}>Meja {tb.no}</Text>
                      <Text style={[s.targetMeta, isTablet && s.targetMetaBig]}>
                        {STATUS_META[tb.status].label} • {tb.kapasitas} pax
                        {tb.total ? ` • ${rp(tb.total)}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setMoveMode(null)}>
                    <Text style={[s.cancelTxt, isTablet && s.cancelTxtBig]}>Kembali</Text>
                  </TouchableOpacity>
                </>
              ) : (
              <>
                <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>Meja {selected.no}</Text>
                <Text style={[s.modalHint, isTablet && s.modalHintBig]}>
                  {STATUS_META[selected.status].label} • {selected.section} • {selected.kapasitas} pax
                  {selected.namaTamu ? ` • ${selected.namaTamu}` : ''}
                  {selected.total ? ` • ${rp(selected.total)}` : ''}
                  {selected.seatedMin !== undefined ? ` • ${fmtDurasi(selected.seatedMin)}` : ''}
                  {held[selected.id] ? ' • Hold' : ''}
                </Text>
                <TouchableOpacity
                  style={s.primaryBtn}
                  onPress={() => {
                    closeModal();
                    navigation?.navigate?.('Cashier', { table: selected.no });
                  }}>
                  <Text style={[s.primaryTxt, isTablet && s.primaryTxtBig]}>
                    {selected.status === 'kosong' ? 'Buat Pesanan' : 'Buka Pesanan'}
                  </Text>
                </TouchableOpacity>
                <View style={s.actionRow}>
                  <TouchableOpacity
                    style={s.secondaryBtn}
                    onPress={() => setBookingVisible(true)}>
                    <Text style={[s.secondaryTxt, isTablet && s.secondaryTxtBig]}>{t('tbl_book')}</Text>
                  </TouchableOpacity>
                  {selected.status !== 'kosong' && (
                    <TouchableOpacity
                      style={s.secondaryBtn}
                      onPress={toggleHold}>
                      <Text style={[s.secondaryTxt, isTablet && s.secondaryTxtBig]}>{held[selected.id] ? 'Lanjut Order' : 'Hold Order'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={s.actionRow}>
                  {selected.status !== 'kosong' && (
                    <TouchableOpacity
                      style={s.secondaryBtn}
                      onPress={() => {
                        closeModal();
                        navigation?.navigate?.('MoveTable', { from: selected.no });
                      }}>
                      <Text style={[s.secondaryTxt, isTablet && s.secondaryTxtBig]}>{t('tbl_move')}</Text>
                    </TouchableOpacity>
                  )}
                  {selected.status === 'terisi' && (
                    <TouchableOpacity
                      style={s.secondaryBtn}
                      onPress={() => setMoveMode('gabung')}>
                      <Text style={[s.secondaryTxt, isTablet && s.secondaryTxtBig]}>{t('tbl_merge')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {selected.status !== 'kosong' && (
                  <View style={s.actionRow}>
                    <TouchableOpacity
                      style={s.secondaryBtn}
                      onPress={() => {
                        closeModal();
                        navigation?.navigate?.('MoveItems', { from: selected.no });
                      }}>
                      <Text style={[s.secondaryTxt, isTablet && s.secondaryTxtBig]}>{t('tbl_move_items')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={confirmCancel ? s.dangerBtnSolid : s.dangerBtn}
                      onPress={cancelTable}>
                      <Text style={[confirmCancel ? s.dangerSolidTxt : s.dangerTxt, isTablet && s.secondaryTxtBig]}>
                        {confirmCancel ? 'Yakin? Ketuk lagi' : t('tbl_cancel_table')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={closeModal}>
                  <Text style={[s.cancelTxt, isTablet && s.cancelTxtBig]}>{t('cm_close')}</Text>
                </TouchableOpacity>
              </>
              )
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Booking */}
      <Modal visible={bookingVisible} transparent animationType="slide" onRequestClose={() => setBookingVisible(false)}>
        <View style={s.modalBg}>
          <View style={[s.modalCard, isTablet && s.modalCardTablet]}>
            <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>
              {t('tbl_book')}{selected ? ` ${selected.no}` : ''}
            </Text>
            <Text style={[s.modalHint, isTablet && s.modalHintBig]}>Sudah memesan meja? Catat reservasi</Text>
            <TextInput
              style={s.input}
              placeholder="Nama pelanggan"
              placeholderTextColor={colors.faint}
              value={namaBooking}
              onChangeText={setNamaBooking}
            />
            <View style={s.inputRow}>
              <TextInput
                style={[s.input, s.inputHalf]}
                placeholder="Jam (19:00)"
                placeholderTextColor={colors.faint}
                value={jamBooking}
                onChangeText={setJamBooking}
              />
              <TextInput
                style={[s.input, s.inputHalf]}
                placeholder="Pax"
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
                value={pax}
                onChangeText={setPax}
              />
            </View>
            {bookingWarn ? <Text style={s.warn}>{bookingWarn}</Text> : null} <TouchableOpacity style={s.primaryBtn} onPress={saveBooking}>
              <Text style={[s.primaryTxt, isTablet && s.primaryTxtBig]}>{t('tbl_save_book')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => setBookingVisible(false)}>
              <Text style={[s.cancelTxt, isTablet && s.cancelTxtBig]}>{t('cm_cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={(r) => { navigation?.navigate?.(r); }} /> </View>
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
  tableCard: {
    width: '30%',
    margin: '1.66%',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    minHeight: 110,
    justifyContent: 'center',
  },
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
  /* Varian tablet (breakpoint 768): teks +1..4pt agar proporsional di layar lebar. */
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