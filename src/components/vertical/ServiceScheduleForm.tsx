import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../../theme';
import AppButton from '../AppButton';

/**
 * ServiceScheduleForm — jasa wajib jadwal YYYY-MM-DD + HH:MM (format BE
 * serviceDate/serviceTime) + teknisi + DP/pelunasan. Tanpa jadwal tak bisa
 * ke Pay (mencegah 400 serviceDate/serviceTime).
 */
export default function ServiceScheduleForm({
  technicians,
  onSubmit,
}: {
  technicians: string[];
  onSubmit: (p: { date: string; time: string; technician: string; dp: number }) => void;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [tech, setTech] = useState<string | null>(null);
  const [dp, setDp] = useState('50');
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date.trim());
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim());
  const ready = dateOk && timeOk && !!tech;
  return (
    <View style={styles.root}>
      <Text style={[styles.step, isTablet && styles.stepTablet]}>Jadwal layanan (wajib)</Text>
      <View style={styles.row}>
        <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.faint} style={[styles.box, !dateOk && date !== '' && styles.bad]} accessibilityLabel="Tanggal layanan" />
        <TextInput value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={colors.faint} style={[styles.box, !timeOk && time !== '' && styles.bad]} accessibilityLabel="Jam layanan" />
      </View>
      {!dateOk && date !== '' ? <Text style={styles.err}>Format tanggal YYYY-MM-DD.</Text> : null}
      {!timeOk && time !== '' ? <Text style={styles.err}>Format jam HH:MM (24 jam).</Text> : null}
      <Text style={[styles.step, isTablet && styles.stepTablet]}>Teknisi</Text>
      <View style={styles.chips}>
        {(technicians.length > 0 ? technicians : ['Kasir']).map((o) => (
          <TouchableOpacity key={o} style={[styles.chip, tech === o && styles.chipOn]} onPress={() => setTech(o)} accessibilityRole="button" accessibilityLabel={`Teknisi ${o}`}>
            <Text style={[styles.chipT, tech === o && styles.chipTOn]}>{o}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[styles.step, isTablet && styles.stepTablet]}>DP % (default 50)</Text>
      <TextInput value={dp} onChangeText={(v) => setDp(v.replace(/[^\d]/g, '').slice(0, 3))} keyboardType="number-pad" style={styles.box} accessibilityLabel="DP persen" />
      <AppButton title={ready ? 'Lanjut bayar DP' : 'Lengkapi jadwal + teknisi'} size="lg" disabled={!ready} onPress={() => { if (ready && tech) onSubmit({ date: date.trim(), time: time.trim(), technician: tech, dp: Math.min(100, Math.max(0, Number(dp) || 0)) }); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  step: { fontSize: 13, color: colors.navy, fontFamily: fonts.semibold },
  stepTablet: { fontSize: 15 },
  row: { flexDirection: 'row', gap: 8 },
  box: {
    flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.inputBorder,
    backgroundColor: colors.white, paddingHorizontal: 12, fontSize: 15, color: colors.text, fontFamily: fonts.regular,
  },
  bad: { borderColor: colors.red },
  err: { fontSize: 12, color: colors.red, fontFamily: fonts.regular },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, borderColor: colors.inputBorder, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.paleOrange },
  chipT: { fontSize: 14, color: colors.text, fontFamily: fonts.medium },
  chipTOn: { color: colors.primaryDark },
});
