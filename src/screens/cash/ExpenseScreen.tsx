import { useEffect, useMemo, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import * as ImagePicker from 'expo-image-picker';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { TABLET_BP, colors, fonts, rp, rpNum, wideCenterLg } from '../../theme';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import { fmtDate } from '../../lib/datefmt';import { useLang } from '../../lib/i18n';import type { Lang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { getSession } from '../../session';import { getTerminal } from '../../config/server';import { initDb, query, queryFirst, run } from '../../lib/db';import { ApiPath } from '../../config/server';import { apiFetch, unwrap } from '../../lib/apiSource';import { enqueueOutbox, enqueueSync } from '../../lib/sync';
import { getApprovals, markApproved, subscribeApprovals } from '../../lib/pettyApproval';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type Expense = {
  id: string;
  nama: string;
  tanggal: string;
  coa: string;
  jumlah: number;
  disetujui: boolean;
  photo?: string;};type ExpenseRow = { id: string;
coaName: string | null; amount: number | null; note: string | null; userId: string | null; expenseDate: string | null; photoPath: string | null; createdAt: string | null;};const FALLBACK_COA = ['Operasional', 'Bahan Baku', 'Gaji', 'Utilitas', 'Sewa', 'Lainnya'];

/** DB kosong = empty-state (tanpa seed). */interface CoaPullItem { coaId?: unknown; coaName?: unknown; name?: unknown; flagActive?: unknown; }/** CoA expense: daftar dari pull chart-of-accounts bila tersedia di ms_setting, fallback konstanta. */async function loadCoa(): Promise<string[]> { try { await initDb();
  const row = await queryFirst<{ value1: string | null }>( "SELECT value1 FROM ms_setting WHERE key1 = 'expense' AND key2 = 'coa_list'", ); if (row?.value1) { const parsed = JSON.parse(row.value1) as unknown; if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') && parsed.length > 0) { return parsed as string[]; } } } catch { /* abaikan: coba pull */ } try { const res = await apiFetch(ApiPath.pullExpenseCoa, { method: 'GET' }); const { data } = unwrap<{ items?: CoaPullItem[] }>(res.data); const pulled = Array.isArray(data?.items) ? data.items : []; const names = pulled.filter((it) => Number(it.flagActive ?? 1) !== 0).map((it) => String(it.coaName ?? it.name ?? '').trim()).filter((s) => s.length > 0); if (names.length > 0) { const uniq = [...new Set(names)]; try { await setJSON('genfity.expense.coa', uniq); } catch { /* abaikan */ } return uniq; } } catch { /* abaikan: pakai cache */ } try { const cached = await getJSON<string[]>('genfity.expense.coa', FALLBACK_COA); return cached.length > 0 ? cached : FALLBACK_COA; } catch { return FALLBACK_COA; }}function shortDate(iso: string | null, lang: Lang = 'id'): string { if (!iso) return fmtDate(new Date(), lang); try { const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso; return fmtDate(d, lang); } catch { return iso; }}export default function ExpenseScreen({ navigation }: Props) { const { width } = useWindowDimensions(); const isTablet = width >= TABLET_BP; const { lang, t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [coaList, setCoaList] = useState<string[]>(FALLBACK_COA); const [items, setItems] = useState<Expense[]>([]); const [formOpen, setFormOpen] = useState(false);
  const [nama, setNama] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [coa, setCoa] = useState(FALLBACK_COA[0]);
  const [photo, setPhoto] = useState<string | null>(null);

  // F7: muat ulang tiap layar jadi fokus agar approve dari daftar lain langsung
  // terlihat (focus-listener; aman: guard addListener + alive).
  const [saving, setSaving] = useState(false); useEffect(() => { let alive = true; void loadCoa().then((list) => { if (!alive) return; setCoaList(list); setCoa((c) => (list.includes(c) ? c : list[0])); }); const load = async () => { const approved = await getApprovals(); try { await initDb(); const rows = await query<ExpenseRow>( "SELECT id, coaName, amount, note, userId, expenseDate, photoPath, createdAt FROM tr_branchexpense WHERE id LIKE 'EX-%' ORDER BY createdAt DESC", ); if (!alive) return; if (rows.length === 0) { setItems([]); return; } setItems( rows.map((r) => ({ id: r.id, nama: (r.note ?? '-').split(' | ')[0], tanggal: shortDate(r.expenseDate ?? r.createdAt, lang), coa: r.coaName ?? 'Operasional', jumlah: Math.abs(Number(r.amount ?? 0)), disetujui: approved[r.id] ?? false, photo: r.photoPath ?? undefined, })), ); } catch { /* abaikan: biarkan state apa adanya */ } }; void load(); const nav = navigation as unknown as { addListener?: (event: string, cb: () => void) => () => void } | undefined; const unsub = nav?.addListener?.('focus', () => { if (alive) void load(); }); return () => { alive = false; if (typeof unsub === 'function') unsub(); }; }, [navigation]); useEffect(() => subscribeApprovals((id) => { setItems((l) => l.map((e) => (e.id === id ? { ...e, disetujui: true } : e))); }), []); const totalBulan = useMemo(() => items.reduce((s, e) => s + e.jumlah, 0), [items]);
  const jumlahNum = Number(jumlah.replace(/\D/g, '')) || 0;
  const ready = nama.trim().length >= 3 && jumlahNum > 0 && !saving;

  const go = (route: string) => navigation?.navigate(route); const pickPhoto = async () => {

    try {
      const cam = await ImagePicker.launchCameraAsync({ quality: 0.5 });
      if (!cam.canceled && cam.assets?.[0]?.uri) {
        setPhoto(cam.assets[0].uri);
        return;
      }
    } catch {
      /* kamera tak tersedia, lanjut ke galeri */
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
    });
    if (!res.canceled && res.assets?.[0]?.uri) setPhoto(res.assets[0].uri);
  };

  /** Simpan expense ke tr_branchexpense + dokumen foto, antrekan outbox. ID unik berbasis waktu. */ const tambah = async () => {
    if (!ready) return;
    setSaving(true); const id = `EX-${Date.now().toString().slice(-8)}`; const now = new Date().toISOString(); const branchId = getTerminal().branchId || 'BR-01'; const kasir = getSession()?.name ?? ''; const entry: Expense =
      {
        id,
        nama: nama.trim(),
        tanggal: shortDate(now, lang),
        coa,
        jumlah: jumlahNum,
        disetujui: false,
        photo: photo ?? undefined,
      }; setItems((l) => [entry, ...l]); try { await initDb(); await run( `INSERT INTO tr_branchexpense (id, branchId, coaId, coaName, amount, note, userId, expenseDate, photoPath, syncDate, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`, [id, branchId, coa, coa, -jumlahNum, nama.trim(), kasir || null, now, photo, now], ); if (photo) { await run( `INSERT INTO tr_branchexpensedocument (id, expenseId, docPath, docType, syncDate) VALUES (?, ?, ?, 'photo', NULL)`, [`doc-${Date.now()}`, id, photo], ); } await enqueueOutbox('tr_branchexpense', id, 'insert'); enqueueSync('other', { table: 'tr_branchexpense', rowId: id, op: 'insert' }); } catch { /* DB belum init: item tetap tampil dari state */ }
    setNama('');
    setJumlah('');
    setPhoto(null);
    setFormOpen(false);
  setSaving(false); };

  const setujui = async (id: string) =>
    { setItems((l) => l.map((e) => (e.id === id ? { ...e, disetujui: true } : e))); await markApproved(id); }; return (
    <View style={s.root}>
      <ScreenHeader title={t('expense.title')} left={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
          <Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
        </TouchableOpacity>
      } right={
        <TouchableOpacity onPress={() => setFormOpen((v) => !v)}>
          <Text style={s.headerAction}>{t('common.add')}</Text>
        </TouchableOpacity>
      } /><DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={go} />

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenterLg]}>
        <View style={s.hero}>
          <Text style={s.heroLabel}>{t('expense.totalMonth')}</Text>
          <Text style={[s.heroValue, isTablet && s.heroValueTablet]}>{rp(totalBulan)}</Text>
          <Text style={s.heroSub}>{items.length} {t('expense.recorded')}</Text>
        </View>

        {formOpen && (
          <View style={s.card}>
            <Text style={s.cardTitle}>{t('expense.addTitle')}</Text>
            <AppInput
              label={t('expense.name')}
              placeholder={t('expense.namePh')}
              value={nama}
              onChangeText={setNama}
            />
            <AppInput
              label={t('expense.nominal')}
              keyboardType="number-pad"
              placeholder="0"
              value={jumlahNum ? rpNum(jumlahNum) : ''}
              onChangeText={(v) => setJumlah(v.replace(/\D/g, '').slice(0, 12))}
              style={{ textAlign: 'right', fontFamily: fonts.bold, fontSize: 20 }}
            />
            <Text style={s.label}>{t('expense.coa')}</Text>
            <View style={s.chips}>
              {coaList.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.chip, coa === c && s.chipOn]}
                  onPress={() => setCoa(c)}>
                  <Text style={[s.chipTxt, coa === c && s.chipTxtOn]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.label}>{t('expense.photo')}</Text>
            <View style={s.photoRow}>
              {photo ? <Image source={{ uri: photo }} style={s.preview} /> : null}
              <AppButton
                size="sm"
                title={photo ? t('expense.changePhoto') : t('expense.takePhoto')}
                variant="secondary"
                fullWidth={false}
                style={{ marginTop: 0 }}
                onPress={pickPhoto}
              />
              {photo ? (
                <TouchableOpacity onPress={() => setPhoto(null)} hitSlop={10}>
                  <Text style={s.del}>{t('common.delete')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <AppButton
              size="md"
              title={t('expense.saveBtn')}
              disabled={!ready}
              onPress={() => void tambah()}
            />
          </View>
        )}

        {/* Tablet: daftar expense 2 kolom; phone tetap 1 kolom (wrapper tanpa style = netral). */}
        <View style={isTablet ? s.gridTablet : undefined}>
        {items.map((e) => (
          <View key={e.id} style={[s.card, isTablet && s.cardTablet]}>
            <View style={s.row}>
              {e.photo ? <Image source={{ uri: e.photo }} style={s.thumb} /> : null}
              <View style={{ flex: 1 }}>
                <Text style={[s.itemName, isTablet && s.itemNameTablet]}>{e.nama}</Text>
                <Text style={s.itemMeta}>
                  {e.id} - {e.tanggal} - {e.coa} -{' '}
                  {e.disetujui ? (
                    <Text style={s.okTxt}>{t('petty.approved')}</Text>
                  ) : (
                    <Text style={s.waitTxt}>{t('petty.pending')}</Text>
                  )}
                </Text>
              </View>
              <Text style={s.jumlah}>-{rp(e.jumlah)}</Text>
            </View>
            {!e.disetujui && (
              <TouchableOpacity style={s.approveBtn} onPress={() => setujui(e.id)}>
                <Text style={s.approveTxt}>{t('petty.approveTxn')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        </View>
      </ScrollView>
    </View>
  );}const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  burger: { width: 22, height: 22 },
  headerAction: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  body: { padding: 16, paddingBottom: 40 },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.navyTint },
  heroValue: { fontFamily: fonts.bold, fontSize: 28, color: colors.white, marginTop: 6 },
  // Tablet: nominal hero sedikit lebih besar.
  heroValueTablet: { fontSize: 32 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  // Tablet: kartu expense setengah lebar baris grid (2 kolom).
  cardTablet: { width: '48.5%' },
  // Tablet: daftar expense 2 kolom bersisian.
  gridTablet: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  label: { fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 14, fontFamily: fonts.regular, color: colors.text,
  backgroundColor: colors.white, },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.line,
    borderRadius: 10, paddingHorizontal: 12, backgroundColor: colors.white,
  },
  rpPrefix: { fontSize: 16, fontFamily: fonts.bold, color: colors.muted },
  amountInput: { flex: 1, fontSize: 20, fontFamily: fonts.bold, color: colors.text, paddingVertical: 10, marginLeft: 8, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 20,
    paddingVertical: 7, paddingHorizontal: 12, marginRight: 8, marginBottom: 8, backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  chipTxtOn: { color: colors.orangeDark },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  preview: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.line },
  photoBtn: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  photoBtnT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  del: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  primary: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  disabled: { opacity: 0.5 },
  primaryT: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.line },
  itemName: { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
  // Tablet: nama expense sedikit lebih besar.
  itemNameTablet: { fontSize: 15 },
  itemMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.faint, marginTop: 2 },
  jumlah: { fontSize: 14, fontFamily: fonts.bold, color: colors.red },
  okTxt: { fontFamily: fonts.semibold, color: colors.greenDark },
  waitTxt: { fontFamily: fonts.semibold, color: colors.amberDark },
  approveBtn: { marginTop: 8, alignSelf: 'flex-end' },
  approveTxt: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark },});