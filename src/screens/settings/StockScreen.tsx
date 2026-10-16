import { useEffect, useState } from 'react';import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, wideCenter } from '../../theme';import { useLang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { initDb, query, queryFirst, run } from '../../lib/db';import { enqueueOutbox } from '../../lib/sync';import { getBranchId } from '../../config/server';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };interface StockItem {
  id: string;
  name: string;
  group: string;
  stock: number;
  online: boolean;
  track: boolean;}const LS_STOCK = 'genfity.stock.cache';const LS_OPTS = 'genfity.stock.opts';/** Sanitasi qty: bulatkan, tolak NaN/negatif (default 0). */function cleanQty(v: unknown, fallback = 0): number { const n = Number(v); if (!Number.isFinite(n)) return fallback; return Math.max(0, Math.round(n)); }interface StockPersistFlags { track: boolean; trackStock: boolean; allowSellEmpty: boolean; }const DEFAULT_ITEMS: StockItem[] = [
  { id: 'm1', name: 'Ayam Geprek Pelakor', group: 'Makanan Utama', stock: 24, online: true, track: true },
  { id: 'm2', name: 'Es Teh Manis', group: 'Minuman', stock: 60, online: true, track: true },
  { id: 'm3', name: 'Lele Goreng', group: 'Makanan Utama', stock: 2, online: false, track: true },
  { id: 'm4', name: 'Kopi Robusta', group: 'Minuman', stock: 5, online: true, track: true },
  { id: 'm5', name: 'Mie Goreng Jawa', group: 'Makanan Utama', stock: 0, online: false, track: true },];interface StockOpts { trackStock: boolean; lowWarn: boolean; lowLimit: string; allowSellEmpty: boolean; onlineSync: boolean;}const DEFAULT_OPTS: StockOpts = { trackStock: true, lowWarn: true, lowLimit: '5', allowSellEmpty: false, onlineSync: true,};/** Tulis stok item ke ms_branchmenu agar ikut sync master. *//* TODO(M9-10): ms_branchmenu tidak punya kolom track/allowSellEmpty per baris (cek skema di lib/db.ts), sehingga flag pelacakan hanya dibaca dari state lokal LS_OPTS dan tidak ikut sync ke server. Jangan tambah kolom tanpa migrasi aman. */async function persistItemStock(id: string, stock: number, online: boolean, flags: StockPersistFlags): Promise<void> { try { await initDb(); const branchId = getBranchId(); const qty = cleanQty(stock, 0); const tracking = flags.trackStock && flags.track; let soldOut: number; if (!tracking) { const cur = await queryFirst<{ flagSoldOut: number | null }>( 'SELECT flagSoldOut FROM ms_branchmenu WHERE branchId = ? AND menuId = ?', [branchId, id], ); soldOut = (cur?.flagSoldOut ?? 0) === 1 ? 1 : 0; } else if (flags.allowSellEmpty) { soldOut = 0; } else { soldOut = qty <= 0 && !online ? 1 : 0; } await run( `INSERT INTO ms_branchmenu (branchId, menuId, qty, flagSoldOut, flagActive, syncDate) VALUES (?, ?, ?, ?, 1, NULL) ON CONFLICT (branchId, menuId) DO UPDATE SET qty = excluded.qty, flagSoldOut = excluded.flagSoldOut, syncDate = NULL`, [branchId, id, qty, soldOut], ); await enqueueOutbox('ms_branchmenu', `${branchId}:${id}`, 'update'); } catch { /* abaikan: cache JSON tetap menyimpan */ }}export default function StockScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [drawerOpen, setDrawerOpen] =  useState(false);
  const [opts, setOpts] = useState<StockOpts>(DEFAULT_OPTS);
  const [items, setItems] = useState<StockItem[]>(DEFAULT_ITEMS);
  const [queryText, setQueryText] = useState('');

  useEffect(() => { let alive = true; (async () => { const [cachedItems, cachedOpts] = await Promise.all([ getJSON<StockItem[]>(LS_STOCK, DEFAULT_ITEMS), getJSON<StockOpts>(LS_OPTS, DEFAULT_OPTS), ]); if (!alive) return; setOpts({ ...DEFAULT_OPTS, ...cachedOpts }); try { await initDb(); const rows = await query<{ menuId: string; qty: number | null; flagSoldOut: number | null }>( 'SELECT menuId, qty, flagSoldOut FROM ms_branchmenu WHERE branchId = ?', [getBranchId()], ); if (!alive) return; if (rows.length === 0) { setItems(cachedItems); return; } const byId = new Map(rows.map((r) => [r.menuId, r])); setItems( cachedItems.map((it) => { const r = byId.get(it.id); if (!r) return it; const qty = Number(r.qty ?? it.stock); return { ...it, stock: Number.isFinite(qty) ? Math.max(0, Math.round(qty)) : it.stock }; }), ); } catch { if (alive) setItems(cachedItems); } })(); return () => { alive = false; }; }, []); useEffect(() => { void setJSON(LS_STOCK, items); }, [items]); useEffect(() => { void setJSON(LS_OPTS, opts); }, [opts]); const patch = (id: string, p: Partial<StockItem>) =>
    { setItems((xs) => { const next = xs.map((x) => (x.id === id ? { ...x, ...p } : x));

  const changed = next.find((x) => x.id === id); if (changed) void persistItemStock(changed.id, changed.stock, changed.online, { track: changed.track, trackStock: opts.trackStock, allowSellEmpty: opts.allowSellEmpty }); return next; }); }; const bump = (id: string, d: number) =>
    { setItems((xs) => { const next = xs.map((x) => { if (x.id !== id) return x; const base = Number.isFinite(x.stock) ? (x.stock as number) : 0; return { ...x, stock: Math.max(0, Math.round(base + d)) }; });

  const changed = next.find((x) => x.id === id); if (changed) void persistItemStock(changed.id, changed.stock, changed.online, { track: changed.track, trackStock: opts.trackStock, allowSellEmpty: opts.allowSellEmpty }); return next; }); }; const setOpt = <K extends keyof StockOpts>(k: K, v: StockOpts[K]) => setOpts((o) => ({ ...o, [k]: v })); const q = queryText.trim().toLowerCase();
  const lowNum = Number(opts.lowLimit) || 0; const list = items.filter((x) => !q || x.name.toLowerCase().includes(q) || x.group.toLowerCase().includes(q));
  const lowCount = items.filter((x) => x.stock <= lowNum).length; const go = (route: string) => navigation?.navigate(route);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <ScreenHeader title={t('stock.title')} sub={`${lowCount} ${t('dash_restock')}`} onBack={() => setDrawerOpen(true)} backLabel="☰" /> <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('stock.tracking')}</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('stock.trackMenu')}</Text>
          <Switch value={opts.trackStock} onValueChange={(v) => setOpt('trackStock', v)} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('stock.lowWarn')}</Text>
          <Switch value={opts.lowWarn} onValueChange={(v) => setOpt('lowWarn', v)} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <Text style={styles.fieldLabel}>{t('stock.lowLimit')}</Text>
        <TextInput style={styles.input} value={opts.lowLimit} onChangeText={(v) => setOpt('lowLimit', v.replace(/\D/g, '').slice(0, 4))} keyboardType="numeric" placeholder="5" placeholderTextColor={colors.faint} />
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('stock.sellEmpty')}</Text>
          <Switch value={opts.allowSellEmpty} onValueChange={(v) => setOpt('allowSellEmpty', v)} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('stock.online')}</Text>
        <Text style={styles.cardSub}>{t('stock.onlineSub')}</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('stock.syncOnline')}</Text>
          <Switch value={opts.onlineSync} onValueChange={(v) => setOpt('onlineSync', v)} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
      </View>

      <View style={styles.searchWrap}>
        <TextInput style={styles.input} value={queryText} onChangeText={setQueryText} placeholder={t('common.searchMenu')} placeholderTextColor={colors.faint} />
      </View>

      {list.map((x) => {
        const low = x.stock <= lowNum;
        return (
          <View key={x.id} style={[styles.card, low && styles.cardLow]}>
            <View style={styles.itemTop}>
              <Image source={require('../../../assets/images/empty_menu.webp')} style={styles.thumb} resizeMode="contain" />
              <View style={styles.itemLeft}>
                <Text style={styles.itemName}>{x.name}</Text>
                <Text style={styles.itemMeta}>
                  {x.group} - {t('unit_left')} {x.stock}{low ? ` - ${t('stock.low')}` : x.stock === 0 ? ` - ${t('stock.empty')}` : ''}
                </Text>
              </View>
              <View style={styles.stepper}>
                <Pressable style={styles.stepBtn} onPress={() => bump(x.id, -1)}>
                  <Text style={styles.stepText}>-</Text>
                </Pressable>
                <Text style={styles.stepVal}>{x.stock}</Text>
                <Pressable style={styles.stepBtn} onPress={() => bump(x.id, 1)}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>{t('stock.showOnline')}</Text>
              <Switch value={x.online} onValueChange={(v) => patch(x.id, { online: v })} trackColor={{ true: colors.green, false: colors.stroke }} />
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>{t('stock.trackItem')}</Text>
              <Switch value={x.track} onValueChange={(v) => patch(x.id, { track: v })} trackColor={{ true: colors.green, false: colors.stroke }} />
            </View>
          </View>
        );
      })}
      {list.length === 0 ? <Text style={styles.empty}>{t('common.noMatch')}</Text> : null}
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
  cardLow: { borderColor: colors.red },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
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
  searchWrap: { paddingHorizontal: 16, marginTop: 12 },
  itemTop: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 48, height: 48, marginRight: 10 },
  itemLeft: { flex: 1 },
  itemName: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  itemMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  stepVal: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, minWidth: 28, textAlign: 'center' },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 20 },});