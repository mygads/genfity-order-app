import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ScreenHeader from '../../components/ScreenHeader';
import SupervisorApprovalDialog from '../../components/SupervisorApprovalDialog';
import { SUPERVISOR_ACTION_ORDER_VOID } from '../../lib/supervisor';
import { useLang, tCur } from '../../lib/i18n';
import { TAX_DEFAULT, defaultOngkirForMode, getPackagingFee, getRoundStep, getServiceConfig, getTaxRate, isMarketplaceMode, SERVICE_LEGACY, serviceLabel, platformFeeLabel, totals, voucherExtras, type ServiceConfig } from '../../lib/totals';
import { itemTotal, unitPrice, type CartItem } from './CashierScreen';
import { initDb, run } from '../../lib/db';
import { enqueueSync } from '../../lib/sync';
import { nextSalesNum } from '../../lib/sales';
import { getSession } from '../../session';
import { requireAccess } from '../../lib/access';
import { postTableTransition } from '../../lib/terminalTable';
import { parseCustomerId } from '../../lib/memberRef';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type Voucher = { code: string; amount: number; kind?: string; rate?: number; maxAmount?: number; minSpend?: number };

type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      items?: CartItem[];
      total?: number;
      voucher?: Voucher;
      mode?: string;
      table?: string;
      customer?: string;
      memberId?: string;
      /** Ronde-3 Q1: customerId GO (int) — diteruskan rantai ke Pay. */
      customerId?: number;
      ongkir?: number;
      packaging?: number;
      subtotal?: number;
      salesNum?: string;
    };
  };
};

export default function CartDetailScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [items, setItems] = useState<CartItem[]>(route?.params?.items ?? []);
  const [voucher, setVoucher] = useState<Voucher | null>(route?.params?.voucher ?? null);
  const [mode, setMode] = useState(route?.params?.mode ?? 'DINE IN');
  const [table, setTable] = useState(route?.params?.table ?? '');
  const [customer, setCustomer] = useState(route?.params?.customer ?? '');
  const [memberId, setMemberId] = useState(route?.params?.memberId ?? '');
  /** Ronde-3 Q1: ref GO — dibawa di semua rantai keluar (Pay/Split/BillPreview). */
  const [customerId, setCustomerId] = useState<number | null>(parseCustomerId(route?.params?.customerId));
  /** Nomor struk draft: dipakai ulang saat bayar + kunci hapus draft di Success. */
  const [salesNum, setSalesNum] = useState(route?.params?.salesNum ?? '');
  /** Tarif pajak setting-driven (ms_setting Tax/PPN, fallback 11). */
  const [taxRate, setTaxRate] = useState(TAX_DEFAULT);
  /** Service charge server-driven (audit trisisi #1) + langkah pembulatan
   * Go-lane (audit #3): legacy 5% / step 100 sampai pull server terbaca. */
  const [svcCfg, setSvcCfg] = useState<ServiceConfig>(SERVICE_LEGACY);
  const [roundStep, setRoundStep] = useState<number | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void getTaxRate().then((r) => {
      if (alive) setTaxRate(r);
    });
    void getServiceConfig().then((c) => {
      if (alive) setSvcCfg(c);
    });
    void getRoundStep().then((s) => {
      if (alive) setRoundStep(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  /** Biaya kemasan: params pemanggil menang (sudah dihitung untuk mode ini);
   * tanpa params = baca dari info merchant via getPackagingFee(mode). */
  const [packagingFee, setPackagingFee] = useState(Math.max(0, Math.round(Number(route?.params?.packaging) || 0)));
  useEffect(() => {
    const fromCaller = Number(route?.params?.packaging);
    if (Number.isFinite(fromCaller) && fromCaller > 0) {
      setPackagingFee(Math.max(0, Math.round(fromCaller)));
      return;
    }
    if (route?.params?.packaging != null) {
      setPackagingFee(0);
      return;
    }
    let alive = true;
    void getPackagingFee(mode).then((v) => {
      if (alive) setPackagingFee(v);
    });
    return () => {
      alive = false;
    };
  }, [mode, route?.params?.packaging]);
  /** Ongkir fungsional - bawaan per mode dari FEE_DEFAULTS, bisa diubah di sini, diteruskan ke Pay. */
  const [ongkir, setOngkir] = useState(route?.params?.ongkir ?? defaultOngkirForMode(route?.params?.mode));
  const [showOngkir, setShowOngkir] = useState(false);
  const [ongkirDraft, setOngkirDraft] = useState('');
  /** Sinkron ulang saat kembali dari PromotionList/Voucher/Member/LoadOrder
   * (params di-merge ke rute yang sudah ada): voucher/member/pelanggan/meja/
   * nomor struk ikut diterapkan, bukan hanya voucher. */
  useEffect(() => {
    if (route?.params?.voucher) setVoucher(route.params.voucher);
    if (route?.params?.items && route.params.items.length > 0) setItems(route.params.items);
    if (route?.params?.ongkir !== undefined) setOngkir(Math.max(0, route.params.ongkir));
    if (typeof route?.params?.mode === 'string' && route.params.mode) setMode(route.params.mode);
    if (route?.params?.table !== undefined) setTable(route.params.table ?? '');
    if (route?.params?.customer !== undefined) setCustomer(route.params.customer ?? '');
    if (route?.params?.memberId !== undefined) setMemberId(route.params.memberId ?? '');
    if (route?.params?.customerId !== undefined) setCustomerId(parseCustomerId(route.params.customerId));
    if (typeof route?.params?.salesNum === 'string' && route.params.salesNum.trim()) setSalesNum(route.params.salesNum.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params]);
  const routeTotal = route?.params?.total;
  // Editor per item: qty stepper inline, panel harga + catatan
  const [editingId, setEditingId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [savedTick, setSavedTick] = useState(false);
  /** Eskalasi void: gate RBAC order.void, deny -> dialog persetujuan supervisor
   * V1 (kontrak BE baru; S7, legacy NOL). */
  const [voidTarget, setVoidTarget] = useState<{ id: string; wantVoid: boolean } | null>(null);

  const active = useMemo(() => items.filter((c) => !c.voided), [items]);
  const subtotalGross = useMemo(
    () => active.reduce((s, c) => s + unitPrice(c) * c.qty, 0),
    [active],
  );
  const discountTotal = useMemo(() => active.reduce((s, c) => s + c.discount, 0), [active]);
  /** Kanonis via helper: voucher ongkir/persen/flat, service server-driven (legacy 5%), pajak incl info-only (setting, default 11), rounding Go-lane step server (legacy 100). */
  const {
    subtotal,
    service,
    taxIncl,
    feeESB,
    packaging,
    ongkirCut,
    ongkirNet,
    bruto,
    total,
    rounding,
    voucherAmt,
  } = totals({ gross: subtotalGross, discount: discountTotal, ongkir, packaging: packagingFee, voucher: voucher ?? undefined, esbOrder: isMarketplaceMode(mode), taxRate, serviceEnabled: svcCfg.enabled, serviceType: svcCfg.type, serviceRate: svcCfg.rate, serviceFixed: svcCfg.fixed, ...(roundStep != null ? { roundStep } : {}) });
  const isOngkirVoucher = voucher?.kind === 'Ongkir' || voucher?.code === 'GRATISONGKIR';
  const useOngkirCut = !!isOngkirVoucher && ongkir > 0;
  const itemCount = active.reduce((s, c) => s + c.qty, 0);

  const incQty = (id: string) =>
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, qty: c.qty + 1 } : c)));
  /** Kurangi qty; di 1 -> item dihapus (tanpa dialog, alasan sama dgn kasir). */
  const decQty = (id: string) =>
    setItems((prev) => {
      const cur = prev.find((c) => c.id === id);
      if (cur && cur.qty <= 1) return prev.filter((c) => c.id !== id);
      return prev.map((c) => (c.id === id ? { ...c, qty: c.qty - 1 } : c));
    });
  const removeItem = (id: string) => setItems((prev) => prev.filter((c) => c.id !== id));
  /** Terapkan void/unvoid langsung (dipakai gate-ok dan sesudah PIN supervisor ok). */
  const applyVoid = (id: string, wantVoid: boolean) => {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, voided: wantVoid } : c)));
    if (wantVoid) setEditingId(null);
  };
  /** Gate RBAC order.void: allow/db-unready langsung terap; deny eskalasi ke
   * dialog persetujuan supervisor V1 (S7). */
  const requestVoid = async (id: string, wantVoid: boolean) => {
    try {
      const s = getSession();
      const gate = await requireAccess(s?.userId || s?.username || '', 'order.void');
      if (gate.ok) {
        applyVoid(id, wantVoid);
        return;
      }
    } catch {
      // Gate-throw: dialog dibuka agar supervisor (otoritatif via server) bisa
      // memutuskan; fallback lokal dialog fail-closed sendiri.
    }
    setVoidTarget({ id, wantVoid });
  };
  const voidItem = (id: string) => {
    void requestVoid(id, true);
  };
  const unvoidItem = (id: string) => {
    void requestVoid(id, false);
  };
  /** Persetujuan supervisor V1 ok → terapkan void/unvoid target tertunda. */
  const approveVoid = () => {
    const target = voidTarget;
    if (!target) return;
    applyVoid(target.id, target.wantVoid);
    setVoidTarget(null);
  };

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

  const saveOngkir = () => {
    const n = Math.max(0, Number(ongkirDraft.replace(/[^0-9]/g, '')) || 0);
    setOngkir(n);
    setShowOngkir(false);
  };

  const modeLabel = table ? `${mode} · ${t('table')} ${table}` : mode;

  // Rantai Pay (kontrak PayScreen): total penuh + items/mode/table/ongkir/voucher/customer/memberId
  // + diskon belanja + rincian info-only (service/pajak/pembulatan/fee) agar Pay teruskan ke Success > Receipt.
  // Voucher sebagai OBJEK {code, amount, kind} (Pay dahulukan discount angka, tanpa hitung ganda).
  const goPay = () =>
    navigation?.navigate('Pay', {
      total,
      items: active,
      // Nomor dibawa agar Pay pakai ulang (bukan nomor baru): draft yang
      // dibayar bisa dihapus tepat sasaran di Success (anti hantu, bug G2).
      ...(salesNum.trim() ? { salesNum: salesNum.trim() } : {}),
      discount: discountTotal + voucherAmt,
      ...(voucher ? { voucher: { code: voucher.code, amount: voucher.amount, ...(voucher.kind ? { kind: voucher.kind } : {}), ...voucherExtras(voucher) } } : {}),
      mode,
      ...(table ? { table } : {}),
      ...(customer ? { customer } : {}),
      ...(memberId ? { memberId } : {}),
      ...(customerId != null ? { customerId } : {}),
      // Ongkir diteruskan BRUTO + cut terpisah (kontrak PayScreen): Pay
      // percaya ongkirCut pemanggil; kirim net tanpa cut = cut hilang di
      // catatan (sebelumnya ongkirNet tanpa ongkirCut di sini).
      ...(ongkir > 0 ? { ongkir } : {}),
      ...(ongkirCut > 0 ? { ongkirCut } : {}),
      ...(packaging > 0 ? { packaging } : {}),
      ...(service > 0 ? { service } : {}),
      ...(taxIncl > 0 ? { tax: taxIncl } : {}),
      ...(rounding !== 0 ? { rounding } : {}),
      ...(feeESB > 0 ? { feeESB } : {}),
    });
  const goPromo = () =>
    // Bawa konteks cart penuh: kembali dari promo hanya membawa {voucher}
    // tanpa items = instance CartDetail baru ter-init keranjang kosong
    // (S4-APP-323). echo di PromotionList mengembalikan semua ini.
    navigation?.navigate('PromotionList', {
      returnTo: 'CartDetail',
      subtotal,
      ongkir,
      items,
      mode,
      ...(table ? { table } : {}),
      ...(customer ? { customer } : {}),
      ...(memberId ? { memberId } : {}),
      ...(customerId != null ? { customerId } : {}),
      ...(salesNum.trim() ? { salesNum: salesNum.trim() } : {}),
    });
  const goSave = () => {
    setSavedTick(true);
    const title = `${modeLabel} · ${customer.trim() || t('guestFallback')}`;
    const now = new Date().toISOString();
    void (async () => {
      // Nomor draft: pakai ulang bila ada, bangkitkan bila cart baru. Tanpa
      // ini draft tak bisa dipetakan ke penjualan (hantu di Muat, bug G2).
      let sn = salesNum.trim();
      if (!sn) {
        try {
          sn = await nextSalesNum();
        } catch {
          sn = '';
        }
      }
      // Simpan item aktif saja (baris voided sudah keluar dari bill) plus
      // voucher/member/pelanggan/nomor agar utuh saat dimuat kembali (G3).
      const payload = JSON.stringify({
        title,
        mode,
        ...(table ? { table } : {}),
        items: active,
        ...(voucher ? { voucher: { code: voucher.code, amount: voucher.amount, ...(voucher.kind ? { kind: voucher.kind } : {}), ...voucherExtras(voucher) } } : {}),
        ...(memberId ? { memberId } : {}),
        ...(customerId != null ? { customerId } : {}),
        ...(customer.trim() ? { customer: customer.trim() } : {}),
        ...(sn ? { salesNum: sn } : {}),
        // Draft menyimpan ongkir BRUTO + cut terpisah agar muat-ulang hitung
        // ulang kanonis dari dasar yang sama (net di sini = cut susut permanen).
        ...(ongkir > 0 ? { ongkir } : {}),
        ...(ongkirCut > 0 ? { ongkirCut } : {}),
        total,
        ts: Date.now(),
      });
      const id = `draft-${Date.now()}`;
      try {
        await initDb();
        await run(
          'INSERT INTO tr_draftorder (id, payload, createdAt, updatedAt, syncDate) VALUES (?, ?, ?, ?, NULL)',
          [id, payload, now, now],
        );
        // Draft menempati meja (cermin LoadOrderScreen): meja ikut 'terisi' + sync.
        if (table) {
          try {
            await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE TRIM(tableNo) = ?', ['terisi', table.trim()]);
            try {
              enqueueSync('other', { op: 'table-occupy', table, at: now });
            } catch {
              /* abaikan */
            }
            // A11: duduki meja di server terminal (best-effort; lokal menang bila
            // offline/BE-BELUM-ADA; 409 kapasitas → banner via server-note).
            void postTableTransition({ tableRef: table.trim(), status: 'OCCUPIED' });
          } catch {
            /* abaikan: status meja tetap ikut draft */
          }
        }
      } catch {
        /* offline-first: abaikan gagal tulis, daftar DB tetap tampil */
      }
      navigation?.navigate('LoadOrder');
    })();
  };

  return (
    <View style={styles.root}>
      {/* Header navy judul tengah + sub mode/meja */}
      <ScreenHeader
        title={t('orderDetail')}
        sub={`${modeLabel} · ${itemCount} ${t('hist_items')}`}
        onBack={() => navigation?.goBack()}
      />

      <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, isTablet && wideCenterLg]}>
        {/* Tablet: daftar item kiri, promo+total kanan; footer tetap full-width bawah. */}
        <View style={[isTablet && styles.cols]}>
        <View style={[isTablet && styles.col]}>
        {items.map((c, idx) => (
          <View key={c.id} style={[styles.row, c.voided && styles.rowVoid]}>
            {/* Lingkaran biru nomor */}
            <View style={[styles.numCircle, c.voided && styles.numVoid]}>
              <Text style={styles.numText}>{idx + 1}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.itemName, c.voided && styles.voidName, isTablet && styles.itemNameBig]} numberOfLines={2}>
                {c.name} x{c.qty}
                {c.voided ? ` (${t('hist_st_void')})` : ''}
              </Text>
              {/* Harga satuan selalu terlihat (dulu hanya di dalam panel edit) */}
              {!c.voided && <Text style={styles.unit}>@ {rp(c.basePrice)}</Text>}
              {/* Modifier biru */}
              {c.modifiers.map((m, i) => (
                <Text key={i} style={styles.modifier}>
                  + {m.name}
                  {m.price > 0 ? `  +${rp(m.price)}` : ''}
                </Text>
              ))}
              {c.note ? <Text style={styles.note}>{t('kit_note')}: {c.note}</Text> : null}
              {c.discount > 0 && <Text style={styles.discount}>- {t('discount')} {rp(c.discount)}</Text>}
              {c.voided ? (
                <TouchableOpacity onPress={() => unvoidItem(c.id)}>
                  <Text style={styles.restoreT}>{t('cart_restore')}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.rowActs}>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      style={[styles.stepBtn, isTablet && styles.stepBtnBig]}
                      onPress={() => decQty(c.id)}>
                      <Text style={styles.stepT}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepQty}>{c.qty}</Text>
                    <TouchableOpacity style={[styles.stepBtn, isTablet && styles.stepBtnBig]} onPress={() => incQty(c.id)}>
                      <Text style={styles.stepT}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={[styles.editBtn, editingId === c.id && styles.editBtnOn, isTablet && styles.editBtnBig]}
                    hitSlop={8}
                    onPress={() => (editingId === c.id ? setEditingId(null) : openEditor(c))}>
                    <Text style={[styles.editBtnT, editingId === c.id && styles.editBtnTOn]}>
                      {editingId === c.id ? t('cartEditClose') : t('cartEditPrice')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {editingId === c.id && !c.voided && (
                <View style={styles.editor}>
                  <Text style={styles.editorLabel}>{tCur('unitPriceRp')}</Text>
                  <AppInput
                    boxStyle={styles.editorInput}
                    style={styles.fieldText}
                    value={priceDraft}
                    onChangeText={(v) => setPriceDraft(v.replace(/[^0-9]/g, ''))}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                  <Text style={styles.editorLabel}>{t('itemNotes')}</Text>
                  <AppInput
                    boxStyle={styles.editorInput}
                    style={styles.fieldText}
                    value={noteDraft}
                    onChangeText={setNoteDraft}
                    placeholder={t('cartNotePh')}
                  />
                  <View style={styles.editorRow}>
                    <AppButton
                      size="sm"
                      variant="secondary"
                      title={t('hist_st_void')}
                      onPress={() => voidItem(c.id)}
                      fullWidth={false}
                      style={[styles.editorVoid, { marginTop: 0, backgroundColor: 'transparent', borderColor: colors.red }]}
                      textStyle={styles.editorVoidT}
                    />
                    <AppButton
                      size="sm"
                      title={t('save')}
                      onPress={saveEditor}
                      fullWidth={false}
                      style={[styles.editorSave, { marginTop: 0, backgroundColor: colors.navy }]}
                      textStyle={styles.editorSaveT}
                    />
                  </View>
                </View>
              )}
            </View>
            {/* Harga kanan */}
            <Text style={styles.price}>{rp(itemTotal(c))}</Text>
            {/* X merah */}
            <TouchableOpacity style={[styles.delBtn, isTablet && styles.delBtnBig]} onPress={() => removeItem(c.id)} hitSlop={12}>
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
            <Text style={[styles.emptyTitle, isTablet && styles.emptyTitleBig]}>{t('cartEmpty')}</Text>
            <Text style={[styles.emptySub, isTablet && styles.emptySubBig]}>{t('cartEmptyHint')}</Text>
            <AppButton
              size="md"
              title={`＋ ${t('addMenu')}`}
              onPress={() => navigation?.navigate('Cashier')}
              fullWidth={false}
              style={[styles.emptyCta, { marginTop: 16 }]}
              textStyle={styles.emptyCtaText}
            />
          </View>
        )}

        </View>
        <View style={[isTablet && styles.col]}>
        {/* Voucher / promo ringkas */}
        {items.length > 0 && (
          <View style={styles.promoCard}>
            <Text style={[styles.promoTitle, isTablet && styles.promoTitleBig]}>{t('voucherPromo')}</Text>
            {voucher ? (
              <View style={styles.promoRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.promoCode}>{voucher.code}</Text>
                  <Text style={styles.promoDesc}>{useOngkirCut ? `${t('discount')} ${t('ongkir')} ${rp(ongkirCut)}` : `${t('discount')} ${rp(voucherAmt)}`}</Text>
                </View>
                <TouchableOpacity onPress={() => setVoucher(null)} hitSlop={10}>
                  <Text style={styles.promoRemove}>{t('promo_remove')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <AppButton
                size="sm"
                title={`＋ ${t('usePromo')}`}
                onPress={goPromo}
                style={[styles.promoBtn, { marginTop: 8 }]}
                textStyle={styles.promoBtnT}
              />
            )}
            {voucher ? (
              <TouchableOpacity onPress={goPromo}>
                <Text style={styles.promoChange}>{t('changeVoucher')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Totals */}
        {items.length > 0 && (
          <View style={styles.totals}>
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>{t('subtotalGross')}</Text>
              <Text style={[styles.sumValue, isTablet && styles.sumValueBig]}>{rp(subtotalGross)}</Text>
            </View>
            {discountTotal > 0 && (
              <View style={styles.sumRow}>
                <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>{t('itemDiscount')}</Text>
                <Text style={[styles.sumValue, styles.red, isTablet && styles.sumValueBig]}>-{rp(discountTotal)}</Text>
              </View>
            )}
            {voucher && !useOngkirCut && (
              <View style={styles.sumRow}>
                <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>Voucher {voucher.code}</Text>
                <Text style={[styles.sumValue, styles.red, isTablet && styles.sumValueBig]}>-{rp(voucherAmt)}</Text>
              </View>
            )}
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>{t('subtotalNet')}</Text>
              <Text style={[styles.sumValue, isTablet && styles.sumValueBig]}>{rp(subtotal)}</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>{t('taxIncl')}</Text>
              <Text style={[styles.sumValue, isTablet && styles.sumValueBig]}>{rp(taxIncl)}</Text>
            </View>
            {service > 0 && (
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>{serviceLabel(t, svcCfg)}</Text>
              <Text style={[styles.sumValue, isTablet && styles.sumValueBig]}>{rp(service)}</Text>
            </View>
            )}
            {feeESB > 0 && (
              <View style={styles.sumRow}>
                <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>{platformFeeLabel(t)}</Text>
                <Text style={[styles.sumValue, isTablet && styles.sumValueBig]}>{rp(feeESB)}</Text>
              </View>
            )}
            {packaging > 0 && (
              <View style={styles.sumRow}>
                <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>{t('packaging')}</Text>
                <Text style={[styles.sumValue, isTablet && styles.sumValueBig]}>{rp(packaging)}</Text>
              </View>
            )}
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>{t('deliveryFee')}</Text>
              <View style={styles.ongkirVal}>
                <Text style={[styles.sumValue, isTablet && styles.sumValueBig]}>{rp(ongkirNet)}</Text>
                <TouchableOpacity
                  onPress={() => {
                    setOngkirDraft(ongkir > 0 ? String(ongkir) : '');
                    setShowOngkir(true);
                  }}
                  hitSlop={8}>
                  <Text style={styles.ongkirEdit}>{ongkir > 0 ? t('editAction') : t('fillAction')}</Text>
                </TouchableOpacity>
              </View>
            </View>
            {voucher && useOngkirCut && (
              <View style={styles.sumRow}>
                <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>Voucher {voucher.code}</Text>
                <Text style={[styles.sumValue, styles.red, isTablet && styles.sumValueBig]}>-{rp(ongkirCut)}</Text>
              </View>
            )}
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, isTablet && styles.sumLabelBig]}>{t('rounding')}</Text>
              <Text style={[styles.sumValue, isTablet && styles.sumValueBig]}>{rp(rounding)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, isTablet && styles.totalLabelBig]}>{t('total')}</Text>
              <Text style={[styles.totalValue, isTablet && styles.totalValueBig]}>{rp(total)}</Text>
            </View>
          </View>
        )}

        {/* Aksi lanjutan ala POSLite: split & pindah */}
        {items.length > 0 && (
          <View style={styles.linksRow}>
            <TouchableOpacity onPress={() => navigation?.navigate('SplitBill', {
              items: active, total, mode,
              // Nomor draft = SATU salesNum grup split (anti struk ganda, anti hantu).
              ...(salesNum.trim() ? { salesNum: salesNum.trim() } : {}),
              ...(table ? { table } : {}),
              ...(customer ? { customer } : {}),
              ...(memberId ? { memberId } : {}),
              ...(customerId != null ? { customerId } : {}),
              // SplitBill menghitung ulang kanonis dari ongkir BRUTO (cut
              // dihitung ulang min(cap, bruto)); kirim net = cut tak terhitung.
              ...(ongkir > 0 ? { ongkir } : {}),
              ...(packaging > 0 ? { packaging } : {}),
              ...(voucher ? { voucher: { code: voucher.code, amount: voucher.amount, ...(voucher.kind ? { kind: voucher.kind } : {}), ...voucherExtras(voucher) } } : {}),
              discount: discountTotal + voucherAmt,
            })}>
              <Text style={[styles.link, isTablet && styles.linkBig]}>{t('splitBill')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation?.navigate('MoveItems', { ...(table ? { from: table } : {}) })}>
              <Text style={[styles.link, isTablet && styles.linkBig]}>{t('moveItems')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation?.navigate('BillPreview', {
              items: active, total, subtotal, mode,
              ...(table ? { table } : {}),
              ...(customer ? { customer } : {}),
              ...(memberId ? { memberId } : {}),
              ...(customerId != null ? { customerId } : {}),
              // Pratinjau butuh bruto + cut terpisah agar terusannya ke Pay
              // utuh (BillPreview meneruskan keduanya via orderCtx).
              ...(ongkir > 0 ? { ongkir } : {}),
              ...(ongkirCut > 0 ? { ongkirCut } : {}),
              ...(packaging > 0 ? { packaging } : {}),
              ...(voucher ? { voucher: { code: voucher.code, amount: voucher.amount, ...(voucher.kind ? { kind: voucher.kind } : {}), ...voucherExtras(voucher) } } : {}),
              discount: discountTotal + voucherAmt,
              ...(service > 0 ? { service } : {}),
              ...(taxIncl > 0 ? { tax: taxIncl } : {}),
              ...(rounding !== 0 ? { rounding } : {}),
              ...(feeESB > 0 ? { feeESB } : {}),
            })}>
              <Text style={[styles.link, isTablet && styles.linkBig]}>{t('billPreview')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation?.navigate('MoveTable', { ...(table ? { from: table } : {}) })}>
              <Text style={[styles.link, isTablet && styles.linkBig]}>{t('moveTable')}</Text>
            </TouchableOpacity>
          </View>
        )}
        </View>
        </View>
      </ScrollView>

      {/* Dialog ongkir: input nominal biaya antar */}
      <Modal visible={showOngkir} transparent animationType="fade" onRequestClose={() => setShowOngkir(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={[styles.modalTitle, isTablet && styles.modalTitleBig]}>{t('ongkirTitle')}</Text>
            <Text style={styles.modalLabel}>{tCur('ongkirNominal')}</Text>
            <AppInput
              boxStyle={styles.modalInput}
              style={styles.fieldText}
              value={ongkirDraft}
              onChangeText={(v) => setOngkirDraft(v.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              placeholder={rp(0)}
            />
            <View style={styles.modalRow}>
              <AppButton
                size="sm"
                variant="secondary"
                title={t('cancel')}
                onPress={() => setShowOngkir(false)}
                fullWidth={false}
                style={[styles.modalGhost, { marginTop: 0 }]}
                textStyle={styles.modalGhostT}
              />
              <AppButton
                size="sm"
                title={t('save')}
                onPress={saveOngkir}
                fullWidth={false}
                style={[styles.modalPrimary, { marginTop: 0, backgroundColor: colors.navy }]}
                textStyle={styles.modalPrimaryT}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* S7: eskalasi void via dialog persetujuan supervisor V1 (kontrak BE baru). */}
      <SupervisorApprovalDialog
        visible={voidTarget !== null}
        action={SUPERVISOR_ACTION_ORDER_VOID}
        refId={voidTarget?.id ?? ''}
        fallbackAccessKey="order.void"
        onApproved={() => approveVoid()}
        onCancel={() => setVoidTarget(null)}
      />

      {/* Simpan / Cetak / Bayar - sembunyi saat keranjang 0, ganti CTA tambah menu */}
      <View style={styles.footer}>
        {routeTotal !== undefined && routeTotal !== total && items.length > 0 && (
          <Text style={[styles.footerNote, isTablet && styles.footerNoteBig]}>
            {t('totalUpdatedA')}{rp(routeTotal)} → {rp(total)}{t('totalUpdatedB')}
          </Text>
        )}
        {savedTick && items.length > 0 && (
          <Text style={[styles.footerNote, isTablet && styles.footerNoteBig]}>{t('orderSavedNote')}</Text>
        )}
        {items.length === 0 ? (
          <AppButton
            size="lg"
            title={`＋ ${t('addMenu')} ›`}
            onPress={() => navigation?.navigate('Cashier')}
            style={[styles.payBtn, { marginTop: 0 }]}
            textStyle={styles.payText}
          />
        ) : (
          <>
            <View style={styles.footerRow}>
              <AppButton
                size="md"
                variant="secondary"
                title={t('save')}
                onPress={goSave}
                fullWidth={false}
                style={styles.saveBtn}
                textStyle={styles.saveText}
              />
              <AppButton
                size="md"
                variant="secondary"
                title={t('load')}
                onPress={() => navigation?.navigate('LoadOrder')}
                fullWidth={false}
                style={styles.printBtn}
                textStyle={styles.printText}
              />
              <AppButton
                size="md"
                variant="secondary"
                title={t('printReceipt')}
                onPress={() => navigation?.navigate('Receipt', {
                  total, mode,
                  items: active,
                  discount: discountTotal + voucherAmt,
                  ...(voucher ? { voucherCode: voucher.code } : {}),
                  ...(table ? { table } : {}),
                  ...(customer ? { customer } : {}),
                  // Pracetak dari cart = pratinjau belum bayar (cermin DineIn).
                  ...(ongkir > 0 ? { ongkir } : {}),
                  ...(ongkirCut > 0 ? { ongkirCut } : {}),
                  ...(packaging > 0 ? { packaging } : {}),
                  unpaid: true,
                  ...(service > 0 ? { service } : {}),
                  ...(taxIncl > 0 ? { tax: taxIncl } : {}),
                  ...(rounding !== 0 ? { rounding } : {}),
                  ...(feeESB > 0 ? { feeESB } : {}),
                })}
                fullWidth={false}
                style={styles.printBtn}
                textStyle={styles.printText}
              />
            </View>
            <AppButton
              size="lg"
              title={`${t('pay')} | ${rp(total)} ›`}
              onPress={goPay}
              style={styles.payBtn}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 24 },
  /* Kolom tablet: item kiri, promo+total kanan (phone tetap 1 kolom). */
  cols: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  col: { flex: 1, minWidth: 0 },
  /* Varian tablet: target sentuh min 44-48px (stepper 30 ke 44, hapus 24 ke 40). */
  stepBtnBig: { width: 44, height: 44, borderRadius: 22 },
  delBtnBig: { width: 40, height: 40, borderRadius: 20 },
  editBtnBig: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
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
  /** Baris harga satuan di bawah nama item - selalu terlihat tanpa buka editor. */
  unit: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  /** Tombol pil edit harga/catatan - ganti teks mungil agar mudah diketuk. */
  editBtn: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  editBtnOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  editBtnT: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy },
  editBtnTOn: { color: colors.orangeDark },
  editor: { backgroundColor: colors.paleBlue, borderRadius: 8, padding: 10, marginTop: 8 },
  editorLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy, marginTop: 6 },
  editorInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 9,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
    marginTop: 4,
  },
  /** Teks di dalam AppInput: medium ala form lama. */
  fieldText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
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
  promoBtn: { backgroundColor: colors.paleOrange, borderWidth: 1, borderColor: colors.orange, borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', marginTop: 8 },
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
  ongkirVal: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ongkirEdit: { fontFamily: fonts.semibold, fontSize: 12, color: colors.blue },
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
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 360, backgroundColor: colors.white, borderRadius: 12, padding: 16 },
  modalTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  modalLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy, marginTop: 12, marginBottom: 6 },
  modalInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
  },
  modalRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modalGhost: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  modalGhostT: { fontFamily: fonts.bold, fontSize: 13, color: colors.navy },
  modalPrimary: { flex: 2, backgroundColor: colors.navy, borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  modalPrimaryT: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  /* Varian tablet (breakpoint 768): teks +1..2pt agar proporsional di layar lebar. */
  itemNameBig: { fontSize: 15 },
  sumLabelBig: { fontSize: 14 },
  sumValueBig: { fontSize: 14 },
  totalLabelBig: { fontSize: 16 },
  totalValueBig: { fontSize: 19 },
  payTextBig: { fontSize: 17 },
  saveTextBig: { fontSize: 14 },
  promoTitleBig: { fontSize: 15 },
  linkBig: { fontSize: 14 },
  emptyTitleBig: { fontSize: 17 },
  emptySubBig: { fontSize: 14 },
  modalTitleBig: { fontSize: 16 },
  footerNoteBig: { fontSize: 12 },
});
