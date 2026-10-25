import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { useLang } from '../lib/i18n';
import AppInput from './AppInput';
import AppButton from './AppButton';
import {
  attemptsLeft,
  authorizeSupervisorV1,
  getBoundSupervisorTerminalId,
  isDecimalOrderId,
  SUPERVISOR_ACTION_COMPLIMENT_SETTLE,
  verifyLocalEscalation,
} from '../lib/supervisor';

/**
 * Dialog persetujuan supervisor BERSAMA (S7, PP-001/PP-016) untuk alur
 * void/eskalasi/compliment via kontrak BE BARU
 * POST /api/v1/terminals/{id}/supervisor-approve {supervisorUserId,
 * supervisorPin, action, refId, reason}.
 *
 * Beda vs modal PIN lama: identitas supervisor EKSPLISIT (ID numerik BE —
 * APP tak punya roster staf, E18 MISSING-BE, jadi input manual; follow-up
 * owner: endpoint roster) + aksi/refId preset dari pemanggil + alasan WAJIB
 * (tercatat append-only di pos_supervisor_approvals).
 *
 * Offline-first (paritas pola lama): server dulu via authorizeSupervisorV1;
 * bila offline/unconfigured → fallback verifyLocalEscalation PIN lokal +
 * cek hak fallbackAccessKey; PIN salah/tanpa hak tetap fail-closed.
 * Legacy auth/supervisor-approve {pin} NOL dipakai alur-alur ini (Real=404).
 */
export interface SupervisorApprovalResult {
  /** ID baris pos_supervisor_approvals; undefined = disetujui jalur lokal. */
  approvalId?: string;
  approvedAt?: string;
  /** ID numerik BE supervisor (string angka) — untuk jejak audit pemanggil. */
  supervisorUserId: string;
  action: string;
  refId: string;
}

interface SupervisorApprovalDialogProps {
  visible: boolean;
  /** Preset aksi 1..64 char — void/refund WAJIB konstanta kanonis
   * (SUPERVISOR_ACTION_ORDER_VOID/REFUND, bukan literal lowercase; compliment =
   * SUPERVISOR_ACTION_COMPLIMENT_SETTLE via ExtraPaySection) — tampil statis. */
  action: string;
  /** Ref default (order/item id); pemanggil boleh biarkan pemohon ubah. */
  refId?: string;
  /**
   * COND-2: kunci refId (tampil statis, tak bisa diubah pemohon). WAJIB true
   * bila refId = id-desimal order untuk approval COMPLIMENT_SETTLE — satu
   * digit diubah = approval tak cocok = settle 403. Untuk aksi bebas lain
   * (void/cancel/refund) biarkan false (default).
   */
  lockRefId?: boolean;
  /** Alasan awal (cth. alasan void layar); tetap bisa diubah, wajib diisi. */
  reasonPreset?: string;
  /** Hak untuk fallback lokal: 'order.void' | 'order.cancel' | 'sale.refund'. */
  fallbackAccessKey: string;
  title?: string;
  sub?: string;
  onApproved: (r: SupervisorApprovalResult) => void;
  onCancel: () => void;
}

export default function SupervisorApprovalDialog({
  visible,
  action,
  refId: refIdProp,
  lockRefId,
  reasonPreset,
  fallbackAccessKey,
  title,
  sub,
  onApproved,
  onCancel,
}: SupervisorApprovalDialogProps) {
  const { t } = useLang();
  const [boundTerminal, setBoundTerminal] = useState('');
  const [terminalManual, setTerminalManual] = useState('');
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [refId, setRefId] = useState(refIdProp ?? '');
  const [reason, setReason] = useState(reasonPreset ?? '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset tiap dibuka; resolve ID terminal BE yang ter-bound (sinkron).
  useEffect(() => {
    if (!visible) return;
    setBoundTerminal(getBoundSupervisorTerminalId());
    setTerminalManual('');
    setUserId('');
    setPin('');
    setRefId(refIdProp ?? '');
    setReason(reasonPreset ?? '');
    setMsg('');
    setBusy(false);
  }, [visible, refIdProp, reasonPreset]);

  const terminalId = (boundTerminal || terminalManual).trim();
  const userIdNum = Number((userId || '').replace(/[^0-9]/g, ''));
  // OFFLINE-RULE: compliment = aksi kanonis; refId wajib id-desimal (tombol
  // tak bisa submit selama kosong — pesan petunjuk tampil di bawah field).
  const isCompliment = action === SUPERVISOR_ACTION_COMPLIMENT_SETTLE;
  const canSubmit =
    !busy &&
    terminalId.length > 0 &&
    Number.isInteger(userIdNum) &&
    userIdNum > 0 &&
    pin.replace(/[^0-9]/g, '').length >= 4 &&
    reason.trim().length >= 1 &&
    (!isCompliment || isDecimalOrderId(refId));

  const approve = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setMsg(t('xp_requesting'));
    const ref = refId.trim();
    let r = await authorizeSupervisorV1({
      terminalId,
      supervisorUserId: userIdNum,
      supervisorPin: pin,
      action,
      refId: ref,
      reason: reason.trim(),
    });
    // Offline-first: cocokkan PIN lokal milik pemegang hak (fail-closed).
    // OFFLINE-RULE: compliment DILARANG lewat fallback lokal — approval lokal
    // tak punya approvalId dan settle BE pasti 403. Tampilkan syarat online.
    if (!r.ok && (r.code === 'offline' || r.code === 'unconfigured')) {
      setBusy(false);
      if (isCompliment) {
        setMsg(t('xp_compliment_offline'));
        return;
      }
      const local = await verifyLocalEscalation(pin, fallbackAccessKey);
      setBusy(false);
      if (!local.ok) {
        setMsg(local.code === 'locked' ? local.message : `${local.message} (${attemptsLeft()} ${t('cx_attempts')})`);
        return;
      }
      onApproved({ supervisorUserId: local.userId ?? '', action, refId: ref });
      return;
    }
    setBusy(false);
    if (!r.ok) {
      setMsg(r.code === 'locked' ? r.message : `${r.message} (${attemptsLeft()} ${t('cx_attempts')})`);
      return;
    }
    onApproved({
      ...(r.approvalId ? { approvalId: r.approvalId } : {}),
      ...(r.approvedAt ? { approvedAt: r.approvedAt } : {}),
      supervisorUserId: String(userIdNum),
      action,
      refId: ref,
    });
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.wrap}>
        <View style={[styles.dialog, styles.dialogNarrow]}>
          <Text style={styles.dTitle}>{title ?? t('xp_auth_title')}</Text>
          <Text style={styles.dSub}>{sub ?? t('xp_auth_sub')}</Text>
          <Text style={styles.fieldLabel}>{t('sup_v1_action')}</Text>
          <Text style={styles.staticVal}>{action}</Text>
          {boundTerminal ? (
            <Text style={styles.staticVal}>ID terminal BE: {boundTerminal}</Text>
          ) : (
            <>
              <Text style={styles.fieldLabel}>{t('sup_v1_terminal')}</Text>
              <AppInput
                keyboardType="numeric"
                placeholder={t('sup_v1_terminal_ph')}
                value={terminalManual}
                onChangeText={(v) => setTerminalManual(v.replace(/[^0-9]/g, '').slice(0, 10))}
              />
            </>
          )}
          <Text style={styles.fieldLabel}>{t('sup_v1_userid')}</Text>
          <AppInput
            keyboardType="numeric"
            placeholder={t('sup_v1_userid_ph')}
            value={userId}
            onChangeText={(v) => setUserId(v.replace(/[^0-9]/g, '').slice(0, 10))}
          />
          <Text style={styles.fieldLabel}>{t('sup_v1_refid')}</Text>
          {lockRefId ? (
            <Text style={styles.staticVal}>{refId || '—'}</Text>
          ) : (
          <AppInput
            placeholder={t('sup_v1_refid_ph')}
            value={refId}
            onChangeText={(v) => setRefId(v.slice(0, 128))}
            autoCapitalize="characters"
          />
          )}
          {isCompliment && !isDecimalOrderId(refId) ? (
            <Text style={styles.msg}>{t('sup_v1_refid_need')}</Text>
          ) : null}
          <Text style={styles.fieldLabel}>{t('sup_v1_reason')}</Text>
          <AppInput
            placeholder={t('sup_v1_reason_ph')}
            value={reason}
            onChangeText={(v) => setReason(v.slice(0, 500))}
          />
          <Text style={styles.fieldLabel}>{t('cx_pin')}</Text>
          <AppInput
            keyboardType="numeric"
            maxLength={8}
            secureTextEntry
            placeholder={t('xp_pin_ph')}
            value={pin}
            onChangeText={(v) => setPin(v.replace(/[^0-9]/g, '').slice(0, 8))}
            style={styles.pinField}
          />
          {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          <View style={styles.btns}>
            <AppButton title={t('xp_cancel')} variant="secondary" disabled={busy} onPress={onCancel} fullWidth={false} size="md" style={styles.modalBtn} />
            <AppButton
              title={busy ? t('xp_checking') : t('xp_approve')}
              disabled={!canSubmit}
              onPress={() => { void approve(); }}
              fullWidth={false}
              size="md"
              style={styles.modalBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogNarrow: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  dTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  dSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 10 },
  staticVal: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginTop: 2 },
  msg: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 8, textAlign: 'center' },
  btns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modalBtn: { flex: 1, marginTop: 0 },
  pinField: { textAlign: 'center', letterSpacing: 4 },
});
