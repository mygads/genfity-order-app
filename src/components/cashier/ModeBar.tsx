import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../../theme';
import { modeDisplayLabel } from '../../lib/posModes';

/**
 * ModeBar — pemilih kanal order per vertikal (reusable, konsisten tema).
 * Daftar mode berasal dari posModesForVertical (kanon BE), bukan hardcode.
 * Target sentuh ≥44dp; tablet 48dp. Dipakai CashierScreen (wide + phone).
 */
export default function ModeBar({
  modes,
  active,
  onPick,
}: {
  modes: string[];
  active: string;
  onPick: (m: string) => void;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  return (
    <View style={styles.root}>
      {modes.map((m) => {
        const on = m === active;
        return (
          <TouchableOpacity
            key={m}
            style={[styles.chip, isTablet && styles.chipTablet, on && styles.chipOn]}
            onPress={() => onPick(m)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Mode ${modeDisplayLabel(m)}`}>
            <Text style={[styles.chipT, isTablet && styles.chipTTablet, on && styles.chipTOn]}>{modeDisplayLabel(m)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chip: {
    minHeight: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1.5,
    borderColor: colors.inputBorder, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  chipTablet: { minHeight: 48 },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.paleOrange },
  chipT: { fontSize: 14, color: colors.text, fontFamily: fonts.semibold },
  chipTTablet: { fontSize: 15 },
  chipTOn: { color: colors.primaryDark },
});
