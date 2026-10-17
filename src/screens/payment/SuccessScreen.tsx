import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { useLang } from '../../lib/i18n';
import { isValidEmail, recordReceiptEmail, type SaleItemIn } from '../../lib/payments';
import { getSession } from '../../session';
import { getTerminal } from '../../config/server';
import { initDb, run } from '../../lib/db';
import { enqueueSync } from '../../lib/sync';

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
  // Tanpa params (dibuka di luar alur bayar) = nilai kosong yang jujur:
  // total 0, metode apa adanya, nomor order kosong.
  const total = Math.max(0, Math.round(Number(route?.params?.total) || 0));
  const method = route?.params?.method ?? '';
  const cash = route?.params?.cash ?? 0;
  const change = route?.params?.change ?? 0;
  // Nomor order: nomor struk asli dari layar bayar (Pay goSuccess kirim L-timestamp,
  // Qris kirim refCode-nya); kosong bila tak dioper (bukan nomor karangan).
  const orderNo = route?.params?.orderNo ?? '';
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
  // Draft yang baru dibayar = hapus dari tr_draftorder agar tak jadi hantu di
  // Muat Order (bug G2). Cocok via salesNum di payload; best-effort, tak blokir UI.
  useEffect(() => {
    const no = String(orderNo ?? '').trim();
    if (!no) return;
    void (async () => {
      try {
        await initDb();
        await run('DELETE FROM tr_draftorder WHERE payload LIKE ?', [`%${no}%`]);
      } catch {
        /* abaikan */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Meja dibebaskan saat penjualan lunas: draft menandai 'terisi' sejak
  // disimpan (LoadOrderScreen) — sukses bayar = meja kosong kembali + sync.
  useEffect(() => {
    const tb = String(route?.params?.table ?? '').trim();
    if (!tb) return;
    void (async () => {
      try {
        await initDb();
        await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE TRIM(tableNo) = ?', ['kosong', tb]);
      } catch {
        /* abaikan */
      }
      try {
        enqueueSync('other', { op: 'table-clear', table: tb, at: new Date().toISOString() });
      } catch {
        /* abaikan */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lineTotal = (it: SaleItemIn): number =>
    it.qty * it.basePrice +
    (it.modifiers ?? []).reduce((s, m) => s + m.price * it.qty, 0) -
    (it.discount ?? 0);
  const miniSubtotal = miniItems.reduce((s, it) => s + lineTotal(it), 0);
  const isCash = method === 'cash' || method.toLowerCase().includes('tunai');
  const doPrint = () => {
    // Cetak via layar struk (cetak nyata ESC/POS + tendang laci bila tunai),
    // bukan dialog info - autoPrint picu sekali saat Receipt dibuka.
    navigation?.navigate('Receipt', { ...receiptParams, autoPrint: true });
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

  // Pratinjau struk: SATU scroll milik layar (tanpa ScrollView bersarang di
  // dalam kartu), semua item tampil, urutan baris SELARAS ReceiptScreen
  // (diskon → service → feeESB → tax → voucher → ongkir → rounding → TOTAL).
  const receipt = (
    <View style={styles.receipt}>
        <Text style={styles.shopName}>{getTerminal().branchName || 'Genfity'}</Text>
        <Text style={styles.shopSub}>Kasir {getSession()?.name ?? getSession()?.username ?? ''} • {[orderMode ?? 'Dine In', route?.params?.table, route?.params?.customer].filter(Boolean).join(' · ')}</Text>
        <View style={styles.divider} />
        {miniItems.map((it) => (
          <View key={it.id} style={styles.row}>
            <Text style={styles.label}>{it.qty}x {it.name}</Text>
            <Text style={styles.value}>{rp(lineTotal(it))}</Text>
          </View>
        ))}
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
        {tax > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('ok_tax')}</Text>
            <Text style={styles.value}>{rp(tax)}</Text>
          </View>
        )}
        {voucherCode ? (
          <View style={styles.row}>
            <Text style={styles.label}>{t('rc_voucher')}</Text>
            <Text style={styles.value}>{voucherCode}</Text>
          </View>
        ) : null}
        {ongkir > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('ongkir')}</Text>
            <Text style={styles.value}>{rp(ongkir)}</Text>
          </View>
        )}
        {rounding !== 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{t('rounding')}</Text>
            <Text style={styles.value}>{rp(rounding)}</Text>
          </View>
        )}
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.totalLabel}>{t('c_total').toUpperCase()}</Text>
          <Text style={styles.totalValue}>{rp(total)}</Text>
        </View>
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
    </View>
  );

  const mailModal = (
    <Modal visible={mailOpen} animationType="fade" transparent>
      <View style={styles.wrap}>
        <View style={[styles.dialog, isTablet && styles.dialogTablet]}>
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

        {/* Tablet: footer 2x2 agar label panjang tidak terjepit. */}
        <View style={[styles.footer, styles.footerTablet]}>
          <AppButton title={t('ok_print')} variant="secondary" onPress={doPrint} fullWidth={false} size="md" style={[styles.footBtnFlex, styles.footTabletBtn]} />
          <AppButton title={t('ok_email_long')} variant="secondary" onPress={() => setMailOpen(true)} fullWidth={false} size="md" style={[styles.footBtnFlex, styles.footTabletBtn]} />
          <AppButton title={t('ok_history_long')} variant="secondary" onPress={() => navigation?.navigate('History')} fullWidth={false} size="md" style={[styles.footBtnFlex, styles.footTabletBtn]} />
          <AppButton title={t('ok_new')} onPress={() => navigation?.navigate('Cashier')} fullWidth={false} size="md" style={[styles.footBtnFlex, styles.footTabletBtn]} />
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
      <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.body}>
        {status}
        {receipt}
      </ScrollView>

      <View style={[styles.footer, styles.footerGrid]}>
        <AppButton title={t('ok_print')} variant="secondary" onPress={doPrint} fullWidth={false} size="md" style={styles.footGridBtn} />
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
  bodyScroll: { flex: 1 },
  body: { alignItems: 'center', padding: 24, paddingBottom: 40 },
  split: { flex: 1, flexDirection: 'row', padding: 24, gap: 20, ...wideCenterLg },
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
  totalLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  totalValue: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  label: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  value: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  changeValue: { fontFamily: fonts.bold, fontSize: 14, color: colors.green },
  thanks: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, textAlign: 'center' },
  footer: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line },
  // Tablet: bungkus 2x2 agar label panjang tidak terjepit.
  footerTablet: { flexWrap: 'wrap' },
  footTabletBtn: { flexBasis: '45%', flexGrow: 1, minHeight: 52 },
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
  // Tablet: modal email dibatasi + tengahkan selaras dialogNarrow.
  dialogTablet: { width: '100%', maxWidth: 480, alignSelf: 'center' },
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
