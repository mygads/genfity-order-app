import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      id?: string; tanggal?: string; keterangan?: string; coa?: string;
      arus?: string; jumlah?: number; kasir?: string; disetujui?: boolean; photo?: string;
    };
  };
};

export default function PettyCashDetailScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const p = route?.params ?? {};
  const id = p.id ?? 'PC-002';
  const tanggal = p.tanggal ?? '16 Okt 2026 · 10:20';
  const keterangan = p.keterangan ?? 'Belanja plastik & tissue';
  const coa = p.coa ?? 'Operasional';
  const arus = p.arus ?? 'Keluar';
  const jumlah = p.jumlah ?? 45000;
  const kasir = p.kasir ?? 'Gista';
  const photo = p.photo ?? null;
  const [disetujui, setDisetujui] = useState(p.disetujui ?? true);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Detail Kas Kecil</Text>
        <View style={s.backBtn} />
      </View>
      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.hero}>
          <View style={[s.badge, arus === 'Masuk' ? s.badgeIn : s.badgeOut]}>
            <Text style={[s.badgeTxt, arus === 'Masuk' ? s.badgeInTxt : s.badgeOutTxt]}>{arus}</Text>
          </View>
          <Text style={s.heroValue}>{arus === 'Masuk' ? '+' : '−'}{rp(jumlah)}</Text>
          <Text style={s.heroSub}>{id} • {tanggal}</Text>
        </View>

        <View style={s.card}>
          <Row label="Keterangan" value={keterangan} />
          <Row label="Akun (CoA)" value={coa} />
          <Row label="Kasir" value={kasir} />
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.rowLabel}>Status</Text>
            <Text style={disetujui ? s.okTxt : s.waitTxt}>
              {disetujui ? '✓ Disetujui' : 'Menunggu persetujuan'}
            </Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Bukti Foto</Text>
          {photo ? (
            <Image source={{ uri: photo }} style={s.photo} />
          ) : (
            <View style={s.noPhoto}>
              <Text style={s.noPhotoTxt}>Belum ada foto bukti untuk transaksi ini.</Text>
            </View>
          )}
        </View>

        {!disetujui && (
          <TouchableOpacity style={s.primary} onPress={() => setDisetujui(true)}>
            <Text style={s.primaryT}>Setujui Transaksi</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.ghost} onPress={() => navigation?.navigate('PettyCash')}>
          <Text style={s.ghostT}>Kembali ke Daftar</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
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
  body: { padding: 16, paddingBottom: 40 },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18, alignItems: 'center' },
  badge: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 4 },
  badgeIn: { backgroundColor: colors.paleGreen },
  badgeOut: { backgroundColor: colors.paleRed },
  badgeTxt: { fontSize: 12, fontFamily: fonts.bold },
  badgeInTxt: { color: colors.greenDark },
  badgeOutTxt: { color: colors.red },
  heroValue: { fontFamily: fonts.bold, fontSize: 30, color: colors.white, marginTop: 8 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginTop: 12 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rowLabel: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, flex: 1 },
  rowValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, textAlign: 'right', flex: 1.4 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  okTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.greenDark },
  waitTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.amberDark },
  photo: { width: '100%', height: 240, borderRadius: 10, backgroundColor: colors.line, marginTop: 8 },
  noPhoto: { backgroundColor: colors.bg, borderRadius: 10, padding: 20, marginTop: 8, alignItems: 'center' },
  noPhotoTxt: { fontSize: 13, fontFamily: fonts.regular, color: colors.faint },
  primary: { backgroundColor: colors.green, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  primaryT: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  ghost: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  ghostT: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
});
