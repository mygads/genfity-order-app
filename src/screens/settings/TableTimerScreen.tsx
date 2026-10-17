import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import { useLang } from '../../lib/i18n';
import { getJSON, setJSON } from '../../lib/storage';
import { getRoundingSetting, initDb, query, type RoundingSetting } from '../../lib/db';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type StartMode = 'duduk' | 'order';

interface TableTimer {
  id: string;
  elapsed: number;
  limit: number;
}

interface TimerConfig {
  enabled: boolean;
  limit: string;
  warnBefore: string;
  startMode: StartMode;
  autoExtend: boolean;
}

const CFG_KEY = 'genfity.tabletimer.config';
const TIM_KEY = 'genfity.tabletimer.timers';
/** Diekspor untuk F2: TablesScreen membaca persist ini sebagai sumber utama. */
export { CFG_KEY as TABLE_TIMER_CFG_KEY, TIM_KEY as TABLE_TIMER_TIM_KEY };

/** Kanonis mengikuti TablesScreen: no tanpa strip (A1/A2/B1) + section Dalam/Teras/VIP. */
const SECTION_OF: Record<string, string> = {
  A1: 'Dalam', A2: 'Dalam', A3: 'Dalam', A4: 'Dalam',
  B1: 'Teras', B2: 'Teras', B3: 'Teras',
  C1: 'VIP', C2: 'VIP',
};
const CANON_IDS = new Set(Object.keys(SECTION_OF));
/** Kode lama ber-strip ("A-01" → "A1", "VIP-2" → "C2") ke kanonis. Diekspor untuk F2. */
export function canonTableNo(raw: string): string {
  const t = (raw || '').trim().toUpperCase();
  if (t === 'VIP-1' || t === 'VIP1') return 'C1';
  if (t === 'VIP-2' || t === 'VIP2') return 'C2';
  const m = t.match(/^([A-Z]+)-?0*(\d+)$/);
  if (m) return `${m[1]}${m[2]}`;
  return t.replace(/-/g, '');
}
/** Tampilkan elapsed live: menit + detik (tick 10 detik) agar tak diam 60 detik. */
function fmtLive(elapsedMin: number, u: { min: string; sec: string; hour: string }): string {
  const totalSec = Math.max(0, Math.round(elapsedMin * 60));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m} ${u.min} ${s} ${u.sec}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h} ${u.hour} ${s} ${u.sec}` : `${h} ${u.hour} ${mm} ${u.min}`;
}

/** Tanpa timer awal: daftar mulai kosong, timer dibuat dari aktivitas meja. */

const DEFAULT_CFG: TimerConfig = { enabled: true, limit: '90', warnBefore: '10', startMode: 'duduk', autoExtend: false };

/** Timer meja: batas + peringatan tersimpan di perangkat, tick live tiap 10 detik. */
export default function TableTimerScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [enabled, setEnabled] = useState(DEFAULT_CFG.enabled);
  const [limit, setLimit] = useState(DEFAULT_CFG.limit);
  const [warnBefore, setWarnBefore] = useState(DEFAULT_CFG.warnBefore);
  const [startMode, setStartMode] = useState<StartMode>(DEFAULT_CFG.startMode);
  const [autoExtend, setAutoExtend] = useState(DEFAULT_CFG.autoExtend);
  const [tables, setTables] = useState<TableTimer[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Section live per nomor kanonis dari ms_table; null = fallback SECTION_OF. */
  const [liveSections, setLiveSections] = useState<Record<string, string> | null>(null);
  // REA-14 display-only: info pembulatan dari ms_setting (tanpa ubah rumus).
  const [rounding, setRounding] = useState<RoundingSetting>({ mode: '', nearest: 0, step: 100 });

  // Muat konfigurasi + snapshot timer; migrasi id lama ber-strip ke kanonis.
  useEffect(() => {
    let on = true;
    (async () => {
      const [cfg, tim, rnd] = await Promise.all([
        getJSON<TimerConfig>(CFG_KEY, DEFAULT_CFG),
        getJSON<TableTimer[]>(TIM_KEY, []),
        getRoundingSetting(),
      ]);
      if (!on) return;
      setEnabled(cfg.enabled);
      setLimit(cfg.limit);
      setWarnBefore(cfg.warnBefore);
      setStartMode(cfg.startMode === 'order' ? 'order' : 'duduk');
      setAutoExtend(!!cfg.autoExtend);
      setRounding(rnd);
      // Validasi id timer terhadap denah live ms_table (fallback kanonis bila
      // DB kosong) agar timer meja di luar set hardcode (mis. C3 seed) tak
      // terbuang diam-diam.
      let validIds: Set<string> | null = null;
      try {
        await initDb();
        const rows = await query<{ tableNo: string | null; sectionId: string | null }>(
          'SELECT tableNo, sectionId FROM ms_table LIMIT 60',
        );
        if (rows.length > 0) {
          validIds = new Set<string>();
          const secMap: Record<string, string> = {};
          for (const r of rows) {
            const no = canonTableNo(String(r.tableNo ?? ''));
            if (!no) continue;
            validIds.add(no);
            secMap[no] = (r.sectionId ?? '').trim();
          }
          if (on) setLiveSections(secMap);
        }
      } catch { /* fallback kanonis */ }
      if (Array.isArray(tim) && tim.length > 0) {
        const seen = new Set<string>();
        const valid = validIds ?? CANON_IDS;
        const migrated = tim
          .map((x) => ({ ...x, id: canonTableNo(x.id) }))
          .filter((x) => valid.has(x.id) && !seen.has(x.id) && (seen.add(x.id), true));
        setTables(migrated);
      }
      setLoaded(true);
    })();
    return () => {
      on = false;
    };
  }, []);

  // Simpan tiap perubahan konfigurasi.
  useEffect(() => {
    if (!loaded) return;
    void setJSON(CFG_KEY, { enabled, limit, warnBefore, startMode, autoExtend });
  }, [enabled, limit, warnBefore, startMode, autoExtend, loaded]);

  // Timer live: tick tiap 10 detik (+10/60 mnt) agar elapsed terlihat bergerak,
  // bukan diam 60 detik. autoExtend aktif: limit +15 otomatis saat lewat batas.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      setTables((ts) => {
        const next = ts.map((x) => {
          const elapsed = Math.round((x.elapsed + 10 / 60) * 100) / 100;
          if (autoExtend && elapsed > x.limit) {
            return { ...x, elapsed, limit: x.limit + 15 };
          }
          return { ...x, elapsed };
        });
        void setJSON(TIM_KEY, next);
        return next;
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [enabled, autoExtend]);

  const lim = Math.max(1, Number(limit) || 90);
  const warn = Math.max(0, Number(warnBefore) || 0);

  const reset = (id: string) => {
    setTables((ts) => {
      const next = ts.map((x) => (x.id === id ? { ...x, elapsed: 0, limit: lim } : x));
      void setJSON(TIM_KEY, next);
      return next;
    });
  };

  const extend = (id: string, mins: number) => {
    setTables((ts) => {
      const next = ts.map((x) => (x.id === id ? { ...x, limit: x.limit + mins } : x));
      void setJSON(TIM_KEY, next);
      return next;
    });
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('title_timer')}
        sub={t('tmr_sub')}
        onBack={() => navigation?.goBack()}
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rowLeft}>
              <Text style={[styles.cardTitle, isTablet && styles.cardTitleBig]}>{t('tmr_enable')}</Text>
              <Text style={[styles.cardSub, isTablet && styles.cardSubBig]}>{startMode === 'duduk' ? t('tmr_run_seated') : t('tmr_run_order')}</Text>
            </View>
            <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.green, false: colors.stroke }} />
          </View>
          <AppInput label={t('tmr_limit_label')} value={limit} onChangeText={setLimit} keyboardType="numeric" placeholder="90" style={isTablet ? styles.inputBig : undefined} />
          <AppInput label={t('tmr_warn_label')} value={warnBefore} onChangeText={setWarnBefore} keyboardType="numeric" placeholder="10" style={isTablet ? styles.inputBig : undefined} />
          <Text style={[styles.fieldLabel, isTablet && styles.fieldLabelBig]}>{t('tmr_start_label')}</Text>
          <View style={styles.chipRow}>
            {(['duduk', 'order'] as StartMode[]).map((m) => (
              <Pressable key={m} onPress={() => setStartMode(m)} style={[styles.chip, startMode === m && styles.chipActive]}>
                <Text style={[styles.chipText, startMode === m && styles.chipTextActive, isTablet && styles.chipTextBig]}>
                  {m === 'duduk' ? t('tmr_mode_seated') : t('tmr_mode_order')}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.rowBetween}>
            <Text style={[styles.rowLabel, isTablet && styles.rowLabelBig]}>{t('tmr_extend_label')}</Text>
            <Switch value={autoExtend} onValueChange={setAutoExtend} trackColor={{ true: colors.green, false: colors.stroke }} />
          </View>
          <Text style={[styles.modeNote, isTablet && styles.modeNoteBig]}>
            {startMode === 'duduk' ? t('tmr_note_seated') : t('tmr_note_order')}
            {autoExtend ? ` ${t('tmr_note_extend')}` : ''}
          </Text>
        </View>

        <Text style={[styles.groupLabel, isTablet && styles.groupLabelBig]}>{t('tmr_running')}</Text>
        {tables.map((x) => {
          const remain = x.limit - x.elapsed;
          const danger = enabled && remain <= warn;
          const over = enabled && remain < 0;
          const sisa = Math.max(0, Math.ceil(remain));
          const lewat = Math.max(1, Math.floor(-remain));
          const secRaw = liveSections?.[x.id] ?? SECTION_OF[x.id] ?? '';
          const sec = secRaw === 'Dalam' ? t('tmr_sec_dalam') : secRaw === 'Teras' ? t('tmr_sec_teras') : secRaw === 'VIP' ? t('tmr_sec_vip') : secRaw;
          const units = { min: t('tmr_u_min'), sec: t('tmr_u_sec'), hour: t('tmr_u_hour') };
          return (
            <View key={x.id} style={[styles.card, danger && styles.cardWarn, over && styles.cardOver]}>
              <View style={styles.timerTop}>
                <Text style={[styles.timerId, isTablet && styles.timerIdBig]}>{t('c_table')} {x.id}{sec ? ` · ${sec}` : ''}</Text>
                <Text style={[styles.timerState, over ? styles.over : danger ? styles.warn : styles.ok, isTablet && styles.timerStateBig]}>
                  {over ? t('tmr_over').replace('{n}', String(lewat)) : t('tmr_left').replace('{n}', String(sisa))}{enabled ? ` • ${t('tmr_live')}` : ''}
                </Text>
              </View>
              <Text style={[styles.timerSub, isTablet && styles.timerSubBig]}>
                {startMode === 'duduk' ? t('tmr_elapsed_seated') : t('tmr_elapsed_order')} {fmtLive(x.elapsed, units)} · {t('tmr_limit_is').replace('{n}', String(x.limit))}
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, Math.round((x.elapsed / x.limit) * 100))}%`, backgroundColor: over ? colors.red : danger ? colors.orange : colors.green }]} />
              </View>
              <View style={styles.timerBtns}>
                <AppButton size="sm" title={t('tmr_reset')} onPress={() => reset(x.id)} variant="secondary" fullWidth={false} style={styles.btnFlex} textStyle={isTablet ? styles.btnGhostTextBig : undefined} />
                <AppButton size="sm" title={t('tmr_extend_btn').replace('{n}', '15')} onPress={() => extend(x.id, 15)} variant="secondary" fullWidth={false} style={styles.btnFlex} textStyle={isTablet ? styles.btnGhostTextBig : undefined} />
                <AppButton size="sm" title={t('tmr_extend_btn').replace('{n}', '30')} onPress={() => extend(x.id, 30)} variant="secondary" fullWidth={false} style={styles.btnFlex} textStyle={isTablet ? styles.btnGhostTextBig : undefined} />
              </View>
            </View>
          );
        })}
        <Text style={[styles.foot, isTablet && styles.footBig]}>{t('tmr_foot').replace('{n}', String(warn))}</Text>
        {/* REA-14: tampilkan info pembulatan hanya bila ms_setting menyimpang
            dari default (hardcode ID sementara; kunci i18n: tmr_round_info). */}
        {rounding.mode !== '' || rounding.nearest !== 0 || rounding.step !== 100 ? (
          <Text style={[styles.foot, isTablet && styles.footBig]}>
            {t('tmr_round_info').replace('{mode}', rounding.mode !== '' ? rounding.mode : 'default').replace('{n}', String(rounding.nearest)).replace('{n}', String(rounding.step))}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  burger: { width: 22, height: 22 },
  body: { paddingBottom: 32 },
  groupLabel: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginTop: 18, marginBottom: 2, paddingHorizontal: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardWarn: { borderColor: colors.orange },
  cardOver: { borderColor: colors.red },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  rowLeft: { flex: 1, paddingRight: 10 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  modeNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginTop: 8 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 10 },
  input: {
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
  chipRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  chip: { borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted },
  chipTextActive: { color: colors.white },
  timerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timerId: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  timerState: { fontFamily: fonts.bold, fontSize: 13 },
  ok: { color: colors.greenDark },
  warn: { color: colors.orangeDark },
  over: { color: colors.red },
  timerSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.bg, marginTop: 8, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  timerBtns: { flexDirection: 'row', gap: 6, marginTop: 10 },
  btnFlex: { marginTop: 0, flex: 1 },
  btnGhost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 9, alignItems: 'center' },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14 },
  /* Varian tablet (breakpoint 768): teks +1..2pt agar proporsional di layar lebar. */
  groupLabelBig: { fontSize: 14 },
  cardTitleBig: { fontSize: 16 },
  cardSubBig: { fontSize: 13 },
  fieldLabelBig: { fontSize: 13 },
  inputBig: { fontSize: 15 },
  chipTextBig: { fontSize: 12 },
  rowLabelBig: { fontSize: 14 },
  modeNoteBig: { fontSize: 12 },
  timerIdBig: { fontSize: 18 },
  timerStateBig: { fontSize: 14 },
  timerSubBig: { fontSize: 13 },
  btnGhostTextBig: { fontSize: 13 },
  footBig: { fontSize: 12 },
});
