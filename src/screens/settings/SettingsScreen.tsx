import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenter } from '../../theme';
import { logout } from '../../session';
import { getBaseUrl, getCustomBaseUrl, getServerEnv, getTerminal, setCustomBaseUrl, setServerEnv, setTerminal, type ServerEnv } from '../../config/server';
import { getNotif, setNotif } from '../../config/device';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

const ENVS: ServerEnv[] = ['prod', 'dev', 'staging', 'custom'];
const ENV_LABEL: Record<ServerEnv, string> = { prod: 'Prod', dev: 'Dev', staging: 'Staging', custom: 'Custom' };

export default function SettingsScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [soundNewOrder, setSoundNewOrder] = useState(() => getNotif().soundNewOrder);
  const [customerDisplay, setCustomerDisplay] = useState(() => getNotif().customerDisplay);
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(() => getNotif().autoPrintKitchen);
  const [autoCut, setAutoCut] = useState(true);
  const [lang, setLang] = useState<'ID' | 'EN'>('ID');
  const [serverEnv, setServerEnvState] = useState<ServerEnv>(() => getServerEnv());
  const [customUrl, setCustomUrl] = useState(() => getCustomBaseUrl());
  const [terminal, setTerminalState] = useState(() => getTerminal());
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [draftCode, setDraftCode] = useState('');
  const [draftBranchId, setDraftBranchId] = useState('');
  const [draftBranchName, setDraftBranchName] = useState('');

  const go = (route: string) => navigation?.navigate(route);

  const pickEnv = (e: ServerEnv) => {
    setServerEnv(e);
    setServerEnvState(e);
  };

  const saveCustom = () => {
    setCustomBaseUrl(customUrl);
  };

  const openTerminal = () => {
    setDraftCode(terminal.terminalCode);
    setDraftBranchId(terminal.branchId);
    setDraftBranchName(terminal.branchName);
    setTerminalOpen(true);
  };

  const saveTerminal = () => {
    const next = { terminalCode: draftCode.trim(), branchId: draftBranchId.trim(), branchName: draftBranchName.trim() };
    setTerminal(next);
    setTerminalState(next);
    setTerminalOpen(false);
  };

  const terminalSub = terminal.terminalCode
    ? `${terminal.terminalCode} • ${terminal.branchName || terminal.branchId || '—'}`
    : 'Belum diklaim — isi kode terminal';

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, isTablet && wideCenter]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Pengaturan</Text>
        <Text style={styles.headerSub}>Toko Maju Jaya • Cabang Pusat</Text>
      </View>

      <Text style={styles.groupLabel}>Terminal & Server</Text>
      <MenuRow title="Terminal" sub={terminalSub} onPress={openTerminal} />
      <View style={styles.panel}>
        <Text style={styles.cardTitle}>Server</Text>
        <Text style={styles.cardSub}>{getBaseUrl() || 'Belum diisi (mode Custom kosong)'}</Text>
        <View style={styles.envRow}>
          {ENVS.map((e) => (
            <Pressable key={e} onPress={() => pickEnv(e)} style={[styles.envBtn, serverEnv === e && styles.envBtnActive]}>
              <Text style={[styles.envText, serverEnv === e && styles.envTextActive]}>{ENV_LABEL[e]}</Text>
            </Pressable>
          ))}
        </View>
        {serverEnv === 'custom' && (
          <View style={styles.customRow}>
            <TextInput
              style={styles.input}
              value={customUrl}
              onChangeText={setCustomUrl}
              placeholder="https://server-anda/api/web"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
            />
            <Pressable style={styles.saveBtn} onPress={saveCustom}>
              <Text style={styles.saveBtnText}>Simpan</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Text style={styles.groupLabel}>Printer & Cetak</Text>
      <MenuRow title="Koneksi Printer" sub="Station kasir/dapur · BT · LAN · Star" onPress={() => go('Printers')} />
      <MenuRow title="Pengaturan Cetakan Menu" sub="Routing cetak per menu → station dapur/checker" onPress={() => go('MenuPrinting')} />
      <MenuRow title="Manajemen Menu" sub="Unduh gambar · tandai habis" onPress={() => go('MenuManagement')} />
      <MenuRow
        title="Potong Otomatis"
        sub="Potong kertas otomatis setelah cetak"
        right={
          <Switch value={autoCut} onValueChange={setAutoCut} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />

      <Text style={styles.groupLabel}>Operasional</Text>
      <MenuRow title="Pengaturan Stok" sub="Lacak stok · stok menu online" onPress={() => go('Stock')} />
      <MenuRow title="Timer Meja" sub="Batas waktu duduk + peringatan" onPress={() => go('TableTimer')} />
      <MenuRow title="Tiket Dapur" sub="Lihat antrean masak & saji" onPress={() => go('Kitchen')} />
      <MenuRow title="Pesanan ESB" sub="Pesanan online dari agregator" onPress={() => go('EsbOrder')} />
      <MenuRow title="Pengaturan Meja" sub="Denah, kapasitas, status" onPress={() => go('Tables')} />
      <MenuRow
        title="Bunyi Pesanan Baru"
        sub="Memberikan info pesanan baru dengan suara"
        right={
          <Switch value={soundNewOrder} onValueChange={(v) => { setSoundNewOrder(v); setNotif({ soundNewOrder: v }); }} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />
      <MenuRow
        title="Cetak Otomatis Dapur"
        sub="Kirim tiket ke printer dapur saat bayar"
        right={
          <Switch value={autoPrintKitchen} onValueChange={(v) => { setAutoPrintKitchen(v); setNotif({ autoPrintKitchen: v }); }} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />

      <Text style={styles.groupLabel}>Tampilan & Pindai</Text>
      <MenuRow title="Tampilan Pelanggan" sub="Layar info pesanan untuk pelanggan" onPress={() => go('CustomerDisplay')} right={
        <Switch value={customerDisplay} onValueChange={(v) => { setCustomerDisplay(v); setNotif({ customerDisplay: v }); }} trackColor={{ true: colors.green, false: colors.stroke }} />
      } />
      <MenuRow title="Layar Idle / Promosi" sub="Tampilan promosi saat tidak dipakai" onPress={() => go('Idle')} />
      <MenuRow title="Scan QR" sub="Klaim terminal · ESB order · member" onPress={() => go('QrScan')} />

      <Text style={styles.groupLabel}>Data & Bantuan</Text>
      <MenuRow title="Sinkronisasi Data" sub="Push/pull manual · antrean offline" onPress={() => go('Sync')} />
      <MenuRow title="Log Aplikasi" sub="Riwayat kejadian + detail" onPress={() => go('Log')} />
      <MenuRow
        title="Bahasa"
        sub={lang === 'ID' ? 'Indonesia' : 'English'}
        right={
          <View style={styles.langRow}>
            {(['ID', 'EN'] as const).map((l) => (
              <Pressable key={l} onPress={() => setLang(l)} style={[styles.lang, lang === l && styles.langActive]}>
                <Text style={[styles.langText, lang === l && styles.langTextActive]}>{l}</Text>
              </Pressable>
            ))}
          </View>
        }
      />
      <MenuRow title="Bantuan / FAQ" sub="Panduan & pertanyaan umum" onPress={() => go('Help')} />
      <MenuRow title="Tentang Aplikasi" sub="Genfity Order v1.0.0" onPress={() => go('About')} />

      <Pressable
        style={styles.logout}
        onPress={() => {
          logout();
          navigation?.navigate('Login');
        }}>
        <Text style={styles.logoutText}>Keluar</Text>
      </Pressable>
      <Text style={styles.version}>v1.0.0 • genfity-order</Text>

      <Modal visible={terminalOpen} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={[styles.dialog, styles.dialogNarrow]}>
            <Text style={styles.dialogTitle}>Klaim Terminal</Text>
            <Text style={styles.dialogSub}>Samakan dengan data terminal di server Anda.</Text>
            <Text style={styles.fieldLabel}>Kode Terminal</Text>
            <TextInput style={styles.input} value={draftCode} onChangeText={setDraftCode} placeholder="TRM-001" placeholderTextColor={colors.faint} autoCapitalize="characters" />
            <Text style={styles.fieldLabel}>ID Cabang</Text>
            <TextInput style={styles.input} value={draftBranchId} onChangeText={setDraftBranchId} placeholder="BR-01" placeholderTextColor={colors.faint} />
            <Text style={styles.fieldLabel}>Nama Cabang</Text>
            <TextInput style={styles.input} value={draftBranchName} onChangeText={setDraftBranchName} placeholder="Cabang Poris" placeholderTextColor={colors.faint} />
            <View style={styles.dialogBtns}>
              <Pressable style={styles.btnGhost} onPress={() => setTerminalOpen(false)}>
                <Text style={styles.btnGhostText}>Batal</Text>
              </Pressable>
              <Pressable style={styles.btnPrimary} onPress={saveTerminal}>
                <Text style={styles.btnPrimaryText}>Simpan</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function MenuRow({
  title,
  sub,
  onPress,
  right,
}: {
  title: string;
  sub: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress} disabled={!onPress && !right}>
      <View style={styles.cardLeft}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{sub}</Text>
      </View>
      {right ?? (onPress ? <Text style={styles.chev}>›</Text> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 32 },
  header: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 18, paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  groupLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.navy,
    marginTop: 18,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
  },
  panel: {
    backgroundColor: colors.card,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardLeft: { flex: 1, paddingRight: 10 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  chev: { fontSize: 22, color: colors.faint, fontFamily: fonts.bold },
  langRow: { flexDirection: 'row', gap: 6 },
  lang: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  langActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  langText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  langTextActive: { color: colors.white },
  envRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  envBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    alignItems: 'center',
  },
  envBtnActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  envText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  envTextActive: { color: colors.white },
  customRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  input: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.white,
    marginTop: 6,
  },
  saveBtn: { borderRadius: 10, backgroundColor: colors.navy, paddingHorizontal: 16, justifyContent: 'center', marginTop: 6 },
  saveBtnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  fieldLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted, marginTop: 10 },
  centerWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogNarrow: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dialogSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4 },
  dialogBtns: { flexDirection: 'row', gap: 8, marginTop: 16 },
  btnGhost: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  btnPrimary: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.navy,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnPrimaryText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  logout: {
    marginHorizontal: 16,
    marginTop: 22,
    borderRadius: 12,
    backgroundColor: colors.paleRed,
    paddingVertical: 13,
    alignItems: 'center',
  },
  logoutText: { fontFamily: fonts.bold, fontSize: 14, color: colors.red },
  version: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 12,
  },
});
