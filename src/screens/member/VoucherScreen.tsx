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
import { colors, fonts, rp, wideCenter } from '../../theme';

type Props = { navigation?: any };

type Voucher = {
  id: string;
  kode: string;
  nama: string;
  jenis: string;
  nilai: number;
  minBelanja: number;
  berlakuHingga: string;
  status: 'tersedia' | 'terpakai' | 'kadaluwarsa';
};

const DUMMY: Voucher[] = [
  { id: '1', kode: 'HEMAT20', nama: 'Diskon 20rb', jenis: 'Diskon (Rp)', nilai: 20000, minBelanja: 100000, berlakuHingga: '31 Des 2026', status: 'tersedia' },
  { id: '2', kode: 'GIFT50', nama: 'Gift Voucher 50rb', jenis: 'Gift Voucher', nilai: 50000, minBelanja: 0, berlakuHingga: '31 Jan 2027', status: 'tersedia' },
  { id: '3', kode: 'ULTRA10', nama: 'Ultra Voucher 10%', jenis: 'Diskon (%)', nilai: 10, minBelanja: 50000, berlakuHingga: '15 Nov 2026', status: 'terpakai' },
  { id: '4', kode: 'LAMA5', nama: 'Voucher Lama', jenis: 'Diskon (Rp)', nilai: 5000, minBelanja: 0, berlakuHingga: '1 Jan 2026', status: 'kadaluwarsa' },
];

export default function VoucherScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'semua' | Voucher['status']>('semua');
  const [kodeManual, setKodeManual] = useState('');
  const [applied, setApplied] = useState<Voucher | null>(null);
  const [cancelVisible, setCancelVisible] = useState(false);

  const hasil = DUMMY.filter(
    (v) =>
      (filter === 'semua' || v.status === filter) &&
      (q.trim() === '' ||
        v.kode.toLowerCase().includes(q.toLowerCase()) ||
        v.nama.toLowerCase().includes(q.toLowerCase())),
  );

  const apply = (v: Voucher) => {
    if (v.status !== 'tersedia') return;
    setApplied(v);
    navigation?.goBack?.();
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Voucher / Promo</Text>
        <View style={s.backBtn} />
      </View>

      <View style={s.searchWrap}>
        <View style={s.manualRow}>
          <TextInput
            style={[s.search, s.manualInput]}
            placeholder="Isi Kode Voucher / Cari promo"
            placeholderTextColor={colors.faint}
            autoCapitalize="characters"
            value={kodeManual}
            onChangeText={(t) => {
              setKodeManual(t);
              setQ(t);
            }}
          />
          <TouchableOpacity
            style={s.checkBtn}
            onPress={() => {
              setQ(kodeManual);
            }}>
            <Text style={s.checkTxt}>Cek</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.filters}>
        {(['semua', 'tersedia', 'terpakai', 'kadaluwarsa'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[s.filterChip, filter === f && s.filterActive]}
            onPress={() => setFilter(f)}>
            <Text style={[s.filterTxt, filter === f && s.filterTxtActive]}>
              {f === 'semua'
                ? 'Semua Voucher'
                : f === 'tersedia'
                  ? 'Tersedia'
                  : f === 'terpakai'
                    ? 'Terpakai'
                    : 'Kadaluwarsa'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.sectionTitle}>Promo Tersedia</Text>

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        {hasil.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Voucher yang Anda cari tidak ditemukan</Text>
            <Text style={s.emptySub}>Periksa kode voucher atau coba kata kunci lain</Text>
          </View>
        ) : (
          hasil.map((v) => {
            const usable = v.status === 'tersedia';
            return (
              <View key={v.id} style={[s.card, !usable && s.cardDim]}>
                <View style={s.cardTop}>
                  <View style={s.voucherBadge}>
                    <Text style={s.voucherKode}>{v.kode}</Text>
                  </View>
                  <Text
                    style={[
                      s.statusTxt,
                      v.status === 'tersedia'
                        ? s.statusOk
                        : v.status === 'terpakai'
                          ? s.statusUsed
                          : s.statusExp,
                    ]}>
                    {v.status === 'tersedia'
                      ? 'Voucher dapat dipakai'
                      : v.status === 'terpakai'
                        ? 'Voucher sudah terpakai'
                        : 'Voucher telah kadaluarsa'}
                  </Text>
                </View>
                <Text style={s.voucherName}>{v.nama}</Text>
                <Text style={s.voucherJenis}>{v.jenis}</Text>
                <Text style={s.voucherNilai}>
                  Nilai Voucher (Rp):{' '}
                  {v.jenis.includes('%') ? `${v.nilai}%` : rp(v.nilai)}
                </Text>
                {v.minBelanja > 0 ? (
                  <Text style={s.voucherMeta}>
                    Min. belanja {rp(v.minBelanja)}
                  </Text>
                ) : null}
                <Text style={s.voucherMeta}>Berlaku hingga {v.berlakuHingga}</Text>
                <TouchableOpacity
                  style={[s.applyBtn, !usable && s.applyDisabled]}
                  disabled={!usable}
                  onPress={() => apply(v)}>
                  <Text style={s.applyTxt}>
                    {usable ? 'Terapkan' : v.status === 'terpakai' ? 'Terpakai' : 'Kadaluwarsa'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}

        {applied ? (
          <TouchableOpacity
            style={s.appliedBox}
            onPress={() => setCancelVisible(true)}>
            <Text style={s.appliedTxt}>
              Voucher {applied.kode} diterapkan — ketuk untuk batalkan
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <Modal visible={cancelVisible} transparent animationType="fade">
        <View style={s.modalBg}>
          <View style={s.dialog}>
            <Text style={s.modalTitle}>Batalkan promo pada transaksi?</Text>
            <Text style={s.modalHint}>
              Jika dibatalkan, Voucher yang sudah Anda terapkan akan hangus.
            </Text>
            <View style={s.dialogRow}>
              <TouchableOpacity
                style={s.dialogGhost}
                onPress={() => setCancelVisible(false)}>
                <Text style={s.dialogGhostTxt}>Tetap Pakai Voucher</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.dialogDanger}
                onPress={() => {
                  setApplied(null);
                  setCancelVisible(false);
                }}>
                <Text style={s.dialogDangerTxt}>Batalkan</Text>
              </TouchableOpacity>
            </View>
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
  searchWrap: {
    backgroundColor: colors.white,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  search: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  manualRow: { flexDirection: 'row', marginTop: 8 },
  manualInput: { flex: 1, marginRight: 8 },
  checkBtn: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  checkTxt: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  filters: { flexDirection: 'row', flexWrap: 'wrap', padding: 12 },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  filterActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  filterTxtActive: { color: colors.white },
  sectionTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  body: { padding: 16, paddingTop: 8, paddingBottom: 24 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.orange,
  },
  cardDim: { opacity: 0.6, borderLeftColor: colors.faint },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  voucherBadge: {
    backgroundColor: colors.navy,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  voucherKode: { color: colors.white, fontSize: 13, fontFamily: fonts.bold },
  statusTxt: { fontSize: 11, fontFamily: fonts.medium },
  statusOk: { color: colors.green },
  statusUsed: { color: colors.orange },
  statusExp: { color: colors.red },
  voucherName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 8,
  },
  voucherJenis: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  voucherNilai: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.navy,
    marginTop: 4,
  },
  voucherMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.faint },
  applyBtn: {
    backgroundColor: colors.orange,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  applyDisabled: { backgroundColor: colors.faint },
  applyTxt: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  emptySub: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.faint,
    marginTop: 6,
  },
  appliedBox: {
    backgroundColor: colors.paleGreen,
    borderRadius: 10,
    padding: 14,
    marginTop: 4,
  },
  appliedTxt: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.green,
    textAlign: 'center',
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 24 },
  modalTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
  },
  modalHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  dialogRow: { flexDirection: 'row', marginTop: 18 },
  dialogGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginRight: 8,
  },
  dialogGhostTxt: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  dialogDanger: {
    flex: 1,
    backgroundColor: colors.red,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginLeft: 8,
  },
  dialogDangerTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.white },
});
