import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';
import { useLang } from '../../lib/i18n';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };
type Props = { navigation?: Nav; route?: { params?: { branch?: string } } };

const STEP_KEYS = ['g_inst_step1', 'g_inst_step2', 'g_inst_step3'];

export default function InstallProgressScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const branch = route?.params?.branch ?? 'ESB Cabang Poris';
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (done >= STEP_KEYS.length) {
      const t = setTimeout(() => navigation?.navigate('CreatePin', { branch }), 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDone((d) => d + 1), 900);
    return () => clearTimeout(t);
  }, [done, navigation, branch]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Text style={styles.title}>{t('g_inst_title')}</Text>
      <Text style={styles.desc}>{branch} · {t('g_inst_dont_close')}</Text>
      <View style={styles.card}>
        {STEP_KEYS.map((k, i) => (
          <View key={k} style={styles.step}>
            {i < done ? (
              <Text style={styles.check}>✓</Text>
            ) : i === done ? (
              <ActivityIndicator size="small" color={colors.orange} />
            ) : (
              <Text style={styles.todo}>○</Text>
            )}
            <Text style={[styles.stepT, i <= done && styles.stepTOn]}>{t(k)}</Text>
          </View>
        ))}
      </View>
      <View style={styles.bar}>
        <View style={[styles.fill, { width: `${Math.round((done / STEP_KEYS.length) * 100)}%` }]} />
      </View>
      <Text style={styles.pct}>{Math.round((done / STEP_KEYS.length) * 100)}%</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, marginBottom: 16 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  check: { fontFamily: fonts.bold, fontSize: 18, color: colors.green, width: 24, textAlign: 'center' },
  todo: { fontSize: 16, color: colors.faint, width: 24, textAlign: 'center' },
  stepT: { fontFamily: fonts.regular, fontSize: 14, color: colors.faint, flex: 1 },
  stepTOn: { color: colors.text, fontFamily: fonts.medium },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.line, marginTop: 20, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.orange },
  pct: { fontFamily: fonts.bold, fontSize: 14, color: colors.orangeDark, textAlign: 'center', marginTop: 8 },
});
