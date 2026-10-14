import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';
import { getSession } from '../../session';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

export default function AttendanceScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const s = getSession();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [clockedIn, setClockedIn] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const press = (k: string) => {
    setError('');
    if (k === 'C') setPin('');
    else if (k === '⌫') setPin(pin.slice(0, -1));
    else if (pin.length < 4) setPin(pin + k);
  };

  const submit = () => {
    if (pin.length < 4) { setError('PIN salah — coba lagi atau hubungi supervisor.'); return; }
    setClockedIn(true);
    setPin('');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.hint}>Karyawan {s?.outlet ?? 'ESB Cabang Poris'} · Kasir {s?.name ?? 'Gista'}</Text>
      <Text style={styles.sec}>Masuk / Keluar Kerja</Text>
      <Text style={styles.clock}>{now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':')}</Text>
      <Text style={styles.date}>{now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
      <Text style={styles.meta}>Shift Pagi (08:00 – 16:00) · {clockedIn ? '● Sudah Masuk' : '● Belum Masuk'}</Text>

      <View style={styles.card}>
        <Text style={styles.cardT}>Outlet {s?.outlet ?? 'ESB Cabang Poris'}</Text>
        <Text style={styles.meta}>{s?.name ?? 'Gista'} ({s?.username ?? 'gista.kasir'})</Text>
        <Text style={styles.meta}>{s?.shift ?? 'Shift Pagi'} · Kas {rp(s?.cash ?? 200000)} · Shift Buka</Text>
      </View>

      <Text style={styles.sec}>Daftar Kehadiran</Text>
      <View style={styles.card}>
        <View style={styles.row}><Text style={styles.item}>Masuk</Text><Text style={styles.item}>{clockedIn ? '08:57' : '-- : --'}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Istirahat</Text><Text style={styles.item}>-- : --</Text></View>
        <View style={styles.row}><Text style={styles.item}>Keluar</Text><Text style={styles.item}>-- : --</Text></View>
      </View>
      {!clockedIn && <Text style={styles.empty}>Belum ada absen masuk hari ini.</Text>}

      <Text style={styles.sec}>Masukkan PIN Absensi</Text>
      <View style={styles.pinRow}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.pinDot}><Text style={styles.pinChar}>{pin[i] ? '●' : '–'}</Text></View>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.keys}>
        {KEYS.map((k) => (
          <TouchableOpacity key={k} style={[styles.key, (k === 'C' || k === '⌫') && styles.keyUtil]} onPress={() => press(k)}>
            <Text style={[styles.keyT, (k === 'C' || k === '⌫') && styles.keyUtilT]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.primary, clockedIn && styles.disabled]} onPress={submit} disabled={clockedIn}>
          <Text style={styles.primaryT}>Masuk ›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghost} onPress={() => navigation?.navigate('Dashboard')}>
          <Text style={styles.ghostT}>Keluar</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.links}>
        <TouchableOpacity onPress={() => navigation?.navigate('Shift')}><Text style={styles.link}>Setelah masuk → Buka Shift</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation?.navigate('Dashboard')}><Text style={styles.link}>Lewati → Dashboard</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 16 },
  clock: { fontFamily: fonts.bold, fontSize: 34, color: colors.navy, marginTop: 6 },
  date: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 2 },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  cardT: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 8 },
  pinRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  pinDot: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  pinChar: { fontSize: 20, color: colors.navy },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginTop: 8 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  key: { width: '31%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  keyT: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  keyUtil: { backgroundColor: colors.bg },
  keyUtilT: { color: colors.red },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primary: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  links: { gap: 8, marginTop: 14 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
});
