import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type Arus = 'Masuk' | 'Keluar';
type Txn = {
  id: string;
  tanggal: string;
  keterangan: string;
  coa: string;
  arus: Arus;
  jumlah: number;
  kasir: string;
  disetujui: boolean;
};

const DUMMY: Txn[] = [
  { id: 'PC-001', tanggal: '16 Okt 2026 · 08:10', keterangan: 'Modal awal petty cash', coa: 'Kas Kecil', arus: 'Masuk', jumlah: 500000, kasir: 'Gista', disetujui: true },
  { id: 'PC-002', tanggal: '16 Okt 2026 · 10:20', keterangan: 'Belanja plastik & tissue', coa: 'Operasional', arus: 'Keluar', jumlah: 45000, kasir: 'Gista', disetujui: true },
  { id: 'PC-003', tanggal: '16 Okt 2026 · 12:05', keterangan: 'Bensin antar online', coa: 'Operasional', arus: 'Keluar', jumlah: 20000, kasir: 'Bimo', disetujui: false },
];

export default function PettyCashScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [filter, setFilter] = useState<'Semua' | Arus>('Semua');

  const list = useMemo(
    () => DUMMY.filter((t) => filter === 'Semua' || t.arus === filter),
    [filter],
  );
  const saldo = useMemo(
    () => DUMMY.reduce((s, t) => s + (t.arus === 'Masuk' ? t.jumlah : -t.jumlah), 0),
    [],
  );

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Petty Cash</Text>
        <TouchableOpacity onPress={() => navigation?.navigate('PettyCashForm')}>
          <Text style={s.headerAction}>+ Tambah</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.hero}>
          <Text style={s.heroLabel}>Saldo Kas Kecil</Text>
          <Text style={s.heroValue}>{rp(saldo)}</Text>
          <Text style={s.heroSub}>{DUMMY.length} transaksi tercatat</Text>
        </View>

        <View style={s.filters}>
          {(['Semua', 'Masuk', 'Keluar'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[s.filterChip, filter === f && s.filterActive]}
              onPress={() => setFilter(f)}>
              <Text style={[s.filterTxt, filter === f && s.filterTxtActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {list.length === 0 ? (
          <View style={s.empty}>
            <Image source={require('../../../assets/images/no_trx_petty_cash.webp')} style={s.emptyImg} resizeMode="contain" />
            <Text style={s.emptyTitle}>Belum Ada Transaksi</Text>
            <Text style={s.emptySub}>Kas kecil yang dicatat akan muncul di sini</Text>
          </View>
        ) : (
          list.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={s.card}
              onPress={() => navigation?.navigate('PettyCashDetail', {
                id: t.id, tanggal: t.tanggal, keterangan: t.keterangan,
                coa: t.coa, arus: t.arus, jumlah: t.jumlah,
                kasir: t.kasir, disetujui: t.disetujui,
              })}>
              <View style={[s.badge, t.arus === 'Masuk' ? s.badgeIn : s.badgeOut]}>
                <Text style={[s.badgeTxt, t.arus === 'Masuk' ? s.badgeInTxt : s.badgeOutTxt]}>
                  {t.arus}
                </Text>
              </View>
              <Text style={s.cardTitle}>{t.keterangan}</Text>
              <Text style={s.cardMeta}>{t.id} • {t.tanggal} • {t.coa}</Text>
              <View style={s.cardBottom}>
                <Text style={[s.jumlah, t.arus === 'Masuk' ? s.jumlahIn : s.jumlahOut]}>
                  {t.arus === 'Masuk' ? '+' : '−'}{rp(t.jumlah)}
                </Text>
                <Text style={t.disetujui ? s.okTxt : s.waitTxt}>
                  {t.disetujui ? '✓ Disetujui' : 'Menunggu persetujuan'}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity style={s.primary} onPress={() => navigation?.navigate('PettyCashForm')}>
          <Text style={s.primaryT}>+ Catat Kas Kecil</Text>
        </TouchableOpacity>
      </View>
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
  body: { padding: 16, paddingBottom: 110 },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.navyTint },
  heroValue: { fontFamily: fonts.bold, fontSize: 28, color: colors.white, marginTop: 6 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  filters: { flexDirection: 'row', marginTop: 14, marginBottom: 4 },
  filterChip: {
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    borderRadius: 20, paddingVertical: 7, paddingHorizontal: 16, marginRight: 8,
  },
  filterActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  filterTxtActive: { color: colors.white },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  badgeIn: { backgroundColor: colors.paleGreen },
  badgeOut: { backgroundColor: colors.paleRed },
  badgeTxt: { fontSize: 11, fontFamily: fonts.bold },
  badgeInTxt: { color: colors.greenDark },
  badgeOutTxt: { color: colors.red },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, marginTop: 8 },
  cardMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.faint, marginTop: 2 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  jumlah: { fontSize: 15, fontFamily: fonts.bold },
  jumlahIn: { color: colors.greenDark },
  jumlahOut: { color: colors.red },
  okTxt: { fontSize: 12, fontFamily: fonts.semibold, color: colors.greenDark },
  waitTxt: { fontSize: 12, fontFamily: fonts.semibold, color: colors.amberDark },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyImg: { width: 180, height: 120, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  emptySub: { fontSize: 13, fontFamily: fonts.regular, color: colors.faint, marginTop: 6 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line, padding: 16 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  primaryT: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
});
