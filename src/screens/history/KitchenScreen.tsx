import { useCallback, useEffect, useMemo, useRef, useState } from 'react';import {
  FlatList,
  Image, Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import AppButton from '../../components/AppButton';import DrawerMenu from '../../components/DrawerMenu';import { type KitchenItem, type KitchenStatus, type KitchenTicket } from '../../data/mock';import { autoSync, enqueueOutbox } from '../../lib/sync';import { printKitchenTicket } from '../../lib/print';import { notifyLocal } from '../../lib/push';import { onWsMessage, startRealtime } from '../../lib/realtime';
/* APP-EVENTS: impor beda-baris agar edit beda lane tak konflik. */
import { subscribeLocalSale } from '../../lib/display';import { getSession } from '../../session';
import { getSaleClientId } from '../../lib/sales';import { useIsFocused } from '@react-navigation/native';import { getDeviceRole, normalizeTag, type TerminalTag } from '../../lib/deviceRole';import { getNotif } from '../../config/device';import { useLang } from '../../lib/i18n';import { ApiPath } from '../../config/server';import { apiFetch, unwrap } from '../../lib/apiSource';import { initDb, query, queryFirst, run } from '../../lib/db';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type StationFilter = 'Semua' | 'Dapur' | 'Checker';const filters = ['Semua', 'Baru', 'Diproses', 'Selesai'] as const;/** * Harga per baris: utamakan harga nyata baris penjualan (tr_salesmenu.price),
 * lalu peta live ms_menu, terakhir fallback konstanta (hanya tiket push
 * tanpa harga). Dapur tidak menghitung qty*15000 lagi. */const MENU_PRICE: Record<string, number> = { 'Nasi Goreng Spesial': 25000, 'Es Teh Manis': 8000, 'Ayam Geprek': 18000, 'Mie Goreng Jawa': 22000, 'Jus Alpukat': 15000, 'Soto Ayam': 17000, 'Tempe Mendoan': 12000, 'Es Jeruk': 10000,};const FALLBACK_PRICE = 15000;/** * T9: harga live dari pull menu (ms_menu via apiSource, offline = dummy lokal) * menang atas fallback di bawah; fallback hanya bila SQLite + pull kosong. */function ticketTotal(t: KitchenTicket, live?: Record<string, number>): number { return t.items.reduce((s, it) => s + priceOf(it, live) * it.qty, 0);}function priceOf(it: KitchenItem, live?: Record<string, number>): number { if (Number.isFinite(it.price) && (it.price ?? 0) > 0) return Math.round(it.price ?? 0); return live?.[it.name] ?? MENU_PRICE[it.name] ?? FALLBACK_PRICE;}/** * Station asal tiket: prioritaskan stationId/station bawaan baris (isi * pullStation → ms_station), heuristik mode/meja hanya fallback offline. */const STATION_NAME: Record<string, 'Dapur' | 'Checker'> = { dapur: 'Dapur', kitchen: 'Dapur', 'st-dapur': 'Dapur', checker: 'Checker', check: 'Checker', 'st-check': 'Checker', 'st-checker': 'Checker',};/** * T9: normalisasi nama station live (isi pullStation → ms_station) ke dua * filter dapur; heuristik mode/meja hanya fallback offline terakhir. */function normStationName(raw: string): 'Dapur' | 'Checker' | null { const v = raw.trim().toLowerCase(); if (!v) return null; if (STATION_NAME[v]) return STATION_NAME[v]; if (v.includes('dapur') || v.includes('kitchen') || v.includes('bar')) return 'Dapur'; if (v.includes('check') || v.includes('kasir')) return 'Checker'; return null;}/** Label station lokal: 'Semua'→kit_station_all, Dapur/Checker→kunci kamus
 * (jangan prefix Inggris mentah — lang=id ikut kena, lang=en bocor 'Dapur'). */
function stationLabel(s: StationFilter, t: (k: string) => string): string {
  if (s === 'Semua') return t('kit_station_all');
  return s === 'Dapur' ? t('kit_station_dapur') : t('kit_station_checker');
}
function stationOf(t: KitchenTicket, live?: Record<string, string>, menuStation?: Record<string, string>): 'Dapur' | 'Checker' {
  const raw = String( (t as { stationId?: unknown }).stationId ?? (t as { station?: unknown }).station ?? '', ).trim(); if (raw) { const hit = live?.[raw] ?? live?.[raw.toLowerCase()]; if (hit) { const n = normStationName(hit); if (n) return n; } const direct = normStationName(raw); if (direct) return direct; } if (menuStation) { for (const it of t.items) { const sid = menuStation[it.name.trim().toLowerCase()]; if (!sid) continue; const hit = live?.[sid] ?? live?.[sid.toLowerCase()]; if (hit) { const n = normStationName(hit); if (n) return n; } const direct = normStationName(sid); if (direct) return direct; } } return t.mode === 'ESB Order' || t.table === 'Online' ? 'Checker' : 'Dapur';}function statusStyle(s: KitchenStatus, t: (k: string) => string) {
  if (s === 'Baru') return { bg: colors.red, fg: colors.white, label: t('kit_new').toUpperCase() };
  if (s === 'Diproses') return { bg: colors.orange, fg: colors.white, label: t('kit_proc').toUpperCase() };
  return { bg: colors.green, fg: colors.white, label: t('kit_done').toUpperCase() };}/** Ubah jam "HH:MM" hari ini menjadi menit berlalu; null bila tak bisa diparse. */function minutesSince(time: string, now: number): number | null {

const m = time.match(/(\d{1,2}):(\d{2})/); if (!m) return null; const d = new Date(now); d.setHours(Number(m[1]), Number(m[2]), 0, 0); const diff = Math.floor((now - d.getTime()) / 60000); return diff >= 0 && diff < 24 * 60 ? diff : null;}function fmtElapsed(mins: number, t: (k: string) => string): string { if (mins < 60) return `${mins} ${t('tmr_u_min')}`; const h = Math.floor(mins / 60); const m = mins % 60; return m === 0 ? `${h} ${t('tmr_u_hour')}` : `${h} ${t('tmr_u_hour')} ${m} ${t('tmr_u_min')}`;}const NEXT: Record<KitchenStatus, KitchenStatus | null> = {
  Baru: 'Diproses',
  Diproses: 'Selesai',
  Selesai: null,};/** Status tiket dapur: tulis baris tr_kitchenticket + antrean outbox FISIK
 * (tr_esoprocessqueue via enqueueOutbox). Tak pernah melempar; daftar tiket
 * dibaca dari tr_kitchenticket (tiket lahir dari saveSale nyata, bukan mock). */
async function persistKitchenStatus(tk: KitchenTicket, status: KitchenStatus): Promise<void> {
  const now = new Date().toISOString();
  const salesNum = String((tk as { salesNum?: unknown }).salesNum ?? '');
  // Q7: status menempel pada identitas head (lookup, tak menerbitkan baru —
  // head pasti ada karena status hanya berubah untuk sale nyata).
  const cid = (salesNum ? await getSaleClientId(salesNum) : null) ?? null;
  try {
    await initDb();
    await run(
      `INSERT INTO tr_kitchenticket (id, ticketNo, salesNum, client_id, status, createdAt, updatedAt, syncDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status, updatedAt = excluded.updatedAt, syncDate = NULL, client_id = COALESCE(tr_kitchenticket.client_id, excluded.client_id)`,
      [tk.id, tk.no, salesNum, cid, status, now, now],
    );
  } catch { /* abaikan: status in-memory tetap jalan */ }
  try {
    await enqueueOutbox('tr_kitchenticket', tk.id, 'update');
  } catch { /* abaikan */ }
}

/** Normalisasi payload KITCHEN_TICKET server → tiket + station cetak.
 * Null bila tak valid (tak ada nomor / tak ada item). */
function normalizePushTicket(p: Record<string, unknown>): {
  ticket: KitchenTicket;
  station: 'Dapur' | 'Checker';
  salesNum: string;
} | null {
  const salesNum = String(p.salesNum ?? p.orderId ?? '').trim();
  const no = String(p.ticketNo ?? p.no ?? p.ticket ?? salesNum).trim();
  if (!salesNum && !no) return null;
  const rawItems = Array.isArray(p.items) ? p.items : [];
  const items: KitchenItem[] = [];
  for (const raw of rawItems) {
    const it = raw as { name?: unknown; menuName?: unknown; qty?: unknown; note?: unknown };
    const name = String(it.name ?? it.menuName ?? '').trim();
    if (!name) continue;
    items.push({
      name,
      qty: Math.max(1, Math.round(Number(it.qty) || 1)),
      ...(it.note ? { note: String(it.note) } : {}),
    });
  }
  if (items.length === 0) return null;
  const st = String(p.status ?? 'Baru').trim();
  const status: KitchenStatus = st === 'Diproses' || st === 'Selesai' ? st : 'Baru';
  const id = String(p.ticketId ?? (salesNum ? `kt-${salesNum}` : `kt-push-${no}`)).trim();
  const stationRaw = String(p.stationId ?? p.station ?? '').trim();
  return {
    ticket: {
      id,
      no: no || salesNum,
      table: String(p.table ?? p.tableNo ?? salesNum).trim(),
      mode: String(p.mode ?? '').trim(),
      time: String(p.time ?? new Date().toISOString().slice(11, 16)).trim(),
      elapsed: '',
      items,
      status,
      priority: false,
    },
    station: /check/i.test(stationRaw) ? 'Checker' : 'Dapur',
    // salesNum fallback ke nomor agar baris cache head/menu tetap
    // berelasi walau payload hanya membawa nomor tiket.
    salesNum: salesNum || no,
  };
}

/** Simpan tiket push sebagai cache lokal bertanda sync (syncDate = now).
 * Tanpa outbox: kasir pemilik order yang push ke server; dapur hanya cermin
 * agar tiket tetap ada setelah reload. Tak pernah melempar. */
async function cachePushTicket(tk: { ticket: KitchenTicket; salesNum: string }): Promise<void> {
  const now = new Date().toISOString();
  try {
    await initDb();
    const { ticket, salesNum } = tk;
    // Q7: cermin push memakai client_id head bila sale sudah dikenal lokal;
    // NULL bila belum (cermin jujur — server pemilik identitas, tak mengarang
    // uuid baru untuk sale milik server).
    const cid = (salesNum ? await getSaleClientId(salesNum) : null) ?? null;
    await run(
      `INSERT INTO tr_kitchenticket (id, ticketNo, salesNum, client_id, status, createdAt, updatedAt, syncDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status, updatedAt = excluded.updatedAt, syncDate = excluded.syncDate, client_id = COALESCE(tr_kitchenticket.client_id, excluded.client_id)`,
      [ticket.id, ticket.no, salesNum, cid, ticket.status, now, now, now],
    );
    if (!salesNum) return;
    await run(
      `INSERT INTO tr_saleshead (salesNum, client_id, salesMode, tableNo, status, createdAt, updatedAt, syncDate)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
       ON CONFLICT (salesNum) DO NOTHING`,
      [salesNum, cid, ticket.mode || null, ticket.table || null, now, now, now],
    );
    for (let i = 0; i < ticket.items.length; i += 1) {
      const it = ticket.items[i];
      await run(
        `INSERT INTO tr_salesmenu (id, salesNum, client_id, menuName, qty, price, discount, subtotal, note, status, syncDate, createdAt)
         VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 'open', ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [`sm-${ticket.id}-${i}`, salesNum, cid, it.name, it.qty, it.note ?? null, now, now],
      );
    }
  } catch { /* cache best-effort: state in-memory tetap tampil */ }
}/** Tag efektif layar dapur: session.terminalTag (kontrak SPEC §1, sudah backfill binding) menang; fallback peran device legacy ('DAPUR'→'dapur'). Tak dikenal = full_access. */function kitchenTag(): TerminalTag { try { const raw = getSession()?.terminalTag; if (raw !== undefined && raw !== null && String(raw).trim() !== '') { const p = normalizeTag(raw); if (p) return p; } } catch { /* abaikan: fallback peran device */ } try { return normalizeTag(getDeviceRole()) ?? 'full_access'; } catch { /* abaikan */ } return 'full_access'; }/** Topik SPEC §9 untuk dapur: 'kitchen-incoming'/'order-accepted' kanonis + warisan KITCHEN_TICKET/kitchen/ticket/order-status. */function isKitchenIncoming(type: unknown): boolean { const t = String(type ?? '').trim().toLowerCase(); if (!t) return false; if (t === 'kitchen-incoming' || t === 'kitchen_incoming' || t === 'order-accepted' || t === 'order_accepted' || t === 'kitchen_ticket') return true; return /kitchen|ticket|order-status/i.test(t); }/** Dapur + full_access menerima kitchen-incoming/order-accepted (SPEC §8-§9, realtime-02); tag lain diabaikan. */function kitchenTagAllowed(tag: TerminalTag): boolean { return tag === 'dapur' || tag === 'full_access'; }export default function KitchenScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [filter, setFilter] = useState<(typeof filters)[number]>('Semua');
  const [station, setStation] = useState<StationFilter>('Semua');
  const [selected, setSelected] = useState<KitchenTicket | null>(null);
  const [moved, setMoved] = useState<Record<string, KitchenStatus>>({});
  // Tiket dapur nyata dari tr_kitchenticket (dilahirkan saveSale per order).
  // Kosong = empty-state; mock kitchenTickets sudah dihapus sebagai fallback.
  const [tickets, setTickets] = useState<KitchenTicket[]>([]); const ticketsRef = useRef<KitchenTicket[]>([]); ticketsRef.current = tickets;
  const [liveNotice, setLiveNotice] = useState('');

  const [now, setNow] = useState(() => Date.now());
  // T9: peta harga + station live (ms_menu/ms_station; pull via apiSource yang
  // offline-jatuh-ke-dummy). Kosong = fallback konstanta tetap dipakai.
  const [livePrice, setLivePrice] = useState<Record<string, number>>({}); const [liveStation, setLiveStation] = useState<Record<string, string>>({}); const [menuStation, setMenuStation] = useState<Record<string, string>>({}); /** Timer dapur: segarkan elapsed tiap 30 detik (Timer.periodic ala APK). */ useEffect(() => autoSync(30000, () => setNow(Date.now())), []);   /** Konsumen realtime: tiket push dari server (KITCHEN_TICKET, kontrak
   * terminal §4) + notif tipe warisan. Tiket push disimpan sebagai cache
   * lokal bertanda sync (tanpa outbox - kasir pemilik order yang push). */
  useEffect(() => {
    try { startRealtime(); } catch { /* abaikan */ }
    const off = onWsMessage((msg) => {
      if (!isKitchenIncoming(msg.type)) return;
      if (!kitchenTagAllowed(kitchenTag())) return;
      setNow(Date.now());
      if (msg.type === 'KITCHEN_TICKET') {
        const tk = normalizePushTicket(msg.payload ?? {});
        if (!tk) return;
        void cachePushTicket(tk);
        setTickets((prev) => {
          if (!prev.some((x) => x.id === tk.ticket.id)) return [tk.ticket, ...prev];
          // Tiket dikenal (echo / update status server): item selalu segar;
          // status server hanya menang bila belum disentuh lokal (moved)
          // agar echo basi tak meregresi advance dapur.
          setMoved((m) => (m[tk.ticket.id] ? m : { ...m, [tk.ticket.id]: tk.ticket.status }));
          return prev.map((x) => (x.id === tk.ticket.id ? { ...x, items: tk.ticket.items } : x));
        });
        setLiveNotice(`${t('kit_title')}: ${tk.ticket.no}`);
        void notifyLocal(t('kit_title'), tk.ticket.no, { code: tk.ticket.no }, 'dapur');
        // Perangkat tag dapur (session.terminalTag, fallback peran device legacy): cetak otomatis sesuai preferensi (kontrak §4.3).
        if (kitchenTag() === 'dapur' && getNotif().autoPrintKitchen) {
          void printKitchenTicket(tk.station, {
            station: tk.station,
            no: `${t('kit_ticket')} ${tk.ticket.no}`,
            table: tk.ticket.table,
            mode: tk.ticket.mode,
            time: tk.ticket.time,
            items: tk.ticket.items.map((it) => ({
              name: it.name,
              qty: it.qty,
              ...(it.note ? { note: String(it.note) } : {}),
            })),
          }).then((res) => {
            if (!res.ok) setLiveNotice(t('kit_print_fail'));
          });
        }
        return;
      }
      const code = String(msg.payload?.code ?? msg.payload?.no ?? msg.payload?.ticketId ?? '');
      setLiveNotice(code ? `${t('kit_title')}: ${code}` : t('kit_new'));
      void notifyLocal(t('kit_title'), code ? `${code}` : t('kit_new'), code ? { code } : undefined, 'dapur');
    });
    return off;
  }, [t]);
  /** APP-EVENTS: sale lokal same-device (kasir→dapur satu device, audit row
   * 12) — tiket tampil instan tanpa roundtrip server, tetap offline. */
  useEffect(() => subscribeLocalSale((s) => {
    if (!kitchenTagAllowed(kitchenTag())) return;
    setNow(Date.now());
    setTickets((prev) => {
      const id = `kt-${s.salesNum}`;
      if (!s.salesNum || prev.some((x) => x.id === id)) return prev;
      return [{
        id,
        no: s.salesNum,
        table: s.salesNum,
        mode: '',
        time: new Date().toISOString().slice(11, 16),
        elapsed: '',
        items: s.items.map((it) => ({ name: it.name, qty: it.qty, price: it.qty > 0 ? Math.round(it.subtotal / it.qty) : 0 })),
        status: 'Baru',
        priority: false,
        salesNum: s.salesNum,
      } as KitchenTicket, ...prev];
    });
    setLiveNotice(`${t('kit_title')}: ${s.salesNum}`);
  }), [t]);
  useEffect(() => { let on = true; (async () => { try { await initDb(); let menus = await query<{ id: string; menuName: string | null; price: number | null; stationId: string | null }>( 'SELECT id, menuName, price, stationId FROM ms_menu WHERE flagActive = 1 LIMIT 500', ); if (menus.length === 0) { const res = await apiFetch(ApiPath.pullMenu, { method: 'GET' }); const { data } = unwrap<{ items?: Record<string, unknown>[] }>(res.data); const items = Array.isArray(data?.items) && !res.fromDummy ? data.items : []; const at = new Date().toISOString(); for (const it of items) { const id = String(it.menuId ?? it.id ?? '').trim(); if (!id) continue; const price = Number(it.price); await run( `INSERT OR REPLACE INTO ms_menu (id, menuName, categoryId, price, imageUrl, stationId, flagActive, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [ id, it.name === undefined || it.name === null ? null : String(it.name), it.categoryId === undefined || it.categoryId === null ? null : String(it.categoryId), Number.isFinite(price) ? Math.round(price) : 0, it.imageUrl === undefined || it.imageUrl === null ? null : String(it.imageUrl), it.stationId === undefined || it.stationId === null ? null : String(it.stationId), it.flagActive === undefined || it.flagActive === null ? 1 : Number(it.flagActive) ? 1 : 0, at, ], ); } menus = await query<{ id: string; menuName: string | null; price: number | null; stationId: string | null }>( 'SELECT id, menuName, price, stationId FROM ms_menu WHERE flagActive = 1 LIMIT 500', ); } let stations = await query<{ id: string; stationName: string | null }>( 'SELECT id, stationName FROM ms_station WHERE flagActive = 1 LIMIT 60', ); if (stations.length === 0) { const res = await apiFetch(ApiPath.pullStation, { method: 'GET' }); const { data } = unwrap<{ items?: Record<string, unknown>[] }>(res.data); const items = Array.isArray(data?.items) && !res.fromDummy ? data.items : []; const at = new Date().toISOString(); for (const it of items) { const id = String(it.stationId ?? it.id ?? '').trim(); if (!id) continue; await run( `INSERT INTO ms_station (id, stationName, printerName, connection, printerType, charPerLine, flagDefault, flagActive, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET stationName = excluded.stationName, printerName = excluded.printerName, printerType = excluded.printerType, charPerLine = excluded.charPerLine, flagDefault = excluded.flagDefault, flagActive = excluded.flagActive, syncDate = excluded.syncDate`, [ id, it.stationName === undefined || it.stationName === null ? null : String(it.stationName), it.printerName === undefined || it.printerName === null ? null : String(it.printerName), it.connection === undefined || it.connection === null ? null : String(it.connection), it.printerType === undefined || it.printerType === null ? null : String(it.printerType), Number.isFinite(Number(it.charPerLine)) ? Number(it.charPerLine) : 32, it.flagDefault === undefined || it.flagDefault === null ? 0 : Number(it.flagDefault) ? 1 : 0, it.flagActive === undefined || it.flagActive === null ? 1 : Number(it.flagActive) ? 1 : 0, at, ], ); } stations = await query<{ id: string; stationName: string | null }>( 'SELECT id, stationName FROM ms_station WHERE flagActive = 1 LIMIT 60', ); } let savedStatus: Record<string, KitchenStatus> = {}; try { const rows = await query<{ id: string; status: string | null }>( 'SELECT id, status FROM tr_kitchenticket LIMIT 500', ); for (const r of rows) { const st = (r.status ?? '').trim(); if (r.id && (st === 'Baru' || st === 'Diproses' || st === 'Selesai')) savedStatus[r.id] = st as KitchenStatus; } } catch { /* tabel kosong: daftar tetap kosong → empty-state */ } if (!on) return; if (Object.keys(savedStatus).length > 0) setMoved((m) => ({ ...savedStatus, ...m })); try { const rows = await query<{ id: string; ticketNo: string | null; salesNum: string | null; status: string | null; createdAt: string | null }>( 'SELECT id, ticketNo, salesNum, status, createdAt FROM tr_kitchenticket ORDER BY createdAt DESC LIMIT 200', ); const out: KitchenTicket[] = []; for (const row of rows) { const st = (row.status ?? '').trim(); if (st !== 'Baru' && st !== 'Diproses' && st !== 'Selesai') continue; const salesNum = (row.salesNum ?? '').trim(); let table = salesNum; let mode = ''; let time = (row.createdAt ?? '').slice(11, 16); try { if (salesNum) { const head = await queryFirst<{ tableNo: string | null; salesMode: string | null; createdAt: string | null }>( 'SELECT tableNo, salesMode, createdAt FROM tr_saleshead WHERE salesNum = ? LIMIT 1', [salesNum], ); if (head) { if (head.tableNo) table = head.tableNo; if (head.salesMode) mode = head.salesMode; const ht = (head.createdAt ?? '').slice(11, 16); if (ht) time = ht; } } } catch { /* info head opsional */ } let items: KitchenItem[] = []; try { if (salesNum) { const menuRows = await query<{ menuName: string | null; qty: number | null; price: number | null; note: string | null }>( 'SELECT menuName, qty, price, note FROM tr_salesmenu WHERE salesNum = ?', [salesNum], ); items = menuRows.map((mr) => ({ name: mr.menuName ?? '-', qty: Math.round(Number(mr.qty) || 0), ...(Number.isFinite(Number(mr.price)) ? { price: Math.round(Number(mr.price)) } : {}), ...(mr.note ? { note: mr.note } : {}) })); } } catch { /* item opsional */ } out.push({ id: row.id, no: (row.ticketNo ?? '').trim() || salesNum, table, mode, time, elapsed: '', items, status: st as KitchenStatus, priority: false, salesNum } as KitchenTicket); } if (!on) return; setTickets(out); } catch { if (on) setTickets([]); } if (menus.length > 0) { const pm: Record<string, number> = {}; for (const m of menus) { const p = Math.round(Number(m.price) || 0); if (m.menuName) pm[m.menuName] = p; pm[m.id] = p; } setLivePrice(pm); } if (menus.length > 0) { const ms: Record<string, string> = {}; for (const m of menus) { const sid = (m.stationId ?? '').trim(); if (!sid || !m.menuName) continue; ms[m.menuName.trim().toLowerCase()] = sid; } setMenuStation(ms); } if (stations.length > 0) { const sm: Record<string, string> = {}; for (const s of stations) { if (!s.stationName) continue; sm[s.id] = s.stationName; sm[s.id.toLowerCase()] = s.stationName; } setLiveStation(sm); } } catch { /* offline / DB belum siap - fallback konstanta tetap jalan */ } })(); return () => { on = false; }; }, []); const isFocused = useIsFocused(); /** Ambil detail head+item untuk tiket yang baru terlihat di SQLite lokal (id belum ada di state); prepend tanpa menggeser status lokal. Tak pernah melempar. */ const fillNewTickets = useCallback(async (fresh: { id: string; ticketNo: string | null; salesNum: string | null; status: string | null; createdAt: string | null }[]): Promise<void> => { if (fresh.length === 0) return; try { await initDb(); const out: KitchenTicket[] = []; for (const row of fresh) { const salesNum = (row.salesNum ?? '').trim(); let table = salesNum; let mode = ''; let time = (row.createdAt ?? '').slice(11, 16); try { if (salesNum) { const head = await queryFirst<{ tableNo: string | null; salesMode: string | null; createdAt: string | null }>('SELECT tableNo, salesMode, createdAt FROM tr_saleshead WHERE salesNum = ? LIMIT 1', [salesNum]); if (head) { if (head.tableNo) table = head.tableNo; if (head.salesMode) mode = head.salesMode; const ht = (head.createdAt ?? '').slice(11, 16); if (ht) time = ht; } } } catch { /* info head opsional */ } let items: KitchenItem[] = []; try { if (salesNum) { const menuRows = await query<{ menuName: string | null; qty: number | null; price: number | null; note: string | null }>('SELECT menuName, qty, price, note FROM tr_salesmenu WHERE salesNum = ?', [salesNum]); items = menuRows.map((mr) => ({ name: mr.menuName ?? '-', qty: Math.round(Number(mr.qty) || 0), ...(Number.isFinite(Number(mr.price)) ? { price: Math.round(Number(mr.price)) } : {}), ...(mr.note ? { note: mr.note } : {}) })); } } catch { /* item opsional */ } const st = (row.status ?? '').trim(); out.push({ id: row.id, no: (row.ticketNo ?? '').trim() || salesNum, table, mode, time, elapsed: '', items, status: (st === 'Diproses' || st === 'Selesai' ? st : 'Baru') as KitchenStatus, priority: false, salesNum } as KitchenTicket); } if (out.length === 0) return; setTickets((prev) => { const ids = new Set(prev.map((x) => x.id)); const add = out.filter((x) => !ids.has(x.id)); return add.length > 0 ? [...add, ...prev] : prev; }); } catch { /* cache best-effort: state in-memory tetap tampil */ } }, []); /** Refresh ringan tr_kitchenticket lokal (realtime-07): tiket lahir dari saveSale kasir perangkat yang sama tanpa putaran server. Satu SELECT murah; detail head+item hanya untuk id yang benar-benar baru. Tak pernah melempar. */ const refreshLocalTickets = useCallback(async (): Promise<void> => { try { await initDb(); const rows = await query<{ id: string; ticketNo: string | null; salesNum: string | null; status: string | null; createdAt: string | null }>('SELECT id, ticketNo, salesNum, status, createdAt FROM tr_kitchenticket ORDER BY createdAt DESC LIMIT 200'); const valid = rows.filter((r) => r.id && (r.status === 'Baru' || r.status === 'Diproses' || r.status === 'Selesai')); if (valid.length === 0) return; setMoved((m) => { let changed = false; const next: Record<string, KitchenStatus> = { ...m }; for (const r of valid) { if (!(r.id in next)) { next[r.id] = r.status as KitchenStatus; changed = true; } } return changed ? next : m; }); const ids = new Set(ticketsRef.current.map((x) => x.id)); const fresh = valid.filter((r) => !ids.has(r.id)); if (fresh.length > 0) await fillNewTickets(fresh); } catch { /* abaikan: daftar in-memory tetap jalan */ } }, [fillNewTickets]); /** Poll lokal 5 dtk HANYA saat layar fokus (SPEC §8, realtime-07): kasir→dapur satu perangkat bekerja offline. Interval dibuat saat fokus, dibersihkan saat blur/unmount. */ useEffect(() => { if (!isFocused) return; void refreshLocalTickets(); const id = setInterval(() => { void refreshLocalTickets(); }, 5000); return () => clearInterval(id); }, [isFocused, refreshLocalTickets]); const NEXT_LABEL: Record<KitchenStatus, string> = { Baru: t('kit_cook'), Diproses: t('kit_ready'), Selesai: '', }; const list = useMemo(
    () =>
      tickets
        .map((tk) => ({ ...tk, status: moved[tk.id] ?? tk.status }))
        .filter((tk) => filter === 'Semua' || tk.status === filter)
        .filter((tk) => station === 'Semua' || stationOf(tk, liveStation, menuStation) === station),
    [filter, station, moved, tickets, liveStation, menuStation],
  );

  const counts = useMemo(() => { const c: Record<KitchenStatus, number> = { Baru: 0, Diproses: 0, Selesai: 0 }; for (const tk of tickets) { const s = moved[tk.id] ?? tk.status; c[s] += 1; } return c; }, [tickets, moved]); const elapsedOf = (tk: KitchenTicket): { text: string; sla: boolean } => { const mins = minutesSince(tk.time, now); if (mins === null) return { text: tk.elapsed, sla: false }; return { text: fmtElapsed(mins, t), sla: mins >= 30 && (moved[tk.id] ?? tk.status) !== 'Selesai' }; }; const advance = (tk: KitchenTicket) => {
    const next = NEXT[moved[tk.id] ?? tk.status];
    if (!next) return;
    setMoved((m) => ({ ...m, [tk.id]: next }));
    setSelected((sel) => (sel && sel.id === tk.id ? { ...sel, status: next } : sel));
    void persistKitchenStatus(tk, next);
  };

  const filterLabel = (f: (typeof filters)[number]) => f === 'Semua' ? t('c_all') : f === 'Baru' ? t('kit_new') : f === 'Diproses' ? t('kit_proc') : t('kit_done'); return (
    <View style={styles.root}>
      <ScreenHeader title={t('kit_title')} sub={`${list.length} tiket - ${counts.Baru} ${t('kit_new')} - ${counts.Diproses} ${t('kit_proc')}`} left={<Pressable onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}><Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" /></Pressable>
      } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={(r) => navigation?.navigate(r)} /><View style={styles.tabs}>
        {filters.map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.tab, filter === f && styles.tabActive, isTablet && styles.tabTablet]}>
            <Text style={[styles.tabText, filter === f && styles.tabTextActive, isTablet && styles.tabTextBig]}>{filterLabel(f)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.stationRow}>
        {(['Semua', 'Dapur', 'Checker'] as StationFilter[]).map((s) => (
          <Pressable key={s} onPress={() => setStation(s)} style={[styles.miniTab, station === s && styles.miniTabActive, isTablet && styles.miniTabTablet]}>
            <Text style={[styles.miniText, station === s && styles.miniTextActive, isTablet && styles.miniTextBig]}>
              {stationLabel(s, t)}
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
          const s = statusStyle(item.status, t);
          const el = elapsedOf(item); return (
            <Pressable style={[styles.ticket, item.priority && styles.ticketPriority, isTablet && styles.ticketTablet]} onPress={() => setSelected(item)}>
              <View style={styles.ticketTop}>
                <Text style={[styles.ticketNo, isTablet && styles.ticketNoBig]}>{item.no}</Text>
                <View style={[styles.badge, { backgroundColor: s.bg }]}>
                  <Text style={[styles.badgeText, { color: s.fg }, isTablet && styles.badgeTextBig]}>{s.label}</Text>
                </View>
              </View>
              <Text style={styles.ticketTable}>{item.table} - {item.mode}</Text>
              <Text style={[styles.ticketStation, el.sla && styles.ticketSla]}> {stationLabel(stationOf(item, liveStation, menuStation), t)} - {item.time} - {el.text}{el.sla ? ' !' : ''} </Text>
              <View style={styles.ticketDiv} />
              {item.items.map((it, idx) => (
                <Text key={idx} style={[styles.ticketItem, isTablet && styles.ticketItemBig]}>{it.qty}x {it.name}</Text>
              ))}
              <Text style={[styles.ticketTotal, isTablet && styles.ticketTotalBig]}>{rp(ticketTotal(item, livePrice))}</Text>{item.priority ? <Text style={styles.priority}>★ {t('kit_priority')}</Text> : null}
            </Pressable>
          );
        }}
      />

      <Modal visible={selected !== null} animationType="slide" transparent>
        <View style={[styles.sheetWrap, isTablet && styles.sheetWrapTablet]}>
          <View style={[styles.sheet, isTablet && styles.sheetTablet]}>
            <View style={styles.sheetHandle} />
            {selected && (
              <>
                <View style={styles.sheetTop}>
                  <Text style={styles.sheetTitle}>{t('kit_ticket')} {selected.no} - {selected.table}</Text>
                  <Text style={styles.sheetTime}>{selected.time} - {elapsedOf(selected).text}</Text>
                </View>
                <Text style={styles.sheetStation}>
                  {stationLabel(stationOf(selected, liveStation, menuStation), t)} - {t('kit_status')}: {statusStyle(selected.status, t).label}
                </Text>
                <View style={styles.divider} />
                {selected.items.map((it, idx) => (
                  <View key={idx} style={styles.detailItem}>
                    <Text style={styles.detailQty}>{it.qty}x</Text>
                    <View style={styles.detailLeft}>
                      <Text style={styles.detailName}>{it.name}</Text>
                      {it.note ? <Text style={styles.detailNote}>{t('kit_note')}: {it.note}</Text> : null}
                    </View>
                  <Text style={styles.detailPrice}>{rp(priceOf(it, livePrice) * it.qty)}</Text></View>
                ))}
                <View style={styles.divider} /><View style={styles.totalRow}><Text style={styles.totalLabel}>{t('kit_total')}</Text><Text style={styles.totalValue}>{rp(ticketTotal(selected, livePrice))}</Text></View><View style={styles.sheetBtns}>
                  <AppButton title={t('c_close')} variant="secondary" onPress={() => setSelected(null)} fullWidth={false} size="md" style={styles.sheetBtn} />
                  <AppButton
                    title={t('c_reprint')}
                    variant="secondary"
                    onPress={() => {
                      const s = selected;
                      setSelected(null);
                      // Cetak ulang ikut rantai Q7: clientId diambil dari head agar
                      // QR struk cetak-ulang tetap terbangun (Receipt butuh
                      // clientId + no); tanpa ini receiptQr kosong.
                      void (async () => {
                        const cid = s?.no ? (await getSaleClientId(s.no)) ?? '' : '';
                        navigation?.navigate('Receipt', { no: s?.no, total: s ? ticketTotal(s, livePrice) : 0, items: s ? s.items.map((it) => ({ id: it.name, name: it.name, basePrice: priceOf(it, livePrice), qty: it.qty, ...(it.note ? { note: it.note } : {}) })) : [], mode: s?.mode, table: s?.table, discount: 0, ...(cid ? { clientId: cid } : {}) });
                      })();
                    }}
                    fullWidth={false}
                    size="md"
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
                    size="md"
                    style={styles.sheetBtn}
                  />
                  {NEXT[selected.status] && (
                    <AppButton title={NEXT_LABEL[selected.status]} onPress={() => advance(selected)} fullWidth={false} size="md" style={styles.sheetBtn} />
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
  langTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  burger: { width: 22, height: 22 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  /* Tablet: tab filter lebih tinggi agar mudah disentuh pakai sarung tangan. */
  tabTablet: { paddingVertical: 12, minHeight: 44 },
  tabTextBig: { fontSize: 14 },
  stationRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  liveNotice: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, paddingHorizontal: 16, marginTop: 6 },
  miniTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  miniTabActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  miniText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  miniTextActive: { color: colors.white },
  /* Tablet: chip station lebih tinggi agar mudah disentuh pakai sarung tangan. */
  miniTabTablet: { paddingVertical: 12, minHeight: 44 },
  miniTextBig: { fontSize: 13 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { gap: 10 },
  ticket: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  /* Tablet: padding tiket lebih lega agar terbaca dari jarak lengan. */
  ticketTablet: { padding: 14 },
  ticketPriority: { borderColor: colors.red, borderWidth: 1.5 },
  ticketTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ticketNo: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  ticketNoBig: { fontSize: 19 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: fonts.bold, fontSize: 10 },
  badgeTextBig: { fontSize: 11 },
  ticketTable: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 6 },
  ticketStation: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, marginTop: 2 },
  ticketSla: { fontFamily: fonts.bold, color: colors.red }, ticketDiv: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  ticketItem: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginBottom: 3 },
  ticketItemBig: { fontSize: 13 },
  ticketTotal: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginTop: 4 },
  ticketTotalBig: { fontSize: 15 }, priority: { fontFamily: fonts.bold, fontSize: 11, color: colors.red, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60, flex: 1 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '85%' },
  /* Tablet: detail tiket jadi kartu dialog tengah agar tombol aksi lega. */
  sheetWrapTablet: { justifyContent: 'center', padding: 24 },
  sheetTablet: { maxWidth: 680, width: '100%', alignSelf: 'center', borderRadius: 20 },
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