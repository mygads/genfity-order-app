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

export default function EndShiftScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  // Ringkasan dummy — di app nyata diambil dari transaksi shift berjalan
  const modalAwal = 200000;
  const penjualanTunai = 1575000;
  const pengeluaran = 75000;
  const kasSeharusnya = modalAwal + penjualanTunai - pengeluaran;

  const [kasFisik, setKasFisik] = useState('');
  const [catatan, setCatatan] = useState('');
  const [pin, setPin] = useState('');
  const [pinVisible, setPinVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [error, setError] = useState('');

  const kasFisikNum = Number(kasFisik.replace(/\D/g, '')) || 0;
  const touched = kasFisik.length > 0;
  const selisih = touched ? kasFisikNum - kasSeharusnya : 0;

  const askClose = () => {
    if (!touched) {
      setError('Masukkan kas fisik (hasil hitung laci) terlebih dahulu');
      return;
    }
    setError('');
    setConfirmVisible(true);
  };

  const askPin = () => {
    setConfirmVisible(false);
    setPin('');
    setPinVisible(true);
  };

  const confirmClose = () => {
    if (pin.length < 4) {
      setError('Masukkan PIN supervisor (min. 4 digit)');
      return;
    }
    setPinVisible(false);
    setPin('');
    navigation?.navigate?.('Shift');
  };

  const renderDiffBanner = () => {
    if (!touched) return null;
    if (selisih === 0) {
      return (
        <View style={[s.banner, s.bannerOk]}>
          <Text style={[s.bannerTitle, s.bannerOkTxt]}>Selisih Rp 0 — Kas Pas ✓</Text>
          <Text style={s.bannerSub}>Kas fisik sama dengan kas seharusnya</Text>
        </View>
      );
    }
    const lebih = selisih > 0;
    return (
      <View style={[s.banner, lebih ? s.bannerMore : s.bannerLess]}>
        <Text style={[s.bannerTitle, lebih ? s.bannerMoreTxt : s.bannerLessTxt]}>
          {lebih ? 'Selisih Lebih' : 'Selisih Kurang'}: {rp(Math.abs(selisih))}
        </Text>
        <Text style={s.bannerSub}>
          {lebih
            ? 'Kas fisik melebihi perhitungan sistem'
            : 'Kas fisik kurang dari perhitungan sistem'}
        </Text>
      </View>
    );
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Tutup Shift / Akhiri Shift</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.card}>
          <Text style={s.cardTitle}>Ringkasan Shift</Text>
          <Row label="Modal Awal (Kas Awal)" value={rp(modalAwal)} />
          <Row label="Penjualan Tunai" value={rp(penjualanTunai)} />
          <Row label="Pengeluaran" value={'− ' + rp(pengeluaran)} negative />
          <View style={s.divider} />
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Kas Seharusnya</Text>
            <Text style={s.totalValue}>{rp(kasSeharusnya)}</Text>
          </View>
          <Text style={s.formula}>
            Modal awal + penjualan tunai − pengeluaran
          </Text>
        </View>

        {renderDiffBanner()}

        <View style={s.card}>
          <Text style={s.cardTitle}>Kas Fisik (Hasil Hitung Laci)</Text>
          <View style={s.amountBox}>
            <Text style={s.rpPrefix}>Rp</Text>
            <TextInput
              style={s.amountInput}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.faint}
              textAlign="right"
              value={touched ? rpNum(kasFisikNum) : '0'}
              onChangeText={(t) => setKasFisik(t.replace(/\D/g, ''))}
            />
          </View>
          <NumPad
            onKey={(k) => {
              if (k === 'C') setKasFisik(kasFisik.slice(0, -1));
              else if (kasFisik.length < 12) setKasFisik(kasFisik + k);
            }}
          />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Catatan Shift Out</Text>
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
        <View style={{ height: 90 }} />
      </ScrollView>

      <View style={s.footer}>
        <View style={s.footerInfo}>
          <Text style={s.footerLabel}>Kas seharusnya</Text>
          <Text style={s.footerValue}>{rp(kasSeharusnya)}</Text>
        </View>
        <TouchableOpacity style={s.closeBtn} onPress={askClose}>
          <Text style={s.closeBtnTxt}>Tutup Shift</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={confirmVisible} transparent animationType="fade">
        <View style={s.modalBg}>
          <View style={s.dialog}>
            <Text style={s.modalTitle}>Akhiri Shift?</Text>
            <Text style={s.modalHint}>
              Kas seharusnya {rp(kasSeharusnya)}{'\n'}Kas fisik {rp(kasFisikNum)}
              {'\n'}Selisih {selisih >= 0 ? '+' : '−'}
              {rpNum(Math.abs(selisih))}
            </Text>
            <View style={s.dialogRow}>
              <TouchableOpacity
                style={s.dialogCancel}
                onPress={() => setConfirmVisible(false)}>
                <Text style={s.dialogCancelTxt}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dialogOk} onPress={askPin}>
                <Text style={s.dialogOkTxt}>Lanjut</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={pinVisible} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>PIN Supervisor</Text>
            <Text style={s.modalHint}>Diperlukan persetujuan supervisor</Text>
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
                      else if (k === 'OK') confirmClose();
                      else if (pin.length < 6) setPin(pin + k);
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

function Row({
  label,
  value,
  negative,
}: {
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, negative && { color: colors.red }]}>{value}</Text>
    </View>
  );
}

function NumPad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <View style={s.pad}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '000'].map((k) => (
        <TouchableOpacity key={k} style={s.padKey} onPress={() => onKey(k)}>
          <Text style={s.padKeyTxt}>{k === 'C' ? '⌫' : k}</Text>
        </TouchableOpacity>
      ))}
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
  headerTitle: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  body: { padding: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  rowLabel: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  rowValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  totalValue: { fontSize: 18, fontFamily: fonts.bold, color: colors.navy },
  formula: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.faint,
    marginTop: 4,
  },
  banner: { borderRadius: 12, padding: 14, marginBottom: 12 },
  bannerOk: { backgroundColor: colors.paleGreen },
  bannerMore: { backgroundColor: colors.paleBlue },
  bannerLess: { backgroundColor: colors.paleRed },
  bannerTitle: { fontSize: 15, fontFamily: fonts.bold },
  bannerOkTxt: { color: colors.green },
  bannerMoreTxt: { color: colors.navy },
  bannerLessTxt: { color: colors.red },
  bannerSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.muted,
    marginTop: 2,
  },
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
  pad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  padKey: {
    width: '31%',
    margin: '1.16%',
    height: 52,
    borderRadius: 10,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padKeyTxt: { fontSize: 18, fontFamily: fonts.bold, color: colors.navy },
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
  errorBox: { backgroundColor: colors.paleRed, borderRadius: 8, padding: 12 },
  errorTxt: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.red,
    textAlign: 'center',
    marginTop: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  footerInfo: { flex: 1 },
  footerLabel: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  footerValue: { fontSize: 17, fontFamily: fonts.bold, color: colors.navy },
  closeBtn: {
    backgroundColor: colors.red,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  closeBtnTxt: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  dialog: {
    backgroundColor: colors.white,
    margin: 24,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 'auto',
    marginTop: 'auto',
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
    color: colors.muted,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  dialogRow: { flexDirection: 'row', marginTop: 18 },
  dialogCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginRight: 8,
  },
  dialogCancelTxt: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
  dialogOk: {
    flex: 1,
    backgroundColor: colors.red,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginLeft: 8,
  },
  dialogOkTxt: { fontSize: 14, fontFamily: fonts.bold, color: colors.white },
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
});
