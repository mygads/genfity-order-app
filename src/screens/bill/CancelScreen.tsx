import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { orderId?: string; table?: string; cashier?: string; total?: number } } };

const ITEMS = [
  { id: 'c1', name: 'Sudirman Coffee', price: 12900 },
  { id: 'c2', name: 'Lele goreng kremes', price: 15000 },
  { id: 'c3', name: 'Es Teh Manis', price: 8000 },
];

const REASONS = [
  'Salah input / salah meja',
  'Customer berubah pikiran',
  'Stok habis / menu tidak tersedia',
  'Kualitas / komplain dapur',
];

const SPLITS = [
  { id: 's1', label: 'Split #1 · QoQi', amount: 41000, paid: true },
  { id: 's2', label: 'Split #2 · Bimo', amount: 32500, paid: false },
  { id: 's3', label: 'Split #3 · Sinta', amount: 12900, paid: false },
];

export default function CancelScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const orderId = route?.params?.orderId ?? 'TRX-047';
  const tableNo = route?.params?.table ?? 'A-03';
  const cashier = route?.params?.cashier ?? 'QoQi';
  const orderTotal = route?.params?.total ?? 86400;
  const [picked, setPicked] = useState<string[]>(['c1']);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [done, setDone] = useState(false);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const voidTotal = ITEMS.filter((i) => picked.includes(i.id)).reduce((s, i) => s + i.price, 0);
  const remain = orderTotal - voidTotal;

  const confirm = () => {
   if (picked.length === 0 || pin.length < 4) return;
   setDone(true);
 };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.meta}>Order {orderId} · {tableNo} · {cashier} · {rp(orderTotal)}</Text>
      <Text style={styles.sec}>Batal Order / Menu</Text>
      <Text style={styles.hint}>Pilih item, lalu alasan — butuh PIN supervisor.</Text>

      {ITEMS.map((i) => (
        <TouchableOpacity key={i.id} style={[styles.item, picked.includes(i.id) && styles.itemOn]} onPress={() => toggle(i.id)}>
          <Text style={[styles.check, picked.includes(i.id) && styles.checkOn]}>{picked.includes(i.id) ? '☑' : '☐'}</Text>
          <Text style={styles.itemName}>1× {i.name}</Text>
          <Text style={styles.itemPrice}>{rp(i.price)}</Text>
        </TouchableOpacity>
      ))}

      <Text style={styles.label}>Alasan pembatalan</Text>
      {REASONS.map((r) => (
        <TouchableOpacity key={r} style={[styles.reason, reason === r && styles.reasonOn]} onPress={() => setReason(r)}>
          <Text style={[styles.reasonT, reason === r && styles.reasonTOn]}>{r}</Text>
        </TouchableOpacity>
      ))}
      <Text style={styles.label}>Catatan tambahan (opsional)</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Catatan" />
      <Text style={styles.label}>PIN supervisor</Text>
      <TextInput style={styles.input} value={pin} onChangeText={setPin} placeholder="4 digit" keyboardType="numeric" maxLength={4} secureTextEntry />

      <View style={styles.summary}>
        <Text style={styles.sumTitle}>Konfirmasi & Split Bill</Text>
        <Text style={styles.sumLine}>{picked.length} item ({rp(voidTotal)}) akan dibatalkan.</Text>
        <Text style={styles.sumNote}>Stok dikembalikan · jejak void tercatat di laporan.</Text>
        <View style={styles.row}><Text style={styles.item2}>Order {orderId} · {tableNo} · {cashier}</Text></View>
        <View style={styles.row}><Text style={styles.item2}>Total awal</Text><Text style={styles.price}>{rp(orderTotal)}</Text></View>
        <View style={styles.row}><Text style={styles.item2}>Dibatalkan</Text><Text style={styles.disc}>-{rp(voidTotal)}</Text></View>
        <View style={styles.row}><Text style={styles.totalL}>Sisa tagihan</Text><Text style={styles.totalV}>{rp(remain)}</Text></View>
        <Text style={styles.sumHint}>Lanjut ke pembayaran untuk melunasi sisa tagihan.</Text>
      </View>

      <Text style={styles.sec}>Batalkan Split</Text>
      {SPLITS.map((sp) => (
        <View key={sp.id} style={styles.item}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName}>{sp.label}</Text>
            <Text style={styles.meta2}>{sp.paid ? 'Lunas' : rp(sp.amount)}</Text>
          </View>
          {!sp.paid && <Text style={styles.cancelT}>Batalkan</Text>}
        </View>
      ))}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghost} onPress={() => navigation?.goBack()}>
          <Text style={styles.ghostT}>Kembali</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primary, (pin.length < 4 || picked.length === 0) && styles.disabled]} onPress={confirm} disabled={pin.length < 4 || picked.length === 0}>
          <Text style={styles.primaryT}>Ya, Batalkan ›</Text>
        </TouchableOpacity>
      </View>
      {done && <Text style={styles.done}>Void tercatat — stok dikembalikan ke inventori.</Text>}
      <TouchableOpacity onPress={() => navigation?.navigate('History')}>
        <Text style={styles.link}>Riwayat void → Riwayat transaksi</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  meta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  meta2: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 16 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  itemOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  check: { fontSize: 18, color: colors.faint },
  checkOn: { color: colors.orange },
  itemName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, flex: 1 },
  itemPrice: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 14, marginBottom: 6 },
  reason: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, backgroundColor: colors.card, marginTop: 6 },
  reasonOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  reasonT: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  reasonTOn: { color: colors.orangeDark },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  summary: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.line },
  sumTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  sumLine: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, marginTop: 6 },
  sumNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  sumHint: { fontFamily: fonts.medium, fontSize: 12, color: colors.navy, marginTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  item2: { fontFamily: fonts.regular, fontSize: 13, color: colors.text },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  disc: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  totalL: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  totalV: { fontFamily: fonts.bold, fontSize: 16, color: colors.orangeDark },
  cancelT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primary: { flex: 1, backgroundColor: colors.red, borderRadius: 10, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  done: { fontFamily: fonts.semibold, fontSize: 13, color: colors.greenDark, marginTop: 12 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark, marginTop: 10 },
});
