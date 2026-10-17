import { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { TABLET_BP, colors, fonts, rp, rpNum, wideCenterLg } from '../../theme';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ScreenHeader from '../../components/ScreenHeader';
import { ApiPath, getTerminal } from '../../config/server';import { apiFetch, memberErpApi, unwrap } from '../../lib/apiSource';
import { initDb, queryFirst, run } from '../../lib/db';
import { getSession } from '../../session';
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

/**
 * Simpan top up deposit ikut kontrak §5.2: POST member-deposit-withdrawal/topup
 * {memberId, amount, paymentMethod, note}. Catat ke outbox + antrean sync
 * agar aman offline; inquiry-deposit hanya untuk cek saldo, bukan top up.
 */
async function persistTopup(memberId: string, nominal: number, method: string, note?: string, balanceAfter?: number): Promise<void> {
  // Saldo member ikut naik di DB lokal (kolom depositBalance, selaras
  // MemberScreen.saveDeposit) agar layar Member + pembayaran deposit langsung
  // konsisten offline; syncDate NULL menandai untuk push berikutnya.
  let after = balanceAfter ?? null;
  try {
    await initDb();
    if (after == null) {
      const cur = await queryFirst<{ depositBalance: number | null }>(
        'SELECT depositBalance FROM ms_member WHERE id = ? LIMIT 1',
        [memberId],
      );
      after = Math.max(0, Math.round(Number(cur?.depositBalance) || 0)) + nominal;
    }
    await run('UPDATE ms_member SET depositBalance = ?, syncDate = NULL WHERE id = ?', [after, memberId]);
  } catch {
    /* abaikan */
  }
  try {
    await enqueueOutbox('ms_member', memberId, 'update');
  } catch {
    /* abaikan */
  }
  // FIX2-5: baris ledger lokal tr_memberdeposit (jenis 'topup') agar tiap mutasi
  // tercatat offline-first + ikut outbox/push, bukan hanya update ms_member.
  try {
    await initDb();
    const nowIso = new Date().toISOString();
    const depId = `dep-${Date.now()}`;
    const userId = getSession()?.username ?? getSession()?.name ?? null;
    await run(
      `INSERT INTO tr_memberdeposit (id, memberId, branchId, trxType, amount, balanceAfter, userId, trxDate, syncDate) VALUES (?, ?, ?, 'topup', ?, ?, ?, ?, NULL)`,
      [depId, memberId, getTerminal().branchId || null, nominal, after ?? null, userId, nowIso],
    );
    await enqueueOutbox('tr_memberdeposit', depId, 'insert');
  } catch {
    /* abaikan: outbox ms_member di atas tetap jalan */
  }
  try {
    enqueueSync('other', { kind: 'deposit-topup', memberId, nominal, method });
  } catch {
    /* abaikan */
  }
  try {
    await apiFetch(ApiPath.depositTopup, { body: { memberId, amount: nominal, paymentMethod: method, note: note ?? '' } });
  } catch {
    /* offline - terkirim via push berikutnya */
  }
}

export default function TopupDepositScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang();
  // Tanpa memberId param = layar dibuka di luar alur (deep-link/dev) — JANGAN
  // tulis ke member contoh. Guard hasMember menonaktifkan submit di bawah.
  const hasMember = !!(route?.params?.memberId && route?.params?.memberId.trim());
  const memberId = route?.params?.memberId ?? '';
  const nama = route?.params?.nama ?? '';
  // Saldo awal dari param route bisa basi (top up cepat dari Member tidak
  // lewat sini) — segarkan dari ms_member lokal saat mount.
  const [saldoAwal, setSaldoAwal] = useState(route?.params?.saldo ?? 0);
  useEffect(() => {
    if (!memberId) return;
    let live = true;
    (async () => {
      try {
        await initDb();
        const row = await queryFirst<{ depositBalance: number | null }>(
          'SELECT depositBalance FROM ms_member WHERE id = ? LIMIT 1',
          [memberId],
        );
        if (live && row) setSaldoAwal(Math.max(0, Math.round(Number(row.depositBalance) || 0)));
      } catch {
        /* offline - fallback saldo route */
      }
    })();
    return () => { live = false; };
  }, [memberId]);

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

  // WIRE REA-3: saldo server via erp/member balance-deposit (best-effort -
  // null = dummy/offline, saldo param route tetap dipakai sebagai fallback).
  const [erpBalance, setErpBalance] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await memberErpApi('balance-deposit', { memberId, branchId: getTerminal().branchId });
        if (!live || res.fromDummy) return;
        const { data } = unwrap<Record<string, unknown>>(res.data);
        const echo = String(data.memberId ?? '');
        if (echo && echo !== memberId) return;
        const saldo = Number(data.saldo ?? data.balance ?? data.depositBalance ?? NaN);
        if (!live || !Number.isFinite(saldo)) return;
        setErpBalance(Math.max(0, Math.round(saldo)));
      } catch {
        /* offline - fallback saldo route */
      }
    })();
    return () => { live = false; };
  }, [memberId]);

  const nominalNum = Number(nominal.replace(/\D/g, '')) || 0;
  const ready = hasMember && nominalNum >= MIN_TOPUP && method !== '' && !saving;
  const saldoAkhir = saldoAwal + nominalNum;

  /** Submit: persist/outbox dulu, lalu tampilkan sukses (saldo kembali ke Member). */
  const submit = () => {
    if (!ready) return;
    setSaving(true);
    void persistTopup(memberId, nominalNum, method, catatan, saldoAkhir).finally(() => {
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
        />
        <View style={[s.body, isTablet && wideCenterLg]}>
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
          <AppButton size="md" title={t('top_back_member')} onPress={backToMember} />
          <AppButton
            size="md"
            title={t('top_new_order')}
            variant="secondary"
            onPress={() => navigation?.navigate('Cashier')}
          />
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
      />
      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenterLg]}>
        <View style={s.memberBar}>
          <Text style={s.memberName}>{nama}</Text>
          <Text style={s.memberMeta}>{memberId} - {t('top_balance_before')} {rp(saldoAwal)}</Text>
          {erpBalance != null ? (
            <Text style={s.memberMeta}>{t('mem_erp_balance')}: {rp(erpBalance)}</Text>
          ) : null}
        </View>
        {!online && (
          <Text style={s.offlineBanner}>{t('top_queued')}</Text>
        )}
        {!hasMember && (
          <Text style={s.offlineBanner}>{lang === 'id' ? 'Buka layar ini dari daftar member agar ID member terbawa.' : 'Open this screen from the member list so the member ID is carried over.'}</Text>
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
          <AppInput
            label={t('top_custom_label')}
            keyboardType="number-pad"
            placeholder="0"
            value={nominalNum ? rpNum(nominalNum) : ''}
            onChangeText={(txt) => setNominal(txt.replace(/\D/g, '').slice(0, 12))}
            boxStyle={{ borderColor: colors.orange, backgroundColor: colors.paleOrange }}
            style={{ textAlign: 'right', fontFamily: fonts.bold, fontSize: 20 }}
          />
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
          <AppInput
            label={t('c_note_opt')}
            placeholder={t('top_note_ph')}
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

        <AppButton
          size="md"
          title={saving ? '...' : `${t('top_pay')} - ${rp(nominalNum)}`}
          disabled={!ready}
          onPress={submit}
        />
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
  langTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
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
