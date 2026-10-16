import { useEffect, useMemo, useState } from 'react';import { Image, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import AppButton from '../../components/AppButton';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';import { useLang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { getLastSync, getLastSyncMs, listOutbox, pendingCount, pushAll,
  applyAutoSyncPrefs,

type SyncItem } from '../../lib/sync';import { pullMaster } from '../../lib/master';import { fmtDate } from '../../lib/datefmt';import { fetchPosVersion, notifyTerminalVerification } from '../../lib/apiSource';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };interface QueueItem {
  id: string;
  kind: string;
  desc: string;
  createdAt: string;
  status: 'antre' | 'terkirim' | 'gagal';}const LS_OPTS = 'genfity.sync.opts';/** Ringkasan item antrean nyata untuk daftar UI. Rupiah selalu via rp(). */function describePayload(o: SyncItem, labels: { sale: string; receipt: string; attendance: string; other: string }): string {

const p = o.payload as Record<string, unknown>; if (o.kind === 'order') return `${String(p.method ?? labels.sale)} - ${rp(Number(p.total ?? 0))}`; if (o.kind === 'receipt') return `Email ${String(p.email ?? '')} - ${String(p.no ?? '')}`; if (o.kind === 'attendance') return labels.attendance; return String(p.table ?? p.rowId ?? labels.other);}function fmtTime(iso: string): string
  { try
  { return new Date(iso).toLocaleString('id-ID',
  { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch
  { return iso; }}/** Hari sejak sync sukses terakhir: level peringatan 3/7 hari. */function warnLevel(daysAgo: number): 'ok' | 'warn3' | 'block7' {
  if (daysAgo > 7) return 'block7';
  if (daysAgo > 3) return 'warn3';
  return 'ok';}export default function SyncScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t, lang } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [autoSync, setAutoSync] = useState(true);
  const [syncOnWifi, setSyncOnWifi] = useState(false);
  const [lastPush, setLastPush] = useState(() => getLastSync() || t('sync_never'));
  const [lastPull, setLastPull] = useState(t('sync_never'));
  const [daysAgo, setDaysAgo] = useState(0);
  const [busy, setBusy] = useState<'push' | 'pull' | null>(null);
  const [msg, setMsg] = useState('');
  // WIRE REA-9/REA-12: versi POS + verifikasi terminal (best-effort -
  // kosong = dummy/offline, push/pull tetap jalan tanpa server).
  const [posVer, setPosVer] = useState('');
  const [verifyMsg, setVerifyMsg] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const v = await fetchPosVersion();
        if (!live || v.fromDummy || !v.latestVersion) return;
        setPosVer(`v${v.latestVersion} / min v${v.minVersion}`);
      } catch { /* offline - tanpa info versi */ }
    })();
    return () => { live = false; };
  }, []);
  const doVerify = async () => {
    if (verifyBusy) return;
    setVerifyBusy(true);
    setVerifyMsg('');
    try {
      const r = await notifyTerminalVerification('verified');
      if (r.ok && !r.fromDummy) setVerifyMsg(t('term_verify_ok'));
    } catch { /* offline - panel tetap jalan */ } finally {
      setVerifyBusy(false);
    }
  };
  const [tick, setTick] = useState(0);

  const level = warnLevel(daysAgo);
  const go = (route: string) => navigation?.navigate(route); useEffect(() => { let alive = true; void getJSON<{ autoSync: boolean; syncOnWifi: boolean }>(LS_OPTS, { autoSync: true, syncOnWifi: false }).then((o) => { if (!alive) return; setAutoSync(o.autoSync); setSyncOnWifi(o.syncOnWifi); }); return () => { alive = false; }; }, []); useEffect(() => {
    void setJSON(LS_OPTS, { autoSync, syncOnWifi }); }, [autoSync, syncOnWifi]);
  // Toggle sync otomatis benar-benar menjadwalkan push berkala (5 mnt) via
  // applyAutoSyncPrefs; sebelumnya toggle hanya tersimpan tanpa efek.
  useEffect(() => {
    try { applyAutoSyncPrefs({ auto: autoSync, wifiOnly: syncOnWifi }); } catch { /* abaikan */ }
  }, [autoSync, syncOnWifi]);
  // Hitung umur sync nyata dari timestamp sukses terakhir agar banner E00043
  // (>3 hari) dan E00044 (>7 hari) mencerminkan kondisi sebenarnya.
  useEffect(() => { const ms = getLastSyncMs(); if (ms > 0) setDaysAgo((Date.now() - ms) / 86400000); }, []); /** Antrean NYATA dari mesin sync, bukan mock. */ const queue: QueueItem[] = useMemo( () => listOutbox().map((o) => ({ id: o.id, kind: o.kind === 'order' ? t('sync_kind_sale') : o.kind === 'receipt' ? t('sync_kind_receipt') : o.kind === 'attendance' ? t('sync_kind_att') : t('sync_kind_other'), desc: describePayload(o, {
      sale: t('sync_kind_sale'), receipt: t('hist_email'), attendance: t('sync_att_desc'), other: o.kind }), createdAt: fmtTime(o.createdAt), status: o.status, })),
  [tick, lang], );

  const pending = pendingCount(); const doPush = async () => {
    if (busy) return;
    setBusy('push'); setMsg(t('sync_push_msg')); try {
      const r = await pushAll(); setTick((x) => x + 1); const last = getLastSync(); if (last) setLastPush(last); setDaysAgo(0); setMsg(t('sync_push_done').replace('{s}', String(r.sent)).replace('{f}', String(r.failed))); } catch (e) { setMsg(e instanceof Error ? `${t('sync_push_fail')} (${e.message})` : t('sync_push_fail')); } finally { setBusy(null); }
  };

  const doPull = async () => {
    if (busy) return;
    setBusy('pull'); setMsg(t('sync_pull_msg')); try {
      const r = await pullMaster(); setLastPull(new Date().toLocaleString('id-ID'));
      setDaysAgo(0);
      setMsg(t('sync_pull_done').replace('{t}', String(r.total)).replace('{m}', String(r.per.menu ?? 0)).replace('{tb}', String(r.per.table ?? 0)).replace('{mb}', String(r.per.member ?? 0)).replace('{v}', String(r.per.voucher ?? 0))); } catch (e) { setMsg(e instanceof Error ? `${t('sync_pull_fail')} (${e.message})` : t('sync_pull_fail')); } finally { setBusy(null); }
  };

  const simulateOld = () => {
    setDaysAgo(5);
    const fiveAgo = fmtDate(new Date(Date.now() - 5 * 86400000), lang);
    setLastPush(fiveAgo);
    setLastPull(fiveAgo);
    setMsg(t('sync_sim_msg'));
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <ScreenHeader title={t('sync.title')} sub={t('sync.sub')} left={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
          <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
        </TouchableOpacity>
      } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />

      {level !== 'ok' ? (
        <View style={[styles.alert, level === 'block7' ? styles.alertBlock : styles.alertWarn]}>
          <Image source={require('../../../assets/images/no_connection.webp')} style={styles.alertImg} resizeMode="contain" />
          <View style={styles.alertLeft}>
            <Text style={[styles.alertTitle, isTablet && { fontSize: 16 }]}>
              {level === 'block7' ? t('sync.blocked') : t('sync.warn')}
            </Text>
            <Text style={styles.alertCode}> {level === 'block7' ? t('sync_code_block') : t('sync_code_warn')} </Text><Text style={styles.alertSub}>
              {level === 'block7'
                ? t('sync.blockedMsg')
                : t('sync.warnMsg')}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={[styles.cardTitle, isTablet && { fontSize: 17 }]}>{t('sync.watermark')}</Text>
        <View style={styles.wmRow}>
          <Text style={styles.wmLabel}>{t('sync.lastPush')}</Text>
          <Text style={styles.wmVal}>{lastPush}</Text>
        </View>
        <View style={styles.wmRow}>
          <Text style={styles.wmLabel}>{t('sync.lastPull')}</Text>
          <Text style={styles.wmVal}>{lastPull}</Text>
        </View>
        <View style={styles.btnRow}>
          <AppButton size="md" title={busy === 'push' ? t('sync.pushing') : t('sync.pushNow')} onPress={doPush} disabled={!!busy} fullWidth={false} style={styles.greenFlex} />
          <AppButton size="md" title={busy === 'pull' ? t('sync.pulling') : t('sync.pullNow')} onPress={doPull} disabled={!!busy} fullWidth={false} style={styles.navyFlex} />
        </View>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={[styles.cardTitle, isTablet && { fontSize: 17 }]}>{t('about.terminal')}</Text>
        {posVer ? (
          <View style={styles.wmRow}>
            <Text style={styles.wmLabel}>POS</Text>
            <Text style={styles.wmVal}>{posVer}</Text>
          </View>
        ) : null}
        <View style={styles.btnRow}>
          <AppButton size="sm" title={t('vou_check')} onPress={doVerify} disabled={verifyBusy} fullWidth={false} style={styles.greenFlex} />
        </View>
        {verifyMsg ? <Text style={styles.msg}>{verifyMsg}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={[styles.cardTitle, isTablet && { fontSize: 17 }]}>{t('sync.opts')}</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('sync.auto')}</Text>
          <Switch value={autoSync} onValueChange={setAutoSync} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('sync.wifi')}</Text>
          <Switch value={syncOnWifi} onValueChange={setSyncOnWifi} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <Text style={styles.cardSub}>{t('sync.pullOrder')}</Text>
      </View>

      <Text style={[styles.groupLabel, isTablet && { fontSize: 14 }]}>{t('sync.queue')} ({pending} {t('sync.pending')})</Text> {queue.length === 0 && ( <View style={styles.card}> <Text style={styles.cardSub}>{t('sync.emptyQueue')}</Text> </View> )}
      {queue.map((q) => (
        <View key={q.id} style={styles.card}>
          <View style={styles.qTop}>
            <Text style={styles.qKind}>{q.kind}</Text>
            <View style={[styles.qBadge, q.status === 'terkirim' ? styles.qOk : q.status === 'gagal' ? styles.qFail : styles.qWait]}>
              <Text style={[styles.qBadgeText, q.status === 'terkirim' ? styles.qOkText : q.status === 'gagal' ? styles.qFailText : styles.qWaitText]}>
                {q.status === 'terkirim' ? t('sync.sent') : q.status === 'gagal' ? t('sync.failed') : t('sync.queued')}
              </Text>
            </View>
          </View>
          <Text style={styles.qDesc}>{q.desc}</Text>
          <Text style={styles.qTime}>{q.createdAt}</Text>
        </View>
      ))}

      <AppButton size="md" title={t('sync.simOld')} onPress={simulateOld} variant="secondary" style={styles.simBtn} textStyle={styles.simBtnText} />
      <Text style={styles.foot}>{t('sync_foot')}</Text>
    </ScrollView>
  );}const styles = StyleSheet.create({
  burger: { width: 22, height: 22 },
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },

  groupLabel: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginTop: 18, marginBottom: 2, paddingHorizontal: 16 },
  alert: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, marginHorizontal: 16, marginTop: 12, borderWidth: 1 },
  alertWarn: { backgroundColor: colors.paleAmber, borderColor: colors.amber },
  alertBlock: { backgroundColor: colors.paleRed, borderColor: colors.red },
  alertImg: { width: 56, height: 56, marginRight: 10 },
  alertLeft: { flex: 1 },
  alertTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  alertCode: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted, marginTop: 2 }, alertSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 6 },
  wmRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  wmLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  wmVal: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  greenFlex: { marginTop: 0, flex: 1, backgroundColor: colors.green },
  navyFlex: { marginTop: 0, flex: 1, backgroundColor: colors.navy },
  simBtn: { marginTop: 12, marginHorizontal: 16, borderColor: colors.line },
  simBtnText: { color: colors.muted },
  btnPush: { flex: 1, borderRadius: 10, backgroundColor: colors.green, paddingVertical: 12, alignItems: 'center' },
  btnPushText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnPull: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center' },
  btnPullText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnDisabled: { opacity: 0.5 },
  msg: { fontFamily: fonts.medium, fontSize: 12, color: colors.navy, marginTop: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  qTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qKind: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  qBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  qWait: { backgroundColor: colors.paleAmber },
  qOk: { backgroundColor: colors.paleGreen },
  qFail: { backgroundColor: colors.paleRed },
  qBadgeText: { fontFamily: fonts.bold, fontSize: 11 },
  qWaitText: { color: colors.amberDark },
  qOkText: { color: colors.greenDark },
  qFailText: { color: colors.red },
  qDesc: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, marginTop: 4 },
  qTime: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, marginTop: 2 },
  btnGhost: { marginHorizontal: 16, marginTop: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 11, alignItems: 'center', backgroundColor: colors.card },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14, paddingHorizontal: 24 },});