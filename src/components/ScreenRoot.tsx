import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  children: ReactNode;
  /** Style akar layar (cth. backgroundColor) - flex:1 + inset ditangani di sini. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Akar layar kustom tanpa ScreenHeader (alur install/auth): beri paddingTop
 * sebesar inset sistem agar konten tak tertutup status bar HP (jam/wifi)
 * pada Android edge-to-edge. Inset 0 di web sehingga tampilan tak berubah.
 */
export default function ScreenRoot({ children, style }: Props) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.root, style, { paddingTop: insets.top }]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
