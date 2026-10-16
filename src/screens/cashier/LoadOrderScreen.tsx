import { useEffect, useRef, useState } from 'react';import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import { useLang } from '../../lib/i18n';import type { CartItem } from './CashierScreen';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav; route?: { params?: { newOrder?: { title: string; mode: string; table?: string; items: CartItem[]; ongkir?: number };

}; };};interface Saved { id: string; badge: string; mode: string; title: string; detail: string; table?: string; items: CartItem[]; ongkir?: number; }const SEED: Saved[] = [
  {
    id: 'o1', badge: 'TA', mode: 'Take Away', title: 'Bawa Pulang · QoQi', detail: '2 item · ' + rp(33900) + ' · 13:10',
    items: [
      { id: 'p11', name: 'Sudirman Coffee', basePrice: 12900, qty: 1, modifiers: [{ name: 'Creamy Pandan', price: 7000 }], discount: 0 },
      { id: 'p9', name: 'Teh Manis Panas', basePrice: 8000, qty: 2, modifiers: [], discount: 2500 },
    ],
  },
  {
    id: 'o2', badge: 'DI', mode: 'Dine In', title: 'Dine In · Meja A5', detail: '4 item · ' + rp(87500) + ' · 12:48', table: 'A5',
    items: [
      { id: 'p2', name: 'Ayam Goreng Dada', basePrice: 15000, qty: 3, modifiers: [], discount: 2500 },
      { id: 'p7', name: 'Kopi Susu Gula Aren', basePrice: 22000, qty: 1, modifiers: [], discount: 0 },
      { id: 'p13', name: 'Cheese Cake Slice', basePrice: 32000, qty: 1, modifiers: [], discount: 0 },
    ],
  },
  {
    id: 'o3', badge: 'GF', mode: 'GOFOOD', title: 'GoFood #GO-88213', detail: '2 item · ' + rp(45800) + ' · 13:42',
    items: [
      { id: 'p10', name: 'Paket Nasi + Ayam', basePrice: 28000, qty: 1, modifiers: [], discount: 0 },
      { id: 'p8', name: 'Americano Ice', basePrice: 18000, qty: 1, modifiers: [], discount: 0 },
    ],
  },
{ id: 'o4', badge: 'GF', mode: 'GRABFOOD', title: 'GrabFood #GR-51107', detail: '1 item · ' + rp(22000) + ' · 14:05', items: [ { id: 'p7', name: 'Kopi Susu Gula Aren', basePrice: 22000, qty: 1, modifiers: [], discount: 0 }, ], }, { id: 'o5', badge: 'SF', mode: 'SHOPEEFOOD', title: 'ShopeeFood #SP-30981', detail: '1 item · ' + rp(32000) + ' · 14:20', items: [ { id: 'p13', name: 'Cheese Cake Slice', basePrice: 32000, qty: 1, modifiers: [], discount: 0 }, ], },];const FILTERS = ['Semua', 'Dine In', 'Take Away', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'];/** Peta mode simpanan ke mode kasir (dulu GOFOOD/GRABFOOD/SHOPEEFOOD jatuh ke tanpa mode). */const MODE_TO_CASHIER: Record<string, string> = { 'Dine In': 'DINE IN', 'Take Away': 'TAKE AWAY', GOFOOD: 'GOFOOD', GRABFOOD: 'GRABFOOD', SHOPEEFOOD: 'SHOPEEFOOD',};/** Order tersimpan (load_order) - muat kembali order yang disimpan dari kasir. */export default function LoadOrderScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [orders, setOrders] = useState<Saved[]>(SEED);
  const [filter, setFilter] = useState('Semua');

  const shown = orders.filter((o) => filter === 'Semua' || o.mode === filter);

  /** Order yang baru disimpan dari kasir/cart langsung masuk daftar (dulu Simpan tanpa payload). */ const appliedRef = useRef(''); useEffect(() => { const n = route?.params?.newOrder; if (!n) return; const key = JSON.stringify(n); if (appliedRef.current === key) return; appliedRef.current = key; const count = n.items.reduce((s, c) => s + c.qty, 0); const sum = n.items.reduce((s, c) => s + (c.basePrice + (c.modifiers ?? []).reduce((m, x) => m + x.price, 0)) * c.qty - (c.discount ?? 0), 0); const badge = n.mode === 'DINE IN' ? 'DI' : n.mode === 'TAKE AWAY' ? 'TA' : n.mode === 'GOFOOD' ? 'GF' : n.mode === 'GRABFOOD' ? 'GF' : n.mode === 'SHOPEEFOOD' ? 'SF' : 'OL'; const label = n.mode === 'DINE IN' ? 'Dine In' : n.mode === 'TAKE AWAY' ? 'Take Away' : n.mode; setOrders((prev) => [ { id: `saved-${Date.now()}`, badge, mode: label, title: n.title, detail: `${count} item · ${rp(sum + (n.ongkir ?? 0))}`, table: n.table, items: n.items, ongkir: n.ongkir }, ...prev, ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.newOrder]); /** Muat order ke kasir - minta konfirmasi dulu sesuai teks hint (dulu langsung tanpa payload). */
  const muat = (o: Saved) => {
    Alert.alert(t('loadConfirmTitle'), `${o.title}\n${t('loadConfirmBodyA')}`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('loadAction'),
        onPress: () =>
          navigation?.navigate('Cashier', {
            loadItems: o.items,
            ...(o.table ? { table: o.table } : {}),
             mode: MODE_TO_CASHIER[o.mode] ?? 'DINE IN', ...(o.ongkir ? { ongkir: o.ongkir } : {}),
          }),
      },
    ]);
  };

  return (
    <View style={styles.root}> <ScreenHeader title={t('loadOrderTitle')} onBack={() => navigation?.goBack()} /> <ScrollView style={styles.list} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.hint}>{t('loadOrderHint')}</Text>
      <Text style={styles.sec}>{t('loadOrderSec')}</Text>
      <Text style={styles.hint}>{t('loadOrderHint')}</Text>
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipOn]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipT, filter === f && styles.chipTOn]}>{f === 'Semua' ? t('all') : f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {shown.length === 0 && (
        <View style={styles.emptyWrap}>
          <Image
            source={require('../../../assets/images/empty_order.webp')}
            style={styles.emptyImg}
            resizeMode="contain"
          />
          <Text style={styles.empty}>{t('emptyLoadOrder')}</Text>
        </View>
      )}
      {shown.map((o) => (
        <View key={o.id} style={styles.card}>
          <View style={styles.badge}><Text style={styles.badgeT}>{o.badge}</Text></View>
          <View style={styles.info}>
            <Text style={styles.title}>{o.title}</Text>
            <Text style={styles.detail}>{o.mode} · {o.detail}</Text>
          </View>
          <TouchableOpacity style={styles.load} onPress={() => muat(o)}>
            <Text style={styles.loadT}>{t('loadAction')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setOrders((l) => l.filter((x) => x.id !== o.id))}>
            <Text style={styles.del}>{t('delete')}</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={styles.primary} onPress={() => navigation?.navigate('Cashier')}>
        <Text style={styles.primaryT}>{t('newTx')}</Text>
      </TouchableOpacity>
    </ScrollView>
  </View> );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 }, body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 12, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  emptyWrap: { alignItems: 'center', paddingVertical: 24 },
  emptyImg: { width: 120, height: 120 },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, backgroundColor: colors.card, borderRadius: 10, padding: 14, marginTop: 8, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paleBlue, alignItems: 'center', justifyContent: 'center' },
  badgeT: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy },
  info: { flex: 1 },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  detail: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  load: { backgroundColor: colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  loadT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  del: { fontFamily: fonts.semibold, fontSize: 12, color: colors.faint },
  primary: { backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },});