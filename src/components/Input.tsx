import { StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { TABLET_BP, colors, fonts } from '../theme';
import { radius } from '../theme/radius';

/**
 * Warna border input - paritas `INPUT_BORDER` LoginScreen (di sana literal).
 * Belum jadi token `colors.*`, jadi diduplikat di sini dgn catatan ini.
 */
const INPUT_BORDER = '#BDBDBD';

interface InputProps extends TextInputProps {
  /** Label di atas kolom (regular 14 ala Login). */
  label?: string;
  /** Tampilkan bintang merah `*` di ujung label ala Login. */
  required?: boolean;
  /**
   * Status error: `true` hanya mewarnai border merah,
   * string sekaligus menampilkan pesan di bawah kolom.
   */
  error?: string | boolean;
  /** Override kotak luar (border, background, tinggi). */
  boxStyle?: StyleProp<ViewStyle>;
}

/**
 * Kolom input bersama - gaya disalin dari LoginScreen:
 * h56, r14, border 1, padding horizontal 16, font 14.
 *
 * Sadar-tema: warna baca dari token `colors.*` (background kartu,
 * teks, faint utk placeholder) sehingga mengikuti tema bila token
 * berubah. Repo saat ini belum punya mode gelap (`useColorScheme`
 * tidak dipakai di layar mana pun) - begitu token gelap ada,
 * komponen ini ikut tanpa perubahan.
 *
 * Migrasi layar lama ke komponen ini adalah batch terpisah -
 * jangan ubah layar apa pun di sini.
 */
export default function Input({ label, required, error, boxStyle, style, ...rest }: InputProps) {
  const invalid = error !== undefined && error !== false && error !== '';
  // Tablet: metrik input naik (cabang isTablet; phone tak berubah).
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  return (
    <View>
      {label ? (
        <Text style={[styles.label, isTablet && styles.labelTablet]}>
          {label}
          {required ? <Text style={styles.star}>*</Text> : null}
        </Text>
      ) : null}
      <View style={[styles.box, invalid && styles.boxError, isTablet && styles.boxTablet, boxStyle]}>
        <TextInput
          style={[styles.field, isTablet && styles.fieldTablet, style]}
          placeholderTextColor={colors.faint}
          {...rest}
        />
      </View>
      {typeof error === 'string' && error ? (
        <Text style={[styles.errorText, isTablet && styles.errorTextTablet]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.regular, fontSize: 14, color: colors.text, marginBottom: 8 },
  // Tablet: label sedikit lebih besar.
  labelTablet: { fontSize: 15 },
  star: { color: colors.red },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    paddingHorizontal: 16,
    backgroundColor: colors.card,
  },
  // Tablet: kolom lebih tinggi + lega.
  boxTablet: { height: 60, paddingHorizontal: 20 },
  boxError: { borderColor: colors.red },
  // Hilangkan outline fokus bawaan browser di web (garis hitam) - pola yg sama di CashierScreen/PromotionListScreen.
  field: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.text, height: '100%', outlineStyle: 'none' as never },
  // Tablet: teks isi + pesan error naik.
  fieldTablet: { fontSize: 16 },
  errorText: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginTop: 8, lineHeight: 19 },
  errorTextTablet: { fontSize: 14 },
});
