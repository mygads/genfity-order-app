import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type Status = 'Terjadwal' | 'Datang' | 'Selesai';
interface Resv { id: string; name: string; tamu: number; table: string; phone: string; note: string; date: string; time: string; status: Status; }

/** Samarkan nomor HP di daftar reservasi (privasi customer). */
function maskHp(hp: string): string {
  const d = hp.replace(/[^0-9]/g, '');
  if (d.length < 7) return hp;
  return `${d.slice(0, 4)}•••${d.slice(-4)}`;
}

/** Warna badge status reservasi. */
function statusStyle(status: Status) {
  if (status === 'Datang') return { bg: colors.paleGreen, tx: colors.greenDark };
  if (status === 'Selesai') return { bg: colors.paleBlue, tx: colors.navy };
  return { bg: colors.paleAmber, tx: colors.amberDark };
}

const NEXT: Record<Status, Status | null> = { Terjadwal: 'Datang', Datang: 'Selesai', Selesai: null };

const SEED: Resv[] = [
  { id: 'r1', name: 'Andini', tamu: 4, table: 'A-03', phone: '0812-7788-9900', note: 'dekat jendela', date: 'Hari ini', time: '12:30', status: 'Datang' },
  { id: 'r2', name: 'Rudi Hartono', tamu: 2, table: 'B-01', phone: '0813-2211-4455', note: 'Ulang tahun', date: 'Hari ini', time: '18:00', status: 'Terjadwal' },
  { id: 'r3', name: 'PT Maju Jaya', tamu: 10, table: 'VIP-1', phone: '021-5566-7788', note: 'Bukber, butuh proyektor', date: 'Besok', time: '19:00', status: 'Terjadwal' },
];

const TABLES_FREE = ['A-03 (4 kursi)', 'B-01 (2 kursi)', 'VIP-1 (12 kursi)', 'A-05 (kosong)', 'B-02 (kosong)'];

/** Booking / reservasi — form (nama, telp, tanggal/jam, pax, meja, catatan) + daftar. */
export default function BookingScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [list, setList] = useState<Resv[]>(SEED);
  const [onlyToday, setOnlyToday] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tamu, setPax] = useState('');
  const [table, setTable] = useState(TABLES_FREE[0] as string);
  const [date, setDate] = useState('Hari ini');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [warn, setWarn] = useState('');

  const shown = onlyToday ? list.filter((r) => r.date === 'Hari ini') : list;

  const save = () => {
    if (!name.trim()) {
      setWarn('Isi nama customer dulu.');
      return;
    }
    if (!time.trim()) {
      setWarn('Isi jam reservasi dulu.');
      return;
    }
    setWarn('');
    setList((l) => [...l, {
      id: `r${Date.now()}`, name: name.trim(), tamu: Number(tamu) || 2,
      table: table.split(' ')[0] as string, phone: phone.trim() || '-', note: note.trim() || '-',
      date, time: time.trim(), status: 'Terjadwal',
    }]);
    setName(''); setPhone(''); setPax(''); setTime(''); setNote('');
  };

  const advance = (id: string) =>
    setList((l) =>
      l.map((r) => {
        const nx = NEXT[r.status];
        return r.id === id && nx ? { ...r, status: nx } : r;
      }),
    );

  const reservasiList = (
    <>
      <Text style={styles.count}>ESB Cabang Poris · {shown.length} reservasi aktif</Text>
      <TouchableOpacity onPress={() => setOnlyToday((v) => !v)} style={styles.todayToggle}>
        <Text style={styles.todayToggleT}>{onlyToday ? '☑ Hari ini saja' : '☐ Hari ini saja'}</Text>
      </TouchableOpacity>

      <Text style={styles.sec}>Daftar Reservasi</Text>
      <Text style={styles.hint}>Ketuk untuk buka di kasir · tombol status memajukan Terjadwal → Datang → Selesai.</Text>
      {shown.length === 0 && <Text style={styles.empty}>Belum ada reservasi — buat baru di bawah.</Text>}
      {shown.map((r) => (
        <View key={r.id} style={styles.card}>
          <TouchableOpacity style={styles.cardMain} onPress={() => navigation?.navigate('Cashier')}>
            <View style={styles.avatar}><Text style={styles.avatarT}>{r.name[0]}</Text></View>
            <View style={styles.info}>
              <Text style={styles.name}>{r.name} · {r.tamu} tamu · {r.table}</Text>
              <Text style={styles.meta}>{maskHp(r.phone)} · Catatan: {r.note}</Text>
              <Text style={styles.meta}>
                {r.date} · {r.time} · <Text style={[styles.statusBadge, { backgroundColor: statusStyle(r.status).bg, color: statusStyle(r.status).tx }]}>{r.status}</Text>
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
          {NEXT[r.status] && (
            <TouchableOpacity style={styles.advBtn} onPress={() => advance(r.id)}>
              <Text style={styles.advT}>→ {NEXT[r.status]}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      <View style={[styles.card, styles.moveCard]}>
        <Text style={styles.cardTitle}>Pindah item / meja</Text>
        <Text style={styles.meta}>Pindahan antar meja lewat layar khusus — bukan dari booking.</Text>
        <View style={[styles.links, { flexWrap: 'wrap', gap: 12 }]}>
          <TouchableOpacity onPress={() => navigation?.navigate('MoveItems', {})}><Text style={styles.link}>Pindah Item ›</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('MoveTable', {})}><Text style={styles.link}>Pindah Meja ›</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}><Text style={styles.link}>Denah Meja ›</Text></TouchableOpacity>
        </View>
      </View>
    </>
  );

  const bookingForm = (
    <>
      <Text style={styles.sec}>Reservasi Baru</Text>
      <Text style={styles.hint}>Form pemesanan meja (BookTable).</Text>
      <Text style={styles.label}>Nama customer</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nama" placeholderTextColor={colors.faint} />
      <Text style={styles.label}>No. HP</Text>
      <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="08xx" keyboardType="phone-pad" placeholderTextColor={colors.faint} />
      <Text style={styles.label}>Jumlah tamu</Text>
      <TextInput style={styles.input} value={tamu} onChangeText={setPax} placeholder="2" keyboardType="numeric" placeholderTextColor={colors.faint} />
      <Text style={styles.label}>Meja</Text>
      <View style={styles.chips}>
        {TABLES_FREE.map((t) => (
          <TouchableOpacity key={t} style={[styles.chip, table === t && styles.chipOn]} onPress={() => setTable(t)}>
            <Text style={[styles.chipT, table === t && styles.chipTOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Tanggal</Text>
      <View style={styles.chips}>
        {['Hari ini', 'Besok'].map((d) => (
          <TouchableOpacity key={d} style={[styles.chip, date === d && styles.chipOn]} onPress={() => setDate(d)}>
            <Text style={[styles.chipT, date === d && styles.chipTOn]}>{d}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Jam</Text>
      <TextInput style={styles.input} value={time} onChangeText={setTime} placeholder="12:30" placeholderTextColor={colors.faint} />
      <Text style={styles.label}>Catatan</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Catatan" placeholderTextColor={colors.faint} />
      {warn ? <Text style={styles.warn}>{warn}</Text> : null}
      <TouchableOpacity style={styles.primary} onPress={save}>
        <Text style={styles.primaryT}>Simpan Reservasi ›</Text>
      </TouchableOpacity>
      <Text style={styles.fine}>Contoh tersimpan: Andini · 4 tamu · {rp(86400)} · meja A-03.</Text>
    </>
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Booking</Text>
        <View style={{ width: 26 }} />
      </View>
      {isTablet ? (
        <View style={styles.split}>
          <ScrollView style={styles.listSide} contentContainerStyle={styles.body}>
            {reservasiList}
          </ScrollView>
          <ScrollView style={styles.formSide} contentContainerStyle={styles.body}>
            {bookingForm}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {reservasiList}
          {bookingForm}
        </ScrollView>
      )}
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
  todayToggle: { marginTop: 6 },
  todayToggleT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 18 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 8 },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, backgroundColor: colors.card, borderRadius: 10, padding: 14 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  cardMain: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  advBtn: { backgroundColor: colors.paleGreen, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 8 },
  advT: { fontFamily: fonts.bold, fontSize: 12, color: colors.greenDark },
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
  split: { flex: 1, flexDirection: 'row' },
  listSide: { flex: 1 },
  formSide: { flex: 1, borderLeftWidth: 1, borderLeftColor: colors.line, backgroundColor: colors.card },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  warn: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red, marginTop: 8 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  fine: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, marginTop: 8 },
});
