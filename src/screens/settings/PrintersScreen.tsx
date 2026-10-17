import { useEffect, useState } from 'react';import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,} from 'react-native';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import { useLang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { buildReceiptBytes, toHex } from '../../lib/escpos';import { shareReceipt } from '../../lib/print';import { hasNativePrinter, listBlePrinters, listBondedBtPrinters, listUsbDevices, openCashDrawer, printBytes, type PrinterTarget } from '../../native/printer';import type { UsbDeviceInfo } from '../../specs/GenfityPrinter';import { initDb, query, run } from '../../lib/db';import { enqueueOutbox } from '../../lib/sync';import { NATIVE_PREF_KEYS } from '../../lib/master';import { getTerminal } from '../../config/server';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type ConnType = 'Bluetooth' | 'LAN' | 'Star';type StationRole = 'Kasir' | 'Dapur' | 'Checker' | 'Label';interface Station {
  id: string;
  name: string;
  role: StationRole;
  conn: ConnType;
  address: string;
  cpl: 32 | 48;
  autocut: boolean;
  isDefault: boolean;
  connected: boolean;
  /**
   * Binding terminal (APP-PRINTER, audit row 11): station = address book yang
   * diikat ke terminalCode klaim device ini (+branchId). Tanpa binding =
   * warisan global. 1 device = 1 terminal = 1 printer: printer aktif per
   * terminal = station terikatnya (lihat scopeRank di lib/print.ts).
   * Disimpan di cache JSON + ms_station; kolom khusus tak ditambah (tanpa migrasi).
   */
  terminalCode?: string;
  branchId?: string;}interface Bonded {
  id: string;
  name: string;
  mac: string;
  paired: boolean;
  /** true = hasil pindai BLE (mac diawali `BLE:`), bisa langsung dipakai. */
  ble?: boolean;}const LS_STATIONS = 'genfity.printer.stations';

/** Baris ms_station (printerType receipt) -> Station UI. */
interface StationRow {
  id: string; stationName: string | null; printerName: string | null;
  printerPort: string | null; connection: string | null; printerType: string | null;
  charPerLine: number | null; flagDefault: number | null; flagAutocut: number | null;
}
function rowToStation(r: StationRow): Station {
  const connRaw = (r.connection ?? '').trim();
  const conn: ConnType = connRaw === 'LAN' ? 'LAN' : connRaw === 'Star' ? 'Star' : 'Bluetooth';
  const pt = (r.printerType ?? '').trim().toLowerCase();
  const role: StationRole = pt === 'kitchen' ? 'Dapur' : pt === 'checker' ? 'Checker' : pt === 'label' ? 'Label' : 'Kasir';
  return {
    id: String(r.id),
    name: (r.stationName ?? r.printerName ?? r.id ?? '').trim() || String(r.id),
    role, conn,
    address: (r.printerPort ?? '').trim(),
    cpl: Number(r.charPerLine) === 48 ? 48 : 32,
    autocut: Number(r.flagAutocut ?? 1) !== 0,
    isDefault: Number(r.flagDefault ?? 0) !== 0,
    connected: false,
  };
}/** M14: peran UI -> printerType kanonis (sebelumnya persistStation menghardcode
 * 'receipt' sehingga peran Dapur/Checker/Label hilang saat reload DB-first). */
function roleToPrinterType(r: StationRole): string {
  return r === 'Dapur' ? 'kitchen' : r === 'Checker' ? 'checker' : r === 'Label' ? 'label' : 'receipt';
}function roleColor(r: StationRole) {
  if (r === 'Kasir') return colors.navy;
  if (r === 'Dapur') return colors.orange;
  if (r === 'Checker') return colors.blue;
  return colors.green;}/** Susun teks pratinjau struk uji per station. Rupiah selalu via rp(). Baris
 *  catatan dev-client hanya ditambah bila modul native tak tersedia (teks via
 *  kunci printers.detectedHint dari pemanggil agar ikut bahasa aktif). */
function previewText(s: Station, hint: string | null, L: { test: string; role: string; cols: string; cut: string; total: string }): string {
  const bar = '-'.repeat(s.cpl);
  return [
    `${L.test} - ${s.name}`,
    `${L.role} - ${s.conn}${s.address ? ` - ${s.address}` : ''}`,
    `${L.cols} - ${L.cut}`,
    bar,
    '1x Ayam Geprek Pelakor',
    '2x Es Teh Manis',
    bar,
    `${L.total} ${rp(64050)}`,
    ...(hint ? [hint] : []),
  ].join('\n');}/** Bangun target kirim dari konfigurasi stasiun. */function stationTarget(s: Station): PrinterTarget { if (s.conn === 'LAN') { const [host, portRaw] = s.address.split(':'); return { transport: 'lan', host: (host ?? '').trim(), port: Number(portRaw ?? 9100) || 9100 };
}

if (s.conn === 'Star') { const m = s.address.match(/(\d+)\s*\/\s*(\d+)/); return { transport: 'usb', vendorId: m ? Number(m[1]) : 0, productId: m ? Number(m[2]) : 0 }; } const addr = s.address.trim(); if (addr.toUpperCase().startsWith('BLE:')) { const mac = addr.slice(4).trim(); if (mac) return { transport: 'ble', address: mac }; } return { transport: 'bt', address: addr };}/** Simpan station ke ms_station agar konfigurasi perangkat ikut sync master.
 * M14: peran dipetakan via roleToPrinterType + UPSERT kolom-terkelola (kolom
 * server lain lestari; binding terminalCode/branchId tetap di cache JSON). */async function persistStation(s: Station): Promise<void> { try { await initDb(); await run( `INSERT INTO ms_station (id, stationName, printerName, printerPort, connection, printerType, charPerLine, flagDefault, flagActive, flagAutocut, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL) ON CONFLICT (id) DO UPDATE SET stationName = excluded.stationName, printerName = excluded.printerName, printerPort = excluded.printerPort, connection = excluded.connection, printerType = excluded.printerType, charPerLine = excluded.charPerLine, flagDefault = excluded.flagDefault, flagAutocut = excluded.flagAutocut, syncDate = NULL`, [s.id, s.name, s.name, s.address, s.conn, roleToPrinterType(s.role), s.cpl, s.isDefault ? 1 : 0, s.autocut ? 1 : 0], ); await enqueueOutbox('ms_station', s.id, 'update'); } catch { /* abaikan: cache JSON di bawah tetap menyimpan */ }}export default function PrintersScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false);
  const [stations, setStations] = useState<Station[]>([]);
  const [bonded, setBonded] = useState<Bonded[]>([]);
  const [pairing, setPairing] = useState(false);
  const [bleScanning, setBleScanning] = useState(false);
  const [usbScanning, setUsbScanning] = useState(false);
  const [usbList, setUsbList] = useState<UsbDeviceInfo[]>([]);
  const [lanIp, setLanIp] = useState('192.168.1.50');
  const [lanPort, setLanPort] = useState('9100');
  const [lanMsg, setLanMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [preview, setPreview] = useState<{ station: string; text: string; hex: string } | null>(null);
  const [stName, setStName] = useState('');
  const [stRole, setStRole] = useState<StationRole>('Dapur');
  const [stConn, setStConn] = useState<ConnType>('Bluetooth');
  // Modul native ada = jalan di dev-client/APK produksi; tidak ada = Expo Go/web.
  // Dipakai untuk menyembunyikan catatan dev-client bila sudah tidak relevan.
  const [nativeReady] = useState(hasNativePrinter);
  // Terminal klaim device ini (APP-PRINTER): acuan binding station + printer aktif.
  const [activeTerm] = useState(() => {
    try {
      return getTerminal();
    } catch {
      return { terminalCode: '', branchId: '' } as { terminalCode?: string; branchId?: string };
    }
  });

  /** Label peran station ikut bahasa aktif (nilai kanonis tetap ID di state). */
  const roleLabel = (r: StationRole) =>
    r === 'Kasir' ? t('printers.role_kasir') : r === 'Dapur' ? t('printers.role_dapur') : r === 'Checker' ? t('printers.role_checker') : t('printers.role_label');

  // DB-first: printer terkonfigurasi (printerPort terisi) dari ms_station;
  // cache JSON hanya fallback bila DB kosong/belum siap.
  // M14: hasil DB di-MERGE dengan cache (binding + station cache-only), bukan ditimpa.
  useEffect(() => {
    let alive = true;
    (async () => {
      // M14: cache dibaca dulu agar binding bisa di-merge ke baris DB.
      let cached: Station[] = [];
      try {
        cached = await getJSON<Station[]>(LS_STATIONS, []);
      } catch { /* daftar kosong */ }
      try {
        await initDb();
        const rows = await query<StationRow>(
          `SELECT id, stationName, printerName, printerPort, connection, printerType,
                  charPerLine, flagDefault, flagAutocut
             FROM ms_station WHERE flagActive = 1
               AND printerPort IS NOT NULL AND TRIM(printerPort) <> ''
             ORDER BY flagDefault DESC LIMIT 20`,
        );
        if (!alive) return;
        // M14: MERGE — binding (terminalCode/branchId, tanpa kolom DB) + station
        // cache-only ditempel ke baris DB; menimpa mentah membunuh keduanya.
        const bindOf = new Map(cached.filter((c) => c.id).map((c) => [c.id, c] as const));
        const mapped = rows.filter((r) => r.id).map(rowToStation).map((m) => {
          const c = bindOf.get(m.id);
          if (!c) return m;
          bindOf.delete(m.id);
          return {
            ...m,
            ...(c.terminalCode ? { terminalCode: c.terminalCode } : {}),
            ...(c.branchId ? { branchId: c.branchId } : {}),
          };
        });
        for (const rest of bindOf.values()) mapped.push(rest);
        if (mapped.length > 0) {
          if (alive) setStations(mapped);
          return;
        }
      } catch { /* DB belum siap — fallback cache di bawah */ }
      if (alive) setStations(cached);
    })();
    return () => { alive = false; };
  }, []); useEffect(() => { void setJSON(LS_STATIONS, stations); }, [stations]);

  const patchStation = (id: string, patch: Partial<Station>) =>
    { setStations((ss) => { const next = ss.map((x) => (x.id === id ? { ...x, ...patch } : x));

  const changed = next.find((x) => x.id === id); if (changed) void persistStation(changed); return next; }); }; const setDefault = (id: string) =>
    { setStations((ss) => { const next = ss.map((x) => ({ ...x, isDefault: x.id === id })); next.forEach((x) => { void persistStation(x); }); return next; }); };

  /** Ikat station ke terminal klaim device ini (1 terminal = 1 printer aktif). */
  const bindStation = (id: string) => {
    const term = String(activeTerm.terminalCode ?? '').trim().toUpperCase();
    const br = String(activeTerm.branchId ?? '').trim();
    if (!term) {
      setStatusMsg('Terminal belum diklaim - klaim terminal dulu sebelum mengikat printer.');
      return;
    }
    setStations((ss) => {
      const next = ss.map((x) => (x.id === id ? { ...x, terminalCode: term, branchId: br || undefined } : x));
      const changed = next.find((x) => x.id === id);
      if (changed) void persistStation(changed);
      return next;
    });
    setStatusMsg(`Printer diikat ke terminal ${term}.`);
  };
  /** Lepas binding → station kembali jadi address book global (warisan). */
  const unbindStation = (id: string) =>
    { setStations((ss) => { const next = ss.map((x) => (x.id === id ? { ...x, terminalCode: undefined, branchId: undefined } : x));

  const changed = next.find((x) => x.id === id); if (changed) void persistStation(changed); return next; }); };

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
        setStatusMsg(t('printers.btFound').replace('{n}', String(found.length)));
      } else {
        setStatusMsg(t('printers.btNone'));
      }
    } finally {
      setPairing(false);
    }
  };

  /** Pindai BLE ±8 detik: hasil masuk daftar bonded (mac `BLE:`), siap dipakai. */
  const startBleScan = async () => {
    setBleScanning(true);
    try {
      const found = await listBlePrinters();
      if (found.length > 0) {
        setBonded((bb) => [
          ...bb,
          ...found
            .filter((f) => !bb.some((b) => b.mac === `BLE:${f.mac}`))
            .map((f, i) => ({ id: `ble-live-${Date.now()}-${i}`, name: f.name, mac: `BLE:${f.mac}`, paired: true, ble: true })),
        ]);
        setStatusMsg(t('printers.bleFound').replace('{n}', String(found.length)));
      } else {
        setStatusMsg(t('printers.bleNone'));
      }
    } finally {
      setBleScanning(false);
    }
  };

  /** Pakai perangkat hasil pindai (BLE/USB) ke printer utama. */
  const useOnPrimary = (patch: Partial<Station>, msg: string) => {
    setStations((ss) => {
      const next = ss.map((x) => (x.isDefault ? { ...x, ...patch } : x));
      const d = next.find((x) => x.isDefault);
      if (d) void persistStation(d);
      return next;
    });
    setStatusMsg(msg);
  };
  const useBleDevice = (b: Bonded) =>
    useOnPrimary({ conn: 'Bluetooth', address: b.mac }, t('printers.bleApplied').replace('{x}', b.name));

  /** Pindai USB OTG: tanpa hafal VID/PID. */
  const scanUsb = async () => {
    setUsbScanning(true);
    try {
      const found = await listUsbDevices();
      setUsbList(found);
      setStatusMsg(
        found.length > 0
          ? t('printers.usbFound').replace('{n}', String(found.length))
          : t('printers.usbNone'),
      );
    } finally {
      setUsbScanning(false);
    }
  };
  const useUsbDevice = (v: UsbDeviceInfo) =>
    useOnPrimary({ conn: 'Star', address: `${v.vendorId}/${v.productId}` }, t('printers.usbApplied').replace('{x}', v.name));

  const togglePair = (id: string) =>
    setBonded((bb) => bb.map((b) => (b.id === id ? { ...b, paired: !b.paired } : b)));

  /** Uji koneksi LAN: kirim ESC @ (init, aman) via TCP port 9100. */
  const testLan = async () => {
    const ipOk = /^\d{1,3}(\.\d{1,3}){3}$/.test(lanIp.trim());
    const port = Number(lanPort);
    if (!ipOk || !Number.isInteger(port) || port < 1 || port > 65535) {
      setLanMsg(t('printers.lanInvalid'));
      return;
    }
    setLanMsg(t('printers.lanCalling').replace('{x}', `${lanIp.trim()}:${port}`));
    // ESC @ = reset printer, aman dikirim sebagai probe koneksi.
    const res = await printBytes(
      { transport: 'lan', host: lanIp.trim(), port },
      new Uint8Array([0x1b, 0x40]),
    );
    setLanMsg(
      res.ok
        ? t('printers.lanOk').replace('{n}', String(res.bytes))
        : res.reason === 'connect-failed'
          ? t('printers.lanFail').replace('{x}', res.detail ?? t('printers.lanSameWifi'))
          : t('printers.lanNeedClient'),
    );
  };

  /** Buka drawer kas: pulse ESC/POS via printer kasir. */
  const openDrawer = async (s: Station) => {
    const ok = await openCashDrawer(stationTarget(s));
    setStatusMsg(
      ok
        ? t('printers.drawerOk').replace('{x}', s.name)
        : t('printers.drawerFail').replace('{x}', s.name),
    );
  };

  /** Test print per station: pratinjau struk + hex ESC/POS, lalu kirim nyata bila bisa. */
  const testPrintStation = async (s: Station) => {
    const bytes = buildReceiptBytes({
      cols: s.cpl,
      shop: 'GENFITY CABANG PORIS',
      addr: `${t('printers.receiptTest')} - ${s.name}`,
      trx: `${roleLabel(s.role)} - ${s.conn} - ${t('printers.receiptCols').replace('{n}', String(s.cpl))}`,
      items: [
        { name: 'Ayam Geprek Pelakor', qty: 1, price: 45000 },
        { name: 'Es Teh Manis', qty: 2, price: 8000 },
      ],
      subtotal: 61000,
      service: 3050,
      total: 64050,
      method: t('pay_tab_cash'),
    });
    setPreview({ station: s.name, text: previewText(s, hasNativePrinter() ? null : t('printers.detectedHint'), { test: t('printers.receiptTest'), role: roleLabel(s.role), cols: t('printers.receiptCols').replace('{n}', String(s.cpl)), cut: s.autocut ? t('printers.receiptCut') : t('printers.receiptNoCut'), total: t('c_total') }), hex: toHex(bytes).slice(0, 240) + '...' });
    const res = await printBytes(stationTarget(s), bytes);
    setStatusMsg(
      res.ok
        ? t('printers.testOk').replace('{x}', s.name).replace('{n}', String(res.bytes))
        : res.reason === 'need-dev-client'
          ? t('printers.testPreview').replace('{x}', s.name).replace('{n}', String(bytes.length))
          : t('printers.testFail').replace('{x}', s.name).replace('{e}', String(res.detail ?? res.reason)),
    );
    if (res.ok) {
      setStations((ss) => ss.map((x) => (x.id === s.id ? { ...x, connected: true } : x)));
    }
  };

  const go = (route: string) => navigation?.navigate(route); return (
    <View style={styles.root}>
      <ScreenHeader title={t('printers.title')} sub={t('printers.sub')} left={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
          <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
        </TouchableOpacity>
      } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
        {/* APP-PRINTER (audit row 11): 1 device = 1 terminal = 1 printer.
            Printer aktif = station yang terikat terminal di bawah ini. */}
        <View style={styles.stCard}>
          <Text style={styles.stName}>
            {String(activeTerm.terminalCode ?? '').trim() ? `Terminal: ${String(activeTerm.terminalCode).trim().toUpperCase()}` : 'Terminal: belum diklaim'}
          </Text>
          <Text style={styles.stMeta}>
            {String(activeTerm.branchId ?? '').trim() ? `Cabang: ${String(activeTerm.branchId).trim()}` : 'Klaim terminal dulu sebelum mengikat printer'}
          </Text>
        </View>
        <Text style={styles.groupLabel}>{t('printers.stations')}</Text>
        {/* WIRE REA-16: kunci prefs native printer (info status, best-effort) */}
        <View style={styles.stCard}>
          <Text style={styles.stName}>native</Text>
          <Text style={styles.stMeta}>{NATIVE_PREF_KEYS.bluetoothPrinter} - {nativeReady ? t('printers.connected') : t('printers.disconnected')}</Text>
          <Text style={styles.stMeta}>{NATIVE_PREF_KEYS.usbPrinter} - {nativeReady ? t('printers.connected') : t('printers.disconnected')}</Text>
        </View>
      {stations.length === 0 ? (
        <View style={styles.empty}>
          <Image source={require('../../../assets/images/empty_printer.webp')} style={styles.emptyImg} resizeMode="contain" />
          <Text style={styles.emptyTitle}>{t('printers.noPrinter')}</Text>
          <Text style={styles.emptySub}>{t('printers.noPrinterSub')}</Text>
        </View>
      ) : null}
      {stations.map((s) => (
        <View key={s.id} style={styles.stCard}>
          <View style={styles.stTop}>
            <View style={styles.stLeft}>
              <Text style={styles.stName}>{s.name}{s.isDefault ? ` - ${t('printers.main')}` : ''}</Text>
              <Text style={styles.stMeta}>
                {s.conn}{s.address ? ` - ${s.address}` : ''} - {s.connected ? t('printers.connected') : t('printers.disconnected')}
              </Text>
              {/* APP-PRINTER: label binding terminal (tanpa kunci i18n baru). */}
              <Text style={styles.stMeta}>
                {s.terminalCode ? `Terminal: ${s.terminalCode}${s.branchId ? ` · ${s.branchId}` : ''}` : 'Belum terikat terminal (address book global)'}
              </Text>
            </View>
            <View style={[styles.roleBadge, { backgroundColor: roleColor(s.role) }]}>
              <Text style={styles.roleText}>{roleLabel(s.role)}</Text>
            </View>
          </View>
          <AppInput key={`${s.id}-${s.address}`} defaultValue={s.address} onEndEditing={(e) => patchStation(s.id, { address: e.nativeEvent.text.trim() })} placeholder={t('printers.addrPh')} autoCapitalize="none" />
          <View style={styles.chipRow}>
            {(['Kasir', 'Dapur', 'Checker', 'Label'] as StationRole[]).map((r) => (
              <Pressable key={r} onPress={() => patchStation(s.id, { role: r })} style={[styles.chip, s.role === r && styles.chipActive]}>
                <Text style={[styles.chipText, s.role === r && styles.chipTextActive]}>{roleLabel(r)}</Text>
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
                <Text style={[styles.chipText, s.cpl === c && styles.chipTextActive]}>{t('printers.cols').replace('{n}', String(c))}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.stRowBetween}>
            <Text style={styles.stMeta}>{t('printers.autocut')}</Text>
            <Switch value={s.autocut} onValueChange={(v) => patchStation(s.id, { autocut: v })} trackColor={{ true: colors.green, false: colors.stroke }} />
          </View>
          <View style={styles.stBtns}>
            <AppButton size="md" title={t('printers.testPrint')} onPress={() => testPrintStation(s)} variant="secondary" fullWidth={false} style={[styles.btnFlex, isTablet && styles.actBtnTablet]} />
            <AppButton size="md" title={t('printers.openDrawer')} onPress={() => openDrawer(s)} variant="secondary" fullWidth={false} style={[styles.amberFlex, isTablet && styles.actBtnTablet]} textStyle={styles.amberText} />
            <AppButton size="md" title={t('printers.setPrimary')} onPress={() => setDefault(s.id)} variant="secondary" fullWidth={false} style={[styles.btnFlex, isTablet && styles.actBtnTablet]} />
            <AppButton size="md" title={t('printers.remove')} onPress={() => removeStation(s.id)} variant="danger" fullWidth={false} style={[styles.paleRedFlex, isTablet && styles.actBtnTablet]} textStyle={styles.redText} />
          </View>
          {s.connected ? (
            <AppButton size="md" title={t('printers.disconnect')} onPress={() => patchStation(s.id, { connected: !s.connected })} variant="danger" style={styles.paleRedBlock} textStyle={styles.redText} />
          ) : (
            <AppButton size="md" title={t('printers.connect')} onPress={() => patchStation(s.id, { connected: !s.connected })} style={styles.greenBlock} />
          )}
          {/* APP-PRINTER: satu printer aktif per terminal klaim (literal netral, tanpa kunci baru). */}
          {s.terminalCode ? (
            <AppButton size="md" title="Lepas dari terminal ini" onPress={() => unbindStation(s.id)} variant="secondary" style={styles.blockGap} />
          ) : (
            <AppButton size="md" title="Pakai di terminal ini" onPress={() => bindStation(s.id)} style={styles.greenBlock} />
          )}
        </View>
      ))}
      <View style={styles.stCard}>
        <Text style={styles.stName}>{t('printers.addStation')}</Text>
        <AppInput value={stName} onChangeText={setStName} placeholder={t('printers.stationNamePh')} />
        <View style={styles.chipRow}>
          {(['Kasir', 'Dapur', 'Checker', 'Label'] as StationRole[]).map((r) => (
            <Pressable key={r} onPress={() => setStRole(r)} style={[styles.chip, stRole === r && styles.chipActive]}>
              <Text style={[styles.chipText, stRole === r && styles.chipTextActive]}>{roleLabel(r)}</Text>
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
        <AppButton title={t('printers.addStation')} onPress={addStation} disabled={!stName.trim()} style={styles.navyBlock} />
      </View>

      {preview ? (
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>{preview.station}</Text>
          <Text style={styles.previewText}>{preview.text}</Text>
          <Text style={styles.previewHex} numberOfLines={2}>{preview.hex}</Text>
          <AppButton title={t('printers.sharePreview')} onPress={() => shareReceipt(preview.text)} variant="secondary" style={styles.blockGap} />
        </View>
      ) : null}
      {statusMsg ? <Text style={styles.statusMsg}>{statusMsg}</Text> : null}

      <Text style={styles.groupLabel}>{t('printers.bt')}</Text>
      <View style={styles.panel}>
        <Text style={styles.cardTitle}>{t('printers.btTitle')}</Text>
        <Text style={styles.cardSub}>{t('printers.btSub')}</Text>
        {bonded.length === 0 ? <Text style={styles.hint}>{t('printers.btNone')}</Text> : null}
        {bonded.map((b) => (
          <View key={b.id} style={styles.btRow}>
            <View style={styles.stLeft}>
              <Text style={styles.stName}>{b.name}</Text>
              <Text style={styles.stMeta}>{b.mac} - {b.paired ? t('printers.paired') : t('printers.notPaired')}</Text>
            </View>
            {b.ble ? (
              <AppButton size="sm" title={t('printers.useDevice')} onPress={() => useBleDevice(b)} fullWidth={false} style={styles.btnInline} />
            ) : b.paired ? (
              <AppButton size="sm" title={t('printers.forget')} onPress={() => togglePair(b.id)} variant="danger" fullWidth={false} style={styles.btnInlinePale} textStyle={styles.redText} />
            ) : (
              <AppButton size="sm" title={t('printers.pair')} onPress={() => togglePair(b.id)} variant="secondary" fullWidth={false} style={styles.btnInline} />
            )}
          </View>
        ))}
        <AppButton title={pairing ? t('printers.scanning') : t('printers.scanBt')} onPress={startPairing} disabled={pairing || bleScanning} style={styles.navyBlock} />
        <AppButton title={bleScanning ? t('printers.scanningBle') : t('printers.scanBle')} onPress={startBleScan} disabled={bleScanning || pairing} variant="secondary" style={styles.blockGap} />
      </View>

      <Text style={styles.groupLabel}>{t('printers.lan')}</Text>
      <View style={styles.panel}>
        <Text style={styles.cardTitle}>{t('printers.lanTitle')}</Text>
        <Text style={styles.cardSub}>{t('printers.lanSub')}</Text>
        <View style={styles.lanRow}>
          <View style={styles.formFlex}>
            <AppInput value={lanIp} onChangeText={setLanIp} placeholder="192.168.1.50" autoCapitalize="none" />
          </View>
          <View style={styles.portWrap}>
            <AppInput value={lanPort} onChangeText={setLanPort} placeholder="9100" keyboardType="numeric" />
          </View>
        </View>
        <AppButton title={t('printers.testLan')} onPress={testLan} variant="secondary" style={styles.blockGap} />
        {lanMsg ? <Text style={styles.statusMsg}>{lanMsg}</Text> : null}
      </View>

      <Text style={styles.groupLabel}>USB</Text>
      <View style={styles.panel}>
        <Text style={styles.cardTitle}>{t('printers.usbTitle')}</Text>
        <Text style={styles.cardSub}>{t('printers.usbSub')}</Text>
        {usbList.map((u) => (
          <View key={`${u.vendorId}-${u.productId}`} style={styles.btRow}>
            <View style={styles.stLeft}>
              <Text style={styles.stName}>{u.name}</Text>
              <Text style={styles.stMeta}>{u.vendorId}/{u.productId}</Text>
            </View>
            <AppButton size="sm" title={t('printers.useDevice')} onPress={() => useUsbDevice(u)} fullWidth={false} style={styles.btnInline} />
          </View>
        ))}
        <AppButton title={usbScanning ? t('printers.scanning') : t('printers.usbScan')} onPress={scanUsb} disabled={usbScanning} variant="secondary" style={styles.blockGap} />
      </View>
      </ScrollView>
    </View>
  );}const styles = StyleSheet.create({
  burger: { width: 22, height: 22 },
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { paddingBottom: 32 },

  groupLabel: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginTop: 18, marginBottom: 6, paddingHorizontal: 16 },
  formFlex: { flex: 1 },
  portWrap: { flex: 1, maxWidth: 100 },
  btnInline: { marginTop: 0 },
  btnInlinePale: { marginTop: 0, backgroundColor: colors.paleRed },
  btnFlex: { marginTop: 0, flex: 1 },
  navyBlock: { marginTop: 10, backgroundColor: colors.navy },
  blockGap: { marginTop: 8 },
  greenFlex: { marginTop: 0, flex: 1, backgroundColor: colors.green },
  greenBlock: { marginTop: 8, backgroundColor: colors.green },
  paleRedFlex: { marginTop: 0, flex: 1, backgroundColor: colors.paleRed },
  paleRedBlock: { marginTop: 8, backgroundColor: colors.paleRed },
  redText: { color: colors.red },
  amberFlex: { marginTop: 0, flex: 1, backgroundColor: colors.paleAmber, borderColor: colors.paleAmber },
  amberText: { color: colors.amberDark },
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
  stBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  // Tablet: tombol aksi station jadi grid 2x2 (basis 48% + minWidth), phone tetap 1 baris.
  actBtnTablet: { flexBasis: '48%', flexGrow: 1, minWidth: 140 },
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