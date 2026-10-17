import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';
import { getSession, logout } from '../../session';
import { getBranchId, getTerminal } from '../../config/server';
import { initDb, query, queryFirst } from '../../lib/db';
import { getLastSync, pendingCount } from '../../lib/sync';
import DrawerMenu from '../../components/DrawerMenu';
import ScreenHeader from '../../components/ScreenHeader';
import { useLang } from '../../lib/i18n';
import { ensureShiftOpen, getShiftStatus } from '../../lib/shiftGuard';
import { useConnectivity } from '../../hooks/useConnectivity';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

interface MenuItem {
  label: string;
  sub: string;
  route: string | null;
  soon?: boolean;
}

/** Item menu utama - label diisi di dalam komponen via t() agar siap EN dan ID. */

type TableState = 'busy' | 'free' | 'res';

interface TableMini {
  id: string;
  s: TableState;
}

interface StockMini {
  id: string;
  name: string;
  left: number;
}

/** Normalisasi status ms_table APK ke tiga state peta. */
function mapStatus(raw: string): TableState {
  const v = raw.trim().toLowerCase();
  if (v === 'busy' || v === 'terisi' || v === 'occupied' || v === 'gabung' || v === 'isi') return 'busy';
  if (v === 'res' || v === 'reservasi' || v === 'reserved' || v === 'booked' || v === 'booking') return 'res';
  return 'free';
}

/** Tanpa seed demo: awal kosong, diisi agregasi live SQLite di bawah. */
const TABLES: TableMini[] = [];

const LOW_STOCK: StockMini[] = [];

function tableStyle(s: string) {
  if (s === 'busy') return { bg: colors.paleRed, bd: colors.red, tx: colors.red };
  if (s === 'res') return { bg: colors.paleAmber, bd: colors.amber, tx: colors.amberDark };
  return { bg: colors.paleGreen, bd: colors.green, tx: colors.greenDark };
}

export default function DashboardScreen({ navigation }: Props) {
  const s = getSession();
  const { t } = useLang();
  const { online, wsConnected } = useConnectivity();
  // Badge koneksi REAL: hijau+Online bila jaringan & WS up, amber+Offline bila
  // jaringan mati, abu+Offline (mode lokal) bila jaringan up tapi WS putus
  // atau status awal null (belum dicek).
  // 'Offline' netral EN/ID (i18n.ts beku - tanpa kunci baru).
  const connLabel = online === false ? 'Offline' : online && wsConnected ? t('badge_online') : 'Offline';
  const connDot = online === false ? styles.onlineDotAmber : online && wsConnected ? undefined : styles.onlineDotGrey;
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const [notice, setNotice] = useState('');
  // Drawer /home juga dibuka dari Dashboard (home) - dulu hanya dari Cashier.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Nilai awal nol; efek di bawah menimpa dengan hitungan nyata SQLite.
  const [sales, setSales] = useState({ total: 0, trx: 0 });
  // T12: pembanding H-1 dari SQLite; null = kemarin belum ada data / DB kosong.
  const [yest, setYest] = useState<{ total: number; trx: number } | null>(null);
  const [tables, setTables] = useState<TableMini[]>([]);
  const [lowStock, setLowStock] = useState<StockMini[]>([]);
  // Kartu shift mulai kosong (tertutup) sampai tr_shiftlog dibaca di bawah —
  // tanpa shift terbuka = ajakan buka shift, bukan 'Shift Pagi 08:57' fiktif.
  const [shift, setShift] = useState(() => ({
    open: false,
    clockIn: s?.clockIn ?? '--:--',
    cash: s?.cash ?? 0,
  }));
  const [lastSync, setLastSync] = useState(() => getLastSync());
  const [pending, setPending] = useState(() => pendingCount());
  // NAV-04/05: hitungan nyata; null/awal = DB kosong → tampil nol.
  const [esbNew, setEsbNew] = useState<number | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);

  // Muat angka nyata dari SQLite (tr_saleshead hari ini, ms_table,
  // ms_branchmenu join ms_menu, tr_shiftlog terakhir). Gagal = tetap nol,
  // kasir tidak diblokir.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await initDb();
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const dayRow = await queryFirst<{ c: number; t: number }>(
          'SELECT COUNT(*) AS c, COALESCE(SUM(grandTotal), 0) AS t FROM tr_saleshead WHERE substr(salesDate, 1, 10) = ?',
          [day],
        );
        if (alive && dayRow) {
          setSales({ total: Number(dayRow.t) || 0, trx: Number(dayRow.c) || 0 });
        }
        // T12: omzet + transaksi kemarin sebagai baseline delta.
        const yd = new Date(d.getTime() - 86400000);
        const yday = `${yd.getFullYear()}-${pad(yd.getMonth() + 1)}-${pad(yd.getDate())}`;
        const yRow = await queryFirst<{ c: number; t: number }>(
          'SELECT COUNT(*) AS c, COALESCE(SUM(grandTotal), 0) AS t FROM tr_saleshead WHERE substr(salesDate, 1, 10) = ?',
          [yday],
        );
        if (alive && yRow) {
          setYest({ total: Number(yRow.t) || 0, trx: Number(yRow.c) || 0 });
        }
        const tRows = await query<{ id: string; tableNo: string | null; status: string | null }>(
          'SELECT id, tableNo, status FROM ms_table LIMIT 60',
        );
        if (alive && tRows.length > 0) {
          setTables(tRows.map((r) => ({ id: r.tableNo || r.id, s: mapStatus(r.status ?? '') })));
        }
        const lRows = await query<{ id: string | null; name: string | null; left: number | null }>(
          `SELECT b.menuId AS id, COALESCE(m.menuName, b.menuId) AS name, b.qty AS left
             FROM ms_branchmenu b LEFT JOIN ms_menu m ON m.id = b.menuId
             WHERE b.branchId = ? AND b.flagSoldOut = 0 AND b.qty <= 8 ORDER BY b.qty ASC LIMIT 5`,
          [getBranchId()],
        );
        if (alive && lRows.length > 0) {
          setLowStock(lRows.map((r) => ({ id: r.id ?? '', name: r.name ?? '-', left: Math.round(Number(r.left) || 0) })));
        }
        const shiftRow = await queryFirst<{
          shiftName: string | null; clockIn: string | null; cashInDrawer: number | null;
          clockOut: string | null; status: string | null;
        }>(
          // Absensi (status 'absen') dikecualikan: clock-in kehadiran bukan shift kasir.
          'SELECT shiftName, clockIn, cashInDrawer, clockOut, status FROM tr_shiftlog WHERE status IS NULL OR status <> \'absen\' ORDER BY clockIn DESC LIMIT 1',
        );
        if (alive && shiftRow) {
          const hhmm = String(shiftRow.clockIn ?? '').slice(11, 16);
          setShift({
            open: shiftRow.status === 'open' || !shiftRow.clockOut,
            clockIn: hhmm || s?.clockIn || '--:--',
            cash: Number(shiftRow.cashInDrawer) || s?.cash || 0,
          });
        } else if (alive) {
          // Tanpa baris shift: hanya-absensi (belum pernah buka shift) = tutup.
          const shiftTotal = await queryFirst<{ c: number }>('SELECT COUNT(*) AS c FROM tr_shiftlog');
          if (shiftTotal && Number(shiftTotal.c) > 0) {
            setShift((prev) => ({ ...prev, open: false }));
          }
        }
        // NAV-04: order online baru (belum diproses) + total member terdaftar.
        const esbRow = await queryFirst<{ c: number }>(
          `SELECT COUNT(*) AS c FROM tr_saleshead
           WHERE onlineOrderId IS NOT NULL AND status = 'open'`,
        );
        if (alive && esbRow) setEsbNew(Number(esbRow.c) || 0);
        const memRow = await queryFirst<{ c: number }>(
          'SELECT COUNT(*) AS c FROM ms_member',
        );
        if (alive && memRow) setMemberCount(Number(memRow.c) || 0);
      } catch {
        // DB belum init - tetap nol.
      }
      if (alive) {
        setLastSync(getLastSync());
        setPending(pendingCount());
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = useMemo(() => tables.filter((x) => x.s === 'busy').length, [tables]);
  const free = useMemo(() => tables.filter((x) => x.s === 'free').length, [tables]);
  const resCount = useMemo(() => tables.filter((x) => x.s === 'res').length, [tables]);
  const avg = sales.trx > 0 ? Math.round(sales.total / sales.trx) : 0;
  // T12: delta omzet hari ini vs kemarin; fallback teks bila baseline kosong.
  const delta = yest && yest.total > 0
    ? Math.round(((sales.total - yest.total) / yest.total) * 100)
    : null;
  const deltaTxt = delta === null
    ? t('dash_vs_empty')
    : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% ${t('dash_vs')}`;

  const MENU: MenuItem[] = [
    { label: t('nav_order'), sub: `${t('nav_cashier')} · ${sales.trx} ${t('unit_trx')}`, route: 'Cashier' },
    { label: t('nav_tables'), sub: `${t('nav_layout')} · ${busy} ${t('unit_filled')}`, route: 'Tables' },
    // Booking disengaja hanya kartu dashboard (route Booking valid) -
    // drawer kanonis 10 item Lampiran A tetap tanpa Booking agar sinkron.
    { label: t('nav_booking'), sub: t('nav_booking_sub'), route: 'Booking' },
    { label: t('nav_shift'), sub: t('nav_shift_sub'), route: 'Shift' },
    { label: t('nav_history'), sub: t('nav_history_sub'), route: 'History' },
    { label: t('nav_recap'), sub: t('nav_recap_sub'), route: 'Recap' },
    { label: t('nav_esb'), sub: `${t('nav_online_orders')} · ${esbNew ?? 0} ${t('unit_new')}`, route: 'EsbOrder' },
    { label: t('nav_member'), sub: `${memberCount ?? 0} ${t('unit_registered')}`, route: 'Member' },
    { label: t('nav_expense'), sub: t('nav_expense_sub'), route: 'Expense' },
    { label: t('nav_petty'), sub: t('nav_petty_sub'), route: 'PettyCash' },
    { label: t('nav_settings'), sub: t('nav_settings_sub'), route: 'Settings' },
  ];

  const openMenu = (m: MenuItem) => {
    if (!m.route) {
      setNotice(`${m.label} ${t('dash_not_available')}`);
      return;
    }
    // Gerbang kasir live dari DB ( kartu shift bisa basi bila pulang dari Tutup Shift
    // tanpa remount ) - shift tutup → notice + arahkan buka shift dulu.
    if (m.route === 'Cashier') {
      void (async () => {
        if (!(await ensureShiftOpen(navigation, `${t('dash_shift_closed')} - ${t('shf_open_btn')}`, setNotice))) return;
        setNotice('');
        navigation?.navigate(m.route as string);
      })();
      return;
    }
    setNotice('');
    navigation?.navigate(m.route);
  };

  const doLogout = () => {
    try {
      (navigation as any)?.reset({ index: 0, routes: [{ name: 'Login' as never }] });
    } catch {}
    logout();
  };

  // Baris sinkron: waktu nyata modul sync + jumlah antrean bila ada.
  const syncLine =
    pending > 0
      ? `${t('dash_sync')} ${lastSync || t('dash_never')} · ${pending} ${t('sync_pending')} · ${connLabel}`
      : `${t('dash_sync')} ${lastSync || t('dash_never')} · ${connLabel}`;

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={s?.outlet ?? 'Genfity Cabang Poris'}
        sub={`${t('nav_cashier')} ${s?.name ?? 'Gista'} · ${s?.shift ?? t('fallback_shift')}`}
        left={
          <TouchableOpacity
            onPress={() => setDrawerOpen(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('action_open_menu')}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
        right={
          <View style={styles.onlineDark}>
            <View style={[styles.onlineDot, connDot]} />
            <Text style={styles.onlineDarkT}>{connLabel}</Text>
          </View>
        }
      />
      <DrawerMenu
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigate={(r) => navigation?.navigate(r)}
        outlet={s?.outlet || getTerminal().branchName || undefined}
        user={s ? `${s.name} | ${s.shift}` : undefined}
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>

      {/* Tablet: kartu shift + omzet bersebelahan, CTA full-width di bawahnya. */}
      <View style={isTablet ? styles.heroRowTablet : undefined}>
      <View style={[styles.shiftCard, isTablet && styles.heroCardTablet]}>
        <View style={styles.shiftLeft}>
          <View style={styles.shiftTitleRow}>
            <View style={[styles.shiftDot, !shift.open && styles.shiftDotClosed]} />
            <Text style={[styles.shiftTitle, isTablet && styles.shiftTitleBig]}>{shift.open ? `${t('dash_shift_open')} ✓` : t('dash_shift_closed')}</Text>
          </View>
          <Text style={[styles.shiftSub, isTablet && styles.shiftSubBig]}>
            {t('dash_clock_in')} {shift.clockIn} · {t('dash_opening')} {rp(shift.cash)}
          </Text>
        </View>
        <TouchableOpacity style={styles.shiftBtn} onPress={() => navigation?.navigate('Shift')}>
          <Text style={[styles.shiftBtnText, isTablet && styles.shiftBtnTextBig]}>{t('nav_shift')} ›</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.salesCard, isTablet && styles.heroCardTablet]}>
        <Text style={styles.salesLabel}>{t('dash_today')}</Text>
        <Text style={[styles.salesValue, isTablet && styles.salesValueBig]}>{rp(sales.total)}</Text>
        <Text style={[styles.salesSub, isTablet && styles.salesSubBig]}>{sales.trx} {t('unit_trx')} · {t('dash_avg')} {rp(avg)} · {deltaTxt}</Text>
      </View>
      </View>

      <TouchableOpacity style={styles.cta} onPress={() => {
        // Cek live dari DB + segarkan kartu shift (state mount bisa basi sepulang Tutup Shift).
        void (async () => {
          const st = await getShiftStatus();
          if (st) {
            const hhmm = String(st.clockIn ?? '').slice(11, 16);
            setShift((prev) => ({ open: st.open, clockIn: hhmm || prev.clockIn, cash: st.cashInDrawer }));
            if (!st.open) {
              setNotice(`${t('dash_shift_closed')} - ${t('shf_open_btn')}`);
              navigation?.navigate('Shift');
              return;
            }
          }
          setNotice('');
          navigation?.navigate('Cashier');
        })();
      }}>
        <Text style={[styles.ctaText, isTablet && styles.ctaTextBig]}>{t('dash_new_trx')}</Text>
      </TouchableOpacity>

      <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleBig]}>{t('dash_main_menu')}</Text>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={[styles.menuGrid, isTablet && styles.menuGridTablet]}>
        {MENU.map((m) => (
          <TouchableOpacity
            key={m.label}
            style={[styles.menuCell, isTablet && styles.menuCellTablet, m.soon && styles.menuCellSoon]}
            onPress={() => openMenu(m)}>
            <View style={styles.menuTop}>
              <Text style={[styles.menuLabel, isTablet && styles.menuLabelBig]}>{m.label}</Text>
              {m.soon ? (
                <View style={styles.soonBadge}>
                  <Text style={styles.soonText}>{t('badge_soon')}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.menuSub, isTablet && styles.menuSubBig]}>{m.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, isTablet && styles.cardTitleBig]}>{t('dash_table_map')}</Text>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}>
            <Text style={[styles.link, isTablet && styles.linkBig]}>{t('dash_view_layout')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.cardSub, isTablet && styles.cardSubBig]}>{busy} {t('unit_filled')} · {free} {t('unit_empty')} · {resCount} {t('unit_res')}</Text>
        <Text style={[styles.legend, isTablet && styles.legendBig]}>{t('dash_legend')}</Text>
        <View style={styles.grid}>
          {tables.map((tb) => {
            const c = tableStyle(tb.s);
            return (
              <View key={tb.id} style={[styles.cell, isTablet && styles.cellTablet, { backgroundColor: c.bg, borderColor: c.bd }]}>
                <Text style={[styles.cellText, isTablet && styles.cellTextBig, { color: c.tx }]}>{tb.id}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, isTablet && styles.cardTitleBig]}>{t('dash_low_stock')}</Text>
          <TouchableOpacity onPress={() => navigation?.navigate('Stock')}>
            <Text style={[styles.link, isTablet && styles.linkBig]}>{t('dash_manage_stock')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.cardSub, isTablet && styles.cardSubBig]}>{lowStock.length} {t('dash_restock')}</Text>
        {lowStock.map((i) => (
          <View key={i.id || i.name} style={styles.stockRow}>
            <Text style={[styles.stockName, isTablet && styles.stockNameBig]}>{i.name}</Text>
            <Text style={[styles.stockLeft, isTablet && styles.stockLeftBig]}>{t('unit_left')} {i.left}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.quickGrid, isTablet && styles.quickGridTablet]}>
        <TouchableOpacity
          style={[styles.quickCard, isTablet && styles.quickCardTablet]}
          onPress={() => navigation?.navigate('Attendance')}>
          <View style={styles.quickIconWrap}>
            <Text style={styles.quickIcon}>◷</Text>
          </View>
          <View style={styles.quickText}>
            <Text style={[styles.quickLabel, isTablet && styles.quickLabelBig]}>{t('dash_attendance_title')}</Text>
            <Text style={[styles.quickSub, isTablet && styles.quickSubBig]}>{t('dash_attendance_sub')}</Text>
          </View>
          <Text style={styles.quickChev}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.quickCard, isTablet && styles.quickCardTablet]}
          onPress={doLogout}>
          <View style={[styles.quickIconWrap, styles.quickIconDanger]}>
            <Text style={[styles.quickIcon, styles.quickIconDangerText]}>↩</Text>
          </View>
          <View style={styles.quickText}>
            <Text style={[styles.quickLabel, isTablet && styles.quickLabelBig]}>{t('action_logout')}</Text>
            <Text style={[styles.quickSub, isTablet && styles.quickSubBig]}>{t('dash_logout_sub')}</Text>
          </View>
          <Text style={styles.quickChev}>›</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.sync}>{syncLine}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  burger: { width: 22, height: 22 },
  onlineDark: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.navyDark, borderWidth: 1, borderColor: colors.navyTint, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, gap: 6 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  onlineDotAmber: { backgroundColor: colors.amber },
  onlineDotGrey: { backgroundColor: colors.stroke },
  onlineDarkT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.white },
  shiftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.navy,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  /* Tablet: shift + omzet bersebelahan agar halaman tidak terlalu panjang. */
  heroRowTablet: { flexDirection: 'row', gap: 10 },
  heroCardTablet: { flex: 1, marginTop: 12 },
  shiftLeft: { flex: 1 },
  shiftTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shiftDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  shiftDotClosed: { backgroundColor: colors.red },
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
  /* Tablet: peta meja 6 kolom dengan sel >=48px agar mudah disentuh. */
  cellTablet: { width: '14.5%', minHeight: 56, paddingVertical: 14 },
  cellText: { fontFamily: fonts.bold, fontSize: 13 },
  stockRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  stockName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  stockLeft: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  row: { flexDirection: 'row', gap: 16, marginTop: 14 },
  quickGrid: { flexDirection: 'column', gap: 8, marginTop: 12 },
  quickGridTablet: { flexDirection: 'row', gap: 10 },
  quickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 12,
  },
  quickCardTablet: { flex: 1 },
  quickIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.paleBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickIconDanger: { backgroundColor: colors.paleRed },
  quickIcon: { fontFamily: fonts.bold, fontSize: 18, color: colors.blueDark },
  quickIconDangerText: { color: colors.red },
  quickText: { flex: 1 },
  quickLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  quickSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  quickChev: { fontFamily: fonts.bold, fontSize: 22, color: colors.faint },
  sync: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, marginTop: 14, textAlign: 'center' },
  /* Varian tablet (breakpoint TABLET_BP): teks +1..2pt agar proporsional di layar lebar. */
  shiftTitleBig: { fontSize: 16 },
  shiftSubBig: { fontSize: 13 },
  shiftBtnTextBig: { fontSize: 14 },
  salesValueBig: { fontSize: 26 },
  salesSubBig: { fontSize: 13 },
  ctaTextBig: { fontSize: 16 },
  sectionTitleBig: { fontSize: 16 },
  menuLabelBig: { fontSize: 15 },
  menuSubBig: { fontSize: 13 },
  cardTitleBig: { fontSize: 16 },
  cardSubBig: { fontSize: 13 },
  linkBig: { fontSize: 14 },
  legendBig: { fontSize: 12 },
  cellTextBig: { fontSize: 15 },
  stockNameBig: { fontSize: 15 },
  stockLeftBig: { fontSize: 14 },
  quickLabelBig: { fontSize: 15 },
  quickSubBig: { fontSize: 13 },
});
