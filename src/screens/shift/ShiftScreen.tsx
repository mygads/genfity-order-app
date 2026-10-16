import React, { useEffect, useRef, useState } from 'react';import {
  Image, Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, rpNum, wideCenter } from '../../theme';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { useLang } from '../../lib/i18n';import { getTerminal } from '../../config/server';import { getSession } from '../../session';import { initDb, queryFirst, run } from '../../lib/db';import { enqueueOutbox, enqueueSync } from '../../lib/sync';import { authorizeSupervisor } from '../../lib/supervisor';import { verifyAttendancePin } from '../../lib/pin';type Props = { navigation?: any };const QUICK_NOMINAL = [50000, 100000, 200000, 500000, 1000000];const terbilang = (n: number): string => {
  if (n <= 0) return 'Nol rupiah';
  const kata = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  const sebut = (x: number): string => {
    if (x < 12) return kata[x];
    if (x < 20) return `${sebut(x - 10)} belas`;
    if (x < 100) return `${sebut(Math.floor(x / 10))} puluh ${sebut(x % 100)}`.trim();
    if (x < 200) return `seratus ${sebut(x - 100)}`.trim();
    if (x < 1000) return `${sebut(Math.floor(x / 100))} ratus ${sebut(x % 100)}`.trim();
    if (x < 2000) return `seribu ${sebut(x - 1000)}`.trim();
    if (x < 1000000) return `${sebut(Math.floor(x / 1000))} ribu ${sebut(x % 1000)}`.trim();
    if (x < 1000000000) return `${sebut(Math.floor(x / 1000000))} juta ${sebut(x % 1000000)}`.trim();
    return `${sebut(Math.floor(x / 1000000000))} miliar ${sebut(x % 1000000000)}`.trim();
  };
  return `${sebut(n).replace(/\s+/g, ' ').trim()} rupiah`;};/** Batas kas awal sesuai hint chip di bawah. */
const MAX_KAS_AWAL = 10000000;
/** Format ISO ke "14 Okt 2026 · 08:00" ala kartu shift. */const fmtShift = (iso: string | null): string => { if (!iso) return '-'; const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso; const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }); const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':'); return `${tgl} · ${jam}`;};interface LastShift { status: string; cashier: string; opened: string | null; closed: string | null;}/** Buka kasir/shift: kas awal + PIN, tercatat ke tr_shiftlog dan antrean sync. */export default function ShiftScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [kasAwal, setKasAwal] = useState('');
  const [catatan, setCatatan] = useState('');
  const [pin, setPin] = useState('');
  const [pinVisible, setPinVisible] = useState(false);
  const [error, setError] = useState('');
  const openingRef = useRef(false); // cegah ketuk ganda tombol OK selama verifikasi async berjalan

  const [lastShift, setLastShift] = useState<LastShift | null>(null);
  // Shift terakhir dari SQLite (tr_shiftlog), bukan hardcoded.
  useEffect(() => { let on = true; (async () => { try { await initDb(); const row = await queryFirst<{ status: string | null; userId: string | null; cashierName: string | null; clockIn: string | null; clockOut: string | null; }>('SELECT status, userId, cashierName, clockIn, clockOut FROM tr_shiftlog ORDER BY clockIn DESC LIMIT 1'); if (on && row) { setLastShift({ status: row.status === 'open' ? t('dash_shift_open') : t('dash_shift_closed'), cashier: row.cashierName || row.userId || 'Kasir Utama', opened: row.clockIn, closed: row.clockOut, }); } } catch { /* DB belum siap - kartu menampilkan status kosong */ } })(); return () => { on = false; }; }, []); const kasAwalNum = Number(kasAwal.replace(/\D/g, '')) || 0;

  const openPin = () => {
    if (kasAwalNum <= 0) {
      setError('Masukkan Kas Awal terlebih dahulu');
      return;
    }
    setError('');
    setPin('');
    setPinVisible(true);
  };

  const confirmOpen = async () => {
    if (openingRef.current) return;
    // FIX2-4a: authorizeSupervisor butuh tepat 6 digit (titik PIN dan pad sudah 6);
    // guard disamakan agar pesan jujur.
    if (pin.length < 6) {
      setError('Masukkan PIN (6 digit)');
      return;
    }
    openingRef.current = true;
    setError('');
    try {
      await initDb();
      // (1) Cegah shift-ganda: tolak bila masih ada shift berstatus open, JANGAN insert.
      const openShift = await queryFirst<{ id: string }>(
        'SELECT id FROM tr_shiftlog WHERE status = ? LIMIT 1',
        ['open'],
      );
      if (openShift) {
        setError(t('shf_double_open'));
        return;
      }
      // (2) Verifikasi PIN ke server saat online (pola ApiPath.supervisorApprove
      // di lib/supervisor.ts). authorizeSupervisor mengembalikan code
      // 'offline'/'unconfigured' bila server tak terjangkau - hanya saat itu
      // kami izinkan PIN lokal agar kasir tetap jalan offline.
      const auth = await authorizeSupervisor(pin);
      if (!auth.ok && auth.code !== 'offline' && auth.code !== 'unconfigured') {
        setError(auth.message);
        return;
      }
      if (!auth.ok) {
        // Offline jujur: server tak terjangkau, cocokkan PIN lokal (lib/pin.ts).
        const local = await verifyAttendancePin(pin);
        if (local.ok !== true) {
          setError(
            local.ok === false ? t('shf_pin_wrong') : t('shf_pin_offline_unknown'),
          );
          return;
        }
      }
      // Catat buka shift ke SQLite + antrean sync (offline-first).
      const nowIso = new Date().toISOString();
      const shiftId = `shift-${Date.now()}`;
      const term = getTerminal();
      const nm = getSession()?.name ?? 'Kasir';
      try {
        await run(
          `INSERT INTO tr_shiftlog (id, branchId, terminalId, userId, shiftName, clockIn, clockOut, cashInDrawer, totalSales, status, syncDate) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 'open', NULL)`,
          [shiftId, term.branchId || null, term.terminalCode || null, nm, 'Shift', nowIso, kasAwalNum],
        );
        // Buka shift tercatat ke outbox agar ikut push berikutnya (parity EndShift).
        try {
          await enqueueOutbox('tr_shiftlog', shiftId, 'insert');
        } catch {
          /* abaikan - antrean sync ringan di bawah tetap jalan */
        }
      } catch {
        // Tulis lokal gagal (mis. DB terkunci) - tetap lanjut: server menjadi
        // sumber akhir lewat antrean sync di bawah.
      }
      // Offline jujur: op shift-open selalu diantrekan agar terkirim saat online
      // kembali; kasir dibuka lokal tanpa menunggu server.
      enqueueSync('other', {
        op: 'shift-open',
        shiftId,
        cashInDrawer: kasAwalNum,
        note: catatan.trim() || null,
        at: nowIso,
      });
    } catch {
      setError(t('shf_open_failed'));
      return;
    } finally {
      openingRef.current = false;
    }
    setPinVisible(false);
    setPin('');
    navigation?.navigate?.('Cashier');
  };

  const pressPinKey = (d: string) => {
    if (pin.length >= 6) return;
    setPin(pin + d);
  };

  return (
    <View style={s.root}>
      <ScreenHeader title={t('shf_open_title')} onBack={() => navigation?.goBack?.()} right={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}> <Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
        </TouchableOpacity>
        } />


      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.card}>
          <Text style={s.cardTitle}>{t('shf_last')}</Text>
          <View style={s.shiftRow}>
            <Text style={s.shiftLabel}>{t('c_status')}</Text>
            <Text style={s.shiftValue}>{lastShift ? lastShift.status : t('shf_no_history')}</Text>
          </View>
          <View style={s.shiftRow}>
            <Text style={s.shiftLabel}>{t('c_cashier')}</Text>
            <Text style={s.shiftValue}>{lastShift ? lastShift.cashier : '-'}</Text>
          </View>
          <View style={s.shiftRow}>
            <Text style={s.shiftLabel}>Waktu Buka</Text>
            <Text style={s.shiftValue}>{lastShift ? fmtShift(lastShift.opened) : '-'}</Text>
          </View>
          <View style={s.shiftRow}>
            <Text style={s.shiftLabel}>Waktu Tutup</Text>
            <Text style={s.shiftValue}>{lastShift ? fmtShift(lastShift.closed) : '-'}</Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('shf_cash_open')}</Text>
          <Text style={s.hint}>{t('shf_cash_hint')}</Text>
          <AppInput
            keyboardType="number-pad"
            placeholder="0"
            textAlign="right"
            value={kasAwalNum ? rpNum(kasAwalNum) : '0'}
            onChangeText={(tx) => setKasAwal(tx.replace(/\D/g, ''))}
            boxStyle={{ borderColor: colors.orange, backgroundColor: colors.paleOrange }}
            style={{ textAlign: 'right', fontFamily: fonts.bold, fontSize: 24 }}
          />
          <Text style={s.rpPreview}>{kasAwalNum > 0 ? terbilang(kasAwalNum) : 'Nol rupiah - masukkan nominal kas awal'}</Text>
          <Text style={s.chipHint}>Ketuk nominal untuk menambah ke Kas Awal · maks. {rp(MAX_KAS_AWAL)}</Text>
          <View style={s.chips}>
            {QUICK_NOMINAL.map((n) => (
              <TouchableOpacity
                key={n}
                style={[s.chip, kasAwalNum === n && s.chipActive]}
                onPress={() => setKasAwal(String(Math.min(kasAwalNum + n, MAX_KAS_AWAL)))}>
                <Text style={[s.chipTxt, kasAwalNum === n && s.chipTxtActive]}>
                  +{rpNum(n)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('shf_note_open')}</Text>
          <AppInput
            placeholder={t('c_note_opt')}
            multiline
            value={catatan}
            onChangeText={setCatatan}
            boxStyle={{ height: 'auto', minHeight: 70, alignItems: 'flex-start' }}
            style={{ textAlignVertical: 'top' }}
          />
        </View>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorTxt}>{error}</Text>
          </View>
        ) : null}
        <TouchableOpacity onPress={() => navigation?.navigate?.('Attendance')}>
          <Text style={s.link}>Belum absen? Catat kehadiran dulu → Absensi</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={s.footer}>
        <AppButton
          title={kasAwalNum > 0 ? `${t('shf_open_btn')} · ${rp(kasAwalNum)}` : t('shf_fill_cash')}
          disabled={kasAwalNum <= 0}
          style={{ marginTop: 0 }}
          onPress={openPin}
        />
      </View>

      <Modal visible={pinVisible} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{t('shf_pin_title')}</Text>
            <Text style={s.modalHint}>PIN kasir untuk membuka shift</Text>
            <View style={s.pinDots}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[s.dot, i < pin.length && s.dotFill]} />
              ))}
            </View>
            {error ? <Text style={s.errorTxt}>{error}</Text> : null}
            <View style={s.pinPad}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map(
                (k) => (
                  <TouchableOpacity
                    key={k}
                    style={s.pinKey}
                    onPress={() => {
                      if (k === 'C') setPin(pin.slice(0, -1));
                      else if (k === 'OK') confirmOpen();
                      else pressPinKey(k);
                    }}>
                    <Text style={s.pinKeyTxt}>{k === 'C' ? '⌫' : k}</Text>
                  </TouchableOpacity>
                ),
              )}
            </View>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => {
                setPinVisible(false);
                setPin('');
              }}>
              <Text style={s.cancelTxt}>{t('cm_cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={(r) => { navigation?.navigate?.(r); }} /> </View>
  );}const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  burger: {
     width: 22, height: 22 },

  body: { padding: 16, paddingBottom: 24 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: colors.faint, marginTop: 2 },
  shiftRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  shiftLabel: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  shiftValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.orange,
    borderRadius: 10,
    paddingHorizontal: 14,
    marginTop: 12,
    backgroundColor: colors.paleOrange,
  },
  rpPrefix: { fontSize: 18, fontFamily: fonts.bold, color: colors.orange },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 24,
    fontFamily: fonts.bold,
    color: colors.text,
    paddingVertical: 12,
    marginLeft: 8,
    textAlign: 'right',
  },
  rpPreview: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.muted,
    textAlign: 'right',
    marginTop: 4,
  },
  chipHint: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.muted,
    marginTop: 6,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: colors.white,
  },
  chipActive: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  chipTxtActive: { color: colors.orange },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  errorBox: {
    backgroundColor: colors.paleRed,
    borderRadius: 8,
    padding: 12,
  },
  errorTxt: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.red,
    textAlign: 'center',
    marginTop: 4,
  },
  footer: {
    backgroundColor: colors.white,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  openBtn: {
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  openBtnDisabled: { opacity: 0.55 },
  openBtnTxt: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
  modalHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.faint,
    marginTop: 4,
  },
  pinDots: { flexDirection: 'row', marginVertical: 18 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.navy,
    marginHorizontal: 6,
  },
  dotFill: { backgroundColor: colors.navy },
  pinPad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  pinKey: {
    width: 72,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 5,
  },
  pinKeyTxt: { fontSize: 20, fontFamily: fonts.bold, color: colors.navy },
  cancelBtn: { marginTop: 12, padding: 10 },
  cancelTxt: { fontSize: 14, fontFamily: fonts.medium, color: colors.red },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark, marginTop: 12, textAlign: 'center' },});