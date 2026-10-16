import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { useLang } from '../../lib/i18n';
import { printReceipt } from '../../lib/print';
import { isValidEmail, recordReceiptEmail, type SaleItemIn } from '../../lib/payments';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      total?: number; method?: string; cash?: number; change?: number; orderNo?: string;
      items?: SaleItemIn[]; discount?: number; ongkir?: number;
      mode?: string; table?: string; customer?: string;
      voucher?: string | { code: string; amount?: number; kind?: string };
      voucherCode?: string; approvalCode?: string; cardLast4?: string;
      bank?: string; terminal?: string; memberId?: string;
      tax?: number; vatTotal?: number; service?: number; serviceTotal?: number;
      rounding?: number; feeESB?: number;
    };
  };
};

const METHOD_LABEL: Record<string, string> = {
  cash: 'Tunai',
  debit: 'Kartu Debit',
  kredit: 'Kartu Kredit',
  'debit-bca': 'Debit BCA',
  'kredit-bca': 'Kredit BCA',
  'debit-ocbc': 'Debit OCBC',
  'EDC BCA': 'EDC BCA',
  transfer: 'Transfer Bank',
  'Transfer Bank': 'Transfer Bank',
  qris: 'QRIS',
  gopay: 'GoPay',
  ovo: 'OVO',
  dana: 'DANA',
  shopeepay: 'ShopeePay',
  deposit: 'Deposit Member',
  pluxee: 'Pluxee',
  ultra: 'Ultra Voucher',
  lainnya: 'Lainnya',
  compliment: 'Kompliment',
  compliment_label: 'Kompliment',
  Kompliment: 'Kompliment',
  'Non-Penjualan': 'Non-Penjualan',
  nonsales: 'Non-Penjualan',
};

export default function SuccessScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const total = route?.params?.total ?? 101200;
  const method = route?.params?.method ?? 'cash';
  const cash = route?.params?.cash ?? 0;
  const change = route?.params?.change ?? 0;
  // Nomor order: nomor struk asli dari layar bayar (Pay goSuccess kirim L-timestamp,
  // Qris kirim refCode-nya); fallback format L-timestamp selaras saveSale bila tak dioper.
  const orderNo = route?.params?.orderNo ?? `L-${Date.now()}`;
  const ongkir = route?.params?.ongkir ?? 0;
  const orderMode = route?.params?.mode;
  const discount = route?.params?.discount ?? 0;
  const voucherParam = route?.params?.voucher;
  const voucherCode = route?.params?.voucherCode
    ?? (typeof voucherParam === 'string' ? voucherParam : voucherParam?.code);
  const approvalCode = route?.params?.approvalCode;
  const cardLast4 = route?.params?.cardLast4;
  const bank = route?.params?.bank;
  const terminal = route?.params?.terminal;
  const tax = route?.params?.tax ?? route?.params?.vatTotal ?? 0;
  const service = route?.params?.service ?? route?.params?.serviceTotal ?? 0;
  const rounding = route?.params?.rounding ?? 0;
  const feeESB = route?.params?.feeESB ?? 0;
  // Ringkasan mini: hitung subtotal dari item agar rinciannya ikut tampil (bukan cuma total).
  const miniItems = route?.params?.items ?? [];
  const lineTotal = (it: SaleItemIn): number =>
    it.qty * it.basePrice +
    (it.modifiers ?? []).reduce((s, m) => s + m.price * it.qty, 0) -
    (it.discount ?? 0);
  const miniSubtotal = miniItems.reduce((s, it) => s + lineTotal(it), 0);
  const miniShown = miniItems.slice(0, 4);
  const miniHidden = miniItems.length - miniShown.length;
  const isCash = method === 'cash' || method.toLowerCase().includes('tunai');
  const doPrint = () => {
    // Perintah cetak langsung (jangan cuma navigasi) - lalu tampilkan pratinjau struk.
    void printReceipt();
    navigation?.navigate('Receipt', receiptParams);
  };
  const receiptParams = {
    total, method: METHOD_LABEL[method] ?? method, cash, change,
    no: orderNo, items: route?.params?.items, discount,
    ...(service > 0 ? { service } : {}),
    ...(tax > 0 ? { tax } : {}),
    ...(rounding !== 0 ? { rounding } : {}),
    ...(feeESB > 0 ? { feeESB } : {}),
    ...(voucherCode ? { voucherCode } : {}),
    ...(approvalCode ? { approvalCode } : {}),
    ...(cardLast4 ? { cardLast4 } : {}),
    ...(bank ? { bank } : {}),
    ...(terminal ? { terminal } : {}),
    ...(route?.params?.memberId ? { memberId: route.params.memberId } : {}),
    ...(ongkir > 0 ? { ongkir } : {}),
    ...(orderMode ? { mode: orderMode } : {}),
    ...(route?.params?.table ? { table: route.params.table } : {}),
    ...(route?.params?.customer ? { customer: route.params.customer } : {}),
  };
  const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const now = new Date();
  const todayId = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const timeId = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} WIB`;

  const [mailOpen, setMailOpen] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mailMsg, setMailMsg] = useState('');

  const sendMail = () => {
    if (!isValidEmail(mailTo)) {
      setMailMsg(t('hist_mail_bad'));
      return;
    }
    recordReceiptEmail(mailTo, orderNo, total, method);
    setMailMsg(t('hist_mail_queued'));
  };

  const status = (
    <>
      <View style={styles.checkCircle}>
        <Text style={styles.checkMark}>✓</Text>
      </View>
      <Text style={styles.title}>{t('ok_title')}</Text>
      <Text style={styles.orderNo}>{orderNo}</Text>
      <Text style={styles.dateLine}>{todayId} · {timeId}</Text>
    </>
  );

  const receipt = (
    <View style={styles.receipt}>
      <ScrollView>
        <Text style={styles.shopName}>ESB Cabang Poris</Text>
        <Text style={styles.shopSub}>Kasir Gista • {[orderMode ?? 'Dine In', route?.params?.table, route?.params?.customer].filter(Boolean).join(' · ')}</Text>
        <View style={styles.divider} />
        {miniShown.map((it) => (
          <View key={it.id} style={styles.row}>
            <Text style={styles.label}>{it.qty}x {it.name}</Text>
            <Text style={styles.value}>{rp(lineTotal(it))}</Text>
          </View>
        ))}
        {miniHidden > 0 && (
          <Text style={styles.miniMore}>{t('ok_more_items').replace('{n}', String(miniHidden))}</Text>
        )}
        {miniItems.length > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('c_subtotal')}</Text>
            <Text style={styles.value}>{rp(miniSubtotal)}</Text>
          </View>
        )}
        {discount > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('rc_discount')}</Text>
            <Text style={styles.value}>-{rp(discount)}</Text>
          </View>
        )}
        {voucherCode ? (
          <View style={styles.row}>
            <Text style={styles.label}>{t('ok_voucher')}</Text>
            <Text style={styles.value}>{voucherCode}</Text>
          </View>
        ) : null}
        {tax > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('ok_tax')}</Text>
            <Text style={styles.value}>{rp(tax)}</Text>
          </View>
        )}
        {service > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('serviceExcl')}</Text>
            <Text style={styles.value}>{rp(service)}</Text>
          </View>
        )}
        {feeESB > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('feeESB')}</Text>
            <Text style={styles.value}>{rp(feeESB)}</Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={styles.label}>{t('c_total')}</Text>
          <Text style={styles.value}>{rp(total)}</Text>
        </View>
        {ongkir > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('ongkir')}</Text>
            <Text style={styles.value}>{rp(ongkir)}</Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={styles.label}>{t('ok_method')}</Text>
          <Text style={styles.value}>{METHOD_LABEL[method] ?? method}</Text>
        </View>
        {approvalCode ? (
          <View style={styles.row}>
            <Text style={styles.label}>{t('ok_approval')}</Text>
            <Text style={styles.value}>{approvalCode}{cardLast4 ? ` ••${cardLast4}` : ''}</Text>
          </View>
        ) : null}
        {bank || terminal ? (
          <View style={styles.row}>
            <Text style={styles.label}>{t('ok_terminal')}</Text>
            <Text style={styles.value}>{[bank, terminal].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : null}
        {isCash && (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>{t('ok_cashin')}</Text>
              <Text style={styles.value}>{rp(cash)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>{t('ok_change')}</Text>
              <Text style={styles.changeValue}>{rp(change)}</Text>
            </View>
          </>
        )}
        <View style={styles.divider} />
        <Text style={styles.thanks}>{t('ok_thanks')}</Text>
      </ScrollView>
    </View>
  );

  const mailModal = (
    <Modal visible={mailOpen} animationType="fade" transparent>
      <View style={styles.wrap}>
        <View style={styles.dialog}>
          <Text style={styles.dTitle}>{t('hist_mail_title')}</Text>
          <Text style={styles.dSub}>Struk {orderNo} • {rp(total)}</Text>
          <AppInput
            value={mailTo}
            onChangeText={setMailTo}
            placeholder={t('hist_mail_ph')}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {mailMsg ? <Text style={styles.mailMsg}>{mailMsg}</Text> : null}
          <View style={styles.dBtns}>
            <AppButton title={t('c_close')} variant="secondary" onPress={() => setMailOpen(false)} fullWidth={false} size="md" style={styles.dBtn} />
            <AppButton title={t('hist_mail_send')} onPress={sendMail} fullWidth={false} size="md" style={styles.dBtn} />
          </View>
        </View>
      </View>
    </Modal>
  );

  if (isTablet) {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title={t('ok_title')}
          sub={orderNo}
          onBack={() => navigation?.navigate('Cashier')}
        />
        <View style={styles.split}>
          <View style={styles.statusSide}>{status}</View>
          <View style={styles.receiptSide}>{receipt}</View>
        </View>

        <View style={styles.footer}>
          <AppButton title={t('ok_print')} variant="secondary" onPress={doPrint} fullWidth={false} size="md" style={styles.footBtnFlex} />
          <AppButton title={t('ok_email_long')} variant="secondary" onPress={() => setMailOpen(true)} fullWidth={false} size="md" style={styles.footBtnFlex} />
          <AppButton title={t('ok_history_long')} variant="secondary" onPress={() => navigation?.navigate('History')} fullWidth={false} size="md" style={styles.footBtnFlex} />
          <AppButton title={t('ok_new')} onPress={() => navigation?.navigate('Cashier')} fullWidth={false} size="md" style={styles.footBtnWide} />
        </View>
        {mailModal}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('ok_title')}
        sub={orderNo}
        onBack={() => navigation?.navigate('Cashier')}
      />
      <View style={styles.body}>
        {status}
        {receipt}
      </View>

      <View style={[styles.footer, styles.footerGrid]}>
        <AppButton title={t('ok_print')} variant="secondary" onPress={() => navigation?.navigate('Receipt', receiptParams)} fullWidth={false} size="md" style={styles.footGridBtn} />
        <AppButton title={t('ok_email_long')} variant="secondary" onPress={() => setMailOpen(true)} fullWidth={false} size="md" style={styles.footGridBtn} />
        <AppButton title={t('ok_history_long')} variant="secondary" onPress={() => navigation?.navigate('History')} fullWidth={false} size="md" style={styles.footGridBtn} />
        <AppButton title={t('ok_new')} onPress={() => navigation?.navigate('Cashier')} fullWidth={false} size="md" style={styles.footGridBtn} />
      </View>
      {mailModal}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: 'center', padding: 24 },
  split: { flex: 1, flexDirection: 'row', padding: 24, gap: 20 },
  statusSide: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  receiptSide: { flex: 1.2, justifyContent: 'center' },
  checkCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  checkMark: { color: colors.white, fontSize: 44, fontFamily: fonts.bold },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.text, marginTop: 14 },
  orderNo: { fontFamily: fonts.medium, fontSize: 14, color: colors.faint, marginTop: 4 },
  dateLine: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  receipt: {
    marginTop: 18,
    width: '100%',
    maxHeight: 320,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  shopName: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, textAlign: 'center' },
  shopSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 2 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginVertical: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  miniMore: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, marginBottom: 6 },
  label: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  value: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  changeValue: { fontFamily: fonts.bold, fontSize: 14, color: colors.green },
  thanks: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, textAlign: 'center' },
  footer: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line },
  footerGrid: { flexWrap: 'wrap' },
  footBtn: {
    width: '48%',
    flexGrow: 1,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 13,
  },
  footBtnPrimary: {
    width: '48%',
    flexGrow: 1,
    flexShrink: 0,
    backgroundColor: colors.orange,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 13,
  },
  printBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 13,
  },
  printBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.navy, textAlign: 'center' },
  newOrderBtn: {
    flex: 2,
    backgroundColor: colors.orange,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 13,
  },
  newOrderBtnText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white, textAlign: 'center' },
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4 },
  input: {
    borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 11,
    fontFamily: fonts.regular, fontSize: 14, color: colors.text, backgroundColor: colors.white, marginTop: 12,
  },
  mailMsg: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 8 },
  dBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  dBtn: { flex: 1, marginTop: 0 },
  footBtnFlex: { flex: 1, marginTop: 0 },
  footBtnWide: { flex: 2, marginTop: 0 },
  footGridBtn: { width: '48%', flexGrow: 1, flexShrink: 0, marginTop: 0 },
  ghostBtn: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: 'center' },
  ghostBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  sendBtn: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center' },
  sendBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
