import React, { useEffect, useMemo, useRef, useState } from 'react';import { Image, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg, wideCenterSm } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import { useLang } from '../../lib/i18n';import { appAlert } from '../../lib/appAlert';import { ApiPath } from '../../config/server';import { apiFetch, getApiMode, unwrap } from '../../lib/apiSource';import { QRIS_ACQUIRERS } from '../../lib/master';import { recordSale,

type SaleInput, type SaleItemIn } from '../../lib/payments';import { nextSalesNum, saveSale, saleHeadExists, appendGroupPayment, getOrCreatePayChainId, buildSaleQrPayload } from '../../lib/sales';import { publishDisplayOrder } from '../../lib/display';import { mirrorSettleToServer } from '../../lib/settleMirror';import { customerIdFromLocalKey, parseCustomerId } from '../../lib/memberRef';type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;};type Props = {
  navigation?: Nav;
  route?: { params?: { total?: number; orderNo?: string; salesNum?: string; clientId?: string; splitGroup?: boolean; orderTotal?: number; splits?: { method?: string; amount?: number; memberId?: string; customerId?: number }[]; items?: SaleItemIn[]; discount?: number; voucherCode?: string; service?: number; tax?: number; feeESB?: number; packaging?: number; rounding?: number; mode?: string; table?: string; ongkir?: number; ongkirCut?: number; tip?: number; customer?: string; memberId?: string; customerId?: number; memberPoin?: number; };
};};const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;};/** * Matriks QR dekoratif deterministik dari nominal - pola finder 3 sudut ala QR. * Bukan payload QRIS asli (payload asli butuh merchant ID dari backend). */function FauxQr({ seed }: { seed: number }) { const N = 21; const cells: boolean[] = []; for (let r = 0; r < N; r++) { for (let c = 0; c < N; c++) { const inFinder = (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7); if (inFinder) { const lr = r >= N - 7 ? r - (N - 7) : r; const lc = c >= N - 7 ? c - (N - 7) : c; cells.push(lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4)); } else { cells.push((r * 31 + c * 17 + seed * 13) % 7 < 3); } } } return (<View style={styles.qrMatrix}>{cells.map((on, i) => (<View key={i} style={[styles.qrCell, on && styles.qrCellOn]} /> ))}</View> );}export default function QrisScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const totalParam = route?.params?.total; const hasTotal = typeof totalParam === 'number' && Number.isFinite(totalParam) && totalParam > 0; const total = hasTotal ? Math.round(totalParam) : 0;
  const items = route?.params?.items; const discount = route?.params?.discount ?? 0; const voucherCode = route?.params?.voucherCode; const orderMode = route?.params?.mode; const tableNo = route?.params?.table; const ongkir = route?.params?.ongkir ?? 0; const ongkirCut = Math.max(0, Math.round(Number(route?.params?.ongkirCut) || 0)); const customerName = route?.params?.customer; const memberId = route?.params?.memberId; const customerIdParam = parseCustomerId(route?.params?.customerId); const memberPoinParam = route?.params?.memberPoin == null || !Number.isFinite(Number(route?.params?.memberPoin)) ? null : Math.max(0, Math.round(Number(route?.params?.memberPoin))); const serviceParam = Math.max(0, Math.round(Number(route?.params?.service) || 0)); const taxParam = Math.max(0, Math.round(Number(route?.params?.tax) || 0)); const feeESBParam = Math.max(0, Math.round(Number(route?.params?.feeESB) || 0)); const packagingParam = Math.max(0, Math.round(Number(route?.params?.packaging) || 0)); const roundingParam = Math.round(Number(route?.params?.rounding) || 0); const tipParam = Math.max(0, Math.round(Number(route?.params?.tip) || 0)); const [seconds, setSeconds] = useState(5 * 60);
  const [status, setStatus] = useState<'waiting' | 'checking' | 'paid' | 'expired'>('waiting');
  const [confirmExit, setConfirmExit] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  /** Mode sumber data: 'local' (tanpa server) = mode uji berlabel. */
  const apiMode = getApiMode();

  const pollRef = useRef(0); /** Kode referensi mock - di app nyata dari backend saat generate QR. */
  /** Guard settle-ganda: poll otomatis + tombol manual bisa panggil berbarengan. */
  const settledRef = useRef(false);
  /** C2: QR kadaluarsa = terminal — poll in-flight yang pulang telat dilarang
   *  settle (tanpa ini respons telat menimpa status expired → Success palsu
   *  atas QR basi). Direset hanya oleh tombol Buat-kode-baru. */
  const expiredRef = useRef(false);
  const refCode = useMemo(() => {
    const n = Math.abs(Math.floor(total * 7 + 123456)) % 1000000;
    return `QRIS-${String(n).padStart(6, '0')}`;
  }, [total]);
  // M15: rantai client_id untuk QR (Pay→Qris via params; head bila dibuka dari
  // riwayat; baru diterbitkan bila belum ada). Diselesaikan sekali agar QR yang
  // tampil = kunci yang dipakai settlePaid (QR tak basi).
  const [qrChainId, setQrChainId] = useState((route?.params?.clientId ?? '').trim());
  // P2: resolusi rantai client_id dijaga — gagal = status error + Alert,
  // QR tidak dirender (P9) agar tak ada QR basi/acak.
  const [chainErr, setChainErr] = useState(false);
  useEffect(() => {
    if (qrChainId) return;
    let on = true;
    void (async () => {
      try {
        const sn = (route?.params?.salesNum ?? '').trim();
        // P0-4: rantai dipersist SEBELUM settle (seed/head/stored menang, baru =
        // payment-{order}-uuidv7) agar retry/drain memakai kunci yang SAMA.
        if (on) setQrChainId(await getOrCreatePayChainId(sn));
      } catch {
        if (on) {
          setChainErr(true);
          appAlert(t('pay_issue_fail'));
        }
      }
    })();
    return () => { on = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // M15: QR MEMBAWA payload nyata (client_id rantai + salesNum + total) via
  // buildSaleQrPayload — bukan pola dekoratif dari nominal. salesNum kosong =
  // nomor baru diterbitkan saat settle; korelasi tetap via client_id yang sama
  // dengan yang dibawa Success/Receipt.
  const qrSalesNum = (route?.params?.salesNum ?? '').trim();
  const qrPayload = buildSaleQrPayload(qrChainId, qrSalesNum, total);
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
        expiredRef.current = true;
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
   * terakhir SATU bill utuh); hanya bila tak ada terusan baru terbitkan nomor.
   * APP-PRINTER-SALES (Q7): client_id dipakai ulang dari rantai Pay/head,
   * baru terbitkan bila belum ada — QR tak basi. FauxQr tampil tetap
   * dekoratif; payload QR nyata (buildSaleQrPayload) ikut clientId ini. */
  const settlePaid = async () => {
    if (settledRef.current || expiredRef.current) return;
    settledRef.current = true;
    // T5: QRIS tampil dulu; persist + struk/bukti hanya setelah bayar sukses.
    const p = route?.params ?? {};
    // M10 (cermin PayScreen goSuccess): nomor diterbitkan DI DALAM try; bila
    // gagal (mis. terminal-unbound dari nextSalesNum), guard di-reset agar
    // tombol Cek Status tetap hidup (sebelumnya throw di luar try =
    // settledRef macet-true = retry-mati).
    let orderNo: string;
    try {
      orderNo = (p.salesNum ?? '').trim() || (await nextSalesNum());
    } catch (e) {
      settledRef.current = false;
      if ((e as { code?: string })?.code === 'terminal-unbound') {
        appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
          { text: t('c_cancel'), style: 'cancel' },
          { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
        ]);
      } else {
        appAlert(t('pay_issue_fail'));
      }
      return;
    }
    // APP-PRINTER-SALES (Q7) + P0-4: SATU client_id per sale (seed Pay/QR
    // tampil menang; kunci lama uuidv7 mentah TETAP sah; baru =
    // payment-{order}-uuidv7), dipersist SEBELUM saveSale agar retry/drain
    // satu kunci. getOrCreate hanya melempar bila CSPRNG absen: guard
    // di-reset agar Cek Status tetap hidup.
    let saleClientId: string;
    try {
      saleClientId = await getOrCreatePayChainId(orderNo, (p.clientId ?? '').trim() || qrChainId);
    } catch (e) {
      settledRef.current = false;
      if ((e as { code?: string })?.code === 'terminal-unbound') {
        appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
          { text: t('c_cancel'), style: 'cancel' },
          { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
        ]);
      } else {
        appAlert(t('pay_issue_fail'));
      }
      return;
    }
    // P7/P15: kaki terusan boleh membawa approvalCode/memberId/customerId
    // defensif dari Pay (tipe nav params belum diperluas) — dipertahankan ke
    // visitPay agar atribusi deposit + kode otorisasi EDC tak hilang di
    // kunjungan QRIS. Ronde-3 Q1: customerId GO diteruskan; alias memberId
    // hanya pointer ledger lokal.
    type FwdLeg = { method?: string; amount?: number; approvalCode?: string; memberId?: string; customerId?: number };
    const fwdSplits = ((p.splits ?? []) as FwdLeg[])
      .map((s) => ({ method: String(s?.method ?? 'split'), amount: Math.max(0, Math.round(Number(s?.amount) || 0)), ...(s?.approvalCode ? { approvalCode: String(s.approvalCode) } : {}), ...(parseCustomerId(s?.customerId) != null ? { customerId: parseCustomerId(s?.customerId) as number } : {}) }))
      .filter((s) => s.amount > 0);
    const legMemberId = ((p.splits ?? []) as FwdLeg[])
      .map((s) => String(s?.memberId ?? '').trim())
      .find((v) => v !== '') ?? '';
    const effMemberId = (memberId ?? '').trim() || legMemberId;
    // Ronde-3 Q1: ref GO = params → kaki → kunci lokal (MC{id}).
    const effCustomerId =
      customerIdParam ??
      parseCustomerId(((p.splits ?? []) as FwdLeg[]).map((s) => s?.customerId).find((v) => v != null)) ??
      customerIdFromLocalKey(effMemberId);
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
          await appendGroupPayment(groupNo, { payments: visitPay, method: 'qris', change: 0, clientId: saleClientId, ...(effMemberId ? { memberId: effMemberId } : {}), ...(effCustomerId != null ? { customerId: effCustomerId } : {}) });
        } else {
          const gInput: SaleInput = { method: 'qris', salesNum: groupNo, clientId: saleClientId, grandTotal: orderTotalFull, discountTotal: discount, ...(serviceParam > 0 ? { serviceTotal: serviceParam } : {}), ...(taxParam > 0 ? { vatTotal: taxParam } : {}), ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}), ...(roundingParam !== 0 ? { rounding: roundingParam } : {}), ...(packagingParam > 0 ? { packagingFee: packagingParam } : {}), items, payments: visitPay, ...(voucherCode ? { voucherCode } : {}), ...(effMemberId ? { memberId: effMemberId } : {}), ...(effCustomerId != null ? { customerId: effCustomerId } : {}), ...(tableNo ? { tableId: tableNo } : {}), ...(orderMode ? { mode: orderMode } : {}), ...(ongkir > 0 ? { ongkir } : {}), ...(ongkirCut > 0 ? { ongkirCut } : {}), ...(customerName ? { customer: customerName } : {}), };
          // C7/L1 save-then-record (cermin PayScreen:553-554): tulis DB dulu,
          // antre HANYA bila sukses — gagal = nol twin yatim, TANPA Success palsu.
          try {
            await saveSale(gInput);
            recordSale(gInput);
          } catch (e) {
            // Gate bound (D3-03): unbound → pesan klaim-terminal, TANPA Success palsu.
            if ((e as { code?: string })?.code === 'terminal-unbound') {
              appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
                { text: t('c_cancel'), style: 'cancel' },
                { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
              ]);
              // M10: guard di-reset agar retry hidup setelah klaim terminal.
              settledRef.current = false;
              return;
            }
            // L1 fail-closed: tulis DB gagal = JANGAN antre + JANGAN Success.
            appAlert(t('pay_issue_fail'));
            settledRef.current = false;
            return;
          }
        }
      } catch (e) {
        // appendGroupPayment kini melempar 'terminal-unbound' (gate bound, cermin
        // saveSale): jangan telan menjadi Success palsu — beri jalan klaim.
        if ((e as { code?: string })?.code === 'terminal-unbound') {
          appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
            { text: t('c_cancel'), style: 'cancel' },
            { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
          ]);
          settledRef.current = false;
          return;
        }
        /* DB gagal - kasir tetap jalan */
      }
      // APP-PRINTER-SALES: kunjungan grup QRIS ikut menyiarkan display
      // (jalur append tak lewat saveSale sehingga tak auto-publish).
      try {
        publishDisplayOrder(
          groupNo,
          (items ?? []).map((it) => ({
            name: String(it.name ?? ''),
            qty: Math.max(1, Math.round(Number(it.qty) || 0)),
            price: Math.round(Number(it.basePrice) || 0),
          })),
          orderTotalFull,
        );
      } catch { /* abaikan */ }
      navigation?.navigate('Success', { total: orderTotalFull, method: 'qris', orderNo: groupNo, clientId: saleClientId, approvalCode: refCode, items, discount, splitPaid: { amount: fullTotal, method: 'qris' }, ...(voucherCode ? { voucherCode } : {}), ...(effMemberId ? { memberId: effMemberId } : {}), ...(effCustomerId != null ? { customerId: effCustomerId } : {}), ...(serviceParam > 0 ? { service: serviceParam } : {}), ...(taxParam > 0 ? { tax: taxParam } : {}), ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}), ...(roundingParam !== 0 ? { rounding: roundingParam } : {}), ...(packagingParam > 0 ? { packaging: packagingParam } : {}), ...(ongkir > 0 ? { ongkir } : {}), ...(orderMode ? { mode: orderMode } : {}), ...(tableNo ? { table: tableNo } : {}), ...(customerName ? { customer: customerName } : {}) });
      return;
    }
    const input: SaleInput = { method: 'qris', salesNum: orderNo, clientId: saleClientId, grandTotal: fullTotal, discountTotal: discount, ...(serviceParam > 0 ? { serviceTotal: serviceParam } : {}), ...(taxParam > 0 ? { vatTotal: taxParam } : {}), ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}), ...(roundingParam !== 0 ? { rounding: roundingParam } : {}), ...(packagingParam > 0 ? { packagingFee: packagingParam } : {}), items, payments: [...fwdSplits, { method: 'qris', amount: total }], ...(voucherCode ? { voucherCode } : {}), ...(effMemberId ? { memberId: effMemberId } : {}), ...(effCustomerId != null ? { customerId: effCustomerId } : {}), ...(tableNo ? { tableId: tableNo } : {}), ...(orderMode ? { mode: orderMode } : {}), ...(ongkir > 0 ? { ongkir } : {}), ...(ongkirCut > 0 ? { ongkirCut } : {}),       ...(customerName ? { customer: customerName } : {}),
      ...(tipParam > 0 ? { tipTotal: tipParam } : {}),
    };
    // C7/L1 save-then-record (cermin PayScreen:633-650): tulis DB dulu, antre
    // HANYA bila sukses — gagal = nol twin yatim, TANPA Success palsu.
    try {
      await saveSale(input);
      recordSale(input);
    } catch (e) {
      // Gate bound (D3-03): unbound → pesan klaim-terminal, TANPA Success palsu.
      if ((e as { code?: string })?.code === 'terminal-unbound') {
        appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
          { text: t('c_cancel'), style: 'cancel' },
          { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
        ]);
        // M10: guard di-reset agar retry hidup setelah klaim terminal.
        settledRef.current = false;
        return;
      }
      // L1 fail-closed: tulis DB gagal = JANGAN antre + JANGAN Success.
      appAlert(t('pay_issue_fail'));
      settledRef.current = false;
      return;
    }
    // A4: cermin immediate ke BE + atribusi sesi kas (paritas cash lane);
    // grup = drain saja (client_id rantai bersama, hindari settle ganda).
    mirrorSettleToServer({ salesNum: orderNo, methodLabel: 'qris', amount: fullTotal, ...(tipParam > 0 ? { tip: tipParam } : {}), ...(voucherCode ? { voucherCode } : {}), ...(effCustomerId != null ? { customerId: effCustomerId } : {}), ...(memberPoinParam != null ? { prevPoints: memberPoinParam } : {}), ...(String(refCode ?? '').trim() ? { notes: String(refCode).trim() } : {}), clientId: saleClientId });
    navigation?.navigate('Success', { total: fullTotal, method: 'qris', orderNo, clientId: saleClientId, approvalCode: refCode, items, discount, ...(voucherCode ? { voucherCode } : {}), ...(effMemberId ? { memberId: effMemberId } : {}), ...(effCustomerId != null ? { customerId: effCustomerId } : {}), ...(serviceParam > 0 ? { service: serviceParam } : {}), ...(taxParam > 0 ? { tax: taxParam } : {}), ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}), ...(roundingParam !== 0 ? { rounding: roundingParam } : {}), ...(packagingParam > 0 ? { packaging: packagingParam } : {}), ...(ongkir > 0 ? { ongkir } : {}), ...(orderMode ? { mode: orderMode } : {}), ...(tableNo ? { table: tableNo } : {}), ...(customerName ? { customer: customerName } : {}), ...(ongkirCut > 0 ? { ongkirCut } : {}), ...(tipParam > 0 ? { tip: tipParam } : {}), }); }; /** * Cek status QRIS per mode sumber data: * - Real Mode: status PAID wajib dari backend (order/view), tanpa
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
    paid = false; }
    // C2: respons telat yang pulang setelah kadaluarsa = abaikan (jangan timpa
    // status expired, jangan settle QR basi).
    if (expiredRef.current) return;
    if (paid) {
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
              {/* APP-R3: FauxQr di atas pola dekoratif saja (bukan QRIS asli) —
                  payload scannable yang jujur = teks qrPayload di bawah ini
                  sampai dep renderer QR tersedia. */}
              {/* P9: QR tidak dirender sebelum client_id rantai siap (tanpa QR
                  basi); fallback loading jujur selagi resolusi berjalan. */}
              {!qrChainId.trim() ? (
                <Text style={styles.qrSub}>{t('qris_checking')}</Text>
              ) : (
                <>
                  <FauxQr seed={total} />
                  {/* M15: payload QR nyata (client_id rantai + salesNum + total) —
                      bukan nominal-dekoratif; teks sampai renderer QR tersedia. */}
                  <Text style={styles.qrPayload} selectable>{qrPayload}</Text>
                  <Text style={styles.qrSub}>{t('qris_scan')}</Text>
                </>
              )}
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
              expiredRef.current = false;
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
  /** M15: payload QR nyata sebagai teks (tanpa renderer QR). */
  qrPayload: { fontFamily: fonts.regular, fontSize: 10, color: colors.text, marginTop: 8, textAlign: 'center' },
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