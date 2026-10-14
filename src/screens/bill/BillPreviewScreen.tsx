import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: Record<string, any> } };

const ITEMS = [
  { name: 'Sudirman Coffee + Creamy Pandan', qty: 1, price: 19900 },
  { name: 'Lele goreng kremes + Ekstra Sambel', qty: 1, price: 19000 },
  { name: 'Es Teh Manis', qty: 2, price: 16000 },
  { name: 'Menu Custom (Nasi + Ayam)', qty: 1, price: 8900 },
];

const SUBTOTAL = ITEMS.reduce((s, i) => s + i.qty * i.price, 0); // 79800
const DISCOUNT = 5000;
const SERVICE = Math.round((SUBTOTAL - DISCOUNT) * 0.05); // 3740
const TAX_INCL = Math.round(((SUBTOTAL - DISCOUNT) * 10) / 110); // 6800, informatif (sudah termasuk)
const TOTAL = SUBTOTAL - DISCOUNT + SERVICE; // 78540

type Mode = 'none' | 'rata' | 'item' | 'nominal';

export default function BillPreviewScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [mode, setMode] = useState<Mode>('none');
  const [splits, setSplits] = useState(3);
  const total = TOTAL;

  const splitVal = Math.round(total / splits);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.meta}>TRX hari ini · A-03 · QoQi</Text>
      <View style={styles.bill}>
        <Text style={styles.shop}>ESB CABANG PORIS</Text>
        <Text style={styles.addr}>Jl. Poris Indah No. 88 · 021-5566-7788</Text>
        <Text style={styles.trx}>TRX-047 · A-03 · Kasir Gista · 12:41</Text>
        {ITEMS.map((i) => (
          <View key={i.name} style={styles.row}>
            <Text style={styles.item}>{i.qty}× {i.name}</Text>
            <Text style={styles.price}>{rp(i.qty * i.price)}</Text>
          </View>
        ))}
        <View style={styles.row}><Text style={styles.item}>Subtotal</Text><Text style={styles.price}>{rp(SUBTOTAL)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Diskon (QOQI10)</Text><Text style={styles.disc}>-{rp(DISCOUNT)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Pajak PB1 10% (termasuk)</Text><Text style={styles.price}>{rp(TAX_INCL)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Service 5%</Text><Text style={styles.price}>{rp(SERVICE)}</Text></View>
        <View style={styles.totalRow}><Text style={styles.totalL}>TOTAL</Text><Text style={styles.totalV}>{rp(total)}</Text></View>
        <Text style={styles.member}>Member QoQi · GOLD · +79 poin</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghost} onPress={() => navigation?.navigate('Receipt', {})}>
          <Text style={styles.ghostT}>Cetak Struk</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={() => navigation?.navigate('Pay', { total })}>
          <Text style={styles.primaryT}>Bayar ›</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sec}>Bagi Bill (Split Bill)</Text>
      <Text style={styles.hint}>Bagi rata atau per item — tiap split bisa bayar terpisah.</Text>
      <Text style={styles.label}>Mode bagi</Text>
      <View style={styles.chips}>
        {([['rata', 'Rata (÷3)'], ['item', 'Per Item'], ['nominal', 'Nominal']] as [Mode, string][]).map(([m, l]) => (
          <TouchableOpacity key={m} style={[styles.chip, mode === m && styles.chipOn]} onPress={() => setMode(mode === m ? 'none' : m)}>
            <Text style={[styles.chipT, mode === m && styles.chipTOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {mode === 'none' ? (
        <Text style={styles.empty}>Belum ada split — pilih mode bagi di atas.</Text>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Jumlah split</Text>
          <View style={styles.chips}>
            {[2, 3, 4].map((n) => (
              <TouchableOpacity key={n} style={[styles.chip, splits === n && styles.chipOn]} onPress={() => setSplits(n)}>
                <Text style={[styles.chipT, splits === n && styles.chipTOn]}>÷{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {['QoQi', 'Bimo', 'Sinta', 'Guest'].slice(0, splits).map((n, i) => (
            <View key={n} style={styles.row}>
              <Text style={styles.item}>Split #{i + 1} · {n}</Text>
              <Text style={styles.price}>{rp(splitVal)}</Text>
            </View>
          ))}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.ghost} onPress={() => setMode('none')}>
              <Text style={styles.ghostT}>Batalkan Split</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={() => navigation?.navigate('Pay', { total: splitVal })}>
              <Text style={styles.primaryT}>Bayar Split #1 ›</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.links}>
        <TouchableOpacity onPress={() => navigation?.navigate('Cancel')}><Text style={styles.link}>Butuh void? → Pembatalan</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation?.navigate('Member')}><Text style={styles.link}>Info customer → Customer</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  meta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  bill: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  shop: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, textAlign: 'center' },
  addr: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 2 },
  trx: { fontFamily: fonts.medium, fontSize: 12, color: colors.faint, textAlign: 'center', marginVertical: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, flex: 1 },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  disc: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, marginTop: 8, paddingTop: 10 },
  totalL: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  totalV: { fontFamily: fonts.bold, fontSize: 18, color: colors.orangeDark },
  member: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primary: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 20 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 10, marginBottom: 6 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 10 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  links: { gap: 8, marginTop: 16 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
});
