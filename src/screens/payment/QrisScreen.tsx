import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenterSm } from '../../theme';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type Props = {
  navigation?: Nav;
  route?: { params?: { total?: number } };
};

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

export default function QrisScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const total = route?.params?.total ?? 101200;
  const [seconds, setSeconds] = useState(5 * 60);
  const [status, setStatus] = useState<'waiting' | 'checking' | 'paid' | 'expired'>('waiting');
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    if (status === 'paid') return;
    if (seconds <= 0) {
      setStatus('expired');
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, status]);

  // Auto-polling tiap 10 dtk saat menunggu (simulasi status backend)
  useEffect(() => {
    if (status !== 'waiting') return;
    const t = setTimeout(() => setStatus('checking'), 10000);
    return () => clearTimeout(t);
  }, [status, seconds]);

  useEffect(() => {
    if (status !== 'checking') return;
    const t = setTimeout(() => setStatus('waiting'), 1500);
    return () => clearTimeout(t);
  }, [status]);

  const checkStatus = () => {
    setStatus('checking');
    setTimeout(() => {
      setStatus('paid');
      navigation?.navigate('Success', { total, method: 'qris' });
    }, 1500);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (seconds > 0 && status !== 'expired' ? setConfirmExit(true) : navigation?.goBack())}>
          <Text style={styles.back}>‹ Batal</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>QRIS</Text>
        <View style={{ width: 70 }} />
      </View>
      {confirmExit && (
        <View style={styles.exitBar}>
          <Text style={styles.exitText}>QR akan hangus jika keluar. Yakin batalkan pembayaran ini?</Text>
          <View style={styles.exitRow}>
            <TouchableOpacity style={styles.exitKeep} onPress={() => setConfirmExit(false)}>
              <Text style={styles.exitKeepText}>Tetap di sini</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.exitYes} onPress={() => navigation?.goBack()}>
              <Text style={styles.exitYesText}>Ya, batalkan</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={[styles.body, isTablet && styles.bodyTablet]}>
        <View style={styles.mainCol}>
          <Text style={styles.totalLabel}>Total Bayar</Text>
          <Text style={styles.totalValue}>{rp(total)}</Text>

          <View style={styles.qrBox}>
            {/* Placeholder QR — ganti dengan <Image source={qrUri} /> dari backend */}
            <View style={styles.qrPlaceholder}>
              <View style={styles.qrCornerTL} />
              <View style={styles.qrCornerTR} />
              <View style={styles.qrCornerBL} />
              <View style={styles.qrCornerBR} />
              <Text style={styles.qrText}>QRIS</Text>
              <Text style={styles.qrSub}>Scan dengan e-wallet / m-banking</Text>
            </View>
          </View>

          <View style={[styles.timerBadge, seconds < 60 && styles.timerBadgeUrgent]}>
            <Text style={[styles.timerText, seconds < 60 && styles.timerTextUrgent]}>
              Sisa {status === 'expired' ? 'Kadaluarsa' : fmtTime(seconds)}
            </Text>
          </View>
          <Text style={styles.hint}>
            {status === 'expired'
              ? 'Kode QR kadaluarsa. Buat kode baru untuk melanjutkan.'
              : status === 'checking'
                ? 'Memeriksa status pembayaran otomatis…'
                : 'Minta pelanggan memindai QR di atas. Status diperiksa otomatis.'}
          </Text>
          <Text style={styles.txnMeta}>Nominal {rp(total)} • Metode QRIS • Berlaku 5 menit</Text>
          <Text style={styles.steps}>1. Tampilkan QR ke pelanggan  2. Pelanggan pindai & bayar  3. Cek Status / tunggu otomatis</Text>
        </View>
        {isTablet && (
          <View style={styles.sideCol}>
            <Text style={styles.sideTitle}>Ringkasan</Text>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>Nominal</Text>
              <Text style={styles.sideValue}>{rp(total)}</Text>
            </View>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>Metode</Text>
              <Text style={styles.sideValue}>QRIS</Text>
            </View>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>Status</Text>
              <Text style={styles.sideValue}>
                {status === 'paid' ? 'Lunas' : status === 'expired' ? 'Kadaluarsa' : 'Menunggu'}
              </Text>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.footer, isTablet && wideCenterSm]}>
        <TouchableOpacity
          style={styles.printBtn}
          onPress={() => navigation?.navigate('Receipt', { total, method: 'QRIS' })}>
          <Text style={styles.printBtnText}>Cetak QR</Text>
        </TouchableOpacity>
        {status === 'expired' ? (
          <TouchableOpacity
            style={styles.checkBtn}
            onPress={() => {
              setSeconds(5 * 60);
              setStatus('waiting');
            }}>
            <Text style={styles.checkBtnText}>Buat QR Baru</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.checkBtn, status === 'checking' && styles.checkBtnDisabled]}
            disabled={status === 'checking'}
            onPress={checkStatus}>
            <Text style={styles.checkBtnText}>
              {status === 'checking' ? 'Memeriksa…' : 'Cek Status'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  back: { color: colors.white, fontFamily: fonts.medium, fontSize: 14, width: 70 },
  headerTitle: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  body: { flex: 1, alignItems: 'center', padding: 20 },
  bodyTablet: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 16, width: '100%', maxWidth: 880, alignSelf: 'center' },
  mainCol: { flex: 1, alignItems: 'center', maxWidth: 420 },
  sideCol: { width: 260, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 14 },
  sideTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  sideRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  sideLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  sideValue: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
  totalLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  totalValue: { fontFamily: fonts.bold, fontSize: 30, color: colors.navy, marginTop: 2 },
  qrBox: {
    marginTop: 18,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 20,
  },
  qrPlaceholder: {
    width: 230,
    height: 230,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.navy,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCornerTL: { position: 'absolute', top: 12, left: 12, width: 44, height: 44, borderTopWidth: 5, borderLeftWidth: 5, borderColor: colors.navy },
  qrCornerTR: { position: 'absolute', top: 12, right: 12, width: 44, height: 44, borderTopWidth: 5, borderRightWidth: 5, borderColor: colors.navy },
  qrCornerBL: { position: 'absolute', bottom: 12, left: 12, width: 44, height: 44, borderBottomWidth: 5, borderLeftWidth: 5, borderColor: colors.navy },
  qrCornerBR: { position: 'absolute', bottom: 12, right: 12, width: 44, height: 44, borderBottomWidth: 5, borderRightWidth: 5, borderColor: colors.navy },
  qrText: { fontFamily: fonts.bold, fontSize: 34, color: colors.red },
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
  exitKeepText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  exitYes: { flex: 1, backgroundColor: colors.red, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  exitYesText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
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
  checkBtn: {
    flex: 2,
    backgroundColor: colors.orange,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 13,
  },
  checkBtnDisabled: { opacity: 0.5 },
  checkBtnText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
