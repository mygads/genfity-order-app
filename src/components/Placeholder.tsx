import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { useLang } from '../lib/i18n';

export default function Placeholder({ title }: { title: string }) {
  const { t } = useLang();
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{t('ph_coming_soon')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.faint, marginTop: 8 },
});
