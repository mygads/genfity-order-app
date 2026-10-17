import { createElement, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { TABLET_BP, colors, fonts, wideCenterSm } from '../../theme';
import {
  buildGrant as buildSessionGrant,
  consumeKickNotice,
  describeGrantProblem,
  getBinding as getSessionBinding,
  getMaxOfflineGrantDays,
  getSession,
  hydrateTerminalState,
  loginEmployee,
  saveGrant as saveSessionGrant,
  saveSession,
  setMaxOfflineGrantDays,
  subscribeSession,
  verifyGrantPin,
  type Binding as SessionBinding,
  type Session as DeviceSession,
} from '../../session';
import { ApiPath, apiPost } from '../../config/server';
import { startRealtime } from '../../lib/realtime';
import { flushPendingRevokes } from '../../lib/sync';
import { setWsForeground } from '../../native/printer';
import { getApiMode, loginByQrCode, parseQrLoginPayload, type EmployeeSession } from '../../lib/apiSource';
import {
  getContractDeviceId,
  loadBinding,
  type TerminalBinding as LegacyBinding,
} from '../../lib/terminalContract';
import { queryFirst } from '../../lib/db';
import { loadPinRecord, savePinHash, verifyPinHash } from '../../lib/pin';
import { useLang } from '../../lib/i18n';
import AppButton from '../../components/AppButton';
import ScreenRoot from '../../components/ScreenRoot';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack?: () => void;
};

type Props = { navigation?: Nav };

const BLUE = '#1E88E5';
const BLUE_PALE = '#E7F3FF';
const BLUE_ICON_BG = '#D2E7FF';
const ORANGE = '#F5820D';
const PEACH = '#F6C28B';
const GREY = '#757575';
const BORDER = '#E0E0E0';
const INPUT_BORDER = '#BDBDBD';
const ICON_GREY = '#9E9E9E';
const RED = '#D33A3F';
const TITLE_DARK = '#2B2B2B';

const ICONS = {
  userBlue: require('../../../assets/icons/login_username_blue.webp'),
  userGray: require('../../../assets/icons/login_username_gray.webp'),
  qrBlue: require('../../../assets/icons/login_scanqr_blue.webp'),
  qrGray: require('../../../assets/icons/login_scanqr_gray.webp'),
  username: require('../../../assets/icons/username.webp'),
  password: require('../../../assets/icons/password.webp'),
  show: require('../../../assets/icons/password_show.webp'),
  hide: require('../../../assets/icons/password_hide.webp'),
  fail: require('../../../assets/icons/fail_red.webp'),
  waQr: require('../../../assets/images/whatsapp_qr.webp'),
  logo: require('../../../assets/images/esb_logo.webp'),
};

/**
 * Ilustrasi tablet + QR ala layar login-qr asli (aproksimasi: tidak ada aset
 * ilustrasi ini di bundle, jadi digambar dari View + matriks QR deterministik).
 */
function QrTabletArt() {
  const N = 11;
  const cells: boolean[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const inFinder = (r < 4 && c < 4) || (r < 4 && c >= N - 4) || (r >= N - 4 && c < 4);
      if (inFinder) {
        const lr = r >= N - 4 ? r - (N - 4) : r;
        const lc = c >= N - 4 ? c - (N - 4) : c;
        cells.push(lr === 0 || lr === 3 || lc === 0 || lc === 3 || (lr >= 1 && lr <= 2 && lc >= 1 && lc <= 2));
      } else {
        cells.push((r * 31 + c * 17 + 5) % 7 < 3);
      }
    }
  }
  return (
    <View style={styles.tablet}>
      <View style={styles.tabletScreen}>
        <View style={styles.tabletQr}>
          <View style={styles.miniQr}>
            {cells.map((on, i) => (
              <View key={i} style={[styles.miniCell, on && styles.miniCellOn]} />
            ))}
          </View>
        </View>
      </View>
      <View style={styles.tabletDot} />
    </View>
  );
}

/**
 * Rute bind flow: SPEC-TERMINAL-SESSION §3 menamai ini 'BindFlow'; guest stack
 * (App.tsx) mendaftarkan alias 'BranchPicker' ke SelectBranchScreen sehingga
 * unbound mulai di picker cabang-terminal, bukan layar klaim lama.
 */
const BIND_FLOW_ROUTE = 'BranchPicker';

/** Ambil string aman dari payload kontrak. */
function str(v: unknown, fb = ''): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return fb;
  return String(v);
}

/** Kupas envelope {data} bila BE membungkus respons. */
function unwrapData<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

/** Batasi gantung fetch login agar offline terdeteksi cepat (jujur, bukan diam). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      setTimeout(() => rej(new Error('login-timeout')), ms);
    }),
  ]);
}

/** Kunci i18n kontrak (SPEC B1) dengan fallback ke kunci lama yang sudah ada:
 * t() mengembalikan nama kunci bila belum terdaftar di STR (lane i18n/BE
 * yang menambahkan E01 wajib mendaftarkan kunci kontrak ini). */
function pickKey(t: (k: string) => string, key: string, fallbackKey: string): string {
  const v = t(key);
  return v === key ? t(fallbackKey) : v;
}

/** Konteks terminal efektif untuk alur B1 (otoritas: binding sesi Wave1). */
interface TermCtx {
  terminalId: string;
  terminalCode: string;
  branchId: string;
  branchName: string;
  merchantName: string;
  tag: string;
  deviceId: string;
}

/** Petakan binding lawas (store terminalContract) ke bentuk sesi. */
function mapLegacyBinding(leg: LegacyBinding): SessionBinding {
  return {
    terminalId: (leg.terminalId || leg.terminalCode).trim(),
    terminalCode: leg.terminalCode.trim(),
    branchId: (leg.branchId || '').trim(),
    branchName: leg.branchName ?? '',
    merchantName: leg.branchName ?? '',
    tag: (leg.tag || '').trim().toLowerCase(),
    ...(leg.deviceId ? { deviceId: leg.deviceId } : {}),
    boundAt: leg.boundAt,
  };
}

/** Selesaikan konteks terminal: binding sesi dulu, fallback store lawas agar
 * device yang ter-bind sebelum Wave1 tetap bisa login (tanpa bind ulang). */
async function resolveTermCtx(): Promise<TermCtx | null> {
  try {
    await hydrateTerminalState();
  } catch {
    /* memori dingin tetap dipakai apa adanya (fail-closed di bawah) */
  }
  const sb = getSessionBinding();
  if (sb && sb.terminalCode.trim()) {
    return {
      terminalId: sb.terminalId.trim(),
      terminalCode: sb.terminalCode.trim(),
      branchId: (sb.branchId || '').trim(),
      branchName: sb.branchName ?? '',
      merchantName: (sb.merchantName || sb.branchName || '').trim(),
      tag: (sb.tag || '').trim().toLowerCase(),
      deviceId: (sb.deviceId || '').trim(),
    };
  }
  try {
    const leg = await loadBinding();
    if (leg && leg.terminalCode.trim()) {
      const m = mapLegacyBinding(leg);
      return {
        terminalId: m.terminalId,
        terminalCode: m.terminalCode,
        branchId: m.branchId,
        branchName: m.branchName,
        merchantName: m.merchantName,
        tag: m.tag,
        deviceId: (m.deviceId || '').trim(),
      };
    }
  } catch {
    /* tanpa binding */
  }
  return null;
}

/** E01 staff-login (SPEC §4/§11 E01): dua tahap via satu endpoint.
 * {username,password,terminalCode,deviceId} → {credentialOk, requiresPin};
 * +{staffPin} → sesi. Payload SELALU bawa terminalCode+deviceId (okupansi
 * tunggal per terminal).
 * Tak pernah melempar: {reached:false} = offline/unconfigured (mode 'local'
 * = tanpa server; BE E01 mayoritas BELUM ADA — pemanggil wajib lewat gate
 * grant, fail-closed). */
interface StaffLoginCall {
  reached: boolean;
  status: number;
  body: Record<string, unknown>;
}

async function callStaffLogin(body: Record<string, string>): Promise<StaffLoginCall> {
  try {
    if (getApiMode() === 'local') return { reached: false, status: 0, body: {} };
    const res = await withTimeout(apiPost(ApiPath.staffLogin, body), 12000);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const b = (unwrapData<unknown>(json) ?? {}) as Record<string, unknown>;
    return { reached: true, status: res.status, body: b && typeof b === 'object' ? b : {} };
  } catch {
    return { reached: false, status: 0, body: {} };
  }
}

/** Penolakan eksplisit server (kredensial salah) vs tak-terjangkau. */
function isExplicitReject(call: StaffLoginCall): boolean {
  if (!call.reached) return false;
  if (call.status === 401 || call.status === 403 || call.status === 422) return true;
  if (call.body.credentialOk === false) return true;
  return false;
}

function isStage1Ok(call: StaffLoginCall): boolean {
  if (!call.reached || call.status < 200 || call.status >= 300) return false;
  const b = call.body;
  return (
    b.credentialOk === true ||
    b.requiresPin === true ||
    str(b.userId ?? b.user_id) !== ''
  );
}

interface NormBranch {
  id: string;
  name: string;
}

function normBranches(v: unknown): NormBranch[] {
  if (!Array.isArray(v)) return [];
  return (v as Record<string, unknown>[])
    .map((b) => ({
      id: str(b.id ?? b.branchId),
      name: str(b.name ?? b.branchName),
    }))
    .filter((b) => b.id !== '');
}

/** Cari userId lokal untuk gate grant offline (tanpa mengarang identitas). */
async function lookupLocalUserId(username: string): Promise<string> {
  try {
    const row = await queryFirst<{ id: string }>(
      'SELECT id FROM ms_posuser WHERE username = ? COLLATE NOCASE LIMIT 1',
      [username.trim()],
    );
    return str(row?.id);
  } catch {
    return '';
  }
}

/** Seed hash PIN lokal (kompatibel layar absensi/shift yang baca loadPinRecord). */
async function ensureLocalPinHash(userId: string, pin: string): Promise<void> {
  try {
    const rec = await loadPinRecord(userId);
    if (!rec || !verifyPinHash(pin, rec)) {
      await savePinHash(userId, pin);
    }
  } catch {
    /* hash lokal opsional - server tetap sumber benar */
  }
}

/**
 * Kunci sesi online pasca-E01b (alur L1): saveSession + saveGrant 7-hari
 * sliding (Q6; server-wins bila BE mengirim policy max_offline_grant_days/E28).
 */
async function completeOnline(
  payload: Record<string, unknown>,
  pin: string,
  ctx: TermCtx,
  deviceId: string,
  username: string,
): Promise<void> {
  const userId = str(payload.userId ?? payload.user_id);
  if (!userId) throw new Error('e01-no-user');
  const role = str(payload.role) || 'Merchant Staff';
  const branches = normBranches(payload.branches);
  const branchId = branches[0]?.id || ctx.branchId;
  const tag = str(payload.tag ?? payload.terminalTag) || ctx.tag;
  const authToken = str(payload.authToken ?? payload.token ?? payload.authKey);
  const prev = getSession();
  const sameUser = !!prev && prev.username === username;
  const sess: DeviceSession = {
    name: str(payload.nama ?? payload.displayName ?? payload.name) || username,
    username,
    role,
    userId,
    branchId,
    terminalCode: ctx.terminalCode,
    terminalTag: tag,
    terminalId: ctx.terminalId,
    deviceId,
    ...(authToken ? { authToken } : {}),
    loginAt: new Date().toISOString(),
    outlet: sameUser && prev ? prev.outlet : (ctx.branchName || prev?.outlet || ''),
    shift: sameUser && prev ? prev.shift : '',
    clockIn: sameUser && prev ? prev.clockIn : '',
    cash: sameUser && prev ? prev.cash : 0,
  };
  if (ctx.merchantName) sess.merchantName = ctx.merchantName;
  saveSession(sess);
  try {
    const pol = payload.policy as Record<string, unknown> | undefined;
    const days = Number(pol?.max_offline_grant_days ?? payload.maxOfflineGrantDays);
    if (Number.isFinite(days)) setMaxOfflineGrantDays(days);
  } catch {
    /* default 7 hari */
  }
  try {
    saveSessionGrant(buildSessionGrant({ userId, terminalId: ctx.terminalId, deviceId, staffPin: pin }));
  } catch (e) {
    console.warn('[login] saveGrant gagal:', e);
  }
  await ensureLocalPinHash(userId, pin);
  try { startRealtime(); } catch { /* abaikan */ }
  try { void setWsForeground(true); } catch { /* abaikan */ }
}

/**
 * Kunci sesi offline dari grant cache (alur L1): triple match + PIN vs hash
 * sudah lolos di pemanggil (describeGrantProblem + verifyGrantPin); sesi
 * ditandai offline:true untuk rekonsiliasi saat reconnect. Grant HANYA
 * diperpanjang saat auth ONLINE sukses (completeOnline) — fungsi ini tak
 * pernah menyentuh grant. Tanpa grant valid fungsi ini tak pernah dipanggil.
 */
async function completeOffline(userId: string, username: string, pin: string): Promise<void> {
  const ctx = await resolveTermCtx();
  if (!ctx) throw new Error('unbound');
  const deviceId = ctx.deviceId || (await getContractDeviceId());
  const prev = getSession();
  const sameUser = !!prev && prev.userId === userId;
  const sess: DeviceSession = {
    name: sameUser && prev && prev.name ? prev.name : username,
    username: sameUser && prev && prev.username ? prev.username : username,
    role: sameUser && prev && prev.role ? prev.role : 'Merchant Staff',
    userId,
    branchId: ctx.branchId,
    terminalCode: ctx.terminalCode,
    terminalTag: ctx.tag,
    terminalId: ctx.terminalId,
    deviceId,
    offline: true,
    loginAt: new Date().toISOString(),
    outlet: ctx.branchName || prev?.outlet || '',
    shift: prev?.shift || '',
    clockIn: prev?.clockIn || '',
    cash: prev?.cash ?? 0,
  };
  if (ctx.merchantName) sess.merchantName = ctx.merchantName;
  saveSession(sess);
  await ensureLocalPinHash(userId, pin);
  try { startRealtime(); } catch { /* abaikan */ }
  try { void setWsForeground(true); } catch { /* abaikan */ }
}

export default function LoginScreen({ navigation }: Props) {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  // Tablet portrait (lebar < tinggi) pakai satu kolom tengah ala phone;
  // split dua kolom hanya saat landscape agar tiap panel tetap lega.
  const showSplit = isTablet && width > height;
  const { lang, t } = useLang();
  const [mode, setMode] = useState<'email' | 'qr'>('email');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState(false);
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  /** Ikatan device (SPEC §2): sapaan merchant-terminal; null = belum diikat. */
  const [binding, setBinding] = useState<SessionBinding | null>(null);
  const [bindingLoaded, setBindingLoaded] = useState(false);
  /** Kandidat pasca-kredensial + modal PIN staff (B1/L1, berurutan). */
  const [pinOpen, setPinOpen] = useState(false);
  const [staffPin, setStaffPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');
  /** online = E01a lolos, PIN menyusul via E01b; offline = grant valid, PIN vs
   * hash grant. Tak ada jalur legacy: unbound diblokir eksplisit di langkah 1
   * (semua build termasuk DEV — login pertama wajib device terikat + BE). */
  const [candidate, setCandidate] = useState<null | {
    kind: 'online';
    username: string;
    password: string;
  } | {
    kind: 'offline';
    username: string;
    userId: string;
  }>(null);
  /** Banner info pasca-E01a (mis. sesi lama ditendang di tempat lain). */
  const [notice, setNotice] = useState('');
  /** Layar blokir eksplisit (fail-closed): grant kedaluwarsa / belum diikat. */
  const [blocked, setBlocked] = useState<null | { kind: 'grant-expired' | 'unbound' }>(null);
  /** Takeover (SPEC §4/K1): E01b menang atas sesi lama — user BARU wajib
   * dikabari + konfirmasi sebelum sesi dibuat. */
  const [takeover, setTakeover] = useState<null | {
    kickedUserId: string;
    payload: Record<string, unknown>;
    pin: string;
  }>(null);

  /** Teks sapaan terminal_welcome {merchant, terminal} dari getBinding(). */
  const welcomeText = (): string => {
    if (!binding) return '';
    const merchant = (binding.merchantName || binding.branchName || '').trim();
    const term = (binding.terminalCode || '').trim();
    const tpl = t('terminal_welcome');
    if (tpl === 'terminal_welcome') {
      return lang === 'id'
        ? `Selamat datang di ${merchant} · Terminal ${term}`
        : `Welcome to ${merchant} · Terminal ${term}`;
    }
    return tpl.split('{merchant}').join(merchant).split('{terminal}').join(term);
  };

  /** need_be: login pertama/offline tanpa grant wajib online. Jendela grant
   * dari policy server (getMaxOfflineGrantDays, server-wins) — tanpa hitungan
   * hari hardcode (G11). */
  const needBeText = (): string => {
    const days = getMaxOfflineGrantDays();
    const win = lang === 'id' ? `(grant ${days} hari)` : `(${days}-day grant)`;
    const v = t('need_be');
    if (v !== 'need_be') return `${v} ${win}`;
    return win;
  };

  /** grant_expired: blokir eksplisit, tanpa silent local login. */
  const grantExpiredText = (): string => t('grant_expired');

  /** Teks unbound: kunci kanonis terminal_unbound_hint (id+en di kamus). */
  const unboundText = (): string => t('terminal_unbound_hint');

  const pinWrongText = (): string => pickKey(t, 'pin_wrong', 'shf_pin_wrong');
  const pinTitleText = (): string => pickKey(t, 'login_pin_title', 'shf_pin_title');

  const pinCandidateLabel = (): string => {
    if (!candidate) return '';
    return t('login_pin_for').split('{user}').join(candidate.username);
  };

  /** KICK-no-live-notify: sesi perangkat ini dicabut login lain (revoke via
   * App.tsx) — tampilkan notif kick sekali saat Login tampil. */
  useEffect(() => {
    try {
      const k = consumeKickNotice();
      if (k) setNotice(k);
    } catch {
      /* abaikan */
    }
  }, []);
  useEffect(() => {
    let live = true;
    const unsub = subscribeSession(() => {
      if (live) setBinding(getSessionBinding());
    });
    (async () => {
      try {
        await hydrateTerminalState();
      } catch {
        /* memori dingin tetap dipakai apa adanya */
      }
      if (!live) return;
      const sb = getSessionBinding();
      if (sb) {
        setBinding(sb);
      } else {
        try {
          const leg = await loadBinding();
          if (live) setBinding(leg ? mapLegacyBinding(leg) : null);
        } catch {
          if (live) setBinding(null);
        }
      }
      if (live) setBindingLoaded(true);
    })();
    return () => { live = false; unsub(); };
  }, []);
  /** Pemindai QR login: kamera dibuka langsung di layar ini (tanpa pindah screen). */
  const [scanOpen, setScanOpen] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const qrBusy = useRef(false);
  /** Web: kamera nyata (getUserMedia) - video dibuka, bukan tempelan kode. */
  const [webManual, setWebManual] = useState(false);
  const [webCamError, setWebCamError] = useState<'denied' | 'nocam' | ''>('');
  /** HP: hasil izin dari requestPermission (nilai hook bisa basi saat modal dibuka). */
  const [camAllowed, setCamAllowed] = useState(false);
  const videoEl = useRef<unknown>(null);
  const detRef = useRef<unknown>(null);

  const filled = username.trim().length > 0 && password.length > 0;

  const goBack = () => {
    if (navigation?.goBack) navigation.goBack();
    else navigation?.navigate('Intro');
  };

  /**
   * Kunci sesi setelah server menyatakan lolos (dipakai form PIN maupun QR):
   * cocokkan/seed hash lokal, kunci sesi + konteks terminal (row 18),
   * segarkan grant sliding (row 19, Q6), nyalakan realtime. Tanpa navigate
   * manual - GuardedStacks mount stack authed (Dashboard/Shift) sendiri.
   */
  const completeLogin = async (
    s: EmployeeSession,
    uname: string,
    pin: string,
    ctx?: { branchId?: string; terminalCode?: string; terminalTag?: string; authKey?: string; role?: string },
  ) => {
    try {
      const rec = await loadPinRecord(s.userId);
      if (!rec || !verifyPinHash(pin, rec)) {
        await savePinHash(s.userId, pin);
      }
    } catch {
      /* hash lokal opsional - server tetap sumber benar */
    }
    // F17: konteks terminal diteruskan sebagai argumen ctx loginEmployee
    // (bukan diselipkan di argumen pertama yang diabaikan implementasi).
    loginEmployee(
      {
        nama: s.nama,
        username: uname,
        role: (ctx?.role ?? '').trim() || s.role,
        userId: s.userId,
      },
      {
        ...(ctx?.branchId ? { branchId: ctx.branchId } : {}),
        ...(ctx?.terminalCode ? { terminalCode: ctx.terminalCode } : {}),
        ...(ctx?.terminalTag ? { terminalTag: ctx.terminalTag } : {}),
      },
    );
    // M8: QR/DEV login menerbitkan grant rangkap-tiga via penerbit kanonis yang
    // sama dengan completeOnline (buildSessionGrant + saveSessionGrant).
    // Fail-closed: triple (userId, terminalId, deviceId) tak lengkap = TANPA
    // grant (tanpa fallback touchGrant — menyentuh grant tanpa triple
    // memperpanjang grant yang tak terikat sesi ini). Sesi tetap dikunci di
    // atas (server sudah menyatakan lolos); gate grant yang menolak offline.
    // B1 fail-closed: QR tanpa ikatan = tolak (cermin gate submit di bawah).
    const termCtx = await resolveTermCtx();
    if (!termCtx) throw new Error('unbound');
    try {
      const terminalId = (termCtx?.terminalId ?? '').trim();
      let deviceId = (termCtx?.deviceId ?? '').trim();
      if (!deviceId) deviceId = await getContractDeviceId();
      if (terminalId && deviceId && s.userId && pin) {
        saveSessionGrant(buildSessionGrant({ userId: s.userId, terminalId, deviceId, staffPin: pin }));
      }
    } catch (e) {
      console.warn('[login] issue grant gagal:', e);
    }
    // Realtime global nyala sekali saat login (sebelumnya hanya nyala bila
    // pengguna membuka layar Dapur/ESB/Display). Foreground service
    // best-effort di dev-client/APK agar WS hidup saat layar mati.
    try { startRealtime(); } catch { /* abaikan */ }
    try { void setWsForeground(true); } catch { /* abaikan */ }
    // S18: kirim utang revoke logout (fire-and-forget; login sukses = momen
    // online yang tepat, best-effort tanpa memblokir kasir). flushPendingRevokes
    // mencakup slot session + antrean umum, jadi satu pemanggil cukup.
    try { void flushPendingRevokes().catch(() => {}); } catch { /* abaikan */ }
  };

  /**
   * Login B1 (SPEC §4/L1): username + password DULU (E01a), lalu MODAL PIN
   * staff (E01b) — berurutan, bukan 3 faktor sekaligus.
   * - Terikat + online: POST E01 staff-login → modal PIN staff (server yang
   *   memverifikasi + cek RBAC + cek okupansi) → saveSession + saveGrant.
   * - Terikat + offline/unconfigured (E01 BELUM ADA di BE): gate grant jujur
   *   (isGrantValid + PIN vs hash); tanpa grant valid → tolak (login pertama
   *   wajib online, Q6). grant kedaluwarsa → layar blokir grant_expired.
   * - Tanpa ikatan: BLOKIR eksplisit 'unbound' + tautan bind di SEMUA build
   *   (tak ada jalur seed lokal/admin-1234 — dihapus, fail-closed Q6).
   *   Tanpa fallback diam-diam B001.
   */
  const submit = () => {
    if (busy) return;
    if (!username.trim() || !password) return;
    if (password.length < 4) {
      setError(true);
      return;
    }
    setError(false);
    setServerError('');
    setNotice('');
    setBlocked(null);
    setBusy(true);
    void (async () => {
      try {
        const uname = username.trim();
        // B1 prasyarat: device ter-bound (fail-closed).
        const ctx = await resolveTermCtx();
        if (!ctx) {
          // Unbound = BLOKIR eksplisit (model final, SEMUA build termasuk DEV):
          // login pertama wajib lewat device terikat + BE (E01a/E01b) atau
          // grant offline yang valid. Tak ada lagi jalur seed lokal tanpa
          // binding - fail-closed, bukan fallback diam-diam.
          setServerError(unboundText());
          setBlocked({ kind: 'unbound' });
          return;
        }
        const deviceId = ctx.deviceId || (await getContractDeviceId());
        // B1 langkah 1: E01a — username+password dulu, tanpa staffPin.
        // Payload SELALU bawa terminalCode+deviceId (kontrak E01).
        const first = await callStaffLogin({ username: uname, password, terminalCode: ctx.terminalCode, deviceId });
        if (isStage1Ok(first)) {
          if (first.body.wasKicked === true || first.body.kicked === true) {
            setNotice(t('kicked_msg'));
          }
          setCandidate({ kind: 'online', username: uname, password });
          setStaffPin('');
          setPinError('');
          setPinOpen(true);
          return;
        }
        if (isExplicitReject(first)) {
          // Server MENOLAK eksplisit (bukan offline): kredensial salah.
          setServerError(t('login_fail'));
          return;
        }
        // Offline/unconfigured: gate grant jujur — tanpa silent local login.
        const userId = await lookupLocalUserId(uname);
        const problem = userId ? describeGrantProblem(userId, ctx.terminalId, deviceId) : 'no-grant';
        if (problem === 'grant-expired') {
          setBlocked({ kind: 'grant-expired' });
          return;
        }
        if (problem) {
          // 'no-grant' | 'grant-mismatch' → butuh online dulu (need_be).
          setServerError(needBeText());
          return;
        }
        setCandidate({ kind: 'offline', username: uname, userId });
        setStaffPin('');
        setPinError('');
        setPinOpen(true);
        // JANGAN navigate manual ke Dashboard: GuardedStacks me-render ulang
        // bersyarat (tamu -> authed) dan stack authed mount dengan initial
        // Dashboard/Shift sendiri. Navigate sinkron di sini race melawan
        // setLoggedIn sehingga error "not handled by any navigator" di HP.
      } finally {
        setBusy(false);
      }
    })();
  };

  /** B1 langkah 2: verifikasi PIN staff, lalu kunci sesi + konteks terminal.
   * online → E01b (server memverifikasi + cek RBAC + cek okupansi; takeover
   * ditahan untuk modal konfirmasi); offline → PIN vs hash grant. */
  const submitStaffPin = () => {
    if (pinBusy || !candidate) return;
    if (staffPin.trim().length < 4) {
      setPinError(t('login_pin_short'));
      return;
    }
    setPinError('');
    setPinBusy(true);
    void (async () => {
      try {
        const pin = staffPin.trim();
        if (candidate.kind === 'offline') {
          // L1 offline: PIN vs hash grant (fail-closed; tanpa bypass).
          if (!verifyGrantPin(pin)) {
            setPinError(pinWrongText());
            return;
          }
          try {
            await completeOffline(candidate.userId, candidate.username, pin);
          } catch (e) {
            // completeOffline hanya melempar 'unbound' (tanpa ikatan); gate
            // grant sudah lolos di pemanggil — selain itu = grant basi.
            setPinError(e instanceof Error && e.message === 'unbound' ? needBeText() : grantExpiredText());
            return;
          }
          setPinOpen(false);
          return;
        }
        // B1 langkah 2 online: E01b.
        const ctx = await resolveTermCtx();
        if (!ctx) {
          setPinError(needBeText());
          return;
        }
        const deviceId = ctx.deviceId || (await getContractDeviceId());
        // B1 langkah 2 online: E01b — payload SELALU bawa terminalCode+deviceId.
        const second = await callStaffLogin({
          username: candidate.username,
          password: candidate.password,
          staffPin: pin,
          terminalCode: ctx.terminalCode,
          deviceId,
        });
        if (second.reached && second.status >= 200 && second.status < 300) {
          const p = second.body;
          const userId = str(p.userId ?? p.user_id);
          if (!userId) {
            // Respons sukses tanpa identitas = jangan buat sesi (fail-closed).
            setPinError(pinWrongText());
            return;
          }
          const tookOver = p.tookOver as Record<string, unknown> | undefined;
          const kickedUserId = str(tookOver?.kickedUserId ?? p.kickedUserId);
          if (kickedUserId) {
            // K1: login baru menang — kabari + minta konfirmasi user baru
            // SEBELUM sesi dibuat (takeover_title/takeover_msg).
            setTakeover({ kickedUserId, payload: p, pin });
            return;
          }
          await completeOnline(p, pin, ctx, deviceId, candidate.username);
          // F14-flush: login ONLINE sukses = momen kirim utang revoke.
          try { void flushPendingRevokes().catch(() => {}); } catch { /* abaikan */ }
          setPinOpen(false);
          return;
        }
        if (isExplicitReject(second)) {
          setPinError(pinWrongText());
          return;
        }
        // Sempat offline di tengah langkah 2: fallback grant jujur.
        const userId = await lookupLocalUserId(candidate.username);
        const problem = userId ? describeGrantProblem(userId, ctx.terminalId, deviceId) : 'no-grant';
        if (!problem && userId && verifyGrantPin(pin)) {
          try {
            await completeOffline(userId, candidate.username, pin);
          } catch (e) {
            // completeOffline hanya melempar 'unbound' (tanpa ikatan).
            setPinError(e instanceof Error && e.message === 'unbound' ? needBeText() : grantExpiredText());
            return;
          }
          setPinOpen(false);
          return;
        }
        setPinError(problem === 'grant-expired' ? grantExpiredText() : needBeText());
      } finally {
        setPinBusy(false);
      }
    })();
  };

  /** Buka kamera pemindai langsung (tanpa pindah screen lain). */
  const openQrScanner = () => {
    if (busy) return;
    setServerError('');
    setWebManual(false);
    setWebCamError('');
    void (async () => {
      if (Platform.OS !== 'web') {
        if (!permission?.granted) {
          try {
            const res = await requestPermission();
            setCamAllowed(res.granted);
            if (!res.granted) {
              setServerError(t('scan_denied'));
              return;
            }
          } catch {
            setCamAllowed(false);
            setServerError(t('scan_denied'));
            return;
          }
        } else {
          setCamAllowed(true);
        }
      }
      setQrCode('');
      setScanOpen(true);
    })();
  };

  /** Hasil pindaian kamera / tempelan manual: kredensial QR dikirim ke BE
   * (auth/cashier-login) - server yang memutuskan, bukan login lokal. */
  const handleQrData = (raw: string) => {
    if (qrBusy.current || busy) return;
    qrBusy.current = true;
    setScanOpen(false);
    setServerError('');
    setBusy(true);
    void (async () => {
      try {
        // Prasyarat sama dengan submit (B1): device ter-bound (fail-closed).
        // Tanpa ikatan = BLOKIR eksplisit 'unbound', bukan login QR lokal.
        const termCtx = await resolveTermCtx();
        if (!termCtx) {
          setServerError(unboundText());
          setBlocked({ kind: 'unbound' });
          return;
        }
        const payload = parseQrLoginPayload(raw);
        if (!payload) {
          setServerError(t('login_qr_invalid'));
          return;
        }
        const s = await loginByQrCode(payload);
        if (!s.ok || !s.userId) {
          setServerError(t('login_fail'));
          return;
        }
        try {
          await completeLogin(s, payload.username, payload.pin);
        } catch {
          // B1 fail-closed (cermin submit): unbound = blokir + tautan klaim.
          setServerError(unboundText());
          setBlocked({ kind: 'unbound' });
        }
      } finally {
        setBusy(false);
        qrBusy.current = false;
      }
    })();
  };

  /**
   * Kamera web nyata: getUserMedia pasang stream ke <video>, BarcodeDetector
   * (Chrome/Edge) memindai QR tiap 400ms. Kamera gagal/tak didukung ->
   * fallback tempel kode. Stream dimatikan saat modal ditutup (cleanup).
   */
  useEffect(() => {
    if (!scanOpen || Platform.OS !== 'web') return;
    type Track = { stop: () => void };
    let stream: { getTracks: () => Track[] } | null = null;
    let alive = true;
    const tick = async () => {
      if (!alive || qrBusy.current || busy) return;
      try {
        const v = videoEl.current as unknown as { readyState?: number } | null;
        const BD = (globalThis as unknown as {
          BarcodeDetector?: new (o: unknown) => { detect: (s: unknown) => Promise<{ rawValue?: unknown }[]> };
        }).BarcodeDetector;
        if (!v || !BD) return;
        if (!detRef.current) detRef.current = new BD({ formats: ['qr_code'] });
        const codes = await (detRef.current as {
          detect: (s: unknown) => Promise<{ rawValue?: unknown }[]>;
        }).detect(v);
        if (codes && codes.length > 0 && alive) handleQrData(String(codes[0]?.rawValue ?? ''));
      } catch {
        /* frame belum siap - coba interval berikut */
      }
    };
    const timer: ReturnType<typeof setInterval> = setInterval(() => { void tick(); }, 400);
    void (async () => {
      try {
        const g = globalThis as unknown as {
          navigator?: { mediaDevices?: { getUserMedia: (c: unknown) => Promise<unknown> } };
          BarcodeDetector?: unknown;
        };
        const md = g.navigator?.mediaDevices;
        if (!md?.getUserMedia || !g.BarcodeDetector) {
          if (alive) setWebCamError('nocam');
          return;
        }
        stream = (await md.getUserMedia({ video: { facingMode: 'environment' }, audio: false })) as {
          getTracks: () => Track[];
        };
        const v = videoEl.current as unknown as { srcObject?: unknown; play?: () => Promise<void> } | null;
        if (!v) return;
        v.srcObject = stream;
        try { await v.play?.(); } catch { /* autoplay ditolak - user ketuk video */ }
      } catch {
        if (alive) setWebCamError('denied');
      }
    })();
    return () => {
      alive = false;
      clearInterval(timer);
      try { stream?.getTracks().forEach((tr) => tr.stop()); } catch { /* abaikan */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanOpen]);

  const card = (which: 'email' | 'qr') => {
    const on = mode === which;
    return (
      <TouchableOpacity
        key={which}
        style={[styles.card, on ? styles.cardOn : styles.cardOff]}
        onPress={() => { setMode(which); setError(false); setServerError(''); }}>
        <View style={[styles.iconBox, on ? styles.iconBoxOn : styles.iconBoxOff]}>
          <Image
            source={which === 'email' ? (on ? ICONS.userBlue : ICONS.userGray) : on ? ICONS.qrBlue : ICONS.qrGray}
            style={styles.iconImg}
            resizeMode="contain"
          />
        </View>
        {which === 'email' ? (
          <Text style={[styles.cardLabel, on ? styles.cardLabelOn : styles.cardLabelOff]}>
            <Text style={styles.cardLabelBold}>{t('g_login_card_user')}</Text> {t('g_login_card_or')}{' '}
            <Text style={styles.cardLabelBold}>{t('g_login_card_email')}</Text>
          </Text>
        ) : (
          <Text style={[styles.cardLabel, styles.cardLabelBold, on ? styles.cardLabelOn : styles.cardLabelOff]}>
            {t('g_login_scan')}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  /**
   * Isi kolom form (satu sumber untuk phone 1-kolom dan panel kiri tablet).
   * Logika login tidak berubah - hanya pembungkus layout yang berbeda.
   */
  const formBody = (
    <>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={12}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setHelp(true)} hitSlop={12}>
            <View style={styles.helpCircle}>
              <Text style={styles.helpGlyph}>?</Text>
            </View>
          </TouchableOpacity>
        </View>

        <Image
          source={require('../../../assets/images/esb_logo.webp')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>{t('g_login_welcome')}</Text>
        <Text style={styles.sub}>{t('g_login_sub')}</Text>
        {/* Sapaan merchant-terminal (SPEC §2/B1 terminal_welcome): dari
         * getBinding(), BUKAN fallback B001. Belum diikat → tautan bind. */}
        {bindingLoaded && binding ? (
          <Text style={styles.welcomeTerm}>
            {welcomeText()}
          </Text>
        ) : bindingLoaded ? (
          <TouchableOpacity style={styles.unboundLink} onPress={() => navigation?.navigate(BIND_FLOW_ROUTE)}>
            <Text style={styles.unboundLinkT}>
              {t('login_bind_first')}
            </Text>
          </TouchableOpacity>
        ) : null}

        {notice ? (
          <View style={styles.errorRow}>
            <Text style={styles.errorText}>{notice}</Text>
          </View>
        ) : null}
        {blocked ? (
          <View style={styles.form}>
            <View style={styles.errorRow}>
              <Image source={ICONS.fail} style={styles.errorIcon} resizeMode="contain" />
              <Text style={styles.errorText}>
                {blocked.kind === 'grant-expired' ? grantExpiredText() : unboundText()}
              </Text>
            </View>
            {blocked.kind === 'unbound' ? (
              <AppButton
                size="md"
                title={t('login_claim')}
                onPress={() => navigation?.navigate(BIND_FLOW_ROUTE)}
                style={styles.primary}
              />
            ) : null}
            <TouchableOpacity onPress={() => setBlocked(null)} hitSlop={12} style={styles.pinCancel}>
              <Text style={styles.pinCancelT}>{t('c_back')}</Text>
            </TouchableOpacity>
          </View>
        ) : (<>
        <View style={styles.cards}>
          {card('email')}
          {card('qr')}
        </View>

        {mode === 'email' ? (
          <View style={styles.form}>
            <Text style={styles.label}>
              {t('g_login_label_user')}<Text style={styles.star}>*</Text>
            </Text>
            <View style={[styles.inputBox, (error || serverError) && styles.inputBoxError]}>
              <Image
                source={ICONS.username}
                style={[styles.fieldIcon, (error || serverError) && { tintColor: RED }]}
                resizeMode="contain"
              />
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={(v) => { setUsername(v); setError(false); setServerError(''); }}
                placeholder={t('g_login_ph_user')}
                placeholderTextColor={INPUT_BORDER}
                autoCapitalize="none"
              />
            </View>

            <Text style={[styles.label, styles.labelGap]}>
              {t('g_login_label_pass')}<Text style={styles.star}>*</Text>
            </Text>
            <View style={[styles.inputBox, (error || serverError) && styles.inputBoxError]}>
              <Image
                source={ICONS.password}
                style={[styles.fieldIcon, (error || serverError) && { tintColor: RED }]}
                resizeMode="contain"
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={(v) => { setPassword(v); setError(false); setServerError(''); }}
                placeholder={t('g_login_ph_pass')}
                placeholderTextColor={INPUT_BORDER}
                secureTextEntry={!showPass}
              />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)} hitSlop={10}>
                <Image
                  source={showPass ? ICONS.hide : ICONS.show}
                  style={styles.eyeIcon}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            </View>

            {error || serverError ? (
              <View style={styles.errorRow}>
                <Image source={ICONS.fail} style={styles.errorIcon} resizeMode="contain" />
                <Text style={styles.errorText}>
                  {serverError || t('g_login_error_local')}
                </Text>
              </View>
            ) : null}
            {serverError ? (
              <TouchableOpacity
                style={styles.forgotLink}
                onPress={() => navigation?.navigate(BIND_FLOW_ROUTE)}>
                <Text style={styles.forgotLinkT}>{t('login_claim')}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={styles.forgotLink}
              onPress={() => navigation?.navigate('ForgotPin')}>
              <Text style={styles.forgotLinkT}>{t('g_login_forgot')}</Text>
            </TouchableOpacity>

            <View style={styles.spacer} />
            <AppButton
              size="md"
              title={busy ? t('login_verifying') : t('g_login_submit')}
              onPress={submit}
              disabled={!filled || busy}
              style={styles.primary}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <View style={styles.qrHero}>
              <QrTabletArt />
            </View>
            {serverError ? (
              <View style={styles.errorRow}>
                <Image source={ICONS.fail} style={styles.errorIcon} resizeMode="contain" />
                <Text style={styles.errorText}>{serverError}</Text>
              </View>
            ) : null}
            <View style={styles.spacer} />
            <AppButton
              size="md"
              variant="secondary"
              title={t('g_login_how')}
              onPress={() => navigation?.navigate('QrHow')}
              style={styles.outline}
              textStyle={styles.outlineT}
            />
            <AppButton
              size="md"
              title={busy ? t('login_verifying') : t('g_login_scan')}
              onPress={openQrScanner}
              disabled={busy}
              style={styles.primary}
            />
          </View>
        )}
      </>)}
    </>
  );

  /**
   * Panel ilustrasi/info kanan khusus tablet (ala split statusSide+receiptSide
   * SuccessScreen). Phone tidak memakai panel ini.
   */
  const infoPanel = (
    <View style={styles.infoSide}>
      <QrTabletArt />
      <Text style={styles.infoTitle}>{t('login_info_title')}</Text>
      <Text style={styles.infoItem}>{t('login_info_user')}</Text>
      <Text style={styles.infoItem}>{t('login_info_qr')}</Text>
      <Text style={styles.infoHelp}>{t('login_info_help')}</Text>
    </View>
  );

  /**
   * Modal PIN staff pasca-kredensial (B1/L1): muncul SETELAH username+password
   * lolos langkah 1 — berurutan, bukan 3 faktor sekaligus. Judul + petunjuk
   * via kunci kontrak login_pin_title/login_pin_hint; PIN staff ≠ PIN terminal
   * (binding) ≠ PIN owner (eskalasi).
   */
  const pinModal = (
      <Modal visible={pinOpen} transparent animationType="fade" onRequestClose={() => setPinOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.helpCard}>
            <Text style={styles.pinTitle}>{pinTitleText()}</Text>
            <Text style={styles.pinSub}>
              {pinCandidateLabel()}
            </Text>
            {t('login_pin_hint') !== 'login_pin_hint' ? (
              <Text style={styles.pinSub}>{t('login_pin_hint')}</Text>
            ) : null}
            <TextInput
              style={styles.pinInput}
              value={staffPin}
              onChangeText={(v) => { setStaffPin(v.replace(/[^0-9]/g, '')); setPinError(''); }}
              placeholder={t('login_pin_ph')}
              placeholderTextColor={INPUT_BORDER}
              secureTextEntry
              keyboardType="number-pad"
            />
            {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
            <AppButton
              size="md"
              title={pinBusy ? t('login_verifying') : t('g_login_submit')}
              onPress={submitStaffPin}
              disabled={pinBusy || staffPin.trim().length < 4}
              style={styles.primary}
            />
            <TouchableOpacity onPress={() => setPinOpen(false)} hitSlop={12} style={styles.pinCancel}>
              <Text style={styles.pinCancelT}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
    </Modal>
  );

  /**
   * Modal takeover (SPEC §4/K1): server me-revoke sesi lama di terminal ini
   * dan E01b mengembalikan tookOver{kickedUserId} — user BARU wajib
   * dikonfirmasi (takeover_title/takeover_msg) SEBELUM sesi dibuat.
   * Batal = tetap di modal PIN (tanpa sesi, tanpa bypass).
   */
  const takeoverModal = (
      <Modal visible={!!takeover} transparent animationType="fade" onRequestClose={() => setTakeover(null)}>
        <View style={styles.overlay}>
          <View style={styles.helpCard}>
            <Text style={styles.pinTitle}>{t('takeover_title')}</Text>
            <Text style={styles.pinSub}>{t('takeover_msg')}</Text>
            {takeover ? (
              <Text style={styles.pinSub}>{takeover.kickedUserId}</Text>
            ) : null}
            <AppButton
              size="md"
              title={t('g_login_help_ok')}
              onPress={() => {
                const cur = takeover;
                if (!cur) return;
                setTakeover(null);
                setPinBusy(true);
                void (async () => {
                  try {
                    const ctx = await resolveTermCtx();
                    const uname = candidate && candidate.kind === 'online' ? candidate.username : '';
                    if (!ctx || !uname) {
                      setPinError(needBeText());
                      return;
                    }
                    const deviceId = ctx.deviceId || (await getContractDeviceId());
                    await completeOnline(cur.payload, cur.pin, ctx, deviceId, uname);
                    // F14-flush: takeover terkonfirmasi = login ONLINE sukses.
                    try { void flushPendingRevokes().catch(() => {}); } catch { /* abaikan */ }
                    setPinOpen(false);
                  } finally {
                    setPinBusy(false);
                  }
                })();
              }}
              style={styles.primary}
            />
            <TouchableOpacity onPress={() => setTakeover(null)} hitSlop={12} style={styles.pinCancel}>
              <Text style={styles.pinCancelT}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
    </Modal>
  );

  const helpModal = (
      <Modal visible={help} transparent animationType="fade" onRequestClose={() => setHelp(false)}>
        <View style={styles.overlay}>
          <View style={styles.helpCard}>
            <View style={styles.helpGreen}>
              <View style={styles.helpLogoCircle}>
                <Image source={ICONS.logo} style={styles.helpLogoImg} resizeMode="contain" />
              </View>
              <Text style={styles.helpGreenTitle}>{t('g_login_help_title')}</Text>
              <Text style={styles.helpGreenSub}>{t('g_login_help_sub')}</Text>
              <Image source={ICONS.waQr} style={styles.helpQrImg} resizeMode="contain" />
            </View>
            <Text style={styles.helpBody}>
              {t('g_login_help_body')}{' '}
              <Text style={styles.helpPhone}>0822-1066-6969</Text>
            </Text>
            <AppButton
              size="sm"
              title={t('g_login_help_ok')}
              onPress={() => setHelp(false)}
              style={styles.primary}
            />
          </View>
        </View>
    </Modal>
  );

  /**
   * Pemindai QR login: kamera live penuh-layar di atas form login (bukan
   * screen navigasi lain). Native: CameraView + pindai otomatis sekali.
   * Web: kamera browser nyata (getUserMedia + BarcodeDetector) ke <video>;
   * tempel kode hanya cadangan bila kamera tak ada/ditolak.
   */
  const scanModal = (
    <Modal visible={scanOpen} transparent={false} animationType="slide" onRequestClose={() => setScanOpen(false)}>
      <View style={styles.scanRoot}>
        {Platform.OS === 'web' ? (
          <View style={[styles.scanManual, isTablet && wideCenterSm]}>
            <Text style={styles.scanTitle}>{t('g_login_scan')}</Text>
            <Text style={styles.scanManualHint}>{t('login_qr_hint')}</Text>
            <View style={[styles.scanVideoWrap, isTablet && styles.scanVideoWrapBig]}>
              {webCamError ? (
                <Text style={styles.scanCamErr}>
                  {webCamError === 'denied' ? t('scan_denied') : t('login_qr_nocam')}
                </Text>
              ) : (
                (createElement as unknown as (tag: string, props: Record<string, unknown>) => never)('video', {
                  ref: (el: unknown) => { videoEl.current = el; },
                  muted: true,
                  playsInline: true,
                  autoPlay: true,
                  style: { width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000000' },
                })
              )}
              <View style={[styles.scanFrame, styles.scanFrameWeb]} pointerEvents="none" />
            </View>
            {webManual || webCamError ? (
              <>
                <View style={styles.scanBox}>
                  <TextInput
                    style={styles.scanInput}
                    value={qrCode}
                    onChangeText={setQrCode}
                    placeholder={t('login_qr_paste')}
                    placeholderTextColor={INPUT_BORDER}
                    autoCapitalize="none"
                    multiline
                  />
                </View>
                <AppButton
                  size="md"
                  title={t('login_qr_use')}
                  onPress={() => handleQrData(qrCode)}
                  disabled={!qrCode.trim() || busy}
                  style={styles.primary}
                />
              </>
            ) : (
              <TouchableOpacity onPress={() => setWebManual(true)} style={styles.scanLink} hitSlop={12}>
                <Text style={styles.scanLinkT}>{t('login_qr_manual')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : camAllowed || permission?.granted ? (
          <View style={styles.scanRoot}>
            <CameraView
              style={styles.scanner}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => handleQrData(String(data))}
            />
            <View style={styles.scanFrame} pointerEvents="none" />
            <View style={styles.scanBar} pointerEvents="box-none">
              <Text style={styles.scanHint}>{t('login_qr_hint')}</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.scanManual, isTablet && wideCenterSm]}>
            <Text style={styles.scanTitle}>{t('g_login_scan')}</Text>
            <Text style={styles.scanManualHint}>{t('scan_denied')}</Text>
            <View style={styles.scanBox}>
              <TextInput
                style={styles.scanInput}
                value={qrCode}
                onChangeText={setQrCode}
                placeholder={t('login_qr_paste')}
                placeholderTextColor={INPUT_BORDER}
                autoCapitalize="none"
                multiline
              />
            </View>
            <AppButton
              size="md"
              title={t('login_qr_use')}
              onPress={() => handleQrData(qrCode)}
              disabled={!qrCode.trim() || busy}
              style={styles.primary}
            />
          </View>
        )}
        <TouchableOpacity style={styles.scanCancel} onPress={() => setScanOpen(false)} hitSlop={12}>
          <Text style={styles.scanCancelT}>← {t('cancel')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );

  // Split dua kolom hanya saat tablet landscape; portrait tablet ikut jalur
  // satu kolom tengah (wideCenterSm) seperti phone agar form tidak sempit.
  if (showSplit) {
    return (
      <ScreenRoot style={styles.root}>
        <View style={styles.split}>
          <ScrollView
            contentContainerStyle={styles.formSide}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {formBody}
          </ScrollView>
          {infoPanel}
        </View>
        {helpModal}
        {pinModal}
        {takeoverModal}
        {scanModal}
      </ScreenRoot>
    );
  }

  return (
    <ScreenRoot style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.body, isTablet && wideCenterSm]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {formBody}
      </ScrollView>
      {helpModal}
      {pinModal}
      {takeoverModal}
      {scanModal}
    </ScreenRoot>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28, flexGrow: 1 },
  split: { flex: 1, flexDirection: 'row' },
  formSide: { paddingHorizontal: 32, paddingTop: 24, paddingBottom: 28, flexGrow: 1 },
  infoSide: {
    flex: 1, backgroundColor: colors.navy,
    alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10,
  },
  infoTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.white, textAlign: 'center', marginTop: 18 },
  infoItem: { fontFamily: fonts.regular, fontSize: 14, color: colors.navyTint, textAlign: 'center' },
  infoHelp: { fontFamily: fonts.medium, fontSize: 13, color: colors.white, textAlign: 'center', marginTop: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { fontSize: 28, color: '#4A4A4A', fontFamily: fonts.bold, paddingRight: 12 },
  helpCircle: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#E4E4E4',
    alignItems: 'center', justifyContent: 'center',
  },
  helpGlyph: { fontSize: 20, color: '#FFFFFF', fontFamily: fonts.bold },
  logo: { width: 200, height: 68, alignSelf: 'center', marginTop: 14 },
  title: {
    fontFamily: fonts.bold, fontSize: 26, color: TITLE_DARK,
    textAlign: 'center', marginTop: 22,
  },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: GREY, textAlign: 'center', marginTop: 10 },
  cards: { flexDirection: 'row', gap: 12, marginTop: 26 },
  card: {
    flex: 1, height: 94, borderRadius: 12, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  cardOn: { backgroundColor: BLUE_PALE, borderColor: BLUE },
  cardOff: { backgroundColor: '#FFFFFF', borderColor: BORDER },
  iconBox: { width: 48, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  iconBoxOn: { backgroundColor: BLUE_ICON_BG },
  iconBoxOff: { backgroundColor: '#F1F3F5' },
  iconImg: { width: 26, height: 26 },
  cardLabel: { fontSize: 13, fontFamily: fonts.regular },
  cardLabelBold: { fontFamily: fonts.bold },
  cardLabelOn: { color: BLUE },
  cardLabelOff: { color: ICON_GREY },
  form: { marginTop: 28, flex: 1 },
  label: { fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, marginBottom: 8 },
  labelGap: { marginTop: 18 },
  star: { color: RED },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    height: 56, borderRadius: 14, borderWidth: 1, borderColor: INPUT_BORDER,
    paddingHorizontal: 16, backgroundColor: '#FFFFFF',
  },
  inputBoxError: { borderColor: RED },
  fieldIcon: { width: 22, height: 22 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, height: '100%', outlineStyle: 'none' as never },
  eyeIcon: { width: 24, height: 24 },
  errorRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'flex-start' },
  errorIcon: { width: 20, height: 20, marginTop: 1 },
  errorText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: RED, lineHeight: 19 },
  forgotLink: { alignSelf: 'flex-end', marginTop: 10, paddingVertical: 4 },
  forgotLinkT: { fontFamily: fonts.semibold, fontSize: 13, color: BLUE },
  spacer: { flex: 1, minHeight: 48 },
  primary: {
    backgroundColor: ORANGE, borderRadius: 28, height: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  primaryIdle: { backgroundColor: PEACH },
  scanGlow: {
    shadowColor: ORANGE, shadowOpacity: 0.45, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  primaryT: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  outline: {
    borderWidth: 1.5, borderColor: BLUE, borderRadius: 28, height: 56,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', marginTop: 12,
  },
  outlineT: { fontFamily: fonts.bold, fontSize: 16, color: BLUE },
  qrHero: { alignItems: 'center', marginTop: 48 },
  tablet: {
    width: 280, height: 200, borderRadius: 18, backgroundColor: '#111111',
    alignItems: 'center', justifyContent: 'center',
  },
  tabletScreen: {
    width: 252, height: 172, borderRadius: 4, backgroundColor: '#BEE3F8',
    alignItems: 'center', justifyContent: 'center',
  },
  tabletQr: {
    backgroundColor: '#FFFFFF', borderRadius: 8, padding: 10,
    borderTopWidth: 3, borderTopColor: RED,
  },
  miniQr: { width: 99, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#FFFFFF' },
  miniCell: { width: 9, height: 9 },
  miniCellOn: { backgroundColor: '#111111' },
  tabletDot: {
    position: 'absolute', right: 8, top: '50%', width: 6, height: 6,
    borderRadius: 3, backgroundColor: '#444444', marginTop: -3,
  },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  /** Kartu bantuan dibatasi agar tidak melar selebar tablet (phone tak berubah). */
  helpCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, alignSelf: 'center' },
  helpGreen: {
    backgroundColor: '#1FA855', borderRadius: 12, padding: 20, alignItems: 'center',
  },
  helpLogoCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', marginTop: -52, marginBottom: 10,
  },
  helpLogoImg: { width: 44, height: 16 },
  helpGreenTitle: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF', textAlign: 'center' },
  helpGreenSub: { fontFamily: fonts.regular, fontSize: 13, color: '#FFFFFF', marginTop: 4 },
  helpQrImg: {
    backgroundColor: '#FFFFFF', borderRadius: 8, marginTop: 16,
    width: 190, height: 190,
  },
  helpBody: {
    fontFamily: fonts.regular, fontSize: 13, color: '#333333',
    textAlign: 'center', lineHeight: 20, marginTop: 16, marginBottom: 4,
  },
  helpPhone: { fontFamily: fonts.bold },
  /** Pemindai QR login penuh-layar (di atas form, bukan screen navigasi). */
  scanRoot: { flex: 1, backgroundColor: '#000000' },
  scanner: { flex: 1 },
  scanBar: {
    position: 'absolute', left: 0, right: 0, bottom: 96,
    alignItems: 'center', paddingHorizontal: 32,
  },
  scanHint: {
    fontFamily: fonts.medium, fontSize: 14, color: '#FFFFFF',
    textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden',
  },
  scanCancel: {
    position: 'absolute', left: 16, top: 16,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
  },
  scanCancelT: { fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' },
  scanManual: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24, paddingTop: 72, paddingBottom: 28 },
  scanTitle: { fontFamily: fonts.bold, fontSize: 22, color: TITLE_DARK, textAlign: 'center' },
  scanManualHint: { fontFamily: fonts.regular, fontSize: 14, color: GREY, textAlign: 'center', marginTop: 10 },
  scanBox: {
    borderWidth: 1, borderColor: INPUT_BORDER, borderRadius: 14,
    minHeight: 120, paddingHorizontal: 16, paddingVertical: 12, marginTop: 16, marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  scanInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: TITLE_DARK, minHeight: 96, outlineStyle: 'none' as never },
  /** Bingkai viewfinder di atas kamera (native penuh-layar maupun video web). */
  scanVideoWrap: {
    marginTop: 16, marginBottom: 8, height: 300, borderRadius: 14,
    overflow: 'hidden', backgroundColor: '#000000',
    alignItems: 'center', justifyContent: 'center',
  },
  scanFrame: {
    position: 'absolute', width: 220, height: 220,
    borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 16, opacity: 0.9,
    alignSelf: 'center', top: '28%',
  },
  scanFrameWeb: { top: 40 },
  /** Video pindai lebih tinggi di tablet agar proporsional (phone tetap 300). */
  scanVideoWrapBig: { height: 420 },
  scanCamErr: {
    fontFamily: fonts.medium, fontSize: 14, color: '#FFFFFF',
    textAlign: 'center', paddingHorizontal: 24,
  },
  scanLink: { alignSelf: 'center', marginTop: 8, paddingVertical: 8 },
  scanLinkT: { fontFamily: fonts.semibold, fontSize: 14, color: BLUE, textDecorationLine: 'underline' },
  /** Sapaan merchant-terminal + modal PIN staff (paket app-login, row 3/18). */
  welcomeTerm: {
    fontFamily: fonts.semibold, fontSize: 13, color: BLUE,
    textAlign: 'center', marginTop: 10, lineHeight: 19,
  },
  unboundLink: { alignSelf: 'center', marginTop: 10, paddingVertical: 4 },
  unboundLinkT: { fontFamily: fonts.semibold, fontSize: 13, color: BLUE },
  pinTitle: { fontFamily: fonts.bold, fontSize: 18, color: TITLE_DARK, textAlign: 'center' },
  pinSub: { fontFamily: fonts.regular, fontSize: 13, color: GREY, textAlign: 'center', marginTop: 6, marginBottom: 12 },
  pinInput: {
    flexDirection: 'row', alignItems: 'center',
    height: 56, borderRadius: 14, borderWidth: 1, borderColor: INPUT_BORDER,
    paddingHorizontal: 16, backgroundColor: '#FFFFFF',
    fontFamily: fonts.bold, fontSize: 18, color: TITLE_DARK,
    letterSpacing: 4, textAlign: 'center',
  },
  pinError: { fontFamily: fonts.medium, fontSize: 13, color: RED, textAlign: 'center', marginTop: 10, lineHeight: 19 },
  pinCancel: { alignSelf: 'center', marginTop: 10, paddingVertical: 6 },
  pinCancelT: { fontFamily: fonts.semibold, fontSize: 14, color: BLUE },
});
