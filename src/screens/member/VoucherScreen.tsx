import React, { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { fmtDate } from '../../lib/datefmt';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { ApiPath } from '../../config/server';import { apiFetch, claimOnlineVoucher, externalVoucher, unwrap, validateOnlineVoucher, validateVoucherCode } from '../../lib/apiSource';
import { enqueueOutbox, enqueueSync } from '../../lib/sync';
import { useLang } from '../../lib/i18n';
import * as Network from 'expo-network';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type VoucherStatus = 'tersedia' | 'terkunci' | 'terpakai' | 'kadaluwarsa';

type Voucher = {
  id: string;
  kode: string;
  nama: string;
  jenis: string;
  nilai: number;
  minBelanja: number;
  berlakuHingga: string;
  status: VoucherStatus;
};

/** Tanggal seed lewat fmtDate agar ikut locale (id/en), bukan string hardcode. */
function seedDate(y: number, m: number, d: number): string {
  return fmtDate(new Date(y, m - 1, d));
}

const SEED: Voucher[] = [
  { id: '1', kode: 'HEMAT20', nama: 'Diskon 20rb', jenis: 'Diskon (Rp)', nilai: 20000, minBelanja: 100000, berlakuHingga: seedDate(2026, 12, 31), status: 'tersedia' },
  { id: '2', kode: 'GIFT50', nama: 'Gift Voucher 50rb', jenis: 'Gift Voucher (Rp)', nilai: 50000, minBelanja: 0, berlakuHingga: seedDate(2027, 1, 31), status: 'tersedia' },
  { id: '3', kode: 'ULTRA10', nama: 'Ultra Voucher 10%', jenis: 'Diskon (%)', nilai: 10, minBelanja: 50000, berlakuHingga: seedDate(2026, 11, 15), status: 'terkunci' },
  { id: '4', kode: 'LAMA5', nama: 'Voucher Lama', jenis: 'Diskon (Rp)', nilai: 5000, minBelanja: 0, berlakuHingga: seedDate(2026, 1, 1), status: 'kadaluwarsa' },
];

/**
 * Operasi voucher ke server ikut kontrak docs/API-CONTRACT.md §5.3:
 * validate {code, grandTotal}, lock/unlock/burn {code, salesNum}.
 * Selalu catat ke outbox + antrean sync agar aman saat offline.
 */
async function persistVoucherOp(
  op: 'lock' | 'unlock' | 'validate' | 'burn',
  v: Voucher,
  opts?: { salesNum?: string; grandTotal?: number },
): Promise<void> {
  const path =
    op === 'lock'
      ? ApiPath.voucherLock
      : op === 'unlock'
        ? ApiPath.voucherUnlock
        : op === 'burn'
          ? ApiPath.voucherBurn
          : ApiPath.voucherValidate;
  try {
    await enqueueOutbox('ms_voucher', v.id, 'update');
  } catch {
    /* abaikan */
  }
  try {
    enqueueSync('other', { kind: `voucher-${op}`, id: v.id, kode: v.kode });
  } catch {
    /* abaikan */
  }
  try {
    const body =
      op === 'validate'
        ? { code: v.kode, grandTotal: opts?.grandTotal ?? 0 }
        : { code: v.kode, salesNum: opts?.salesNum ?? '' };
    await apiFetch(path, { body });
  } catch {
    /* offline - terkirim via push berikutnya */
  }
}

export default function VoucherScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, setLang, t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'semua' | VoucherStatus>('semua');
  const [kodeManual, setKodeManual] = useState('');
  const [msg, setMsg] = useState('');
  const [items, setItems] = useState<Voucher[]>(SEED);
  const [applied, setApplied] = useState<Voucher | null>(null);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // WIRE REA-7/REA-6: jalur server voucher online + eksternal di samping mock.
  const [onlineCode, setOnlineCode] = useState('');
  const [onlineMsg, setOnlineMsg] = useState('');
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [extCode, setExtCode] = useState('');
  const [extMsg, setExtMsg] = useState('');
  const [extBusy, setExtBusy] = useState(false);

  // Guard online seperti Member: offline tampilkan banner, operasi antre via outbox.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let live = true;
    Network.getNetworkStateAsync()
      .then((ns) => { if (live) setOnline(ns.isConnected ?? true); })
      .catch(() => { if (live) setOnline(true); });
    return () => { live = false; };
  }, []);

  // Sinkron voucher dari server (kontrak §4 main/get-voucher via
  // ApiPath.pullVoucher yang ditarik master.ts ke ms_voucher): tampilkan data
  // sync bila ada, fallback SEED lokal bila kosong/offline - fallback JANGAN
  // dihapus agar kasir tetap jalan tanpa server.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await apiFetch(ApiPath.pullVoucher, { method: 'GET' });
        const { data } = unwrap<{ items?: Record<string, unknown>[] }>(res.data);
        const rows = Array.isArray(data?.items) ? data.items : [];
        if (!live || rows.length === 0) return;
        const mapped: Voucher[] = [];
        for (const [idx, it] of rows.entries()) {
          const kode = String(it.code ?? '').trim().toUpperCase();
          if (!kode) continue;
          const st = String(it.status ?? 'available').toLowerCase();
          const status: VoucherStatus =
            st === 'available' ? 'tersedia'
            : st === 'locked' ? 'terkunci'
            : st === 'used' || st === 'burned' ? 'terpakai'
            : 'kadaluwarsa';
          let hingga = String(it.validTo ?? '').slice(0, 10);
          try {
            const d = new Date(String(it.validTo ?? ''));
            if (!Number.isNaN(d.getTime())) {
              hingga = fmtDate(d, lang);
            }
          } catch {
            /* pakai potongan tanggal mentah */
          }
          mapped.push({
            id: String(it.voucherId ?? it.id ?? `V${idx + 1}`),
            kode,
            nama: String(it.name ?? kode),
            jenis: t('vou_kind_discount'),
            nilai: Math.max(0, Math.round(Number(it.amount ?? 0) || 0)),
            minBelanja: 0,
            berlakuHingga: hingga,
            status,
          });
        }
        if (live && mapped.length > 0) setItems(mapped);
      } catch {
        /* offline - SEED lokal tetap dipakai */
      }
    })();
    return () => { live = false; };
  }, []);

  const STATUS_TXT: Record<VoucherStatus, string> = {
    tersedia: t('vou_st_available'),
    terkunci: t('vou_st_locked'),
    terpakai: t('vou_st_used'),
    kadaluwarsa: t('vou_st_expired'),
  };

  const hasil = items.filter(
    (v) =>
      (filter === 'semua' || v.status === filter) &&
      (q.trim() === '' ||
        v.kode.toLowerCase().includes(q.toLowerCase()) ||
        v.nama.toLowerCase().includes(q.toLowerCase())),
  );

  const setStatus = (id: string, status: VoucherStatus) =>
    setItems((list) => list.map((v) => (v.id === id ? { ...v, status } : v)));

  /** Validasi kode manual: tanya server dulu (valid/amount/minSpend),
   * fallback ke data lokal + antrean bila offline. */
  const validate = async () => {
    const kode = kodeManual.trim().toUpperCase();
    if (kode.length < 3) {
      setMsg(t('vou_short'));
      return;
    }
    const found = items.find((v) => v.kode === kode);
    if (!found) {
      setMsg(`Kode ${kode} ${t('vou_unknown')}`);
      return;
    }
    if (found.status === 'kadaluwarsa') {
      setMsg(`Kode ${kode} ${t('vou_is_expired')}`);
      return;
    }
    if (found.status === 'terpakai') {
      setMsg(`Kode ${kode} ${t('vou_is_used')}`);
      return;
    }
    // Offline: fallback SEED lokal agar kasir tetap jalan.
    if (!online) {
      void persistVoucherOp('validate', found);
      setQ(kode);
      setMsg(`Kode ${kode} ${t('vou_valid')} - ${found.nama}. ${t('vou_lock_first')}`);
      return;
    }
    // Online: tampilkan valid/amount/minSpend dari server (apiSource.ts:314).
    setMsg(t('vou_checking'));
    try {
      const r = await validateVoucherCode(kode, found.minBelanja);
      void persistVoucherOp('validate', found);
      setQ(kode);
      if (r.ok) {
        setMsg(t('vou_server_valid').replace('{k}', kode).replace('{a}', rp(r.amount)).replace('{m}', rp(r.minSpend)).replace('{l}', t('vou_lock_first')));
      } else {
        setMsg(t('vou_server_invalid').replace('{k}', kode).replace('{u}', t('vou_unknown')).replace('{m}', rp(r.minSpend)));
      }
    } catch {
      // Server tak terjangkau: fallback SEED lokal + antrean sync.
      void persistVoucherOp('validate', found);
      setQ(kode);
      setMsg(`Kode ${kode} ${t('vou_valid')} - ${found.nama}. ${t('vou_lock_first')}`);
    }
  };

  /** Validasi voucher online via helper REA-7. Best-effort, UI tetap jalan offline. */
  const validateOnline = async () => {
    const kode = onlineCode.trim().toUpperCase();
    if (kode.length < 3) {
      setOnlineMsg(t('vou_short'));
      return;
    }
    setOnlineBusy(true);
    try {
      const r = await validateOnlineVoucher(kode, 0);
      if (r.ok) {
        setOnlineMsg(`Kode ${kode} ${t('vou_valid')} - ${rp(r.amount)}. Min. belanja ${rp(r.minSpend)}.`);
      } else {
        setOnlineMsg(`Kode ${kode} ${t('vou_unknown')}`);
      }
    } catch {
      setOnlineMsg(`Kode ${kode} ${t('vou_unknown')}`);
    } finally {
      setOnlineBusy(false);
    }
  };

  /** Klaim voucher online ke transaksi berjalan via helper REA-7. Best-effort. */
  const claimOnline = async () => {
    const kode = onlineCode.trim().toUpperCase();
    if (kode.length < 3) {
      setOnlineMsg(t('vou_short'));
      return;
    }
    setOnlineBusy(true);
    try {
      const r = await claimOnlineVoucher(kode, `TRX-${Date.now()}`);
      setOnlineMsg(r.ok ? t('vou_online_claim_ok') : `Kode ${kode} ${t('vou_unknown')}`);
    } catch {
      setOnlineMsg(`Kode ${kode} ${t('vou_unknown')}`);
    } finally {
      setOnlineBusy(false);
    }
  };

  /** Voucher eksternal validate/burn/unburn via helper REA-6. Best-effort. */
  const extOp = async (op: 'validate' | 'burn' | 'unburn') => {
    const kode = extCode.trim().toUpperCase();
    if (kode.length < 3) {
      setExtMsg(t('vou_short'));
      return;
    }
    setExtBusy(true);
    try {
      const r = await externalVoucher(op, kode);
      if (op === 'burn') {
        setExtMsg(r.ok ? t('vou_ext_burn_ok') : `Kode ${kode} ${t('vou_unknown')}`);
      } else if (op === 'unburn') {
        setExtMsg(r.ok ? t('vou_ext_unburn_ok') : `Kode ${kode} ${t('vou_unknown')}`);
      } else if (r.ok) {
        setExtMsg(`Kode ${kode} ${t('vou_valid')} - ${rp(r.amount)}.`);
      } else {
        setExtMsg(`Kode ${kode} ${t('vou_unknown')}`);
      }
    } catch {
      setExtMsg(`Kode ${kode} ${t('vou_unknown')}`);
    } finally {
      setExtBusy(false);
    }
  };

  /** Kunci voucher agar tidak dipakai transaksi lain. */
  const lock = (v: Voucher) => {    if (v.status !== 'tersedia' || busy) return;
    setBusy(v.id);
    void persistVoucherOp('lock', v).finally(() => {
      setStatus(v.id, 'terkunci');
      setBusy(null);
    });
  };

  /** Buka kunci voucher. */
  const unlock = (v: Voucher, done?: () => void) => {
    if (v.status !== 'terkunci' || busy) return;
    setBusy(v.id);
    void persistVoucherOp('unlock', v).finally(() => {
      setStatus(v.id, 'tersedia');
      setBusy(null);
      done?.();
    });
  };

  /** Terapkan = bakar voucher; banner applied tetap tampil, tidak langsung goBack. */
  const burn = (v: Voucher) => {
    if (v.status !== 'terkunci' || busy) return;
    setBusy(v.id);
    void persistVoucherOp('burn', v).finally(() => {
      setStatus(v.id, 'terpakai');
      setBusy(null);
      setApplied({ ...v, status: 'terpakai' });
    });
  };

  /** Batalkan promo: unlock di server + antrean, lalu lepas applied. */
  const cancelPromo = () => {
    if (applied) {
      const v = items.find((i) => i.id === applied.id);
      if (v && v.status === 'terkunci') {
        unlock({ ...v }, () => {
          setApplied(null);
          setCancelVisible(false);
        });
        return;
      }
      // Sudah burn: kembalikan ke terkunci agar kasir bisa putuskan ulang.
      void persistVoucherOp('unlock', applied).finally(() => {
        setStatus(applied.id, 'terkunci');
        setApplied(null);
        setCancelVisible(false);
      });
      return;
    }
    setCancelVisible(false);
  };

  /** Kembali ke kasir dengan objek voucher {code, amount, kind} kontrak totals.ts:
   * kind 'Ongkir'/kode GRATISONGKIR = potong ongkir, nominal = potong belanja.
   * Ragam 'Diskon (%)' diteruskan apa adanya - JANGAN hitung persen di sini.
   * Rumus persen kanonis milik totals.ts (bukan file ini); kebutuhan untuk
   * pemilik totals.ts: potong = round(dasar * nilai / 100), dibulatkan integer
   * rupiah sebelum dipakai sebagai voucherBelanja pada rumus-BE PARITY §3. */
  const backToCashier = () => {
    if (!applied) {
      navigation?.goBack?.();
      return;
    }
    navigation?.navigate('Cashier', {
      voucher: { code: applied.kode, amount: applied.nilai, kind: applied.jenis },
    });
  };

  const filterLabel = (f: 'semua' | VoucherStatus) =>
    f === 'semua' ? t('c_all') : f === 'tersedia' ? t('vou_available') : f === 'terkunci' ? t('vou_locked') : f === 'terpakai' ? t('vou_used') : t('vou_expired');

  return (
    <View style={s.root}>
      <ScreenHeader
        title={t('vou_title')}
        sub={applied ? `${applied.kode} - ${applied.nama}` : `${hasil.length} promo`}
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

      <View style={s.searchWrap}>
        <Text style={s.label}>{t('vou_search_label')}</Text>
        <View style={s.manualRow}>
          <View style={s.manualInput}>
            <AppInput
              placeholder={t('vou_search_ph')}
              autoCapitalize="characters"
              value={kodeManual}
              onChangeText={(txt) => {
                setKodeManual(txt);
                setQ(txt);
                setMsg('');
              }}
            />
          </View>
          <AppButton
            title={t('vou_check')}
            fullWidth={false}
            style={{ marginTop: 0, paddingHorizontal: 20, backgroundColor: colors.navy }}
            onPress={validate}
          />
        </View>
        {msg ? <Text style={s.msg}>{msg}</Text> : null}
      </View>

      {!online && (
        <Text style={s.offlineBanner}>Offline - data dari cache lokal, perubahan disinkron saat online.</Text>
      )}

      <View style={s.searchWrap}>
        <Text style={s.label}>{t('vou_online_title')}</Text>
        <View style={s.manualRow}>
          <View style={s.manualInput}>
            <AppInput
              placeholder={t('vou_search_ph')}
              autoCapitalize="characters"
              value={onlineCode}
              onChangeText={(txt) => {
                setOnlineCode(txt);
                setOnlineMsg('');
              }}
            />
          </View>
          <AppButton
            title={onlineBusy ? '...' : t('vou_check')}
            disabled={onlineBusy}
            fullWidth={false}
            style={{ marginTop: 0, paddingHorizontal: 20, backgroundColor: colors.navy }}
            onPress={validateOnline}
          />
        </View>
        <View style={s.lockRow}>
          <AppButton
            title={t('vou_online_claim')}
            disabled={onlineBusy}
            fullWidth={false}
            style={{ flex: 2, marginTop: 0 }}
            onPress={claimOnline}
          />
        </View>
        {onlineMsg ? <Text style={s.msg}>{onlineMsg}</Text> : null}
        <Text style={s.label}>{t('vou_title')}</Text>
        <View style={s.manualRow}>
          <View style={s.manualInput}>
            <AppInput
              placeholder={t('vou_search_ph')}
              autoCapitalize="characters"
              value={extCode}
              onChangeText={(txt) => {
                setExtCode(txt);
                setExtMsg('');
              }}
            />
          </View>
          <AppButton
            title={extBusy ? '...' : t('vou_check')}
            disabled={extBusy}
            fullWidth={false}
            style={{ marginTop: 0, paddingHorizontal: 20, backgroundColor: colors.navy }}
            onPress={() => void extOp('validate')}
          />
        </View>
        <View style={s.lockRow}>
          <AppButton
            title={t('vou_unlock')}
            variant="secondary"
            disabled={extBusy}
            fullWidth={false}
            style={{ flex: 1, marginTop: 0 }}
            onPress={() => void extOp('unburn')}
          />
          <AppButton
            title={t('vou_apply_burn')}
            disabled={extBusy}
            fullWidth={false}
            style={{ flex: 2, marginTop: 0 }}
            onPress={() => void extOp('burn')}
          />
        </View>
        {extMsg ? <Text style={s.msg}>{extMsg}</Text> : null}
      </View>

      <View style={s.filters}>
        {(['semua', 'tersedia', 'terkunci', 'terpakai', 'kadaluwarsa'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[s.filterChip, filter === f && s.filterActive]}
            onPress={() => setFilter(f)}>
            <Text style={[s.filterTxt, filter === f && s.filterTxtActive]}>
              {filterLabel(f)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.sectionTitle}>{t('vou_promo_list')}</Text>

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenter]}>
        {hasil.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>{t('vou_empty')}</Text>
            <Text style={s.emptySub}>{t('vou_empty_sub')}</Text>
          </View>
        ) : (
          hasil.map((v) => {
            const loading = busy === v.id;
            return (
              <View key={v.id} style={[s.card, v.status !== 'tersedia' && v.status !== 'terkunci' && s.cardDim]}>
                <View style={s.cardTop}>
                  <View style={s.voucherBadge}>
                    <Text style={s.voucherKode}>{v.kode}</Text>
                  </View>
                  <Text
                    style={[
                      s.statusTxt,
                      v.status === 'tersedia' ? s.statusOk : v.status === 'terkunci' ? s.statusLock : v.status === 'terpakai' ? s.statusUsed : s.statusExp,
                    ]}>
                    {STATUS_TXT[v.status]}
                  </Text>
                </View>
                <Text style={s.voucherName}>{v.nama}</Text>
                <Text style={s.voucherJenis}>{v.jenis}</Text>
                <Text style={s.voucherNilai}>
                  {t('vou_value')}:{' '}
                  {v.jenis.includes('%') ? `${v.nilai}%` : rp(v.nilai)}
                </Text>
                {v.minBelanja > 0 ? (
                  <Text style={s.voucherMeta}>
                    {t('vou_min')} {rp(v.minBelanja)}
                  </Text>
                ) : null}
                <Text style={s.voucherMeta}>{t('vou_valid_until')} {v.berlakuHingga}</Text>
                {v.status === 'tersedia' && (
                  <AppButton
                    title={loading ? t('vou_locking') : t('vou_lock_use')}
                    disabled={loading}
                    style={{ marginTop: 10 }}
                    onPress={() => lock(v)}
                  />
                )}
                {v.status === 'terkunci' && (
                  <View style={s.lockRow}>
                    <AppButton
                      title={loading ? '...' : t('vou_unlock')}
                      variant="secondary"
                      disabled={loading}
                      fullWidth={false}
                      style={{ flex: 1, marginTop: 0 }}
                      onPress={() => unlock(v)}
                    />
                    <AppButton
                      title={loading ? '...' : t('vou_apply_burn')}
                      disabled={loading}
                      fullWidth={false}
                      style={{ flex: 2, marginTop: 0 }}
                      onPress={() => burn(v)}
                    />
                  </View>
                )}
                {(v.status === 'terpakai' || v.status === 'kadaluwarsa') && (
                  <View style={[s.applyBtn, s.applyDisabled]}>
                    <Text style={s.applyTxt}>{v.status === 'terpakai' ? t('vou_used') : t('vou_expired')}</Text>
                  </View>
                )}
              </View>
            );
          })
        )}

        {applied ? (
          <View style={s.appliedBox}>
            <TouchableOpacity onPress={() => setCancelVisible(true)}>
              <Text style={s.appliedTxt}>
                {t('ok_voucher')} {applied.kode} {t('vou_used').toLowerCase()} - {t('vou_cancel_promo')}
              </Text>
            </TouchableOpacity>
            <AppButton
              title={`${t('vou_back_cashier')} ›`}
              style={{ marginTop: 10 }}
              onPress={backToCashier}
            />
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={cancelVisible} transparent animationType="fade">
        <View style={s.modalBg}>
          <View style={s.dialog}>
            <Text style={s.modalTitle}>{t('vou_cancel_title')}</Text>
            <Text style={s.modalHint}>
              {applied ? `Voucher ${applied.kode} - ${applied.nama}` : ''}
            </Text>
            <View style={s.dialogRow}>
              <AppButton
                title={t('vou_keep')}
                variant="secondary"
                fullWidth={false}
                style={{ flex: 1, marginTop: 0, marginRight: 8 }}
                onPress={() => setCancelVisible(false)}
              />
              <AppButton
                title={t('vou_cancel_promo')}
                variant="danger"
                fullWidth={false}
                style={{ flex: 1, marginTop: 0, marginLeft: 8 }}
                onPress={cancelPromo}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  langTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  burger: { width: 22, height: 22 },
  searchWrap: {
    backgroundColor: colors.white,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginBottom: 2 },
  search: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  manualRow: { flexDirection: 'row', marginTop: 8 },
  manualInput: { flex: 1, marginRight: 8 },
  checkBtn: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  checkTxt: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  msg: { fontSize: 12, fontFamily: fonts.medium, color: colors.navy, marginTop: 8 },
  offlineBanner: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.amberDark,
    backgroundColor: colors.paleAmber,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', padding: 12 },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  filterActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  filterTxtActive: { color: colors.white },
  sectionTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  body: { padding: 16, paddingTop: 8, paddingBottom: 24 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.orange,
  },
  cardDim: { opacity: 0.6, borderLeftColor: colors.faint },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  voucherBadge: {
    backgroundColor: colors.navy,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  voucherKode: { color: colors.white, fontSize: 13, fontFamily: fonts.bold },
  statusTxt: { fontSize: 11, fontFamily: fonts.medium },
  statusOk: { color: colors.green },
  statusLock: { color: colors.blue },
  statusUsed: { color: colors.orange },
  statusExp: { color: colors.red },
  voucherName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 8,
  },
  voucherJenis: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  voucherNilai: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.navy,
    marginTop: 4,
  },
  voucherMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.faint },
  applyBtn: {
    backgroundColor: colors.orange,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  applyDisabled: { backgroundColor: colors.faint },
  applyTxt: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  lockRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  unlockBtn: {
    flex: 1, borderWidth: 1, borderColor: colors.navy, borderRadius: 8,
    paddingVertical: 10, alignItems: 'center',
  },
  unlockTxt: { color: colors.navy, fontSize: 14, fontFamily: fonts.bold },
  burnBtn: { flex: 2, backgroundColor: colors.orange, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  emptySub: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.faint,
    marginTop: 6,
  },
  appliedBox: {
    backgroundColor: colors.paleGreen,
    borderRadius: 10,
    padding: 14,
    marginTop: 4,
  },
  appliedTxt: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.green,
    textAlign: 'center',
  },
  backCashierBtn: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 10,
  },
  backCashierTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.white },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 24 },
  modalTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
  },
  modalHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  dialogRow: { flexDirection: 'row', marginTop: 18 },
  dialogGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginRight: 8,
  },
  dialogGhostTxt: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  dialogDanger: {
    flex: 1,
    backgroundColor: colors.red,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginLeft: 8,
  },
  dialogDangerTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.white },
});
