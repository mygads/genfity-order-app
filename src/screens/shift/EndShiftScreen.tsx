import React, { useEffect, useState } from 'react';import {
  Image, Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp, rpNum, wideCenter } from '../../theme';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import ScreenHeader from '../../components/ScreenHeader';import DrawerMenu from '../../components/DrawerMenu';import { useLang } from '../../lib/i18n';import { getSession } from '../../session';import { getTerminal } from '../../config/server';import { initDb, query, queryFirst, run } from '../../lib/db';import { authorizeSupervisor } from '../../lib/supervisor';import { verifyAttendancePin } from '../../lib/pin';import { enqueueOutbox, enqueueSync } from '../../lib/sync';type Props = { navigation?: any };interface ShiftSummary { openId: string | null; modalAwal: number; penjualanTunai: number; pengeluaran: number; fromDb: boolean;}const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0;};

/** Tutup shift: hitung kas seharusnya dari SQLite, cocokkan dengan kas fisik. */export default function EndShiftScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;

  const { t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [summary, setSummary] = useState<ShiftSummary>({ openId: null, modalAwal: 200000, penjualanTunai: 1575000, pengeluaran: 75000, fromDb: false, });
  const  [kasFisik, setKasFisik] = useState('');
  const [catatan, setCatatan] = useState('');
  const [pin, setPin] = useState('');
  const [pinVisible, setPinVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [error, setError] = useState('');

  // Ringkasan dari shift berjalan (tr_shiftlog) + penjualan lunas + pengeluaran.
  useEffect(() => { let on = true; (async () => { try { await initDb(); const open = await queryFirst<{ id: string; cashInDrawer: number | null; clockIn: string | null; }>(`SELECT id, cashInDrawer, clockIn FROM tr_shiftlog WHERE status = 'open' ORDER BY clockIn DESC LIMIT 1`); const latest = open ?? (await queryFirst<{ id: string; cashInDrawer: number | null; clockIn: string | null }>( 'SELECT id, cashInDrawer, clockIn FROM tr_shiftlog ORDER BY clockIn DESC LIMIT 1', )); if (!on || !latest) return; const since = latest.clockIn ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString();    // Kas tunai MURNI: jumlah pembayaran cash dari tr_salespayment yang
    // head-nya lunas - tanpa fallback ke semua metode (RIW-07).
    const cash = await queryFirst<{ total: number }>( `SELECT COALESCE(SUM(p.amount), 0) AS total FROM tr_salespayment p JOIN tr_saleshead h ON h.salesNum = p.salesNum WHERE h.status = 'paid' AND h.salesDate >= ? AND (p.paymentMethod LIKE '%cash%' OR p.paymentMethod LIKE '%tunai%')`, [since], ); const tunai = num(cash?.total); const exp = await queryFirst<{ total: number }>( 'SELECT COALESCE(SUM(amount), 0) AS total FROM tr_branchexpense WHERE expenseDate >= ?', [since], ); if (!on) return; setSummary({ openId: open ? open.id : null, modalAwal: Math.round(num(latest.cashInDrawer)), penjualanTunai: Math.round(tunai), pengeluaran: Math.round(num(exp?.total)), fromDb: true, }); } catch { /* DB belum siap - pakai angka awal */ } })(); return () => { on = false; }; }, []); const { modalAwal, penjualanTunai, pengeluaran } = summary; const kasSeharusnya = modalAwal + penjualanTunai - pengeluaran; const kasFisikNum = Number(kasFisik.replace(/\D/g, '')) || 0;
  const touched = kasFisik.length > 0;
  const selisih = touched ? kasFisikNum - kasSeharusnya : 0;

  const askClose = () => {
    if (!touched) {
      setError('Masukkan kas fisik (hasil hitung laci) terlebih dahulu');
      return;
    }
    setError('');
    setConfirmVisible(true);
  };

  const askPin = () => {
    setConfirmVisible(false);
    setPin('');
    setPinVisible(true);
  };

  const confirmClose = async () => {
    // FIX2-4b: samakan dengan ShiftScreen - verifikasi ke server dulu via
    // authorizeSupervisor (tepat 6 digit); PIN lokal (lib/pin.ts) hanya fallback
    // saat server tak terjangkau (offline/unconfigured), bukan satu-satunya cek.
    if (pin.length < 6) {
      setError('Masukkan PIN supervisor (6 digit)');
      return;
    }
    try { await initDb(); } catch { /* DB belum siap - verifikasi di bawah tetap dicoba */ }
    const auth = await authorizeSupervisor(pin);
    if (!auth.ok && auth.code !== 'offline' && auth.code !== 'unconfigured') { setError(auth.message); return; }
    if (!auth.ok) { try { const v = await verifyAttendancePin(pin); if (v.ok === false) { setError('PIN supervisor tidak dikenal - hubungi supervisor.'); return; } } catch { /* DB belum siap - lanjut dengan gerbang panjang-PIN */ } }
    // Tutup shift di SQLite + rincian per metode (tr_shiftlogdetail) + selisih,
// lalu antre sync dan kembali ke layar Shift.
    const nowIso = new Date().toISOString(); const nm = getSession()?.name ?? 'Kasir'; let shiftId: string | null = summary.openId; try { await initDb(); let since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString(); if (shiftId) { const open = await queryFirst<{ clockIn: string | null }>( 'SELECT clockIn FROM tr_shiftlog WHERE id = ?', [shiftId], ); if (open?.clockIn) since = open.clockIn; await run( `UPDATE tr_shiftlog SET clockOut = ?, totalSales = ?, cashActual = ?, cashDiff = ?, status = 'closed', syncDate = NULL WHERE id = ?`, [nowIso, Math.round(penjualanTunai), Math.round(kasFisikNum), Math.round(selisih), shiftId], ); } else { const term = getTerminal(); shiftId = `shift-${Date.now()}`; await run( `INSERT INTO tr_shiftlog (id, branchId, terminalId, userId, shiftName, clockIn, clockOut, cashInDrawer, totalSales, cashActual, cashDiff, status, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', NULL)`, [shiftId, term.branchId || null, term.terminalCode || null, nm, 'Shift', since, nowIso, Math.round(modalAwal), Math.round(penjualanTunai), Math.round(kasFisikNum), Math.round(selisih)], ); }
    // Rincian per metode bayar untuk rekap + rekonsiliasi (RIW-16).
    const byMethod = await query<{ paymentMethod: string | null; total: number; n: number }>( `SELECT p.paymentMethod, COALESCE(SUM(p.amount), 0) AS total, COUNT(*) AS n FROM tr_salespayment p JOIN tr_saleshead h ON h.salesNum = p.salesNum WHERE h.status = 'paid' AND h.salesDate >= ? GROUP BY p.paymentMethod`, [since], ); for (const m of byMethod) { try { await run( `INSERT INTO tr_shiftlogdetail (id, shiftId, paymentMethod, totalAmount, totalTrx, syncDate) VALUES (?, ?, ?, ?, ?, NULL)`, [`sd-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, shiftId, m.paymentMethod ?? '-', Math.round(num(m.total)), m.n], ); } catch { /* abaikan per baris */ } } try { await enqueueOutbox('tr_shiftlog', shiftId, 'update'); } catch { /* abaikan */ } } catch { /* abaikan - navigasi tetap jalan */ } try { enqueueSync('other', { op: 'shift-close', shiftId: summary.openId, cashExpected: Math.round(kasSeharusnya), cashCounted: kasFisikNum, diff: Math.round(selisih), note: catatan.trim() || null, at: nowIso, }); } catch { /* antrean belum siap */ } setPinVisible(false);
    setPin('');
    navigation?.navigate?.('Shift');
  };

  const renderDiffBanner = () => {
    if (!touched) return null;
    if (selisih === 0) {
      return (
        <View style={[s.banner, s.bannerOk]}>
          <Text style={[s.bannerTitle, s.bannerOkTxt]}>{t('shf_diff_ok').replace('{z}', rp(0))}</Text>
          <Text style={s.bannerSub}>{t('shf_diff_ok_sub')}</Text>
        </View>
      );
    }
    const lebih = selisih > 0;
    return (
      <View style={[s.banner, lebih ? s.bannerMore : s.bannerLess]}>
        <Text style={[s.bannerTitle, lebih ? s.bannerMoreTxt : s.bannerLessTxt]}>
          {(lebih ? t('shf_diff_over') : t('shf_diff_short'))}: {rp(Math.abs(selisih))}
        </Text>
        <Text style={s.bannerSub}>
          {lebih ? t('shf_diff_over_sub') : t('shf_diff_short_sub')}
        </Text>
      </View>
    );
  };

  return (
    <View style={s.root}>
      <ScreenHeader title={t('title_close')} onBack={() => navigation?.goBack?.()} right={
        <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}> <Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
        </TouchableOpacity>
        } />


      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.card}>
          <Text style={s.cardTitle}>{t('end_summary')}</Text>
          <Row label="Modal Awal (Kas Awal)" value={rp(modalAwal)} />
          <Row label="Penjualan Tunai" value={rp(penjualanTunai)} />
          <Row label="Pengeluaran" value={'- ' + rp(pengeluaran)} negative />
          <View style={s.divider} />
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Kas Seharusnya</Text>
            <Text style={s.totalValue}>{rp(kasSeharusnya)}</Text>
          </View>
          <Text style={s.formula}>
            Modal awal + penjualan tunai - pengeluaran
          </Text>
        </View>

        {renderDiffBanner()}

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('end_cash_real')}</Text>
          <AppInput
            keyboardType="number-pad"
            placeholder="0"
            textAlign="right"
            value={touched ? rpNum(kasFisikNum) : '0'}
            onChangeText={(tx) => setKasFisik(tx.replace(/\D/g, ''))}
            boxStyle={{ borderColor: colors.orange, backgroundColor: colors.paleOrange }}
            style={{ textAlign: 'right', fontFamily: fonts.bold, fontSize: 24 }}
          />
          <NumPad
            onKey={(k) => {
              if (k === 'C') setKasFisik(kasFisik.slice(0, -1));
              else if (kasFisik.length < 12) setKasFisik(kasFisik + k);
            }}
          />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('end_note_out')}</Text>
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
        <TouchableOpacity onPress={() => navigation?.navigate?.('Recap')}>
          <Text style={s.link}>Cek dulu → Rekap penjualan shift ini</Text>
        </TouchableOpacity>
        <View style={{ height: 90 }} />
      </ScrollView>

      <View style={s.footer}>
        <View style={s.footerInfo}>
          <Text style={s.footerLabel}>Kas seharusnya</Text>
          <Text style={s.footerValue}>{rp(kasSeharusnya)}</Text>
        </View>
        <AppButton
          title={t('end_close_btn')}
          variant="danger"
          fullWidth={false}
          style={{ marginTop: 0, paddingHorizontal: 32 }}
          onPress={askClose}
        />
      </View>

      <Modal visible={confirmVisible} transparent animationType="fade">
        <View style={s.modalBg}>
          <View style={s.dialog}>
            <Text style={s.modalTitle}>Akhiri Shift?</Text>
            <Text style={s.modalHint}>
              Kas seharusnya {rp(kasSeharusnya)}{'\n'}Kas fisik {rp(kasFisikNum)}
              {'\n'}Selisih {selisih >= 0 ? '+' : '-'}
              {rpNum(Math.abs(selisih))}
            </Text>
            <View style={s.dialogRow}>
              <AppButton
                title={t('cm_cancel')}
                variant="secondary"
                fullWidth={false}
                style={{ flex: 1, marginTop: 0, marginRight: 8 }}
                onPress={() => setConfirmVisible(false)}
              />
              <AppButton
                title="Lanjut"
                variant="danger"
                fullWidth={false}
                style={{ flex: 1, marginTop: 0, marginLeft: 8 }}
                onPress={askPin}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={pinVisible} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>PIN Supervisor</Text>
            <Text style={s.modalHint}>Diperlukan persetujuan supervisor</Text>
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
                      else if (k === 'OK') confirmClose();
                      else if (pin.length < 6) setPin(pin + k);
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
  );}function Row({
  label,
  value,
  negative,}: {
  label: string;
  value: string;
  negative?: boolean;}) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, negative && { color: colors.red }]}>{value}</Text>
    </View>
  );}function NumPad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <View style={s.pad}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '000'].map((k) => (
        <TouchableOpacity key={k} style={s.padKey} onPress={() => onKey(k)}>
          <Text style={s.padKeyTxt}>{k === 'C' ? '⌫' : k}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );}const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  burger: {
     width: 22, height: 22 },

  body: { padding: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  rowLabel: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  rowValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  totalValue: { fontSize: 18, fontFamily: fonts.bold, color: colors.navy },
  formula: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.faint,
    marginTop: 4,
  },
  banner: { borderRadius: 12, padding: 14, marginBottom: 12 },
  bannerOk: { backgroundColor: colors.paleGreen },
  bannerMore: { backgroundColor: colors.paleBlue },
  bannerLess: { backgroundColor: colors.paleRed },
  bannerTitle: { fontSize: 15, fontFamily: fonts.bold },
  bannerOkTxt: { color: colors.green },
  bannerMoreTxt: { color: colors.navy },
  bannerLessTxt: { color: colors.red },
  bannerSub: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.muted,
    marginTop: 2,
  },
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
  pad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  padKey: {
    width: '31%',
    margin: '1.16%',
    height: 52,
    borderRadius: 10,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padKeyTxt: { fontSize: 18, fontFamily: fonts.bold, color: colors.navy },
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
  errorBox: { backgroundColor: colors.paleRed, borderRadius: 8, padding: 12 },
  errorTxt: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.red,
    textAlign: 'center',
    marginTop: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  footerInfo: { flex: 1 },
  footerLabel: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  footerValue: { fontSize: 17, fontFamily: fonts.bold, color: colors.navy },
  closeBtn: {
    backgroundColor: colors.red,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  closeBtnTxt: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  dialog: {
    backgroundColor: colors.white,
    margin: 24,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 'auto',
    marginTop: 'auto',
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
    color: colors.muted,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  dialogRow: { flexDirection: 'row', marginTop: 18 },
  dialogCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginRight: 8,
  },
  dialogCancelTxt: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
  dialogOk: {
    flex: 1,
    backgroundColor: colors.red,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginLeft: 8,
  },
  dialogOkTxt: { fontSize: 14, fontFamily: fonts.bold, color: colors.white },
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