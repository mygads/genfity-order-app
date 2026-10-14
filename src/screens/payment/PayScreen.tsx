import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, rp } from '../../theme';

type Nav = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

type Props = {
  navigation?: Nav;
  route?: { params?: { total?: number } };
};

type Tab = 'tunai' | 'nontunai' | 'online';
type Split = { id: string; label: string; amount: number };

const CASH_DRAWERS = ['Cash Authorization', 'Cash Child 1', 'Cash Child 2'];

const CARDS = [
  { id: 'debit-bca', name: 'Debit BCA' },
  { id: 'kredit-bca', name: 'Kredit BCA' },
  { id: 'debit-ocbc', name: 'Debit OCBC' },
];

const WALLETS = [
  { id: 'ovo', name: 'OVO' },
  { id: 'gopay', name: 'gopay' },
  { id: 'dana', name: 'DANA' },
  { id: 'qris', name: 'QRIS' },
];

const VOUCHER_VALUE = 10000;
let splitSeq = 0;

const SIDEBAR: { id: Tab; title: string; sub: string }[] = [
  { id: 'tunai', title: 'Tunai', sub: '(Uang kertas & koin)' },
  { id: 'nontunai', title: 'Non-Tunai', sub: '(Debit/Kredit via EDC)' },
  { id: 'online', title: 'Pembayaran Online', sub: '(E-Wallet, QRIS, transfer)' },
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
  const [cardAmount, setCardAmount] = useState('');
  const [cardNo, setCardNo] = useState('');
  const [edcCode, setEdcCode] = useState('');
  const [bankName, setBankName] = useState('');
  const [holderName, setHolderName] = useState('');

  // Online
  const [wallet, setWallet] = useState<string | null>(null);

  const payable = total - voucherApplied;
  const paid = useMemo(() => splits.reduce((s, x) => s + x.amount, 0), [splits]);
  const remaining = Math.max(0, payable - paid);
  const hasAdjust = voucherApplied > 0 || paid > 0;

  const WALLET_LABEL: Record<string, string> = { ovo: 'OVO', gopay: 'GoPay', dana: 'DANA', qris: 'QRIS' };

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

  const goSuccess = (method: string, cash: number, change: number) => {
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
  const cardNum = Number(cardAmount.replace(/[^0-9]/g, '')) || 0;
  const onCardLanjut = () => {
    const amt = cardNum > 0 ? cardNum : remaining;
    if (amt <= 0 || payable <= 0) return;
    const grand = paid + amt;
    if (grand >= payable) {
      goSuccess(card, grand, Math.max(0, grand - payable));
    } else {
      addSplit(CARDS.find((c) => c.id === card)?.name ?? 'Non Tunai', amt);
      setCardAmount('');
    }
  };

  const onCardUbah = () => {
    setCardAmount(remaining > 0 ? String(remaining) : '');
  };

  // ---- Online actions ----
  const onOnlineLanjut = () => {
    if (!wallet || payable <= 0) return;
    if (wallet === 'qris') {
      navigation?.navigate('Qris', { total: remaining > 0 ? remaining : payable });
      return;
    }
    const grand = paid + (remaining > 0 ? remaining : payable);
    goSuccess(wallet, grand, 0);
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

  const renderVoucher = () => {
    if (isTablet) return null;
    return <View />;
  };

  const renderTabs = () => {
    if (isTablet) return null;
    return (
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'tunai' && styles.tabActive]}
          onPress={() => setTab('tunai')}>
          <Text style={[styles.tabText, tab === 'tunai' && styles.tabTextActive]}>Tunai</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'nontunai' && styles.tabActive]}
          onPress={() => setTab('nontunai')}>
          <Text style={[styles.tabText, tab === 'nontunai' && styles.tabTextActive]}>Non-Tunai</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, styles.tabWide, tab === 'online' && styles.tabActive]}
          onPress={() => setTab('online')}>
          <Text
            style={[styles.tabText, tab === 'online' && styles.tabTextActive]}
            numberOfLines={1}
            adjustsFontSizeToFit>
            Pembayaran Online
          </Text>
        </TouchableOpacity>
      </View>
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
        <TouchableOpacity style={styles.ubahBtn} onPress={onCardUbah}>
          <Text style={styles.ubahText}>Ubah</Text>
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

  const renderWalletCard = (id: string, label: string, labelStyle: object) => (
    <TouchableOpacity
      key={id}
      style={[styles.walletCard, wallet === id && styles.walletCardActive]}
      onPress={() => setWallet(id)}
      accessibilityRole="radio"
      accessibilityState={{ selected: wallet === id }}>
      {wallet === id && <View style={styles.walletCheck}><Text style={styles.walletCheckMark}>✓</Text></View>}
      <Text style={[styles.walletText, labelStyle]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderOnline = () => (
    <View>
      <Text style={styles.panelTitle}>Dompet digital & QRIS</Text>
      <View style={styles.grid}>
        {renderWalletCard('ovo', 'OVO', styles.brandOvo)}
        {renderWalletCard('gopay', 'GoPay', styles.brandGopay)}
        {renderWalletCard('dana', 'DANA', styles.brandDana)}
        {renderWalletCard('qris', 'QRIS', styles.brandQris)}
      </View>
      {!wallet && (
        <Text style={styles.ctaHint}>Pilih salah satu dompet digital di atas untuk melanjutkan.</Text>
      )}

      {renderSplits()}

      <View style={styles.footerSingle}>
        <TouchableOpacity
          style={[styles.lanjutBtnFull, styles.lanjutBtnPrimary, !wallet && styles.btnDisabled]}
          disabled={!wallet}
          onPress={onOnlineLanjut}>
          <Text style={styles.lanjutTextPrimary}>
            {wallet ? `Bayar ${rp(remaining)} via ${WALLET_LABEL[wallet] ?? wallet} ›` : `Pilih metode • ${rp(remaining)}`}
          </Text>
        </TouchableOpacity>
      </View>
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
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {renderHeader()}
      <ScrollView contentContainerStyle={styles.body}>
        {renderBanner()}
        {renderVoucher()}
        {renderBody()}
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
  tabs: { flexDirection: 'row', gap: 8, marginTop: 12 },
  tab: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  tabActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  tabWide: { flex: 1.6 },
  tabText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
  },
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
  lanjutText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.navy },
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
  ubahBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  ubahText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.navy },
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
  formTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, marginTop: 14, marginBottom: 8 },
  amountRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  amountInput: { fontFamily: fonts.bold, fontSize: 16 },
  copyBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  copyText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.navy },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  formHalf: { width: '48%', flexGrow: 1 },
  walletCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 22,
    alignItems: 'center',
  },
  walletCardActive: { borderColor: colors.orange, backgroundColor: colors.paleOrange, borderWidth: 2 },
  walletCheck: {
    position: 'absolute', top: 6, right: 6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center',
  },
  walletCheckMark: { color: colors.white, fontSize: 11, fontFamily: fonts.bold },
  walletText: { fontFamily: fonts.bold, fontSize: 20 },
  brandOvo: { color: colors.navy },
  brandGopay: { color: colors.text },
  brandDana: { color: colors.blue },
  brandQris: { color: colors.text },
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
