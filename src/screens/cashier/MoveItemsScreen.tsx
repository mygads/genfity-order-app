import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { from?: string } } };

type MoveItem = { id: string; name: string; qty: number; price: number };

const SOURCE: Record<string, MoveItem[]> = {
  'A-03': [
    { id: 'm1', name: 'Sudirman Coffee', qty: 2, price: 12900 },
    { id: 'm2', name: 'Lele goreng kremes', qty: 2, price: 15000 },
    { id: 'm3', name: 'Es Teh Manis', qty: 1, price: 8000 },
  ],
  'B-01': [
    { id: 'm4', name: 'Ayam Geprek', qty: 1, price: 18000 },
    { id: 'm5', name: 'Jus Alpukat', qty: 1, price: 15000 },
  ],
};

const DESTS = ['A-05 (kosong)', 'B-02 (kosong)', 'C-01 (kosong)', 'B-01 (terisi)'];

/**
 * Pindah Item (move_items) — pilih sumber → pilih item → pilih tujuan.
 * Daftarkan route: MoveItems.
 */
export default function MoveItemsScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const tables = useMemo(() => Object.keys(SOURCE), []);
  const [from, setFrom] = useState(route?.params?.from ?? tables[0] ?? 'A-03');
  // qty yang dipilih untuk dipindah per item (mendukung pindah sebagian, mis. 2× pindah 1).
  const [pickedQty, setPickedQty] = useState<Record<string, number>>({});
  const [to, setTo] = useState(DESTS[0] as string);
  const [movedQty, setMovedQty] = useState<Record<string, number>>({});
  const [doneMsg, setDoneMsg] = useState('');

  const sourceItems = SOURCE[from] ?? [];
  const remaining = sourceItems
    .map((it) => ({ ...it, left: it.qty - (movedQty[it.id] ?? 0) }))
    .filter((it) => it.left > 0);
  const pickedItems = remaining
    .filter((it) => (pickedQty[it.id] ?? 0) > 0)
    .map((it) => ({ ...it, move: Math.min(pickedQty[it.id] ?? 0, it.left) }));
  const pickedTotal = pickedItems.reduce((s, it) => s + it.move * it.price, 0);
  const pickedCount = pickedItems.reduce((s, it) => s + it.move, 0);

  const toggle = (id: string) =>
    setPickedQty((m) => {
      if ((m[id] ?? 0) > 0) {
        const next = { ...m };
        delete next[id];
        return next;
      }
      const it = remaining.find((x) => x.id === id);
      return { ...m, [id]: it?.left ?? 1 };
    });

  const stepMoveQty = (id: string, d: number) =>
    setPickedQty((m) => {
      const it = remaining.find((x) => x.id === id);
      if (!it) return m;
      return { ...m, [id]: Math.min(it.left, Math.max(1, (m[id] ?? 1) + d)) };
    });

  const destOccupied = to.includes('(terisi)');

  const move = () => {
    if (pickedItems.length === 0) return;
    setMovedQty((m) => {
      const next = { ...m };
      for (const it of pickedItems) next[it.id] = (next[it.id] ?? 0) + it.move;
      return next;
    });
    setDoneMsg(
      `${pickedCount} pcs (${rp(pickedTotal)}) dipindahkan ${from} → ${to}${destOccupied ? ' — digabung ke bill yang sudah ada' : ''}.`,
    );
    setPickedQty({});
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pindah Item</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <Text style={styles.step}>1 · Pilih meja sumber</Text>
        <View style={styles.chips}>
          {tables.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, from === t && styles.chipOn]}
              onPress={() => { setFrom(t); setPickedQty({}); }}>
              <Text style={[styles.chipT, from === t && styles.chipTOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.step}>2 · Pilih item dari {from}</Text>
        {remaining.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Image
              source={require('../../../assets/images/empty_order.webp')}
              style={styles.emptyImg}
              resizeMode="contain"
            />
            <Text style={styles.emptyT}>Semua item {from} sudah dipindahkan.</Text>
          </View>
        ) : (
          remaining.map((it) => {
            const sel = pickedQty[it.id] ?? 0;
            const on = sel > 0;
            return (
              <TouchableOpacity
                key={it.id}
                style={[styles.itemRow, on && styles.itemOn]}
                onPress={() => toggle(it.id)}>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Text style={styles.checkT}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.left}× {it.name}</Text>
                  <Text style={styles.itemPrice}>{rp(it.left * it.price)}</Text>
                </View>
                {on && (
                  <View style={styles.qtyRow}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => stepMoveQty(it.id, -1)}>
                      <Text style={styles.qtyT}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyN}>{sel}</Text>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => stepMoveQty(it.id, 1)}>
                      <Text style={styles.qtyT}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}

        <Text style={styles.step}>3 · Pilih meja tujuan</Text>
        <View style={styles.chips}>
          {DESTS.map((t) => (
            <TouchableOpacity key={t} style={[styles.chip, to === t && styles.chipOn]} onPress={() => setTo(t)}>
              <Text style={[styles.chipT, to === t && styles.chipTOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.summary}>
          <Text style={styles.sumTitle}>Ringkasan pindah</Text>
          <Text style={styles.sumLine}>
            {pickedItems.length === 0
              ? 'Belum ada item dipilih.'
              : `${pickedCount} pcs · ${rp(pickedTotal)} · ${from} → ${to}${destOccupied ? ' (gabung)' : ''}`}
          </Text>
          {doneMsg ? <Text style={styles.done}>{doneMsg}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.primary, pickedItems.length === 0 && styles.off]}
          disabled={pickedItems.length === 0}
          onPress={move}>
          <Text style={styles.primaryT}>Pindahkan Item ›</Text>
        </TouchableOpacity>
        <View style={styles.links}>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}>
            <Text style={styles.link}>Lihat Denah Meja ›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Cashier')}>
            <Text style={styles.link}>Buka di Kasir ›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.navy, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  back: { color: colors.white, fontSize: 26, fontFamily: fonts.bold },
  headerTitle: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 16, textAlign: 'center' },
  body: { padding: 16, paddingBottom: 40 },
  step: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy, marginTop: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1.5, borderColor: colors.line },
  itemOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  checkOn: { borderColor: colors.orange, backgroundColor: colors.orange },
  checkT: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  itemName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  itemPrice: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.orange, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  qtyT: { color: colors.orangeDark, fontFamily: fonts.bold, fontSize: 15 },
  qtyN: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, minWidth: 20, textAlign: 'center' },
  emptyWrap: { alignItems: 'center', paddingVertical: 20 },
  emptyImg: { width: 110, height: 110 },
  emptyT: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 8 },
  summary: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: colors.line },
  sumTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  sumLine: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, marginTop: 4 },
  done: { fontFamily: fonts.semibold, fontSize: 12, color: colors.greenDark, marginTop: 6 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  off: { opacity: 0.45 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
});
