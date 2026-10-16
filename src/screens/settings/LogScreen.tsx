import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';
import { useLang } from '../../lib/i18n';
import { getJSON, setJSON } from '../../lib/storage';
import { shareReceipt } from '../../lib/print';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type LogLevel = 'Info' | 'Peringatan' | 'Error';

interface AppLog {
  id: string;
  time: string;
  level: LogLevel;
  tag: string;
  message: string;
  detail: string;
}

const LS_LOGS = 'genfity.applog.items';
const MAX_LOGS = 200;

/** Seed log terhubung kejadian nyata (sync, cetak, shift, display). Rupiah selalu via rp(). */
function seedLogs(now: Date, lang: 'id' | 'en'): AppLog[] {
  const en = lang === 'en';
  const day = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  const hm = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return [
    { id: 'l1', time: `${day} ${hm}`, level: 'Info', tag: 'sync', message: en ? 'Menu pull done - 68 items' : 'Pull menu selesai - 68 item', detail: en ? 'pull/menu endpoint: 68 rows, pullDateTime watermark updated. No price conflicts.' : 'Endpoint pull/menu: 68 baris, watermark pullDateTime diperbarui. Tidak ada konflik harga.' },
    { id: 'l2', time: `${day} ${hm}`, level: 'Info', tag: 'sales', message: en ? 'TRX queued for sync' : 'TRX tersimpan antre', detail: en ? `Subtotal ${rp(61000)}, service ${rp(3050)}, total ${rp(64050)}, Cash. syncDate NULL: awaiting push.` : `Subtotal ${rp(61000)}, service ${rp(3050)}, total ${rp(64050)}, Tunai. syncDate NULL: menunggu push.` },
    { id: 'l3', time: `${day} ${hm}`, level: 'Peringatan', tag: 'printer', message: en ? 'Kitchen printer not responding' : 'Printer Dapur tidak menjawab', detail: en ? 'TCP 192.168.1.50:9100 timed out after 5s sending a ticket. Ticket held in the print queue, retry from Kitchen Tickets.' : 'TCP 192.168.1.50:9100 timeout 5 dtk saat kirim tiket. Tiket ditahan di antrean cetak, coba lagi dari Tiket Dapur.' },
    { id: 'l4', time: `${day} ${hm}`, level: 'Error', tag: 'sync', message: en ? 'Expense push failed (2x)' : 'Push expense gagal (2x)', detail: en ? 'branch-expenses push timed out. Item marked failed, retried on the next push. Local data is safe.' : 'Push branch-expenses timeout. Item ditandai gagal, dicoba pada push berikutnya. Data lokal aman.' },
    { id: 'l5', time: `${day} ${hm}`, level: 'Info', tag: 'shift', message: en ? 'Morning shift opened' : 'Shift Pagi dibuka', detail: en ? `Cashier Gista, opening float ${rp(200000)}, terminal TRM-001, branch BR-01.` : `Kasir Gista, kas awal ${rp(200000)}, terminal TRM-001, cabang BR-01.` },
    { id: 'l6', time: `${day} ${hm}`, level: 'Info', tag: 'display', message: en ? 'Customer display calling A-03' : 'Display pelanggan memanggil A-03', detail: en ? 'Call event: ticket A-03 moved to Ready for Pickup, broadcast locally + via WS when available.' : 'Event call: tiket A-03 dipindah ke Siap Diambil, disiarkan lokal + WS bila tersedia.' },
  ];
}

/** Tulis satu baris log persisten. Dipakai lintas layar via impor modul ini. */
export async function logApp(level: LogLevel, tag: string, message: string, detail = ''): Promise<void> {
  try {
    const items = await getJSON<AppLog[]>(LS_LOGS, []);
    const now = new Date();
    const entry: AppLog = {
      id: `l-${Date.now()}`,
      time: `${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`,
      level,
      tag,
      message,
      detail,
    };
    await setJSON(LS_LOGS, [entry, ...items].slice(0, MAX_LOGS));
  } catch {
    /* abaikan: log tak boleh memblokir kasir */
  }
}

const levelFilters = ['Semua', 'Info', 'Peringatan', 'Error'] as const;
const tagFilters = ['semua', 'sync', 'sales', 'printer', 'shift', 'display'] as const;

function levelStyle(l: LogLevel) {
  if (l === 'Error') return { bg: colors.paleRed, fg: colors.red };
  if (l === 'Peringatan') return { bg: colors.paleAmber, fg: colors.amberDark };
  return { bg: colors.paleBlue, fg: colors.navy };
}

export default function LogScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t, lang } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logs, setLogs] = useState<AppLog[]>([]);
  const [level, setLevel] = useState<(typeof levelFilters)[number]>('Semua');
  const [tag, setTag] = useState<(typeof tagFilters)[number]>('semua');
  const [selected, setSelected] = useState<AppLog | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await getJSON<AppLog[]>(LS_LOGS, []);
      if (!alive) return;
      if (cached.length === 0) {
        const seed = seedLogs(new Date(), lang);
        setLogs(seed);
        void setJSON(LS_LOGS, seed);
      } else {
        setLogs(cached);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(
    () => logs.filter((l) => (level === 'Semua' || l.level === level) && (tag === 'semua' || l.tag === tag)),
    [logs, level, tag],
  );

  const clearLogs = async () => {
    setLogs([]);
    setSelected(null);
    await setJSON(LS_LOGS, []);
  };

  const exportLogs = () => {
    const text = list.map((l) => `[${l.time}] ${l.level} #${l.tag}: ${l.message} | ${l.detail}`).join('\n');
    void shareReceipt(text || t('log_empty_export'));
  };

  const levelLabel = (f: string) =>
    f === 'Semua' || f === 'semua' ? t('common.all') : f === 'Info' ? t('log.info') : f === 'Peringatan' ? t('log.warn') : f === 'Error' ? t('log.error') : f;

  const go = (route: string) => navigation?.navigate(route);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('log.title')}
        sub={t('log.sub')}
        onBack={() => setDrawerOpen(true)}
        backLabel="☰"
        right={
          <View style={styles.headBtns}>
            <Pressable onPress={exportLogs} hitSlop={8}>
              <Text style={styles.headBtn}>{t('log.export')}</Text>
            </Pressable>
            <Pressable onPress={clearLogs} hitSlop={8}>
              <Text style={styles.headBtn}>{t('log.clear')}</Text>
            </Pressable>
          </View>
        }
      />
      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />
      <View style={styles.tabs}>
        {levelFilters.map((f) => (
          <Pressable key={f} onPress={() => setLevel(f)} style={[styles.tab, level === f && styles.tabActive]}>
            <Text style={[styles.tabText, level === f && styles.tabTextActive]}>{levelLabel(f)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.tabs}>
        {tagFilters.map((g) => (
          <Pressable key={g} onPress={() => setTag(g)} style={[styles.tab, tag === g && styles.tabActive]}>
            <Text style={[styles.tabText, tag === g && styles.tabTextActive]}>{g === 'semua' ? t('common.all') : `#${g}`}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={list}
        keyExtractor={(l) => l.id}
        contentContainerStyle={[styles.list, isTablet && wideCenter]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image source={require('../../../assets/images/empty_general.webp')} style={styles.emptyImg} resizeMode="contain" />
            <Text style={[styles.emptyTitle, isTablet && { fontSize: 18 }]}>{t('log.noLog')}</Text>
            <Text style={styles.emptySub}>{t('log.noLogSub')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const st = levelStyle(item.level);
          return (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <View style={styles.cardTop}>
                <View style={[styles.badge, { backgroundColor: st.bg }]}>
                  <Text style={[styles.badgeText, { color: st.fg }]}>{levelLabel(item.level)}</Text>
                </View>
                <Text style={styles.time}>{item.time}</Text>
              </View>
              <Text style={[styles.msg, isTablet && { fontSize: 14 }]}>{item.message}</Text>
              <Text style={styles.tag}>#{item.tag} - {t('log.tapDetail')} ›</Text>
            </Pressable>
          );
        }}
      />
      <Modal visible={selected !== null} animationType="slide" transparent>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {selected ? (
              <>
                <Text style={[styles.sheetTitle, isTablet && { fontSize: 19 }]}>{t('log.detail')}</Text>
                <Text style={styles.detailTime}>{selected.time} - #{selected.tag} - {levelLabel(selected.level)}</Text>
                <Text style={styles.detailMsg}>{selected.message}</Text>
                <Text style={styles.detailBody}>{selected.detail}</Text>
                <Pressable style={styles.btnPrimary} onPress={() => setSelected(null)}>
                  <Text style={styles.btnPrimaryText}>{t('common.close')}</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headBtns: { flexDirection: 'row', gap: 12 },
  headBtn: { color: colors.white, fontFamily: fonts.bold, fontSize: 12 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tabTextActive: { color: colors.white },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontFamily: fonts.bold, fontSize: 11 },
  time: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint },
  msg: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, marginTop: 8 },
  tag: { fontFamily: fonts.regular, fontSize: 11, color: colors.orangeDark, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyImg: { width: 180, height: 140 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 12 },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '80%' },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  detailTime: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, marginTop: 4 },
  detailMsg: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, marginTop: 8 },
  detailBody: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 8 },
  btnPrimary: { borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  btnPrimaryText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
