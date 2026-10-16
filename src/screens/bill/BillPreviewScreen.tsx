import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { useLang } from '../../lib/i18n';
import type { SaleItemIn } from '../../lib/payments';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type OrderItemParam = {
  id?: string; name: string; qty: number;
  basePrice?: number; price?: number;
  modifiers?: { name: string; price: number }[]; discount?: number;
};
type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      items?: OrderItemParam[];
      total?: number; subtotal?: number; discount?: number;
      voucher?: string | { code: string; amount: number; kind?: string };
      voucherCode?: string;
      service?: number; serviceTotal?: number;
      tax?: number; vatTotal?: number;
      /** Fee platform agregator + pembulatan bawaan pemanggil (info-only, diteruskan). */
      feeESB?: number; rounding?: number;
      mode?: string; table?: string; ongkir?: number;
      customer?: string; memberId?: string;
    };
  };
};

type Mode = 'none' | 'rata' | 'item' | 'nominal';

const unitPrice = (it: OrderItemParam): number => it.basePrice ?? it.price ?? 0;
const lineAmount = (it: OrderItemParam): number =>
  it.qty * unitPrice(it) +
  (it.modifiers ?? []).reduce((s, m) => s + m.price * it.qty, 0) -
  (it.discount ?? 0);

export default function BillPreviewScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  // Order asli dari params kasir (bukan konstanta hardcode).
  const p = route?.params ?? {};
  const orderItems = p.items ?? [];
  const voucherCode =
    p.voucherCode ?? (typeof p.voucher === 'string' ? p.voucher : p.voucher?.code) ?? '';
  const voucherKind =
    typeof p.voucher === 'object' ? (p.voucher.kind ?? '') : '';
  const discountVal = p.discount ?? (typeof p.voucher === 'object' ? p.voucher.amount : 0) ?? 0;
  const ongkirVal = p.ongkir ?? 0;
  const serviceVal = p.service ?? p.serviceTotal ?? 0;
  const taxVal = p.tax ?? p.vatTotal ?? 0;
  const feeESBVal = p.feeESB ?? 0;
  const roundingVal = p.rounding ?? 0;
  const subtotalVal = p.subtotal ?? orderItems.reduce((s, it) => s + lineAmount(it), 0);
  const total = p.total ?? (subtotalVal - discountVal + serviceVal + ongkirVal);
  // Kepala struk mengikuti order berjalan (meja/pelanggan/member asli bila dioper
  // pemanggil); fallback tampilan lama bila dibuka tanpa params.
  const metaTable = p.table ?? 'A-03';
  const metaGuest = p.customer ?? p.memberId ?? 'QoQi';
  const [mode, setMode] = useState<Mode>('none');
  const [splits, setSplitsRaw] = useState(3);
  const [paid, setPaid] = useState<boolean[]>([false, false, false]);
  const [assign, setAssign] = useState<Record<string, number>>(() =>
    Object.fromEntries(orderItems.map((it, i) => [it.name, i % 3])),
  );
  const [nominals, setNominals] = useState<string[]>(['', '', '']);

  const resetSplits = (n: number) => {
    setSplitsRaw(n);
    setPaid(Array(n).fill(false));
    setNominals(Array(n).fill(''));
    setAssign(Object.fromEntries(orderItems.map((it, i) => [it.name, i % n])));
  };

  const togglePaid = (i: number) => setPaid((p) => p.map((v, j) => (j === i ? !v : v)));
  const cycleAssign = (name: string) =>
    setAssign((a) => ({ ...a, [name]: ((a[name] ?? 0) + 1) % splits }));

  const splitNames = ['QoQi', 'Bimo', 'Sinta', 'Guest'];
  // Bagi rata: sisa rupiah didistribusikan satu per satu ke split awal - jumlah split pas = total.
  const splitBase = Math.floor(total / splits);
  const splitRem = total - splitBase * splits;
  const splitVal = (i: number) => splitBase + (i < splitRem ? 1 : 0);
  const itemTotals = Array(splits).fill(0) as number[];
  orderItems.forEach((it) => {
    itemTotals[assign[it.name] ?? 0] += lineAmount(it);
  });
  const nominalNums = nominals.map((s) => Number(s.replace(/[^0-9]/g, '')) || 0);
  const nominalSum = nominalNums.reduce((s, v) => s + v, 0);
  const nominalPas = nominalSum === total;
  const nominalGateOk = (m: Mode) => m !== 'nominal' || nominalPas;
  const paidCount = paid.filter(Boolean).length;
  // Item siap diteruskan ke rantai Pay > Success > Receipt (bentuk SaleItemIn).
  const saleItems: SaleItemIn[] = orderItems.map((it) => ({
    id: it.id ?? it.name,
    name: it.name,
    basePrice: unitPrice(it),
    qty: it.qty,
    ...(it.modifiers ? { modifiers: it.modifiers } : {}),
    ...(it.discount ? { discount: it.discount } : {}),
  }));
  // Konteks order agar tidak hilang di rantai (Pay teruskan ke Success > Receipt).
  const orderCtx = {
    ...(p.mode ? { mode: p.mode } : {}),
    ...(p.table ? { table: p.table } : {}),
    ...(ongkirVal > 0 ? { ongkir: ongkirVal } : {}),
    ...(p.customer ? { customer: p.customer } : {}),
    ...(p.memberId ? { memberId: p.memberId } : {}),
  };
  // Share proporsional service/pajak/pembulatan untuk split parsial (info-only
  // struk di Pay > Success > Receipt). Diskon/voucher tak diteruskan per-split
  // karena total split sudah neto (hindari catat ganda).
  const splitShareCtx = (val: number): Record<string, number> => {
    if (total <= 0 || val <= 0) return {};
    const r = val / total;
    return {
      ...(serviceVal > 0 ? { service: Math.max(0, Math.round(serviceVal * r)) } : {}),
      ...(taxVal > 0 ? { tax: Math.max(0, Math.round(taxVal * r)) } : {}),
      ...(roundingVal !== 0 ? { rounding: Math.round(roundingVal * r) } : {}),
    };
  };
  // Rincian info-only bawaan pemanggil (service/pajak/fee/pembulatan) - diteruskan
  // agar baris struk pas dengan total di Pay > Success > Receipt.
  const breakdownCtx = {
    ...(serviceVal > 0 ? { service: serviceVal } : {}),
    ...(taxVal > 0 ? { tax: taxVal } : {}),
    ...(feeESBVal > 0 ? { feeESB: feeESBVal } : {}),
    ...(roundingVal !== 0 ? { rounding: roundingVal } : {}),
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('bill_title')}
        onBack={() => navigation?.goBack()}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <Text style={styles.meta}>TRX hari ini · {metaTable} · {metaGuest}</Text>
      <View style={styles.bill}>
        <Text style={styles.shop}>ESB CABANG PORIS</Text>
        <Text style={styles.addr}>Jl. Poris Indah No. 88 · 021-5566-7788</Text>
        <Text style={styles.trx}>TRX-047 · {metaTable} · Kasir Gista · 12:41</Text>
        {orderItems.map((i) => (
          <View key={i.name} style={styles.row}>
            <Text style={styles.item}>{i.qty}× {i.name}</Text>
            <Text style={styles.price}>{rp(lineAmount(i))}</Text>
          </View>
        ))}
        <View style={styles.row}><Text style={styles.item}>Subtotal</Text><Text style={styles.price}>{rp(subtotalVal)}</Text></View>
        {discountVal > 0 && (
          <View style={styles.row}><Text style={styles.item}>Diskon{voucherCode ? ` (${voucherCode})` : ''}</Text><Text style={styles.disc}>-{rp(discountVal)}</Text></View>
        )}
        {taxVal > 0 && (
          <View style={styles.row}><Text style={styles.item}>{t('taxIncl')}</Text><Text style={styles.price}>{rp(taxVal)}</Text></View>
        )}
        {serviceVal > 0 && (
          <View style={styles.row}><Text style={styles.item}>{t('serviceExcl')}</Text><Text style={styles.price}>{rp(serviceVal)}</Text></View>
        )}
        {feeESBVal > 0 && (
          <View style={styles.row}><Text style={styles.item}>{t('feeESB')}</Text><Text style={styles.price}>{rp(feeESBVal)}</Text></View>
        )}
        {roundingVal !== 0 && (
          <View style={styles.row}><Text style={styles.item}>{t('rounding')}</Text><Text style={styles.price}>{rp(roundingVal)}</Text></View>
        )}
        <View style={styles.totalRow}><Text style={styles.totalL}>TOTAL</Text><Text style={styles.totalV}>{rp(total)}</Text></View>
        {(p.memberId || p.customer) ? (
          <Text style={styles.member}>{p.memberId ? `Member ${p.memberId}` : metaGuest}{p.memberId && p.customer ? ` · ${p.customer}` : ''}</Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <AppButton
          title={t('ok_print')}
          variant="secondary"
          onPress={() => navigation?.navigate('Receipt', {
            total, items: saleItems, discount: discountVal,
            ...(voucherCode ? { voucherCode } : {}),
            ...orderCtx,
            ...breakdownCtx,
          })}
          fullWidth={false}
          size="md"
          style={styles.actionBtn}
        />
        <AppButton
          title={`${t('bill_pay')} ›`}
          onPress={() => navigation?.navigate('Pay', {
            total, items: saleItems, discount: discountVal,
            ...(voucherCode ? { voucher: { code: voucherCode, amount: discountVal, ...(voucherKind ? { kind: voucherKind } : {}) } } : {}),
            ...orderCtx,
            ...breakdownCtx,
          })}
          fullWidth={false}
          size="md"
          style={styles.actionBtn}
        />
      </View>
      <Text style={styles.hint}>{t('bill_qr_after_pay')}</Text>

      <Text style={styles.sec}>{t('bill_split_sec')}</Text>
      <Text style={styles.hint}>{t('bill_split_hint')}</Text>
      <Text style={styles.label}>{t('bill_mode')}</Text>
      <View style={styles.chips}>
        {([['rata', t('bill_mode_even').replace('{n}', String(splits))], ['item', t('bill_mode_item')], ['nominal', t('bill_mode_nominal')]] as [Mode, string][]).map(([m, l]) => (
          <TouchableOpacity key={m} style={[styles.chip, mode === m && styles.chipOn]} onPress={() => setMode(mode === m ? 'none' : m)}>
            <Text style={[styles.chipT, mode === m && styles.chipTOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {mode === 'none' ? (
        <Text style={styles.empty}>{t('bill_nosplit')}</Text>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>{t('bill_count')}</Text>
          <View style={styles.chips}>
            {[2, 3, 4].map((n) => (
              <TouchableOpacity key={n} style={[styles.chip, splits === n && styles.chipOn]} onPress={() => resetSplits(n)}>
                <Text style={[styles.chipT, splits === n && styles.chipTOn]}>÷{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.paidBanner}>
            {t('bill_paid').replace('{p}', String(paidCount)).replace('{s}', String(splits))}
          </Text>

          {mode === 'item' && (
            <>
              <Text style={styles.hint}>{t('bill_item_hint')}</Text>
              {orderItems.map((it) => (
                <TouchableOpacity key={it.name} style={styles.row} onPress={() => cycleAssign(it.name)}>
                  <Text style={styles.item}>{it.qty}× {it.name}</Text>
                  <Text style={styles.splitBadge}>Split #{(assign[it.name] ?? 0) + 1} ›</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {mode === 'nominal' && (
            <>
              <Text style={styles.hint}>{t('bill_nom_hint').replace('{t}', rp(total))}</Text>
              {splitNames.slice(0, splits).map((n, i) => (
                <View key={n} style={styles.nomRow}>
                  <Text style={styles.item}>{t('bill_split_of').replace('{i}', String(i + 1)).replace('{n}', n)}</Text>
                  <AppInput
                    value={nominals[i]}
                    onChangeText={(v) =>
                      setNominals((arr) => arr.map((x, j) => (j === i ? v : x)))
                    }
                    placeholder={rp(0)}
                    keyboardType="numeric"
                    boxStyle={styles.nomBox}
                    style={styles.nomField}
                  />
                </View>
              ))}
              <View style={styles.row}>
                <Text style={styles.item}>{t('bill_remain')}</Text>
                <Text style={[styles.price, !nominalPas && styles.over]}>
                  {nominalPas
                    ? t('bill_pas')
                    : nominalSum > total
                      ? t('bill_over').replace('{k}', rp(nominalSum - total))
                      : t('bill_short').replace('{k}', rp(total - nominalSum))}
                </Text>
              </View>
              {mode === 'nominal' && !nominalPas && (
                <Text style={styles.gateMsg}>{t('bill_gate')}</Text>
              )}
            </>
          )}

          {splitNames.slice(0, splits).map((n, i) => {
            const val = mode === 'item' ? itemTotals[i] : mode === 'nominal' ? nominalNums[i] : splitVal(i);
            return (
              <View key={n} style={styles.splitRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.item}>{t('bill_split_of').replace('{i}', String(i + 1)).replace('{n}', n)}</Text>
                  <Text style={paid[i] ? styles.lunas : styles.price}>{paid[i] ? t('bill_lunas') : rp(val)}</Text>
                </View>
                {!paid[i] && (
                  <AppButton
                    title={`${t('bill_pay')} ›`}
                    disabled={val <= 0 || !nominalGateOk(mode)}
                    // Split parsial: total split sudah neto (termasuk diskon),
                    // jadi teruskan konteks + share proporsional service/pajak/
                    // pembulatan, tanpa diskon/voucher ganda.
                    onPress={() => navigation?.navigate('Pay', { total: val, items: saleItems, ...orderCtx, ...splitShareCtx(val) })}
                    fullWidth={false}
                    size="sm"
                    style={styles.payBtn}
                  />
                )}
                <TouchableOpacity onPress={() => togglePaid(i)} hitSlop={10} style={styles.lunasBtn}>
                  <Text style={styles.lunasT}>{paid[i] ? t('bill_unmark') : t('bill_mark')}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <AppButton title={t('bill_cancel_split')} variant="secondary" onPress={() => setMode('none')} size="md" />
        </View>
      )}

      <View style={styles.links}>
        <TouchableOpacity onPress={() => navigation?.navigate('Cancel')}><Text style={styles.link}>{t('bill_void')}</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation?.navigate('Member', {
          total, items: saleItems, discount: discountVal,
          ...(voucherCode ? { voucher: { code: voucherCode, amount: discountVal, ...(voucherKind ? { kind: voucherKind } : {}) } } : {}),
          ...(voucherCode ? { voucherCode } : {}),
          ...orderCtx,
          ...breakdownCtx,
        })}><Text style={styles.link}>{t('bill_customer')}</Text></TouchableOpacity>
      </View>
    </ScrollView>
  </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  meta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  bill: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  shop: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, textAlign: 'center' },
  addr: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 2 },
  trx: { fontFamily: fonts.medium, fontSize: 12, color: colors.faint, textAlign: 'center', marginVertical: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, flex: 1 },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  disc: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, marginTop: 8, paddingTop: 10 },
  totalL: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  totalV: { fontFamily: fonts.bold, fontSize: 18, color: colors.orangeDark },
  member: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, marginTop: 0 },
  primary: { flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 20 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 10, marginBottom: 6 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 10 },
  paidBanner: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark, marginTop: 10 },
  splitBadge: { fontFamily: fonts.bold, fontSize: 12, color: colors.orangeDark },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 6,
  },
  payBtn: { paddingHorizontal: 12, marginTop: 0 },
  payBtnOff: { opacity: 0.45 },
  payBtnT: { fontFamily: fonts.bold, fontSize: 12, color: colors.white },
  gateMsg: { fontFamily: fonts.semibold, fontSize: 12, color: colors.amberDark, marginTop: 6 },
  lunasBtn: { paddingVertical: 8, paddingLeft: 4 },
  lunasT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy },
  lunas: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark },
  nomRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  nomBox: { width: 130 },
  nomField: { textAlign: 'right' },
  nomInput: {
    width: 130,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
    textAlign: 'right',
  },
  over: { color: colors.red },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  links: { gap: 8, marginTop: 16 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
});
