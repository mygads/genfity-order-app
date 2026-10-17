import { useEffect, useState } from 'react';import { Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';import { useLang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { initDb, query, run } from '../../lib/db';import { enqueueOutbox } from '../../lib/sync';import { getBranchId } from '../../config/server';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type StationId = 'kasir' | 'dapur' | 'checker' | 'label' | 'none';interface MenuRoute {
  id: string;
  group: string;
  items: number;
  station: StationId;
  printLabel: boolean;}interface PrintOpts { topMargin: string; showPaymentInfo: boolean;
showSalesTime: boolean;}const LS_ROUTES = 'genfity.menuPrint.routes';const LS_OPTS = 'genfity.menuPrint.opts';const STATIONS: { id: StationId }[] = [
  { id: 'kasir' },
  { id: 'dapur' },
  { id: 'checker' },
  { id: 'label' },
  { id: 'none' },];const DEFAULT_ROUTES: MenuRoute[] = [
  { id: 'r1', group: 'Makanan Utama', items: 24, station: 'dapur', printLabel: false },
  { id: 'r2', group: 'Makanan Ringan', items: 12, station: 'dapur', printLabel: false },
  { id: 'r3', group: 'Minuman', items: 18, station: 'checker', printLabel: false },
  { id: 'r4', group: 'Dessert', items: 8, station: 'checker', printLabel: false },
  { id: 'r5', group: 'Paket / Bundle', items: 6, station: 'dapur', printLabel: true },];const DEFAULT_OPTS: PrintOpts = { topMargin: '2', showPaymentInfo: false, showSalesTime: true };/** M9/R53: cabang routing = id cabang aktif; '' = unbound — persistRoutes
 * MENOLAK seluruh tulis DB (bukan hanya per-cabang) + banner unbound;
 * cache JSON pemanggil tetap menyimpan. */

/** APP-PRINTER (audit row 7/11, tag-consistent): routing MENU→STATION di sini
 * adalah peta fisik (menu grup → printer kasir/dapur/checker/label), BUKAN
 * feature gate. Tag terminal (kasir/dapur/full_access/view_*) mengatur ROUTING
 * event/notifikasi di dispatcher, bukan memblokir fitur — kasir/dapur/full =
 * fitur penuh. Station kanonis ST-KASIR/ST-DAPUR/ST-CHECKER/ST-LABEL di bawah
 * adalah address book printer; SELEKSI aktif di-scope per terminal klaim
 * (scopeRank di lib/print.ts), jadi routing ini tetap valid lintas terminal. */
/** Pilihan station UI -> id station kanonis (kolom id ms_station, dibaca KitchenScreen). */
const STATION_ID_OF: Record<StationId, string | null> = {
  kasir: 'ST-KASIR',
  dapur: 'ST-DAPUR',
  checker: 'ST-CHECKER',
  label: 'ST-LABEL',
  none: null,
};

/** Simpan routing: stationId per menu ke ms_menu + ms_branchmenu (sumber yang
 * dibaca KitchenScreen), definisi station kanonis ke ms_station dengan
 * connection = tipe koneksi (Bluetooth/LAN/Star) dan printerType = peran
 * (receipt/kitchen/checker/label), plus peta grup + opsi ke ms_setting agar
 * persisten dan ikut sync master. */
async function persistRoutes(routes: MenuRoute[], opts: PrintOpts): Promise<void> {
  try {
    // R53: unbound = tolak tulis DB seluruhnya — tanpa branch, stationId grup
    // bisa menimpa menu cabang lain; cache JSON pemanggil tetap menyimpan.
    const branchId = (getBranchId() || '').trim();
    if (!branchId) return;
    await initDb();
    // 1. Pastikan definisi station kanonis ada; baris pull master menang bila
    // sudah ada (DO NOTHING) agar alamat printer dari server tidak tertimpa.
    const defs = [
      { id: 'ST-KASIR', name: 'Printer Kasir', conn: 'Bluetooth', ptype: 'receipt' },
      { id: 'ST-DAPUR', name: 'Printer Dapur', conn: 'LAN', ptype: 'kitchen' },
      { id: 'ST-CHECKER', name: 'Printer Checker', conn: 'LAN', ptype: 'checker' },
      { id: 'ST-LABEL', name: 'Printer Label', conn: 'Star', ptype: 'label' },
    ];
    for (const d of defs) {
      await run(
        'INSERT INTO ms_station (id, stationName, connection, printerType, flagActive, syncDate) VALUES (?, ?, ?, ?, 1, NULL) ON CONFLICT (id) DO NOTHING',
        [d.id, d.name, d.conn, d.ptype],
      );
    }
    // 2. Routing per grup: tulis stationId ke tiap menu dalam grup tersebut.
    // R52: grup UI = nama tampil — selesaikan ke CODE kategori via
    // ms_category (categoryId menyimpan id, bukan nama); fallback cocokkan
    // mentah untuk data lama yang menyimpan nama di categoryId.
    for (const r of routes) {
      const sid = STATION_ID_OF[r.station];
      let codes: string[] = [];
      try {
        const cats = await query<{ id: string }>(
          'SELECT id FROM ms_category WHERE categoryName = ? LIMIT 5',
          [r.group],
        );
        codes = cats.map((c) => String(c.id ?? '').trim()).filter(Boolean);
      } catch { /* fallback di bawah */ }
      if (codes.length === 0) codes = [r.group];
      for (const code of codes) {
        const menus = await query<{ id: string }>(
          'SELECT id FROM ms_menu WHERE categoryId = ?',
          [code],
        );
        for (const m of menus) {
        if (sid) {
          await run('UPDATE ms_menu SET stationId = ?, syncDate = NULL WHERE id = ?', [sid, m.id]);
          if (branchId) {
            await run(
              'UPDATE ms_branchmenu SET stationId = ?, syncDate = NULL WHERE branchId = ? AND menuId = ?',
              [sid, branchId, m.id],
            );
          }
        } else {
          await run('UPDATE ms_menu SET stationId = NULL, syncDate = NULL WHERE id = ?', [m.id]);
          if (branchId) {
            await run(
              'UPDATE ms_branchmenu SET stationId = NULL, syncDate = NULL WHERE branchId = ? AND menuId = ?',
              [branchId, m.id],
            );
          }
        }
        await enqueueOutbox('ms_menu', m.id, 'update');
        // R53: di sini branchId selalu terisi (return awal bila unbound).
        if (branchId) await enqueueOutbox('ms_branchmenu', `${branchId}:${m.id}`, 'update');
        }
      }
    }
    // 3. Peta routing grup + opsi tiket agar persisten dan ikut sync master.
    await run(
      "INSERT INTO ms_setting (key1, key2, value1, syncDate) VALUES ('menuPrint', 'routes', ?, NULL) ON CONFLICT (key1, key2) DO UPDATE SET value1 = excluded.value1, syncDate = NULL",
      [JSON.stringify(routes)],
    );
    await run(
      "INSERT INTO ms_setting (key1, key2, value1, syncDate) VALUES ('menuPrint', 'opts', ?, NULL) ON CONFLICT (key1, key2) DO UPDATE SET value1 = excluded.value1, syncDate = NULL",
      [JSON.stringify(opts)],
    );
  } catch {
    /* abaikan: cache JSON tetap menyimpan */
  }
}export default function MenuPrintingScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [routes, setRoutes] = useState<MenuRoute[]>(DEFAULT_ROUTES);
  const [opts, setOpts] = useState<PrintOpts>(DEFAULT_OPTS);
  // M9/R53: '' = unbound — banner jujur (tulis DB ditolak persistRoutes).
  const unboundBranch = (() => {
    try {
      return !getBranchId();
    } catch {
      return true;
    }
  })(); useEffect(() => { let alive = true; (async () => {
  const [cachedRoutes, cachedOpts] = await Promise.all([ getJSON<MenuRoute[]>(LS_ROUTES, DEFAULT_ROUTES), getJSON<PrintOpts>(LS_OPTS, DEFAULT_OPTS), ]); if (!alive) return; const base = cachedRoutes.length > 0 ? cachedRoutes : DEFAULT_ROUTES; if (cachedRoutes.length > 0) setRoutes(cachedRoutes); setOpts({ ...DEFAULT_OPTS, ...cachedOpts });
      // Hitungan item jujur dari ms_menu live per grup (bukan angka contoh
      // 24/12/18/8/6); grup merchant sendiri tetap dipertahankan.
      // R52: categoryId menyimpan CODE — petakan ke nama tampil via
      // ms_category (fallback kode mentah untuk baris legacy tanpa kategori).
      try {
        await initDb();
        let codeName: Record<string, string> = {};
        try {
          const cats = await query<{ id: string; categoryName: string | null }>(
            'SELECT id, categoryName FROM ms_category LIMIT 200',
          );
          for (const c of cats) {
            const code = String(c.id ?? '').trim();
            const nm = String(c.categoryName ?? '').trim();
            if (code && nm) codeName[code.toLowerCase()] = nm;
          }
        } catch { /* tanpa peta: cocokkan mentah */ }
        const counts = await query<{ g: string | null; n: number }>(
          'SELECT categoryId AS g, COUNT(*) AS n FROM ms_menu GROUP BY categoryId',
        );
        if (alive && counts.length > 0) {
          const byGroup: Record<string, number> = {};
          for (const c of counts) {
            const g = (c.g ?? '').trim();
            if (g) byGroup[codeName[g.toLowerCase()] ?? g] = Number(c.n) || 0;
          }
          if (Object.keys(byGroup).length > 0) {
            setRoutes((prev) => {
              const src = prev.length > 0 ? prev : base;
              let changed = false;
              const next = src.map((r) => {
                const n = byGroup[r.group];
                if (n === undefined || n === r.items) return r;
                changed = true;
                return { ...r, items: n };
              });
              return changed ? next : prev;
            });
          }
        }
      } catch { /* hitungan opsional - cache tetap dipakai */ } })(); return () => { alive = false; }; }, []); useEffect(() => { void setJSON(LS_ROUTES, routes); }, [routes]); useEffect(() => { void setJSON(LS_OPTS, opts); void persistRoutes(routes, opts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.topMargin, opts.showPaymentInfo, opts.showSalesTime]);

  const patch = (id: string, p: Partial<MenuRoute>) =>
    { setRoutes((rs) => { const next = rs.map((r) => (r.id === id ? { ...r, ...p } : r)); void setJSON(LS_ROUTES, next); void persistRoutes(next, opts); return next; }); };

  // R53: UI mati yang dihapus — switch printLabel per rute + kartu opsi dapur
  // (topMargin/showPay/showTime). Model data (printLabel, PrintOpts) tetap
  // dipertahankan + ikut tersimpan (persistRoutes/ms_setting) tanpa UI.
  const stationLabel = (id: StationId) => id === 'kasir' ? t('mprint.st_kasir') : id === 'dapur' ? t('mprint.st_dapur') : id === 'checker' ? t('mprint.st_checker') : id === 'label' ? t('mprint.st_label') : t('mprint.st_none');

  const go = (route: string) => navigation?.navigate(route); return (
    <View style={styles.root}>
      <ScreenHeader title={t('mprint.title')} sub={t('mprint.sub')} left={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
          <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
        </TouchableOpacity>
      } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      {/* Tablet: kartu routing 2 kolom; phone tetap 1 kolom (wadah transparan). */}
      <View style={isTablet ? styles.gridTablet : undefined}>
      {routes.map((r) => (
        <View key={r.id} style={[styles.card, isTablet && styles.cardTablet]}>
          <View style={styles.cardTop}>
            <View style={styles.cardLeft}>
              <Text style={styles.groupName}>{r.group}</Text>
              <Text style={styles.groupMeta}>{t('mprint.groupMeta').replace('{n}', String(r.items)).replace('{s}', stationLabel(r.station))}</Text>
            </View>
            <Image source={require('../../../assets/images/empty_menu.webp')} style={styles.thumb} resizeMode="contain" />
          </View>
          <View style={styles.chipRow}>
            {STATIONS.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => patch(r.id, { station: s.id })}
                style={[styles.chip, r.station === s.id && styles.chipActive]}>
                <Text style={[styles.chipText, r.station === s.id && styles.chipTextActive]}>{stationLabel(s.id)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      </View>
      {unboundBranch ? <Text style={[styles.foot, { color: colors.red }]}>{t('terminal_unbound_hint')}</Text> : null}
      <Text style={styles.foot}>{t('mprint.saved')}</Text>
      </ScrollView>
    </View>
  );}const styles = StyleSheet.create({
  burger: { width: 22, height: 22 },
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { paddingBottom: 32 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardLeft: { flex: 1, paddingRight: 10 },
  groupName: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  groupMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  thumb: { width: 56, height: 56 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  chipText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  chipTextActive: { color: colors.white },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 10 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.white,
    marginTop: 6,
  },
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14 },
  // Tablet: grid kartu routing 2 kolom (phone tak tersentuh).
  gridTablet: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  cardTablet: { flexBasis: '48%', flexGrow: 1, marginHorizontal: 0 },});