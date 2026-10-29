import { useCallback, useEffect, useMemo, useState } from 'react';import { Image, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { useFocusEffect } from '@react-navigation/native';import AppButton from '../../components/AppButton';import ScreenHeader from '../../components/ScreenHeader';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import { getLang, useLang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { getLastSync, getLastSyncMs, listOutbox, pendingCount, pushAll, countDirtyRows, countPhysicalQueue, getPendingRevoke, listLocalOnly,
  applyAutoSyncPrefs, syncWarnLevel, WARN_SYNC_DAYS, SYNC_OPTS_KEY,

type SyncItem, type LocalOnlyRow } from '../../lib/sync';import { pullMaster } from '../../lib/master';import { pendingPrintCount } from '../../lib/printqueue';
// APP-FIXUP(PRN-DRAIN-VISIBILITY): tampilkan backlog cetak (tr_printqueue) di panel ini — tanpa siklus impor (printqueue hanya → db/escpos/native-printer/uuidv7).
import { fmtDate, fmtDateInTz, fmtTimeInTz } from '../../lib/datefmt';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };interface QueueItem {
  id: string;
  kind: string;
  desc: string;
  createdAt: string;
  /** C8: catatan fail-once mesin sync (S10/C2/C8) — ditampilkan jujur di kartu. */
  note: string;
  status: 'antre' | 'terkirim' | 'gagal';}/** Ringkasan item antrean nyata untuk daftar UI. Rupiah selalu via rp(). S8:
 * kind deposit/shift/voucher/member memakai kunci kamus + identifier. */function describePayload(o: SyncItem, labels: { sale: string; receipt: string; attendance: string; other: string; dep: string; shift: string; voucher: string; member: string }): string {

const p = o.payload as Record<string, unknown>; if (o.kind === 'order') return `${String(p.method ?? labels.sale)} - ${rp(Number(p.total ?? 0))}`; if (o.kind === 'receipt') return `Email ${String(p.email ?? '')} - ${String(p.no ?? '')}`; if (o.kind === 'attendance') return labels.attendance;
  const k = String(p.kind ?? '');
  const op = String(p.op ?? '');
  if (k === 'deposit-refund' || k === 'deposit-withdraw' || k === 'deposit-topup' || k === 'member-deposit') {
    const who = String(p.memberId ?? '');
    const nom = Number(p.nominal ?? p.amount ?? 0);
    return `${labels.dep}${who ? ` · ${who}` : ''}${nom > 0 ? ` · ${rp(nom)}` : ''}`;
  }
  if (op === 'shift-open' || op === 'shift-close' || k === 'shift-open' || k === 'shift-close') {
    return `${labels.shift} · ${op || k}`;
  }
  if (/voucher/i.test(k) || /voucher/i.test(op)) {
    const code = String(p.kode ?? p.voucherCode ?? p.code ?? p.id ?? '');
    return `${labels.voucher}${code ? ` · ${code}` : ''}`;
  }
  if (/member/i.test(k)) {
    const who = String(p.memberId ?? p.nama ?? p.name ?? '');
    return `${labels.member}${who ? ` · ${who}` : ''}`;
  }
  return String(p.table ?? p.rowId ?? labels.other);}function fmtTime(iso: string): string
  { try
  { const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso; return `${fmtDateInTz(d, getLang())} ${fmtTimeInTz(d)}`; } catch
  { return iso; }}/** S7: level umur sync SELALU dari kanonis syncWarnLevel(lib/sync) — layar tak
 * mengimplementasikan ambang sendiri. daysAgo hari → ms untuk demo/dev. */export default function SyncScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t, lang } = useLang(); const [autoSync, setAutoSync] = useState(true);
  const [lastPush, setLastPush] = useState(() => getLastSync() || t('sync_never'));
  const [lastPull, setLastPull] = useState(t('sync_never'));
  const [daysAgo, setDaysAgo] = useState(() => (getLastSyncMs() > 0 ? 0 : Infinity));
  const [busy, setBusy] = useState<'push' | 'pull' | null>(null);
  const [msg, setMsg] = useState('');
  // Audit 2026-10-26: terminal-check manual dihapus. Validitas terminal dicek
  // otomatis server di setiap apiFetch/pull (401 non-PIN → refresh → logout).
  const [tick, setTick] = useState(0);
  // BACKLOG GABUNGAN (temuan offline-ms-edits-stuck-invisible): antrean ringan
  // saja tak cukup — tampilkan juga fisik (tr_esoprocessqueue) + baris kotor
  // (syncDate NULL) + indikator pendingRevoke (O1) bila ada. Label memakai nama
  // tabel/kolom apa adanya (identifier, tak perlu terjemahan) + key existing.
  const [physPending, setPhysPending] = useState(0);
  const [dirtyRows, setDirtyRows] = useState(0);
  const [pendingRevoke, setPendingRevoke] = useState<string[]>([]);
  // M9-3: baris master local-only (status 'lokal') — informatif, bukan pending.
  const [localOnly, setLocalOnly] = useState<LocalOnlyRow[]>([]);
  // APP-FIXUP(PRN-DRAIN-VISIBILITY): backlog cetak persisten (tr_printqueue
  // status antre/gagal) — identifier tabel apa adanya, label existing.
  const [printPending, setPrintPending] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, d, r, pp, lo] = await Promise.all([countPhysicalQueue(), countDirtyRows(), getPendingRevoke(), pendingPrintCount(), listLocalOnly()]);
        if (alive) { setPhysPending(p); setDirtyRows(d); setPendingRevoke(r); setPrintPending(pp); setLocalOnly(lo); }
      } catch { /* DB/storage belum siap - panel tetap jalan */ }
    })();
    return () => { alive = false; };
  }, [tick]);

  const level = Number.isFinite(daysAgo) ? syncWarnLevel(Date.now() - daysAgo * 86400000) : syncWarnLevel();
  // Audit 2026-10-26: opsi wifi-only dihapus — sync pakai jaringan apa pun.
  // wifiOnly selalu false; bentuk simpanan dipertahankan agar instalasi lama
  // yang masih menyimpan syncOnWifi=true ikut kembali ke jaringan apa pun.
  useEffect(() => { let alive = true; void getJSON<{ autoSync: boolean; syncOnWifi: boolean }>(SYNC_OPTS_KEY, { autoSync: true, syncOnWifi: false }).then((o) => { if (!alive) return; setAutoSync(o.autoSync); }); return () => { alive = false; }; }, []); useEffect(() => {
    void setJSON(SYNC_OPTS_KEY, { autoSync, syncOnWifi: false }); }, [autoSync]);
  // Toggle sync otomatis benar-benar menjadwalkan push berkala (5 mnt) via
  // applyAutoSyncPrefs; sebelumnya toggle hanya tersimpan tanpa efek.
  useEffect(() => {
    try { applyAutoSyncPrefs({ auto: autoSync, wifiOnly: false }); } catch { /* abaikan */ }
  }, [autoSync]);
  // Hitung umur sync nyata dari timestamp sukses terakhir agar banner E00043
  // (>3 hari) dan E00044 (>7 hari) mencerminkan kondisi sebenarnya.
  // pullMaster TIDAK menyentuh lastSyncMs (hanya pushAll) — umur dihitung
  // ulang dari sumber yang sama agar banner tak berbohong pasca-pull.
  // Belum pernah sync (ms<=0) = umur tak diketahui = block7, cermin
  // syncWarnLevel kanonis di lib/sync (jangan render 'ok' buta).
  const refreshDaysAgo = () => { const ms = getLastSyncMs(); if (ms > 0) setDaysAgo((Date.now() - ms) / 86400000); else setDaysAgo(Infinity); };
  useEffect(() => { refreshDaysAgo(); }, []); // S19: segarkan umur tiap layar
  // difokuskan; tak ada emit session-restore di sesi (grep) — focus saja.
  useFocusEffect(useCallback(() => { refreshDaysAgo(); setTick((x) => x + 1);
    // W-FULL §14: tampilkan stempel pull-otomatis terakhir (boot/reconnect)
    // agar "Last pull: Never" hanya muncul bila pull belum pernah sukses.
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('../../lib/master') as typeof import('../../lib/master');
        const iso = await m.getLastPullOk();
        if (iso) {
          const d = new Date(iso);
          if (!Number.isNaN(d.getTime())) setLastPull(`${fmtDateInTz(d, lang)} ${fmtTimeInTz(d)}`);
        }
      } catch { /* abaikan — label tetap */ }
    })(); }, [])); /** Antrean NYATA dari mesin sync, bukan mock. */ const queue: QueueItem[] = useMemo( () => listOutbox().map((o) => ({ id: o.id, kind: o.kind === 'order' ? t('sync_kind_sale') : o.kind === 'receipt' ? t('sync_kind_receipt') : o.kind === 'attendance' ? t('sync_kind_att') : t('sync_kind_other'), desc: describePayload(o, {
      sale: t('sync_kind_sale'), receipt: t('hist_email'), attendance: t('sync_att_desc'), other: o.kind, dep: t('sync_kind_deposit'), shift: t('sync_kind_shift'), voucher: t('sync_kind_voucher'), member: t('sync_kind_member') }), createdAt: fmtTime(o.createdAt), note: String(o.note ?? ''), status: o.status, })),
  [tick, lang], );

  const pending = pendingCount(); // S21: hitung lokal-only (flag local) untuk badge.
  const localN = useMemo(() => listOutbox().filter((o) => !!o.local && o.status !== 'terkirim').length, [tick]); const doPush = async () => {
    if (busy) return;
    setBusy('push'); setMsg(t('sync_push_msg')); try {
      const r = await pushAll(); setTick((x) => x + 1); const last = getLastSync(); if (last) setLastPush(last); refreshDaysAgo(); setMsg(t('sync_push_done').replace('{s}', String(r.sent)).replace('{f}', String(r.failed))); } catch (e) { setMsg(e instanceof Error ? `${t('sync_push_fail')} (${e.message})` : t('sync_push_fail')); } finally { setBusy(null); }
  };

  const doPull = async () => {
    if (busy) return;
    setBusy('pull'); setMsg(t('sync_pull_msg')); try {
      const r = await pullMaster(); { const now = new Date(); setLastPull(`${fmtDateInTz(now, lang)} ${fmtTimeInTz(now)}`); }
      refreshDaysAgo();
      const doneBase = t('sync_pull_done').replace('{t}', String(r.total)).replace('{m}', String(r.per.menu ?? 0)).replace('{tb}', String(r.per.table ?? 0)).replace('{mb}', String(r.per.member ?? 0)).replace('{v}', String(r.per.voucher ?? 0));
      // E2E-HP (2026-10-26): tampilkan domain yang dilewati eksplisit
      // (404 tanpa kontrak Go) agar skip tak pernah diam-diam.
      const skipPart = r.skipped.length > 0 ? t('sync_pull_skip').replace('{n}', String(r.skipped.length)).replace('{l}', r.skipped.join(', ')) : '';
      setMsg(skipPart ? `${doneBase} ${skipPart}` : doneBase); } catch (e) { setMsg(e instanceof Error ? `${t('sync_pull_fail')} (${e.message})` : t('sync_pull_fail')); } finally { setBusy(null); }
  };

  const simulateOld = () => {
    // Demo ke level warn: ambang + 2 hari (tak ada literal tanggal).
    const demoDays = WARN_SYNC_DAYS + 2;
    setDaysAgo(demoDays);
    const demoAgo = fmtDate(new Date(Date.now() - demoDays * 86400000), lang);
    setLastPush(demoAgo);
    setLastPull(demoAgo);
    setMsg(t('sync_sim_msg'));
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title={t('sync.title')} sub={t('sync.sub')} onBack={() => navigation?.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      {level !== 'ok' ? (
        <View style={[styles.alert, level === 'block7' ? styles.alertBlock : styles.alertWarn]}>
          <Image source={require('../../../assets/images/no_connection.webp')} style={styles.alertImg} resizeMode="contain" />
          <View style={styles.alertLeft}>
            <Text style={[styles.alertTitle, isTablet && { fontSize: 16 }]}>
              {`${level === 'block7' ? t('sync.blocked') : t('sync.warn')} · ${pendingCount()} antre`}
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

      {/* Audit 2026-10-26: kartu terminal-check manual dihapus — validitas
        terminal dicek otomatis server di setiap pull (401 → logout). */}
      <View style={styles.card}>
        <Text style={[styles.cardTitle, isTablet && { fontSize: 17 }]}>{t('sync.opts')}</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('sync.auto')}</Text>
          <Switch value={autoSync} onValueChange={setAutoSync} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <Text style={styles.cardSub}>{t('sync.pullOrder')}</Text>
      </View>

      <Text style={[styles.groupLabel, isTablet && { fontSize: 14 }]}>{t('sync.queue')} ({pending + physPending + dirtyRows + printPending} {t('sync.pending')}{localN > 0 ? ` · ${t('sync_local_n').replace('{n}', String(localN))}` : ''})</Text>{(physPending > 0 || dirtyRows > 0 || printPending > 0) && (<View style={styles.card}><View style={styles.wmRow}><Text style={styles.wmLabel}>tr_esoprocessqueue</Text><Text style={styles.wmVal}>{physPending} {t('sync.pending')}</Text></View><View style={styles.wmRow}><Text style={styles.wmLabel}>syncDate NULL</Text><Text style={styles.wmVal}>{dirtyRows} {t('sync.pending')}</Text></View><View style={styles.wmRow}><Text style={styles.wmLabel}>tr_printqueue</Text><Text style={styles.wmVal}>{printPending} {t('sync.pending')}</Text></View></View> )}{pendingRevoke.length > 0 && (<View style={styles.card}><Text style={styles.qDesc}>{t('action_logout')}: {t('sync.pending')} ({pendingRevoke.length})</Text></View> )}{localOnly.length > 0 && (<View style={styles.card}><Text style={[styles.cardTitle, isTablet && { fontSize: 17 }]}>{t('sync.localOnlyTitle')} ({localOnly.length})</Text><Text style={styles.cardSub}>{t('sync.localOnlyDesc')}</Text>{localOnly.map((r) => (<View key={r.id} style={styles.wmRow}><Text style={styles.wmLabel}>{r.tableName} · {r.op}</Text><Text style={styles.wmVal}>{fmtTime(r.createdAt)}</Text></View>))}</View> )}{queue.length === 0 && physPending === 0 && dirtyRows === 0 && printPending === 0 && (<View style={styles.card}><Text style={styles.cardSub}>{t('sync.emptyQueue')}</Text></View> )}
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
          {/* C8 UI-jujur: catatan fail-once (BLOCKED/S10) tampil bila ada. */}
          {q.note ? <Text style={styles.qDesc}>{q.note}</Text> : null}
          <Text style={styles.qTime}>{q.createdAt}</Text>
        </View>
      ))}
      {/* Simulasi hanya di build dev: di produksi tombol disembunyikan agar
        banner peringatan sync tak bisa dipalsukan kasir. */}
      {__DEV__ ? (
        <AppButton size="md" title={t('sync.simOld')} onPress={simulateOld} variant="secondary" style={styles.simBtn} textStyle={styles.simBtnText} />
      ) : null}
      <Text style={styles.foot}>{t('sync_foot')}</Text>
      </ScrollView>
    </View>
  );}const styles = StyleSheet.create({
  burger: { width: 22, height: 22 },
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
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