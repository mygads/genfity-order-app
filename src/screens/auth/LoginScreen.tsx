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
import { loginEmployee } from '../../session';
import { startRealtime } from '../../lib/realtime';
import { setWsForeground } from '../../native/printer';
import { loginByQrCode, parseQrLoginPayload, validateEmployee, type EmployeeSession } from '../../lib/apiSource';
import { ensureSeeded } from '../../lib/seed';
import { trimTestUsers } from '../../lib/seedUsers';
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
   * cocokkan/seed hash lokal, kunci sesi, nyalakan realtime. Tanpa navigate
   * manual - GuardedStacks mount stack authed (Dashboard/Shift) sendiri.
   */
  const completeLogin = async (s: EmployeeSession, uname: string, pin: string) => {
    try {
      const rec = await loadPinRecord(s.userId);
      if (!rec || !verifyPinHash(pin, rec)) {
        await savePinHash(s.userId, pin);
      }
    } catch {
      /* hash lokal opsional - server tetap sumber benar */
    }
    loginEmployee({ nama: s.nama, username: uname, role: s.role, userId: s.userId });
    // Realtime global nyala sekali saat login (sebelumnya hanya nyala bila
    // pengguna membuka layar Dapur/ESB/Display). Foreground service
    // best-effort di dev-client/APK agar WS hidup saat layar mati.
    try { startRealtime(); } catch { /* abaikan */ }
    try { void setWsForeground(true); } catch { /* abaikan */ }
  };

  /**
   * Login T1: username/PIN direvalidasi ke server via validateEmployee
   * (kontrak esb/employee/validate; offline jalan via dummy apiSource).
   * Lolos server lalu cocokkan/seed hash lokal via pin.ts (PIN plaintext
   * hanya di memori, tidak pernah disimpan), baru kunci sesi.
   * Kredensial ditolak (E401) tampilkan error + tawarkan klaim ulang terminal.
   * Gate panjang lokal dipertahankan untuk kompatibilitas perilaku lama.
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
    setBusy(true);
    void (async () => {
      try {
        // Sembuh-di-titik-butuh: bila seed saat起動 gagal/terlewat (instalasi
        // lama, storage dibersihkan), pastikan admin lokal ada TEPAT sebelum
        // validasi. Idempoten — PIN yang sudah diganti tidak ditimpa.
        try { await ensureSeeded(); } catch { /* validasi yang memutuskan */ }
        // Tegakkan "2 user saja": buang u-owner hasil seed (seed.ts milik
        // lane lain, tak disentuh) SEBELUM validasi agar tak bisa dipakai login.
        try { await trimTestUsers(); } catch { /* validasi yang memutuskan */ }
        const s = await validateEmployee(username.trim(), password);
        if (!s.ok || !s.userId) {
          // DB lokal kosong total = seed gagal total di perangkat ini. Jangan
          // tuduh "PIN salah" — beri tahu solusi sebenarnya (literal ID/EN,
          // bukan kunci i18n baru, sesuai aturan lane beku).
          let empty = false;
          try {
            const c = await queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM ms_posuser');
            empty = (c?.n ?? 0) === 0;
          } catch { empty = false; }
          if (empty) {
            setServerError(lang === 'id'
              ? 'Tidak ada user lokal di perangkat ini. Tutup total aplikasinya lalu buka lagi. Bila memakai APK lama, install ulang versi terbaru.'
              : 'No local users on this device. Fully close and reopen the app. If using an old APK, reinstall the latest version.');
            return;
          }
          setServerError(t('login_fail'));
          return;
        }
        await completeLogin(s, username.trim(), password);
        // JANGAN navigate manual ke Dashboard: GuardedStacks me-render ulang
        // bersyarat (tamu -> authed) dan stack authed mount dengan initial
        // Dashboard/Shift sendiri. Navigate sinkron di sini race melawan
        // setLoggedIn sehingga error "not handled by any navigator" di HP.
      } finally {
        setBusy(false);
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
        await completeLogin(s, payload.username, payload.pin);
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
                onPress={() => navigation?.navigate('Install')}>
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
});
