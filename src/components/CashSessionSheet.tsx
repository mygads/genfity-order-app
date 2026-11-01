/**
 * GAP-A (audit 2026-11-01): pemilih sesi kas di perangkat.
 * Bila server menjawab SELECTION_REQUIRED (>1 sesi kas OPEN) dan auto-heal
 * satu-sesi gagal, kasir kasir-only (tanpa akses FE Laci kas) sebelumnya
 * buntu. Sheet ini mendaftar sesi OPEN (listOpenCashSessionsBe),
 * mengadopsi pilihan (chooseCashSessionId) lalu memicu onPicked agar
 * pemanggil mengulang settle SEKALI ke sesi terpilih. Tak pernah melempar
 * ke pemanggil (gagal = pesan di sheet, pilih "Nanti" = antre jujur).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import AppButton from './AppButton';
import { useLang } from '../lib/i18n';
import {
  chooseCashSessionId,
  listOpenCashSessionsBe,
  type OpenCashSession,
} from '../lib/beWorkforce';

interface CashSessionSheetProps {
  visible: boolean;
  onPicked: (sessionId: string) => void;
  onCancel: () => void;
}

export default function CashSessionSheet({ visible, onPicked, onCancel }: CashSessionSheetProps) {
  const { t } = useLang();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<OpenCashSession[] | null>(null);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await listOpenCashSessionsBe();
      if (r.ok) setItems(r.data);
      else setErr(r.message || 'offline');
    } catch {
      setErr('offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setItems(null);
      setPicked('');
      setErr('');
      void load();
    }
  }, [visible, load]);

  const use = async (sid: string) => {
    const id = sid.trim();
    if (!id || picked) return;
    setPicked(id);
    try {
      const ok = await chooseCashSessionId(id);
      if (ok) {
        onPicked(id);
        return;
      }
      setErr('offline');
    } catch {
      setErr('offline');
    } finally {
      setPicked('');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.wrap}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{t('cashsess_title')}</Text>
          <Text style={styles.sub}>{t('cashsess_hint')}</Text>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="small" color={colors.orange} />
              <Text style={styles.sub}>{t('cashsess_loading')}</Text>
            </View>
          ) : items && items.length > 0 ? (
            <View style={styles.list}>
              {items.map((s) => (
                <View key={s.sessionId} style={styles.row}>
                  <View style={styles.info}>
                    <Text style={styles.name}>{s.registerName} · #{s.sessionId}</Text>
                    {!!(s.openedBy || s.openedAt) && (
                      <Text style={styles.meta}>
                        {[s.openedBy, s.openedAt ? String(s.openedAt).slice(0, 16).replace('T', ' ') : ''].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </View>
                  <AppButton
                    title={t('cashsess_use')}
                    size="sm"
                    fullWidth={false}
                    disabled={picked !== ''}
                    onPress={() => void use(s.sessionId)}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.sub}>{err || t('cashsess_empty')}</Text>
              {!!err && (
                <AppButton title="↻" size="sm" fullWidth={false} onPress={() => void load()} style={styles.retry} />
              )}
            </View>
          )}
          <AppButton title={t('cashsess_cancel')} variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  dialog: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  title: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  center: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  list: { marginVertical: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.stroke, borderRadius: 12, padding: 10 },
  info: { flex: 1 },
  name: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  meta: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginTop: 2 },
  retry: { marginTop: 4 },
});
