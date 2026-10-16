import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenterLg } from '../../theme';
import { publishDisplay, subscribeDisplay } from '../../lib/display';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type ViewMode = 'queue' | 'order' | 'success';

/** Item berjalan pada transaksi aktif (mock — nyata via event display/WS). */
const RUNNING_ITEMS = [
  { name: 'Nasi Goreng Spesial', qty: 2, price: 25000 },
  { name: 'Es Teh Manis', qty: 2, price: 8000 },
];
const RUNNING_TOTAL = 66000;
const PAID_TOTAL = 66000;

const READY0 = ['A-01', 'A-03'];
const PREP0 = ['A-04', 'A-05', 'A-06'];

export default function CustomerDisplayScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [mode, setMode] = useState<ViewMode>('queue');
  const [ready, setReady] = useState<string[]>(READY0);
  const [prep, setPrep] = useState<string[]>(PREP0);

  useEffect(() => subscribeDisplay((e) => {
    if (e.type === 'call') {
      setPrep((p) => (p[0] === e.ticket ? p.slice(1) : p.filter((t) => t !== e.ticket)));
      setReady((r) => (r.includes(e.ticket) ? r : [e.ticket, ...r].slice(0, 6)));
    } else {
      setReady((r) => (r.includes(e.ticket) ? r : [...r, e.ticket].slice(0, 6)));
    }
  }), []);

  const callNext = () => {
    if (prep.length === 0) return;
    const [next, ...rest] = prep;
    setPrep(rest);
    setReady((r) => [next, ...r].slice(0, 6));
    publishDisplay({ type: 'call', ticket: next });
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.modeRow}>
        {(['queue', 'order', 'success'] as ViewMode[]).map((m) => (
          <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.modeTab, mode === m && styles.modeTabActive]}>
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
              {m === 'queue' ? 'Antrean' : m === 'order' ? 'Transaksi' : 'Sukses'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'queue' ? (
        <>
          <View style={styles.hero}>
            <Text style={styles.shop}>ESB CABANG PORIS</Text>
            <Text style={styles.heroSub}>Nomor pesanan Anda tampil di bawah</Text>
          </View>
          <View style={[styles.cols, !isTablet && styles.colsPhone]}>
            <View style={styles.col}>
              <Text style={styles.colTitle}>⏳ Disiapkan</Text>
              {prep.length === 0 && <Text style={styles.empty}>—</Text>}
              {prep.map((n) => (
                <View key={n} style={styles.ticketPrep}>
                  <Text style={[styles.ticketNo, isTablet && styles.ticketNoBig]}>{n}</Text>
                </View>
              ))}
            </View>
            <View style={styles.col}>
              <Text style={styles.colTitle}>🔔 Siap Diambil</Text>
              {ready.length === 0 && <Text style={styles.empty}>—</Text>}
              {ready.map((n, i) => (
                <View key={n} style={[styles.ticketReady, i === 0 && styles.ticketFirst]}>
                  <Text style={[styles.ticketNo, styles.ticketNoReady, isTablet && styles.ticketNoBig]}>{n}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.promo}>
            <Text style={styles.promoT}>Promo: QOQI10 — diskon Rp 5.000 untuk member GOLD</Text>
          </View>
          <TouchableOpacity style={styles.primary} onPress={callNext} disabled={prep.length === 0}>
            <Text style={styles.primaryT}>
              {prep.length === 0 ? 'Semua pesanan siap' : `Panggil ${prep[0]} ›`}
            </Text>
          </TouchableOpacity>
        </>
      ) : null}

      {mode === 'order' ? (
        <View style={styles.orderCard}>
          <Text style={styles.shop}>Pesanan Berjalan · Meja A-01</Text>
          <Text style={styles.heroSub}>Item terupdate otomatis dari kasir</Text>
          <View style={styles.divider} />
          {RUNNING_ITEMS.map((it) => (
            <View key={it.name} style={styles.itemRow}>
              <Text style={styles.itemName}>{it.qty}x {it.name}</Text>
              <Text style={styles.itemPrice}>{rp(it.qty * it.price)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.itemRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalVal}>{rp(RUNNING_TOTAL)}</Text>
          </View>
          <View style={styles.qrisBox}>
            <Text style={styles.qrisTitle}>Bayar via QRIS</Text>
            <Image source={require('../../../assets/images/payment_qris.webp')} style={styles.qrisImg} resizeMode="contain" />
            <Text style={styles.qrisSub}>Pindai untuk membayar {rp(RUNNING_TOTAL)}</Text>
          </View>
          <TouchableOpacity style={styles.primary} onPress={() => setMode('success')}>
            <Text style={styles.primaryT}>Simulasikan Bayar Berhasil ›</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {mode === 'success' ? (
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>Pembayaran Berhasil</Text>
          <Text style={styles.successTotal}>{rp(PAID_TOTAL)}</Text>
          <Text style={styles.successSub}>Tunai · Kembalian Rp 0 · TRX-20261016-014</Text>
          <Text style={styles.successSub}>Terima kasih — silakan ambil pesanan di kasir.</Text>
          <TouchableOpacity style={styles.primaryDark} onPress={() => setMode('queue')}>
            <Text style={styles.primaryDarkT}>Kembali ke Antrean</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={styles.hint}>Tampilan sekunder (presentation display) butuh dev-client — pratinjau di atas Tersinkron antar layar otomatis.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navyDark },
  body: { padding: 16, paddingBottom: 40 },
  modeRow: { flexDirection: 'row', gap: 6 },
  modeTab: { flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center', backgroundColor: colors.navy },
  modeTabActive: { backgroundColor: colors.white },
  modeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navyTint },
  modeTextActive: { color: colors.navy },
  hero: { alignItems: 'center', marginTop: 16 },
  shop: { fontFamily: fonts.bold, fontSize: 22, color: colors.white, textAlign: 'center' },
  heroSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4, textAlign: 'center' },
  cols: { flexDirection: 'row', gap: 12, marginTop: 16 },
  colsPhone: { flexDirection: 'column' },
  col: { flex: 1 },
  colTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.white, marginBottom: 8 },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.navyTint },
  ticketPrep: { backgroundColor: colors.navy, borderRadius: 12, padding: 16, marginBottom: 8, alignItems: 'center' },
  ticketReady: { backgroundColor: colors.white, borderRadius: 12, padding: 16, marginBottom: 8, alignItems: 'center' },
  ticketFirst: { borderWidth: 3, borderColor: colors.orange },
  ticketNo: { fontFamily: fonts.bold, fontSize: 28, color: colors.white },
  ticketNoReady: { color: colors.navy },
  ticketNoBig: { fontSize: 40 },
  promo: { backgroundColor: colors.orange, borderRadius: 12, padding: 14, marginTop: 8 },
  promoT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white, textAlign: 'center' },
  primary: { backgroundColor: colors.white, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  primaryDark: { backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  primaryDarkT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  orderCard: { backgroundColor: colors.white, borderRadius: 16, padding: 18, marginTop: 16 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  itemName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  itemPrice: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  totalLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  totalVal: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy },
  qrisBox: { backgroundColor: colors.bg, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  qrisTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  qrisImg: { width: 160, height: 160, marginVertical: 8 },
  qrisSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  successCard: { backgroundColor: colors.white, borderRadius: 16, padding: 28, marginTop: 24, alignItems: 'center' },
  successIcon: { fontSize: 56, color: colors.green, fontFamily: fonts.bold },
  successTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 8 },
  successTotal: { fontFamily: fonts.bold, fontSize: 28, color: colors.text, marginTop: 6 },
  successSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 12 },
});
