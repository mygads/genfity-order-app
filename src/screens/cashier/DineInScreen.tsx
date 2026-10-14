import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { table?: string } } };

const SEATS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
const CATS = ['Promo', 'Favorit', 'Minuman', 'Makanan', 'Dessert', 'Pasta', 'Cake'];
const SUBS: Record<string, string[]> = {
  Minuman: ['Dingin', 'Panas', 'Coffee', 'Shake'],
  Makanan: ['Cepat', 'Ringan'],
};

export default function DineInScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [table, setTable] = useState(route?.params?.table ?? 'A3');
  const [pax, setPax] = useState('2');
  const [guest, setGuest] = useState('');
  const [cat, setCat] = useState('Minuman');
  const [sub, setSub] = useState<string | null>(null);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.head}>Meja {table} | Info tambahan / nama customer</Text>
      <Text style={styles.saved}>Tersimpan</Text>

      <Text style={styles.label}>Meja</Text>
      <View style={styles.chips}>
        {SEATS.map((st) => (
          <TouchableOpacity key={st} style={[styles.chip, table === st && styles.chipOn]} onPress={() => setTable(st)}>
            <Text style={[styles.chipT, table === st && styles.chipTOn]}>{st}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.duo}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Tamu</Text>
          <TextInput style={styles.input} value={pax} onChangeText={setPax} keyboardType="numeric" />
        </View>
        <View style={{ flex: 2 }}>
          <Text style={styles.label}>Nama pelanggan</Text>
          <TextInput style={styles.input} value={guest} onChangeText={setGuest} placeholder="Nama / info tambahan" />
        </View>
      </View>

      <Text style={styles.label}>Mode Transaksi</Text>
      <View style={styles.chips}>
        {CATS.map((c) => (
          <TouchableOpacity key={c} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => { setCat(c); setSub(null); }}>
            <Text style={[styles.chipT, cat === c && styles.chipTOn]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {SUBS[cat] && (
        <View style={styles.chips2}>
          {SUBS[cat].map((s) => (
            <TouchableOpacity key={s} style={[styles.chip, sub === s && styles.chipOn]} onPress={() => setSub(s)}>
              <Text style={[styles.chipT, sub === s && styles.chipTOn]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {cat === 'Promo' && (<Text style={styles.empty}>Promo Tersedia kosong — pilih kategori lain.</Text>)}

      <View style={styles.bill}>
        <Text style={styles.billTitle}>Dine In - {pax} tamu - Meja {table}</Text>
        <View style={styles.row}><Text style={styles.item}>2 Sudirman Coffee + Normal Sugar + Normal Ice</Text><Text style={styles.price}>{rp(25800)} + {rp(7000)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>1 Lele goreng kremes + Ekstra Sambel - Diskon (Rp)</Text><Text style={styles.price}>{rp(15000)} + {rp(4000)} - {rp(5000)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Subtotal</Text><Text style={styles.price}>{rp(65900)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Diskon</Text><Text style={styles.disc}>-{rp(5000)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Pajak (PB1 10%, incl.)</Text><Text style={styles.price}>{rp(5536)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Service (5%)</Text><Text style={styles.price}>{rp(0)}</Text></View>
        <View style={styles.totalRow}><Text style={styles.totalL}>Total</Text><Text style={styles.totalV}>{rp(60900)}</Text></View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghost} onPress={() => navigation?.navigate('LoadOrder')}>
          <Text style={styles.ghostT}>Simpan</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghost} onPress={() => navigation?.navigate('Receipt', { total: 60900 })}>
          <Text style={styles.ghostT}>Cetak Struk</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={() => navigation?.navigate('Pay', { total: 60900 })}>
          <Text style={styles.primaryT}>Bayar | {rp(60900)} ›</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  head: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  saved: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 2 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chips2: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  duo: { flexDirection: 'row', gap: 10 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 10 },
  bill: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.line },
  billTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 8 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, flex: 1 },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  disc: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, marginTop: 8, paddingTop: 10 },
  totalL: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  totalV: { fontFamily: fonts.bold, fontSize: 17, color: colors.orangeDark },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  primary: { flex: 2, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
});
