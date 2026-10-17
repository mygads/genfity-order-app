import React, { useEffect, useMemo, useRef, useState } from 'react';import { Image, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg, wideCenterSm } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import { useLang } from '../../lib/i18n';import { ApiPath } from '../../config/server';import { apiFetch, getApiMode, unwrap } from '../../lib/apiSource';import { QRIS_ACQUIRERS } from '../../lib/master';import { recordSale,

type SaleInput, type SaleItemIn } from '../../lib/payments';import { nextSalesNum, saveSale, saleHeadExists, appendGroupPayment } from '../../lib/sales';type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;};type Props = {
  navigation?: Nav;
  route?: { params?: { total?: number; orderNo?: string; salesNum?: string; splitGroup?: boolean; orderTotal?: number; splits?: { method?: string; amount?: number }[]; items?: SaleItemIn[]; discount?: number; voucherCode?: string; service?: number; tax?: number; feeESB?: number; rounding?: number; mode?: string; table?: string; ongkir?: number; customer?: string; memberId?: string; };
};};const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;};/** * Matriks QR dekoratif deterministik dari nominal - pola finder 3 sudut ala QR. * Bukan payload QRIS asli (payload asli butuh merchant ID dari backend). */function FauxQr({ seed }: { seed: number }) { const N = 21; const cells: boolean[] = []; for (let r = 0; r < N; r++) { for (let c = 0; c < N; c++) { const inFinder = (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7); if (inFinder) { const lr = r >= N - 7 ? r - (N - 7) : r; const lc = c >= N - 7 ? c - (N - 7) : c; cells.push(lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4)); } else { cells.push((r * 31 + c * 17 + seed * 13) % 7 < 3); } } } return (<View style={styles.qrMatrix}>{cells.map((on, i) => (<View key={i} style={[styles.qrCell, on && styles.qrCellOn]} /> ))}</View> );}export default function QrisScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const totalParam = route?.params?.total; const hasTotal = typeof totalParam === 'number' && Number.isFinite(totalParam) && totalParam > 0; const total = hasTotal ? Math.round(totalParam) : 0;
  const items = route?.params?.items; const discount = route?.params?.discount ?? 0; const voucherCode = route?.params?.voucherCode; const orderMode = route?.params?.mode; const tableNo = route?.params?.table; const ongkir = route?.params?.ongkir ?? 0; const customerName = route?.params?.customer; const memberId = route?.params?.memberId; const serviceParam = Math.max(0, Math.round(Number(route?.params?.service) || 0)); const taxParam = Math.max(0, Math.round(Number(route?.params?.tax) || 0)); const feeESBParam = Math.max(0, Math.round(Number(route?.params?.feeESB) || 0)); const roundingParam = Math.round(Number(route?.params?.rounding) || 0); const [seconds, setSeconds] = useState(5 * 60);
  const [status, setStatus] = useState<'waiting' | 'checking' | 'paid' | 'expired'>('waiting');
  const [confirmExit, setConfirmExit] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  /** Mode sumber data: 'local' (tanpa server) = mode uji berlabel. */
  const apiMode = getApiMode();

  const pollRef = useRef(0); /** Kode referensi mock - di app nyata dari backend saat generate QR. */
  const refCode = useMemo(() => {
    const n = Math.abs(Math.floor(total * 7 + 123456)) % 1000000;
    return `QRIS-${String(n).padStart(6, '0')}`;
  }, [total]);
  // WIRE REA-17: label acquirer deterministik dari QRIS_ACQUIRERS + key i18n
  // qris_acq_* (mock FauxQr tetap dipakai - hanya label yang dilengkapi).
  const acq = QRIS_ACQUIRERS[Math.abs(Math.floor(total)) % QRIS_ACQUIRERS.length] ?? 'qrisesb';
  const acqKey = `qris_acq_${acq}`;
  let acqLabel = 'QRIS';
  try { const s = t(acqKey); if (s && s !== acqKey) acqLabel = s; } catch { /* fallback QRIS */ }

  useEffect(() => {
    if (status === 'paid') return;
    const t = setTimeout(() => {
      if (seconds <= 1) {
        setSeconds(0);
        setStatus('expired');
      } else {
        setSeconds(seconds - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [seconds, status]);

  // Cek status  tiap 10 dtk saat menunggu (backend asli / simulasi dummy).
  useEffect(() => {
    if (status !== 'waiting') return;
    const t = setTimeout(() => {
      void doCheck();
    }, 10000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, seconds]);

  /** Selesaikan pembayaran: satu nomor TRX untuk DB + Success (sekali saja).
   * Nomor + kaki split terusan dari Pay dipakai ulang (sisa QRIS = kaki
   * terakhir SATU bill utuh); hanya bila tak ada terusan baru terbitkan nomor. */
  const settlePaid = async () => {
    // T5: QRIS tampil dulu; persist + struk/bukti hanya setelah bayar sukses.
    const p = route?.params ?? {};
    const orderNo = (p.salesNum ?? '').trim() || (await nextSalesNum());
    const fwdSplits = (p.splits ?? [])
      .map((s) => ({ method: String(s?.method ?? 'split'), amount: Math.max(0, Math.round(Number(s?.amount) || 0)) }))
      .filter((s) => s.amount > 0);
    const paidBefore = fwdSplits.reduce((s, x) => s + x.amount, 0);
    const fullTotal = paidBefore + total;
    // Split grup (SplitBill via Pay): kunjungan QRIS ikut SATU salesNum.
    // Pertama = saveSale penuh (grand = total order); berikut = append kaki
    // (tanpa stok/voucher/dapur ganda). Struk = total penuh + splitPaid.
    const groupNo = p.splitGroup === true && (p.salesNum ?? '').trim()
      && Math.max(0, Math.round(Number(p.orderTotal) || 0)) > 0
      ? (p.salesNum ?? '').trim() : '';
    if (groupNo) {
      const orderTotalFull = Math.max(0, Math.round(Number(p.orderTotal) || 0));
      const visitPay = [...fwdSplits, { method: 'qris', amount: total }];
      try {
        if (await saleHeadExists(groupNo)) {
          await appendGroupPayment(groupNo, { payments: visitPay, method: 'qris', change: 0 });
        } else {
          const gInput: SaleInput = { method: 'qris', salesNum: groupNo, grandTotal: orderTotalFull, discountTotal: discount, ...(serviceParam > 0 ? { serviceTotal: serviceParam } : {}), ...(taxParam > 0 ? { vatTotal: taxParam } : {}), ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}), ...(roundingParam !== 0 ? { rounding: roundingParam } : {}), items, payments: visitPay, ...(voucherCode ? { voucherCode } : {}), ...(memberId ? { memberId } : {}), ...(tableNo ? { tableId: tableNo } : {}), ...(orderMode ? { mode: orderMode } : {}), ...(ongkir > 0 ? { ongkir } : {}), ...(customerName ? { customer: customerName } : {}), };
          recordSale(gInput);
          try { await saveSale(gInput); } catch { /* DB gagal - kasir tetap jalan */ }
        }
      } catch { /* DB gagal - kasir tetap jalan */ }
      navigation?.navigate('Success', { total: orderTotalFull, method: 'qris', orderNo: groupNo, items, discount, splitPaid: { amount: fullTotal, method: 'qris' }, ...(voucherCode ? { voucherCode } : {}), ...(memberId ? { memberId } : {}), ...(serviceParam > 0 ? { service: serviceParam } : {}), ...(taxParam > 0 ? { tax: taxParam } : {}), ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}), ...(roundingParam !== 0 ? { rounding: roundingParam } : {}), ...(ongkir > 0 ? { ongkir } : {}), ...(orderMode ? { mode: orderMode } : {}), ...(tableNo ? { table: tableNo } : {}), ...(customerName ? { customer: customerName } : {}) });
      return;
    }
    const input: SaleInput = { method: 'qris', salesNum: orderNo, grandTotal: fullTotal, discountTotal: discount, ...(serviceParam > 0 ? { serviceTotal: serviceParam } : {}), ...(taxParam > 0 ? { vatTotal: taxParam } : {}), ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}), ...(roundingParam !== 0 ? { rounding: roundingParam } : {}), items, payments: [...fwdSplits, { method: 'qris', amount: total }], ...(voucherCode ? { voucherCode } : {}), ...(memberId ? { memberId } : {}), ...(tableNo ? { tableId: tableNo } : {}), ...(orderMode ? { mode: orderMode } : {}), ...(ongkir > 0 ? { ongkir } : {}), ...(customerName ? { customer: customerName } : {}), }; recordSale(input); try { await saveSale(input); } catch { /* DB gagal - kasir tetap jalan */ } navigation?.navigate('Success', { total: fullTotal, method: 'qris', orderNo, items, discount, ...(voucherCode ? { voucherCode } : {}), ...(memberId ? { memberId } : {}), ...(serviceParam > 0 ? { service: serviceParam } : {}), ...(taxParam > 0 ? { tax: taxParam } : {}), ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}), ...(roundingParam !== 0 ? { rounding: roundingParam } : {}), ...(ongkir > 0 ? { ongkir } : {}), ...(orderMode ? { mode: orderMode } : {}), ...(tableNo ? { table: tableNo } : {}), ...(customerName ? { customer: customerName } : {}), }); }; /** * Cek status QRIS per mode sumber data: * - Real Mode: status PAID wajib dari backend (order/view), tanpa
   *   simulasi; respons dummy (offline) = tetap menunggu, bukan lunas. * - Local Mode (tanpa server): simulasi lunas setelah N poll SEBAGAI
   *   "mode uji" yang diberi label jelas ke user (qris_test_mode). * - Dummy Mode eksplisit (screenshot): perilaku lama (simulasi realistis,
   *   lunas pada cek ke-3 ≈ ±30 dtk). * Dipakai tombol manual + polling otomatis. */ const doCheck = async () => { if (status !== 'waiting') return;
    setStatus('checking'); pollRef.current += 1; setPollCount(pollRef.current); const mode = getApiMode(); let paid = false; try {
      if (mode === 'real') {
        const r = await apiFetch(ApiPath.pushOrderView, { body: { refCode, total } });
        if (!r.fromDummy) {
          const { data } = unwrap<Record<string, unknown>>(r.data); paid = String(data.status ?? '').toUpperCase() === 'PAID';
        } else {
          paid = false;
        }
      } else {
        // Local (mode uji berlabel) + Dummy eksplisit: simulasi lunas.
        paid = pollRef.current >= 3;
      }
    } catch {
    paid = false; } if (paid) {
      setStatus('paid');
      void settlePaid(); } else { setStatus('waiting'); }
  };

  const statusChip =
    status === 'paid' ? t('qris_paid') : status === 'expired' ? t('qris_expired') : status === 'checking' ? t('qris_checking') : t('qris_wait');

  // Nominal wajib dari Pay (route.params.total) — tanpa params tampilkan
  // empty-state jujur, bukan Rp101,2rb + QR fiktif.
  if (!hasTotal) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={t('qris_title')} onBack={() => navigation?.goBack()} />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{t('qris_empty_total')}</Text>
          <Text style={styles.emptySub}>{t('qris_empty_total_sub')}</Text>
          <TouchableOpacity style={[styles.checkBtn, styles.emptyBtn]} onPress={() => navigation?.goBack()}>
            <Text style={styles.checkBtnText}>‹ {t('c_back')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title={t('qris_title')} onBack={() => (seconds > 0 && status !== 'expired' ? setConfirmExit(true) : navigation?.goBack())} right={<Text style={styles.headRight}>{statusChip}</Text>} />

      {confirmExit && (
        <View style={[styles.exitBar, isTablet && wideCenterSm]}>
          <Text style={styles.exitText}>{t('qris_exit')}</Text>
          <View style={styles.exitRow}>
            <TouchableOpacity style={[styles.exitKeep, isTablet && styles.exitKeepTablet]} onPress={() => setConfirmExit(false)}>
              <Text style={styles.exitKeepText}>{t('qris_stay')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.exitYes, isTablet && styles.exitYesTablet]} onPress={() => navigation?.goBack()}>
              <Text style={styles.exitYesText}>{t('qris_exit_yes')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={[styles.body, isTablet && styles.bodyTablet]}>
        <View style={styles.mainCol}>
          <Text style={styles.totalLabel}>{t('qris_total')}</Text>
          <Text style={[styles.totalValue, isTablet && styles.totalValueTablet]}>{rp(total)}</Text>
          <Text style={styles.refCode}>{refCode} - {t('qris_valid')}</Text>
          <Text style={styles.refCode}>{acqLabel}</Text>
          {apiMode === 'local' && (
            <Text style={styles.testBadge}>{t('qris_test_mode')}</Text>
          )}

          <View style={styles.qrBox}>
            <Image
              source={require('../../../assets/images/payment_qris.webp')}
              style={styles.qrLogo}
              resizeMode="contain"
            />
            <View style={[styles.qrPlaceholder, isTablet && styles.qrPlaceholderTablet]}>
              <FauxQr seed={total} />

              <Text style={styles.qrSub}>{t('qris_scan')}</Text>
            </View>
          </View>

          <View style={[styles.timerBadge, seconds < 60 && styles.timerBadgeUrgent]}>
            <Text style={[styles.timerText, seconds < 60 && styles.timerTextUrgent]}>
               {status === 'expired' ? t('qris_expired') : t('qris_left').replace('{t}', fmtTime(seconds))}
            </Text>
          </View>
          <Text style={styles.hint}>
            {status === 'expired'
              ? t('qris_expired_hint')
              : status === 'checking'
                ? t('qris_checking_hint')
                : t('qris_wait_hint')}
          </Text>
          <Text style={styles.txnMeta}>
            {t('qris_meta').replace('{t}', rp(total)).replace('{c}', String(pollCount))}
          </Text>
          <Text style={styles.steps}>{t('qris_steps')}</Text>
        </View>
        {isTablet && (
          <View style={styles.sideCol}>
            <Text style={styles.sideTitle}>{t('qris_summary')}</Text>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>{t('qris_nominal')}</Text>
              <Text style={styles.sideValue}>{rp(total)}</Text>
            </View>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>{t('qris_ref')}</Text>
              <Text style={styles.sideValue}>{refCode}</Text>
            </View>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>{t('qris_method')}</Text>
              <Text style={styles.sideValue}>{acqLabel}</Text>
            </View>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>{t('qris_status')}</Text>
              <Text style={styles.sideValue}>{statusChip}</Text>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.footer, isTablet && wideCenterSm]}>

        {status === 'expired' ? (
          <TouchableOpacity
            style={[styles.checkBtn, isTablet && styles.checkBtnTablet]}
            onPress={() => {
              setSeconds(5 * 60);
              setStatus('waiting');
            }}>
            <Text style={styles.checkBtnText}>{t('qris_new')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.checkBtn, status === 'checking' && styles.checkBtnDisabled, isTablet && styles.checkBtnTablet]}
            disabled={status === 'checking'}
            onPress={() => void doCheck()}>
            <Text style={styles.checkBtnText}>
              {status === 'checking' ? t('qris_checking') : t('qris_check')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  /** Empty-state jujur bila QRIS dibuka tanpa total dari Pay. */
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, textAlign: 'center' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  emptyBtn: { flex: 0, alignSelf: 'stretch' },
  headRight: {
     color: colors.white, fontFamily: fonts.semibold, fontSize: 13, textAlign: 'right' },

  body: { flex: 1, alignItems: 'center', padding: 20 },
  bodyTablet: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 16, ...wideCenterLg },
  mainCol: { flex: 1, alignItems: 'center', maxWidth: 420 },
  sideCol: { width: 260, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 14 },
  sideTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  sideRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  sideLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  sideValue: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
  totalLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  totalValue: { fontFamily: fonts.bold, fontSize: 30, color: colors.navy, marginTop: 2 },
  // Tablet: nominal besar proporsional panel + QR tidak raksasa (matriks tetap).
  totalValueTablet: { fontSize: 36 },
  refCode: { fontFamily: fonts.medium, fontSize: 12, color: colors.faint, marginTop: 4 },
  /** Label mode uji (Local Mode): simulasi lunas, bukan pembayaran nyata. */
  testBadge: { fontFamily: fonts.semibold, fontSize: 12, color: colors.orange, backgroundColor: colors.paleOrange, marginTop: 6, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  qrBox: {
    marginTop: 18,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 20,
    alignItems: 'center',
  },
  qrLogo: { width: 96, height: 28, marginBottom: 12 },
  qrPlaceholder: {
    width: 230,
    minHeight: 230,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.navy,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  padding: 10, },
  // Tablet: QR proporsional ruang (tidak raksasa, matriks tetap 189).
  qrPlaceholderTablet: { width: 280, minHeight: 280 },
  qrMatrix: {  width: 189, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.white },
  qrCell: {  width: 9, height: 9 },
  qrCellOn: { backgroundColor: colors.text },

  qrSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, marginTop: 6, textAlign: 'center' },
  timerBadge: {
    marginTop: 16,
    backgroundColor: colors.navy,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  timerBadgeUrgent: { backgroundColor: colors.red },
  timerText: { fontFamily: fonts.bold, fontSize: 22, color: colors.white },
  timerTextUrgent: { color: colors.white },
  hint: {
    marginTop: 12,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  txnMeta: { marginTop: 8, fontFamily: fonts.regular, fontSize: 12, color: colors.muted, textAlign: 'center' },
  steps: { marginTop: 6, fontFamily: fonts.medium, fontSize: 12, color: colors.navy, textAlign: 'center' },
  exitBar: { backgroundColor: colors.paleRed, borderBottomWidth: 1, borderBottomColor: colors.red, padding: 12 },
  exitText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red, textAlign: 'center' },
  exitRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  exitKeep: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  // Tablet: tombol konfirmasi penuhi target sentuh 48px.
  exitKeepTablet: { minHeight: 48, justifyContent: 'center' },
  exitKeepText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  exitYes: { flex: 1, backgroundColor: colors.red, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  exitYesTablet: { minHeight: 48, justifyContent: 'center' },
  exitYesText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  footer: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line },

  checkBtn: {
    flex: 2,
    backgroundColor: colors.orange,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  // Tablet: tombol cek status penuhi target sentuh 48px.
  checkBtnTablet: { minHeight: 48 },
  checkBtnDisabled: { opacity: 0.5 },
  checkBtnText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },});