import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { table?: string } } };

const SECTIONS: Record<string, string[]> = {
  Dalam: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
  Teras: ['T1', 'T2', 'T3'],
  VIP: ['VIP-1', 'VIP-2'],
};
const MODES = ['DINE IN', 'TAKE AWAY', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'];

/** Dine In — pilih section + meja, pax, nama tamu, ringkasan bill, Simpan/Cetak/Bayar. */
export default function DineInScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [section, setSection] = useState('Dalam');
  const [table, setTable] = useState(route?.params?.table ?? 'A3');
  const [pax, setPax] = useState('2');
  const [guest, setGuest] = useState('');
  const [mode, setMode] = useState('DINE IN');

  /** Bill meja ini — dihitung dari state (dulu hardcode tak rekonsiliasi + service Rp 0). */
  const billItems = [
    { name: 'Sudirman Coffee + Normal Sugar + Normal Ice', qty: 2, price: 25800 + 7000, discount: 0 },
    { name: 'Lele goreng kremes + Ekstra Sambel', qty: 1, price: 15000 + 4000, discount: 5000 },
  ];
  const gross = billItems.reduce((s, it) => s + it.qty * it.price, 0);
  const discTotal = billItems.reduce((s, it) => s + it.discount, 0);
  const net = gross - discTotal;
  const pb1 = Math.round((net * 10) / 110);
  const service = Math.round(net * 0.05);
  const total = net + service;

  const seats = SECTIONS[section] ?? [];

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.head}>Meja {table} · {section} · {pax} tamu</Text>
      <Text style={styles.saved}>Tersimpan</Text>

      <Text style={styles.label}>Section</Text>
      <View style={styles.chips}>
        {Object.keys(SECTIONS).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.chip, section === s && styles.chipOn]}
            onPress={() => { setSection(s); setTable((SECTIONS[s] ?? [])[0] ?? ''); }}>
            <Text style={[styles.chipT, section === s && styles.chipTOn]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Meja</Text>
      <View style={styles.chips}>
        {seats.map((st) => (
          <TouchableOpacity key={st} style={[styles.chip, table === st && styles.chipOn]} onPress={() => setTable(st)}>
            <Text style={[styles.chipT, table === st && styles.chipTOn]}>{st}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.duo}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Tamu (pax)</Text>
          <TextInput style={styles.input} value={pax} onChangeText={setPax} keyboardType="numeric" />
        </View>
        <View style={{ flex: 2 }}>
          <Text style={styles.label}>Nama pelanggan</Text>
          <TextInput style={styles.input} value={guest} onChangeText={setGuest} placeholder="Nama / info tambahan" placeholderTextColor={colors.faint} />
        </View>
      </View>

      <Text style={styles.label}>Mode Transaksi</Text>
      <View style={styles.chips}>
        {MODES.map((m) => (
          <TouchableOpacity key={m} style={[styles.chip, mode === m && styles.chipOn]} onPress={() => setMode(m)}>
            <Text style={[styles.chipT, mode === m && styles.chipTOn]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.bill}>
        <Text style={styles.billTitle}>{guest.trim() || 'Tamu'} · Meja {table} · {pax} pax</Text>
        {billItems.map((it) => (
          <View key={it.name} style={styles.row}>
            <Text style={styles.item}>{it.qty}× {it.name}</Text>
            <Text style={styles.price}>{rp(it.qty * it.price)}</Text>
          </View>
        ))}
        <View style={styles.row}><Text style={styles.item}>Subtotal</Text><Text style={styles.price}>{rp(gross)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Diskon</Text><Text style={styles.disc}>-{rp(discTotal)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Pajak (PB1 10%, incl.)</Text><Text style={styles.price}>{rp(pb1)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Service (5%)</Text><Text style={styles.price}>{rp(service)}</Text></View>
        <View style={styles.totalRow}><Text style={styles.totalL}>Total</Text><Text style={styles.totalV}>{rp(total)}</Text></View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghost} onPress={() => navigation?.navigate('LoadOrder')}>
          <Text style={styles.ghostT}>Simpan</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghost} onPress={() => navigation?.navigate('Receipt', { total })}>
          <Text style={styles.ghostT}>Cetak Struk</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={() => navigation?.navigate('Pay', { total })}>
          <Text style={styles.primaryT}>Bayar | {rp(total)} ›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.links}>
        <TouchableOpacity onPress={() => navigation?.navigate('MoveTable', { from: table })}>
          <Text style={styles.link}>Pindah Meja ›</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation?.navigate('SplitBill', {})}>
          <Text style={styles.link}>Bagi Bill ›</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation?.navigate('Cashier', { table, mode })}>
          <Text style={styles.link}>Tambah Menu ›</Text>
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
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  duo: { flexDirection: 'row', gap: 10 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
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
  links: { flexDirection: 'row', gap: 16, marginTop: 14, flexWrap: 'wrap' },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
});
