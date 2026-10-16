import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TABLET_BP } from '../theme';

interface Props {
  children: ReactNode;
  /** Style akar layar (cth. backgroundColor) - flex:1 + inset ditangani di sini. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Akar layar kustom tanpa ScreenHeader (alur install/auth): beri paddingTop
 * sebesar inset sistem agar konten tak tertutup status bar HP (jam/wifi)
 * pada Android edge-to-edge. Inset 0 di web sehingga tampilan tak berubah.
 * Tablet: konten dibatasi lebarnya + ditengahkan agar tak melar full-width
 * (cabang isTablet; phone tak berubah).
 */
export default function ScreenRoot({ children, style }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  return (
    <View style={[styles.root, style, { paddingTop: insets.top }, isTablet && styles.rootTablet]}>
      {isTablet ? <View style={styles.inner}>{children}</View> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Tablet: beri napas dari tepi layar lebar.
  rootTablet: { paddingHorizontal: 24 },
  // Kolom konten tablet: batasi + tengahkan.
  inner: { flex: 1, width: '100%', maxWidth: 960, alignSelf: 'center' },
});
