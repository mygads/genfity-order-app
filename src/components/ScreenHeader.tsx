import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../theme';

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
  backLabel = '‹',
  left,
  right,
  sub,
  titleSize,
  subSize,
}: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const tSize = titleSize ?? (isTablet ? 18 : 16);
  const sSize = subSize ?? (isTablet ? 13 : 12);
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {left ?? (onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={12}>
            <Text style={styles.back}>{backLabel}</Text>
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
      <View style={styles.sideRight}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 56,
  },
  side: { width: 70, justifyContent: 'center' },
  sideRight: { width: 70, alignItems: 'flex-end', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center' },
  back: { color: colors.white, fontFamily: fonts.medium, fontSize: 16 },
  title: { color: colors.white, fontFamily: fonts.bold, textAlign: 'center' },
  sub: { color: colors.navyTint, fontFamily: fonts.regular, marginTop: 2, textAlign: 'center' },
});
