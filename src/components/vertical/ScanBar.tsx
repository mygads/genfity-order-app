import React, { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../../theme';

/**
 * ScanBar — reusable search + scan kasir (retail/grocery: barcode/SKU/nama).
 * Best practice POS modern: fast product search by name, barcode, or category.
 * Target sentuh ≥44dp; tablet scan dominan.
 */
export default function ScanBar({
  value,
  onChange,
  onScan,
  placeholder = 'Scan barcode / cari SKU / nama…',
}: {
  value: string;
  onChange: (v: string) => void;
  onScan?: () => void;
  placeholder?: string;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.row, isTablet && styles.rowTablet]}>
      <View style={[styles.box, focused && styles.boxFocus, isTablet && styles.boxTablet]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          style={[styles.input, isTablet && styles.inputTablet]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Cari produk"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
      {onScan ? (
        <TouchableOpacity
          style={[styles.scan, isTablet && styles.scanTablet]}
          onPress={onScan}
          accessibilityRole="button"
          accessibilityLabel="Scan barcode">
          {/* glyph scan: bingkai + garis, tanpa aset baru */}
          <View style={styles.scanIcon}>
            <View style={styles.scanLine} />
          </View>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowTablet: { gap: 10 },
  box: {
    flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5,
    borderColor: colors.inputBorder, backgroundColor: colors.white,
    paddingHorizontal: 12, justifyContent: 'center',
  },
  boxTablet: { height: 56 },
  boxFocus: { borderColor: colors.focus },
  input: { fontSize: 15, color: colors.text, fontFamily: fonts.regular, padding: 0 },
  inputTablet: { fontSize: 17 },
  scan: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  scanTablet: { width: 56, height: 56 },
  scanIcon: { width: 22, height: 22, borderWidth: 2, borderColor: colors.white, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  scanLine: { width: 14, height: 2, backgroundColor: colors.white, borderRadius: 1 },
});
