import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { returnTo?: string } } };

type Promo = {
  code: string;
  name: string;
  desc: string;
  amount: number;
  minBelanja: number;
  sampai: string;
  tag: string;
};

const PROMOS: Promo[] = [
  { code: 'QOQI10', name: 'Diskon Member 10%', desc: 'Member GOLD, maks. Rp 25rb', amount: 10000, minBelanja: 50000, sampai: '31 Okt 2026', tag: 'Member' },
  { code: 'HEMAT5K', name: 'Potongan Rp 5rb', desc: 'Semua metode bayar', amount: 5000, minBelanja: 30000, sampai: '31 Des 2026', tag: 'Voucher' },
  { code: 'HEMAT15K', name: 'Potongan Rp 15rb', desc: 'Min. belanja Rp 150rb, Dine In', amount: 15000, minBelanja: 150000, sampai: '30 Nov 2026', tag: 'Voucher' },
  { code: 'KOPIHEMAT', name: 'Kopi Hemat 20%', desc: 'Kategori Minuman, maks. Rp 10rb', amount: 8000, minBelanja: 25000, sampai: '15 Nov 2026', tag: 'Kategori' },
  { code: 'GRATISONGKIR', name: 'Gratis Ongkir', desc: 'Take Away & delivery, maks. Rp 12rb', amount: 12000, minBelanja: 40000, sampai: '31 Des 2026', tag: 'Ongkir' },
];

/**
 * Daftar Promo (select_promotion) — daftar promo/voucher + tombol Pakai
 * yang kembali ke layar pemanggil dengan params voucher.
 * Daftarkan route: PromotionList.
 */
export default function PromotionListScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Semua');
  const returnTo = route?.params?.returnTo ?? 'CartDetail';

  const tags = useMemo(() => ['Semua', ...Array.from(new Set(PROMOS.map((p) => p.tag)))], []);
  const shown = PROMOS.filter((p) => {
    const q = query.trim().toLowerCase();
    const matchQ = q.length === 0 || (p.code + p.name + p.desc).toLowerCase().includes(q);
    const matchTag = filter === 'Semua' || p.tag === filter;
    return matchQ && matchTag;
  });

  const pakai = (p: Promo) =>
    navigation?.navigate(returnTo, { voucher: { code: p.code, amount: p.amount } });

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Promo & Voucher</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Cari kode / nama promo…"
            placeholderTextColor={colors.faint}
          />
        </View>
        <View style={styles.chips}>
          {tags.map((t) => (
            <TouchableOpacity key={t} style={[styles.chip, filter === t && styles.chipOn]} onPress={() => setFilter(t)}>
              <Text style={[styles.chipT, filter === t && styles.chipTOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {shown.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Image
              source={require('../../../assets/images/empty_promo.webp')}
              style={styles.emptyImg}
              resizeMode="contain"
            />
            <Text style={styles.emptyT}>Promo tidak ditemukan — coba kata kunci lain.</Text>
          </View>
        ) : (
          shown.map((p) => (
            <View key={p.code} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.badge}>
                  <Text style={styles.badgeT}>{p.tag}</Text>
                </View>
                <Text style={styles.sampai}>s/d {p.sampai}</Text>
              </View>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.code}>{p.code} · potongan {rp(p.amount)}</Text>
              <Text style={styles.desc}>{p.desc}</Text>
              <Text style={styles.min}>Min. belanja {rp(p.minBelanja)}</Text>
              <TouchableOpacity style={styles.pakai} onPress={() => pakai(p)}>
                <Text style={styles.pakaiT}>Pakai ›</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.navy, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  back: { color: colors.white, fontSize: 26, fontFamily: fonts.bold },
  headerTitle: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 16, textAlign: 'center' },
  body: { padding: 16, paddingBottom: 40 },
  searchWrap: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12 },
  search: { paddingVertical: 11, fontFamily: fonts.regular, fontSize: 14, color: colors.text, outlineStyle: 'none' as never },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  emptyWrap: { alignItems: 'center', paddingVertical: 36 },
  emptyImg: { width: 130, height: 130 },
  emptyT: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 10, textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { backgroundColor: colors.paleBlue, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeT: { fontFamily: fonts.bold, fontSize: 11, color: colors.navy },
  sampai: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginTop: 8 },
  code: { fontFamily: fonts.semibold, fontSize: 13, color: colors.greenDark, marginTop: 2 },
  desc: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  min: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  pakai: { backgroundColor: colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  pakaiT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
});
