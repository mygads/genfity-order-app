import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp } from '../../theme';
import type { CartItem } from '../../screens/cashier/CashierScreen';

export type CartLine = Pick<CartItem, 'id' | 'name' | 'qty' | 'basePrice'>;

/**
 * CartPanel — ringkasan keranjang reusable (tablet kanan / HP bottom-sheet isi).
 * Tanpa logika hitung (total dari pemanggil totals()), hanya tampil + stepper.
 */
export default function CartPanel({
  lines,
  total,
  onInc,
  onDec,
  onCheckout,
  checkoutLabel = 'Lihat Pesanan',
}: {
  lines: CartLine[];
  total: number;
  onInc: (id: string) => void;
  onDec: (id: string) => void;
  onCheckout: () => void;
  checkoutLabel?: string;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  return (
    <View style={[styles.root, isTablet && styles.rootTablet]}>
      <FlatList
        data={lines}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.price}>{rp(item.basePrice)} × {item.qty}</Text>
            </View>
            <View style={styles.step}>
              <TouchableOpacity style={styles.btn} onPress={() => onDec(item.id)} accessibilityLabel={`Kurangi ${item.name}`}><Text style={styles.btnT}>-</Text></TouchableOpacity>
              <Text style={styles.qty}>{item.qty}</Text>
              <TouchableOpacity style={styles.btn} onPress={() => onInc(item.id)} accessibilityLabel={`Tambah ${item.name}`}><Text style={styles.btnT}>+</Text></TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Keranjang masih kosong</Text>}
      />
      <TouchableOpacity style={[styles.cta, isTablet && styles.ctaTablet]} onPress={onCheckout} disabled={lines.length === 0} accessibilityRole="button">
        <Text style={styles.ctaT}>{checkoutLabel} · {rp(total)}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line, maxHeight: 320 },
  rootTablet: { borderTopWidth: 0, borderLeftWidth: 1, borderLeftColor: colors.line, maxHeight: undefined, flex: 1 },
  list: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 },
  info: { flex: 1 },
  name: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  price: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  btnT: { fontSize: 18, color: colors.primaryDark, fontFamily: fonts.bold },
  qty: { minWidth: 24, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  empty: { textAlign: 'center', color: colors.faint, fontFamily: fonts.regular, paddingVertical: 16 },
  cta: { margin: 12, minHeight: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  ctaTablet: { minHeight: 56 },
  ctaT: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
});
