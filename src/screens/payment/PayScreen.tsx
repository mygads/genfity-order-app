import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { useLang } from '../../lib/i18n';
import { appAlert } from '../../lib/appAlert';
import { useConnectivity } from '../../hooks/useConnectivity';
import ExtraPaySection from './ExtraPaySection';
import { lineSubtotal, recordSale, type SaleInput, type SaleItemIn } from '../../lib/payments';
import { nextSalesNum, saveSale, saleHeadExists, appendGroupPayment, getSaleClientId, getOrCreatePayChainId, getGroupPaid } from '../../lib/sales';
import { uuidv7 } from '../../lib/uuidv7';
import { getCashSessionId } from '../../lib/beWorkforce';
import { publishDisplayOrder } from '../../lib/display';
import { validateVoucherCode } from '../../lib/apiSource';
import { enqueueSync, syncWarnLevel } from '../../lib/sync';
import {
  getServerOrderIdForSale,
  mapPayMethodToBe,
  settlePosPayment,
  GO_OP_SETTLE,
} from '../../lib/posWire';
import { initDb, query as queryDb } from '../../lib/db';
import { getCachedTipEnabled, subscribeTipFlag } from '../../lib/posModes';
import ManagerPinPrompt from '../../components/ManagerPinPrompt';
import { requiresPosPin } from '../../lib/posPinGate';
import { getCachedCurrency } from '../../lib/currency';
import { getPosPromoGate, isPayTabEnabled, getRequirePaymentProof } from '../../lib/posConfigSync';
import { uploadExpensePhotoFirst } from '../../lib/terminalExpense';
import { preparePhoto } from '../../lib/photo';
import { customerIdFromLocalKey, maskMemberName, parseCustomerId } from '../../lib/memberRef';
import { recordSettleMemberResult } from '../../lib/memberChangedStore';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type VoucherIn =
  | string
  | { code?: unknown; amount?: unknown; kind?: unknown; rate?: unknown; maxAmount?: unknown; minSpend?: unknown }
  | number;

/** Voucher bawaan order yang nominalnya sudah dihitung pemanggil ke dalam total. */
type OrderVoucher = { code: string; amount: number; kind: string; rate?: number; maxAmount?: number; minSpend?: number };

/**
 * Klasifikasi ragam voucher selaras src/lib/totals.ts: hanya kind 'Ongkir'
 * atau kode GRATISONGKIR yang memotong ongkir; kind mengandung '%' dihitung
 * kanonis di totals.ts (round(dasar * pct / 100), pct 0-100, sebelum service).
 * Selain itu diskon nominal atas belanja, diteruskan apa adanya untuk dicatat.
 */
const isOngkirVoucher = (code: string, kind: string): boolean =>
  kind === 'Ongkir' || code === 'GRATISONGKIR';

/**
 * Normalisasi voucher params ke {code, amount, kind} untuk diteruskan dan
 * dicatat (bukan untuk dipotong ulang: total pemanggil sudah neto).
 * Nominal dari params discount didahulukan (BillPreview/SplitBill kirim angka
 * resmi), lalu objek {code, amount, kind}, lalu angka mentah. Kode string tanpa
 * nominal berarti jumlah tak diketahui di layar ini (amount 0).
 */
const normalizeOrderVoucher = (
  raw: VoucherIn | undefined,
  voucherCode: string | undefined,
  discount: number | undefined,
): OrderVoucher | null => {
  let code = (voucherCode ?? '').trim().toUpperCase();
  let amount = Math.max(0, Math.round(Number(discount) || 0));
  let kind = '';
  let rate: number | undefined;
  let maxAmount: number | undefined;
  let minSpend: number | undefined;
  if (typeof raw === 'string') {
    if (!code) code = raw.trim().toUpperCase();
  } else if (typeof raw === 'number') {
    if (amount <= 0) amount = Math.max(0, Math.round(raw));
  } else if (raw && typeof raw === 'object') {
    if (!code && typeof raw.code === 'string') code = raw.code.trim().toUpperCase();
    if (amount <= 0) amount = Math.max(0, Math.round(Number(raw.amount) || 0));
    if (typeof raw.kind === 'string') kind = raw.kind.trim();
    const r = Number((raw as { rate?: unknown }).rate);
    if (Number.isFinite(r) && r > 0) rate = Math.min(100, r);
    const c = Math.round(Number((raw as { maxAmount?: unknown }).maxAmount) || 0);
    if (c > 0) maxAmount = c;
    const m = Math.round(Number((raw as { minSpend?: unknown }).minSpend) || 0);
    if (m > 0) minSpend = m;
  }
  if (!code && amount <= 0) return null;
  return {
    code,
    amount,
    kind,
    ...(rate != null ? { rate } : {}),
    ...(maxAmount != null ? { maxAmount } : {}),
    ...(minSpend != null ? { minSpend } : {}),
  };
};

type Props = {
  navigation?: Nav;
  route?: {
    params?: {
      total?: number;
      items?: SaleItemIn[];
      /** Metode usulan (mis. dari SplitBill: Tunai/QRIS/EDC) - memilih tab awal. */
      method?: string;
      mode?: string;
      table?: string;
      ongkir?: number;
      customer?: string;
      memberId?: string;
      /** Ronde-3 Q1: customerId GO (int) bila member ditempel. */
      customerId?: number;
      /** Ronde-3 Q4: poin pra-settle yang dipajang (dari Member terapkan);
       * dipakai sebagai snapshot pembanding block response pasca-settle. */
      memberPoin?: number;
      /** Voucher bawaan order: kode string, objek {code, amount, kind}, atau nominal. */
      voucher?: VoucherIn;
      /** Kode voucher eksplisit bila voucher di atas hanya angka. */
      voucherCode?: string;
      /** Diskon/voucher bawaan order (dari BillPreview/SplitBill) agar tidak hilang di rantai. */
      discount?: number;
      /** Potongan ongkir bawaan yang sudah dihitung pemanggil (gross-ongkir - net). */
      ongkirCut?: number;
      /** Rincian struk untuk diteruskan (opsional, bila pemanggil memilikinya). */
      service?: number;
      tax?: number;
      rounding?: number;
      /** Fee platform order ESB/marketplace (info-only, kontrak §5: platformFee). */
      feeESB?: number;
      /** Biaya kemasan order (info-only terusan; ledger via packagingFee). */
      packaging?: number;
      /** Tip/gratuity terusan (kembali dari Member/EDC agar pilihan tak hilang). */
      tip?: number;
      /** Nomor struk bawaan (dari Simpan/LoadOrder via kasir) - pakai ulang bila ada. */
      salesNum?: string;
      /** client_id UUIDv7 rantai bayar (APP-PRINTER-SALES, Q7): diterbitkan
       * sekali per sale, dipakai ulang Qris/Edc/Success/Receipt agar QR tak basi. */
      clientId?: string;
      /** Split grup (dari SplitBill): kunjungan bayar memakai SATU salesNum. */
      splitGroup?: boolean;
      /** Total PENUH order grup (tagihan kunjungan ini tetap di `total`). */
      orderTotal?: number;
    };
  };
};

type Tab = 'tunai' | 'nontunai' | 'online' | 'member' | 'lainnya';
/** Split parsial: label untuk tampilan, method mentah untuk payload (bank/dompet masing-masing). memberId dibawa kaki deposit agar gate withdraw saveSale jalan; customerId GO ikut agar settle/drain membawa ref GO (ronde-3 Q1). */
type Split = { id: string; label: string; method: string; amount: number; memberId?: string; customerId?: number };

/** Label generik ExtraPay → method mentah agar payload tidak ke-strip. */
const extraLabelToMethod = (label: string): string => {
  const k = label.trim().toLowerCase();
  if (k.includes('transfer')) return 'transfer';
  if (k.includes('deposit')) return 'deposit';
  if (k.includes('kompli')) return 'compliment';
  if (k.includes('non')) return 'nonsales';
  return label;
};

// HP-E2E-FIX-DRAWER (2026-10-24): 1 terminal = 1 drawer default. Dulu ada
// pilihan Laci 1/2/3 (CASH_DRAWERS) — dihapus: kasir/owner/full-access tak
// lagi memilih drawer; pembayaran tunai selalu ke drawer default terminal.
// Kunci i18n pay_drawer_* dipertahankan (tak dipakai lagi, tanpa referensi).

const CARDS = [
  { id: 'debit-bca', name: 'Debit BCA' },
  { id: 'kredit-bca', name: 'Kredit BCA' },
  { id: 'debit-ocbc', name: 'Debit OCBC' },
];

const WALLETS = [
  { id: 'ovo', name: 'OVO', img: require('../../../assets/images/payment_ovo.webp') },
  { id: 'gopay', name: 'GoPay', img: require('../../../assets/images/payment_gopay.webp') },
  { id: 'dana', name: 'DANA', img: require('../../../assets/images/payment_dana.webp') },
  { id: 'qris', name: 'QRIS', img: require('../../../assets/images/payment_qris.webp') },
  { id: 'shopeepay', name: 'ShopeePay', img: null },
];

/** Tanpa mock member: DB kosong/gagal baca = empty-state pay_dep_empty (jujur). */

let splitSeq = 0;

const SIDEBAR_IDS: Tab[] = ['tunai', 'nontunai', 'online', 'member', 'lainnya'];

/** Baris member live (ms_member hasil seed/pull); saldo dari depositBalance. */
type LiveMember = { id: string; nama: string; saldo: number };
type MemberRow = { id: string; memberName: string | null; depositBalance: number | null };

export default function PayScreen({ navigation, route }: Props) {
  /** G5: sinyal E00044 (kontrak §2/§10.4) >7 hari tanpa sync = BLOKIR bayar:
   * semua CTA pelunasan mati + banner blokir beraksi Sync; bangun split lokal
   * (Tambah) tetap boleh. Qris/Edc tak terjangkau karena hanya via Pay. */
  const syncBlocked = syncWarnLevel() === 'block7';
  // Nominal wajib dari kasir (route.params.total) — tanpa params tampilkan
  // empty-state jujur (pay_empty_total), bukan Rp266rb fiktif.
  const totalParam = route?.params?.total;
  const hasTotal =
    typeof totalParam === 'number' && Number.isFinite(totalParam) && totalParam > 0;
  const total = hasTotal ? Math.round(totalParam) : 0;
  const orderMode = route?.params?.mode;
  const tableNo = route?.params?.table;
  const ongkir = route?.params?.ongkir ?? 0;
  const customerName = route?.params?.customer;
  const memberIdParam = route?.params?.memberId;
  /** Ronde-3 Q1: ref GO dari params (ditempel MemberScreen pasca-resolve). */
  const customerIdParam = parseCustomerId(route?.params?.customerId);
  /** Ronde-3 Q4: poin pra-settle (snapshot pembanding block response). */
  const memberPoinParam =
    route?.params?.memberPoin == null || !Number.isFinite(Number(route.params.memberPoin))
      ? null
      : Math.max(0, Math.round(Number(route.params.memberPoin)));
  /** Nomor struk bawaan draft (Simpan/LoadOrder): pakai ulang agar struk = arsip. */
  const paramSalesNum = (route?.params?.salesNum ?? '').trim();
  /** Rincian struk bawaan pemanggil untuk diteruskan (bukan dihitung ulang). */
  const serviceParam = Math.max(0, Math.round(Number(route?.params?.service) || 0));
  const taxParam = Math.max(0, Math.round(Number(route?.params?.tax) || 0));
  const roundingParam = Math.round(Number(route?.params?.rounding) || 0);
  const feeESBParam = Math.max(0, Math.round(Number(route?.params?.feeESB) || 0));
  const packagingParam = Math.max(0, Math.round(Number(route?.params?.packaging) || 0));
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang();
  const { online, wsConnected } = useConnectivity();
  // Badge koneksi 3-state (mirror DashboardScreen): hijau+Online bila jaringan
  // & WS up, amber+Offline bila jaringan mati, abu+Offline (mode lokal) bila tak diketahui
  // (null)/WS putus. 'Offline' netral EN/ID (tanpa kunci i18n baru).
  const connLabel = online === false ? 'Offline' : online && wsConnected ? t('pay_online') : 'Offline';
  const connDot = online === false ? styles.onlineDotAmber : online && wsConnected ? undefined : styles.onlineDotGrey;
  const todayStr = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  }, [lang]);
  // Tab awal mengikuti metode usulan pemanggil (mis. SplitBill kirim Tunai/QRIS/EDC).
  const methodParam = (route?.params?.method ?? '').trim().toLowerCase();
  // DUAL-CURRENCY §4a: QRIS/EDC/dompet-ID hanya untuk cabang IDR. Gerbang
  // dibaca dari profil currency live (disinkron saat login); tab ID disembunyikan
  // + usulan metode ID jatuh ke Tunai. Tunai/member/tender netral-currency.
  // (ms_paymentmethod seed tak dikonsumsi UI — tab hardcode ini satu-satunya
  // sumber daftar metode, sehingga gerbang hidup di sini, bukan kolom DB mati.)
  const isAudBranch = getCachedCurrency().code === 'AUD';
  const [tab, setTab] = useState<Tab>(() => {
    let initial: Tab = 'tunai';
    if (/qris|ovo|gopay|dana|shopee|online|wallet/.test(methodParam)) initial = 'online';
    else if (/edc|debit|kredit|kartu|card|non/.test(methodParam)) initial = 'nontunai';
    else if (/deposit|member/.test(methodParam)) initial = 'member';
    else if (/pluxee|ultra|tender|lainnya/.test(methodParam)) initial = 'lainnya';
    if (isAudBranch && (initial === 'online' || initial === 'nontunai')) return 'tunai';
    return initial;
  });
  /** S-F1: tab yang dimatikan server via pos-config (absen = tampil).
   * Muat sekali saat layar dibuka; cache gagal = perilaku lama. */
  const [srvOffTabs, setSrvOffTabs] = useState<Tab[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const off: Tab[] = [];
      for (const id of SIDEBAR_IDS) {
        try {
          if (!(await isPayTabEnabled(id))) off.push(id);
        } catch {
          /* absen = tampil */
        }
      }
      if (alive) setSrvOffTabs(off);
    })();
    return () => {
      alive = false;
    };
  }, []);
  /** S-F2: gate promo server (posDiscountsEnabled=false = kunci UI pasang
   * voucher baru; voucher bawaan order tetap ditampilkan apa adanya). */
  const [posPromoOn, setPosPromoOn] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await getPosPromoGate();
        if (alive) setPosPromoOn(g.posDiscountsEnabled);
      } catch {
        /* absen = true = perilaku lama */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  /** Tab yang tampil untuk currency cabang aktif (AUD = tanpa nontunai/online),
   * dikurangi tab yang dimatikan server (S-F1). Salah-konfigurasi server
   * (semua tab mati) = kembali ke daftar currency agar kasir tak terkunci. */
  const visibleTabs: Tab[] = (() => {
    const base = isAudBranch
      ? SIDEBAR_IDS.filter((id) => id !== 'nontunai' && id !== 'online')
      : SIDEBAR_IDS;
    const cut = base.filter((id) => !srvOffTabs.includes(id));
    return cut.length > 0 ? cut : base;
  })();
  /** Bila tab terpilih dimatikan server susulan, jatuh ke tab tampil pertama. */
  useEffect(() => {
    if (srvOffTabs.length === 0) return;
    setTab((cur) => (srvOffTabs.includes(cur) ? visibleTabs[0] ?? 'tunai' : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srvOffTabs]);

  const [voucherOpen, setVoucherOpen] = useState(false);
  // Voucher bawaan order (CartDetail/BillPreview/SplitBill): total pemanggil sudah
  // neto termasuk voucher ini, jadi hanya diteruskan + dicatat, bukan dipotong lagi.
  const orderVoucher = normalizeOrderVoucher(
    route?.params?.voucher,
    route?.params?.voucherCode,
    route?.params?.discount,
  );
  const isSplitGroup = route?.params?.splitGroup === true;
  const orderIsOngkir = orderVoucher
    ? isOngkirVoucher(orderVoucher.code, orderVoucher.kind)
    : false;
  // Diskon belanja bawaan = angka discount pemanggil apa adanya (sudah neto:
  // discountTotal + voucherAmt belanja; untuk voucher ongkir = discountTotal
  // saja karena voucherAmt=0). Jangan di-nol-kan untuk kind Ongkir — itu
  // menghilangkan diskon order saat voucher ongkir dipakai.
  const discountParam = Math.max(0, Math.round(Number(route?.params?.discount) || 0));
  const orderDiscount = orderVoucher ? discountParam : 0;
  // Potongan ongkir bawaan: PERCAYA angka pemanggil (ongkirCut) apa adanya.
  // Tebak-ulang min(nominal, ongkir) salah kaprah karena ongkir hilir sudah
  // NET (min(nominal, net) ≠ cut aktual) dan discountParam sudah neto.
  // Tanpa params (pemanggil lama) = 0 yang jujur, bukan tebakan.
  const orderCutParam = Math.max(0, Math.round(Number(route?.params?.ongkirCut) || 0));
  const orderOngkirCut = orderVoucher && orderIsOngkir ? orderCutParam : 0;
  // Nilai yang dicatat ke DB/payload: hanya jalur langsung (ongkir = bruto).
  // Jalur splitGroup memakai ongkir residual per kunjungan sehingga potongan
  // vs-net tak bermakna - catat 0 yang jujur (kode voucher tetap terbakar).
  const cutToRecord = isSplitGroup ? 0 : orderOngkirCut;
  // Voucher yang dipasang di layar ini via kotak validasi server. Ini satu-satunya
  // pengurang payable, karena total pemanggil sudah final. Split grup DILARANG
  // pasang box: voucher grup sudah diaporsi SplitBill; box menambah diskon di
  // luar head grup (ghost remainder: head grand penuh vs visit pay lebih kecil).
  const [boxCode, setBoxCode] = useState('');
  const [boxVoucher, setBoxVoucher] = useState<{ code: string; amount: number; kind: string; rate?: number; maxAmount?: number } | null>(null);
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherMsg, setVoucherMsg] = useState('');
  const boxIsOngkir = boxVoucher ? isOngkirVoucher(boxVoucher.code, boxVoucher.kind) : false;
  const boxBelanjaAmt = boxVoucher && !boxIsOngkir ? boxVoucher.amount : 0;
  const boxOngkirCut = boxVoucher && boxIsOngkir ? boxVoucher.amount : 0;
  // Kode voucher efektif (kotak didahulukan) + diskon efektif untuk dicatat.
  // Diskon belanja TAK mencakup box ongkir (itu ongkirCut, bukan discountTotal).
  const effVoucherCode = boxVoucher?.code ?? orderVoucher?.code ?? '';
  const effDiscount = orderDiscount + boxBelanjaAmt;
  const totalOngkirCut = cutToRecord + (isSplitGroup ? 0 : boxOngkirCut);
  // Tip/gratuity pelanggan (fitur tip v1, 2026-10): diputuskan di layar ini —
  // satu-satunya PENAMBAH payable (voucher box hanya mengurangi; total
  // pemanggil sudah final). Basis = subtotal item (Σ lineSubtotal); tanpa
  // items = mundur dari total (total − service − fee − rounding − ongkirNet).
  // Cap = basis (cermin validasi server: tip ≤ subtotal). Split grup DILARANG
  // bertip (tip kunjungan grup = follow-up; BE v1 mengecualikan bagi-bill):
  // tipAmount paksa 0. Init dari params (kembali dari Member/EDC membawa tip
  // pilihan pulang agar tak hilang).
  const tipItems = route?.params?.items ?? [];
  const tipBase = tipItems.length > 0
    ? Math.max(0, tipItems.reduce((a, it) => a + lineSubtotal(it), 0))
    : Math.max(0, total - serviceParam - feeESBParam - packagingParam - roundingParam - Math.max(0, (Number(ongkir) || 0) - totalOngkirCut));
  const [tipMode, setTipMode] = useState<'none' | 'p5' | 'p10' | 'p15' | 'custom'>(() => (
    Math.max(0, Math.round(Number(route?.params?.tip) || 0)) > 0 ? 'custom' : 'none'
  ));
  const [tipCustom, setTipCustom] = useState(() => String(Math.max(0, Math.round(Number(route?.params?.tip) || 0)) || ''));
  const tipPct = tipMode === 'p5' ? 5 : tipMode === 'p10' ? 10 : tipMode === 'p15' ? 15 : 0;
  const tipCalc = tipMode === 'custom'
    ? Math.max(0, Math.round(Number(String(tipCustom).replace(/[^0-9]/g, '')) || 0))
    : Math.round((tipBase * tipPct) / 100);
  // Gate tip-enabled merchant (app-tip-gate, cermin FE POSPaymentModal
  // `tipEnabled === true`, default-closed): merchant tip-OFF → tipAmount
  // paksa 0 (seperti split grup) agar tak kena BE 400 INVALID_TIP. Reaktif
  // via subscribeTipFlag bila profil tersinkron setelah layar dibuka.
  const [tipEnabled, setTipEnabled] = useState(getCachedTipEnabled());
  useEffect(() => subscribeTipFlag(setTipEnabled), []);
  // Cap basis + paksa 0 untuk split grup MAUPUN merchant tip-OFF.
  const tipAmount = (!tipEnabled || isSplitGroup) ? 0 : Math.min(Math.max(0, tipCalc), tipBase);
  // Teks banner voucher bawaan (info saja, tanpa tombol lepas karena sudah di total).
  const orderBannerText = !orderVoucher
    ? ''
    : orderIsOngkir
      ? orderOngkirCut > 0
        ? `${t('pay_voucher_on').replace('{d}', rp(orderOngkirCut))} · ${orderVoucher.code}`
        : `${t('ok_voucher')} ${orderVoucher.code}`
      : orderVoucher.amount > 0
        ? `${t('pay_voucher_on').replace('{d}', rp(orderVoucher.amount))} · ${orderVoucher.code}`
        : `${t('ok_voucher')} ${orderVoucher.code}`;

  const [splits, setSplits] = useState<Split[]>([]);
  // A6 banner 2-share: kunjungan 2+ bill patungan (head sudah ada pembayaran
  // sebelumnya) tampil jujur terkumpul-vs-grand. Read-only; tanpa ubah
  // perilaku bayar/settle. Diisi sekali saat layar dibuka.
  const [groupPaidInfo, setGroupPaidInfo] = useState<{ paid: number; grand: number } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!isSplitGroup || !paramSalesNum) return;
        if (!(await saleHeadExists(paramSalesNum))) return;
        const gp = await getGroupPaid(paramSalesNum);
        if (live && gp.payCount > 0 && gp.paidTotal > 0) {
          setGroupPaidInfo({ paid: gp.paidTotal, grand: gp.grandTotal });
        }
      } catch {
        /* abaikan: banner info saja */
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  // Pemilik deposit untuk TERUSAN Pay→Qris/Edc (cermin saleMemberId goSuccess):
  // Pay bisa dibuka tanpa memberId params sementara kaki deposit parsial sudah
  // membawa memberId; tanpa fallback ini withdraw di daun dilewati (G1).
  const fwdMemberId = memberIdParam ?? splits.find((s) => s.memberId)?.memberId;
  /** Ronde-3 Q1: ref GO untuk terusan Pay→Qris/Edc (params → kaki → kunci lokal). */
  const fwdCustomerId =
    customerIdParam ??
    splits.find((s) => s.customerId != null)?.customerId ??
    customerIdFromLocalKey(fwdMemberId);
  /** Guard ketuk-ganda goSuccess (dideklarasi di sini agar di atas goSuccess). */
  const goRef = useRef(false);
  // P1-1b: prompt PIN manajer transport-only — dibuka hanya bila merchant
  // mewajibkan PIN payment DAN sale tertaut order server; batal = bayar
  // dibatalkan (paritas FE: gate memblokir konfirmasi).
  const [mgrPinOpen, setMgrPinOpen] = useState(false);
  const pinRetryRef = useRef<{ method: string; cash: number; change: number; detail?: { approvalCode?: string; memberId?: string; customerId?: number; approvedBy?: string } } | null>(null);

  // SESI-FINAL-APP: gerbang wajib-foto-bukti-bayar (merchant requirePaymentProof,
  // cache pos-config; absen = OFF = perilaku lama). Berlaku HANYA untuk metode
  // yang dicerminkan ke GO (mapPayMethodToBe != null): deposit/member/transfer
  // = ledger lokal + antre ESB tanpa padanan settle → proof tak bisa ditempel
  // (PARKED jujur, bukan diblokir). proofUrl ditempel ke settle + antrean
  // GO_OP_SETTLE; tanpa proofUrl = HOLD (tanpa goSuccess palsu).
  const [requireProof, setRequireProof] = useState(false);
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState('');
  const [proofBusy, setProofBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void getRequirePaymentProof()
      .then((v) => { if (alive) setRequireProof(v === true); })
      .catch(() => { /* absen = OFF */ });
    return () => { alive = false; };
  }, []);

  /** Ambil foto bukti (kamera → galeri; resize via preparePhoto, cermin picker
   *  ExpenseScreen). Tak pernah melempar; batal/gagal = state tak berubah. */
  const takeProof = async () => {
    if (proofBusy) return;
    setProofBusy(true);
    try {
      try {
        const cam = await ImagePicker.launchCameraAsync({ quality: 0.5 });
        if (!cam.canceled && cam.assets?.[0]?.uri) {
          const a = cam.assets[0];
          setProofUri(await preparePhoto(a.uri, a.width, a.height));
          setProofUrl('');
          return;
        }
      } catch {
        /* kamera tak tersedia, lanjut ke galeri */
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        const a = res.assets[0];
        setProofUri(await preparePhoto(a.uri, a.width, a.height));
        setProofUrl('');
      }
    } finally {
      setProofBusy(false);
    }
  };

  // Tunai
  const [cashSel, setCashSel] = useState<number | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customAmt, setCustomAmt] = useState('');

  // Non-tunai
  const [card, setCard] = useState(CARDS[1].id);
  const [edcCode, setEdcCode] = useState('');

  // Online (preset dompet bila metode usulan cocok, mis. QRIS dari SplitBill)
  const [wallet, setWallet] = useState<string | null>(() =>
    ['ovo', 'gopay', 'dana', 'qris', 'shopeepay'].includes(methodParam) ? methodParam : null,
  );
  const [ovoPhone, setOvoPhone] = useState('');

  // Deposit member live dari ms_member (seed/pull); [] = empty-state, tanpa mock.
  const [memberQ, setMemberQ] = useState('');
  const [memberSel, setMemberSel] = useState<string | null>(null);
  const [dbMembers, setDbMembers] = useState<LiveMember[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await initDb();
        const rows = await queryDb<MemberRow>(
          'SELECT id, memberName, depositBalance FROM ms_member ORDER BY memberName',
        );
        if (!alive) return;
        setDbMembers(
          rows
            .map((r) => ({
              id: String(r.id),
              nama: r.memberName ?? String(r.id),
              saldo: Math.max(0, Math.round(Number(r.depositBalance) || 0)),
            }))
            .filter((m) => m.id.length > 0),
        );
      } catch {
        // Gagal baca = anggap kosong agar empty-state tampil (bukan mock).
        if (alive) setDbMembers([]);
      }
    })();
    return () => { alive = false; };
  }, []);
  // Pra-pilih bila memberId params cocok ID live.
  useEffect(() => {
    if (!memberIdParam || memberSel) return;
    const src = dbMembers;
    if (!src) return;
    if (src.some((m) => m.id === memberIdParam)) setMemberSel(memberIdParam);
  }, [dbMembers, memberIdParam, memberSel]);

  // Pluxee / Ultra / lainnya
  const [tenderCode, setTenderCode] = useState('');
  const [tenderKind, setTenderKind] = useState<'Pluxee' | 'Ultra' | 'Lainnya'>(() => {
    if (methodParam === 'pluxee') return 'Pluxee';
    if (methodParam === 'ultra') return 'Ultra';
    return 'Lainnya';
  });
  const [tenderAmt, setTenderAmt] = useState('');
  const [tenderBusy, setTenderBusy] = useState(false);
  const [tenderMsg, setTenderMsg] = useState('');

  // Total pemanggil adalah angka resmi (selaras kontrak SplitBill/CartDetail/DineIn:
  // sudah mencakup service + ongkirNet + voucher + rounding). Params ongkir/
  // voucher/diskon hanya diteruskan untuk dicatat, bukan dihitung ulang di sini.
  // Satu-satunya pengurang adalah voucher yang dipasang di layar ini: belanja
  // (boxBelanjaAmt) dan — bila kind Ongkir — sisa ongkir (boxOngkirCut).
  // Satu-satunya penambah = tip/gratuity pelanggan (tipAmount; 0 bila tanpa
  // tip atau kunjungan split grup).
  const payable = Math.max(0, total - boxBelanjaAmt - boxOngkirCut + tipAmount);
  const paid = useMemo(() => splits.reduce((s, x) => s + x.amount, 0), [splits]);
  const remaining = Math.max(0, payable - paid);

  const WALLET_LABEL: Record<string, string> = {
    ovo: 'OVO',
    gopay: 'GoPay',
    dana: 'DANA',
    qris: 'QRIS',
    shopeepay: 'ShopeePay',
  };

  const nominals = useMemo(() => {
    const base = remaining;
    const r10 = Math.ceil(base / 10000) * 10000;
    const r1 = r10 === base ? base + 10000 : r10;
    const r2 = r1 + 10000;
    const r50 = Math.ceil(base / 50000) * 50000;
    const r3 = r50 <= r2 ? r2 + 20000 : r50;
    const r4 = r3 + 50000;
    return [r1, r2, r3, r4].filter((v, i, a) => v > base && a.indexOf(v) === i).slice(0, 4);
  }, [remaining, payable]);

  const customNum = Number(customAmt.replace(/[^0-9]/g, '')) || 0;
  const tendered = customMode ? customNum : (cashSel ?? 0);

  /**
   * Pasang voucher di layar ini: validasi ke server dulu (PAY-09). Nominal ikut
   * server (bukan konstanta), minSpend ditegakkan atas total resmi pemanggil.
   * Kind-aware (selaras totals.ts): kind Ongkir memotong SISA ongkir
   * (min(nominal, ongkir - cut bawaan), tolak bila ongkir habis) dan dicatat
   * sebagai ongkirCut — bukan diskon belanja. Split grup DILARANG: voucher
   * grup sudah diaporsi SplitBill; box menambah diskon di luar head grup
   * (ghost remainder: head grand penuh vs visit pay lebih kecil).
   */
  const applyVoucher = async () => {
    const code = boxCode.trim().toUpperCase();
    if (code.length < 3 || voucherBusy) return;
    if (isSplitGroup) {
      setVoucherMsg(t('pay_voucher_invalid').replace('{m}', rp(0)));
      return;
    }
    setVoucherBusy(true);
    setVoucherMsg(t('pay_voucher_checking'));
    try {
      const v = await validateVoucherCode(code, total);
      if (!v.ok || (v.minSpend > 0 && total < v.minSpend)) {
        setVoucherMsg(t('pay_voucher_invalid').replace('{m}', rp(v.minSpend)));
        return;
      }
      if (isOngkirVoucher(code, v.kind || '')) {
        const remainingOngkir = Math.max(0, Math.round(Number(ongkir) || 0) - orderOngkirCut);
        if (remainingOngkir <= 0) {
          setVoucherMsg(t('pay_voucher_invalid').replace('{m}', rp(v.minSpend)));
          return;
        }
        const cut = Math.min(v.amount, remainingOngkir);
        if (cut <= 0) {
          setVoucherMsg(t('pay_voucher_invalid').replace('{m}', rp(v.minSpend)));
          return;
        }
        setBoxVoucher({ code, amount: cut, kind: 'Ongkir', ...(v.maxAmount != null ? { maxAmount: v.maxAmount } : {}) });
        setBoxCode(code);
        setVoucherMsg('');
        setVoucherOpen(false);
        // Payable turun -> split lama dijepit agar tak over-collect.
        clampSplits(Math.max(0, total - cut));
        return;
      }
      const amt = Math.min(v.amount, total);
      if (amt <= 0) {
        setVoucherMsg(t('pay_voucher_invalid').replace('{m}', rp(v.minSpend)));
        return;
      }
      setBoxVoucher({ code, amount: amt, kind: v.kind || '', ...(v.rate != null ? { rate: v.rate } : {}), ...(v.maxAmount != null ? { maxAmount: v.maxAmount } : {}) });
      setBoxCode(code);
      setVoucherMsg('');
      setVoucherOpen(false);
      // Payable turun -> split lama dijepit agar tak over-collect.
      clampSplits(Math.max(0, total - amt));
    } catch {
      setVoucherMsg(t('pay_voucher_invalid').replace('{m}', rp(0)));
    } finally {
      setVoucherBusy(false);
    }
  };

  /**
   * Jepit split yang sudah ditambah SEBELUM voucher box dipasang: paid gabungan
   * tak boleh melebihi payable baru (kelebihan menempel di split terakhir).
   */
  const clampSplits = (maxPayable: number) => {
    setSplits((prev) => {
      let acc = 0;
      const out: Split[] = [];
      for (const s of prev) {
        if (acc >= maxPayable) break;
        const keep = Math.min(s.amount, maxPayable - acc);
        if (keep > 0) { out.push({ ...s, amount: keep }); acc += keep; }
      }
      return out;
    });
  };

  const removeBoxVoucher = () => {
    setBoxVoucher(null);
    setBoxCode('');
  };

  /**
   * Ganti mode/nominal tip; payable berubah (naik MAUPUN turun) = split lama
   * dijepit agar tak over-collect (cermin pola voucher box di atas).
   */
  const applyTip = (mode: 'none' | 'p5' | 'p10' | 'p15' | 'custom', custom?: string) => {
    const pct = mode === 'p5' ? 5 : mode === 'p10' ? 10 : mode === 'p15' ? 15 : 0;
    const next = isSplitGroup ? 0 : mode === 'custom'
      ? Math.min(Math.max(0, Math.round(Number(String(custom ?? tipCustom).replace(/[^0-9]/g, '')) || 0)), tipBase)
      : Math.min(Math.round((tipBase * pct) / 100), tipBase);
    setTipMode(mode);
    if (custom !== undefined) setTipCustom(custom);
    // Payable baru = total − boxBelanja − boxOngkir + tipBaru.
    clampSplits(Math.max(0, total - boxBelanjaAmt - boxOngkirCut + next));
  };

  const addSplit = (label: string, amount: number, method?: string, memberId?: string, customerId?: number) => {
    if (amount <= 0) return;
    splitSeq += 1;
    const splitCustomerId = parseCustomerId(customerId);
    setSplits((s) => [...s, { id: `split-${splitSeq}`, label, method: method ?? label, amount, ...(memberId ? { memberId } : {}), ...(splitCustomerId != null ? { customerId: splitCustomerId } : {}) }]);
  };

  const removeSplit = (id: string) => setSplits((s) => s.filter((x) => x.id !== id));

  /**
   * APP-PRINTER-SALES (Q7) + P0-4: SATU client_id per sale untuk SELURUH rantai.
   * Diselesaikan sekali di Pay (params → head → terbitkan baru) lalu
   * diteruskan WAJIB ke Qris/Edc/Success — Qris/Edc memakai ulang, tak
   * menerbitkan sendiri, agar QR tak basi dan upsert server satu kunci.
   * Bila nomor sale sudah ada, kunci dipersist SEBELUM saveSale pertama
   * (getOrCreatePayChainId) agar retry/drain memakai kunci yang SAMA.
   */
  const resolveChainClientId = async (): Promise<string> => {
    const seed = (route?.params?.clientId ?? '').trim() ||
      (paramSalesNum ? (await getSaleClientId(paramSalesNum)) ?? '' : '');
    if (paramSalesNum) return getOrCreatePayChainId(paramSalesNum, seed);
    return seed || uuidv7();
  };

  /**
   * Selesaikan pembayaran dengan SATU nomor struk: nomor TRX diterbitkan dulu,
   * dipakai saveSale + push + Success + Receipt (sebelumnya Success/Receipt
   * memakai L-timestamp yang beda dari yang tersimpan di DB).
   */
/** W2: cermin pelunasan ke BE (/pos/payment) bila sale tertaut order server.
 *  Tanpa id server / tanpa padanan enum = BLOCKED (diam, lokal tetap sah).
 *  Immediate gagal (offline/ditolak) = antre GO_OP_SETTLE agar drain
 *  memfinalisasi (retry saat offline, 'gagal'+catatan saat 4xx) — jujur di
 *  SyncScreen, tanpa Success palsu dan tanpa kirim buta. Tak pernah melempar.
 *  P1-2: sesi kas W1 yang diketahui disertakan (atribusi setoran benar);
 *  tak diketahui = BE me-resolve sendiri (sesi tunggal) atau menolak jujur
 *  bila register kasir diwajibkan — tanpa blokir-buta kasir offline (buka
 *  shift offline = id sesi belum ada di perangkat ini). */
  const mirrorSettleToServer = (
    salesNum: string, methodLabel: string, amount: number,
    tip: number, voucherCode: string | undefined, clientId: string | undefined,
    pin?: string, customerId?: number | null, prevPoints?: number | null,
  ) => {
    void (async () => {
      try {
        const serverId = await getServerOrderIdForSale(salesNum);
        if (serverId == null) return;
        // A4: deposit/member/transfer TAK punya padanan enum BE — cermin
        // server DILARANG untuk ketiganya (hanya ledger lokal + antre ESB).
        const beMethod = mapPayMethodToBe(methodLabel);
        if (!beMethod) return;
        let cashSid: number | undefined;
        try {
          const s = await getCashSessionId();
          const n = parseInt(String(s ?? '').trim(), 10);
          if (Number.isFinite(n) && n > 0) cashSid = n;
        } catch {
          /* abaikan: BE me-resolve */
        }
        // Ronde-3 Q1: customerId GO (int) bila member ditempel.
        const custId = parseCustomerId(customerId);
        // SESI-FINAL-APP: proofUrl https≤2048 ditempel aditif (settle jalan
        // tanpa proof bila kosong — BE menolak jujur via 409 PROOF_REQUIRED).
        const proofClean = /^https:\/\/.{1,2040}$/i.test(proofUrl.trim()) ? proofUrl.trim().slice(0, 2048) : '';
        const res = await settlePosPayment({
          serverId, method: beMethod, amountPaid: amount,
          ...(tip > 0 ? { tipAmount: tip } : {}),
          ...(voucherCode ? { voucherCode } : {}),
          ...(clientId ? { idempotencyKey: clientId } : {}),
          ...(custId != null ? { customerId: custId } : {}),
          ...(cashSid ? { cashSessionId: cashSid } : {}),
          ...(pin ? { pin } : {}),
          ...(proofClean ? { proofUrl: proofClean } : {}),
        });
        if (res.ok || res.reason === 'blocked') {
          if (res.ok) {
            // Ronde-3 Q4: snapshot pra vs block pasca → banner persisten di
            // Success; view minimal Q3 disimpan untuk Success/struk.
            // Fire-and-forget: sale lokal tetap sah apa pun hasilnya.
            void recordSettleMemberResult(
              salesNum,
              res.data,
              {
                customerId: custId,
                pointsBalance:
                  prevPoints == null || !Number.isFinite(Number(prevPoints))
                    ? null
                    : Math.round(Number(prevPoints)),
                vouchersValid: null,
              },
            ).catch(() => undefined);
          }
          return;
        }
        try {
          enqueueSync('other', {
            op: GO_OP_SETTLE, serverId, method: beMethod, amountPaid: amount,
            ...(tip > 0 ? { tipAmount: tip } : {}),
            ...(voucherCode ? { voucherCode } : {}),
            ...(clientId ? { clientId } : {}),
            ...(custId != null ? { customerId: custId } : {}),
            ...(cashSid ? { cashSessionId: cashSid } : {}),
            // A-P1-4: antrean ikut membawa PIN (transport-only, dipangkas).
            // Drain meneruskannya ke /pos/payment; PIN salah/berubah =
            // fail-once PIN_REQUIRED jujur (kasir ulangi live + PIN).
            ...(pin ? { pin: String(pin).slice(0, 128) } : {}),
            // SESI-FINAL-APP: proof ikut antre agar drain memfinalisasi
            // DENGAN bukti (tanpa ini = 409 PROOF_REQUIRED saat drain jalan).
            ...(proofClean ? { proofUrl: proofClean } : {}),
            salesNum, at: new Date().toISOString(),
          });
        } catch { /* antrean belum siap */ }
      } catch { /* abaikan: sale lokal tetap sah */ }
    })();
  };
  const goSuccess = async (method: string, cash: number, change: number, detail?: { approvalCode?: string; memberId?: string; customerId?: number; approvedBy?: string }, pin?: string) => {
    // Guard ketuk-ganda (#8/#21): tiap goSuccess menerbitkan nomor + tulis
    // DB; tanpa guard, dua ketukan cepat = dua saveSale (dua struk/stok ganda).
    if (goRef.current) return;
    goRef.current = true;
    try {
    // nextSalesNum melempar 'terminal-unbound' saat device belum klaim (cermin
    // QrisScreen/EdcScreen M10): tangkap di sini agar tap Bayar tunai selalu
    // memberi umpan balik (sebelumnya unhandled rejection = tombol tampak mati).
    let orderNo: string;
    let saleClientId: string;
    try {
      orderNo = paramSalesNum || (await nextSalesNum());
      // APP-PRINTER-SALES (Q7): SATU client_id per sale — diselesaikan sekali
      // di Pay via resolveChainClientId; saveSale memakai apa adanya agar QR tak basi.
      saleClientId = await resolveChainClientId();
    } catch (e) {
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
    // memberId kaki deposit parsial ikut menentukan pemilik (tanpa ini gate
    // withdraw saveSale tak jalan bila Pay dibuka tanpa memberId params).
    const saleMemberId = detail?.memberId ?? memberIdParam ?? splits.find((s) => s.memberId)?.memberId;
    // Ronde-3 Q1: ref GO otoritatif = detail → params → kaki → kunci lokal
    // (MC{id} → id). Dipakai saveSale/recordSale/appendGroupPayment/mirror/
    // Success; memberId di atas tinggal pointer ledger (kompat lokal).
    const saleCustomerId =
      parseCustomerId(detail?.customerId) ??
      customerIdParam ??
      splits.find((s) => s.customerId != null)?.customerId ??
      customerIdFromLocalKey(saleMemberId);
    // Split grup (dari SplitBill): SATU nomor struk untuk semua kunjungan.
    // Kunjungan pertama = saveSale penuh (status auto 'open'); berikutnya =
    // appendGroupPayment (tanpa stok/voucher/dapur ganda). Struk tampilkan
    // total PENUH + baris splitPaid kunjungan ini (bukan porsi saja).
    const splitGroup = route?.params?.splitGroup === true;
    const orderTotalFull = Math.max(0, Math.round(Number(route?.params?.orderTotal) || 0));
    if (splitGroup && paramSalesNum && orderTotalFull > 0) {
      const visitPay = [
        ...splits.map((s) => ({ method: s.method, amount: s.amount, ...(s.memberId ? { memberId: s.memberId } : {}), ...(s.customerId != null ? { customerId: s.customerId } : {}) })),
        { method, amount: Math.max(0, payable - paid), ...(detail?.approvalCode ? { approvalCode: detail.approvalCode } : {}) },
      ];
      try {
        if (await saleHeadExists(paramSalesNum)) {
          await appendGroupPayment(paramSalesNum, { payments: visitPay, method, change, clientId: saleClientId, ...(saleMemberId ? { memberId: saleMemberId } : {}), ...(saleCustomerId != null ? { customerId: saleCustomerId } : {}) });
        } else {
          const gInput: SaleInput = {
            method,
            salesNum: paramSalesNum,
            clientId: saleClientId,
            grandTotal: orderTotalFull,
            discountTotal: effDiscount,
            ...(serviceParam > 0 ? { serviceTotal: serviceParam } : {}),
            ...(taxParam > 0 ? { vatTotal: taxParam } : {}),
            ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
            ...(packagingParam > 0 ? { packagingFee: packagingParam } : {}),
            ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
            cash,
            change,
            items: route?.params?.items,
            payments: visitPay,
            ...(effVoucherCode ? { voucherCode: effVoucherCode } : {}),
            ...(detail?.approvalCode ? { approvalCode: detail.approvalCode } : {}),
            ...(saleMemberId ? { memberId: saleMemberId } : {}),
            ...(saleCustomerId != null ? { customerId: saleCustomerId } : {}),
            ...(tableNo ? { tableId: tableNo } : {}),
            ...(orderMode ? { mode: orderMode } : {}),
            ...(ongkir > 0 ? { ongkir } : {}),
            ...(totalOngkirCut > 0 ? { ongkirCut: totalOngkirCut } : {}),
            ...(customerName ? { customer: customerName } : {}),
          };
          // L1: antre HANYA setelah tulis DB sukses (gagal = tanpa antre yatim).
          await saveSale(gInput);
          recordSale(gInput);
          // W2: cermin lunas grup ke BE bila tertaut order server.
          mirrorSettleToServer(paramSalesNum, method, orderTotalFull, 0, effVoucherCode, saleClientId, pin, saleCustomerId, memberPoinParam);
        }
      } catch (e) {
        // Gate bound (D3-03): unbound = belum klaim → pesan klaim-terminal,
        // TANPA Success palsu. DB gagal lain = kasir tetap jalan via antrean.
        if ((e as { code?: string })?.code === 'terminal-unbound') {
          // Unbound = belum klaim: beri jalan keluar ke Klaim Terminal
          // (bukan pesan buntu), TANPA Success palsu.
          appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
            { text: t('c_cancel'), style: 'cancel' },
            { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
          ]);
          return;
        }
        // L1 fail-closed: tulis DB gagal = JANGAN Success (bukan kasir-jalan).
        appAlert(t('pay_issue_fail'));
        return;
      }
      // APP-PRINTER-SALES: kunjungan grup ikut menyiarkan display (jalur
      // appendGroupPayment tak lewat saveSale sehingga tak auto-publish).
      try {
        publishDisplayOrder(
          paramSalesNum,
          (route?.params?.items ?? []).map((it) => ({
            name: String(it.name ?? ''),
            qty: Math.max(1, Math.round(Number(it.qty) || 0)),
            price: Math.round(Number(it.basePrice) || 0),
          })),
          orderTotalFull,
        );
      } catch {
        /* abaikan */
      }
      navigation?.navigate('Success', {
        total: orderTotalFull, method, cash, change, orderNo: paramSalesNum,
        ...(saleClientId ? { clientId: saleClientId } : {}),
        items: route?.params?.items, discount: effDiscount,
        splitPaid: { amount: payable, method },
        ...(effVoucherCode ? { voucherCode: effVoucherCode } : {}),
        ...(detail?.approvalCode ? { approvalCode: detail.approvalCode } : {}),
        ...(saleMemberId ? { memberId: saleMemberId } : {}),
        ...(saleCustomerId != null ? { customerId: saleCustomerId } : {}),
        ...(serviceParam > 0 ? { service: serviceParam } : {}),
        ...(taxParam > 0 ? { tax: taxParam } : {}),
        ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
        ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
        ...(packagingParam > 0 ? { packaging: packagingParam } : {}),
        ...(ongkir > 0 ? { ongkir } : {}),
        ...(orderMode ? { mode: orderMode } : {}),
        ...(tableNo ? { table: tableNo } : {}),
        ...(customerName ? { customer: customerName } : {}),
      });
      return;
    }
    const input: SaleInput = {
      method,
      salesNum: orderNo,
      clientId: saleClientId,
      grandTotal: payable,
      discountTotal: effDiscount,
      ...(serviceParam > 0 ? { serviceTotal: serviceParam } : {}),
      // Tip diteruskan sebagai tipTotal (payload tipAmount; server validasi cap).
      ...(tipAmount > 0 ? { tipTotal: tipAmount } : {}),
      ...(taxParam > 0 ? { vatTotal: taxParam } : {}),
      ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
      ...(packagingParam > 0 ? { packagingFee: packagingParam } : {}),
      ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
      cash,
      change,
      items: route?.params?.items,
      payments: [
        ...splits.map((s) => ({ method: s.method, amount: s.amount, ...(s.memberId ? { memberId: s.memberId } : {}), ...(s.customerId != null ? { customerId: s.customerId } : {}) })),
        { method, amount: Math.max(0, payable - paid), ...(detail?.approvalCode ? { approvalCode: detail.approvalCode } : {}) },
      ],
      ...(effVoucherCode ? { voucherCode: effVoucherCode } : {}),
      ...(detail?.approvalCode ? { approvalCode: detail.approvalCode } : {}),
      ...(detail?.approvedBy ? { approvedBy: detail.approvedBy } : {}),
      ...(saleMemberId ? { memberId: saleMemberId } : {}),
      ...(saleCustomerId != null ? { customerId: saleCustomerId } : {}),
      ...(tableNo ? { tableId: tableNo } : {}),
      ...(orderMode ? { mode: orderMode } : {}),
      ...(ongkir > 0 ? { ongkir } : {}),
      ...(totalOngkirCut > 0 ? { ongkirCut: totalOngkirCut } : {}),
      ...(customerName ? { customer: customerName } : {}),
    };
    try {
      await saveSale(input);
    } catch (e) {
      // Gate bound (D3-03): unbound = belum klaim → pesan klaim-terminal,
      // TANPA Success palsu. DB gagal lain = kasir tetap jalan via antrean.
      if ((e as { code?: string })?.code === 'terminal-unbound') {
        appAlert(t('terminal_unbound_title'), t('terminal_unbound_hint'), [
          { text: t('c_cancel'), style: 'cancel' },
          { text: t('inst_claim_btn'), onPress: () => navigation?.navigate('Install') },
        ]);
        return;
      }
      // L1 fail-closed: tulis DB gagal = JANGAN Success (bukan kasir-jalan).
      appAlert(t('pay_issue_fail'));
      return;
    }
    // L1: antre HANYA setelah tulis DB sukses (gagal = tanpa antre yatim).
    recordSale(input);
    // W2: cermin lunas ke BE bila tertaut order server.
    mirrorSettleToServer(orderNo, method, payable, tipAmount, effVoucherCode, saleClientId, pin, saleCustomerId, memberPoinParam);
    navigation?.navigate('Success', {
      total: payable, method, cash, change, orderNo,
      items: route?.params?.items, discount: effDiscount,
      ...(saleClientId ? { clientId: saleClientId } : {}),
      ...(effVoucherCode ? { voucherCode: effVoucherCode } : {}),
      ...(detail?.approvalCode ? { approvalCode: detail.approvalCode } : {}),
      ...(detail?.approvedBy ? { approvedBy: detail.approvedBy } : {}),
      ...(saleMemberId ? { memberId: saleMemberId } : {}),
      ...(saleCustomerId != null ? { customerId: saleCustomerId } : {}),
      ...(serviceParam > 0 ? { service: serviceParam } : {}),
      ...(tipAmount > 0 ? { tip: tipAmount } : {}),
      ...(taxParam > 0 ? { tax: taxParam } : {}),
      ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
      ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
      ...(packagingParam > 0 ? { packaging: packagingParam } : {}),
      ...(ongkir > 0 ? { ongkir } : {}),
      ...(orderMode ? { mode: orderMode } : {}),
      ...(tableNo ? { table: tableNo } : {}),
      ...(customerName ? { customer: customerName } : {}),
    });
    } finally {
      goRef.current = false;
    }
  };

  // ---- Tunai actions ----
  // P1-1b: gerbang PIN manajer (paritas FE DeletePinModal): PIN dikumpulkan
  // via ManagerPinPrompt lalu diteruskan ke goSuccess → mirror live; bila
  // live gagal, PIN ikut antrean GO_OP_SETTLE agar drain memfinalisasi
  // (transport-only; salah/berubah = fail-once PIN_REQUIRED jujur).
  // A-P1-4 fail-closed: PIN wajib TAPI sid tak bisa dipastikan (null/lookup
  // gagal/exception, atau status-wajib tak diketahui) = HOLD sebagai
  // unpaid/offline-hold — TANPA goSuccess, TANPA navigasi Success, TANPA
  // tulis lunas. Kasir tetap di layar (keranjang/tender utuh) + banner hold;
  // ulangi setelah order tertaut / online kembali. TANPA persist tambahan:
  // tagihan meja yang sudah ada tetap 'open'; keranjang baru tetap di
  // keranjang (tanpa struk-hantu, tanpa burn voucher, tanpa debit deposit).
  const holdAsUnpaidOffline = () => {
    appAlert(t('pay_hold_unpaid_title'), t('pay_hold_unpaid'));
  };
  const goSuccessGated = (method: string, cash: number, change: number, detail?: { approvalCode?: string; memberId?: string; customerId?: number; approvedBy?: string }) => {
    void (async () => {
      try {
        // Tanpa padanan enum BE = BLOCKED diam (deposit/member): tanpa prompt.
        if (!mapPayMethodToBe(method)) {
          void goSuccess(method, cash, change, detail);
          return;
        }
        // SESI-FINAL-APP: merchant mewajibkan bukti bayar → wajibkan foto
        // SEBELUM goSuccess (upload-dulu; tanpa proofUrl = HOLD + banner,
        // TANPA goSuccess palsu, TANPA navigasi Success, TANPA tulis lunas).
        // Upload gagal/offline = tahan sebagai unpaid/hold (kasir ulangi saat
        // online). Berlaku hanya untuk metode GO-mirrored (cek di atas).
        if (requireProof) {
          let url = proofUrl.trim();
          if (!url && proofUri && !proofBusy) {
            setProofBusy(true);
            try {
              // uploadExpensePhotoFirst generik (pakai binding terminal +
              // endpoint upload K1; '' = gagal/offline jujur).
              url = await uploadExpensePhotoFirst(proofUri);
              if (url) setProofUrl(url);
            } finally {
              setProofBusy(false);
            }
          }
          if (!url) {
            if (proofUri) {
              appAlert(t('pay_proof_required'), t('pay_proof_upload_fail'));
            } else {
              appAlert(t('pay_proof_required'), t('pay_proof_required'));
            }
            return;
          }
        }
        // PIN dulu (tanpa sid): tak-wajib = jalur normal seperti hari ini.
        // Tak-diketahui (exception) = anggap wajib → fail-closed di bawah.
        let pinRequired: boolean | null = null;
        try {
          pinRequired = await requiresPosPin('payment');
        } catch {
          pinRequired = null;
        }
        if (pinRequired === false) {
          void goSuccess(method, cash, change, detail);
          return;
        }
        // Wajib/tak-diketahui: verifikasi server butuh sid. Tanpa sid (order
        // baru/offline-belum-taut) atau lookup gagal = HOLD, bukan goSuccess.
        let sid: number | null = null;
        try {
          sid = paramSalesNum ? await getServerOrderIdForSale(paramSalesNum) : null;
        } catch {
          holdAsUnpaidOffline();
          return;
        }
        if (pinRequired === null || sid == null) {
          holdAsUnpaidOffline();
          return;
        }
        pinRetryRef.current = { method, cash, change, detail };
        setMgrPinOpen(true);
      } catch {
        // A-P1-4: exception = JANGAN Success (bukan kasir-jalan).
        try {
          holdAsUnpaidOffline();
        } catch {
          /* abaikan */
        }
      }
    })();
  };
  const submitManagerPin = (pin: string) => {
    setMgrPinOpen(false);
    const r = pinRetryRef.current;
    pinRetryRef.current = null;
    if (r) void goSuccess(r.method, r.cash, r.change, r.detail, pin);
  };
  const cancelManagerPin = () => {
    setMgrPinOpen(false);
    pinRetryRef.current = null;
  };
  const onCashTambah = () => {
    if (tendered <= 0) return;
    addSplit(t('suc_m_cash'), Math.min(tendered, remaining), 'cash');
    setCashSel(null);
    setCustomMode(false);
    setCustomAmt('');
  };

  const onCashLanjut = () => {
    const grand = paid + tendered;
    if (grand < payable || payable <= 0) return;
    void goSuccessGated('cash', grand, Math.max(0, grand - payable));
  };

  // ---- Non-tunai actions ----
  const onCardLanjut = () => {
    if (edcCode.length !== 6 || payable <= 0) return;
    const amt = remaining;
    const grand = paid + amt;
    if (grand >= payable) {
      void goSuccessGated(card, grand, Math.max(0, grand - payable), edcCode.length === 6 ? { approvalCode: edcCode } : undefined);
    } else {
      addSplit(CARDS.find((c) => c.id === card)?.name ?? 'Non Tunai', amt, card);
      setEdcCode('');
    }
  };

  // ---- Online actions ----
  const ovoPhoneOk = wallet !== 'ovo' || ovoPhone.replace(/[^0-9]/g, '').length >= 9;
  const onOnlineLanjut = () => {
    if (!wallet || payable <= 0 || !ovoPhoneOk) return;
    if (wallet === 'qris') {
      // client_id diselesaikan dulu (async) agar Qris SELALU menerima kunci
      // rantai — tak ada penerbitan baru di daun (QR tak basi).
      void (async () => {
        try {
        const chainClientId = await resolveChainClientId();
        navigation?.navigate('Qris', {
        total: remaining,
        items: route?.params?.items,
        discount: effDiscount,
        ...(effVoucherCode ? { voucherCode: effVoucherCode } : {}),
        ...(serviceParam > 0 ? { service: serviceParam } : {}),
        ...(taxParam > 0 ? { tax: taxParam } : {}),
        ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
        ...(packagingParam > 0 ? { packaging: packagingParam } : {}),
        ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
        ...(orderMode ? { mode: orderMode } : {}),
        ...(tableNo ? { table: tableNo } : {}),
        ...(ongkir > 0 ? { ongkir } : {}),
        ...(totalOngkirCut > 0 ? { ongkirCut: totalOngkirCut } : {}),
        ...(tipAmount > 0 ? { tip: tipAmount } : {}),
        ...(customerName ? { customer: customerName } : {}),
        ...(fwdMemberId ? { memberId: fwdMemberId } : {}),
        ...(fwdCustomerId != null ? { customerId: fwdCustomerId } : {}),
        ...(memberPoinParam != null ? { memberPoin: memberPoinParam } : {}),
        ...(paramSalesNum ? { salesNum: paramSalesNum } : {}),
        // APP-PRINTER-SALES (Q7): client_id rantai SELALU dibawa ke QRIS.
        clientId: chainClientId,
        // Rantai grup ke QRIS: kunjungan QRIS ikut SATU salesNum + tahu total penuh.
        ...(route?.params?.splitGroup === true ? { splitGroup: true } : {}),
        ...(route?.params?.orderTotal ? { orderTotal: route.params.orderTotal } : {}),
        // Kaki split yang sudah dibayar diteruskan agar QRIS/EDC mencatat
        // SATU bill utuh (bukan hanya sisa): nomor + kaki lama dipakai ulang.
        ...(splits.length > 0 ? { splits: splits.map((s) => ({ method: s.method, amount: s.amount, ...(s.memberId ? { memberId: s.memberId } : {}), ...(s.customerId != null ? { customerId: s.customerId } : {}) })) } : {}),
        });
        } catch {
          // resolveChainClientId melempar hanya bila CSPRNG absen (uuidv7
          // melempar sesuai kontrak): tombol tak boleh mati diam-diam.
          appAlert(t('pay_issue_fail'));
        }
      })();
      return;
    }
    const grand = paid + (remaining);
    void goSuccessGated(wallet, grand, 0);
  };

  // ---- Deposit member actions (live ms_member; nol-baris = empty-state pay_dep_empty) ----
  const memberSource: LiveMember[] = dbMembers ?? [];
  const memberHits = memberSource.filter(
    (m) =>
      memberQ.trim() === '' ||
      m.nama.toLowerCase().includes(memberQ.toLowerCase()) ||
      m.id.toLowerCase().includes(memberQ.toLowerCase()),
  );
  const memberPicked = memberSource.find((m) => m.id === memberSel) ?? null;
  /** Ronde-3 Q3: member tertempel untuk chip minimal (pilihan tab / params). */
  const chipMember = memberPicked ?? memberSource.find((m) => m.id === memberIdParam) ?? null;
  const onDepositLanjut = () => {
    if (!memberPicked || memberPicked.saldo <= 0 || payable <= 0) return;
    const pakai = Math.min(memberPicked.saldo, remaining);
    const grand = paid + pakai;
    // Ronde-3 Q1: kunci ledger lokal → ref GO bila format MC{id}.
    const pickedCustomerId = customerIdFromLocalKey(memberPicked.id);
    if (grand >= payable) {
      void goSuccessGated('deposit', grand, 0, { memberId: memberPicked.id, ...(pickedCustomerId != null ? { customerId: pickedCustomerId } : {}) });
    } else {
      addSplit(`Deposit ${memberPicked.nama}`, pakai, 'deposit', memberPicked.id, pickedCustomerId ?? undefined);
      setMemberSel(null);
    }
  };

  // ---- Pluxee / Ultra / lainnya ----
  const tenderNum = Number(tenderAmt.replace(/[^0-9]/g, '')) || 0;
  const tenderReady = tenderCode.trim().length >= 3 && tenderNum > 0 && !tenderBusy;
  /**
   * Validasi kode tender ke server sebelum diterima (PAY-09): kode asal
   * tidak bisa dipakai. Berhasil = approvalCode = kode tervalidasi.
   */
  const checkTender = async (): Promise<boolean> => {
    const code = tenderCode.trim().toUpperCase();
    if (code.length < 3 || tenderNum <= 0) return false;
    setTenderBusy(true);
    setTenderMsg(t('pay_tender_checking'));
    try {
      const v = await validateVoucherCode(code, payable);
      if (!v.ok || (v.minSpend > 0 && payable < v.minSpend)) {
        setTenderMsg(t('pay_tender_invalid').replace('{m}', rp(v.minSpend)));
        return false;
      }
      setTenderMsg('');
      return true;
    } catch {
      setTenderMsg(t('pay_tender_invalid').replace('{m}', rp(0)));
      return false;
    } finally {
      setTenderBusy(false);
    }
  };
  const onTenderTambah = async () => {
    if (!tenderReady) return;
    if (!(await checkTender())) return;
    addSplit(`${tenderKind} ${tenderCode.trim().toUpperCase()}`, Math.min(tenderNum, remaining), tenderKind.toLowerCase());
    setTenderCode('');
    setTenderAmt('');
  };
  const onTenderLunas = async () => {
    if (!tenderReady || payable <= 0) return;
    if (!(await checkTender())) return;
    const grand = paid + Math.min(tenderNum, remaining);
    if (grand >= payable) void goSuccessGated(tenderKind.toLowerCase(), grand, 0, { approvalCode: tenderCode.trim().toUpperCase() });
    else {
      addSplit(`${tenderKind} ${tenderCode.trim().toUpperCase()}`, Math.min(tenderNum, remaining), tenderKind.toLowerCase());
      setTenderCode('');
      setTenderAmt('');
    }
  };

  const cashTambahReady = tendered > 0;
  const cashLanjutReady = payable > 0 && !syncBlocked && paid + tendered >= payable && (paid > 0 || tendered > 0);
  const cashChange = Math.max(0, paid + tendered - payable);
  const cashPayLabel =
    tendered > 0 && cashLanjutReady
      ? `${t('pay_cash_pay').replace('{t}', rp(tendered))} ›`
      : tendered > 0
        ? t('pay_cash_short').replace('{k}', rp(Math.max(0, payable - paid - tendered)))
        : t('pay_cash_go').replace('{t}', rp(payable));

  const sideText = (id: Tab): { title: string; sub: string } => {
    switch (id) {
      case 'tunai': return { title: t('pay_side_cash'), sub: t('pay_side_cash_sub') };
      case 'nontunai': return { title: t('pay_side_card'), sub: t('pay_side_card_sub') };
      case 'online': return { title: t('pay_side_online'), sub: t('pay_side_online_sub') };
      case 'member': return { title: t('pay_side_dep'), sub: t('pay_side_dep_sub') };
      default: return { title: t('pay_side_tender'), sub: t('pay_side_tender_sub') };
    }
  };

  const renderHeader = () => (
    <ScreenHeader
      title={t('pay_title')}
      sub={isTablet ? todayStr : undefined}
      onBack={() => navigation?.goBack()}
      right={
        <View style={styles.onlineBadge}>
          <View style={[styles.onlineDot, connDot]} />
          <Text style={styles.onlineText}>{connLabel}</Text>
        </View>
      }
    />
  );

  /**
   * Rincian tagihan terlihat: Total order (neto, sudah termasuk orderVoucher +
   * orderDiscount), potongan voucher Pay yang dipasang di layar ini (belanja
   * dan potongan ongkir dipisah — ongkirCut bukan diskon), dan Harus dibayar
   * (= Sisa saat belum ada split). Sebelumnya voucher box tak muncul di
   * penjumlahan mana pun sehingga terasa "tidak masuk hitungan".
   */
  const renderSummary = () => {
    if (orderDiscount <= 0 && !boxVoucher && totalOngkirCut <= 0 && tipAmount <= 0) return null;
    return (
      <View style={styles.sumBox}>
        <View style={styles.sumRow}>
          <Text style={styles.sumLabel}>{t('c_total')}</Text>
          <Text style={styles.sumValue}>{rp(total)}</Text>
        </View>
        {orderDiscount > 0 && (
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>{t('pay_sum_incl')}</Text>
            <Text style={styles.sumValue}>−{rp(orderDiscount)}</Text>
          </View>
        )}
        {boxBelanjaAmt > 0 && (
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>{`${t('ok_voucher')} ${boxVoucher?.code ?? ''}`}</Text>
            <Text style={[styles.sumValue, styles.sumCut]}>−{rp(boxBelanjaAmt)}</Text>
          </View>
        )}
        {totalOngkirCut > 0 && (
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>{`${t('rc_ongkir_cut')}${boxOngkirCut > 0 && boxVoucher ? ` (${boxVoucher.code})` : ''}`}</Text>
            <Text style={[styles.sumValue, styles.sumCut]}>−{rp(totalOngkirCut)}</Text>
          </View>
        )}
        {tipAmount > 0 && (
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>{t('pay_tip_row')}</Text>
            <Text style={styles.sumValue}>+{rp(tipAmount)}</Text>
          </View>
        )}
        <View style={[styles.sumRow, styles.sumDueRow]}>
          <Text style={[styles.sumLabel, styles.sumDue]}>{t('pay_sum_due')}</Text>
          <Text style={[styles.sumValue, styles.sumDue]}>{rp(payable)}</Text>
        </View>
      </View>
    );
  };

  const renderBanner = () => (
    <View style={isTablet ? styles.bannerRowTablet : styles.bannerRow}>
      {isTablet && (
        boxVoucher ? (
          <TouchableOpacity
            style={[styles.voucherBarTablet, styles.voucherBarTabletActive]}
            onPress={removeBoxVoucher}>
            <Text style={[styles.voucherBarTabletText, styles.voucherBarTabletTextActive]}>
              {`◈  ${t('pay_voucher_on').replace('{d}', rp(boxVoucher.amount))}  ✕`}
            </Text>
          </TouchableOpacity>
        ) : orderVoucher ? (
          <View style={styles.voucherBarTablet}>
            <Text style={styles.voucherBarTabletText}>{`◈  ${orderBannerText}`}</Text>
          </View>
        ) : !isSplitGroup && posPromoOn ? (
          <TouchableOpacity
            style={styles.voucherBarTablet}
            onPress={() => setVoucherOpen((v) => !v)}>
            <Text style={styles.voucherBarTabletText}>{`◈  ${t('pay_voucher_add')}`}</Text>
          </TouchableOpacity>
        ) : null
      )}
      <View style={isTablet ? styles.bannerTablet : styles.banner}>
        <View style={styles.bannerCol}>
          <Text style={styles.bannerLabel}>{t('c_total')}</Text>
          <Text style={styles.bannerValue}>{rp(total)}</Text>
        </View>
        <View style={styles.bannerDivider} />
        {ongkir > 0 && (
          <>
            <View style={styles.bannerCol}>
              <Text style={styles.bannerLabel}>{t('ongkir')}</Text>
              <Text style={styles.bannerValue}>{rp(ongkir)}</Text>
            </View>
            <View style={styles.bannerDivider} />
          </>
        )}
        <View style={styles.bannerCol}>
          <Text style={styles.bannerLabel}>{t('pay_remaining')}</Text>
          <Text style={[styles.bannerValue, styles.bannerRemaining]}>{rp(remaining)}</Text>
        </View>
      </View>
      {groupPaidInfo && (
        <View style={styles.voucherBar}>
          <Text style={styles.voucherBarText}>{`◈  ${t('pay_group_collected').replace('{p}', rp(groupPaidInfo.paid)).replace('{g}', rp(groupPaidInfo.grand))}`}</Text>
        </View>
      )}
      {isTablet ? null : (
        boxVoucher ? (
          <TouchableOpacity
            style={[styles.voucherBar, styles.voucherBarActive]}
            onPress={removeBoxVoucher}>
            <Text style={[styles.voucherBarText, styles.voucherBarTextActive]}>
              {`◈  ${t('pay_voucher_on').replace('{d}', rp(boxVoucher.amount))}  ✕`}
            </Text>
          </TouchableOpacity>
        ) : orderVoucher ? (
          <View style={styles.voucherBar}>
            <Text style={styles.voucherBarText}>{`◈  ${orderBannerText}`}</Text>
          </View>
        ) : !isSplitGroup && posPromoOn ? (
          <TouchableOpacity
            style={styles.voucherBar}
            onPress={() => setVoucherOpen((v) => !v)}>
            <Text style={styles.voucherBarText}>{`◈  ${t('pay_voucher_add')}`}</Text>
          </TouchableOpacity>
        ) : null
      )}
      {renderSummary()}
      {voucherOpen && posPromoOn && !boxVoucher && !orderVoucher && !isSplitGroup && (
        <View style={styles.voucherRow}>
          <View style={styles.voucherField}>
            <AppInput
              placeholder={t('pay_voucher_ph')}
              value={boxCode}
              onChangeText={setBoxCode}
              autoCapitalize="characters"
            />
          </View>
          <AppButton title={voucherBusy ? '…' : t('pay_voucher_use')} disabled={voucherBusy} onPress={() => void applyVoucher()} fullWidth={false} size="sm" style={styles.voucherAction} />
          <AppButton
            title={`${t('pay_voucher_pick')} ›`}
            onPress={() => {
              setVoucherOpen(false);
              navigation?.navigate('Voucher');
            }}
            fullWidth={false}
            size="sm"
            style={styles.voucherAction}
          />
        </View>
      )}
      {voucherMsg ? <Text style={styles.ctaHint}>{voucherMsg}</Text> : null}
      {!isSplitGroup && tipEnabled && (
        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>{t('pay_tip_title')}</Text>
          <Text style={styles.tipSub}>{t('pay_tip_sub')}</Text>
          <View style={styles.tipRow}>
            <TouchableOpacity
              style={[styles.tipChip, tipMode === 'none' && styles.tipChipActive]}
              onPress={() => applyTip('none')}>
              <Text style={[styles.tipChipText, tipMode === 'none' && styles.tipChipTextActive]}>{t('pay_tip_none')}</Text>
            </TouchableOpacity>
            {(['p5', 'p10', 'p15'] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.tipChip, tipMode === m && styles.tipChipActive]}
                onPress={() => applyTip(m)}>
                <Text style={[styles.tipChipText, tipMode === m && styles.tipChipTextActive]}>{m === 'p5' ? '5%' : m === 'p10' ? '10%' : '15%'}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.tipChip, tipMode === 'custom' && styles.tipChipActive]}
              onPress={() => applyTip('custom', tipCustom)}>
              <Text style={[styles.tipChipText, tipMode === 'custom' && styles.tipChipTextActive]}>{t('pay_tip_custom')}</Text>
            </TouchableOpacity>
          </View>
          {tipMode === 'custom' && (
            <AppInput
              value={tipCustom}
              onChangeText={(v) => applyTip('custom', v)}
              keyboardType="numeric"
              placeholder={rp(0)}
            />
          )}
          {tipAmount > 0 && (
            <Text style={styles.tipAdded}>{t('pay_tip_added').replace('{d}', rp(tipAmount))}</Text>
          )}
        </View>
      )}
    </View>
  );

  const renderTabs = () => {
    if (isTablet) return null;
    const allTabs: { id: Tab; label: string }[] = [
      { id: 'tunai', label: t('pay_tab_cash') },
      { id: 'nontunai', label: t('pay_tab_card') },
      { id: 'online', label: t('pay_tab_online') },
      { id: 'member', label: t('pay_tab_deposit') },
      { id: 'lainnya', label: t('pay_tab_tender') },
    ];
    const tabs = allTabs.filter((x) => visibleTabs.includes(x.id));
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        persistentScrollbar
        contentContainerStyle={styles.tabsContent}
        style={styles.tabsScroll}>
        <View style={styles.tabs}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.tab, tab === t.id && styles.tabActive]}
              onPress={() => setTab(t.id)}>
              <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  };

  const renderSplits = () => {
    if (splits.length === 0) return null;
    return (
      <View style={styles.splitBox}>
        {splits.map((s) => (
          <View key={s.id} style={styles.splitRow}>
            <Text style={styles.splitLabel}>{s.label}</Text>
            <Text style={styles.splitValue}>{rp(s.amount)}</Text>
            <TouchableOpacity onPress={() => removeSplit(s.id)}>
              <Text style={styles.splitRemove}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    );
  };

  const renderTunai = () => (
    <View>
      <Text style={styles.panelTitle}>{t('pay_cash_title')}</Text>

      <View style={styles.grid}>
        <TouchableOpacity
          style={[styles.gridCard, isTablet && styles.gridCardTablet, !customMode && cashSel === remaining && styles.gridCardActive]}
          onPress={() => {
            setCustomMode(false);
            setCashSel(remaining);
          }}>
          <Text style={[styles.gridText, isTablet && styles.gridTextTablet]}>{t('pay_exact')}</Text>
          <Text style={styles.gridSub}>{rp(remaining)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.gridCard, isTablet && styles.gridCardTablet, customMode && styles.gridCardActive]}
          onPress={() => {
            setCustomMode(true);
            setCashSel(null);
          }}>
          <Text style={[styles.gridText, isTablet && styles.gridTextTablet]}>{t('pay_other')} ›</Text>
        </TouchableOpacity>
        {nominals.map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.gridCard, isTablet && styles.gridCardTablet, !customMode && cashSel === v && styles.gridCardActive]}
            onPress={() => {
              setCustomMode(false);
              setCashSel(v);
            }}>
            <Text style={[styles.gridText, isTablet && styles.gridTextTablet]}>{rp(v)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {customMode && (
        <View style={styles.customRow}>
          <AppInput
            label={t('pay_other_label')}
            keyboardType="numeric"
            placeholder="0"
            value={customAmt}
            onChangeText={setCustomAmt}
          />
        </View>
      )}

      {tendered > 0 && (
        <View style={styles.changeBox}>
          <Text style={styles.changeText}>
            {cashLanjutReady
              ? t('pay_change_is').replace('{c}', rp(cashChange)).replace('{t}', rp(tendered))
              : t('pay_short_is').replace('{k}', rp(Math.max(0, payable - paid - tendered))).replace('{t}', rp(tendered))}
          </Text>
        </View>
      )}
      {tendered > remaining && remaining > 0 && (
        <Text style={styles.clampNote}>{t('pay_clamped').replace('{s}', rp(remaining))}</Text>
      )}
      {!cashLanjutReady && tendered === 0 && (
        <Text style={styles.ctaHint}>{t('pay_pick_nominal')}</Text>
      )}
      {renderSplits()}

      <View style={styles.footer}>
        <AppButton title={cashPayLabel} disabled={!cashLanjutReady} onPress={onCashLanjut} fullWidth={false} size="md" style={styles.footerBtn} />
        <AppButton title={t('pay_add')} variant="secondary" disabled={!cashTambahReady} onPress={onCashTambah} fullWidth={false} size="md" style={styles.footerBtn} />
      </View>
    </View>
  );

  const cardName = CARDS.find((c) => c.id === card)?.name ?? 'Non Tunai';

  const renderNonTunai = () => (
    <View>
      <Text style={styles.panelTitle}>{t('pay_card_title')}</Text>
      <View style={styles.pills} accessibilityRole="radiogroup">
        {CARDS.map((c) => {
          const active = card === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => setCard(c.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}>
              <View style={[styles.check, active && styles.checkActive]}>
                {active && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.edcInfo}>
        <Text style={styles.edcInfoTitle}>{cardName} - {rp(remaining)}</Text>
        <Text style={styles.edcInfoSub}>
          {t('pay_card_info')}
        </Text>
      </View>

      <Text style={styles.fieldLabel}>{t('pay_locked').replace('{t}', rp(remaining))}</Text>
      <View style={styles.lockedAmount}>
        <Text style={styles.lockedAmountText}>{rp(remaining)}</Text>
        <Text style={styles.lockedBadge}>{t('pay_locked_badge')}</Text>
      </View>

      <AppInput
        label={t('pay_approval')}
        keyboardType="numeric"
        placeholder={t('pay_approval_ph')}
        value={edcCode}
        onChangeText={(v) => setEdcCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
        maxLength={6}
      />
      {/* D7: tombol Ubah ala ref tablet - reset kode EDC untuk input ulang. */}
      {edcCode.length > 0 && (
        <AppButton title={t('editAction')} variant="secondary" onPress={() => setEdcCode('')} fullWidth={false} size="sm" style={styles.footerBtn} />
      )}

      {renderSplits()}

      <View style={styles.footer}>
        <AppButton title={`${t('pay_cash_pay').replace('{t}', rp(remaining))} ›`} disabled={edcCode.length !== 6 || syncBlocked} onPress={onCardLanjut} fullWidth={false} size="md" style={styles.footerBtn} />
      </View>
      {edcCode.length !== 6 && (
        <Text style={styles.ctaHint}>{t('pay_need_approval')}</Text>
      )}
      <TouchableOpacity
        style={styles.edcLink}
        onPress={() => void (async () => {
          // G5: block7 = jalur EDC dikunci (Alert + tetap di Pay, bukan tautan mati).
          if (syncBlocked) {
            appAlert(t('sync.blocked'), t('sync.blockedMsg'));
            return;
          }
          try {
          // client_id rantai SELALU dibawa ke EDC (tak diterbitkan di daun).
          const chainClientId = await resolveChainClientId();
          navigation?.navigate('Edc', {
          total: remaining,
          items: route?.params?.items,
          discount: effDiscount,
          ...(effVoucherCode ? { voucherCode: effVoucherCode } : {}),
          ...(serviceParam > 0 ? { service: serviceParam } : {}),
          ...(taxParam > 0 ? { tax: taxParam } : {}),
          ...(feeESBParam > 0 ? { feeESB: feeESBParam } : {}),
          ...(packagingParam > 0 ? { packaging: packagingParam } : {}),
          ...(roundingParam !== 0 ? { rounding: roundingParam } : {}),
          ...(orderMode ? { mode: orderMode } : {}),
          ...(tableNo ? { table: tableNo } : {}),
          ...(ongkir > 0 ? { ongkir } : {}),
          ...(totalOngkirCut > 0 ? { ongkirCut: totalOngkirCut } : {}),
          ...(tipAmount > 0 ? { tip: tipAmount } : {}),
          ...(customerName ? { customer: customerName } : {}),
          ...(fwdMemberId ? { memberId: fwdMemberId } : {}),
          ...(fwdCustomerId != null ? { customerId: fwdCustomerId } : {}),
          ...(memberPoinParam != null ? { memberPoin: memberPoinParam } : {}),
          ...(paramSalesNum ? { salesNum: paramSalesNum } : {}),
          // APP-PRINTER-SALES (Q7): client_id rantai SELALU dibawa ke EDC.
          clientId: chainClientId,
          // Rantai grup ke EDC (cermin QRIS): kunjungan EDC ikut SATU salesNum
          // + tahu total penuh; tanpa ini kunjungan ke-2+ menabrak PRIMARY KEY
          // head lalu gagal diam-diam (Success palsu, setoran tak tercatat).
          ...(route?.params?.splitGroup === true ? { splitGroup: true } : {}),
          ...(route?.params?.orderTotal ? { orderTotal: route.params.orderTotal } : {}),
          ...(splits.length > 0 ? { splits: splits.map((s) => ({ method: s.method, amount: s.amount, ...(s.memberId ? { memberId: s.memberId } : {}), ...(s.customerId != null ? { customerId: s.customerId } : {}) })) } : {}),
          });
          } catch {
            appAlert(t('pay_issue_fail'));
          }
        })}>
        <Text style={styles.edcLinkText}>{t('pay_edc_guide')} ›</Text>
      </TouchableOpacity>
    </View>
  );

  const renderOnline = () => (
    <View>
      <Text style={styles.panelTitle}>{t('pay_online_title')}</Text>
      <View style={styles.grid}>
        {WALLETS.map((w) => {
          const active = wallet === w.id;
          return (
            <TouchableOpacity
              key={w.id}
              style={[styles.walletCard, isTablet && styles.walletCardTablet, active && styles.walletCardActive]}
              onPress={() => setWallet(w.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}>
              {active && <View style={styles.walletCheck}><Text style={styles.walletCheckMark}>✓</Text></View>}
              {w.img ? (
                <Image source={w.img} style={styles.walletImg} resizeMode="contain" />
              ) : (
                <Text style={[styles.walletText, styles.brandQris]}>{w.name}</Text>
              )}
              <Text style={styles.walletName}>{w.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {!wallet && (
        <Text style={styles.ctaHint}>{t('pay_pick_wallet')}</Text>
      )}

      {wallet === 'ovo' && (
        <View style={styles.customRow}>
          <AppInput
            label={t('pay_ovo_label')}
            keyboardType="phone-pad"
            placeholder={t('pay_ovo_ph')}
            value={ovoPhone}
            onChangeText={(v) => setOvoPhone(v.replace(/[^0-9]/g, '').slice(0, 14))}
          />
          <Text style={styles.ctaHint}>{t('pay_ovo_hint')}</Text>
        </View>
      )}

      {renderSplits()}

      <View style={styles.footerSingle}>
        <AppButton
          title={wallet ? `${t('pay_via').replace('{t}', rp(remaining)).replace('{w}', WALLET_LABEL[wallet] ?? wallet)} ›` : t('pay_pick_method').replace('{t}', rp(remaining))}
          disabled={!wallet || !ovoPhoneOk || syncBlocked}
          onPress={onOnlineLanjut}
          size="md"
        />
      </View>
    </View>
  );

  const renderMember = () => (
    <View>
      <Text style={styles.panelTitle}>{t('pay_dep_title')}</Text>
      {/* Ronde-3 Q3: tampilan minimal member tertempel (nama samar + poin
          bila diketahui); JANGAN kontak penuh/riwayat. Poin pra-settle dari
          Member terapkan (memberPoin params); tanpa itu hanya nama samar. */}
      {chipMember ? (
        <Text style={styles.ctaHint}>
          {maskMemberName(chipMember.nama)}
          {memberPoinParam != null ? ` · ${t('mem_go_points')}: ${memberPoinParam}` : ''}
        </Text>
      ) : null}
      <AppInput
        placeholder={t('pay_dep_search')}
        value={memberQ}
        onChangeText={setMemberQ}
      />
      <View style={styles.memberList}>
        {memberHits.map((m) => {
          const active = memberSel === m.id;
          return (
            <TouchableOpacity
              key={m.id}
              style={[styles.memberCard, active && styles.memberCardActive]}
              onPress={() => setMemberSel(active ? null : m.id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{m.nama}</Text>
                <Text style={styles.memberMeta}>{m.id}</Text>
              </View>
              <Text style={[styles.memberSaldo, m.saldo <= 0 && styles.memberSaldoEmpty]}>
                {rp(m.saldo)}
              </Text>
            </TouchableOpacity>
          );
        })}
        {memberHits.length === 0 && (
          <Text style={styles.ctaHint}>{t('pay_dep_empty')}</Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.memberLink}
        onPress={() => navigation?.navigate('Member', {
          from: 'Pay',
          ...(memberIdParam ? { memberId: memberIdParam } : {}),
          ...(customerIdParam != null ? { customerId: customerIdParam } : {}),
          total,
          ...(route?.params?.items ? { items: route.params.items } : {}),
          ...(orderMode ? { mode: orderMode } : {}),
          ...(tableNo ? { table: tableNo } : {}),
          ...(ongkir ? { ongkir } : {}),
          ...(customerName ? { customer: customerName } : {}),
          ...(route?.params?.voucher != null ? { voucher: route.params.voucher } : {}),
          ...(route?.params?.voucherCode ? { voucherCode: route.params.voucherCode } : {}),
          ...(route?.params?.discount != null ? { discount: route.params.discount } : {}),
          ...(tipAmount > 0 ? { tip: tipAmount } : {}),
          service: serviceParam,
          tax: taxParam,
          rounding: roundingParam,
          feeESB: feeESBParam,
          packaging: packagingParam,
        })}>
        <Text style={styles.edcLinkText}>{t('pay_dep_find')} ›</Text>
      </TouchableOpacity>
      {renderSplits()}
      <View style={styles.footerSingle}>
        <AppButton
          title={memberPicked
            ? `${t('pay_dep_use').replace('{t}', rp(Math.min(memberPicked.saldo, remaining))).replace('{n}', memberPicked.nama)} ›`
            : t('pay_dep_pick').replace('{t}', rp(remaining))}
          disabled={!memberPicked || memberPicked.saldo <= 0 || syncBlocked}
          onPress={onDepositLanjut}
          size="md"
        />
      </View>
      {memberPicked && memberPicked.saldo < remaining && (
        <Text style={styles.ctaHint}>{t('pay_dep_short')}</Text>
      )}
    </View>
  );

  const renderLainnya = () => (
    <View>
      <Text style={styles.panelTitle}>{t('pay_tender_title')}</Text>
      <View style={styles.pills}>
        {(['Pluxee', 'Ultra', 'Lainnya'] as const).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.pill, tenderKind === k && styles.pillActive]}
            onPress={() => setTenderKind(k)}>
            <Text style={[styles.pillText, tenderKind === k && styles.pillTextActive]}>{k === 'Lainnya' ? t('suc_m_lainnya') : k}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <AppInput
        label={`${t('pay_tender_code').replace('{k}', tenderKind)} *`}
        placeholder={t('pay_tender_code_ph')}
        value={tenderCode}
        onChangeText={(v) => setTenderCode(v.toUpperCase())}
        autoCapitalize="characters"
      />
      <AppInput
        label={t('pay_tender_amt')}
        keyboardType="numeric"
        placeholder="0"
        value={tenderAmt}
        onChangeText={setTenderAmt}
      />
      {renderSplits()}
      {tenderMsg ? <Text style={styles.ctaHint}>{tenderMsg}</Text> : null}
      <View style={styles.footer}>
        <AppButton title={tenderBusy ? t('pay_tender_checking') : `${t('pay_cash_pay').replace('{t}', rp(Math.min(tenderNum, remaining)))} ›`} disabled={!tenderReady || syncBlocked} onPress={() => void onTenderLunas()} fullWidth={false} size="md" style={styles.footerBtn} />
        <AppButton title={t('pay_add')} variant="secondary" disabled={!tenderReady || syncBlocked} onPress={() => void onTenderTambah()} fullWidth={false} size="md" style={styles.footerBtn} />
      </View>
      <Text style={styles.ctaHint}>{t('pay_tender_burn')}</Text>
      {tenderNum > remaining && remaining > 0 && (
        <Text style={styles.clampNote}>{t('pay_clamped').replace('{s}', rp(remaining))}</Text>
      )}
    </View>
  );

  // SESI-FINAL-APP: kartu bukti bayar (hanya bila merchant mewajibkan).
  // Tanpa dep baru: foto via ImagePicker + preparePhoto yang sudah ada;
  // pratinjau via Image bawaan RN; upload terjadi di gate (upload-dulu).
  const renderProof = () => {
    if (!requireProof) return null;
    return (
      <View style={styles.proofCard}>
        <Text style={styles.panelTitle}>{t('pay_proof_title')}</Text>
        {proofUri ? (
          <Image source={{ uri: proofUri }} style={styles.proofImg} />
        ) : (
          <Text style={styles.ctaHint}>{t('pay_proof_required')}</Text>
        )}
        {proofUrl ? <Text style={styles.proofOk}>{`✓ ${t('pay_proof_uploaded')}`}</Text> : null}
        {proofBusy ? <Text style={styles.ctaHint}>{t('pay_proof_uploading')}</Text> : null}
        <AppButton
          title={proofUri ? t('pay_proof_retake') : t('pay_proof_take')}
          variant="secondary"
          size="sm"
          fullWidth={false}
          disabled={proofBusy}
          onPress={() => void takeProof()}
        />
      </View>
    );
  };

  const renderBody = () => {    if (!isTablet) {
      return (
        <>
          {renderTabs()}
          {tab === 'tunai' && renderTunai()}
          {tab === 'nontunai' && renderNonTunai()}
          {tab === 'online' && renderOnline()}
          {tab === 'member' && renderMember()}
          {tab === 'lainnya' && renderLainnya()}
        </>
      );
    }
    return (
      <View style={styles.tabletSplit}>
        <View style={styles.sidebar}>
          {visibleTabs.map((id) => {
            const active = tab === id;
            const s = sideText(id);
            return (
              <TouchableOpacity
                key={id}
                style={[styles.sideBtn, active && styles.sideBtnActive]}
                onPress={() => setTab(id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}>
                <Text style={[styles.sideTitle, active && styles.sideTitleActive]}>{s.title}</Text>
                <Text style={[styles.sideSub, active && styles.sideSubActive]}>{s.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.tabletContent}>
          {tab === 'tunai' && renderTunai()}
          {tab === 'nontunai' && renderNonTunai()}
          {tab === 'online' && renderOnline()}
          {tab === 'member' && renderMember()}
          {tab === 'lainnya' && renderLainnya()}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {renderHeader()}
      {/* P1-1b: PIN manajer transport-only — hanya bila gerbang payment aktif. */}
      <ManagerPinPrompt
        visible={mgrPinOpen}
        onSubmit={submitManagerPin}
        onCancel={cancelManagerPin}
      />
      {hasTotal ? (
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
        {renderBanner()}
        {syncBlocked && (
          <View style={styles.syncWarn}>
            <Text style={styles.syncWarnT}>{t('sync.blocked')}</Text>
            <Text style={styles.syncWarnSub}>{t('sync.blockedMsg')}</Text>
            <AppButton title={`${t('sync.openSync')} ›`} onPress={() => navigation?.navigate('Sync')} size="sm" fullWidth={false} style={styles.syncWarnBtn} />
          </View>
        )}
        {renderBody()}
        {renderProof()}
        {/* G5: block7 = ExtraPay disembunyikan; banner blokir di atas memberi jalan Sync. */}
        {syncBlocked ? null : (
        <ExtraPaySection online={online} onDone={(label, ref, approver) => {
          const method = extraLabelToMethod(label);
          if (method === 'deposit') {
            // Deposit wajib lewat alur member (cek saldo + memberId): lunas
            // langsung tanpa member membuat gate withdraw saveSale tak jalan
            // (saldo tak berkurang, deposit bisa dipakai ulang). Tanpa member
            // terpilih / saldo kosong → arahkan ke tab member.
            if (!memberPicked || memberPicked.saldo <= 0) {
              setTab('member');
              return;
            }
            onDepositLanjut();
            return;
          }
          const detail: { approvalCode?: string; approvedBy?: string } = {};
          if (ref) detail.approvalCode = ref;
          if (approver) detail.approvedBy = approver;
          void goSuccessGated(method, payable, 0, Object.keys(detail).length > 0 ? detail : undefined);
        }} />)}
      </ScrollView>
      ) : (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>{t('pay_empty_total')}</Text>
        <Text style={styles.emptySub}>{t('pay_empty_total_sub')}</Text>
        <AppButton title={`‹ ${t('c_back')}`} onPress={() => navigation?.goBack()} size="md" fullWidth={false} style={styles.emptyBtn} />
      </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white, marginRight: 5 },
  onlineDotAmber: { backgroundColor: colors.amber, marginRight: 5 },
  onlineDotGrey: { backgroundColor: colors.stroke, marginRight: 5 },
  onlineText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 12 },
  body: { padding: 12, paddingBottom: 24 },
  /** Empty-state jujur bila Pay dibuka tanpa total dari kasir. */
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, textAlign: 'center' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 8 },
  emptyBtn: { marginTop: 16 },
  /** Kartu blokir sync >7 hari (G5): pembayaran dikunci sampai sync. */
  syncWarn: { backgroundColor: colors.paleAmber, borderRadius: 10, padding: 12, marginTop: 10 },
  syncWarnT: { fontFamily: fonts.bold, fontSize: 13, color: colors.amberDark },
  syncWarnSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.amberDark, marginTop: 4 },
  syncWarnBtn: { marginTop: 10, alignSelf: 'flex-start' },
  bannerRow: { gap: 0 },
  bannerRowTablet: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  voucherBarTablet: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    flexShrink: 0,
  },
  voucherBarTabletActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  voucherBarTabletText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy },
  voucherBarTabletTextActive: { color: colors.white },
  bannerTablet: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.green,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 10,
  },
  banner: {
    flexDirection: 'row',
    backgroundColor: colors.green,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 10,
  },
  bannerCol: { flex: 1, alignItems: 'flex-start', paddingHorizontal: 8 },
  bannerDivider: { width: 1, backgroundColor: colors.white, opacity: 0.8 },
  bannerLabel: { color: colors.white, fontFamily: fonts.regular, fontSize: 11 },
  bannerValue: { color: colors.white, fontFamily: fonts.bold, fontSize: 20, marginTop: 2 },
  bannerRemaining: { color: colors.paleAmber },
  voucherBar: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  voucherBarActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  voucherBarText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.navy },
  voucherBarTextActive: { color: colors.white },
  voucherRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  tipTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  tipSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  tipRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  tipChip: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.card },
  tipChipActive: { backgroundColor: colors.greenDark, borderColor: colors.greenDark },
  tipChipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  tipChipTextActive: { color: colors.white },
  tipInput: { flex: 1, minWidth: 120 },
  tipAdded: { fontFamily: fonts.semibold, fontSize: 12, color: colors.greenDark, marginTop: 6 },
  tipBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },
  // SESI-FINAL-APP: kartu bukti bayar (merchant requirePaymentProof).
  proofCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },
  proofImg: { width: '100%', height: 180, borderRadius: 8, marginTop: 8, backgroundColor: colors.line },
  proofOk: { fontFamily: fonts.semibold, fontSize: 12, color: colors.greenDark, marginTop: 6 },  sumBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  sumLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  sumValue: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  sumCut: { color: colors.orangeDark },
  sumDueRow: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 4, paddingTop: 7 },
  sumDue: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  voucherField: { flex: 1 },
  voucherAction: { marginTop: 0 },
  footerBtn: { flex: 1, marginTop: 0 },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
  },
  voucherBtn: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  voucherBtnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.white },
  tabsScroll: { marginTop: 12 },
  tabsContent: { paddingRight: 16, flexGrow: 0 },
  tabs: { flexDirection: 'row', gap: 8, paddingRight: 12 },
  tab: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tabActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  tabText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.muted, textAlign: 'center' },
  tabTextActive: { color: colors.white },
  panelTitle: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, marginTop: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  gridCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  gridCardActive: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  gridText: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  // Tablet: teks sedikit besar + kartu nominal 3 kolom proporsional.
  gridTextTablet: { fontSize: 15 },
  gridCardTablet: { width: '31%', flexGrow: 0, paddingVertical: 16 },
  gridSub: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy, marginTop: 2 },
  customRow: { marginTop: 10 },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginBottom: 5 },
  clampNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.amberDark, marginTop: 6, textAlign: 'center' },
  changeBox: {
    backgroundColor: colors.paleGreen,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    alignItems: 'center',
  },
  changeText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.greenDark },
  ctaHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 8, textAlign: 'center' },
  edcInfo: { backgroundColor: colors.paleBlue, borderWidth: 1, borderColor: colors.blue, borderRadius: 8, padding: 12, marginTop: 12 },
  edcInfoTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  edcInfoSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  lockedAmount: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 10 },
  lockedAmountText: { fontFamily: fonts.bold, fontSize: 18, color: colors.navy },
  lockedBadge: { fontFamily: fonts.semibold, fontSize: 11, color: colors.greenDark, backgroundColor: colors.paleGreen, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  splitBox: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  splitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  splitLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  splitValue: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  splitRemove: { fontFamily: fonts.bold, fontSize: 13, color: colors.red, paddingHorizontal: 4 },
  footer: { flexDirection: 'row', gap: 8, marginTop: 14 },
  footerSingle: { marginTop: 14 },
  lanjutBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  lanjutBtnFull: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 13,
  },
  lanjutBtnPrimary: { backgroundColor: colors.navy, borderColor: colors.navy },
  lanjutTextPrimary: { fontFamily: fonts.semibold, fontSize: 14, color: colors.white },
  tambahBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  tambahBtnDisabled: { opacity: 0.45 },
  tambahText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.navy },
  edcLink: { marginTop: 10, alignItems: 'center', paddingVertical: 6 },
  edcLinkText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  btnDisabled: { opacity: 0.45 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 8,
  },
  pillActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  check: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  checkActive: { borderColor: colors.white, backgroundColor: colors.orangeDark },
  checkMark: { color: colors.white, fontSize: 10, fontFamily: fonts.bold, lineHeight: 12 },
  pillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted },
  pillTextActive: { color: colors.white },
  walletCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  walletCardActive: { borderColor: colors.orange, backgroundColor: colors.paleOrange, borderWidth: 2 },
  // Tablet: kartu dompet 3 kolom proporsional (selaras grid nominal).
  walletCardTablet: { width: '31%', flexGrow: 0, paddingVertical: 16 },
  walletCheck: {
    position: 'absolute', top: 6, right: 6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center',
  },
  walletCheckMark: { color: colors.white, fontSize: 11, fontFamily: fonts.bold },
  walletImg: { width: 72, height: 30 },
  walletName: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 6 },
  walletText: { fontFamily: fonts.bold, fontSize: 20 },
  brandQris: { color: colors.text },
  memberList: { marginTop: 10, gap: 8 },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
  },
  memberCardActive: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  memberName: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  memberMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  memberSaldo: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy },
  memberSaldoEmpty: { color: colors.faint },
  memberLink: { marginTop: 6, alignItems: 'center', paddingVertical: 6 },
  tabletSplit: { flexDirection: 'row', gap: 12, marginTop: 12, alignItems: 'flex-start' },
  sidebar: { width: 220, backgroundColor: colors.navy, borderRadius: 12, padding: 10, gap: 10 },
  sideBtn: {
    backgroundColor: colors.navyDark,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  sideBtnActive: { backgroundColor: colors.orange },
  sideTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.white, textAlign: 'center' },
  sideTitleActive: { color: colors.white },
  sideSub: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.navyTint,
    textAlign: 'center',
    marginTop: 4,
  },
  sideSubActive: { color: colors.white },
  tabletContent: { flex: 1, minWidth: 0 },
});
