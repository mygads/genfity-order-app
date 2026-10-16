import { Linking, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, fonts, wideCenterSm } from '../../theme';

type Nav = { goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { url?: string; title?: string } } };

/**
 * Web-view dalam aplikasi (fakta APK: layar `web-view` untuk registrasi/
 * login owner lewat browser). Fallback: buka browser eksternal.
 */
export default function WebViewScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const url = route?.params?.url ?? '';
  const title = route?.params?.title ?? 'Halaman Web';

  const openExternal = () => {
    if (url) void Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.bar, isTablet && wideCenterSm]}>
        <TouchableOpacity onPress={() => navigation?.goBack()}>
          <Text style={styles.back}>‹ Tutup</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <TouchableOpacity onPress={openExternal}>
          <Text style={styles.ext}>Browser ›</Text>
        </TouchableOpacity>
      </View>
      {url ? (
        <WebView source={{ uri: url }} style={styles.web} onError={openExternal} />
      ) : (
        <View style={[styles.empty, isTablet && wideCenterSm]}>
          <Text style={styles.emptyT}>Tidak ada tautan.</Text>
          <Text style={styles.emptyS}>Buka lewat tombol pendaftaran di layar Klaim Terminal.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  back: { color: colors.white, fontFamily: fonts.medium, fontSize: 14, width: 70 },
  title: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 15, textAlign: 'center' },
  ext: { color: colors.white, fontFamily: fonts.medium, fontSize: 13, width: 70, textAlign: 'right' },
  web: { flex: 1 },
  empty: { padding: 24, alignItems: 'center' },
  emptyT: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  emptyS: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'center' },
});
