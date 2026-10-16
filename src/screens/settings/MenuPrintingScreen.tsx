import { useEffect, useState } from 'react';import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, wideCenter } from '../../theme';import { useLang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { initDb, query, run } from '../../lib/db';import { enqueueOutbox } from '../../lib/sync';import { getBranchId } from '../../config/server';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type StationId = 'kasir' | 'dapur' | 'checker' | 'label' | 'none';interface MenuRoute {
  id: string;
  group: string;
  items: number;
  station: StationId;
  printLabel: boolean;}interface PrintOpts { topMargin: string; showPaymentInfo: boolean;
showSalesTime: boolean;}const LS_ROUTES = 'genfity.menuPrint.routes';const LS_OPTS = 'genfity.menuPrint.opts';const STATIONS: { id: StationId; label: string }[] = [
  { id: 'kasir', label: 'Kasir' },
  { id: 'dapur', label: 'Dapur' },
  { id: 'checker', label: 'Checker' },
  { id: 'label', label: 'Label' },
  { id: 'none', label: 'Jangan Cetak' },];const DEFAULT_ROUTES: MenuRoute[] = [
  { id: 'r1', group: 'Makanan Utama', items: 24, station: 'dapur', printLabel: false },
  { id: 'r2', group: 'Makanan Ringan', items: 12, station: 'dapur', printLabel: false },
  { id: 'r3', group: 'Minuman', items: 18, station: 'checker', printLabel: false },
  { id: 'r4', group: 'Dessert', items: 8, station: 'checker', printLabel: false },
  { id: 'r5', group: 'Paket / Bundle', items: 6, station: 'dapur', printLabel: true },];const DEFAULT_OPTS: PrintOpts = { topMargin: '2', showPaymentInfo: false, showSalesTime: true };/** Cabang routing: id cabang aktif (fallback B001 bila terminal belum diklaim,
 * selaras getBranchId + dummy pull + Stock/MenuManagement). */

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
    await initDb();
    const branchId = getBranchId();
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
    // Grup dicocokkan ke ms_menu.categoryId (menu lokal menyimpan nama grup di
    // kolom itu; dummy pull memakai C01.. sehingga tak cocok - peta grup tetap
    // tersimpan di ms_setting di bawah + TODO chip dinamis dari ms_category).
    for (const r of routes) {
      const sid = STATION_ID_OF[r.station];
      const menus = await query<{ id: string }>(
        'SELECT id FROM ms_menu WHERE categoryId = ?',
        [r.group],
      );
      for (const m of menus) {
        if (sid) {
          await run('UPDATE ms_menu SET stationId = ?, syncDate = NULL WHERE id = ?', [sid, m.id]);
          await run(
            'UPDATE ms_branchmenu SET stationId = ?, syncDate = NULL WHERE branchId = ? AND menuId = ?',
            [sid, branchId, m.id],
          );
        } else {
          await run('UPDATE ms_menu SET stationId = NULL, syncDate = NULL WHERE id = ?', [m.id]);
          await run(
            'UPDATE ms_branchmenu SET stationId = NULL, syncDate = NULL WHERE branchId = ? AND menuId = ?',
            [branchId, m.id],
          );
        }
        await enqueueOutbox('ms_menu', m.id, 'update');
        await enqueueOutbox('ms_branchmenu', `${branchId}:${m.id}`, 'update');
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
  const [opts, setOpts] = useState<PrintOpts>(DEFAULT_OPTS); useEffect(() => { let alive = true; (async () => {
  const [cachedRoutes, cachedOpts] = await Promise.all([ getJSON<MenuRoute[]>(LS_ROUTES, DEFAULT_ROUTES), getJSON<PrintOpts>(LS_OPTS, DEFAULT_OPTS), ]); if (!alive) return; if (cachedRoutes.length > 0) setRoutes(cachedRoutes); setOpts({ ...DEFAULT_OPTS, ...cachedOpts }); })(); return () => { alive = false; }; }, []); useEffect(() => { void setJSON(LS_ROUTES, routes); }, [routes]); useEffect(() => { void setJSON(LS_OPTS, opts); void persistRoutes(routes, opts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.topMargin, opts.showPaymentInfo, opts.showSalesTime]);

  const patch = (id: string, p: Partial<MenuRoute>) =>
    { setRoutes((rs) => { const next = rs.map((r) => (r.id === id ? { ...r, ...p } : r)); void setJSON(LS_ROUTES, next); void persistRoutes(next, opts); return next; }); };

  const setOpt = <K extends keyof PrintOpts>(k: K, v: PrintOpts[K]) => setOpts((o) => ({ ...o, [k]: v })); const stationLabel = (id: StationId) => STATIONS.find((s) => s.id === id)?.label ?? id;

  const go = (route: string) => navigation?.navigate(route); return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <ScreenHeader title={t('mprint.title')} sub={t('mprint.sub')} onBack={() => setDrawerOpen(true)} backLabel="☰" /> <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />

      {routes.map((r) => (
        <View key={r.id} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.cardLeft}>
              <Text style={styles.groupName}>{r.group}</Text>
              <Text style={styles.groupMeta}>{r.items} menu - cetak ke {stationLabel(r.station)}</Text>
            </View>
            <Image source={require('../../../assets/images/empty_menu.webp')} style={styles.thumb} resizeMode="contain" />
          </View>
          <View style={styles.chipRow}>
            {STATIONS.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => patch(r.id, { station: s.id })}
                style={[styles.chip, r.station === s.id && styles.chipActive]}>
                <Text style={[styles.chipText, r.station === s.id && styles.chipTextActive]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>{t('mprint.sticker')}</Text>
            <Switch value={r.printLabel} onValueChange={(v) => patch(r.id, { printLabel: v })} trackColor={{ true: colors.green, false: colors.stroke }} />
          </View>
        </View>
      ))}

      <View style={styles.card}>
        <Text style={styles.groupName}>{t('mprint.kitchenOpts')}</Text>
        <Text style={styles.groupMeta}>{t('mprint.kitchenSub')}</Text>
        <Text style={styles.fieldLabel}>{t('mprint.topMargin')}</Text>
        <TextInput
          style={styles.input}
          value={opts.topMargin} onChangeText={(v) => setOpt('topMargin', v.replace(/\D/g, '').slice(0, 2))}
          keyboardType="numeric"
          placeholder="2"
          placeholderTextColor={colors.faint}
        />
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('mprint.showPay')}</Text>
          <Switch value={opts.showPaymentInfo} onValueChange={(v) => setOpt('showPaymentInfo', v)} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('mprint.showTime')}</Text>
          <Switch value={opts.showSalesTime} onValueChange={(v) => setOpt('showSalesTime', v)} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
      </View>
      <Text style={styles.foot}>{t('mprint.saved')}</Text>
    </ScrollView>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14 },});