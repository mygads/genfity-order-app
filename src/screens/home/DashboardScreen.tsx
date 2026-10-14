import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenterLg } from '../../theme';
import { getSession, logout } from '../../session';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

const HOURS = [
  { h: '08', v: 50 }, { h: '09', v: 80 }, { h: '10', v: 110 },
  { h: '11', v: 140 }, { h: '12', v: 200 }, { h: '13', v: 160 }, { h: '14', v: 100 }, { h: '15', v: 70 },
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

const MENU: { label: string; sub: string; route: string }[] = [
  { label: 'Kasir', sub: 'Jual · 47 transaksi', route: 'Cashier' },
  { label: 'Riwayat', sub: 'Semua transaksi', route: 'History' },
  { label: 'Booking', sub: 'Reservasi · 3 aktif', route: 'Booking' },
  { label: 'Member', sub: '342 terdaftar', route: 'Member' },
  { label: 'Menu Custom', sub: 'Stasiun Bill', route: 'CustomMenu' },
  { label: 'Pratinjau Bill', sub: 'split', route: 'BillPreview' },
  { label: 'Laporan', sub: 'Shift & kas', route: 'Recap' },
  { label: 'Batal / Void', sub: 'void', route: 'Cancel' },
  { label: 'Pengaturan', sub: 'Printer · sinkron', route: 'Settings' },
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
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.top}>
        <View>
          <Text style={styles.branch}>{s?.outlet ?? 'ESB Cabang Poris'}</Text>
          <Text style={styles.cashier}>Kasir {s?.name ?? 'Gista'} | Shift Buka ✓</Text>
        </View>
        <View style={styles.online}>
          <Text style={styles.onlineText}>Online</Text>
        </View>
      </View>
      <Text style={styles.shiftLine}>
        {s?.shift ?? 'Shift Pagi'} Buka · Kas {rp(s?.cash ?? 200000)} · Masuk {s?.clockIn ?? '08:57'}
      </Text>
      <View style={styles.row}>
        <TouchableOpacity onPress={() => navigation?.navigate('Attendance')}>
          <Text style={styles.link}>Absensi ›</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { logout(); navigation?.navigate('Login'); }}>
          <Text style={styles.link}>Keluar ›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.kpis}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Omzet Hari Ini</Text>
          <Text style={styles.kpiValue}>{rp(1284500)}</Text>
          <Text style={styles.kpiUp}>▲ 12% vs kemarin</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Transaksi</Text>
          <Text style={styles.kpiValue}>47</Text>
          <Text style={styles.kpiSub}>rata-rata Rp 27.329</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Meja Terisi</Text>
          <Text style={styles.kpiValue}>6 / 14</Text>
          <Text style={styles.kpiSub}>3 reservasi aktif</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.cta} onPress={() => navigation?.navigate('Cashier')}>
        <Text style={styles.ctaText}>+ Transaksi Baru</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Penjualan per Jam</Text>
        <Text style={styles.cardSub}>Hari ini · ■ oranye = hari ini · □ abu = kemarin · puncak 12:00</Text>
      <View style={styles.chartRow}>
        <View style={styles.yAxis}>
          <Text style={styles.yLabel}>200rb</Text>
          <Text style={styles.yLabel}>100rb</Text>
          <Text style={styles.yLabel}>0</Text>
        </View>
        <View style={styles.chartBody}>
          <View style={styles.gridLines} pointerEvents="none">
            <View style={styles.gridLine} />
            <View style={styles.gridLine} />
            <View style={styles.gridLine} />
          </View>
          <View style={styles.bars}>
            {HOURS.map((b) => (
              <View key={b.h} style={styles.barCol}>
                <Text style={styles.barVal}>{b.v}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${Math.round((b.v / 200) * 100)}%` }]} />
                </View>
                <Text style={styles.barH}>{b.h}</Text>
              </View>
            ))}
          </View>
          <View style={styles.xAxis} />
          <Text style={styles.axisNote}>Jam (WIB) · satuan ribu rupiah · puncak 12:00</Text>
        </View>
      </View>
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
          <TouchableOpacity onPress={() => navigation?.navigate('CustomMenu')}>
            <Text style={styles.link}>Kelola menu ›</Text>
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

      <Text style={styles.cardTitle}>Menu</Text>
      <View style={[styles.menuGrid, isTablet && styles.menuGridTablet]}>
        {MENU.map((m) => (
          <TouchableOpacity key={m.label} style={[styles.menuCell, isTablet && styles.menuCellTablet]} onPress={() => navigation?.navigate(m.route)}>
            <Text style={styles.menuLabel}>{m.label}</Text>
            <Text style={styles.menuSub}>{m.sub}</Text>
          </TouchableOpacity>
        ))}
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
  shiftLine: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 6 },
  row: { flexDirection: 'row', gap: 16, marginTop: 6 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  kpis: { flexDirection: 'row', gap: 8, marginTop: 14 },
  kpi: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.line },
  kpiLabel: { fontFamily: fonts.medium, fontSize: 11, color: colors.faint },
  kpiValue: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 4 },
  kpiUp: { fontFamily: fonts.semibold, fontSize: 11, color: colors.greenDark, marginTop: 4 },
  kpiSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginTop: 4 },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 8 },
  bars: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 6 },
  barCol: { flex: 1, alignItems: 'center' },
  barVal: { fontFamily: fonts.semibold, fontSize: 10, color: colors.muted, marginBottom: 3 },
  barTrack: { height: 90, width: '100%', backgroundColor: colors.bg, borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { backgroundColor: colors.orange, borderRadius: 6, width: '100%' },
  barH: { fontFamily: fonts.medium, fontSize: 11, color: colors.faint, marginTop: 4 },
  chartRow: { flexDirection: 'row', marginTop: 6 },
  yAxis: { justifyContent: 'space-between', paddingBottom: 26, marginRight: 6 },
  yLabel: { fontFamily: fonts.medium, fontSize: 10, color: colors.faint, textAlign: 'right' },
  chartBody: { flex: 1 },
  gridLines: { position: 'absolute', top: 0, left: 0, right: 0, height: 90, justifyContent: 'space-between' },
  gridLine: { borderTopWidth: 1, borderTopColor: colors.line, opacity: 0.7 },
  xAxis: { height: 1, backgroundColor: colors.faint, marginTop: 0 },
  axisNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '22%', borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cellText: { fontFamily: fonts.bold, fontSize: 13 },
  stockRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  stockName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  stockLeft: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  menuGridTablet: { gap: 10 },
  menuCell: { width: '48%', backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.line },
  menuCellTablet: { width: '23%' },
  menuLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  menuSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  cta: { backgroundColor: colors.orange, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  ctaText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  legend: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, marginTop: 2, marginBottom: 8 },
  sync: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, marginTop: 14, textAlign: 'center' },
});
