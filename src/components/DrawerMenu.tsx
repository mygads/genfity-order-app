import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { logout } from '../session';

interface DrawerItem {
  label: string;
  sub: string;
  route: string;
}

// Isi drawer = menu /home APK asli (Lampiran A dossier):
// order, table, shift, sales-history, detail-recap, esb-order-dashboard,
// member, expense, petty-cash, settings.
const ITEMS: DrawerItem[] = [
  { label: 'Order', sub: 'Kasir', route: 'Cashier' },
  { label: 'Meja', sub: 'Denah & status', route: 'Tables' },
  { label: 'Shift', sub: 'Kehadiran & kas', route: 'Shift' },
  { label: 'Riwayat Penjualan', sub: 'Semua transaksi', route: 'History' },
  { label: 'Detail Rekap', sub: 'Rekap shift', route: 'Recap' },
  { label: 'ESB Order', sub: 'Pesanan online', route: 'EsbOrder' },
  { label: 'Member', sub: 'Member & deposit', route: 'Member' },
  { label: 'Expense', sub: 'Biaya operasional', route: 'Expense' },
  { label: 'Petty Cash', sub: 'Kas kecil', route: 'PettyCash' },
  { label: 'Pengaturan', sub: 'Printer · sinkron', route: 'Settings' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  navigate: (screen: string) => void;
  outlet?: string;
  user?: string;
}

export default function DrawerMenu({ visible, onClose, navigate, outlet, user }: Props) {
  const go = (route: string) => {
    onClose();
    navigate(route);
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.outlet}>{outlet ?? 'ESB Cabang Poris'}</Text>
            <View style={styles.shiftRow}>
              <View style={styles.shiftDot} />
              <Text style={styles.shiftText}>{user ?? 'Gista | Shift Open'}</Text>
            </View>
          </View>
          {ITEMS.map((m) => (
            <Pressable key={m.route} style={styles.row} onPress={() => go(m.route)}>
              <View style={styles.rowLeft}>
                <Text style={styles.rowLabel}>{m.label}</Text>
                <Text style={styles.rowSub}>{m.sub}</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))}
          <Pressable
            style={styles.logout}
            onPress={() => {
              onClose();
              logout();
              navigate('Login');
            }}>
            <Text style={styles.logoutText}>Keluar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { width: 300, backgroundColor: colors.white, paddingBottom: 24 },
  head: { backgroundColor: colors.navy, paddingTop: 56, paddingBottom: 18, paddingHorizontal: 18 },
  outlet: { fontFamily: fonts.bold, fontSize: 17, color: colors.white },
  shiftRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  shiftDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green, marginRight: 6 },
  shiftText: { fontFamily: fonts.medium, fontSize: 12, color: colors.navyTint },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLeft: { flex: 1 },
  rowLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  chev: { fontSize: 22, color: colors.faint, fontFamily: fonts.bold },
  logout: {
    marginHorizontal: 18,
    marginTop: 18,
    borderRadius: 12,
    backgroundColor: colors.paleRed,
    paddingVertical: 13,
    alignItems: 'center',
  },
  logoutText: { fontFamily: fonts.bold, fontSize: 14, color: colors.red },
});
