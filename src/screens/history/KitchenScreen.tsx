import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, wideCenterLg } from '../../theme';
import {
  kitchenTickets,
  type KitchenStatus,
  type KitchenTicket,
} from '../../data/mock';

const filters = ['Semua', 'Baru', 'Diproses', 'Selesai'] as const;

function statusStyle(s: KitchenStatus) {
  if (s === 'Baru') return { bg: colors.red, fg: colors.white, label: 'BARU' };
  if (s === 'Diproses') return { bg: colors.orange, fg: colors.white, label: 'DIMASAK' };
  return { bg: colors.green, fg: colors.white, label: 'SELESAI' };
}

const NEXT: Record<KitchenStatus, KitchenStatus | null> = {
  Baru: 'Diproses',
  Diproses: 'Selesai',
  Selesai: null,
};

const NEXT_LABEL: Record<KitchenStatus, string> = {
  Baru: 'Mulai Masak',
  Diproses: 'Selesai',
  Selesai: '',
};

export default function KitchenScreen({ navigation }: { navigation?: { navigate: (s: string, p?: object) => void } }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [filter, setFilter] = useState<(typeof filters)[number]>('Semua');
  const [selected, setSelected] = useState<KitchenTicket | null>(null);
  const [moved, setMoved] = useState<Record<string, KitchenStatus>>({});

  const list = useMemo(
    () =>
      kitchenTickets
        .map((t) => ({ ...t, status: moved[t.id] ?? t.status }))
        .filter((t) => filter === 'Semua' || t.status === filter),
    [filter, moved],
  );

  const advance = (t: KitchenTicket) => {
    const next = NEXT[moved[t.id] ?? t.status];
    if (!next) return;
    setMoved((m) => ({ ...m, [t.id]: next }));
    setSelected((sel) => (sel && sel.id === t.id ? { ...sel, status: next } : sel));
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Tiket Dapur</Text>
        <Text style={styles.headerSub}>Kitchen Display • {list.length} tiket</Text>
      </View>

      <View style={styles.tabs}>
        {filters.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.tab, filter === f && styles.tabActive]}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={list}
        keyExtractor={(t) => t.id}
        contentContainerStyle={[styles.list, isTablet && wideCenterLg]}
        numColumns={2}
        columnWrapperStyle={styles.row}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Tidak ada tiket</Text>
            <Text style={styles.emptySub}>Semua pesanan dapur sudah selesai</Text>
          </View>
        }
        renderItem={({ item }) => {
          const s = statusStyle(item.status);
          return (
            <Pressable
              style={[styles.ticket, item.priority && styles.ticketPriority]}
              onPress={() => setSelected(item)}
            >
              <View style={styles.ticketTop}>
                <Text style={styles.ticketNo}>{item.no}</Text>
                <View style={[styles.badge, { backgroundColor: s.bg }]}>
                  <Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text>
                </View>
              </View>
              <Text style={styles.ticketTable}>
                {item.table} • {item.mode}
              </Text>
              <Text style={styles.ticketTime}>
                {item.time} • {item.elapsed}
              </Text>
              <View style={styles.ticketDiv} />
              {item.items.map((it, idx) => (
                <Text key={idx} style={styles.ticketItem}>
                  {it.qty}x {it.name}
                </Text>
              ))}
              {item.priority ? (
                <Text style={styles.priority}>★ Prioritas</Text>
              ) : null}
            </Pressable>
          );
        }}
      />

      <Modal visible={selected !== null} animationType="slide" transparent>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {selected && (
              <>
                <View style={styles.sheetTop}>
                  <Text style={styles.sheetTitle}>
                    Tiket {selected.no} • {selected.table}
                  </Text>
                  <Text style={styles.sheetTime}>
                    {selected.time} • {selected.elapsed}
                  </Text>
                </View>
                <View style={styles.divider} />
                {selected.items.map((it, idx) => (
                  <View key={idx} style={styles.detailItem}>
                    <Text style={styles.detailQty}>{it.qty}x</Text>
                    <View style={styles.detailLeft}>
                      <Text style={styles.detailName}>{it.name}</Text>
                      {it.note ? (
                        <Text style={styles.detailNote}>Catatan: {it.note}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
                <View style={styles.sheetBtns}>
                  <Pressable style={styles.btnGhost} onPress={() => setSelected(null)}>
                    <Text style={styles.btnGhostText}>Tutup</Text>
                  </Pressable>
                  <Pressable
                    style={styles.btnPrint}
                    onPress={() => {
                      const s = selected;
                      setSelected(null);
                      navigation?.navigate('Receipt', { no: s?.no, total: s ? s.items.reduce((a, i) => a + i.qty, 0) * 15000 : 0 });
                    }}>
                    <Text style={styles.btnPrintText}>Cetak Ulang</Text>
                  </Pressable>
                  {NEXT[selected.status] && (
                    <Pressable
                      style={styles.btnNext}
                      onPress={() => advance(selected)}
                    >
                      <Text style={styles.btnNextText}>{NEXT_LABEL[selected.status]}</Text>
                    </Pressable>
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
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { gap: 10 },
  ticket: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ticketPriority: { borderColor: colors.red, borderWidth: 1.5 },
  ticketTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ticketNo: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: fonts.bold, fontSize: 10 },
  ticketTable: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 6 },
  ticketTime: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, marginTop: 2 },
  ticketDiv: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  ticketItem: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginBottom: 3 },
  priority: { fontFamily: fonts.bold, fontSize: 11, color: colors.red, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60, flex: 1 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.line,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  sheetTime: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  detailItem: { flexDirection: 'row', marginBottom: 10 },
  detailQty: { fontFamily: fonts.bold, fontSize: 15, color: colors.orange, width: 36 },
  detailLeft: { flex: 1 },
  detailName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  detailNote: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.orangeDark,
    fontStyle: 'italic',
    marginTop: 2,
  },
  sheetBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btnGhost: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  btnPrint: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.navy,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnPrintText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnNext: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.green,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnNextText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
