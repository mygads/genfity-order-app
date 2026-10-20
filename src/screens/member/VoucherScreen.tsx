import React, { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { dbNowLocal, fmtDate } from '../../lib/datefmt';
import ScreenHeader from '../../components/ScreenHeader';
import { ApiPath } from '../../config/server';import { apiFetch, claimOnlineVoucher, externalVoucher, unwrap, validateOnlineVoucher, validateVoucherCode } from '../../lib/apiSource';
import { enqueueOutbox, enqueueSync } from '../../lib/sync';
import { initDb, query, queryFirst, run } from '../../lib/db';
import { tOf, useLang } from '../../lib/i18n';
import { getCachedCurrency } from '../../lib/currency';
import type { Lang } from '../../lib/i18n';
import { verifyLocalEscalation } from '../../lib/supervisor';
import { uuidv7 } from '../../lib/uuidv7';
import * as Network from 'expo-network';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type VoucherStatus = 'tersedia' | 'terkunci' | 'terpakai' | 'kadaluwarsa' | 'belum_berlaku';

type Voucher = {
  id: string;
  kode: string;
  nama: string;
  jenis: string;
  nilai: number;
  minBelanja: number;
  /** U1: cermin TotalsVoucher — diteruskan ke kasir agar totals.ts
   * (satu-satunya pemilik rumus) bisa pakai. */
  rate?: number;
  maxAmount?: number;
  berlakuHingga: string;
  status: VoucherStatus;
};

/** Baca koleksi nyata dari SQLite ms_voucher (hasil pull/koleksi kasir).
 * Kosong = belum ada voucher (pemanggil tampilkan empty-state). */
type VoucherRow = {
  id: string | null;
  voucherCode: string | null;
  voucherName: string | null;
  amount: number | null;
  quota: number | null;
  validFrom: string | null;
  validTo: string | null;
  status: string | null;
};

async function loadVouchersFromSqlite(lang: Lang): Promise<Voucher[]> {
  await initDb();
  const rows = await query<VoucherRow>(
    'SELECT id, voucherCode, voucherName, amount, quota, validFrom, validTo, status FROM ms_voucher ORDER BY validTo',
  );
  const out: Voucher[] = [];
  // "Sekarang" waktu lokal selaras validateVoucherCodeLocal/saveSale agar
  // perbandingan jendela validitas identik (kolom DATETIME = waktu lokal).
  const nowStr = dbNowLocal();
  for (const [idx, r] of rows.entries()) {
    const kode = (r.voucherCode ?? '').trim().toUpperCase();
    if (!kode) continue;
    const st = (r.status ?? 'available').toLowerCase();
    let status: VoucherStatus =
      st === 'available' ? 'tersedia'
      : st === 'locked' ? 'terkunci'
      : st === 'used' || st === 'burned' ? 'terpakai'
      : 'kadaluwarsa';
    const nilai = Math.max(0, Math.round(Number(r.amount) || 0));
    // Cermin kanonis: status 'available' saja tak cukup — kuota habis /
    // nominal 0 / di luar jendela = tak bisa dipakai kasir, jadi daftar
    // menampilkannya apa adanya (bukan 'tersedia' yang menipu).
    if (status === 'tersedia') {
      const quota = Math.round(Number(r.quota) || 0);
      const vf = (r.validFrom ?? '').trim();
      const vt = (r.validTo ?? '').trim();
      if (nilai <= 0 || quota <= 0) status = 'terpakai';
      else if (vf && vf > nowStr) status = 'belum_berlaku';
      else if (vt && vt < nowStr) status = 'kadaluwarsa';
    }
    let hingga = String(r.validTo ?? '').slice(0, 10);
    try {
      const d = new Date(String(r.validTo ?? ''));
      if (!Number.isNaN(d.getTime())) hingga = fmtDate(d, lang);
    } catch {
      /* pakai potongan tanggal mentah */
    }
    out.push({
      id: String(r.id ?? `V${idx + 1}`),
      kode,
      nama: (r.voucherName ?? '').trim() || kode,
      // S4: label jenis diskon ikut currency cabang (dulu vou_type_disc_idr
      // hardcode "Rp/IDR" untuk semua merchant, salah untuk AUD).
      jenis: tOf(getCachedCurrency().code === 'AUD' ? 'vou_type_disc_aud' : 'vou_type_disc_idr', lang),
      nilai,
      minBelanja: 0,
      berlakuHingga: hingga,
      status,
    });
  }
  return out;
}

/**
 * Operasi voucher ke server ikut kontrak docs/API-CONTRACT.md §5.3:
 * validate {code, grandTotal}, lock/unlock/burn {code, salesNum}.
 * S6 (immediate-first): coba ke server dulu dengan timeout singkat; hanya
 * bila gagal/timeout, antrekan kembar (outbox + sync) dengan client_id
 * bersama agar push berikutnya idempoten dan tak ganda catat.
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
  // FetchOpts tak punya timeout — batas 8 dtk via Promise.race.
  const clientId = uuidv7();
  const body =
    op === 'validate'
      ? { code: v.kode, grandTotal: opts?.grandTotal ?? 0, client_id: clientId }
      : { code: v.kode, salesNum: opts?.salesNum ?? '', client_id: clientId };
  try {
    const res = await Promise.race([
      apiFetch(path, { body, idempotencyKey: clientId }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (res && res.ok) return;
  } catch {
    /* jatuh ke antrean kembar di bawah */
  }
  try {
    await enqueueOutbox('ms_voucher', v.id, 'update');
  } catch {
    /* abaikan */
  }
  try {
    enqueueSync('other', { kind: `voucher-${op}`, id: v.id, kode: v.kode, client_id: clientId, clientId });
  } catch {
    /* abaikan */
  }
}

export default function VoucherScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'semua' | VoucherStatus>('semua');
  const [kodeManual, setKodeManual] = useState('');
  const [msg, setMsg] = useState('');
  const [items, setItems] = useState<Voucher[]>([]);
  const [applied, setApplied] = useState<Voucher | null>(null);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // U10: bakar voucher = gerbang PIN eskalasi (fail-closed). Kunci (lock)
  // tetap ungated — deliberate.
  const [burnPinVisible, setBurnPinVisible] = useState(false);
  const [burnPin, setBurnPin] = useState('');
  const [burnPinErr, setBurnPinErr] = useState('');
  const [pendingBurn, setPendingBurn] = useState<Voucher | null>(null);
  // Unified lookup: satu state kode (kodeManual) + satu msg + satu result.
  // lookup() mencoba: match lokal SQLite → validateVoucherCode → validateOnlineVoucher → external validate.
  type LookupSource = 'local' | 'online' | 'external';
  type LookupResult = { source: LookupSource; kode: string; amount: number; minSpend: number };
  const [result, setResult] = useState<LookupResult | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  // Guard online seperti Member: offline tampilkan banner, operasi antre via outbox.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let live = true;
    Network.getNetworkStateAsync()
      .then((ns) => { if (live) setOnline(ns.isConnected ?? true); })
      .catch(() => { if (live) setOnline(true); });
    return () => { live = false; };
  }, []);

  // Voucher dari SQLite ms_voucher dulu (offline-first: pull/koleksi nyata),
  // lalu pengayaan dari server bila ada. Kosong = empty-state.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const local = await loadVouchersFromSqlite(lang);
        if (live && local.length > 0) setItems(local);
      } catch {
        /* SQLite belum siap - lanjut API */
      }
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
        /* offline - koleksi SQLite tetap dipakai */
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const STATUS_TXT: Record<VoucherStatus, string> = {
    tersedia: t('vou_st_available'),
    terkunci: t('vou_st_locked'),
    terpakai: t('vou_st_used'),
    kadaluwarsa: t('vou_st_expired'),
    belum_berlaku: t('vou_st_scheduled'),
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

  /** Unified lookup: satu kode → lokal SQLite, lalu validateVoucherCode,
   * lalu validateOnlineVoucher, lalu external validate. Hasil digabung ke
   * SATU msg + SATU result (source: local|online|external). */
  const lookup = async () => {
    const kode = kodeManual.trim().toUpperCase();
    if (kode.length < 3) {
      setResult(null);
      setMsg(t('vou_short'));
      return;
    }
    setLookupBusy(true);
    setResult(null);
    setMsg(t('vou_checking'));
    try {
      // 1. Match lokal SQLite (offline-first: pull/koleksi kasir).
      const found = items.find((v) => v.kode === kode);
      if (found && found.status === 'kadaluwarsa') {
        setMsg(t('vou_is_expired').replace('{k}', kode));
        return;
      }
      if (found && found.status === 'terpakai') {
        setMsg(t('vou_is_used').replace('{k}', kode));
        return;
      }
      if (found && found.status === 'belum_berlaku') {
        setMsg(t('vou_not_yet').replace('{k}', kode));
        return;
      }
      if (found && (found.status === 'tersedia' || found.status === 'terkunci')) {
        void persistVoucherOp('validate', found);
        setQ(kode);
        setResult({ source: 'local', kode, amount: found.nilai, minSpend: found.minBelanja });
        setMsg(t('vou_local_valid').replace('{k}', kode).replace('{v}', found.nama).replace('{l}', t('vou_lock_first')));
        return;
      }
      if (!online) {
        setMsg(t('vou_unknown').replace('{k}', kode));
        return;
      }
      // 2. Server validate (kontrak §5.2 validate {code, grandTotal}).
      try {
        const r = await validateVoucherCode(kode, 0);
        if (r.ok) {
          setQ(kode);
          setResult({ source: 'local', kode, amount: r.amount, minSpend: r.minSpend });
          setMsg(t('vou_server_valid').replace('{k}', kode).replace('{a}', rp(r.amount)).replace('{m}', rp(r.minSpend)).replace('{l}', t('vou_lock_first')));
          return;
        }
      } catch {
        /* lanjut ke jalur online/eksternal */
      }
      // 3. Voucher online (REA-7). Best-effort.
      try {
        const r = await validateOnlineVoucher(kode, 0);
        if (r.ok) {
          setResult({ source: 'online', kode, amount: r.amount, minSpend: r.minSpend });
          setMsg(t('vou_online_valid').replace('{k}', kode).replace('{a}', rp(r.amount)).replace('{m}', rp(r.minSpend)));
          return;
        }
      } catch {
        /* lanjut ke eksternal */
      }
      // 4. Voucher eksternal validate (REA-6). Best-effort.
      try {
        const r = await externalVoucher('validate', kode);
        if (r.ok) {
          setResult({ source: 'external', kode, amount: r.amount, minSpend: 0 });
          setMsg(t('vou_ext_valid').replace('{k}', kode).replace('{a}', rp(r.amount)));
          return;
        }
      } catch {
        /* jatuh ke unknown di bawah */
      }
      setMsg(t('vou_unknown').replace('{k}', kode));
    } finally {
      setLookupBusy(false);
    }
  };

  /** Satu action row untuk result, driven by result.source:
   * local → kunci voucher lokal; online → klaim (REA-7); external → burn (REA-6).
   * Klaim/burn yang sukses WAJIB menempel ke kasir (gap audit: sebelumnya hanya
   * pesan — kuota server terbakar tapi kode tak bisa dipakai kasir karena
   * backstop saveSale hanya kenal ms_voucher/ms_promotion). Karena itu kode
   * online/eksternal dipersist sebagai baris sekali-pakai (kuota 1) agar rantai
   * totals → backstop → burn → void-restore berjalan seragam; TANPA baris ini
   * pemakaian tercatat 'rejected' padahal diskon terlanjur diberikan. */
  const persistSingleUseVoucher = async (kode: string, amount: number): Promise<boolean> => {
    try {
      await initDb();
      const dup = await queryFirst<{ n: number }>(
        'SELECT COUNT(*) AS n FROM ms_voucher WHERE UPPER(voucherCode) = UPPER(?)',
        [kode],
      );
      // Baris lokal sudah ada (mis. hangus/kadaluwarsa) = JANGAN bangkitkan;
      // pemanggil menampilkan arahan pakai jalur lokal.
      if ((dup?.n ?? 0) > 0) return false;
      await run(
        `INSERT INTO ms_voucher (id, voucherCode, voucherName, amount, quota, status, syncDate)
         VALUES (?, ?, ?, ?, 1, 'available', NULL)`,
        [`VON-${kode}`, kode, kode, Math.max(0, Math.round(amount))],
      );
      return true;
    } catch {
      return false;
    }
  };

  const attachClaimedToCashier = async (
    kode: string,
    amount: number,
    opts?: { minSpend?: number; rate?: number; maxAmount?: number },
  ): Promise<void> => {
    const ok = await persistSingleUseVoucher(kode, amount);
    if (!ok) {
      setMsg(t('vou_local_exists'));
      return;
    }
    navigation?.navigate('Cashier', {
      // U1: teruskan minSpend/rate/maxAmount agar totals.ts bisa pakai.
      voucher: {
        code: kode,
        amount: Math.max(0, Math.round(amount)),
        kind: 'Diskon (Rp)',
        ...(opts?.minSpend ? { minSpend: opts.minSpend } : {}),
        ...(opts?.rate != null ? { rate: opts.rate } : {}),
        ...(opts?.maxAmount != null ? { maxAmount: opts.maxAmount } : {}),
      },
    });
  };

  const claimResult = async () => {
    if (!result || lookupBusy) return;
    const kode = result.kode;
    if (result.source === 'local') {
      const found = items.find((v) => v.kode === kode);
      if (found && found.status === 'tersedia') lock(found);
      else setMsg(t('vou_local_valid').replace('{k}', kode).replace('{v}', rp(result.amount)).replace('{l}', t('vou_lock_first')));
      return;
    }
    setLookupBusy(true);
    try {
      if (result.source === 'online') {
        const r = await claimOnlineVoucher(kode, `TRX-${Date.now()}`);
        if (!r.ok) {
          setMsg(t('vou_unknown').replace('{k}', kode));
          return;
        }
        setMsg(t('vou_online_claim_ok'));
        await attachClaimedToCashier(kode, result.amount, { minSpend: result.minSpend });
      } else {
        const r = await externalVoucher('burn', kode);
        if (!r.ok) {
          setMsg(t('vou_unknown').replace('{k}', kode));
          return;
        }
        setMsg(t('vou_ext_burn_ok'));
        await attachClaimedToCashier(kode, result.amount, { minSpend: result.minSpend });
      }
    } catch {
      setMsg(t('vou_unknown').replace('{k}', kode));
    } finally {
      setLookupBusy(false);
    }
  };

  /** Batal: lepas result + msg. Eksternal coba unburn dulu (best-effort);
   * item lokal yang terkunci dibuka via kartu daftar. */
  const clearResult = async () => {
    if (!result) {
      setMsg('');
      return;
    }
    if (result.source === 'external') {
      setLookupBusy(true);
      try {
        const r = await externalVoucher('unburn', result.kode);
        if (r.ok) setMsg(t('vou_ext_unburn_ok'));
      } catch {
        /* abaikan */
      } finally {
        setLookupBusy(false);
      }
    }
    setResult(null);
    setMsg('');
  };

  /* Jalur terpisah REA-7/REA-6 dilebur ke lookup()/claimResult()/clearResult di atas. */

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

  /** Terapkan = bakar voucher; banner applied tetap tampil, tidak langsung goBack.
   * U10: bakar = aksi uang → wajib lolos eskalasi supervisor 'sale.refund'
   * (PIN salah/tanpa hak = ditolak, fail-closed). */
  const burn = (v: Voucher) => {
    if (v.status !== 'terkunci' || busy) return;
    setPendingBurn(v);
    setBurnPin('');
    setBurnPinErr('');
    setBurnPinVisible(true);
  };
  const confirmBurn = async () => {
    if (!pendingBurn || busy) return;
    const v = pendingBurn;
    const esc = await verifyLocalEscalation(burnPin, 'sale.refund');
    if (!esc.ok) {
      setBurnPinErr(esc.message);
      return;
    }
    setBurnPinVisible(false);
    setBurnPin('');
    setBurnPinErr('');
    setPendingBurn(null);
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
      voucher: {
        code: applied.kode,
        amount: applied.nilai,
        kind: applied.jenis,
        // U1: teruskan extras agar totals.ts (satu-satunya pemilik rumus) bisa pakai.
        ...(applied.minBelanja > 0 ? { minSpend: applied.minBelanja } : {}),
        ...(applied.rate != null ? { rate: applied.rate } : {}),
        ...(applied.maxAmount != null ? { maxAmount: applied.maxAmount } : {}),
      },
    });
  };

  const filterLabel = (f: 'semua' | VoucherStatus) =>
    f === 'semua' ? t('c_all') : f === 'tersedia' ? t('vou_available') : f === 'terkunci' ? t('vou_locked') : f === 'terpakai' ? t('vou_used') : f === 'kadaluwarsa' ? t('vou_expired') : t('vou_scheduled');

  const countTxt = t('vou_promo_count').replace('{n}', String(hasil.length));

  return (
    <View style={s.root}>
      <ScreenHeader
        title={t('vou_title')}
        sub={applied ? `${applied.kode} - ${applied.nama}` : countTxt}
        onBack={() => navigation?.goBack?.()}
      />

      {/* SATU panel cek: satu input kode + satu tombol + satu pesan hasil. */}
      <View style={s.searchPanel}>
        <View style={[s.panelInner, isTablet && wideCenterLg]}>
          <Text style={s.panelTitle}>{t('vou_search_label')}</Text>
          <Text style={s.panelHint}>{t('vou_lookup_hint')}</Text>
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
                  setResult(null);
                }}
                boxStyle={!isTablet ? s.inputCompact : undefined}
              />
            </View>
            <AppButton
              title={lookupBusy ? t('vou_checking_short') : t('vou_check')}
              disabled={lookupBusy}
              fullWidth={false}
              style={!isTablet ? s.checkCompact : s.checkTablet}
              textStyle={!isTablet ? s.checkCompactTxt : undefined}
              onPress={lookup}
            />
          </View>
          {msg ? <Text style={s.msg}>{msg}</Text> : null}
          {!online && (
            <Text style={s.offlineBanner}>{t('vou_offline')}</Text>
          )}
          {result ? (
            <View style={s.resultRow}>
              <AppButton
                title={result.source === 'local' ? t('vou_lock_use') : result.source === 'online' ? t('vou_online_claim') : t('vou_apply_burn')}
                disabled={lookupBusy}
                fullWidth={false}
                style={[s.resultPrimary, !isTablet && s.actRowBtn]}
                textStyle={!isTablet ? s.actMdTxt : undefined}
                onPress={claimResult}
              />
              <AppButton
                title={t('c_cancel')}
                variant="secondary"
                disabled={lookupBusy}
                fullWidth={false}
                style={[s.resultSecondary, !isTablet && s.actRowBtn]}
                textStyle={!isTablet ? s.actMdTxt : undefined}
                onPress={clearResult}
              />
            </View>
          ) : null}
        </View>
      </View>

      {/* Filter status — satu baris wrap, ikut batas lebar konten. */}
      <View style={[s.filters, isTablet && wideCenterLg]}>
        {(['semua', 'tersedia', 'terkunci', 'terpakai', 'kadaluwarsa', 'belum_berlaku'] as const).map((f) => (
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

      {/* Judul daftar + jumlah — teks beda dan jelas dari panel cek di atas. */}
      <View style={[s.titleRow, isTablet && wideCenterLg]}>
        <Text style={s.sectionTitle}>{t('vou_promo_list')}</Text>
        <Text style={s.sectionCount}>{countTxt}</Text>
      </View>

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenterLg]}>
        {hasil.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>{t('vou_empty')}</Text>
            <Text style={s.emptySub}>{t('vou_empty_sub')}</Text>
          </View>
        ) : (
          <View style={isTablet ? s.gridTablet : undefined}>
          {hasil.map((v) => {
            const loading = busy === v.id;
            return (
              <View key={v.id} style={[s.card, v.status !== 'tersedia' && v.status !== 'terkunci' && s.cardDim, isTablet && s.cardTablet]}>
                <View style={s.cardTop}>
                  <View style={s.voucherBadge}>
                    <Text style={s.voucherKode}>{v.kode}</Text>
                  </View>
                  <Text
                    style={[
                      s.statusTxt,
                      v.status === 'tersedia' ? s.statusOk : v.status === 'terkunci' ? s.statusLock : v.status === 'terpakai' ? s.statusUsed : v.status === 'belum_berlaku' ? s.statusSched : s.statusExp,
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
                    style={[{ marginTop: 10 }, !isTablet && s.actMd]}
                    textStyle={!isTablet ? s.actMdTxt : undefined}
                    onPress={() => lock(v)}
                  />
                )}
                {v.status === 'terkunci' && (
                  <View style={s.lockRow}>
                    <AppButton
                      title={loading ? t('vou_checking_short') : t('vou_unlock')}
                      variant="secondary"
                      disabled={loading}
                      fullWidth={false}
                      style={[{ flex: 1, marginTop: 0, marginRight: 8 }, !isTablet && s.actRowBtn]}
                      textStyle={!isTablet ? s.actMdTxt : undefined}
                      onPress={() => unlock(v)}
                    />
                    <AppButton
                      title={loading ? t('vou_checking_short') : t('vou_apply_burn')}
                      disabled={loading}
                      fullWidth={false}
                      style={[{ flex: 2, marginTop: 0 }, !isTablet && s.actRowBtn]}
                      textStyle={!isTablet ? s.actMdTxt : undefined}
                      onPress={() => burn(v)}
                    />
                  </View>
                )}
                {(v.status === 'terpakai' || v.status === 'kadaluwarsa' || v.status === 'belum_berlaku') && (
                  <View style={[s.applyBtn, s.applyDisabled]}>
                    <Text style={s.applyTxt}>{v.status === 'terpakai' ? t('vou_used') : v.status === 'belum_berlaku' ? t('vou_scheduled') : t('vou_expired')}</Text>
                  </View>
                )}
              </View>
            );
          })}
          </View>
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
              style={[{ marginTop: 10 }, !isTablet && s.actMd]}
              textStyle={!isTablet ? s.actMdTxt : undefined}
              onPress={backToCashier}
            />
          </View>
        ) : null}
      </ScrollView>

      {/* U10: modal PIN eskalasi bakar voucher (fail-closed). */}
      <Modal visible={burnPinVisible} transparent animationType="slide" onRequestClose={() => setBurnPinVisible(false)}>
        <View style={s.modalBg}>
          <View style={[s.dialog, isTablet && s.dialogTablet]}>
            <Text style={s.modalTitle}>{t('cx_pin')}</Text>
            <Text style={s.modalHint}>
              {pendingBurn ? `${pendingBurn.kode} - ${pendingBurn.nama}` : ''}
            </Text>
            <View style={s.pinDots}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[s.dot, i < burnPin.length && s.dotFill]} />
              ))}
            </View>
            {burnPinErr ? <Text style={s.pinErr}>{burnPinErr}</Text> : null}
            <View style={s.pinPad}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map((k) => (
                <TouchableOpacity
                  key={k}
                  style={s.pinKey}
                  onPress={() => {
                    if (k === 'C') setBurnPin(burnPin.slice(0, -1));
                    else if (k === 'OK') void confirmBurn();
                    else if (burnPin.length < 6) setBurnPin(burnPin + k);
                  }}>
                  <Text style={s.pinKeyTxt}>{k === 'C' ? '⌫' : k}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => {
                setBurnPinVisible(false);
                setBurnPin('');
                setBurnPinErr('');
                setPendingBurn(null);
              }}>
              <Text style={s.cancelTxt}>{t('c_cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={cancelVisible} transparent animationType="fade">
        <View style={s.modalBg}>
          <View style={[s.dialog, isTablet && s.dialogTablet]}>
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
  /** Panel cek fixed di atas: full-bleed putih, isi ikut batas lebar konten. */
  searchPanel: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  panelInner: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  panelTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  panelHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  manualRow: { flexDirection: 'row', marginTop: 8 },
  manualInput: { flex: 1, marginRight: 8 },
  /** Phone: input cek compact (h44) + tombol cek compact + aksi (h42, font 13). */
  inputCompact: { height: 44 },
  checkCompact: {
    marginTop: 0,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.navy,
  },
  checkCompactTxt: { fontSize: 13, textAlign: 'center' },
  checkTablet: { marginTop: 0, paddingHorizontal: 20, backgroundColor: colors.navy },
  actMd: { height: 42, marginTop: 10, borderRadius: 10 },
  actMdTxt: { fontSize: 13, textAlign: 'center' },
  actRowBtn: { height: 42, borderRadius: 10 },
  /** Unified result action row: wrap di layar sempit, margin (bukan gap) utk RN lama. */
  resultRow: { flexDirection: 'row', flexWrap: 'wrap' },
  resultPrimary: { flex: 2, marginTop: 10, marginRight: 8 },
  resultSecondary: { flex: 1, marginTop: 10 },
  msg: { fontSize: 12, fontFamily: fonts.medium, color: colors.navy, marginTop: 8 },
  offlineBanner: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.amberDark,
    backgroundColor: colors.paleAmber,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    borderRadius: 8,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 12 },
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
  /** Baris judul daftar: judul kiri + jumlah kanan, ikut batas lebar konten. */
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  sectionCount: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.faint,
  },
  body: { padding: 16, paddingTop: 8, paddingBottom: 24 },
  // Tablet: daftar voucher 2 kolom, bukan 1 kolom penuh.
  gridTablet: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.orange,
  },
  cardDim: { opacity: 0.6, borderLeftColor: colors.faint },
  // Tablet: kartu voucher setengah lebar baris grid.
  cardTablet: { width: '48.5%' },
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
  statusSched: { color: colors.amberDark },
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
  lockRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
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
    borderRadius: 12,
    padding: 16,
    marginTop: 4,
  },
  appliedTxt: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.green,
    textAlign: 'center',
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: { backgroundColor: colors.white, borderRadius: 16, padding: 24 },
  // Tablet: dialog batal-promo dibatasi lebarnya + tengah.
  dialogTablet: { width: '100%', maxWidth: 480, alignSelf: 'center' },
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
  /** U10: PIN pad bakar voucher (cermin pola ExpenseScreen). */
  pinDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 14,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.faint,
    marginHorizontal: 5,
  },
  dotFill: { backgroundColor: colors.navy, borderColor: colors.navy },
  pinErr: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.red,
    textAlign: 'center',
    marginTop: 8,
  },
  pinPad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 12,
  },
  pinKey: {
    width: '30%',
    aspectRatio: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderRadius: 10,
    margin: 4,
  },
  pinKeyTxt: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },
  cancelBtn: { alignItems: 'center', marginTop: 12, paddingVertical: 8 },
  cancelTxt: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
});
