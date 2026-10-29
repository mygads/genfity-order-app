import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../../theme';

/**
 * VariantPicker — pilih Size/Warna fashion (S/M/L/XL + Hitam/Putih…).
 * Standar retail: matrix size-warna + stok per SKU. Chip ≥44dp.
 */
export default function VariantPicker({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (v: string) => void;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  if (!options || options.length === 0) return null;
  return (
    <View style={styles.root}>
      <Text style={[styles.label, isTablet && styles.labelTablet]}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => {
          const on = selected === o;
          return (
            <TouchableOpacity
              key={o}
              style={[styles.chip, isTablet && styles.chipTablet, on && styles.chipOn]}
              onPress={() => onSelect(o)}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${o}`}>
              <Text style={[styles.chipT, isTablet && styles.chipTTablet, on && styles.chipTOn]}>{o}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  label: { fontSize: 13, color: colors.navy, fontFamily: fonts.semibold },
  labelTablet: { fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minWidth: 48, minHeight: 44, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.inputBorder, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  chipTablet: { minHeight: 48, paddingHorizontal: 16 },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.paleOrange },
  chipT: { fontSize: 14, color: colors.text, fontFamily: fonts.medium },
  chipTTablet: { fontSize: 15 },
  chipTOn: { color: colors.primaryDark },
});
