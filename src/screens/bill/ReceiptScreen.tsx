import { ScrollView, StyleSheet, Text, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { no?: string; total?: number; method?: string; mode?: string } } };

export default function ReceiptScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const no = route?.params?.no ?? '#148';
  const method = route?.params?.method ?? 'QRIS';
  const mode = route?.params?.mode ?? 'Bawa Pulang';
  const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const now = new Date();
  const todayId = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const timeId = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} WIB`;
  // Struk konsisten: 19900 + 19000 = subtotal 38900 − diskon 5000 = total 33900

  const paper = (
    <View style={styles.paper}>
      <Text style={styles.shop}>ESB Cabang Poris</Text>
      <Text style={styles.addr}>Jl. Poris Raya No. 8 · 021-555-0100</Text>
      <Text style={styles.line}>No: {no}    {mode}</Text>
      <Text style={styles.line}>Kasir Gista · QoQi</Text>
      <Text style={styles.line}>{todayId} · {timeId}</Text>
      <View style={styles.div} />
      <Text style={styles.item}>1× Sudirman Coffee</Text>
      <Text style={styles.note}>  Creamy Pandan, Normal {rp(12900)}</Text>
      <Text style={styles.note}>  + Modifier {rp(7000)}</Text>
      <Text style={styles.item}>1× Lele goreng kremes</Text>
      <Text style={styles.note}>  Ekstra Sambel {rp(15000)} + {rp(4000)}</Text>
      <View style={styles.row}><Text style={styles.item}>Subtotal</Text><Text style={styles.item}>{rp(38900)}</Text></View>
      <View style={styles.row}><Text style={styles.item}>Diskon</Text><Text style={styles.item}>-{rp(5000)}</Text></View>
      <View style={styles.div} />
      <View style={styles.row}><Text style={styles.total}>TOTAL</Text><Text style={styles.total}>{rp(33900)}</Text></View>
      <View style={styles.row}><Text style={styles.item}>{method}</Text><Text style={styles.item}>{rp(33900)}</Text></View>
      <View style={styles.row}><Text style={styles.item}>Kembali</Text><Text style={styles.item}>Rp 0</Text></View>
      <Text style={styles.thanks}>*** Terima kasih ***</Text>
    </View>
  );

  const actions = (
    <View style={[styles.actions, isTablet && styles.actionsStack]}>
      <TouchableOpacity style={[styles.ghost, isTablet && styles.actionCol]} onPress={() => navigation?.navigate('Dashboard')}>
        <Text style={styles.ghostT}>Kembali</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.ghost, isTablet && styles.actionCol]} onPress={() => navigation?.navigate('History')}>
        <Text style={styles.ghostT}>🖨 Cetak</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.ghost, isTablet && styles.actionCol]} onPress={() => navigation?.navigate('History')}>
        <Text style={styles.ghostT}>⤴ Bagikan</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.primary, isTablet && styles.actionCol]} onPress={() => navigation?.navigate('Cashier')}>
        <Text style={styles.primaryT}>+ Transaksi Baru</Text>
      </TouchableOpacity>
    </View>
  );

  if (isTablet) {
    return (
      <View style={styles.split}>
        <ScrollView style={styles.paperSide} contentContainerStyle={styles.body}>
          {paper}
        </ScrollView>
        <View style={styles.summarySide}>
          <Text style={styles.summaryTitle}>Ringkasan Struk</Text>
          <View style={styles.summaryCard}>
            <View style={styles.row}><Text style={styles.item}>No. Struk</Text><Text style={styles.item}>{no}</Text></View>
            <View style={styles.row}><Text style={styles.item}>Mode</Text><Text style={styles.item}>{mode}</Text></View>
            <View style={styles.row}><Text style={styles.item}>Metode</Text><Text style={styles.item}>{method}</Text></View>
            <View style={styles.div} />
            <View style={styles.row}><Text style={styles.total}>TOTAL</Text><Text style={styles.total}>{rp(33900)}</Text></View>
          </View>
          <View style={styles.actionsColumn}>{actions}</View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      {paper}
      {actions}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  paper: { backgroundColor: colors.white, borderRadius: 8, padding: 18, borderWidth: 1, borderColor: colors.line },
  shop: { fontFamily: fonts.bold, fontSize: 17, color: colors.text, textAlign: 'center' },
  addr: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4 },
  line: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 6 },
  div: { borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginVertical: 10 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, marginTop: 3 },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  total: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 4 },
  thanks: { fontFamily: fonts.bold, fontSize: 13, color: colors.text, textAlign: 'center', marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionsStack: { flexDirection: 'column' },
  actionCol: { flex: 0, width: '100%' },
  split: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  paperSide: { flex: 1.2 },
  summarySide: { flex: 1, backgroundColor: colors.card, borderLeftWidth: 1, borderLeftColor: colors.line, padding: 20 },
  summaryTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  summaryCard: { backgroundColor: colors.bg, borderRadius: 10, padding: 14, marginTop: 12 },
  actionsColumn: { marginTop: 16 },
  primary: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
});
