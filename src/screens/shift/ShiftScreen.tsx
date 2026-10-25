import React, { useEffect, useRef, useState } from 'react';import {
  Image, Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, numGrouping, rp, wideCenterLg } from '../../theme';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { useLang } from '../../lib/i18n';import { getBranchId, getTerminal } from '../../config/server';import { getSession } from '../../session';import { initDb, query, queryFirst, run } from '../../lib/db';import { enqueueOutbox, enqueueSync, noteServerContact } from '../../lib/sync';import {
  cashApproveBe,
  cashApprovePayload,
  cashOpenBe,
  cashOpenPayload,
  clockInBe,
  clockInPayload,
  getPendingReviewSid,
  shouldQueueW1,
} from '../../lib/beWorkforce';import { notifyShiftChanged } from '../../lib/shiftGuard';import { authorizeSupervisor } from '../../lib/supervisor';import { verifyAttendancePin } from '../../lib/pin';import { getCachedTimezone } from '../../lib/timezone';import { getWorkforceGates } from '../../lib/posConfigSync';type Props = { navigation?: any };const QUICK_NOMINAL = [50000, 100000, 200000, 500000, 1000000];const terbilang = (n: number): string => {
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
/** Format ISO ke "14 Okt 2026 · 08:00" ala kartu shift — sadar-bahasa (id/en)
 * + sadar-zona-merchant (PW-4/S3; dulu id-ID-only + jam perangkat). */const fmtShift = (iso: string | null, lang: 'id' | 'en' = 'id', timeZone?: string): string => { if (!iso) return '-'; const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso; const locale = lang === 'id' ? 'id-ID' : 'en-AU'; const tz = (timeZone ?? '').trim() || getCachedTimezone(); let tgl: string; let jam: string; try { tgl = d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }); jam = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }).replace(/\./g, ':'); } catch { tgl = d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }); jam = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':'); } return `${tgl} · ${jam}`;};interface LastShift { status: string; cashier: string; opened: string | null; closed: string | null;}/** Buka kasir/shift: kas awal + PIN, tercatat ke tr_shiftlog dan antrean sync. */export default function ShiftScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t, lang } = useLang(); const [drawerOpen, setDrawerOpen] = useState(false); const [kasAwal, setKasAwal] = useState('');
  const [catatan, setCatatan] = useState('');
  const [pin, setPin] = useState('');
  const [pinVisible, setPinVisible] = useState(false);
  const [error, setError] = useState('');
  const openingRef = useRef(false); // cegah ketuk ganda tombol OK selama verifikasi async berjalan

  const [lastShift, setLastShift] = useState<LastShift | null>(null);
  // Sesi kas menunggu review manager kedua (diset EndShiftScreen saat tutup
  // menjawab pendingManagerReview; dibersihkan saat approve sukses/replay).
  // S-F6: gerbang workforce server (absen = OFF).
  const [wfGates, setWfGates] = useState({ requirePinForPos: false, requireCashRegisterForPos: false });
  const [pendingSid, setPendingSid] = useState<string | null>(null);
  const [approveNote, setApproveNote] = useState('');
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveMsg, setApproveMsg] = useState('');
  // Shift terakhir dari SQLite (tr_shiftlog), bukan hardcoded.
  useEffect(() => { let on = true; (async () => { try { await initDb(); const row = await queryFirst<{ status: string | null; userId: string | null; cashierName: string | null; clockIn: string | null; clockOut: string | null; }>('SELECT status, userId, cashierName, clockIn, clockOut FROM tr_shiftlog WHERE status IN (\'open\', \'closed\') AND (branchId = ? OR branchId IS NULL OR branchId = \'\') ORDER BY clockIn DESC LIMIT 1', [getBranchId()]); if (on && row) { setLastShift({ status: row.status === 'open' ? t('dash_shift_open') : t('dash_shift_closed'), cashier: row.cashierName || row.userId || '-', opened: row.clockIn, closed: row.clockOut, }); } } catch { /* DB belum siap - kartu menampilkan status kosong */ } })(); return () => { on = false; }; }, []); const kasAwalNum = Number(kasAwal.replace(/\D/g, '')) || 0;
  // Muat sid menunggu-review tiap mount (persist di storage).
  useEffect(() => { let on = true; (async () => { try { const sid = await getPendingReviewSid(); if (on) setPendingSid(sid); } catch { /* abaikan */ } })(); return () => { on = false; }; }, []);
  // S-F6: muat gerbang workforce sekali saat layar dibuka (cache gagal = OFF).
  useEffect(() => { let on = true; (async () => { try { const g = await getWorkforceGates(); if (on) setWfGates({ requirePinForPos: g.requirePinForPos, requireCashRegisterForPos: g.requireCashRegisterForPos }); } catch { /* abaikan: OFF */ } })(); return () => { on = false; }; }, []);

  const submitApprove = async () => {
    if (!pendingSid || approveBusy) return;
    const note = approveNote.trim();
    if (!note) {
      setApproveMsg(t('appr_need_note'));
      return;
    }
    setApproveBusy(true);
    setApproveMsg('');
    // Immediate-first cermin clock-in/cash-open; offline/5xx/429 = antrekan
    // op be-cash-approve (drain mem-POST note + REVIEW_NOT_PENDING = replay).
    // 403 (penutup approve sendiri) = error jujur, tak diantre.
    try {
      const r = await cashApproveBe(pendingSid, note);
      if (r.ok) {
        try { noteServerContact(); } catch { /* abaikan */ }
        setPendingSid(null);
        setApproveNote('');
        setApproveMsg(t('appr_ok'));
      } else if (shouldQueueW1(r)) {
        try {
          enqueueSync('other', cashApprovePayload(pendingSid, note));
          setApproveMsg(t('appr_queued'));
        } catch {
          setApproveMsg(r.message || t('appr_failed'));
        }
      } else {
        setApproveMsg(r.message || t('appr_failed'));
      }
    } catch {
      setApproveMsg(t('appr_failed'));
    } finally {
      setApproveBusy(false);
    }
  };

  const openPin = () => {
    if (kasAwalNum <= 0) {
      setError(t('shf_err_cash'));
      return;
    }
    setError('');
    setPin('');
    setPinVisible(true);
  };

  const confirmOpen = async () => {
    if (openingRef.current) return;
    // Tanpa gerbang panjang-PIN lokal (cermin EndShiftScreen): PIN seed uji
    // 4 digit (1111/2222/1234) harus lolos ke authorizeSupervisor +
    // verifyAttendancePin; hanya PIN kosong yang ditolak di sini.
    if (!pin.replace(/\D/g, '')) {
      setError(t('shf_err_pin'));
      return;
    }
    openingRef.current = true;
    setError('');
    // APP-SHIFT 2026-10-17: jalur PIN staff dinyatakan CLEAR - server dulu,
    // fallback PIN lokal mana pun yang dikenal (tanpa gerbang owner, tanpa
    // gerbang panjang-PIN); openerUserId mengikat shift ke pemilik PIN offline.
    let openerUserId: string | null = null;
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
        if (local.ok !== true || !local.userId) {
          setError(
            local.ok === false ? t('shf_pin_wrong') : t('shf_pin_offline_unknown'),
          );
          return;
        }
        openerUserId = local.userId;
      }
      // Catat buka shift ke SQLite + antrean sync (offline-first).
      const nowIso = new Date().toISOString();
      const shiftId = `shift-${Date.now()}`;
      const term = getTerminal();
      // Kolom userId WAJIB id user nyata (dipakai rekap/hak/eskalasi), BUKAN
      // nama tampilan; cashierName menyimpan nama untuk struk/rekap.
      // APP-SHIFT: offline ikat ke pemilik PIN (cermin anti-titip Attendance);
      // online ikut sesi (server tak mengembalikan userId).
      const sess = getSession();
      const shiftUserId = openerUserId || sess?.userId || sess?.username || '';
      const shiftCashier = sess?.name || sess?.username || '';
      // S9 (PP-010): GERBANG ABSENSI buka-shift — pembuka WAJIB punya baris
      // 'absen' hari-ini-lokal (paritas gerbang tutup di EndShiftScreen).
      // Lokal SQLite sehingga berlaku offline; DB tak terbaca = fail-closed
      // (jatuh ke shf_open_failed di catch). Pesan = tautan ke Absensi.
      const attRows = await query<{ clockIn: string | null }>(
        `SELECT clockIn FROM tr_shiftlog WHERE status = 'absen' AND userId = ? ORDER BY clockIn DESC LIMIT 3`,
        [shiftUserId],
      );
      const todayD = new Date();
      const clockedToday = attRows.some((r) => {
        try {
          const d = new Date(String(r.clockIn));
          return d.getFullYear() === todayD.getFullYear() && d.getMonth() === todayD.getMonth() && d.getDate() === todayD.getDate();
        } catch {
          return false;
        }
      });
      if (!clockedToday) {
        setError(t('shf_att_link'));
        return;
      }
      try {
        await run(
          `INSERT INTO tr_shiftlog (id, branchId, terminalId, userId, cashierName, shiftName, clockIn, clockOut, cashInDrawer, totalSales, status, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 'open', NULL)`,
          [shiftId, term.branchId || null, term.terminalCode || null, shiftUserId, shiftCashier, 'Shift', nowIso, kasAwalNum],
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
      // kembali; kasir dibuka lokal tanpa menunggu server. openedBy mengikat
      // payload ke userId pembuka (paritas closedBy di EndShiftScreen).
      enqueueSync('other', {
        op: 'shift-open',
        shiftId,
        openedBy: shiftUserId || null,
        cashInDrawer: kasAwalNum,
        note: catatan.trim() || null,
        at: nowIso,
      });
      // W1 (SESI-FIX-APPW1): cermin clock-in + buka sesi kas ke BE — immediate-
      // first fire-and-forget SETELAH lokal menang di atas. Offline/error =
      // antrekan op be-* (drain sync mem-POST tanpa stamp/PIN); 4xx deterministik
      // = error jujur (tak diantre). PIN tak pernah ikut (verifikasi PIN sudah
      // selesai di atas; beWorkforce memoles body via stripPin).
      void (async () => {
        try {
          const ci = await clockInBe();
          if (ci.ok) {
            // HP-E2E-FIX-2: kontak server sukses = bukti kontak terakhir
            // (gate E00044 membaca lastSyncMs modul sync).
            try { noteServerContact(); } catch { /* abaikan */ }
          } else if (shouldQueueW1(ci)) {
            try {
              enqueueSync('other', clockInPayload());
            } catch {
              /* abaikan */
            }
          }
        } catch {
          /* abaikan */
        }
        try {
          const co = await cashOpenBe(kasAwalNum, catatan.trim() || undefined);
          if (co.ok) {
            // HP-E2E-FIX-2: sesi kas TERCATAT di server = kontak sukses.
            try { noteServerContact(); } catch { /* abaikan */ }
          } else if (shouldQueueW1(co)) {
            try {
              enqueueSync('other', cashOpenPayload(kasAwalNum, catatan.trim() || undefined));
            } catch {
              /* abaikan */
            }
          }
        } catch {
          /* abaikan */
        }
      })();
    } catch {
      setError(t('shf_open_failed'));
      return;
    } finally {
      openingRef.current = false;
    }
    setPinVisible(false);
    setPin('');
    // HP-E2E-FIX-HEADER: shift lokal tercatat → guard App hitung ulang
    // (rute awal + tanpa strip basi di semua layar).
    try { notifyShiftChanged(); } catch { /* abaikan */ }
    navigation?.navigate?.('Cashier');
  };

  const pressPinKey = (d: string) => {
    if (pin.length >= 6) return;
    setPin(pin + d);
  };

  return (
    <View style={s.root}>
      <ScreenHeader title={t('shf_open_title')} left={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}><Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
        </TouchableOpacity>
        } />


      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenterLg]}>
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
            <Text style={s.shiftLabel}>{t('shf_opened_at')}</Text>
            <Text style={s.shiftValue}>{lastShift ? fmtShift(lastShift.opened, lang, getCachedTimezone()) : '-'}</Text>
          </View>
          <View style={s.shiftRow}>
            <Text style={s.shiftLabel}>{t('shf_closed_at')}</Text>
            <Text style={s.shiftValue}>{lastShift ? fmtShift(lastShift.closed, lang, getCachedTimezone()) : '-'}</Text>
          </View>
        </View>

        {pendingSid ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>{t('appr_title')}</Text>
            <Text style={s.hint}>{t('appr_desc').replace('{s}', pendingSid)}</Text>
            <AppInput
              placeholder={t('appr_note_ph')}
              multiline
              value={approveNote}
              onChangeText={setApproveNote}
              boxStyle={{ height: 'auto', minHeight: 70, alignItems: 'flex-start', marginTop: 8 }}
              style={{ textAlignVertical: 'top' }}
            />
            {approveMsg ? <Text style={s.hint}>{approveMsg}</Text> : null}
            <AppButton
              title={approveBusy ? t('appr_sending') : t('appr_btn')}
              disabled={approveBusy || !approveNote.trim()}
              style={{ marginTop: 8 }}
              onPress={() => void submitApprove()}
            />
          </View>
        ) : null}

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('shf_cash_open')}</Text>
          <Text style={s.hint}>{t('shf_cash_hint')}</Text>
          {wfGates.requireCashRegisterForPos ? (
            <Text style={s.hint}>{t('shf_policy_cash')}</Text>
          ) : null}
          {/* S-F7: tanpa endpoint sesi-kas terminal di BE — kas terminal
              resmi offline-dengan-rekonsiliasi via antrean sync. */}
          <Text style={s.hint}>{t('shf_offline_recon')}</Text>
          <AppInput
            keyboardType="number-pad"
            placeholder="0"
            textAlign="right"
            value={kasAwalNum ? numGrouping(kasAwalNum) : '0'}
            onChangeText={(tx) => setKasAwal(tx.replace(/\D/g, ''))}
            boxStyle={{ borderColor: colors.orange, backgroundColor: colors.paleOrange, marginTop: 8 }}
            style={{ textAlign: 'right', fontFamily: fonts.bold, fontSize: 24 }}
          />
          {/* S4: terbilang HANYA untuk UI Indonesia — merchant EN/AUD
              melihat nominal format-currency (terbilang-ID dilarang tampil). */}
          <Text style={s.rpPreview}>{kasAwalNum > 0 ? (lang === 'id' ? terbilang(kasAwalNum) : rp(kasAwalNum)) : t('shf_zero_hint')}</Text>
          <Text style={s.chipHint}>{t('shf_chip_hint').replace('{m}', rp(MAX_KAS_AWAL))}</Text>
          <View style={s.chips}>
            {QUICK_NOMINAL.map((n) => (
              <TouchableOpacity
                key={n}
                style={[s.chip, kasAwalNum === n && s.chipActive]}
                onPress={() => setKasAwal(String(Math.min(kasAwalNum + n, MAX_KAS_AWAL)))}>
                <Text style={[s.chipTxt, kasAwalNum === n && s.chipTxtActive]}>
                  +{numGrouping(n)}
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
            boxStyle={{ height: 'auto', minHeight: 70, alignItems: 'flex-start', marginTop: 8 }}
            style={{ textAlignVertical: 'top' }}
          />
        </View>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorTxt}>{error}</Text>
          </View>
        ) : null}
        <TouchableOpacity onPress={() => navigation?.navigate?.('Attendance')}>
          <Text style={s.link}>{t('shf_att_link')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={s.footer}>
        {isTablet ? (
          <View style={s.footerInnerTablet}>
            <AppButton
              title={kasAwalNum > 0 ? `${t('shf_open_btn')} · ${rp(kasAwalNum)}` : t('shf_fill_cash')}
              disabled={kasAwalNum <= 0}
              style={{ marginTop: 0 }}
              onPress={openPin}
            />
          </View>
        ) : (
        <AppButton
          title={kasAwalNum > 0 ? `${t('shf_open_btn')} · ${rp(kasAwalNum)}` : t('shf_fill_cash')}
          disabled={kasAwalNum <= 0}
          style={{ marginTop: 0 }}
          onPress={openPin}
        />
        )}
      </View>

      <Modal visible={pinVisible} transparent animationType="slide">
        <View style={[s.modalBg, isTablet && s.modalBgTablet]}>
          <View style={[s.modalCard, isTablet && s.modalCardTablet]}>
            <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>{t('shf_pin_title')}</Text>
            <Text style={s.modalHint}>{t('shf_pin_hint')}</Text>
            {wfGates.requirePinForPos ? (
              <Text style={s.modalHint}>{t('shf_policy_pin')}</Text>
            ) : null}
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
                    style={[s.pinKey, isTablet && s.pinKeyTablet]}
                    onPress={() => {
                      if (k === 'C') setPin(pin.slice(0, -1));
                      else if (k === 'OK') confirmOpen();
                      else pressPinKey(k);
                    }}>
                    <Text style={[s.pinKeyTxt, isTablet && s.pinKeyTxtBig]}>{k === 'C' ? '⌫' : k}</Text>
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
    <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigate={(r) => { navigation?.navigate?.(r); }} /></View>
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
    marginTop: 8,
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
  // Tablet: isi footer dibatasi lebarnya + tengah.
  footerInnerTablet: { width: '100%', maxWidth: 1024, alignSelf: 'center' },
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
  // Tablet: sheet PIN jadi dialog tengah yang dibatasi lebarnya.
  modalBgTablet: { justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  // Tablet: kartu PIN maxWidth 520 + tengah, bukan selebar layar.
  modalCardTablet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: 16,
  },
  modalTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
  // Tablet: judul PIN sedikit lebih besar.
  modalTitleBig: { fontSize: 19 },
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
  // Tablet: tombol PIN lebih besar dan mudah disentuh.
  pinKeyTablet: { width: 84, height: 64 },
  pinKeyTxt: { fontSize: 20, fontFamily: fonts.bold, color: colors.navy },
  // Tablet: label tombol PIN sedikit lebih besar.
  pinKeyTxtBig: { fontSize: 22 },
  cancelBtn: { marginTop: 12, padding: 10 },
  cancelTxt: { fontSize: 14, fontFamily: fonts.medium, color: colors.red },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark, marginTop: 12, textAlign: 'center' },});