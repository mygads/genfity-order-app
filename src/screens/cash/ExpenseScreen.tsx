import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors, fonts, rp, rpNum, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type Expense = {
  id: string;
  nama: string;
  tanggal: string;
  coa: string;
  jumlah: number;
  disetujui: boolean;
  photo?: string;
};

/** Mirror alur expense dossier: push branch-expenses + dokumen, CoA dari chart-of-accounts. */
const COA = ['Operasional', 'Bahan Baku', 'Gaji', 'Utilitas', 'Sewa', 'Lainnya'];

export default function ExpenseScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [items, setItems] = useState<Expense[]>([
    { id: 'EX-101', nama: 'Belanja plastik & tissue', tanggal: '16 Okt 2026', coa: 'Operasional', jumlah: 45000, disetujui: true },
    { id: 'EX-102', nama: 'Bensin antar online', tanggal: '16 Okt 2026', coa: 'Operasional', jumlah: 20000, disetujui: true },
    { id: 'EX-103', nama: 'Servis kompor dapur', tanggal: '15 Okt 2026', coa: 'Utilitas', jumlah: 150000, disetujui: false },
  ]);
  const [formOpen, setFormOpen] = useState(false);
  const [nama, setNama] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [coa, setCoa] = useState(COA[0]);
  const [photo, setPhoto] = useState<string | null>(null);

  const totalBulan = useMemo(() => items.reduce((s, e) => s + e.jumlah, 0), [items]);
  const jumlahNum = Number(jumlah.replace(/\D/g, '')) || 0;
  const ready = nama.trim().length >= 3 && jumlahNum > 0;

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
    });
    if (!res.canceled && res.assets?.[0]?.uri) setPhoto(res.assets[0].uri);
  };

  const tambah = () => {
    if (!ready) return;
    setItems((l) => [
      ...l,
      {
        id: `EX-${103 + l.length}`,
        nama: nama.trim(),
        tanggal: '16 Okt 2026',
        coa,
        jumlah: jumlahNum,
        disetujui: false,
        photo: photo ?? undefined,
      },
    ]);
    setNama('');
    setJumlah('');
    setPhoto(null);
    setFormOpen(false);
  };

  const setujui = (id: string) =>
    setItems((l) => l.map((e) => (e.id === id ? { ...e, disetujui: true } : e)));

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Pengeluaran Cabang</Text>
        <TouchableOpacity onPress={() => setFormOpen((v) => !v)}>
          <Text style={s.headerAction}>+ Tambah</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.hero}>
          <Text style={s.heroLabel}>Total Pengeluaran Bulan Ini</Text>
          <Text style={s.heroValue}>{rp(totalBulan)}</Text>
          <Text style={s.heroSub}>{items.length} pengeluaran cabang tercatat</Text>
        </View>

        {formOpen && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Tambah Pengeluaran</Text>
            <Text style={s.label}>Nama pengeluaran *</Text>
            <TextInput
              style={s.input}
              placeholder="Contoh: Belanja gas LPG"
              placeholderTextColor={colors.faint}
              value={nama}
              onChangeText={setNama}
            />
            <Text style={s.label}>Nominal *</Text>
            <View style={s.amountBox}>
              <Text style={s.rpPrefix}>Rp</Text>
              <TextInput
                style={s.amountInput}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.faint}
                value={jumlahNum ? rpNum(jumlahNum) : ''}
                onChangeText={(t) => setJumlah(t.replace(/\D/g, '').slice(0, 12))}
              />
            </View>
            <Text style={s.label}>Akun (CoA)</Text>
            <View style={s.chips}>
              {COA.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.chip, coa === c && s.chipOn]}
                  onPress={() => setCoa(c)}>
                  <Text style={[s.chipTxt, coa === c && s.chipTxtOn]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.label}>Foto nota (opsional)</Text>
            <View style={s.photoRow}>
              {photo ? <Image source={{ uri: photo }} style={s.preview} /> : null}
              <TouchableOpacity style={s.photoBtn} onPress={pickPhoto}>
                <Text style={s.photoBtnT}>{photo ? 'Ganti Foto' : '📷 Ambil Foto'}</Text>
              </TouchableOpacity>
              {photo ? (
                <TouchableOpacity onPress={() => setPhoto(null)} hitSlop={10}>
                  <Text style={s.del}>Hapus</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity
              style={[s.primary, !ready && s.disabled]}
              disabled={!ready}
              onPress={tambah}>
              <Text style={s.primaryT}>Simpan Pengeluaran</Text>
            </TouchableOpacity>
          </View>
        )}

        {items.map((e) => (
          <View key={e.id} style={s.card}>
            <View style={s.row}>
              {e.photo ? <Image source={{ uri: e.photo }} style={s.thumb} /> : null}
              <View style={{ flex: 1 }}>
                <Text style={s.itemName}>{e.nama}</Text>
                <Text style={s.itemMeta}>
                  {e.id} • {e.tanggal} • {e.coa} •{' '}
                  {e.disetujui ? (
                    <Text style={s.okTxt}>✓ Disetujui</Text>
                  ) : (
                    <Text style={s.waitTxt}>Menunggu persetujuan</Text>
                  )}
                </Text>
              </View>
              <Text style={s.jumlah}>−{rp(e.jumlah)}</Text>
            </View>
            {!e.disetujui && (
              <TouchableOpacity style={s.approveBtn} onPress={() => setujui(e.id)}>
                <Text style={s.approveTxt}>Setujui</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
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
  body: { padding: 16, paddingBottom: 40 },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.navyTint },
  heroValue: { fontFamily: fonts.bold, fontSize: 28, color: colors.white, marginTop: 6 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  label: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted, marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12,
    fontSize: 14, fontFamily: fonts.regular, color: colors.text,
  },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.orange,
    borderRadius: 10, paddingHorizontal: 14, backgroundColor: colors.paleOrange,
  },
  rpPrefix: { fontSize: 18, fontFamily: fonts.bold, color: colors.orange },
  amountInput: { flex: 1, fontSize: 24, fontFamily: fonts.bold, color: colors.text, paddingVertical: 12, marginLeft: 8, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 20,
    paddingVertical: 7, paddingHorizontal: 12, marginRight: 8, marginBottom: 8, backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  chipTxtOn: { color: colors.orangeDark },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  preview: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.line },
  photoBtn: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  photoBtnT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  del: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  primary: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  disabled: { opacity: 0.5 },
  primaryT: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.line },
  itemName: { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
  itemMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.faint, marginTop: 2 },
  jumlah: { fontSize: 14, fontFamily: fonts.bold, color: colors.red },
  okTxt: { fontFamily: fonts.semibold, color: colors.greenDark },
  waitTxt: { fontFamily: fonts.semibold, color: colors.amberDark },
  approveBtn: { marginTop: 8, alignSelf: 'flex-end' },
  approveTxt: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark },
});
