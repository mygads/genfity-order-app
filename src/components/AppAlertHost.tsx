/**
 * Host Modal untuk appAlert di web (S2-C308).
 *
 * Dipasang sekali di App.tsx dalam NavigationContainer. Berlangganan
 * permintaan dari lib/appAlert lalu merendernya sebagai Modal + AppButton
 * (pola dialog ExtraPaySection): 'cancel' → secondary, 'destructive' →
 * danger, bawaan → primary. Tiap tombol menjalankan onPress lalu dismiss.
 * Tanpa buttons = satu tombol Tutup via kunci cm_close.
 */
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { useLang } from '../lib/i18n';
import AppButton from './AppButton';
import { dismissAppAlert, subscribeAppAlert, type AppAlertRequest } from '../lib/appAlert';

export default function AppAlertHost() {
  const { t } = useLang();
  const [req, setReq] = useState<AppAlertRequest | null>(null);

  useEffect(() => subscribeAppAlert(setReq), []);

  if (!req) return null;
  const buttons = req.buttons.length > 0 ? req.buttons : [{ text: t('cm_close') }];
  return (
    <Modal
      transparent
      animationType="fade"
      visible
      onRequestClose={() => {
        // Android back: hormati cancelable seperti Alert.alert bawaan.
        if (req.cancelable) dismissAppAlert();
      }}>
      <View style={styles.wrap}>
        <View style={[styles.dialog, styles.dialogNarrow]}>
          <Text style={styles.dTitle}>{req.title}</Text>
          {req.message ? <Text style={styles.dSub}>{req.message}</Text> : null}
          <View style={styles.btns}>
            {buttons.map((b, i) => (
              <AppButton
                key={i}
                title={b.text ?? t('cm_close')}
                variant={b.style === 'cancel' ? 'secondary' : b.style === 'destructive' ? 'danger' : 'primary'}
                fullWidth={false}
                size="md"
                style={styles.modalBtn}
                onPress={() => {
                  try {
                    b.onPress?.();
                  } finally {
                    dismissAppAlert();
                  }
                }}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Cermin pola dialog ExtraPaySection: overlay gelap + kartu putih tengah.
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogNarrow: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  dTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  btns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modalBtn: { flex: 1, marginTop: 0 },
});
