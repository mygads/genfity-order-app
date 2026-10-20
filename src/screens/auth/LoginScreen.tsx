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
  adoptTerminalBinding,
  buildGrant as buildSessionGrant,
  consumeKickNotice,
  describeGrantProblem,
  getBinding as getSessionBinding,
  getGrantPinVersion,
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
import { pinVerifyTerminalPin } from '../../lib/terminalApi';
import {
  getContractDeviceId,
  loadBinding,
  type TerminalBinding as LegacyBinding,
} from '../../lib/terminalContract';
import { queryFirst } from '../../lib/db';
import { isSeedReady, whenSeedReady } from '../../lib/seed';
import { loadPinRecord, savePinHash, verifyAttendancePin, verifyPinHash } from '../../lib/pin';
import { requireEscalationAccess } from '../../lib/access';
import { readMerchantTypeFromLoginBody } from '../../lib/posModes';
import { syncCurrencyFromProfile } from '../../lib/currency';
import { syncTimezoneFromProfile } from '../../lib/timezone';
import { useLang } from '../../lib/i18n';
import AppButton from '../../components/AppButton';
import ScreenRoot from '../../components/ScreenRoot';
import BackChevron from '../../components/BackChevron';

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

/**
 * APP-FIXUP(Q2) HIDE-QR: entry login-QR DIHIDE dulu (QR_LOGIN_VISIBLE=false).
 * handleQrData/loginByQrCode/parseQrLoginPayload SENGAJA dipertahankan
 * (bukti H1 + dipakai future) — yang disembunyikan hanya entry UI-nya
 * (card mode qr, qrHero, tombol openQrScanner, infoItem login_info_qr).
 * Future design (catat saja, JANGAN implementasi di sini): backend
 * genfity-order akan mendukung login via QR di terminal — scan QR langsung
 * login tanpa username/password/PIN-terminal; user yang sedang login di web
 * genfity-order otomatis login di terminal, lalu hanya diminta PIN
 * staff/owner sesuai role-nya.
 */
const QR_LOGIN_VISIBLE = false;

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
 * device yang ter-bind sebelum Wave1 tetap bisa login (tanpa bind ulang).
 * S4-APP-313: I/O lokal dibatasi withTimeout — storage/SQLite yang wedged tak
 * pernah settle (bukan reject), jadi try/catch saja tak cukup; tanpa batas ini
 * submit gantung di "Verifying..." selamanya. 5 dtk longgar untuk I/O lokal
 * normal (<50 mdtk) sekaligus fail-fast menuju jalur error jujur. */
async function resolveTermCtx(): Promise<TermCtx | null> {
  try {
    await withTimeout(hydrateTerminalState(), 5000);
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
    const leg = await withTimeout(loadBinding(), 5000);
    if (leg && leg.terminalCode.trim()) {
      const m = mapLegacyBinding(leg);
      return {
        terminalId: m.terminalId,
        terminalCode: m.terminalCode,
        branchId: m.branchId,
        branchName: m.branchName,
        // Q1: merchantName opsional di Binding — cermin dari branchName.
        merchantName: (m.merchantName || m.branchName || '').trim(),
        tag: m.tag,
        deviceId: (m.deviceId || '').trim(),
      };
    }
  } catch {
    /* tanpa binding */
  }
  return null;
}

/** E01 terminal-login STAGED fase-1a (SPEC §4/§11 E01): POST
 * /api/v1/auth/terminal-login {username,password,deviceId,terminalCode?,
 * terminalPin?} → langkah 1+2 (password + PIN terminal; PIN terminal HANYA
 * diminta bila device belum bound ke user ini — bound device lewat fast-path
 * tanpa PIN). Respons SUKSES membawa materi sesi PENUH (session + JWT pair +
 * terminal tag + branches + terminals + grant triple 7-hari + tookOver bila
 * eviksi) + pinRequired:true SELALU — langkah 3 (PIN user/workforce) WAJIB
 * lewat E29 pin-verify (callPinVerify) SEBELUM kasir dibuka. `staffPin`
 * BUKAN bagian endpoint ini (server mengabaikan field JSON tak dikenal).
 * Payload SELALU bawa deviceId; terminalCode OPSIONAL (bound device resolve
 * via fast-path server); terminalPin ikut bila server memintanya.
 * Tak pernah melempar: {reached:false} = offline/unconfigured (mode 'local'
 * = tanpa server — pemanggil wajib lewat gate grant, fail-closed). */
interface StaffLoginCall {
  reached: boolean;
  status: number;
  body: Record<string, unknown>;
}

async function callStaffLogin(
  body: Record<string, string | number>,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<StaffLoginCall> {
  // S4-APP-313: timeout eksplisit PER-ATTEMPT via AbortController (bukan
  // Promise.race tanpa abort — fetch yang dibiarkan hidup menahan soket dan,
  // di RN-web, penolakan balapan bisa tak menjatuhkan submit bila pemanggil
  // menunggu hal lain). Timeout 15 dtk menutup jendela SYN-blackhole (~21 dtk
  // akan memotong SEBELUM OS menyerah — verifikasi inti memakai 10.255.255.1).
  // 1x retry HANYA untuk kegagalan transpor (throw/timeout), BUKAN untuk
  // jawaban definitif server (reached apa pun statusnya = final, tanpa retry).
  // Sinyal pemanggil (pembatalan user: submit baru / unmount) dihubungkan ke
  // controller yang sama — abort user TIDAK memicu retry, langsung jatuh ke
  // jalur offline. Semua lemparan termasuk AbortError → {reached:false} =
  // jalur offline-path yang sama dengan fast-fail; tak pernah melempar.
  if (getApiMode() === 'local') return { reached: false, status: 0, body: {} };
  const TIMEOUT_MS = opts?.timeoutMs ?? 15000;
  const userSignal = opts?.signal;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (userSignal?.aborted) break;
    const ctrl = new AbortController();
    const onUserAbort = () => {
      try {
        ctrl.abort();
      } catch {
        /* abaikan */
      }
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        ctrl.abort();
      } catch {
        /* abaikan */
      }
    }, TIMEOUT_MS);
    if (userSignal) {
      if (typeof userSignal.addEventListener === 'function') {
        userSignal.addEventListener('abort', onUserAbort);
      }
    }
    try {
      const res = await apiPost(ApiPath.staffLogin, body, { signal: ctrl.signal });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      const b = (unwrapData<unknown>(json) ?? {}) as Record<string, unknown>;
      return { reached: true, status: res.status, body: b && typeof b === 'object' ? b : {} };
    } catch {
      // Abort user = niat pembatalan → JANGAN retry, langsung offline-path.
      if (userSignal?.aborted && !timedOut) break;
      // attempt 0 = coba sekali lagi; attempt 1 = habis → offline-path.
      if (attempt >= 1) break;
    } finally {
      clearTimeout(timer);
      if (userSignal && typeof userSignal.removeEventListener === 'function') {
        userSignal.removeEventListener('abort', onUserAbort);
      }
    }
  }
  return { reached: false, status: 0, body: {} };
}

/** E29 pin-verify (fase-1a, faktor 3 login staged): INTI HTTP TUNGGAL di
 * lib/terminalApi.pinVerifyTerminalPin (termasuk bearer JWT tahap-B — temuan
 * review Trek 1: login-first belum punya sesi tersimpan saat PIN modal karena
 * completeOnline jalan SETELAH PIN lolos; tanpa token E29 selalu 401 dan
 * login macet permanen). Wrapper ini hanya memetakan ke bentuk fail-closed
 * layar: {reached:false} = jaringan putus / mode local / dummy → pemanggil
 * fallback ke gerbang PIN lokal (kejujuran offline L1 tak berubah). */
interface PinVerifyCall {
  reached: boolean;
  status: number;
  errorCode: string;
  serverMessage: string;
  pinVersion: number;
}

async function callPinVerify(terminalId: string, pin: string, token?: string): Promise<PinVerifyCall> {
  const blank: PinVerifyCall = { reached: false, status: 0, errorCode: '', serverMessage: '', pinVersion: 0 };
  try {
    if (!terminalId || getApiMode() === 'local') return blank;
    const r = await withTimeout(
      pinVerifyTerminalPin(terminalId, pin, token ? { token } : undefined),
      12000,
    );
    if (r.fromDummy) return blank;
    if (!r.ok) {
      // Server menjawab penolakan (INVALID/LOCKED/NOT_SET): reached = server
      // menang; kode + pesan diteruskan agar layar bedakan enroll vs tolak.
      return { reached: true, status: r.status, errorCode: r.errorCode ?? '', serverMessage: r.serverMessage ?? '', pinVersion: 0 };
    }
    // Inti sukses selalu 2xx (BE 200): status literal cukup — pemanggil hanya
    // cabang 2xx vs 400 vs lainnya.
    return { reached: true, status: 200, errorCode: '', serverMessage: '', pinVersion: r.data.pinVersion };
  } catch {
    return blank;
  }
}

/** B (PIN hybrid berversi): bandingkan pinVersion grant simpanan vs server
 * pasca-E29 sukses. Beda = PIN diubah manajer setelah grant dibuat; user BARU
 * SAJA membuktikan PIN saat ini ke server → tindakan benar = SEMBUHKAN
 * (completeOnline di bawah menulis versi baru), BUKAN memblokir login yang
 * sah. Kasus berbahaya (grant versi-lama dipakai OFFLINE) tak terlihat di
 * sini — penegakannya milik Trek Sync (versi di payload pull / endpoint
 * cek-versi ringan BE): mismatch → clearGrant(triple) + wajib re-login
 * online + copy jujur (lihat POS-DECISIONS). Di sini hanya diagnostik. */
function noteGrantPinVersion(userId: string, terminalId: string, deviceId: string, serverVersion: number): void {
  if (!userId || !terminalId || !deviceId || !serverVersion) return;
  try {
    const stored = getGrantPinVersion({ userId, terminalId, deviceId });
    if (stored !== null && stored !== 0 && stored !== serverVersion) {
      console.info(
        `[login] pinVersion server v${serverVersion} ≠ grant v${stored}: PIN diubah setelah grant dibuat — versi disembuhkan pasca-login ini.`,
      );
    }
  } catch {
    /* diagnostik saja; completeOnline menulis versi baru */
  }
}

/** Penolakan eksplisit server (kredensial salah) vs tak-terjangkau.
 * 401 di SINI (pra-sesi, tanpa sesi aktif) = kredensial ditolak, BUKAN kick:
 * 401 = gagal auth final → re-login, tak pernah bukti kick (koreksi K1
 * 2026-10-17). Deteksi kick = event `takeover` SSE terminal (watcher sesi di
 * App.tsx) + pencocokan pola kick/takeover sisi-klien pada pesan WS.
 * PENGECUALIAN fase-1a: 401 PIN_REQUIRED/PIN_INVALID/PIN_LOCKED dan 423
 * PIN_LOCKED = server meminta PIN terminal (faktor 2 login staged), BUKAN
 * kredensial salah — pemanggil menampilkannya sebagai permintaan PIN, bukan
 * login_fail (lihat submit). */
function isExplicitReject(call: StaffLoginCall): boolean {
  if (!call.reached) return false;
  if (call.status === 409) return false; // 1-1-1: konflik okupansi, bukan kredensial
  if (call.status === 401 || call.status === 403 || call.status === 422 || call.status === 423) {
    const code = str((call.body as Record<string, unknown>).error);
    if (code === 'PIN_REQUIRED' || code === 'PIN_INVALID' || code === 'PIN_LOCKED') return false;
    return true;
  }
  if (call.body.credentialOk === false) return true;
  return false;
}

/** Kode error terminal-login tahap-1 (envelope error tanpa `data`, baca
 * top-level — beda dari respons sukses yang dibungkus `data`). */
function loginErrorOf(call: StaffLoginCall): { code: string; message: string } {
  const b = (call.body ?? {}) as Record<string, unknown>;
  return { code: str(b.error), message: str(b.message) };
}

/** Respons pertama SUDAH membawa sesi penuh (single-stage live): userId ada.
 * BUKAN undangan tahap-2 — sesi dikunci setelah gerbang PIN LOKAL, tanpa
 * panggilan server kedua. PENGECUALIAN: stage-A login-first (`stage:
 * 'pick-terminal' = picker tanpa sesi/token) — userId di sana BUKAN materi
 * sesi, jangan kunci sesi darinya (ditangani cabang stage-A di submit). */
function hasSessionMaterial(call: StaffLoginCall): boolean {
  if (!call.reached || call.status < 200 || call.status >= 300) return false;
  if (str(call.body.stage) === 'pick-terminal') return false;
  return str(call.body.userId ?? call.body.user_id) !== '';
}

/** DEFENSIF: server menjawab kredensial-ok TANPA materi sesi (requiresPin /
 * credentialOk tanpa userId — tak pernah terjadi di BE live single-stage).
 * Pemanggil boleh refetch jujur TANPA staffPin; PIN tetap gerbang lokal. */
function isCredentialOnly(call: StaffLoginCall): boolean {
  if (!call.reached || call.status < 200 || call.status >= 300) return false;
  if (hasSessionMaterial(call)) return false;
  const b = call.body;
  return b.credentialOk === true || b.requiresPin === true;
}

interface NormBranch {
  id: string;
  name: string;
}

/** Terminal tahap-A login-first (dari E01 stage pick-terminal). */
interface NormTerminal {
  id: string;
  code: string;
  name: string;
  tag: string;
  merchantId: string;
}

/** Normalisasi daftar terminal stage-A; opsional filter per cabang
 * (picker chips memfilternya per pickBranch). Terminal tanpa merchantId
 * dianggap milik semua cabang (backward-compat payload lama). */
function normTerminals(v: unknown, branchId?: string): NormTerminal[] {
  if (!Array.isArray(v)) return [];
  return (v as Record<string, unknown>[])
    .map((x) => ({
      id: str(x.terminalId ?? x.id),
      code: str(x.terminalCode ?? x.code),
      name: str(x.name),
      tag: str(x.tag).trim().toLowerCase(),
      merchantId: str(x.merchantId ?? x.merchant_id ?? x.branchId),
    }))
    .filter(
      (x) =>
        x.id !== '' &&
        x.code !== '' &&
        (!branchId || x.merchantId === '' || x.merchantId === branchId),
    );
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

/** S4-APP-313: lookup tahan-seed — query SQLite antri di belakang seed-write
 * (~40 dtk di first-run web; bukti runtime 2026-10-20 :3120-vs-:3131: batas
 * tunggal 3 dtk/60 dtk = login offline valid gagal-palsu jadi need_be).
 * Selama seed BELUM selesai, '' = "belum tahu" → ulangi (tiap query dibatasi
 * 15 dtk); berhenti bila: user ketemu, seed selesai ('' = tak ada user =
 * jawaban final), atau budget total 90 dtk habis (wedged = '' → need_be
 * jujur). Tak pernah gantung selamanya; kasus umum (seed done) = 1 iterasi,
 * tanpa latensi tambahan. */
async function lookupLocalUserIdAfterSeed(username: string): Promise<string> {
  const t0 = Date.now();
  for (;;) {
    const uid = await withTimeout(lookupLocalUserId(username), 15000).catch(() => '');
    if (uid || isSeedReady() || Date.now() - t0 > 90000) return uid;
    await new Promise((r) => setTimeout(r, 3000));
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
 * GERBANG PIN LOKAL (koreksi review Trek 1 — komentar lama "server tak pernah
 * verifikasi PIN staff" SUDAH SALAH: E29 POST /terminals/{id}/pin-verify
 * adalah verifikasi server dan WAJIB lolos saat reachable).
 * Dipakai HANYA bila (a) server mengonfirmasi USER_PIN_NOT_SET (enroll
 * progresif, online), atau (b) E29 tak terjangkau TAPI record PIN lokal sudah
 * ada (user kembali). Tanpa record + tanpa server = fail-closed di pemanggil
 * (need_be), BUKAN seed-if-absent — seed di sini MENGINGAT PIN sesi yang sudah
 * lolos server, bukan verifikasi. Dipakai terhadap record yang sama dibaca
 * layar absensi/shift via loadPinRecord.
 * - record ada → PIN wajib cocok (verifyPinHash), salah = tolak;
 * - record belum ada → seed sekali (savePinHash) agar grant offline + login
 *   berikut punya acuan — HANYA dipanggil dari jalur (a)/(b) di atas.
 * Tak pernah melempar (gagal baca = false, fail-closed).
 */
async function passesLocalWorkforcePin(userId: string, pin: string): Promise<boolean> {
  const uid = userId.trim();
  const clean = String(pin ?? '');
  if (!uid || !clean) return false;
  try {
    const rec = await loadPinRecord(uid);
    if (!rec) {
      await savePinHash(uid, clean);
      return true;
    }
    return verifyPinHash(clean, rec);
  } catch {
    return false;
  }
}

/**
 * GAP-14 owner-override (2026-10-17): modal PIN staff menerima PIN OWNER
 * sebagai pengganti — login kandidat TETAP dikunci untuk user kandidat, tapi
 * sesi membawa attribution approvedBy='owner:<approverUserId>' (Session,
 * session.ts) sebagai jejak audit.
 * - Online (E29 terjangkau): PIN diverifikasi server DULU via callPinVerify
 *   (server menang bila INVALID/LOCKED — tanpa fallback lokal, agar lockout
 *   server tak bisa di-bypass); NOT_SET → lanjut cek lokal (paritas
 *   enroll-progresif jalur normal).
 * - Offline (E29 tak terjangkau): fallback hash lokal via verifyAttendancePin
 *   (disiplin pin.ts: throttle 5x/60 dtk bawaan; null = DB belum siap =
 *   fail-closed, kembalikan gagal agar jalur normal yang memverdict).
 * - Pemegang PIN lalu WAJIB lolos gerbang owner-only
 *   (requireEscalationAccess 'settings.edit' — Staff di-deny di seed) — PIN
 *   staff biasa / typo bukan owner → {ok:false} dan jalur normal yang
 *   memutuskan (murni aditif: override gagal tak mengubah perilaku normal).
 */
async function verifyOwnerOverridePin(pin: string, stageToken?: string): Promise<{
  ok: boolean;
  approverUserId?: string;
  pinVersion?: number;
}> {
  const clean = String(pin ?? '').trim();
  if (!clean) return { ok: false };
  let termId = '';
  try {
    termId = (await resolveTermCtx())?.terminalId ?? '';
  } catch {
    termId = '';
  }
  let pinVersion: number | undefined;
  if (termId.trim()) {
    const pv = await callPinVerify(termId.trim(), clean, stageToken);
    if (pv.reached) {
      if (pv.status >= 200 && pv.status < 300) {
        pinVersion = pv.pinVersion;
      } else if (!(pv.status === 400 && pv.errorCode === 'USER_PIN_NOT_SET')) {
        // Server menolak eksplisit (INVALID/LOCKED/lainnya) = server menang.
        return { ok: false };
      }
    }
    // Tak terjangkau → jatuh ke hash lokal di bawah (offline honesty).
  }
  let v: { ok: boolean | null; userId?: string };
  try {
    v = await verifyAttendancePin(clean);
  } catch {
    return { ok: false };
  }
  if (v.ok !== true || !v.userId) return { ok: false };
  let gate: { ok: boolean } = { ok: false };
  try {
    gate = await requireEscalationAccess(v.userId, 'settings.edit');
  } catch {
    gate = { ok: false };
  }
  if (!gate.ok) return { ok: false };
  return {
    ok: true,
    approverUserId: v.userId,
    ...(pinVersion !== undefined ? { pinVersion } : {}),
  };
}

/**
 * Kunci sesi online pasca-terminal-login login-first (alur L1): saveSession
 * + saveGrant 7-hari sliding (Q6; server-wins bila BE mengirim policy
 * max_offline_grant_days/E28). Materi sesi dari respons terminal-login
 * (pertama, atau refetch defensif TANPA staffPin) — PIN argumen dipakai
 * HANYA untuk grant hash + seed workforce-PIN lokal, bukan verifikasi server.
 * pinVersion (E29, opsional) disimpan ke grant sebagai sumber versi PIN
 * hybrid; 0 = belum diketahui (jalur fallback lokal / QR).
 */
async function completeOnline(
  payload: Record<string, unknown>,
  pin: string,
  ctx: TermCtx,
  deviceId: string,
  username: string,
  pinVersion?: number,
  // GAP-14: attribution owner-override ('owner:<approverUserId>') — dicatat ke
  // sesi apa adanya (jejak audit lokal); absen = login normal tanpa override.
  approvedBy?: string,
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
  // GAP-14: attribution owner-override ikut sesi (persist via saveSession).
  if (approvedBy) sess.approvedBy = approvedBy;
  saveSession(sess);
  // Dual-currency: segarkan cache currency dari profil merchant (fire-and-forget,
  // best-effort — login tak diblokir bila gagal; currency tak ada = fallback IDR).
  // PW-4/S3: sekalian segarkan cache timezone cabang (AUD = Australia/Perth).
  try { void syncCurrencyFromProfile().catch(() => {}); } catch { /* abaikan */ }
  try { void syncTimezoneFromProfile().catch(() => {}); } catch { /* abaikan */ }
  try {
    const pol = payload.policy as Record<string, unknown> | undefined;
    const days = Number(pol?.max_offline_grant_days ?? payload.maxOfflineGrantDays);
    if (Number.isFinite(days)) setMaxOfflineGrantDays(days);
  } catch {
    /* default 7 hari */
  }
  try {
    saveSessionGrant(buildSessionGrant({ userId, terminalId: ctx.terminalId, deviceId, staffPin: pin, ...(pinVersion !== undefined ? { pinVersion } : {}) }));
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
async function completeOffline(
  userId: string,
  username: string,
  pin: string,
  // GAP-14: attribution owner-override ('owner:<approverUserId>') — lihat
  // completeOnline; absen = login offline normal tanpa override.
  approvedBy?: string,
): Promise<void> {
  const ctx = await resolveTermCtx();
  if (!ctx) throw new Error('unbound');
  const deviceId = ctx.deviceId || (await withTimeout(getContractDeviceId(), 5000).catch(() => ''));
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
  // GAP-14: attribution owner-override ikut sesi (persist via saveSession).
  if (approvedBy) sess.approvedBy = approvedBy;
  saveSession(sess);
  // Dual-currency: segarkan cache currency dari profil merchant (fire-and-forget,
  // best-effort — login tak diblokir bila gagal; currency tak ada = fallback IDR).
  // PW-4/S3: sekalian segarkan cache timezone cabang (AUD = Australia/Perth).
  try { void syncCurrencyFromProfile().catch(() => {}); } catch { /* abaikan */ }
  try { void syncTimezoneFromProfile().catch(() => {}); } catch { /* abaikan */ }
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
  // Q8 (2026-10-17): mode 'account' — satu field jujur username-ATAU-email
  // (BE E01 menerima keduanya), bukan label 'email' yang menyesatkan.
  const [mode, setMode] = useState<'account' | 'qr'>('account');
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
  // Throttle PIN offline (temuan review Trek 1): grant-PIN 4-digit tanpa
  // throttle = brute-force via modal. 5x salah → kunci modal 60 dtk.
  // Direset tiap modal dibuka + tiap sukses (bukan per user — satu modal
  // satu kandidat; oracle grant-holder didokumentasikan sebagai residual).
  const [pinAttempts, setPinAttempts] = useState(0);
  const [pinLockUntil, setPinLockUntil] = useState(0);
  // Fase-1a (login staged): PIN terminal HANYA diminta server bila device
  // belum bound ke user ini (PIN_REQUIRED/INVALID/LOCKED) — kolom muncul di
  // bawah password hanya bila server memintanya; bound device dilewati
  // server (fast-path) sehingga kolom tak pernah muncul di sana.
  const [termPin, setTermPin] = useState('');
  const [needTermPin, setNeedTermPin] = useState(false);
  /** Tahap-A login-first (F1): E01 tanpa terminalCode di device yang belum
   * bound mengembalikan {stage:'pick-terminal', branches, terminals} TANPA
   * sesi/token — layar menampilkan picker cabang+terminal, lalu tahap-B
   * (submitPickA) memanggil E01 lagi DENGAN terminalCode (+merchantId).
   * pickPin = PIN terminal bila tahap-B menuntutnya (PIN_REQUIRED). */
  const [pickA, setPickA] = useState<null | {
    username: string;
    password: string;
    deviceId: string;
    branches: NormBranch[];
    terminals: NormTerminal[];
  }>(null);
  const [pickBranch, setPickBranch] = useState('');
  const [pickTerminal, setPickTerminal] = useState('');
  const [pickPin, setPickPin] = useState('');
  const [pickPinNeeded, setPickPinNeeded] = useState(false);
  /** online = respons terminal-login SUDAH bawa sesi (single-stage) + payload
   * tersimpan; PIN = gerbang VERIFIKASI LOKAL (passesLocalWorkforcePin),
   * tanpa panggilan server kedua. online-refetch = defensif (kredensial-ok
   * tanpa materi sesi; refetch jujur TANPA staffPin). offline = grant valid,
   * PIN vs hash grant. Tak ada jalur legacy: unbound diblokir eksplisit di
   * langkah 1 (semua build termasuk DEV — login pertama wajib device
   * terikat + BE). */
  const [candidate, setCandidate] = useState<null | {
    kind: 'online';
    username: string;
    password: string;
    /** Materi sesi dari respons terminal-login pertama (single-stage). */
    payload: Record<string, unknown>;
  } | {
    kind: 'online-refetch';
    username: string;
    password: string;
  } | {
    kind: 'offline';
    username: string;
    userId: string;
  }>(null);
  /** Banner info pasca-terminal-login (mis. sesi lama ditendang di tempat lain). */
  const [notice, setNotice] = useState('');
  /** Layar blokir eksplisit (fail-closed): grant kedaluwarsa / belum diikat. */
  const [blocked, setBlocked] = useState<null | { kind: 'grant-expired' | 'unbound' }>(null);
  /** Takeover (SPEC §4/K1, jalur refetch defensif): terminal-login menang atas
   * sesi lama — user BARU wajib dikabari + konfirmasi sebelum sesi dibuat.
   * Jalur utama single-stage mengabari via notice kicked_msg (tanpa modal
   * blokir — server sudah merevoke sesi lama). */
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
  /** S4-APP-313: pembatalan user untuk fetch login. Tiap submit membuat
   * controller baru (submit lama yang masih hidup diabort — tak menimpa hasil
   * submit baru karena guard busy); unmount mengabort fetch yang tersisa.
   * Sinyal ini dihubungkan dengan timeout per-attempt di callStaffLogin:
   * timeout-abort → 1x retry → offline-path; user-abort → langsung
   * offline-path tanpa retry. Kontrak grant/PIN tak berubah. */
  const loginAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    try {
      loginAbortRef.current?.abort();
    } catch {
      /* abaikan */
    }
    loginAbortRef.current = null;
  }, []);
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
    // Fail-closed QR (temuan review Trek 1): pastikan ikatan SEBELUM sesi
    // dibuat — throw 'unbound' setelah loginEmployee meninggalkan sesi yatim
    // (isLoggedIn true tanpa ikatan hingga restart).
    const preCtx = await resolveTermCtx();
    if (!preCtx) throw new Error('unbound');
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
    // Dual-currency: segarkan cache currency dari profil merchant (fire-and-forget,
    // best-effort — login tak diblokir bila gagal; currency tak ada = fallback IDR).
    // PW-4/S3: sekalian segarkan cache timezone cabang (AUD = Australia/Perth).
    try { void syncCurrencyFromProfile().catch(() => {}); } catch { /* abaikan */ }
    try { void syncTimezoneFromProfile().catch(() => {}); } catch { /* abaikan */ }
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
   * Login B1 (SPEC §4/L1, single-stage — koreksi 2026-10-17): username +
   * password DULU, lalu MODAL PIN staff — berurutan, bukan 3 faktor sekaligus.
   * - Terikat + online: POST E01 terminal-login {username,password,
   *   terminalCode,deviceId} → LANGSUNG sesi penuh → modal PIN staff
   *   (VERIFIKASI LOKAL via passesLocalWorkforcePin — server tak pernah
   *   memverifikasi PIN staff) → saveSession + saveGrant.
   * - Terikat + offline/unconfigured: gate grant jujur (isGrantValid + PIN
   *   vs hash); tanpa grant valid → tolak (login pertama wajib online, Q6).
   *   grant kedaluwarsa → layar blokir grant_expired.
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
    // S4-APP-313: controller pembatalan milik submit ini — submit lama yang
    // masih hidup diabort; sinyal diteruskan ke callStaffLogin agar
    // timeout-abort dan user-abort memakai controller yang sama (balancing).
    try {
      loginAbortRef.current?.abort();
    } catch {
      /* abaikan */
    }
    const loginCtrl = new AbortController();
    loginAbortRef.current = loginCtrl;
    const loginSignal = loginCtrl.signal;
    // Race auto-skip (temuan review Trek 1): runStageB mengelola busy sendiri;
    // bila tahap-B diambil alih (handedOff), finally submit JANGAN nol-kan busy.
    let handedOff = false;
    void (async () => {
      try {
        // S2-C311: tunggu upaya seed selesai agar login tak baca DB setengah-seed
        // (fail-open: bila seed gagal/gantung, lanjut ke jalur error normal).
        try {
          await whenSeedReady(8000);
        } catch {
          /* fail-open: lanjut ke jalur error normal */
        }
        const uname = username.trim();
        // B1 prasyarat: device ter-bound (fail-closed) — KECUALI login-first
        // F1: device belum bound + online → tahap-A E01 (username+password+
        // deviceId, TANPA terminalCode) → picker cabang+terminal (pickA),
        // lalu tahap-B (submitPickA) menyelesaikan login di terminal pilihan.
        const ctx = await resolveTermCtx();
        if (!ctx) {
          if (getApiMode() === 'local') {
            // Tanpa server tak ada tahap-A dan tak ada triple grant → blokir.
            setServerError(unboundText());
            setBlocked({ kind: 'unbound' });
            return;
          }
          // S4-APP-313: batasi I/O deviceId (wedged = gantung, bukan reject);
          // '' = jalur error jujur di bawah (unbound/need_be), bukan hang.
          // + sinyal network-layer (retry slice): timeout-abort → 1x retry →
          // offline-path; user-abort → langsung offline-path tanpa retry.
          const devId = await withTimeout(getContractDeviceId(), 5000).catch(() => '');
          const stageA = await callStaffLogin(
            { username: uname, password, deviceId: devId },
            { signal: loginSignal },
          );
          if (stageA.reached && stageA.status >= 200 && stageA.status < 300 && str(stageA.body.stage) === 'pick-terminal') {
            const branches = normBranches(stageA.body.branches);
            const terminals = normTerminals(stageA.body.terminals);
            if (!branches.length || !terminals.length) {
              setServerError(needBeText());
              return;
            }
            const data = { username: uname, password, deviceId: devId, branches, terminals };
            const firstBranch = branches[0].id;
            // S2 desain F1: 1 cabang + 1 terminal → langsung tahap-B tanpa
            // menampilkan picker (state pickA tetap diisi untuk konsistensi).
            const scoped = normTerminals(terminals, firstBranch);
            setPickA(data);
            setPickBranch(firstBranch);
            setPickTerminal(scoped.length === 1 && branches.length === 1 ? scoped[0].id : '');
            setPickPin('');
            setPickPinNeeded(false);
            setServerError('');
            // F1 §2/§6 (temuan review Trek 1): password fase-1 di-nol-kan dari
            // form segera setelah disalin ke memori pickA (data). Retry tahap-B
            // memakai salinan memori, bukan form — form tak dibutuhkan lagi.
            setPassword('');
            if (branches.length === 1 && scoped.length === 1) {
              handedOff = true;
              runStageB(data, firstBranch, scoped[0], '');
              return;
            }
            return;
          }
          if (isExplicitReject(stageA)) {
            // Kredensial salah (401 INVALID_CREDENTIALS) — bukan offline.
            setServerError(t('login_fail'));
            return;
          }
          // Tak terjangkau / respons asing → fail-closed unbound (tanpa grant
          // offline: triple user-terminal-device belum ada di device ini).
          setServerError(stageA.reached ? unboundText() : needBeText());
          if (stageA.reached) setBlocked({ kind: 'unbound' });
          return;
        }
        const deviceId = ctx.deviceId || (await withTimeout(getContractDeviceId(), 5000).catch(() => ''));
        // B1 langkah 1 fase-1a (login staged): username+password dulu, TANPA
        // staffPin (server mengabaikan field tak dikenal). terminalCode
        // OPSIONAL — bound device resolve via fast-path server; terminalPin
        // ikut terkirim bila user sudah mengisinya (server meminta).
        const first = await callStaffLogin(
          {
            username: uname,
            password,
            deviceId,
            ...(ctx.terminalCode ? { terminalCode: ctx.terminalCode } : {}),
            ...(termPin.trim() ? { terminalPin: termPin.trim() } : {}),
          },
          { signal: loginSignal },
        );
        if (hasSessionMaterial(first)) {
          // Single-stage: sesi SUDAH ada di respons pertama — disimpan sebagai
          // kandidat, dikunci setelah gerbang PIN LOKAL (tanpa call kedua).
          const tookOver = first.body.tookOver as Record<string, unknown> | undefined;
          const kickedUserId = str(tookOver?.kickedUserId ?? first.body.kickedUserId);
          if (kickedUserId || first.body.wasKicked === true || first.body.kicked === true) {
            // K1: user BARU dikabari via kunci kicked_msg (tak ada frame
            // SESSION_KICKED push sisi server — kick = revoke grant +
            // takeover event ke device baru).
            setNotice(t('kicked_msg'));
          }
          setCandidate({ kind: 'online', username: uname, password, payload: first.body });
          setStaffPin('');
          setPinError('');
          setPinAttempts(0);
          setPinLockUntil(0);
          // Kredensial diterima → form password dibuang (higiene F1:
          // aliran PIN memakai candidate/payload, bukan form).
          setPassword('');
          setPinOpen(true);
          return;
        }
        if (isCredentialOnly(first)) {
          // Defensif (BE live tak mengirim ini): kredensial-ok tanpa materi
          // sesi — refetch jujur TANPA staffPin di langkah 2, PIN tetap lokal.
          setCandidate({ kind: 'online-refetch', username: uname, password });
          setStaffPin('');
          setPinError('');
          setPinAttempts(0);
          setPinLockUntil(0);
          // Form dibuang; refetch memakai salinan candidate (bukan form).
          setPassword('');
          setPinOpen(true);
          return;
        }
        if (isExplicitReject(first)) {
          // Server MENOLAK eksplisit (bukan offline): kredensial salah.
          setServerError(t('login_fail'));
          return;
        }
        if (first.reached && first.status === 409) {
          // Kapasitas per-tag / okupansi (TERMINAL_OCCUPIED /
          // TERMINAL_DEVICE_CONFLICT / TERMINAL_TAG_CONFLICT): 1 user = 1
          // kasir + 1 dapur + N view per cabang; full_access eksklusif.
          // Pesan server jujur apa adanya; pindah binding HANYA via claim
          // (install flow), bukan dari layar ini.
          const err409 = loginErrorOf(first);
          setServerError(err409.message || t('login_fail'));
          return;
        }
        {
          // Faktor 2 login staged: server meminta PIN terminal
          // (PIN_REQUIRED/INVALID/LOCKED, 401/423) — tampilkan kolom PIN di
          // bawah password; user isi lalu tekan Masuk lagi.
          const loginErr = loginErrorOf(first);
          if (
            first.reached &&
            (first.status === 401 || first.status === 423) &&
            (loginErr.code === 'PIN_REQUIRED' ||
              loginErr.code === 'PIN_INVALID' ||
              loginErr.code === 'PIN_LOCKED')
          ) {
            setNeedTermPin(true);
            setServerError(loginErr.message || t('login_fail'));
            return;
          }
        }
        // Offline/unconfigured: gate grant jujur — tanpa silent local login.
        // S4-APP-313: AKAR HANG — lookupLocalUserId = query expo-sqlite TANPA
        // timeout; SQLite wedged = promise tak pernah settle = "Verifying..."
        // selamanya (finally tak jalan). lookupLocalUserIdAfterSeed: tahan
        // selama seed berjalan (batas total 90 dtk), tiap query 15 dtk;
        // '' final → 'no-grant' → pesan need_be jujur. Outer catch di bawah
        // menjaring lemparan tak terduga menjadi need_be (bukan hang).
        const userId = await lookupLocalUserIdAfterSeed(uname);
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
        setPinAttempts(0);
        setPinLockUntil(0);
        setPinOpen(true);
        // JANGAN navigate manual ke Dashboard: GuardedStacks me-render ulang
        // bersyarat (tamu -> authed) dan stack authed mount dengan initial
        // Dashboard/Shift sendiri. Navigate sinkron di sini race melawan
        // setLoggedIn sehingga error "not handled by any navigator" di HP.
      } catch {
        // S4-APP-313: jaring pengaman — lemparan tak terduga (termasuk
        // 'login-timeout' dari withTimeout) = pesan need_be jujur + busy
        // dibersihkan finally, BUKAN unhandled rejection tanpa pesan.
        // i18n frozen: pakai kunci need_be yang sudah ada.
        setServerError(needBeText());
      } finally {
        if (!handedOff) setBusy(false);
      }
    })();
  };

  /** Tahap-B login-first (F1): E01 lagi DENGAN terminalCode (+merchantId
   * pilihan) memakai kredensial tahap-A — password tak diminta ulang. Inti
   * tahap-B diparameterisasi (runStageB) agar auto-skip 1-cabang+1-terminal
   * (S2) bisa memanggil jalur yang sama tanpa menunggu state picker.
   * Sukses → cerminkan binding lokal (server sudah bind, lokal belum) via
   * adoptTerminalBinding, lalu kandidat online seperti jalur utama (modal PIN
   * staff + E29). PIN terminal yang dituntut server (PIN_REQUIRED) diminta di
   * picker yang sama (pickPin), bukan form utama. Password tahap-A di-nol-kan
   * dari memori usai tahap-B (desain F1 §2/§6: hanya transit di memori). */
  const runStageB = (
    data: { username: string; password: string; deviceId: string; branches: NormBranch[] },
    branchId: string,
    term: NormTerminal,
    pin: string,
  ) => {
    setServerError('');
    setBusy(true);
    // S4-APP-313: tahap-B = submit tersendiri (dari picker) → controller
    // pembatalan sendiri, pola sama seperti submit utama.
    try {
      loginAbortRef.current?.abort();
    } catch {
      /* abaikan */
    }
    const stageBCtrl = new AbortController();
    loginAbortRef.current = stageBCtrl;
    const stageBSignal = stageBCtrl.signal;
    void (async () => {
      try {
        const merchantNum = Number(branchId);
        const second = await callStaffLogin(
          {
            username: data.username,
            password: data.password,
            deviceId: data.deviceId,
            terminalCode: term.code,
            ...(Number.isFinite(merchantNum) && merchantNum > 0 ? { merchantId: merchantNum } : {}),
            ...(pin.trim() ? { terminalPin: pin.trim() } : {}),
          },
          { signal: stageBSignal },
        );
        if (hasSessionMaterial(second)) {
          // Server sudah bind device+user ke terminal ini; cerminkan ke store
          // lokal (UNIFIKASI TULIS 3 store) agar fast-path + grant triple
          // berlaku di login berikut. adopt = logout-safe (belum ada sesi).
          try {
            const pTerm = (second.body.terminal ?? {}) as Record<string, unknown>;
            const pBranches = normBranches(second.body.branches);
            const bName =
              pBranches.find((b) => b.id === branchId)?.name ??
              data.branches.find((b) => b.id === branchId)?.name ??
              '';
            adoptTerminalBinding({
              terminalId: str(pTerm.terminalId) || term.id,
              terminalCode: str(pTerm.terminalCode) || term.code,
              branchId,
              branchName: bName,
              // Q1 (temuan review Trek 1): merchantName eksplisit = cermin
              // bName segar — jangan biarkan fallback adopt mewarisi prev
              // lintas-cabang. Pola sama seperti Install/TerminalPinScreen.
              merchantName: bName,
              // C2: tipe merchant dari body E01 (forward-compat; BE 2026-10-20
              // belum mengirim → '' → adopt pertahankan prev/default).
              merchantType: readMerchantTypeFromLoginBody(second.body) || undefined,
              tag: str(pTerm.tag) || term.tag,
              deviceId: data.deviceId,
            });
          } catch (e) {
            setServerError(e instanceof Error && e.message ? e.message : needBeText());
            return;
          }
          const tookOver = second.body.tookOver as Record<string, unknown> | undefined;
          const kickedUserId = str(tookOver?.kickedUserId ?? second.body.kickedUserId);
          if (kickedUserId || second.body.wasKicked === true || second.body.kicked === true) {
            setNotice(t('kicked_msg'));
          }
          setPickA(null);
          setPickPin('');
          setPickPinNeeded(false);
          // F1 §2/§6: password fase-1 hanya transit di memori — kandidat
          // 'online' TIDAK membawa password (jalur ini tak membaca
          // candidate.password; faktor 3 = modal PIN staff via E29).
          setCandidate({ kind: 'online', username: data.username, password: '', payload: second.body });
          setStaffPin('');
          setPinError('');
          setPinAttempts(0);
          setPinLockUntil(0);
          setPinOpen(true);
          return;
        }
        if (isExplicitReject(second)) {
          setServerError(t('login_fail'));
          return;
        }
        if (second.reached && second.status === 409) {
          const err409 = loginErrorOf(second);
          setServerError(err409.message || t('login_fail'));
          return;
        }
        {
          // Faktor 2 login staged di tahap-B: terminal pilihan ber-PIN →
          // minta PIN di picker yang sama, user tekan Lanjut lagi.
          const loginErr = loginErrorOf(second);
          if (
            second.reached &&
            (second.status === 401 || second.status === 423) &&
            (loginErr.code === 'PIN_REQUIRED' ||
              loginErr.code === 'PIN_INVALID' ||
              loginErr.code === 'PIN_LOCKED')
          ) {
            setPickPinNeeded(true);
            setPickPin('');
            setServerError(loginErr.message || t('login_fail'));
            return;
          }
        }
        setServerError(second.reached ? unboundText() : needBeText());
      } finally {
        setBusy(false);
      }
    })();
  };

  /** Lanjut dari picker (tombol Lanjut / onPress): validasi pilihan state
   * lalu panggil inti tahap-B yang sama dengan auto-skip (runStageB). */
  const submitPickA = () => {
    if (busy || !pickA) return;
    const branchId = pickBranch.trim();
    const term = pickA.terminals.find((x) => x.id === pickTerminal.trim());
    const termOk = term && (!term.merchantId || !branchId || term.merchantId === branchId);
    if (!branchId || !termOk || !term) {
      setServerError(t('pick_terminal_hint'));
      return;
    }
    runStageB(pickA, branchId, term, pickPin);
  };

  /** B1 langkah 3 fase-1a: PIN user/workforce diverifikasi SERVER via E29
   * (callPinVerify) DULU; gerbang lokal (passesLocalWorkforcePin) HANYA
   * fallback bila server bilang USER_PIN_NOT_SET (400, belum enroll →
   * enroll progresif) atau jaringan putus (offline honesty — grant sudah
   * lolos di langkah 1). USER_PIN_INVALID/LOCKED = server menang (tolak).
   * Sesi dikunci via completeOnline HANYA setelah salah satu gerbang lolos.
   * online (payload tahap-1 tersimpan) → E29 → completeOnline (sesi dari
   * respons terminal-login PERTAMA, tanpa call login kedua);
   * online-refetch (defensif) → ambil materi sesi TANPA staffPin → E29 →
   * gerbang lokal → completeOnline (takeover ditahan untuk modal konfirmasi);
   * offline → PIN vs hash grant. */
  const submitStaffPin = () => {
    if (pinBusy || !candidate) return;
    // Modal dikunci sementara setelah 5x PIN salah (throttle offline).
    if (Date.now() < pinLockUntil) {
      const secs = Math.max(1, Math.ceil((pinLockUntil - Date.now()) / 1000));
      setPinError(t('g_pin_offline_locked').split('{n}').join(String(secs)));
      return;
    }
    if (staffPin.trim().length < 4) {
      setPinError(t('login_pin_short'));
      return;
    }
    setPinError('');
    setPinBusy(true);
    // S4-APP-313: refetch defensif = submit tersendiri → controller sendiri.
    try {
      loginAbortRef.current?.abort();
    } catch {
      /* abaikan */
    }
    const pinCtrl = new AbortController();
    loginAbortRef.current = pinCtrl;
    const pinSignal = pinCtrl.signal;
    void (async () => {
      try {
        const pin = staffPin.trim();
        // GAP-14 owner-override (cek DULU, sebelum verdict normal): PIN owner
        // meloloskan login kandidat dengan attribution approvedBy di sesi.
        // Gagal override = lanjut jalur normal di bawah TANPA perubahan
        // perilaku (verdict tetap milik jalur normal). Dilewati untuk
        // online-refetch defensif (materi sesi belum ada — override di sana
        // tak punya payload untuk dikunci; jalur normal yang menangani).
        if (candidate.kind !== 'online-refetch') {
          const ov = await verifyOwnerOverridePin(
            pin,
            candidate.kind === 'online'
              ? str(candidate.payload.authToken ?? candidate.payload.token ?? candidate.payload.authKey)
              : undefined,
          );
          if (ov.ok && ov.approverUserId) {
            const approvedBy = `owner:${ov.approverUserId}`;
            if (candidate.kind === 'offline') {
              const oCtx = await resolveTermCtx();
              const oDev = oCtx?.deviceId || (await getContractDeviceId());
              const oTerm = (oCtx?.terminalId ?? '').trim();
              if (!oCtx || !oTerm || !oDev) {
                setPinError(needBeText());
                return;
              }
              // Override offline: expiry grant kandidat TETAP diperiksa
              // (paritas TOCTOU jalur normal), tapi PIN-vs-grant dilewati —
              // PIN owner ≠ hash grant kandidat; owner menjadi penjamin.
              const oRecheck = describeGrantProblem(candidate.userId, oTerm, oDev);
              if (oRecheck) {
                setPinError(oRecheck === 'grant-expired' ? grantExpiredText() : needBeText());
                return;
              }
              try {
                await completeOffline(candidate.userId, candidate.username, pin, approvedBy);
              } catch (e) {
                setPinError(e instanceof Error && e.message === 'unbound' ? needBeText() : grantExpiredText());
                return;
              }
              setPinAttempts(0);
              setPinLockUntil(0);
              setPinOpen(false);
              return;
            }
            const oCtx = await resolveTermCtx();
            if (!oCtx) {
              setPinError(needBeText());
              return;
            }
            const oDev = oCtx.deviceId || (await getContractDeviceId());
            const oUserId = str(candidate.payload.userId ?? candidate.payload.user_id);
            if (!oUserId) {
              setPinError(pinWrongText());
              return;
            }
            await completeOnline(
              candidate.payload, pin, oCtx, oDev, candidate.username,
              ov.pinVersion, approvedBy,
            );
            try { void flushPendingRevokes().catch(() => {}); } catch { /* abaikan */ }
            setPinOpen(false);
            return;
          }
        }
        if (candidate.kind === 'offline') {
          // L1 offline: PIN vs hash grant TRIPLE-spesifik (grant-map F1 —
          // grant terminal lain milik user yang sama tak boleh lolos).
          // completeOffline me-resolve binding sendiri; triple di sini
          // di-resolve sama agar verifikasi dan sesi konsisten.
          const offCtx = await resolveTermCtx();
          const offDevice = offCtx?.deviceId || (await getContractDeviceId());
          const offTerm = (offCtx?.terminalId ?? '').trim();
          if (!offCtx || !offTerm || !offDevice) {
            setPinError(needBeText());
            return;
          }
          // TOCTOU (temuan review Trek 1): grant bisa kedaluwarsa selagi modal
          // PIN terbuka — verifyGrantPin hanya hash-compare tanpa cek expiry.
          // Periksa ulang seperti jalur refetch sebelum completeOffline.
          const recheck = describeGrantProblem(candidate.userId, offTerm, offDevice);
          if (recheck) {
            setPinError(recheck === 'grant-expired' ? grantExpiredText() : needBeText());
            return;
          }
          if (!verifyGrantPin(pin, { userId: candidate.userId, terminalId: offTerm, deviceId: offDevice })) {
            // Throttle: 5x salah → kunci modal 60 dtk (anti brute-force).
            const n = pinAttempts + 1;
            if (n >= 5) {
              setPinLockUntil(Date.now() + 60_000);
              setPinAttempts(0);
              setPinError(t('g_pin_offline_locked').split('{n}').join('60'));
            } else {
              setPinAttempts(n);
              setPinError(pinWrongText());
            }
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
          setPinAttempts(0);
          setPinLockUntil(0);
          setPinOpen(false);
          return;
        }
        // B1 langkah 3 online fase-1a: E29 pin-verify server DULU (faktor PIN
        // user/workforce); gerbang lokal HANYA fallback NOT_SET/offline.
        const ctx = await resolveTermCtx();
        if (!ctx) {
          setPinError(needBeText());
          return;
        }
        const deviceId = ctx.deviceId || (await withTimeout(getContractDeviceId(), 5000).catch(() => ''));
        if (candidate.kind === 'online') {
          const userId = str(candidate.payload.userId ?? candidate.payload.user_id);
          if (!userId) {
            // Payload tanpa identitas = jangan buat sesi (fail-closed).
            setPinError(pinWrongText());
            return;
          }
          const termObj = (candidate.payload.terminal ?? {}) as Record<string, unknown>;
          const grantObj = (candidate.payload.grant ?? {}) as Record<string, unknown>;
          const verifyTermId = str(termObj.terminalId ?? grantObj.terminalId) || ctx.terminalId;
          // Teruskan JWT tahap-B dari payload ( pola completeOnline:490 ) —
          // sesi tersimpan belum ada di titik ini (adopt me-logout).
          const stageToken = str(candidate.payload.authToken ?? candidate.payload.token ?? candidate.payload.authKey);
          const pv = await callPinVerify(verifyTermId, pin, stageToken || undefined);
          if (pv.reached) {
            if (pv.status >= 200 && pv.status < 300) {
              // Server memverifikasi — langsung kunci sesi (tanpa gerbang lokal).
              // B: bandingkan versi grant vs server (sembuhkan, bukan blokir).
              noteGrantPinVersion(userId, verifyTermId, deviceId, pv.pinVersion);
              await completeOnline(candidate.payload, pin, ctx, deviceId, candidate.username, pv.pinVersion);
              // F14-flush: login ONLINE sukses = momen kirim utang revoke.
              try { void flushPendingRevokes().catch(() => {}); } catch { /* abaikan */ }
              setPinOpen(false);
              return;
            }
            if (!(pv.status === 400 && pv.errorCode === 'USER_PIN_NOT_SET')) {
              // USER_PIN_INVALID (401) / USER_PIN_LOCKED (423) / lainnya =
              // server menang — tampilkan pesan server jujur.
              setPinError(pv.serverMessage || pinWrongText());
              return;
            }
            // USER_PIN_NOT_SET → belum enroll: lanjut ke gerbang lokal di
            // bawah (enroll progresif via passesLocalWorkforcePin).
          }
          // E29 tak terjangkau → status enroll PIN di server TAK DIKETAHUI.
          // Gerbang lokal hanya bila record PIN lokal SUDAH ada (user kembali,
          // server pernah konfirmasi). Tanpa record → fail-closed need_be:
          // seed-if-absent di sini menerima PIN apa pun (= downgrade faktor
          // server; temuan review Trek 1). Enroll progresif tetap via
          // USER_PIN_NOT_SET yang dikonfirmasi server (pv.reached, di atas).
          if (!pv.reached) {
            let hasPinRecord = false;
            try {
              hasPinRecord = !!(await loadPinRecord(userId));
            } catch {
              hasPinRecord = false;
            }
            if (!hasPinRecord) {
              setPinError(needBeText());
              return;
            }
          }
          if (!(await passesLocalWorkforcePin(userId, pin))) {
            setPinError(pinWrongText());
            return;
          }
          await completeOnline(candidate.payload, pin, ctx, deviceId, candidate.username);
          // F14-flush: login ONLINE sukses = momen kirim utang revoke.
          try { void flushPendingRevokes().catch(() => {}); } catch { /* abaikan */ }
          setPinOpen(false);
          return;
        }
        // B1 langkah 2 defensif (online-refetch): ambil materi sesi TANPA
        // staffPin — mengirim staffPin akan menyiratkan verifikasi server
        // yang tak ada (server abaikan field tak dikenal). Payload SELALU
        // bawa terminalCode+deviceId.
        const second = await callStaffLogin(
          {
            username: candidate.username,
            password: candidate.password,
            terminalCode: ctx.terminalCode,
            deviceId,
          },
          { signal: pinSignal },
        );
        if (second.reached && second.status >= 200 && second.status < 300) {
          const p = second.body;
          const userId = str(p.userId ?? p.user_id);
          if (!userId) {
            // Respons sukses tanpa identitas = jangan buat sesi (fail-closed).
            setPinError(pinWrongText());
            return;
          }
          // E29 fase-1a: PIN user diverifikasi server DULU; gerbang lokal
          // HANYA fallback NOT_SET (enroll progresif) / offline.
          const rTermObj = (p.terminal ?? {}) as Record<string, unknown>;
          const rGrantObj = (p.grant ?? {}) as Record<string, unknown>;
          const rVerifyTermId = str(rTermObj.terminalId ?? rGrantObj.terminalId) || ctx.terminalId;
          const rpv = await callPinVerify(rVerifyTermId, pin);
          if (rpv.reached) {
            if (!(rpv.status >= 200 && rpv.status < 300)) {
              if (rpv.status === 400 && rpv.errorCode === 'USER_PIN_NOT_SET') {
                // Belum enroll → lanjut ke gerbang lokal di bawah.
              } else {
                // INVALID/LOCKED/lainnya = server menang.
                setPinError(rpv.serverMessage || pinWrongText());
                return;
              }
            }
          }
          if (!rpv.reached || (rpv.status === 400 && rpv.errorCode === 'USER_PIN_NOT_SET')) {
            // Fallback gerbang lokal: NOT_SET (enroll progresif) atau offline.
            if (!(await passesLocalWorkforcePin(userId, pin))) {
              setPinError(pinWrongText());
              return;
            }
          }
          const tookOver = p.tookOver as Record<string, unknown> | undefined;
          const kickedUserId = str(tookOver?.kickedUserId ?? p.kickedUserId);
          if (kickedUserId) {
            // K1: login baru menang — kabari + minta konfirmasi user baru
            // SEBELUM sesi dibuat (takeover_title/takeover_msg).
            setTakeover({ kickedUserId, payload: p, pin });
            return;
          }
          if (rpv.reached && rpv.status >= 200 && rpv.status < 300) {
            // B: bandingkan versi grant vs server (sembuhkan, bukan blokir).
            noteGrantPinVersion(userId, rVerifyTermId, deviceId, rpv.pinVersion);
          }
          await completeOnline(p, pin, ctx, deviceId, candidate.username, rpv.reached ? rpv.pinVersion : undefined);
          // F14-flush: login ONLINE sukses = momen kirim utang revoke.
          try { void flushPendingRevokes().catch(() => {}); } catch { /* abaikan */ }
          setPinOpen(false);
          return;
        }
        if (isExplicitReject(second)) {
          setPinError(pinWrongText());
          return;
        }
        // Sempat offline di tengah langkah 2: fallback grant jujur (triple-
        // spesifik, grant-map F1).
        const userId = await lookupLocalUserId(candidate.username);
        const problem = userId ? describeGrantProblem(userId, ctx.terminalId, deviceId) : 'no-grant';
        if (!problem && userId && verifyGrantPin(pin, { userId, terminalId: ctx.terminalId, deviceId })) {
          try {
            await completeOffline(userId, candidate.username, pin);
          } catch (e) {
            // completeOffline hanya melempar 'unbound' (tanpa ikatan).
            setPinError(e instanceof Error && e.message === 'unbound' ? needBeText() : grantExpiredText());
            return;
          }
          setPinAttempts(0);
          setPinLockUntil(0);
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

  // Kartu mode login: 'account' (username-atau-email + password + deviceId)
  // atau 'qr' (pairing QR instalasi, bila QR_LOGIN_VISIBLE).
  const card = (which: 'account' | 'qr') => {
    const on = mode === which;
    return (
      <TouchableOpacity
        key={which}
        style={[styles.card, on ? styles.cardOn : styles.cardOff]}
        onPress={() => { setMode(which); setError(false); setServerError(''); }}>
        <View style={[styles.iconBox, on ? styles.iconBoxOn : styles.iconBoxOff]}>
          <Image
            source={which === 'account' ? (on ? ICONS.userBlue : ICONS.userGray) : on ? ICONS.qrBlue : ICONS.qrGray}
            style={styles.iconImg}
            resizeMode="contain"
          />
        </View>
        {which === 'account' ? (
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
            <BackChevron color="#4A4A4A" />
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
        ) : pickA ? (
        /* BODY-A2/B1: stage 'pick-terminal' (F1 login-first) — server
         * mengembalikan cabar + terminal tempat user BOLEH login. Pilih
         * cabang lalu terminal, tekan Lanjut (submitPickA = tahap-B:
         * E01 lagi + terminalCode + merchantId + PIN terminal bila dituntut).
         * Kembali → setPickA(null), kembali ke form kredensial. */
        <View style={styles.form}>
          <Text style={styles.title}>{t('pick_terminal_title')}</Text>
          <Text style={[styles.sub, styles.pickHint]}>{t('pick_terminal_hint')}</Text>
          {serverError ? (
            <View style={styles.errorRow}>
              <Image source={ICONS.fail} style={styles.errorIcon} resizeMode="contain" />
              <Text style={styles.errorText}>{serverError}</Text>
            </View>
          ) : null}
          {pickA.branches.length > 1 ? (
            <>
              <Text style={[styles.label, styles.labelGap]}>
                {t('pick_branch_label')}<Text style={styles.star}>*</Text>
              </Text>
              <View style={styles.pickRow}>
                {pickA.branches.map((b) => (
                  <TouchableOpacity
                    key={b.id}
                    onPress={() => {
                      setPickBranch(b.id);
                      // Ganti cabang = reset pilihan terminal (anti stale —
                      // temuan review Trek 1: Lanjut enabled tapi selalu gagal).
                      setPickTerminal('');
                    }}
                    style={[styles.pickChip, pickBranch === b.id && styles.pickChipOn]}
                    hitSlop={8}>
                    <Text style={[styles.pickChipT, pickBranch === b.id && styles.pickChipTOn]}>
                      {b.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}
          <Text style={[styles.label, styles.labelGap]}>
            {t('pick_terminal_label')}<Text style={styles.star}>*</Text>
          </Text>
          {normTerminals(pickA.terminals, pickBranch).length === 0 ? (
            <Text style={styles.pickEmpty}>{t('pick_terminal_empty')}</Text>
          ) : (
            <View style={styles.pickRow}>
              {normTerminals(pickA.terminals, pickBranch).map((tm) => (
                <TouchableOpacity
                  key={tm.id}
                  onPress={() => setPickTerminal(tm.id)}
                  style={[styles.pickChip, pickTerminal === tm.id && styles.pickChipOn]}
                  hitSlop={8}>
                  <Text style={[styles.pickChipT, pickTerminal === tm.id && styles.pickChipTOn]}>
                    {tm.name || tm.code}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {pickPinNeeded ? (
            <>
              <Text style={[styles.label, styles.labelGap]}>
                {t('inst_term_pin_title')}<Text style={styles.star}>*</Text>
              </Text>
              <View style={styles.inputBox}>
                <TextInput
                  style={styles.input}
                  value={pickPin}
                  onChangeText={(v) => { setPickPin(v); setServerError(''); }}
                  placeholder={t('inst_term_pin_ph')}
                  placeholderTextColor={INPUT_BORDER}
                  secureTextEntry
                  keyboardType="number-pad"
                />
              </View>
            </>
          ) : null}
          <View style={styles.spacer} />
          <AppButton
            size="md"
            title={t('pick_terminal_continue')}
            onPress={submitPickA}
            disabled={busy || !pickTerminal.trim()}
            style={[styles.primary, (busy || !pickTerminal.trim()) && styles.primaryIdle]}
            textStyle={styles.primaryT}
          />
          <TouchableOpacity onPress={() => { setPickA(null); setPassword(''); setServerError(''); }} hitSlop={12} style={styles.pinCancel}>
            <Text style={styles.pinCancelT}>{t('c_back')}</Text>
          </TouchableOpacity>
        </View>
        ) : (<>
        <View style={styles.cards}>
          {card('account')}
          {QR_LOGIN_VISIBLE && card('qr')}
        </View>

        {(mode === 'account' || !QR_LOGIN_VISIBLE) ? (
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

            {needTermPin ? (
              <>
                <Text style={[styles.label, styles.labelGap]}>
                  {t('inst_term_pin_title')}<Text style={styles.star}>*</Text>
                </Text>
                <View style={[styles.inputBox, (error || serverError) && styles.inputBoxError]}>
                  <Image
                    source={ICONS.password}
                    style={[styles.fieldIcon, (error || serverError) && { tintColor: RED }]}
                    resizeMode="contain"
                  />
                  <TextInput
                    style={styles.input}
                    value={termPin}
                    onChangeText={(v) => { setTermPin(v); setError(false); setServerError(''); }}
                    placeholder={t('inst_term_pin_ph')}
                    placeholderTextColor={INPUT_BORDER}
                    secureTextEntry
                    keyboardType="numeric"
                  />
                </View>
              </>
            ) : null}

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
      {QR_LOGIN_VISIBLE && <Text style={styles.infoItem}>{t('login_info_qr')}</Text>}
      <Text style={styles.infoHelp}>{t('login_info_help')}</Text>
    </View>
  );

  /**
   * Modal PIN staff pasca-kredensial (B1/L1): muncul SETELAH username+password
   * lolos langkah 1 — berurutan, bukan 3 faktor sekaligus. KOREKSI 2026-10-17:
   * ini GERBANG VERIFIKASI LOKAL (passesLocalWorkforcePin vs workforce-PIN
   * record lib/pin — seed-sekali saat login pertama, wajib cocok sesudahnya)
   * — server TAK PERNAH memverifikasi PIN staff (staffPin bukan bagian
   * kontrak terminal-login; E02 validate-pin = PIN terminal untuk binding).
   * Label ke user memakai kunci kontrak yang SUDAH ADA
   * (login_pin_title/login_pin_hint/login_pin_for — "PIN Staff", jujur tanpa
   * klaim verifikasi server; i18n.ts beku — tanpa kunci baru). PIN staff ≠
   * PIN terminal (binding) ≠ PIN owner (eskalasi).
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
            {t('login_pin_owner_hint') !== 'login_pin_owner_hint' ? (
              <Text style={styles.pinSub}>{t('login_pin_owner_hint')}</Text>
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
   * Modal takeover (SPEC §4/K1, jalur refetch defensif): server me-revoke sesi
   * lama di terminal ini dan terminal-login mengembalikan
   * tookOver{kickedUserId} — user BARU wajib dikonfirmasi
   * (takeover_title/takeover_msg) SEBELUM sesi dibuat. Jalur utama
   * single-stage mengabari via notice kicked_msg (server sudah merevoke —
   * tanpa konfirmasi pra-sesi). Batal = tetap di modal PIN (tanpa sesi,
   * tanpa bypass).
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
                    const deviceId = ctx.deviceId || (await withTimeout(getContractDeviceId(), 5000).catch(() => ''));
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
  pickHint: { marginBottom: 4 },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  pickChip: {
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFFFFF',
  },
  pickChipOn: { backgroundColor: BLUE_PALE, borderColor: BLUE },
  pickChipT: { fontSize: 14, fontFamily: fonts.regular, color: TITLE_DARK },
  pickChipTOn: { fontFamily: fonts.bold, color: BLUE },
  pickEmpty: { fontFamily: fonts.regular, fontSize: 13, color: GREY, marginTop: 4 },
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
