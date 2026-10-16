import { useWindowDimensions, type ViewStyle } from 'react-native';

/** Breakpoint tablet - SAMA di semua layar ( Cashier/Pay/History pakai literal 768 ). */
export const TABLET_BP = 768;

export function useIsWide(bp: number = TABLET_BP): boolean {
  const { width } = useWindowDimensions();
  return width >= bp;
}

/** Kolom konten tablet: batasi lebar + tengahkan (pakai: [styles.body, isWide && wideCenter]). */
export const wideCenter: ViewStyle = { width: '100%', alignSelf: 'center', maxWidth: 880 };
/** Utk struk/konten sempit (Receipt, QrScan). */
export const wideCenterSm: ViewStyle = { width: '100%', alignSelf: 'center', maxWidth: 560 };
/** Utk dashboard/daftar lebar (Dashboard, Member, daftar). */
export const wideCenterLg: ViewStyle = { width: '100%', alignSelf: 'center', maxWidth: 1024 };
