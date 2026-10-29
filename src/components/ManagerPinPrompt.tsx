/**
 * P1-1b: prompt PIN manajer transport-only (cermin FE ManagerPinModal +
 * withPosPin). PIN 4–8 digit (kontrak BE manager PIN, Opsi A: slot delete_pin
 * sunset — server hanya baca `pin`), dipegang di
 * state lokal saja: diserahkan ke onSubmit untuk SATU panggilan live, lalu
 * dibersihkan saat tutup — TAK PERNAH dipersist, di-log, atau diantrekan.
 */
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import AppButton from './AppButton';
import AppInput from './AppInput';
import { useLang } from '../lib/i18n';

interface ManagerPinPromptProps {
  visible: boolean;
  busy?: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

export default function ManagerPinPrompt({ visible, busy, onSubmit, onCancel }: ManagerPinPromptProps) {
  const { t } = useLang();
  const [pin, setPin] = useState('');
  useEffect(() => {
    if (visible) setPin('');
  }, [visible]);
  const clean = pin.replace(/[^0-9]/g, '').slice(0, 8);
  const ok = clean.length >= 4 && !busy;
  const submit = () => {
    if (!ok) return;
    const p = clean;
    setPin('');
    onSubmit(p);
  };
  const cancel = () => {
    setPin('');
    onCancel();
  };
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={cancel}>
      <View style={styles.wrap}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{t('mgr_pin_title')}</Text>
          <Text style={styles.sub}>{t('mgr_pin_hint')}</Text>
          <Text style={styles.label}>{t('cx_pin')}</Text>
          <AppInput
            keyboardType="numeric"
            maxLength={8}
            secureTextEntry
            placeholder={t('mgr_pin_ph')}
            value={pin}
            onChangeText={(v) => setPin(v.replace(/[^0-9]/g, '').slice(0, 8))}
          />
          <View style={styles.btns}>
            <AppButton title={t('xp_cancel')} variant="secondary" disabled={!!busy} onPress={cancel} fullWidth={false} size="md" style={styles.btn} />
            <AppButton title={t('xp_approve')} disabled={!ok} onPress={submit} fullWidth={false} size="md" style={styles.btn} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, alignSelf: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  label: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 10 },
  btns: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1 },
});
