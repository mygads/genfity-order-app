import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, wideCenter } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { useLang } from '../../lib/i18n';
import { getJSON, setJSON } from '../../lib/storage';

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

/** Kanonis mengikuti TablesScreen: no tanpa strip (A1/A2/B1) + section Dalam/Teras/VIP. */
const SECTION_OF: Record<string, string> = {
  A1: 'Dalam', A2: 'Dalam', A3: 'Dalam', A4: 'Dalam',
  B1: 'Teras', B2: 'Teras', B3: 'Teras',
  C1: 'VIP', C2: 'VIP',
};
const CANON_IDS = new Set(Object.keys(SECTION_OF));
/** Kode lama ber-strip ("A-01" → "A1", "VIP-2" → "C2") ke kanonis. */
function canonTableNo(raw: string): string {
  const t = (raw || '').trim().toUpperCase();
  if (t === 'VIP-1' || t === 'VIP1') return 'C1';
  if (t === 'VIP-2' || t === 'VIP2') return 'C2';
  const m = t.match(/^([A-Z]+)-?0*(\d+)$/);
  if (m) return `${m[1]}${m[2]}`;
  return t.replace(/-/g, '');
}
/** Tampilkan elapsed live: menit + detik (tick 10 detik) agar tak diam 60 detik. */
function fmtLive(elapsedMin: number): string {
  const totalSec = Math.max(0, Math.round(elapsedMin * 60));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m} mnt ${s} dtk`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h} jam ${s} dtk` : `${h} jam ${mm} mnt`;
}

const DEFAULT_TABLES: TableTimer[] = [
  { id: 'A2', elapsed: 25, limit: 90 },
  { id: 'B1', elapsed: 48, limit: 90 },
  { id: 'B2', elapsed: 70, limit: 90 },
  { id: 'C2', elapsed: 35, limit: 120 },
];

const DEFAULT_CFG: TimerConfig = { enabled: true, limit: '90', warnBefore: '10', startMode: 'duduk', autoExtend: false };

/** Timer meja: batas + peringatan tersimpan di perangkat, tick live tiap 10 detik. */
export default function TableTimerScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [enabled, setEnabled] = useState(DEFAULT_CFG.enabled);
  const [limit, setLimit] = useState(DEFAULT_CFG.limit);
  const [warnBefore, setWarnBefore] = useState(DEFAULT_CFG.warnBefore);
  const [startMode, setStartMode] = useState<StartMode>(DEFAULT_CFG.startMode);
  const [autoExtend, setAutoExtend] = useState(DEFAULT_CFG.autoExtend);
  const [tables, setTables] = useState<TableTimer[]>(DEFAULT_TABLES);
  const [loaded, setLoaded] = useState(false);

  // Muat konfigurasi + snapshot timer; migrasi id lama ber-strip ke kanonis.
  useEffect(() => {
    let on = true;
    (async () => {
      const [cfg, tim] = await Promise.all([
        getJSON<TimerConfig>(CFG_KEY, DEFAULT_CFG),
        getJSON<TableTimer[]>(TIM_KEY, DEFAULT_TABLES),
      ]);
      if (!on) return;
      setEnabled(cfg.enabled);
      setLimit(cfg.limit);
      setWarnBefore(cfg.warnBefore);
      setStartMode(cfg.startMode === 'order' ? 'order' : 'duduk');
      setAutoExtend(!!cfg.autoExtend);
      if (Array.isArray(tim) && tim.length > 0) {
        const seen = new Set<string>();
        const migrated = tim
          .map((x) => ({ ...x, id: canonTableNo(x.id) }))
          .filter((x) => CANON_IDS.has(x.id) && !seen.has(x.id) && (seen.add(x.id), true));
        setTables(migrated.length > 0 ? migrated : DEFAULT_TABLES);
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
        right={
          <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rowLeft}>
              <Text style={styles.cardTitle}>{t('tmr_enable')}</Text>
              <Text style={styles.cardSub}>Timer berjalan {startMode === 'duduk' ? 'sejak pelanggan duduk' : 'sejak order pertama'}.</Text>
            </View>
            <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.green, false: colors.stroke }} />
          </View>
          <Text style={styles.fieldLabel}>Batas waktu (menit)</Text>
          <TextInput style={styles.input} value={limit} onChangeText={setLimit} keyboardType="numeric" placeholder="90" placeholderTextColor={colors.faint} />
          <Text style={styles.fieldLabel}>Peringatkan sebelum habis (menit)</Text>
          <TextInput style={styles.input} value={warnBefore} onChangeText={setWarnBefore} keyboardType="numeric" placeholder="10" placeholderTextColor={colors.faint} />
          <Text style={styles.fieldLabel}>Timer mulai saat</Text>
          <View style={styles.chipRow}>
            {(['duduk', 'order'] as StartMode[]).map((m) => (
              <Pressable key={m} onPress={() => setStartMode(m)} style={[styles.chip, startMode === m && styles.chipActive]}>
                <Text style={[styles.chipText, startMode === m && styles.chipTextActive]}>
                  {m === 'duduk' ? 'Pelanggan duduk' : 'Order pertama'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>Perpanjang otomatis bila lewat batas (+15 mnt)</Text>
            <Switch value={autoExtend} onValueChange={setAutoExtend} trackColor={{ true: colors.green, false: colors.stroke }} />
          </View>
          <Text style={styles.modeNote}>
            {startMode === 'duduk'
              ? 'Mulai dihitung sejak pelanggan duduk.'
              : 'Mode order pertama: offline disamakan dengan duduk; selisih pencatatan order menyusul.'}
            {autoExtend ? ' Auto-extend aktif: limit +15 otomatis saat lewat batas.' : ''}
          </Text>
        </View>

        <Text style={styles.groupLabel}>{t('tmr_running')}</Text>
        {tables.map((x) => {
          const remain = x.limit - x.elapsed;
          const danger = enabled && remain <= warn;
          const over = enabled && remain < 0;
          const sisa = Math.max(0, Math.ceil(remain));
          const lewat = Math.max(1, Math.floor(-remain));
          return (
            <View key={x.id} style={[styles.card, danger && styles.cardWarn, over && styles.cardOver]}>
              <View style={styles.timerTop}>
                <Text style={styles.timerId}>Meja {x.id}{SECTION_OF[x.id] ? ` · ${SECTION_OF[x.id]}` : ''}</Text>
                <Text style={[styles.timerState, over ? styles.over : danger ? styles.warn : styles.ok]}>
                  {over ? `Lewat ${lewat} mnt` : `Sisa ${sisa} mnt`}{enabled ? ' • live' : ''}
                </Text>
              </View>
              <Text style={styles.timerSub}>
                {startMode === 'duduk' ? 'Duduk' : 'Order'} {fmtLive(x.elapsed)} · batas {x.limit} mnt
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, Math.round((x.elapsed / x.limit) * 100))}%`, backgroundColor: over ? colors.red : danger ? colors.orange : colors.green }]} />
              </View>
              <View style={styles.timerBtns}>
                <Pressable style={styles.btnGhost} onPress={() => reset(x.id)}>
                  <Text style={styles.btnGhostText}>Reset</Text>
                </Pressable>
                <Pressable style={styles.btnGhost} onPress={() => extend(x.id, 15)}>
                  <Text style={styles.btnGhostText}>+15 mnt</Text>
                </Pressable>
                <Pressable style={styles.btnGhost} onPress={() => extend(x.id, 30)}>
                  <Text style={styles.btnGhostText}>+30 mnt</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
        <Text style={styles.foot}>Peringatan muncul {warn} menit sebelum batas - tersimpan di perangkat.</Text>
      </ScrollView>
      <DrawerMenu
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigate={(r) => {
          navigation?.navigate(r);
        }}
      />
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
  btnGhost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 9, alignItems: 'center' },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14 },
});
