import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { useLang } from '../../lib/i18n';
import { appAlert } from '../../lib/appAlert';
import { startEdcPayment } from '../../native/edc';import { NATIVE_PREF_KEYS } from '../../lib/master';
import { recordSale, type SaleInput, type SaleItemIn } from '../../lib/payments';
import { saveSale, saleHeadExists, appendGroupPayment, nextSalesNum, getSaleClientId } from '../../lib/sales';
import { uuidv7 } from '../../lib/uuidv7';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      total?: number;
      salesNum?: string;
      /** client_id UUIDv7 rantai bayar (APP-PRINTER-SALES, Q7): dipakai ulang, bukan dibuat baru. */
      clientId?: string;
      splits?: { method?: string; amount?: number }[];
      /** Split grup: kunjungan bayar memakai SATU salesNum + tahu total penuh. */
      splitGroup?: boolean;
      orderTotal?: number;
      items?: SaleItemIn[];
      discount?: number;
      voucherCode?: string;
      service?: number;
      tax?: number;
      feeESB?: number;
      rounding?: number;
      mode?: string;
      table?: string;
      ongkir?: number;
      ongkirCut?: number;
      customer?: string;
      memberId?: string;
    };
  };
};

type Phase = 'waiting' | 'error' | 'approval';

const BANKS = ['BCA', 'Mandiri', 'BRI'];
const TERMINALS = ['EDC-01', 'EDC-02'];

export default function EdcScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  // Tanpa total terusan (dibuka di luar alur bayar) = 0 yang jujur; tombol
  // simpan mati sampai nominal > 0 + approval 6 digit.
  const total = Math.max(0, Math.round(Number(route?.params?.total) || 0));
  const [phase, setPhase] = useState<Phase>('waiting');
  const [secs, setSecs] = useState(60);
  const [approval, setApproval] = useState('');
  const [bank, setBank] = useState(BANKS[0]);
  const [terminal, setTerminal] = useState(TERMINALS[0]);
  const [cardNo, setCardNo] = useState('');
  /** Guard ketuk-ganda save (direset hanya bila save gagal sebelum navigasi). */
  const savedRef = useRef(false);

  useEffect(() => {
    // Lempar nominal ke aplikasi APOS (pola POSLite). Di Expo Go/web: no-op.
    // Kasir tetap input kode persetujuan 6 digit dari struk EDC secara manual.
    void startEdcPayment(total, `EDC-${Date.now()}`).then((r) => {
      if (r.ok && r.approvalCode) {
        setApproval(r.approvalCode.replace(/\D/g, '').slice(0, 6));
        if (r.cardNo) setCardNo(r.cardNo.replace(/\D/g, '').slice(-4));
        setPhase('approval');
      }
    // P16: rantai bare promise dijaga — APOS tak tersedia = tetap di fase
    // waiting, kasir input approval manual (fail-soft, tanpa tombol mati).
    }).catch(() => { /* modul APOS/native absen — abaikan, jalur manual hidup */ });
  }, []);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = setTimeout(() => {
      if (secs <= 1) {
        setSecs(0);
        setPhase('error');
      } else {
        setSecs(secs - 1);
      }
    }, 1000);

    return () => clearTimeout(t);
  }, [phase, secs]);

  const retry = () => { setSecs(60); setPhase('waiting'); };
  const canSave = approval.length === 6 && total > 0;

  // Simpan + teruskan approval 6-digit & 4 digit kartu ke Success dan ke payload antrean.
  // Satu nomor TRX untuk DB + Success + Receipt (selaras PayScreen).
  // Nomor + kaki split terusan dari Pay dipakai ulang (EDC = kaki terakhir
  // SATU bill utuh); hanya bila tak ada terusan baru terbitkan nomor.
  const save = async () => {
    if (!canSave) return;
    // Guard ketuk-ganda: tombol Bayar bisa diketuk dua kali sebelum navigasi.
    if (savedRef.current) return;
    savedRef.current = true;
    const p = route?.params ?? {};
    const method = `EDC ${bank}`;
    const cardLast4 = cardNo.slice(-4);
    // M10 (cermin PayScreen goSuccess): nomor diterbitkan DI DALAM try; bila
    // gagal, guard di-reset agar tombol Simpan tetap hidup (sebelumnya throw
    // di luar try = savedRef macet-true = retry-mati).
    let orderNo: string;
    try {
      orderNo = (p.salesNum ?? '').trim() || (await nextSalesNum());
    } catch (e) {
      savedRef.current = false;
      if ((e as { code?: string })?.code === 'terminal-unbound') {
        appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
          { text: t('c_cancel'), style: 'cancel' },
          { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
        ]);
      } else {
        appAlert(t('pay_issue_fail'));
      }
      return;
    }
    // APP-PRINTER-SALES (Q7): SATU client_id per sale (rantai Pay → head → baru).
    // uuidv7() melempar bila CSPRNG absen: guard di-reset agar tombol Simpan
    // tetap hidup (cermin penjagaan nextSalesNum di atas).
    let saleClientId: string;
    try {
      saleClientId = (p.clientId ?? '').trim() || (await getSaleClientId(orderNo)) || uuidv7();
    } catch (e) {
      savedRef.current = false;
      if ((e as { code?: string })?.code === 'terminal-unbound') {
        appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
          { text: t('c_cancel'), style: 'cancel' },
          { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
        ]);
      } else {
        appAlert(t('pay_issue_fail'));
      }
      return;
    }
    // P7/P15: kaki terusan boleh membawa approvalCode/memberId defensif dari
    // Pay (tipe nav params belum diperluas) — dipertahankan ke visitPay agar
    // atribusi deposit + kode otorisasi kunjungan lalu tak hilang di EDC.
    type FwdLeg = { method?: string; amount?: number; approvalCode?: string; memberId?: string };
    const fwdSplits = ((p.splits ?? []) as FwdLeg[])
      .map((s) => ({ method: String(s?.method ?? 'split'), amount: Math.max(0, Math.round(Number(s?.amount) || 0)), ...(s?.approvalCode ? { approvalCode: String(s.approvalCode) } : {}) }))
      .filter((s) => s.amount > 0);
    const legMemberId = ((p.splits ?? []) as FwdLeg[])
      .map((s) => String(s?.memberId ?? '').trim())
      .find((v) => v !== '') ?? '';
    const effMemberId = String(p.memberId ?? '').trim() || legMemberId;
    const serviceParam = Math.max(0, Math.round(Number(p.service) || 0));
    const taxParam = Math.max(0, Math.round(Number(p.tax) || 0));
    const feeESBParam = Math.max(0, Math.round(Number(p.feeESB) || 0));
    const roundingParam = Math.round(Number(p.rounding) || 0);
    const paidBefore = fwdSplits.reduce((s, x) => s + x.amount, 0);
    const fullTotal = paidBefore + total;
    // Split grup (BillPreview/SplitBill via Pay): kunjungan EDC ikut SATU
    // salesNum. Pertama = saveSale penuh (grand = total order, stok/voucher/
    // dapur sekali); berikut = appendGroupPayment. Tanpa cabang ini kunjungan
    // ke-2+ menabrak PRIMARY KEY head lalu gagal diam-diam.
    const groupNo = p.splitGroup === true && (p.salesNum ?? '').trim()
      && Math.max(0, Math.round(Number(p.orderTotal) || 0)) > 0
      ? (p.salesNum ?? '').trim() : '';
    if (groupNo) {
      const orderTotalFull = Math.max(0, Math.round(Number(p.orderTotal) || 0));
      const visitPay = [...fwdSplits, { method, amount: total, approvalCode: approval }];
      try {
        if (await saleHeadExists(groupNo)) {
          await appendGroupPayment(groupNo, { payments: visitPay, method, change: 0, clientId: saleClientId, ...(effMemberId ? { memberId: effMemberId } : {}) });
        } else {
          const gInput: SaleInput = {
            method,
            salesNum: groupNo,
            clientId: saleClientId,
            grandTotal: orderTotalFull,
            cash: orderTotalFull,
            change: 0,
            items: p.items,
            payments: visitPay,
            discountTotal: p.discount ?? 0,
            ...(serviceParam > 0 ? { serviceTotal: serviceParam } : {}),
            ...(taxParam > 0 ? { vatTotal: taxParam } : {}),
            ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
            ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
            approvalCode: approval,
            ...(p.voucherCode ? { voucherCode: p.voucherCode } : {}),
            ...(effMemberId ? { memberId: effMemberId } : {}),
            ...(p.table ? { tableId: p.table } : {}),
            ...(p.mode ? { mode: p.mode } : {}),
            ...(p.ongkir && p.ongkir > 0 ? { ongkir: p.ongkir } : {}),
            ...(p.ongkirCut && p.ongkirCut > 0 ? { ongkirCut: p.ongkirCut } : {}),
            ...(p.customer ? { customer: p.customer } : {}),
          };
          // C7/L1 save-then-record (cermin PayScreen:553-554): tulis DB dulu,
          // antre HANYA bila sukses — gagal = nol twin yatim, TANPA Success palsu.
          try {
            await saveSale(gInput);
            recordSale(gInput);
          } catch (e) {
            // Gate bound (D3-03): unbound → pesan klaim-terminal, TANPA Success palsu.
            // APP-R3: guard di-reset agar retry hidup setelah klaim terminal
            // (cermin outer catch + non-group path — sebelumnya macet-true di sini).
            if ((e as { code?: string })?.code === 'terminal-unbound') {
              appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
                { text: t('c_cancel'), style: 'cancel' },
                { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
              ]);
              savedRef.current = false;
              return;
            }
            // L1 fail-closed: tulis DB gagal = JANGAN antre + JANGAN Success.
            appAlert(t('pay_issue_fail'));
            savedRef.current = false;
            return;
          }
        }
      } catch (e) {
        // appendGroupPayment kini melempar 'terminal-unbound' (gate bound, cermin
        // saveSale): jangan telan menjadi Success palsu — beri jalan klaim.
        if ((e as { code?: string })?.code === 'terminal-unbound') {
          appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
            { text: t('c_cancel'), style: 'cancel' },
            { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
          ]);
          savedRef.current = false;
          return;
        }
        /* DB gagal - kasir tetap jalan */
      }
      navigation?.navigate('Success', {
        total: orderTotalFull,
        method,
        cash: orderTotalFull,
        change: 0,
        orderNo: groupNo,
        clientId: saleClientId,
        approvalCode: approval,
        ...(cardLast4 ? { cardLast4 } : {}),
        bank,
        terminal,
        items: p.items,
        discount: p.discount ?? 0,
        splitPaid: { amount: fullTotal, method },
        ...(serviceParam > 0 ? { service: serviceParam } : {}),
        ...(taxParam > 0 ? { tax: taxParam } : {}),
        ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
        ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
        ...(p.voucherCode ? { voucherCode: p.voucherCode } : {}),
        ...(effMemberId ? { memberId: effMemberId } : {}),
        ...(p.mode ? { mode: p.mode } : {}),
        ...(p.table ? { table: p.table } : {}),
        ...(p.ongkir && p.ongkir > 0 ? { ongkir: p.ongkir } : {}),
        ...(p.customer ? { customer: p.customer } : {}),
      });
      return;
    }
    const input: SaleInput = {
      method,
      salesNum: orderNo,
      clientId: saleClientId,
      grandTotal: fullTotal,
      cash: fullTotal,
      change: 0,
      items: p.items,
      payments: [...fwdSplits, { method, amount: total, approvalCode: approval }],
      discountTotal: p.discount ?? 0,
      ...(serviceParam > 0 ? { serviceTotal: serviceParam } : {}),
      ...(taxParam > 0 ? { vatTotal: taxParam } : {}),
      ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
      ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
      approvalCode: approval,
      ...(p.voucherCode ? { voucherCode: p.voucherCode } : {}),
      ...(effMemberId ? { memberId: effMemberId } : {}),
      ...(p.table ? { tableId: p.table } : {}),
      ...(p.mode ? { mode: p.mode } : {}),
      ...(p.ongkir && p.ongkir > 0 ? { ongkir: p.ongkir } : {}),
      ...(p.ongkirCut && p.ongkirCut > 0 ? { ongkirCut: p.ongkirCut } : {}),
      ...(p.customer ? { customer: p.customer } : {}),
    };
    // C7/L1 save-then-record (cermin PayScreen:633-650): tulis DB dulu, antre
    // HANYA bila sukses — gagal = nol twin yatim, TANPA Success palsu.
    try {
      await saveSale(input);
      recordSale(input);
    } catch (e) {
      // Gate bound (D3-03): unbound → pesan klaim-terminal + jalan ke Klaim, TANPA Success palsu.
      if ((e as { code?: string })?.code === 'terminal-unbound') {
        appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
          { text: t('c_cancel'), style: 'cancel' },
          { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
        ]);
        // M10: guard di-reset agar retry hidup setelah klaim terminal.
        savedRef.current = false;
        return;
      }
      // L1 fail-closed: tulis DB gagal = JANGAN antre + JANGAN Success.
      appAlert(t('pay_issue_fail'));
      savedRef.current = false;
      return;
    }
    navigation?.navigate('Success', {
      total: fullTotal,
      method,
      cash: fullTotal,
      change: 0,
      orderNo,
      clientId: saleClientId,
      approvalCode: approval,
      ...(cardLast4 ? { cardLast4 } : {}),
      bank,
      terminal,
      items: p.items,
      discount: p.discount ?? 0,
      ...(serviceParam > 0 ? { service: serviceParam } : {}),
      ...(taxParam > 0 ? { tax: taxParam } : {}),
      ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
      ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
      ...(p.voucherCode ? { voucherCode: p.voucherCode } : {}),
      ...(effMemberId ? { memberId: effMemberId } : {}),
      ...(p.mode ? { mode: p.mode } : {}),
      ...(p.table ? { table: p.table } : {}),
      ...(p.ongkir && p.ongkir > 0 ? { ongkir: p.ongkir } : {}),
      ...(p.ongkirCut && p.ongkirCut > 0 ? { ongkirCut: p.ongkirCut } : {}),
      ...(p.customer ? { customer: p.customer } : {}),
    });
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('edc_title')}
        sub={t('edc_sub')}
        onBack={() => navigation?.goBack()}
        right={<Text style={styles.headRight}>{rp(total)}</Text>}
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <Text style={styles.sub}>{t('edc_sub')}</Text>
      <Text style={styles.steps}>{t('edc_steps')}</Text>
      <View style={[isTablet && styles.split]}>
        <View style={[styles.main, isTablet && styles.mainTablet]}>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{t('edc_hero').replace('{b}', bank).replace('{t}', terminal)}</Text>
            <Text style={styles.heroValue}>{rp(total)}</Text>
            <Text style={styles.heroSub}>{t('edc_follow')}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('edc_machine')}</Text>
            <Text style={styles.fieldLabel}>{t('edc_bank')}</Text>
            <View style={[styles.chips, isTablet && styles.chipsTablet]}>
              {BANKS.map((b) => (
                <TouchableOpacity
                  key={b}
                  style={[styles.chip, isTablet && styles.chipTablet, bank === b && styles.chipOn]}
                  onPress={() => setBank(b)}>
                  <Text style={[styles.chipT, isTablet && styles.chipTTablet, bank === b && styles.chipTOn]}>{b}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>{t('edc_terminal')}</Text>
            <View style={[styles.chips, isTablet && styles.chipsTablet]}>
              {TERMINALS.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, isTablet && styles.chipTablet, terminal === t && styles.chipOn]}
                  onPress={() => setTerminal(t)}>
                  <Text style={[styles.chipT, isTablet && styles.chipTTablet, terminal === t && styles.chipTOn]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('edc_nominal_card')}</Text>
            <Text style={styles.big}>{rp(total)}</Text>
            <Text style={styles.meta}>{t('edc_swipe').replace('{b}', bank).replace('{t}', terminal)}</Text>
            <Text style={styles.fieldLabel}>{t('edc_card4')}</Text>
            <AppInput
              value={cardNo}
              onChangeText={(v) => setCardNo(v.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder={t('edc_card4_ph')}
              keyboardType="numeric"
              maxLength={4}
              style={styles.centerField}
            />
            {cardNo.length === 4 && (
              <Text style={styles.meta}>{t('edc_card4_show').replace('{c}', cardNo).replace('{b}', bank)}</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('edc_status')}</Text>
            {phase === 'waiting' && <Text style={styles.wait}>{t('edc_waiting').replace('{s}', String(secs))}</Text>}
            {phase === 'error' && <Text style={styles.err}>{t('edc_noresp')}</Text>}
            {phase === 'error' && (
              <AppButton title={t('edc_retry')} onPress={retry} size="md" />
            )}
            {phase === 'waiting' && (
              <AppButton title={`${t('edc_cardread')} ›`} variant="secondary" onPress={() => setPhase('approval')} size="md" />
            )}
            {/* WIRE REA-16: kunci prefs native modul BCA APOS (info status, best-effort) */}
            <Text style={styles.meta}>{NATIVE_PREF_KEYS.bcaApos} / {NATIVE_PREF_KEYS.bcaAposCallback}</Text>
          </View>
        </View>
        {isTablet && (
          <View style={styles.side}>
            <Text style={styles.sideTitle}>{t('edc_summary')}</Text>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>{t('edc_nominal')}</Text>
              <Text style={styles.sideValue}>{rp(total)}</Text>
            </View>
            <View style={styles.sideRow}>
              <Text style={styles.sideLabel}>{t('edc_terminal')}</Text>
              <Text style={styles.sideValue}>{bank} · {terminal}</Text>
            </View>
            <Text style={styles.sideHint}>{t('edc_follow')}</Text>
          </View>
        )}
      </View>

      <View style={[styles.card, isTablet && styles.approvalTablet]}>
        <Text style={styles.cardTitle}>{t('edc_approval_title')}</Text>
        <Text style={styles.meta}>{t('edc_approval_ex')}</Text>
        {/* P17: total<=0 = Simpan mati (canSave) + pesan jujur, bukan tombol mati tanpa kabar. */}
        {total <= 0 && (
          <Text style={styles.err}>{t('pay_empty_total')} {t('pay_empty_total_sub')}</Text>
        )}
        <AppInput value={approval} onChangeText={(v) => setApproval(v.replace(/[^0-9]/g, '').slice(0, 6))} placeholder="••••••" keyboardType="numeric" maxLength={6} style={styles.centerField} />
        <AppButton
          title={t('edc_save')}
          disabled={!canSave}
          onPress={() => void save()}
          size="md"
        />
        <TouchableOpacity style={styles.linkBtn} onPress={() => void (async () => {
          // Kembali ganti metode dengan konteks penuh agar tidak hilang di Pay:
          // nomor + client_id + kaki split + grup ikut pulang (ganti metode
          // bukan sale baru — rantai Q7 lestari).
          const p = route?.params ?? {};
          // P1: blok issuance dijaga (cermin Qris-guard) — getSaleClientId /
          // uuidv7 gagal = Alert + tetap di EDC, bukan pulang tanpa client_id.
          let backSalesNum = '';
          let backClientId = '';
          try {
            backSalesNum = (p.salesNum ?? '').trim();
            backClientId = (p.clientId ?? '').trim()
              || (backSalesNum ? (await getSaleClientId(backSalesNum)) ?? '' : '')
              || uuidv7();
          } catch {
            appAlert(t('pay_issue_fail'));
            return;
          }
          navigation?.navigate('Pay', {
            total,
            ...(p.items ? { items: p.items } : {}),
            ...(p.discount ? { discount: p.discount } : {}),
            ...(p.voucherCode ? { voucher: p.voucherCode } : {}),
            ...(p.service ? { service: p.service } : {}),
            ...(p.feeESB ? { feeESB: p.feeESB } : {}),
            ...((p.rounding ?? 0) !== 0 ? { rounding: p.rounding } : {}),
            ...(p.ongkirCut ? { ongkirCut: p.ongkirCut } : {}),
            ...(p.tax ? { tax: p.tax } : {}),
            ...((p.rounding ?? 0) !== 0 ? { rounding: p.rounding } : {}),
            ...(p.mode ? { mode: p.mode } : {}),
            ...(p.table ? { table: p.table } : {}),
            ...(p.ongkir ? { ongkir: p.ongkir } : {}),
            ...(p.customer ? { customer: p.customer } : {}),
            ...(p.memberId ? { memberId: p.memberId } : {}),
            ...(backSalesNum ? { salesNum: backSalesNum } : {}),
            clientId: backClientId,
            ...(p.splits ? { splits: p.splits } : {}),
            ...(p.splitGroup === true ? { splitGroup: true } : {}),
            ...(p.orderTotal ? { orderTotal: p.orderTotal } : {}),
          });
        })}>
          <Text style={styles.link}>{t('edc_change')} ›</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headRight: { color: colors.white, fontFamily: fonts.semibold, fontSize: 13, textAlign: 'right' },
  body: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  sub: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  steps: { fontFamily: fonts.regular, fontSize: 12, color: colors.navy, textAlign: 'center', marginTop: 4 },
  hero: { backgroundColor: colors.navy, borderRadius: 14, padding: 18, marginTop: 10 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.navyTint },
  heroValue: { fontFamily: fonts.bold, fontSize: 28, color: colors.white, marginTop: 6 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  big: { fontFamily: fonts.bold, fontSize: 22, color: colors.navy, marginTop: 6 },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 10, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Tablet: gap lega + chip penuhi target sentuh 48px.
  chipsTablet: { gap: 10 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipTablet: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18 },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTTablet: { fontSize: 13 },
  chipTOn: { color: colors.orangeDark },
  wait: { fontFamily: fonts.medium, fontSize: 13, color: colors.orangeDark, marginTop: 8 },
  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginTop: 8 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontFamily: fonts.bold, fontSize: 14, color: colors.text, letterSpacing: 4, textAlign: 'center', marginTop: 10 },
  inputSmall: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.bold, fontSize: 14, color: colors.text, letterSpacing: 3, textAlign: 'center', marginTop: 4 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  disabled: { opacity: 0.5 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 },
  ghostT: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy },
  linkBtn: { marginTop: 12, alignItems: 'center' },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  centerField: { textAlign: 'center', letterSpacing: 4 },
  split: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  main: { flex: 1 },
  mainTablet: { flex: 1.6 },
  side: { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 14, marginTop: 10 },
  sideTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  sideRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  sideLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  sideValue: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
  sideHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 8 },
  approvalTablet: { maxWidth: 560 },
});
