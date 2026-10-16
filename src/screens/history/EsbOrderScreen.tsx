import { useCallback, useEffect, useMemo, useState } from 'react';import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import { totals } from '../../lib/totals';import ScreenHeader from '../../components/ScreenHeader';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import { esbOrders, type EsbOrder, type EsbStatus } from '../../data/mock';import { notifyLocal } from '../../lib/push';import { onWsMessage, startRealtime } from '../../lib/realtime';import { useLang } from '../../lib/i18n';import { ApiPath, getTerminal } from '../../config/server';import { apiFetch, deliveryApi, unwrap } from '../../lib/apiSource';import { enqueueOutbox, enqueueSync } from '../../lib/sync';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };/** Status lokal: mock hanya kenal Baru/Diproses/Selesai, penolakan dicatat sebagai Batal. */type EsbStatusLocal = EsbStatus | 'Batal';/** Baris ESB dengan status lokal (Omit agar status mock yang sempit tertimpa). */type EsbRow = Omit<EsbOrder, 'status'> & { status: EsbStatusLocal; rejectReason?: string };const tabs: EsbStatusLocal[] = ['Baru', 'Diproses', 'Selesai', 'Batal'];const typeFilters = ['Semua', 'Diantar', 'Ambil Sendiri'] as const;type HistoryKey = 'today' | 'yesterday' | 'week';const historyKeys: HistoryKey[] = ['today', 'yesterday', 'week'];/** Hari mock per order: esb1-2 hari ini, esb3 kemarin, esb4 dalam 7 hari. */const ORDER_DAY: Record<string, 'today' | 'yesterday' | 'older'> = { esb1: 'today', esb2: 'today', esb3: 'yesterday', esb4: 'older',};/** Jadwal mock per order (waktu diminta pelanggan). */const SCHEDULE: Record<string, string> = {
  esb1: 'Segera - maks 13:00',
  esb2: 'Terjadwal - 13:30',
  esb3: 'Segera - maks 12:15',
  esb4: 'Selesai 11:05',};const ONGKIR_DIANTAR = 10000;/** Action-flag backend per status (order/finish tak punya endpoint status khusus). */function actionOf(s: EsbStatusLocal): 'esb-accept' | 'esb-done' | 'esb-reject' { if (s === 'Diproses') return 'esb-accept'; if (s === 'Selesai') return 'esb-done'; return 'esb-reject'; }/** Bus status lokal agar dapur/kasir bisa sinkron (pola listener ala session.ts). */export type EsbStatusEvent = { id: string; status: EsbStatusLocal; reason?: string };type EsbStatusListener = (e: EsbStatusEvent) => void;const esbStatusListeners = new Set<EsbStatusListener>();export function onEsbStatusChange(fn: EsbStatusListener): () => void { esbStatusListeners.add(fn); return () => { esbStatusListeners.delete(fn); }; }function emitEsbStatus(id: string, status: EsbStatusLocal, reason?: string): void { esbStatusListeners.forEach((fn) => { try { fn({ id, status, ...(reason ? { reason } : {}) }); } catch { /* abaikan */ } }); }function badgeStyle(s: EsbStatusLocal) {
  if (s === 'Baru') return { bg: colors.paleOrange, fg: colors.orange };
  if (s === 'Diproses') return { bg: colors.paleBlue, fg: colors.navy };
  if (s === 'Batal') return { bg: colors.paleRed, fg: colors.red }; return { bg: colors.paleGreen, fg: colors.green };}function typeStyle(tp: string) {
  return tp === 'Diantar'
    ? { bg: colors.paleBlue, fg: colors.blueDark, label: 'Delivery' }
    : { bg: colors.paleGreen, fg: colors.greenDark, label: 'Pickup' };}function totalsOf(o: EsbRow, ongkirLive?: number) { const gross = o.items.reduce((a, it) => a + it.qty * it.price, 0); const t = totals({ gross: gross > 0 ? gross : o.total, ongkir: ongkirLive ?? (o.type === 'Diantar' ? ONGKIR_DIANTAR : 0), esbOrder: true, }); return { sub: t.subtotal, fee: t.feeESB, ongkir: t.ongkirNet, grand: t.total, ppnIncl: t.taxIncl, rounding: t.rounding }; }/** Persist aksi Terima/Selesai/Tolak: outbox + sync order + POST action-flag ke order/finish. True bila server OK / dummy / offline-queue; false bila backend menolak (pemanggil rollback). */async function persistEsbStatus(id: string, status: EsbStatusLocal, reason?: string): Promise<boolean> { const action = actionOf(status); const extra = reason ? { reason } : {}; try { await enqueueOutbox('tr_saleshead', id, 'update'); } catch { /* abaikan */ } try { enqueueSync('order', { action, salesNum: id, no: id, status, ...extra }); } catch { /* abaikan */ } try { const res = await apiFetch(ApiPath.pushOrderFinish, { body: { action, no: id, status, ...extra } }); if (!res.ok && !res.fromDummy) return false; return true; } catch { /* offline - terkirim via push berikutnya */ return true; } }/** Paket cetak ulang ESB: bawa items + fee platform + ongkir + mode + customer asli ke Receipt. */function esbReceipt(o: EsbRow, grand: number, ongkirLive?: number, fee?: number) { const ongkir = ongkirLive ?? (o.type === 'Diantar' ? ONGKIR_DIANTAR : 0); return { no: o.code, total: grand, items: o.items.map((it) => ({ id: it.name, name: it.name, basePrice: it.price, qty: it.qty, ...(it.note ? { note: it.note } : {}) })), customer: o.customer, mode: o.type === 'Diantar' ? 'Delivery' : 'ESB Order', ongkir, discount: 0, ...(fee && fee > 0 ? { feeESB: fee } : {}) };}/** T9: hari order - mock ikut ORDER_DAY; baris live (id TRX-YYYYMMDD-NNN) * dihitung dari tanggal salesNum agar filter tanggal tetap benar. */function dayOf(o: EsbRow): 'today' | 'yesterday' | 'older' { const known = ORDER_DAY[o.id]; if (known) return known; const m = o.id.match(/TRX-(\d{4})(\d{2})(\d{2})-/); if (m) { const day = `${m[1]}-${m[2]}-${m[3]}`; const d = new Date(); const pad = (n: number) => String(n).padStart(2, '0'); const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; if (day === today) return 'today'; const y = new Date(d.getTime() - 86400000); if (day === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`) return 'yesterday'; return 'older';
}

return 'today';}/** T9: jadwal - mock ikut SCHEDULE; baris live tampil jam salesDate. */function scheduleOf(o: EsbRow): string { const s = SCHEDULE[o.id]; if (s) return s; return o.time && o.time !== '--:--' ? o.time : 'Segera';}interface SalePullItem { name?: unknown; qty?: unknown; unitPrice?: unknown; price?: unknown; note?: unknown;}interface SalePull { salesNum?: unknown; salesDate?: unknown; salesMode?: unknown; tableNo?: unknown; customerName?: unknown; subtotal?: unknown; ongkir?: unknown; ongkirNet?: unknown; items?: SalePullItem[];}export default function EsbOrderScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, setLang, t } = useLang(); const [tab, setTab] = useState<EsbStatusLocal>('Baru');
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
  // dummy lokal saat offline). Null/kosong = fallback mock tetap jalan.
  const [liveOrders, setLiveOrders] = useState<EsbRow[] | null>(null); const [liveOngkir, setLiveOngkir] = useState<Record<string, number>>({}); const pullLive = useCallback(async () => { try { const res = await apiFetch(ApiPath.pullSales, { method: 'GET' }); const { data } = unwrap<{ items?: SalePull[] }>(res.data); const items = Array.isArray(data?.items) ? data.items : []; if (items.length === 0) return; const rows: EsbRow[] = []; const ong: Record<string, number> = {}; for (const s of items) { const code = String(s.salesNum ?? '').trim(); if (!code) continue; const mode = String(s.salesMode ?? '').toUpperCase(); const type = mode.includes('DELIVER') || mode.includes('DIANTAR') ? 'Diantar' : 'Ambil Sendiri'; const mapped = (Array.isArray(s.items) ? s.items : []).map((it) => ({ name: String(it.name ?? '-'), qty: Math.max(1, Math.round(Number(it.qty) || 0)), price: Math.round(Number(it.unitPrice ?? it.price) || 0), ...(it.note ? { note: String(it.note) } : {}), })); const sub = Number(s.subtotal); const total = Number.isFinite(sub) && sub > 0 ? Math.round(sub) : mapped.reduce((a, it) => a + it.qty * it.price, 0); const time = String(s.salesDate ?? '').slice(11, 16) || '--:--'; rows.push({ id: code, code, customer: String(s.customerName ?? s.tableNo ?? '-'), phone: '', type, time, items: mapped, total, status: 'Baru', }); const fee = Number(s.ongkirNet ?? s.ongkir); ong[code] = Number.isFinite(fee) && fee > 0 ? Math.round(fee) : 0; } if (rows.length === 0) return; setLiveOrders(rows); setLiveOngkir(ong); } catch { /* offline / pull gagal - mock tetap jalan */ } }, []); useEffect(() => { void pullLive(); }, [pullLive]); /** Notifikasi live: channel self-order → banner lokal + badge dalam aplikasi. */ useEffect(() => { try { startRealtime(); } catch { /* abaikan */ } const off = onWsMessage((msg) => { if (!/order|esb|self/i.test(msg.type)) return; const code = String(msg.payload?.code ?? msg.payload?.no ?? ''); setLiveNew((n) => n + 1); void pullLive(); setNotice(code ? `${t('esb_push_title')} ${code}` : t('esb_push_body')); void notifyLocal(t('esb_push_title'), code ? `${code}` : t('esb_push_body'), { code }); }); return off; }, [t, pullLive]); const base = liveOrders ?? esbOrders; const withMoved: EsbRow[] = useMemo(
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

  const setStatus = (id: string, s: EsbStatusLocal, reason?: string) => { const prev: EsbStatusLocal = moved[id] ?? ((base.find((o) => o.id === id)?.status as EsbStatusLocal | undefined) ?? 'Baru'); setMoved((m) => ({ ...m, [id]: s })); setSelected((sel) => (sel && sel.id === id ? { ...sel, status: s, ...(reason ? { rejectReason: reason } : {}) } : sel)); if (reason) setRejectOf((r) => ({ ...r, [id]: reason })); emitEsbStatus(id, s, reason); void (async () => { const ok = await persistEsbStatus(id, s, reason); if (ok) { void pullLive(); return; } setMoved((m) => ({ ...m, [id]: prev })); setSelected((sel) => (sel && sel.id === id ? { ...sel, status: prev } : sel)); })(); };

  const tabLabel = (k: EsbStatusLocal) => k === 'Baru' ? t('esb_new') : k === 'Diproses' ? t('esb_proc') : k === 'Selesai' ? t('esb_done') : t('esb_void'); const histLabel = (h: HistoryKey) => h === 'today' ? t('esb_today') : h === 'yesterday' ? t('esb_yesterday') : t('esb_7days'); const fresh = counts.Baru + liveNew;

  return (
    <View style={styles.root}>
      <ScreenHeader title={t('esb_title')} sub={`${histLabel(history)} - ${list.length} order - ${fresh} ${t('esb_new_badge')}`} onBack={() => navigation?.goBack?.()} right={<View style={styles.headRight}><Pressable onPress={() => setLang(lang === 'id' ? 'en' : 'id')} hitSlop={8}>
        <Text style={styles.langTxt}>{lang === 'id' ? 'EN' : 'ID'}</Text></Pressable></View> } />
        <View style={styles.statRow}>
          {(Object.keys(counts) as EsbStatusLocal[]).map((k) => (
            <View key={k} style={styles.stat}>
              <Text style={styles.statNum}>{counts[k]}</Text>
              <Text style={styles.statLabel}>{tabLabel(k)}</Text>
            </View>
          ))}
        <View style={[styles.stat, styles.statLive]}><Text style={styles.statNum}>{liveNew}</Text><Text style={styles.statLabel}>Live</Text></View>
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}<View style={styles.tabs}>
        {tabs.map((tb) => (
          <Pressable key={tb} onPress={() => setTab(tb)} style={[styles.tab, tab === tb && styles.tabActive]}>
            <Text style={[styles.tabText, tab === tb && styles.tabTextActive]}>
              {tabLabel(tb)} ({counts[tb]})
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.filterRow}>
        <View style={styles.typeRow}>
          {typeFilters.map((tf) => (
            <Pressable key={tf} onPress={() => setTypeFilter(tf)} style={[styles.miniTab, typeFilter === tf && styles.miniTabActive]}>
              <Text style={[styles.miniText, typeFilter === tf && styles.miniTextActive]}>
                {tf === 'Semua' ? t('esb_all') : tf === 'Diantar' ? t('esb_delivery') : t('esb_pickup')}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.typeRow}>
          {historyKeys.map((h) => (
            <Pressable key={h} onPress={() => setHistory(h)} style={[styles.miniTab, history === h && styles.miniTabActive]}>
              <Text style={[styles.miniText, history === h && styles.miniTextActive]}>{histLabel(h)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(o) => o.id}
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
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardCode}>{item.code}</Text>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: tp.bg }]}>
                    <Text style={[styles.badgeText, { color: tp.fg }]}>{tp.label}</Text>
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
              <Text style={styles.schedule}>{t('esb_schedule')}: {scheduleOf(item)}</Text>
              <View style={styles.cardBottom}>
                <Text style={styles.cardTotal}>{rp(tt.grand)}</Text>
                <Text style={styles.link}>{t('esb_view')} ›</Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal visible={selected !== null} animationType="slide" transparent>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('esb_detail')}</Text>
            {selected && (
              <>
                <Text style={styles.detailCode}>{selected.code}</Text>
                <Text style={styles.detailMeta}>{selected.customer} - {selected.phone}</Text>
                <Text style={styles.detailMeta}>
                  {selected.type} ({typeStyle(selected.type).label}) - {selected.time}
                </Text>
                <Text style={styles.detailMeta}>{t('esb_schedule')}: {scheduleOf(selected)}</Text>
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
                <View style={styles.row}><Text style={styles.rowLabel}>{t('esb_grand')}</Text><Text style={styles.rowTotal}>{rp(tt.grand)}</Text></View></> ); })()}{selected.type === 'Diantar' ? (<><View style={styles.divider} /><View style={styles.row}><Text style={styles.rowLabel}>{t('dlv_title')}</Text><Text style={styles.rowVal}>{scheduleOf(selected)}</Text></View><Text style={styles.detailNote}>{t('dlv_search_hint')}</Text>{dlvMsg ? (<Text style={styles.detailNote}>{dlvMsg}</Text>) : null}<View style={styles.sheetBtns}><AppButton title={t('dlv_search')} variant="secondary" onPress={() => void queryDelivery(selected.code)} disabled={dlvBusy} fullWidth={false} size="md" style={styles.sheetBtn} /><AppButton title={t('dlv_schedule')} variant="secondary" onPress={() => void scheduleDelivery(selected.code)} disabled={dlvBusy} fullWidth={false} size="md" style={styles.sheetBtn} /></View></>) : null}<View style={styles.sheetBtns}>
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
      <Modal visible={rejectFor !== null} animationType="fade" transparent>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
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
  filterRow: { paddingHorizontal: 16, paddingBottom: 4 },
  typeRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  miniTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  miniTabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  miniText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  miniTextActive: { color: colors.white },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
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