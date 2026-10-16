import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { colors, fonts, rp, wideCenter } from '../../theme';
import { itemTotal, unitPrice, type CartItem } from './CashierScreen';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type Voucher = { code: string; amount: number };

type Props = {
  navigation?: Nav;
  route?: { params?: { items?: CartItem[]; total?: number; voucher?: Voucher } };
};

export default function CartDetailScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [items, setItems] = useState<CartItem[]>(route?.params?.items ?? []);
  const [voucher, setVoucher] = useState<Voucher | null>(route?.params?.voucher ?? null);
  const routeTotal = route?.params?.total;
  // Editor per item: qty stepper inline, panel harga + catatan
  const [editingId, setEditingId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [savedTick, setSavedTick] = useState(false);

  const active = useMemo(() => items.filter((c) => !c.voided), [items]);
  const subtotalGross = useMemo(
    () => active.reduce((s, c) => s + unitPrice(c) * c.qty, 0),
    [active],
  );
  const discountTotal = useMemo(() => active.reduce((s, c) => s + c.discount, 0), [active]);
  const voucherAmt = Math.min(voucher?.amount ?? 0, Math.max(0, subtotalGross - discountTotal));
  const subtotal = subtotalGross - discountTotal - voucherAmt;
  const service = Math.round(subtotal * 0.05);
  const pb1incl = Math.round((subtotal * 10) / 110);
  const total = subtotal + service;
  const itemCount = active.reduce((s, c) => s + c.qty, 0);

  const incQty = (id: string) =>
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, qty: c.qty + 1 } : c)));
  const decQty = (id: string) =>
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, qty: Math.max(1, c.qty - 1) } : c)));
  const removeItem = (id: string) => setItems((prev) => prev.filter((c) => c.id !== id));
  const voidItem = (id: string) => {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, voided: true } : c)));
    setEditingId(null);
  };
  const unvoidItem = (id: string) =>
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, voided: false } : c)));

  const openEditor = (c: CartItem) => {
    setEditingId(c.id);
    setPriceDraft(String(c.basePrice));
    setNoteDraft(c.note ?? '');
  };

  const saveEditor = () => {
    if (!editingId) return;
    const price = Math.max(0, Number(priceDraft.replace(/[^0-9]/g, '')) || 0);
    setItems((prev) =>
      prev.map((c) =>
        c.id === editingId ? { ...c, basePrice: price, note: noteDraft.trim() || undefined } : c,
      ),
    );
    setEditingId(null);
  };

  const goPay = () =>
    navigation?.navigate('Pay', { total, ...(voucher ? { voucher: voucher.code } : {}) });
  const goPromo = () => navigation?.navigate('PromotionList', { returnTo: 'CartDetail' });
  const goSave = () => {
    setSavedTick(true);
    navigation?.navigate('LoadOrder');
  };

  return (
    <View style={styles.root}>
      {/* Header navy */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detail Pesanan</Text>
        <Text style={styles.headerCount}>{itemCount} item</Text>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, isTablet && wideCenter]}>
        {items.map((c, idx) => (
          <View key={c.id} style={[styles.row, c.voided && styles.rowVoid]}>
            {/* Lingkaran biru nomor */}
            <View style={[styles.numCircle, c.voided && styles.numVoid]}>
              <Text style={styles.numText}>{idx + 1}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.itemName, c.voided && styles.voidName]} numberOfLines={2}>
                {c.name} x{c.qty}
                {c.voided ? ' (Void)' : ''}
              </Text>
              {/* Modifier biru */}
              {c.modifiers.map((m, i) => (
                <Text key={i} style={styles.modifier}>
                  + {m.name}
                  {m.price > 0 ? `  +${rp(m.price)}` : ''}
                </Text>
              ))}
              {c.note ? <Text style={styles.note}>📝 {c.note}</Text> : null}
              {c.discount > 0 && <Text style={styles.discount}>- Diskon {rp(c.discount)}</Text>}
              {c.voided ? (
                <TouchableOpacity onPress={() => unvoidItem(c.id)}>
                  <Text style={styles.restoreT}>Kembalikan item</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.rowActs}>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      style={[styles.stepBtn, c.qty <= 1 && styles.stepOff]}
                      onPress={() => decQty(c.id)}
                      disabled={c.qty <= 1}>
                      <Text style={styles.stepT}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepQty}>{c.qty}</Text>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => incQty(c.id)}>
                      <Text style={styles.stepT}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => (editingId === c.id ? setEditingId(null) : openEditor(c))}>
                    <Text style={styles.editLink}>
                      {editingId === c.id ? 'Tutup ▴' : '✎ Harga / catatan'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {editingId === c.id && !c.voided && (
                <View style={styles.editor}>
                  <Text style={styles.editorLabel}>Harga satuan (Rp)</Text>
                  <TextInput
                    style={styles.editorInput}
                    value={priceDraft}
                    onChangeText={setPriceDraft}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.faint}
                  />
                  <Text style={styles.editorLabel}>Catatan item</Text>
                  <TextInput
                    style={styles.editorInput}
                    value={noteDraft}
                    onChangeText={setNoteDraft}
                    placeholder="cth: Level 3, es sedikit"
                    placeholderTextColor={colors.faint}
                  />
                  <View style={styles.editorRow}>
                    <TouchableOpacity style={styles.editorVoid} onPress={() => voidItem(c.id)}>
                      <Text style={styles.editorVoidT}>Void</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.editorSave} onPress={saveEditor}>
                      <Text style={styles.editorSaveT}>Simpan</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
            {/* Harga kanan */}
            <Text style={styles.price}>{rp(itemTotal(c))}</Text>
            {/* X merah */}
            <TouchableOpacity style={styles.delBtn} onPress={() => removeItem(c.id)} hitSlop={12}>
              <Text style={styles.delText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {items.length === 0 && (
          <View style={styles.emptyWrap}>
            <Image
              source={require('../../../assets/images/empty_order.webp')}
              style={styles.emptyImg}
              resizeMode="contain"
            />
            <Text style={styles.emptyTitle}>Keranjang masih kosong</Text>
            <Text style={styles.emptySub}>Tambah menu dari kasir untuk mulai mencatat pesanan.</Text>
            <TouchableOpacity style={styles.emptyCta} onPress={() => navigation?.navigate('Cashier')}>
              <Text style={styles.emptyCtaText}>＋ Tambah Menu</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Voucher / promo ringkas */}
        {items.length > 0 && (
          <View style={styles.promoCard}>
            <Text style={styles.promoTitle}>Voucher / Promo</Text>
            {voucher ? (
              <View style={styles.promoRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.promoCode}>{voucher.code}</Text>
                  <Text style={styles.promoDesc}>Potongan {rp(voucherAmt)}</Text>
                </View>
                <TouchableOpacity onPress={() => setVoucher(null)} hitSlop={10}>
                  <Text style={styles.promoRemove}>Hapus ✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.promoBtn} onPress={goPromo}>
                <Text style={styles.promoBtnT}>＋ Pakai Promo / Voucher</Text>
              </TouchableOpacity>
            )}
            {voucher ? (
              <TouchableOpacity onPress={goPromo}>
                <Text style={styles.promoChange}>Ganti voucher ›</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Totals */}
        {items.length > 0 && (
          <View style={styles.totals}>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Subtotal (bruto)</Text>
              <Text style={styles.sumValue}>{rp(subtotalGross)}</Text>
            </View>
            {discountTotal > 0 && (
              <View style={styles.sumRow}>
                <Text style={styles.sumLabel}>Diskon item</Text>
                <Text style={[styles.sumValue, styles.red]}>-{rp(discountTotal)}</Text>
              </View>
            )}
            {voucher && (
              <View style={styles.sumRow}>
                <Text style={styles.sumLabel}>Voucher {voucher.code}</Text>
                <Text style={[styles.sumValue, styles.red]}>-{rp(voucherAmt)}</Text>
              </View>
            )}
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Subtotal (net)</Text>
              <Text style={styles.sumValue}>{rp(subtotal)}</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Pajak PB1 (incl)</Text>
              <Text style={styles.sumValue}>{rp(pb1incl)}</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Service 5% (excl)</Text>
              <Text style={styles.sumValue}>{rp(service)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{rp(total)}</Text>
            </View>
          </View>
        )}

        {/* Aksi lanjutan ala POSLite: split & pindah */}
        {items.length > 0 && (
          <View style={styles.linksRow}>
            <TouchableOpacity onPress={() => navigation?.navigate('SplitBill', { items, total })}>
              <Text style={styles.link}>Bagi Bill ›</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation?.navigate('MoveItems', {})}>
              <Text style={styles.link}>Pindah Item ›</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation?.navigate('BillPreview')}>
              <Text style={styles.link}>Pratinjau Bill ›</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation?.navigate('MoveTable', {})}>
              <Text style={styles.link}>Pindah Meja ›</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Simpan / Cetak / Bayar — sembunyi saat keranjang 0, ganti CTA tambah menu */}
      <View style={styles.footer}>
        {routeTotal !== undefined && routeTotal !== total && items.length > 0 && (
          <Text style={styles.footerNote}>
            Total diperbarui dari {rp(routeTotal)} → {rp(total)} setelah perubahan item
          </Text>
        )}
        {savedTick && items.length > 0 && (
          <Text style={styles.footerNote}>Order tersimpan — buka kembali via Muat.</Text>
        )}
        {items.length === 0 ? (
          <TouchableOpacity style={styles.payBtn} onPress={() => navigation?.navigate('Cashier')}>
            <Text style={styles.payText}>＋ Tambah Menu ›</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.footerRow}>
              <TouchableOpacity style={styles.saveBtn} onPress={goSave}>
                <Text style={styles.saveText}>🧺 Simpan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.printBtn}
                onPress={() => navigation?.navigate('LoadOrder')}>
                <Text style={styles.printText}>📂 Muat</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.printBtn}
                onPress={() => navigation?.navigate('Receipt', { total })}>
                <Text style={styles.printText}>🖨 Cetak</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.payBtn} onPress={goPay}>
              <Text style={styles.payText}>Bayar | {rp(total)} ›</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  back: { color: colors.white, fontSize: 26, fontFamily: fonts.bold },
  headerTitle: { flex: 1, color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  headerCount: { color: colors.navyTint, fontFamily: fonts.regular, fontSize: 12 },
  list: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rowVoid: { opacity: 0.65 },
  numCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  numVoid: { backgroundColor: colors.faint },
  numText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  rowBody: { flex: 1 },
  itemName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  voidName: { textDecorationLine: 'line-through', color: colors.faint },
  modifier: { fontFamily: fonts.regular, fontSize: 12, color: colors.blue, marginTop: 2 },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.blue, marginTop: 2 },
  discount: { fontFamily: fonts.regular, fontSize: 12, color: colors.red, marginTop: 2 },
  restoreT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.greenDark, marginTop: 4 },
  rowActs: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepOff: { borderColor: colors.line },
  stepT: { color: colors.navy, fontFamily: fonts.bold, fontSize: 16 },
  stepQty: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, minWidth: 22, textAlign: 'center' },
  editLink: { fontFamily: fonts.medium, fontSize: 12, color: colors.blue },
  editor: { backgroundColor: colors.paleBlue, borderRadius: 8, padding: 10, marginTop: 8 },
  editorLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy, marginTop: 6 },
  editorInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 9,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.text,
    marginTop: 4,
  },
  editorRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  editorVoid: { flex: 1, borderWidth: 1, borderColor: colors.red, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  editorVoidT: { fontFamily: fonts.bold, fontSize: 13, color: colors.red },
  editorSave: { flex: 2, backgroundColor: colors.navy, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  editorSaveT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  price: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy, marginLeft: 8, marginTop: 2 },
  delBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  delText: { color: colors.red, fontSize: 12, fontFamily: fonts.bold },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyImg: { width: 130, height: 130 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginTop: 14 },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'center' },
  emptyCta: {
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 13,
    marginTop: 16,
  },
  emptyCtaText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  promoCard: { backgroundColor: colors.card, borderRadius: 10, padding: 14, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  promoTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  promoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  promoCode: { fontFamily: fonts.bold, fontSize: 14, color: colors.greenDark },
  promoDesc: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  promoRemove: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red },
  promoBtn: { backgroundColor: colors.paleOrange, borderWidth: 1, borderColor: colors.orange, borderRadius: 8, padding: 11, alignItems: 'center', marginTop: 8 },
  promoBtnT: { fontFamily: fonts.bold, fontSize: 13, color: colors.orangeDark },
  promoChange: { fontFamily: fonts.medium, fontSize: 12, color: colors.blue, marginTop: 8 },
  totals: {
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  sumLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  sumValue: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  red: { color: colors.red },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  totalLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  totalValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.orange },
  linksRow: { flexDirection: 'row', gap: 16, marginTop: 12, flexWrap: 'wrap' },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  footer: { backgroundColor: colors.white, padding: 12, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  footerNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.amberDark, textAlign: 'center' },
  footerRow: { flexDirection: 'row', gap: 8 },
  saveBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.orange,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  saveText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orange },
  printBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  printText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  payBtn: {
    backgroundColor: colors.blueDark,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  payText: { fontFamily: fonts.bold, fontSize: 16, color: colors.white },
});
