import { useMemo, useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type LogLevel = 'Info' | 'Peringatan' | 'Error';

interface AppLog {
  id: string;
  time: string;
  level: LogLevel;
  tag: string;
  message: string;
  detail: string;
}

const LOGS: AppLog[] = [
  { id: 'l1', time: '16 Okt 12:44', level: 'Info', tag: 'sync', message: 'Pull menu selesai — 68 item', detail: 'Endpoint v1/pull/menu · 68 baris · watermark pullDateTime diperbarui ke 16 Okt 2026 12:44. Tidak ada konflik harga.' },
  { id: 'l2', time: '16 Okt 12:40', level: 'Info', tag: 'sales', message: 'TRX-20261016-014 tersimpan antre', detail: 'Subtotal Rp 61.000 · service Rp 3.050 · total Rp 64.050 · Tunai. syncDate=NULL → menunggu push.' },
  { id: 'l3', time: '16 Okt 12:31', level: 'Peringatan', tag: 'printer', message: 'Printer Dapur tidak menjawab', detail: 'TCP 192.168.1.50:9100 timeout 5 dtk saat kirim tiket T-014. Tiket ditahan di antrean cetak, coba lagi dari Tiket Dapur.' },
  { id: 'l4', time: '16 Okt 11:58', level: 'Error', tag: 'sync', message: 'Push expense gagal (2x)', detail: 'POST v1/push/branch-expenses → timeout. Item q3 ditandai gagal, akan dicoba pada push berikutnya. Data lokal aman.' },
  { id: 'l5', time: '16 Okt 08:57', level: 'Info', tag: 'shift', message: 'Shift Pagi dibuka', detail: 'Kasir Gista · kas awal Rp 200.000 · terminal TRM-001 · cabang BR-01.' },
  { id: 'l6', time: '15 Okt 19:02', level: 'Info', tag: 'display', message: 'Display pelanggan memanggil A-03', detail: 'Event call → tiket A-03 dipindah ke Siap Diambil. disiarkan lokal + WS bila tersedia.' },
];

const filters = ['Semua', 'Info', 'Peringatan', 'Error'] as const;

function levelStyle(l: LogLevel) {
  if (l === 'Error') return { bg: colors.paleRed, fg: colors.red };
  if (l === 'Peringatan') return { bg: colors.paleAmber, fg: colors.amberDark };
  return { bg: colors.paleBlue, fg: colors.navy };
}

export default function LogScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [filter, setFilter] = useState<(typeof filters)[number]>('Semua');
  const [selected, setSelected] = useState<AppLog | null>(null);

  const list = useMemo(() => LOGS.filter((l) => filter === 'Semua' || l.level === filter), [filter]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Log Aplikasi</Text>
        <Text style={styles.headerSub}>Kejadian sync · cetak · shift · display</Text>
      </View>
      <View style={styles.tabs}>
        {filters.map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.tab, filter === f && styles.tabActive]}>
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={list}
        keyExtractor={(l) => l.id}
        contentContainerStyle={[styles.list, isTablet && wideCenter]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image source={require('../../../assets/images/empty_general.webp')} style={styles.emptyImg} resizeMode="contain" />
            <Text style={styles.emptyTitle}>Tidak ada log</Text>
            <Text style={styles.emptySub}>Belum ada kejadian pada filter ini</Text>
          </View>
        }
        renderItem={({ item }) => {
          const s = levelStyle(item.level);
          return (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <View style={styles.cardTop}>
                <View style={[styles.badge, { backgroundColor: s.bg }]}>
                  <Text style={[styles.badgeText, { color: s.fg }]}>{item.level}</Text>
                </View>
                <Text style={styles.time}>{item.time}</Text>
              </View>
              <Text style={styles.msg}>{item.message}</Text>
              <Text style={styles.tag}>#{item.tag} · ketuk utk detail ›</Text>
            </Pressable>
          );
        }}
      />
      <Modal visible={selected !== null} animationType="slide" transparent>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {selected ? (
              <>
                <Text style={styles.sheetTitle}>Detail Log</Text>
                <Text style={styles.detailTime}>{selected.time} · #{selected.tag} · {selected.level}</Text>
                <Text style={styles.detailMsg}>{selected.message}</Text>
                <Text style={styles.detailBody}>{selected.detail}</Text>
                <Pressable style={styles.btnPrimary} onPress={() => setSelected(null)}>
                  <Text style={styles.btnPrimaryText}>Tutup</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 16, paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontFamily: fonts.bold, fontSize: 11 },
  time: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint },
  msg: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, marginTop: 8 },
  tag: { fontFamily: fonts.regular, fontSize: 11, color: colors.orangeDark, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyImg: { width: 180, height: 140 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 12 },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '80%' },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  detailTime: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, marginTop: 4 },
  detailMsg: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, marginTop: 8 },
  detailBody: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 8 },
  btnPrimary: { borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  btnPrimaryText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
