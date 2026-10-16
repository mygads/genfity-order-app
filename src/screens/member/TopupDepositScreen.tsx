import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, rpNum, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = {
  navigation?: Nav;
  route?: { params?: { memberId?: string; nama?: string; saldo?: number } };
};

const QUICK = [50000, 100000, 200000, 500000, 1000000];
const METHODS = ['Tunai', 'QRIS', 'EDC', 'Transfer'];

export default function TopupDepositScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const memberId = route?.params?.memberId ?? 'M001';
  const nama = route?.params?.nama ?? 'Budi Santoso';
  const saldoAwal = route?.params?.saldo ?? 150000;

  const [nominal, setNominal] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [catatan, setCatatan] = useState('');
  const [done, setDone] = useState(false);

  const nominalNum = Number(nominal.replace(/\D/g, '')) || 0;
  const ready = nominalNum >= 10000 && method !== '';
  const saldoAkhir = saldoAwal + nominalNum;

  const submit = () => {
    if (!ready) return;
    setDone(true);
  };

  if (done) {
    return (
      <View style={s.root}>
        <View style={[s.body, isTablet && wideCenter]}>
          <View style={s.checkCircle}><Text style={s.checkMark}>✓</Text></View>
          <Text style={s.title}>Top Up Berhasil</Text>
          <Text style={s.sub}>{nama} • {memberId}</Text>
          <View style={s.card}>
            <Row label="Nominal top up" value={rp(nominalNum)} />
            <Row label="Metode bayar" value={method} />
            <View style={s.divider} />
            <Row label="Saldo awal" value={rp(saldoAwal)} />
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Saldo akhir</Text>
              <Text style={s.totalValue}>{rp(saldoAkhir)}</Text>
            </View>
          </View>
          <TouchableOpacity style={s.primary} onPress={() => navigation?.navigate('Member')}>
            <Text style={s.primaryT}>Kembali ke Member</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghost} onPress={() => navigation?.navigate('Cashier')}>
            <Text style={s.ghostT}>Order Baru</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Top Up Deposit</Text>
        <View style={s.backBtn} />
      </View>
      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.memberBar}>
          <Text style={s.memberName}>{nama}</Text>
          <Text style={s.memberMeta}>{memberId} • Saldo {rp(saldoAwal)}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Nominal Cepat</Text>
          <View style={s.chips}>
            {QUICK.map((n) => (
              <TouchableOpacity
                key={n}
                style={[s.chip, nominalNum === n && s.chipOn]}
                onPress={() => setNominal(String(n))}>
                <Text style={[s.chipTxt, nominalNum === n && s.chipTxtOn]}>{rpNum(n)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.label}>Nominal custom (min. Rp 10.000)</Text>
          <View style={s.amountBox}>
            <Text style={s.rpPrefix}>Rp</Text>
            <TextInput
              style={s.amountInput}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.faint}
              value={nominalNum ? rpNum(nominalNum) : ''}
              onChangeText={(t) => setNominal(t.replace(/\D/g, '').slice(0, 12))}
            />
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Metode Bayar</Text>
          <View style={s.chips}>
            {METHODS.map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.chip, method === m && s.chipOn]}
                onPress={() => setMethod(m)}>
                <Text style={[s.chipTxt, method === m && s.chipTxtOn]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.label}>Catatan (opsional)</Text>
          <TextInput
            style={s.noteInput}
            placeholder="Catatan top up"
            placeholderTextColor={colors.faint}
            value={catatan}
            onChangeText={setCatatan}
          />
        </View>

        <View style={s.card}>
          <Row label="Saldo awal" value={rp(saldoAwal)} />
          <Row label="Nominal top up" value={rp(nominalNum)} />
          <View style={s.divider} />
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Saldo akhir</Text>
            <Text style={s.totalValue}>{rp(saldoAkhir)}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[s.primary, !ready && s.disabled]}
          disabled={!ready}
          onPress={submit}>
          <Text style={s.primaryT}>Bayar & Top Up • {rp(nominalNum)}</Text>
        </TouchableOpacity>
        {!ready && (
          <Text style={s.hint}>Nominal minimal Rp 10.000 dan metode bayar wajib dipilih.</Text>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  backBtn: { width: 32, alignItems: 'center' },
  backTxt: { color: colors.white, fontSize: 28, fontFamily: fonts.medium },
  headerTitle: { color: colors.white, fontSize: 17, fontFamily: fonts.bold },
  body: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  memberBar: { backgroundColor: colors.navy, borderRadius: 12, padding: 16 },
  memberName: { fontSize: 17, fontFamily: fonts.bold, color: colors.white },
  memberMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.navyTint, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginTop: 12 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  label: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  chip: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, marginBottom: 8, backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipTxt: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  chipTxtOn: { color: colors.orangeDark },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.orange,
    borderRadius: 10, paddingHorizontal: 14, backgroundColor: colors.paleOrange,
  },
  rpPrefix: { fontSize: 18, fontFamily: fonts.bold, color: colors.orange },
  amountInput: { flex: 1, fontSize: 24, fontFamily: fonts.bold, color: colors.text, paddingVertical: 12, marginLeft: 8, textAlign: 'right' },
  noteInput: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12,
    fontSize: 14, fontFamily: fonts.regular, color: colors.text,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rowLabel: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  rowValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  totalValue: { fontSize: 18, fontFamily: fonts.bold, color: colors.navy },
  primary: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  disabled: { opacity: 0.5 },
  primaryT: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  ghost: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  ghostT: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, textAlign: 'center', marginTop: 8 },
  checkCircle: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', marginTop: 32, alignSelf: 'center',
  },
  checkMark: { color: colors.white, fontSize: 44, fontFamily: fonts.bold },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.text, marginTop: 14, textAlign: 'center' },
  sub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
});
