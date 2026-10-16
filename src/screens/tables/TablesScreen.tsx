import React, { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, rp, wideCenterLg } from '../../theme';

type Props = { navigation?: any };

type TableStatus = 'kosong' | 'terisi' | 'dipesan' | 'gabung';

type Table = {
  id: string;
  no: string;
  section: string;
  kapasitas: number;
  status: TableStatus;
  total?: number;
  namaTamu?: string;
  /** Menit sejak tamu duduk — timer durasi meja terisi. */
  seatedMin?: number;
};

const TABLES: Table[] = [
  { id: '1', no: 'A1', section: 'Dalam', kapasitas: 2, status: 'kosong' },
  { id: '2', no: 'A2', section: 'Dalam', kapasitas: 2, status: 'terisi', total: 185000, namaTamu: 'Budi', seatedMin: 25 },
  { id: '3', no: 'A3', section: 'Dalam', kapasitas: 4, status: 'kosong' },
  { id: '4', no: 'A4', section: 'Dalam', kapasitas: 4, status: 'dipesan', namaTamu: 'Sinta · 19:00' },
  { id: '5', no: 'B1', section: 'Teras', kapasitas: 4, status: 'terisi', total: 96000, namaTamu: 'Andi', seatedMin: 48 },
  { id: '6', no: 'B2', section: 'Teras', kapasitas: 6, status: 'gabung', namaTamu: 'B2+B3 · 12 tamu', seatedMin: 70 },
  { id: '7', no: 'B3', section: 'Teras', kapasitas: 6, status: 'gabung', namaTamu: 'B2+B3 · 12 tamu', seatedMin: 70 },
  { id: '8', no: 'C1', section: 'VIP', kapasitas: 2, status: 'kosong' },
  { id: '9', no: 'C2', section: 'VIP', kapasitas: 8, status: 'dipesan', namaTamu: 'Rapat · 20:00' },
];

const SECTIONS = ['Semua', 'Dalam', 'Teras', 'VIP'];

const STATUS_META: Record<TableStatus, { label: string; bg: string; fg: string }> = {
  kosong: { label: 'Tersedia', bg: colors.paleGreen, fg: colors.green },
  terisi: { label: 'Terisi', bg: colors.paleRed, fg: colors.red },
  dipesan: { label: 'Dipesan', bg: colors.paleOrange, fg: colors.orange },
  gabung: { label: 'Gabung', bg: colors.paleBlue, fg: colors.navy },
};

/** Format durasi duduk ala POSLite: "25 mnt" / "1 jam 10 mnt". */
function fmtDurasi(min?: number): string {
  if (min === undefined) return '';
  if (min < 60) return `${min} mnt`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} jam` : `${h} jam ${m} mnt`;
}

/** Denah meja — section, status, timer durasi, hold order, transaksi cepat (QS). */
export default function TablesScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [tables, setTables] = useState<Table[]>(TABLES);
  const [section, setSection] = useState('Semua');
  const [filter, setFilter] = useState<'semua' | TableStatus>('semua');
  const [selected, setSelected] = useState<Table | null>(null);
  const [moveMode, setMoveMode] = useState<'pindah' | 'gabung' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [bookingVisible, setBookingVisible] = useState(false);
  const [namaBooking, setNamaBooking] = useState('');
  const [jamBooking, setJamBooking] = useState('');
  const [pax, setPax] = useState('');
  /** Hold order: order ditahan, meja tetap terisi tapi ditandai. */
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [qsCount, setQsCount] = useState(0);

  // Timer durasi: tiap menit tambah 1 menit utk meja terisi/gabung.
  useEffect(() => {
    const t = setInterval(() => {
      setTables((list) =>
        list.map((tb) =>
          tb.status === 'terisi' || tb.status === 'gabung'
            ? { ...tb, seatedMin: (tb.seatedMin ?? 0) + 1 }
            : tb,
        ),
      );
    }, 60000);
    return () => clearInterval(t);
  }, []);

  const shown = tables.filter(
    (t) =>
      (section === 'Semua' || t.section === section) &&
      (filter === 'semua' || t.status === filter),
  );

  const openDetail = (t: Table) => {
    setSelected(t);
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
      list.map((t) => {
        if (moveMode === 'pindah') {
          if (t.id === target.id)
            return { ...t, status: 'terisi' as TableStatus, namaTamu: sel.namaTamu, total: sel.total, seatedMin: sel.seatedMin ?? 0 };
          if (t.id === sel.id)
            return { ...t, status: 'kosong' as TableStatus, namaTamu: undefined, total: undefined, seatedMin: undefined };
          return t;
        }
        // gabung
        if (t.id === target.id)
          return {
            ...t,
            status: 'gabung' as TableStatus,
            total: (t.total ?? 0) + (sel.total ?? 0),
            namaTamu: `${t.no}+${sel.no}${t.namaTamu ? ` · ${t.namaTamu}` : ''}`,
          };
        if (t.id === sel.id)
          return { ...t, status: 'gabung' as TableStatus, namaTamu: `${sel.no}+${target.no}`, total: undefined };
        return t;
      }),
    );
    closeModal();
  };

  const cancelTable = () => {
    if (!selected) return;
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    const id = selected.id;
    setTables((list) =>
      list.map((t) =>
        t.id === id ? { ...t, status: 'kosong' as TableStatus, namaTamu: undefined, total: undefined, seatedMin: undefined } : t,
      ),
    );
    closeModal();
  };

  const toggleHold = () => {
    if (!selected) return;
    const id = selected.id;
    setHeld((h) => ({ ...h, [id]: !h[id] }));
  };

  /** Transaksi cepat (QS): order tanpa meja — langsung buka kasir mode TAKE AWAY. */
  const quickTransaction = () => {
    setQsCount((n) => n + 1);
    navigation?.navigate?.('Cashier');
  };

  const moveTargets = tables.filter((t) =>
    !selected || t.id === selected.id
      ? false
      : moveMode === 'pindah'
        ? t.status === 'kosong'
        : t.status === 'terisi',
  );

  const saveBooking = () => {
    setBookingVisible(false);
    setSelected(null);
    setNamaBooking('');
    setJamBooking('');
    setPax('');
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Peta Meja</Text>
        <TouchableOpacity onPress={quickTransaction} style={s.qsBtn}>
          <Text style={s.qsTxt}>+ QS</Text>
        </TouchableOpacity>
      </View>

      <View style={s.legend}>
        {(Object.keys(STATUS_META) as TableStatus[]).map((k) => (
          <View key={k} style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: STATUS_META[k].fg }]} />
            <Text style={s.legendTxt}>{STATUS_META[k].label}</Text>
          </View>
        ))}
        {qsCount > 0 && <Text style={s.qsNote}>{qsCount} QS shift ini</Text>}
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
            <Text style={[s.filterTxt, section === sec && s.filterTxtActive]}>{sec}</Text>
          </TouchableOpacity>
        ))}
        <View style={s.filterSep} />
        {(['semua', 'kosong', 'terisi', 'dipesan', 'gabung'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[s.filterChip, filter === f && s.filterActive]}
            onPress={() => setFilter(f)}>
            <Text style={[s.filterTxt, filter === f && s.filterTxtActive]}>
              {f === 'semua' ? 'Semua' : STATUS_META[f].label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[s.grid, isTablet && wideCenterLg]}>
        {shown.map((t) => {
          const meta = STATUS_META[t.status];
          const isHeld = !!held[t.id];
          return (
            <TouchableOpacity
              key={t.id}
              style={[s.tableCard, { backgroundColor: meta.bg }, isHeld && s.tableHeld]}
              onPress={() => openDetail(t)}>
              <Text style={s.tableNo}>{t.no}</Text>
              <Text style={[s.tableStatus, { color: meta.fg }]}>{meta.label}</Text>
              <Text style={s.tableCap}>{t.kapasitas} tamu</Text>
              {t.total ? (
                <Text style={s.tableTotal}>{rp(t.total)}</Text>
              ) : null}
              {t.seatedMin !== undefined && (t.status === 'terisi' || t.status === 'gabung') ? (
                <Text style={s.tableDur}>⏱ {fmtDurasi(t.seatedMin)}</Text>
              ) : null}
              {isHeld ? <Text style={s.holdBadge}>⏸ Hold</Text> : null}
              {t.namaTamu ? (
                <Text style={s.tableGuest} numberOfLines={1}>
                  {t.namaTamu}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Detail / aksi meja */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            {selected ? (
              moveMode ? (
                <>
                  <Text style={s.modalTitle}>
                    {moveMode === 'pindah' ? `Pindah dari Meja ${selected.no}` : `Gabung Meja ${selected.no}`}
                  </Text>
                  <Text style={s.modalHint}>
                    {moveMode === 'pindah'
                      ? 'Pilih meja kosong tujuan — tamu & total ikut pindah.'
                      : 'Pilih meja terisi tujuan — total digabungkan.'}
                  </Text>
                  {moveTargets.length === 0 && (
                    <Text style={s.modalHint}>
                      {moveMode === 'pindah' ? 'Tidak ada meja kosong.' : 'Tidak ada meja terisi lain.'}
                    </Text>
                  )}
                  {moveTargets.map((t) => (
                    <TouchableOpacity key={t.id} style={s.targetRow} onPress={() => applyMove(t)}>
                      <Text style={s.targetNo}>Meja {t.no}</Text>
                      <Text style={s.targetMeta}>
                        {STATUS_META[t.status].label} • {t.kapasitas} pax
                        {t.total ? ` • ${rp(t.total)}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setMoveMode(null)}>
                    <Text style={s.cancelTxt}>Kembali</Text>
                  </TouchableOpacity>
                </>
              ) : (
              <>
                <Text style={s.modalTitle}>Meja {selected.no}</Text>
                <Text style={s.modalHint}>
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
                  <Text style={s.primaryTxt}>
                    {selected.status === 'kosong' ? 'Buat Pesanan' : 'Buka Pesanan'}
                  </Text>
                </TouchableOpacity>
                <View style={s.actionRow}>
                  <TouchableOpacity
                    style={s.secondaryBtn}
                    onPress={() => setBookingVisible(true)}>
                    <Text style={s.secondaryTxt}>Booking Meja</Text>
                  </TouchableOpacity>
                  {selected.status !== 'kosong' && (
                    <TouchableOpacity
                      style={s.secondaryBtn}
                      onPress={toggleHold}>
                      <Text style={s.secondaryTxt}>{held[selected.id] ? 'Lanjut Order' : 'Hold Order'}</Text>
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
                      <Text style={s.secondaryTxt}>Pindah Meja</Text>
                    </TouchableOpacity>
                  )}
                  {selected.status === 'terisi' && (
                    <TouchableOpacity
                      style={s.secondaryBtn}
                      onPress={() => setMoveMode('gabung')}>
                      <Text style={s.secondaryTxt}>Gabungkan Meja</Text>
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
                      <Text style={s.secondaryTxt}>Pindah Item</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={confirmCancel ? s.dangerBtnSolid : s.dangerBtn}
                      onPress={cancelTable}>
                      <Text style={confirmCancel ? s.dangerSolidTxt : s.dangerTxt}>
                        {confirmCancel ? 'Yakin? Ketuk lagi' : 'Batalkan Meja'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={closeModal}>
                  <Text style={s.cancelTxt}>Tutup</Text>
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
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              Booking Meja{selected ? ` ${selected.no}` : ''}
            </Text>
            <Text style={s.modalHint}>Sudah memesan meja? Catat reservasi</Text>
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
            <TouchableOpacity style={s.primaryBtn} onPress={saveBooking}>
              <Text style={s.primaryTxt}>Simpan Booking</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => setBookingVisible(false)}>
              <Text style={s.cancelTxt}>Batal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  backBtn: { width: 32, alignItems: 'center' },
  backTxt: { color: colors.white, fontSize: 28, fontFamily: fonts.medium },
  headerTitle: { color: colors.white, fontSize: 17, fontFamily: fonts.bold },
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
  qsNote: { fontSize: 12, fontFamily: fonts.semibold, color: colors.orangeDark, marginLeft: 'auto' },
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
});
