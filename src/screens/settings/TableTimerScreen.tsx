import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type StartMode = 'duduk' | 'order';

interface TableTimer {
  id: string;
  elapsed: number;
  limit: number;
}

const DEFAULT_TABLES: TableTimer[] = [
  { id: 'A-01', elapsed: 42, limit: 90 },
  { id: 'A-04', elapsed: 85, limit: 90 },
  { id: 'B-03', elapsed: 20, limit: 90 },
  { id: 'VIP-2', elapsed: 120, limit: 120 },
];

export default function TableTimerScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [enabled, setEnabled] = useState(true);
  const [limit, setLimit] = useState('90');
  const [warnBefore, setWarnBefore] = useState('10');
  const [startMode, setStartMode] = useState<StartMode>('duduk');
  const [autoExtend, setAutoExtend] = useState(false);
  const [tables, setTables] = useState<TableTimer[]>(DEFAULT_TABLES);

  const lim = Math.max(1, Number(limit) || 90);
  const warn = Math.max(0, Number(warnBefore) || 0);

  const reset = (id: string) =>
    setTables((ts) => ts.map((t) => (t.id === id ? { ...t, elapsed: 0, limit: lim } : t)));

  const extend = (id: string, mins: number) =>
    setTables((ts) => ts.map((t) => (t.id === id ? { ...t, limit: t.limit + mins } : t)));

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Timer Meja</Text>
        <Text style={styles.headerSub}>Batas waktu duduk + peringatan sebelum habis</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={styles.rowLeft}>
            <Text style={styles.cardTitle}>Aktifkan timer meja</Text>
            <Text style={styles.cardSub}>Timer berjalan {startMode === 'duduk' ? 'sejak pelanggan duduk' : 'sejak order pertama'}.</Text>
          </View>
          <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <Text style={styles.fieldLabel}>Batas waktu (menit)</Text>
        <TextInput style={styles.input} value={limit} onChangeText={setLimit} keyboardType="numeric" placeholder="90" placeholderTextColor={colors.faint} />
        <Text style={styles.fieldLabel}>Peringatkan sebelum habis (menit)</Text>
        <TextInput style={styles.input} value={warnBefore} onChangeText={setWarnBefore} keyboardType="numeric" placeholder="10" placeholderTextColor={colors.faint} />
        <Text style={styles.fieldLabel}>Timer mulai saat</Text>
        <View style={styles.chipRow}>
          {(['duduk', 'order'] as StartMode[]).map((m) => (
            <Pressable key={m} onPress={() => setStartMode(m)} style={[styles.chip, startMode === m && styles.chipActive]}>
              <Text style={[styles.chipText, startMode === m && styles.chipTextActive]}>
                {m === 'duduk' ? 'Pelanggan duduk' : 'Order pertama'}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Perpanjang otomatis bila tambah order</Text>
          <Switch value={autoExtend} onValueChange={setAutoExtend} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
      </View>

      <Text style={styles.groupLabel}>Timer Berjalan</Text>
      {tables.map((t) => {
        const remain = t.limit - t.elapsed;
        const danger = enabled && remain <= warn;
        const over = enabled && remain < 0;
        return (
          <View key={t.id} style={[styles.card, danger && styles.cardWarn, over && styles.cardOver]}>
            <View style={styles.timerTop}>
              <Text style={styles.timerId}>Meja {t.id}</Text>
              <Text style={[styles.timerState, over ? styles.over : danger ? styles.warn : styles.ok]}>
                {over ? `Lewat ${-remain} mnt` : `Sisa ${remain} mnt`}
              </Text>
            </View>
            <Text style={styles.timerSub}>Duduk {t.elapsed} mnt · batas {t.limit} mnt</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, Math.round((t.elapsed / t.limit) * 100))}%`, backgroundColor: over ? colors.red : danger ? colors.orange : colors.green }]} />
            </View>
            <View style={styles.timerBtns}>
              <Pressable style={styles.btnGhost} onPress={() => reset(t.id)}>
                <Text style={styles.btnGhostText}>Reset</Text>
              </Pressable>
              <Pressable style={styles.btnGhost} onPress={() => extend(t.id, 15)}>
                <Text style={styles.btnGhostText}>+15 mnt</Text>
              </Pressable>
              <Pressable style={styles.btnGhost} onPress={() => extend(t.id, 30)}>
                <Text style={styles.btnGhostText}>+30 mnt</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      <Text style={styles.foot}>Peringatan muncul {warn} menit sebelum batas (mock in-memory).</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },
  header: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 16, paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  groupLabel: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginTop: 18, marginBottom: 2, paddingHorizontal: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardWarn: { borderColor: colors.orange },
  cardOver: { borderColor: colors.red },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  rowLeft: { flex: 1, paddingRight: 10 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  fieldLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted, marginTop: 10 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.white,
    marginTop: 6,
  },
  chipRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  chip: { borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  chipTextActive: { color: colors.white },
  timerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timerId: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  timerState: { fontFamily: fonts.bold, fontSize: 13 },
  ok: { color: colors.greenDark },
  warn: { color: colors.orangeDark },
  over: { color: colors.red },
  timerSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.bg, marginTop: 8, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  timerBtns: { flexDirection: 'row', gap: 6, marginTop: 10 },
  btnGhost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 9, alignItems: 'center' },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14 },
});
