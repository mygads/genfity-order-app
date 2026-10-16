import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, rp, wideCenterLg } from '../../theme';
import { esbOrders, type EsbOrder, type EsbStatus } from '../../data/mock';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

const tabs = ['Baru', 'Diproses', 'Selesai'] as const;
const typeFilters = ['Semua', 'Diantar', 'Ambil Sendiri'] as const;
const historyFilters = ['Hari ini', 'Kemarin', '7 hari'] as const;

/** Jadwal mock per order (waktu diminta pelanggan). */
const SCHEDULE: Record<string, string> = {
  esb1: 'Segera · maks 13:00',
  esb2: 'Terjadwal · 13:30',
  esb3: 'Segera · maks 12:15',
  esb4: 'Selesai 11:05',
};

const PLATFORM_FEE_RATE = 0.05;

function badgeStyle(s: EsbStatus) {
  if (s === 'Baru') return { bg: colors.paleOrange, fg: colors.orange };
  if (s === 'Diproses') return { bg: colors.paleBlue, fg: colors.navy };
  return { bg: colors.paleGreen, fg: colors.green };
}

function typeStyle(t: string) {
  return t === 'Diantar'
    ? { bg: colors.paleBlue, fg: colors.blueDark, label: 'Delivery' }
    : { bg: colors.paleGreen, fg: colors.greenDark, label: 'Pickup' };
}

export default function EsbOrderScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [tab, setTab] = useState<(typeof tabs)[number]>('Baru');
  const [typeFilter, setTypeFilter] = useState<(typeof typeFilters)[number]>('Semua');
  const [history, setHistory] = useState<(typeof historyFilters)[number]>('Hari ini');
  const [selected, setSelected] = useState<EsbOrder | null>(null);
  const [moved, setMoved] = useState<Record<string, EsbStatus>>({});

  const withMoved = useMemo(
    () => esbOrders.map((o) => ({ ...o, status: moved[o.id] ?? o.status })),
    [moved],
  );

  const counts = useMemo(() => ({
    Baru: withMoved.filter((o) => o.status === 'Baru').length,
    Diproses: withMoved.filter((o) => o.status === 'Diproses').length,
    Selesai: withMoved.filter((o) => o.status === 'Selesai').length,
  }), [withMoved]);

  const list = useMemo(
    () => withMoved.filter(
      (o) => o.status === tab && (typeFilter === 'Semua' || o.type === typeFilter),
    ),
    [withMoved, tab, typeFilter],
  );

  const setStatus = (id: string, s: EsbStatus) => {
    setMoved((m) => ({ ...m, [id]: s }));
    setSelected((sel) => (sel && sel.id === id ? { ...sel, status: s } : sel));
  };

  const feeOf = (total: number) => Math.round(total * PLATFORM_FEE_RATE);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>ESB Order</Text>
        <Text style={styles.headerSub}>Dashboard pesanan online · {history}</Text>
        <View style={styles.statRow}>
          {(Object.keys(counts) as EsbStatus[]).map((k) => (
            <View key={k} style={styles.stat}>
              <Text style={styles.statNum}>{counts[k]}</Text>
              <Text style={styles.statLabel}>{k}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.tabs}>
        {tabs.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t} ({counts[t]})
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.filterRow}>
        <View style={styles.typeRow}>
          {typeFilters.map((t) => (
            <Pressable key={t} onPress={() => setTypeFilter(t)} style={[styles.miniTab, typeFilter === t && styles.miniTabActive]}>
              <Text style={[styles.miniText, typeFilter === t && styles.miniTextActive]}>
                {t === 'Semua' ? 'Semua' : t === 'Diantar' ? 'Delivery' : 'Pickup'}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.typeRow}>
          {historyFilters.map((h) => (
            <Pressable key={h} onPress={() => setHistory(h)} style={[styles.miniTab, history === h && styles.miniTabActive]}>
              <Text style={[styles.miniText, history === h && styles.miniTextActive]}>{h}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(o) => o.id}
        contentContainerStyle={[styles.list, isTablet && wideCenterLg]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image source={require('../../../assets/images/empty_order.webp')} style={styles.emptyImg} resizeMode="contain" />
            <Text style={styles.emptyTitle}>Belum Ada Pesanan {tab}</Text>
            <Text style={styles.emptySub}>Pesanan online baru akan muncul di sini</Text>
          </View>
        }
        renderItem={({ item }) => {
          const b = badgeStyle(item.status);
          const t = typeStyle(item.type);
          return (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardCode}>{item.code}</Text>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: t.bg }]}>
                    <Text style={[styles.badgeText, { color: t.fg }]}>{t.label}</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: b.bg }]}>
                    <Text style={[styles.badgeText, { color: b.fg }]}>{item.status}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.cardName}>{item.customer}</Text>
              <Text style={styles.cardMeta}>
                {item.type} • {item.time} • {item.items.reduce((a, i) => a + i.qty, 0)} item
              </Text>
              <Text style={styles.schedule}>Jadwal: {SCHEDULE[item.id] ?? 'Segera'}</Text>
              <View style={styles.cardBottom}>
                <Text style={styles.cardTotal}>{rp(item.total)}</Text>
                <Text style={styles.link}>Lihat Pesanan ›</Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal visible={selected !== null} animationType="slide" transparent>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Detail Transaksi</Text>
            {selected && (
              <>
                <Text style={styles.detailCode}>{selected.code}</Text>
                <Text style={styles.detailMeta}>{selected.customer} • {selected.phone}</Text>
                <Text style={styles.detailMeta}>
                  {selected.type} ({typeStyle(selected.type).label}) • Masuk {selected.time}
                </Text>
                <Text style={styles.detailMeta}>Jadwal: {SCHEDULE[selected.id] ?? 'Segera'}</Text>
                {selected.note ? <Text style={styles.detailNote}>Catatan: {selected.note}</Text> : null}
                <View style={styles.divider} />
                {selected.items.map((it, idx) => (
                  <View key={idx} style={styles.itemRow}>
                    <View style={styles.itemLeft}>
                      <Text style={styles.itemName}>{it.qty}x {it.name}</Text>
                      {it.note ? <Text style={styles.itemNote}>{it.note}</Text> : null}
                    </View>
                    <Text style={styles.itemPrice}>{rp(it.qty * it.price)}</Text>
                  </View>
                ))}
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Subtotal</Text>
                  <Text style={styles.rowVal}>{rp(selected.total)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Biaya platform (5%)</Text>
                  <Text style={styles.rowVal}>{rp(feeOf(selected.total))}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Total</Text>
                  <Text style={styles.rowTotal}>{rp(selected.total)}</Text>
                </View>
                <View style={styles.sheetBtns}>
                  {selected.status === 'Baru' && (
                    <>
                      <Pressable style={styles.btnReject} onPress={() => setStatus(selected.id, 'Selesai')}>
                        <Text style={styles.btnRejectText}>Tolak</Text>
                      </Pressable>
                      <Pressable style={styles.btnAccept} onPress={() => setStatus(selected.id, 'Diproses')}>
                        <Text style={styles.btnAcceptText}>Terima Pesanan</Text>
                      </Pressable>
                    </>
                  )}
                  {selected.status === 'Diproses' && (
                    <>
                      <Pressable
                        style={styles.btnGhost}
                        onPress={() => {
                          const s = selected;
                          setSelected(null);
                          navigation?.navigate('Receipt', { total: s?.total ?? 0 });
                        }}>
                        <Text style={styles.btnGhostText}>Cetak</Text>
                      </Pressable>
                      <Pressable style={styles.btnAccept} onPress={() => setStatus(selected.id, 'Selesai')}>
                        <Text style={styles.btnAcceptText}>Selesaikan</Text>
                      </Pressable>
                    </>
                  )}
                  {selected.status === 'Selesai' && (
                    <>
                      <Pressable style={styles.btnGhost} onPress={() => setSelected(null)}>
                        <Text style={styles.btnGhostText}>Tutup</Text>
                      </Pressable>
                      <Pressable
                        style={styles.btnPrint}
                        onPress={() => {
                          const s = selected;
                          setSelected(null);
                          navigation?.navigate('Receipt', { total: s?.total ?? 0 });
                        }}>
                        <Text style={styles.btnPrintText}>Cetak</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </>
            )}
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
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 2 },
  statRow: { flexDirection: 'row', marginTop: 12, gap: 10 },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  statNum: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  statLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.navyTint, marginTop: 2 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  tabActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  tabText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  filterRow: { paddingHorizontal: 16, paddingBottom: 4 },
  typeRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  miniTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  miniTabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  miniText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  miniTextActive: { color: colors.white },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCode: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  badgeRow: { flexDirection: 'row', gap: 6 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: fonts.bold, fontSize: 11 },
  cardName: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, marginTop: 6 },
  cardMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  schedule: { fontFamily: fonts.medium, fontSize: 12, color: colors.orangeDark, marginTop: 2 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  cardTotal: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  link: { fontFamily: fonts.bold, fontSize: 12, color: colors.orange },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyImg: { width: 180, height: 140 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 12 },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '88%' },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  detailCode: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginTop: 6 },
  detailMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  detailNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.orangeDark, fontStyle: 'italic', marginTop: 6 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  itemLeft: { flex: 1, paddingRight: 12 },
  itemName: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  itemNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, fontStyle: 'italic' },
  itemPrice: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  rowLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  rowVal: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  rowTotal: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  sheetBtns: { flexDirection: 'row', gap: 8, marginTop: 16 },
  btnGhost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: 'center' },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  btnAccept: { flex: 2, borderRadius: 10, backgroundColor: colors.green, paddingVertical: 12, alignItems: 'center' },
  btnAcceptText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnReject: { flex: 1, borderRadius: 10, backgroundColor: colors.paleRed, paddingVertical: 12, alignItems: 'center' },
  btnRejectText: { fontFamily: fonts.bold, fontSize: 13, color: colors.red },
  btnPrint: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center' },
  btnPrintText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
