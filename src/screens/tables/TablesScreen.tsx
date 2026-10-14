import React, { useState } from 'react';
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
  kapasitas: number;
  status: TableStatus;
  total?: number;
  namaTamu?: string;
};

const TABLES: Table[] = [
  { id: '1', no: 'A1', kapasitas: 2, status: 'kosong' },
  { id: '2', no: 'A2', kapasitas: 2, status: 'terisi', total: 185000, namaTamu: 'Budi' },
  { id: '3', no: 'A3', kapasitas: 4, status: 'kosong' },
  { id: '4', no: 'A4', kapasitas: 4, status: 'dipesan', namaTamu: 'Sinta · 19:00' },
  { id: '5', no: 'B1', kapasitas: 4, status: 'terisi', total: 96000, namaTamu: 'Andi' },
  { id: '6', no: 'B2', kapasitas: 6, status: 'gabung', namaTamu: 'B2+B3 · 12 tamu' },
  { id: '7', no: 'B3', kapasitas: 6, status: 'gabung', namaTamu: 'B2+B3 · 12 tamu' },
  { id: '8', no: 'C1', kapasitas: 2, status: 'kosong' },
  { id: '9', no: 'C2', kapasitas: 8, status: 'dipesan', namaTamu: 'Rapat · 20:00' },
];

const STATUS_META: Record<TableStatus, { label: string; bg: string; fg: string }> = {
  kosong: { label: 'Tersedia', bg: colors.paleGreen, fg: colors.green },
  terisi: { label: 'Terisi', bg: colors.paleRed, fg: colors.red },
  dipesan: { label: 'Dipesan', bg: colors.paleOrange, fg: colors.orange },
  gabung: { label: 'Gabung', bg: colors.paleBlue, fg: colors.navy },
};

export default function TablesScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [tables, setTables] = useState<Table[]>(TABLES);
  const [filter, setFilter] = useState<'semua' | TableStatus>('semua');
  const [selected, setSelected] = useState<Table | null>(null);
  const [moveMode, setMoveMode] = useState<'pindah' | 'gabung' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [bookingVisible, setBookingVisible] = useState(false);
  const [namaBooking, setNamaBooking] = useState('');
  const [jamBooking, setJamBooking] = useState('');
  const [pax, setPax] = useState('');

  const shown = tables.filter((t) => filter === 'semua' || t.status === filter);

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
    setTables((list) =>
      list.map((t) => {
        if (moveMode === 'pindah') {
          if (t.id === target.id)
            return { ...t, status: 'terisi' as TableStatus, namaTamu: selected.namaTamu, total: selected.total };
          if (t.id === selected.id)
            return { ...t, status: 'kosong' as TableStatus, namaTamu: undefined, total: undefined };
          return t;
        }
        // gabung
        if (t.id === target.id)
          return {
            ...t,
            status: 'gabung' as TableStatus,
            total: (t.total ?? 0) + (selected.total ?? 0),
            namaTamu: `${t.no}+${selected.no}${t.namaTamu ? ` · ${t.namaTamu}` : ''}`,
          };
        if (t.id === selected.id)
          return { ...t, status: 'gabung' as TableStatus, namaTamu: `${selected.no}+${target.no}`, total: undefined };
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
        t.id === id ? { ...t, status: 'kosong' as TableStatus, namaTamu: undefined, total: undefined } : t,
      ),
    );
    closeModal();
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
        <View style={s.backBtn} />
      </View>

      <View style={s.legend}>
        {(Object.keys(STATUS_META) as TableStatus[]).map((k) => (
          <View key={k} style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: STATUS_META[k].fg }]} />
            <Text style={s.legendTxt}>{STATUS_META[k].label}</Text>
          </View>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filters}
        style={s.filtersScroll}>
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
          return (
            <TouchableOpacity
              key={t.id}
              style={[s.tableCard, { backgroundColor: meta.bg }]}
              onPress={() => openDetail(t)}>
              <Text style={s.tableNo}>{t.no}</Text>
              <Text style={[s.tableStatus, { color: meta.fg }]}>{meta.label}</Text>
              <Text style={s.tableCap}>{t.kapasitas} tamu</Text>
              {t.total ? (
                <Text style={s.tableTotal}>{rp(t.total)}</Text>
              ) : null}
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
                  {STATUS_META[selected.status].label} • {selected.kapasitas} pax
                  {selected.namaTamu ? ` • ${selected.namaTamu}` : ''}
                  {selected.total ? ` • ${rp(selected.total)}` : ''}
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
                      onPress={() => setMoveMode('pindah')}>
                      <Text style={s.secondaryTxt}>Pindah Meja</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={s.actionRow}>
                  {selected.status === 'terisi' && (
                    <TouchableOpacity
                      style={s.secondaryBtn}
                      onPress={() => setMoveMode('gabung')}>
                      <Text style={s.secondaryTxt}>Gabungkan Meja</Text>
                    </TouchableOpacity>
                  )}
                  {selected.status !== 'kosong' && (
                    <TouchableOpacity
                      style={confirmCancel ? s.dangerBtnSolid : s.dangerBtn}
                      onPress={cancelTable}>
                      <Text style={confirmCancel ? s.dangerSolidTxt : s.dangerTxt}>
                        {confirmCancel ? 'Yakin? Ketuk lagi' : 'Batalkan Meja'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
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
  legend: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  legendTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  filtersScroll: { flexGrow: 0 },
  filters: { flexDirection: 'row', padding: 12, paddingRight: 20 },
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
  tableNo: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },
  tableStatus: { fontSize: 12, fontFamily: fonts.bold, marginTop: 2 },
  tableCap: { fontSize: 11, fontFamily: fonts.regular, color: colors.muted },
  tableTotal: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.navy,
    marginTop: 4,
  },
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
