import type { ViewStyle } from 'react-native';
import { View } from 'react-native';

interface Props {
  /** Warna chevron. */
  color?: string;
  /** Ukuran kotak luar — selalu 1:1. */
  size?: number;
}

/**
 * Chevron kiri digambar dari dua batang (bukan glyph font) — proporsinya
 * selalu 1:1 di semua font/OS, tidak ketarik seperti '‹'/'←' teks.
 */
export default function BackChevron({ color = '#FFFFFF', size = 24 }: Props) {
  const len = size * 0.52;
  const thick = Math.max(2.5, size * 0.12);
  const d = (len / 2) * Math.SQRT1_2;
  const cx = size * 0.46;
  const cy = size / 2;
  const bar: ViewStyle = {
    position: 'absolute',
    width: len,
    height: thick,
    borderRadius: thick / 2,
    backgroundColor: color,
  };
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          bar,
          { left: cx + d - len / 2, top: cy - d - thick / 2, transform: [{ rotate: '-45deg' }] },
        ]}
      />
      <View
        style={[
          bar,
          { left: cx + d - len / 2, top: cy + d - thick / 2, transform: [{ rotate: '45deg' }] },
        ]}
      />
    </View>
  );
}
