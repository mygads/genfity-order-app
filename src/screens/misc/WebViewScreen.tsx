import { Linking, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';

type Nav = { goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { url?: string; title?: string } } };

/**
 * Web-view dalam aplikasi (fakta APK: layar `web-view` untuk registrasi/
 * login owner lewat browser). Fallback: buka browser eksternal.
 */
export default function WebViewScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const url = route?.params?.url ?? '';
  const title = route?.params?.title ?? 'Halaman Web';

  const openExternal = () => {
    if (url) void Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={title}
        onBack={() => navigation?.goBack()}
        backLabel="‹ Tutup"
        right={
          <TouchableOpacity onPress={openExternal} hitSlop={10}>
            <Text style={styles.ext}>Browser ›</Text>
          </TouchableOpacity>
        }
      />
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
  ext: { color: colors.white, fontFamily: fonts.medium, fontSize: 13, width: 70, textAlign: 'right' },
  web: { flex: 1 },
  empty: { padding: 24, alignItems: 'center' },
  emptyT: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  emptyS: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'center' },
});
