import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

interface Expense { id: string; name: string; time: string; amount: number; coa: string; approved: boolean; }

/** Akun (CoA) pengeluaran kas kecil ala APK. */
const COA = ['Operasional', 'Bahan Baku', 'Gaji', 'Utilitas', 'Lainnya'];

export default function RecapScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [expenses, setExpenses] = useState<Expense[]>([
    { id: 'e1', name: 'Belanja plastik & tissue', time: '10:20', amount: 45000, coa: 'Operasional', approved: true },
    { id: 'e2', name: 'Bensin antar online', time: '12:05', amount: 20000, coa: 'Operasional', approved: true },
  ]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [coa, setCoa] = useState(COA[0]);
  const expTotal = expenses.reduce((s, e) => s + e.amount, 0);

  const add = () => {
    const n = Number(amount.replace(/[^0-9]/g, ''));
    if (!name.trim() || !n) return;
    setExpenses((l) => [...l, { id: `e${Date.now()}`, name: name.trim(), time: '13:40', amount: n, coa, approved: false }]);
    setName(''); setAmount('');
  };

  const approve = (id: string) =>
    setExpenses((l) => l.map((e) => (e.id === id ? { ...e, approved: true } : e)));

  const rows: [string, string, number][] = [
    ['Tunai (18 trx)', '', 486500],
    ['EDC / Kartu (12 trx)', '', 312000],
    ['QRIS / E-Wallet (11 trx)', '', 198400],
    ['Order Online (6 trx)', '', 124000],
  ];
  const gross = rows.reduce((s, [, , v]) => s + v, 0);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.sub}>Shift Pagi · Kasir Gista</Text>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Total Penjualan Shift Ini</Text>
        <Text style={styles.heroValue}>{rp(gross)}</Text>
        <Text style={styles.heroSub}>47 transaksi · 08:00 – 15:00</Text>
        <Text style={styles.heroNet}>Kas bersih {rp(gross - expTotal)} setelah pengeluaran</Text>
      </View>
      <Text style={styles.sec}>Ringkasan Pembayaran</Text>
      <View style={styles.card}>
        {rows.map(([l, , v]) => (
          <View key={l} style={styles.row}>
            <Text style={styles.item}>{l}</Text>
            <Text style={styles.price}>{rp(v)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.sec}>Pengeluaran Kas</Text>
      <View style={styles.card}>
        {expenses.map((e) => (
          <View key={e.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.item}>{e.name}</Text>
              <Text style={styles.meta}>
                {e.time} · {e.coa} ·{' '}
                {e.approved ? (
                  <Text style={styles.okBadge}>✓ Disetujui</Text>
                ) : (
                  <Text style={styles.waitBadge}>Menunggu persetujuan</Text>
                )}
              </Text>
            </View>
            <Text style={styles.disc}>-{rp(e.amount)}</Text>
            {!e.approved && (
              <TouchableOpacity
                onPress={() => approve(e.id)}
                hitSlop={10}
                style={styles.approveBtn}>
                <Text style={styles.approve}>Setujui</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => setExpenses((l) => l.filter((x) => x.id !== e.id))}
              hitSlop={10}
              style={styles.delBtn}>
              <Text style={styles.del}>Hapus</Text>
            </TouchableOpacity>
          </View>
        ))}
        {expenses.length === 0 && <Text style={styles.meta}>Belum ada pengeluaran outlet hari ini.</Text>}
        <View style={styles.row}>
          <Text style={styles.totalL}>Total pengeluaran</Text>
          <Text style={styles.disc}>-{rp(expTotal)}</Text>
        </View>
        <Text style={styles.label}>Tambah pengeluaran</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nama pengeluaran" placeholderTextColor={colors.faint} />
        <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="Nominal Rp" placeholderTextColor={colors.faint} keyboardType="numeric" />
        <Text style={styles.label}>Akun (CoA)</Text>
        <View style={styles.chips}>
          {COA.map((c) => (
            <TouchableOpacity key={c} style={[styles.chip, coa === c && styles.chipOn]} onPress={() => setCoa(c)}>
              <Text style={[styles.chipT, coa === c && styles.chipTOn]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.primary} onPress={add}>
          <Text style={styles.primaryT}>Tambah</Text>
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
  delBtn: { paddingVertical: 8, paddingLeft: 12 },
  del: { fontFamily: fonts.semibold, fontSize: 12, color: colors.faint },
  approveBtn: { paddingVertical: 8, paddingLeft: 12 },
  approve: { fontFamily: fonts.bold, fontSize: 12, color: colors.greenDark },
  okBadge: { fontFamily: fonts.semibold, color: colors.greenDark },
  waitBadge: { fontFamily: fonts.semibold, color: colors.amberDark },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  totalL: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, flex: 1 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.medium, fontSize: 14, color: colors.text, marginBottom: 8 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 4 },
  primaryT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  primary2: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
});
