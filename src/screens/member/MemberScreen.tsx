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
import { colors, fonts, rp, rpNum, wideCenterLg } from '../../theme';

type Props = { navigation?: any };

type Member = {
  id: string;
  nama: string;
  noHp: string;
  tipe: string;
  saldo: number;
  poin: number;
};

const DUMMY: Member[] = [
  { id: 'M001', nama: 'Budi Santoso', noHp: '081234567890', tipe: 'Regular', saldo: 150000, poin: 120 },
  { id: 'M002', nama: 'Sinta Dewi', noHp: '081987654321', tipe: 'Gold', saldo: 500000, poin: 450 },
  { id: 'M003', nama: 'Andi Pratama', noHp: '082112233445', tipe: 'Regular', saldo: 0, poin: 30 },
];

/** Samarkan nomor HP di daftar: 0812•••7890 (privasi kasir). */
function maskHp(hp: string): string {
  const d = hp.replace(/[^0-9]/g, '');
  if (d.length < 7) return hp;
  return `${d.slice(0, 4)}•••${d.slice(-4)}`;
}

export default function MemberScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Member | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [depositVisible, setDepositVisible] = useState(false);
  const [depositNominal, setDepositNominal] = useState('');

  // Form tambah member
  const [nama, setNama] = useState('');
  const [noHp, setNoHp] = useState('');
  const [tglLahir, setTglLahir] = useState('');

  const hasil =
    q.trim().length === 0
      ? DUMMY
      : DUMMY.filter(
          (m) =>
            m.nama.toLowerCase().includes(q.toLowerCase()) ||
            m.noHp.includes(q) ||
            m.id.toLowerCase().includes(q.toLowerCase()),
        );

  const saveMember = () => {
    setAddVisible(false);
    setNama('');
    setNoHp('');
    setTglLahir('');
  };

  const saveDeposit = () => {
    setDepositVisible(false);
    setDepositNominal('');
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Member</Text>
        <TouchableOpacity onPress={() => setAddVisible(true)}>
          <Text style={s.headerAction}>+ Baru</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <TextInput
          style={s.search}
          placeholder="Masukkan Member ID / Nama / No. HP"
          placeholderTextColor={colors.faint}
          value={q}
          onChangeText={setQ}
        />
        <View style={s.searchLinks}>
          <TouchableOpacity onPress={() => navigation?.navigate('QrScan')}>
            <Text style={s.searchLink}>Pindai QR ›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Voucher')}>
            <Text style={s.searchLink}>Voucher ›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenterLg]}>
        <Text style={s.count}>
          {hasil.length} member terdaftar{q.trim() ? ` · hasil “${q.trim()}”` : ''}
        </Text>
        {hasil.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Maaf, Member Tidak Terdeteksi</Text>
            <Text style={s.emptySub}>Coba kata kunci lain atau tambah member baru</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => setAddVisible(true)}>
              <Text style={s.primaryTxt}>Tambah Member Baru</Text>
            </TouchableOpacity>
          </View>
        ) : (
          hasil.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[s.card, selected?.id === m.id && s.cardActive]}
              onPress={() => setSelected(m)}>
              <View style={s.cardTop}>
                <View style={s.avatar}>
                  <Text style={s.avatarTxt}>{m.nama.charAt(0)}</Text>
                </View>
                <View style={s.cardInfo}>
                  <Text style={s.cardName}>{m.nama}</Text>
                  <Text style={s.cardMeta}>
                    {m.id} • {maskHp(m.noHp)}
                  </Text>
                  <Text style={[s.cardTipe, m.tipe === 'Gold' ? s.cardTipeGold : s.cardTipeReg]}>{m.tipe} Member{m.tipe === 'Gold' ? ' ★' : ''}</Text>
                </View>
              </View>
              <View style={s.cardBottom}>
                <Text style={s.saldoTxt}>Saldo {rp(m.saldo)}</Text>
                <Text style={s.poinTxt}>{m.poin} poin</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {selected ? (
        <View style={s.footer}>
          <TouchableOpacity
            style={s.ghostBtn}
            onPress={() => setDepositVisible(true)}>
            <Text style={s.ghostTxt}>Deposit / Top Up</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.applyBtn}
            onPress={() => navigation?.goBack?.()}>
            <Text style={s.applyTxt}>Terapkan Member</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Tambah member */}
      <Modal visible={addVisible} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Tambah Member Baru</Text>
            <TextInput
              style={s.input}
              placeholder="Nama Member*"
              placeholderTextColor={colors.faint}
              value={nama}
              onChangeText={setNama}
            />
            <TextInput
              style={s.input}
              placeholder="No. HP*"
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              value={noHp}
              onChangeText={setNoHp}
            />
            <TextInput
              style={s.input}
              placeholder="Tanggal lahir (DD-MM-YYYY)"
              placeholderTextColor={colors.faint}
              value={tglLahir}
              onChangeText={setTglLahir}
            />
            <TouchableOpacity style={s.primaryBtn} onPress={saveMember}>
              <Text style={s.primaryTxt}>Simpan Member</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => setAddVisible(false)}>
              <Text style={s.cancelTxt}>Batal Menambahkan Member</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Deposit */}
      <Modal visible={depositVisible} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Member Deposit</Text>
            {selected ? (
              <Text style={s.modalHint}>
                {selected.nama} • Saldo {rp(selected.saldo)}
              </Text>
            ) : null}
            <View style={s.amountBox}>
              <Text style={s.rpPrefix}>Rp</Text>
              <TextInput
                style={s.amountInput}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.faint}
                value={
                  depositNominal
                    ? rpNum(Number(depositNominal))
                    : ''
                }
                onChangeText={(t) => setDepositNominal(t.replace(/\D/g, ''))}
              />
            </View>
            <View style={s.chips}>
              {[50000, 100000, 200000, 500000].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={s.chip}
                  onPress={() =>
                    setDepositNominal(
                      String((Number(depositNominal) || 0) + n),
                    )
                  }>
                  <Text style={s.chipTxt}>+{rpNum(n)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.primaryBtn} onPress={saveDeposit}>
              <Text style={s.primaryTxt}>Lanjut Deposit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => setDepositVisible(false)}>
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
  headerAction: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  searchWrap: { backgroundColor: colors.white, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  searchLinks: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8 },
  searchLink: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  search: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  count: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginBottom: 4 },
  body: { padding: 16, paddingBottom: 110 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cardActive: { borderColor: colors.orange },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { color: colors.white, fontSize: 18, fontFamily: fonts.bold },
  cardInfo: { marginLeft: 12, flex: 1 },
  cardName: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  cardMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  cardTipe: { fontSize: 12, fontFamily: fonts.medium },
  cardTipeReg: { color: colors.muted },
  cardTipeGold: { color: colors.orangeDark, fontFamily: fonts.bold },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  saldoTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.navy },
  poinTxt: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  emptySub: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.faint,
    marginTop: 6,
  },
  primaryBtn: {
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryTxt: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: 'row',
    padding: 16,
  },
  ghostBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginRight: 8,
  },
  ghostTxt: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  applyBtn: {
    flex: 1,
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginLeft: 8,
  },
  applyTxt: { fontSize: 14, fontFamily: fonts.bold, color: colors.white },
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
  },
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
  cancelBtn: { marginTop: 10, padding: 10, alignItems: 'center' },
  cancelTxt: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.orange,
    borderRadius: 10,
    paddingHorizontal: 14,
    marginTop: 14,
    backgroundColor: colors.paleOrange,
  },
  rpPrefix: { fontSize: 18, fontFamily: fonts.bold, color: colors.orange },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontFamily: fonts.bold,
    color: colors.text,
    paddingVertical: 12,
    marginLeft: 8,
    textAlign: 'right',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  chipTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
});
