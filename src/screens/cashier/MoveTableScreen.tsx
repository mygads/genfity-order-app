import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';
import AppButton from '../../components/AppButton';
import ScreenHeader from '../../components/ScreenHeader';
import { useLang } from '../../lib/i18n';
import { enqueueOutbox, enqueueSync } from '../../lib/sync';
import { GO_OP_MOVE_TABLE, getServerOrderIdForSale } from '../../lib/posWire';
import { initDb, query, run } from '../../lib/db';
import { postTableTransition } from '../../lib/terminalTable';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { from?: string } } };

type Occupied = { table: string; guest: string; items: number; total: number };
/** Kanonis mengikuti TablesScreen: no tanpa strip (A1/A2/B1, bukan A-03) + section Dalam/Teras/VIP. */
const SECTION_OF: Record<string, string> = {
  A1: 'Dalam', A2: 'Dalam', A3: 'Dalam', A4: 'Dalam',
  B1: 'Teras', B2: 'Teras', B3: 'Teras',
  C1: 'VIP', C2: 'VIP',
};
/** Contoh tamu lama dihapus — daftar terisi & kosong murni dari SQLite (live-only). */

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
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [from, setFrom] = useState(() => canonTableNo(route?.params?.from ?? ''));
  const [to, setTo] = useState('');
  const [done, setDone] = useState(false);
  /** Peringatan validasi tujuan (meja sama / asal belum dipilih). */
  const [warn, setWarn] = useState('');
  // T7: katalog live dari SQLite (bill aktif + ms_table); tanpa bill
  // terbuka = daftar kosong yang jujur.
  const [liveOcc, setLiveOcc] = useState<Occupied[] | null>(null);
  const [liveEmpty, setLiveEmpty] = useState<string[] | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        await initDb();
        const heads = await query<{ tableNo: string; customerName: string | null; grandTotal: number | null }>(
          `SELECT tableNo, customerName, grandTotal FROM tr_saleshead
           WHERE status NOT IN ('paid','void') AND tableNo IS NOT NULL AND TRIM(tableNo)<> ''`,
        );
        if (!on) return;
        if (heads.length === 0) {
          // Jujur: tak ada bill terbuka = tak ada meja terisi. Muat daftar
          // meja kosong dari ms_table; tanpa itu = daftar kosong.
          try {
            const tRows = await query<{ id: string; tableNo: string | null }>(
              'SELECT id, tableNo FROM ms_table LIMIT 60',
            );
            const free = tRows
              .map((r) => ((r.tableNo || r.id) || '').trim())
              .filter((no) => !!no);
            if (!on) return;
            setLiveOcc([]);
            setLiveEmpty(free.length > 0 ? free : []);
            setFrom('');
            if (free.length > 0) setTo((prev) => (prev && free.includes(prev) ? prev : free[0]));
          } catch {
            if (!on) return;
            setLiveOcc([]);
            setLiveEmpty([]);
          }
          return;
        }
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
           WHERE h.status NOT IN ('paid','void') AND h.tableNo IS NOT NULL AND TRIM(h.tableNo)<> ''
           GROUP BY h.tableNo`,
        );
        const itemCount = new Map(itemRows.map((r) => [String(r.tableNo).trim(), Number(r.n) || 0]));
        const occ: Occupied[] = [...byTable.entries()].map(([table, v]) => ({
          table,
          guest: v.guest || t('guestFallback'),
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
          /* ms_table kosong - daftar kosong */
        }
        if (!on) return;
        setLiveOcc(occ);
        setLiveEmpty(empty);
        setFrom((prev) => (occ.some((o) => o.table === prev) ? prev : occ[0].table));
        if (empty) setTo((prev) => (empty.includes(prev) ? prev : empty[0]));
      } catch {
        /* SQLite belum siap - daftar tetap kosong */
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  // Live-only: tanpa bill terbuka = daftar kosong.
  const occupied = liveOcc ?? [];
  const emptyList = liveEmpty ?? [];
  const src = occupied.find((o) => o.table === from);
  /** Kode meja dari label "A1 (Dalam · 2 kursi)" ke "A1" (dulu split(' ')[0] yang rapuh). */
  const destCode = to.replace(/\s*\(.*\)\s*$/, '').trim();

  const move = () => {
    // Validasi meja tujuan ala POSLite: asal harus ada, tujuan wajib diisi + tak boleh sama.
    if (!src) { setWarn(t('mov_warn_src')); return; }
    if (!destCode) { setWarn(t('mov_warn_dst')); return; }
    if (destCode === src.table) { setWarn(t('mov_same_table').replace('{from}', src.table)); return; }
    setWarn('');
    // Catat pindah meja ke antrean sync agar diteruskan ke server (offline-first).
    try {
      enqueueSync('other', {
        op: 'move-table', from: src.table, to: destCode, total: src.total,
        at: new Date().toISOString(),
      });
    } catch {
      /* antrean belum siap - status lokal di bawah tetap diubah */
    }
    // Pindah bill di SQLite: seluruh item, catatan (note), modifier, dan total
    // ikut pindah karena baris tr_salesmenu/menuextra menempel ke salesNum.
    void (async () => {
      try {
        await initDb();
        await run(
          `UPDATE tr_saleshead SET tableNo = ?, syncDate = NULL WHERE TRIM(tableNo) = ? AND status NOT IN ('paid','void')`,
          [destCode, src.table],
        );
        // Tandai bill pindahan kotor per salesNum agar ikut push berikutnya.
        try {
          const moved = await query<{ salesNum: string }>(
            `SELECT salesNum FROM tr_saleshead WHERE tableNo = ? AND status NOT IN ('paid','void')`,
            [destCode],
          );
          for (const m of moved) {
            try {
              await enqueueOutbox('tr_saleshead', m.salesNum, 'update');
            } catch {
              /* abaikan per baris */
            }
            // P0-3 audit paritas: sale yang sudah punya order server ikut
            // dipindah di BE (POST move-table); tanpa onlineOrderId = lokal
            // saja (jujur: BE tak tahu bill ini).
            try {
              const serverId = await getServerOrderIdForSale(m.salesNum);
              if (serverId !== null) {
                enqueueSync('other', {
                  op: GO_OP_MOVE_TABLE, serverId: String(serverId),
                  to: destCode, salesNum: m.salesNum,
                  at: new Date().toISOString(),
                });
              }
            } catch {
              /* antrean belum siap - pindah lokal di atas tetap sah */
            }
          }
        } catch {
          /* syncDate NULL di atas tetap menandai kotor */
        }
        try {
          await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE TRIM(tableNo) = ?', ['kosong', src.table]);
        } catch { /* master meja opsional */ }
        try {
          await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE TRIM(tableNo) = ?', ['terisi', destCode]);
        } catch { /* master meja opsional */ }
        // A11: pindah meja di server terminal (best-effort; antrean GO_OP_MOVE_TABLE
        // + tulis lokal di atas tetap jadi fallback offline).
        void postTableTransition({ tableRef: src.table, status: 'AVAILABLE' });
        void postTableTransition({ tableRef: destCode, status: 'OCCUPIED' });
      } catch {
        /* SQLite belum siap - antrean sync di atas tetap jalan */
      }
    })();
    setDone(true);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('title_move_table')}
        onBack={() => navigation?.goBack()}
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
        <Text style={[styles.hint, isTablet && styles.hintBig]}>{t('mov_hint_table')}</Text>
        {/* Tablet: pemilih Dari dan Ke berdampingan 2 kolom; phone tetap susun vertikal. */}
        <View style={[isTablet && styles.cols]}>
        <View style={[isTablet && styles.col]}>
        <Text style={[styles.label, isTablet && styles.labelBig]}>{t('mov_from_label')}</Text>
        <View style={styles.chips}>
          {occupied.map((o) => (
            <TouchableOpacity
              key={o.table}
              style={[styles.chip, from === o.table && styles.chipOn, isTablet && styles.chipBig]}
              onPress={() => { setFrom(o.table); setDone(false); setWarn(''); }}>
              <Text style={[styles.chipT, from === o.table && styles.chipTOn, isTablet && styles.chipTBig]}>{o.table}</Text>
            </TouchableOpacity>
          ))}
        </View>
        </View>
        {/* Phone: kartu info di posisi asal (di antara pemilih) agar urutan phone tak berubah. */}
        {!isTablet && src && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('c_table')} {src.table}{SECTION_OF[src.table] ? ` · ${SECTION_OF[src.table]}` : ''} · {src.guest}</Text>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t('mov_card_items')}</Text>
              <Text style={styles.cardVal}>{t('mov_items_unit').replace('{n}', String(src.items))}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t('mov_total_run')}</Text>
              <Text style={styles.cardVal}>{rp(src.total)}</Text>
            </View>
          </View>
        )}
        <View style={[isTablet && styles.col]}>
        <Text style={[styles.label, isTablet && styles.labelBig]}>{t('mov_to_label')}</Text>
        <View style={styles.chips}>
          {emptyList.map((tb) => (
            <TouchableOpacity key={tb} style={[styles.chip, to === tb && styles.chipOn, isTablet && styles.chipBig]} onPress={() => { setTo(tb); setWarn(''); }}>
              <Text style={[styles.chipT, to === tb && styles.chipTOn, isTablet && styles.chipTBig]}>{tb}</Text>
            </TouchableOpacity>
          ))}
        </View>
        </View>
        </View>

        {/* Tablet: kartu info full-width di bawah kolom. */}
        {isTablet && src && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, styles.cardTitleBig]}>{t('c_table')} {src.table}{SECTION_OF[src.table] ? ` · ${SECTION_OF[src.table]}` : ''} · {src.guest}</Text>
            <View style={styles.cardRow}>
              <Text style={[styles.cardLabel, styles.cardLabelBig]}>{t('mov_card_items')}</Text>
              <Text style={[styles.cardVal, styles.cardValBig]}>{t('mov_items_unit').replace('{n}', String(src.items))}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={[styles.cardLabel, styles.cardLabelBig]}>{t('mov_total_run')}</Text>
              <Text style={[styles.cardVal, styles.cardValBig]}>{rp(src.total)}</Text>
            </View>
          </View>
        )}

        {done && src ? (
          <Text style={[styles.done, isTablet && styles.doneBig]}>{t('mov_table_done').replace('{table}', src.table).replace('{total}', rp(src.total)).replace('{to}', to)}</Text>
        ) : null}
        {warn ? <Text style={styles.warn}>{warn}</Text> : null}

        <AppButton
          size="md"
          title={`${t('mov_do_table')} ›`}
          onPress={move}
          style={[styles.primary, { marginTop: 16 }]}
          textStyle={styles.primaryT}
        />
        <View style={styles.links}>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}>
            <Text style={[styles.link, isTablet && styles.linkBig]}>{t('mov_view_layout')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Cashier', { table: destCode })}>
            <Text style={[styles.link, isTablet && styles.linkBig]}>{t('mov_open_cashier')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  /* Kolom tablet: pemilih Dari dan Ke berdampingan (phone tetap 1 kolom). */
  cols: { flexDirection: 'row', gap: 16 },
  col: { flex: 1, minWidth: 0 },
  /* Varian tablet: chip min 48px agar mudah diketuk. */
  chipBig: { minHeight: 48, justifyContent: 'center', paddingVertical: 12 },
  chipT: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  cardLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  cardVal: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  done: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark, marginTop: 12 },
  warn: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red, marginTop: 8, textAlign: 'center' },
  /* Varian tablet (breakpoint 768): teks +1..2pt agar proporsional di layar lebar. */
  hintBig: { fontSize: 13 },
  labelBig: { fontSize: 13 },
  chipTBig: { fontSize: 14 },
  cardTitleBig: { fontSize: 15 },
  cardLabelBig: { fontSize: 14 },
  cardValBig: { fontSize: 14 },
  doneBig: { fontSize: 14 },
  primaryTBig: { fontSize: 16 },
  linkBig: { fontSize: 14 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
});
