import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { TABLET_BP, colors, fonts, wideCenter } from '../../theme';
import { useLang, type Lang } from '../../lib/i18n';
import { logout } from '../../session';
import { getBaseUrl, getCustomBaseUrl, getServerEnv, getTerminal, setCustomBaseUrl, setServerEnv, setTerminal, type ServerEnv } from '../../config/server';
import { getNotif, setNotif } from '../../config/device';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

const ENVS: ServerEnv[] = ['prod', 'dev', 'staging', 'custom'];
const ENV_LABEL: Record<ServerEnv, string> = { prod: 'Prod', dev: 'Dev', staging: 'Staging', custom: 'Custom' };

export default function SettingsScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t, lang, setLang } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [soundNewOrder, setSoundNewOrder] = useState(() => getNotif().soundNewOrder);
  const [customerDisplay, setCustomerDisplay] = useState(() => getNotif().customerDisplay);
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(() => getNotif().autoPrintKitchen);
  const [autoCut, setAutoCut] = useState(true);
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

  const pickLang = (l: Lang) => setLang(l);

  const terminalSub = terminal.terminalCode
    ? `${terminal.terminalCode} - ${terminal.branchName || terminal.branchId || '-'}`
    : t('settings.notClaimed');

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, isTablet && wideCenter]}>
      <ScreenHeader
        title={t('settings.title')}
        sub={t('settings.sub')}
        onBack={() => setDrawerOpen(true)}
        backLabel="☰"
      />
      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />

      <Text style={styles.groupLabel}>{t('settings.terminalServer')}</Text>
      <MenuRow title={t('settings.terminal')} sub={terminalSub} onPress={openTerminal} />
      <View style={styles.panel}>
        <Text style={styles.cardTitle}>{t('settings.server')}</Text>
        <Text style={styles.cardSub}>{getBaseUrl() || t('settings.noServer')}</Text>
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
              <Text style={styles.saveBtnText}>{t('common.save')}</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Text style={styles.groupLabel}>{t('settings.printerPrint')}</Text>
      <MenuRow title={t('settings.printConn')} sub={t('settings.printConnSub')} onPress={() => go('Printers')} />
      <MenuRow title={t('settings.menuPrint')} sub={t('settings.menuPrintSub')} onPress={() => go('MenuPrinting')} />
      <MenuRow title={t('settings.menuMgmt')} sub={t('settings.menuMgmtSub')} onPress={() => go('MenuManagement')} />
      <MenuRow
        title={t('settings.autoCut')}
        sub={t('settings.autoCutSub')}
        right={
          <Switch value={autoCut} onValueChange={setAutoCut} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />

      <Text style={styles.groupLabel}>{t('settings.operational')}</Text>
      <MenuRow title={t('settings.stock')} sub={t('settings.stockSub')} onPress={() => go('Stock')} />
      <MenuRow title={t('settings.tableTimer')} sub={t('settings.tableTimerSub')} onPress={() => go('TableTimer')} />
      <MenuRow title={t('settings.kitchen')} sub={t('settings.kitchenSub')} onPress={() => go('Kitchen')} />
      <MenuRow title={t('settings.esb')} sub={t('settings.esbSub')} onPress={() => go('EsbOrder')} />
      <MenuRow title={t('settings.tables')} sub={t('settings.tablesSub')} onPress={() => go('Tables')} />
      <MenuRow
        title={t('settings.newOrderSound')}
        sub={t('settings.newOrderSoundSub')}
        right={
          <Switch value={soundNewOrder} onValueChange={(v) => { setSoundNewOrder(v); setNotif({ soundNewOrder: v }); }} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />
      <MenuRow
        title={t('settings.autoKitchen')}
        sub={t('settings.autoKitchenSub')}
        right={
          <Switch value={autoPrintKitchen} onValueChange={(v) => { setAutoPrintKitchen(v); setNotif({ autoPrintKitchen: v }); }} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />

      <Text style={styles.groupLabel}>{t('settings.displayScan')}</Text>
      <MenuRow title={t('settings.customerDisplay')} sub={t('settings.customerDisplaySub')} onPress={() => go('CustomerDisplay')} right={
        <Switch value={customerDisplay} onValueChange={(v) => { setCustomerDisplay(v); setNotif({ customerDisplay: v }); }} trackColor={{ true: colors.green, false: colors.stroke }} />
      } />
      <MenuRow title={t('settings.idle')} sub={t('settings.idleSub')} onPress={() => go('Idle')} />
      <MenuRow title={t('settings.scanQr')} sub={t('settings.scanQrSub')} onPress={() => go('QrScan')} />

      <Text style={styles.groupLabel}>{t('settings.dataHelp')}</Text>
      <MenuRow title={t('settings.sync')} sub={t('settings.syncSub')} onPress={() => go('Sync')} />
      <MenuRow title={t('settings.log')} sub={t('settings.logSub')} onPress={() => go('Log')} />
      <MenuRow
        title={t('settings.language')}
        sub={lang === 'id' ? 'Indonesia' : 'English'}
        right={
          <View style={styles.langRow}>
            {(['id', 'en'] as const).map((l) => (
              <Pressable key={l} onPress={() => pickLang(l)} style={[styles.lang, lang === l && styles.langActive]}>
                <Text style={[styles.langText, lang === l && styles.langTextActive]}>{l.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        }
      />
      <MenuRow title={t('settings.help')} sub={t('settings.helpSub')} onPress={() => go('Help')} />
      <MenuRow title={t('settings.about')} sub="Genfity Order v1.0.0" onPress={() => go('About')} />

      <Pressable
        style={styles.logout}
        onPress={() => {
          logout();
          navigation?.navigate('Login');
        }}>
        <Text style={styles.logoutText}>{t('settings.logout')}</Text>
      </Pressable>
      <Text style={styles.version}>v1.0.0 - genfity-order</Text>

      <Modal visible={terminalOpen} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={[styles.dialog, styles.dialogNarrow]}>
            <Text style={styles.dialogTitle}>{t('settings.claimTerminal')}</Text>
            <Text style={styles.dialogSub}>{t('settings.claimSub')}</Text>
            <Text style={styles.fieldLabel}>{t('settings.terminalCode')}</Text>
            <TextInput style={styles.input} value={draftCode} onChangeText={setDraftCode} placeholder="TRM-001" placeholderTextColor={colors.faint} autoCapitalize="characters" />
            <Text style={styles.fieldLabel}>{t('settings.branchId')}</Text>
            <TextInput style={styles.input} value={draftBranchId} onChangeText={setDraftBranchId} placeholder="BR-01" placeholderTextColor={colors.faint} />
            <Text style={styles.fieldLabel}>{t('settings.branchName')}</Text>
            <TextInput style={styles.input} value={draftBranchName} onChangeText={setDraftBranchName} placeholder="Cabang Poris" placeholderTextColor={colors.faint} />
            <View style={styles.dialogBtns}>
              <Pressable style={styles.btnGhost} onPress={() => setTerminalOpen(false)}>
                <Text style={styles.btnGhostText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable style={styles.btnPrimary} onPress={saveTerminal}>
                <Text style={styles.btnPrimaryText}>{t('common.save')}</Text>
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
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.white,
    marginTop: 6,
  },
  saveBtn: { borderRadius: 10, backgroundColor: colors.navy, paddingHorizontal: 16, justifyContent: 'center', marginTop: 6 },
  saveBtnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 10 },
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
