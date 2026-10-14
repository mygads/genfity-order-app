import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, wideCenter } from '../../theme';
import { printers, type PrinterDevice, type PrinterType } from '../../data/mock';
import {
  buildReceiptBytes,
  downloadBin,
  sendOverWebBluetooth,
  toHex,
} from '../../lib/escpos';
import { shareReceipt } from '../../lib/print';

const typeFilters = ['Semua', 'Bluetooth', 'USB', 'LAN'] as const;

function typeColor(t: PrinterType) {
  if (t === 'Bluetooth') return colors.navy;
  if (t === 'USB') return colors.orange;
  return colors.green;
}

export default function PrintersScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [filter, setFilter] = useState<(typeof typeFilters)[number]>('Semua');
  const [connected, setConnected] = useState<string[]>(printers.filter((p) => p.connected).map((p) => p.id));
  const [testing, setTesting] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<string | null>(null);
  const [escBytes, setEscBytes] = useState<Uint8Array | null>(null);
  const [escFor, setEscFor] = useState('');
  const [escMsg, setEscMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [confirm, setConfirm] = useState<PrinterDevice | null>(null);

  const list = useMemo(
    () => printers.filter((p) => filter === 'Semua' || p.type === filter),
    [filter],
  );

  const toggleConnect = (p: PrinterDevice) => {
    setConnected((c) => (c.includes(p.id) ? c.filter((id) => id !== p.id) : [...c, p.id]));
    setConfirm(null);
  };

  /** Uji cetak nyata: susun byte ESC/POS struk contoh (32 kolom). */
  const testPrint = (p: PrinterDevice) => {
    setTesting(p.id);
    setTestOk(null);
    setEscMsg('');
    setTimeout(() => {
      const bytes = buildReceiptBytes({
        shop: 'ESB CABANG PORIS',
        addr: 'Jl. Poris Indah No. 88',
        trx: 'UJI CETAK · Kasir Gista',
        items: [
          { name: 'Ayam Geprek Pelakor', qty: 1, price: 45000 },
          { name: 'Es Teh Manis', qty: 2, price: 8000 },
        ],
        subtotal: 61000,
        service: 3050,
        total: 64050,
        method: 'Tunai',
      });
      setEscBytes(bytes);
      setEscFor(p.name);
      setTesting(null);
      setTestOk(p.id);
      setTimeout(() => setTestOk(null), 6000);
    }, 600);
  };

  const copyHex = async () => {
    if (!escBytes) return;
    const hex = toHex(escBytes);
    try {
      const g = globalThis as unknown as { navigator?: { clipboard?: { writeText: (s: string) => Promise<void> } } };
      if (g.navigator?.clipboard) {
        await g.navigator.clipboard.writeText(hex);
        setEscMsg('Hex tersalin ke clipboard.');
        return;
      }
      throw new Error('no-clipboard');
    } catch {
      await shareReceipt(hex);
      setEscMsg('Clipboard tak tersedia — dibuka via dialog bagikan.');
    }
  };

  const download = () => {
    if (!escBytes) return;
    setEscMsg(
      downloadBin(escBytes, 'uji-cetak-escpos.bin')
        ? 'File uji-cetak-escpos.bin terunduh.'
        : 'Unduh hanya tersedia di web.',
    );
  };

  const sendBt = async () => {
    if (!escBytes || busy) return;
    setBusy(true);
    setEscMsg('Memilih printer Bluetooth…');
    try {
      const name = await sendOverWebBluetooth(escBytes);
      setEscMsg(`Terkirim ke ${name} via Bluetooth.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal mengirim.';
      setEscMsg(msg.includes('User cancelled') || msg.includes('cancelled') ? 'Pemilihan printer dibatalkan.' : msg);
    } finally {
      setBusy(false);
    }
  };

  const scan = () => {
    setScanning(true);
    setTimeout(() => setScanning(false), 1800);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Printer</Text>
        <Text style={styles.headerSub}>Koneksi Printer • Pilih Printer Bluetooth</Text>
      </View>

      <View style={styles.scanRow}>
        <View style={styles.tabs}>
          {typeFilters.map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.tab, filter === f && styles.tabActive]}
            >
              <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.scanBtn} onPress={scan} disabled={scanning}>
          <Text style={styles.scanBtnText}>{scanning ? 'Memindai...' : 'Pindai'}</Text>
        </Pressable>
      </View>

      {escBytes && (
        <View style={[styles.escCard, isTablet && wideCenter]}>
          <Text style={styles.escTitle}>✓ ESC/POS dibuat · {escFor}</Text>
          <Text style={styles.escSub}>
            {escBytes.length} byte · 32 kolom · init + teks + total tebal + potong kertas
          </Text>
          <Text style={styles.escHex} numberOfLines={2}>
            {toHex(escBytes).slice(0, 120)}…
          </Text>
          <View style={styles.escBtns}>
            <Pressable style={styles.escBtn} onPress={copyHex}>
              <Text style={styles.escBtnText}>Salin Hex</Text>
            </Pressable>
            <Pressable style={styles.escBtn} onPress={download}>
              <Text style={styles.escBtnText}>Unduh .bin</Text>
            </Pressable>
            <Pressable style={[styles.escBtnPrimary, busy && styles.btnDisabled]} onPress={sendBt} disabled={busy}>
              <Text style={styles.escBtnPrimaryText}>{busy ? 'Mengirim…' : 'Kirim Bluetooth'}</Text>
            </Pressable>
          </View>
          {escMsg ? <Text style={styles.escMsg}>{escMsg}</Text> : null}
        </View>
      )}

      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={[styles.list, isTablet && wideCenter]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image
              source={require('../../../assets/images/empty_printer.webp')}
              style={styles.emptyImg}
              resizeMode="contain"
            />
            <Text style={styles.emptyTitle}>Printer Tidak Ditemukan</Text>
            <Text style={styles.emptySub}>Pastikan printer menyala lalu tekan Pindai</Text>
          </View>
        }
        renderItem={({ item }) => {
          const on = connected.includes(item.id);
          return (
            <View style={[styles.card, on && styles.cardOn]}>
              <View style={styles.cardTop}>
                <View style={styles.cardLeft}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.cardAddr}>{item.address}</Text>
                </View>
                <View style={[styles.typeBadge, { backgroundColor: typeColor(item.type) }]}>
                  <Text style={styles.typeText}>{item.type}</Text>
                </View>
              </View>
              <Text style={styles.cardRole}>
                {item.role} • {on ? 'Terhubung' : 'Terputus'}
              </Text>
              <View style={styles.cardBtns}>
                <Pressable
                  style={[styles.btnTest, !on && styles.btnDisabled]}
                  disabled={!on}
                  onPress={() => testPrint(item)}
                >
                  <Text style={styles.btnTestText}>
                    {testing === item.id
                      ? 'Mencetak...'
                      : testOk === item.id
                        ? '✓ Berhasil'
                        : 'Uji Cetak'}
                  </Text>
                </Pressable>
                <Pressable
                  style={on ? styles.btnOff : styles.btnOn}
                  onPress={() => (on ? setConfirm(item) : toggleConnect(item))}
                >
                  <Text style={on ? styles.btnOffText : styles.btnOnText}>
                    {on ? 'Putuskan' : 'Sambungkan'}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={confirm !== null} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Putuskan Printer?</Text>
            <Text style={styles.dialogSub}>
              Koneksi ke {confirm?.name} akan diputus. Cetak struk tidak dapat dilakukan.
            </Text>
            <View style={styles.dialogBtns}>
              <Pressable style={styles.btnGhost} onPress={() => setConfirm(null)}>
                <Text style={styles.btnGhostText}>Batal</Text>
              </Pressable>
              <Pressable
                style={styles.btnDanger}
                onPress={() => confirm && toggleConnect(confirm)}
              >
                <Text style={styles.btnDangerText}>Ya, Putuskan</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.foot}>
        <Text style={styles.footText}>Jenis Printer: Struk 58mm / 80mm • Mode Printer: Kasir & Dapur</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 16, paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  tabs: { flex: 1, flexDirection: 'row', gap: 6 },
  tab: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted },
  tabTextActive: { color: colors.white },
  scanBtn: { backgroundColor: colors.orange, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  scanBtnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardOn: { borderColor: colors.green },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLeft: { flex: 1, paddingRight: 10 },
  cardName: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  cardAddr: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, marginTop: 2 },
  typeBadge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  typeText: { fontFamily: fonts.bold, fontSize: 10, color: colors.white },
  cardRole: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 6 },
  cardBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btnTest: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.navy,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnTestText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  btnOn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.green,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnOnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  btnOff: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.paleRed,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnOffText: { fontFamily: fonts.bold, fontSize: 12, color: colors.red },
  btnDisabled: { opacity: 0.4 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyImg: { width: 180, height: 140 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 12 },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  centerWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dialogSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 8 },
  dialogBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btnGhost: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  btnDanger: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.red,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDangerText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  foot: { paddingHorizontal: 16, paddingBottom: 20 },
  footText: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center' },
  escCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.green,
  },
  escTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.greenDark },
  escSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  escHex: { fontFamily: fonts.regular, fontSize: 10, color: colors.faint, marginTop: 6 },
  escBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
  escBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.navy,
    paddingVertical: 10,
    alignItems: 'center',
  },
  escBtnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  escBtnPrimary: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.navy,
    paddingVertical: 10,
    alignItems: 'center',
  },
  escBtnPrimaryText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  escMsg: { fontFamily: fonts.medium, fontSize: 12, color: colors.navy, marginTop: 8 },
});
