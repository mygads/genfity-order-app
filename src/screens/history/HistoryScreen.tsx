import { useEffect, useMemo, useState } from 'react';import {
  FlatList,
  Modal,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,} from 'react-native';import { TABLET_BP, colors, fonts, rp } from '../../theme';import ScreenHeader from '../../components/ScreenHeader';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import { transactions, type Transaction, type TxnStatus } from '../../data/mock';import { loadHistory, persistPayChangeDb, persistVoidDb } from '../../lib/history';import { isValidEmail, recordReceiptEmail } from '../../lib/payments';import { attemptsLeft, authorizeSupervisor } from '../../lib/supervisor';import {
  useLang } from '../../lib/i18n';function statusColor(s: TxnStatus) {
  if (s === 'Selesai') return colors.greenDark;
  if (s === 'Void') return colors.red;
  return colors.orangeDark;}function statusBg(s: TxnStatus) {
  if (s === 'Selesai') return colors.paleGreen;
  if (s === 'Void') return colors.paleRed;
  return colors.paleOrange;}const billNo = (t: Transaction) => t.no.replace(/^TRX/, 'BILL');const payOf = (t: Transaction, over: Record<string, string>) => over[t.id] ?? t.payment;const PAY_OPTIONS = ['Tunai', 'QRIS', 'EDC', 'Debit', 'Kredit', 'Transfer'];/** Void: tulis DB (head → void + tr_cancelmenu) + outbox/sync/server. */async function persistVoid(t: Transaction, reason: string): Promise<void> { await persistVoidDb(t.no, reason);}/** Ganti metode bayar: tulis DB (payment + head) + outbox/sync/server. */async function persistPayChange(t: Transaction, method: string): Promise<void> { await persistPayChangeDb(t.no, method);}export default function HistoryScreen({ navigation }: { navigation?: { navigate: (s: string, p?: object) => void; goBack?: () => void } }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;

  const { lang, setLang, t } = useLang(); const [query, setQuery] = useState('');
  const [fDate, setFDate] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState<TxnStatus | null>(null);
  const [fPayment, setFPayment] = useState<string | null>(null);
  const [picker, setPicker] = useState<'date' | 'status' | 'payment' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidNote, setVoidNote] = useState('');
  const [voidPin, setVoidPin] = useState('');
  const [voidAuthMsg, setVoidAuthMsg] = useState('');
  const [voidConfirming, setVoidConfirming] = useState(false);
  const [voided, setVoided] = useState<string[]>([]);
  const [payModal, setPayModal] = useState(false);
  const [payOver, setPayOver] = useState<Record<string, string>>({});
  const [mailOpen, setMailOpen] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mailMsg, setMailMsg] = useState('');

  /** Baris DB riil; null = belum dimuat / DB kosong → pakai data demo. */ const [dbTxns, setDbTxns] = useState<Transaction[] | null>(null); useEffect(() => { let live = true; void loadHistory().then((rows) => { if (live && rows.length > 0) setDbTxns(rows); }); return () => { live = false; }; }, []); const base = dbTxns ?? transactions; const STATUS_LABEL: Record<TxnStatus, string> = { Selesai: t('hist_st_done'), Batal: t('hist_st_cancel'), Void: t('hist_st_void'), }; const dates = useMemo(() => [...new Set(base.map((tr) => tr.date))], [base]);
  const payments = useMemo(() => [...new Set(base.map((tr) => tr.payment))], [base]);

  const list = useMemo(() => {
    const rows = base.map((tr) =>
      voided.includes(tr.id) ? { ...tr, status: 'Void' as TxnStatus } : tr,
    );
    const q = query.trim().toLowerCase();
    return rows.filter((tr) => {
      if (fDate && tr.date !== fDate) return false;
      if (fStatus && tr.status !== fStatus) return false;
      if (fPayment && payOf(tr, payOver) !== fPayment) return false;
      if (
        q &&
        !(
          tr.no.toLowerCase().includes(q) ||
          billNo(tr).toLowerCase().includes(q) ||
          tr.cashier.toLowerCase().includes(q) ||
          payOf(tr, payOver).toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [base, query, fDate, fStatus, fPayment, voided, payOver]);

  /** Rekap penjualan dari daftar terfilter: omzet lunas + hitung per metode. */ const recap = useMemo(() => { const paid = list.filter((tr) => tr.status === 'Selesai'); const omzet = paid.reduce((s, tr) => s + tr.total, 0); const byPay: Record<string, number> = {}; for (const tr of paid) { const m = payOf(tr, payOver); byPay[m] = (byPay[m] ?? 0) + tr.total; } return { omzet, count: paid.length, byPay }; }, [list, payOver]); const hasFilter = query.trim() !== '' || fDate !== null || fStatus !== null || fPayment !== null;
  const clearAll = () => {
    setQuery('');
    setFDate(null);
    setFStatus(null);
    setFPayment(null);
  };

  const selected: Transaction | null =
    list.find((tr) => tr.id === selectedId) ?? list[0] ?? null;

  /** Tandai void di state: baris DB diupdate langsung, baris demo via overlay. */ const markVoided = (id: string) => {
    if (dbTxns) { setDbTxns((prev) => prev ? prev.map((r) => (r.id === id ? { ...r, status: 'Void' as TxnStatus } : r)) : prev, ); } else {
    setVoided((v) => (v.includes(id) ? v : [...v, id])); } }; /** PIN supervisor 6 digit wajib sebelum void (pola authorizeSupervisor ala CancelScreen, fail-closed saat offline). */ const voidPinOk = voidPin.replace(/\D/g, '').length === 6 && !voidConfirming; const runVoidAuthed = (print: boolean) => { if (!selected || !voidPinOk) return; const target = selected; const reason = voidNote.trim(); if (!reason) return; setVoidConfirming(true); setVoidAuthMsg(''); void authorizeSupervisor(voidPin).then((res) => { if (!res.ok) {
      setVoidAuthMsg(res.code === 'locked' ? res.message : `${res.message} (${attemptsLeft()} ${t('cx_attempts')})`); setVoidConfirming(false); return; } void persistVoid(target, reason).catch(() => undefined); markVoided(target.id); setVoidConfirming(false); setConfirmVoid(false); setVoidNote(''); setVoidPin(''); setVoidAuthMsg(''); if (print) { navigation?.navigate('Receipt', { no: target.no, total: target.total, method: payOf(target, payOver), voidLines: target.items.map((it) => ({ name: it.name, qty: it.qty, price: it.price })), reason, }); } }); }; const doVoid = () => { runVoidAuthed(false); };

  const doVoidAndPrint = () => { runVoidAuthed(true); }; const changePay = (method: string) => { if (selected) { void persistPayChange(selected, method).catch(() => undefined); if (dbTxns) { const id = selected.id; setDbTxns((prev) => prev ? prev.map((r) => (r.id === id ? { ...r, payment: method } : r)) : prev, ); } else { setPayOver((p) => ({ ...p, [selected.id]: method })); } } setPayModal(false); }; const sendMail = () => {
    if (!selected) return;
    if (!isValidEmail(mailTo)) {
      setMailMsg(t('hist_mail_bad'));
      return;
    }
    recordReceiptEmail(mailTo, selected.no, selected.total, payOf(selected, payOver));
    setMailMsg(t('hist_mail_queued'));
  };

  const pickerOptions: string[] =
    picker === 'date'
      ? dates
      : picker === 'status'
        ? ['Selesai', 'Batal', 'Void']
        : payments;
  const pickerValue =
    picker === 'date' ? fDate : picker === 'status' ? fStatus : fPayment;
  const pick = (v: string) => {
    if (picker === 'date') setFDate(v);
    else if (picker === 'status') setFStatus(v as TxnStatus);
    else if (picker === 'payment') setFPayment(v);
    setPicker(null);
  };

  const langToggle = (<Pressable onPress={() => setLang(lang === 'id' ? 'en' : 'id')} hitSlop={8} accessibilityLabel="Ganti bahasa / Switch language"><Text style={styles.langTxt}>{lang === 'id' ? 'EN' : 'ID'}</Text></Pressable> ); const detail = selected ? (
    <DetailPanel
      txn={selected}
      payment={payOf(selected, payOver)}
      statusLabel={STATUS_LABEL[selected.status]} t={t} onPrint={() =>
        navigation?.navigate('Receipt', {
          no: selected?.no,
          total: selected?.total ?? 0,
          method: selected ? payOf(selected, payOver) : undefined,
        items: selected?.items.map((it) => ({ id: it.name, name: it.name, basePrice: it.price, qty: it.qty, ...(it.note ? { note: it.note } : {}), })), discount: selected?.discount ?? 0, mode: selected?.mode, ...(selected?.table ? { table: selected.table } : {}), })
      }
      onChangePay={() => setPayModal(true)}
      onVoid={() => setConfirmVoid(true)}
      onVoidItem={() => navigation?.navigate('Cancel', { orderId: selected?.no, table: selected?.table ?? '-', cashier: selected?.cashier ?? '-', total: selected?.total ?? 0, }) }
      onEmail={() => { setMailMsg(''); setMailTo(''); setMailOpen(true); }}
      onClose={() => setSelectedId(null)}
      showClose={!isTablet}
    />
  ) : (
    <View style={styles.noSel}>
      <Text style={styles.noSelText}>{t('hist_pick_hint')}</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader title={t('hist_title')} sub={`${t('hist_sales_on')} : ${fDate ?? t('c_all')} - ${list.length} ${t('hist_trx')}`} onBack={() => navigation?.goBack?.()} right={<View style={styles.headRight}>{langToggle}</View>} />

      <View style={[styles.searchRow, !isTablet && styles.searchRowPhone]}>
        {isTablet && <Text style={styles.searchIcon}>⌕</Text>}
        <View style={{ flex: 1 }}>
          <AppInput
            label={t('hist_search_label')}
            placeholder={t('hist_search_ph')}
            value={query}
            onChangeText={setQuery}
            boxStyle={!isTablet ? styles.searchBoxPhone : undefined}
            style={!isTablet ? styles.searchFieldPhone : undefined}
          />
          {!isTablet && (
            <View pointerEvents="none" style={styles.searchAdorn}>
              <Text style={styles.searchAdornIcon}>⌕</Text>
            </View>
          )}
        </View>
        {!isTablet && (
          <AppButton
            title={t('hist_search_btn')}
            fullWidth={false}
            style={styles.searchBtnPhone}
            textStyle={styles.searchBtnTxtPhone}
            onPress={() => Keyboard.dismiss()}
          />
        )}
      </View><View style={styles.filterRow}>
        <Pressable style={styles.filterBtn} onPress={() => setPicker('date')}>
          <Text style={styles.filterIcon}>▦</Text>
          <Text style={styles.filterText} numberOfLines={1}>
            {fDate ?? t('hist_f_date')}
          </Text>
          <Text style={styles.filterCaret}>▾</Text>
        </Pressable>
        <Pressable style={styles.filterBtn} onPress={() => setPicker('status')}>
          <Text style={styles.filterText} numberOfLines={1}>
            {fStatus ? STATUS_LABEL[fStatus] : t('hist_f_status')}
          </Text>
          <Text style={styles.filterCaret}>▾</Text>
        </Pressable>
        <Pressable style={styles.filterBtn} onPress={() => setPicker('payment')}>
          <Text style={styles.filterText} numberOfLines={1}>
            {fPayment ?? t('hist_f_payment')}
          </Text>
          <Text style={styles.filterCaret}>▾</Text>
        </Pressable>
        {hasFilter && (
          <Pressable style={styles.clearBtn} onPress={clearAll} accessibilityLabel={t('hist_clear')}>
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.recapCard}><View style={styles.recapTop}><View style={{ flex: 1 }}>
        <Text style={styles.recapLabel}>{t('hist_omzet')}</Text><Text style={styles.recapValue}>{rp(recap.omzet)}</Text><Text style={styles.recapSub}> {recap.count} {t('hist_trx')} - {t('hist_sales_on')} : {fDate ?? t('c_all')} </Text>{Object.entries(recap.byPay).slice(0, 4).map(([m, v]) => (
        <Text key={m} style={styles.recapLine}> {m} - {rp(v)} </Text> ))}
      </View>

      <View style={[styles.onlinePill, !isTablet && styles.onlinePillPhone]}><View style={styles.onlineDot} /><Text style={[styles.onlineText, !isTablet && styles.onlineTextPhone]}>{t('hist_online')}</Text></View></View><View style={styles.recapBtns}><Pressable style={styles.recapBtn} onPress={() => navigation?.navigate('Recap')}><Text style={styles.recapBtnTxt}>{t('hist_detail_recap')} ›</Text></Pressable><Pressable style={styles.recapBtn} onPress={() => navigation?.navigate('EsbOrder')}><Text style={styles.recapBtnTxt}>{t('hist_esb')} ›</Text></Pressable><Pressable style={styles.recapBtn} onPress={() => navigation?.navigate('Kitchen')}><Text style={styles.recapBtnTxt}>{t('hist_kitchen')} ›</Text></Pressable></View></View>{isTablet ? (
        <View style={styles.split}>
          <View style={styles.splitList}>
            <TxnList
              data={list}
              compact
              selectedId={selected?.id ?? null}
              onSelect={(tr) => setSelectedId(tr.id)} statusLabel={(s) => STATUS_LABEL[s]} emptyTitle={t('hist_empty')} emptySub={t('hist_empty_sub')} t={t}
            />
          </View>
          <View style={styles.splitDetail}>
            <ScrollView contentContainerStyle={styles.detailWrap}>{detail}</ScrollView>
          </View>
        </View>
      ) : (
        <TxnList data={list} selectedId={null} onSelect={(tr) => setSelectedId(tr.id)} statusLabel={(s) => STATUS_LABEL[s]} emptyTitle={t('hist_empty')} emptySub={t('hist_empty_sub')} t={t} />
      )}

      {!isTablet && (
        <Modal visible={selectedId !== null} animationType="slide" transparent>
          <View style={styles.sheetWrap}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <ScrollView>{detail}</ScrollView>
            </View>
          </View>
        </Modal>
      )}

      <Modal visible={picker !== null} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>
              {picker === 'date' ? t('hist_pick_date') : picker === 'status' ? t('hist_f_status') : t('hist_f_payment')}
            </Text>
            {pickerOptions.map((o) => (
              <Pressable
                key={o}
                style={[styles.optRow, pickerValue === o && styles.optRowActive]}
                onPress={() => pick(o)}
              >
                <Text
                  style={[
                    styles.optText,
                    pickerValue === o && styles.optTextActive,
                  ]}
                >
                  {picker === 'status' ? STATUS_LABEL[o as TxnStatus] : o}
                </Text>
              </Pressable>
            ))}
            <AppButton title={t('c_all')} variant="secondary" onPress={() => {
                if (picker === 'date') setFDate(null);
                else if (picker === 'status') setFStatus(null);
                else if (picker === 'payment') setFPayment(null);
                setPicker(null);
              }} />
          </View>
        </View>
      </Modal>

      <Modal visible={payModal} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{t('hist_change_pay')}</Text>
            <Text style={styles.dialogSub}>{selected?.no}</Text>
            {PAY_OPTIONS.map((o) => (
              <Pressable
                key={o}
                style={styles.optRow}
                onPress={() => changePay(o)}
              >
                <Text style={styles.optText}>{o}</Text>
              </Pressable>
            ))}
            <AppButton title={t('c_cancel')} variant="secondary" onPress={() => setPayModal(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={confirmVoid} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{t('hist_void_title')}</Text>
            <Text style={styles.dialogSub}>
              {t('hist_void_title')} {selected?.no}
            </Text>
            <AppInput
              label={t('hist_void_reason_ph')}
              placeholder={t('hist_void_reason_ph')}
              value={voidNote}
              onChangeText={setVoidNote}
              multiline
              boxStyle={styles.noteBox}
              style={styles.noteField}
            />
            <AppInput
              label={t('cx_pin')}
              placeholder={t('cx_pin_ph')}
              value={voidPin}
              onChangeText={(txt) => { setVoidPin(txt.replace(/\D/g, '').slice(0, 6)); setVoidAuthMsg(''); }}
              keyboardType="numeric"
              maxLength={6}
              secureTextEntry
            />
            {voidAuthMsg ? <Text style={styles.authErr}>{voidAuthMsg}</Text> : null}
            <View style={styles.dialogBtns}>
              <AppButton
                title={t('c_cancel')}
                variant="secondary"
                onPress={() => {
                  setConfirmVoid(false);
                  setVoidNote('');
                  setVoidPin('');
                  setVoidAuthMsg('');
                }}
                fullWidth={false}
                style={styles.dialogBtn}
              />
              <AppButton
                title={voidConfirming ? '...' : t('hist_void_yes')}
                variant="danger"
                disabled={!voidNote.trim() || !voidPinOk}
                onPress={doVoid}
                fullWidth={false}
                style={styles.dialogBtn}
              />
            </View>
          <AppButton title={voidConfirming ? '...' : t('hist_void_print')} disabled={!voidNote.trim() || !voidPinOk} onPress={doVoidAndPrint} /></View>
        </View>
      </Modal>

      <Modal visible={mailOpen} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{t('hist_mail_title')}</Text>
            <Text style={styles.dialogSub}>{selected?.no} - {selected ? rp(selected.total) : ''}</Text>
            <AppInput
              label={t('hist_email')}
              placeholder={t('hist_mail_ph')}
              keyboardType="email-address"
              autoCapitalize="none"
              value={mailTo}
              onChangeText={setMailTo}
            />
            {mailMsg ? <Text style={styles.mailMsg}>{mailMsg}</Text> : null}
            <View style={styles.dialogBtns}>
              <AppButton title={t('c_close')} variant="secondary" onPress={() => setMailOpen(false)} fullWidth={false} style={styles.dialogBtn} />
              <AppButton title={t('hist_mail_send')} onPress={sendMail} fullWidth={false} style={styles.dialogBtn} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );}function TxnList({
  data,
  compact,
  selectedId,
  onSelect,
statusLabel, emptyTitle, emptySub, t,}: {
  data: Transaction[];
  compact?: boolean;
  selectedId: string | null;
  onSelect: (tr: Transaction) => void;
statusLabel: (s: TxnStatus) => string; emptyTitle: string; emptySub: string; t: (k: string) => string;}) {
  return (
    <FlatList
      data={data}
      keyExtractor={(tr) => tr.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptySub}>{emptySub}</Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={[styles.card, item.id === selectedId && styles.cardSelected]}
          onPress={() => onSelect(item)}
        >
          {compact ? (
            <>
              <View style={styles.cardTop}>
                <Text style={styles.cardDate}>
                  {item.date} {item.time}
                </Text>
                <View style={[styles.badge, { backgroundColor: statusBg(item.status) }]}>
                  <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>
                    {statusLabel(item.status)}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardNo}>{item.no}</Text>
              <View style={styles.cardBottom}>
                <Text style={styles.cardMeta}>{item.payment}</Text>
                <Text style={styles.cardTotal}>{rp(item.total)}</Text>
              </View>
            </>
          ) : (
            <View style={styles.cardCols}>
              <View style={styles.cardColL}>
                <Field label={t('hist_col_date')} value={`${item.date} ${item.time}`} />
                <Field label={t('hist_col_extra')} value={item.cashier} />
                <Field label={t('hist_col_trxno')} value={item.no} />
                <Field label={t('hist_col_billno')} value={billNo(item)} />
              </View>
              <View style={styles.cardColR}>
                <Text style={styles.fieldLabel}>{t('hist_col_status')}</Text>
                <View style={[styles.badge, { backgroundColor: statusBg(item.status) }]}>
                  <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>
                    {statusLabel(item.status)}
                  </Text>
                </View>
                <Field label={t('hist_col_total')} value={rp(item.total)} bold />
                <Field label={t('hist_col_pay')} value={item.payment} />
              </View>
            </View>
          )}
        </Pressable>
      )}
    />
  );}function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, bold && styles.fieldValueBold]}>{value}</Text>
    </View>
  );}function DetailPanel({
  txn,
  payment,
  statusLabel, t, onPrint,
  onChangePay,
  onVoid,
  onVoidItem,
  onEmail,
  onClose,
  showClose,}: {
  txn: Transaction;
  payment: string;
  statusLabel: string; t: (k: string) => string; onPrint: () => void;
  onChangePay: () => void;
  onVoid: () => void;
  onVoidItem: () => void;
  onEmail: () => void;
  onClose: () => void;
  showClose: boolean;}) {
  const qty = txn.items.reduce((a, i) => a + i.qty, 0);
  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <View>
          <Text style={styles.detailMode}>
            {txn.mode} - {t('c_cashier')} {txn.cashier}
          </Text>
          <Text style={styles.detailNo}>
            {txn.no} - {txn.date} {txn.time}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: statusBg(txn.status) }]}>
          <Text style={[styles.badgeText, { color: statusColor(txn.status) }]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      <View style={styles.payRow}>
        <Text style={styles.rowLabel}>{t('hist_pay_method')}</Text>
        <Text style={styles.rowValue}>{payment}</Text>
      </View>

      <View style={styles.payRow}><Text style={styles.rowLabel}>{t('hist_mode')}</Text><Text style={styles.rowValue}>{txn.mode}</Text></View><View style={styles.payRow}><Text style={styles.rowLabel}>{t('c_table')}</Text><Text style={styles.rowValue}>{txn.table ?? '-'}</Text></View><View style={styles.payRow}><Text style={styles.rowLabel}>{t('c_cashier')}</Text><Text style={styles.rowValue}>{txn.cashier}</Text></View><View style={styles.divider} />
      {txn.items.map((it, idx) => (
        <View key={idx} style={styles.itemRow}>
          <View style={styles.qtyCircle}>
            <Text style={styles.qtyText}>{it.qty}</Text>
          </View>
          <View style={styles.itemMid}>
            <Text style={styles.itemName}>{it.name}</Text>
            {it.note ? <Text style={styles.itemNote}>{it.note}</Text> : null}
            {txn.discount > 0 ? (
              <Text style={styles.itemDisc}>Diskon {rp(txn.discount)}</Text>
            ) : null}
          </View>
          <Text style={styles.itemPrice}>{rp(it.qty * it.price)}</Text>
        </View>
      ))}
      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t('hist_qty')}</Text>
        <Text style={styles.rowValue}>{qty} {t('hist_items')}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t('c_subtotal')}</Text>
        <Text style={styles.rowValue}>{rp(txn.subtotal)}</Text></View><View style={styles.row}><Text style={styles.totalLabel}>{t('c_total')}</Text><Text style={styles.totalValue}>{rp(txn.total)}</Text>
      </View>

      <View style={styles.detailBtns}>
        <AppButton title={t('c_reprint')} variant="secondary" onPress={onPrint} fullWidth={false} style={styles.detailBtn} />
        <AppButton title={t('hist_email')} variant="secondary" onPress={onEmail} fullWidth={false} style={styles.detailBtn} />
        {txn.status === 'Selesai' && (
          <AppButton title={t('hist_change_pay')} onPress={onChangePay} fullWidth={false} style={styles.detailBtn} />
        )}
        {txn.status === 'Selesai' && (
          <AppButton title={t('hist_void')} variant="danger" onPress={onVoid} fullWidth={false} style={styles.detailBtn} />
        )}
        {txn.status === 'Selesai' && (
          <AppButton title={`${t('hist_void_item')} ›`} variant="secondary" onPress={onVoidItem} fullWidth={false} style={styles.detailBtn} />
        )}
        {showClose && (
          <AppButton title={t('c_close')} variant="secondary" onPress={onClose} fullWidth={false} style={styles.detailBtn} />
        )}
      </View>
    </View>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headRight: {

    flexDirection: 'row',

    alignItems: 'center',
   gap: 12 },
  langTxt: { color: colors.white,  fontFamily: fonts.bold, fontSize: 13 },
  burger: { width: 22, height: 22 },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paleGreen,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  onlineText: { fontFamily: fonts.bold, fontSize: 12, color: colors.green },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
  paddingVertical: 6, },
  searchIcon: { fontSize: 16, color: colors.faint, marginRight: 8 },
  /** Phone: baris polos tanpa kotak ganda - ikon di dalam input + tombol compact. */
  searchRowPhone: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'flex-end',
    gap: 8,
  },
  searchBoxPhone: { height: 46, borderRadius: 10 },
  searchFieldPhone: { paddingLeft: 26, fontSize: 13 },
  searchAdorn: {
    position: 'absolute',
    left: 12,
    bottom: 0,
    height: 46,
    justifyContent: 'center',
  },
  searchAdornIcon: { fontSize: 15, color: colors.faint },
  searchBtnPhone: {
    marginTop: 0,
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.navy,
  },
  searchBtnTxtPhone: { fontSize: 13 },
  /** Phone: label Online compact - tidak memenuhi tinggi kartu rekap. */
  onlinePillPhone: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4 },
  onlineTextPhone: { fontSize: 12 },
  search: {
    flex: 1,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
  },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8, alignItems: 'center' },
  filterBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 6,
  },
  filterIcon: { fontSize: 14 },
  filterText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  filterCaret: { fontSize: 11, color: colors.faint },
  clearBtn: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  recapCard: {
    backgroundColor: colors.navy, borderRadius: 12, marginHorizontal: 16, marginTop: 12, padding: 14, }, recapTop: { flexDirection: 'row',
    gap: 10
  },
  recapLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.navyTint }, recapValue: { fontFamily: fonts.bold, fontSize: 22, color: colors.white, marginTop: 4 }, recapSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  recapLine: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 2 }, recapBtns: { flexDirection: 'row', gap: 8, marginTop: 10 }, recapBtn: { flex: 1, backgroundColor: colors.white, borderRadius: 8, paddingVertical: 9, alignItems: 'center', }, recapBtnTxt: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  split: { flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 12 },
  splitList: { flex: 1, minWidth: 0 },
  splitDetail: {
    flex: 1.1,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  detailWrap: { padding: 16, flexGrow: 1 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardSelected: { borderColor: colors.navy, borderWidth: 2 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  cardNo: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, marginTop: 6 },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  cardMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint },
  cardTotal: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  cardCols: { flexDirection: 'row', gap: 12 },
  cardColL: { flex: 1.2, minWidth: 0 },
  cardColR: { flex: 1, minWidth: 0 },
  field: { marginBottom: 7 },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted },
  fieldValue: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, marginTop: 1 },
  fieldValueBold: { fontFamily: fonts.bold, color: colors.navy, fontSize: 14 },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { fontFamily: fonts.bold, fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 4 },
  detail: { backgroundColor: colors.card, borderRadius: 12 },
  detailHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 10,
  },
  detailMode: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
  detailNo: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  qtyCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    flexShrink: 0,
  },
  qtyText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  itemMid: { flex: 1, paddingRight: 10 },
  itemName: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  itemNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, fontStyle: 'italic' },
  itemDisc: { fontFamily: fonts.regular, fontSize: 11, color: colors.green },
  itemPrice: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  rowLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  rowValue: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  totalLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  totalValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  detailBtns: { flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  btnPrint: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.navy,
    paddingVertical: 12,
    alignItems: 'center',
    minWidth: 100,
  marginTop: 8, paddingHorizontal: 16, },
  btnPrintText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnChange: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.orange,
    paddingVertical: 12,
    alignItems: 'center',
    minWidth: 100,
  },
  btnChangeText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnVoid: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.red,
    paddingVertical: 12,
    alignItems: 'center',
    minWidth: 80,
  },
  btnVoidText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  btnGhost: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  btnGhostText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  btnDisabled: { opacity: 0.45 },
  noSel: { alignItems: 'center', paddingTop: 60 },
  noSelText: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    maxHeight: '88%',
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.line,
    alignSelf: 'center',
    marginBottom: 12,
  },
  centerWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  dialogTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginBottom: 6 },
  dialogSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginBottom: 8 },
  optRow: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: 8,
  },
  optRowActive: { borderColor: colors.navy, backgroundColor: colors.paleBlue },
  optText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  optTextActive: { color: colors.navy },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
    marginTop: 6,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  mailInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
    marginTop: 6,
  },
  mailMsg: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 8 },
  authErr: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 8 },
  dialogBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  dialogBtn: { flex: 1, marginTop: 0 },
  detailBtn: { flex: 1, minWidth: 100, marginTop: 8 },
  noteBox: { minHeight: 72, height: 'auto', alignItems: 'flex-start', paddingVertical: 10 },
  noteField: { textAlignVertical: 'top' },});