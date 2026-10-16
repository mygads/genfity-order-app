import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenterLg } from '../../theme';
import { getSession, logout } from '../../session';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

interface MenuItem {
  label: string;
  sub: string;
  route: string | null;
  soon?: boolean;
}

/** Menu utama (drawer) — route null = modul belum tersedia, tampil "Segera". */
const MENU: MenuItem[] = [
  { label: 'Order', sub: 'Kasir · 47 transaksi', route: 'Cashier' },
  { label: 'Meja', sub: 'Denah · 6 terisi', route: 'Tables' },
  { label: 'Booking', sub: 'Reservasi meja', route: 'Booking' },
  { label: 'Shift', sub: 'Kehadiran & kas', route: 'Shift' },
  { label: 'Riwayat Penjualan', sub: 'Semua transaksi', route: 'History' },
  { label: 'Detail Rekap', sub: 'Rekap shift', route: 'Recap' },
  { label: 'ESB Order', sub: 'Pesanan online · 2 baru', route: 'EsbOrder' },
  { label: 'Member', sub: '342 terdaftar', route: 'Member' },
  { label: 'Expense', sub: 'Biaya operasional', route: 'Expense' },
  { label: 'Petty Cash', sub: 'Kas kecil', route: 'PettyCash' },
  { label: 'Pengaturan', sub: 'Printer · sinkron', route: 'Settings' },
];

const TABLES = [
  { id: 'A-01', s: 'busy' }, { id: 'A-02', s: 'free' }, { id: 'A-03', s: 'res' },
  { id: 'A-04', s: 'busy' }, { id: 'A-05', s: 'free' }, { id: 'B-01', s: 'res' },
  { id: 'B-02', s: 'free' }, { id: 'B-03', s: 'busy' }, { id: 'B-04', s: 'free' },
  { id: 'B-05', s: 'busy' }, { id: 'VIP-1', s: 'res' }, { id: 'VIP-2', s: 'busy' },
  { id: 'C-01', s: 'free' }, { id: 'C-02', s: 'busy' },
] as const;

const LOW_STOCK = [
  { name: 'Lele goreng', left: 2 },
  { name: 'Kopi robusta', left: 5 },
  { name: 'Teh melati', left: 8 },
];

function tableStyle(s: string) {
  if (s === 'busy') return { bg: colors.paleRed, bd: colors.red, tx: colors.red };
  if (s === 'res') return { bg: colors.paleAmber, bd: colors.amber, tx: colors.amberDark };
  return { bg: colors.paleGreen, bd: colors.green, tx: colors.greenDark };
}

export default function DashboardScreen({ navigation }: Props) {
  const s = getSession();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [notice, setNotice] = useState('');

  const openMenu = (m: MenuItem) => {
    if (!m.route) {
      setNotice(`${m.label} belum tersedia di build ini.`);
      return;
    }
    setNotice('');
    navigation?.navigate(m.route);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.top}>
        <View>
          <Text style={styles.branch}>{s?.outlet ?? 'ESB Cabang Poris'}</Text>
          <Text style={styles.cashier}>Kasir {s?.name ?? 'Gista'} · {s?.shift ?? 'Shift Pagi'}</Text>
        </View>
        <View style={styles.online}>
          <Text style={styles.onlineText}>Online</Text>
        </View>
      </View>

      <View style={styles.shiftCard}>
        <View style={styles.shiftLeft}>
          <Text style={styles.shiftTitle}>Shift Buka ✓</Text>
          <Text style={styles.shiftSub}>
            Masuk {s?.clockIn ?? '08:57'} · Kas awal {rp(s?.cash ?? 200000)}
          </Text>
        </View>
        <TouchableOpacity style={styles.shiftBtn} onPress={() => navigation?.navigate('Shift')}>
          <Text style={styles.shiftBtnText}>Shift ›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.salesCard}>
        <Text style={styles.salesLabel}>Penjualan Hari Ini</Text>
        <Text style={styles.salesValue}>{rp(1284500)}</Text>
        <Text style={styles.salesSub}>47 transaksi · rata-rata Rp 27.329 · ▲ 12% vs kemarin</Text>
      </View>

      <TouchableOpacity style={styles.cta} onPress={() => navigation?.navigate('Cashier')}>
        <Text style={styles.ctaText}>+ Transaksi Baru</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Menu Utama</Text>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={[styles.menuGrid, isTablet && styles.menuGridTablet]}>
        {MENU.map((m) => (
          <TouchableOpacity
            key={m.label}
            style={[styles.menuCell, isTablet && styles.menuCellTablet, m.soon && styles.menuCellSoon]}
            onPress={() => openMenu(m)}>
            <View style={styles.menuTop}>
              <Text style={styles.menuLabel}>{m.label}</Text>
              {m.soon ? (
                <View style={styles.soonBadge}>
                  <Text style={styles.soonText}>Segera</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.menuSub}>{m.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Peta Meja</Text>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}>
            <Text style={styles.link}>Lihat denah ›</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.cardSub}>6 terisi · 5 kosong · 3 reservasi</Text>
        <Text style={styles.legend}>■ Terisi · □ Kosong · ● Reservasi — warna + label, bukan warna saja</Text>
        <View style={styles.grid}>
          {TABLES.map((t) => {
            const c = tableStyle(t.s);
            return (
              <View key={t.id} style={[styles.cell, { backgroundColor: c.bg, borderColor: c.bd }]}>
                <Text style={[styles.cellText, { color: c.tx }]}>{t.id}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Stok Menipis</Text>
          <TouchableOpacity onPress={() => navigation?.navigate('Stock')}>
            <Text style={styles.link}>Kelola stok ›</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.cardSub}>3 item perlu restok</Text>
        {LOW_STOCK.map((i) => (
          <View key={i.name} style={styles.stockRow}>
            <Text style={styles.stockName}>{i.name}</Text>
            <Text style={styles.stockLeft}>sisa {i.left}</Text>
          </View>
        ))}
      </View>

      <View style={styles.row}>
        <TouchableOpacity onPress={() => navigation?.navigate('Attendance')}>
          <Text style={styles.link}>Absensi ›</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { logout(); navigation?.navigate('Login'); }}>
          <Text style={styles.link}>Keluar ›</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.sync}>Sinkron terakhir 5 mnt lalu · Online</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  branch: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  cashier: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 2 },
  online: { backgroundColor: colors.paleGreen, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  onlineText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.greenDark },
  shiftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.navy,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  shiftLeft: { flex: 1 },
  shiftTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  shiftSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 2 },
  shiftBtn: { backgroundColor: colors.white, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  shiftBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy },
  salesCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  salesLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.faint },
  salesValue: { fontFamily: fonts.bold, fontSize: 24, color: colors.navy, marginTop: 4 },
  salesSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  cta: { backgroundColor: colors.orange, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  ctaText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginTop: 16 },
  notice: { fontFamily: fonts.medium, fontSize: 12, color: colors.orangeDark, marginTop: 6 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  menuGridTablet: { gap: 10 },
  menuCell: { width: '48%', backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.line },
  menuCellTablet: { width: '23%' },
  menuCellSoon: { opacity: 0.75 },
  menuTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  menuLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  menuSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  soonBadge: { backgroundColor: colors.paleAmber, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  soonText: { fontFamily: fonts.bold, fontSize: 10, color: colors.amberDark },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 8 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  legend: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, marginTop: 2, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '22%', borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cellText: { fontFamily: fonts.bold, fontSize: 13 },
  stockRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  stockName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  stockLeft: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  row: { flexDirection: 'row', gap: 16, marginTop: 14 },
  sync: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, marginTop: 14, textAlign: 'center' },
});
