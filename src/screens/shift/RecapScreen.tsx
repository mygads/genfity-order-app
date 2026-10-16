import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { useLang } from '../../lib/i18n';
import { getSession } from '../../session';
import { initDb, queryFirst } from '../../lib/db';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type Range = 'Hari Ini' | 'Kemarin' | '7 Hari';

const RANGES: Range[] = ['Hari Ini', 'Kemarin', '7 Hari'];

/** Seed tampilan bila SQLite masih kosong (instalasi baru / belum ada penjualan). */
const BY_MENU = [
  { nama: 'Es Teh Manis', qty: 42, total: 336000 },
  { nama: 'Lele goreng kremes', qty: 28, total: 420000 },
  { nama: 'Sudirman Coffee', qty: 25, total: 322500 },
  { nama: 'Menu Custom (Nasi + Ayam)', qty: 9, total: 80100 },
];
const BY_CATEGORY = [
  { nama: 'Minuman', qty: 67, total: 658500 },
  { nama: 'Makanan', qty: 37, total: 500100 },
];
const BY_METHOD = [
  { nama: 'Tunai (18 trx)', total: 486500 },
  { nama: 'EDC / Kartu (12 trx)', total: 312000 },
  { nama: 'QRIS / E-Wallet (11 trx)', total: 198400 },
  { nama: 'Deposit Member (4 trx)', total: 112000 },
  { nama: 'Order Online (6 trx)', total: 124000 },
];
const BY_MODE = [
  { nama: 'Dine In (21 trx)', total: 512000 },
  { nama: 'Bawa Pulang (14 trx)', total: 356900 },
  { nama: 'Online / Delivery (6 trx)', total: 124000 },
];
// Seed tampilan hanya bila SQLite masih kosong; agregasi live (BY_USER per kasir
// + promo/voucher) dihitung dari SQLite di bawah (T6).
const BY_USER = [
  { nama: 'Gista', trx: 47, total: 812000 },
  { nama: 'Rudi', trx: 17, total: 420900 },
];
const PROMO = [
  { nama: 'QOQI10 (Diskon)', pakai: 12, total: -60000 },
  { nama: 'HEMAT20 (Voucher)', pakai: 5, total: -100000 },
  { nama: 'GIFT50 (Gift)', pakai: 2, total: -100000 },
];
const CANCELLED = [
  { nama: 'Es Teh Manis', qty: 3, alasan: 'Salah input' },
  { nama: 'Lele goreng kremes', qty: 1, alasan: 'Stok habis' },
];

const EXPENSE_TOTAL = 65000;

interface Row3 { nama: string; qty: number; total: number }
interface Row2 { nama: string; total: number }
interface RowUser { nama: string; trx: number; total: number }
interface RowPromo { nama: string; pakai: number; total: number }
interface RowCancel { nama: string; qty: number; alasan: string }

interface RecapData {
  byMenu: Row3[];
  byCat: Row3[];
  byMethod: Row2[];
  byMode: Row2[];
  byUser: RowUser[];
  promo: RowPromo[];
  cancelled: RowCancel[];
  gross: number;
  trx: number;
  expense: number;
  hours: string;
  shiftLabel: string;
  fromDb: boolean;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Batas ISO rentang rekap. */
function rangeBounds(range: Range): { since: string; until: string } {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  if (range === 'Hari Ini') return { since: day.toISOString(), until: new Date(day.getTime() + 86400000).toISOString() };
  if (range === 'Kemarin') {
    return { since: new Date(day.getTime() - 86400000).toISOString(), until: day.toISOString() };
  }
  return { since: new Date(day.getTime() - 6 * 86400000).toISOString(), until: new Date(day.getTime() + 86400000).toISOString() };
}

/** Rekap dari SQLite (tr_saleshead/menu/payment, tr_cancelmenu, tr_branchexpense). */
export default function RecapScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [range, setRange] = useState<Range>('Hari Ini');
  const [db, setDb] = useState<RecapData | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        await initDb();
        const { since, until } = rangeBounds(range);
        const heads = await import('../../lib/db').then((m) =>
          m.query<{ grandTotal: number; paymentMethod: string | null; cashierName: string | null; userId: string | null }>(
            `SELECT grandTotal, paymentMethod, cashierName, userId FROM tr_saleshead
             WHERE status = 'paid' AND salesDate >= ? AND salesDate < ?`,
            [since, until],
          ),
        );
        if (!on) return;
        if (heads.length === 0) {
          setDb(null);
          return;
        }
        const { query } = await import('../../lib/db');
        const gross = heads.reduce((s, h) => s + num(h.grandTotal), 0);
        const methodMap = new Map<string, { n: number; total: number }>();
        const userMap = new Map<string, { n: number; total: number }>();
        for (const h of heads) {
          const m = (h.paymentMethod || 'Lainnya').trim() || 'Lainnya';
          const mm = methodMap.get(m) ?? { n: 0, total: 0 };
          mm.n += 1;
          mm.total += num(h.grandTotal);
          methodMap.set(m, mm);
          const u = (h.cashierName || h.userId || 'Kasir').trim() || 'Kasir';
          const uu = userMap.get(u) ?? { n: 0, total: 0 };
          uu.n += 1;
          uu.total += num(h.grandTotal);
          userMap.set(u, uu);
        }
        const menus = await query<{ nama: string; qty: number; total: number }>(
          `SELECT m.menuName AS nama, SUM(m.qty) AS qty, SUM(m.subtotal) AS total
           FROM tr_salesmenu m INNER JOIN tr_saleshead h ON h.salesNum = m.salesNum
           WHERE h.status = 'paid' AND h.salesDate >= ? AND h.salesDate < ?
           GROUP BY m.menuName ORDER BY total DESC`,
          [since, until],
        );
        const cats = await query<{ nama: string; qty: number; total: number }>(
          `SELECT COALESCE(c.categoryName, 'Lainnya') AS nama, SUM(m.qty) AS qty, SUM(m.subtotal) AS total
           FROM tr_salesmenu m INNER JOIN tr_saleshead h ON h.salesNum = m.salesNum
           LEFT JOIN ms_menu mm ON mm.id = m.menuId
           LEFT JOIN ms_category c ON c.id = mm.categoryId
           WHERE h.status = 'paid' AND h.salesDate >= ? AND h.salesDate < ?
           GROUP BY COALESCE(c.categoryName, 'Lainnya') ORDER BY total DESC`,
          [since, until],
        );
        const modes = await query<{ salesMode: string | null; n: number; total: number }>(
          `SELECT salesMode, COUNT(*) AS n, SUM(grandTotal) AS total FROM tr_saleshead
           WHERE status = 'paid' AND salesDate >= ? AND salesDate < ? GROUP BY salesMode`,
          [since, until],
        );
        const exp = await queryFirst<{ total: number }>(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM tr_branchexpense
           WHERE expenseDate >= ? AND expenseDate < ?`,
          [since, until],
        );
        const canc = await query<{ nama: string; qty: number; alasan: string | null }>(
          `SELECT menuName AS nama, SUM(qty) AS qty, reasonNote AS alasan FROM tr_cancelmenu
           WHERE cancelDate >= ? AND cancelDate < ? GROUP BY menuName, reasonNote`,
          [since, until],
        );
        // T6: ringkasan pemakaian voucher dari SQLite (join ke head agar ikut
        // rentang tanggal; tabel usage tak punya kolom tanggal sendiri).
        // Baris lama (sebelum voucherAmount dicatat) totalnya 0 - dilengkapi
        // dari agregat head agar tetap tampil.
        const usePromo = await query<{ voucherCode: string | null; n: number; total: number }>(
          `SELECT u.voucherCode AS voucherCode, COUNT(*) AS n, COALESCE(SUM(u.voucherAmount), 0) AS total
           FROM tr_salesvoucherusage u INNER JOIN tr_saleshead h ON h.salesNum = u.salesNum
           WHERE h.status = 'paid' AND h.salesDate >= ? AND h.salesDate < ?
             AND u.voucherCode IS NOT NULL AND TRIM(u.voucherCode) <> ''
           GROUP BY u.voucherCode`,
          [since, until],
        );
        const headPromo = await query<{ voucherCode: string | null; n: number; total: number }>(
          `SELECT voucherCode, COUNT(*) AS n, COALESCE(SUM(voucherAmount), 0) AS total
           FROM tr_saleshead
           WHERE status = 'paid' AND salesDate >= ? AND salesDate < ?
             AND voucherCode IS NOT NULL AND TRIM(voucherCode) <> ''
           GROUP BY voucherCode`,
          [since, until],
        );
        const promoMap = new Map<string, { n: number; total: number }>();
        for (const r of headPromo) {
          const code = (r.voucherCode || '').trim();
          if (code) promoMap.set(code, { n: num(r.n), total: Math.round(num(r.total)) });
        }
        for (const r of usePromo) {
          const code = (r.voucherCode || '').trim();
          if (!code) continue;
          const cur = promoMap.get(code) ?? { n: 0, total: 0 };
          const tot = Math.round(num(r.total));
          promoMap.set(code, { n: Math.max(cur.n, num(r.n)), total: tot > 0 ? tot : cur.total });
        }
        const shift = await queryFirst<{ shiftName: string | null; userId: string | null; cashierName: string | null; clockIn: string | null; clockOut: string | null }>(
          'SELECT shiftName, userId, cashierName, clockIn, clockOut FROM tr_shiftlog ORDER BY clockIn DESC LIMIT 1',
        );
        if (!on) return;
        const nm = getSession()?.name ?? 'Gista';
        setDb({
          byMenu: menus.map((r) => ({ nama: r.nama, qty: Math.round(num(r.qty)), total: Math.round(num(r.total)) })),
          byCat: cats.map((r) => ({ nama: r.nama, qty: Math.round(num(r.qty)), total: Math.round(num(r.total)) })),
          byMethod: [...methodMap.entries()].map(([nama, v]) => ({ nama: `${nama} (${v.n} trx)`, total: Math.round(v.total) })),
          byMode: modes.map((r) => ({
            nama: `${(r.salesMode || 'DINE_IN').split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')} (${r.n} trx)`,
            total: Math.round(num(r.total)),
          })),
          byUser: [...userMap.entries()].map(([nama, v]) => ({ nama, trx: v.n, total: Math.round(v.total) })),
          promo: [...promoMap.entries()].map(([nama, v]) => ({ nama, pakai: v.n, total: -Math.abs(v.total) })),
          cancelled: canc.map((r) => ({ nama: r.nama, qty: Math.round(num(r.qty)), alasan: r.alasan || '-' })),
          gross: Math.round(gross),
          trx: heads.length,
          expense: Math.round(num(exp?.total)),
          hours: shift?.clockIn ? `${shift.clockIn.slice(11, 16)} - ${shift.clockOut ? shift.clockOut.slice(11, 16) : '... '}` : '',
          shiftLabel: `${shift?.shiftName ?? 'Shift'} · Kasir ${shift?.cashierName || shift?.userId || nm}`,
          fromDb: true,
        });
      } catch {
        if (on) setDb(null);
      }
    })();
    return () => {
      on = false;
    };
  }, [range]);

  const fallbackGross = useMemo(() => BY_METHOD.reduce((s, r) => s + r.total, 0), []);
  const gross = db?.gross ?? fallbackGross;
  const trxCount = db?.trx ?? 51;
  // T6: promo dari SQLite bila ada; seed statis hanya fallback saat tabel kosong.
  const promo = db && db.promo.length > 0 ? db.promo : PROMO;
  const promoTotal = promo.reduce((s, p) => s + p.total, 0);
  const byMethod = db?.byMethod ?? BY_METHOD;
  const byMenu = db?.byMenu ?? BY_MENU;
  const byCat = db?.byCat ?? BY_CATEGORY;
  const byMode = db?.byMode ?? BY_MODE;
  const byUser = db?.byUser ?? BY_USER;
  const cancelled = db?.cancelled ?? CANCELLED;
  const cancelQty = cancelled.reduce((s, c) => s + c.qty, 0);
  const expenseTotal = db?.expense ?? EXPENSE_TOTAL;
  const shiftLabel = db?.shiftLabel ?? `Shift Pagi · Kasir ${getSession()?.name ?? 'Gista'}`;
  const hours = db?.hours ?? '08:00 - 15:00';

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('title_recap')}
        sub={shiftLabel}
        onBack={() => navigation?.goBack()}
        right={
          <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <View style={styles.filters}>
          {RANGES.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.filterChip, range === r && styles.filterActive]}
              onPress={() => setRange(r)}>
              <Text style={[styles.filterTxt, range === r && styles.filterTxtActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Total Penjualan · {range}</Text>
          <Text style={styles.heroValue}>{rp(gross)}</Text>
          <Text style={styles.heroSub}>{trxCount} transaksi · {hours}</Text>
          <Text style={styles.heroNet}>Kas bersih {rp(gross - expenseTotal)} setelah pengeluaran</Text>
        </View>

        <Text style={styles.sec}>{t('rcp_pay')}</Text>
        <View style={styles.card}>
          {byMethod.map((r) => (
            <View key={r.nama} style={styles.row}>
              <Text style={styles.item}>{r.nama}</Text>
              <Text style={styles.price}>{rp(r.total)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sec}>{t('rcp_menu')}</Text>
        <View style={styles.card}>
          {byMenu.map((r) => (
            <View key={r.nama} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.item}>{r.nama}</Text>
                <Text style={styles.meta}>{r.qty} terjual</Text>
              </View>
              <Text style={styles.price}>{rp(r.total)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sec}>{t('rcp_cat')}</Text>
        <View style={styles.card}>
          {byCat.map((r) => (
            <View key={r.nama} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.item}>{r.nama}</Text>
                <Text style={styles.meta}>{r.qty} item</Text>
              </View>
              <Text style={styles.price}>{rp(r.total)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sec}>{t('rcp_mode')}</Text>
        <View style={styles.card}>
          {byMode.map((r) => (
            <View key={r.nama} style={styles.row}>
              <Text style={styles.item}>{r.nama}</Text>
              <Text style={styles.price}>{rp(r.total)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sec}>{t('rcp_by_user')}</Text>
        <View style={styles.card}>
          {byUser.map((r) => (
            <View key={r.nama} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.item}>{r.nama}</Text>
                <Text style={styles.meta}>{r.trx} transaksi</Text>
              </View>
              <Text style={styles.price}>{rp(r.total)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sec}>{t('rcp_promo')}</Text>
        <View style={styles.card}>
          {promo.map((r) => (
            <View key={r.nama} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.item}>{r.nama}</Text>
                <Text style={styles.meta}>{r.pakai}x {t('rcp_used')}</Text>
              </View>
              <Text style={styles.disc}>{rp(r.total)}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <Text style={styles.totalL}>Total promo</Text>
            <Text style={styles.disc}>{rp(promoTotal)}</Text>
          </View>
        </View>

        <Text style={styles.sec}>{t('rcp_cancel')} ({cancelQty})</Text>
        <View style={styles.card}>
          {cancelled.map((r) => (
            <View key={`${r.nama}-${r.alasan}`} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.item}>{r.qty}x {r.nama}</Text>
                <Text style={styles.meta}>{r.alasan}</Text>
              </View>
            </View>
          ))}
          {cancelled.length === 0 && <Text style={styles.meta}>Tidak ada item dibatalkan.</Text>}
        </View>

        <Text style={styles.sec}>{t('rcp_expense')}</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.item}>Total pengeluaran outlet</Text>
            <Text style={styles.disc}>-{rp(expenseTotal)}</Text>
          </View>
          <TouchableOpacity onPress={() => navigation?.navigate('Expense')}>
            <Text style={styles.link}>Kelola pengeluaran cabang ›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.ghost} onPress={() => navigation?.navigate('History')}>
            <Text style={styles.ghostT}>{t('rcp_history_btn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primary2} onPress={() => navigation?.navigate('EndShift')}>
            <Text style={styles.primaryT}>{t('rcp_close_btn')}</Text>
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
  filters: { flexDirection: 'row', marginTop: 10 },
  filterChip: {
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    borderRadius: 20, paddingVertical: 7, paddingHorizontal: 16, marginRight: 8,
  },
  filterActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  filterTxtActive: { color: colors.white },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18, marginTop: 10 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.navyTint },
  heroValue: { fontFamily: fonts.bold, fontSize: 28, color: colors.white, marginTop: 6 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  heroNet: { fontFamily: fonts.semibold, fontSize: 12, color: colors.white, marginTop: 6 },
  sec: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, gap: 8 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, flex: 1 },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  disc: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  totalL: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, flex: 1 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  primary2: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
});
