import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';
import { useLang, type Lang } from '../../lib/i18n';
import { appAlert } from '../../lib/appAlert';
import { getSession, getBinding, logout, subscribeSession } from '../../session';
import { getBaseUrl, getCustomBaseUrl, getServerEnv, getTerminal, setCustomBaseUrl, setServerEnv, type ServerEnv } from '../../config/server';
import { getNotif, setNotif } from '../../config/device';
import { requireAccess } from '../../lib/access';
import { terminalLogout } from '../../lib/terminalApi';
import { getJSON, setJSON } from '../../lib/storage';
import { getDeviceRole, subscribeDeviceRole, normalizeTag, VIEW_TAGS } from '../../lib/deviceRole';
import SupervisorApprovalDialog from '../../components/SupervisorApprovalDialog';
import VerticalOnboarding from '../../components/vertical/VerticalOnboarding';
import { getCachedVerticalId, getHybridVerticals, normalizeMerchantType, setCachedVerticalId, setHybridVerticals, syncVerticalIdFromProfile } from '../../lib/posModes';
import { VERTICALS, type VerticalId } from '../../lib/verticals';


type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

const ENVS: ServerEnv[] = ['prod', 'dev', 'staging', 'custom'];
const ENV_LABEL: Record<ServerEnv, string> = { prod: 'Prod', dev: 'Dev', staging: 'Staging', custom: 'Custom' };
const AUTOCUT_KEY = 'genfity.settings.autocut';
// 2026-10-26 owner sempat menyembunyikan "Pengaturan Cetakan Menu".
// 2026-10-27 diaktifkan kembali: MenuPrintingScreen adalah satu-satunya
// editor routing grup-menu→station (persistRoutes menulis stationId ke
// ms_menu/ms_branchmenu + definisi ms_station) yang dibaca KitchenScreen;
// PrintersScreen hanya mengatur koneksi, bukan routing; Help FAQ
// (help_faq5_a) merujuk ke "Cetakan Menu". Route tanpa entry = yatim.
const MENU_PRINTING_VISIBLE = true;
// PUTUSAN OWNER 2026-10-26: baris "Scan QR" di Pengaturan disembunyikan dulu
// (layar QrScan tetap ada — dipakai Member + Login). Ubah ke true untuk
// menampilkan kembali tanpa menghapus layar.
const MENU_SCAN_VISIBLE = false;

export default function SettingsScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t, lang, setLang, isLocked } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [soundNewOrder, setSoundNewOrder] = useState(() => getNotif().soundNewOrder);
  const [customerDisplay, setCustomerDisplay] = useState(() => getNotif().customerDisplay);
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(() => getNotif().autoPrintKitchen);
  const [autoCut, setAutoCut] = useState(true);
  useEffect(() => {
    let alive = true;
    void getJSON<boolean>(AUTOCUT_KEY, true).then((v) => { if (alive) setAutoCut(v); });
    return () => { alive = false; };
  }, []);
  const toggleAutoCut = (v: boolean) => { setAutoCut(v); void setJSON(AUTOCUT_KEY, v); };
  const [serverEnv, setServerEnvState] = useState<ServerEnv>(() => getServerEnv());
  const [customUrl, setCustomUrl] = useState(() => getCustomBaseUrl());
  // Audit-5d80: panel server disembunyikan dari staf — preset + editor custom
  // hanya muncul setelah tap 5x pada label versi (dengan gate settings.edit).
  // Alasan: preset 'Prod' menunjuk ke server pihak ketiga (ESB), dan selektor
  // server di tangan kasir = risiko salah arah + desync klaim terminal.
  const [serverUnlocked, setServerUnlocked] = useState(false);
  // Vertical Shell: jenis usaha aktif + dialog ganti (PIN supervisor) + onboarding picker.
  const [verticalTick, setVerticalTick] = useState(0);
  const [verticalPickOpen, setVerticalPickOpen] = useState(false);
  const [verticalPinOpen, setVerticalPinOpen] = useState(false);
  const [hybridPickOpen, setHybridPickOpen] = useState(false);
  const [hybrid, setHybrid] = useState<string[]>([]);
  useEffect(() => { void getHybridVerticals().then(setHybrid).catch(() => {}); }, [verticalTick]);
  void verticalTick;
  const [versionTaps, setVersionTaps] = useState(0);
  // F4 readout klaim: ditulis HANYA oleh alur bind terverifikasi PIN via
  // BranchPicker (tanpa input manual di layar ini); dibaca ulang tiap fokus —
  // back-navigate setelah re-bind tak remount sehingga getTerminal() per
  // render bisa basi tanpa render ulang.
  const [terminal, setTerminal] = useState(() => getTerminal());
  useFocusEffect(useCallback(() => { setTerminal(getTerminal()); }, []));
  // Kunci peran perangkat: 1 perangkat = 1 peran (Kasir penuh, Dapur, Display).
  const [deviceRole, setDeviceRoleState] = useState(() => getDeviceRole());
  useEffect(() => subscribeDeviceRole((r) => setDeviceRoleState(r)), []);
  // Display-lock SPEC §10: tag view terkunci = switch peran perangkat +
  // klaim terminal disembunyikan TOTAL (tanpa Settings/role-switch di profil
  // view). Membuka kembali wajib lewat aksi owner terautentikasi (Q14
  // TERBUKA) — bukan sekadar un-hide di sini.
  const [, setBindTick] = useState(0);
  useEffect(() => subscribeSession(() => setBindTick((x) => x + 1)), []);
  const boundTag = (() => {
    try {
      return normalizeTag(getBinding()?.tag);
    } catch {
      return null;
    }
  })();
  const activeTag = boundTag ?? normalizeTag(deviceRole) ?? 'full_access';
  const isViewLocked = (VIEW_TAGS as string[]).includes(activeTag);
  // Audit 2026-10-26: panel sync manual (push/pull + terminal-check) dihapus
  // dari Pengaturan — push/pull + status ada di layar Sync; validitas terminal
  // dicek otomatis server di setiap apiFetch/pull (401 → logout).

  const go = (route: string) => navigation?.navigate(route);

  /** Kunci akses RBAC: userId sesi bila ada, else username. */
  const sessionKey = () => {
    const s = getSession();
    return s?.userId || s?.username || '';
  };

  /**
   * Gate RBAC settings.edit: deny = Alert + block (tanpa eskalasi).
   * Fail-CLOSED (R1): DB belum siap / throw = DENY. Gate ini menjaga server
   * env + re-bind terminal — fail-open akan membiarkan kasir mengganti
   * endpoint server saat DB rusak/belum hydrate.
   */
  const guardSettingsEdit = async (): Promise<boolean> => {
    try {
      const gate = await requireAccess(sessionKey(), 'settings.edit');
      if (!gate.ok) {
        appAlert(t('sett_denied_title'), t('sett_denied_msg').replace('{r}', gate.reason));
        return false;
      }
      return true;
    } catch {
      appAlert(t('sett_denied_title'), t('sett_denied_msg').replace('{r}', 'db-unready'));
      return false;
    }
  };

  const pickEnv = (e: ServerEnv) => {
    void guardSettingsEdit().then((ok) => {
      if (!ok) return;
      setServerEnv(e);
      setServerEnvState(e);
    });
  };

  /** Buka kunci panel server setelah 5 ketukan pada label versi (gate RBAC). */
  const tapVersion = () => {
    const n = versionTaps + 1;
    if (n >= 5) {
      setVersionTaps(0);
      if (!serverUnlocked) {
        void guardSettingsEdit().then((ok) => {
          if (ok) setServerUnlocked(true);
        });
      }
      return;
    }
    setVersionTaps(n);
  };

  const saveCustom = () => {
    void guardSettingsEdit().then((ok) => {
      if (!ok) return;
      // setCustomBaseUrl melempar untuk URL non-http(s): tampilkan pesannya
      // (sync_bad_url lokal) agar tak jadi unhandled rejection diam-diam.
      try {
        setCustomBaseUrl(customUrl);
      } catch (e) {
        appAlert(t('settings.server'), e instanceof Error ? e.message : String(e));
      }
    });
  };

  /** Tugas F ("Ganti terminal" tanpa logout): masuk alur pilih cabang +
   * terminal DI DALAM sesi (rute BranchPicker stack authed) — tanpa logout
   * manual. Catatan jujur: bind terminal BARU yang terverifikasi PIN tetap
   * mengakhiri sesi staff via adoptTerminalBinding (okupansi tunggal per
   * device, by design) sehingga login ulang diperlukan SETELAH klaim baru;
   * yang dihapus di sini hanyalah langkah logout-manual sebelum memilih. */
  const goSwitchTerminal = () => navigation?.navigate('BranchPicker');

  const pickLang = (l: Lang) => setLang(l);

  const terminalSub = terminal.terminalCode
    ? `${terminal.terminalCode} - ${terminal.branchName || terminal.branchId || '-'}`
    : t('settings.notClaimed');

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('settings.title')}
        sub={(getBinding()?.merchantName || getBinding()?.branchName || '').trim() || t('settings.sub')}
        left={
          <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      />
      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, isTablet && wideCenterLg]}>
      <Text style={[styles.groupLabel, isTablet && styles.groupLabelBig]}>{t('settings.terminalServer')}</Text>
      {isViewLocked ? null : (
      <>
      <MenuRow title={t('settings.terminal')} sub={terminalSub} onPress={goSwitchTerminal} />
      <View style={styles.panel}>
        <Text style={[styles.cardTitle, isTablet && styles.cardTitleBig]}>{t('settings.claimTerminal')}</Text>
        <Text style={[styles.cardSub, isTablet && styles.cardSubBig]}>{t('settings.claimSub')}</Text>
        <Text style={[styles.cardSub, isTablet && styles.cardSubBig]}>{activeTag}</Text>
        <View style={styles.syncRow}>
          <AppButton size="md" title={t('rebind_button')} onPress={goSwitchTerminal} fullWidth={false} style={styles.btnFlexNavy} />
        </View>
      </View>
      </>
      )}
      <View style={styles.panel}>
        <Text style={[styles.cardTitle, isTablet && styles.cardTitleBig]}>{t('settings.server')}</Text>
        <Text style={[styles.cardSub, isTablet && styles.cardSubBig]}>{getBaseUrl() || t('settings.noServer')}</Text>
        {serverUnlocked ? (
        <>
        <View style={styles.envRow}>
          {ENVS.map((e) => (
            <Pressable key={e} onPress={() => pickEnv(e)} style={[styles.envBtn, serverEnv === e && styles.envBtnActive]}>
              <Text style={[styles.envText, serverEnv === e && styles.envTextActive]}>{ENV_LABEL[e]}</Text>
            </Pressable>
          ))}
        </View>
        {serverEnv === 'custom' && (
          <View style={styles.customRow}>
            <View style={styles.formFlex}>
              <AppInput
                value={customUrl}
                onChangeText={setCustomUrl}
                placeholder="https://server.example.com/api/web"
                autoCapitalize="none"
              />
            </View>
            <AppButton size="sm" title={t('common.save')} onPress={saveCustom} fullWidth={false} style={styles.btnInline} />
          </View>
        )}
        </>
        ) : null}
      </View>

      {/* Audit 2026-10-26: panel sync manual dihapus — push/pull + status ada
        di layar Sync (MenuRow Data & Bantuan di bawah); identitas terminal
        terlihat di baris klaim + panel server di atas. */}
      <Text style={[styles.groupLabel, isTablet && styles.groupLabelBig]}>{t('settings.printerPrint')}</Text>
      <MenuRow title={t('settings.printConn')} sub={t('settings.printConnSub')} onPress={() => go('Printers')} />
      {MENU_PRINTING_VISIBLE ? (
        <MenuRow title={t('settings.menuPrint')} sub={t('settings.menuPrintSub')} onPress={() => go('MenuPrinting')} />
      ) : null}
      <MenuRow
        title={t('settings.autoCut')}
        sub={t('settings.autoCutSub')}
        right={
          <Switch value={autoCut} onValueChange={toggleAutoCut} trackColor={{ true: colors.green, false: colors.stroke }} />
        }
      />

      <Text style={[styles.groupLabel, isTablet && styles.groupLabelBig]}>{t('settings.operational')}</Text>
      <MenuRow title={t('settings.stock')} sub={t('settings.stockSub')} onPress={() => go('Stock')} />
      <MenuRow
        title={t('settings.vertical')}
        sub={(() => { try { const v = VERTICALS[getCachedVerticalId()]; return v ? `${v.icon} ${v.label} — ${v.example}` : t('settings.verticalSub'); } catch { return t('settings.verticalSub'); } })()}
        onPress={() => setVerticalPinOpen(true)}
      />
      <MenuRow
        title="Jualan tambahan (hybrid)"
        sub={hybrid.length ? hybrid.map((h) => { try { const v = VERTICALS[h as VerticalId]; return v ? `${v.icon} ${v.label}` : h; } catch { return h; } }).join(' + ') : 'Satu usaha utama + tambahan (mis. warung + pulsa)'}
        onPress={() => setHybridPickOpen(true)}
      />
      <MenuRow title={t('settings.tableTimer')} sub={t('settings.tableTimerSub')} onPress={() => go('TableTimer')} />
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

      <Text style={[styles.groupLabel, isTablet && styles.groupLabelBig]}>{t('settings.displayScan')}</Text>
      <MenuRow title={t('settings.customerDisplay')} sub={t('settings.customerDisplaySub')} onPress={() => go('CustomerDisplay')} right={
        <Switch value={customerDisplay} onValueChange={(v) => { setCustomerDisplay(v); setNotif({ customerDisplay: v }); }} trackColor={{ true: colors.green, false: colors.stroke }} />
      } />
      <MenuRow title={t('settings.idle')} sub={t('settings.idleSub')} onPress={() => go('Idle')} />
      {MENU_SCAN_VISIBLE ? (
      <MenuRow title={t('settings.scanQr')} sub={t('settings.scanQrSub')} onPress={() => go('QrScan')} />
      ) : null}

      <Text style={[styles.groupLabel, isTablet && styles.groupLabelBig]}>{t('settings.dataHelp')}</Text>
      {/* SESI-FINAL-APP K5 PARKED needs-dep: backup codec murni, tanpa expo-clipboard/share/file — baris disabled jujur */}
      <MenuRow title={t('settings.backup')} sub={t('settings.backupSub')} />
      <MenuRow title={t('settings.sync')} sub={t('settings.syncSub')} onPress={() => go('Sync')} />
      <MenuRow title={t('settings.log')} sub={t('settings.logSub')} onPress={() => go('Log')} />
      {/* Cabang Australia (AUD): bahasa dikunci Inggris, baris pemilih disembunyikan. */}
      {isLocked ? null : (
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
      )}
      <MenuRow title={t('settings.help')} sub={t('settings.helpSub')} onPress={() => go('Help')} />
      <MenuRow title={t('settings.about')} sub="Genfity Order v1.0.0" onPress={() => go('About')} />

      <SupervisorApprovalDialog
        visible={verticalPinOpen}
        action="VERTICAL_SWITCH"
        refId={(() => { try { return getBinding()?.terminalId ?? ''; } catch { return ''; } })()}
        lockRefId={false}
        reasonPreset="Ganti jenis usaha"
        fallbackAccessKey="settings.edit"
        title={t('settings.vertical')}
        sub={t('settings.verticalSub')}
        onApproved={() => { setVerticalPinOpen(false); setVerticalPickOpen(true); }}
        onCancel={() => setVerticalPinOpen(false)}
      />
      <VerticalOnboarding
        visible={verticalPickOpen}
        initial={(() => { try { return getCachedVerticalId(); } catch { return undefined; } })()}
        onPick={(v: VerticalId) => {
          try {
            const mt = (() => { try { return normalizeMerchantType(getBinding()?.merchantType); } catch { return 'RESTAURANT'; } })();
            setCachedVerticalId(v, mt);
            void (async () => {
              try {
                const { initDb: initDb2, run: run2 } = await import('../../lib/db');
                await initDb2();
                await run2(
                  `INSERT INTO ms_setting (key1, key2, value1, value2) VALUES ('Merchant', 'Vertical', ?, ?)` +
                  ` ON CONFLICT(key1, key2) DO UPDATE SET value1 = excluded.value1, value2 = excluded.value2`,
                  [v, ''],
                );
              } catch { /* abaikan */ }
              // Selaraskan ke server dulu (PUT verticalId); HANYA re-pull bila
              // server terima — bila offline/ditolak, pilihan lokal WAJIB
              // dipertahankan (jangan re-pull yang menimpa balik ke nilai lama).
              try {
                const { pushVerticalIdToServer } = await import('../../lib/posModes');
                const pushed = await pushVerticalIdToServer(v);
                if (pushed) {
                  try { await syncVerticalIdFromProfile(mt); } catch { /* abaikan */ }
                }
              } catch { /* lokal saja */ }
              setVerticalTick((x) => x + 1);
            })();
            appAlert(t('settings.vertical'), t('vertical.changed'));
          } catch { /* abaikan */ }
          setVerticalPickOpen(false);
        }}
      />
      <VerticalOnboarding
        visible={hybridPickOpen}
        initial={(() => { try { return getCachedVerticalId(); } catch { return undefined; } })()}
        onPick={(v: VerticalId) => {
          // Toggle keanggotaan: pilih yang sudah ada = hapus; beda L1 merchantType
          // = tolak jujur (1 terminal = 1 tipe BE; campur RESTAURANT+PRODUCT
          // merusak gate orderType). Maks 3 tambahan.
          void (async () => {
            try {
              const main = getCachedVerticalId();
              const mainCfg = VERTICALS[main];
              const cur = await getHybridVerticals();
              let ids: string[];
              let msg: string;
              if (v === main) {
                msg = 'Sudah menjadi usaha utama.';
                ids = cur;
              } else if (cur.includes(v)) {
                ids = cur.filter((x) => x !== v);
                msg = `${VERTICALS[v].label} dihapus dari tambahan.`;
              } else if (VERTICALS[v].merchantType !== mainCfg.merchantType) {
                appAlert('Tidak kompatibel', `${VERTICALS[v].label} beda tipe usaha (${VERTICALS[v].merchantType}) dengan utama (${mainCfg.merchantType}). Ganti jenis usaha utama dulu bila perlu.`);
                return;
              } else if (cur.length >= 3) {
                appAlert('Penuh', 'Maksimal 3 jualan tambahan.');
                return;
              } else {
                ids = [...cur, v].slice(0, 3);
                msg = `${VERTICALS[v].label} ditambah sebagai jualan tambahan.`;
              }
              await setHybridVerticals(ids);
              setHybrid(ids);
              setVerticalTick((x) => x + 1);
              appAlert('Jualan tambahan', msg);
            } catch { /* abaikan */ }
          })();
          setHybridPickOpen(false);
        }}
      />
      <AppButton
        size="lg"
        title={t('settings.logout')}
        variant="danger"
        onPress={() => {
          // E31 fase-1a: terminal-logout best-effort (fire-and-forget; device
          // tetap bound) — gagal jaringan = abaikan, logout lokal tetap jalan.
          try {
            const dev = (getSession()?.deviceId || '').trim();
            if (dev) void terminalLogout(dev).catch(() => {});
          } catch {}
          logout();
          navigation?.navigate('Login');
        }}
        style={styles.logoutBtn}
        textStyle={styles.logoutBtnText}
      />
      <Pressable onPress={tapVersion} accessibilityRole="button">
        <Text style={styles.version}>v1.0.0 - genfity-order</Text>
      </Pressable>

      </ScrollView>
    </View>
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
  // Tablet: skala judul ikut layar induk (komponen baris menu bersama).
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  return (
    <Pressable style={styles.card} onPress={onPress} disabled={!onPress && !right}>
      <View style={styles.cardLeft}>
        <Text style={[styles.cardTitle, isTablet && styles.cardTitleBig]}>{title}</Text>
        <Text style={[styles.cardSub, isTablet && styles.cardSubBig]}>{sub}</Text>
      </View>
      {right ?? (onPress ? <Text style={styles.chev}>›</Text> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  burger: { width: 22, height: 22 },
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
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
  // Tablet: skala tipografi +1-2pt mengikuti pola TableTimerScreen (phone tetap).
  groupLabelBig: { fontSize: 14 },
  cardTitleBig: { fontSize: 16 },
  cardSubBig: { fontSize: 13 },
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
  formFlex: { flex: 1 },
  btnInline: { marginTop: 0 },
  btnFlexNavy: { marginTop: 0, flex: 1, backgroundColor: colors.navy },
  logoutBtn: { marginTop: 22, marginHorizontal: 16, backgroundColor: colors.paleRed },
  logoutBtnText: { color: colors.red },
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
  syncRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
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
