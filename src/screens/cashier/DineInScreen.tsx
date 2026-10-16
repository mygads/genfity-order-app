import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { useLang } from '../../lib/i18n';
import { TAX_DEFAULT, defaultOngkirForMode, getTaxRate, isMarketplaceMode, totals } from '../../lib/totals';
import { unitPrice, type CartItem } from './CashierScreen';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Voucher = { code: string; amount: number; kind?: string };
type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      table?: string;
      mode?: string;
      items?: CartItem[];
      ongkir?: number;
      customer?: string;
      memberId?: string;
      voucher?: Voucher;
    };
  };
};

/** Kanonis mengikuti TablesScreen: no tanpa strip + section Dalam/Teras/VIP. */
const SECTIONS: Record<string, string[]> = {
  Dalam: ['A1', 'A2', 'A3', 'A4'],
  Teras: ['B1', 'B2', 'B3'],
  VIP: ['C1', 'C2'],
};
/** Kode lama ber-strip ("A-03" → "A3") ke kanonis tanpa strip. */
function canonTableNo(raw: string): string {
  const t = (raw || '').trim().toUpperCase();
  if (t === 'VIP-1' || t === 'VIP1') return 'C1';
  if (t === 'VIP-2' || t === 'VIP2') return 'C2';
  const m = t.match(/^([A-Z]+)-?0*(\d+)$/);
  if (m) return `${m[1]}${m[2]}`;
  return t.replace(/-/g, '');
}
function sectionOf(no: string): string {
  for (const [sec, list] of Object.entries(SECTIONS)) {
    if (list.includes(no)) return sec;
  }
  return 'Dalam';
}
const MODES = ['DINE IN', 'TAKE AWAY', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'];

/** Dine In - pilih section + meja, pax, nama tamu, ringkasan bill, Simpan/Cetak/Bayar. */
export default function DineInScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const initTable = (() => {
    const raw = route?.params?.table ?? 'A3';
    const code = canonTableNo(raw);
    return (Object.values(SECTIONS).flat().includes(code) ? code : 'A3');
  })();
  const [section, setSection] = useState(() => sectionOf(initTable));
  const [table, setTable] = useState(initTable);
  const [pax, setPax] = useState('2');
  const [guest, setGuest] = useState(route?.params?.customer ?? '');
  const [mode, setMode] = useState(
    route?.params?.mode && MODES.includes(route.params.mode) ? route.params.mode : 'DINE IN',
  );
  const [memberId] = useState(route?.params?.memberId ?? '');
  /** Tarif pajak setting-driven (ms_setting Tax/PPN, fallback 11). */
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

  /** Bill meja ini - diambil dari cart kasir via params, bukan hardcode. */
  const billItems: CartItem[] = route?.params?.items ?? [];
  const active = billItems.filter((c) => !c.voided);
  /** Voucher dari kasir/promo - diteruskan ke helper agar setara Cashier. */
  const voucher: Voucher | null = route?.params?.voucher ?? null;
  const ongkir = Math.max(0, route?.params?.ongkir ?? defaultOngkirForMode(route?.params?.mode));
  /** Kanonis via helper: voucher ongkir/persen/flat, service 5%, pajak incl info-only (setting, default 11), rounding 100. */
  const subtotalGross = active.reduce((s, c) => s + unitPrice(c) * c.qty, 0);
  const discountTotal = active.reduce((s, c) => s + c.discount, 0);
  const {
    voucherAmt,
    subtotal,
    service,
    taxIncl,
    ongkirCut,
    ongkirNet,
    bruto,
    total,
    rounding,
    feeESB,
  } = totals({
    gross: subtotalGross,
    discount: discountTotal,
    ongkir,
    voucher: voucher ?? undefined,
    esbOrder: isMarketplaceMode(mode),
    taxRate,
  });
  const useOngkirCut = (voucher?.kind === 'Ongkir' || voucher?.code === 'GRATISONGKIR') && ongkir > 0;
  /** Alias lama agar sisa render tetap jalan. */
  const gross = subtotalGross;
  const discTotal = discountTotal;
  const net = subtotal;
  const itemCount = active.reduce((s, c) => s + c.qty, 0);
  const guestName = guest.trim() || t('guestFallback');

  const seats = SECTIONS[section] ?? [];

  const goCashier = () =>
    navigation?.navigate('Cashier', {
      table, mode,
      ...(guest.trim() ? { customer: guest.trim() } : {}),
    });
  const goSave = () =>
    navigation?.navigate('LoadOrder', {
      newOrder: {
        title: `${mode} · ${t('table')} ${table} · ${guestName}`,
        mode,
        table,
        items: active,
        ongkir: ongkirNet,
      },
    });
  /** Paket struk penuh ala POSLite: item + diskon + voucher + ongkir + meja + tamu. */
  const discountForChain = discountTotal + voucherAmt;
  const goPrint = () =>
    navigation?.navigate('Receipt', {
      total, mode, table,
      items: active,
      discount: discountForChain,
      ...(voucher ? { voucherCode: voucher.code } : {}),
      ongkir: ongkirNet,
      // Rincian info-only agar baris struk pas dengan total (service/pajak/fee/pembulatan).
      ...(service > 0 ? { service } : {}),
      ...(taxIncl > 0 ? { tax: taxIncl } : {}),
      ...(feeESB > 0 ? { feeESB } : {}),
      ...(rounding !== 0 ? { rounding } : {}),
      ...(guest.trim() ? { customer: guest.trim() } : {}),
      ...(memberId ? { memberId } : {}),
    });
  // Rantai Pay (kontrak PayScreen): total penuh + items/mode/table/ongkir/voucher/customer/memberId
  // + diskon belanja + rincian info-only agar Pay teruskan ke Success > Receipt.
  // Voucher sebagai OBJEK {code, amount, kind} (Pay dahulukan discount angka, tanpa hitung ganda).
  const goPay = () =>
    navigation?.navigate('Pay', {
      total,
      items: active,
      mode,
      table,
      discount: discountForChain,
      ...(voucher ? { voucher: { code: voucher.code, amount: voucher.amount, ...(voucher.kind ? { kind: voucher.kind } : {}) } } : {}),
      ongkir: ongkirNet,
      ...(service > 0 ? { service } : {}),
      ...(taxIncl > 0 ? { tax: taxIncl } : {}),
      ...(feeESB > 0 ? { feeESB } : {}),
      ...(rounding !== 0 ? { rounding } : {}),
      ...(guest.trim() ? { customer: guest.trim() } : {}),
      ...(memberId ? { memberId } : {}),
    });

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('dineInTitle')}
        sub={`${t('table')} ${table} · ${section} · ${pax} ${t('guests')}`}
        onBack={() => navigation?.goBack()}
      />
      <ScrollView style={styles.list} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={[styles.saved, isTablet && styles.savedBig]}>{t('saved')}</Text>

      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('section')}</Text>
      <View style={styles.chips}>
        {Object.keys(SECTIONS).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.chip, section === s && styles.chipOn]}
            onPress={() => { setSection(s); setTable((SECTIONS[s] ?? [])[0] ?? ''); }}>
            <Text style={[styles.chipT, section === s && styles.chipTOn, isTablet && styles.chipTBig]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('table')}</Text>
      <View style={styles.chips}>
        {seats.map((st) => (
          <TouchableOpacity key={st} style={[styles.chip, table === st && styles.chipOn]} onPress={() => setTable(st)}>
            <Text style={[styles.chipT, table === st && styles.chipTOn, isTablet && styles.chipTBig]}>{st}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.duo}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, isTablet && styles.labelBig]}>{t('pax')}</Text>
          <AppInput
            boxStyle={styles.input}
            style={[styles.fieldText, isTablet && styles.inputBig]}
            value={pax}
            onChangeText={setPax}
            keyboardType="numeric"
            placeholder="2"
          />
        </View>
        <View style={{ flex: 2 }}>
          <Text style={[styles.label, isTablet && styles.labelBig]}>{t('guestName')}</Text>
          <AppInput
            boxStyle={styles.input}
            style={[styles.fieldText, isTablet && styles.inputBig]}
            value={guest}
            onChangeText={setGuest}
            placeholder={t('guestName')}
          />
        </View>
      </View>

      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('txMode')}</Text>
      <View style={styles.chips}>
        {MODES.map((m) => (
          <TouchableOpacity key={m} style={[styles.chip, mode === m && styles.chipOn]} onPress={() => setMode(m)}>
            <Text style={[styles.chipT, mode === m && styles.chipTOn, isTablet && styles.chipTBig]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.bill}>
        <Text style={[styles.billTitle, isTablet && styles.billTitleBig]}>{guestName} · {t('table')} {table} · {pax} pax · {itemCount} item</Text>
        {active.length === 0 ? (
          <View style={styles.billEmpty}>
            <Text style={[styles.billEmptyT, isTablet && styles.billEmptyTBig]}>{t('cartEmpty')}</Text>
            <AppButton
              size="sm"
              title={`＋ ${t('addMenu')} ›`}
              onPress={goCashier}
              fullWidth={false}
              style={[styles.billEmptyBtn, { marginTop: 10 }]}
              textStyle={styles.billEmptyBtnT}
            />
          </View>
        ) : (
          active.map((it) => (
            <View key={it.id} style={styles.row}>
              <Text style={[styles.item, isTablet && styles.itemBig]}>{it.qty}x {it.name}</Text>
              <Text style={[styles.price, isTablet && styles.priceBig]}>{rp(unitPrice(it) * it.qty - it.discount)}</Text>
            </View>
          ))
        )}
        <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemBig]}>{t('subtotalGross')}</Text><Text style={[styles.price, isTablet && styles.priceBig]}>{rp(gross)}</Text></View>
        {discTotal > 0 && (
          <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemBig]}>{t('discount')}</Text><Text style={[styles.disc, isTablet && styles.priceBig]}>-{rp(discTotal)}</Text></View>
        )}
        {voucher && !useOngkirCut && voucherAmt > 0 && (
          <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemBig]}>Voucher {voucher.code}</Text><Text style={[styles.disc, isTablet && styles.priceBig]}>-{rp(voucherAmt)}</Text></View>
        )}
        <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemBig]}>{t('taxIncl')}</Text><Text style={[styles.price, isTablet && styles.priceBig]}>{rp(taxIncl)}</Text></View>
        <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemBig]}>{t('serviceExcl')}</Text><Text style={[styles.price, isTablet && styles.priceBig]}>{rp(service)}</Text></View>
        {feeESB > 0 && (
          <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemBig]}>{t('feeESB')}</Text><Text style={[styles.price, isTablet && styles.priceBig]}>{rp(feeESB)}</Text></View>
        )}
        <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemBig]}>{t('deliveryFee')}</Text><Text style={[styles.price, isTablet && styles.priceBig]}>{rp(ongkirNet)}</Text></View>
        {voucher && useOngkirCut && (
          <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemBig]}>Voucher {voucher.code}</Text><Text style={[styles.disc, isTablet && styles.priceBig]}>-{rp(ongkirCut)}</Text></View>
        )}
        <View style={styles.row}><Text style={[styles.item, isTablet && styles.itemBig]}>{t('rounding')}</Text><Text style={[styles.price, isTablet && styles.priceBig]}>{rp(rounding)}</Text></View>
        <View style={styles.totalRow}><Text style={[styles.totalL, isTablet && styles.totalLBig]}>{t('total')}</Text><Text style={[styles.totalV, isTablet && styles.totalVBig]}>{rp(total)}</Text></View>
      </View>

      <View style={styles.actions}>
        <AppButton
          size="md"
          variant="secondary"
          title={t('save')}
          onPress={goSave}
          fullWidth={false}
          style={styles.ghost}
          textStyle={styles.ghostT}
        />
        <AppButton
          size="md"
          variant="secondary"
          title={t('printReceipt')}
          onPress={goPrint}
          fullWidth={false}
          style={styles.ghost}
          textStyle={styles.ghostT}
        />
        <AppButton
          size="lg"
          title={`${t('pay')} | ${rp(total)} ›`}
          onPress={active.length > 0 ? goPay : goCashier}
          fullWidth={false}
          style={styles.primary}
          textStyle={styles.primaryT}
        />
      </View>
      <View style={styles.links}>
        <TouchableOpacity onPress={() => navigation?.navigate('MoveTable', { from: table })}>
          <Text style={[styles.link, isTablet && styles.linkBig]}>{t('moveTable')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation?.navigate('SplitBill', active.length > 0 ? {
          items: active, total,
          ...(mode ? { mode } : {}),
          ...(table ? { table } : {}),
          ...(guest.trim() ? { customer: guest.trim() } : {}),
          ...(ongkirNet > 0 ? { ongkir: ongkirNet } : {}),
          ...(voucher ? { voucher: { code: voucher.code, amount: voucher.amount, ...(voucher.kind ? { kind: voucher.kind } : {}) } } : {}),
          ...(memberId ? { memberId } : {}),
          discount: discountTotal + voucherAmt,
        } : {})}>
          <Text style={[styles.link, isTablet && styles.linkBig]}>{t('splitBill')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goCashier}>
          <Text style={[styles.link, isTablet && styles.linkBig]}>{t('addMenu')} ›</Text>
        </TouchableOpacity>
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  body: { padding: 16, paddingBottom: 40 },
  saved: { fontFamily: fonts.medium, fontSize: 12, color: colors.greenDark, marginTop: 2 },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  duo: { flexDirection: 'row', gap: 10 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
  },
  /** Teks di dalam AppInput: medium ala form lama. */
  fieldText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  bill: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.line },
  billTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 8 },
  item: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, flex: 1 },
  price: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  disc: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, marginTop: 8, paddingTop: 10 },
  totalL: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy },
  totalV: { fontFamily: fonts.bold, fontSize: 17, color: colors.orangeDark },
  billEmpty: { alignItems: 'center', paddingVertical: 12 },
  billEmptyT: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, textAlign: 'center' },
  billEmptyBtn: { backgroundColor: colors.orange, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, marginTop: 10 },
  billEmptyBtnT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  primary: { flex: 2, backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
  ghost: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, alignItems: 'center' },
  ghostT: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  links: { flexDirection: 'row', gap: 16, marginTop: 14, flexWrap: 'wrap' },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  /* Varian tablet (breakpoint 768): teks +1..2pt agar proporsional di layar lebar. */
  savedBig: { fontSize: 13 },
  labelBig: { fontSize: 13 },
  chipTBig: { fontSize: 13 },
  inputBig: { fontSize: 15 },
  billTitleBig: { fontSize: 15 },
  itemBig: { fontSize: 14 },
  priceBig: { fontSize: 14 },
  totalLBig: { fontSize: 17 },
  totalVBig: { fontSize: 19 },
  billEmptyTBig: { fontSize: 14 },
  billEmptyBtnTBig: { fontSize: 14 },
  ghostTBig: { fontSize: 15 },
  primaryTBig: { fontSize: 15 },
  linkBig: { fontSize: 14 },
});
