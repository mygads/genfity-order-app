/**
 * B2 — TerminalPicker (SPEC B1 langkah 2): daftar terminal satu branch
 * dari BE via fetchBranchTerminals (E09). Baris: nama/tag/pinSet
 * (pinSet sebagai indikator ●/○ + label terminal_pin_title — preseden
 * glif ■/□/● di kunci dash_legend). Gagal BE → status need_be jujur;
 * fixture dev → label mode_local. Pilih → TerminalPin.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';
import { fetchBranchTerminals, type TerminalItem } from '../../lib/terminalApi';
import { useLang } from '../../lib/i18n';
import ScreenRoot from '../../components/ScreenRoot';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack?: () => void;
};

type Route = {
  params?: {
    branchId?: string;
    branchName?: string;
  };
};

const GREY = '#757575';
const TITLE_DARK = '#2B2B2B';

export default function TerminalPickerScreen({
  navigation,
  route,
}: {
  navigation?: Nav;
  route?: Route;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang();
  const branchId = (route?.params?.branchId ?? '').trim();
  const branchName = (route?.params?.branchName ?? '').trim() || branchId;
  const [terminals, setTerminals] = useState<TerminalItem[]>([]);
  const [fromDummy, setFromDummy] = useState(false);
  const [needBe, setNeedBe] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!branchId) {
          if (live) {
            setTerminals([]);
            setNeedBe(true);
            setLoading(false);
          }
          return;
        }
        const r = await fetchBranchTerminals(branchId);
        if (!live) return;
        if (r.ok) {
          setTerminals(r.data.terminals);
          setFromDummy(r.fromDummy);
          setNeedBe(false);
        } else {
          setTerminals([]);
          setFromDummy(false);
          setNeedBe(true);
        }
      } catch {
        if (live) {
          setTerminals([]);
          setFromDummy(false);
          setNeedBe(true);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [branchId]);

  const choose = (terminal: TerminalItem) => {
    navigation?.navigate('TerminalPin', {
      branchId,
      branchName,
      terminalId: terminal.terminalId,
      terminalCode: terminal.terminalCode,
      terminalName: terminal.name,
      tag: terminal.tag,
    });
  };

  return (
    <ScreenRoot style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          onPress={() => navigation?.goBack?.()}
          hitSlop={12}
          style={styles.backRow}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isTablet && styles.titleBig]}>
          {t('terminal_pick_title')}
        </Text>
        <Text style={[styles.desc, isTablet && styles.descBig]}>{branchName}</Text>
        {needBe ? <Text style={styles.offline}>{t('need_be')}</Text> : null}
        {fromDummy ? (
          <Text style={styles.offline}>
            {t('mode_local')}
            {lang === 'id'
              ? ' — daftar terminal bawaan (dev).'
              : ' — built-in terminal list (dev).'}
          </Text>
        ) : null}
        {loading ? (
          <ActivityIndicator size="small" color="#1E88E5" style={styles.loader} />
        ) : terminals.length === 0 ? (
          <Text style={styles.empty}>{needBe ? t('need_be') : t('sel_empty')}</Text>
        ) : (
          terminals.map((x) => (
            <TouchableOpacity
              key={x.terminalId || x.terminalCode}
              style={styles.card}
              onPress={() => choose(x)}>
              <View style={styles.avatar}>
                <Text style={styles.avatarT}>T</Text>
              </View>
              <View style={styles.info}>
                <Text style={[styles.name, isTablet && styles.nameBig]}>
                  {x.name || x.terminalCode}
                </Text>
                <Text style={[styles.meta, isTablet && styles.metaBig]}>
                  {x.terminalCode}
                  {x.tag ? ` · ${x.tag}` : ''}
                </Text>
              </View>
              <Text style={[styles.pinBadge, !x.pinSet && styles.pinBadgeOff]}>
                {x.pinSet ? '●' : '○'} {t('terminal_pin_title')}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </ScreenRoot>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32, flexGrow: 1 },
  backRow: { alignSelf: 'flex-start', paddingRight: 16, paddingBottom: 8 },
  back: { fontSize: 28, color: '#4A4A4A', fontFamily: fonts.bold },
  title: { fontFamily: fonts.bold, fontSize: 20, color: TITLE_DARK },
  titleBig: { fontSize: 24 },
  desc: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: GREY,
    marginTop: 6,
    lineHeight: 19,
  },
  descBig: { fontSize: 15, lineHeight: 21 },
  nameBig: { fontSize: 17 },
  metaBig: { fontSize: 14, lineHeight: 20 },
  loader: { marginTop: 28, alignSelf: 'flex-start' },
  offline: { fontFamily: fonts.regular, fontSize: 12, color: GREY, marginTop: 6 },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: GREY,
    textAlign: 'center',
    marginTop: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    marginTop: 2,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarT: { fontFamily: fonts.bold, fontSize: 18, color: colors.navy },
  info: { flex: 1 },
  name: { fontFamily: fonts.bold, fontSize: 15, color: TITLE_DARK },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: GREY, marginTop: 2 },
  pinBadge: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy },
  pinBadgeOff: { color: GREY },
});
