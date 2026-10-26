import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AppInput from '../../components/AppInput';
import ScreenHeader from '../../components/ScreenHeader';
import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';
import { useLang } from '../../lib/i18n';
import { getJSON } from '../../lib/storage';
import { initDb, query } from '../../lib/db';
import { isCatalogImageReady, noteCatalogImageError, prefetchCatalogImage } from '../../lib/catalogImages';
import { getBranchId } from '../../config/server';
import {
  cleanQty,
  cleanThreshold,
  getAllLocalFlags,
  persistBranchQty,
  setBranchThreshold,
  type StockKind,
} from '../../lib/stockWrite';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type Status = 'untracked' | 'out' | 'low' | 'healthy' | 'inactive';

/** Satu baris stok seragam menu/addon — cermin FE StockItem InventoryPanel. */
interface StockRow {
  kind: StockKind;
  id: string;
  name: string;
  sub: string;
  price: number | null;
  imageUrl: string | null;
  serverTrack: boolean;
  active: boolean;
  qty: number;
  /** Template harian server (NULL = tanpa template → tombol reset tak tampil). */
  template: number | null;
  threshold: number | null;
  soldOut: boolean;
}

interface StockOpts {
  trackStock: boolean;
  lowWarn: boolean;
  lowLimit: string;
  allowSellEmpty: boolean;
  onlineSync: boolean;
}

const LS_OPTS = 'genfity.stock.opts';
const DEFAULT_OPTS: StockOpts = { trackStock: true, lowWarn: false, lowLimit: '5', allowSellEmpty: false, onlineSync: true };

function deriveStatus(r: StockRow, tracked: boolean, lowEff: number): Status {
  if (!r.active) return 'inactive';
  if (!tracked) return 'untracked';
  if (r.qty <= 0) return 'out';
  if (r.qty <= lowEff) return 'low';
  return 'healthy';
}

function ItemCard(props: {
  row: StockRow;
  tracked: boolean;
  lowEff: number;
  globalLow: number;
  globalTrack: boolean;
  status: Status;
  onChanged: () => void;
}) {
  const { t } = useLang();
  const { row, tracked, lowEff, globalLow, globalTrack, status, onChanged } = props;
  const [, setImgTick] = useState(0);
  const [draft, setDraft] = useState<string>(row.threshold !== null && row.threshold !== undefined ? String(row.threshold) : '');
  const [busy, setBusy] = useState(false);

  const saveQty = async (qty: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const flags = await getAllLocalFlags(row.kind).then((m) => m.get(row.id));
      await persistBranchQty(row.kind, row.id, cleanQty(qty, row.qty), {
        globalTrack,
        localTrack: flags?.track ?? true,
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const saveThreshold = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setBranchThreshold(row.kind, row.id, cleanThreshold(draft));
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const badge =
    status === 'out' ? (
      <View style={styles.badgeOut}><Text style={styles.badgeOutText}>{t('stockMgmt.badgeOut')}</Text></View>
    ) : status === 'low' ? (
      <View style={styles.badgeLow}><Text style={styles.badgeLowText}>{t('stockMgmt.badgeLow')}</Text></View>
    ) : status === 'healthy' ? (
      <Text style={styles.badgeOkText}>{t('stockMgmt.badgeOk')}</Text>
    ) : null;

  return (
    <View style={[styles.card, status === 'out' && styles.cardOut, status === 'low' && styles.cardLow]}>
      <View style={styles.itemTop}>
        {row.kind === 'menu' ? (
          row.imageUrl && isCatalogImageReady(row.imageUrl) ? (
            <Image
              source={{ uri: row.imageUrl }}
              style={styles.thumb}
              resizeMode="cover"
              onError={() => { noteCatalogImageError(row.imageUrl); setImgTick((x) => x + 1); }}
            />
          ) : (
            <Image source={require('../../../assets/images/empty_menu.webp')} style={styles.thumb} resizeMode="contain" />
          )
        ) : (
          <View style={[styles.thumb, styles.thumbAddon]}><Text style={styles.thumbAddonText}>+</Text></View>
        )}
        <View style={styles.itemLeft}>
          <Text style={styles.itemName}>{row.name}</Text>
          <Text style={styles.itemMeta}>
            {row.sub}{row.price !== null && row.price !== undefined ? ` · ${rp(row.price)}` : ''}
          </Text>
          <Text style={styles.itemMeta}>
            {tracked ? t('stockMgmt.tracked') : t('stockMgmt.untracked')}
            {!row.active ? ` · ${t('stockMgmt.inactive')}` : ''}
            {` · ${t('unit_left')} ${row.qty}`}
          </Text>
        </View>
        {badge}
      </View>
      <View style={styles.stepRow}>
        <View style={styles.stepper}>
          <Pressable style={styles.stepBtn} onPress={() => saveQty(row.qty - 1)} disabled={busy}>
            <Text style={styles.stepText}>-</Text>
          </Pressable>
          <Text style={styles.stepVal}>{row.qty}</Text>
          <Pressable style={styles.stepBtn} onPress={() => saveQty(row.qty + 1)} disabled={busy}>
            <Text style={styles.stepText}>+</Text>
          </Pressable>
          <Pressable style={styles.stepBtn} onPress={() => saveQty(row.qty + 10)} disabled={busy}>
            <Text style={styles.stepTextSm}>+10</Text>
          </Pressable>
        </View>
        {/* FE handleMarkOutOfStock = set stockQty 0 (bukan flag) — konsisten web↔APP. */}
        <Pressable style={[styles.outBtn, busy && styles.btnBusy]} onPress={() => saveQty(0)} disabled={busy}>
          <Text style={styles.outText}>{t('stockMgmt.markOut')}</Text>
        </Pressable>
      </View>
      {/* FE handleResetToTemplate: kirim qty = template via jalur absolut yang sama
          (persistBranchQty → drain Opsi A). Guard `tracked && template != null`
          cermin FE `disabled={item.dailyStockTemplate === null}`. */}
      {tracked && row.template !== null && row.template !== undefined ? (
        <View style={styles.resetRow}>
          <Pressable style={[styles.resetBtn, busy && styles.btnBusy]} onPress={() => saveQty(row.template as number)} disabled={busy}>
            <Text style={styles.resetText}>{t('stockMgmt.resetTpl').replace('{n}', String(row.template))}</Text>
          </Pressable>
        </View>
      ) : null}
      {tracked ? (
        <View style={styles.thRow}>
          <Text style={styles.rowLabel}>{t('stockMgmt.threshold')} ({t('stockMgmt.filterHealthy')}: &gt;{lowEff})</Text>
          <View style={styles.thInputRow}>
            <View style={styles.thFlex}>
              <AppInput
                value={draft}
                onChangeText={(v) => setDraft(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="numeric"
                placeholder={t('stockMgmt.useGlobal').replace('{n}', String(globalLow))}
                onSubmitEditing={saveThreshold}
              />
            </View>
            <Pressable style={[styles.applyBtn, busy && styles.btnBusy]} onPress={saveThreshold} disabled={busy}>
              <Text style={styles.applyText}>{t('common.save')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function StockManagementScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [flagsMenu, setFlagsMenu] = useState<Map<string, { online: boolean; track: boolean }>>(new Map());
  const [flagsAddon, setFlagsAddon] = useState<Map<string, { online: boolean; track: boolean }>>(new Map());
  const [opts, setOpts] = useState<StockOpts>(DEFAULT_OPTS);
  const [tab, setTab] = useState<'all' | 'menu' | 'addon'>('all');
  const [filter, setFilter] = useState<'all' | 'healthy' | 'low' | 'out'>('all');
  const [queryText, setQueryText] = useState('');
  const [tick, setTick] = useState(0);
  /** Guard tombol reset-semua (FE handleResetSelected/all → sekuensial absolut). */
  const [resettingAll, setResettingAll] = useState(false);
  /** Re-render saat prefetch sesi-ini selesai (placeholder → remote terverifikasi). */
  const [, setImgRev] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cachedOpts, fMenu, fAddon] = await Promise.all([
        getJSON<StockOpts>(LS_OPTS, DEFAULT_OPTS),
        getAllLocalFlags('menu'),
        getAllLocalFlags('addon'),
      ]);
      if (!alive) return;
      setOpts({ ...DEFAULT_OPTS, ...cachedOpts });
      setFlagsMenu(fMenu);
      setFlagsAddon(fAddon);
      try {
        await initDb();
        const branchId = getBranchId();
        const menus = await query<{
          id: string; menuName: string | null; categoryName: string | null;
          price: number | null; imageUrl: string | null; trackStock: number | null;
          flagActive: number | null; qty: number | null; lowThreshold: number | null;
          flagSoldOut: number | null; stockTemplate: number | null;
        }>(
          `SELECT m.id AS id, m.menuName AS menuName, c.categoryName AS categoryName,
                  m.price AS price, m.imageUrl AS imageUrl, m.trackStock AS trackStock,
                  m.flagActive AS flagActive, b.qty AS qty, b.lowThreshold AS lowThreshold,
                  b.flagSoldOut AS flagSoldOut, m.stockTemplate AS stockTemplate
           FROM ms_menu m
           LEFT JOIN ms_branchmenu b ON b.menuId = m.id AND b.branchId = ?
           LEFT JOIN ms_category c ON c.id = m.categoryId
           WHERE (m.flagActive IS NULL OR m.flagActive = 1)
             AND (b.flagActive IS NULL OR b.flagActive = 1)
           ORDER BY c.sortOrder, m.menuName`,
          [branchId],
        );
        const addons = await query<{
          id: string; addonName: string | null; categoryName: string | null;
          price: number | null; trackStock: number | null; flagActive: number | null;
          qty: number | null; lowThreshold: number | null; flagSoldOut: number | null;
          parents: string | null; stockTemplate: number | null;
        }>(
          `SELECT a.id AS id, a.addonName AS addonName, c.categoryName AS categoryName,
                  a.price AS price, a.trackStock AS trackStock, a.flagActive AS flagActive,
                  b.qty AS qty, b.lowThreshold AS lowThreshold, b.flagSoldOut AS flagSoldOut,
                  a.stockTemplate AS stockTemplate,
                  (SELECT GROUP_CONCAT(m.menuName, ', ') FROM ms_menuaddon ma
                    JOIN ms_menu m ON m.id = ma.menuId WHERE ma.categoryId = a.categoryId) AS parents
           FROM ms_addon a
           LEFT JOIN ms_addoncategory c ON c.id = a.categoryId
           LEFT JOIN ms_branchaddon b ON b.addonId = a.id AND b.branchId = ?
           WHERE (a.flagActive IS NULL OR a.flagActive = 1)
             AND (b.flagActive IS NULL OR b.flagActive = 1)
           ORDER BY c.categoryName, a.addonName`,
          [branchId],
        );
        if (!alive) return;
        const menuRows: StockRow[] = menus.map((r) => ({
          kind: 'menu',
          id: r.id,
          name: r.menuName ?? r.id,
          sub: r.categoryName ?? '',
          price: r.price !== null && r.price !== undefined ? Number(r.price) : null,
          imageUrl: (r.imageUrl ?? '').trim() ? String(r.imageUrl).trim() : null,
          serverTrack: (r.trackStock ?? 1) === 1,
          active: (r.flagActive ?? 1) === 1,
          qty: cleanQty(r.qty, 0),
          template: r.stockTemplate !== null && r.stockTemplate !== undefined ? Number(r.stockTemplate) : null,
          threshold: r.lowThreshold !== null && r.lowThreshold !== undefined ? Number(r.lowThreshold) : null,
          soldOut: (r.flagSoldOut ?? 0) === 1,
        }));
        const addonRows: StockRow[] = addons.map((r) => ({
          kind: 'addon',
          id: r.id,
          name: r.addonName ?? r.id,
          sub: [r.categoryName, r.parents ? `${t('stockMgmt.variants')}: ${r.parents}` : ''].filter(Boolean).join(' · '),
          price: r.price !== null && r.price !== undefined ? Number(r.price) : null,
          imageUrl: null,
          serverTrack: (r.trackStock ?? 1) === 1,
          active: (r.flagActive ?? 1) === 1,
          qty: cleanQty(r.qty, 0),
          template: r.stockTemplate !== null && r.stockTemplate !== undefined ? Number(r.stockTemplate) : null,
          threshold: r.lowThreshold !== null && r.lowThreshold !== undefined ? Number(r.lowThreshold) : null,
          soldOut: (r.flagSoldOut ?? 0) === 1,
        }));
        setRows([...menuRows, ...addonRows]);
        // K4-lazy: verifikasi thumb remote sesi-ini (fail-closed; offline =
        // placeholder). Tanpa ini isCatalogImageReady selalu false → thumb
        // remote tak pernah tampil (pengganti tombol unduh per-item layar lama,
        // yang bukan bagian FE stock page). Tanpa dep baru, tak pernah melempar.
        try {
          const urls = [...new Set(menuRows.map((m) => m.imageUrl).filter((u): u is string => !!u))];
          if (urls.length > 0) {
            void Promise.all(urls.map((u) => prefetchCatalogImage(u, 8000))).then((oks) => {
              if (alive && oks.some(Boolean)) setImgRev((x) => x + 1);
            });
          }
        } catch {
          /* abaikan — placeholder tetap tampil */
        }
      } catch {
        if (alive) setRows([]);
      }
    })();
    return () => { alive = false; };
  }, [tick]);

  const refresh = () => setTick((x) => x + 1);
  const globalTrack = opts.trackStock;
  const globalLow = Math.max(0, Number(opts.lowLimit) || 0);

  const withStatus = rows.map((r) => {
    const local = (r.kind === 'addon' ? flagsAddon : flagsMenu).get(r.id);
    const tracked = globalTrack && (local?.track ?? true) && r.serverTrack;
    const lowEff = r.threshold ?? globalLow;
    return { r, tracked, lowEff, status: deriveStatus(r, tracked, lowEff) };
  });

  const q = queryText.trim().toLowerCase();
  const list = withStatus.filter(
    ({ r, status }) =>
      (tab === 'all' || r.kind === tab) &&
      (filter === 'all' || status === filter) &&
      (!q || r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)),
  );
  const outCount = withStatus.filter((x) => x.status === 'out').length;
  const lowCount = withStatus.filter((x) => x.status === 'low').length;
  const healthyCount = withStatus.filter((x) => x.status === 'healthy').length;

  // Baris layak-reset: dilacak + punya template (cermin guard FE
  // `dailyStockTemplate === null → disabled`). Multi-select ala FE
  // handleResetSelected tak ada di APP (tanpa selection UX) → reset-semua.
  const tplEligible = withStatus.filter(
    ({ r, tracked }) => tracked && r.template !== null && r.template !== undefined,
  );

  // FE performResetAllToTemplate: absolut per item via jalur yang sama
  // (persistBranchQty → drain Opsi A). Sekuensial agar antrean drain
  // deterministik; flag lokal dari state (sumber yang sama dengan `tracked`).
  const resetAll = async () => {
    if (resettingAll || tplEligible.length === 0) return;
    setResettingAll(true);
    try {
      const maps = { menu: flagsMenu, addon: flagsAddon } as const;
      for (const { r } of tplEligible) {
        const local = maps[r.kind].get(r.id);
        await persistBranchQty(r.kind, r.id, cleanQty(r.template as number, r.qty), {
          globalTrack,
          localTrack: local?.track ?? true,
        });
      }
      refresh();
    } finally {
      setResettingAll(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('stockMgmt.title')}
        sub={`${rows.length} item · ${outCount} ${t('stockMgmt.filterOut')} · ${lowCount} ${t('stockMgmt.filterLow')} · ${healthyCount} ${t('stockMgmt.filterHealthy')}`}
        onBack={() => navigation?.goBack()}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
        <View style={styles.readonlyBanner}>
          <Text style={styles.readonlyText}>{t('stockMgmt.readonlyNote')}</Text>
        </View>
        <View style={styles.searchWrap}>
          <AppInput value={queryText} onChangeText={setQueryText} placeholder={t('stockMgmt.searchPh')} />
        </View>
        <View style={styles.tabs}>
          {(['all', 'menu', 'addon'] as const).map((k) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabActive]}>
              <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>
                {k === 'all' ? t('stockMgmt.tabAll') : k === 'menu' ? t('stockMgmt.tabMenu') : t('stockMgmt.tabAddon')}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.tabs}>
          {(['all', 'healthy', 'low', 'out'] as const).map((k) => (
            <Pressable key={k} onPress={() => setFilter(k)} style={[styles.tab, filter === k && styles.tabActive]}>
              <Text style={[styles.tabText, filter === k && styles.tabTextActive]}>
                {k === 'all' ? t('stockMgmt.filterAll') : k === 'healthy' ? t('stockMgmt.filterHealthy') : k === 'low' ? t('stockMgmt.filterLow') : t('stockMgmt.filterOut')}
              </Text>
            </Pressable>
          ))}
        </View>
        {/* Reset massal template (pengganti FE reset-terpilih; APP tanpa selection UX). */}
        {tplEligible.length > 0 ? (
          <View style={styles.resetAllWrap}>
            <Pressable style={[styles.resetAllBtn, resettingAll && styles.btnBusy]} onPress={resetAll} disabled={resettingAll}>
              <Text style={styles.resetAllText}>{t('stockMgmt.resetAll').replace('{n}', String(tplEligible.length))}</Text>
            </Pressable>
          </View>
        ) : null}
        {/* Tablet: 2 kolom; phone 1 kolom. */}
        <View style={isTablet ? styles.gridTablet : undefined}>
          {list.map(({ r, tracked, lowEff, status }) => (
            <View key={`${r.kind}:${r.id}`} style={isTablet ? styles.cardTabletWrap : undefined}>
              <ItemCard
                row={r}
                tracked={tracked}
                lowEff={lowEff}
                globalLow={globalLow}
                globalTrack={globalTrack}
                status={status}
                onChanged={refresh}
              />
            </View>
          ))}
        </View>
        {list.length === 0 ? (
          <Text style={styles.empty}>{rows.length === 0 ? t('stockMgmt.empty') : t('stockMgmt.noMatch')}</Text>
        ) : null}
        <Text style={styles.syncNote}>{t('master.branchMenuSyncNote')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { paddingBottom: 32 },
  readonlyBanner: {
    backgroundColor: colors.paleOrange, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, marginHorizontal: 16, marginTop: 10,
    borderWidth: 1, borderColor: colors.orangeDark,
  },
  readonlyText: { fontFamily: fonts.medium, fontSize: 12, color: colors.orangeDark },
  searchWrap: { paddingHorizontal: 16, marginTop: 12 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  gridTablet: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  cardTabletWrap: { flexBasis: '48%', flexGrow: 1 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardOut: { borderColor: colors.red },
  cardLow: { borderColor: colors.orangeDark },
  itemTop: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 48, height: 48, marginRight: 10 },
  thumbAddon: { borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  thumbAddonText: { fontFamily: fonts.bold, fontSize: 20, color: colors.muted },
  itemLeft: { flex: 1 },
  itemName: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  itemMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  badgeOut: { backgroundColor: colors.red, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  badgeOutText: { fontFamily: fonts.bold, fontSize: 10, color: colors.white },
  badgeLow: { backgroundColor: colors.orangeDark, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  badgeLowText: { fontFamily: fonts.bold, fontSize: 10, color: colors.white },
  badgeOkText: { fontFamily: fonts.bold, fontSize: 11, color: colors.greenDark },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { minWidth: 34, height: 34, borderRadius: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  stepText: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  stepTextSm: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  stepVal: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, minWidth: 30, textAlign: 'center' },
  outBtn: { borderRadius: 8, backgroundColor: colors.red, paddingHorizontal: 12, paddingVertical: 9 },
  outText: { fontFamily: fonts.bold, fontSize: 11, color: colors.white },
  btnBusy: { opacity: 0.6 },
  resetRow: { flexDirection: 'row', marginTop: 8 },
  resetBtn: { flex: 1, borderRadius: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.navy, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12 },
  resetText: { fontFamily: fonts.bold, fontSize: 11, color: colors.navy },
  resetAllWrap: { paddingHorizontal: 16, paddingTop: 10 },
  resetAllBtn: { borderRadius: 10, backgroundColor: colors.navy, alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14 },
  resetAllText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  thRow: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  thInputRow: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  thFlex: { flex: 1 },
  applyBtn: { borderRadius: 8, backgroundColor: colors.navy, paddingHorizontal: 14, paddingVertical: 10 },
  applyText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, textAlign: 'center', marginTop: 20 },
  syncNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, marginTop: 12, paddingHorizontal: 16 },
});
