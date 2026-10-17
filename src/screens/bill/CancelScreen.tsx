import { useEffect, useState } from 'react';import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import { ApiPath } from '../../config/server';import { apiFetch } from '../../lib/apiSource';import { enqueueOutbox, enqueueSync } from '../../lib/sync';import { attemptsLeft, authorizeSupervisor } from '../../lib/supervisor';import { initDb, query } from '../../lib/db';import { useLang } from '../../lib/i18n';import { getSession } from '../../session';import { requireAccess } from '../../lib/access';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav; route?: { params?: { orderId?: string; table?: string; cashier?: string; total?: number } } };/** Mock hanya referensi tipe — tak pernah ditampilkan; layar memakai baris live tr_salesmenu. */const ITEMS = [
  { id: 'c1', name: 'Sudirman Coffee', price: 12900, qty: 2 },
  { id: 'c2', name: 'Lele goreng kremes', price: 15000, qty: 1 },
  { id: 'c3', name: 'Es Teh Manis', price: 8000, qty: 2 },];type CancelItem = { id: string; name: string; price: number; qty: number };interface SaleMenuRow { id: string; menuId: string | null; menuName: string | null; qty: number | null; price: number | null; note: string | null; }/** Item live dari tr_salesmenu bila orderId cocok; [] bila DB kosong agar empty-state dipakai. Split fisik antar salesNum bukan urusan layar ini (milik penulis sales.ts). */async function loadSaleItems(salesNum: string): Promise<CancelItem[]> { try { await initDb(); const rows = await query<SaleMenuRow>( 'SELECT id, menuId, menuName, qty, price, note FROM tr_salesmenu WHERE salesNum = ? ORDER BY rowid', [salesNum], ); const seen = new Map<string, CancelItem>(); for (const r of rows) { const qty = Math.round(Number(r.qty) || 0); if (qty <= 0) continue; const id = String(r.menuId || r.id); const cur = seen.get(id); if (cur) { cur.qty += qty; } else { seen.set(id, { id, name: r.menuName ?? '-', price: Math.round(Number(r.price) || 0), qty }); } } return [...seen.values()]; } catch { return []; }} /** Mock hanya referensi tipe — tak pernah ditampilkan (render memakai array kosong). */ const SPLITS = [
  { id: 's1', label: 'Split #1 - QoQi', amount: 41000, paid: true },
  { id: 's2', label: 'Split #2 - Bimo', amount: 32500, paid: false },
  { id: 's3', label: 'Split #3 - Sinta', amount: 12900, paid: false },];/** * Simpan void (kontrak §5.1.1 action-flag): catat ke outbox tr_saleshead + antrean sync agar aman offline, * coba kirim POST order/finish {action:'void', no, reason} langsung bila online. */async function persistVoid( orderId: string, voidLines: { id: string; qty: number }[], reason: string,): Promise<void> { try { await enqueueOutbox('tr_saleshead', orderId, 'update'); } catch { /* abaikan */ } try { enqueueSync('order', { action: 'void', salesNum: orderId, no: orderId, voidLines, reason }); } catch { /* abaikan */ } try { await apiFetch(ApiPath.pushOrderFinish, { body: { action: 'void', no: orderId, salesNum: orderId, voidLines, reason } }); } catch { /* offline - terkirim via push berikutnya */ }}export default function CancelScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const orderId = (route?.params?.orderId ?? '').trim();
  const tableNo = route?.params?.table ?? '';
  const cashier = route?.params?.cashier ?? '';
  /** Total resmi pemanggil; 0 bila tak ada (mock 86400 tak lagi dipakai). */
  const paramTotal = Math.max(0, Math.round(Number(route?.params?.total) || 0));
  /** Live-only: mulai kosong (tanpa mock); DB kosong = empty-state, bukan fallback mock. */ const [items, setItems] = useState<CancelItem[]>([]); const [voidQty, setVoidQty] = useState<Record<string, number>>({}); const [loaded, setLoaded] = useState(false); /** Muat baris live tr_salesmenu; kosong/tanpa orderId = tetap [] + tandai loaded. */ useEffect(() => { let alive = true; if (!orderId) { setItems([]); setVoidQty({}); setLoaded(true); return () => { alive = false; }; } void loadSaleItems(orderId).then((rows) => { if (!alive) return; setItems(rows); const zero: Record<string, number> = {}; for (const r of rows) zero[r.id] = 0; setVoidQty(zero); setLoaded(true); }); return () => { alive = false; }; }, [orderId]);
  const REASONS = [t('cx_reason_1'), t('cx_reason_2'), t('cx_reason_3'), t('cx_reason_4')];
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [authMsg, setAuthMsg] = useState(''); const [confirming, setConfirming] = useState(false); const [done, setDone] = useState(false);

  const [voidSplits, setVoidSplits] = useState<string[]>([]); const toggleSplit = (id: string) =>
    setVoidSplits((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const step = (id: string, delta: number, max: number) => setVoidQty((q) => { const next = Math.min(max, Math.max(0, (q[id] ?? 0) + delta)); return { ...q, [id]: next }; }); const picked = items.filter((i) => (voidQty[i.id] ?? 0) > 0); const voidTotal = picked.reduce((s, i) => s + i.price * (voidQty[i.id] ?? 0), 0);
  /** Total live (jumlah item) bila pemanggil tak mengirim total; tanpa mock. */
  const liveTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const orderTotal = paramTotal > 0 ? paramTotal : liveTotal;
  const remain = orderTotal - voidTotal;
  /** DB nol-baris / tanpa orderId = empty-state (bukan ITEMS/SPLITS/TRX-047 mock). */
  const isEmptyOrder = loaded && (items.length === 0 || !orderId);

  const canConfirm = picked.length > 0 && pin.replace(/\D/g, '').length === 6 && !confirming; /** * Konfirmasi void: otorisasi supervisor 6 digit via server (fail-closed * saat offline), bukan PIN lokal; lalu simpan via outbox + antrean sync. */ const confirm = () => {
   if (!canConfirm) return; setConfirming(true); setAuthMsg(''); void requireAccess(getSession()?.userId || getSession()?.username || '', 'order.cancel').then((gate) => {
        // Gate RBAC order.cancel: deny = eskalasi ke PIN supervisor di bawah
        // (bukan hard block); fail-open (allow/db-unready) lanjut tanpa catatan.
        if (!gate.ok) setAuthMsg(`Akses ditolak / Access denied — perlu PIN supervisor (${gate.reason})`);
        return authorizeSupervisor(pin); }).then((res) => { if (!res.ok) {
        // Terkunci sementara: pesan sudah lokal via kamus (sup_locked + detik).
        setAuthMsg(res.code === 'locked' ? res.message : `${res.message} (${attemptsLeft()} ${t('cx_attempts')})`); setConfirming(false); return;
   } const lines = picked.map((i) => ({ id: i.id, qty: voidQty[i.id] ?? 0 })); void persistVoid(orderId, lines, reason).finally(() => { setConfirming(false); setDone(true);
 }); }); };

  /** Empty-state: DB nol-baris / tanpa orderId — tanpa ITEMS/SPLITS/TRX-047 mock.
   * Teks netral ID/EN (tanpa kunci i18n baru), gaya teks empty yang sudah ada. */
  if (!loaded || isEmptyOrder) { return (
    <View style={styles.root}><ScreenHeader title={t('cx_title')} sub={orderId ? `Order ${orderId}` : undefined} onBack={() => navigation?.goBack?.()} /><ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>{!loaded ? 'Memuat... / Loading...' : 'Order tidak ditemukan / Order not found'}</Text>
        {loaded && orderId ? (<Text style={styles.meta}>Order {orderId} tidak ada di database lokal</Text>) : null}
      </View>
    </ScrollView>
  </View> ); }

  /** Cetak rincian void ke struk dengan data order asal (id/meja/kasir/total). */ const printVoid = () => { navigation?.navigate('Receipt', { no: orderId, table: tableNo, cashier, total: voidTotal, voidLines: picked.map((i) => ({ name: i.name, qty: voidQty[i.id] ?? 0, price: i.price })), reason, }); }; return (
    <View style={styles.root}><ScreenHeader title={t('cx_title')} sub={`Order ${orderId} - ${tableNo} - ${cashier}`} onBack={() => navigation?.goBack?.()} /><ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <Text style={styles.meta}>Order {orderId} - {tableNo} - {cashier} - {rp(orderTotal)}</Text>
      <Text style={styles.sec}>{t('cx_title')}</Text>
      <Text style={styles.hint}>{t('cx_pick_hint')}</Text>

      {/* Tablet: dua kolom (kiri item+alasan+input, kanan ringkasan+aksi+split). */}
      <View style={isTablet && styles.cols}>
      <View style={isTablet && styles.colMain}>
      {items.map((i) => { const q = voidQty[i.id] ?? 0; const on = q > 0; return (
        <View key={i.id} style={[styles.item, on && styles.itemOn]}><View style={styles.itemInfo}><Text style={styles.itemName}>{i.qty}x {i.name}</Text><Text style={styles.itemPrice}>{rp(i.price)}</Text></View><View style={styles.stepper}><TouchableOpacity style={[styles.stepBtn, isTablet && styles.stepBtnTablet]} onPress={() => step(i.id, -1, i.qty)} hitSlop={isTablet ? 12 : 8}>
          <Text style={[styles.stepTxt, isTablet && styles.stepTxtTablet]}>-</Text></TouchableOpacity>
          <Text style={styles.stepVal}>{q}</Text><TouchableOpacity style={[styles.stepBtn, isTablet && styles.stepBtnTablet]} onPress={() => step(i.id, 1, i.qty)} hitSlop={isTablet ? 12 : 8}>
          <Text style={[styles.stepTxt, isTablet && styles.stepTxtTablet]}>+</Text>
        </TouchableOpacity>
      </View></View> ); })}

      <Text style={styles.label}>{t('cx_reason')}</Text>
      {REASONS.map((r) => (
        <TouchableOpacity key={r} style={[styles.reason, reason === r && styles.reasonOn]} onPress={() => setReason(r)}>
          <Text style={[styles.reasonT, reason === r && styles.reasonTOn]}>{r}</Text>
        </TouchableOpacity>
      ))}
      <AppInput label={t('c_note_opt')} value={note} onChangeText={setNote} placeholder={t('cx_note_ph')} />
      <AppInput label={t('cx_pin')} value={pin} onChangeText={(txt) => { setPin(txt.replace(/\D/g, '').slice(0, 6)); setAuthMsg(''); }} placeholder={t('cx_pin_ph')} keyboardType="numeric" maxLength={6} secureTextEntry />

      {authMsg ? <Text style={styles.authErr}>{authMsg}</Text> : null}
      </View>
      <View style={isTablet && styles.colSide}>
      <View style={styles.summary}>
        <Text style={styles.sumTitle}>{t('cx_confirm_split')}</Text>
        <Text style={styles.sumLine}>{picked.length} item ({rp(voidTotal)}) {t('cx_to_cancel')}</Text>
        <Text style={styles.sumNote}>{t('cx_stock_back')}</Text>
        <View style={styles.row}><Text style={styles.item2}>Order {orderId} - {tableNo} - {cashier}</Text></View>
        <View style={styles.row}><Text style={styles.item2}>{t('cx_total_before')}</Text><Text style={styles.price}>{rp(orderTotal)}</Text></View>
        <View style={styles.row}><Text style={styles.item2}>{t('cx_voided')}</Text><Text style={styles.disc}>-{rp(voidTotal)}</Text></View>
        <View style={styles.row}><Text style={styles.totalL}>{t('cx_remain')}</Text><Text style={styles.totalV}>{rp(remain)}</Text></View>
        <Text style={styles.sumHint}>{t('cx_to_pay')}</Text>{remain > 0 ? (<TouchableOpacity onPress={() => navigation?.navigate('Pay', { total: remain })}><Text style={styles.link}>{t('cx_remain')} {rp(remain)} ›</Text></TouchableOpacity> ) : null}
      </View>

      <Text style={styles.sec}>{t('cx_cancel_split')}</Text>
      {/* SPLITS mock hanya referensi tipe — tak pernah ditampilkan (empty-state di atas bila DB kosong). */}
      {([] as typeof SPLITS).map((sp) => (
        <TouchableOpacity key={sp.id} style={[styles.item, voidSplits.includes(sp.id) && styles.itemOn]} onPress={() => !sp.paid && toggleSplit(sp.id)} disabled={sp.paid} hitSlop={4}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>{sp.label}</Text>
            <Text style={styles.meta2}>{sp.paid ? t('cx_paid') : rp(sp.amount)}</Text>
          </View>
          {!sp.paid && (<Text style={styles.cancelT}> {voidSplits.includes(sp.id) ? `✓ ${t('cx_voided')}` : t('cx_cancel_word')} </Text> )}</TouchableOpacity>
      ))}

      <View style={styles.actions}>
        <AppButton title={t('c_back')} variant="secondary" onPress={() => navigation?.goBack()} fullWidth={false} size="md" style={styles.actionBtn} />
        <AppButton title={confirming ? '...' : `${t('cx_yes_void')} ›`} variant="danger" disabled={!canConfirm} onPress={confirm} fullWidth={false} size="md" style={styles.actionBtn} />
      </View>
      {done && <Text style={styles.done}>{t('cx_done')}</Text>}{done && (
      <AppButton title={t('cx_void_print')} onPress={printVoid} size="md" /> )}<TouchableOpacity onPress={() => navigation?.navigate('History')}>
        <Text style={styles.link}>{t('cx_history')}</Text>
      </TouchableOpacity>
      </View>
      </View>
    </ScrollView>
  </View> );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12 }, langTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 }, burger: { width: 22, height: 22 }, body: { padding: 16, paddingBottom: 40 },
  meta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  meta2: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 16 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  itemOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  itemInfo: { flex: 1 },

  itemName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  itemPrice: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 }, stepBtn: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', }, stepTxt: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy }, stepVal: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, minWidth: 18, textAlign: 'center' }, label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 14, marginBottom: 6 },
  // Tablet: stepper penuhi target sentuh 48px + dua kolom proporsional.
  stepBtnTablet: { width: 48, height: 48, borderRadius: 12 },
  stepTxtTablet: { fontSize: 18 },
  cols: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  colMain: { flex: 1.2, minWidth: 0 },
  colSide: { flex: 1, minWidth: 0 },
  reason: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.card, marginTop: 6 },
  reasonOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  reasonT: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  reasonTOn: { color: colors.orangeDark },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 14, color: colors.text, },
  authErr: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red, marginTop: 6 }, summary: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.line },
  sumTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  sumLine: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, marginTop: 6 },
  sumNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  sumHint: { fontFamily: fonts.medium, fontSize: 12, color: colors.navy, marginTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  item2: { fontFamily: fonts.regular, fontSize: 13, color: colors.text },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  disc: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  totalL: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  totalV: { fontFamily: fonts.bold, fontSize: 16, color: colors.orangeDark },
  cancelT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, marginTop: 0 },
  primary: { flex: 1, backgroundColor: colors.red, borderRadius: 10, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  done: { fontFamily: fonts.semibold, fontSize: 13, color: colors.greenDark, marginTop: 12 },
  printVoidBtn: { backgroundColor: colors.navy, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 10, }, printVoidTxt: { fontFamily: fonts.bold, fontSize: 14, color: colors.white }, link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark, marginTop: 10 }, emptyWrap: { alignItems: 'center', paddingVertical: 32 }, empty: { textAlign: 'center', marginTop: 12, fontFamily: fonts.regular, fontSize: 14, color: colors.muted },});