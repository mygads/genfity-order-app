import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, rp, rpNum, wideCenter } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { ApiPath, apiPost } from '../../config/server';
import { enqueueOutbox, enqueueSync } from '../../lib/sync';
import { useLang } from '../../lib/i18n';
import * as Network from 'expo-network';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = {
  navigation?: Nav;
  route?: { params?: { memberId?: string; nama?: string; saldo?: number } };
};

const QUICK = [50000, 100000, 200000, 500000, 1000000];
const METHODS = ['Tunai', 'QRIS', 'EDC', 'Transfer'];
const MIN_TOPUP = 10000;

/** Prefix mata uang dari helper rp() agar tidak hardcode "Rp". */
const RP_PREFIX = rp(0).replace(/\d/g, '').trim();

/**
 * Simpan top up deposit ikut kontrak §5.2: POST member-deposit-withdrawal/topup
 * {memberId, amount, paymentMethod, note}. Catat ke outbox + antrean sync
 * agar aman offline; inquiry-deposit hanya untuk cek saldo, bukan top up.
 */
async function persistTopup(memberId: string, nominal: number, method: string, note?: string): Promise<void> {
  try {
    await enqueueOutbox('ms_member', memberId, 'update');
  } catch {
    /* abaikan */
  }
  try {
    enqueueSync('other', { kind: 'deposit-topup', memberId, nominal, method });
  } catch {
    /* abaikan */
  }
  try {
    await apiPost(ApiPath.depositTopup, { memberId, amount: nominal, paymentMethod: method, note: note ?? '' });
  } catch {
    /* offline - terkirim via push berikutnya */
  }
}

export default function TopupDepositScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const { lang, setLang, t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const memberId = route?.params?.memberId ?? 'M001';
  const nama = route?.params?.nama ?? 'Budi Santoso';
  const saldoAwal = route?.params?.saldo ?? 150000;

  const [nominal, setNominal] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [catatan, setCatatan] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  // Guard online seperti Member: offline tampilkan banner, submit tetap antre via outbox.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let live = true;
    Network.getNetworkStateAsync()
      .then((ns) => { if (live) setOnline(ns.isConnected ?? true); })
      .catch(() => { if (live) setOnline(true); });
    return () => { live = false; };
  }, []);

  const nominalNum = Number(nominal.replace(/\D/g, '')) || 0;
  const ready = nominalNum >= MIN_TOPUP && method !== '' && !saving;
  const saldoAkhir = saldoAwal + nominalNum;

  /** Submit: persist/outbox dulu, lalu tampilkan sukses (saldo kembali ke Member). */
  const submit = () => {
    if (!ready) return;
    setSaving(true);
    void persistTopup(memberId, nominalNum, method, catatan).finally(() => {
      setSaving(false);
      setDone(true);
    });
  };

  /** Kembali ke Member sambil membawa saldo baru agar kartu + riwayat terupdate. */
  const backToMember = () => {
    navigation?.navigate('Member', { memberId, saldoBaru: saldoAkhir, topupNominal: nominalNum });
  };

  if (done) {
    return (
      <View style={s.root}>
        <ScreenHeader
          title={t('top_title')}
          sub={`${nama} - ${memberId}`}
          onBack={backToMember}
          right={
            <View style={s.headRight}>
              <Pressable onPress={() => setLang(lang === 'id' ? 'en' : 'id')} hitSlop={8}>
                <Text style={s.langTxt}>{lang === 'id' ? 'EN' : 'ID'}</Text>
              </Pressable>
              <Pressable onPress={() => setDrawerOpen(true)} hitSlop={10}>
                <Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
              </Pressable>
            </View>
          }
        />
        <DrawerMenu
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          navigate={(r) => navigation?.navigate(r)}
        />
        <View style={[s.body, isTablet && wideCenter]}>
          <View style={s.checkCircle}><Text style={s.checkMark}>✓</Text></View>
          <Text style={s.title}>{t('top_success')}</Text>
          <Text style={s.sub}>{nama} - {memberId}</Text>
          <View style={s.card}>
            <Row label={t('top_amount')} value={rp(nominalNum)} />
            <Row label={t('top_method')} value={method} />
            <View style={s.divider} />
            <Row label={t('top_balance_before')} value={rp(saldoAwal)} />
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>{t('top_balance_after')}</Text>
              <Text style={s.totalValue}>{rp(saldoAkhir)}</Text>
            </View>
          </View>
          <Text style={s.hint}>{t('top_queued')}</Text>
          <TouchableOpacity style={s.primary} onPress={backToMember}>
            <Text style={s.primaryT}>{t('top_back_member')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghost} onPress={() => navigation?.navigate('Cashier')}>
            <Text style={s.ghostT}>{t('top_new_order')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScreenHeader
        title={t('top_title')}
        sub={`${nama} - ${memberId}`}
        onBack={() => navigation?.goBack?.()}
        right={
          <View style={s.headRight}>
            <Pressable onPress={() => setLang(lang === 'id' ? 'en' : 'id')} hitSlop={8}>
              <Text style={s.langTxt}>{lang === 'id' ? 'EN' : 'ID'}</Text>
            </Pressable>
            <Pressable onPress={() => setDrawerOpen(true)} hitSlop={10}>
              <Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
            </Pressable>
          </View>
        }
      />
      <DrawerMenu
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigate={(r) => navigation?.navigate(r)}
      />
      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        <View style={s.memberBar}>
          <Text style={s.memberName}>{nama}</Text>
          <Text style={s.memberMeta}>{memberId} - {t('top_balance_before')} {rp(saldoAwal)}</Text>
        </View>
        {!online && (
          <Text style={s.offlineBanner}>{t('top_queued')}</Text>
        )}

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('top_quick')}</Text>
          <View style={s.chips}>
            {QUICK.map((n) => (
              <TouchableOpacity
                key={n}
                style={[s.chip, nominalNum === n && s.chipOn]}
                onPress={() => setNominal(String(n))}>
                <Text style={[s.chipTxt, nominalNum === n && s.chipTxtOn]}>{rpNum(n)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.label}>{t('top_custom_label')}</Text>
          <View style={s.amountBox}>
            <Text style={s.rpPrefix}>{RP_PREFIX}</Text>
            <TextInput
              style={s.amountInput}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.faint}
              value={nominalNum ? rpNum(nominalNum) : ''}
              onChangeText={(txt) => setNominal(txt.replace(/\D/g, '').slice(0, 12))}
            />
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('top_method')}</Text>
          <View style={s.chips}>
            {METHODS.map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.chip, method === m && s.chipOn]}
                onPress={() => setMethod(m)}>
                <Text style={[s.chipTxt, method === m && s.chipTxtOn]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.label}>{t('c_note_opt')}</Text>
          <TextInput
            style={s.noteInput}
            placeholder={t('top_note_ph')}
            placeholderTextColor={colors.faint}
            value={catatan}
            onChangeText={setCatatan}
          />
        </View>

        <View style={s.card}>
          <Row label={t('top_balance_before')} value={rp(saldoAwal)} />
          <Row label={t('top_amount')} value={rp(nominalNum)} />
          <View style={s.divider} />
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>{t('top_balance_after')}</Text>
            <Text style={s.totalValue}>{rp(saldoAkhir)}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[s.primary, !ready && s.disabled]}
          disabled={!ready}
          onPress={submit}>
          <Text style={s.primaryT}>
            {saving ? '...' : `${t('top_pay')} - ${rp(nominalNum)}`}
          </Text>
        </TouchableOpacity>
        {!ready && !saving && (
          <Text style={s.hint}>{t('top_hint')}</Text>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  langTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  burger: { width: 22, height: 22 },
  body: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  memberBar: { backgroundColor: colors.navy, borderRadius: 12, padding: 16 },
  offlineBanner: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.amberDark,
    backgroundColor: colors.paleAmber,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
  },
  memberName: { fontSize: 17, fontFamily: fonts.bold, color: colors.white },
  memberMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.navyTint, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginTop: 12 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  label: { fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  chip: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, marginBottom: 8, backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipTxt: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  chipTxtOn: { color: colors.orangeDark },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.orange,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 2, backgroundColor: colors.paleOrange,
  },
  rpPrefix: { fontSize: 18, fontFamily: fonts.bold, color: colors.orange },
  amountInput: { flex: 1, fontSize: 24, fontFamily: fonts.bold, color: colors.text, paddingVertical: 10, marginLeft: 8, textAlign: 'right' },
  noteInput: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 14, fontFamily: fonts.regular, color: colors.text,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rowLabel: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
  rowValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  totalValue: { fontSize: 18, fontFamily: fonts.bold, color: colors.navy },
  primary: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  disabled: { opacity: 0.5 },
  primaryT: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  ghost: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  ghostT: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, textAlign: 'center', marginTop: 8 },
  checkCircle: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', marginTop: 32, alignSelf: 'center',
  },
  checkMark: { color: colors.white, fontSize: 44, fontFamily: fonts.bold },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.text, marginTop: 14, textAlign: 'center' },
  sub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
});
