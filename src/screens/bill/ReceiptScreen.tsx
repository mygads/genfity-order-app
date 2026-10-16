import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp } from '../../theme';
import { printReceipt, shareReceipt } from '../../lib/print';
import { isValidEmail, recordReceiptEmail } from '../../lib/payments';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { no?: string; total?: number; method?: string; mode?: string; cash?: number; change?: number } } };

export default function ReceiptScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const no = route?.params?.no ?? '#148';
  const method = route?.params?.method ?? 'QRIS';
  const mode = route?.params?.mode ?? 'Bawa Pulang';
  const cash = route?.params?.cash ?? 0;
  const change = route?.params?.change ?? 0;
  const isCash = method.toLowerCase().includes('tunai') || method.toLowerCase() === 'cash';
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
      {isCash && cash > 0 ? (
        <>
          <View style={styles.row}><Text style={styles.item}>Tunai Diterima</Text><Text style={styles.item}>{rp(cash)}</Text></View>
          <View style={styles.row}><Text style={styles.item}>Kembali</Text><Text style={styles.item}>{rp(change)}</Text></View>
        </>
      ) : (
        <View style={styles.row}><Text style={styles.item}>Kembali</Text><Text style={styles.item}>Rp 0</Text></View>
      )}
      <Text style={styles.thanks}>*** Terima kasih ***</Text>
    </View>
  );

  const shareText = `ESB Cabang Poris · Struk ${no} · ${mode} · ${method} · TOTAL ${rp(33900)}`;
  const [mailOpen, setMailOpen] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mailMsg, setMailMsg] = useState('');

  const sendMail = () => {
    if (!isValidEmail(mailTo)) {
      setMailMsg('Alamat email tidak valid.');
      return;
    }
    recordReceiptEmail(mailTo, no, 33900, method);
    setMailMsg('Struk masuk antrean kirim — terkirim saat online.');
  };

  const actions = (
    <View style={[styles.actions, isTablet && styles.actionsStack]}>
      <TouchableOpacity style={[styles.ghost, isTablet && styles.actionCol]} onPress={() => navigation?.navigate('Dashboard')}>
        <Text style={styles.ghostT}>Kembali</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.ghost, isTablet && styles.actionCol]} onPress={() => printReceipt()}>
        <Text style={styles.ghostT}>🖨 Cetak</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.ghost, isTablet && styles.actionCol]} onPress={() => { void shareReceipt(shareText); }}>
        <Text style={styles.ghostT}>⤴ Bagikan</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.ghost, isTablet && styles.actionCol]} onPress={() => { setMailMsg(''); setMailOpen(true); }}>
        <Text style={styles.ghostT}>✉ Email</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.primary, isTablet && styles.actionCol]} onPress={() => navigation?.navigate('Cashier')}>
        <Text style={styles.primaryT}>+ Transaksi Baru</Text>
      </TouchableOpacity>
    </View>
  );

  const mailModal = (
    <Modal visible={mailOpen} animationType="fade" transparent>
      <View style={styles.wrap}>
        <View style={[styles.dialog, styles.dialogNarrow]}>
          <Text style={styles.dTitle}>Kirim Struk via Email</Text>
          <Text style={styles.dSub}>Struk {no} • {rp(33900)}</Text>
          <TextInput
            style={styles.input}
            value={mailTo}
            onChangeText={setMailTo}
            placeholder="nama@email.com"
            placeholderTextColor={colors.faint}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {mailMsg ? <Text style={styles.mailMsg}>{mailMsg}</Text> : null}
          <View style={styles.dBtns}>
            <TouchableOpacity style={styles.ghost} onPress={() => setMailOpen(false)}>
              <Text style={styles.ghostT}>Tutup</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={sendMail}>
              <Text style={styles.primaryT}>Kirim</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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
          {mailModal}
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      {paper}
      {actions}
      {mailModal}
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
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogNarrow: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  dTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4 },
  input: {
    borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 11,
    fontFamily: fonts.regular, fontSize: 14, color: colors.text, backgroundColor: colors.white, marginTop: 12,
  },
  mailMsg: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 8 },
  dBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
});
