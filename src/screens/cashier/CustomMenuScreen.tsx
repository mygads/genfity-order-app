import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

const STATIONS = ['Dapur Utama', 'Bar / Minuman', 'Dessert', 'Lainnya'];
const QUICK = ['Less Sugar', 'Less Ice', 'Extra Pedas', 'Tanpa MSG', 'Matang Sempurna', 'Sambal Pisah'];

export default function CustomMenuScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [name, setName] = useState('');
  const [price, setPrice] = useState('25000');
  const [qty, setQty] = useState('1');
  const [station, setStation] = useState(STATIONS[0]);
  const [notes, setNotes] = useState<string[]>(['Less Sugar', 'Less Ice']);
  const [free, setFree] = useState('Gula aren 50%');
  const [added, setAdded] = useState<string[]>([]);

  const toggleNote = (n: string) =>
    setNotes((l) => (l.includes(n) ? l.filter((x) => x !== n) : [...l, n]));

  const add = () => {
    if (!name.trim()) return;
    const n = Number(price.replace(/[^0-9]/g, '')) || 0;
    setAdded((l) => [...l, `${qty}× ${name.trim()} — ${rp(n * (Number(qty) || 1))}`]);
    setName('');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.meta}>TRX-047 · tambah item di luar katalog</Text>
      <Text style={styles.sec}>Tambah Menu Custom</Text>
      <Text style={styles.hint}>Untuk item dadakan — harga manual, tetap masuk struk & dapur.</Text>
      {added.length === 0
        ? <Text style={styles.empty}>Belum ada item custom — isi form lalu Tambah ke Order.</Text>
        : added.map((a) => <Text key={a} style={styles.added}>• {a}</Text>)}

      <Text style={styles.label}>Nama item</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="cth: Nasi + Ayam" />
      <View style={styles.duo}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Harga (Rp)</Text>
          <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Qty</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="numeric" />
        </View>
      </View>
      <Text style={styles.label}>Station dapur</Text>
      <View style={styles.chips}>
        {STATIONS.map((st) => (
          <TouchableOpacity key={st} style={[styles.chip, station === st && styles.chipOn]} onPress={() => setStation(st)}>
            <Text style={[styles.chipT, station === st && styles.chipTOn]}>{st}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.sub2}>{station === 'Dapur Utama' ? 'gorengan · nasi' : station === 'Bar / Minuman' ? 'kopi · jus' : station === 'Dessert' ? 'cake · es' : 'tanpa routing'} · {rp(Number(price.replace(/[^0-9]/g, '')) || 0)}</Text>
      <TouchableOpacity style={styles.primary} onPress={add}>
        <Text style={styles.primaryT}>Tambah ke Order ›</Text>
      </TouchableOpacity>

      <Text style={styles.sec}>Notes Item</Text>
      <Text style={styles.hint}>Catatan diteruskan ke KDS / struk dapur.</Text>
      <Text style={styles.label}>Item · Sudirman Coffee ×1</Text>
      <View style={styles.chips}>
        {QUICK.map((q) => (
          <TouchableOpacity key={q} style={[styles.chip, notes.includes(q) && styles.chipOn]} onPress={() => toggleNote(q)}>
            <Text style={[styles.chipT, notes.includes(q) && styles.chipTOn]}>{q}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Catatan bebas</Text>
      <TextInput style={styles.input} value={free} onChangeText={setFree} placeholder="Catatan bebas" />
      <View style={styles.preview}>
        <Text style={styles.prevTitle}>Pratinjau KDS · {station}</Text>
        <Text style={styles.prevLine}>1× Sudirman Coffee — {[...notes, free].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghost} onPress={() => navigation?.navigate('Kitchen')}>
          <Text style={styles.ghostT}>Lihat Dapur</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary2} onPress={() => navigation?.navigate('Cashier')}>
          <Text style={styles.primaryT}>Simpan Notes ›</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  meta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 16 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 6 },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, backgroundColor: colors.card, borderRadius: 10, padding: 14, marginTop: 6 },
  added: { fontFamily: fonts.medium, fontSize: 13, color: colors.greenDark, marginTop: 4 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  duo: { flexDirection: 'row', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  sub2: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 6 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  primary2: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  preview: { backgroundColor: colors.navy, borderRadius: 12, padding: 14, marginTop: 14 },
  prevTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.navyTint },
  prevLine: { fontFamily: fonts.medium, fontSize: 13, color: colors.white, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
});
