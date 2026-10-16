import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { useLang } from '../../lib/i18n';
import { enqueueSync } from '../../lib/sync';
import { initDb, query } from '../../lib/db';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { from?: string } } };

type MoveItem = { id: string; name: string; qty: number; price: number };

/** Kanonis mengikuti TablesScreen: no tanpa strip (A1/A2/B1) + section Dalam/Teras/VIP. */
const SECTION_OF: Record<string, string> = {
  A1: 'Dalam', A2: 'Dalam', A3: 'Dalam', A4: 'Dalam',
  B1: 'Teras', B2: 'Teras', B3: 'Teras',
  C1: 'VIP', C2: 'VIP',
};
const SOURCE: Record<string, MoveItem[]> = {
  A2: [
    { id: 'm1', name: 'Sudirman Coffee', qty: 2, price: 12900 },
    { id: 'm2', name: 'Lele goreng kremes', qty: 2, price: 15000 },
    { id: 'm3', name: 'Es Teh Manis', qty: 1, price: 8000 },
  ],
  'B1': [
    { id: 'm4', name: 'Ayam Geprek', qty: 1, price: 18000 },
    { id: 'm5', name: 'Jus Alpukat', qty: 1, price: 15000 },
  ],
};

const DESTS = ['A1 (kosong)', 'A3 (kosong)', 'A4 (kosong)', 'C1 (kosong)', 'B1 (terisi)'];

/** Normalisasi kode lama ber-strip ("A-03" → "A3") ke kanonis tanpa strip. */
function canonTableNo(raw: string): string {
  const t = (raw || '').trim().toUpperCase().replace(/\s*\(.*\)\s*$/, '').trim();
  const m = t.match(/^([A-Z]+)-?0*(\d+)$/);
  if (m) return `${m[1]}${m[2]}`;
  return t.replace(/-/g, '');
}

/**
 * Pindah Item (move_items) - pilih sumber, lalu item, lalu tujuan.
 * Daftarkan route: MoveItems.
 */
export default function MoveItemsScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const { t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // T7: katalog live dari SQLite (bill aktif per meja + ms_table); konstanta
  // SOURCE/DESTS hanya fallback saat DB kosong (instalasi baru / kasir web).
  const [liveSource, setLiveSource] = useState<Record<string, MoveItem[]> | null>(null);
  const [liveDests, setLiveDests] = useState<string[] | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        await initDb();
        const tables = await query<{ tableNo: string }>(
          `SELECT DISTINCT tableNo FROM tr_saleshead
           WHERE status <> 'paid' AND tableNo IS NOT NULL AND TRIM(tableNo) <> ''`,
        );
        const names = tables.map((r) => r.tableNo.trim()).filter(Boolean);
        if (!on || names.length === 0) return;
        const catalog: Record<string, MoveItem[]> = {};
        for (const tb of names) {
          const rows = await query<{ id: string | null; name: string | null; qty: number | null; price: number | null }>(
            `SELECT m.menuId AS id, m.menuName AS name, SUM(m.qty) AS qty, m.price AS price
             FROM tr_salesmenu m INNER JOIN tr_saleshead h ON h.salesNum = m.salesNum
             WHERE h.status <> 'paid' AND h.tableNo = ?
             GROUP BY m.menuId, m.menuName, m.price`,
            [tb],
          );
          const items = rows
            .map((r, i) => ({
              id: (r.id || `${tb}-${i}`).trim(),
              name: (r.name || '-').trim(),
              qty: Math.max(1, Math.round(Number(r.qty) || 0)),
              price: Math.round(Number(r.price) || 0),
            }))
            .filter((it) => it.qty > 0);
          if (items.length > 0) catalog[tb] = items;
        }
        if (!on || Object.keys(catalog).length === 0) return;
        let dests: string[] | null = null;
        try {
          const tRows = await query<{ id: string; tableNo: string | null }>(
            'SELECT id, tableNo FROM ms_table LIMIT 60',
          );
          if (tRows.length > 0) {
            const busy = new Set(Object.keys(catalog));
            const free = tRows
              .map((r) => ((r.tableNo || r.id) || '').trim())
              .filter((no) => no && !busy.has(no));
            dests = [
              ...free.map((no) => `${no} (kosong)`),
              ...Object.keys(catalog).map((no) => `${no} (terisi)`),
            ];
            if (dests.length === 0) dests = null;
          }
        } catch {
          /* ms_table kosong - fallback DESTS */
        }
        if (!on) return;
        setLiveSource(catalog);
        setLiveDests(dests);
        setFrom((prev) => (catalog[prev] ? prev : Object.keys(catalog)[0]));
        if (dests) setTo((prev) => (dests.includes(prev) ? prev : dests[0]));
        setPickedQty({});
      } catch {
        /* SQLite belum siap - fallback konstanta tetap tampil */
      }
    })();
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catalog = liveSource ?? SOURCE;
  const destList = liveDests ?? DESTS;
  const tables = useMemo(() => Object.keys(catalog), [catalog]);
  const [from, setFrom] = useState(() => canonTableNo(route?.params?.from ?? tables[0] ?? 'A2'));
  // qty yang dipilih untuk dipindah per item (mendukung pindah sebagian, mis. 2x pindah 1).
  const [pickedQty, setPickedQty] = useState<Record<string, number>>({});
  const [to, setTo] = useState(destList[0] as string);
  const [movedQty, setMovedQty] = useState<Record<string, number>>({});
  const [doneMsg, setDoneMsg] = useState('');

  const sourceItems = catalog[from] ?? [];
  const remaining = sourceItems
    .map((it) => ({ ...it, left: it.qty - (movedQty[it.id] ?? 0) }))
    .filter((it) => it.left > 0);
  const pickedItems = remaining
    .filter((it) => (pickedQty[it.id] ?? 0) > 0)
    .map((it) => ({ ...it, move: Math.min(pickedQty[it.id] ?? 0, it.left) }));
  const pickedTotal = pickedItems.reduce((s, it) => s + it.move * it.price, 0);
  const pickedCount = pickedItems.reduce((s, it) => s + it.move, 0);

  const toggle = (id: string) =>
    setPickedQty((m) => {
      if ((m[id] ?? 0) > 0) {
        const next = { ...m };
        delete next[id];
        return next;
      }
      const it = remaining.find((x) => x.id === id);
      return { ...m, [id]: it?.left ?? 1 };
    });

  const stepMoveQty = (id: string, d: number) =>
    setPickedQty((m) => {
      const it = remaining.find((x) => x.id === id);
      if (!it) return m;
      return { ...m, [id]: Math.min(it.left, Math.max(1, (m[id] ?? 1) + d)) };
    });

  const destOccupied = to.includes('(terisi)');

  const move = () => {
    if (pickedItems.length === 0) return;
    // Catat pindah item ke antrean sync agar diteruskan ke server (offline-first).
    try {
      enqueueSync('other', {
        op: 'move-items', from, to,
        items: pickedItems.map((it) => ({ id: it.id, name: it.name, qty: it.move, price: it.price })),
        total: pickedTotal, merge: destOccupied, at: new Date().toISOString(),
      });
    } catch {
      /* antrean belum siap - status lokal di bawah tetap diubah */
    }
    setMovedQty((m) => {
      const next = { ...m };
      for (const it of pickedItems) next[it.id] = (next[it.id] ?? 0) + it.move;
      return next;
    });
    setDoneMsg(
      `${pickedCount} pcs (${rp(pickedTotal)}) dipindahkan ${from} ke ${to}${destOccupied ? ' - digabung ke bill yang sudah ada' : ''}.`,
    );
    setPickedQty({});
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('title_move_items')}
        onBack={() => navigation?.goBack()}
        right={
          <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <Text style={styles.step}>1 · Pilih meja sumber</Text>
        <View style={styles.chips}>
          {tables.map((tb) => (
            <TouchableOpacity
              key={tb}
              style={[styles.chip, from === tb && styles.chipOn]}
              onPress={() => { setFrom(tb); setPickedQty({}); }}>
              <Text style={[styles.chipT, from === tb && styles.chipTOn]}>{tb}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.step}>2 · Pilih item dari {from}{SECTION_OF[from] ? ` · ${SECTION_OF[from]}` : ''}</Text>
        {remaining.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Image
              source={require('../../../assets/images/empty_order.webp')}
              style={styles.emptyImg}
              resizeMode="contain"
            />
            <Text style={styles.emptyT}>Semua item {from} sudah dipindahkan.</Text>
          </View>
        ) : (
          remaining.map((it) => {
            const sel = pickedQty[it.id] ?? 0;
            const on = sel > 0;
            return (
              <TouchableOpacity
                key={it.id}
                style={[styles.itemRow, on && styles.itemOn]}
                onPress={() => toggle(it.id)}>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Text style={styles.checkT}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.left}x {it.name}</Text>
                  <Text style={styles.itemPrice}>{rp(it.left * it.price)}</Text>
                </View>
                {on && (
                  <View style={styles.qtyRow}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => stepMoveQty(it.id, -1)}>
                      <Text style={styles.qtyT}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyN}>{sel}</Text>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => stepMoveQty(it.id, 1)}>
                      <Text style={styles.qtyT}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}

        <Text style={styles.step}>3 · Pilih meja tujuan</Text>
        <View style={styles.chips}>
          {destList.map((tb) => (
            <TouchableOpacity key={tb} style={[styles.chip, to === tb && styles.chipOn]} onPress={() => setTo(tb)}>
              <Text style={[styles.chipT, to === tb && styles.chipTOn]}>{tb}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.summary}>
          <Text style={styles.sumTitle}>Ringkasan pindah</Text>
          <Text style={styles.sumLine}>
            {pickedItems.length === 0
              ? 'Belum ada item dipilih.'
              : `${pickedCount} pcs · ${rp(pickedTotal)} · ${from} ke ${to}${destOccupied ? ' (gabung)' : ''}`}
          </Text>
          {doneMsg ? <Text style={styles.done}>{doneMsg}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.primary, pickedItems.length === 0 && styles.off]}
          disabled={pickedItems.length === 0}
          onPress={move}>
          <Text style={styles.primaryT}>{t('mov_do_items')} ›</Text>
        </TouchableOpacity>
        <View style={styles.links}>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}>
            <Text style={styles.link}>Lihat Denah Meja ›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Cashier')}>
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
  step: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy, marginTop: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1.5, borderColor: colors.line },
  itemOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  checkOn: { borderColor: colors.orange, backgroundColor: colors.orange },
  checkT: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  itemName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  itemPrice: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.orange, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  qtyT: { color: colors.orangeDark, fontFamily: fonts.bold, fontSize: 15 },
  qtyN: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, minWidth: 20, textAlign: 'center' },
  emptyWrap: { alignItems: 'center', paddingVertical: 20 },
  emptyImg: { width: 110, height: 110 },
  emptyT: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 8 },
  summary: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: colors.line },
  sumTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  sumLine: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, marginTop: 4 },
  done: { fontFamily: fonts.semibold, fontSize: 12, color: colors.greenDark, marginTop: 6 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  off: { opacity: 0.45 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
});
