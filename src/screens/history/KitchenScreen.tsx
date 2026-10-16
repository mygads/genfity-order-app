import { useEffect, useMemo, useState } from 'react';import {
  FlatList,
  Image, Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import AppButton from '../../components/AppButton';import DrawerMenu from '../../components/DrawerMenu';import { kitchenTickets, type KitchenStatus, type KitchenTicket } from '../../data/mock';import { autoSync, enqueueOutbox } from '../../lib/sync';import { printKitchenTicket } from '../../lib/print';import { notifyLocal } from '../../lib/push';import { onWsMessage, startRealtime } from '../../lib/realtime';import { useLang } from '../../lib/i18n';import { ApiPath } from '../../config/server';import { apiFetch, unwrap } from '../../lib/apiSource';import { initDb, query, run } from '../../lib/db';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type StationFilter = 'Semua' | 'Dapur' | 'Checker';const filters = ['Semua', 'Baru', 'Diproses', 'Selesai'] as const;/** * Harga master per menu (fakta: harga resmi datang dari pullMenu/pullBranchMenu * ke ms_menu; tabel di bawah hanya fallback offline untuk mock tiket yang * tidak membawa harga). Dapur tidak menghitung qty*15000 lagi. */const MENU_PRICE: Record<string, number> = { 'Nasi Goreng Spesial': 25000, 'Es Teh Manis': 8000, 'Ayam Geprek': 18000, 'Mie Goreng Jawa': 22000, 'Jus Alpukat': 15000, 'Soto Ayam': 17000, 'Tempe Mendoan': 12000, 'Es Jeruk': 10000,};const FALLBACK_PRICE = 15000;/** * T9: harga live dari pull menu (ms_menu via apiSource, offline = dummy lokal) * menang atas fallback di bawah; fallback hanya bila SQLite + pull kosong. */function ticketTotal(t: KitchenTicket, live?: Record<string, number>): number { return t.items.reduce((s, it) => s + (live?.[it.name] ?? MENU_PRICE[it.name] ?? FALLBACK_PRICE) * it.qty, 0);}function priceOf(name: string, live?: Record<string, number>): number { return live?.[name] ?? MENU_PRICE[name] ?? FALLBACK_PRICE;}/** * Station asal tiket: prioritaskan stationId/station bawaan baris (isi * pullStation → ms_station), heuristik mode/meja hanya fallback offline. */const STATION_NAME: Record<string, 'Dapur' | 'Checker'> = { dapur: 'Dapur', kitchen: 'Dapur', 'st-dapur': 'Dapur', checker: 'Checker', check: 'Checker', 'st-check': 'Checker', 'st-checker': 'Checker',};/** * T9: normalisasi nama station live (isi pullStation → ms_station) ke dua * filter dapur; heuristik mode/meja hanya fallback offline terakhir. */function normStationName(raw: string): 'Dapur' | 'Checker' | null { const v = raw.trim().toLowerCase(); if (!v) return null; if (STATION_NAME[v]) return STATION_NAME[v]; if (v.includes('dapur') || v.includes('kitchen') || v.includes('bar')) return 'Dapur'; if (v.includes('check') || v.includes('kasir')) return 'Checker'; return null;}function stationOf(t: KitchenTicket, live?: Record<string, string>, menuStation?: Record<string, string>): 'Dapur' | 'Checker' {
  const raw = String( (t as { stationId?: unknown }).stationId ?? (t as { station?: unknown }).station ?? '', ).trim(); if (raw) { const hit = live?.[raw] ?? live?.[raw.toLowerCase()]; if (hit) { const n = normStationName(hit); if (n) return n; } const direct = normStationName(raw); if (direct) return direct; } if (menuStation) { for (const it of t.items) { const sid = menuStation[it.name.trim().toLowerCase()]; if (!sid) continue; const hit = live?.[sid] ?? live?.[sid.toLowerCase()]; if (hit) { const n = normStationName(hit); if (n) return n; } const direct = normStationName(sid); if (direct) return direct; } } return t.mode === 'ESB Order' || t.table === 'Online' ? 'Checker' : 'Dapur';}function statusStyle(s: KitchenStatus) {
  if (s === 'Baru') return { bg: colors.red, fg: colors.white, label: 'BARU' };
  if (s === 'Diproses') return { bg: colors.orange, fg: colors.white, label: 'DIMASAK' };
  return { bg: colors.green, fg: colors.white, label: 'SAJI' };}/** Ubah jam "HH:MM" hari ini menjadi menit berlalu; null bila tak bisa diparse. */function minutesSince(time: string, now: number): number | null {

const m = time.match(/(\d{1,2}):(\d{2})/); if (!m) return null; const d = new Date(now); d.setHours(Number(m[1]), Number(m[2]), 0, 0); const diff = Math.floor((now - d.getTime()) / 60000); return diff >= 0 && diff < 24 * 60 ? diff : null;}function fmtElapsed(mins: number, t: (k: string) => string): string { if (mins < 60) return `${mins} mnt`; const h = Math.floor(mins / 60); const m = mins % 60; return m === 0 ? `${h} jam` : `${h} jam ${m} mnt`;}const NEXT: Record<KitchenStatus, KitchenStatus | null> = {
  Baru: 'Diproses',
  Diproses: 'Selesai',
  Selesai: null,};/** Status tiket dapur: tulis baris tr_kitchenticket + antrean outbox FISIK
 * (tr_esoprocessqueue via enqueueOutbox). Tak pernah melempar; mock tetap
 * jadi fallback bila tabel kosong. salesNum diisi '' karena mock tak bawa
 * nomor penjualan (TODO: isi saat tiket lahir dari order nyata). */
async function persistKitchenStatus(tk: KitchenTicket, status: KitchenStatus): Promise<void> {
  const now = new Date().toISOString();
  try {
    await initDb();
    await run(
      `INSERT INTO tr_kitchenticket (id, ticketNo, salesNum, status, createdAt, updatedAt, syncDate)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status, updatedAt = excluded.updatedAt, syncDate = NULL`,
      [tk.id, tk.no, '', status, now, now],
    );
  } catch { /* abaikan: status in-memory tetap jalan */ }
  try {
    await enqueueOutbox('tr_kitchenticket', tk.id, 'update');
  } catch { /* abaikan */ }
}export default function KitchenScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, setLang, t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [filter, setFilter] = useState<(typeof filters)[number]>('Semua');
  const [station, setStation] = useState<StationFilter>('Semua');
  const [selected, setSelected] = useState<KitchenTicket | null>(null);
  const [moved, setMoved] = useState<Record<string, KitchenStatus>>({});
  const [liveNotice, setLiveNotice] = useState('');

  const [now, setNow] = useState(() => Date.now());
  // T9: peta harga + station live (ms_menu/ms_station; pull via apiSource yang
  // offline-jatuh-ke-dummy). Kosong = fallback konstanta tetap dipakai.
  const [livePrice, setLivePrice] = useState<Record<string, number>>({}); const [liveStation, setLiveStation] = useState<Record<string, string>>({}); const [menuStation, setMenuStation] = useState<Record<string, string>>({}); /** Timer dapur: segarkan elapsed tiap 30 detik (Timer.periodic ala APK). */ useEffect(() => autoSync(30000, () => setNow(Date.now())), []); /** Konsumen realtime ala EsbOrderScreen: refresh tiket live + notif tiket baru. */ useEffect(() => { try { startRealtime(); } catch { /* abaikan */ } const off = onWsMessage((msg) => { if (!/kitchen|ticket|order-status/i.test(msg.type)) return; const code = String(msg.payload?.code ?? msg.payload?.no ?? msg.payload?.ticketId ?? ''); setNow(Date.now()); setLiveNotice(code ? `${t('kit_title')}: ${code}` : t('kit_new')); void notifyLocal(t('kit_title'), code ? `${code}` : t('kit_new'), code ? { code } : undefined); }); return off; }, [t]); useEffect(() => { let on = true; (async () => { try { await initDb(); let menus = await query<{ id: string; menuName: string | null; price: number | null; stationId: string | null }>( 'SELECT id, menuName, price, stationId FROM ms_menu WHERE flagActive = 1 LIMIT 500', ); if (menus.length === 0) { const res = await apiFetch(ApiPath.pullMenu, { method: 'GET' }); const { data } = unwrap<{ items?: Record<string, unknown>[] }>(res.data); const items = Array.isArray(data?.items) ? data.items : []; const at = new Date().toISOString(); for (const it of items) { const id = String(it.menuId ?? it.id ?? '').trim(); if (!id) continue; const price = Number(it.price); await run( `INSERT OR REPLACE INTO ms_menu (id, menuName, categoryId, price, imageUrl, stationId, flagActive, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [ id, it.name === undefined || it.name === null ? null : String(it.name), it.categoryId === undefined || it.categoryId === null ? null : String(it.categoryId), Number.isFinite(price) ? Math.round(price) : 0, it.imageUrl === undefined || it.imageUrl === null ? null : String(it.imageUrl), it.stationId === undefined || it.stationId === null ? null : String(it.stationId), it.flagActive === undefined || it.flagActive === null ? 1 : Number(it.flagActive) ? 1 : 0, at, ], ); } menus = await query<{ id: string; menuName: string | null; price: number | null; stationId: string | null }>( 'SELECT id, menuName, price, stationId FROM ms_menu WHERE flagActive = 1 LIMIT 500', ); } let stations = await query<{ id: string; stationName: string | null }>( 'SELECT id, stationName FROM ms_station WHERE flagActive = 1 LIMIT 60', ); if (stations.length === 0) { const res = await apiFetch(ApiPath.pullStation, { method: 'GET' }); const { data } = unwrap<{ items?: Record<string, unknown>[] }>(res.data); const items = Array.isArray(data?.items) ? data.items : []; const at = new Date().toISOString(); for (const it of items) { const id = String(it.stationId ?? it.id ?? '').trim(); if (!id) continue; await run( `INSERT INTO ms_station (id, stationName, printerName, connection, printerType, charPerLine, flagDefault, flagActive, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET stationName = excluded.stationName, printerName = excluded.printerName, printerType = excluded.printerType, charPerLine = excluded.charPerLine, flagDefault = excluded.flagDefault, flagActive = excluded.flagActive, syncDate = excluded.syncDate`, [ id, it.stationName === undefined || it.stationName === null ? null : String(it.stationName), it.printerName === undefined || it.printerName === null ? null : String(it.printerName), it.connection === undefined || it.connection === null ? null : String(it.connection), it.printerType === undefined || it.printerType === null ? null : String(it.printerType), Number.isFinite(Number(it.charPerLine)) ? Number(it.charPerLine) : 32, it.flagDefault === undefined || it.flagDefault === null ? 0 : Number(it.flagDefault) ? 1 : 0, it.flagActive === undefined || it.flagActive === null ? 1 : Number(it.flagActive) ? 1 : 0, at, ], ); } stations = await query<{ id: string; stationName: string | null }>( 'SELECT id, stationName FROM ms_station WHERE flagActive = 1 LIMIT 60', ); } let savedStatus: Record<string, KitchenStatus> = {}; try { const rows = await query<{ id: string; status: string | null }>( 'SELECT id, status FROM tr_kitchenticket LIMIT 500', ); for (const r of rows) { const st = (r.status ?? '').trim(); if (r.id && (st === 'Baru' || st === 'Diproses' || st === 'Selesai')) savedStatus[r.id] = st as KitchenStatus; } } catch { /* tabel kosong: mock tetap dipakai */ } if (!on) return; if (Object.keys(savedStatus).length > 0) setMoved((m) => ({ ...savedStatus, ...m })); if (menus.length > 0) { const pm: Record<string, number> = {}; for (const m of menus) { const p = Math.round(Number(m.price) || 0); if (m.menuName) pm[m.menuName] = p; pm[m.id] = p; } setLivePrice(pm); } if (menus.length > 0) { const ms: Record<string, string> = {}; for (const m of menus) { const sid = (m.stationId ?? '').trim(); if (!sid || !m.menuName) continue; ms[m.menuName.trim().toLowerCase()] = sid; } setMenuStation(ms); } if (stations.length > 0) { const sm: Record<string, string> = {}; for (const s of stations) { if (!s.stationName) continue; sm[s.id] = s.stationName; sm[s.id.toLowerCase()] = s.stationName; } setLiveStation(sm); } } catch { /* offline / DB belum siap - fallback konstanta tetap jalan */ } })(); return () => { on = false; }; }, []); const NEXT_LABEL: Record<KitchenStatus, string> = { Baru: t('kit_cook'), Diproses: t('kit_ready'), Selesai: '', }; const list = useMemo(
    () =>
      kitchenTickets
        .map((tk) => ({ ...tk, status: moved[tk.id] ?? tk.status }))
        .filter((tk) => filter === 'Semua' || tk.status === filter)
        .filter((tk) => station === 'Semua' || stationOf(tk, liveStation, menuStation) === station),
    [filter, station, moved, liveStation, menuStation],
  );

  const counts = useMemo(() => { const c: Record<KitchenStatus, number> = { Baru: 0, Diproses: 0, Selesai: 0 }; for (const tk of kitchenTickets) { const s = moved[tk.id] ?? tk.status; c[s] += 1; } return c; }, [moved]); const elapsedOf = (tk: KitchenTicket): { text: string; sla: boolean } => { const mins = minutesSince(tk.time, now); if (mins === null) return { text: tk.elapsed, sla: false }; return { text: fmtElapsed(mins, t), sla: mins >= 30 && (moved[tk.id] ?? tk.status) !== 'Selesai' }; }; const advance = (tk: KitchenTicket) => {
    const next = NEXT[moved[tk.id] ?? tk.status];
    if (!next) return;
    setMoved((m) => ({ ...m, [tk.id]: next }));
    setSelected((sel) => (sel && sel.id === tk.id ? { ...sel, status: next } : sel));
    void persistKitchenStatus(tk, next);
  };

  const filterLabel = (f: (typeof filters)[number]) => f === 'Semua' ? t('c_all') : f === 'Baru' ? t('kit_new') : f === 'Diproses' ? t('kit_proc') : t('kit_done'); return (
    <View style={styles.root}>
      <ScreenHeader title={t('kit_title')} sub={`${list.length} tiket - ${counts.Baru} ${t('kit_new')} - ${counts.Diproses} ${t('kit_proc')}`} onBack={() => navigation?.goBack?.()} right={ <View style={styles.headRight}><Pressable onPress={() => setLang(lang === 'id' ? 'en' : 'id')} hitSlop={8}>
        <Text style={styles.langTxt}>{lang === 'id' ? 'EN' : 'ID'}</Text> </Pressable><Pressable onPress={() => setDrawerOpen(true)} hitSlop={10}><Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" /> </Pressable>
      </View>

      } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={(r) => navigation?.navigate(r)} /><View style={styles.tabs}>
        {filters.map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.tab, filter === f && styles.tabActive]}>
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{filterLabel(f)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.stationRow}>
        {(['Semua', 'Dapur', 'Checker'] as StationFilter[]).map((s) => (
          <Pressable key={s} onPress={() => setStation(s)} style={[styles.miniTab, station === s && styles.miniTabActive]}>
            <Text style={[styles.miniText, station === s && styles.miniTextActive]}>
              {s === 'Semua' ? t('kit_station_all') : `Station ${s}`}
            </Text>
          </Pressable>
        ))}
      </View>
      {liveNotice ? <Text style={styles.liveNotice}>{liveNotice}</Text> : null}

      <FlatList
        data={list}
        keyExtractor={(tk) => tk.id}
        contentContainerStyle={[styles.list, isTablet && wideCenterLg]}
        numColumns={isTablet ? 3 : 2}
        columnWrapperStyle={styles.row}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t('kit_empty')}</Text>
            <Text style={styles.emptySub}>{t('kit_empty_sub')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const s = statusStyle(item.status);
          const el = elapsedOf(item); return (
            <Pressable style={[styles.ticket, item.priority && styles.ticketPriority]} onPress={() => setSelected(item)}>
              <View style={styles.ticketTop}>
                <Text style={styles.ticketNo}>{item.no}</Text>
                <View style={[styles.badge, { backgroundColor: s.bg }]}>
                  <Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text>
                </View>
              </View>
              <Text style={styles.ticketTable}>{item.table} - {item.mode}</Text>
              <Text style={[styles.ticketStation, el.sla && styles.ticketSla]}> Station {stationOf(item, liveStation, menuStation)} - {item.time} - {el.text}{el.sla ? ' !' : ''} </Text>
              <View style={styles.ticketDiv} />
              {item.items.map((it, idx) => (
                <Text key={idx} style={styles.ticketItem}>{it.qty}x {it.name}</Text>
              ))}
              <Text style={styles.ticketTotal}>{rp(ticketTotal(item, livePrice))}</Text> {item.priority ? <Text style={styles.priority}>★ {t('kit_priority')}</Text> : null}
            </Pressable>
          );
        }}
      />

      <Modal visible={selected !== null} animationType="slide" transparent>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {selected && (
              <>
                <View style={styles.sheetTop}>
                  <Text style={styles.sheetTitle}>{t('kit_ticket')} {selected.no} - {selected.table}</Text>
                  <Text style={styles.sheetTime}>{selected.time} - {elapsedOf(selected).text}</Text>
                </View>
                <Text style={styles.sheetStation}>
                  Station {stationOf(selected, liveStation, menuStation)} - {t('kit_status')}: {statusStyle(selected.status).label}
                </Text>
                <View style={styles.divider} />
                {selected.items.map((it, idx) => (
                  <View key={idx} style={styles.detailItem}>
                    <Text style={styles.detailQty}>{it.qty}x</Text>
                    <View style={styles.detailLeft}>
                      <Text style={styles.detailName}>{it.name}</Text>
                      {it.note ? <Text style={styles.detailNote}>{t('kit_note')}: {it.note}</Text> : null}
                    </View>
                  <Text style={styles.detailPrice}>{rp(priceOf(it.name, livePrice) * it.qty)}</Text> </View>
                ))}
                <View style={styles.divider} /><View style={styles.totalRow}> <Text style={styles.totalLabel}>{t('kit_total')}</Text> <Text style={styles.totalValue}>{rp(ticketTotal(selected, livePrice))}</Text> </View><View style={styles.sheetBtns}>
                  <AppButton title={t('c_close')} variant="secondary" onPress={() => setSelected(null)} fullWidth={false} style={styles.sheetBtn} />
                  <AppButton
                    title={t('c_reprint')}
                    variant="secondary"
                    onPress={() => {
                      const s = selected;
                      setSelected(null);
                      navigation?.navigate('Receipt', { no: s?.no, total: s ? ticketTotal(s, livePrice) : 0, items: s ? s.items.map((it) => ({ id: it.name, name: it.name, basePrice: priceOf(it.name, livePrice), qty: it.qty, ...(it.note ? { note: it.note } : {}) })) : [], mode: s?.mode, table: s?.table, discount: 0 });
                    }}
                    fullWidth={false}
                    style={styles.sheetBtn}
                  />
                  <AppButton
                    title={t('kit_print')}
                    variant="secondary"
                    onPress={() => {
                      const s = selected;
                      if (!s) return;
                      const st = stationOf(s, liveStation, menuStation);
                      void printKitchenTicket(st, {
                        station: st,
                        no: `${t('kit_ticket')} ${s.no}`,
                        table: s.table,
                        mode: s.mode,
                        time: s.time,
                        items: s.items.map((it) => ({
                          name: it.name,
                          qty: it.qty,
                          ...(it.note ? { note: String(it.note) } : {}),
                        })),
                      }).then((res) => setLiveNotice(res.ok ? t('kit_print_ok') : t('kit_print_fail')));
                    }}
                    fullWidth={false}
                    style={styles.sheetBtn}
                  />
                  {NEXT[selected.status] && (
                    <AppButton title={NEXT_LABEL[selected.status]} onPress={() => advance(selected)} fullWidth={false} style={styles.sheetBtn} />
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  langTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  burger: { width: 22, height: 22 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  stationRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  liveNotice: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, paddingHorizontal: 16, marginTop: 6 },
  miniTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  miniTabActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  miniText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  miniTextActive: { color: colors.white },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { gap: 10 },
  ticket: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  ticketPriority: { borderColor: colors.red, borderWidth: 1.5 },
  ticketTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ticketNo: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: fonts.bold, fontSize: 10 },
  ticketTable: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 6 },
  ticketStation: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, marginTop: 2 },
  ticketSla: { fontFamily: fonts.bold, color: colors.red }, ticketDiv: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  ticketItem: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginBottom: 3 },
  ticketTotal: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginTop: 4 }, priority: { fontFamily: fonts.bold, fontSize: 11, color: colors.red, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60, flex: 1 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '85%' },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 12 },
  sheetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  sheetTime: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  sheetStation: { fontFamily: fonts.medium, fontSize: 12, color: colors.orangeDark, marginTop: 4 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  detailItem: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' },
  detailQty: { fontFamily: fonts.bold, fontSize: 15, color: colors.orange, width: 36 },
  detailLeft: { flex: 1 },
  detailName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  detailNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.orangeDark, fontStyle: 'italic', marginTop: 2 },
  detailPrice: { fontFamily: fonts.medium, fontSize: 13, color: colors.text }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, totalLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy }, totalValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy }, sheetBtns: { flexDirection: 'row', gap: 8, marginTop: 14 }, sheetBtn: { flex: 1, marginTop: 0 },
  btnGhost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: 'center' },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  btnPrint: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center' },
  btnPrintText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnNext: { flex: 1, borderRadius: 10, backgroundColor: colors.green, paddingVertical: 12, alignItems: 'center' },
  btnNextText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },});