import { useEffect, useMemo, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import ScreenHeader from '../../components/ScreenHeader';import AppButton from '../../components/AppButton';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';import { fmtDate, fmtTime } from '../../lib/datefmt';import { useLang } from '../../lib/i18n';import { initDb, query } from '../../lib/db';
import { getApprovals, markApproved, subscribeApprovals } from '../../lib/pettyApproval';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type Arus = 'Masuk' | 'Keluar';type Txn = {
  id: string;
  tanggal: string;
  keterangan: string;
  coa: string;
  arus: Arus;
  jumlah: number;
  kasir: string;
  disetujui: boolean;
photo?: string;};type ExpenseRow = { id: string; coaName: string | null; amount: number | null; note: string | null; userId: string | null; expenseDate: string | null; photoPath: string | null; createdAt: string | null;};/** Tanggal seed lewat fmtDate/fmtTime agar ikut locale, bukan string hardcode. */
function seedDateTime(y: number, m: number, d: number, h: number, mi: number): string {
  const dt = new Date(y, m - 1, d, h, mi);
  return `${fmtDate(dt)} ${fmtTime(dt)}`;
}
const SEED: Txn[] = [
  { id: 'PC-001', tanggal: seedDateTime(2026, 10, 16, 8, 10), keterangan: 'Modal awal petty cash', coa: 'Kas Kecil', arus: 'Masuk', jumlah: 500000, kasir: 'Gista', disetujui: true },
  { id: 'PC-002', tanggal: seedDateTime(2026, 10, 16, 10, 20), keterangan: 'Belanja plastik dan tissue', coa: 'Operasional', arus: 'Keluar', jumlah: 45000, kasir: 'Gista', disetujui: true },
  { id: 'PC-003', tanggal: seedDateTime(2026, 10, 16, 12, 5), keterangan: 'Bensin antar online', coa: 'Operasional', arus: 'Keluar', jumlah: 20000, kasir: 'Bimo', disetujui: false },];function fmtTxn(iso: string | null): string { if (!iso) return fmtDate(new Date()); try { const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso; return `${fmtDate(d)} ${fmtTime(d)}`; } catch { return iso; }}export default function PettyCashScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [filter, setFilter] = useState<'Semua' | Arus>('Semua');

  // F7: muat ulang tiap layar jadi fokus agar approve dari Detail langsung
  // terlihat di daftar (focus-listener; aman: guard addListener + alive).
  const [items, setItems] = useState<Txn[]>(SEED); useEffect(() => { let alive = true; const load = async () => { const approved = await getApprovals(); try { await initDb(); const rows = await query<ExpenseRow>( "SELECT id, coaName, amount, note, userId, expenseDate, photoPath, createdAt FROM tr_branchexpense WHERE id LIKE 'PC-%' ORDER BY createdAt DESC", ); if (!alive) return; if (rows.length === 0) { setItems(SEED); return; } setItems( rows.map((r) => { const amt = Number(r.amount ?? 0); return { id: r.id, tanggal: fmtTxn(r.expenseDate ?? r.createdAt), keterangan: r.note ?? '-', coa: r.coaName ?? 'Operasional', arus: (amt >= 0 ? 'Masuk' : 'Keluar') as Arus, jumlah: Math.abs(amt), kasir: r.userId ?? '-', disetujui: approved[r.id] ?? false, photo: r.photoPath ?? undefined, }; }), ); } catch { if (alive) setItems(SEED); } }; void load(); const nav = navigation as unknown as { addListener?: (event: string, cb: () => void) => () => void } | undefined; const unsub = nav?.addListener?.('focus', () => { if (alive) void load(); }); return () => { alive = false; if (typeof unsub === 'function') unsub(); }; }, [navigation]); useEffect(() => subscribeApprovals((id) => { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, disetujui: true } : x))); }), []); const list = useMemo(
    () => items.filter((x) => filter === 'Semua' || x.arus === filter),
    [items, filter],
  );
  const saldo = useMemo(
    () => items.reduce((s, x) => s + (x.arus === 'Masuk' ? x.jumlah : -x.jumlah), 0),
    [items],
  );

  const approve = async (id: string) => { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, disetujui: true } : x))); await markApproved(id); }; const go = (route: string) => navigation?.navigate(route); return (
    <View style={s.root}>
      <ScreenHeader title={t('petty.title')} left={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
          <Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
        </TouchableOpacity>
      } right={
        <TouchableOpacity onPress={() => navigation?.navigate('PettyCashForm')}>
          <Text style={s.headerAction}>{t('common.add')}</Text>
        </TouchableOpacity>
      } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.hero}>
          <Text style={s.heroLabel}>{t('petty.balance')}</Text>
          <Text style={s.heroValue}>{rp(saldo)}</Text>
          <Text style={s.heroSub}>{items.length} {t('petty.recorded')}</Text>
        </View>

        <View style={s.filters}>
          {(['Semua', 'Masuk', 'Keluar'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[s.filterChip, filter === f && s.filterActive]}
              onPress={() => setFilter(f)}>
              <Text style={[s.filterTxt, filter === f && s.filterTxtActive]}> {f === 'Semua' ? t('common.all') : f === 'Masuk' ? t('petty.in') : t('petty.out')} </Text>
            </TouchableOpacity>
          ))}
        </View>

        {list.length === 0 ? (
          <View style={s.empty}>
            <Image source={require('../../../assets/images/no_trx_petty_cash.webp')} style={s.emptyImg} resizeMode="contain" />
            <Text style={s.emptyTitle}>{t('petty.emptyTitle')}</Text>
            <Text style={s.emptySub}>{t('petty.emptySub')}</Text>
          </View>
        ) : (
          list.map((x) => (
            <TouchableOpacity
              key={x.id}
              style={s.card}
              onPress={() => navigation?.navigate('PettyCashDetail', {
                id: x.id, tanggal: x.tanggal, keterangan: x.keterangan,
                coa: x.coa, arus: x.arus, jumlah: x.jumlah,
                kasir: x.kasir, disetujui: x.disetujui, photo: x.photo ?? null,
              })}>
              <View style={[s.badge, x.arus === 'Masuk' ? s.badgeIn : s.badgeOut]}>
                <Text style={[s.badgeTxt, x.arus === 'Masuk' ? s.badgeInTxt : s.badgeOutTxt]}>
                  {x.arus === 'Masuk' ? t('petty.in') : t('petty.out')}
                </Text>
              </View>
              <Text style={s.cardTitle}>{x.keterangan}</Text>
              <Text style={s.cardMeta}>{x.id} - {x.tanggal} - {x.coa}</Text>
              <View style={s.cardBottom}>
                <Text style={[s.jumlah, x.arus === 'Masuk' ? s.jumlahIn : s.jumlahOut]}>
                  {x.arus === 'Masuk' ? '+' : '-'}{rp(x.jumlah)}
                </Text>
                {x.disetujui ? ( <Text style={s.okTxt}>{t('petty.approved')}</Text> ) : ( <TouchableOpacity onPress={() => approve(x.id)} hitSlop={8}> <Text style={s.waitTxt}>{t('petty.pending')}</Text> </TouchableOpacity> )}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <View style={s.footer}>
        <AppButton
          title={t('petty.recordBtn')}
          style={{ marginTop: 0 }}
          onPress={() => navigation?.navigate('PettyCashForm')}
        />
      </View>
    </View>
  );}const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  burger: { width: 22, height: 22 },
  headerAction: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  body: { padding: 16, paddingBottom: 110 },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.navyTint },
  heroValue: { fontFamily: fonts.bold, fontSize: 28, color: colors.white, marginTop: 6 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  filters: { flexDirection: 'row', marginTop: 14, marginBottom: 4 },
  filterChip: {
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    borderRadius: 20, paddingVertical: 7, paddingHorizontal: 16, marginRight: 8,
  },
  filterActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  filterTxtActive: { color: colors.white },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  badgeIn: { backgroundColor: colors.paleGreen },
  badgeOut: { backgroundColor: colors.paleRed },
  badgeTxt: { fontSize: 11, fontFamily: fonts.bold },
  badgeInTxt: { color: colors.greenDark },
  badgeOutTxt: { color: colors.red },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, marginTop: 8 },
  cardMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.faint, marginTop: 2 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  jumlah: { fontSize: 15, fontFamily: fonts.bold },
  jumlahIn: { color: colors.greenDark },
  jumlahOut: { color: colors.red },
  okTxt: { fontSize: 12, fontFamily: fonts.semibold, color: colors.greenDark },
  waitTxt: { fontSize: 12, fontFamily: fonts.semibold, color: colors.amberDark },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyImg: { width: 180, height: 120, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  emptySub: { fontSize: 13, fontFamily: fonts.regular, color: colors.faint, marginTop: 6 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line, padding: 16 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  primaryT: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },});