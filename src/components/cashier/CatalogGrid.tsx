import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fonts, rp } from '../../theme';

export type CatalogItem = { id: string; name: string; price: number; category: string; fav?: boolean; soldOut?: boolean; low?: boolean; unitLabel?: string; qty?: number };

/**
 * CatalogGrid — grid katalog reusable (fashion/retail/resto sama).
 * Sentuh ≥44dp, harga grouping rp(), tanpa logika vertikal (murni tampil).
 * Dipakai bertahap untuk pecah CashierScreen god-file (Fase 2).
 */
export default function CatalogGrid({
  items,
  onAdd,
  numCols = 3,
}: {
  items: CatalogItem[];
  onAdd: (p: CatalogItem) => void;
  numCols?: number;
}) {
  return (
    <FlatList
      data={items}
      key={`cat-${numCols}`}
      numColumns={numCols}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <TouchableOpacity onPress={() => onAdd(item)} activeOpacity={0.7} disabled={!!item.soldOut} accessibilityRole="button" accessibilityLabel={`Tambah ${item.name}`}>
            <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
            {item.low && !item.soldOut ? (<Text style={styles.low}>Stok menipis{item.qty != null ? ` · sisa ${item.qty}` : ''}</Text>) : null}
            <View style={styles.foot}>
              <Text style={styles.price}>{rp(item.price)}{item.unitLabel ? ` / ${item.unitLabel}` : ''}</Text>
              <View style={styles.add}>
                <Text style={styles.addT}>+</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>Belum ada produk</Text>}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 8 },
  card: { flex: 1, margin: 4, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 10, minHeight: 96 },
  name: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, minHeight: 38 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  price: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primaryDark },
  add: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  addT: { fontSize: 20, color: colors.white, fontFamily: fonts.bold },
  empty: { textAlign: 'center', marginTop: 24, color: colors.faint, fontFamily: fonts.regular },
  low: { fontFamily: fonts.semibold, fontSize: 11, color: colors.amberDark, backgroundColor: colors.paleAmber, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 4, overflow: 'hidden' },
});
