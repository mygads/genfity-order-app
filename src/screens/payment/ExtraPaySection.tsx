import { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../../theme';
import { useLang } from '../../lib/i18n';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { EXTRA_METHODS, type ExtraMethodId } from '../../lib/payments';
import { attemptsLeft, authorizeSupervisor, verifyLocalEscalation } from '../../lib/supervisor';

/**
 * Metode pembayaran lanjutan: transfer, deposit member, kompliment,
 * non-penjualan. Dua terakhir wajib otorisasi supervisor (fail-closed).
 */
export default function ExtraPaySection({ onDone }: { onDone: (methodLabel: string, ref?: string, approverUserId?: string) => void }) {
  // Tablet: kartu 4 sebaris proporsional di dalam konten PayScreen.
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [authFor, setAuthFor] = useState<ExtraMethodId | null>(null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Transfer Bank wajib no. referensi/bukti sebelum lunas (jangan langsung onDone).
  const [refFor, setRefFor] = useState<ExtraMethodId | null>(null);
  const [refNo, setRefNo] = useState('');
  const [refMsg, setRefMsg] = useState('');

  const tap = (id: ExtraMethodId) => {
    const m = EXTRA_METHODS.find((x) => x.id === id);
    if (!m) return;
    if (id === 'transfer') {
      setRefFor(id);
      setRefNo('');
      setRefMsg('');
      return;
    }
    if (m.needsAuth) {
      setAuthFor(id);
      setPin('');
      setMsg('');
      return;
    }
    onDone(m.label);
  };

  const submitRef = () => {
    const ref = refNo.trim();
    if (ref.length < 3) {
      setRefMsg(t('xp_ref_need'));
      return;
    }
    const m = EXTRA_METHODS.find((x) => x.id === refFor);
    setRefFor(null);
    if (m) onDone(m.label, ref.toUpperCase());
  };

  const approve = async () => {
    if (!authFor || busy) return;
    setBusy(true);
    setMsg(t('xp_requesting'));
    let r = await authorizeSupervisor(pin);
    // Identitas penyetuju diteruskan ke Pay agar diaudit (tr_salesinfo +
    // payload). Jalur server tak mengembalikan userId — hanya eskalasi lokal
    // yang membawa identitas (verifyLocalEscalation → userId).
    let approver: string | undefined;
    // Offline-first: kompliment/non-penjualan butuh hak order.void; PIN staf
    // atau salah tetap ditolak (fail-closed).
    if (!r.ok && (r.code === 'offline' || r.code === 'unconfigured')) {
      const local = await verifyLocalEscalation(pin, 'order.void');
      if (local.ok) approver = local.userId;
      r = local;
    }
    setBusy(false);
    if (!r.ok) {
      // Terkunci sementara: pesan sudah lokal via kamus (sup_locked + detik).
      setMsg(r.code === 'locked' ? r.message : `${r.message} (${t('xp_left').replace('{n}', String(attemptsLeft()))})`);
      return;
    }
    const m = EXTRA_METHODS.find((x) => x.id === authFor);
    setAuthFor(null);
    if (m) onDone(m.label, undefined, approver);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('xp_title')}</Text>
      <Text style={styles.hint}>{t('xp_hint')}</Text>
      <View style={styles.grid}>
        {EXTRA_METHODS.map((m) => (
          <TouchableOpacity key={m.id} style={[styles.card, isTablet && styles.cardTablet]} onPress={() => tap(m.id)}>
            <Text style={[styles.cardT, isTablet && styles.cardTTablet]}>{m.label}</Text>
            <Text style={[styles.cardS, isTablet && styles.cardSTablet]}>{m.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Modal visible={authFor !== null} animationType="fade" transparent>
        <View style={styles.wrap}>
          <View style={[styles.dialog, styles.dialogNarrow]}>
            <Text style={styles.dTitle}>{t('xp_auth_title')}</Text>
            <Text style={styles.dSub}>{t('xp_auth_sub')}</Text>
            <AppInput
              keyboardType="numeric"
              maxLength={6}
              secureTextEntry
              placeholder={t('xp_pin_ph')}
              value={pin}
              onChangeText={(v) => setPin(v.replace(/[^0-9]/g, '').slice(0, 6))}
              style={styles.pinField}
            />
            {msg ? <Text style={styles.msg}>{msg}</Text> : null}
            <View style={styles.btns}>
              <AppButton title={t('xp_cancel')} variant="secondary" disabled={busy} onPress={() => setAuthFor(null)} fullWidth={false} size="md" style={styles.modalBtn} />
              <AppButton
                title={busy ? t('xp_checking') : t('xp_approve')}
                disabled={pin.replace(/[^0-9]/g, '').length < 4 || busy}
                onPress={() => { void approve(); }}
                fullWidth={false}
                size="md"
                style={styles.modalBtn}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={refFor !== null} animationType="fade" transparent>
        <View style={styles.wrap}>
          <View style={[styles.dialog, styles.dialogNarrow]}>
            <Text style={styles.dTitle}>{t('xp_ref_title')}</Text>
            <Text style={styles.dSub}>{t('xp_ref_sub')}</Text>
            <AppInput
              placeholder={t('xp_ref_ph')}
              value={refNo}
              onChangeText={(v) => setRefNo(v.toUpperCase().slice(0, 32))}
              autoCapitalize="characters"
            />
            {refMsg ? <Text style={styles.msg}>{refMsg}</Text> : null}
            <View style={styles.btns}>
              <AppButton title={t('xp_cancel')} variant="secondary" onPress={() => setRefFor(null)} fullWidth={false} size="md" style={styles.modalBtn} />
              <AppButton
                title={t('xp_ref_done')}
                disabled={refNo.trim().length < 3}
                onPress={submitRef}
                fullWidth={false}
                size="md"
                style={styles.modalBtn}
              />
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
  // Tablet: 4 kartu sebaris proporsional dengan teks sedikit besar.
  cardTablet: { flexBasis: '23%', minHeight: 64, padding: 16 },
  cardTTablet: { fontSize: 14 },
  cardSTablet: { fontSize: 12 },
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
    fontSize: 14,
    color: colors.text,
    marginTop: 12,
    letterSpacing: 4,
    textAlign: 'center',
  },
  msg: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 8, textAlign: 'center' },
  btns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modalBtn: { flex: 1, marginTop: 0 },
  pinField: { textAlign: 'center', letterSpacing: 4 },
  ghost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  primary: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  disabled: { opacity: 0.5 },
});
