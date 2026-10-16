import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import { useLang } from '../../lib/i18n';
import { unitPrice, type CartItem } from './CashierScreen';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      table?: string;
      mode?: string;
      items?: CartItem[];
      ongkir?: number;
      customer?: string;
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
  const isTablet = width >= 768;
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

  /** Bill meja ini - diambil dari cart kasir via params, bukan hardcode. */
  const billItems: CartItem[] = route?.params?.items ?? [];
  const active = billItems.filter((c) => !c.voided);
  const gross = active.reduce((s, c) => s + unitPrice(c) * c.qty, 0);
  const discTotal = active.reduce((s, c) => s + c.discount, 0);
  const net = gross - discTotal;
  /** PPN 11% inclusive (info-only): dasar sudah termasuk pajak. */
  const ppnIncl = Math.round((net * 11) / 111);
  const service = Math.round(net * 0.05);
  const ongkir = Math.max(0, route?.params?.ongkir ?? 0);
  const bruto = net + service + ongkir;
  /** Pembulatan ke kelipatan Rp 100 terdekat. */
  const total = Math.round(bruto / 100) * 100;
  const rounding = total - bruto;
  const itemCount = active.reduce((s, c) => s + c.qty, 0);
  const guestName = guest.trim() || t('guestFallback');

  const seats = SECTIONS[section] ?? [];

  const goCashier = () => navigation?.navigate('Cashier', { table, mode });
  const goSave = () =>
    navigation?.navigate('LoadOrder', {
      newOrder: {
        title: `${mode} · ${t('table')} ${table} · ${guestName}`,
        mode,
        table,
        items: active,
        ongkir,
      },
    });
  const goPrint = () => navigation?.navigate('Receipt', { total, mode, table });
  const goPay = () =>
    navigation?.navigate('Pay', {
      total,
      items: active,
      mode,
      table,
      ongkir,
      ...(guest.trim() ? { customer: guest.trim() } : {}),
    });

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('dineInTitle')}
        sub={`${t('table')} ${table} · ${section} · ${pax} ${t('guests')}`}
        onBack={() => navigation?.goBack()}
      />
      <ScrollView style={styles.list} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <Text style={styles.saved}>{t('saved')}</Text>

      <Text style={styles.label}>{t('section')}</Text>
      <View style={styles.chips}>
        {Object.keys(SECTIONS).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.chip, section === s && styles.chipOn]}
            onPress={() => { setSection(s); setTable((SECTIONS[s] ?? [])[0] ?? ''); }}>
            <Text style={[styles.chipT, section === s && styles.chipTOn]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t('table')}</Text>
      <View style={styles.chips}>
        {seats.map((st) => (
          <TouchableOpacity key={st} style={[styles.chip, table === st && styles.chipOn]} onPress={() => setTable(st)}>
            <Text style={[styles.chipT, table === st && styles.chipTOn]}>{st}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.duo}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{t('pax')}</Text>
          <TextInput
            style={styles.input}
            value={pax}
            onChangeText={setPax}
            keyboardType="numeric"
            placeholder="2"
            placeholderTextColor={colors.faint}
          />
        </View>
        <View style={{ flex: 2 }}>
          <Text style={styles.label}>{t('guestName')}</Text>
          <TextInput
            style={styles.input}
            value={guest}
            onChangeText={setGuest}
            placeholder={t('guestName')}
            placeholderTextColor={colors.faint}
          />
        </View>
      </View>

      <Text style={styles.label}>{t('txMode')}</Text>
      <View style={styles.chips}>
        {MODES.map((m) => (
          <TouchableOpacity key={m} style={[styles.chip, mode === m && styles.chipOn]} onPress={() => setMode(m)}>
            <Text style={[styles.chipT, mode === m && styles.chipTOn]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.bill}>
        <Text style={styles.billTitle}>{guestName} · {t('table')} {table} · {pax} pax · {itemCount} item</Text>
        {active.length === 0 ? (
          <View style={styles.billEmpty}>
            <Text style={styles.billEmptyT}>{t('cartEmpty')}</Text>
            <TouchableOpacity style={styles.billEmptyBtn} onPress={goCashier}>
              <Text style={styles.billEmptyBtnT}>＋ {t('addMenu')} ›</Text>
            </TouchableOpacity>
          </View>
        ) : (
          active.map((it) => (
            <View key={it.id} style={styles.row}>
              <Text style={styles.item}>{it.qty}x {it.name}</Text>
              <Text style={styles.price}>{rp(unitPrice(it) * it.qty - it.discount)}</Text>
            </View>
          ))
        )}
        <View style={styles.row}><Text style={styles.item}>{t('subtotalGross')}</Text><Text style={styles.price}>{rp(gross)}</Text></View>
        {discTotal > 0 && (
          <View style={styles.row}><Text style={styles.item}>{t('discount')}</Text><Text style={styles.disc}>-{rp(discTotal)}</Text></View>
        )}
        <View style={styles.row}><Text style={styles.item}>{t('taxIncl')}</Text><Text style={styles.price}>{rp(ppnIncl)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>{t('serviceExcl')}</Text><Text style={styles.price}>{rp(service)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>{t('deliveryFee')}</Text><Text style={styles.price}>{rp(ongkir)}</Text></View>
        <View style={styles.row}><Text style={styles.item}>Rounding</Text><Text style={styles.price}>{rp(rounding)}</Text></View>
        <View style={styles.totalRow}><Text style={styles.totalL}>{t('total')}</Text><Text style={styles.totalV}>{rp(total)}</Text></View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghost} onPress={goSave}>
          <Text style={styles.ghostT}>{t('save')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghost} onPress={goPrint}>
          <Text style={styles.ghostT}>{t('printReceipt')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={active.length > 0 ? goPay : goCashier}>
          <Text style={styles.primaryT}>{t('pay')} | {rp(total)} ›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.links}>
        <TouchableOpacity onPress={() => navigation?.navigate('MoveTable', { from: table })}>
          <Text style={styles.link}>{t('moveTable')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation?.navigate('SplitBill', active.length > 0 ? { items: active, total } : {})}>
          <Text style={styles.link}>{t('splitBill')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goCashier}>
          <Text style={styles.link}>{t('addMenu')} ›</Text>
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
});
