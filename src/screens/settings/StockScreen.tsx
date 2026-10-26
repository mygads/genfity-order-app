import { useEffect, useState } from 'react';import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import AppInput from '../../components/AppInput';import ScreenHeader from '../../components/ScreenHeader';import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';import { useLang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { getSession } from '../../session';import { pushStockCount } from '../../lib/stockCountSync';import { getRoundingSetting, initDb, query, type RoundingSetting } from '../../lib/db';import { getBranchId } from '../../config/server';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };interface StockItem {
  id: string;
  name: string;
  group: string;
  stock: number;
  online: boolean;
  track: boolean;}const LS_STOCK = 'genfity.stock.cache';const LS_OPTS = 'genfity.stock.opts';/** Sanitasi qty: bulatkan, tolak NaN/negatif (default 0). */function cleanQty(v: unknown, fallback = 0): number { const n = Number(v); if (!Number.isFinite(n)) return fallback; return Math.max(0, Math.round(n)); }interface StockOpts { trackStock: boolean; lowWarn: boolean; lowLimit: string; allowSellEmpty: boolean; onlineSync: boolean;}const DEFAULT_OPTS: StockOpts = { trackStock: true, lowWarn: true, lowLimit: '5', allowSellEmpty: false, onlineSync: true,};/** Lembar hitung opname + pengaturan global/toggle per-item (TIDAK menulis stok
 * absolut — stok absolut + tandai habis hanya via StockManagementScreen).
 * Stepper di tiap kartu = entri hitung fisik lokal, dikirim sekaligus via
 * "Kirim hasil opname" ke draf server (finalisasi owner). Toggle tampil-online
 * & lacak per item local-only (cache genfity.stock.cache, dibaca juga oleh
 * StockManagement). Kasir menggerbang sendiri (soldOut && !sellEmpty). */export default function StockScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [opts, setOpts] = useState<StockOpts>(DEFAULT_OPTS);
  const [items, setItems] = useState<StockItem[]>([]);
  const [queryText, setQueryText] = useState('');
  // Opname-lite (audit-5d80): dorong hasil hitung ke draf server; finalisasi owner-only.
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const pushOpname = async () => {
    if (pushing) return;
    setPushing(true);
    setPushMsg('');
    try {
      const tid = (getSession()?.terminalId ?? '').trim();
      if (!tid) { setPushMsg(t('stock.opnameNoTerminal')); return; }
      const r = await pushStockCount(tid, items.map((x) => ({ name: x.name, stock: x.stock })));
      setPushMsg(t('stock.opnameResult').replace('{ok}', String(r.submitted)).replace('{skip}', String(r.skipped)).replace('{fail}', String(r.failed)));
    } catch { setPushMsg(t('stock.opnameFailed')); } finally { setPushing(false); }
  };
  // REA-14 display-only: info pembulatan dari ms_setting (tanpa ubah rumus).
  const [rounding, setRounding] = useState<RoundingSetting>({ mode: '', nearest: 0, step: 100 });

  useEffect(() => { let alive = true; (async () => { const [cachedItems, cachedOpts, rnd] = await Promise.all([ getJSON<StockItem[]>(LS_STOCK, []), getJSON<StockOpts>(LS_OPTS, DEFAULT_OPTS), getRoundingSetting(), ]); if (!alive) return; setOpts({ ...DEFAULT_OPTS, ...cachedOpts }); setRounding(rnd); try { await initDb(); const branchId = getBranchId(); const rows = await query<{ id: string; menuName: string | null; groupName: string | null; qty: number | null; flagSoldOut: number | null }>( 'SELECT m.id AS id, m.menuName AS menuName, c.categoryName AS groupName, b.qty AS qty, b.flagSoldOut AS flagSoldOut FROM ms_menu m LEFT JOIN ms_branchmenu b ON b.menuId = m.id AND b.branchId = ? LEFT JOIN ms_category c ON c.id = m.categoryId WHERE (m.flagActive IS NULL OR m.flagActive = 1) AND (b.flagActive IS NULL OR b.flagActive = 1) ORDER BY c.sortOrder, m.menuName', [branchId], ); if (!alive) return; if (rows.length === 0) { setItems([]); return; } const cachedById = new Map(cachedItems.map((it) => [it.id, it])); setItems( rows.map((r) => { const cached = cachedById.get(r.id); const soldOut = (r.flagSoldOut ?? 0) === 1; return { id: r.id, name: r.menuName ?? r.id, group: r.groupName ?? '', stock: cleanQty(r.qty, 0), online: cached?.online ?? !soldOut, track: cached?.track ?? true }; }), ); } catch { if (alive) setItems(cachedItems); } })(); return () => { alive = false; }; }, []); useEffect(() => { void setJSON(LS_STOCK, items); }, [items]); useEffect(() => { void setJSON(LS_OPTS, opts); }, [opts]); const patch = (id: string, p: Partial<StockItem>) =>
    { setItems((xs) => { const next = xs.map((x) => (x.id === id ? { ...x, ...p } : x));

  return next; }); }; const bump = (id: string, d: number) =>
    { setItems((xs) => { const next = xs.map((x) => { if (x.id !== id) return x; const base = Number.isFinite(x.stock) ? (x.stock as number) : 0; return { ...x, stock: Math.max(0, Math.round(base + d)) }; });

  return next; }); }; const setOpt = <K extends keyof StockOpts>(k: K, v: StockOpts[K]) => setOpts((o) => ({ ...o, [k]: v })); const q = queryText.trim().toLowerCase();
  const lowNum = Number(opts.lowLimit) || 0; const list = items.filter((x) => !q || x.name.toLowerCase().includes(q) || x.group.toLowerCase().includes(q));
  const lowCount = items.filter((x) => x.stock <= lowNum).length;

  return (
    <View style={styles.root}>
      <ScreenHeader title={t('stock.title')} sub={`${lowCount} ${t('dash_restock')}`} onBack={() => navigation?.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
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
        <AppInput label={t('stock.lowLimit')} value={opts.lowLimit} onChangeText={(v) => setOpt('lowLimit', v.replace(/\D/g, '').slice(0, 4))} keyboardType="numeric" placeholder="5" />
        {/* R1: server-wins tiap sync login (posConfigSync S-F5, sengaja) —
            kasir diberi tahu agar tak bingung bila kustomnya tertimpa. */}
        <Text style={styles.cardSub}>{t('stock.lowLimitManaged')}</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('stock.sellEmpty')}</Text>
          <Switch value={opts.allowSellEmpty} onValueChange={(v) => setOpt('allowSellEmpty', v)} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        {/* REA-14: tampilkan info pembulatan hanya bila ms_setting menyimpang
            dari default (kunci kanonis: stock.roundInfo; fallback underscore
            + string kosong aman bila kamus belum sinkron; {n} ganda = chained). */}
        {rounding.mode !== '' || rounding.nearest !== 0 || rounding.step !== 100 ? (
          <Text style={styles.cardSub}>
            {(t('stock.roundInfo') || t('stock_round_info')).replace('{mode}', rounding.mode !== '' ? rounding.mode : 'default').replace('{n}', String(rounding.nearest)).replace('{n}', String(rounding.step))}
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('stock.opname')}</Text>
        <Text style={styles.cardSub}>{t('stock.opnameSub')}</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('stock.pushOpname')}</Text>
          <Pressable style={[styles.pushBtn, pushing && styles.pushBtnBusy]} onPress={pushOpname} disabled={pushing}>
            <Text style={styles.pushText}>{pushing ? '…' : t('common.save')}</Text>
          </Pressable>
        </View>
        {pushMsg !== '' ? <Text style={styles.cardSub}>{pushMsg}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('stock.online')}</Text>
        <Text style={styles.cardSub}>{t('stock.onlineSub')}</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('stock.syncOnline')}</Text>
          <Switch value={opts.onlineSync} onValueChange={(v) => setOpt('onlineSync', v)} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        {/* M9-3 tertutup Opsi A untuk stok cabang: didorong ke server. */}
        <Text style={styles.cardSub}>{t('master.branchMenuSyncNote')}</Text>
      </View>

      <View style={styles.searchWrap}>
        <AppInput value={queryText} onChangeText={setQueryText} placeholder={t('common.searchMenu')} />
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
                <Pressable style={[styles.stepBtn, isTablet && styles.stepBtnBig]} onPress={() => bump(x.id, -1)}>
                  <Text style={[styles.stepText, isTablet && styles.stepTextBig]}>-</Text>
                </Pressable>
                <Text style={styles.stepVal}>{x.stock}</Text>
                <Pressable style={[styles.stepBtn, isTablet && styles.stepBtnBig]} onPress={() => bump(x.id, 1)}>
                  <Text style={[styles.stepText, isTablet && styles.stepTextBig]}>+</Text>
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
  // Tablet: target sentuh stepper 44px (phone tetap 30px).
  stepBtnBig: { width: 44, height: 44, borderRadius: 10 },
  stepTextBig: { fontSize: 18 },
  stepText: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  stepVal: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, minWidth: 28, textAlign: 'center' },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 20 },
  pushBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.navy },
  pushBtnBusy: { opacity: 0.6 },
  pushText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },});