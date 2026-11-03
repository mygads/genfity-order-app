/**
 * GAP-B (audit 2026-11-01): kunci otomatis kasir idle.
 * cashierIdle.ts sebelumnya dead-code (watcher tak pernah start, tak ada
 * pemanggil touch/lock). Overlay ini = ujung UI: modal penuh yang memblokir
 * interaksi sampai PIN staff sesi aktif terverifikasi offline
 * (verifyGrantPin, triple user+terminal+device) — shift/kas tetap berjalan,
 * tanpa logout. Tanpa grant valid pemanggil JANGAN tampilkan overlay ini
 * (PIN tak bisa diverifikasi offline → kunci permanen). Gerbang kedaluwarsa
 * (GAP-BW): verifyGrantPin murni hash-compare tanpa cek expiry, jadi submit
 * menolak bila isGrantValid gagal (grant kedaluwarsa/mismatch = paksa login ulang).
 */
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import AppButton from './AppButton';
import AppInput from './AppInput';
import { useLang } from '../lib/i18n';
import { isGrantValid, verifyGrantPin, type GrantTriple } from '../session';
import {
  checkGrantLoginThrottle,
  noteGrantLoginFailure,
  resetGrantLoginThrottle,
} from '../lib/pin';

interface IdleLockOverlayProps {
  visible: boolean;
  triple: GrantTriple | null;
  onUnlocked: () => void;
  onLogout: () => void;
}

export default function IdleLockOverlay({ visible, triple, onUnlocked, onLogout }: IdleLockOverlayProps) {
  const { t } = useLang();
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setPin('');
      setMsg('');
      setBusy(false);
    }
  }, [visible]);

  const submit = async () => {
    const clean = pin.replace(/[^0-9]/g, '').slice(0, 8);
    if (clean.length < 4 || busy || !triple) return;
    setBusy(true);
    try {
      const th = await checkGrantLoginThrottle().catch(() => null);
      if (th && th.locked) {
        const n = Math.max(1, th.remainingSec);
        setMsg(t('g_pin_offline_locked').replace('{n}', String(n)));
        return;
      }
      if (!isGrantValid(triple.userId, triple.terminalId, triple.deviceId)) {
        setMsg(t('idle_expired'));
        return;
      }
      if (verifyGrantPin(clean, triple)) {
        setPin('');
        try {
          await resetGrantLoginThrottle().catch(() => {});
        } catch { /* abaikan */ }
        onUnlocked();
      } else {
        try {
          await noteGrantLoginFailure().catch(() => {});
        } catch { /* abaikan */ }
        setMsg(t('idle_wrong'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={() => {}}>
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('idle_title')}</Text>
          <Text style={styles.sub}>{t('idle_sub')}</Text>
          <Text style={styles.label}>{t('login_pin_title')}</Text>
          <AppInput
            keyboardType="numeric"
            maxLength={8}
            secureTextEntry
            placeholder={t('mgr_pin_ph')}
            value={pin}
            onChangeText={(v) => setPin(v.replace(/[^0-9]/g, '').slice(0, 8))}
          />
          {!!msg && <Text style={styles.err}>{msg}</Text>}
          <View style={styles.btns}>
            <AppButton title={t('idle_logout')} variant="secondary" disabled={busy} onPress={onLogout} fullWidth={false} size="md" style={styles.btn} />
            <AppButton title={t('idle_unlock')} disabled={pin.replace(/[^0-9]/g, '').length < 4 || busy} onPress={() => void submit()} fullWidth={false} size="md" style={styles.btn} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy ?? '#1c2430', justifyContent: 'center', paddingHorizontal: 28 },
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, alignSelf: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 6 },
  label: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 12 },
  err: { fontFamily: fonts.medium, fontSize: 12, color: colors.red ?? '#c0392b', marginTop: 8 },
  btns: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1 },
});
