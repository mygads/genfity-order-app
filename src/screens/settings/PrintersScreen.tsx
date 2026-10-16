import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, wideCenter } from '../../theme';
import { printers, type PrinterDevice } from '../../data/mock';
import { buildReceiptBytes, toHex } from '../../lib/escpos';
import { shareReceipt } from '../../lib/print';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type ConnType = 'Bluetooth' | 'LAN' | 'Star';
type StationRole = 'Kasir' | 'Dapur' | 'Checker' | 'Label';

interface Station {
  id: string;
  name: string;
  role: StationRole;
  conn: ConnType;
  address: string;
  cpl: 32 | 48;
  autocut: boolean;
  isDefault: boolean;
  connected: boolean;
}

interface Bonded {
  id: string;
  name: string;
  mac: string;
  paired: boolean;
}

const DEFAULT_STATIONS: Station[] = [
  { id: 'st-kasir', name: 'Printer Kasir', role: 'Kasir', conn: 'Bluetooth', address: '00:11:22:33:44:55', cpl: 32, autocut: true, isDefault: true, connected: true },
  { id: 'st-dapur', name: 'Printer Dapur', role: 'Dapur', conn: 'LAN', address: '192.168.1.50:9100', cpl: 32, autocut: false, isDefault: false, connected: false },
  { id: 'st-checker', name: 'Printer Checker', role: 'Checker', conn: 'LAN', address: '192.168.1.51:9100', cpl: 48, autocut: false, isDefault: false, connected: false },
  { id: 'st-label', name: 'Printer Label', role: 'Label', conn: 'Star', address: '', cpl: 32, autocut: true, isDefault: false, connected: false },
];

const DEFAULT_BONDED: Bonded[] = [
  { id: 'bt1', name: 'XPrinter XP-80C', mac: '00:11:22:33:44:55', paired: true },
  { id: 'bt2', name: 'XPrinter XP-58IIH', mac: 'AA:BB:CC:DD:EE:01', paired: true },
  { id: 'bt3', name: 'Star TSP143IIIU', mac: 'AA:BB:CC:DD:EE:02', paired: false },
];

const typeFilters = ['Semua', 'Bluetooth', 'USB', 'LAN'] as const;

function roleColor(r: StationRole) {
  if (r === 'Kasir') return colors.navy;
  if (r === 'Dapur') return colors.orange;
  if (r === 'Checker') return colors.blue;
  return colors.green;
}

/** Susun teks pratinjau struk uji per station (cetak nyata butuh dev-client). */
function previewText(s: Station): string {
  const bar = '-'.repeat(s.cpl);
  return [
    `UJI CETAK · ${s.name}`,
    `${s.role} · ${s.conn}${s.address ? ` · ${s.address}` : ''}`,
    `${s.cpl} kolom · ${s.autocut ? 'autocut' : 'tanpa autocut'}`,
    bar,
    '1x Ayam Geprek Pelakor',
    '2x Es Teh Manis',
    bar,
    'TOTAL Rp 64.050',
    'Butuh dev-client utk kirim BT/LAN.',
  ].join('\n');
}

export default function PrintersScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [filter, setFilter] = useState<(typeof typeFilters)[number]>('Semua');
  const [stations, setStations] = useState<Station[]>(DEFAULT_STATIONS);
  const [bonded, setBonded] = useState<Bonded[]>(DEFAULT_BONDED);
  const [pairing, setPairing] = useState(false);
  const [lanIp, setLanIp] = useState('192.168.1.50');
  const [lanPort, setLanPort] = useState('9100');
  const [lanMsg, setLanMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [preview, setPreview] = useState<{ station: string; text: string; hex: string } | null>(null);
  const [confirm, setConfirm] = useState<PrinterDevice | null>(null);
  const [connectedIds, setConnectedIds] = useState<string[]>(printers.filter((p) => p.connected).map((p) => p.id));
  const [stName, setStName] = useState('');
  const [stRole, setStRole] = useState<StationRole>('Dapur');
  const [stConn, setStConn] = useState<ConnType>('Bluetooth');

  const list = useMemo(
    () => printers.filter((p) => filter === 'Semua' || p.type === filter),
    [filter],
  );

  const patchStation = (id: string, patch: Partial<Station>) =>
    setStations((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const setDefault = (id: string) =>
    setStations((ss) => ss.map((s) => ({ ...s, isDefault: s.id === id })));

  const removeStation = (id: string) =>
    setStations((ss) => (ss.length <= 1 ? ss : ss.filter((s) => s.id !== id)));

  const addStation = () => {
    const name = stName.trim();
    if (!name) return;
    setStations((ss) => ([
      ...ss,
      {
        id: `st-${Date.now()}`,
        name,
        role: stRole,
        conn: stConn,
        address: stConn === 'LAN' ? `${lanIp.trim()}:${lanPort.trim()}` : '',
        cpl: 32,
        autocut: true,
        isDefault: ss.length === 0,
        connected: false,
      },
    ]));
    setStName('');
  };

  /** Pairing BT (stub): daftar bonded + status butuh dev-client. */
  const startPairing = () => {
    setPairing(true);
    setTimeout(() => setPairing(false), 1800);
  };

  const togglePair = (id: string) =>
    setBonded((bb) => bb.map((b) => (b.id === id ? { ...b, paired: !b.paired } : b)));

  /** Uji koneksi LAN (stub): validasi IP:port + status butuh dev-client. */
  const testLan = () => {
    const ipOk = /^\d{1,3}(\.\d{1,3}){3}$/.test(lanIp.trim());
    const port = Number(lanPort);
    if (!ipOk || !Number.isInteger(port) || port < 1 || port > 65535) {
      setLanMsg('IP/port tidak valid — contoh 192.168.1.50:9100.');
      return;
    }
    setLanMsg(`Socket TCP ke ${lanIp.trim()}:${port} butuh dev-client — pratinjau dibuat.`);
  };

  /** Buka drawer kas (stub): perintah ESC/POS drawer + status butuh dev-client. */
  const openDrawer = (s: Station) => {
    setStatusMsg(`Perintah buka drawer dikirim ke ${s.name} (butuh dev-client).`);
  };

  /** Test print per station: pratinjau struk + hex ESC/POS. */
  const testPrintStation = (s: Station) => {
    const bytes = buildReceiptBytes({
      shop: 'ESB CABANG PORIS',
      addr: `Uji cetak · ${s.name}`,
      trx: `${s.role} · ${s.conn} · ${s.cpl} kolom`,
      items: [
        { name: 'Ayam Geprek Pelakor', qty: 1, price: 45000 },
        { name: 'Es Teh Manis', qty: 2, price: 8000 },
      ],
      subtotal: 61000,
      service: 3050,
      total: 64050,
      method: 'Tunai',
    });
    setPreview({ station: s.name, text: previewText(s), hex: toHex(bytes).slice(0, 240) + '…' });
    setStatusMsg(`Pratinjau uji cetak ${s.name} siap (${bytes.length} byte). Kirim nyata butuh dev-client.`);
  };

  const togglePrinter = (p: PrinterDevice) => {
    setConnectedIds((c) => (c.includes(p.id) ? c.filter((id) => id !== p.id) : [...c, p.id]));
    setConfirm(null);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Printer</Text>
        <Text style={styles.headerSub}>Station kasir/dapur/checker/label · BT SPP · LAN · Star</Text>
      </View>

      <Text style={styles.groupLabel}>Station Printer</Text>
      {stations.map((s) => (
        <View key={s.id} style={styles.stCard}>
          <View style={styles.stTop}>
            <View style={styles.stLeft}>
              <Text style={styles.stName}>{s.name}{s.isDefault ? ' • Utama' : ''}</Text>
              <Text style={styles.stMeta}>
                {s.conn}{s.address ? ` · ${s.address}` : ''} · {s.connected ? 'Terhubung' : 'Terputus'}
              </Text>
            </View>
            <View style={[styles.roleBadge, { backgroundColor: roleColor(s.role) }]}>
              <Text style={styles.roleText}>{s.role}</Text>
            </View>
          </View>
          <View style={styles.chipRow}>
            {(['Kasir', 'Dapur', 'Checker', 'Label'] as StationRole[]).map((r) => (
              <Pressable key={r} onPress={() => patchStation(s.id, { role: r })} style={[styles.chip, s.role === r && styles.chipActive]}>
                <Text style={[styles.chipText, s.role === r && styles.chipTextActive]}>{r}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.chipRow}>
            {(['Bluetooth', 'LAN', 'Star'] as ConnType[]).map((c) => (
              <Pressable key={c} onPress={() => patchStation(s.id, { conn: c })} style={[styles.chip, s.conn === c && styles.chipActive]}>
                <Text style={[styles.chipText, s.conn === c && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
            {([32, 48] as const).map((c) => (
              <Pressable key={c} onPress={() => patchStation(s.id, { cpl: c })} style={[styles.chip, s.cpl === c && styles.chipActive]}>
                <Text style={[styles.chipText, s.cpl === c && styles.chipTextActive]}>{c} kol</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.stRowBetween}>
            <Text style={styles.stMeta}>Potong kertas otomatis</Text>
            <Switch value={s.autocut} onValueChange={(v) => patchStation(s.id, { autocut: v })} trackColor={{ true: colors.green, false: colors.stroke }} />
          </View>
          <View style={styles.stBtns}>
            <Pressable style={styles.btnTest} onPress={() => testPrintStation(s)}>
              <Text style={styles.btnTestText}>Uji Cetak</Text>
            </Pressable>
            <Pressable style={styles.btnDrawer} onPress={() => openDrawer(s)}>
              <Text style={styles.btnDrawerText}>Buka Drawer</Text>
            </Pressable>
            <Pressable style={styles.btnMini} onPress={() => setDefault(s.id)}>
              <Text style={styles.btnMiniText}>Utama</Text>
            </Pressable>
            <Pressable style={styles.btnMiniDanger} onPress={() => removeStation(s.id)}>
              <Text style={styles.btnMiniDangerText}>Hapus</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.btnConn, s.connected && styles.btnConnOff]}
            onPress={() => patchStation(s.id, { connected: !s.connected })}>
            <Text style={[styles.btnConnText, s.connected && styles.btnConnOffText]}>
              {s.connected ? 'Putuskan' : 'Sambungkan (butuh dev-client)'}
            </Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.stCard}>
        <Text style={styles.stName}>Tambah Station</Text>
        <TextInput style={styles.input} value={stName} onChangeText={setStName} placeholder="Nama station baru" placeholderTextColor={colors.faint} />
        <View style={styles.chipRow}>
          {(['Kasir', 'Dapur', 'Checker', 'Label'] as StationRole[]).map((r) => (
            <Pressable key={r} onPress={() => setStRole(r)} style={[styles.chip, stRole === r && styles.chipActive]}>
              <Text style={[styles.chipText, stRole === r && styles.chipTextActive]}>{r}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.chipRow}>
          {(['Bluetooth', 'LAN', 'Star'] as ConnType[]).map((c) => (
            <Pressable key={c} onPress={() => setStConn(c)} style={[styles.chip, stConn === c && styles.chipActive]}>
              <Text style={[styles.chipText, stConn === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={[styles.btnPrimary, !stName.trim() && styles.btnDisabled]} disabled={!stName.trim()} onPress={addStation}>
          <Text style={styles.btnPrimaryText}>Tambah Station</Text>
        </Pressable>
      </View>

      {preview ? (
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>Pratinjau Struk · {preview.station}</Text>
          <Text style={styles.previewText}>{preview.text}</Text>
          <Text style={styles.previewHex} numberOfLines={2}>{preview.hex}</Text>
          <Pressable style={styles.btnTest} onPress={() => shareReceipt(preview.text)}>
            <Text style={styles.btnTestText}>Bagikan Pratinjau</Text>
          </Pressable>
        </View>
      ) : null}
      {statusMsg ? <Text style={styles.statusMsg}>{statusMsg}</Text> : null}

      <Text style={styles.groupLabel}>Bluetooth (SPP)</Text>
      <View style={styles.panel}>
        <Text style={styles.cardTitle}>Pairing + Perangkat Bonded</Text>
        <Text style={styles.cardSub}>Cetak BT klasik via SPP — kirim nyata butuh dev-client.</Text>
        {bonded.map((b) => (
          <View key={b.id} style={styles.btRow}>
            <View style={styles.stLeft}>
              <Text style={styles.stName}>{b.name}</Text>
              <Text style={styles.stMeta}>{b.mac} · {b.paired ? 'Terpairing' : 'Belum pairing'}</Text>
            </View>
            <Pressable style={b.paired ? styles.btnMiniDanger : styles.btnMini} onPress={() => togglePair(b.id)}>
              <Text style={b.paired ? styles.btnMiniDangerText : styles.btnMiniText}>
                {b.paired ? 'Lupakan' : 'Pairing'}
              </Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={[styles.btnPrimary, pairing && styles.btnDisabled]} onPress={startPairing} disabled={pairing}>
          <Text style={styles.btnPrimaryText}>{pairing ? 'Memindai (120 dtk)…' : 'Pindai Perangkat BT'}</Text>
        </Pressable>
      </View>

      <Text style={styles.groupLabel}>LAN / Wi-Fi</Text>
      <View style={styles.panel}>
        <Text style={styles.cardTitle}>Printer Jaringan (ESC/POS via TCP)</Text>
        <Text style={styles.cardSub}>Isi IP + port printer struk/label dapur.</Text>
        <View style={styles.lanRow}>
          <TextInput style={styles.input} value={lanIp} onChangeText={setLanIp} placeholder="192.168.1.50" placeholderTextColor={colors.faint} autoCapitalize="none" />
          <TextInput style={[styles.input, styles.portInput]} value={lanPort} onChangeText={setLanPort} placeholder="9100" placeholderTextColor={colors.faint} keyboardType="numeric" />
        </View>
        <Pressable style={styles.btnTest} onPress={testLan}>
          <Text style={styles.btnTestText}>Uji Koneksi LAN</Text>
        </Pressable>
        {lanMsg ? <Text style={styles.statusMsg}>{lanMsg}</Text> : null}
      </View>

      <Text style={styles.groupLabel}>Daftar Printer Terdeteksi</Text>
      <View style={styles.tabs}>
        {typeFilters.map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.tab, filter === f && styles.tabActive]}>
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        scrollEnabled={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image source={require('../../../assets/images/empty_printer.webp')} style={styles.emptyImg} resizeMode="contain" />
            <Text style={styles.emptyTitle}>Printer Tidak Ditemukan</Text>
            <Text style={styles.emptySub}>Pastikan printer menyala lalu pindai ulang</Text>
          </View>
        }
        renderItem={({ item }) => {
          const on = connectedIds.includes(item.id);
          return (
            <View style={[styles.card, on && styles.cardOn]}>
              <View style={styles.cardTop}>
                <View style={styles.stLeft}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.cardAddr}>{item.address}</Text>
                </View>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeText}>{item.type}</Text>
                </View>
              </View>
              <Text style={styles.cardRole}>{item.role} • {on ? 'Terhubung' : 'Terputus'}</Text>
              <View style={styles.cardBtns}>
                <Pressable style={styles.btnTest} onPress={() => testPrintStation({
                  id: item.id, name: item.name, role: 'Kasir', conn: item.type === 'LAN' ? 'LAN' : 'Bluetooth',
                  address: item.address, cpl: 32, autocut: true, isDefault: false, connected: on,
                })}>
                  <Text style={styles.btnTestText}>Uji Cetak</Text>
                </Pressable>
                <Pressable style={on ? styles.btnOff : styles.btnOn} onPress={() => (on ? setConfirm(item) : togglePrinter(item))}>
                  <Text style={on ? styles.btnOffText : styles.btnOnText}>{on ? 'Putuskan' : 'Sambungkan'}</Text>
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
            <Text style={styles.dialogSub}>Koneksi ke {confirm?.name} akan diputus. Cetak struk tidak dapat dilakukan.</Text>
            <View style={styles.dialogBtns}>
              <Pressable style={styles.btnGhost} onPress={() => setConfirm(null)}>
                <Text style={styles.btnGhostText}>Batal</Text>
              </Pressable>
              <Pressable style={styles.btnDanger} onPress={() => confirm && togglePrinter(confirm)}>
                <Text style={styles.btnDangerText}>Ya, Putuskan</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Text style={styles.foot}>Jenis: Struk 58mm/80mm · Label · Mode Star line-mode · Margin & drawer per station</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },
  header: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 16, paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  groupLabel: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginTop: 18, marginBottom: 6, paddingHorizontal: 16 },
  stCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  stLeft: { flex: 1, paddingRight: 10 },
  stName: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  stMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  roleBadge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  roleText: { fontFamily: fonts.bold, fontSize: 10, color: colors.white },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  chipTextActive: { color: colors.white },
  stRowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  stBtns: { flexDirection: 'row', gap: 6, marginTop: 10 },
  btnTest: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.navy, paddingVertical: 10, alignItems: 'center' },
  btnTestText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  btnDrawer: { flex: 1, borderRadius: 10, backgroundColor: colors.paleAmber, paddingVertical: 10, alignItems: 'center' },
  btnDrawerText: { fontFamily: fonts.bold, fontSize: 12, color: colors.amberDark },
  btnMini: { borderRadius: 8, borderWidth: 1, borderColor: colors.navy, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center' },
  btnMiniText: { fontFamily: fonts.bold, fontSize: 11, color: colors.navy },
  btnMiniDanger: { borderRadius: 8, backgroundColor: colors.paleRed, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center' },
  btnMiniDangerText: { fontFamily: fonts.bold, fontSize: 11, color: colors.red },
  btnConn: { borderRadius: 10, backgroundColor: colors.green, paddingVertical: 11, alignItems: 'center', marginTop: 8 },
  btnConnOff: { backgroundColor: colors.paleRed },
  btnConnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  btnConnOffText: { color: colors.red },
  btnPrimary: { borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  btnPrimaryText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnDisabled: { opacity: 0.4 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.white,
    marginTop: 8,
    flex: 1,
  },
  previewCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.green,
  },
  previewTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.greenDark },
  previewText: { fontFamily: fonts.regular, fontSize: 12, color: colors.text, marginTop: 8 },
  previewHex: { fontFamily: fonts.regular, fontSize: 10, color: colors.faint, marginTop: 6 },
  statusMsg: { fontFamily: fonts.medium, fontSize: 12, color: colors.navy, marginTop: 8, paddingHorizontal: 16 },
  panel: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  btRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  lanRow: { flexDirection: 'row', gap: 8 },
  portInput: { maxWidth: 100 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, marginHorizontal: 16, borderWidth: 1, borderColor: colors.line },
  cardOn: { borderColor: colors.green },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardName: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  cardAddr: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, marginTop: 2 },
  typeBadge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: colors.navy },
  typeText: { fontFamily: fonts.bold, fontSize: 10, color: colors.white },
  cardRole: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 6 },
  cardBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btnOn: { flex: 1, borderRadius: 10, backgroundColor: colors.green, paddingVertical: 10, alignItems: 'center' },
  btnOnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  btnOff: { flex: 1, borderRadius: 10, backgroundColor: colors.paleRed, paddingVertical: 10, alignItems: 'center' },
  btnOffText: { fontFamily: fonts.bold, fontSize: 12, color: colors.red },
  empty: { alignItems: 'center', paddingTop: 40, paddingBottom: 20 },
  emptyImg: { width: 180, height: 140 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 12 },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  centerWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dialogSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 8 },
  dialogBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btnGhost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: 'center' },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  btnDanger: { flex: 1, borderRadius: 10, backgroundColor: colors.red, paddingVertical: 12, alignItems: 'center' },
  btnDangerText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 16, paddingHorizontal: 24 },
});
