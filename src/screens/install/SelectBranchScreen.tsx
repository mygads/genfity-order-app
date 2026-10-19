import { useEffect, useState } from 'react';import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';import { ApiPath } from '../../config/server';import { exitBranchAll, getBinding } from '../../session';import { fetchMyBranches, releaseTerminal, type BranchItem } from '../../lib/terminalApi';import { apiFetch } from '../../lib/apiSource';import { setDeviceRoleForTag } from '../../lib/deviceRole';import { verifyLocalEscalation } from '../../lib/supervisor';import { removeItem } from '../../lib/storage';import { useLang } from '../../lib/i18n';import { appAlert } from '../../lib/appAlert';import AppButton from '../../components/AppButton';
import ScreenRoot from '../../components/ScreenRoot';type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack?: () => void;};const GREY = '#757575';const TITLE_DARK = '#2B2B2B';/** Dev fallback berlabel jelas (B2): HANYA tampil bila BE tak terjangkau,
 * selalu di bawah banner need_be + label mode_local. Bukan data nyata. */
const DEV_BRANCHES: BranchItem[] = [
  { id: 'B001', name: 'Genfity Cabang Poris' },
  { id: 'B002', name: 'Genfity Cabang Ciputat' },
  { id: 'B003', name: 'Genfity Cabang Bintaro' },];export default function SelectBranchScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang();
  const [branchId, setBranchId] = useState('');
  /** B2 (SPEC B1): daftar dari BE via fetchMyBranches (E07); tanpa timer palsu. */
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [fromDummy, setFromDummy] = useState(false);
  const [needBe, setNeedBe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [boundTick, setBoundTick] = useState(0);
  const binding = boundTick >= 0 ? getBinding() : null;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetchMyBranches();
        if (!live) return;
        if (r.ok) {
          setBranches(r.data.branches);
          setFromDummy(r.fromDummy);
          setNeedBe(false);
          if (r.data.branches.length > 0) setBranchId(r.data.branches[0].id);
        } else {
          setBranches([]);
          setFromDummy(false);
          setNeedBe(true);
        }
      } catch {
        if (live) {
          setBranches([]);
          setFromDummy(false);
          setNeedBe(true);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  const goBack = () => {
    if (navigation?.goBack) navigation.goBack();
  };

  /** Pilih cabang → TerminalPicker (B1); tak ada gate legacy checkBranch. */
  const goSelect = () => {
    if (loading || !branchId) return;
    // B6 fail-closed: daftar fallback dev + needBe = belum ada data cabang
    // nyata dari BE — tolak maju.
    if (needBe && branches.length === 0) {
      appAlert(t('need_be'));
      return;
    }
    const picked =
      branches.find((b) => b.id === branchId) ??
      DEV_BRANCHES.find((b) => b.id === branchId);
    navigation?.navigate('TerminalPicker', {
      branchId,
      branchName: picked?.name ?? branchId,
    });
  };

  /** GAP-11: keluar branch = role-change (peran → full_access) sehingga
   * WAJIB gerbang PIN supervisor/owner via modal di bawah (bukan langsung
   * Alert). State modal PIN. */
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  /** R1: keluar branch — PIN supervisor/owner dulu (GAP-11), lalu konfirmasi,
   * lalu cabut binding + sesi. Tanpa binding = tak ada yang dicabut, langsung
   * konfirmasi warisan. */
  const exitBranch = () => {
    const b = getBinding();
    if (!b) {
      confirmExitBranch(null, undefined);
      return;
    }
    setPin('');
    setPinError('');
    setPinOpen(true);
  };

  /** Verifikasi PIN modal keluar-branch: eskalasi lokal owner-only
   * ('settings.edit' — Staff di-deny di seed) dengan throttle persisten
   * bawaan verifyLocalEscalation (5x/60 dtk) + offline honesty (DB belum
   * siap/unbound = tolak dengan pesan jujur, bukan bypass). Sukses → lanjut
   * konfirmasi dengan attribution approvedBy. */
  const submitExitPin = () => {
    if (pinBusy) return;
    const clean = pin.replace(/[^0-9]/g, '');
    if (!clean || clean.length < 4) {
      setPinError(t('sup_invalid'));
      return;
    }
    setPinBusy(true);
    setPinError('');
    void (async () => {
      try {
        const res = await verifyLocalEscalation(clean, 'settings.edit');
        if (!res.ok) {
          setPinError(res.message);
          return;
        }
        const b = getBinding();
        const approvedBy = `owner:${(res.userId ?? '').trim() || 'unknown'}`;
        setPinOpen(false);
        setPin('');
        confirmExitBranch(b, approvedBy);
      } finally {
        setPinBusy(false);
      }
    })();
  };

  /** Konfirmasi + eksekusi cabut binding (isi Alert warisan R1; approvedBy =
   * attribution GAP-11, diteruskan best-effort ke body unbind server — field
   * aditif, server boleh mengabaikan; jejak lokal: sesi/grant ikut dihapus
   * exitBranchAll sehingga atribusi ini yang tersisa di sisi server). */
  const confirmExitBranch = (b: ReturnType<typeof getBinding>, approvedBy?: string) => {
    appAlert(t('exit_branch'), b ? `${b.branchName || b.branchId} · ${b.terminalCode}` : '', [
      { text: t('c_cancel'), style: 'cancel' },
      {
        text: t('exit_branch'),
        style: 'destructive',
        onPress: () => {
          // E04: coba unbind server best-effort (abaikan gagal — local clear
          // di bawah sudah sah). Tanpa terminalId = tak ada yang di-unbind.
          const termId = (b?.terminalId ?? '').trim();
          const devId = (b?.deviceId ?? '').trim();
          if (termId) {
            void (async () => {
              try {
                await apiFetch(
                  ApiPath.terminalUnbind.replace('{id}', encodeURIComponent(termId)),
                  // GAP-11 attribution: approvedBy aditif best-effort (server
                  // boleh mengabaikan field tak dikenal; tanpa ini unbind
                  // tanpa jejak siapa yang menyetujui role-change).
                  { body: { ...(devId ? { deviceId: devId } : {}), ...(approvedBy ? { approvedBy } : {}) } },
                );
              } catch { /* abaikan: local clear sudah sah */ }
            })();
          }
          // E30: occupant melepas binding MILIKNYA sendiri via releaseTerminal —
          // best-effort (offline-safe, never block UI, fire-and-forget): gagal
          // = abaikan, local clear di bawah tetap sah. WAJIB sebelum
          // exitBranchAll menghapus state lokal. Butuh terminalId + deviceId;
          // tanpa keduanya tak ada yang di-release.
          if (termId && devId) {
            void (async () => {
              try {
                await releaseTerminal(termId, devId);
              } catch { /* abaikan: local clear sudah sah */ }
            })();
          }
          // Kontrak antar-paket: exitBranchAll = logout + clear SEMUA store
          // binding (sesi, kontrak, server) + clear grant sekaligus.
          void (async () => {
            try {
              await exitBranchAll();
            } catch { /* abaikan: lanjut bereskan sisa lokal */ }
            // B12: peran + station printer milik terminal lama ikut dicabut
            // (store peran/printer bukan bagian exitBranchAll).
            try { setDeviceRoleForTag('full_access'); } catch { /* abaikan */ }
            void removeItem('genfity.printer.stations').catch(() => { /* abaikan */ });
            setBoundTick((x) => x + 1);
          })();
        },
      },
    ]);
  };

  const list = (branches.length > 0 ? branches : DEV_BRANCHES).filter((b) =>
    (b.name + ' ' + b.id).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const showingDev = branches.length === 0;

  return (
    <ScreenRoot style={styles.root}>
      <View style={styles.arc} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={goBack} hitSlop={12} style={styles.backRow}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <View style={styles.titleRow}>
          <Text style={[styles.title, isTablet && styles.titleBig]}>{t('branch_pick_title')}</Text>
          <Image
            source={require('../../../assets/images/install_location_pin.webp')}
            style={styles.pinImg}
            resizeMode="contain"
          />
        </View>
        <Text style={[styles.desc, isTablet && styles.descBig]}>{t('sel_desc')}</Text>
        {binding ? (
          <View style={styles.boundCard}>
            <Text style={styles.boundMain}>
              {binding.branchName || binding.branchId} · {binding.terminalCode}
              {binding.tag ? ` (${binding.tag})` : ''}
            </Text>
            <TouchableOpacity onPress={exitBranch} hitSlop={8}>
              <Text style={styles.exitLink}>{t('exit_branch')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {needBe ? (
          <Text style={styles.offline}>{t('need_be')}</Text>
        ) : null}
        {fromDummy || showingDev ? (
          <Text style={styles.offline}>
            {t('mode_local')}
            {lang === 'id'
              ? ' — daftar cabang bawaan (dev).'
              : ' — built-in branch list (dev).'}
          </Text>
        ) : null}
        {loading ? (
          <ActivityIndicator size="small" color="#1E88E5" style={styles.loader} />
        ) : (
        <>
        <View style={styles.searchBox}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('sel_search_ph')}
            placeholderTextColor={colors.faint}
          />
        </View>
        {list.map((b) => (
          <TouchableOpacity
            key={b.id}
            style={[styles.card, branchId === b.id && styles.cardOn]}
            onPress={() => { setBranchId(b.id); }}>
            <View style={[styles.avatar, branchId === b.id && styles.avatarOn]}>
              <Text style={[styles.avatarT, branchId === b.id && styles.avatarTOn]}>C</Text>
            </View>
            <View style={styles.info}>
              <Text style={[styles.name, isTablet && styles.nameBig]}>{b.name}</Text>
              <Text style={[styles.meta, isTablet && styles.metaBig]}>{b.id}</Text>
            </View>
            <View style={[styles.radio, branchId === b.id && styles.radioOn]}>
              {branchId === b.id && <View style={styles.radioDot} />}
            </View>
          </TouchableOpacity>
        ))}
        {list.length === 0 ? (
          <Text style={styles.empty}>{needBe ? t('need_be') : t('sel_empty')}</Text>
        ) : null}</>
        )}
      </ScrollView>
      <View style={[styles.footer, isTablet && wideCenterSm]}>
        <AppButton
          size="lg"
          title={binding ? t('rebind_button') : t('sel_choose')}
          onPress={goSelect}
          disabled={loading || !branchId || (needBe && branches.length === 0)}
          style={styles.primary}
        />
      </View>
      {/* GAP-11: modal PIN supervisor/owner untuk keluar-branch (role-change).
       * Pola verifyAttendancePin-loop ada di verifyLocalEscalation
       * (submitExitPin); PIN tak pernah disimpan. */}
      <Modal visible={pinOpen} transparent animationType="fade" onRequestClose={() => setPinOpen(false)}>
        <View style={styles.pinOverlay}>
          <View style={styles.pinCard}>
            <Text style={styles.pinTitle}>{t('exit_pin_title')}</Text>
            <Text style={styles.pinSub}>{t('exit_pin_hint')}</Text>
            <TextInput
              style={styles.pinInput}
              value={pin}
              onChangeText={(v) => { setPin(v.replace(/[^0-9]/g, '').slice(0, 6)); setPinError(''); }}
              placeholder={t('cx_pin_ph')}
              placeholderTextColor={colors.faint}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={6}
              editable={!pinBusy}
            />
            {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
            <AppButton
              size="md"
              title={t('exit_branch')}
              onPress={submitExitPin}
              disabled={pinBusy || pin.replace(/[^0-9]/g, '').length < 4}
              style={styles.primary}
            />
            <TouchableOpacity onPress={() => setPinOpen(false)} hitSlop={12} style={styles.pinCancel}>
              <Text style={styles.pinCancelT}>{t('c_cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenRoot>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  arc: {
    position: 'absolute', top: -130, right: -130, width: 250, height: 250,
    borderRadius: 125, backgroundColor: '#1E88E5',
  },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, flexGrow: 1 },
  backRow: { alignSelf: 'flex-start', paddingRight: 16, paddingBottom: 8 },
  back: { fontSize: 28, color: '#4A4A4A', fontFamily: fonts.bold },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 20, color: TITLE_DARK },
  /** Skala tablet: buang paddingRight 80 + teks membesar (phone tetap). */
  titleBig: { fontSize: 24 },
  descBig: { paddingRight: 0 },
  nameBig: { fontSize: 17 },
  metaBig: { fontSize: 14, lineHeight: 20 },
  pinImg: { width: 26, height: 26, marginLeft: 8 },
  loader: { marginTop: 28, alignSelf: 'flex-start' },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: GREY, marginTop: 6, lineHeight: 19, paddingRight: 80 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48,
    borderRadius: 10, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14, backgroundColor: '#FFFFFF', marginTop: 14, marginBottom: 12,
  },
  searchGlyph: { fontSize: 20, color: colors.faint },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, height: '100%', outlineStyle: 'none' as never },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 14, marginBottom: 10,
  },
  cardOn: { borderColor: colors.orange, backgroundColor: '#FFF4E8' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EAF2FF', alignItems: 'center', justifyContent: 'center' },
  avatarOn: { backgroundColor: colors.navy },
  avatarT: { fontFamily: fonts.bold, fontSize: 18, color: colors.navy },
  avatarTOn: { color: '#FFFFFF' },
  info: { flex: 1 },
  name: { fontFamily: fonts.bold, fontSize: 15, color: TITLE_DARK },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: GREY, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.orange },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: GREY, textAlign: 'center', marginTop: 24 },
  /** Penanda status jujur B2: need_be (butuh BE) / mode_local (fallback dev). */
  offline: { fontFamily: fonts.regular, fontSize: 12, color: GREY, marginTop: 6 }, footer: { paddingHorizontal: 24, paddingBottom: 28, paddingTop: 8, backgroundColor: '#FFFFFF' },
  boundCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F4F8FF', borderWidth: 1, borderColor: colors.navy,
    borderRadius: 12, padding: 12, marginTop: 12,
  },
  boundMain: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: '#2B2B2B' },
  exitLink: { fontFamily: fonts.semibold, fontSize: 13, color: '#D33A3F', marginLeft: 12 },
  primary: {
    backgroundColor: colors.orange, borderRadius: 22, height: 56,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryIdle: { backgroundColor: '#F6C28B' },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  /** GAP-11: modal PIN supervisor/owner (overlay + kartu ala LoginScreen). */
  pinOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  pinCard: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 20 },
  pinTitle: { fontFamily: fonts.bold, fontSize: 17, color: TITLE_DARK, textAlign: 'center' },
  pinSub: { fontFamily: fonts.regular, fontSize: 13, color: GREY, marginTop: 8, textAlign: 'center', lineHeight: 19 },
  pinInput: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 16, height: 56, fontFamily: fonts.bold, fontSize: 18, color: TITLE_DARK, letterSpacing: 6, textAlign: 'center', marginTop: 16 },
  pinError: { fontFamily: fonts.medium, fontSize: 13, color: '#D33A3F', textAlign: 'center', marginTop: 10 },
  pinCancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  pinCancelT: { fontFamily: fonts.medium, fontSize: 14, color: colors.navy, textDecorationLine: 'underline' },});
