import { StyleSheet, Text, TouchableOpacity, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { colors, fonts } from '../theme';
import { radius } from '../theme/radius';

/**
 * Nonaktif CTA primer — PAR-01 parity (2026-10-27): #FFB399 paritas FE
 * --color-primary-disabled (dulu PEACH #F6C28B utk orange lama #F5820D).
 * LoginScreen masih literal #F6C28B; migrasi ke token ini butuh acc owner
 * (lihat decision-packet), tak disentuh di sini.
 */
const PEACH_IDLE = '#FFB399';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  /** Teks tombol. */
  title: string;
  onPress?: () => void;
  /** Gaya: primer oranye / outline biru / bahaya merah. */
  variant?: ButtonVariant;
  /** Status nonaktif - gaya pucat ala CTA Login, tombol tak merespons. */
  disabled?: boolean;
  /** Lebar penuh (default true, ala CTA Login/Dashboard). */
  fullWidth?: boolean;
  /** Override kotak tombol. */
  style?: StyleProp<ViewStyle>;
  /** Override teks tombol. */
  textStyle?: StyleProp<TextStyle>;
}

/**
 * Tombol bersama — PAR-01 parity (2026-10-27): radius via radius.cta = 12
 * (paritas FE rounded-lg; dulu stadium tinggi/2 = 28), h56, teks bold 16 putih.
 *
 * - `primary`: oranye solid ala Login (`colors.orange`).
 * - `secondary`: outline biru 1.5 ala tombol "how" Login.
 * - `danger`: merah solid (`colors.red`) utk aksi destruktif.
 *
 * Sadar-tema: warna baca dari token `colors.*` sehingga mengikuti
 * tema bila token berubah (repo saat ini belum punya mode gelap).
 *
 * Migrasi layar lama ke komponen ini adalah batch terpisah -
 * jangan ubah layar apa pun di sini.
 */
export default function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  fullWidth = true,
  style,
  textStyle,
}: ButtonProps) {
  return (
    <TouchableOpacity
      style={[
        styles.base,
        fullWidth && styles.stretch,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        disabled && variant === 'primary' && styles.primaryIdle,
        disabled && variant === 'secondary' && styles.secondaryIdle,
        disabled && variant === 'danger' && styles.dangerIdle,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}>
      <Text
        style={[
          styles.text,
          variant === 'secondary' && styles.textSecondary,
          disabled && variant === 'secondary' && styles.textSecondaryIdle,
          disabled && variant === 'danger' && styles.textDangerIdle,
          textStyle,
        ]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 56,
    borderRadius: radius.cta,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  stretch: { alignSelf: 'stretch' },
  primary: { backgroundColor: colors.orange },
  primaryIdle: { backgroundColor: PEACH_IDLE },
  secondary: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.blue,
  },
  secondaryIdle: { borderColor: colors.stroke },
  danger: { backgroundColor: colors.red },
  dangerIdle: { backgroundColor: colors.paleRed },
  text: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
  textSecondary: { color: colors.blue },
  textSecondaryIdle: { color: colors.faint },
  textDangerIdle: { color: colors.red },
});
