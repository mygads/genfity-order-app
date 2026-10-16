import { useEffect, useMemo, useState } from 'react';import {
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
  useWindowDimensions,} from 'react-native';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';import { useLang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { printers, type PrinterDevice } from '../../data/mock';import { buildReceiptBytes, toHex } from '../../lib/escpos';import { shareReceipt } from '../../lib/print';import { hasNativePrinter, listBondedBtPrinters, openCashDrawer, printBytes, type PrinterTarget } from '../../native/printer';import { initDb, run } from '../../lib/db';import { enqueueOutbox } from '../../lib/sync';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type ConnType = 'Bluetooth' | 'LAN' | 'Star';type StationRole = 'Kasir' | 'Dapur' | 'Checker' | 'Label';interface Station {
  id: string;
  name: string;
  role: StationRole;
  conn: ConnType;
  address: string;
  cpl: 32 | 48;
  autocut: boolean;
  isDefault: boolean;
  connected: boolean;}interface Bonded {
  id: string;
  name: string;
  mac: string;
  paired: boolean;}const LS_STATIONS = 'genfity.printer.stations';const DEFAULT_STATIONS: Station[] = [
  { id: 'st-kasir', name: 'Printer Kasir', role: 'Kasir', conn: 'Bluetooth', address: '00:11:22:33:44:55', cpl: 32, autocut: true, isDefault: true, connected: true },
  { id: 'st-dapur', name: 'Printer Dapur', role: 'Dapur', conn: 'LAN', address: '192.168.1.50:9100', cpl: 32, autocut: false, isDefault: false, connected: false },
  { id: 'st-checker', name: 'Printer Checker', role: 'Checker', conn: 'LAN', address: '192.168.1.51:9100', cpl: 48, autocut: false, isDefault: false, connected: false },
  { id: 'st-label', name: 'Printer Label', role: 'Label', conn: 'Star', address: '', cpl: 32, autocut: true, isDefault: false, connected: false },];const DEFAULT_BONDED: Bonded[] = [
  { id: 'bt1', name: 'XPrinter XP-80C', mac: '00:11:22:33:44:55', paired: true },
  { id: 'bt2', name: 'XPrinter XP-58IIH', mac: 'AA:BB:CC:DD:EE:01', paired: true },
  { id: 'bt3', name: 'Star TSP143IIIU', mac: 'AA:BB:CC:DD:EE:02', paired: false },];const typeFilters = ['Semua', 'Bluetooth', 'USB', 'LAN'] as const;function roleColor(r: StationRole) {
  if (r === 'Kasir') return colors.navy;
  if (r === 'Dapur') return colors.orange;
  if (r === 'Checker') return colors.blue;
  return colors.green;}/** Susun teks pratinjau struk uji per station. Rupiah selalu via rp(). Baris
 *  catatan dev-client hanya ditambah bila modul native tak tersedia (teks via
 *  kunci printers.detectedHint dari pemanggil agar ikut bahasa aktif). */function previewText(s: Station, hint: string | null): string {
  const bar = '-'.repeat(s.cpl);
  return [
    `UJI CETAK - ${s.name}`,
    `${s.role} - ${s.conn}${s.address ? ` - ${s.address}` : ''}`,
    `${s.cpl} kolom - ${s.autocut ? 'autocut' : 'tanpa autocut'}`,
    bar,
    '1x Ayam Geprek Pelakor',
    '2x Es Teh Manis',
    bar,
    `TOTAL ${rp(64050)}`,
    ...(hint ? [hint] : []),
  ].join('\n');}/** Bangun target kirim dari konfigurasi stasiun. */function stationTarget(s: Station): PrinterTarget { if (s.conn === 'LAN') { const [host, portRaw] = s.address.split(':'); return { transport: 'lan', host: (host ?? '').trim(), port: Number(portRaw ?? 9100) || 9100 };
}

if (s.conn === 'Star') { const m = s.address.match(/(\d+)\s*\/\s*(\d+)/); return { transport: 'usb', vendorId: m ? Number(m[1]) : 0, productId: m ? Number(m[2]) : 0 }; } return { transport: 'bt', address: s.address.trim() };}/** Simpan station ke ms_station agar konfigurasi perangkat ikut sync master. */async function persistStation(s: Station): Promise<void> { try { await initDb(); await run( `INSERT OR REPLACE INTO ms_station (id, stationName, printerName, printerPort, connection, printerType, charPerLine, flagDefault, flagActive, flagAutocut, syncDate) VALUES (?, ?, ?, ?, ?, 'receipt', ?, ?, 1, ?, NULL)`, [s.id, s.name, s.name, s.address, s.conn, s.cpl, s.isDefault ? 1 : 0, s.autocut ? 1 : 0], ); await enqueueOutbox('ms_station', s.id, 'update'); } catch { /* abaikan: cache JSON di bawah tetap menyimpan */ }}export default function PrintersScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [filter, setFilter] = useState<(typeof typeFilters)[number]>('Semua');
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
  // Modul native ada = jalan di dev-client/APK produksi; tidak ada = Expo Go/web.
  // Dipakai untuk menyembunyikan catatan dev-client bila sudah tidak relevan.
  const [nativeReady] = useState(hasNativePrinter);

  useEffect(() => { let alive = true; void getJSON<Station[]>(LS_STATIONS, DEFAULT_STATIONS).then((cached) => { if (alive && cached.length > 0) setStations(cached); }); return () => { alive = false; }; }, []); useEffect(() => { void setJSON(LS_STATIONS, stations); }, [stations]); const list = useMemo(
    () => printers.filter((p) => filter === 'Semua' || p.type === filter),
    [filter],
  );

  const patchStation = (id: string, patch: Partial<Station>) =>
    { setStations((ss) => { const next = ss.map((x) => (x.id === id ? { ...x, ...patch } : x));

  const changed = next.find((x) => x.id === id); if (changed) void persistStation(changed); return next; }); }; const setDefault = (id: string) =>
    { setStations((ss) => { const next = ss.map((x) => ({ ...x, isDefault: x.id === id })); next.forEach((x) => { void persistStation(x); }); return next; }); };

  const removeStation = (id: string) =>
    setStations((ss) => {
      if (ss.length <= 1) return ss;
      const next = ss.filter((x) => x.id !== id);
      // Cerminkan hapus ke ms_station agar daftar live KitchenScreen ikut bersih.
      void (async () => {
        try {
          await initDb();
          await run('DELETE FROM ms_station WHERE id = ?', [id]);
          await enqueueOutbox('ms_station', id, 'delete');
        } catch {
          /* abaikan: cache JSON di bawah tetap menyimpan */
        }
      })();
      return next;
    });

  const addStation = () => {
    const name = stName.trim();
    if (!name) return;
    const entry: Station =
      {
        id: `st-${Date.now()}`,
        name,
        role: stRole,
        conn: stConn,
        address: stConn === 'LAN' ? `${lanIp.trim()}:${lanPort.trim()}` : '',
        cpl: 32,
        autocut: true,
        isDefault: stations.length === 0,
        connected: false,
      }; setStations((ss) => [...ss, entry]); void persistStation(entry);
    setStName('');
  };

  /** Pairing BT: daftar bonded nyata via modul native (dev-client), kosong di Expo Go/web. */

    const  startPairing = async () => {
    setPairing(true);
    try {
      // Daftar BT bonded nyata, perlu dev-client + izin; di Expo Go/web hasilnya kosong.
      const found = await listBondedBtPrinters();
      if (found.length > 0) {
        setBonded((bb) => [
          ...bb,
          ...found
            .filter((f) => !bb.some((b) => b.mac === f.mac))
            .map((f, i) => ({ id: `bt-live-${i}`, name: f.name, mac: f.mac, paired: true })),
        ]);
        setStatusMsg(`${found.length} printer BT bonded terdeteksi.`);
      } else {
        setStatusMsg('Tak ada printer BT bonded terdeteksi - perlu dev-client + izin Bluetooth.');
      }
    } finally {
      setPairing(false);
    }
  };

  const togglePair = (id: string) =>
    setBonded((bb) => bb.map((b) => (b.id === id ? { ...b, paired: !b.paired } : b)));

  /** Uji koneksi LAN: kirim ESC @ (init, aman) via TCP port 9100. */
  const testLan = async () => {
    const ipOk = /^\d{1,3}(\.\d{1,3}){3}$/.test(lanIp.trim());
    const port = Number(lanPort);
    if (!ipOk || !Number.isInteger(port) || port < 1 || port > 65535) {
      setLanMsg('IP/port tidak valid - contoh 192.168.1.50:9100.');
      return;
    }
    setLanMsg(`Menghubungi ${lanIp.trim()}:${port}...`);
    // ESC @ = reset printer, aman dikirim sebagai probe koneksi.
    const res = await printBytes(
      { transport: 'lan', host: lanIp.trim(), port },
      new Uint8Array([0x1b, 0x40]),
    );
    setLanMsg(
      res.ok
        ? `Terhubung - printer menjawab (${res.bytes} byte terkirim).`
        : res.reason === 'connect-failed'
          ? `Koneksi gagal: ${res.detail ?? 'pastikan satu jaringan Wi-Fi'}.`
          : 'Kirim butuh dev-client / modul TCP.',
    );
  };

  /** Buka drawer kas: pulse ESC/POS via printer kasir. */
  const openDrawer = async (s: Station) => {
    const ok = await openCashDrawer(stationTarget(s));
    setStatusMsg(
      ok
        ? `Perintah buka drawer dikirim ke ${s.name}.`
        : `Gagal buka drawer ${s.name} - perlu dev-client (modul native).`,
    );
  };

  /** Test print per station: pratinjau struk + hex ESC/POS, lalu kirim nyata bila bisa. */
  const testPrintStation = async (s: Station) => {
    const bytes = buildReceiptBytes({
      shop: 'ESB CABANG PORIS',
      addr: `Uji cetak - ${s.name}`,
      trx: `${s.role} - ${s.conn} - ${s.cpl} kolom`,
      items: [
        { name: 'Ayam Geprek Pelakor', qty: 1, price: 45000 },
        { name: 'Es Teh Manis', qty: 2, price: 8000 },
      ],
      subtotal: 61000,
      service: 3050,
      total: 64050,
      method: 'Tunai',
    });
    setPreview({ station: s.name, text: previewText(s, hasNativePrinter() ? null : t('printers.detectedHint')), hex: toHex(bytes).slice(0, 240) + '...' });
    const res = await printBytes(stationTarget(s), bytes);
    setStatusMsg(
      res.ok
        ? `Uji cetak ${s.name} terkirim (${res.bytes} byte).`
        : res.reason === 'need-dev-client'
          ? `Pratinjau uji cetak ${s.name} siap (${bytes.length} byte). Kirim nyata butuh dev-client.`
          : `Kirim ke ${s.name} gagal: ${res.detail ?? res.reason}.`,
    );
    if (res.ok) {
      setStations((ss) => ss.map((x) => (x.id === s.id ? { ...x, connected: true } : x)));
    }
  };

  const togglePrinter = (p: PrinterDevice) => {
    setConnectedIds((c) => (c.includes(p.id) ? c.filter((id) => id !== p.id) : [...c, p.id]));
    setConfirm(null);
  };

  const go = (route: string) => navigation?.navigate(route); return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <ScreenHeader title={t('printers.title')} sub={t('printers.sub')} onBack={() => setDrawerOpen(true)} backLabel="☰" /> <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />
        <Text style={styles.groupLabel}>{t('printers.stations')}</Text>
      {stations.map((s) => (
        <View key={s.id} style={styles.stCard}>
          <View style={styles.stTop}>
            <View style={styles.stLeft}>
              <Text style={styles.stName}>{s.name}{s.isDefault ? ` - ${t('printers.main')}` : ''}</Text>
              <Text style={styles.stMeta}>
                {s.conn}{s.address ? ` - ${s.address}` : ''} - {s.connected ? t('printers.connected') : t('printers.disconnected')}
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
            <Text style={styles.stMeta}>{t('printers.autocut')}</Text>
            <Switch value={s.autocut} onValueChange={(v) => patchStation(s.id, { autocut: v })} trackColor={{ true: colors.green, false: colors.stroke }} />
          </View>
          <View style={styles.stBtns}>
            <Pressable style={styles.btnTest} onPress={() => testPrintStation(s)}>
              <Text style={styles.btnTestText}>{t('printers.testPrint')}</Text>
            </Pressable>
            <Pressable style={styles.btnDrawer} onPress={() => openDrawer(s)}>
              <Text style={styles.btnDrawerText}>{t('printers.openDrawer')}</Text>
            </Pressable>
            <Pressable style={styles.btnMini} onPress={() => setDefault(s.id)}>
              <Text style={styles.btnMiniText}>{t('printers.setPrimary')}</Text>
            </Pressable>
            <Pressable style={styles.btnMiniDanger} onPress={() => removeStation(s.id)}>
              <Text style={styles.btnMiniDangerText}>{t('printers.remove')}</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.btnConn, s.connected && styles.btnConnOff]}
            onPress={() => patchStation(s.id, { connected: !s.connected })}>
            <Text style={[styles.btnConnText, s.connected && styles.btnConnOffText]}>
              {s.connected ? t('printers.disconnect') : t('printers.connect')}
            </Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.stCard}>
        <Text style={styles.stName}>{t('printers.addStation')}</Text>
        <TextInput style={styles.input} value={stName} onChangeText={setStName} placeholder={t('printers.stationNamePh')} placeholderTextColor={colors.faint} />
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
          <Text style={styles.btnPrimaryText}>{t('printers.addStation')}</Text>
        </Pressable>
      </View>

      {preview ? (
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>{preview.station}</Text>
          <Text style={styles.previewText}>{preview.text}</Text>
          <Text style={styles.previewHex} numberOfLines={2}>{preview.hex}</Text>
          <Pressable style={[styles.btnTest, { marginTop: 8 }]} onPress={() => shareReceipt(preview.text)}>
            <Text style={styles.btnTestText}>{t('printers.sharePreview')}</Text>
          </Pressable>
        </View>
      ) : null}
      {statusMsg ? <Text style={styles.statusMsg}>{statusMsg}</Text> : null}

      <Text style={styles.groupLabel}>{t('printers.bt')}</Text>
      <View style={styles.panel}>
        <Text style={styles.cardTitle}>{t('printers.btTitle')}</Text>
        <Text style={styles.cardSub}>{t('printers.btSub')}</Text>
        {bonded.map((b) => (
          <View key={b.id} style={styles.btRow}>
            <View style={styles.stLeft}>
              <Text style={styles.stName}>{b.name}</Text>
              <Text style={styles.stMeta}>{b.mac} - {b.paired ? t('printers.paired') : t('printers.notPaired')}</Text>
            </View>
            <Pressable style={b.paired ? styles.btnMiniDanger : styles.btnMini} onPress={() => togglePair(b.id)}>
              <Text style={b.paired ? styles.btnMiniDangerText : styles.btnMiniText}>
                {b.paired ? t('printers.forget') : t('printers.pair')}
              </Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={[styles.btnPrimary, pairing && styles.btnDisabled]} onPress={startPairing} disabled={pairing}>
          <Text style={styles.btnPrimaryText}>{pairing ? t('printers.scanning') : t('printers.scanBt')}</Text>
        </Pressable>
      </View>

      <Text style={styles.groupLabel}>{t('printers.lan')}</Text>
      <View style={styles.panel}>
        <Text style={styles.cardTitle}>{t('printers.lanTitle')}</Text>
        <Text style={styles.cardSub}>{t('printers.lanSub')}</Text>
        <View style={styles.lanRow}>
          <TextInput style={styles.input} value={lanIp} onChangeText={setLanIp} placeholder="192.168.1.50" placeholderTextColor={colors.faint} autoCapitalize="none" />
          <TextInput style={[styles.input, styles.portInput]} value={lanPort} onChangeText={setLanPort} placeholder="9100" placeholderTextColor={colors.faint} keyboardType="numeric" />
        </View>
        <Pressable style={[styles.btnTest, { marginTop: 8 }]} onPress={testLan}>
          <Text style={styles.btnTestText}>{t('printers.testLan')}</Text>
        </Pressable>
        {lanMsg ? <Text style={styles.statusMsg}>{lanMsg}</Text> : null}
      </View>

      <Text style={styles.groupLabel}>{t('printers.detected')}</Text>
      {nativeReady ? null : <Text style={styles.hint}>{t('printers.detectedHint')}</Text>}
      <View style={styles.tabs}>
        {typeFilters.map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.tab, filter === f && styles.tabActive]}>
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}> {f === 'Semua' ? t('common.all') : f} </Text>
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
            <Text style={styles.emptyTitle}>{t('printers.noPrinter')}</Text>
            <Text style={styles.emptySub}>{t('printers.noPrinterSub')}</Text>
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
              <Text style={styles.cardRole}>{item.role} - {on ? t('printers.connected') : t('printers.disconnected')}</Text>
              <View style={styles.cardBtns}>
                <Pressable style={styles.btnTest} onPress={() => testPrintStation({
                  id: item.id, name: item.name, role: 'Kasir', conn: item.type === 'LAN' ? 'LAN' : 'Bluetooth',
                  address: item.address, cpl: 32, autocut: true, isDefault: false, connected: on,
                })}>
                  <Text style={styles.btnTestText}>{t('printers.testPrint')}</Text>
                </Pressable>
                <Pressable style={on ? styles.btnOff : styles.btnOn} onPress={() => (on ? setConfirm(item) : togglePrinter(item))}>
                  <Text style={on ? styles.btnOffText : styles.btnOnText}>{on ? t('printers.disconnect') : t('printers.connect')}</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={confirm !== null} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{t('printers.disconnectTitle')}</Text>
            <Text style={styles.dialogSub}>{t('printers.disconnectSub1')} {confirm?.name} {t('printers.disconnectSub2')}</Text>
            <View style={styles.dialogBtns}>
              <Pressable style={styles.btnGhost} onPress={() => setConfirm(null)}>
                <Text style={styles.btnGhostText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable style={styles.btnDanger} onPress={() => confirm && togglePrinter(confirm)}>
                <Text style={styles.btnDangerText}>{t('printers.yesDisconnect')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>


    </ScrollView>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },

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
  btnTest: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.navy, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', minHeight: 42 },
  btnTestText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy, textAlign: 'center' },
  btnDrawer: { flex: 1, borderRadius: 10, backgroundColor: colors.paleAmber, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', minHeight: 42 },
  btnDrawerText: { fontFamily: fonts.bold, fontSize: 12, color: colors.amberDark, textAlign: 'center' },
  btnMini: { borderRadius: 8, borderWidth: 1, borderColor: colors.navy, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', minHeight: 42 },
  btnMiniText: { fontFamily: fonts.bold, fontSize: 11, color: colors.navy, textAlign: 'center' },
  btnMiniDanger: { borderRadius: 8, backgroundColor: colors.paleRed, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', minHeight: 42 },
  btnMiniDangerText: { fontFamily: fonts.bold, fontSize: 11, color: colors.red, textAlign: 'center' },
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
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, paddingHorizontal: 16, marginTop: 2 },
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
  btnOn: { flex: 1, borderRadius: 10, backgroundColor: colors.green, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', minHeight: 42 },
  btnOnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white, textAlign: 'center' },
  btnOff: { flex: 1, borderRadius: 10, backgroundColor: colors.paleRed, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', minHeight: 42 },
  btnOffText: { fontFamily: fonts.bold, fontSize: 12, color: colors.red, textAlign: 'center' },
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
  btnDangerText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },});