import { useState } from 'react';import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import ScreenHeader from '../../components/ScreenHeader';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import { useLang } from '../../lib/i18n';import { markApproved } from '../../lib/pettyApproval';import { verifyLocalEscalation } from '../../lib/supervisor';import { getSession } from '../../session';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      id?: string; tanggal?: string; keterangan?: string; coa?: string;
      arus?: string; jumlah?: number; kasir?: string; disetujui?: boolean; photo?: string | null;
    };
  };};export default function PettyCashDetailScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang(); const p = route?.params ?? {};
  const id = p.id ?? 'PC-002';
  const tanggal = p.tanggal ?? '16 Okt 2026  10:20';
  const keterangan = p.keterangan ?? 'Belanja plastik dan tissue';
  const coa = p.coa ?? 'Operasional';
  const arus = p.arus ?? 'Keluar';
  const jumlah = p.jumlah ?? 45000;
  const kasir = p.kasir ?? getSession()?.name ?? getSession()?.username ?? '';
  const photo = p.photo ?? null;
  // WIRE-APPROVAL: default fail-closed (tanpa param = belum disetujui) +
  // approve via eskalasi PIN staff/owner Q18 (verifyLocalEscalation
  // 'petty.approve' — kunci khusus tanpa deny Staff); identitas approver tercatat via markApproved(id,
  // approver) + rincian by/at + sync. Tanpa PIN = tak approve.
  const [disetujui, setDisetujui] = useState(p.disetujui ?? false);
  const [pin, setPin] = useState('');
  const [pinVisible, setPinVisible] = useState(false);
  const [pinErr, setPinErr] = useState('');

  /** Buka modal PIN staff/owner (audit trail, bukan auto-approve). */
  const setujui = () => { setPin(''); setPinErr(''); setPinVisible(true); };
  /** Konfirmasi approve: PIN staff/owner via eskalasi lokal, catat approver + timestamp + sync. */
  const confirmApprove = async () => {
    const esc = await verifyLocalEscalation(pin, 'petty.approve');
    if (!esc.ok) { setPinErr(esc.message); return; }
    const approver = (esc.userId ?? '').trim();
    if (!approver) { setPinErr(t('petty_unknown_approver')); return; }
    setDisetujui(true);
    await markApproved(id, approver);
    setPinVisible(false); setPin('');
  }; return (
    <View style={s.root}>
      <ScreenHeader title={t('petty.detailTitle')} onBack={() => navigation?.goBack?.()}  />

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenterLg]}>
        <View style={s.hero}>
          <View style={[s.badge, arus === 'Masuk' ? s.badgeIn : s.badgeOut]}>
            <Text style={[s.badgeTxt, arus === 'Masuk' ? s.badgeInTxt : s.badgeOutTxt]}> {arus === 'Masuk' ? t('petty.in') : t('petty.out')} </Text>
          </View>
          <Text style={s.heroValue}>{arus === 'Masuk' ? '+' : '-'}{rp(jumlah)}</Text>
          <Text style={s.heroSub}>{id} - {tanggal}</Text>
        </View>

        <View style={s.card}>
          <Row label={t('petty.desc').replace(' *', '')} value={keterangan} />
          <Row label={t('petty.account')} value={coa} />
          <Row label={t('petty.cashier')} value={kasir} />
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.rowLabel}>{t('petty.status')}</Text>
            <Text style={disetujui ? s.okTxt : s.waitTxt}>
              {disetujui ? t('petty.approved') : t('petty.pending')}
            </Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('petty.photo')}</Text>
          {photo ? (
            <Image source={{ uri: photo }} style={s.photo} />
          ) : (
            <View style={s.noPhoto}>
              <Text style={s.noPhotoTxt}>{t('petty.noPhoto')}</Text>
            </View>
          )}
        </View>

        {!disetujui && (
          <TouchableOpacity style={s.primary} onPress={setujui}>
            <Text style={s.primaryT}>{t('petty.approveTxn')}</Text>
          </TouchableOpacity>
        )}
        {/* WIRE-APPROVAL: modal PIN staff/owner untuk approve. Judul/petunjuk literal netral ID/EN. */}
        <Modal visible={pinVisible} transparent animationType="slide" onRequestClose={() => setPinVisible(false)}>
          <View style={s.modalBg}>
            <View style={[s.modalCard, isTablet && s.modalCardTablet]}>
              <Text style={s.modalTitle}>{t('petty_approve_title')}</Text>
              <Text style={s.modalHint}>{t('petty_approve_hint')}</Text>
              <View style={s.pinDots} accessibilityLabel={t('cx_pin')}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <View key={i} style={[s.dot, i < pin.length && s.dotFill]} />
                ))}
              </View>
              {pinErr ? <Text style={s.pinErr}>{pinErr}</Text> : null}
              <View style={s.pinPad}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={s.pinKey}
                    onPress={() => {
                      if (k === 'C') setPin(pin.slice(0, -1));
                      else if (k === 'OK') void confirmApprove();
                      else if (pin.length < 6) setPin(pin + k);
                    }}>
                    <Text style={s.pinKeyTxt}>{k === 'C' ? '⌫' : k}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={s.ghostBtn} onPress={() => { setPinVisible(false); setPin(''); }}>
                <Text style={s.ghostT}>{t('c_cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <TouchableOpacity style={s.ghost} onPress={() => navigation?.navigate('PettyCash')}>
          <Text style={s.ghostT}>{t('petty.backToList')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );}function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );}const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  body: { padding: 16, paddingBottom: 40 },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18, alignItems: 'center' },
  badge: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 4 },
  badgeIn: { backgroundColor: colors.paleGreen },
  badgeOut: { backgroundColor: colors.paleRed },
  badgeTxt: { fontSize: 12, fontFamily: fonts.bold },
  badgeInTxt: { color: colors.greenDark },
  badgeOutTxt: { color: colors.red },
  heroValue: { fontFamily: fonts.bold, fontSize: 30, color: colors.white, marginTop: 8 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rowLabel: { fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, flex: 1 },
  rowValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, textAlign: 'right', flex: 1.4 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  okTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.greenDark },
  waitTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.amberDark },
  photo: { width: '100%', height: 240, borderRadius: 10, backgroundColor: colors.line, marginTop: 8 },
  noPhoto: { backgroundColor: colors.bg, borderRadius: 10, padding: 20, marginTop: 8, alignItems: 'center' },
  noPhotoTxt: { fontSize: 13, fontFamily: fonts.regular, color: colors.faint, textAlign: 'center' },
  primary: { backgroundColor: colors.green, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  primaryT: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  ghost: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  ghostT: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, alignItems: 'center' },
  modalCardTablet: { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 16 },
  modalTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
  modalHint: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 8, textAlign: 'center' },
  pinDots: { flexDirection: 'row', marginVertical: 18 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.navy, marginHorizontal: 6 },
  dotFill: { backgroundColor: colors.navy },
  pinPad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  pinKey: { width: 72, height: 56, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', margin: 5 },
  pinKeyTxt: { fontSize: 20, fontFamily: fonts.bold, color: colors.navy },
  pinErr: { fontSize: 13, fontFamily: fonts.medium, color: colors.red, textAlign: 'center', marginTop: 4 },
  ghostBtn: { marginTop: 12, padding: 10 },});