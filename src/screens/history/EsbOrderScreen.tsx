import { useCallback, useEffect, useMemo, useRef, useState } from 'react';import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import { totals } from '../../lib/totals';import ScreenHeader from '../../components/ScreenHeader';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import DrawerMenu from '../../components/DrawerMenu';import type { EsbOrder, EsbStatus } from '../../data/mock';import { notifyLocal } from '../../lib/push';import { onWsMessage, startRealtime } from '../../lib/realtime';import { getSession } from '../../session';import { getDeviceRole, normalizeTag, type TerminalTag } from '../../lib/deviceRole';import { useLang } from '../../lib/i18n';import { ApiPath, getTerminal } from '../../config/server';import { apiFetch, deliveryApi, unwrap } from '../../lib/apiSource';
import { uuidv7 } from '../../lib/uuidv7';import { enqueueOutbox, enqueueSync, withTimeout } from '../../lib/sync';
import {
  cancelMerchantOrder,
  pullActiveOrders,
  pushOrderStatus,
  GO_OP_CANCEL,
  GO_OP_STATUS,
  type ServerActiveOrder,
} from '../../lib/posWire';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };/** Status lokal: penolakan dicatat sebagai Batal. */type EsbStatusLocal = EsbStatus | 'Batal';/** Baris ESB dengan status lokal. */type EsbRow = Omit<EsbOrder, 'status'> & { status: EsbStatusLocal; rejectReason?: string; serverId?: number; serverStatus?: string };

/** W2: baris order aktif server -> EsbRow. Snapshot aktif BE tak membawa rincian
 *  item (dikontrak di posWire) — items: [] + total server; status advance tetap
 *  jalan, cetak ulang ikut item lokal bila ada. Null = status non-aktif, lewati. */
function mapGoActiveToRow(a: ServerActiveOrder): EsbRow | null {
  const st = String(a.status ?? '').trim().toUpperCase();
  const local: EsbStatusLocal | null =
    st === 'PENDING' ? 'Baru'
    : st === 'ACCEPTED' || st === 'IN_PROGRESS' ? 'Diproses'
    : st === 'READY' ? 'Selesai'
    : null;
  if (!local) return null;
  const ot = String(a.orderType ?? '');
  const type = /DELIVER|ANTAR|KURIR|OJOL|OJEK|GOFOOD|GRAB|SHOPEE/i.test(ot)
    ? 'Diantar' : /MEJA|DINE/i.test(ot) ? 'Makan di Tempat' : 'Ambil Sendiri';
  return {
    id: `srv-${a.id}`,
    code: a.orderNumber || `SRV-${a.id}`,
    customer: a.customerName || '-',
    phone: '',
    type,
    time: String(a.createdAt ?? '').slice(11, 16) || '--:--',
    items: [],
    total: a.total,
    status: local,
    serverId: a.id,
    serverStatus: st,
  };
}const tabs: EsbStatusLocal[] = ['Baru', 'Diproses', 'Selesai', 'Batal'];const typeFilters = ['Semua', 'Diantar', 'Ambil Sendiri'] as const;type HistoryKey = 'today' | 'yesterday' | 'week';const historyKeys: HistoryKey[] = ['today', 'yesterday', 'week'];/** Ongkir dari field nyata order bila ada (pull sales), else 0 - tanpa mock. */
function ongkirOf(o: EsbRow, live?: number): number { if (typeof live === 'number' && Number.isFinite(live)) return live > 0 ? Math.round(live) : 0; const c = o as unknown as Record<string, unknown>; const v = c.ongkirNet ?? c.ongkir ?? c.deliveryFee ?? c.shippingFee ?? 0; const n = Math.round(Number(v) || 0); return n > 0 ? n : 0; }/** Action-flag backend per status (order/finish tak punya endpoint status khusus). */function actionOf(s: EsbStatusLocal): 'esb-accept' | 'esb-done' | 'esb-reject' { if (s === 'Diproses') return 'esb-accept'; if (s === 'Selesai') return 'esb-done'; return 'esb-reject'; }/** Bus status lokal agar dapur/kasir bisa sinkron (pola listener ala session.ts). */export type EsbStatusEvent = { id: string; status: EsbStatusLocal; reason?: string };type EsbStatusListener = (e: EsbStatusEvent) => void;const esbStatusListeners = new Set<EsbStatusListener>();export function onEsbStatusChange(fn: EsbStatusListener): () => void { esbStatusListeners.add(fn); return () => { esbStatusListeners.delete(fn); }; }function emitEsbStatus(id: string, status: EsbStatusLocal, reason?: string): void { esbStatusListeners.forEach((fn) => { try { fn({ id, status, ...(reason ? { reason } : {}) }); } catch { /* abaikan */ } }); }function badgeStyle(s: EsbStatusLocal) {
  if (s === 'Baru') return { bg: colors.paleOrange, fg: colors.orange };
  if (s === 'Diproses') return { bg: colors.paleBlue, fg: colors.navy };
  if (s === 'Batal') return { bg: colors.paleRed, fg: colors.red }; return { bg: colors.paleGreen, fg: colors.green };}function typeStyle(tp: string) {
  return tp === 'Diantar'
    ? { bg: colors.paleBlue, fg: colors.blueDark }
    : { bg: colors.paleGreen, fg: colors.greenDark };}function totalsOf(o: EsbRow, ongkirLive?: number) { const gross = o.items.reduce((a, it) => a + it.qty * it.price, 0); const t = totals({ gross: gross > 0 ? gross : o.total, ongkir: ongkirOf(o, ongkirLive), esbOrder: true, }); return { sub: t.subtotal, fee: t.feeESB, ongkir: t.ongkirNet, grand: t.total, ppnIncl: t.taxIncl, rounding: t.rounding }; }/** S6 immediate-first: coba POST langsung (timeout singkat) dengan client_id
 * twin; twin (fisik + ringan, id SAMA) hanya bila immediate gagal. Nilai
 * status/tipe kontrak tak diubah (label diterjemahkan di render saja). True
 * bila server OK / dummy / offline-queue; false bila backend menolak
 * eksplisit (pemanggil rollback optimistik). */
async function persistEsbStatus(id: string, status: EsbStatusLocal, reason?: string): Promise<boolean> { const action = actionOf(status); const extra = reason ? { reason } : {}; const twinId = uuidv7(); const body = { action, no: id, status, client_id: twinId, ...extra }; let rejected = false; try { const res = await withTimeout(apiFetch(ApiPath.pushOrderFinish, { body })); if (res.ok && !res.fromDummy) return true; rejected = !res.ok && !res.fromDummy; } catch { /* offline/timeout - antre twin di bawah */ } try { await enqueueOutbox('tr_saleshead', id, 'update'); } catch { /* abaikan */ } try { enqueueSync('order', { action, salesNum: id, no: id, status, client_id: twinId, ...extra }, twinId); } catch { /* abaikan */ } return !rejected; }/** Paket cetak ulang ESB: bawa items + fee platform + ongkir + mode + customer asli ke Receipt. */function esbReceipt(o: EsbRow, grand: number, ongkirLive?: number, fee?: number) { const ongkir = ongkirOf(o, ongkirLive); return { no: o.code, total: grand, items: o.items.map((it) => ({ id: it.name, name: it.name, basePrice: it.price, qty: it.qty, ...(it.note ? { note: it.note } : {}) })), customer: o.customer, mode: o.type === 'Diantar' ? 'Delivery' : 'ESB Order', ongkir, discount: 0, ...(fee && fee > 0 ? { feeESB: fee } : {}) };}/** Hari order dihitung dari tanggal salesNum (id TRX-YYYYMMDD-NNN) agar filter tanggal tetap benar. */function dayOf(o: EsbRow): 'today' | 'yesterday' | 'older' { const m = o.id.match(/TRX-(\d{4})(\d{2})(\d{2})-/); if (m) { const day = `${m[1]}-${m[2]}-${m[3]}`; const d = new Date(); const pad = (n: number) => String(n).padStart(2, '0'); const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; if (day === today) return 'today'; const y = new Date(d.getTime() - 86400000); if (day === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`) return 'yesterday'; return 'older';
}

return 'today';}/** Jadwal tampil jam order nyata, else label 'segera' (i18n di render; kontrak server tetap default). */function scheduleOf(o: EsbRow, soon = 'Segera'): string { return o.time && o.time !== '--:--' ? o.time : soon;}interface SalePullItem { name?: unknown; qty?: unknown; unitPrice?: unknown; price?: unknown; note?: unknown;}interface SalePull { salesNum?: unknown; salesDate?: unknown; salesMode?: unknown; tableNo?: unknown; customerName?: unknown; subtotal?: unknown; ongkir?: unknown; ongkirNet?: unknown; items?: SalePullItem[];}/** Tag efektif layar ESB: session.terminalTag (kontrak SPEC §1, sudah backfill binding) menang; fallback peran device legacy. Tak dikenal = full_access. */function esbTag(): TerminalTag { try { const raw = getSession()?.terminalTag; if (raw !== undefined && raw !== null && String(raw).trim() !== '') { const p = normalizeTag(raw); if (p) return p; } } catch { /* abaikan: fallback peran device */ } try { return normalizeTag(getDeviceRole()) ?? 'full_access'; } catch { /* abaikan */ } return 'full_access'; }/** Topik SPEC §9 untuk kasir: 'online-order-incoming' kanonis + warisan order/esb/self; trafik dapur (kitchen/ticket/order-status/order-accepted) BUKAN konsumsi layar ini. */function isOnlineOrderIncoming(type: unknown): boolean { const t = String(type ?? '').trim().toLowerCase(); if (!t) return false; if (t === 'online-order-incoming' || t === 'online_order_incoming') return true; if (/kitchen|ticket|order-status|order_accepted|order-accepted/i.test(t)) return false; return /order|esb|self/i.test(t); }/** Kasir + full_access menerima order-online-masuk (SPEC §8-§9, realtime-02); tag lain diabaikan. */function esbTagAllowed(tag: TerminalTag): boolean { return tag === 'kasir' || tag === 'full_access'; }export default function EsbOrderScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [tab, setTab] = useState<EsbStatusLocal>('Baru');
  const [typeFilter, setTypeFilter] = useState<(typeof typeFilters)[number]>('Semua');
  const [history, setHistory] = useState<HistoryKey>('today');
  const [selected, setSelected] = useState<EsbRow | null>(null);
  const [moved, setMoved] = useState<Record<string, EsbStatusLocal>>({});
  const [rejectFor, setRejectFor] = useState<EsbRow | null>(null); const [rejectText, setRejectText] = useState(''); const [rejectOf, setRejectOf] = useState<Record<string, string>>({});

  const [liveNew, setLiveNew] = useState(0); const [notice, setNotice] = useState('');
  // WIRE REA-2: status/schedule delivery via helper deliveryApi (best-effort,
  // offline-first - mock/ESB lokal tetap jalan tanpa server).
  const [dlvMsg, setDlvMsg] = useState(''); const [dlvBusy, setDlvBusy] = useState(false); const queryDelivery = useCallback(async (orderCode: string) => { if (dlvBusy) return; setDlvBusy(true); setDlvMsg(''); try { const term = getTerminal(); const res = await deliveryApi('search-ongoing', { orderNo: orderCode, branchId: term.branchId }); const { data } = unwrap<Record<string, unknown>>(res.data); const info = String((data as { status?: unknown })?.status ?? (data as { state?: unknown })?.state ?? ''); setDlvMsg(info ? `${t('dlv_title')}: ${orderCode} - ${info}` : `${t('dlv_title')}: ${orderCode} - OK`); } catch { setDlvMsg(''); } finally { setDlvBusy(false); } }, [dlvBusy, t]); const scheduleDelivery = useCallback(async (orderCode: string) => { if (dlvBusy) return; setDlvBusy(true); try { const term = getTerminal(); await deliveryApi('schedule-order', { orderNo: orderCode, branchId: term.branchId, schedule: scheduleOf({ id: orderCode } as EsbRow) }); setDlvMsg(`${t('dlv_title')}: ${orderCode} - OK`); } catch { setDlvMsg(''); } finally { setDlvBusy(false); } }, [dlvBusy, t]);
  // T9: order live dari pull sales (apiSource: backend asli bila env terisi,
  // order online datang dari pull saat backend ada; offline = kosong, bukan palsu.
  const [liveOrders, setLiveOrders] = useState<EsbRow[] | null>(null); const [liveOngkir, setLiveOngkir] = useState<Record<string, number>>({}); const pullLive = useCallback(async () => { try { const res = await apiFetch(ApiPath.pullSales, { method: 'GET' }); const { data } = unwrap<{ items?: SalePull[] }>(res.data); const items = Array.isArray(data?.items) ? data.items : []; if (items.length === 0) { setLiveOrders([]); setLiveOngkir({}); return; } const rows: EsbRow[] = []; const ong: Record<string, number> = {}; for (const s of items) { const code = String(s.salesNum ?? '').trim(); if (!code) continue; const mode = String(s.salesMode ?? '').toUpperCase(); const type = mode.includes('DELIVER') || mode.includes('DIANTAR') ? 'Diantar' : 'Ambil Sendiri'; const mapped = (Array.isArray(s.items) ? s.items : []).map((it) => ({ name: String(it.name ?? '-'), qty: Math.max(1, Math.round(Number(it.qty) || 0)), price: Math.round(Number(it.unitPrice ?? it.price) || 0), ...(it.note ? { note: String(it.note) } : {}), })); const sub = Number(s.subtotal); const total = Number.isFinite(sub) && sub > 0 ? Math.round(sub) : mapped.reduce((a, it) => a + it.qty * it.price, 0); const time = String(s.salesDate ?? '').slice(11, 16) || '--:--'; rows.push({ id: code, code, customer: String(s.customerName ?? s.tableNo ?? '-'), phone: '', type, time, items: mapped, total, status: 'Baru', }); const fee = Number(s.ongkirNet ?? s.ongkir); ong[code] = Number.isFinite(fee) && fee > 0 ? Math.round(fee) : 0; } if (rows.length === 0) { setLiveOrders([]); } else { setLiveOrders(rows); } setLiveOngkir(rows.length === 0 ? {} : ong);
    // W2: cermin order aktif server (read-only merge; SQLite/state ESB tak
    // ditulis). Tanpa items — lihat mapGoActiveToRow. Gagal/offline = baris
    // srv-* dibersihkan agar tak ada baris server basi.
    void (async () => {
      try {
        const go = await pullActiveOrders();
        if (!go.ok) {
          setLiveOrders((prev) => {
            const kept = (prev ?? []).filter((r) => !r.id.startsWith('srv-'));
            return kept.length === (prev ?? []).length ? (prev ?? []) : kept;
          });
          return;
        }
        const mapped: EsbRow[] = [];
        for (const a of go.data) { const r = mapGoActiveToRow(a); if (r) mapped.push(r); }
        setLiveOrders((prev) => {
          const base = (prev ?? []).filter((r) => !r.id.startsWith('srv-'));
          const have = new Set(base.map((r) => r.id));
          const fresh = mapped.filter((r) => !have.has(r.id));
          return fresh.length > 0 ? [...fresh, ...base] : base;
        });
      } catch { /* abaikan: baris ESB tetap tampil */ }
    })(); } catch { /* offline / pull gagal - tampil kosong, bukan palsu */ setLiveOrders((prev) => prev ?? []); } }, []); useEffect(() => { void pullLive(); }, [pullLive]); /** APP-EVENTS: debounce pullLive ~800 mdtk — ledakan pesan WS dicoalesce menjadi satu pull penuh; timer dibersihkan saat unmount. */ const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const pullLiveRef = useRef(pullLive); pullLiveRef.current = pullLive; const schedulePullLive = useCallback(() => { if (pullTimer.current) return; pullTimer.current = setTimeout(() => { pullTimer.current = null; try { void pullLiveRef.current(); } catch { /* abaikan: banner in-memory tetap tampil */ } }, 800); }, []); useEffect(() => () => { if (pullTimer.current) { clearTimeout(pullTimer.current); pullTimer.current = null; } }, []); /** Notifikasi live: topik online-order-incoming → banner lokal + badge; hanya untuk tag kasir/full_access (SPEC §8-§9, realtime-02). */ useEffect(() => { try { startRealtime(); } catch { /* abaikan */ } const off = onWsMessage((msg) => { if (!isOnlineOrderIncoming(msg.type)) return; if (!esbTagAllowed(esbTag())) return; const code = String(msg.payload?.code ?? msg.payload?.no ?? ''); setLiveNew((n) => n + 1); schedulePullLive(); setNotice(code ? `${t('esb_push_title')} ${code}` : t('esb_push_body')); void notifyLocal(t('esb_push_title'), code ? `${code}` : t('esb_push_body'), { code }, 'kasir'); }); return off; }, [t, schedulePullLive]); const base: EsbRow[] = liveOrders ?? []; const withMoved: EsbRow[] = useMemo(
    () => base.map((o) => ({ ...o, status: moved[o.id] ?? (o.status as EsbStatusLocal), ...(rejectOf[o.id] ? { rejectReason: rejectOf[o.id] } : {}) })),
    [base, moved, rejectOf],
  );

  const counts = useMemo(() => { const c: Record<EsbStatusLocal, number> = {
    Baru: 0,
    Diproses: 0,
    Selesai: 0, Batal: 0 }; for (const o of withMoved) c[o.status] += 1; return c; }, [withMoved]);

  /** Filter tanggal benar-benar memfilter daftar, bukan cuma subtitle. */ const list = useMemo(
    () => withMoved.filter((o) => { if (o.status !== tab) return false; if (typeFilter !== 'Semua' && o.type !== typeFilter) return false; const day = dayOf(o); if (history === 'today') return day === 'today'; if (history === 'yesterday') return day === 'yesterday'; return true;
      // week = semua 7 hari
    }),
    [withMoved, tab, typeFilter, history],
  );

  const setStatus = (id: string, s: EsbStatusLocal, reason?: string) => { const prev: EsbStatusLocal = moved[id] ?? ((base.find((o) => o.id === id)?.status as EsbStatusLocal | undefined) ?? 'Baru'); setMoved((m) => ({ ...m, [id]: s })); setSelected((sel) => (sel && sel.id === id ? { ...sel, status: s, ...(reason ? { rejectReason: reason } : {}) } : sel)); if (reason) setRejectOf((r) => ({ ...r, [id]: reason })); emitEsbStatus(id, s, reason); const row = base.find((o) => o.id === id);
  // W2: baris server (id srv-*) -> kontrak Go; baris ESB lokal ikut jalur lama.
  if (row && typeof row.serverId === 'number') {
    const sid = row.serverId;
    const target = s === 'Diproses' ? 'ACCEPTED' : s === 'Selesai' ? 'READY' : null;
    void (async () => {
      const res = s === 'Batal'
        ? await cancelMerchantOrder(sid, reason)
        : await pushOrderStatus(sid, target ?? 'READY', { current: row.serverStatus, ...(reason ? { note: reason } : {}) });
      if (res.ok) { void pullLive(); return; }
      // Gagal = antrekan (drain PUT-capable: offline dicoba lagi, 4xx final
      // jadi 'gagal' + catatan di SyncScreen). Optimistik dipertahankan.
      try {
        enqueueSync('other', s === 'Batal'
          ? { op: GO_OP_CANCEL, serverId: sid, ...(reason ? { reason } : {}), salesNum: id, at: new Date().toISOString() }
          : { op: GO_OP_STATUS, serverId: sid, target: target ?? 'READY', ...(reason ? { reason } : {}), salesNum: id, at: new Date().toISOString() });
      } catch { /* antrean belum siap */ }
      if (res.reason === 'rejected') {
        // Konflik transisi = server menang (override lokal dihapus).
        if (/TRANSITION|VALIDATION|CLOSED/i.test(res.code ?? '')) {
          setMoved((m) => { const n = { ...m }; delete n[id]; return n; });
          setSelected((sel) => (sel && sel.id === id ? { ...sel, status: prev } : sel));
        }
        setNotice(res.message || '');
      }
    })();
    return;
  }
  void (async () => { const ok = await persistEsbStatus(id, s, reason); if (ok) { void pullLive(); return; } setMoved((m) => ({ ...m, [id]: prev })); setSelected((sel) => (sel && sel.id === id ? { ...sel, status: prev } : sel)); })(); };

  const tabLabel = (k: EsbStatusLocal) => k === 'Baru' ? t('esb_new') : k === 'Diproses' ? t('esb_proc') : k === 'Selesai' ? t('esb_done') : t('esb_void'); const histLabel = (h: HistoryKey) => h === 'today' ? t('esb_today') : h === 'yesterday' ? t('esb_yesterday') : t('esb_7days'); const fresh = counts.Baru + liveNew;

  return (
    <View style={styles.root}>
      <ScreenHeader title={t('esb_title')} sub={`${histLabel(history)} - ${list.length} order - ${fresh} ${t('esb_new_badge')}`} left={ <Pressable onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}><Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" /></Pressable> } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={(r) => navigation?.navigate(r)} />
        <View style={styles.statRow}>
          {(Object.keys(counts) as EsbStatusLocal[]).map((k) => (
            <View key={k} style={styles.stat}>
              <Text style={styles.statNum}>{counts[k]}</Text>
              <Text style={styles.statLabel}>{tabLabel(k)}</Text>
            </View>
          ))}
        <View style={[styles.stat, styles.statLive]}><Text style={styles.statNum}>{liveNew}</Text><Text style={styles.statLabel}>{t('esb_live')}</Text></View>
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}<View style={styles.tabs}>
        {tabs.map((tb) => (
          <Pressable key={tb} onPress={() => setTab(tb)} style={[styles.tab, tab === tb && styles.tabActive, isTablet && styles.tabTablet]}>
            <Text style={[styles.tabText, tab === tb && styles.tabTextActive, isTablet && styles.tabTextBig]}>
              {tabLabel(tb)} ({counts[tb]})
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.filterRow}>
        <View style={styles.typeRow}>
          {typeFilters.map((tf) => (
            <Pressable key={tf} onPress={() => setTypeFilter(tf)} style={[styles.miniTab, typeFilter === tf && styles.miniTabActive, isTablet && styles.miniTabTablet]}>
              <Text style={[styles.miniText, typeFilter === tf && styles.miniTextActive, isTablet && styles.miniTextBig]}>
                {tf === 'Semua' ? t('esb_all') : tf === 'Diantar' ? t('esb_delivery') : t('esb_pickup')}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.typeRow}>
          {historyKeys.map((h) => (
            <Pressable key={h} onPress={() => setHistory(h)} style={[styles.miniTab, history === h && styles.miniTabActive, isTablet && styles.miniTabTablet]}>
              <Text style={[styles.miniText, history === h && styles.miniTextActive, isTablet && styles.miniTextBig]}>{histLabel(h)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(o) => o.id}
        key={isTablet ? 't2' : 't1'}
        numColumns={isTablet ? 2 : 1}
        columnWrapperStyle={isTablet ? styles.colWrap : undefined}
        contentContainerStyle={[styles.list, isTablet && wideCenterLg]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image source={require('../../../assets/images/empty_order.webp')} style={styles.emptyImg} resizeMode="contain" />
            <Text style={styles.emptyTitle}>{t('esb_empty')} {tabLabel(tab)}</Text>
            <Text style={styles.emptySub}>{t('esb_empty_sub')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const b = badgeStyle(item.status);
          const tp = typeStyle(item.type);
          const tt = totalsOf(item, liveOngkir[item.id]); return (
            <Pressable style={[styles.card, isTablet && styles.cardTablet]} onPress={() => setSelected(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardCode}>{item.code}</Text>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: tp.bg }]}>
                    <Text style={[styles.badgeText, { color: tp.fg }]}>{item.type === 'Diantar' ? t('esb_type_delivery') : t('esb_type_pickup')}</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: b.bg }]}>
                    <Text style={[styles.badgeText, { color: b.fg }]}>{tabLabel(item.status)}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.cardName}>{item.customer}</Text>
              <Text style={styles.cardMeta}>
                {item.type} - {item.time} - {item.items.reduce((a, i) => a + i.qty, 0)} {t('hist_items')}
              </Text>
              <Text style={styles.schedule}>{t('esb_schedule')}: {scheduleOf(item, t('esb_soon'))}</Text>
              <View style={styles.cardBottom}>
                <Text style={styles.cardTotal}>{rp(tt.grand)}</Text>
                <Text style={styles.link}>{t('esb_view')} ›</Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal visible={selected !== null} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={[styles.sheetWrap, isTablet && styles.sheetWrapTablet]}>
          <View style={[styles.sheet, isTablet && styles.sheetTablet]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('esb_detail')}</Text>
            {selected && (
              <>
                <Text style={styles.detailCode}>{selected.code}</Text>
                <Text style={styles.detailMeta}>{selected.customer} - {selected.phone}</Text>
                <Text style={styles.detailMeta}>
                  {selected.type} ({selected.type === 'Diantar' ? t('esb_type_delivery') : t('esb_type_pickup')}) - {selected.time}
                </Text>
                <Text style={styles.detailMeta}>{t('esb_schedule')}: {scheduleOf(selected, t('esb_soon'))}</Text>
                {selected.note ? <Text style={styles.detailNote}>{t('kit_note')}: {selected.note}</Text> : null}
                {selected.status === 'Batal' ? (<Text style={styles.rejectedNote}>{t('esb_rejected_note')}{selected.rejectReason ? ` - ${selected.rejectReason}` : ''}</Text> ) : null}<View style={styles.divider} />
                {selected.items.map((it, idx) => (
                  <View key={idx} style={styles.itemRow}>
                    <View style={styles.itemLeft}>
                      <Text style={styles.itemName}>{it.qty}x {it.name}</Text>
                      {it.note ? <Text style={styles.itemNote}>{it.note}</Text> : null}
                    </View>
                    <Text style={styles.itemPrice}>{rp(it.qty * it.price)}</Text>
                  </View>
                ))}
                <View style={styles.divider} />
                {(() => { const tt = totalsOf(selected, liveOngkir[selected.id]); return (<><View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('c_subtotal')}</Text>
                  <Text style={styles.rowVal}>{rp(tt.sub)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('esb_fee')}</Text>
                  <Text style={styles.rowVal}>{rp(tt.fee)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('esb_tax_incl')}</Text>
                  <Text style={styles.rowVal}>{rp(tt.ppnIncl)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('esb_shipping')}</Text>
                  <Text style={styles.rowVal}> {tt.ongkir > 0 ? rp(tt.ongkir) : t('esb_free')} </Text>
                </View>
                {tt.rounding !== 0 ? (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('esb_rounding')}</Text>
                  <Text style={styles.rowVal}>{rp(tt.rounding)}</Text>
                </View>
                ) : null}
                <View style={styles.row}><Text style={styles.rowLabel}>{t('esb_grand')}</Text><Text style={styles.rowTotal}>{rp(tt.grand)}</Text></View></> ); })()}{selected.type === 'Diantar' ? (<><View style={styles.divider} /><View style={styles.row}><Text style={styles.rowLabel}>{t('dlv_title')}</Text><Text style={styles.rowVal}>{scheduleOf(selected, t('esb_soon'))}</Text></View><Text style={styles.detailNote}>{t('dlv_search_hint')}</Text>{dlvMsg ? (<Text style={styles.detailNote}>{dlvMsg}</Text>) : null}<View style={styles.sheetBtns}><AppButton title={t('dlv_search')} variant="secondary" onPress={() => void queryDelivery(selected.code)} disabled={dlvBusy} fullWidth={false} size="md" style={styles.sheetBtn} /><AppButton title={t('dlv_schedule')} variant="secondary" onPress={() => void scheduleDelivery(selected.code)} disabled={dlvBusy} fullWidth={false} size="md" style={styles.sheetBtn} /></View></>) : null}<View style={styles.sheetBtns}>
                  {selected.status === 'Baru' && (
                    <>
                      <AppButton title={t('esb_reject')} variant="danger" onPress={() => { setRejectText(''); setRejectFor(selected); }} fullWidth={false} size="md" style={styles.sheetBtn} />
                      <AppButton title={t('esb_accept')} onPress={() => setStatus(selected.id, 'Diproses')} fullWidth={false} size="md" style={styles.sheetBtnWide} />
                    </>
                  )}
                  {selected.status === 'Diproses' && (
                    <>
                      <AppButton
                        title={t('c_print')}
                        variant="secondary"
                        onPress={() => {
                          const s = selected;
                          const tt = totalsOf(s, liveOngkir[s.id]); setSelected(null);
                          navigation?.navigate('Receipt', esbReceipt(s, tt.grand, liveOngkir[s.id], tt.fee));
                        }}
                        fullWidth={false}
                        size="md"
                        style={styles.sheetBtn}
                      />
                      <AppButton title={t('esb_complete')} onPress={() => setStatus(selected.id, 'Selesai')} fullWidth={false} size="md" style={styles.sheetBtnWide} />
                    </>
                  )}
                  {(selected.status === 'Selesai' || selected.status === 'Batal') && (
                    <>
                      <AppButton title={t('c_close')} variant="secondary" onPress={() => setSelected(null)} fullWidth={false} size="md" style={styles.sheetBtn} />
                      <AppButton
                        title={t('c_print')}
                        onPress={() => {
                          const s = selected;
                          const tt = totalsOf(s, liveOngkir[s.id]); setSelected(null);
                          navigation?.navigate('Receipt', esbReceipt(s, tt.grand, liveOngkir[s.id], tt.fee));
                        }}
                        fullWidth={false}
                        size="md"
                        style={styles.sheetBtn}
                      />
                    </>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
      <Modal visible={rejectFor !== null} animationType="fade" transparent onRequestClose={() => setRejectFor(null)}>
        <View style={[styles.sheetWrap, isTablet && styles.sheetWrapTablet]}>
          <View style={[styles.sheet, isTablet && styles.sheetTablet]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('esb_reject_title')}</Text>
            <Text style={styles.detailMeta}>{rejectFor?.code}</Text>
            <AppInput value={rejectText} onChangeText={setRejectText} placeholder={t('esb_reject_ph')} multiline boxStyle={styles.rejectBox} style={styles.rejectField} />
            <View style={styles.sheetBtns}>
              <AppButton title={t('c_close')} variant="secondary" onPress={() => setRejectFor(null)} fullWidth={false} size="md" style={styles.sheetBtn} />
              <AppButton title={t('esb_reject')} variant="danger" disabled={!rejectText.trim()} onPress={() => { const target = rejectFor; const reason = rejectText.trim(); if (!target || !reason) return; setRejectFor(null); setRejectText(''); setStatus(target.id, 'Batal', reason); }} fullWidth={false} size="md" style={styles.sheetBtn} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  langTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  burger: { width: 22, height: 22 },
  statRow: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 12, gap: 10 },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.line },
  statLive: { borderColor: colors.green }, statNum: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy },
  statLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, marginTop: 2 },
  notice: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, paddingHorizontal: 16, marginTop: 8 }, tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  tabActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  tabText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  /* Tablet: tab status lebih tinggi agar target sentuh >=48px. */
  tabTablet: { paddingVertical: 14 },
  tabTextBig: { fontSize: 14 },
  filterRow: { paddingHorizontal: 16, paddingBottom: 4 },
  typeRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  miniTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  miniTabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  miniText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  miniTextActive: { color: colors.white },
  /* Tablet: chip filter lebih tinggi agar mudah disentuh. */
  miniTabTablet: { paddingHorizontal: 14, paddingVertical: 10 },
  miniTextBig: { fontSize: 13 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  /* Tablet: kartu mengisi setengah baris (daftar 2 kolom). */
  cardTablet: { flex: 1 },
  colWrap: { gap: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCode: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  badgeRow: { flexDirection: 'row', gap: 6 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: fonts.bold, fontSize: 11 },
  cardName: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, marginTop: 6 },
  cardMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  schedule: { fontFamily: fonts.medium, fontSize: 12, color: colors.orangeDark, marginTop: 2 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  cardTotal: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  link: { fontFamily: fonts.bold, fontSize: 12, color: colors.orange },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyImg: { width: 180, height: 140 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 12 },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '88%' },
  /* Tablet: sheet jadi kartu dialog tengah, tidak melar selebar layar. */
  sheetWrapTablet: { justifyContent: 'center', padding: 24 },
  sheetTablet: { maxWidth: 720, width: '100%', alignSelf: 'center', borderRadius: 20, margin: 24 },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  detailCode: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginTop: 6 },
  detailMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  detailNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.orangeDark, fontStyle: 'italic', marginTop: 6 },
  rejectedNote: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 6 }, divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  itemLeft: { flex: 1, paddingRight: 12 },
  itemName: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  itemNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, fontStyle: 'italic' },
  itemPrice: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  rowLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  rowVal: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  rowTotal: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  sheetBtns: { flexDirection: 'row', gap: 8, marginTop: 16 },
  sheetBtn: { flex: 1, marginTop: 0 },
  sheetBtnWide: { flex: 2, marginTop: 0 },
  rejectBox: { minHeight: 88, height: 'auto', alignItems: 'flex-start', paddingVertical: 10 },
  rejectField: { textAlignVertical: 'top' },
  btnGhost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: 'center' },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  btnAccept: { flex: 2, borderRadius: 10, backgroundColor: colors.green, paddingVertical: 12, alignItems: 'center' },
  btnAcceptText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnReject: { flex: 1, borderRadius: 10, backgroundColor: colors.paleRed, paddingVertical: 12, alignItems: 'center' },
  btnRejectText: { fontFamily: fonts.bold, fontSize: 13, color: colors.red },
  btnPrint: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center' },
  btnPrintText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white }, rejectInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, marginTop: 12, minHeight: 88, textAlignVertical: 'top', fontFamily: fonts.regular, fontSize: 13, color: colors.text, backgroundColor: colors.card }, btnDisabled: { opacity: 0.5 },});