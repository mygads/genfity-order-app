import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors, fonts, rp, wideCenterSm } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type Tab = 'Klaim' | 'ESB Order' | 'Member' | 'Voucher';

const TAB_HINT: Record<Tab, string> = {
  Klaim: 'Pindai QR klaim terminal dari server untuk mengikat perangkat ini.',
  'ESB Order': 'Pindai QR/tagihan pesanan online untuk membuka detailnya.',
  Member: 'Pindai kartu/QR member untuk menautkan ke transaksi.',
  Voucher: 'Pindai QR voucher atau masukkan kode manual.',
};

const TAB_PLACEHOLDER: Record<Tab, string> = {
  Klaim: 'TRM-XXXX-XXXX',
  'ESB Order': 'ESB-XXXXX',
  Member: 'MBR-XXXX',
  Voucher: 'VC-XXXX',
};

export default function QrScanScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [tab, setTab] = useState<Tab>('Voucher');
  const [code, setCode] = useState('VC-DISKON10K');
  const [result, setResult] = useState(true);
  const [msg, setMsg] = useState('');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const toggleScan = async () => {
    if (scanning) {
      setScanning(false);
      return;
    }
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setMsg('Izin kamera ditolak — pakai input manual di bawah.');
        return;
      }
    }
    setMsg('');
    setScanning(true);
  };

  const pickTab = (t: Tab) => {
    setTab(t);
    setResult(false);
    setMsg('');
    setCode(t === 'Klaim' ? '' : t === 'ESB Order' ? 'ESB-88121' : t === 'Member' ? 'MBR-QOQI-342' : 'VC-DISKON10K');
  };

  const check = () => {
    if (!code.trim()) {
      setMsg('Isi kode manual dulu.');
      setResult(false);
      return;
    }
    setMsg('');
    setResult(true);
  };

  const useCode = () => {
    if (tab === 'Klaim') {
      navigation?.navigate('Install');
      return;
    }
    if (tab === 'ESB Order') {
      navigation?.navigate('EsbOrder');
      return;
    }
    navigation?.navigate('Cashier');
  };

  const descFor = () => {
    if (tab === 'Voucher') return `Voucher · Potongan ${rp(10000)} · Berlaku s/d 31 Des 2026`;
    if (tab === 'Member') return 'Member QoQi · GOLD · 342 poin';
    if (tab === 'ESB Order') return 'ESB-88121 · Budi Santoso · Diantar · 3 item';
    return 'Terminal TRM-001 · Cabang Poris · siap diklaim';
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterSm]}>
      <Text style={styles.hint}>Kamera + input manual</Text>
      <View style={styles.frame}>
        {scanning ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              setCode(String(data));
              setResult(true);
              setMsg('');
              setScanning(false);
            }}
          />
        ) : (
          <Image source={require('../../../assets/images/invalid_qr.webp')} style={styles.frameImg} resizeMode="contain" />
        )}
        <Text style={styles.frameT}>Pindai Kode QR</Text>
        <Text style={styles.frameS}>{TAB_HINT[tab]}</Text>
        <TouchableOpacity style={styles.scanBtn} onPress={toggleScan}>
          <Text style={styles.scanBtnT}>{scanning ? 'Matikan Kamera' : 'Aktifkan Kamera'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.tabs}>
        {(['Klaim', 'ESB Order', 'Member', 'Voucher'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => pickTab(t)}>
            <Text style={[styles.tabT, tab === t && styles.tabTOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {result ? (
        <View style={styles.card}>
          <Text style={styles.code}>{code || '—'}</Text>
          <Text style={styles.desc}>{descFor()}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.ghost} onPress={() => setResult(false)}>
              <Text style={styles.ghostT}>Scan Ulang</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={useCode}>
              <Text style={styles.primaryT}>Gunakan</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={styles.empty}>Belum ada hasil scan — arahkan kamera atau masukkan kode manual.</Text>
      )}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <Text style={styles.label}>Atau masukkan kode manual ({tab})</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        placeholder={TAB_PLACEHOLDER[tab]}
        placeholderTextColor={colors.faint}
        autoCapitalize="characters"
      />
      <TouchableOpacity style={styles.primary} onPress={check}>
        <Text style={styles.primaryT}>Cek Kode</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  frame: { backgroundColor: colors.navy, borderRadius: 14, padding: 22, alignItems: 'center', marginTop: 12 },
  frameImg: { width: 120, height: 90 },
  camera: { width: 220, height: 160, borderRadius: 10, overflow: 'hidden' },
  scanBtn: { marginTop: 10, borderWidth: 1, borderColor: colors.navyTint, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 },
  scanBtnT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  frameT: { fontFamily: fonts.bold, fontSize: 16, color: colors.white, marginTop: 8 },
  frameS: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 4 },
  frameNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.navyTint, textAlign: 'center', marginTop: 6, opacity: 0.8 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  tab: { flexGrow: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, alignItems: 'center', backgroundColor: colors.card, minWidth: '22%' },
  tabOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  tabT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
  tabTOn: { color: colors.orangeDark },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  code: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primary: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 10 },
  primaryT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 13, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 12 },
  msg: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.bold, fontSize: 15, color: colors.text },
});
