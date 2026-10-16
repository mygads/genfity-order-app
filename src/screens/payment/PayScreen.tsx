import React, { useMemo, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, rp } from '../../theme';
import ExtraPaySection from './ExtraPaySection';
import { recordSale, type SaleItemIn } from '../../lib/payments';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type Props = {
  navigation?: Nav;
  route?: { params?: { total?: number; items?: SaleItemIn[] } };
};

type Tab = 'tunai' | 'nontunai' | 'online' | 'member' | 'lainnya';
type Split = { id: string; label: string; amount: number };

const CASH_DRAWERS = ['Laci 1', 'Laci 2', 'Laci 3'];

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

/** Deposit member mock — di app nyata diambil dari server (member butuh online). */
const MEMBER_DEPOSIT_DB = [
  { id: 'M001', nama: 'Budi Santoso', saldo: 150000 },
  { id: 'M002', nama: 'Sinta Dewi', saldo: 500000 },
  { id: 'M003', nama: 'Andi Pratama', saldo: 0 },
];

const VOUCHER_VALUE = 10000;
let splitSeq = 0;

const SIDEBAR: { id: Tab; title: string; sub: string }[] = [
  { id: 'tunai', title: 'Tunai', sub: '(Uang kertas & koin)' },
  { id: 'nontunai', title: 'Non-Tunai', sub: '(Debit/Kredit via EDC)' },
  { id: 'online', title: 'Pembayaran Online', sub: '(E-Wallet, QRIS, transfer)' },
  { id: 'member', title: 'Deposit Member', sub: '(Potong saldo)' },
  { id: 'lainnya', title: 'Pluxee / Ultra', sub: '(Voucher tender)' },
];

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export default function PayScreen({ navigation, route }: Props) {
  const total = route?.params?.total ?? 266000;
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }, []);
  const [tab, setTab] = useState<Tab>('tunai');
  const [drawer, setDrawer] = useState(CASH_DRAWERS[0]);

  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherApplied, setVoucherApplied] = useState(0);

  const [splits, setSplits] = useState<Split[]>([]);

  // Tunai
  const [cashSel, setCashSel] = useState<number | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customAmt, setCustomAmt] = useState('');

  // Non-tunai
  const [card, setCard] = useState(CARDS[1].id);
  const [edcCode, setEdcCode] = useState('');

  // Online
  const [wallet, setWallet] = useState<string | null>(null);
  const [ovoPhone, setOvoPhone] = useState('');

  // Deposit member
  const [memberQ, setMemberQ] = useState('');
  const [memberSel, setMemberSel] = useState<string | null>(null);

  // Pluxee / Ultra / lainnya
  const [tenderCode, setTenderCode] = useState('');
  const [tenderKind, setTenderKind] = useState<'Pluxee' | 'Ultra' | 'Lainnya'>('Pluxee');
  const [tenderAmt, setTenderAmt] = useState('');

  const payable = total - voucherApplied;
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
    const base = remaining > 0 ? remaining : payable;
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

  const applyVoucher = () => {
    if (voucherCode.trim().length >= 3) {
      setVoucherApplied(VOUCHER_VALUE);
      setVoucherOpen(false);
    }
  };

  const removeVoucher = () => {
    setVoucherApplied(0);
    setVoucherCode('');
  };

  const addSplit = (label: string, amount: number) => {
    if (amount <= 0) return;
    splitSeq += 1;
    setSplits((s) => [...s, { id: `split-${splitSeq}`, label, amount }]);
  };

  const removeSplit = (id: string) => setSplits((s) => s.filter((x) => x.id !== id));

  const goSuccess = (method: string, cash: number, change: number, detail?: { approvalCode?: string }) => {
    recordSale({
      method,
      grandTotal: payable,
      discountTotal: voucherApplied,
      cash,
      change,
      items: route?.params?.items,
      payments: [
        ...splits.map((s) => ({ method: s.label, amount: s.amount })),
        { method, amount: Math.max(0, payable - paid), ...(detail?.approvalCode ? { approvalCode: detail.approvalCode } : {}) },
      ],
      ...(voucherCode.trim() ? { voucherCode: voucherCode.trim() } : {}),
      ...(detail?.approvalCode ? { approvalCode: detail.approvalCode } : {}),
    });
    navigation?.navigate('Success', { total: payable, method, cash, change });
  };

  // ---- Tunai actions ----
  const onCashTambah = () => {
    if (tendered <= 0) return;
    addSplit('Tunai', Math.min(tendered, remaining));
    setCashSel(null);
    setCustomMode(false);
    setCustomAmt('');
  };

  const onCashLanjut = () => {
    const grand = paid + tendered;
    if (grand < payable || payable <= 0) return;
    goSuccess('cash', grand, Math.max(0, grand - payable));
  };

  // ---- Non-tunai actions ----
  const onCardLanjut = () => {
    if (edcCode.length !== 6 || payable <= 0) return;
    const amt = remaining > 0 ? remaining : payable;
    const grand = paid + amt;
    if (grand >= payable) {
      goSuccess(card, grand, Math.max(0, grand - payable), edcCode.length === 6 ? { approvalCode: edcCode } : undefined);
    } else {
      addSplit(CARDS.find((c) => c.id === card)?.name ?? 'Non Tunai', amt);
      setEdcCode('');
    }
  };

  // ---- Online actions ----
  const ovoPhoneOk = wallet !== 'ovo' || ovoPhone.replace(/[^0-9]/g, '').length >= 9;
  const onOnlineLanjut = () => {
    if (!wallet || payable <= 0 || !ovoPhoneOk) return;
    if (wallet === 'qris') {
      navigation?.navigate('Qris', { total: remaining > 0 ? remaining : payable });
      return;
    }
    const grand = paid + (remaining > 0 ? remaining : payable);
    goSuccess(wallet, grand, 0);
  };

  // ---- Deposit member actions ----
  const memberHits = MEMBER_DEPOSIT_DB.filter(
    (m) =>
      memberQ.trim() === '' ||
      m.nama.toLowerCase().includes(memberQ.toLowerCase()) ||
      m.id.toLowerCase().includes(memberQ.toLowerCase()),
  );
  const memberPicked = MEMBER_DEPOSIT_DB.find((m) => m.id === memberSel) ?? null;
  const onDepositLanjut = () => {
    if (!memberPicked || memberPicked.saldo <= 0 || payable <= 0) return;
    const pakai = Math.min(memberPicked.saldo, remaining > 0 ? remaining : payable);
    const grand = paid + pakai;
    if (grand >= payable) {
      goSuccess('deposit', grand, 0);
    } else {
      addSplit(`Deposit ${memberPicked.nama}`, pakai);
      setMemberSel(null);
    }
  };

  // ---- Pluxee / Ultra / lainnya ----
  const tenderNum = Number(tenderAmt.replace(/[^0-9]/g, '')) || 0;
  const tenderReady = tenderCode.trim().length >= 3 && tenderNum > 0;
  const onTenderTambah = () => {
    if (!tenderReady) return;
    addSplit(`${tenderKind} ${tenderCode.trim().toUpperCase()}`, Math.min(tenderNum, remaining));
    setTenderCode('');
    setTenderAmt('');
  };
  const onTenderLunas = () => {
    if (!tenderReady || payable <= 0) return;
    const grand = paid + Math.min(tenderNum, remaining);
    if (grand >= payable) goSuccess(tenderKind.toLowerCase(), grand, 0);
    else onTenderTambah();
  };

  const cashTambahReady = tendered > 0;
  const cashLanjutReady = payable > 0 && paid + tendered >= payable && (paid > 0 || tendered > 0);
  const cashChange = Math.max(0, paid + tendered - payable);
  const cashPayLabel =
    tendered > 0 && cashLanjutReady
      ? `Bayar ${rp(tendered)} ›`
      : tendered > 0
        ? `Kurang ${rp(Math.max(0, payable - paid - tendered))}`
        : `Lanjut Pembayaran • ${rp(payable)}`;

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <TouchableOpacity onPress={() => navigation?.goBack()}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Metode Pembayaran</Text>
      </View>
      <View style={styles.headerRight}>
        {isTablet && (
          <View style={styles.dateChip}>
            <Text style={styles.dateChipText}>◷  {todayStr}</Text>
          </View>
        )}
        <View style={styles.onlineBadge}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>Online</Text>
        </View>
      </View>
    </View>
  );

  const renderBanner = () => (
    <View style={isTablet ? styles.bannerRowTablet : styles.bannerRow}>
      {isTablet && (
        <TouchableOpacity
          style={[styles.voucherBarTablet, voucherApplied > 0 && styles.voucherBarTabletActive]}
          onPress={() => (voucherApplied > 0 ? removeVoucher() : setVoucherOpen((v) => !v))}>
          <Text
            style={[
              styles.voucherBarTabletText,
              voucherApplied > 0 && styles.voucherBarTabletTextActive,
            ]}>
            {voucherApplied > 0 ? `◈  Voucher Terpasang • -${rp(voucherApplied)}  ✕` : '◈  Tambah Voucher'}
          </Text>
        </TouchableOpacity>
      )}
      <View style={isTablet ? styles.bannerTablet : styles.banner}>
        <View style={styles.bannerCol}>
          <Text style={styles.bannerLabel}>Total</Text>
          <Text style={styles.bannerValue}>{rp(total)}</Text>
        </View>
        <View style={styles.bannerDivider} />
        <View style={styles.bannerCol}>
          <Text style={styles.bannerLabel}>Belum Terbayar</Text>
          <Text style={[styles.bannerValue, styles.bannerRemaining]}>{rp(remaining)}</Text>
        </View>
      </View>
      {isTablet ? null : (
        <TouchableOpacity
          style={[styles.voucherBar, voucherApplied > 0 && styles.voucherBarActive]}
          onPress={() => (voucherApplied > 0 ? removeVoucher() : setVoucherOpen((v) => !v))}>
          <Text style={[styles.voucherBarText, voucherApplied > 0 && styles.voucherBarTextActive]}>
            {voucherApplied > 0
              ? `◈  Voucher Terpasang • -${rp(voucherApplied)}  ✕`
              : '◈  Tambah Voucher'}
          </Text>
        </TouchableOpacity>
      )}
      {voucherOpen && voucherApplied === 0 && (
        <View style={styles.voucherRow}>
          <TextInput
            style={styles.input}
            placeholder="Kode voucher"
            placeholderTextColor={colors.faint}
            value={voucherCode}
            onChangeText={setVoucherCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.voucherBtn} onPress={applyVoucher}>
            <Text style={styles.voucherBtnText}>Pakai</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.voucherBtn}
            onPress={() => {
              setVoucherOpen(false);
              navigation?.navigate('Voucher');
            }}>
            <Text style={styles.voucherBtnText}>Pilih ›</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderTabs = () => {
    if (isTablet) return null;
    const tabs: { id: Tab; label: string }[] = [
      { id: 'tunai', label: 'Tunai' },
      { id: 'nontunai', label: 'Non-Tunai' },
      { id: 'online', label: 'Online' },
      { id: 'member', label: 'Deposit' },
      { id: 'lainnya', label: 'Pluxee/Ultra' },
    ];
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll}>
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
      <Text style={styles.panelTitle}>Pembayaran tunai</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subTabs}>
        {CASH_DRAWERS.map((d) => (
          <TouchableOpacity
            key={d}
            style={styles.subTab}
            onPress={() => setDrawer(d)}
            accessibilityState={{ selected: drawer === d }}>
            <Text style={[styles.subTabText, drawer === d && styles.subTabTextActive]}>
              {d}
            </Text>
            {drawer === d && <View style={styles.subTabUnderline} />}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.grid}>
        <TouchableOpacity
          style={[styles.gridCard, !customMode && cashSel === remaining && styles.gridCardActive]}
          onPress={() => {
            setCustomMode(false);
            setCashSel(remaining);
          }}>
          <Text style={styles.gridText}>Uang Pas</Text>
          <Text style={styles.gridSub}>{rp(remaining)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.gridCard, customMode && styles.gridCardActive]}
          onPress={() => {
            setCustomMode(true);
            setCashSel(null);
          }}>
          <Text style={styles.gridText}>Jumlah lain ›</Text>
        </TouchableOpacity>
        {nominals.map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.gridCard, !customMode && cashSel === v && styles.gridCardActive]}
            onPress={() => {
              setCustomMode(false);
              setCashSel(v);
            }}>
            <Text style={styles.gridText}>{rp(v)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {customMode && (
        <View style={styles.customRow}>
          <Text style={styles.fieldLabel}>Pembayaran jumlah lain</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.faint}
            value={customAmt}
            onChangeText={setCustomAmt}
          />
        </View>
      )}

      {tendered > 0 && (
        <View style={styles.changeBox}>
          <Text style={styles.changeText}>
            {cashLanjutReady
              ? `Kembalian ${rp(cashChange)} • Diterima ${rp(tendered)}`
              : `Kurang ${rp(Math.max(0, payable - paid - tendered))} • Diterima ${rp(tendered)}`}
          </Text>
        </View>
      )}
      {!cashLanjutReady && tendered === 0 && (
        <Text style={styles.ctaHint}>Pilih nominal di atas untuk melanjutkan pembayaran.</Text>
      )}
      {renderSplits()}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.lanjutBtn, styles.lanjutBtnPrimary, !cashLanjutReady && styles.btnDisabled]}
          disabled={!cashLanjutReady}
          onPress={onCashLanjut}>
          <Text style={styles.lanjutTextPrimary}>{cashPayLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tambahBtn, !cashTambahReady && styles.tambahBtnDisabled]}
          disabled={!cashTambahReady}
          onPress={onCashTambah}>
          <Text style={styles.tambahText}>+ Tambah</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const cardName = CARDS.find((c) => c.id === card)?.name ?? 'Non Tunai';

  const renderNonTunai = () => (
    <View>
      <Text style={styles.panelTitle}>Kartu debit/kredit via mesin EDC</Text>
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
        <Text style={styles.edcInfoTitle}>{cardName} • {rp(remaining)}</Text>
        <Text style={styles.edcInfoSub}>
          Gesek/tap kartu di mesin EDC, lalu masukkan 6 digit kode persetujuan dari struk EDC di bawah.
        </Text>
      </View>

      <Text style={styles.fieldLabel}>Nominal terkunci ({rp(remaining)})</Text>
      <View style={styles.lockedAmount}>
        <Text style={styles.lockedAmountText}>{rp(remaining)}</Text>
        <Text style={styles.lockedBadge}>Terkunci</Text>
      </View>

      <Text style={styles.fieldLabel}>Kode persetujuan EDC (6 digit) *</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        placeholder="Contoh: 482913"
        placeholderTextColor={colors.faint}
        value={edcCode}
        onChangeText={(t) => setEdcCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
        maxLength={6}
      />

      {renderSplits()}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.lanjutBtn, styles.lanjutBtnPrimary, edcCode.length !== 6 && styles.btnDisabled]}
          disabled={edcCode.length !== 6}
          onPress={onCardLanjut}>
          <Text style={styles.lanjutTextPrimary}>Bayar {rp(remaining)} ›</Text>
        </TouchableOpacity>
      </View>
      {edcCode.length !== 6 && (
        <Text style={styles.ctaHint}>Masukkan 6 digit kode dari struk EDC untuk mengaktifkan tombol bayar.</Text>
      )}
      <TouchableOpacity
        style={styles.edcLink}
        onPress={() => navigation?.navigate('Edc', { total: remaining > 0 ? remaining : payable })}>
        <Text style={styles.edcLinkText}>Buka panduan mesin EDC ›</Text>
      </TouchableOpacity>
    </View>
  );

  const renderOnline = () => (
    <View>
      <Text style={styles.panelTitle}>Dompet digital & QRIS</Text>
      <View style={styles.grid}>
        {WALLETS.map((w) => {
          const active = wallet === w.id;
          return (
            <TouchableOpacity
              key={w.id}
              style={[styles.walletCard, active && styles.walletCardActive]}
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
        <Text style={styles.ctaHint}>Pilih salah satu dompet digital di atas untuk melanjutkan.</Text>
      )}

      {wallet === 'ovo' && (
        <View style={styles.customRow}>
          <Text style={styles.fieldLabel}>Nomor OVO pelanggan *</Text>
          <TextInput
            style={styles.input}
            keyboardType="phone-pad"
            placeholder="Contoh: 0812xxxxxxx"
            placeholderTextColor={colors.faint}
            value={ovoPhone}
            onChangeText={(t) => setOvoPhone(t.replace(/[^0-9]/g, '').slice(0, 14))}
          />
          <Text style={styles.ctaHint}>Notifikasi tagihan dikirim ke nomor ini — pelanggan setujui di aplikasi OVO.</Text>
        </View>
      )}

      {renderSplits()}

      <View style={styles.footerSingle}>
        <TouchableOpacity
          style={[styles.lanjutBtnFull, styles.lanjutBtnPrimary, (!wallet || !ovoPhoneOk) && styles.btnDisabled]}
          disabled={!wallet || !ovoPhoneOk}
          onPress={onOnlineLanjut}>
          <Text style={styles.lanjutTextPrimary}>
            {wallet ? `Bayar ${rp(remaining)} via ${WALLET_LABEL[wallet] ?? wallet} ›` : `Pilih metode • ${rp(remaining)}`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderMember = () => (
    <View>
      <Text style={styles.panelTitle}>Potong saldo deposit member</Text>
      <TextInput
        style={styles.input}
        placeholder="Cari nama / ID member"
        placeholderTextColor={colors.faint}
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
          <Text style={styles.ctaHint}>Member tidak ditemukan — tambah via layar Member.</Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.memberLink}
        onPress={() => navigation?.navigate('Member')}>
        <Text style={styles.edcLinkText}>Cari / tambah member ›</Text>
      </TouchableOpacity>
      {renderSplits()}
      <View style={styles.footerSingle}>
        <TouchableOpacity
          style={[styles.lanjutBtnFull, styles.lanjutBtnPrimary, (!memberPicked || memberPicked.saldo <= 0) && styles.btnDisabled]}
          disabled={!memberPicked || memberPicked.saldo <= 0}
          onPress={onDepositLanjut}>
          <Text style={styles.lanjutTextPrimary}>
            {memberPicked
              ? `Potong ${rp(Math.min(memberPicked.saldo, remaining))} dari ${memberPicked.nama} ›`
              : `Pilih member • ${rp(remaining)}`}
          </Text>
        </TouchableOpacity>
      </View>
      {memberPicked && memberPicked.saldo < remaining && (
        <Text style={styles.ctaHint}>Saldo kurang — sisanya bisa dibayar tunai/non-tunai (split).</Text>
      )}
    </View>
  );

  const renderLainnya = () => (
    <View>
      <Text style={styles.panelTitle}>Pluxee, Ultra voucher & tender lainnya</Text>
      <View style={styles.pills}>
        {(['Pluxee', 'Ultra', 'Lainnya'] as const).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.pill, tenderKind === k && styles.pillActive]}
            onPress={() => setTenderKind(k)}>
            <Text style={[styles.pillText, tenderKind === k && styles.pillTextActive]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.fieldLabel}>Kode voucher {tenderKind} *</Text>
      <TextInput
        style={styles.input}
        placeholder="Contoh: PLX-882031"
        placeholderTextColor={colors.faint}
        value={tenderCode}
        onChangeText={(t) => setTenderCode(t.toUpperCase())}
        autoCapitalize="characters"
      />
      <Text style={styles.fieldLabel}>Nominal dipakai *</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.faint}
        value={tenderAmt}
        onChangeText={setTenderAmt}
      />
      {renderSplits()}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.lanjutBtn, styles.lanjutBtnPrimary, !tenderReady && styles.btnDisabled]}
          disabled={!tenderReady}
          onPress={onTenderLunas}>
          <Text style={styles.lanjutTextPrimary}>Bayar {rp(Math.min(tenderNum, remaining))} ›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tambahBtn, !tenderReady && styles.tambahBtnDisabled]}
          disabled={!tenderReady}
          onPress={onTenderTambah}>
          <Text style={styles.tambahText}>+ Tambah</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.ctaHint}>Kode dikunci saat dipakai dan dibakar (burn) setelah lunas.</Text>
    </View>
  );

  const renderBody = () => {
    if (!isTablet) {
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
          {SIDEBAR.map((s) => {
            const active = tab === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.sideBtn, active && styles.sideBtnActive]}
                onPress={() => setTab(s.id)}
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
      <ScrollView contentContainerStyle={styles.body}>
        {renderBanner()}
        {renderBody()}
        <ExtraPaySection onDone={(label) => goSuccess(label, payable, 0)} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  back: { color: colors.white, fontFamily: fonts.medium, fontSize: 22, marginRight: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dateChipText: { color: colors.white, fontFamily: fonts.medium, fontSize: 12 },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white, marginRight: 5 },
  onlineText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 12 },
  body: { padding: 12, paddingBottom: 24 },
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
  },
  tabActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  tabText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.muted, textAlign: 'center' },
  tabTextActive: { color: colors.white },
  panelTitle: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, marginTop: 12 },
  subTabs: { flexDirection: 'row', marginTop: 8 },
  subTab: { marginRight: 18, paddingBottom: 6 },
  subTabText: { fontFamily: fonts.medium, fontSize: 13, color: colors.faint },
  subTabTextActive: { color: colors.text, fontFamily: fonts.semibold },
  subTabUnderline: { height: 2, backgroundColor: colors.orange, marginTop: 4, borderRadius: 1 },
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
  gridSub: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy, marginTop: 2 },
  customRow: { marginTop: 10 },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.faint, marginBottom: 5 },
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
  checkActive: { borderColor: colors.white, backgroundColor: 'rgba(255,255,255,0.25)' },
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
    backgroundColor: 'rgba(255,255,255,0.12)',
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
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    marginTop: 4,
  },
  sideSubActive: { color: colors.white },
  tabletContent: { flex: 1, minWidth: 0 },
});
