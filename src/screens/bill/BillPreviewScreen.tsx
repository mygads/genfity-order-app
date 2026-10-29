import { useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View , useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenterLg, wideCenterSm } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { useLang } from '../../lib/i18n';
import { SERVICE_LEGACY, getServiceConfig, serviceLabel, platformFeeLabel, type ServiceConfig } from '../../lib/totals';
import { buildReceiptOrderTypeLine, getCachedMerchantInfo, getEffectiveTogglesForMode, getReceiptTemplateToggles, hasReceiptTemplate, RECEIPT_TEMPLATE_DEFAULTS, type CachedMerchantInfo, type ReceiptTemplateToggles } from '../../lib/receiptTemplate';
import { getGroupPaid, nextSalesNum } from '../../lib/sales';
import { getBranchId, getTerminal } from '../../config/server';
import type { SaleItemIn } from '../../lib/payments';
import { parseCustomerId } from '../../lib/memberRef';

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
      voucher?: string | { code: string; amount: number; kind?: string; rate?: number; maxAmount?: number; minSpend?: number };
      voucherCode?: string;
      service?: number; serviceTotal?: number;
      tax?: number; vatTotal?: number;
      /** Fee platform agregator + pembulatan + kemasan bawaan pemanggil (info-only, diteruskan). */
      feeESB?: number; rounding?: number; packaging?: number; tip?: number;
      mode?: string; table?: string; ongkir?: number; ongkirCut?: number; orderNote?: string; deliveryAddr?: string;
      serviceDate?: string; serviceTime?: string; technician?: string; dpPercent?: number; deliveryAddress?: string; deliveryFee?: number;
      customer?: string; memberId?: string; customerId?: number;
      /** Nomor order bila sudah ada (alir balik History); pratinjau baru = tanpa nomor. */
      no?: string;
      /** Identitas resto/kasir untuk kepala struk (cermin ReceiptScreen). */
      shopName?: string; shopAddr?: string; cashier?: string;
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
  const { lang, t } = useLang();
  /** Label service mengikuti knob server (audit trisisi #1); nilai serviceVal
   * tetap dari pemanggil (angka resmi rantai). */
  const [svcCfg, setSvcCfg] = useState<ServiceConfig>(SERVICE_LEGACY);
  // 1:1 template website: pratinjau tagihan menghormati toggle yang sama
  // dengan ReceiptScreen/thermal (tanpa template = default kanonik BE).
  const [tpl, setTpl] = useState<ReceiptTemplateToggles>({ ...RECEIPT_TEMPLATE_DEFAULTS });
  const [tplOn, setTplOn] = useState(false);
  const [mInfo, setMInfo] = useState<CachedMerchantInfo>({ name: '', address: '', phone: '', email: '', logoUrl: '', merchantCode: '', merchantType: '' });
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const on = await hasReceiptTemplate();
        const tg = await getReceiptTemplateToggles();
        const mi = await getCachedMerchantInfo();
        if (alive) { setTplOn(on); setTpl(tg); setMInfo(mi); }
      } catch { /* default kanonik */ }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    void getServiceConfig().then((c) => {
      if (alive) setSvcCfg(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  // Order asli dari params kasir (bukan konstanta hardcode).
  const p = route?.params ?? {};
  const orderItems = p.items ?? [];
  const voucherCode =
    p.voucherCode ?? (typeof p.voucher === 'string' ? p.voucher : p.voucher?.code) ?? '';
  const voucherKind =
    typeof p.voucher === 'object' ? (p.voucher.kind ?? '') : '';
  const discountVal = p.discount ?? (typeof p.voucher === 'object' ? p.voucher.amount : 0) ?? 0;
  const ongkirVal = p.ongkir ?? 0;
  // Potongan ongkir terpisah pemanggil (bruto + cut, kontrak PayScreen):
  // diteruskan utuh via orderCtx agar Pay/Success/Receipt mencatat benar.
  // Tanpa ini (pemanggil lama) = 0 jujur; total tetap benar karena neto.
  const ongkirCutVal = Math.max(0, Math.round(Number(p.ongkirCut) || 0));
  const serviceVal = p.service ?? p.serviceTotal ?? 0;
  const taxVal = p.tax ?? p.vatTotal ?? 0;
  const feeESBVal = p.feeESB ?? 0;
  const packagingVal = Math.max(0, Math.round(Number(p.packaging) || 0));
  const roundingVal = p.rounding ?? 0;
  const tipVal = Math.max(0, Math.round(Number((p as unknown as { tip?: unknown }).tip) || 0));
  const orderNoteVal = String((p as unknown as { orderNote?: unknown }).orderNote ?? '').trim();
  const deliveryAddrVal = String((p as unknown as { deliveryAddr?: unknown }).deliveryAddr ?? '').trim();
  const serviceDateVal = String((p as unknown as { serviceDate?: unknown }).serviceDate ?? '').trim();
  const serviceTimeVal = String((p as unknown as { serviceTime?: unknown }).serviceTime ?? '').trim();
  const technicianVal = String((p as unknown as { technician?: unknown }).technician ?? '').trim();
  const dpPercentVal = Math.max(0, Math.round(Number((p as unknown as { dpPercent?: unknown }).dpPercent) || 0));
  const deliveryAddressVal = String((p as unknown as { deliveryAddress?: unknown }).deliveryAddress ?? '').trim();
  const svcLineVal = [serviceDateVal && serviceTimeVal ? `${serviceDateVal} ${serviceTimeVal}` : null, technicianVal ? `Teknisi ${technicianVal}` : null, dpPercentVal > 0 ? `DP ${dpPercentVal}%` : null, deliveryAddressVal ? `Antar: ${deliveryAddressVal.slice(0, 80)}` : null].filter(Boolean).join(' · ');
  const subtotalVal = p.subtotal ?? orderItems.reduce((s, it) => s + lineAmount(it), 0);
  const total = p.total ?? (subtotalVal - discountVal + serviceVal + ongkirVal);
  // Kepala struk mengikuti order berjalan (meja/pelanggan/member/kasir/no
  // asli bila dioper pemanggil); tanpa params tampilkan '-' (jujur).
  // Identitas resto = cabang live (cermin AboutScreen), bukan seed.
  const metaTable = p.table ?? '-';
  const metaGuest = p.customer ?? p.memberId ?? '-';
  // APP-R3: identitas cabang live (cermin AboutScreen); '-' jujur bila
  // unbound — tanpa contoh seed Poris. Override params pemanggil tetap menang.
  let liveBranchName = '';
  let liveBranchId = '';
  try { liveBranchId = getBranchId(); } catch { /* '-' jujur */ }
  try {
    const term = getTerminal();
    liveBranchName = (term.branchName ?? '').trim();
    if ((term.branchId ?? '').trim()) liveBranchId = term.branchId.trim();
  } catch { /* '-' jujur */ }
  const liveShop = liveBranchName
    ? (liveBranchId ? `${liveBranchName} - ${liveBranchId}` : liveBranchName)
    : (liveBranchId || '-');
  const shopName = p.shopName ?? (mInfo.name || liveShop);
  const shopAddr = p.shopAddr ?? (mInfo.address || '-');
  const shopPhone = (mInfo.phone ?? '').trim();
  const shopEmail = (mInfo.email ?? '').trim();
  const metaCashier = p.cashier ?? '-';
  const metaNo = p.no ?? 'Pratinjau / Preview';
  const metaTime = new Date().toLocaleTimeString(lang === 'en' ? 'en-US' : 'id-ID', { hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':');
  // Kunci split per ID item (bukan nama): dua item beda ID boleh bernama
  // sama tanpa tabrakan alokasi.
  const itemKey = (it: OrderItemParam): string => it.id ?? it.name;
  const [mode, setMode] = useState<Mode>('none');
  const [splits, setSplitsRaw] = useState(3);
  const [paid, setPaid] = useState<boolean[]>([false, false, false]);
  const [assign, setAssign] = useState<Record<string, number>>(() =>
    Object.fromEntries(orderItems.map((it, i) => [itemKey(it), i % 3])),
  );
  const [nominals, setNominals] = useState<string[]>(['', '', '']);
  // Nomor grup split: SATU salesNum untuk semua kunjungan bayar (alur grup
  // Pay > appendGroupPayment). Dibangkitkan sekali lalu dipakai ulang agar
  // kunjungan ke-2+ menempel ke head yang sama (stok/voucher/dapur sekali).
  const groupNoRef = useRef<string>('');
  // Kebenaran DB saat tombol split ditekan (getGroupPaid): banner jujur di
  // bawah penghitung manual agar kasir tahu yang benar-benar tercatat.
  const [dbPaid, setDbPaid] = useState<number | null>(null);

  // Bayar satu split via alur grup: kunjungan pertama = saveSale penuh
  // (grand = total order, stok/voucher/dapur sekali), berikut = append kaki.
  // Total split sudah neto (termasuk diskon) + share proporsional
  // service/pajak/pembulatan, tanpa diskon/voucher ganda.
  const paySplit = (val: number, mode: Mode) => {
    if (val <= 0 || !nominalGateOk(mode)) return;
    void (async () => {
      let g = groupNoRef.current;
      let grouped = true;
      if (!g) {
        try {
          g = await nextSalesNum();
          groupNoRef.current = g;
        } catch {
          // Perangkat belum bound: nomor tak bisa terbit; lanjut tanpa grup
          // (Pay menampilkan pesan klaim-terminal, tanpa tulis ganda karena
          // saveSale menolak di perangkat unbound).
          grouped = false;
        }
      }
      if (grouped && g) {
        try {
          const gp = await getGroupPaid(g);
          setDbPaid(gp.paidTotal);
        } catch {
          /* abaikan - banner tetap nilai lama */
        }
        navigation?.navigate('Pay', {
          total: val, items: saleItems, discount: discountVal,
          ...(voucherCode ? { voucher: { code: voucherCode, amount: discountVal, ...(voucherKind ? { kind: voucherKind } : {}) } } : {}),
          ...(voucherCode ? { voucherCode } : {}),
          ...orderCtx, ...splitShareCtx(val),
          splitGroup: true, salesNum: g, orderTotal: total,
        });
        return;
      }
      // P10: jalur non-grup membawa diskon/voucher seperti jalur grup agar
      // rincian struk di Pay konsisten (total split tetap neto).
      navigation?.navigate('Pay', { total: val, items: saleItems, discount: discountVal, ...(voucherCode ? { voucher: { code: voucherCode, amount: discountVal, ...(voucherKind ? { kind: voucherKind } : {}) } } : {}), ...(voucherCode ? { voucherCode } : {}), ...orderCtx, ...splitShareCtx(val) });
    })();
  };

  const resetSplits = (n: number) => {
    setSplitsRaw(n);
    setPaid(Array(n).fill(false));
    setNominals(Array(n).fill(''));
    setAssign(Object.fromEntries(orderItems.map((it, i) => [itemKey(it), i % n])));
  };

  const togglePaid = (i: number) => setPaid((p) => p.map((v, j) => (j === i ? !v : v)));
  const cycleAssign = (key: string) =>
    setAssign((a) => ({ ...a, [key]: ((a[key] ?? 0) + 1) % splits }));

  // Label split generik bernomor (tanpa nama orang fiktif).
  const splitLabel = (i: number): string => t('bill_split_of').replace('{i}', String(i + 1)).replace('{n}', String(splits));
  // Bagi rata: sisa rupiah didistribusikan satu per satu ke split awal - jumlah split pas = total.
  const splitBase = Math.floor(total / splits);
  const splitRem = total - splitBase * splits;
  const splitVal = (i: number) => splitBase + (i < splitRem ? 1 : 0);
  const itemTotals = Array(splits).fill(0) as number[];
  orderItems.forEach((it) => {
    itemTotals[assign[itemKey(it)] ?? 0] += lineAmount(it);
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
    ...(ongkirCutVal > 0 ? { ongkirCut: ongkirCutVal } : {}),
    // Kemasan cermin ongkir: menempel pada order PENUH (bukan per-split),
    // diteruskan utuh via orderCtx agar Pay/Success/Receipt mencatat benar.
    ...(packagingVal > 0 ? { packaging: packagingVal } : {}),
    ...(p.customer ? { customer: p.customer } : {}),
    ...(p.memberId ? { memberId: p.memberId } : {}),
    ...(tipVal > 0 ? { tip: tipVal } : {}),
    ...(orderNoteVal ? { orderNote: orderNoteVal } : {}),
    ...(deliveryAddrVal ? { deliveryAddr: deliveryAddrVal } : {}),
    ...(serviceDateVal ? { serviceDate: serviceDateVal } : {}),
    ...(serviceTimeVal ? { serviceTime: serviceTimeVal } : {}),
    ...(technicianVal ? { technician: technicianVal } : {}),
    ...(dpPercentVal > 0 ? { dpPercent: dpPercentVal } : {}),
    ...(deliveryAddressVal ? { deliveryAddress: deliveryAddressVal } : {}),
    ...(parseCustomerId(p.customerId) != null ? { customerId: parseCustomerId(p.customerId) as number } : {}),
  };
  // Share proporsional service/pajak/feeESB/kemasan/pembulatan untuk split parsial
  // (info-only struk di Pay > Success > Receipt). P5: feeESB ikut (charged
  // total grup memuatnya; Success menampilkannya) agar konsisten di keduanya.
  // Diskon/voucher tak diteruskan per-split karena total split sudah neto
  // (hindari catat ganda).
  const splitShareCtx = (val: number): Record<string, number> => {
    if (total <= 0 || val <= 0) return {};
    const r = val / total;
    return {
      ...(serviceVal > 0 ? { service: Math.max(0, Math.round(serviceVal * r)) } : {}),
      ...(taxVal > 0 ? { tax: Math.max(0, Math.round(taxVal * r)) } : {}),
      ...(feeESBVal > 0 ? { feeESB: Math.max(0, Math.round(feeESBVal * r)) } : {}),
      ...(packagingVal > 0 ? { packaging: Math.max(0, Math.round(packagingVal * r)) } : {}),
      ...(tipVal > 0 ? { tip: Math.max(0, Math.round(tipVal * r)) } : {}),
      ...(roundingVal !== 0 ? { rounding: Math.round(roundingVal * r) } : {}),
    };
  };
  // Rincian info-only bawaan pemanggil (service/pajak/fee/kemasan/pembulatan)
  // - diteruskan agar baris struk pas dengan total di Pay > Success > Receipt.
  const breakdownCtx = {
    ...(serviceVal > 0 ? { service: serviceVal } : {}),
    ...(taxVal > 0 ? { tax: taxVal } : {}),
    ...(feeESBVal > 0 ? { feeESB: feeESBVal } : {}),
    ...(packagingVal > 0 ? { packaging: packagingVal } : {}),
    ...(tipVal > 0 ? { tip: tipVal } : {}),
    ...(roundingVal !== 0 ? { rounding: roundingVal } : {}),
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('bill_title')}
        onBack={() => navigation?.goBack()}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
        <Text style={styles.meta}>{metaNo} · {metaTable} · {metaGuest}</Text>
      {/* Tablet: struk dibatasi sempit + tengahkan agar proporsional. */}
      {(() => {
        const eff = tplOn ? getEffectiveTogglesForMode(tpl, p.mode) : null;
        const show = (k: keyof ReceiptTemplateToggles): boolean => (eff ? eff[k] as boolean : true);
        const narrow = tplOn && eff && eff.paperSize === '58mm';
        return (<View style={[styles.bill, isTablet && wideCenterSm, narrow && styles.billNarrow]}>
        <Text style={styles.unpaid}>** {t('rc_unpaid')} **</Text>
        {(tplOn && eff && eff.showLogo && (mInfo.logoUrl ?? '').trim()) ? (<Image source={{ uri: (mInfo.logoUrl ?? '').trim() }} style={styles.logo} resizeMode="contain" />) : null}
        {show('showMerchantName') ? (<Text style={styles.shop}>{shopName}</Text>) : null}
        {show('showAddress') ? (<Text style={styles.addr}>{shopAddr}</Text>) : null}
        {(() => {
          const c = [eff && eff.showPhone ? shopPhone : '', eff && eff.showEmail ? shopEmail : ''].filter((s) => s).join(' · ');
          return c ? (<Text style={styles.addr}>{c}</Text>) : null;
        })()}
        {(show('showOrderNumber') || show('showOrderType')) ? (<Text style={styles.trx}>{[eff && !eff.showOrderNumber ? '' : metaNo, eff && !eff.showOrderType ? '' : (tplOn && eff ? buildReceiptOrderTypeLine(p.mode ?? '', p.table, eff, (eff.receiptLanguage ?? lang), mInfo.merchantType || undefined) : (p.mode ?? ''))].filter((s) => s && s !== '-').join(' · ')}</Text>) : null}
        {(() => {
          const parts = [eff && !eff.showTableNumber ? '' : metaTable, (eff && !(eff.showCustomerName || eff.showCustomerPhone)) ? '' : metaGuest].filter((x) => x && x !== '-');
          return parts.length > 0 ? (<Text style={styles.trx}>{parts.join(' · ')}</Text>) : null;
        })()}
        {show('showDateTime') ? (<Text style={styles.trx}>{metaTime}</Text>) : null}
        {deliveryAddrVal ? (<Text style={styles.trx}>{deliveryAddrVal}</Text>) : null}
        {svcLineVal ? (<Text style={styles.trx}>{svcLineVal}</Text>) : null}
        {tplOn && eff && eff.paperSize ? (<Text style={styles.paperTag}>{eff.paperSize === '58mm' ? '58mm' : '80mm'} · {eff.receiptLanguage === 'id' ? 'ID' : 'EN'}</Text>) : null}
        {orderItems.map((i, idx) => (
          <View key={`${itemKey(i)}-${idx}`} style={styles.row}>
            <Text style={styles.item}>{i.qty}× {i.name}</Text>
            <Text style={styles.price}>{rp(lineAmount(i))}</Text>
          </View>
        ))}
        {orderItems.map((i, idx) => (
          <View key={`sub-${itemKey(i)}-${idx}`}>
            {(tplOn && eff && eff.showUnitPrice) ? (<Text style={styles.note}>@ {rp(unitPrice(i))}</Text>) : null}
            {(() => {
              const n = (i as unknown as { note?: string }).note;
              return (tplOn && eff && eff.showItemNotes && n) ? (<Text style={styles.note}>* {n}</Text>) : null;
            })()}
            {((!eff || eff.showAddons) ? (i.modifiers ?? []) : []).map((m) => (
              <Text key={m.name} style={styles.note}>+ {m.name}{(!eff || eff.showAddonPrices) ? ` ${rp(m.price * i.qty)}` : ''}</Text>
            ))}
          </View>
        ))}
        {(tplOn && eff && eff.showOrderNotes && orderNoteVal) ? (<Text style={styles.note}>{orderNoteVal}</Text>) : null}
        {show('showSubtotal') ? (<View style={styles.row}><Text style={styles.item}>{t('c_subtotal')}</Text><Text style={styles.price}>{rp(subtotalVal)}</Text></View>) : null}
        {taxVal > 0 && show('showTax') && (
          <View style={styles.row}><Text style={styles.item}>{t('taxIncl')}</Text><Text style={styles.price}>{rp(taxVal)}</Text></View>
        )}
        {serviceVal > 0 && show('showServiceCharge') && (
          <View style={styles.row}><Text style={styles.item}>{tplOn && eff ? ((eff.receiptLanguage ?? lang) === 'id' ? 'Biaya Layanan' : 'Service Charge') : serviceLabel(t, svcCfg)}</Text><Text style={styles.price}>{rp(serviceVal)}</Text></View>
        )}
        {tipVal > 0 && (
          <View style={styles.row}><Text style={styles.item}>{t('pay_tip_row')}</Text><Text style={styles.price}>+{rp(tipVal)}</Text></View>
        )}
        {feeESBVal > 0 && (
          <View style={styles.row}><Text style={styles.item}>{platformFeeLabel(t)}</Text><Text style={styles.price}>{rp(feeESBVal)}</Text></View>
        )}
        {packagingVal > 0 && show('showPackagingFee') && (
          <View style={styles.row}><Text style={styles.item}>{t('packaging')}</Text><Text style={styles.price}>{rp(packagingVal)}</Text></View>
        )}
        {ongkirVal > 0 && show('showDeliveryFee') && (
          <View style={styles.row}><Text style={styles.item}>{t('ongkir')}</Text><Text style={styles.price}>{rp(ongkirVal)}</Text></View>
        )}
        {ongkirCutVal > 0 && show('showDeliveryFee') && (
          <View style={styles.row}><Text style={styles.item}>{t('rc_ongkir_cut')}</Text><Text style={styles.price}>-{rp(ongkirCutVal)}</Text></View>
        )}
        {discountVal > 0 && show('showDiscount') && (
          <View style={styles.row}><Text style={styles.item}>{t('discount')}{voucherCode ? ` (${voucherCode})` : ''}</Text><Text style={styles.disc}>-{rp(discountVal)}</Text></View>
        )}
        {roundingVal !== 0 && (
          <View style={styles.row}><Text style={styles.item}>{t('rounding')}</Text><Text style={styles.price}>{rp(roundingVal)}</Text></View>
        )}
        {show('showTotal') ? (<View style={styles.totalRow}><Text style={styles.totalL}>{t('bill_total')}</Text><Text style={styles.totalV}>{rp(total)}</Text></View>) : null}
        {tplOn && eff && eff.showCashierName && metaCashier && metaCashier !== '-' ? (<Text style={styles.member}>{(eff.receiptLanguage ?? lang) === 'id' ? 'Kasir' : 'Cashier'}: {metaCashier}</Text>) : null}
        {tplOn && eff && eff.showThankYouMessage ? (<Text style={styles.thanks}>{eff.customThankYouMessage || ((eff.receiptLanguage ?? lang) === 'en' ? 'Thank you for your order!' : 'Terima kasih atas pesanan Anda!')}</Text>) : null}
        {tplOn && eff && eff.showCustomFooterText && eff.customFooterText ? (<Text style={styles.addr}>{eff.customFooterText}</Text>) : null}
        {tplOn && eff && eff.showFooterPhone && shopPhone ? (<Text style={styles.addr}>{shopPhone}</Text>) : null}
        {tplOn && eff && eff.showGenfityBranding ? (<Text style={styles.addr}>{(eff.receiptLanguage ?? lang) === 'id' ? 'Diberdayakan oleh Genfity' : 'Powered by Genfity'}</Text>) : null}
        {(p.memberId || p.customer) ? (
          <Text style={styles.member}>{p.memberId ? t('bill_member_line').replace('{m}', p.memberId).replace('{c}', p.customer ? ` · ${p.customer}` : '') : metaGuest}</Text>
        ) : null}
      </View>);
      })()}

      <View style={styles.actions}>
        <AppButton
          title={t('ok_print')}
          variant="secondary"
          onPress={() => navigation?.navigate('Receipt', {
            total, items: saleItems, discount: discountVal,
            ...(voucherCode ? { voucherCode } : {}),
            ...orderCtx,
            ...breakdownCtx,
            // Pratinjau pracetak: tandai belum bayar agar struk jujur.
            unpaid: true,
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
          <TouchableOpacity key={m} style={[styles.chip, isTablet && styles.chipTablet, mode === m && styles.chipOn]} onPress={() => setMode(mode === m ? 'none' : m)}>
            <Text style={[styles.chipT, isTablet && styles.chipTTablet, mode === m && styles.chipTOn]}>{l}</Text>
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
              <TouchableOpacity key={n} style={[styles.chip, isTablet && styles.chipTablet, splits === n && styles.chipOn]} onPress={() => resetSplits(n)}>
                <Text style={[styles.chipT, isTablet && styles.chipTTablet, splits === n && styles.chipTOn]}>÷{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.paidBanner}>
            {t('bill_paid').replace('{p}', String(paidCount)).replace('{s}', String(splits))}
          </Text>
          {dbPaid != null && groupNoRef.current ? (
            <Text style={styles.paidBanner}>
              {t('bill_dbpaid').replace('{p}', rp(dbPaid)).replace('{t}', rp(total))}
            </Text>
          ) : null}

          {mode === 'item' && (
            <>
              <Text style={styles.hint}>{t('bill_item_hint')}</Text>
              {orderItems.map((it) => (
                <TouchableOpacity key={itemKey(it)} style={styles.row} onPress={() => cycleAssign(itemKey(it))}>
                  <Text style={styles.item}>{it.qty}× {it.name}</Text>
                  <Text style={styles.splitBadge}>{t('bill_split_of').replace('{i}', String((assign[itemKey(it)] ?? 0) + 1)).replace('{n}', String(splits))} ›</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {mode === 'nominal' && (
            <>
              <Text style={styles.hint}>{t('bill_nom_hint').replace('{t}', rp(total))}</Text>
              {Array.from({ length: splits }, (_, i) => (
                <View key={i} style={styles.nomRow}>
                  <Text style={styles.item}>{splitLabel(i)}</Text>
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

          {Array.from({ length: splits }, (_, i) => {
            const val = mode === 'item' ? itemTotals[i] : mode === 'nominal' ? nominalNums[i] : splitVal(i);
            return (
              <View key={i} style={styles.splitRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.item}>{splitLabel(i)}</Text>
                  <Text style={paid[i] ? styles.lunas : styles.price}>{paid[i] ? t('bill_lunas') : rp(val)}</Text>
                </View>
                {!paid[i] && (
                  <AppButton
                    title={`${t('bill_pay')} ›`}
                    disabled={val <= 0 || !nominalGateOk(mode)}
                    onPress={() => paySplit(val, mode)}
                    fullWidth={false}
                    size="sm"
                    style={styles.payBtn}
                  />
                )}
                <TouchableOpacity onPress={() => togglePaid(i)} hitSlop={10} style={[styles.lunasBtn, isTablet && styles.lunasBtnTablet]}>
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
  billNarrow: { maxWidth: 300, alignSelf: 'center', width: '100%' },
  unpaid: { fontFamily: fonts.bold, fontSize: 13, color: colors.red, textAlign: 'center', marginBottom: 6 },
  paperTag: { fontFamily: fonts.medium, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 4 },
  thanks: { fontFamily: fonts.bold, fontSize: 13, color: colors.text, textAlign: 'center', marginTop: 10 },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  logo: { width: 56, height: 56, alignSelf: 'center', marginBottom: 4 },
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
  // Tablet: chip penuhi target sentuh 48px.
  chipTablet: { minHeight: 48, paddingVertical: 12 },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTTablet: { fontSize: 13 },
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
  // Tablet: toggle lunas penuhi target sentuh 48px.
  lunasBtnTablet: { minHeight: 48, paddingVertical: 12 },
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
