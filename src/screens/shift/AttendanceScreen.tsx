import { useEffect, useState } from 'react';import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import ScreenHeader from '../../components/ScreenHeader';import { getLang, useLang } from '../../lib/i18n';import type { Lang } from '../../lib/i18n';import { getSession } from '../../session';import { getTerminal } from '../../config/server';import { initDb, markDirty, queryFirst, run } from '../../lib/db';import { enqueueSync, noteServerContact, withTimeout } from '../../lib/sync';import { updatePinOnServer } from '../../lib/apiSource';
import { breakBe, breakPayload, clockInBe, clockInPayload, clockOutBe, clockOutPayload, getPosLocation, shouldQueueW1, updateWorkforcePinOnServer } from '../../lib/beWorkforce';
import { isStarterPlanCached } from '../../lib/posConfigSync';import { clearPinPendingSync, isPinPendingSync, markPinPendingSync, savePinHash, verifyAttendancePin } from '../../lib/pin';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];/** Format jam-menit sesuai bahasa (S4-APP-336 display-only, EN = AM/PM). C11 EFF-09:
 * tick jam dinding 1 dtk → 60 dtk (layar ini hanya butuh presisi menit) +
 * fmtClock detik DIHAPUS (satu-satunya pemakai jam-live) agar tampilan = HM. */const fmtClockHM = (d: Date, curLang?: Lang) =>
  d.toLocaleTimeString((curLang ?? getLang()) === 'en' ? 'en-US' : 'id-ID', { hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':');/** Absensi: PIN terverifikasi ke data user, clock-in/out lokal + live W1 ke BE.
 * Offline-first: tulis lokal + antre legacy dulu, lalu immediate-first live
 * clockInBe/clockOutBe/breakBe dengan PIN + lokasi GPS (bila ada).
 * 401 PIN_REQUIRED / 422 LOCATION_CHECK_FAILED = error jujur (tak diantre);
 * offline/5xx = antre W1. Titip-absen: server catat auth-user; pemilik PIN
 * lokal tetap diaudit via holderName + payload attendance legacy. */export default function AttendanceScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t, lang } = useLang(); const s = getSession();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [inTime, setInTime] = useState<string | null>(null);
  const [outTime, setOutTime] = useState<string | null>(null);
  const [onBreak, setOnBreak] = useState(false);
  const [syncNote, setSyncNote] = useState(''); const [busy, setBusy] = useState(false); const [now, setNow] = useState(() => new Date());

  // Ganti PIN
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMsg, setPinMsg] = useState('');
  /** Popup ganti PIN (dibuka via tombol, bukan seksi inline). */
  const [pinModal, setPinModal] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  /** Buka modal ganti PIN + muat status pending-sinkron user sesi. */
  const openPinModal = () => {
    setPinMsg('');
    const sid = s?.userId ?? s?.username;
    if (sid) {
      void isPinPendingSync(String(sid)).then(setPinPending).catch(() => undefined);
    } else {
      setPinPending(false);
    }
    setPinModal(true);
  };
  /** Seed 4-digit lama: banner non-blocking + deep-link ke modal ganti PIN. Baru wajib 6-8, lama 4-8 (migrasi). */
  const [legacyPin, setLegacyPin] = useState(false);
  /** PRO-GATE: null = belum tahu (fail-open); true = Starter = kunci. */
  const [starterLock, setStarterLock] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await isStarterPlanCached();
        if (alive) setStarterLock(v);
      } catch {
        if (alive) setStarterLock(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // FIX3-ATT: pulihkan state absensi dari tr_shiftlog saat mount agar tahan reload.
  // Pola query sama dengan DashboardScreen/CashierScreen (initDb + queryFirst +
  // fallback diam); hanya baris status 'absen' milik user sesi + hanya hari yang
  // sama yang dipulihkan. Logika clock-in/out di bawah tidak diubah.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await initDb();
        // APP-SHIFT 2026-10-17 (titip-absen): restore diikat ke identitas stabil
        // sesi - userId pakai id/username, cashierName pakai nama tampilan.
        const sess0 = getSession();
        const uid0 = sess0?.userId || sess0?.username || '';
        const nm0 = sess0?.name || uid0 || 'Kasir';
        const row = await queryFirst<{ clockIn: string | null; clockOut: string | null }>(
          `SELECT clockIn, clockOut FROM tr_shiftlog WHERE status = 'absen' AND (userId = ? OR cashierName = ?) ORDER BY clockIn DESC LIMIT 1`,
          [uid0, nm0],
        );
        if (!alive || !row?.clockIn) return;
        const d = new Date(row.clockIn);
        if (Number.isNaN(d.getTime())) return;
        const nowD = new Date();
        const sameDay = d.getFullYear() === nowD.getFullYear() && d.getMonth() === nowD.getMonth() && d.getDate() === nowD.getDate();
        if (!sameDay) return;
        setInTime(fmtClockHM(d));
        if (row.clockOut) {
          const o = new Date(row.clockOut);
          if (!Number.isNaN(o.getTime())) setOutTime(fmtClockHM(o));
        }
      } catch {
        // DB belum siap - tampilan kosong tetap tampil, kasir tidak diblokir.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const press = (k: string) => {
    setError('');
    if (k === 'C') setPin('');
    else if (k === '⌫') setPin(pin.slice(0, -1));
    // E2E-HP (2026-10-26) + hardening 2026-10-29: pad 6 digit (paritas changePin
    // maxLength 6 + verifyGrantPin sesi 6-digit). Cap 4 membuat PIN 6-digit
    // (mis. seed 246810) tak pernah bisa dimasukkan -> Wrong PIN selamanya.
    // Minimum tetap 4 (dijaga clockIn/clockOut via att_pin_short).
    else if (pin.length < 8) setPin(pin + k);
  };

  /** Nama tampilan pemilik PIN: nama sesi bila PIN milik sesi aktif, sonst username/id stabil (anti-titip: clock tercatat atas pemilik PIN). */
  const holderName = async (userId: string): Promise<string> => {
    const sess = getSession();
    if (userId === (sess?.userId || sess?.username)) return sess?.name || userId;
    try {
      await initDb();
      const u = await queryFirst<{ username: string | null }>('SELECT username FROM ms_posuser WHERE id = ?', [userId]);
      if (u?.username) return u.username;
    } catch {
      /* pakai userId */
    }
    return userId;
  };

  // FIX2-3: baris absensi ditandai status 'absen' + shiftName 'Absensi' agar
  // TIDAK mencemari guard shift (ShiftScreen/EndShiftScreen/Recap hanya baca
  // status 'open'/'closed'); clock-out juga hanya menutup baris 'absen'.
  // APP-SHIFT 2026-10-17 (titip-absen CONFIRMED-1): baris + payload diikat ke
  // userId pemilik PIN terverifikasi (argumen), BUKAN nama sesi.
  /** Catat clock ke tr_shiftlog + antrean sync employee-attendance. */ const recordClock = async (kind: 'in' | 'out', verifiedUserId: string, verifiedName: string) => { const nowIso = new Date().toISOString(); const term = getTerminal(); try { await initDb(); if (kind === 'in') { const id = `att-${Date.now()}`; await run( `INSERT INTO tr_shiftlog (id, branchId, terminalId, userId, cashierName, shiftName, clockIn, clockOut, cashInDrawer, totalSales, status, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 'absen', NULL)`, [id, term.branchId || null, term.terminalCode || null, verifiedUserId, verifiedName, 'Absensi', nowIso], ); } else { const open = await queryFirst<{ id: string }>( `SELECT id FROM tr_shiftlog WHERE clockOut IS NULL AND status = 'absen' AND (userId = ? OR cashierName = ?) ORDER BY clockIn DESC LIMIT 1`, [verifiedUserId, verifiedName], ); if (open) { await run('UPDATE tr_shiftlog SET clockOut = ?, syncDate = NULL WHERE id = ?', [nowIso, open.id]); } } } catch { /* DB belum siap - antrean sync di bawah tetap dicoba */ } try { enqueueSync('attendance', { type: kind === 'in' ? 'clock-in' : 'clock-out', userId: verifiedUserId, user: verifiedName, branchId: term.branchId || null, terminalCode: term.terminalCode || null, at: nowIso, }); } catch { /* antrean belum siap */ } }; const clockIn = async () => {
    // GAP-4: guard ganda ala changePin - ketuk ganda saat verifikasi async
    // berjalan ditolak (tombol juga disabled via busy).
    if (busy) return;
    if (pin.length < 4) { setError(t('att_pin_short')); return; } setBusy(true); try {
    // APP-SHIFT titip-absen: ok===null (DB kosong/belum siap) DITOLAK seperti PIN salah; clock diikat ke pemilik PIN.
    const vIn = await verifyAttendancePin(pin);
    if (vIn.ok !== true || !vIn.userId) { setError(vIn.ok === false ? t('att_pin_wrong') : t('shf_pin_offline_unknown')); return; }
    try { const digits = pin.replace(/[^0-9]/g, ''); if (digits.length >= 4 && digits.length < 6) setLegacyPin(true); } catch { /* abaikan */ }
    await recordClock('in', vIn.userId, await holderName(vIn.userId)); setInTime(fmtClockHM(new Date(), lang)); setOutTime(null); setOnBreak(false);
    try {
      let loc = null;
      try { loc = await getPosLocation(6000); } catch { loc = null; }
      const live = await clockInBe(pin, loc);
      if (live.ok) {
        try { noteServerContact(); } catch { /* abaikan */ }
        setSyncNote(t('att_synced'));
      } else if (shouldQueueW1(live)) {
        try { enqueueSync('other', clockInPayload()); } catch { /* abaikan */ }
        setSyncNote(t('att_queued'));
      } else {
        setError(live.message || t('att_queued'));
        setSyncNote(t('att_queued'));
      }
    } catch { setSyncNote(t('att_queued')); }
    setPin('');
  } finally { setBusy(false); } };

  const toggleBreak = async () => {
    if (busy) return;
    if (pin.length < 4) { setError(t('att_pin_short')); return; }
    setBusy(true);
    setError('');
    try {
      const action = onBreak ? 'END' : 'START';
      const live = await breakBe(action);
      if (live.ok) {
        setOnBreak(!onBreak);
        try { noteServerContact(); } catch { /* abaikan */ }
        setSyncNote(onBreak ? t('att_break_ended') : t('att_break_started'));
      } else if (live.code === 'BREAK_ALREADY_OPEN' && !onBreak) {
        setOnBreak(true);
      } else if (shouldQueueW1(live)) {
        try { enqueueSync('other', breakPayload(action)); } catch { /* abaikan */ }
        setOnBreak(!onBreak);
        setSyncNote(t('att_queued'));
      } else {
        setError(live.message || t('att_break_error'));
      }
    } catch {
      setError(t('att_break_error'));
    } finally { setBusy(false); }
  };

  const clockOut = async () => {
    // GAP-4: guard ganda ala changePin (cermin clockIn di atas).
    if (busy) return;
    if (pin.length < 4) { setError(t('att_pin_need_out')); return; }
    setBusy(true); try {
    // APP-SHIFT titip-absen: ok===null DITOLAK; clock-out menutup baris milik pemilik PIN.
    const vOut = await verifyAttendancePin(pin);
    if (vOut.ok !== true || !vOut.userId) { setError(vOut.ok === false ? t('att_pin_wrong') : t('shf_pin_offline_unknown')); return; }
    try { const digits = pin.replace(/[^0-9]/g, ''); if (digits.length >= 4 && digits.length < 6) setLegacyPin(true); } catch { /* abaikan */ }
    await recordClock('out', vOut.userId, await holderName(vOut.userId)); setOutTime(fmtClockHM(new Date(), lang)); setOnBreak(false);
    try {
      let loc = null;
      try { loc = await getPosLocation(6000); } catch { loc = null; }
      const live = await clockOutBe(pin, loc);
      if (live.ok) {
        try { noteServerContact(); } catch { /* abaikan */ }
        setSyncNote(t('att_synced'));
      } else if (live.code === 'BREAK_IN_PROGRESS') {
        setError(t('att_break_in_progress'));
        setSyncNote(t('att_queued'));
      } else if (shouldQueueW1(live)) {
        try { enqueueSync('other', clockOutPayload()); } catch { /* abaikan */ }
        setSyncNote(t('att_queued'));
      } else {
        setError(live.message || t('att_queued'));
        setSyncNote(t('att_queued'));
      }
    } catch { setSyncNote(t('att_queued')); }
    setPin('');
  } finally { setBusy(false); } };

  /** * Ganti PIN: verifikasi PIN lama (hash), simpan hash baru - plaintext TIDAK * PERNAH ditulis ke DB. Perubahan dikirim ke server bila online, selebihnya * antre via sync (server sumber akhir). */ const changePin = async () => {
    const clean = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 8);
    const o = clean(oldPin);
    const n = clean(newPin);
    const c = clean(confirmPin);
    if (o.length < 4) { setPinMsg(t('att_old_short')); return; }
    if (n.length < 6) { setPinMsg(t('att_new_short')); return; }
    if (n !== c) { setPinMsg(t('att_confirm_mismatch')); return; }
    if (o === n) { setPinMsg(t('att_same_pin')); return; }
    // SIDE-B: busy dikunci selama submit (tombol Save disabled) + panggilan
    // server dibatasi timeout - BE macet tak boleh menggantung modal.
    if (busy) return;
    setBusy(true);
    try {
    const v = await verifyAttendancePin(o); if (v.ok !== true || !v.userId) { setPinMsg(v.ok === false ? t('att_old_wrong') : t('shf_pin_offline_unknown')); return; } const userId = v.userId; try { await savePinHash(userId, n); } catch { setPinMsg(t('att_save_fail')); return; }
    /* GAP-L: live-update sukses = server + lokal konvergen (bersihkan
       flag); offline = lokal saja (tandai pending; JANGAN klaim "terkirim
       saat online" — antrean 'attendance' difinalkan lokal tanpa POST). */ try { await initDb(); await markDirty('ms_posuser', userId); } catch { /* abaikan */ } let sent = false; let goDenied = ''; let goDeniedCode = ''; /* GAP-L2: wasPending dibaca DULU — 401 PIN_INVALID + pending = divergensi offline yang tak bisa pulih via ulangi (butuh reset manajer atau first-set). */ let wasPending = false; try { wasPending = await isPinPendingSync(userId); } catch { /* abaikan */ } try { const g = await withTimeout(updateWorkforcePinOnServer(o, n), 8000); if (g.ok) { sent = true; } else if ((g as { rejected?: boolean }).rejected) { const m = String((g as { message?: unknown }).message ?? '').trim(); if (m) goDenied = m; const cd = String((g as { code?: unknown }).code ?? '').trim(); if (cd) goDeniedCode = cd; } } catch { /* offline/timeout - coba legacy di bawah */ } if (!sent) { try { const r = await withTimeout(updatePinOnServer(userId, o, n), 8000); if (r.ok) sent = true; } catch { /* offline/timeout - antre di bawah */ } } try { enqueueSync('attendance', { type: 'pin-change', userId, at: new Date().toISOString() }); } catch { /* abaikan */ } try { if (n.length >= 6) setLegacyPin(false); } catch { /* abaikan */ } if (sent) { try { await clearPinPendingSync(userId); } catch { /* abaikan */ } setPinPending(false); setPinMsg(t('att_pin_changed_ok')); }
    else if (goDeniedCode === 'PIN_INVALID' && wasPending) { /* GAP-L2: server menolak PIN lama = divergensi (server masih PIN pra-offline). Ulangi takkan pulih — arahkan ke reset manajer; flag tetap pending. */ setPinPending(true); setPinMsg(t('att_pin_diverged')); }
    else if (goDenied) { setPinMsg(goDenied); }
    else { try { await markPinPendingSync(userId); } catch { /* abaikan */ } setPinPending(true); setPinMsg(t('att_pin_saved_pending')); }
    } finally { setBusy(false); }
    setOldPin('');
    setNewPin('');
    setConfirmPin('');
    setPinModal(false);
  };

  const clockedIn = inTime !== null && outTime === null;

  const outlet = s?.outlet ?? t('outlet_fallback'); const who = s?.name ?? s?.username ?? '-';
  // PRO-GATE: absensi & shift khusus Pro. Tak diketahui = fail-open.
  if (starterLock === true) {
    return (
      <View style={styles.root}><ScreenHeader title={t('title_attendance')} sub={`${outlet} · ${t('att_inout')}`} onBack={() => navigation?.goBack()} /><ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
        <View style={styles.card}>
          <Text style={[styles.item, isTablet && styles.itemTablet]}>{t('att_pro_only_title')}</Text>
          <Text style={[styles.meta, isTablet && styles.metaTablet]}>{t('att_pro_only_desc')}</Text>
        </View>
        <View style={styles.actions}>
          <AppButton size="md" title={t('att_exit')} variant="secondary" fullWidth={false} style={{ flex: 1, marginTop: 0 }} onPress={() => navigation?.navigate('Dashboard')} />
        </View>
      </ScrollView></View>
    );
  }
  return (
    <View style={styles.root}><ScreenHeader title={t('title_attendance')} sub={`${outlet} · ${t('att_inout')}`} onBack={() => navigation?.goBack()} /><ScrollView  contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <Text style={styles.hint}>{t('att_staff')} {outlet} · {t('c_cashier')} {who}</Text>
      <Text style={styles.sec}>{t('att_inout')}</Text>
      <Text style={styles.clock}>{fmtClockHM(now, lang)}</Text>
      <Text style={styles.date}>{now.toLocaleDateString(lang === 'en' ? 'en-US' : 'id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
      <Text style={[styles.meta, isTablet && styles.metaTablet]}>{t('fallback_shift')} (08:00 - 16:00) · {clockedIn ? `● ${t('att_st_in')}` : outTime ? `● ${t('att_st_out')}` : `● ${t('att_st_none')}`}</Text>

      <View style={styles.card}>
        <Text style={styles.cardT}>{t('att_outlet')} {outlet}</Text>
        <Text style={[styles.meta, isTablet && styles.metaTablet]}>{who} ({s?.username ?? '-'})</Text>
        <Text style={[styles.meta, isTablet && styles.metaTablet]}>{s?.shift ?? t('fallback_shift')} · {t('att_cash')} {rp(s?.cash ?? 0)} · {t('dash_shift_open')}</Text>
      </View>

      <Text style={styles.sec}>{t('att_list')}</Text>
      <View style={styles.card}>
        <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('att_in')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{inTime ?? '-- : --'}</Text></View>
        <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('att_break')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{onBreak ? t('att_on_break') : '-- : --'}</Text></View>
        <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemTablet]}>{t('att_out')}</Text><Text style={[styles.item, isTablet && styles.itemTablet]}>{outTime ?? '-- : --'}</Text></View>
      </View>
      {!inTime && <Text style={styles.empty}>{t('att_empty_in')}</Text>}
      {/* S9: banner offline-only eksplisit - selalu tampil, bukan syarat. */}
      <Text style={styles.hint}>{t('att_offline_only')}</Text>
      {(legacyPin || (pin.replace(/[^0-9]/g, '').length >= 4 && pin.replace(/[^0-9]/g, '').length < 6)) ? (
        <View style={[styles.card, { borderColor: colors.orange, borderWidth: 1.5 }]}>
          <Text style={[styles.item, isTablet && styles.itemTablet, { fontFamily: fonts.bold, color: colors.orangeDark }]}>{t('att_pin_legacy_title')}</Text>
          <Text style={[styles.meta, isTablet && styles.metaTablet, { marginTop: 4 }]}>{t('att_pin_legacy_banner')}</Text>
          <View style={{ marginTop: 10 }}>
            <AppButton size="md" title={t('att_pin_legacy_action')} onPress={() => { openPinModal(); }} />
          </View>
        </View>
      ) : null}

      <Text style={styles.sec}>{t('att_pin_entry')}</Text>
      <View style={styles.pinRow}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <View key={i} style={styles.pinDot}><Text style={styles.pinChar}>{pin[i] ? '●' : '-'}</Text></View>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={[styles.keys, isTablet && styles.keysTablet]}>
        {KEYS.map((k) => (
          <TouchableOpacity key={k} style={[styles.key, (k === 'C' || k === '⌫') && styles.keyUtil, isTablet && styles.keyTablet]} onPress={() => press(k)}>
            <Text style={[styles.keyT, (k === 'C' || k === '⌫') && styles.keyUtilT]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.actions}>
        {!outTime ? (
          <AppButton
            size="md"
            title={`${t('att_in')} ›`}
            disabled={clockedIn || busy}
            fullWidth={false}
            style={{ flex: 1, marginTop: 0 }}
            onPress={clockIn}
          />
        ) : null}
        {clockedIn && !outTime ? (
          <AppButton
            size="md"
            title={onBreak ? `${t('att_break_end')} ›` : `${t('att_break_start')} ›`}
            variant="secondary"
            disabled={busy}
            fullWidth={false}
            style={{ flex: 1, marginTop: 0 }}
            onPress={toggleBreak}
          />
        ) : null}
        {clockedIn ? (
          <AppButton
            size="md"
            title={`${t('att_out')} ›`}
            variant="danger"
            disabled={busy}
            fullWidth={false}
            style={{ flex: 1, marginTop: 0 }}
            onPress={clockOut}
          />
        ) : null}
        <AppButton
          size="md"
          title={t('att_exit')}
          variant="secondary"
          fullWidth={false}
          style={{ flex: 1, marginTop: 0 }}
          onPress={() => navigation?.navigate('Dashboard')}
        />
      </View>
      {syncNote ? <Text style={styles.syncNote}>{syncNote}</Text> : null}<View style={styles.links}>
        <TouchableOpacity onPress={() => navigation?.navigate('Shift')}><Text style={styles.link}>{t('att_after_shift')}</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation?.navigate('Dashboard')}><Text style={styles.link}>{t('att_skip_dash')}</Text></TouchableOpacity>
      </View>

      <AppButton
        size="md"
        variant="secondary"
        title={t('att_change_pin')}
        onPress={() => { openPinModal(); }}
        style={{ marginTop: 16 }}
      />
      <Modal visible={pinModal} transparent animationType="slide" onRequestClose={() => setPinModal(false)}>
        {/* Ketuk area gelap di luar kartu = tutup. */}
        <Pressable style={[styles.modalBg, isTablet && styles.modalBgTablet]} onPress={() => setPinModal(false)}>
          <View style={[styles.modalCard, isTablet && styles.modalCardTablet]} onStartShouldSetResponder={() => true}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={[styles.modalTitle, isTablet && styles.modalTitleBig]}>{t('att_change_pin')}</Text>
              {pinPending ? (<Text style={[styles.meta, isTablet && styles.metaTablet, { color: colors.orangeDark, marginTop: 6 }]}>{t('att_pin_pending_banner')}</Text>) : null}
              <AppInput
                label={t('att_old_label')}
                keyboardType="numeric"
                secureTextEntry
                maxLength={8}
                placeholder={t('att_old_ph')}
                value={oldPin}
                onChangeText={(tx) => setOldPin(tx.replace(/[^0-9]/g, '').slice(0, 8))}
                style={{ textAlign: 'center', letterSpacing: 3, fontFamily: fonts.bold }}
              />
              <AppInput
                label={t('att_new_label')}
                keyboardType="numeric"
                secureTextEntry
                maxLength={8}
                placeholder={t('att_new_ph')}
                value={newPin}
                onChangeText={(tx) => setNewPin(tx.replace(/[^0-9]/g, '').slice(0, 8))}
                style={{ textAlign: 'center', letterSpacing: 3, fontFamily: fonts.bold }}
              />
              <AppInput
                label={t('att_confirm_label')}
                keyboardType="numeric"
                secureTextEntry
                maxLength={8}
                placeholder={t('att_confirm_ph')}
                value={confirmPin}
                onChangeText={(tx) => setConfirmPin(tx.replace(/[^0-9]/g, '').slice(0, 8))}
                style={{ textAlign: 'center', letterSpacing: 3, fontFamily: fonts.bold }}
              />
              {pinMsg ? <Text style={styles.pinMsg}>{pinMsg}</Text> : null}
              <AppButton size="md" title={t('att_save_pin')} disabled={busy} onPress={changePin} />
              <TouchableOpacity onPress={() => setPinModal(false)}>
                <Text style={styles.modalCancel}>{t('cm_cancel')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
 </View> );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 16 },
  clock: { fontFamily: fonts.bold, fontSize: 34, color: colors.navy, marginTop: 6 },
  date: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 2 },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  // Tablet: teks status kehadiran lebih proporsional.
  metaTablet: { fontSize: 13 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  cardT: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text },
  // Tablet: baris status kehadiran lebih terbaca.
  itemTablet: { fontSize: 14 },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 8 },
  pinRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  pinDot: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  pinChar: { fontSize: 20, color: colors.navy },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginTop: 8 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  // Tablet: grid keypad dibatasi agar tombol tidak pipih raksasa.
  keysTablet: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  key: { width: '31%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  // Tablet: tombol keypad lebih tinggi dan mudah disentuh.
  keyTablet: { minHeight: 56, justifyContent: 'center' },
  keyT: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  keyUtil: { backgroundColor: colors.bg },
  keyUtilT: { color: colors.red },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primary: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  danger: { flex: 1, backgroundColor: colors.red, borderRadius: 10, padding: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  syncNote: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 8, textAlign: 'center' }, links: { gap: 8, marginTop: 14 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 10, marginBottom: 5 },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
    padding: 11, fontFamily: fonts.bold, fontSize: 14, color: colors.text, letterSpacing: 3, textAlign: 'center',
  },
  pinMsg: { fontFamily: fonts.medium, fontSize: 13, color: colors.greenDark, marginTop: 8, textAlign: 'center' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  // Tablet: sheet ganti PIN jadi dialog tengah yang dibatasi lebarnya.
  modalBgTablet: { justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '85%' },
  // Tablet: kartu dialog tengah maxWidth 520, bukan selebar layar.
  modalCardTablet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: 16,
  },
  modalTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, textAlign: 'center', marginBottom: 4 },
  // Tablet: judul dialog sedikit lebih besar.
  modalTitleBig: { fontSize: 18 },
  modalCancel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 12 },});