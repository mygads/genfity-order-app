import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';
import { itemTotal, type CartItem } from './CashierScreen';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { items?: CartItem[]; total?: number } } };

const SEED: CartItem[] = [
  { id: 'p11', name: 'Sudirman Coffee', basePrice: 12900, qty: 1, modifiers: [{ name: 'Creamy Pandan', price: 7000 }], discount: 0 },
  { id: 'p2', name: 'Ayam Goreng Dada', basePrice: 15000, qty: 2, modifiers: [], discount: 0 },
  { id: 'p9', name: 'Teh Manis Panas', basePrice: 8000, qty: 2, modifiers: [], discount: 0 },
];

const METHODS = ['Tunai', 'QRIS', 'EDC', 'Transfer'];
const NAMES = ['Bill 1', 'Bill 2', 'Bill 3', 'Bill 4'];

/**
 * Bagi Bill (split_bill) — pilih item → bagi ke 2+ bill,
 * tiap bill bisa beda metode bayar + tombol Bayar per bill.
 * Daftarkan route: SplitBill.
 */
export default function SplitBillScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const items = useMemo(() => {
    const fromRoute = (route?.params?.items ?? []).filter((c) => !c.voided);
    return fromRoute.length > 0 ? fromRoute : SEED;
  }, [route?.params?.items]);
  const [splits, setSplits] = useState(2);
  const [assign, setAssign] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((it, i) => [it.id, i % 2])),
  );
  const [methods, setMethods] = useState<string[]>(['Tunai', 'QRIS']);
  const [paid, setPaid] = useState<boolean[]>([false, false]);

  const resetSplits = (n: number) => {
    setSplits(n);
    setPaid(Array(n).fill(false));
    setMethods(Array.from({ length: n }, (_, i) => METHODS[i % METHODS.length] as string));
    setAssign(Object.fromEntries(items.map((it, i) => [it.id, i % n])));
  };

  const cycleAssign = (id: string) =>
    setAssign((a) => ({ ...a, [id]: ((a[id] ?? 0) + 1) % splits }));

  const billTotals = useMemo(() => {
    const arr = Array(splits).fill(0) as number[];
    items.forEach((it) => {
      arr[assign[it.id] ?? 0] += itemTotal(it);
    });
    return arr;
  }, [items, assign, splits]);

  const grand = billTotals.reduce((s, v) => s + v, 0);
  const paidCount = paid.filter(Boolean).length;

  const payBill = (i: number) => {
    const val = billTotals[i] as number;
    if (val <= 0 || paid[i]) return;
    navigation?.navigate('Pay', { total: val, method: methods[i] });
    setPaid((p) => p.map((v, j) => (j === i ? true : v)));
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bagi Bill</Text>
        <Text style={styles.headerCount}>{paidCount}/{splits} lunas</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <Text style={styles.hint}>Ketuk item untuk memindahkan ke bill berikut — tiap bill bisa beda metode bayar.</Text>
        <Text style={styles.label}>Jumlah bill</Text>
        <View style={styles.chips}>
          {[2, 3, 4].map((n) => (
            <TouchableOpacity key={n} style={[styles.chip, splits === n && styles.chipOn]} onPress={() => resetSplits(n)}>
              <Text style={[styles.chipT, splits === n && styles.chipTOn]}>÷{n}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sec}>Item · {rp(grand)}</Text>
        {items.map((it) => (
          <TouchableOpacity key={it.id} style={styles.itemRow} onPress={() => cycleAssign(it.id)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{it.qty}× {it.name}</Text>
              <Text style={styles.itemPrice}>{rp(itemTotal(it))}</Text>
            </View>
            <Text style={styles.splitBadge}>Bill #{(assign[it.id] ?? 0) + 1} ›</Text>
          </TouchableOpacity>
        ))}
        {items.length === 0 && (
          <View style={styles.emptyWrap}>
            <Image
              source={require('../../../assets/images/empty_order.webp')}
              style={styles.emptyImg}
              resizeMode="contain"
            />
            <Text style={styles.emptyT}>Tidak ada item untuk dibagi</Text>
          </View>
        )}

        <Text style={styles.sec}>Per Bill</Text>
        {NAMES.slice(0, splits).map((name, i) => {
          const val = billTotals[i] as number;
          const members = items.filter((it) => (assign[it.id] ?? 0) === i);
          return (
            <View key={name} style={styles.billCard}>
              <View style={styles.billHead}>
                <Text style={styles.billName}>{name}</Text>
                <Text style={paid[i] ? styles.lunas : styles.billTotal}>
                  {paid[i] ? '✓ Lunas' : rp(val)}
                </Text>
              </View>
              <Text style={styles.billItems}>
                {members.length === 0 ? 'Belum ada item' : members.map((m) => `${m.qty}× ${m.name}`).join(' · ')}
              </Text>
              <Text style={styles.label}>Metode bayar</Text>
              <View style={styles.chips}>
                {METHODS.map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.chip, methods[i] === m && styles.chipOn]}
                    onPress={() => setMethods((arr) => arr.map((x, j) => (j === i ? m : x)))}>
                    <Text style={[styles.chipT, methods[i] === m && styles.chipTOn]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.billActs}>
                {!paid[i] && (
                  <TouchableOpacity
                    style={[styles.payBtn, val <= 0 && styles.payOff]}
                    disabled={val <= 0}
                    onPress={() => payBill(i)}>
                    <Text style={styles.payT}>Bayar {methods[i]} ›</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setPaid((p) => p.map((v, j) => (j === i ? !v : v)))}
                  hitSlop={10}>
                  <Text style={styles.lunasT}>{paid[i] ? 'Batalkan lunas' : 'Tandai lunas'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {paidCount === splits && (
          <Text style={styles.done}>Semua bill lunas — kembali ke kasir untuk transaksi baru.</Text>
        )}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.navigate('Cashier')}>
          <Text style={styles.backBtnT}>Kembali ke Kasir</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.navy, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  back: { color: colors.white, fontSize: 26, fontFamily: fonts.bold },
  headerTitle: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  headerCount: { color: colors.navyTint, fontFamily: fonts.regular, fontSize: 12 },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 12, marginBottom: 6 },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  itemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.line },
  itemName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  itemPrice: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  splitBadge: { fontFamily: fonts.bold, fontSize: 13, color: colors.orangeDark },
  emptyWrap: { alignItems: 'center', paddingVertical: 24 },
  emptyImg: { width: 110, height: 110 },
  emptyT: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 8 },
  billCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  billHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  billName: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  billTotal: { fontFamily: fonts.bold, fontSize: 16, color: colors.orangeDark },
  lunas: { fontFamily: fonts.bold, fontSize: 14, color: colors.greenDark },
  billItems: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  billActs: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 },
  payBtn: { backgroundColor: colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  payOff: { opacity: 0.4 },
  payT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  lunasT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy },
  done: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark, textAlign: 'center', marginTop: 8 },
  backBtn: { backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  backBtnT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
