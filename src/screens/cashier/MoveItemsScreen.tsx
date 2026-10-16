import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';
import AppButton from '../../components/AppButton';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { useLang } from '../../lib/i18n';
import { enqueueSync } from '../../lib/sync';
import { initDb, query } from '../../lib/db';
import { moveSaleItems } from '../../lib/sales';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { from?: string } } };

type MoveItem = { id: string; name: string; qty: number; price: number; note?: string; discount?: number };

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
  const isTablet = width >= TABLET_BP;
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
           WHERE status <> 'paid' AND tableNo IS NOT NULL AND TRIM(tableNo)<> ''`,
        );
        const names = tables.map((r) => r.tableNo.trim()).filter(Boolean);
        if (!on || names.length === 0) return;
        const catalog: Record<string, MoveItem[]> = {};
        for (const tb of names) {
          // Kelompokkan per menu + harga + catatan + diskon agar catatan dapur
          // (note) dan diskon per baris ikut pindah, tidak hilang tergabung.
          const rows = await query<{ id: string | null; name: string | null; qty: number | null; price: number | null; note: string | null; discount: number | null }>(
            `SELECT m.menuId AS id, m.menuName AS name, SUM(m.qty) AS qty, m.price AS price,
                    m.note AS note, m.discount AS discount
             FROM tr_salesmenu m INNER JOIN tr_saleshead h ON h.salesNum = m.salesNum
             WHERE h.status <> 'paid' AND h.tableNo = ?
             GROUP BY m.menuId, m.menuName, m.price, m.note, m.discount`,
            [tb],
          );
          const items = rows
            // Kunci unik per baris grup (menu sama beda catatan = id beda).
            .map((r, i) => ({
              id: `${(r.id || `${tb}-${i}`).trim()}#${i}`,
              name: (r.name || '-').trim(),
              qty: Math.max(1, Math.round(Number(r.qty) || 0)),
              price: Math.round(Number(r.price) || 0),
              note: (r.note || '').trim() || undefined,
              discount: Math.max(0, Math.round(Number(r.discount) || 0)) || undefined,
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
  // Total pindahan = harga qty pindah dikurangi porsi diskon barisnya.
  const pickedTotal = pickedItems.reduce(
    (s, it) => s + it.move * it.price - Math.round(((it.discount ?? 0) * it.move) / Math.max(1, it.qty)),
    0,
  );
  const pickedCount = pickedItems.reduce((s, it) => s + it.move, 0);
  /** Kode meja tujuan ("B1 (terisi)" ke "B1") untuk validasi. */
  const destCode = to.replace(/\s*\(.*\)\s*$/, '').trim();
  const sameTable = destCode === from;

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
    if (pickedItems.length === 0 || sameTable) return;
    const snapshot = pickedItems.map((it) => ({ ...it }));
    const totalSnap = pickedTotal;
    const countSnap = pickedCount;
    const toTable = destCode;
    const mergeSnap = destOccupied;
    const markMoved = () => {
      setMovedQty((m) => {
        const next = { ...m };
        for (const it of snapshot) next[it.id] = (next[it.id] ?? 0) + it.move;
        return next;
      });
      setDoneMsg(
        `${countSnap} pcs (${rp(totalSnap)}) dipindahkan ${from} ke ${to}${mergeSnap ? ' - digabung ke bill yang sudah ada' : ''}.`,
      );
      setPickedQty({});
    };
    // Coba belah fisik di SQLite dulu (kontrak §5.2); bila gagal, fallback ke
    // antrean manual + status lokal seperti sebelumnya (offline-first).
    (async () => {
      try {
        await initDb();
        const heads = await query<{ salesNum: string }>(
          `SELECT salesNum FROM tr_saleshead WHERE tableNo = ? AND status <> 'paid' ORDER BY salesDate`,
          [from],
        );
        if (heads.length === 0) throw new Error('no-head');
        const fromSalesNum = heads[0].salesNum;
        const destHeads = await query<{ salesNum: string }>(
          `SELECT salesNum FROM tr_saleshead WHERE tableNo = ? AND status <> 'paid' ORDER BY salesDate LIMIT 1`,
          [toTable],
        );
        const moves: { id: string; qty: number }[] = [];
        for (const it of snapshot) {
          const menuId = it.id.includes('#') ? it.id.split('#')[0] : it.id;
          let need = it.move;
          const rows = await query<{ id: string; qty: number }>(
            `SELECT m.id AS id, m.qty AS qty FROM tr_salesmenu m
             WHERE m.salesNum = ? AND m.menuId = ? AND COALESCE(m.note,'') = ? AND m.price = ?
             ORDER BY m.rowid`,
            [fromSalesNum, menuId, it.note ?? '', it.price],
          );
          for (const r of rows) {
            if (need <= 0) break;
            const take = Math.min(need, Math.max(0, Math.round(Number(r.qty) || 0)));
            if (take > 0) { moves.push({ id: r.id, qty: take }); need -= take; }
          }
        }
        if (moves.length === 0) throw new Error('no-rows');
        await moveSaleItems({
          fromSalesNum,
          toTableNo: toTable,
          moves,
          ...(destHeads.length > 0 ? { toSalesNum: destHeads[0].salesNum } : {}),
        });
        markMoved();
        return;
      } catch {
        /* DB tak cocok (fallback konstanta / multi-bill) - pakai antrean manual */
      }
      // Catat pindah item ke antrean sync agar diteruskan ke server (offline-first).
      // Catatan dan diskon per baris ikut agar dapur/struk tujuan tetap sama.
      try {
        enqueueSync('other', {
          op: 'move-items', from, to,
          items: snapshot.map((it) => ({
            id: it.id, name: it.name, qty: it.move, price: it.price,
            ...(it.note ? { note: it.note } : {}),
            ...(it.discount ? { discount: Math.round((it.discount * it.move) / Math.max(1, it.qty)) } : {}),
          })),
          total: totalSnap, merge: mergeSnap, at: new Date().toISOString(),
        });
      } catch {
        /* antrean belum siap - status lokal di bawah tetap diubah */
      }
      markMoved();
    })();
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
        <Text style={[styles.step, isTablet && styles.stepBig]}>1 · Pilih meja sumber</Text>
        <View style={styles.chips}>
          {tables.map((tb) => (
            <TouchableOpacity
              key={tb}
              style={[styles.chip, from === tb && styles.chipOn]}
              onPress={() => { setFrom(tb); setPickedQty({}); }}>
              <Text style={[styles.chipT, from === tb && styles.chipTOn, isTablet && styles.chipTBig]}>{tb}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.step, isTablet && styles.stepBig]}>2 · Pilih item dari {from}{SECTION_OF[from] ? ` · ${SECTION_OF[from]}` : ''}</Text>
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
                  <Text style={[styles.itemName, isTablet && styles.itemNameBig]}>{it.left}x {it.name}</Text>
                  {it.note ? <Text style={[styles.itemNote, isTablet && styles.itemNoteBig]}>{t('kit_note')}: {it.note}</Text> : null}
                  <Text style={[styles.itemPrice, isTablet && styles.itemPriceBig]}>{rp(it.left * it.price)}</Text>
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

        <Text style={[styles.step, isTablet && styles.stepBig]}>3 · Pilih meja tujuan</Text>
        <View style={styles.chips}>
          {destList.map((tb) => (
            <TouchableOpacity key={tb} style={[styles.chip, to === tb && styles.chipOn]} onPress={() => setTo(tb)}>
              <Text style={[styles.chipT, to === tb && styles.chipTOn, isTablet && styles.chipTBig]}>{tb}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.summary}>
          <Text style={[styles.sumTitle, isTablet && styles.sumTitleBig]}>Ringkasan pindah</Text>
          <Text style={[styles.sumLine, isTablet && styles.sumLineBig]}>
            {pickedItems.length === 0
              ? 'Belum ada item dipilih.'
              : `${pickedCount} pcs · ${rp(pickedTotal)} · ${from} ke ${to}${destOccupied ? ' (gabung)' : ''}`}
          </Text>
          {sameTable ? <Text style={styles.warn}>Meja tujuan sama dengan asal ({from}) - pilih meja lain.</Text> : null}
          {doneMsg ? <Text style={[styles.done, isTablet && styles.doneBig]}>{doneMsg}</Text> : null}
        </View>

        <AppButton
          size="md"
          title={`${t('mov_do_items')} ›`}
          onPress={move}
          disabled={pickedItems.length === 0 || sameTable}
          style={[styles.primary, (pickedItems.length === 0 || sameTable) && styles.off, { marginTop: 14 }]}
          textStyle={styles.primaryT}
        />
        <View style={styles.links}>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}>
            <Text style={[styles.link, isTablet && styles.linkBig]}>Lihat Denah Meja ›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Cashier')}>
            <Text style={[styles.link, isTablet && styles.linkBig]}>Buka di Kasir ›</Text>
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
  itemNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.blue, marginTop: 2 },
  warn: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red, marginTop: 6 },
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
  /* Varian tablet (breakpoint 768): teks +1..2pt agar proporsional di layar lebar. */
  stepBig: { fontSize: 15 },
  chipTBig: { fontSize: 14 },
  itemNameBig: { fontSize: 15 },
  itemNoteBig: { fontSize: 13 },
  itemPriceBig: { fontSize: 13 },
  sumTitleBig: { fontSize: 15 },
  sumLineBig: { fontSize: 14 },
  doneBig: { fontSize: 13 },
  primaryTBig: { fontSize: 16 },
  linkBig: { fontSize: 14 },
});
