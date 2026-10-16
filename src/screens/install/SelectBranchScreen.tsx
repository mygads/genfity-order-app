import { useEffect, useState } from 'react';import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';import { checkBranch } from '../../lib/apiSource';import { useLang } from '../../lib/i18n';import AppButton from '../../components/AppButton';type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack?: () => void;};const GREY = '#757575';const TITLE_DARK = '#2B2B2B';const BRANCHES = [
  { id: 'B001', name: 'ESB Cabang Poris', addr: 'Jl. Poris Raya No. 8, Tangerang', device: 'Terminal 01 · Kasir' },
  { id: 'B002', name: 'ESB Cabang Ciputat', addr: 'Jl. Dewi Sartika No. 12, Tangsel', device: 'Terminal 02 · Kasir' },
  { id: 'B003', name: 'ESB Cabang Bintaro', addr: 'Jl. Bintaro Utama No. 5, Tangsel', device: 'Terminal 03 · Kasir' },];export default function SelectBranchScreen({ navigation }: { navigation?: Nav }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [branchId, setBranchId] = useState(BRANCHES[0].id); const [query, setQuery] = useState('');
  /** Asli: daftar cabang dimuat async (capture asli = spinner biru + CTA pucat). */
  const [loading, setLoading] = useState(true);

  const [checking, setChecking] = useState(false); const [error, setError] = useState(''); useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 900);
    return () => clearTimeout(timer);
  }, []);

  const goBack = () => {
    if (navigation?.goBack) navigation.goBack();
  };

  const branch = BRANCHES.find((b) => b.id === branchId)?.name ?? BRANCHES[0].name;
  // Status cabang dicek ke server lewat apiSource (Dummy Mode offline /
  // backend asli bila env terisi); selain active tampilkan pesan blokir.
  const goSelect = async () => { if (loading || checking) return; setChecking(true); setError(''); try { const r = await checkBranch(branchId); if (r.status !== 'active') { setError(t('inst_branch_blocked')); return; } navigation?.navigate('InstallProgress', { branch }); } catch { setError(t('inst_branch_blocked')); } finally { setChecking(false); } }; const list = BRANCHES.filter((b) =>
    (b.name + ' ' + b.addr).toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <View style={styles.root}>
      <View style={styles.arc} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={goBack} hitSlop={12} style={styles.backRow}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('sel_title')}</Text>
          <Image
            source={require('../../../assets/images/install_location_pin.webp')}
            style={styles.pinImg}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.desc}>{t('sel_desc')}</Text>
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
            onPress={() => { setBranchId(b.id); setError(''); }}>
            <View style={[styles.avatar, branchId === b.id && styles.avatarOn]}>
              <Text style={[styles.avatarT, branchId === b.id && styles.avatarTOn]}>C</Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{b.name}</Text>
              <Text style={styles.meta}>{b.addr}</Text>
              <Text style={styles.meta}>{b.device}</Text>
            </View>
            <View style={[styles.radio, branchId === b.id && styles.radioOn]}>
              {branchId === b.id && <View style={styles.radioDot} />}
            </View>
          </TouchableOpacity>
        ))}
        {list.length === 0 ? (
          <Text style={styles.empty}>{t('sel_empty')}</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null} </>
        )}
      </ScrollView>
      <View style={[styles.footer, isTablet && wideCenterSm]}>
        <AppButton
          title={checking ? t('inst_branch_checking') : t('sel_choose')}
          onPress={goSelect}
          disabled={loading || list.length === 0 || checking}
          style={styles.primary}
        />
      </View>
    </View>
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
  pinImg: { width: 26, height: 26, marginLeft: 8 },
  loader: { marginTop: 28, alignSelf: 'flex-start' },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: GREY, marginTop: 6, lineHeight: 19, paddingRight: 80 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48,
    borderRadius: 10, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14, backgroundColor: '#FFFFFF', marginTop: 14, marginBottom: 12,
  },
  searchGlyph: { fontSize: 20, color: colors.faint },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, height: '100%' },
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
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, textAlign: 'center', marginTop: 12 }, footer: { paddingHorizontal: 24, paddingBottom: 28, paddingTop: 8, backgroundColor: '#FFFFFF' },
  primary: {
    backgroundColor: colors.orange, borderRadius: 22, height: 56,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryIdle: { backgroundColor: '#F6C28B' },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },});