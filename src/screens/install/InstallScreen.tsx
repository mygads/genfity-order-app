import { useEffect, useState, type ReactNode } from 'react';import { Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import { getTerminal, setTerminal, WEB_URLS } from '../../config/server';import { validateTerminal, fetchPosVersion, notifyTerminalVerification } from '../../lib/apiSource';import { useLang } from '../../lib/i18n';import { parseDeviceRole, setDeviceRoleForTag } from '../../lib/deviceRole';import { adoptTerminalBinding, getBinding, hydrateTerminalState } from '../../session';import { TERMINAL_CODE_RE, normalizeTerminalCode } from '../../lib/sales';import {
  bindTerminal,
  fetchBranches,
  fetchTerminals,
  getContractDeviceId,
  isContractConfigured,
  loadBinding,
  type BranchInfo,
  type ContractTerminal,
  type TerminalBinding,
} from '../../lib/terminalContract';
import ScreenRoot from '../../components/ScreenRoot';
import { removeItem } from '../../lib/storage';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav; route?: { params?: { code?: string } } };const GREY = '#757575';const STEP_KEYS = ['inst_step1', 'inst_step2', 'inst_step3'];export default function InstallScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang(); const [code, setCode] = useState(route?.params?.code ?? '');
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const [checking, setChecking] = useState(false);
  // WIRE REA-12: versi POS server (best-effort - kosong = dummy/offline).
  const [posVer, setPosVer] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const v = await fetchPosVersion();
        if (!live || v.fromDummy || !v.latestVersion) return;
        setPosVer(`v${v.latestVersion} / min v${v.minVersion}`);
      } catch { /* offline - tanpa info versi */ }
    })();
    return () => { live = false; };
  }, []);
  // Klaim via lapisan apiSource (Dummy Mode offline / backend asli bila env
  // terisi). Kode terminal yang lolos disimpan ke setTerminal untuk header
  // request berikutnya.
  // ------------------------------------------------------------------
  // Bind flow kontrak backend Go (audit row 3, model akses terminal):
  // branch -> terminal -> PIN terminal, SEKALI per device, persist lintas
  // logout. Picker sebagai modal in-flow (navigation beku: tanpa rute baru).
  // PIN terminal ≠ PIN staff ≠ PIN owner (row 5); PIN tak pernah disimpan,
  // hanya diverifikasi per-bind oleh server. Bila kontrak absen/offline,
  // jatuh ke klaim kode legacy di bawah (server lama) secara jujur.
  // Daftar cabang/terminal diambil dari lib yang SAMA dengan
  // SelectBranchScreen (reusable by bind — satu sumber, dua pemakai).
  // ------------------------------------------------------------------
  const [binding, setBinding] = useState<TerminalBinding | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [terminals, setTerminals] = useState<ContractTerminal[]>([]);
  const [selBranch, setSelBranch] = useState<BranchInfo | null>(null);
  const [selTerminal, setSelTerminal] = useState<ContractTerminal | null>(null);
  const [termPin, setTermPin] = useState('');
  const [showBranches, setShowBranches] = useState(false);
  const [showTerminals, setShowTerminals] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bindError, setBindError] = useState('');
  const [kickNotice, setKickNotice] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const b = await loadBinding();
        if (live) setBinding(b);
      } catch { /* tanpa ikatan - alur baru */ }
    })();
    return () => { live = false; };
  }, []);

  // B4: teks via t('inst_*') dengan fallback literal netral ID/EN yang
  // disalin persis dari teks lama — UI tak berubah sampai STR mendaftarkan
  // kunci ini (t() mengembalikan nama kunci bila belum terdaftar).
  const tx = (key: string, fb: string): string => {
    const v = t(key);
    return v === key ? fb : v;
  };
  const L = {
    bindTitle: tx('inst_bind_title', lang === 'id' ? 'Ikat Perangkat ke Terminal' : 'Bind This Device to a Terminal'),
    bindDesc: tx('inst_bind_desc', lang === 'id'
      ? 'Pilih cabang, pilih terminal, lalu masukkan PIN terminal (dari dashboard owner). Ikatan tersimpan di perangkat ini.'
      : 'Pick a branch, pick a terminal, then enter the terminal PIN (from the owner dashboard). The binding stays on this device.'),
    bindBtn: tx('inst_bind_btn', lang === 'id' ? 'Mulai Ikat Terminal' : 'Start Terminal Binding'),
    rebindBtn: tx('inst_rebind_btn', lang === 'id' ? 'Ikat ulang (pindah terminal/cabang)' : 'Re-bind (move terminal/branch)'),
    boundAs: tx('inst_bound_as', lang === 'id' ? 'Perangkat terikat' : 'Device bound to'),
    pickBranch: tx('inst_pick_branch', lang === 'id' ? 'Pilih cabang' : 'Select a branch'),
    pickTerminal: tx('inst_pick_terminal', lang === 'id' ? 'Pilih terminal' : 'Select a terminal'),
    pinTitle: tx('inst_term_pin_title', lang === 'id' ? 'PIN terminal' : 'Terminal PIN'),
    pinPh: tx('inst_term_pin_ph', lang === 'id' ? 'PIN dari dashboard owner' : 'PIN from the owner dashboard'),
    pinShort: tx('inst_term_pin_short', lang === 'id' ? 'Masukkan PIN terminal (min. 4 digit).' : 'Enter the terminal PIN (min. 4 digits).'),
    doBind: tx('inst_do_bind', lang === 'id' ? 'Ikat Terminal' : 'Bind Terminal'),
    loading: tx('inst_loading', lang === 'id' ? 'Memuat...' : 'Loading...'),
    noContract: tx('inst_no_contract', lang === 'id'
      ? 'Backend baru belum terjangkau (atau belum dikonfigurasi) — pakai klaim kode di bawah (server lama).'
      : 'New backend unreachable (or not configured) — use the code claim below (legacy server).'),
    branchFail: tx('inst_branch_fail', lang === 'id'
      ? 'Daftar cabang tak terjangkau — periksa koneksi atau pakai klaim kode di bawah.'
      : 'Branch list unreachable — check the connection or use the code claim below.'),
    termFail: tx('inst_term_fail', lang === 'id'
      ? 'Daftar terminal tak terjangkau — coba lagi.'
      : 'Terminal list unreachable — try again.'),
    termEmpty: tx('inst_term_empty', lang === 'id'
      ? 'Belum ada terminal di cabang ini — minta owner menambahkannya dulu.'
      : 'No terminals in this branch yet — ask the owner to add one first.'),
    bindFail: tx('inst_bind_fail', lang === 'id'
      ? 'Ikat gagal — PIN salah atau terminal ditolak server.'
      : 'Bind failed — wrong PIN or the server rejected the terminal.'),
    kicked: tx('inst_kicked', lang === 'id'
      ? 'Perangkat ini mengambil alih terminal — sesi perangkat sebelumnya telah digantikan (login baru menang).'
      : 'This device took over the terminal — the previous device session was replaced (new login wins).'),
    legacyTitle: tx('inst_legacy_title', lang === 'id' ? 'Cara lama (server legacy)' : 'Legacy way (legacy server)'),
    noPinSet: tx('inst_no_pin_set', lang === 'id' ? 'belum ada PIN' : 'no PIN yet'),
  };

  const startBind = async () => {
    if (busy) return;
    setBindError(''); setKickNotice('');
    if (!isContractConfigured()) { setBindError(L.noContract); return; }
    setBusy(true);
    try {
      const r = await fetchBranches();
      if (!r.ok || r.branches.length === 0) { setBindError(L.branchFail); return; }
      setBranches(r.branches);
      setShowBranches(true);
    } finally {
      setBusy(false);
    }
  };

  const chooseBranch = async (b: BranchInfo) => {
    if (busy) return;
    setBindError('');
    setSelBranch(b);
    setShowBranches(false);
    setBusy(true);
    try {
      const r = await fetchTerminals(b.id);
      if (!r.ok) { setBindError(L.termFail); return; }
      if (r.terminals.length === 0) { setBindError(L.termEmpty); return; }
      setTerminals(r.terminals);
      setShowTerminals(true);
    } finally {
      setBusy(false);
    }
  };

  const chooseTerminal = (terminal: ContractTerminal) => {
    setSelTerminal(terminal);
    setTermPin('');
    setBindError('');
    setShowTerminals(false);
    setShowPin(true);
  };

  const doBind = async () => {
    if (busy || !selBranch || !selTerminal) return;
    if (termPin.trim().length < 4) { setBindError(L.pinShort); return; }
    setBusy(true); setBindError('');
    // Tag terminal lama HANYA dipertahankan untuk bind ULANG ke terminal yang
    // SAMA (kompatibel terminal warisan tanpa tag); terminal baru/lain tanpa
    // tag kanonis = tolak fail-closed (tanpa default 'full_access' diam-diam).
    const prevContract = await loadBinding().catch(() => null);
    const sameTerminal = !!prevContract && prevContract.terminalId === selTerminal.terminalId;
    try {
      const deviceId = await getContractDeviceId();
      const r = await bindTerminal(selTerminal.terminalId, termPin.trim(), deviceId);
      if (!r.ok || !r.data?.bound) { setBindError(L.bindFail); return; }
      const tag = parseDeviceRole((selTerminal.tag || '').trim())
        ?? (sameTerminal ? parseDeviceRole((prevContract?.tag || '').trim()) : null);
      if (!tag) { setBindError(L.bindFail); return; }
      // Kontrak antar-paket: adoptTerminalBinding = logout + clearGrant +
      // tulis SEMUA store binding (sesi, kontrak, server) sekaligus
      // (REBIND-STALE-GRANT ikut dicabut di dalamnya). JANGAN setTerminal /
      // saveBinding terpisah agar tak ada store yang tertinggal.
      try {
        await adoptTerminalBinding({
          terminalId: selTerminal.terminalId,
          terminalCode: selTerminal.terminalCode,
          branchId: selBranch.id,
          branchName: selBranch.name,
          merchantName: selBranch.name,
          tag,
          deviceId,
        });
      } catch {
        setBindError(L.bindFail);
        return;
      }
      // Station printer milik terminal lama tak berlaku lintas re-bind
      // (kunci store 'genfity.printer.stations' milik lib/print.ts — bukan
      // bagian adopt sehingga dibersihkan di sini).
      try { await removeItem('genfity.printer.stations'); } catch { /* abaikan */ }
      const b: TerminalBinding = {
        branchId: selBranch.id,
        branchName: selBranch.name,
        terminalId: selTerminal.terminalId,
        terminalCode: selTerminal.terminalCode,
        terminalName: selTerminal.name,
        tag,
        deviceId,
        boundAt: new Date().toISOString(),
      };
      // Cermin peran dari tag tervalidasi yang SAMA (store peran bukan bagian
      // adopt) — home guard tetap fail-safe bila ini gagal.
      try {
        setDeviceRoleForTag(tag);
      } catch { /* peran bertahan — home guard tetap fail-safe */ }
      setBinding(b);
      try { await notifyTerminalVerification('verified'); } catch { /* best-effort */ }
      setShowPin(false);
      // Q13: beritahu perangkat BARU bila ada sesi lama yang digantikan.
      if (r.data.kickedUserId) setKickNotice(L.kicked);
      navigation?.navigate('InstallProgress', { branch: selBranch.name });
    } finally {
      setBusy(false);
    }
  };

  const sheet = (
    visible: boolean,
    title: string,
    onClose: () => void,
    body: ReactNode,
  ) => (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {body}
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.sheetCancel}>
            <Text style={styles.sheetCancelT}>{t('c_cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const claim = async () => {
    if (checking) return;
    // Kanon Q7: normalisasi + REGEX dulu (server BE juga menegakkan unik/
    // format ini) — kode warisan bertanda hubung tak bisa bound.
    const canon = normalizeTerminalCode(code);
    if (canon.length < 4) {
      setError(t('inst_code_short'));
      return;
    }
    if (!TERMINAL_CODE_RE.test(canon)) {
      setError(t('inst_code_format'));
      return;
    }
    setChecking(true); setError('');
    // Q10: ganti terminal wajib re-bind penuh (pilih ulang + PIN terminal) —
    // klaim kode legacy tak boleh menimpa ikatan yang sudah ada (tanpa PIN,
    // tanpa logout/clearGrant). Perangkat terikat → tolak fail-closed; pakai
    // tombol ikat-ulang di kartu atas (aliran E03 ber-PIN). Tanpa kunci i18n
    // baru: pesan memakai L.rebindBtn yang sudah ada.
    try { await hydrateTerminalState(); } catch { /* memori apa adanya */ }
    let alreadyBound = false;
    try {
      const b = getBinding();
      const t0 = getTerminal();
      alreadyBound =
        !!(b && (b.terminalId || '').trim()) ||
        !!((t0.terminalCode || '').trim() && (t0.branchId || '').trim());
    } catch { alreadyBound = false; }
    if (alreadyBound) { setChecking(false); setError(L.rebindBtn); return; }
    try { const r = await validateTerminal(canon); if (!r.valid || !r.branchId) { setError(t('inst_claim_invalid')); return; } setTerminal({ terminalCode: canon, branchId: r.branchId, branchName: r.branchName, }); try { await notifyTerminalVerification('verified'); } catch { /* notify best-effort - klaim tetap lanjut */ } navigation?.navigate('SelectBranch');
  } catch { setError(t('inst_claim_invalid')); } finally { setChecking(false); } };

  return (
    <ScreenRoot style={styles.root}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
      showsVerticalScrollIndicator={false}>
      <Image source={require('../../../assets/images/claim_terminal.webp')} style={[styles.banner, isTablet && styles.bannerBig]} resizeMode="contain" />
      <Text style={[styles.title, isTablet && styles.titleBig]}>{t('inst_title')}</Text>
      <Text style={[styles.desc, isTablet && styles.descBig]}>
        {t('inst_desc')}
      </Text>
      {posVer ? <Text style={[styles.desc, isTablet && styles.descBig]}>POS {posVer}</Text> : null}

      {/* Identitas merchant-terminal + ikat/ikat-ulang (audit row 18, paket app-login). */}
      {binding ? (
        <View style={styles.bindCard}>
          <Text style={styles.bindHead}>{L.boundAs}</Text>
          <Text style={styles.bindMain}>
            {binding.branchName || binding.branchId} · {binding.terminalCode}
            {binding.tag ? ` (${binding.tag})` : ''}
          </Text>
          {kickNotice ? <Text style={styles.kick}>{kickNotice}</Text> : null}
          <AppButton
            size="sm"
            variant="secondary"
            title={busy ? L.loading : L.rebindBtn}
            onPress={startBind}
            disabled={busy}
            style={styles.rebindBtn}
          />
        </View>
      ) : (
        <View style={styles.bindCard}>
          <Text style={styles.bindHead}>{L.bindTitle}</Text>
          <Text style={styles.bindDesc}>{L.bindDesc}</Text>
          <AppButton
            size="md"
            title={busy ? L.loading : L.bindBtn}
            onPress={startBind}
            disabled={busy}
            style={styles.primary}
          />
        </View>
      )}
      {bindError ? <Text style={styles.error}>{bindError}</Text> : null}

      <View style={styles.stepsCard}>
        {STEP_KEYS.map((k, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumT}>{i + 1}</Text>
            </View>
            <Text style={[styles.stepT, isTablet && styles.stepTBig]}>{t(k)}</Text>
          </View>
        ))}
      </View>

      {/* LEGACY server lama — bukan PIN terminal kontrak (lihat komentar claim). */}
      <Text style={styles.legacyHead}>{L.legacyTitle}</Text>
      <View style={styles.scanBox}>
        <Text style={styles.scanGlyph}>▣</Text>
        <Text style={[styles.scanText, isTablet && styles.scanTextBig]}>{t('inst_scan_frame')}</Text>
        <TouchableOpacity
          style={[styles.scanBtn, isTablet && styles.scanBtnBig]}
          onPress={() => { setCode('PORIS01'); setError(''); }}>
          <Text style={styles.scanBtnT}>{t('inst_sim_scan')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('inst_code_label')}</Text>
      <AppInput
        boxStyle={styles.input}
        style={styles.inputText}
        value={code}
        onChangeText={(t) => { setCode(t); setError(''); }}
        placeholder={t('inst_code_ph')}
        autoCapitalize="characters"
        error={error}
      />

      <AppButton
        size="md"
        title={checking ? t('inst_claim_checking') : `${t('inst_claim_btn')} ›`}
        onPress={claim}
        disabled={checking}
        style={styles.primary}
      />

      <AppButton
        size="md"
        variant="secondary"
        title={`${t('inst_web_btn')} ›`}
        onPress={() => navigation?.navigate('WebView', { url: WEB_URLS.register, title: t('inst_web_title') })}
        style={styles.webBtn}
        textStyle={styles.webBtnT}
      />

      <TouchableOpacity onPress={() => setShowHelp((v) => !v)}>
        <Text style={styles.link}>{`${t('inst_no_qr')} ›`}</Text>
      </TouchableOpacity>
      {showHelp && (
        <View style={styles.helpCard}>
          <Image source={require('../../../assets/images/get_qr_banner.webp')} style={styles.helpImg} resizeMode="contain" />
          <Text style={styles.helpT}>{t('inst_help1')}</Text>
          <Text style={styles.helpT}>{t('inst_help2')}</Text>
          <Text style={styles.helpT}>{t('inst_help3')}</Text>
        </View>
      )}
    </ScrollView>
    {sheet(showBranches, L.pickBranch, () => setShowBranches(false), (
      <ScrollView style={styles.sheetList}>
        {branches.map((b) => (
          <TouchableOpacity key={b.id} style={styles.sheetRow} onPress={() => void chooseBranch(b)}>
            <Text style={styles.sheetRowT}>{b.name || b.id}</Text>
            <Text style={styles.sheetRowSub}>{b.id}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    ))}
    {sheet(
      showTerminals,
      `${L.pickTerminal} — ${selBranch?.name ?? selBranch?.id ?? ''}`,
      () => setShowTerminals(false),
      (
        <ScrollView style={styles.sheetList}>
          {terminals.map((x) => (
            <TouchableOpacity key={x.terminalId || x.terminalCode} style={styles.sheetRow} onPress={() => chooseTerminal(x)}>
              <Text style={styles.sheetRowT}>
                {x.name || x.terminalCode}
                {x.tag ? ` · ${x.tag}` : ''}
              </Text>
              <Text style={styles.sheetRowSub}>
                {x.terminalCode}
                {x.pinSet ? '' : ` · ${L.noPinSet}`}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ),
    )}
    {sheet(showPin, `${L.pinTitle} — ${selTerminal?.terminalCode ?? ''}`, () => setShowPin(false), (
      <View>
        <TextInput
          style={styles.pinInput}
          value={termPin}
          onChangeText={(v) => { setTermPin(v.replace(/[^0-9]/g, '')); setBindError(''); }}
          placeholder={L.pinPh}
          placeholderTextColor={GREY}
          secureTextEntry
          keyboardType="number-pad"
        />
        <AppButton
          size="md"
          title={busy ? L.loading : L.doBind}
          onPress={doBind}
          disabled={busy || termPin.trim().length < 4}
          style={styles.primary}
        />
      </View>
    ))}
    </ScreenRoot>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 },
  banner: { width: '100%', height: 150 },
  /** Skala tablet: banner + teks membesar, tombol scan penuhi sentuh 48px (phone tetap). */
  bannerBig: { height: 210 },
  titleBig: { fontSize: 24 },
  descBig: { fontSize: 15, lineHeight: 21 },
  stepTBig: { fontSize: 15, lineHeight: 21 },
  scanTextBig: { fontSize: 15 },
  labelBig: { fontSize: 14 },
  scanBtnBig: { minHeight: 48, paddingVertical: 14 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 16 },
  desc: { fontFamily: fonts.regular, fontSize: 13, color: GREY, marginTop: 6, lineHeight: 19 },
  stepsCard: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line,
    borderRadius: 12, padding: 14, marginTop: 14, gap: 10,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumT: { fontFamily: fonts.bold, fontSize: 13, color: '#FFFFFF' },
  stepT: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: '#2B2B2B', lineHeight: 18 },
  scanBox: {
    borderWidth: 1.5, borderColor: colors.navy, borderStyle: 'dashed', borderRadius: 14,
    alignItems: 'center', padding: 20, marginTop: 14, backgroundColor: '#FFFFFF',
  },
  scanGlyph: { fontSize: 40, color: colors.navy },
  scanText: { fontFamily: fonts.medium, fontSize: 13, color: GREY, marginTop: 6 },
  scanBtn: { marginTop: 10, backgroundColor: '#EAF2FF', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  scanBtnT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: '#2B2B2B', marginTop: 18, marginBottom: 8 },
  input: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 10,
    paddingHorizontal: 16, height: 52, fontFamily: fonts.bold, fontSize: 14, color: '#2B2B2B', letterSpacing: 1,
  },
  /** Teks di dalam AppInput: tebal + spasi huruf ala kode terminal. */
  inputText: { fontFamily: fonts.bold, letterSpacing: 1 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: '#D33A3F', marginTop: 8 },
  primary: {
    backgroundColor: colors.orange, borderRadius: 14, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 18,
  },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  primaryIdle: { opacity: 0.6 }, link: { fontFamily: fonts.semibold, fontSize: 13, color: '#D96F00', textAlign: 'center', marginTop: 14 },
  helpCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, marginTop: 12 },
  helpImg: { width: '100%', height: 120, marginBottom: 8 },
  helpT: { fontFamily: fonts.regular, fontSize: 13, color: '#2B2B2B', marginTop: 4, lineHeight: 18 },
  webBtn: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: colors.navy, borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  webBtnT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  /** Kartu ikatan kontrak (paket app-login): identitas merchant-terminal + re-bind. */
  bindCard: {
    backgroundColor: '#F4F8FF', borderWidth: 1, borderColor: colors.navy,
    borderRadius: 12, padding: 14, marginTop: 14, gap: 8,
  },
  bindHead: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  bindMain: { fontFamily: fonts.medium, fontSize: 13, color: '#2B2B2B', lineHeight: 19 },
  bindDesc: { fontFamily: fonts.regular, fontSize: 13, color: GREY, lineHeight: 19 },
  rebindBtn: { marginTop: 4 },
  kick: { fontFamily: fonts.medium, fontSize: 12, color: '#B25E00', lineHeight: 18 },
  legacyHead: { fontFamily: fonts.semibold, fontSize: 12, color: GREY, marginTop: 18 },
  /** Sheet picker in-flow (navigation beku: tanpa rute baru). */
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  sheet: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, width: '100%', maxWidth: 480 },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginBottom: 10 },
  sheetList: { maxHeight: 320 },
  sheetRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  sheetRowT: { fontFamily: fonts.semibold, fontSize: 14, color: '#2B2B2B' },
  sheetRowSub: { fontFamily: fonts.regular, fontSize: 12, color: GREY, marginTop: 2 },
  sheetCancel: { alignSelf: 'center', marginTop: 12, paddingVertical: 8, paddingHorizontal: 16 },
  sheetCancelT: { fontFamily: fonts.semibold, fontSize: 14, color: colors.navy },
  pinInput: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 10,
    paddingHorizontal: 16, height: 52, fontFamily: fonts.bold, fontSize: 16, color: '#2B2B2B',
    letterSpacing: 4, textAlign: 'center', marginBottom: 4,
  },});