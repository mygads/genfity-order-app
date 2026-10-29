import { useEffect, useRef, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import AppButton from '../../components/AppButton';import ScreenHeader from '../../components/ScreenHeader';import { useLang } from '../../lib/i18n';import { all, initDb, run } from '../../lib/db';import { enqueueSync } from '../../lib/sync';import { nextSalesNum } from '../../lib/sales';import type { CartItem } from './CashierScreen';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav; route?: { params?: { newOrder?: { title: string; mode: string; table?: string; items: CartItem[]; ongkir?: number; ongkirCut?: number; salesNum?: string; voucher?: { code: string; amount: number; kind?: string; rate?: number; maxAmount?: number; minSpend?: number }; memberId?: string; customer?: string };

}; };};interface Saved { id: string; badge: string; mode: string; title: string; detail: string; table?: string; items: CartItem[]; ongkir?: number; ongkirCut?: number; salesNum?: string; serviceDate?: string; serviceTime?: string; technician?: string; dpPercent?: number; deliveryAddress?: string; deliveryFee?: number; voucher?: { code: string; amount: number; kind?: string; rate?: number; maxAmount?: number; minSpend?: number }; memberId?: string; customer?: string; }/** Payload JSON yang disimpan di tr_draftorder.payload. */interface DraftPayload { title?: string; mode?: string; table?: string; items?: CartItem[]; ongkir?: number; ongkirCut?: number; salesNum?: string; serviceDate?: string; serviceTime?: string; technician?: string; dpPercent?: number; deliveryAddress?: string; deliveryFee?: number; voucher?: { code: string; amount: number; kind?: string; rate?: number; maxAmount?: number; minSpend?: number }; memberId?: string; customer?: string; total?: number; ts?: number; }interface DraftRow { id: string; payload: string; createdAt?: string | null; }const FILTERS = ['Semua', 'Dine In', 'Take Away', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'];/** Peta mode simpanan ke mode kasir (dulu GOFOOD/GRABFOOD/SHOPEEFOOD jatuh ke tanpa mode). */const MODE_TO_CASHIER: Record<string, string> = { 'Dine In': 'DINE IN', 'Take Away': 'TAKE AWAY', GOFOOD: 'GOFOOD', GRABFOOD: 'GRABFOOD', SHOPEEFOOD: 'SHOPEEFOOD',};function badgeForMode(mode: string): string { const u = (mode ?? '').toUpperCase(); if (u === 'DINE IN' || u === 'DINE-IN') return 'DI'; if (u === 'TAKE AWAY' || u === 'TAKEAWAY') return 'TA'; if (u === 'GOFOOD' || u === 'GRABFOOD') return 'GF'; if (u === 'SHOPEEFOOD') return 'SF'; return 'OL'; }function labelForMode(mode: string): string { const u = (mode ?? '').toUpperCase(); if (u === 'DINE IN' || u === 'DINE-IN') return 'Dine In'; if (u === 'TAKE AWAY' || u === 'TAKEAWAY') return 'Take Away'; return mode || 'Dine In'; }function formatTs(ts?: number, createdAt?: string | null): string { try { const d = typeof ts === 'number' && ts > 0 ? new Date(ts) : createdAt ? new Date(createdAt) : null; if (!d || Number.isNaN(d.getTime())) return ''; const hh = String(d.getHours()).padStart(2, '0'); const mm = String(d.getMinutes()).padStart(2, '0'); return `${hh}:${mm}`; } catch { return ''; } }function sumItems(items: CartItem[]): number { return (items ?? []).reduce((s, c) => s + (c.basePrice + (c.modifiers ?? []).reduce((m, x) => m + x.price, 0)) * c.qty - (c.discount ?? 0), 0); }function draftToSaved(id: string, p: DraftPayload, createdAt?: string | null): Saved | null { const items = Array.isArray(p.items) ? p.items : []; const mode = p.mode ?? 'DINE IN'; const label = labelForMode(mode); const count = items.reduce((s, c) => s + (c.qty ?? 0), 0); const ongkir = typeof p.ongkir === 'number' ? p.ongkir : 0; const sum = typeof p.total === 'number' ? p.total : sumItems(items) + ongkir - (p.ongkirCut ?? 0); const clock = formatTs(p.ts, createdAt); const title = p.title ?? label; const detail = `${count} item · ${rp(sum)}${clock ? ` · ${clock}` : ''}`; return { id, badge: badgeForMode(mode), mode: label, title, detail, ...(p.table ? { table: p.table } : {}), items, ...(ongkir ? { ongkir } : {}), ...(typeof p.ongkirCut === 'number' && p.ongkirCut > 0 ? { ongkirCut: Math.round(p.ongkirCut) } : {}), ...(typeof p.salesNum === 'string' && p.salesNum.trim() ? { salesNum: p.salesNum.trim() } : {}), ...(p.voucher && p.voucher.code ? { voucher: { code: p.voucher.code, amount: Math.max(0, Math.round(Number(p.voucher.amount) || 0)), ...(p.voucher.kind ? { kind: p.voucher.kind } : {}), ...(typeof p.voucher.rate === 'number' ? { rate: p.voucher.rate } : {}), ...(typeof p.voucher.maxAmount === 'number' ? { maxAmount: p.voucher.maxAmount } : {}), ...(typeof p.voucher.minSpend === 'number' ? { minSpend: p.voucher.minSpend } : {}) } } : {}), ...(typeof p.memberId === 'string' && p.memberId.trim() ? { memberId: p.memberId.trim() } : {}), ...(typeof p.customer === 'string' && p.customer.trim() ? { customer: p.customer.trim() } : {}), ...(typeof p.serviceDate === 'string' && p.serviceDate.trim() ? { serviceDate: p.serviceDate.trim() } : {}), ...(typeof p.serviceTime === 'string' && p.serviceTime.trim() ? { serviceTime: p.serviceTime.trim() } : {}), ...(typeof p.technician === 'string' && p.technician.trim() ? { technician: p.technician.trim() } : {}), ...(typeof p.dpPercent === 'number' && p.dpPercent > 0 ? { dpPercent: Math.round(p.dpPercent) } : {}), ...(typeof p.deliveryAddress === 'string' && p.deliveryAddress.trim() ? { deliveryAddress: p.deliveryAddress.trim() } : {}), ...(typeof p.deliveryFee === 'number' && p.deliveryFee > 0 ? { deliveryFee: Math.round(p.deliveryFee) } : {}) }; }/** Order tersimpan (load_order) - daftar draft offline dari tr_draftorder. */export default function LoadOrderScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [orders, setOrders] = useState<Saved[]>([]);
  const [filter, setFilter] = useState('Semua');

  const shown = orders.filter((o) => filter === 'Semua' || o.mode === filter);

  const refresh = async () => {
    try {
      await initDb();
      const rows = await all<DraftRow>('SELECT id, payload, createdAt FROM tr_draftorder ORDER BY createdAt DESC');
      const list: Saved[] = [];
      for (const r of rows) {
        try {
          const p = JSON.parse(r.payload) as DraftPayload;
          const s = draftToSaved(r.id, p, r.createdAt);
          if (s) list.push(s);
        } catch {
          /* baris korup - lewati */
        }
      }
      setOrders(list);
    } catch {
      /* DB belum siap - tampilkan kosong */
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Order yang baru disimpan dari kasir/cart: INSERT ke tr_draftorder dulu lalu tampilkan. */ const appliedRef = useRef(''); useEffect(() => { const n = route?.params?.newOrder; if (!n) return; const key = JSON.stringify(n); if (appliedRef.current === key) return; appliedRef.current = key; void (async () => { try { await initDb(); const id = `draft-${Date.now()}`; const now = new Date().toISOString(); let sn = (typeof n.salesNum === 'string' ? n.salesNum.trim() : ''); if (!sn) { try { sn = await nextSalesNum(); } catch { sn = ''; } } const payload = JSON.stringify({ title: n.title, mode: n.mode, ...(n.table ? { table: n.table } : {}), items: n.items, ...(typeof n.ongkir === 'number' ? { ongkir: n.ongkir } : {}), ...(typeof n.ongkirCut === 'number' && n.ongkirCut > 0 ? { ongkirCut: Math.round(n.ongkirCut) } : {}), ...(sn ? { salesNum: sn } : {}), ...(n.voucher && n.voucher.code ? { voucher: n.voucher } : {}), ...(n.memberId ? { memberId: n.memberId } : {}), ...(n.customer ? { customer: n.customer } : {}), ...(typeof (n as DraftPayload).serviceDate === 'string' && (n as DraftPayload).serviceDate!.trim() ? { serviceDate: (n as DraftPayload).serviceDate!.trim() } : {}), ...(typeof (n as DraftPayload).serviceTime === 'string' && (n as DraftPayload).serviceTime!.trim() ? { serviceTime: (n as DraftPayload).serviceTime!.trim() } : {}), ...(typeof (n as DraftPayload).technician === 'string' && (n as DraftPayload).technician!.trim() ? { technician: (n as DraftPayload).technician!.trim() } : {}), ...(typeof (n as DraftPayload).dpPercent === 'number' && (n as DraftPayload).dpPercent! > 0 ? { dpPercent: Math.round((n as DraftPayload).dpPercent!) } : {}), ...(typeof (n as DraftPayload).deliveryAddress === 'string' && (n as DraftPayload).deliveryAddress!.trim() ? { deliveryAddress: (n as DraftPayload).deliveryAddress!.trim() } : {}), ...(typeof (n as DraftPayload).deliveryFee === 'number' && (n as DraftPayload).deliveryFee! > 0 ? { deliveryFee: Math.round((n as DraftPayload).deliveryFee!) } : {}), total: sumItems(n.items) + (n.ongkir ?? 0) - (n.ongkirCut ?? 0), ts: Date.now() }); if (sn) { try { const esc = String(sn).replace(/[\\%_]/g, (c) => `\\${c}`); await run("DELETE FROM tr_draftorder WHERE payload LIKE ? ESCAPE '\\'", [`%${esc}%`]); } catch { /* abaikan: kartu lama bertahan */ } } await run('INSERT INTO tr_draftorder (id, payload, createdAt, updatedAt, syncDate) VALUES (?, ?, ?, ?, NULL)', [id, payload, now, now]); if (n.table) { try { await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE TRIM(tableNo) = ?', ['terisi', String(n.table).trim()]); try { enqueueSync('other', { op: 'table-occupy', table: n.table, at: now }); } catch { /* abaikan */ } } catch { /* abaikan: status meja tetap ikut draft */ } } } catch { /* abaikan gagal tulis */ } await refresh(); })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.newOrder]); /** Muat order ke kasir - sekali ketuk langsung buka kasir
   * (tanpa dialog konfirmasi: Alert.alert no-op di web sehingga tombol mati,
   * dan di HP butuh dua ketukan). */
  const muat = (o: Saved) => {
    navigation?.navigate('Cashier', {
      loadItems: o.items,
      ...(o.table ? { table: o.table } : {}),
      mode: MODE_TO_CASHIER[o.mode] ?? 'DINE IN',
      ...(o.ongkir ? { ongkir: o.ongkir } : {}),
      ...(o.ongkirCut ? { ongkirCut: o.ongkirCut } : {}),
      ...(o.salesNum ? { salesNum: o.salesNum } : {}),
      // Rantai draft utuh (G4): voucher/member/pelanggan ikut kembali ke kasir.
      ...(o.voucher ? { voucher: o.voucher } : {}),
      ...(o.memberId ? { memberId: o.memberId } : {}),
      ...(o.customer ? { customer: o.customer } : {}),
      ...(o.serviceDate ? { serviceDate: o.serviceDate } : {}),
      ...(o.serviceTime ? { serviceTime: o.serviceTime } : {}),
      ...(o.technician ? { technician: o.technician } : {}),
      ...(o.dpPercent ? { dpPercent: o.dpPercent } : {}),
      ...(o.deliveryAddress ? { deliveryAddress: o.deliveryAddress } : {}),
      ...(o.deliveryFee ? { deliveryFee: o.deliveryFee } : {}),
    });
  };

  const hapus = async (id: string) => {
    setOrders((l) => l.filter((x) => x.id !== id));
    try {
      await run('DELETE FROM tr_draftorder WHERE id = ?', [id]);
      await refresh();
    } catch {
      /* hapus optimistis sudah tampil */
    }
  };

  return (
    <View style={styles.root}><ScreenHeader title={t('loadOrderTitle')} onBack={() => navigation?.goBack()} /><ScrollView style={styles.list} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <Text style={styles.hint}>{t('loadOrderHint')}</Text>
      <Text style={styles.sec}>{t('loadOrderSec')}</Text>
      <Text style={styles.hint}>{t('loadOrderHint')}</Text>
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipOn]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipT, filter === f && styles.chipTOn]}>{f === 'Semua' ? t('all') : f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {shown.length === 0 && (
        <View style={styles.emptyWrap}>
          <Image
            source={require('../../../assets/images/empty_order.webp')}
            style={styles.emptyImg}
            resizeMode="contain"
          />
          <Text style={styles.empty}>{t('emptyLoadOrder')}</Text>
        </View>
      )}
      {/* Grid 2 kolom di tablet agar daftar draft memakai lebar landscape. */}
      <View style={[isTablet && styles.grid]}>
      {shown.map((o) => (
        <View key={o.id} style={[styles.card, isTablet && styles.cardWide]}>
          <View style={styles.badge}><Text style={styles.badgeT}>{o.badge}</Text></View>
          <View style={styles.info}>
            <Text style={styles.title}>{o.salesNum ? `${o.salesNum} · ${o.title}` : o.title}</Text>
            <Text style={styles.detail}>{o.salesNum ? `${o.salesNum} · ${o.mode} · ${o.detail}` : `${o.mode} · ${o.detail}`}</Text>
          </View>
          <AppButton size="sm" title={t('loadAction')} onPress={() => muat(o)} fullWidth={false} style={[styles.load, { marginTop: 0 }, isTablet && styles.loadBig]} textStyle={styles.loadT} />
          <TouchableOpacity onPress={() => void hapus(o.id)} style={isTablet && styles.delTouch}>
            <Text style={[styles.del, isTablet && styles.delBig]}>{t('delete')}</Text>
          </TouchableOpacity>
        </View>
      ))}
      </View>
      <AppButton size="md" title={t('newTx')} onPress={() => navigation?.navigate('Cashier')} style={[styles.primary, { marginTop: 16, backgroundColor: colors.navy }]} textStyle={styles.primaryT} />
    </ScrollView>
  </View> );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 }, body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 12, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  emptyWrap: { alignItems: 'center', paddingVertical: 24 },
  emptyImg: { width: 120, height: 120 },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, backgroundColor: colors.card, borderRadius: 10, padding: 14, marginTop: 8, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  /* Grid tablet: kartu draft 2 kolom berdampingan (phone tetap 1 kolom). */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cardWide: { flexBasis: '48%', flexGrow: 1, minWidth: 0, marginTop: 0 },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paleBlue, alignItems: 'center', justifyContent: 'center' },
  badgeT: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy },
  info: { flex: 1 },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  detail: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  load: { backgroundColor: colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  loadT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  del: { fontFamily: fonts.semibold, fontSize: 12, color: colors.faint },
  /* Varian tablet: tombol Muat min 48px, Hapus diberi area sentuh padding 12. */
  loadBig: { minHeight: 48, justifyContent: 'center' },
  delTouch: { padding: 12, justifyContent: 'center' },
  delBig: { fontSize: 13 },
  primary: { backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },});
