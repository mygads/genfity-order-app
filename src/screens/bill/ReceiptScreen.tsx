import { useEffect, useRef, useState } from 'react';import { Modal, ScrollView, StyleSheet, Text, View , useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg, wideCenterSm } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import { useLang } from '../../lib/i18n';import { printReceiptData, openDefaultDrawer, shareReceipt } from '../../lib/print';import { initDb, run } from '../../lib/db';import { isValidEmail, recordReceiptEmail, type SaleItemIn } from '../../lib/payments';import { getSession } from '../../session';import { getTerminal } from '../../config/server';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type VoidLine = { name: string; qty: number; price: number };type Props = { navigation?: Nav; route?: { params?: { no?: string; total?: number; method?: string; mode?: string; cash?: number; change?: number; items?: SaleItemIn[]; discount?: number; service?: number; tax?: number; rounding?: number; feeESB?: number; voucherCode?: string; approvalCode?: string; cardLast4?: string; bank?: string; terminal?: string; memberId?: string; voidLines?: VoidLine[]; reason?: string; table?: string; cashier?: string; customer?: string; ongkir?: number; shopName?: string; shopAddr?: string; footer?: string; autoPrint?: boolean } } };const lineTotal = (it: SaleItemIn): number => it.qty * it.basePrice + (it.modifiers ?? []).reduce((s, m) => s + m.price * it.qty, 0) - (it.discount ?? 0);export default function ReceiptScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); // Tanpa params = nilai kosong yang jujur (bukan TRX/#148/QRIS/Bawa Pulang karangan).
  const no = route?.params?.no ?? '';
  const method = route?.params?.method ?? '';
  const mode = route?.params?.mode ?? '';
  // Label tampil: nilai data 'ESB Order' (dipakai logika fee/mode) tetap, yang tampil jadi nama produk.
  const modeLabel = mode === 'ESB Order' ? 'Genfity Order' : mode;
  const cash = route?.params?.cash ?? 0;
  const change = route?.params?.change ?? 0;
  const isCash = method.toLowerCase().includes('tunai') || method.toLowerCase() === 'cash';
  const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const now = new Date();
  const todayId = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const timeId = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} WIB`;
  // Struk dari data transaksi asli: total terusan adalah sumber kebenaran
  // (payable kasir); subtotal dihitung mundur hanya bila item tak dioper
  // (cetak ulang arsip) - tanpa angka hardcode.
  const cartItems = route?.params?.items;
  const hasItems = !!cartItems && cartItems.length > 0;
  const discount = route?.params?.discount ?? 0;
  const ongkir = route?.params?.ongkir ?? 0;
  // Rincian struk bawaan rantai pay (opsional): tampil bila dikirim pemanggil.
  // Semua baris rincian info-only - total terusan pemanggil adalah kebenaran.
  const service = Math.max(0, Math.round(Number(route?.params?.service) || 0));
  const tax = Math.max(0, Math.round(Number(route?.params?.tax) || 0));
  const rounding = Math.round(Number(route?.params?.rounding) || 0);
  const feeESB = Math.max(0, Math.round(Number(route?.params?.feeESB) || 0));
  const itemsSum = hasItems ? cartItems.reduce((s, it) => s + lineTotal(it), 0) : 0;
  const total = route?.params?.total ?? (itemsSum - discount + ongkir);
  // Mundur tanpa item: kurangi SEMUA komponen info-only agar konsisten
  // (sebelumnya service/rounding/feeESB tak dikurangi → subtotal kebesaran).
  const subtotal  = hasItems ? itemsSum : Math.max(0, total + discount - ongkir - service - rounding - feeESB);

  const cashierLine = [route?.params?.cashier ?? getSession()?.name ?? getSession()?.username ?? '', route?.params?.table ?? route?.params?.customer ?? ''].filter((s) => s && s.trim()).join(' · ');
  // Rincian void dari CancelScreen/History (T8): tampil sebagai seksi struk tersendiri.
  const voidLines = route?.params?.voidLines ?? [];
  const voidReason = route?.params?.reason ?? '';
  const hasVoid = voidLines.length > 0;
  const voidTotal = voidLines.reduce((s, l) => s + l.qty * l.price, 0);
  // Kode voucher + footer custom cabang bila dioper via params (jangan hardcode).
  const voucherCode = route?.params?.voucherCode ?? '';
  const approvalCode = route?.params?.approvalCode ?? '';
  const cardLast4 = route?.params?.cardLast4 ?? '';
  const edcLine = [route?.params?.bank, route?.params?.terminal].filter(Boolean).join(' · ');
  // Nama + alamat gerai dari terminal aktif (bukan hardcode Poris); alamat
  // kosong = baris alamat disembunyikan.
  const shopName = route?.params?.shopName ?? getTerminal().branchName ?? 'Genfity';
  const shopAddr = route?.params?.shopAddr ?? '';
  const customFooter = route?.params?.footer ?? '';
  const [printing, setPrinting] = useState(false);
  /** Cetak nyata: ESC/POS rincian penuh (selaras tampilan kertas) → printer
   * default; sukses = printedCount+1 + dirty. Tunai sukses → tendang laci
   * kas ala POSLite (best-effort). */
  const doPrint = async () => { if (printing) return; setPrinting(true); try { const res = await printReceiptData({ shop: shopName.toUpperCase(), addr: shopAddr, trx: `No: ${no} - ${modeLabel}`, cashier: cashierLine, datetime: `${todayId} ${timeId}`, items: (cartItems ?? []).map((it) => ({ name: it.name, qty: it.qty, price: Math.round(lineTotal(it) / Math.max(1, it.qty)), })), subtotal: Math.round(subtotal), ...(discount > 0 ? { discount: Math.round(discount) } : {}), ...(service > 0 ? { service } : {}), ...(tax > 0 ? { tax } : {}), ...(feeESB > 0 ? { feeESB } : {}), ...(voucherCode ? { voucherCode } : {}), ...(ongkir > 0 ? { ongkir: Math.round(ongkir) } : {}), ...(rounding !== 0 ? { rounding } : {}), total: Math.round(total), method, ...(isCash && cash > 0 ? { paid: Math.round(cash), change: Math.round(change) } : {}), ...(customFooter ? { footer: customFooter } : {}), }); if (res.ok && res.bytes > 0) { try { await initDb(); await run( 'UPDATE tr_saleshead SET printedCount = COALESCE(printedCount, 0) + 1, syncDate = NULL WHERE salesNum = ?', [no], ); } catch { /* abaikan */ } if (isCash) { try { await openDefaultDrawer(); } catch { /* laci opsional */ } } } } finally { setPrinting(false); } };
  /** Cetak otomatis sekali saat dibuka dari tombol Cetak (Success) - pemanggil
   * lain (pratinjau/arsip/void) tetap manual via tombol. */
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (route?.params?.autoPrint === true && !autoPrinted.current) {
      autoPrinted.current = true;
      void doPrint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const paper = (<View style={[styles.paper, isTablet && styles.paperTablet]}>
      <Text style={[styles.shop, isTablet && styles.shopTablet]}>{shopName}</Text>{shopAddr ? <Text style={styles.addr}>{shopAddr}</Text> : null}<Text style={styles.line}>No: {no}    {modeLabel}</Text>
      <Text style={styles.line}>{cashierLine}</Text>
      <Text style={styles.line}>{todayId} · {timeId}</Text>
      <View style={styles.div} />
      {hasItems ? ( cartItems.map((it) => (<View key={it.id}><View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{it.qty}x {it.name}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(lineTotal(it))}</Text></View>{(it.modifiers ?? []).map((m) => (<Text key={m.name} style={styles.note}>    + {m.name} {rp(m.price * it.qty)}</Text> ))}</View> )) ) : null}
      <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('c_subtotal')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(subtotal)}</Text></View>{discount > 0 && (
      <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_discount')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>-{rp(discount)}</Text></View> )}{service > 0 && (
      <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('serviceExcl')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(service)}</Text></View> )}{feeESB > 0 && (
      <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('feeESB')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(feeESB)}</Text></View> )}{tax > 0 && (
      <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('ok_tax')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(tax)}</Text></View> )}{voucherCode ? (
      <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_voucher')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{voucherCode}</Text></View> ) : null}{approvalCode ? (<View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_approval')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{approvalCode}{cardLast4 ? ` ••${cardLast4}` : ''}</Text></View> ) : null}{edcLine ? (<View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_terminal')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{edcLine}</Text></View> ) : null}{ongkir > 0 && (<View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('ongkir')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(ongkir)}</Text></View> )}{rounding !== 0 && (<View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rounding')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(rounding)}</Text></View> )}<View style={styles.div} />
      <View style={styles.row}><Text style={[styles.total, isTablet && styles.totalTablet]}>{t('c_total').toUpperCase()}</Text><Text style={[styles.total, isTablet && styles.totalTablet]}>{rp(total)}</Text></View>
      <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{method}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(total)}</Text></View>{hasVoid && (<><View style={styles.div} /><Text style={styles.voidTitle}>{t('rc_void_title')}</Text>{voidLines.map((l) => (<View key={l.name} style={styles.row}><Text style={styles.voidItem}>{l.qty}x {l.name}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>-{rp(l.qty * l.price)}</Text></View> ))}{voidReason ? <Text style={styles.note}>{t('rc_void_reason')}: {voidReason}</Text> : null}<View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_void_total')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>-{rp(voidTotal)}</Text></View></> )}
      {isCash && cash > 0 ? (
        <>
          <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_cashin')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(cash)}</Text></View>
          <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_change')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(change)}</Text></View>
        </>
      ) : (
        <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_change')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(0)}</Text></View>
      )}
      <Text style={styles.thanks}>{t('rc_thanks')}</Text>{customFooter ? <Text style={styles.footerNote}>{customFooter}</Text> : null}
    </View>
  );

  // Teks bagikan itemized: sama rincinya dengan kertas (item + rincian + total).
  const shareItemLines = hasItems ? cartItems.flatMap((it) => [ `${it.qty}x ${it.name} - ${rp(lineTotal(it))}`, ...(it.modifiers ?? []).map((m) => ` + ${m.name} ${rp(m.price * it.qty)}`), ]) : [];
  const shareText = [ `${shopName} - Struk ${no} - ${mode}`, `${todayId} ${timeId}`, ...shareItemLines, `${t('c_subtotal')}: ${rp(subtotal)}`, ...(discount > 0 ? [`${t('rc_discount')}: -${rp(discount)}`] : []), ...(service > 0 ? [`${t('serviceExcl')}: ${rp(service)}`] : []), ...(feeESB > 0 ? [`${t('feeESB')}: ${rp(feeESB)}`] : []), ...(tax > 0 ? [`${t('ok_tax')}: ${rp(tax)}`] : []), ...(voucherCode ? [`${t('rc_voucher')}: ${voucherCode}`] : []), ...(approvalCode ? [`${t('rc_approval')}: ${approvalCode}${cardLast4 ? ` ••${cardLast4}` : ''}`] : []), ...(ongkir > 0 ? [`${t('ongkir')}: ${rp(ongkir)}`] : []), ...(rounding !== 0 ? [`${t('rounding')}: ${rp(rounding)}`] : []), `${t('c_total').toUpperCase()}: ${rp(total)}`, `${method}: ${rp(total)}`, ...(isCash && cash > 0 ? [`${t('rc_cashin')}: ${rp(cash)}`, `${t('rc_change')}: ${rp(change)}`] : []), ...(hasVoid ? [ `${t('rc_void_title')}:`, ...voidLines.map((l) => `${l.qty}x ${l.name} -${rp(l.qty * l.price)}`), ...(voidReason ? [`${t('rc_void_reason')}: ${voidReason}`] : []), ] : []), ...(customFooter ? [customFooter] : []), ].join('\n');
  const [mailOpen, setMailOpen] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mailMsg, setMailMsg] = useState('');

  const sendMail = () => {
    if (!isValidEmail(mailTo)) {
      setMailMsg(t('hist_mail_bad'));
      return;
    }
    recordReceiptEmail(mailTo, no, total, method);
    setMailMsg(t('hist_mail_queued'));
  };

  const actions = (
    <View style={[styles.actions, isTablet && styles.actionsStack]}>
      <AppButton title={t('c_back')} variant="secondary" onPress={() => navigation?.navigate('Dashboard')} fullWidth={false} size="md" style={[styles.actionBtn, isTablet ? styles.actionCol : styles.actionHalf]} />
      <AppButton title={`🖨 ${printing ? '...' : t('rc_print')}`} variant="secondary" onPress={() => void doPrint()} fullWidth={false} size="md" style={[styles.actionBtn, isTablet ? styles.actionCol : styles.actionHalf]} />
      <AppButton title={`⤴ ${t('rc_share')}`} variant="secondary" onPress={() => { void shareReceipt(shareText); }} fullWidth={false} size="md" style={[styles.actionBtn, isTablet ? styles.actionCol : styles.actionHalf]} />
      <AppButton title={`✉ ${t('ok_email')}`} variant="secondary" onPress={() => { setMailMsg(''); setMailOpen(true); }} fullWidth={false} size="md" style={[styles.actionBtn, isTablet ? styles.actionCol : styles.actionHalf]} />
      <AppButton title={t('rc_new')} onPress={() => navigation?.navigate('Cashier')} fullWidth={false} size="md" style={[styles.actionBtn, isTablet ? styles.actionCol : styles.actionFull]} />
    </View>
  );

  const mailModal = (
    <Modal visible={mailOpen} animationType="fade" transparent>
      <View style={styles.wrap}>
        <View style={[styles.dialog, styles.dialogNarrow]}>
          <Text style={styles.dTitle}>{t('hist_mail_title')}</Text>
          <Text style={styles.dSub}>{t('rc_title')} {no} • {rp(total)}</Text>
          <AppInput
            value={mailTo}
            onChangeText={setMailTo}
            placeholder={t('hist_mail_ph')}
            keyboardType="email-address"
            autoCapitalize="none"
            boxStyle={{ marginTop: 8 }}
          />
          {mailMsg ? <Text style={styles.mailMsg}>{mailMsg}</Text> : null}
          <View style={styles.dBtns}>
            <AppButton title={t('c_close')} variant="secondary" onPress={() => setMailOpen(false)} fullWidth={false} size="md" style={[styles.actionBtn, styles.dBtnFlex]} />
            <AppButton title={t('hist_mail_send')} onPress={sendMail} fullWidth={false} size="md" style={[styles.actionBtn, styles.dBtnFlex]} />
          </View>
        </View>
      </View>
    </Modal>
  );

  if (isTablet) {
    return (
      <View style={styles.root}><ScreenHeader title={t('rc_title')} sub={no} onBack={() => navigation?.goBack()} /><View style={styles.split}>
        <ScrollView style={styles.paperSide} contentContainerStyle={styles.body}>
          {paper}
        </ScrollView>
        <ScrollView style={styles.summarySide} contentContainerStyle={styles.summarySideBody}>
          <Text style={styles.summaryTitle}>{t('rc_summary')}</Text>
          <View style={styles.summaryCard}>
            <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_no')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{no}</Text></View>
            <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_mode')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{modeLabel}</Text></View>
            <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('rc_method')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{method}</Text></View>
            {ongkir > 0 && (<View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('ongkir')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{rp(ongkir)}</Text></View> )}<View style={styles.div} />
            <View style={styles.row}><Text style={[styles.total, isTablet && styles.totalTablet]}>{t('c_total').toUpperCase()}</Text><Text style={[styles.total, isTablet && styles.totalTablet]}>{rp(total)}</Text></View>
          </View>
          <View style={styles.actionsColumn}>{actions}</View>
          </ScrollView>{mailModal}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}><ScreenHeader title={t('rc_title')} sub={no} onBack={() => navigation?.goBack()} /><ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      {paper}
      {actions}
      {mailModal}
    </ScrollView>
  </View> );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1, backgroundColor: colors.bg }, body: { padding: 16, paddingBottom: 40 },
  paper: { backgroundColor: colors.white, borderRadius: 8, padding: 18, borderWidth: 1, borderColor: colors.line },
  // Tablet: kertas struk dibatasi sempit + tengahkan (tidak melar).
  paperTablet: { ...wideCenterSm },
  shop: { fontFamily: fonts.bold, fontSize: 17, color: colors.text, textAlign: 'center' },
  shopTablet: { fontSize: 20 },
  addr: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4 },
  line: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 6 },
  div: { borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginVertical: 10 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, marginTop: 3 },
  // Tablet: skala font struk agar proporsional kolom.
  itemTablet: { fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  total: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 4 },
  totalTablet: { fontSize: 18 },
  voidTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.red, marginTop: 4 }, voidItem: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 3, textDecorationLine: 'line-through' }, thanks: { fontFamily: fonts.bold, fontSize: 13, color: colors.text, textAlign: 'center', marginTop: 12 },
  footerNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  actionsStack: { flexDirection: 'column' },
  actionCol: { width: '100%' },
  actionHalf: { width: '48%', flexGrow: 1, flexShrink: 0 }, actionFull: { width: '100%' }, dBtnFlex: { flex: 1 }, actionBtn: { marginTop: 0 }, split: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg, ...wideCenterLg },
  paperSide: { flex: 1.2 },
  summarySide: { flex: 1, backgroundColor: colors.card, borderLeftWidth: 1, borderLeftColor: colors.line }, summarySideBody: { padding: 20, paddingBottom: 32 },
  summaryTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  summaryCard: { backgroundColor: colors.bg, borderRadius: 10, padding: 14, marginTop: 12 },
  actionsColumn: { marginTop: 16 },
  primary: {  backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white, textAlign: 'center' },
  ghost: {  backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy, textAlign: 'center' },
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogNarrow: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  dTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4 },
  input: {
    borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 11,
    fontFamily: fonts.regular, fontSize: 14, color: colors.text, backgroundColor: colors.white, marginTop: 12,
  },
  mailMsg: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 8 },
  dBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },});