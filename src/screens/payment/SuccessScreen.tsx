import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp } from '../../theme';

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
  transfer: 'Transfer Bank',
  qris: 'QRIS',
  gopay: 'GoPay',
  ovo: 'OVO',
  dana: 'DANA',
  shopeepay: 'ShopeePay',
};

export default function SuccessScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const total = route?.params?.total ?? 101200;
  const method = route?.params?.method ?? 'cash';
  const cash = route?.params?.cash ?? 0;
  const change = route?.params?.change ?? 0;
  const orderNo = '#TRX-000123';
  const receiptParams = { total, method: METHOD_LABEL[method] ?? method };
  const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const now = new Date();
  const todayId = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const timeId = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} WIB`;

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
            onPress={() => navigation?.navigate('Receipt', receiptParams)}>
            <Text style={styles.printBtnText}>Cetak Struk</Text>
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
          onPress={() => navigation?.navigate('History')}>
          <Text style={styles.printBtnText}>Lihat Riwayat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.newOrderBtn}
          onPress={() => navigation?.navigate('Cashier')}>
          <Text style={styles.newOrderBtnText}>Order Baru</Text>
        </TouchableOpacity>
      </View>
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
});
