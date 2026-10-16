import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

interface QueueItem {
  id: string;
  kind: string;
  desc: string;
  createdAt: string;
  status: 'antre' | 'terkirim' | 'gagal';
}

const DEFAULT_QUEUE: QueueItem[] = [
  { id: 'q1', kind: 'Penjualan', desc: 'TRX-20261016-014 · Rp 64.050 · Tunai', createdAt: '16 Okt 12:40', status: 'antre' },
  { id: 'q2', kind: 'Shift', desc: 'Shift Pagi · kas awal Rp 200.000', createdAt: '16 Okt 08:57', status: 'terkirim' },
  { id: 'q3', kind: 'Pengeluaran', desc: 'Gas 3kg · Rp 145.000', createdAt: '15 Okt 17:20', status: 'gagal' },
  { id: 'q4', kind: 'Penjualan', desc: 'TRX-20261015-089 · Rp 132.000 · QRIS', createdAt: '15 Okt 19:02', status: 'terkirim' },
];

/** Hari sejak sync sukses terakhir (mock) → level peringatan 3/7 hari. */
function warnLevel(daysAgo: number): 'ok' | 'warn3' | 'block7' {
  if (daysAgo > 7) return 'block7';
  if (daysAgo > 3) return 'warn3';
  return 'ok';
}

export default function SyncScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [autoSync, setAutoSync] = useState(true);
  const [syncOnWifi, setSyncOnWifi] = useState(false);
  const [lastPush, setLastPush] = useState('16 Okt 2026 12:35');
  const [lastPull, setLastPull] = useState('16 Okt 2026 12:35');
  const [daysAgo, setDaysAgo] = useState(0);
  const [busy, setBusy] = useState<'push' | 'pull' | null>(null);
  const [msg, setMsg] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>(DEFAULT_QUEUE);

  const level = warnLevel(daysAgo);
  const pending = useMemo(() => queue.filter((q) => q.status !== 'terkirim').length, [queue]);

  const fakeSend = (mode: 'push' | 'pull', done: () => void) => {
    setBusy(mode);
    setMsg(mode === 'push' ? 'Mengirim antrean…' : 'Menarik data master…');
    setTimeout(() => {
      done();
      setBusy(null);
    }, 1200);
  };

  const doPush = () => {
    if (busy) return;
    fakeSend('push', () => {
      setQueue((qs) => qs.map((q) => (q.status === 'terkirim' ? q : { ...q, status: 'terkirim' })));
      setLastPush('16 Okt 2026 12:45 (baru saja)');
      setDaysAgo(0);
      setMsg('Push selesai — antrean terkirim.');
    });
  };

  const doPull = () => {
    if (busy) return;
    fakeSend('pull', () => {
      setLastPull('16 Okt 2026 12:45 (baru saja)');
      setDaysAgo(0);
      setMsg('Pull selesai — menu/promo/pengguna diperbarui.');
    });
  };

  const simulateOld = () => {
    setDaysAgo(5);
    setLastPush('11 Okt 2026 09:12');
    setLastPull('11 Okt 2026 09:12');
    setMsg('Simulasi: sync terakhir 5 hari lalu.');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sinkronisasi</Text>
        <Text style={styles.headerSub}>Push/pull manual · watermark · antrean offline</Text>
      </View>

      {level !== 'ok' ? (
        <View style={[styles.alert, level === 'block7' ? styles.alertBlock : styles.alertWarn]}>
          <Image source={require('../../../assets/images/no_connection.webp')} style={styles.alertImg} resizeMode="contain" />
          <View style={styles.alertLeft}>
            <Text style={styles.alertTitle}>
              {level === 'block7' ? 'Kasir diblokir — sync > 7 hari' : 'Peringatan — sync > 3 hari'}
            </Text>
            <Text style={styles.alertSub}>
              {level === 'block7'
                ? 'Kode E00044: lakukan push/pull agar bisa transaksi lagi.'
                : 'Segera sinkronkan agar data tidak menumpuk.'}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Watermark Terakhir</Text>
        <View style={styles.wmRow}>
          <Text style={styles.wmLabel}>Push terakhir</Text>
          <Text style={styles.wmVal}>{lastPush}</Text>
        </View>
        <View style={styles.wmRow}>
          <Text style={styles.wmLabel}>Pull terakhir</Text>
          <Text style={styles.wmVal}>{lastPull}</Text>
        </View>
        <View style={styles.btnRow}>
          <Pressable style={[styles.btnPush, busy && styles.btnDisabled]} onPress={doPush} disabled={!!busy}>
            <Text style={styles.btnPushText}>{busy === 'push' ? 'Push…' : 'Push Sekarang'}</Text>
          </Pressable>
          <Pressable style={[styles.btnPull, busy && styles.btnDisabled]} onPress={doPull} disabled={!!busy}>
            <Text style={styles.btnPullText}>{busy === 'pull' ? 'Pull…' : 'Pull Sekarang'}</Text>
          </Pressable>
        </View>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Opsi Sinkronisasi</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Sync otomatis berkala</Text>
          <Switch value={autoSync} onValueChange={setAutoSync} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>Hanya saat Wi-Fi</Text>
          <Switch value={syncOnWifi} onValueChange={setSyncOnWifi} trackColor={{ true: colors.green, false: colors.stroke }} />
        </View>
        <Text style={styles.cardSub}>Urutan pull: cabang → menu → pengguna → promo/voucher → pengaturan. Push: shift → penjualan → expense → deposit.</Text>
      </View>

      <Text style={styles.groupLabel}>Antrean Offline ({pending} tertunda)</Text>
      {queue.map((q) => (
        <View key={q.id} style={styles.card}>
          <View style={styles.qTop}>
            <Text style={styles.qKind}>{q.kind}</Text>
            <View style={[styles.qBadge, q.status === 'terkirim' ? styles.qOk : q.status === 'gagal' ? styles.qFail : styles.qWait]}>
              <Text style={[styles.qBadgeText, q.status === 'terkirim' ? styles.qOkText : q.status === 'gagal' ? styles.qFailText : styles.qWaitText]}>
                {q.status === 'terkirim' ? 'Terkirim' : q.status === 'gagal' ? 'Gagal' : 'Antre'}
              </Text>
            </View>
          </View>
          <Text style={styles.qDesc}>{q.desc}</Text>
          <Text style={styles.qTime}>{q.createdAt}</Text>
        </View>
      ))}

      <Pressable style={styles.btnGhost} onPress={simulateOld}>
        <Text style={styles.btnGhostText}>Simulasikan sync 5 hari lalu</Text>
      </Pressable>
      <Text style={styles.foot}>Mock in-memory — tanpa localStorage. Enforcement nyata: blokir &gt; 7 hari (E00044).</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },
  header: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 16, paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  groupLabel: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginTop: 18, marginBottom: 2, paddingHorizontal: 16 },
  alert: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, marginHorizontal: 16, marginTop: 12, borderWidth: 1 },
  alertWarn: { backgroundColor: colors.paleAmber, borderColor: colors.amber },
  alertBlock: { backgroundColor: colors.paleRed, borderColor: colors.red },
  alertImg: { width: 56, height: 56, marginRight: 10 },
  alertLeft: { flex: 1 },
  alertTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  alertSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
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
  foot: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14, paddingHorizontal: 24 },
});
