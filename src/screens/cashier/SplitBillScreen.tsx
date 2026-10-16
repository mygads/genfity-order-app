import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import { useLang } from '../../lib/i18n';
import { itemTotal, type CartItem } from './CashierScreen';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };

/** Voucher order: objek {code, amount} dari kasir/CartDetail, string kode (kontrak Pay), atau nominal. */
type VoucherParam = { code?: unknown; amount?: unknown; kind?: unknown } | string | number | null;

type SplitParams = {
  items?: unknown;
  total?: number;
  mode?: string;
  table?: string;
  customer?: string;
  memberId?: string;
  ongkir?: number;
  voucher?: VoucherParam;
  discount?: number;
  service?: number;
};

type Props = { navigation?: Nav; route?: { params?: SplitParams } };

const asAmount = (v: unknown) => {
  const n = Math.round(Number(v) || 0);
  return n > 0 ? n : 0;
};

const asText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');

/** Normalisasi items rute (boleh unknown[]) ke CartItem agar itemTotal aman. */
const normalizeItems = (raw: unknown): CartItem[] => {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((c, i) => ({
    id: typeof c?.id === 'string' && c.id ? (c.id as string) : `item-${i}`,
    name: typeof c?.name === 'string' && c.name ? (c.name as string) : 'Item',
    basePrice: asAmount(c?.basePrice),
    qty: Math.max(1, Math.round(Number(c?.qty) || 1)),
    modifiers: Array.isArray(c?.modifiers)
      ? (c.modifiers as Record<string, unknown>[]).map((m) => ({
          name: typeof m?.name === 'string' ? (m.name as string) : '',
          price: asAmount(m?.price),
        }))
      : [],
    discount: asAmount(c?.discount),
    ...(typeof c?.note === 'string' && (c.note as string).trim() ? { note: (c.note as string).trim() } : {}),
    ...(c?.voided ? { voided: true } : {}),
  }));
};

/**
 * Bagi amount (Rp) ke tiap split proporsional bobot (bobot = itemTotal split,
 * basis = total item). Tiap split dibulatkan, selisih dibuang ke split terakhir
 * agar jumlah split = amount persis.
 */
const splitShare = (amount: number, weights: number[], base: number): number[] => {
  const n = weights.length;
  if (n === 0) return [];
  if (amount === 0) return Array(n).fill(0) as number[];
  if (base <= 0) {
    const each = Math.round(amount / n);
    const even = Array(n).fill(each) as number[];
    even[n - 1] = amount - each * (n - 1);
    return even;
  }
  const out = weights.map((w) => Math.round((amount * w) / base));
  out[n - 1] = amount - out.slice(0, n - 1).reduce((s, v) => s + v, 0);
  return out;
};

const SEED: CartItem[] = [
  { id: 'p11', name: 'Sudirman Coffee', basePrice: 12900, qty: 1, modifiers: [{ name: 'Creamy Pandan', price: 7000 }], discount: 0 },
  { id: 'p2', name: 'Ayam Goreng Dada', basePrice: 15000, qty: 2, modifiers: [], discount: 0 },
  { id: 'p9', name: 'Teh Manis Panas', basePrice: 8000, qty: 2, modifiers: [], discount: 0 },
];

const METHODS = ['Tunai', 'QRIS', 'EDC', 'Transfer'];
const NAMES = ['Bill 1', 'Bill 2', 'Bill 3', 'Bill 4'];

/**
 * Bagi Bill (split_bill) - pilih item lalu bagi ke 2+ bill,
 * tiap bill bisa beda metode bayar + tombol Bayar per bill.
 * Daftarkan route: SplitBill.
 */
export default function SplitBillScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const { t } = useLang();
  const params = route?.params ?? {};
  const items = useMemo(() => {
    const fromRoute = normalizeItems(params.items).filter((c) => !c.voided);
    return fromRoute.length > 0 ? fromRoute : SEED;
  }, [route?.params?.items]);
  const [splits, setSplits] = useState(2);
  const [assign, setAssign] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((it, i) => [it.id, i % 2])),
  );
  const [methods, setMethods] = useState<string[]>(['Tunai', 'QRIS']);
  const [paid, setPaid] = useState<boolean[]>([false, false]);

  const resetSplits = (n: number) => {
    setSplits(n);
    setPaid(Array(n).fill(false));
    setMethods(Array.from({ length: n }, (_, i) => METHODS[i % METHODS.length] as string));
    setAssign(Object.fromEntries(items.map((it, i) => [it.id, i % n])));
  };

  const cycleAssign = (id: string) =>
    setAssign((a) => ({ ...a, [id]: ((a[id] ?? 0) + 1) % splits }));

  const mode = asText(params.mode);
  const table = asText(params.table);
  const customer = asText(params.customer);
  const memberId = asText(params.memberId);

  // Voucher order: objek kasir {code, amount}, string kode (kontrak Pay), atau nominal.
  const voucherParam = params.voucher as VoucherParam;
  const voucherCode =
    typeof voucherParam === 'string'
      ? voucherParam.trim()
      : asText((voucherParam as { code?: unknown } | null)?.code);
  const voucherRaw =
    typeof voucherParam === 'number'
      ? asAmount(voucherParam)
      : asAmount((voucherParam as { amount?: unknown } | null)?.amount);
  const ongkirParam = asAmount(params.ongkir);

  const itemSplits = useMemo(() => {
    const arr = Array(splits).fill(0) as number[];
    items.forEach((it) => {
      arr[assign[it.id] ?? 0] += itemTotal(it);
    });
    return arr;
  }, [items, assign, splits]);
  const itemSum = itemSplits.reduce((s, v) => s + v, 0);

  // Ikuti rumus kasir/CartDetail: voucher dibatasi nilai item, service 5% dari net.
  const voucherCapped = Math.min(voucherRaw, itemSum);
  const discountCapped = Math.min(asAmount(params.discount), Math.max(0, itemSum - voucherCapped));
  const netBase = Math.max(0, itemSum - voucherCapped - discountCapped);
  const serviceAmt = params.service !== undefined ? asAmount(params.service) : Math.round(netBase * 0.05);
  const expectedTotal = netBase + serviceAmt + ongkirParam;
  // Total dari pemanggil adalah angka resmi (sudah mencakup service/ongkir/voucher).
  const orderTotal = Math.max(0, Math.round(Number(params.total) || expectedTotal));
  // Pemanggil lama hanya kirim {items, total} tanpa rincian ongkir/voucher -
  // selisihnya dilipat ke share ongkir agar rincian per bill tetap pas dengan total.
  const residual = orderTotal - expectedTotal;
  const ongkirEff = Math.max(0, ongkirParam + residual);
  const voucherEff = voucherCapped + Math.max(0, -(ongkirParam + residual));

  // Reaporsi tiap komponen proporsional itemSplit; jumlah split = orderTotal persis.
  const { billTotals, voucherShares, discountShares, serviceShares, ongkirShares } = useMemo(() => {
    const v = splitShare(voucherEff, itemSplits, itemSum);
    const d = splitShare(discountCapped, itemSplits, itemSum);
    const s = splitShare(serviceAmt, itemSplits, itemSum);
    const o = splitShare(ongkirEff, itemSplits, itemSum);
    const totals = itemSplits.map((it, i) =>
      Math.max(0, it - (v[i] as number) - (d[i] as number) + (s[i] as number) + (o[i] as number)),
    );
    return { billTotals: totals, voucherShares: v, discountShares: d, serviceShares: s, ongkirShares: o };
  }, [itemSplits, itemSum, voucherEff, discountCapped, serviceAmt, ongkirEff]);

  const grand = orderTotal;
  const paidCount = paid.filter(Boolean).length;

  const payBill = (i: number) => {
    const val = billTotals[i] as number;
    if (val <= 0 || paid[i]) return;
    const members = items.filter((it) => (assign[it.id] ?? 0) === i);
    // Kontrak Pay (PayScreen read-only): total + items/mode/table/ongkir/voucher.
    // total = tagihan penuh split ini (selaras CartDetail yang kirim total penuh),
    // ongkir/voucher diteruskan agar Pay mencatat rinciannya.
    navigation?.navigate('Pay', {
      total: val,
      method: methods[i],
      items: members,
      ...(mode ? { mode } : {}),
      ...(table ? { table } : {}),
      ...(customer ? { customer } : {}),
      ...(memberId ? { memberId } : {}),
      ...((ongkirShares[i] as number) > 0 ? { ongkir: ongkirShares[i] } : {}),
      ...(voucherCode ? { voucher: voucherCode } : {}),
    });
    setPaid((p) => p.map((v, j) => (j === i ? true : v)));
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('sp_title')}
        sub={t('sp_lunas_of').replace('{p}', String(paidCount)).replace('{s}', String(splits))}
        onBack={() => navigation?.goBack()}
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        <Text style={styles.hint}>{t('sp_hint')}</Text>
        {(mode || table) && (
          <Text style={styles.ctx}>{[mode, table ? `${t('table')} ${table}` : ''].filter(Boolean).join(' · ')}</Text>
        )}
        <Text style={styles.label}>{t('sp_count')}</Text>
        <View style={styles.chips}>
          {[2, 3, 4].map((n) => (
            <TouchableOpacity key={n} style={[styles.chip, splits === n && styles.chipOn]} onPress={() => resetSplits(n)}>
              <Text style={[styles.chipT, splits === n && styles.chipTOn]}>÷{n}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sec}>{t('sp_items_sec')} · {rp(grand)}</Text>
        {items.map((it) => (
          <TouchableOpacity key={it.id} style={styles.itemRow} onPress={() => cycleAssign(it.id)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{it.qty}× {it.name}</Text>
              <Text style={styles.itemPrice}>{rp(itemTotal(it))}</Text>
            </View>
            <Text style={styles.splitBadge}>Bill #{(assign[it.id] ?? 0) + 1} ›</Text>
          </TouchableOpacity>
        ))}
        {items.length === 0 && (
          <View style={styles.emptyWrap}>
            <Image
              source={require('../../../assets/images/empty_order.webp')}
              style={styles.emptyImg}
              resizeMode="contain"
            />
            <Text style={styles.emptyT}>{t('sp_empty')}</Text>
          </View>
        )}

        <Text style={styles.sec}>{t('sp_perbill')}</Text>
        {NAMES.slice(0, splits).map((name, i) => {
          const val = billTotals[i] as number;
          const members = items.filter((it) => (assign[it.id] ?? 0) === i);
          const label = t('sp_name').replace('{n}', String(i + 1));
          return (
            <View key={name} style={styles.billCard}>
              <View style={styles.billHead}>
                <Text style={styles.billName}>{label}</Text>
                <Text style={paid[i] ? styles.lunas : styles.billTotal}>
                  {paid[i] ? t('bill_lunas') : rp(val)}
                </Text>
              </View>
              <Text style={styles.billItems}>
                {members.length === 0 ? t('sp_noitems') : members.map((m) => `${m.qty}× ${m.name}`).join(' · ')}
              </Text>
              <View style={styles.meta}>
                <View style={styles.metaRow}>
                  <Text style={styles.metaL}>{t('c_subtotal')}</Text>
                  <Text style={styles.metaV}>{rp(itemSplits[i] as number)}</Text>
                </View>
                {serviceAmt > 0 && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaL}>{t('serviceExcl')}</Text>
                    <Text style={styles.metaV}>+{rp(serviceShares[i] as number)}</Text>
                  </View>
                )}
                {ongkirEff > 0 && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaL}>{t('deliveryFee')}</Text>
                    <Text style={styles.metaV}>+{rp(ongkirShares[i] as number)}</Text>
                  </View>
                )}
                {voucherEff > 0 && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaL}>Voucher{voucherCode ? ` ${voucherCode}` : ''}</Text>
                    <Text style={[styles.metaV, styles.metaDisc]}>-{rp(voucherShares[i] as number)}</Text>
                  </View>
                )}
                {discountCapped > 0 && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaL}>{t('discount')}</Text>
                    <Text style={[styles.metaV, styles.metaDisc]}>-{rp(discountShares[i] as number)}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.label}>{t('sp_method')}</Text>
              <View style={styles.chips}>
                {METHODS.map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.chip, methods[i] === m && styles.chipOn]}
                    onPress={() => setMethods((arr) => arr.map((x, j) => (j === i ? m : x)))}>
                    <Text style={[styles.chipT, methods[i] === m && styles.chipTOn]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.billActs}>
                {!paid[i] && (
                  <TouchableOpacity
                    style={[styles.payBtn, val <= 0 && styles.payOff]}
                    disabled={val <= 0}
                    onPress={() => payBill(i)}>
                    <Text style={styles.payT}>{t('sp_pay').replace('{m}', methods[i] as string)} ›</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setPaid((p) => p.map((v, j) => (j === i ? !v : v)))}
                  hitSlop={10}>
                  <Text style={styles.lunasT}>{paid[i] ? t('sp_unmark') : t('sp_mark')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {paidCount === splits && (
          <Text style={styles.done}>{t('sp_allpaid')}</Text>
        )}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.navigate('Cashier')}>
          <Text style={styles.backBtnT}>{t('sp_back')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 40 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 12, marginBottom: 6 },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  itemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.line },
  itemName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  itemPrice: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  splitBadge: { fontFamily: fonts.bold, fontSize: 13, color: colors.orangeDark },
  emptyWrap: { alignItems: 'center', paddingVertical: 24 },
  emptyImg: { width: 110, height: 110 },
  emptyT: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 8 },
  billCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  billHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  billName: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  billTotal: { fontFamily: fonts.bold, fontSize: 16, color: colors.orangeDark },
  lunas: { fontFamily: fonts.bold, fontSize: 14, color: colors.greenDark },
  billItems: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  ctx: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy, marginTop: 6 },
  meta: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6, gap: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaL: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  metaV: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
  metaDisc: { color: colors.red },
  billActs: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 },
  payBtn: { backgroundColor: colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  payOff: { opacity: 0.4 },
  payT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  lunasT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy },
  done: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark, textAlign: 'center', marginTop: 8 },
  backBtn: { backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  backBtnT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
