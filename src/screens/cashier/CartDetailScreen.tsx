import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';
import { itemTotal, unitPrice, type CartItem } from './CashierScreen';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type Props = { navigation?: Nav; route?: { params?: { items?: CartItem[]; total?: number } } };

export default function CartDetailScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [items, setItems] = useState<CartItem[]>(route?.params?.items ?? []);
  const routeTotal = route?.params?.total;

  const subtotalGross = useMemo(() => items.reduce((s, c) => s + unitPrice(c) * c.qty, 0), [items]);
  const discountTotal = useMemo(() => items.reduce((s, c) => s + c.discount, 0), [items]);
  const subtotal = subtotalGross - discountTotal;
  const service = Math.round(subtotal * 0.05);
  const pb1incl = Math.round((subtotal * 10) / 110);
  const total = subtotal + service;
  const itemCount = items.reduce((s, c) => s + c.qty, 0);

  const removeItem = (id: string) => setItems((prev) => prev.filter((c) => c.id !== id));

  const goPay = () => navigation?.navigate('Pay', { total });

  return (
    <View style={styles.root}>
      {/* Header navy */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detail Pesanan</Text>
        <Text style={styles.headerCount}>{itemCount} item</Text>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, isTablet && wideCenter]}>
        {items.map((c, idx) => (
          <View key={c.id} style={styles.row}>
            {/* Lingkaran biru nomor */}
            <View style={styles.numCircle}>
              <Text style={styles.numText}>{idx + 1}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.itemName} numberOfLines={2}>
                {c.name} x{c.qty}
              </Text>
              {/* Modifier biru */}
              {c.modifiers.map((m, i) => (
                <Text key={i} style={styles.modifier}>
                  + {m.name}
                  {m.price > 0 ? `  +${rp(m.price)}` : ''}
                </Text>
              ))}
              {c.discount > 0 && <Text style={styles.discount}>- Diskon {rp(c.discount)}</Text>}
            </View>
            {/* Harga kanan */}
            <Text style={styles.price}>{rp(itemTotal(c))}</Text>
            {/* X merah */}
            <TouchableOpacity style={styles.delBtn} onPress={() => removeItem(c.id)} hitSlop={12}>
              <Text style={styles.delText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {items.length === 0 && (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyCircle}>
              <Text style={styles.emptyIcon}>🧺</Text>
            </View>
            <Text style={styles.emptyTitle}>Keranjang masih kosong</Text>
            <Text style={styles.emptySub}>Tambah menu dari kasir untuk mulai mencatat pesanan.</Text>
            <TouchableOpacity style={styles.emptyCta} onPress={() => navigation?.navigate('Cashier')}>
              <Text style={styles.emptyCtaText}>＋ Tambah Menu</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Totals */}
        {items.length > 0 && (
          <View style={styles.totals}>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Subtotal (bruto)</Text>
              <Text style={styles.sumValue}>{rp(subtotalGross)}</Text>
            </View>
            {discountTotal > 0 && (
              <View style={styles.sumRow}>
                <Text style={styles.sumLabel}>Diskon</Text>
                <Text style={[styles.sumValue, styles.red]}>-{rp(discountTotal)}</Text>
              </View>
            )}
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Subtotal (net)</Text>
              <Text style={styles.sumValue}>{rp(subtotal)}</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Pajak PB1 (incl)</Text>
              <Text style={styles.sumValue}>{rp(pb1incl)}</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Service 5% (excl)</Text>
              <Text style={styles.sumValue}>{rp(service)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{rp(total)}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Simpan / Cetak / Bayar — sembunyi saat keranjang 0, ganti CTA tambah menu */}
      <View style={styles.footer}>
        {routeTotal !== undefined && routeTotal !== total && items.length > 0 && (
          <Text style={styles.footerNote}>
            Total diperbarui dari {rp(routeTotal)} → {rp(total)} setelah perubahan item
          </Text>
        )}
        {items.length === 0 ? (
          <TouchableOpacity style={styles.payBtn} onPress={() => navigation?.navigate('Cashier')}>
            <Text style={styles.payText}>＋ Tambah Menu ›</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.footerRow}>
              <TouchableOpacity style={styles.saveBtn} onPress={() => navigation?.navigate('SavedTransactions')}>
                <Text style={styles.saveText}>🧺 Simpan</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.printBtn} onPress={() => navigation?.navigate('Receipt', { total })}>
                <Text style={styles.printText}>🖨 Cetak Struk</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.payBtn} onPress={goPay}>
              <Text style={styles.payText}>Bayar | {rp(total)} ›</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
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
    paddingVertical: 12,
    gap: 12,
  },
  back: { color: colors.white, fontSize: 26, fontFamily: fonts.bold },
  headerTitle: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  headerCount: { color: colors.navyTint, fontFamily: fonts.regular, fontSize: 12 },
  list: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  numCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  numText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  rowBody: { flex: 1 },
  itemName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  modifier: { fontFamily: fonts.regular, fontSize: 12, color: colors.blue, marginTop: 2 },
  discount: { fontFamily: fonts.regular, fontSize: 12, color: colors.red, marginTop: 2 },
  price: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginLeft: 8, marginTop: 2 },
  delBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  delText: { color: colors.red, fontSize: 12, fontFamily: fonts.bold },
  empty: { textAlign: 'center', marginTop: 48, fontFamily: fonts.regular, fontSize: 14, color: colors.faint },
  emptyWrap: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24 },
  emptyCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.paleOrange,
    borderWidth: 1.5,
    borderColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: { fontSize: 38 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 14 },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'center' },
  emptyCta: {
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 13,
    marginTop: 16,
  },
  emptyCtaText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  totals: {
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  sumLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  sumValue: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  red: { color: colors.red },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  totalLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  totalValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.orange },
  footer: { backgroundColor: colors.white, padding: 12, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  footerNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.amberDark, textAlign: 'center' },
  footerRow: { flexDirection: 'row', gap: 8 },
  saveBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.orange,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  saveText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orange },
  printBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  printText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  payBtn: {
    backgroundColor: colors.blueDark,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  payDisabled: { opacity: 0.45 },
  payText: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
});
