import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

interface Resv { id: string; name: string; tamu: number; table: string; phone: string; note: string; time: string; status: string; }

/** Samarkan nomor HP di daftar reservasi (privasi customer). */
function maskHp(hp: string): string {
  const d = hp.replace(/[^0-9]/g, '');
  if (d.length < 7) return hp;
  return `${d.slice(0, 4)}•••${d.slice(-4)}`;
}

/** Warna badge status reservasi. */
function statusStyle(status: string) {
  if (status === 'Datang') return { bg: colors.paleGreen, tx: colors.greenDark };
  return { bg: colors.paleAmber, tx: colors.amberDark };
}

const SEED: Resv[] = [
  { id: 'r1', name: 'Andini', tamu: 4, table: 'A-03', phone: '0812-7788-9900', note: 'dekat jendela', time: '12:30', status: 'Datang' },
  { id: 'r2', name: 'Rudi Hartono', tamu: 2, table: 'B-01', phone: '0813-2211-4455', note: 'Ulang tahun', time: '18:00', status: 'Terjadwal' },
  { id: 'r3', name: 'PT Maju Jaya', tamu: 10, table: 'VIP-1', phone: '021-5566-7788', note: 'Bukber, butuh proyektor', time: '19:00', status: 'Terjadwal' },
];

const MOVES = [
  '1× Sudirman Coffee — A-03 → A-05',
  '2× Lele goreng kremes — A-03 → A-05',
  '1× Es Teh Manis — B-01 → B-02',
];

const TABLES_FREE = ['A-03 (4 kursi)', 'B-01 (2 kursi)', 'VIP-1 (12 kursi)', 'A-05 (kosong)', 'B-02 (kosong)'];

export default function BookingScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [list, setList] = useState<Resv[]>(SEED);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tamu, setPax] = useState('');
  const [table, setTable] = useState(TABLES_FREE[0]);
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [fromTable, setFromTable] = useState('A-03 · Andini · ' + rp(86400));
  const [toTable, setToTable] = useState('A-05 (kosong)');

  const save = () => {
    if (!name.trim()) return;
    setList((l) => [...l, {
      id: `r${Date.now()}`, name: name.trim(), tamu: Number(tamu) || 2,
      table: table.split(' ')[0], phone: phone.trim() || '-', note: note.trim() || '-',
      time: time.trim() || '--:--', status: 'Terjadwal',
    }]);
    setName(''); setPhone(''); setPax(''); setTime(''); setNote('');
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Booking</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.count}>ESB Cabang Poris · {list.length} reservasi aktif</Text>

      <Text style={styles.sec}>Daftar Reservasi</Text>
      <Text style={styles.hint}>Hari ini · ketuk untuk buka di kasir.</Text>
      {list.length === 0 && <Text style={styles.empty}>Belum ada reservasi hari ini — buat baru di bawah.</Text>}
      {list.map((r) => (
        <TouchableOpacity key={r.id} style={styles.card} onPress={() => navigation?.navigate('Cashier')}>
          <View style={styles.avatar}><Text style={styles.avatarT}>{r.name[0]}</Text></View>
          <View style={styles.info}>
            <Text style={styles.name}>{r.name} · {r.tamu} tamu · {r.table}</Text>
            <Text style={styles.meta}>{maskHp(r.phone)} · Catatan: {r.note}</Text>
            <Text style={styles.meta}>
              {r.time} · <Text style={[styles.statusBadge, { backgroundColor: statusStyle(r.status).bg, color: statusStyle(r.status).tx }]}>{r.status}</Text>
            </Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </TouchableOpacity>
      ))}

      <View style={[styles.card, styles.moveCard]}>
        <Text style={styles.cardTitle}>Pindah item antar meja</Text>
        {MOVES.map((m) => <Text key={m} style={styles.meta} numberOfLines={2}>• {m}</Text>)}
        <View style={[styles.links, { flexWrap: 'wrap', gap: 12 }]}>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}><Text style={styles.link}>Lihat Denah Meja ›</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Cashier')}><Text style={styles.link}>Buka di Kasir ›</Text></TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sec}>Reservasi Baru</Text>
      <Text style={styles.hint}>Form pemesanan meja (BookTable).</Text>
      <Text style={styles.label}>Nama customer</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nama" />
      <Text style={styles.label}>No. HP</Text>
      <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="08xx" keyboardType="phone-pad" />
      <Text style={styles.label}>Jumlah tamu</Text>
      <TextInput style={styles.input} value={tamu} onChangeText={setPax} placeholder="2" keyboardType="numeric" />
      <Text style={styles.label}>Meja</Text>
      <View style={styles.chips}>
        {TABLES_FREE.map((t) => (
          <TouchableOpacity key={t} style={[styles.chip, table === t && styles.chipOn]} onPress={() => setTable(t)}>
            <Text style={[styles.chipT, table === t && styles.chipTOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Waktu / Tanggal</Text>
      <TextInput style={styles.input} value={time} onChangeText={setTime} placeholder="12:30" />
      <Text style={styles.label}>Catatan</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Catatan" />
      <TouchableOpacity style={styles.primary} onPress={save}>
        <Text style={styles.primaryT}>Simpan Reservasi ›</Text>
      </TouchableOpacity>

      <Text style={styles.sec}>Pindah meja (MoveTable)</Text>
      <Text style={styles.label}>Dari meja</Text>
      <View style={styles.chips}>
        {['A-03 · Andini · ' + rp(86400), 'B-01 · Rudi · ' + rp(41000)].map((t) => (
          <TouchableOpacity key={t} style={[styles.chip, fromTable === t && styles.chipOn]} onPress={() => setFromTable(t)}>
            <Text style={[styles.chipT, fromTable === t && styles.chipTOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Ke meja</Text>
      <View style={styles.chips}>
        {['A-05 (kosong)', 'B-02 (kosong)'].map((t) => (
          <TouchableOpacity key={t} style={[styles.chip, toTable === t && styles.chipOn]} onPress={() => setToTable(t)}>
            <Text style={[styles.chipT, toTable === t && styles.chipTOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.primary} onPress={() => navigation?.navigate('Tables')}>
        <Text style={styles.primaryT}>Pindahkan Meja</Text>
      </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 48,
    paddingBottom: 12,
    gap: 12,
  },
  back: { color: colors.white, fontSize: 26, fontFamily: fonts.bold, width: 26 },
  headerTitle: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 16, textAlign: 'center' },
  body: { padding: 16, paddingBottom: 40 },
  count: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 18 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 8 },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, backgroundColor: colors.card, borderRadius: 10, padding: 14 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', gap: 10 },
  moveCard: { flexDirection: 'column' },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, marginBottom: 6 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paleBlue, alignItems: 'center', justifyContent: 'center' },
  avatarT: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  info: { flex: 1 },
  name: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  statusBadge: { fontFamily: fonts.semibold, fontSize: 12, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  chev: { fontFamily: fonts.bold, fontSize: 20, color: colors.faint, alignSelf: 'center' },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
