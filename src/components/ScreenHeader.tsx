import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TABLET_BP, colors, fonts } from '../theme';
import BackChevron from './BackChevron';

interface Props {
  /** Judul tengah. */
  title: string;
  /** Kembali: teks tombol kiri. Tanpa onBack dan tanpa left = sisi kiri kosong (layar akar). */
  onBack?: () => void;
  backLabel?: string;
  /** Slot aksi kiri kustom (cth. burger drawer). Diutamakan bila onBack tidak diisi. */
  left?: ReactNode;
  /** Aksi kanan (ikon/teks/tombol, cth. badge Online atau tanggal). */
  right?: ReactNode;
  /** Baris kecil di bawah judul (cth. jumlah item). */
  sub?: string;
  /** Override ukuran judul - default responsif 16 phone / 18 tablet. */
  titleSize?: number;
  /** Override ukuran sub - default responsif 12 phone / 13 tablet. */
  subSize?: number;
}

/**
 * Bilah atas tunggal seluruh aplikasi (navy, judul tengah putih).
 * Fakta APK (dump UI): bilah atas berisi aksi kiri + aksi kanan simetris.
 * Sisi kiri dan kanan sama lebar (70) agar judul selalu tepat di tengah.
 * Migrasi bertahap: layar yang sudah memakai ini tercatat di docs/PARITY.md.
 */
export default function ScreenHeader({
  title,
  onBack,
  backLabel,
  left,
  right,
  sub,
  titleSize,
  subSize,
}: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isTablet = width >= TABLET_BP;
  const tSize = titleSize ?? (isTablet ? 18 : 16);
  const sSize = subSize ?? (isTablet ? 13 : 12);
  return (
    // paddingTop = inset sistem (status bar Android takik/edge-to-edge,
    // 0 di web) + 12 bawaan agar bilah tak tertutup jam/wifi HP.
    // Tablet: bar lebih tinggi + lega (cabang isTablet; phone tak berubah).
    <View style={[styles.bar, { paddingTop: insets.top + 12 }, isTablet && styles.barTablet]}>
      <View style={[styles.side, isTablet && styles.sideTablet]}>
        {left ?? (onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={isTablet ? 16 : 12} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Kembali">
            {backLabel != null ? (
              <Text style={styles.back}>{backLabel}</Text>
            ) : (
              <BackChevron color={colors.white} size={isTablet ? 26 : 24} />
            )}
          </TouchableOpacity>
        ) : null)}
      </View>
      <View style={styles.center}>
        <Text style={[styles.title, { fontSize: tSize }]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={[styles.sub, { fontSize: sSize }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={[styles.sideRight, isTablet && styles.sideRightTablet]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    minHeight: 56,
  },
  // Tablet: bar lebih tinggi + padding lega agar tak terlihat tipis di layar lebar.
  barTablet: { minHeight: 64, paddingHorizontal: 20, paddingBottom: 14 },
  side: { width: 70, justifyContent: 'center' },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sideRight: { width: 70, alignItems: 'flex-end', justifyContent: 'center' },
  // Tablet: slot aksi lebih lebar (isi kanan tak terpotong) + minHeight 48
  // agar touch target back/burger aman.
  sideTablet: { width: 96, minHeight: 48 },
  sideRightTablet: { width: 96, minHeight: 48 },
  center: { flex: 1, alignItems: 'center' },
  back: { color: colors.white, fontFamily: fonts.medium, fontSize: 28, lineHeight: 32, paddingRight: 16, paddingVertical: 4 },
  title: { color: colors.white, fontFamily: fonts.bold, textAlign: 'center' },
  sub: { color: colors.navyTint, fontFamily: fonts.regular, marginTop: 2, textAlign: 'center' },
});
