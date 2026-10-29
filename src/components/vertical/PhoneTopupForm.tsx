import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../../theme';
import AppButton from '../AppButton';
import { isValidPhoneNumberID, normalizePhoneNumberID } from '../../lib/verticals';

/**
 * PhoneTopupForm — 3 langkah kaku PULSA_DIGITAL (konter Indonesia):
 * 1. Nomor tujuan (keypad numeric + auto-deteksi prefix) →
 * 2. Nominal (grid 5k/10k/25k/50k/100k + token PLN) →
 * 3. Bayar lunas (PREPAID mutlak, tanpa tempo).
 * Nomor invalid = tombol Bayar disabled + pesan merah. Tanpa Tables/Kitchen.
 */
const NOMINALS = [5000, 10000, 25000, 50000, 100000];

export default function PhoneTopupForm({ onSubmit }: { onSubmit: (phone: string, nominal: number) => void }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const [phone, setPhone] = useState('');
  const [nominal, setNominal] = useState<number | null>(null);
  const digits = useMemo(() => normalizePhoneNumberID(phone), [phone]);
  const valid = isValidPhoneNumberID(phone);
  const ready = valid && nominal !== null;
  return (
    <View style={styles.root}>
      <Text style={[styles.step, isTablet && styles.stepTablet]}>1 · Nomor tujuan</Text>
      <TextInput
        value={phone}
        onChangeText={(v) => setPhone(v.replace(/[^\d]/g, '').slice(0, 14))}
        placeholder="08xxxxxxxxxx"
        placeholderTextColor={colors.faint}
        keyboardType="number-pad"
        style={[styles.phone, isTablet && styles.phoneTablet, phone !== '' && !valid && styles.phoneBad]}
        accessibilityLabel="Nomor tujuan"
      />
      {!valid && phone !== '' ? (
        <Text style={styles.err}>Nomor HP 10–14 digit diawali 08 (contoh 0812…).</Text>
      ) : null}
      <Text style={[styles.step, isTablet && styles.stepTablet]}>2 · Nominal</Text>
      <View style={styles.grid}>
        {NOMINALS.map((n) => {
          const on = nominal === n;
          return (
            <TouchableOpacity key={n} style={[styles.nom, on && styles.nomOn]} onPress={() => setNominal(n)} accessibilityRole="button" accessibilityLabel={`Nominal ${n}`}>
              <Text style={[styles.nomT, on && styles.nomTOn]}>{(n / 1000).toString() + 'K'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.step, isTablet && styles.stepTablet]}>3 · Bayar lunas</Text>
      <AppButton title={ready ? `Bayar ${nominal}` : 'Lengkapi nomor + nominal'} size="lg" disabled={!ready} onPress={() => { if (ready && nominal !== null) onSubmit(digits, nominal); }} />
      <Text style={styles.prepaid}>Pulsa/digital wajib bayar di depan — tanpa tempo/hutang. Pastikan online: harga/stok provider dicek server.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  step: { fontSize: 13, color: colors.navy, fontFamily: fonts.semibold },
  stepTablet: { fontSize: 15 },
  phone: {
    height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: colors.inputBorder,
    backgroundColor: colors.white, paddingHorizontal: 14, fontSize: 22,
    fontFamily: 'monospace', letterSpacing: 1, color: colors.text,
  },
  phoneTablet: { height: 64, fontSize: 26 },
  phoneBad: { borderColor: colors.red },
  err: { fontSize: 12, color: colors.red, fontFamily: fonts.regular },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nom: {
    minWidth: 72, minHeight: 48, paddingHorizontal: 16, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.inputBorder, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  nomOn: { borderColor: colors.primary, backgroundColor: colors.paleOrange },
  nomT: { fontSize: 15, color: colors.text, fontFamily: fonts.semibold },
  nomTOn: { color: colors.primaryDark },
  prepaid: { fontSize: 12, color: colors.muted, fontFamily: fonts.regular, textAlign: 'center' },
});
