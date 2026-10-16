import React, { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, rp, rpNum, wideCenter } from '../../theme';

type Props = { navigation?: any };

const QUICK_NOMINAL = [50000, 100000, 200000, 500000, 1000000];

const terbilang = (n: number): string => {
  if (n <= 0) return 'Nol rupiah';
  const kata = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  const sebut = (x: number): string => {
    if (x < 12) return kata[x];
    if (x < 20) return `${sebut(x - 10)} belas`;
    if (x < 100) return `${sebut(Math.floor(x / 10))} puluh ${sebut(x % 10)}`.trim();
    if (x < 200) return `seratus ${sebut(x - 100)}`.trim();
    if (x < 1000) return `${sebut(Math.floor(x / 100))} ratus ${sebut(x % 100)}`.trim();
    if (x < 2000) return `seribu ${sebut(x - 1000)}`.trim();
    if (x < 1000000) return `${sebut(Math.floor(x / 1000))} ribu ${sebut(x % 1000)}`.trim();
    if (x < 1000000000) return `${sebut(Math.floor(x / 1000000))} juta ${sebut(x % 1000000)}`.trim();
    return `${sebut(Math.floor(x / 1000000000))} miliar ${sebut(x % 1000000000)}`.trim();
  };
  return `${sebut(n).replace(/\s+/g, ' ').trim()} rupiah`;
};

export default function ShiftScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [kasAwal, setKasAwal] = useState('');
  const [catatan, setCatatan] = useState('');
  const [pin, setPin] = useState('');
  const [pinVisible, setPinVisible] = useState(false);
  const [error, setError] = useState('');

  const kasAwalNum = Number(kasAwal.replace(/\D/g, '')) || 0;

  const openPin = () => {
    if (kasAwalNum <= 0) {
      setError('Masukkan Kas Awal terlebih dahulu');
      return;
    }
    setError('');
    setPin('');
    setPinVisible(true);
  };

  const confirmOpen = () => {
    if (pin.length < 4) {
      setError('Masukkan PIN (min. 4 digit)');
      return;
    }
    setPinVisible(false);
    setPin('');
    navigation?.navigate?.('Cashier');
  };

  const pressPinKey = (d: string) => {
    if (pin.length >= 6) return;
    setPin(pin + d);
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Buka Kasir / Shift</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.card}>
          <Text style={s.cardTitle}>Shift Terakhir</Text>
          <View style={s.shiftRow}>
            <Text style={s.shiftLabel}>Status</Text>
            <Text style={s.shiftValue}>Tidak ada shift aktif</Text>
          </View>
          <View style={s.shiftRow}>
            <Text style={s.shiftLabel}>Kasir</Text>
            <Text style={s.shiftValue}>Kasir Utama</Text>
          </View>
          <View style={s.shiftRow}>
            <Text style={s.shiftLabel}>Waktu Buka</Text>
            <Text style={s.shiftValue}>14 Okt 2026 · 08:00</Text>
          </View>
          <View style={s.shiftRow}>
            <Text style={s.shiftLabel}>Waktu Tutup</Text>
            <Text style={s.shiftValue}>14 Okt 2026 · 15:00</Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Kas Awal</Text>
          <Text style={s.hint}>Modal awal kas fisik di laci kasir</Text>
          <View style={s.amountBox}>
            <Text style={s.rpPrefix}>Rp</Text>
            <TextInput
              style={s.amountInput}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.faint}
              textAlign="right"
              value={kasAwalNum ? rpNum(kasAwalNum) : '0'}
              onChangeText={(t) => setKasAwal(t.replace(/\D/g, ''))}
            />
          </View>
          <Text style={s.rpPreview}>{kasAwalNum > 0 ? terbilang(kasAwalNum) : 'Nol rupiah — masukkan nominal kas awal'}</Text>
          <Text style={s.chipHint}>Ketuk nominal untuk menambah ke Kas Awal · maks. Rp 10.000.000</Text>
          <View style={s.chips}>
            {QUICK_NOMINAL.map((n) => (
              <TouchableOpacity
                key={n}
                style={[s.chip, kasAwalNum === n && s.chipActive]}
                onPress={() => setKasAwal(String(kasAwalNum + n))}>
                <Text style={[s.chipTxt, kasAwalNum === n && s.chipTxtActive]}>
                  +{rpNum(n)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Catatan Buka Shift</Text>
          <TextInput
            style={s.noteInput}
            placeholder="Catatan (opsional)"
            placeholderTextColor={colors.faint}
            multiline
            value={catatan}
            onChangeText={setCatatan}
          />
        </View>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorTxt}>{error}</Text>
          </View>
        ) : null}
        <TouchableOpacity onPress={() => navigation?.navigate?.('Attendance')}>
          <Text style={s.link}>Belum absen? Catat kehadiran dulu → Absensi</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity
          style={[s.openBtn, kasAwalNum <= 0 && s.openBtnDisabled]}
          onPress={openPin}
          accessibilityState={{ disabled: kasAwalNum <= 0 }}>
          <Text style={s.openBtnTxt}>{kasAwalNum > 0 ? `Buka Shift · ${rp(kasAwalNum)}` : 'Isi Kas Awal untuk Buka Shift'}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={pinVisible} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Masukkan PIN</Text>
            <Text style={s.modalHint}>PIN kasir untuk membuka shift</Text>
            <View style={s.pinDots}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[s.dot, i < pin.length && s.dotFill]} />
              ))}
            </View>
            {error ? <Text style={s.errorTxt}>{error}</Text> : null}
            <View style={s.pinPad}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map(
                (k) => (
                  <TouchableOpacity
                    key={k}
                    style={s.pinKey}
                    onPress={() => {
                      if (k === 'C') setPin(pin.slice(0, -1));
                      else if (k === 'OK') confirmOpen();
                      else pressPinKey(k);
                    }}>
                    <Text style={s.pinKeyTxt}>{k === 'C' ? '⌫' : k}</Text>
                  </TouchableOpacity>
                ),
              )}
            </View>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => {
                setPinVisible(false);
                setPin('');
              }}>
              <Text style={s.cancelTxt}>Batal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  backBtn: { width: 32, alignItems: 'center' },
  backTxt: { color: colors.white, fontSize: 28, fontFamily: fonts.medium },
  headerTitle: { color: colors.white, fontSize: 17, fontFamily: fonts.bold },
  body: { padding: 16, paddingBottom: 24 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: colors.faint, marginTop: 2 },
  shiftRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  shiftLabel: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  shiftValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.orange,
    borderRadius: 10,
    paddingHorizontal: 14,
    marginTop: 12,
    backgroundColor: colors.paleOrange,
  },
  rpPrefix: { fontSize: 18, fontFamily: fonts.bold, color: colors.orange },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 24,
    fontFamily: fonts.bold,
    color: colors.text,
    paddingVertical: 12,
    marginLeft: 8,
    textAlign: 'right',
  },
  rpPreview: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.muted,
    textAlign: 'right',
    marginTop: 4,
  },
  chipHint: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.muted,
    marginTop: 6,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: colors.white,
  },
  chipActive: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  chipTxtActive: { color: colors.orange },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  errorBox: {
    backgroundColor: colors.paleRed,
    borderRadius: 8,
    padding: 12,
  },
  errorTxt: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.red,
    textAlign: 'center',
    marginTop: 4,
  },
  footer: {
    backgroundColor: colors.white,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  openBtn: {
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  openBtnDisabled: { opacity: 0.55 },
  openBtnTxt: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
  modalHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.faint,
    marginTop: 4,
  },
  pinDots: { flexDirection: 'row', marginVertical: 18 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.navy,
    marginHorizontal: 6,
  },
  dotFill: { backgroundColor: colors.navy },
  pinPad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  pinKey: {
    width: 72,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 5,
  },
  pinKeyTxt: { fontSize: 20, fontFamily: fonts.bold, color: colors.navy },
  cancelBtn: { marginTop: 12, padding: 10 },
  cancelTxt: { fontSize: 14, fontFamily: fonts.medium, color: colors.red },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark, marginTop: 12, textAlign: 'center' },
});
