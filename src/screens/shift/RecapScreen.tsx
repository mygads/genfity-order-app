import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type Range = 'Hari Ini' | 'Kemarin' | '7 Hari';

const RANGES: Range[] = ['Hari Ini', 'Kemarin', '7 Hari'];

/** Rekap mock — di app nyata dari sales_recap_* (menu, kategori, payment, mode). */
const BY_MENU = [
  { nama: 'Es Teh Manis', qty: 42, total: 336000 },
  { nama: 'Lele goreng kremes', qty: 28, total: 420000 },
  { nama: 'Sudirman Coffee', qty: 25, total: 322500 },
  { nama: 'Menu Custom (Nasi + Ayam)', qty: 9, total: 80100 },
];
const BY_CATEGORY = [
  { nama: 'Minuman', qty: 67, total: 658500 },
  { nama: 'Makanan', qty: 37, total: 500100 },
];
const BY_METHOD = [
  { nama: 'Tunai (18 trx)', total: 486500 },
  { nama: 'EDC / Kartu (12 trx)', total: 312000 },
  { nama: 'QRIS / E-Wallet (11 trx)', total: 198400 },
  { nama: 'Deposit Member (4 trx)', total: 112000 },
  { nama: 'Order Online (6 trx)', total: 124000 },
];
const BY_MODE = [
  { nama: 'Dine In (21 trx)', total: 512000 },
  { nama: 'Bawa Pulang (14 trx)', total: 356900 },
  { nama: 'Online / Delivery (6 trx)', total: 124000 },
];
const PROMO = [
  { nama: 'QOQI10 (Diskon)', pakai: 12, total: -60000 },
  { nama: 'HEMAT20 (Voucher)', pakai: 5, total: -100000 },
  { nama: 'GIFT50 (Gift)', pakai: 2, total: -100000 },
];
const CANCELLED = [
  { nama: 'Es Teh Manis', qty: 3, alasan: 'Salah input' },
  { nama: 'Lele goreng kremes', qty: 1, alasan: 'Stok habis' },
];

const EXPENSE_TOTAL = 65000;

export default function RecapScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [range, setRange] = useState<Range>('Hari Ini');

  const gross = useMemo(() => BY_METHOD.reduce((s, r) => s + r.total, 0), []);
  const trxCount = 51;
  const promoTotal = PROMO.reduce((s, p) => s + p.total, 0);
  const cancelQty = CANCELLED.reduce((s, c) => s + c.qty, 0);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.sub}>Shift Pagi · Kasir Gista</Text>

      <View style={styles.filters}>
        {RANGES.map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.filterChip, range === r && styles.filterActive]}
            onPress={() => setRange(r)}>
            <Text style={[styles.filterTxt, range === r && styles.filterTxtActive]}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Total Penjualan · {range}</Text>
        <Text style={styles.heroValue}>{rp(gross)}</Text>
        <Text style={styles.heroSub}>{trxCount} transaksi · 08:00 – 15:00</Text>
        <Text style={styles.heroNet}>Kas bersih {rp(gross - EXPENSE_TOTAL)} setelah pengeluaran</Text>
      </View>

      <Text style={styles.sec}>Ringkasan per Metode Bayar</Text>
      <View style={styles.card}>
        {BY_METHOD.map((r) => (
          <View key={r.nama} style={styles.row}>
            <Text style={styles.item}>{r.nama}</Text>
            <Text style={styles.price}>{rp(r.total)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sec}>Penjualan per Menu</Text>
      <View style={styles.card}>
        {BY_MENU.map((r) => (
          <View key={r.nama} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.item}>{r.nama}</Text>
              <Text style={styles.meta}>{r.qty} terjual</Text>
            </View>
            <Text style={styles.price}>{rp(r.total)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sec}>Penjualan per Kategori</Text>
      <View style={styles.card}>
        {BY_CATEGORY.map((r) => (
          <View key={r.nama} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.item}>{r.nama}</Text>
              <Text style={styles.meta}>{r.qty} item</Text>
            </View>
            <Text style={styles.price}>{rp(r.total)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sec}>Penjualan per Mode</Text>
      <View style={styles.card}>
        {BY_MODE.map((r) => (
          <View key={r.nama} style={styles.row}>
            <Text style={styles.item}>{r.nama}</Text>
            <Text style={styles.price}>{rp(r.total)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sec}>Promo & Diskon</Text>
      <View style={styles.card}>
        {PROMO.map((r) => (
          <View key={r.nama} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.item}>{r.nama}</Text>
              <Text style={styles.meta}>{r.pakai}x dipakai</Text>
            </View>
            <Text style={styles.disc}>{rp(r.total)}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.totalL}>Total promo</Text>
          <Text style={styles.disc}>{rp(promoTotal)}</Text>
        </View>
      </View>

      <Text style={styles.sec}>Item Dibatalkan ({cancelQty})</Text>
      <View style={styles.card}>
        {CANCELLED.map((r) => (
          <View key={r.nama} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.item}>{r.qty}× {r.nama}</Text>
              <Text style={styles.meta}>{r.alasan}</Text>
            </View>
          </View>
        ))}
        {CANCELLED.length === 0 && <Text style={styles.meta}>Tidak ada item dibatalkan.</Text>}
      </View>

      <Text style={styles.sec}>Pengeluaran Kas</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.item}>Total pengeluaran outlet</Text>
          <Text style={styles.disc}>-{rp(EXPENSE_TOTAL)}</Text>
        </View>
        <TouchableOpacity onPress={() => navigation?.navigate('Expense')}>
          <Text style={styles.link}>Kelola pengeluaran cabang ›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghost} onPress={() => navigation?.navigate('History')}>
          <Text style={styles.ghostT}>Riwayat Transaksi</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary2} onPress={() => navigation?.navigate('EndShift')}>
          <Text style={styles.primaryT}>Tutup Shift</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  sub: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  filters: { flexDirection: 'row', marginTop: 10 },
  filterChip: {
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    borderRadius: 20, paddingVertical: 7, paddingHorizontal: 16, marginRight: 8,
  },
  filterActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  filterTxtActive: { color: colors.white },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18, marginTop: 10 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.navyTint },
  heroValue: { fontFamily: fonts.bold, fontSize: 28, color: colors.white, marginTop: 6 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  heroNet: { fontFamily: fonts.semibold, fontSize: 12, color: colors.white, marginTop: 6 },
  sec: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, gap: 8 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, flex: 1 },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  disc: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  totalL: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, flex: 1 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  primary2: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
});
