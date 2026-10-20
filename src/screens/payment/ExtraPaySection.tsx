import { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../../theme';
import { useLang } from '../../lib/i18n';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import SupervisorApprovalDialog from '../../components/SupervisorApprovalDialog';
import { SUPERVISOR_ACTION_COMPLIMENT_SETTLE, isDecimalOrderId } from '../../lib/supervisor';
import { EXTRA_METHODS, xmDesc, xmLabel, type ExtraMethodId } from '../../lib/payments';

/**
 * Metode pembayaran lanjutan: transfer, deposit member, kompliment,
 * non-penjualan. Dua terakhir wajib otorisasi supervisor via kontrak BE BARU
 * (S7: SupervisorApprovalDialog — legacy {pin} NOL, Real mode 404).
 *
 * COND-2 (PP-028): approval compliment WAJIB action persis
 * COMPLIMENT_SETTLE + refId = id-desimal order BE (BUKAN salesNum/nomor
 * struk). `orderId` = id desimal dari pemanggil bila alur sudah punya order
 * BE (create-first); bila absen/tak-desimal, refId dikosongkan dan TIDAK
 * dikunci — approval itu tercatat tapi TAKKAN cocok untuk settle (403 yang
 * benar). Batas jujur: alur offline-first APP (saveSale lokal → sync
 * order/finish) tak punya id BE pra-approval; who-supplies-orderId adalah
 * keputusan koordinator (E2E memasok via API).
 *
 * OFFLINE-RULE (putusan koordinator): approval compliment WAJIB online +
 * orderId desimal (create-first). Kartu compliment nonaktif + pesan jelas
 * bila offline ATAU orderId absen; refId kosong DILARANG dikirim (gate ganda:
 * di sini, di dialog, di authorizeSupervisorV1).
 */
export default function ExtraPaySection({ onDone, orderId, online }: { onDone: (methodLabel: string, ref?: string, approverUserId?: string) => void; orderId?: string; online?: boolean | null }) {
  // Tablet: kartu 4 sebaris proporsional di dalam konten PayScreen.
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [authFor, setAuthFor] = useState<ExtraMethodId | null>(null);
  // Transfer Bank wajib no. referensi/bukti sebelum lunas (jangan langsung onDone).
  const [refFor, setRefFor] = useState<ExtraMethodId | null>(null);
  const [refNo, setRefNo] = useState('');
  const [refMsg, setRefMsg] = useState('');
  // OFFLINE-RULE: pesan penolakan kartu compliment (offline / tanpa order).
  const [xpMsg, setXpMsg] = useState('');
  const orderIdDecimal = isDecimalOrderId(orderId ?? '');
  const complimentBlocked = online !== true || !orderIdDecimal;

  const tap = (id: ExtraMethodId) => {
    const m = EXTRA_METHODS.find((x) => x.id === id);
    if (!m) return;
    if (id === 'transfer') {
      setRefFor(id);
      setRefNo('');
      setRefMsg('');
      setXpMsg('');
      return;
    }
    // OFFLINE-RULE: compliment WAJIB online + orderId desimal. Tombol
    // nonaktif (lihat disabled kartu) + pesan jelas; tap yang lolos
    // (mis. aksesibilitas) tetap ditolak di sini, jangan buka dialog.
    if (id === 'compliment') {
      if (online !== true) {
        setXpMsg(t('xp_compliment_offline'));
        return;
      }
      if (!orderIdDecimal) {
        setXpMsg(t('xp_compliment_no_order'));
        return;
      }
    }
    if (m.needsAuth) {
      setXpMsg('');
      setAuthFor(id);
      return;
    }
    setXpMsg('');
    onDone(xmLabel(m, t));
  };

  const submitRef = () => {
    const ref = refNo.trim();
    if (ref.length < 3) {
      setRefMsg(t('xp_ref_need'));
      return;
    }
    const m = EXTRA_METHODS.find((x) => x.id === refFor);
    setRefFor(null);
    if (m) onDone(xmLabel(m, t), ref.toUpperCase());
  };

  /** S7: sesudah dialog V1 disetujui — teruskan approvalId (jadi approvalCode
   * di Pay) + ID supervisor (jadi approvedBy). Beda vs lama: dulu ref kosong
   * dan approver hanya ada di jalur lokal; kini audit BE selalu tercatat. */
  const approved = (r: { approvalId?: string; supervisorUserId: string }) => {
    const m = EXTRA_METHODS.find((x) => x.id === authFor);
    setAuthFor(null);
    if (m) onDone(xmLabel(m, t), r.approvalId, r.supervisorUserId || undefined);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('xp_title')}</Text>
      <Text style={styles.hint}>{t('xp_hint')}</Text>
      <View style={styles.grid}>
        {EXTRA_METHODS.map((m) => {
          // OFFLINE-RULE: kartu compliment nonaktif visual bila diblokir.
          const dis = m.id === 'compliment' && complimentBlocked;
          return (
          <TouchableOpacity key={m.id} style={[styles.card, isTablet && styles.cardTablet, dis && styles.cardDisabled]} disabled={dis} onPress={() => tap(m.id)}>
            <Text style={[styles.cardT, isTablet && styles.cardTTablet]}>{xmLabel(m, t)}</Text>
            <Text style={[styles.cardS, isTablet && styles.cardSTablet]}>{xmDesc(m, t)}</Text>
          </TouchableOpacity>
          );
        })}
      </View>
      {xpMsg ? <Text style={styles.msg}>{xpMsg}</Text> : null}

      {/* COND-2: compliment = aksi kanonis COMPLIMENT_SETTLE (konstanta, bukan
          literal 'compliment' — itu 403 permanen yang benar) + refId id-desimal
          order yang DIKUNCI bila pemanggil memasok orderId desimal valid.
          OFFLINE-RULE: dialog ini hanya tercapai bila tap() lolos (online +
          desimal); refId di sini selalu desimal-valid. */}
      <SupervisorApprovalDialog
        visible={authFor !== null}
        action={authFor === 'compliment' ? SUPERVISOR_ACTION_COMPLIMENT_SETTLE : 'non-sales'}
        refId={authFor === 'compliment' && isDecimalOrderId(orderId ?? '') ? (orderId as string).trim() : undefined}
        lockRefId={authFor === 'compliment' && isDecimalOrderId(orderId ?? '')}
        fallbackAccessKey="order.void"
        onApproved={(r) => approved(r)}
        onCancel={() => setAuthFor(null)}
      />

      <Modal visible={refFor !== null} animationType="fade" transparent>
        <View style={styles.wrap}>
          <View style={[styles.dialog, styles.dialogNarrow]}>
            <Text style={styles.dTitle}>{t('xp_ref_title')}</Text>
            <Text style={styles.dSub}>{t('xp_ref_sub')}</Text>
            <AppInput
              placeholder={t('xp_ref_ph')}
              value={refNo}
              onChangeText={(v) => setRefNo(v.toUpperCase().slice(0, 32))}
              autoCapitalize="characters"
            />
            {refMsg ? <Text style={styles.msg}>{refMsg}</Text> : null}
            <View style={styles.btns}>
              <AppButton title={t('xp_cancel')} variant="secondary" onPress={() => setRefFor(null)} fullWidth={false} size="md" style={styles.modalBtn} />
              <AppButton
                title={t('xp_ref_done')}
                disabled={refNo.trim().length < 3}
                onPress={submitRef}
                fullWidth={false}
                size="md"
                style={styles.modalBtn}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 14 },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  card: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
  },
  cardT: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy },
  cardS: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginTop: 2 },
  // OFFLINE-RULE: kartu nonaktif (compliment diblokir offline/tanpa order).
  cardDisabled: { opacity: 0.45 },
  // Tablet: 4 kartu sebaris proporsional dengan teks sedikit besar.
  cardTablet: { flexBasis: '23%', minHeight: 64, padding: 16 },
  cardTTablet: { fontSize: 14 },
  cardSTablet: { fontSize: 12 },
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogNarrow: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  dTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.text,
    marginTop: 12,
    letterSpacing: 4,
    textAlign: 'center',
  },
  msg: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 8, textAlign: 'center' },
  btns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modalBtn: { flex: 1, marginTop: 0 },
  pinField: { textAlign: 'center', letterSpacing: 4 },
  ghost: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  primary: { flex: 1, borderRadius: 10, backgroundColor: colors.navy, paddingVertical: 12, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  disabled: { opacity: 0.5 },
});
