import { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, fonts } from '../../theme';
import { EXTRA_METHODS, type ExtraMethodId } from '../../lib/payments';
import { attemptsLeft, authorizeSupervisor } from '../../lib/supervisor';

/**
 * Metode pembayaran lanjutan: transfer, deposit member, kompliment,
 * non-penjualan. Dua terakhir wajib otorisasi supervisor (fail-closed).
 */
export default function ExtraPaySection({ onDone }: { onDone: (methodLabel: string) => void }) {
  const [authFor, setAuthFor] = useState<ExtraMethodId | null>(null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const tap = (id: ExtraMethodId) => {
    const m = EXTRA_METHODS.find((x) => x.id === id);
    if (!m) return;
    if (m.needsAuth) {
      setAuthFor(id);
      setPin('');
      setMsg('');
      return;
    }
    onDone(m.label);
  };

  const approve = async () => {
    if (!authFor || busy) return;
    setBusy(true);
    setMsg('Meminta persetujuan…');
    const r = await authorizeSupervisor(pin);
    setBusy(false);
    if (!r.ok) {
      setMsg(`${r.message} (sisa ${attemptsLeft()}x)`);
      return;
    }
    const m = EXTRA_METHODS.find((x) => x.id === authFor);
    setAuthFor(null);
    if (m) onDone(m.label);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Metode Lainnya</Text>
      <Text style={styles.hint}>Transfer dikonfirmasi manual via mutasi bank. Kompliment & Non-Penjualan tercatat atas nama penyetuju.</Text>
      <View style={styles.grid}>
        {EXTRA_METHODS.map((m) => (
          <TouchableOpacity key={m.id} style={styles.card} onPress={() => tap(m.id)}>
            <Text style={styles.cardT}>{m.label}</Text>
            <Text style={styles.cardS}>{m.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Modal visible={authFor !== null} animationType="fade" transparent>
        <View style={styles.wrap}>
          <View style={[styles.dialog, styles.dialogNarrow]}>
            <Text style={styles.dTitle}>Persetujuan Supervisor</Text>
            <Text style={styles.dSub}>Aksi ini dicatat atas nama penyetuju. PIN tidak disimpan di perangkat.</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              maxLength={6}
              secureTextEntry
              placeholder="PIN supervisor (6 digit)"
              placeholderTextColor={colors.faint}
              value={pin}
              onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
            />
            {msg ? <Text style={styles.msg}>{msg}</Text> : null}
            <View style={styles.btns}>
              <TouchableOpacity style={styles.ghost} onPress={() => setAuthFor(null)} disabled={busy}>
                <Text style={styles.ghostT}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primary, (pin.length !== 6 || busy) && styles.disabled]}
                disabled={pin.length !== 6 || busy}
                onPress={() => { void approve(); }}>
                <Text style={styles.primaryT}>{busy ? 'Memeriksa…' : 'Setujui'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 14 },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  card: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
  },
  cardT: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy },
  cardS: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginTop: 2 },
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogNarrow: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  dTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.text,
    marginTop: 12,
    letterSpacing: 4,
    textAlign: 'center',
  },
  msg: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 8, textAlign: 'center' },
  btns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  ghost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  primary: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  disabled: { opacity: 0.5 },
});
