import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors, fonts, rp, rpNum, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

/** Akun (CoA) kas kecil ala APK — di app nyata dari pull expense-chart-of-accounts. */
const COA = ['Operasional', 'Bahan Baku', 'Gaji', 'Utilitas', 'Kas Kecil', 'Lainnya'];

export default function PettyCashFormScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [arus, setArus] = useState<'Keluar' | 'Masuk'>('Keluar');
  const [coa, setCoa] = useState(COA[0]);
  const [keterangan, setKeterangan] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const jumlahNum = Number(jumlah.replace(/\D/g, '')) || 0;
  const ready = keterangan.trim().length >= 3 && jumlahNum > 0;

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
    });
    if (!res.canceled && res.assets?.[0]?.uri) setPhoto(res.assets[0].uri);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!res.canceled && res.assets?.[0]?.uri) setPhoto(res.assets[0].uri);
  };

  if (done) {
    return (
      <View style={s.root}>
        <View style={[s.body, isTablet && wideCenter]}>
          <View style={s.checkCircle}><Text style={s.checkMark}>✓</Text></View>
          <Text style={s.title}>Kas Kecil Tercatat</Text>
          <Text style={s.sub}>{arus} • {coa} • {rp(jumlahNum)}</Text>
          {photo ? <Image source={{ uri: photo }} style={s.donePhoto} /> : null}
          <TouchableOpacity style={s.primary} onPress={() => navigation?.navigate('PettyCash')}>
            <Text style={s.primaryT}>Lihat Daftar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.ghost}
            onPress={() => { setDone(false); setKeterangan(''); setJumlah(''); setCatatan(''); setPhoto(null); }}>
            <Text style={s.ghostT}>Catat Lagi</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Form Kas Kecil</Text>
        <View style={s.backBtn} />
      </View>
      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.card}>
          <Text style={s.cardTitle}>Arus Kas</Text>
          <View style={s.arusRow}>
            {(['Keluar', 'Masuk'] as const).map((a) => (
              <TouchableOpacity
                key={a}
                style={[s.arusBtn, arus === a && (a === 'Keluar' ? s.arusOut : s.arusIn)]}
                onPress={() => setArus(a)}>
                <Text style={[s.arusTxt, arus === a && s.arusTxtOn]}>
                  {a === 'Keluar' ? '− Keluar' : '+ Masuk'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Akun (CoA)</Text>
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
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Nominal & Keterangan</Text>
          <Text style={s.label}>Jumlah *</Text>
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
          <Text style={s.label}>Keterangan *</Text>
          <TextInput
            style={s.input}
            placeholder="Contoh: Belanja plastik & tissue"
            placeholderTextColor={colors.faint}
            value={keterangan}
            onChangeText={setKeterangan}
          />
          <Text style={s.label}>Catatan (opsional)</Text>
          <TextInput
            style={s.noteInput}
            placeholder="Catatan tambahan"
            placeholderTextColor={colors.faint}
            multiline
            value={catatan}
            onChangeText={setCatatan}
          />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Foto Bukti (opsional)</Text>
          {photo ? (
            <Image source={{ uri: photo }} style={s.preview} />
          ) : (
            <Text style={s.hint}>Lampirkan foto struk/nota sebagai bukti kas.</Text>
          )}
          <View style={s.photoRow}>
            <TouchableOpacity style={s.photoBtn} onPress={takePhoto}>
              <Text style={s.photoBtnT}>📷 Kamera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.photoBtn} onPress={pickPhoto}>
              <Text style={s.photoBtnT}>🖼 Galeri</Text>
            </TouchableOpacity>
            {photo ? (
              <TouchableOpacity onPress={() => setPhoto(null)} hitSlop={10}>
                <Text style={s.del}>Hapus</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <TouchableOpacity
          style={[s.primary, !ready && s.disabled]}
          disabled={!ready}
          onPress={() => setDone(true)}>
          <Text style={s.primaryT}>Simpan • {rp(jumlahNum)}</Text>
        </TouchableOpacity>
        {!ready && (
          <Text style={s.hint}>Isi keterangan (min. 3 huruf) dan jumlah untuk menyimpan.</Text>
        )}
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
  body: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  label: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted, marginTop: 12, marginBottom: 6 },
  arusRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  arusBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.card },
  arusOut: { backgroundColor: colors.red, borderColor: colors.red },
  arusIn: { backgroundColor: colors.green, borderColor: colors.green },
  arusTxt: { fontSize: 14, fontFamily: fonts.bold, color: colors.muted },
  arusTxtOn: { color: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  chip: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 20,
    paddingVertical: 7, paddingHorizontal: 12, marginRight: 8, marginBottom: 8, backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  chipTxtOn: { color: colors.orangeDark },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.orange,
    borderRadius: 10, paddingHorizontal: 14, backgroundColor: colors.paleOrange,
  },
  rpPrefix: { fontSize: 18, fontFamily: fonts.bold, color: colors.orange },
  amountInput: { flex: 1, fontSize: 24, fontFamily: fonts.bold, color: colors.text, paddingVertical: 12, marginLeft: 8, textAlign: 'right' },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12,
    fontSize: 14, fontFamily: fonts.regular, color: colors.text,
  },
  noteInput: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12,
    fontSize: 14, fontFamily: fonts.regular, color: colors.text, minHeight: 70, textAlignVertical: 'top',
  },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 8, textAlign: 'center' },
  preview: { width: '100%', height: 200, borderRadius: 10, backgroundColor: colors.line, marginTop: 10 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  photoBtn: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  photoBtnT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  del: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  primary: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  disabled: { opacity: 0.5 },
  primaryT: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  ghost: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  ghostT: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  checkCircle: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', marginTop: 32, alignSelf: 'center',
  },
  checkMark: { color: colors.white, fontSize: 44, fontFamily: fonts.bold },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.text, marginTop: 14, textAlign: 'center' },
  sub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
  donePhoto: { width: '100%', height: 200, borderRadius: 10, backgroundColor: colors.line, marginTop: 14 },
});
