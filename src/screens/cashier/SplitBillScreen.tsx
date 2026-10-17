import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';
import AppButton from '../../components/AppButton';
import ScreenHeader from '../../components/ScreenHeader';
import { useLang } from '../../lib/i18n';
import { TAX_DEFAULT, getTaxRate, isMarketplaceMode, totals } from '../../lib/totals';
import { nextSalesNum, getGroupPaid } from '../../lib/sales';
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
  /** Nomor draft/order pengirim = dipakai sebagai SATU salesNum grup. */
  salesNum?: string;
  tax?: number;
  feeESB?: number;
};

type Props = { navigation?: Nav; route?: { params?: SplitParams } };

/** Mode bagi bill: rata = total dibagi sama besar; perItem = ketuk item; nominal = input Rp per bill. */
type SplitMode = 'rata' | 'perItem' | 'nominal';

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



const METHODS = ['Tunai', 'QRIS', 'EDC', 'Transfer'];
const NAMES = ['Bill 1', 'Bill 2', 'Bill 3', 'Bill 4'];

/**
 * Bagi Bill (split_bill) - pilih item lalu bagi ke 2+ bill,
 * tiap bill bisa beda metode bayar + tombol Bayar per bill.
 * Daftarkan route: SplitBill.
 */
export default function SplitBillScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const params = route?.params ?? {};
  const items = useMemo(() => {
    const fromRoute = normalizeItems(params.items).filter((c) => !c.voided);
    return fromRoute;
  }, [route?.params?.items]);
  const [splits, setSplits] = useState(2);
  /** perItem = perilaku lama (ketuk item pindah bill); default agar UX tak berubah. */
  const [splitMode, setSplitMode] = useState<SplitMode>('perItem');
  const [nominals, setNominals] = useState<string[]>(['', '']);
  const [assign, setAssign] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((it, i) => [it.id, i % 2])),
  );
  const [methods, setMethods] = useState<string[]>(['Tunai', 'QRIS']);
  const [paid, setPaid] = useState<boolean[]>([false, false]);
  // Nomor grup: SATU salesNum untuk semua kunjungan split (dari pengirim =
  // salesNum draft agar Success hapus draft tepat sasaran; fallback terbitkan
  // bila pengirim lama tak mengirim). Head grup dibuat kunjungan pertama,
  // kunjungan berikut append kaki (tanpa stok/voucher/dapur ganda).
  const [groupNum, setGroupNum] = useState(() => asText(params.salesNum));
  useEffect(() => {
    if (groupNum) return;
    let alive = true;
    void nextSalesNum()
      .then((n) => {
        if (alive && n) setGroupNum(n);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupNum]);
  /** Kebenaran DB grup (anti centang optimistis): nominal terbayar + status lunas. */
  const [groupPaid, setGroupPaid] = useState({ paidTotal: 0, grandTotal: 0, fullyPaid: false, payCount: 0 });
  /** Tarif pajak setting-driven (ms_setting Tax/PPN, fallback 11) untuk rumus kanonik. */
  const [taxRate, setTaxRate] = useState(TAX_DEFAULT);
  useEffect(() => {
    let alive = true;
    void getTaxRate().then((r) => {
      if (alive) setTaxRate(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  const resetSplits = (n: number) => {
    setSplits(n);
    setPaid(Array(n).fill(false));
    setNominals(Array(n).fill(''));
    setMethods(Array.from({ length: n }, (_, i) => METHODS[i % METHODS.length] as string));
    setAssign(Object.fromEntries(items.map((it, i) => [it.id, i % n])));
  };

  const cycleAssign = (id: string) =>
    setAssign((a) => ({ ...a, [id]: ((a[id] ?? 0) + 1) % splits }));

  const mode = asText(params.mode);
  const table = asText(params.table);
  const customer = asText(params.customer);
  const memberId = asText(params.memberId);

  // Voucher order: objek kasir {code, kind, amount}, string kode (kontrak Pay), atau nominal.
  const voucherParam = params.voucher as VoucherParam;
  const voucherCode =
    typeof voucherParam === 'string'
      ? voucherParam.trim()
      : asText((voucherParam as { code?: unknown } | null)?.code);
  const voucherKind =
    typeof voucherParam === 'object' && voucherParam !== null
      ? asText((voucherParam as { kind?: unknown } | null)?.kind)
      : '';
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

  // Rumus kanonik kasir/CartDetail (src/lib/totals.ts): voucher dibatasi nilai
  // item (flat atau persen sebelum service/pajak), service 5% dari net,
  // pajak inclusive info-only (setting-driven via taxRate, default 11),
  // feeESB 5% utk agregator, bulat Rp 100.
  const canon = totals({
    gross: itemSum,
    discount: asAmount(params.discount),
    voucher: { code: voucherCode, kind: voucherKind, amount: voucherRaw },
    ongkir: ongkirParam,
    esbOrder: isMarketplaceMode(mode),
    taxRate,
  });
  const discountEff = Math.min(asAmount(params.discount), Math.max(0, itemSum - canon.voucherAmt));
  const serviceEff = params.service !== undefined ? asAmount(params.service) : canon.service;
  const feeEff = canon.feeESB;
  // Total dari pemanggil adalah angka resmi (sudah mencakup service/ongkir/voucher/fee).
  const orderTotal = Math.max(0, Math.round(Number(params.total) || canon.total));
  // Pemanggil lama hanya kirim {items, total} tanpa rincian ongkir/voucher -
  // selisih tak membulat (termasuk pembulatan pemanggil) dilipat ke share
  // ongkir agar jumlah per bill tetap pas dengan total.
  const residual = orderTotal - (itemSum - canon.voucherAmt - discountEff + serviceEff + canon.ongkirNet + feeEff);
  const ongkirEff = Math.max(0, canon.ongkirNet + residual);
  const voucherEff = canon.voucherAmt + Math.max(0, -(canon.ongkirNet + residual));

  // Reaporsi tiap komponen: perItem proporsional itemSplit; rata/nominal bobot
  // sama agar share ongkir/voucher/diskon/fee/pajak tetap diteruskan ke Pay.
  // Jumlah per-bill mode perItem = orderTotal persis (matematika bayar tak berubah).
  const { billTotals, voucherShares, discountShares, serviceShares, ongkirShares, feeShares, taxShares } = useMemo(() => {
    const weights = splitMode === 'perItem' ? itemSplits : Array(splits).fill(1);
    const base = splitMode === 'perItem' ? itemSum : splits;
    const v = splitShare(voucherEff, weights, base);
    const d = splitShare(discountEff, weights, base);
    const s = splitShare(serviceEff, weights, base);
    const o = splitShare(ongkirEff, weights, base);
    const f = splitShare(feeEff, weights, base);
    const tx = splitShare(canon.taxIncl, weights, base);
    const totals = itemSplits.map((it, i) =>
      Math.max(0, it - (v[i] as number) - (d[i] as number) + (s[i] as number) + (o[i] as number) + (f[i] as number)),
    );
    return { billTotals: totals, voucherShares: v, discountShares: d, serviceShares: s, ongkirShares: o, feeShares: f, taxShares: tx };
  }, [itemSplits, itemSum, voucherEff, discountEff, serviceEff, ongkirEff, feeEff, canon.taxIncl, splitMode, splits]);

  // Mode rata: total dibagi sama besar, sisa pembulatan masuk bill terakhir.
  const rataBase = splits > 0 ? Math.floor(orderTotal / splits) : 0;
  const rataTotals = useMemo(
    () =>
      Array.from(
        { length: splits },
        (_, i) => (i < splits - 1 ? rataBase : orderTotal - rataBase * (splits - 1)),
      ),
    [splits, rataBase, orderTotal],
  );
  // Mode nominal: input Rp per bill, sisa harus nol sebelum bisa bayar.
  const nominalNums = nominals.map((s) => Math.max(0, Number(String(s).replace(/[^0-9]/g, '')) || 0));
  const nominalSum = nominalNums.reduce((s, v) => s + v, 0);
  const nominalSisa = orderTotal - nominalSum;
  const nominalPas = nominalSisa === 0;
  const nominalBlocked = splitMode === 'nominal' && !nominalPas;

  const billVal = (i: number): number =>
    splitMode === 'rata'
      ? (rataTotals[i] as number)
      : splitMode === 'nominal'
        ? (nominalNums[i] ?? 0)
        : (billTotals[i] as number);

  const grand = orderTotal;
  const paidCount = paid.filter(Boolean).length;

  const payBill = (i: number) => {
    const val = billVal(i);
    if (val <= 0 || paid[i]) return;
    // Tanpa nomor grup = belum siap (nomor fallback masih diterbitkan).
    if (!groupNum) return;
    // Grup lunas penuh = tak ada kunjungan lagi.
    if (groupPaid.fullyPaid) return;
    // Mode nominal diblokir bila sisa != 0 (nominal belum pas dengan total).
    if (splitMode === 'nominal' && !nominalPas) return;
    // Kontrak grup: SELALU konteks penuh (semua item + diskon + voucher +
    // service/fee/pajak/ongkir) + SATU salesNum grup; kunjungan ini menagih
    // porsi `val` (di `total`), total order di `orderTotal`. Pay paham
    // splitGroup: kunjungan pertama saveSale penuh, berikut append kaki.
    // Voucher selalu bawa kode penuh: kuota terbakar 1x di create (append
    // abaikan voucher) — tanpa klaim manual yang rapuh.
    // Rounding tak diteruskan: tiap bill sudah bulat persis (pembulatan
    // pemanggil sudah dilipat ke ongkirEff via residual).
    navigation?.navigate('Pay', {
      total: val,
      orderTotal,
      salesNum: groupNum,
      splitGroup: true,
      method: methods[i],
      items,
      ...(mode ? { mode } : {}),
      ...(table ? { table } : {}),
      ...(customer ? { customer } : {}),
      ...(memberId ? { memberId } : {}),
      ...(ongkirEff > 0 ? { ongkir: ongkirEff } : {}),
      ...(voucherCode ? { voucher: { code: voucherCode, amount: voucherEff, ...(voucherKind ? { kind: voucherKind } : {}) } } : {}),
      ...(discountEff + voucherEff > 0 ? { discount: discountEff + voucherEff } : {}),
      ...(serviceEff > 0 ? { service: serviceEff } : {}),
      ...(feeEff > 0 ? { feeESB: feeEff } : {}),
      ...(canon.taxIncl > 0 ? { tax: canon.taxIncl } : {}),
    });
  };

  // Sinkron kebenaran DB tiap grup/bill berubah (termasuk kembali dari Pay):
  // cocokkan nominal kaki DB ke tiap bill (multiset) agar centang Lunas hanya
  // untuk bill yang benar dibayar; header Terbayar = angka DB, bukan tebakan.
  useEffect(() => {
    if (!groupNum) return;
    let alive = true;
    void (async () => {
      try {
        const g = await getGroupPaid(groupNum);
        if (!alive) return;
        setGroupPaid({ paidTotal: g.paidTotal, grandTotal: g.grandTotal, fullyPaid: g.fullyPaid, payCount: g.payCount });
        const rest = [...g.amounts];
        const flags = Array.from({ length: splits }, (_, idx) => {
          const v = billVal(idx);
          if (v <= 0) return false;
          const k = rest.findIndex((a) => a === v);
          if (k < 0) return false;
          rest.splice(k, 1);
          return true;
        });
        setPaid(flags);
      } catch {
        /* abaikan: centang lama bertahan, kasir tetap jalan */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupNum, splits, splitMode, itemSplits, rataTotals, nominalNums, billTotals]);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('sp_title')}
        sub={t('sp_lunas_of').replace('{p}', String(paidCount)).replace('{s}', String(splits))}
        onBack={() => navigation?.goBack()}
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
        <Text style={styles.hint}>{t('sp_hint')}</Text>
        {(mode || table) && (
          <Text style={styles.ctx}>{[mode, table ? `${t('table')} ${table}` : ''].filter(Boolean).join(' · ')}</Text>
        )}
        <Text style={styles.label}>{t('sp_count')}</Text>
        <View style={styles.chips}>
          {[2, 3, 4].map((n) => (
            <TouchableOpacity key={n} style={[styles.chip, splits === n && styles.chipOn, isTablet && styles.chipBig]} onPress={() => resetSplits(n)}>
              <Text style={[styles.chipT, splits === n && styles.chipTOn, isTablet && styles.chipTBig]}>÷{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>{t('bill_mode')}</Text>
        <View style={styles.chips}>
          {([['rata', t('bill_mode_even').replace('{n}', String(splits))], ['perItem', t('bill_mode_item')], ['nominal', t('bill_mode_nominal')]] as [SplitMode, string][]).map(([m, l]) => (
            <TouchableOpacity key={m} style={[styles.chip, splitMode === m && styles.chipOn, isTablet && styles.chipBig]} onPress={() => setSplitMode(m)}>
              <Text style={[styles.chipT, splitMode === m && styles.chipTOn, isTablet && styles.chipTBig]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.sumCard}>
          <View style={styles.metaRow}>
            <Text style={styles.metaL}>{t('c_subtotal')}</Text>
            <Text style={styles.metaV}>{rp(itemSum)}</Text>
          </View>
          {voucherEff > 0 && (
            <View style={styles.metaRow}>
              <Text style={styles.metaL}>{t('rc_voucher')}{voucherCode ? ` ${voucherCode}` : ''}</Text>
              <Text style={[styles.metaV, styles.metaDisc]}>-{rp(voucherEff)}</Text>
            </View>
          )}
          {discountEff > 0 && (
            <View style={styles.metaRow}>
              <Text style={styles.metaL}>{t('discount')}</Text>
              <Text style={[styles.metaV, styles.metaDisc]}>-{rp(discountEff)}</Text>
            </View>
          )}
          {serviceEff > 0 && (
            <View style={styles.metaRow}>
              <Text style={styles.metaL}>{t('serviceExcl')}</Text>
              <Text style={styles.metaV}>+{rp(serviceEff)}</Text>
            </View>
          )}
          {ongkirEff > 0 && (
            <View style={styles.metaRow}>
              <Text style={styles.metaL}>{t('deliveryFee')}</Text>
              <Text style={styles.metaV}>+{rp(ongkirEff)}</Text>
            </View>
          )}
          <View style={styles.metaRow}>
            <Text style={styles.metaL}>{t('taxIncl')}</Text>
            <Text style={styles.metaV}>{rp(canon.taxIncl)}</Text>
          </View>
          {feeEff > 0 && (
            <View style={styles.metaRow}>
              <Text style={styles.metaL}>{t('feeESB')}</Text>
              <Text style={styles.metaV}>+{rp(feeEff)}</Text>
            </View>
          )}
          <View style={styles.metaRow}>
            <Text style={styles.metaL}>{t('rounding')}</Text>
            <Text style={styles.metaV}>{canon.rounding >= 0 ? `+${rp(canon.rounding)}` : `-${rp(-canon.rounding)}`}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaL}>{t('total')}</Text>
            <Text style={styles.billTotal}>{rp(orderTotal)}</Text>
          </View>
          {groupPaid.payCount > 0 && (
            <View style={styles.metaRow}>
              <Text style={styles.metaL}>Terbayar {groupPaid.payCount} kaki</Text>
              <Text style={styles.metaV}>{rp(groupPaid.paidTotal)} / {rp(groupPaid.grandTotal > 0 ? groupPaid.grandTotal : orderTotal)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.sec}>{t('sp_items_sec')} · {rp(grand)}</Text>
        {splitMode === 'perItem' ? (
          items.map((it) => (
            <TouchableOpacity key={it.id} style={styles.itemRow} onPress={() => cycleAssign(it.id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{it.qty}× {it.name}</Text>
                <Text style={styles.itemPrice}>{rp(itemTotal(it))}</Text>
              </View>
              <Text style={styles.splitBadge}>{t('sp_name').replace('{n}', String((assign[it.id] ?? 0) + 1))} ›</Text>
            </TouchableOpacity>
          ))
        ) : splitMode === 'rata' ? (
          <Text style={styles.hint}>{t('bill_rata_hint')}</Text>
        ) : (
          <Text style={styles.hint}>{t('bill_nom_hint').replace('{t}', rp(orderTotal))}</Text>
        )}
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
        {/* Grid 2 kolom di tablet agar kartu tiap bill berdampingan. */}
        <View style={[isTablet && styles.billGrid]}>
        {splitMode === 'nominal' && (
          <View style={styles.sumCard}>
            {NAMES.slice(0, splits).map((name, i) => (
              <View key={name} style={styles.nomRow}>
                <Text style={styles.metaL}>{t('sp_name').replace('{n}', String(i + 1))}</Text>
                <TextInput
                  style={styles.nomInput}
                  value={nominals[i] ?? ''}
                  onChangeText={(v) => setNominals((arr) => arr.map((x, j) => (j === i ? v : x)))}
                  placeholder={rp(0)}
                  placeholderTextColor={colors.faint}
                  keyboardType="numeric"
                />
              </View>
            ))}
            <View style={styles.metaRow}>
              <Text style={styles.metaL}>{t('bill_remain')}</Text>
              <Text style={[styles.metaV, !nominalPas && styles.metaDisc]}>
                {nominalPas
                  ? t('bill_pas')
                  : nominalSisa > 0
                    ? t('bill_short').replace('{k}', rp(nominalSisa))
                    : t('bill_over').replace('{k}', rp(-nominalSisa))}
              </Text>
            </View>
            {!nominalPas && <Text style={styles.gateMsg}>{t('bill_gate')}</Text>}
          </View>
        )}
        {NAMES.slice(0, splits).map((name, i) => {
          const val = billVal(i);
          const members = splitMode === 'perItem' ? items.filter((it) => (assign[it.id] ?? 0) === i) : items;
          const label = t('sp_name').replace('{n}', String(i + 1));
          return (
            <View key={name} style={[styles.billCard, isTablet && styles.billCardWide]}>
              <View style={styles.billHead}>
                <Text style={[styles.billName, isTablet && styles.billNameBig]}>{label}</Text>
                <Text style={paid[i] ? [styles.lunas, isTablet && styles.lunasBig] : [styles.billTotal, isTablet && styles.billTotalBig]}>
                  {paid[i] ? t('bill_lunas') : rp(val)}
                </Text>
              </View>
              <Text style={styles.billItems}>
                {members.length === 0 ? t('sp_noitems') : members.map((m) => `${m.qty}× ${m.name}`).join(' · ')}
              </Text>
              {splitMode === 'perItem' && (
              <View style={styles.meta}>
                <View style={styles.metaRow}>
                  <Text style={styles.metaL}>{t('c_subtotal')}</Text>
                  <Text style={styles.metaV}>{rp(itemSplits[i] as number)}</Text>
                </View>
                {serviceEff > 0 && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaL}>{t('serviceExcl')}</Text>
                    <Text style={styles.metaV}>+{rp(serviceShares[i] as number)}</Text>
                  </View>
                )}
                {feeEff > 0 && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaL}>{t('feeESB')}</Text>
                    <Text style={styles.metaV}>+{rp(feeShares[i] as number)}</Text>
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
                    <Text style={styles.metaL}>{t('rc_voucher')}{voucherCode ? ` ${voucherCode}` : ''}</Text>
                    <Text style={[styles.metaV, styles.metaDisc]}>-{rp(voucherShares[i] as number)}</Text>
                  </View>
                )}
                {discountEff > 0 && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaL}>{t('discount')}</Text>
                    <Text style={[styles.metaV, styles.metaDisc]}>-{rp(discountShares[i] as number)}</Text>
                  </View>
                )}
              </View>
              )}
              <Text style={styles.label}>{t('sp_method')}</Text>
              <View style={styles.chips}>
                {METHODS.map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.chip, methods[i] === m && styles.chipOn, isTablet && styles.chipBig]}
                    onPress={() => setMethods((arr) => arr.map((x, j) => (j === i ? m : x)))}>
                    <Text style={[styles.chipT, methods[i] === m && styles.chipTOn, isTablet && styles.chipTBig]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.billActs}>
                {!paid[i] && (
                  <AppButton
                    size="sm"
                    title={`${t('sp_pay').replace('{m}', methods[i] as string)} ›`}
                    onPress={() => payBill(i)}
                    disabled={val <= 0 || nominalBlocked}
                    fullWidth={false}
                    style={[styles.payBtn, (val <= 0 || nominalBlocked) && styles.payOff, { marginTop: 0 }, isTablet && styles.payBtnBig]}
                    textStyle={[styles.payT, isTablet && styles.payTBig]}
                  />
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
        </View>
        {paidCount === splits && (
          <Text style={styles.done}>{t('sp_allpaid')}</Text>
        )}
        <AppButton
          size="md"
          title={t('sp_back')}
          onPress={() => navigation?.navigate('Cashier')}
          style={[styles.backBtn, { marginTop: 16 }]}
          textStyle={styles.backBtnT}
        />
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
  /* Grid tablet: kartu tiap bill 2 kolom berdampingan (phone tetap 1 kolom). */
  billGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  billCardWide: { flexBasis: '48%', flexGrow: 1, minWidth: 0, marginBottom: 0 },
  /* Varian tablet: teks +2pt, chip dan tombol bayar lebih besar. */
  chipBig: { paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  chipTBig: { fontSize: 14 },
  billNameBig: { fontSize: 17 },
  billTotalBig: { fontSize: 18 },
  lunasBig: { fontSize: 16 },
  payBtnBig: { paddingVertical: 14, minHeight: 48, justifyContent: 'center' },
  payTBig: { fontSize: 15 },
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
  sumCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  nomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
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
    outlineStyle: 'none' as never,
  },
  gateMsg: { fontFamily: fonts.semibold, fontSize: 12, color: colors.amberDark, marginTop: 6 },
  billActs: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 },
  payBtn: { backgroundColor: colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  payOff: { opacity: 0.4 },
  payT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  lunasT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy },
  done: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDark, textAlign: 'center', marginTop: 8 },
  backBtn: { backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 },
  backBtnT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
