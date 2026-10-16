import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp } from '../../theme';
import { printReceipt } from '../../lib/print';
import { isValidEmail, recordReceiptEmail } from '../../lib/payments';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type Props = {
  navigation?: Nav;
  route?: {
    params?: { total?: number; method?: string; cash?: number; change?: number };
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
  const isTablet = width >= 768;
  const total = route?.params?.total ?? 101200;
  const method = route?.params?.method ?? 'cash';
  const cash = route?.params?.cash ?? 0;
  const change = route?.params?.change ?? 0;
  const orderNo = '#TRX-000123';
  const receiptParams = { total, method: METHOD_LABEL[method] ?? method, cash, change };
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
      setMailMsg('Alamat email tidak valid.');
      return;
    }
    recordReceiptEmail(mailTo, orderNo, total, method);
    setMailMsg('Struk masuk antrean kirim — terkirim saat online.');
  };

  const status = (
    <>
      <View style={styles.checkCircle}>
        <Text style={styles.checkMark}>✓</Text>
      </View>
      <Text style={styles.title}>Pembayaran Berhasil</Text>
      <Text style={styles.orderNo}>{orderNo}</Text>
      <Text style={styles.dateLine}>{todayId} · {timeId}</Text>
    </>
  );

  const receipt = (
    <View style={styles.receipt}>
      <ScrollView>
        <Text style={styles.shopName}>ESB Cabang Poris</Text>
        <Text style={styles.shopSub}>Kasir Gista • Dine In</Text>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.label}>Total</Text>
          <Text style={styles.value}>{rp(total)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Metode</Text>
          <Text style={styles.value}>{METHOD_LABEL[method] ?? method}</Text>
        </View>
        {method === 'cash' && (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Tunai Diterima</Text>
              <Text style={styles.value}>{rp(cash)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Kembalian</Text>
              <Text style={styles.changeValue}>{rp(change)}</Text>
            </View>
          </>
        )}
        <View style={styles.divider} />
        <Text style={styles.thanks}>Terima kasih atas kunjungan Anda</Text>
      </ScrollView>
    </View>
  );

  const mailModal = (
    <Modal visible={mailOpen} animationType="fade" transparent>
      <View style={styles.wrap}>
        <View style={styles.dialog}>
          <Text style={styles.dTitle}>Kirim Struk via Email</Text>
          <Text style={styles.dSub}>Struk {orderNo} • {rp(total)}</Text>
          <TextInput
            style={styles.input}
            value={mailTo}
            onChangeText={setMailTo}
            placeholder="nama@email.com"
            placeholderTextColor={colors.faint}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {mailMsg ? <Text style={styles.mailMsg}>{mailMsg}</Text> : null}
          <View style={styles.dBtns}>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setMailOpen(false)}>
              <Text style={styles.ghostBtnText}>Tutup</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sendBtn} onPress={sendMail}>
              <Text style={styles.sendBtnText}>Kirim</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (isTablet) {
    return (
      <View style={styles.root}>
        <View style={styles.split}>
          <View style={styles.statusSide}>{status}</View>
          <View style={styles.receiptSide}>{receipt}</View>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.printBtn}
            onPress={() => printReceipt()}>
            <Text style={styles.printBtnText}>Cetak Struk</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.printBtn}
            onPress={() => setMailOpen(true)}>
            <Text style={styles.printBtnText}>Kirim Email</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.printBtn}
            onPress={() => navigation?.navigate('History')}>
            <Text style={styles.printBtnText}>Lihat Riwayat</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.newOrderBtn}
            onPress={() => navigation?.navigate('Cashier')}>
            <Text style={styles.newOrderBtnText}>Order Baru</Text>
          </TouchableOpacity>
        </View>
        {mailModal}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {status}
        {receipt}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.printBtn}
          onPress={() => navigation?.navigate('Receipt', receiptParams)}>
          <Text style={styles.printBtnText}>Cetak Struk</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.printBtn}
          onPress={() => setMailOpen(true)}>
          <Text style={styles.printBtnText}>Email</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.newOrderBtn}
          onPress={() => navigation?.navigate('Cashier')}>
          <Text style={styles.newOrderBtnText}>Order Baru</Text>
        </TouchableOpacity>
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
  label: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  value: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  changeValue: { fontFamily: fonts.bold, fontSize: 14, color: colors.green },
  thanks: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, textAlign: 'center' },
  footer: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line },
  printBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 13,
  },
  printBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.navy },
  newOrderBtn: {
    flex: 2,
    backgroundColor: colors.orange,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 13,
  },
  newOrderBtnText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
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
  ghostBtn: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: 'center' },
  ghostBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  sendBtn: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center' },
  sendBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
