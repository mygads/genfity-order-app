import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, rp } from '../../theme';
import { transactions, type Transaction, type TxnStatus } from '../../data/mock';
import { isValidEmail, recordReceiptEmail } from '../../lib/payments';

const STATUS_LABEL: Record<TxnStatus, string> = {
  Selesai: 'Berhasil',
  Batal: 'Dibatalkan',
  Void: 'Void',
};

function statusColor(s: TxnStatus) {
  if (s === 'Selesai') return colors.greenDark;
  if (s === 'Void') return colors.red;
  return colors.orangeDark;
}

function statusBg(s: TxnStatus) {
  if (s === 'Selesai') return colors.paleGreen;
  if (s === 'Void') return colors.paleRed;
  return colors.paleOrange;
}

const billNo = (t: Transaction) => t.no.replace(/^TRX/, 'BILL');
const payOf = (t: Transaction, over: Record<string, string>) => over[t.id] ?? t.payment;

const PAY_OPTIONS = ['Tunai', 'QRIS', 'EDC', 'Debit', 'Kredit', 'Transfer'];

export default function HistoryScreen({ navigation }: { navigation?: { navigate: (s: string, p?: object) => void; goBack?: () => void } }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const [query, setQuery] = useState('');
  const [fDate, setFDate] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState<TxnStatus | null>(null);
  const [fPayment, setFPayment] = useState<string | null>(null);
  const [picker, setPicker] = useState<'date' | 'status' | 'payment' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidNote, setVoidNote] = useState('');
  const [voided, setVoided] = useState<string[]>([]);
  const [payModal, setPayModal] = useState(false);
  const [payOver, setPayOver] = useState<Record<string, string>>({});
  const [mailOpen, setMailOpen] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mailMsg, setMailMsg] = useState('');

  const dates = useMemo(() => [...new Set(transactions.map((t) => t.date))], []);
  const payments = useMemo(() => [...new Set(transactions.map((t) => t.payment))], []);

  const list = useMemo(() => {
    const rows = transactions.map((t) =>
      voided.includes(t.id) ? { ...t, status: 'Void' as TxnStatus } : t,
    );
    const q = query.trim().toLowerCase();
    return rows.filter((t) => {
      if (fDate && t.date !== fDate) return false;
      if (fStatus && t.status !== fStatus) return false;
      if (fPayment && payOf(t, payOver) !== fPayment) return false;
      if (
        q &&
        !(
          t.no.toLowerCase().includes(q) ||
          billNo(t).toLowerCase().includes(q) ||
          t.cashier.toLowerCase().includes(q) ||
          payOf(t, payOver).toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [query, fDate, fStatus, fPayment, voided, payOver]);

  const hasFilter = query.trim() !== '' || fDate !== null || fStatus !== null || fPayment !== null;
  const clearAll = () => {
    setQuery('');
    setFDate(null);
    setFStatus(null);
    setFPayment(null);
  };

  const selected: Transaction | null =
    list.find((t) => t.id === selectedId) ?? list[0] ?? null;

  const doVoid = () => {
    if (!selected) return;
    setVoided((v) => (v.includes(selected.id) ? v : [...v, selected.id]));
    setConfirmVoid(false);
    setVoidNote('');
  };

  const sendMail = () => {
    if (!selected) return;
    if (!isValidEmail(mailTo)) {
      setMailMsg('Alamat email tidak valid.');
      return;
    }
    recordReceiptEmail(mailTo, selected.no, selected.total, payOf(selected, payOver));
    setMailMsg('Struk masuk antrean kirim — terkirim saat online.');
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

  const detail = selected ? (
    <DetailPanel
      txn={selected}
      payment={payOf(selected, payOver)}
      onPrint={() =>
        navigation?.navigate('Receipt', {
          no: selected?.no,
          total: selected?.total ?? 0,
          method: selected ? payOf(selected, payOver) : undefined,
        })
      }
      onChangePay={() => setPayModal(true)}
      onVoid={() => setConfirmVoid(true)}
      onVoidItem={() => navigation?.navigate('Cancel', { orderId: selected?.no })}
      onEmail={() => { setMailMsg(''); setMailTo(''); setMailOpen(true); }}
      onClose={() => setSelectedId(null)}
      showClose={!isTablet}
    />
  ) : (
    <View style={styles.noSel}>
      <Text style={styles.noSelText}>Pilih transaksi untuk melihat detail</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.backBtn} onPress={() => navigation?.goBack?.()}>‹</Text>
          <Text style={styles.histIcon}>◷</Text>
          <Text style={styles.headerTitle}>Riwayat Penjualan</Text>
        </View>
        <View style={styles.onlinePill}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>Online</Text>
          <Text style={styles.onlineCaret}>▾</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.search}
          placeholder="Cari nomor transaksi / tagihan"
          placeholderTextColor={colors.faint}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <View style={styles.filterRow}>
        <Pressable style={styles.filterBtn} onPress={() => setPicker('date')}>
          <Text style={styles.filterIcon}>▦</Text>
          <Text style={styles.filterText} numberOfLines={1}>
            {fDate ?? 'Tanggal'}
          </Text>
          <Text style={styles.filterCaret}>▾</Text>
        </Pressable>
        <Pressable style={styles.filterBtn} onPress={() => setPicker('status')}>
          <Text style={styles.filterText} numberOfLines={1}>
            {fStatus ? STATUS_LABEL[fStatus] : 'Status'}
          </Text>
          <Text style={styles.filterCaret}>▾</Text>
        </Pressable>
        <Pressable style={styles.filterBtn} onPress={() => setPicker('payment')}>
          <Text style={styles.filterText} numberOfLines={1}>
            {fPayment ?? 'Pembayaran'}
          </Text>
          <Text style={styles.filterCaret}>▾</Text>
        </Pressable>
        {hasFilter && (
          <Pressable style={styles.clearBtn} onPress={clearAll} accessibilityLabel="Bersihkan filter">
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryLeft}>Penjualan Tanggal : {fDate ?? 'Semua'}</Text>
        <Text style={styles.summaryRight}>{list.length} TRANSAKSI</Text>
      </View>

      {isTablet ? (
        <View style={styles.split}>
          <View style={styles.splitList}>
            <TxnList
              data={list}
              compact
              selectedId={selected?.id ?? null}
              onSelect={(t) => setSelectedId(t.id)}
            />
          </View>
          <View style={styles.splitDetail}>
            <ScrollView contentContainerStyle={styles.detailWrap}>{detail}</ScrollView>
          </View>
        </View>
      ) : (
        <TxnList data={list} selectedId={null} onSelect={(t) => setSelectedId(t.id)} />
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
              {picker === 'date' ? 'Pilih Tanggal' : picker === 'status' ? 'Status' : 'Pembayaran'}
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
            <Pressable
              style={styles.btnGhost}
              onPress={() => {
                if (picker === 'date') setFDate(null);
                else if (picker === 'status') setFStatus(null);
                else if (picker === 'payment') setFPayment(null);
                setPicker(null);
              }}
            >
              <Text style={styles.btnGhostText}>Semua</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={payModal} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Ubah Pembayaran</Text>
            <Text style={styles.dialogSub}>{selected?.no}</Text>
            {PAY_OPTIONS.map((o) => (
              <Pressable
                key={o}
                style={styles.optRow}
                onPress={() => {
                  if (selected) setPayOver((p) => ({ ...p, [selected.id]: o }));
                  setPayModal(false);
                }}
              >
                <Text style={styles.optText}>{o}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.btnGhost} onPress={() => setPayModal(false)}>
              <Text style={styles.btnGhostText}>Batal</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={confirmVoid} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Void Transaksi?</Text>
            <Text style={styles.dialogSub}>
              Transaksi {selected?.no} akan dibatalkan dan tercatat pada Cetak Rincian Void.
            </Text>
            <TextInput
              style={styles.noteInput}
              placeholder="Alasan pembatalan (wajib)"
              placeholderTextColor={colors.faint}
              value={voidNote}
              onChangeText={setVoidNote}
              multiline
            />
            <View style={styles.dialogBtns}>
              <Pressable
                style={styles.btnGhost}
                onPress={() => {
                  setConfirmVoid(false);
                  setVoidNote('');
                }}
              >
                <Text style={styles.btnGhostText}>Batal</Text>
              </Pressable>
              <Pressable
                style={[styles.btnVoid, !voidNote.trim() && styles.btnDisabled]}
                disabled={!voidNote.trim()}
                onPress={doVoid}
              >
                <Text style={styles.btnVoidText}>Ya, Void</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={mailOpen} animationType="fade" transparent>
        <View style={styles.centerWrap}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Kirim Struk via Email</Text>
            <Text style={styles.dialogSub}>{selected?.no} · {selected ? rp(selected.total) : ''}</Text>
            <TextInput
              style={styles.mailInput}
              placeholder="nama@email.com"
              placeholderTextColor={colors.faint}
              keyboardType="email-address"
              autoCapitalize="none"
              value={mailTo}
              onChangeText={setMailTo}
            />
            {mailMsg ? <Text style={styles.mailMsg}>{mailMsg}</Text> : null}
            <View style={styles.dialogBtns}>
              <Pressable style={styles.btnGhost} onPress={() => setMailOpen(false)}>
                <Text style={styles.btnGhostText}>Tutup</Text>
              </Pressable>
              <Pressable style={styles.btnPrint} onPress={sendMail}>
                <Text style={styles.btnPrintText}>Kirim</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TxnList({
  data,
  compact,
  selectedId,
  onSelect,
}: {
  data: Transaction[];
  compact?: boolean;
  selectedId: string | null;
  onSelect: (t: Transaction) => void;
}) {
  return (
    <FlatList
      data={data}
      keyExtractor={(t) => t.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Belum Ada Transaksi</Text>
          <Text style={styles.emptySub}>Transaksi yang selesai akan tercatat di sini</Text>
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
                    {STATUS_LABEL[item.status]}
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
                <Field label="Tanggal" value={`${item.date} ${item.time}`} />
                <Field label="Info tambahan" value={item.cashier} />
                <Field label="Nomor Transaksi" value={item.no} />
                <Field label="Nomor Bill" value={billNo(item)} />
              </View>
              <View style={styles.cardColR}>
                <Text style={styles.fieldLabel}>Status</Text>
                <View style={[styles.badge, { backgroundColor: statusBg(item.status) }]}>
                  <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>
                    {STATUS_LABEL[item.status]}
                  </Text>
                </View>
                <Field label="Total Penjualan" value={rp(item.total)} bold />
                <Field label="Metode Pembayaran" value={item.payment} />
              </View>
            </View>
          )}
        </Pressable>
      )}
    />
  );
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, bold && styles.fieldValueBold]}>{value}</Text>
    </View>
  );
}

function DetailPanel({
  txn,
  payment,
  onPrint,
  onChangePay,
  onVoid,
  onVoidItem,
  onEmail,
  onClose,
  showClose,
}: {
  txn: Transaction;
  payment: string;
  onPrint: () => void;
  onChangePay: () => void;
  onVoid: () => void;
  onVoidItem: () => void;
  onEmail: () => void;
  onClose: () => void;
  showClose: boolean;
}) {
  const qty = txn.items.reduce((a, i) => a + i.qty, 0);
  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <View>
          <Text style={styles.detailMode}>
            {txn.mode} • Kasir {txn.cashier}
          </Text>
          <Text style={styles.detailNo}>
            {txn.no} • {txn.date} {txn.time}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: statusBg(txn.status) }]}>
          <Text style={[styles.badgeText, { color: statusColor(txn.status) }]}>
            {STATUS_LABEL[txn.status]}
          </Text>
        </View>
      </View>

      <View style={styles.payRow}>
        <Text style={styles.rowLabel}>Metode Pembayaran</Text>
        <Text style={styles.rowValue}>{payment}</Text>
      </View>

      <View style={styles.divider} />
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
        <Text style={styles.rowLabel}>Kuantitas</Text>
        <Text style={styles.rowValue}>{qty}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.totalLabel}>TOTAL</Text>
        <Text style={styles.totalValue}>{rp(txn.total)}</Text>
      </View>

      <View style={styles.detailBtns}>
        <Pressable style={styles.btnPrint} onPress={onPrint}>
          <Text style={styles.btnPrintText}>Cetak Ulang</Text>
        </Pressable>
        <Pressable style={styles.btnPrint} onPress={onEmail}>
          <Text style={styles.btnPrintText}>Email</Text>
        </Pressable>
        {txn.status === 'Selesai' && (
          <Pressable style={styles.btnChange} onPress={onChangePay}>
            <Text style={styles.btnChangeText}>Ubah Pembayaran</Text>
          </Pressable>
        )}
        {txn.status === 'Selesai' && (
          <Pressable style={styles.btnVoid} onPress={onVoid}>
            <Text style={styles.btnVoidText}>Void</Text>
          </Pressable>
        )}
        {txn.status === 'Selesai' && (
          <Pressable style={styles.btnGhost} onPress={onVoidItem}>
            <Text style={styles.btnGhostText}>Void per Item ›</Text>
          </Pressable>
        )}
        {showClose && (
          <Pressable style={styles.btnGhost} onPress={onClose}>
            <Text style={styles.btnGhostText}>Tutup</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    paddingTop: 52,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { color: colors.white, fontSize: 26, fontFamily: fonts.bold },
  histIcon: { color: colors.white, fontSize: 18 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 19, color: colors.white },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  onlineText: { fontFamily: fonts.bold, fontSize: 12, color: colors.green },
  onlineCaret: { fontSize: 10, color: colors.green },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
  },
  searchIcon: { fontSize: 16, color: colors.faint, marginRight: 8 },
  search: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 18, gap: 8, alignItems: 'center' },
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
  clearText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  summaryLeft: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  summaryRight: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  split: { flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  splitList: { flex: 1, minWidth: 0 },
  splitDetail: {
    flex: 1.1,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  detailWrap: { padding: 16, flexGrow: 1 },
  list: { paddingBottom: 24 },
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
  fieldLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint },
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
  },
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
    marginTop: 12,
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
    marginTop: 12,
  },
  mailMsg: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 8 },
  dialogBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
});
