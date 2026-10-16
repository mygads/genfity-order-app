import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { useLang } from '../../lib/i18n';
import { enqueueSync } from '../../lib/sync';
import { initDb, query } from '../../lib/db';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { from?: string } } };

type Occupied = { table: string; guest: string; items: number; total: number };
/** Kanonis mengikuti TablesScreen: no tanpa strip (A1/A2/B1, bukan A-03) + section Dalam/Teras/VIP. */
const SECTION_OF: Record<string, string> = {
  A1: 'Dalam', A2: 'Dalam', A3: 'Dalam', A4: 'Dalam',
  B1: 'Teras', B2: 'Teras', B3: 'Teras',
  C1: 'VIP', C2: 'VIP',
};
const OCCUPIED: Occupied[] = [
  { table: 'A2', guest: 'Budi · 2 tamu', items: 3, total: 185000 },
  { table: 'B1', guest: 'Andi · 4 tamu', items: 4, total: 96000 },
  { table: 'B2', guest: 'B2+B3 · 12 tamu', items: 8, total: 320000 },
];
const EMPTY = [
  'A1 (Dalam · 2 kursi)',
  'A3 (Dalam · 4 kursi)',
  'A4 (Dalam · 4 kursi)',
  'B3 (Teras · 6 kursi)',
  'C1 (VIP · 2 kursi)',
  'C2 (VIP · 8 kursi)',
];

/**
 * Pindah Meja (move_table) - pindah seluruh transaksi ke meja lain.
 * Daftarkan route: MoveTable.
 */
/** Normalisasi kode lama ber-strip ("A-03" → "A3") ke kanonis tanpa strip. */
function canonTableNo(raw: string): string {
  const t = (raw || '').trim().toUpperCase().replace(/\s*\(.*\)\s*$/, '').trim();
  const m = t.match(/^([A-Z]+)-?0*(\d+)$/);
  if (m) return `${m[1]}${m[2]}`;
  return t.replace(/-/g, '');
}
export default function MoveTableScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const { t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [from, setFrom] = useState(() => canonTableNo(route?.params?.from ?? OCCUPIED[0]?.table ?? 'A2'));
  const [to, setTo] = useState(EMPTY[0] as string);
  const [done, setDone] = useState(false);
  // T7: katalog live dari SQLite (bill aktif + ms_table); konstanta di atas
  // hanya fallback saat DB kosong (instalasi baru / belum ada bill terbuka).
  const [liveOcc, setLiveOcc] = useState<Occupied[] | null>(null);
  const [liveEmpty, setLiveEmpty] = useState<string[] | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        await initDb();
        const heads = await query<{ tableNo: string; customerName: string | null; grandTotal: number | null }>(
          `SELECT tableNo, customerName, grandTotal FROM tr_saleshead
           WHERE status <> 'paid' AND tableNo IS NOT NULL AND TRIM(tableNo) <> ''`,
        );
        if (!on || heads.length === 0) return;
        const byTable = new Map<string, { guest: string; bills: number; total: number }>();
        for (const h of heads) {
          const tb = h.tableNo.trim();
          const cur = byTable.get(tb) ?? { guest: '', bills: 0, total: 0 };
          cur.bills += 1;
          cur.total += Number(h.grandTotal) || 0;
          if (!cur.guest) cur.guest = (h.customerName || '').trim();
          byTable.set(tb, cur);
        }
        const itemRows = await query<{ tableNo: string; n: number }>(
          `SELECT h.tableNo AS tableNo, COUNT(*) AS n FROM tr_salesmenu m
           INNER JOIN tr_saleshead h ON h.salesNum = m.salesNum
           WHERE h.status <> 'paid' AND h.tableNo IS NOT NULL AND TRIM(h.tableNo) <> ''
           GROUP BY h.tableNo`,
        );
        const itemCount = new Map(itemRows.map((r) => [String(r.tableNo).trim(), Number(r.n) || 0]));
        const occ: Occupied[] = [...byTable.entries()].map(([table, v]) => ({
          table,
          guest: v.guest || 'Tamu',
          items: itemCount.get(table) ?? v.bills,
          total: Math.round(v.total),
        }));
        let empty: string[] | null = null;
        try {
          const tRows = await query<{ id: string; tableNo: string | null }>(
            'SELECT id, tableNo FROM ms_table LIMIT 60',
          );
          if (tRows.length > 0) {
            const busy = new Set(occ.map((o) => o.table));
            const free = tRows
              .map((r) => ((r.tableNo || r.id) || '').trim())
              .filter((no) => no && !busy.has(no));
            if (free.length > 0) empty = free;
          }
        } catch {
          /* ms_table kosong - fallback konstanta */
        }
        if (!on) return;
        setLiveOcc(occ);
        setLiveEmpty(empty);
        setFrom((prev) => (occ.some((o) => o.table === prev) ? prev : occ[0].table));
        if (empty) setTo((prev) => (empty.includes(prev) ? prev : empty[0]));
      } catch {
        /* SQLite belum siap - fallback konstanta tetap tampil */
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  const occupied = liveOcc ?? OCCUPIED;
  const emptyList = liveEmpty ?? EMPTY;
  const src = occupied.find((o) => o.table === from);
  /** Kode meja dari label "A1 (Dalam · 2 kursi)" ke "A1" (dulu split(' ')[0] yang rapuh). */
  const destCode = to.replace(/\s*\(.*\)\s*$/, '').trim();

  const move = () => {
    if (!src) return;
    // Catat pindah meja ke antrean sync agar diteruskan ke server (offline-first).
    try {
      enqueueSync('other', {
        op: 'move-table', from: src.table, to: destCode, total: src.total,
        at: new Date().toISOString(),
      });
    } catch {
      /* antrean belum siap - status lokal di bawah tetap diubah */
    }
    setDone(true);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('title_move_table')}
        onBack={() => navigation?.goBack()}
        right={
          <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <Text style={styles.hint}>{t('mov_hint_table')}</Text>
        <Text style={styles.label}>Dari meja (terisi)</Text>
        <View style={styles.chips}>
          {occupied.map((o) => (
            <TouchableOpacity
              key={o.table}
              style={[styles.chip, from === o.table && styles.chipOn]}
              onPress={() => { setFrom(o.table); setDone(false); }}>
              <Text style={[styles.chipT, from === o.table && styles.chipTOn]}>{o.table}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {src && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Meja {src.table}{SECTION_OF[src.table] ? ` · ${SECTION_OF[src.table]}` : ''} · {src.guest}</Text>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Item</Text>
              <Text style={styles.cardVal}>{src.items} item</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Total berjalan</Text>
              <Text style={styles.cardVal}>{rp(src.total)}</Text>
            </View>
          </View>
        )}

        <Text style={styles.label}>Ke meja (kosong)</Text>
        <View style={styles.chips}>
          {emptyList.map((tb) => (
            <TouchableOpacity key={tb} style={[styles.chip, to === tb && styles.chipOn]} onPress={() => setTo(tb)}>
              <Text style={[styles.chipT, to === tb && styles.chipTOn]}>{tb}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {done && src ? (
          <Text style={styles.done}>Transaksi {src.table} ({rp(src.total)}) dipindahkan ke {to}.</Text>
        ) : null}

        <TouchableOpacity style={styles.primary} onPress={move}>
          <Text style={styles.primaryT}>{t('mov_do_table')} ›</Text>
        </TouchableOpacity>
        <View style={styles.links}>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}>
            <Text style={styles.link}>Lihat Denah Meja ›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Cashier', { table: destCode })}>
            <Text style={styles.link}>Buka di Kasir ›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <DrawerMenu
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigate={(r) => {
          navigation?.navigate(r);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  burger: { width: 22, height: 22 },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  cardLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  cardVal: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  done: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark, marginTop: 12 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
});
