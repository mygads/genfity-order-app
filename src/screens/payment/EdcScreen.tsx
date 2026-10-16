import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { total?: number } } };

type Phase = 'waiting' | 'error' | 'approval';

const BANKS = ['BCA', 'Mandiri', 'BRI'];
const TERMINALS = ['EDC-01', 'EDC-02'];

export default function EdcScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const total = route?.params?.total ?? 33900;
  const [phase, setPhase] = useState<Phase>('waiting');
  const [secs, setSecs] = useState(60);
  const [approval, setApproval] = useState('');
  const [bank, setBank] = useState(BANKS[0]);
  const [terminal, setTerminal] = useState(TERMINALS[0]);
  const [cardNo, setCardNo] = useState('');

  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = setTimeout(() => {
      if (secs <= 1) {
        setSecs(0);
        setPhase('error');
      } else {
        setSecs(secs - 1);
      }
    }, 1000);

    return () => clearTimeout(t);
  }, [phase, secs]);

  const retry = () => { setSecs(60); setPhase('waiting'); };
  const canSave = approval.length === 6;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()}>
          <Text style={styles.back}>‹ Batal</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>EDC</Text>
        <View style={{ width: 70 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.sub}>Non-Tunai · Kartu Debit/Kredit</Text>
      <Text style={styles.steps}>1. Input nominal di EDC &nbsp; 2. Pelanggan tap/insert kartu &nbsp; 3. Masukkan kode persetujuan</Text>
      <View style={[isTablet && styles.split]}>
        <View style={[styles.main, isTablet && styles.mainTablet]}>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Pembayaran EDC · {bank} · {terminal}</Text>
            <Text style={styles.heroValue}>{rp(total)}</Text>
            <Text style={styles.heroSub}>Ikuti instruksi pada mesin EDC yang terhubung.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Mesin & Bank</Text>
            <Text style={styles.fieldLabel}>Bank penerbit</Text>
            <View style={styles.chips}>
              {BANKS.map((b) => (
                <TouchableOpacity
                  key={b}
                  style={[styles.chip, bank === b && styles.chipOn]}
                  onPress={() => setBank(b)}>
                  <Text style={[styles.chipT, bank === b && styles.chipTOn]}>{b}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Terminal</Text>
            <View style={styles.chips}>
              {TERMINALS.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, terminal === t && styles.chipOn]}
                  onPress={() => setTerminal(t)}>
                  <Text style={[styles.chipT, terminal === t && styles.chipTOn]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Input Nominal</Text>
            <Text style={styles.big}>{rp(total)}</Text>
            <Text style={styles.meta}>Gesek / Insert · Bank / Mesin {bank} · {terminal}</Text>
            <Text style={styles.fieldLabel}>4 digit terakhir kartu (opsional)</Text>
            <TextInput
              style={styles.inputSmall}
              value={cardNo}
              onChangeText={(t) => setCardNo(t.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="Contoh: 4582"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              maxLength={4}
            />
            {cardNo.length === 4 && (
              <Text style={styles.meta}>Nomor Kartu **** **** **** {cardNo} · {bank}</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Status EDC</Text>
            {phase === 'waiting' && <Text style={styles.wait}>Menunggu kartu… Batas waktu {secs} detik.</Text>}
            {phase === 'error' && <Text style={styles.err}>Mesin EDC tidak merespons — periksa koneksi lalu coba lagi.</Text>}
            {phase === 'error' && (
              <TouchableOpacity style={styles.primary} onPress={retry}>
                <Text style={styles.primaryT}>Coba Lagi</Text>
              </TouchableOpacity>
            )}
            {phase === 'waiting' && (
              <TouchableOpacity style={styles.ghost} onPress={() => setPhase('approval')}>
                <Text style={styles.ghostT}>Kartu terbaca — input kode persetujuan ›</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {isTablet && (
          <View style={styles.side}>
            <Text style={styles.sideTitle}>Ringkasan</Text>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>Nominal</Text>
              <Text style={styles.sideValue}>{rp(total)}</Text>
            </View>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>Mesin</Text>
              <Text style={styles.sideValue}>{bank} · {terminal}</Text>
            </View>
            <Text style={styles.sideHint}>Ikuti instruksi pada mesin EDC yang terhubung.</Text>
          </View>
        )}
      </View>

      <View style={[styles.card, isTablet && styles.approvalTablet]}>
        <Text style={styles.cardTitle}>Kode Persetujuan (6 digit dari struk EDC)</Text>
        <Text style={styles.meta}>Contoh struk persetujuan · 482913</Text>
        <TextInput style={styles.input} value={approval} onChangeText={(t) => setApproval(t.replace(/[^0-9]/g, '').slice(0, 6))} placeholder="482913" placeholderTextColor={colors.faint} keyboardType="numeric" maxLength={6} />
        <TouchableOpacity
          style={[styles.primary, !canSave && styles.disabled]}
          disabled={!canSave}
          onPress={() => navigation?.navigate('Success', { total, method: 'EDC BCA' })}>
          <Text style={styles.primaryT}>Simpan Pembayaran</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation?.navigate('Pay', { total })}>
          <Text style={styles.link}>Batal & ganti metode bayar ›</Text>
        </TouchableOpacity>
      </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 48,
    paddingBottom: 12,
  },
  back: { color: colors.white, fontFamily: fonts.medium, fontSize: 14, width: 70 },
  headerTitle: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  body: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  sub: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  steps: { fontFamily: fonts.regular, fontSize: 12, color: colors.navy, textAlign: 'center', marginTop: 4 },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18, marginTop: 10 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.navyTint },
  heroValue: { fontFamily: fonts.bold, fontSize: 28, color: colors.white, marginTop: 6 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  big: { fontFamily: fonts.bold, fontSize: 22, color: colors.navy, marginTop: 6 },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.faint, marginTop: 10, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  wait: { fontFamily: fonts.medium, fontSize: 13, color: colors.orangeDark, marginTop: 8 },
  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginTop: 8 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, fontFamily: fonts.bold, fontSize: 20, color: colors.text, letterSpacing: 6, textAlign: 'center', marginTop: 10 },
  inputSmall: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10, fontFamily: fonts.bold, fontSize: 15, color: colors.text, letterSpacing: 3, textAlign: 'center', marginTop: 4 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 },
  ghostT: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy },
  linkBtn: { marginTop: 12, alignItems: 'center' },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  split: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  main: { flex: 1 },
  mainTablet: { flex: 1.6 },
  side: { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 14, marginTop: 10 },
  sideTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  sideRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  sideLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  sideValue: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
  sideHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 8 },
  approvalTablet: { maxWidth: 560 },
});
