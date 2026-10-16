import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp, wideCenter } from '../../theme';
import AppInput from '../../components/AppInput';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { ApiPath } from '../../config/server';
import { apiFetch, unwrap, validateVoucherCode } from '../../lib/apiSource';
import { initDb, query } from '../../lib/db';
import { useLang } from '../../lib/i18n';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav; route?: { params?: { returnTo?: string; subtotal?: number; ongkir?: number } } };
type Promo = {
  code: string;
  name: string;
  desc: string;
  amount: number;
  minBelanja: number;
  sampai: string;
  tag: string;
};

/**
 * Fallback offline: dipakai bila SQLite ms_voucher kosong dan API
 * main/get-voucher|get-promotion tak terjangkau. JANGAN dihapus agar kasir
 * tetap jalan tanpa server (pola VoucherScreen SEED).
 */
const FALLBACK_PROMOS: Promo[] = [
  { code: 'QOQI10', name: 'Diskon Member 10%', desc: 'Member GOLD, maks. ' + rp(25000), amount: 10000, minBelanja: 50000, sampai: '31 Okt 2026', tag: 'Member' },
  { code: 'HEMAT5K', name: 'Potongan ' + rp(5000), desc: 'Semua metode bayar', amount: 5000, minBelanja: 30000, sampai: '31 Des 2026', tag: 'Voucher' },
  { code: 'HEMAT15K', name: 'Potongan ' + rp(15000), desc: 'Min. belanja ' + rp(150000) + ', Dine In', amount: 15000, minBelanja: 150000, sampai: '30 Nov 2026', tag: 'Voucher' },
  { code: 'KOPIHEMAT', name: 'Kopi Hemat 20%', desc: 'Kategori Minuman, maks. ' + rp(10000), amount: 8000, minBelanja: 25000, sampai: '15 Nov 2026', tag: 'Kategori' },
  { code: 'GRATISONGKIR', name: 'Gratis Ongkir', desc: 'Take Away & delivery, maks. ' + rp(12000), amount: 12000, minBelanja: 40000, sampai: '31 Des 2026', tag: 'Ongkir' },
];

/** Format tanggal server ('2026-10-31 23:59:59') ala Indonesia ('31 Okt 2026'). */
function fmtTgl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const d = new Date(s.replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  } catch {
    /* pakai potongan mentah */
  }
  return s.slice(0, 10);
}

function tagFor(code: string, kind: unknown): string {
  const c = code.toUpperCase();
  const k = String(kind ?? '').toLowerCase();
  if (c.includes('ONGKIR') || c.includes('KIRIM') || k.includes('ongkir')) return 'Ongkir';
  if (k.includes('percent') || c.startsWith('QOQI')) return 'Member';
  return 'Voucher';
}

type VoucherRow = {
  voucherCode: string | null;
  voucherName: string | null;
  amount: number | null;
  validTo: string | null;
  status: string | null;
};

/** Baca live dari SQLite ms_voucher (pola master.ts: pullVoucher → ms_voucher). */
async function loadFromSqlite(): Promise<Promo[]> {
  await initDb();
  const rows = await query<VoucherRow>(
    'SELECT voucherCode, voucherName, amount, validTo, status FROM ms_voucher',
  );
  const out: Promo[] = [];
  for (const r of rows) {
    const code = (r.voucherCode ?? '').trim().toUpperCase();
    if (!code) continue;
    const st = (r.status ?? 'available').toLowerCase();
    if (st === 'used' || st === 'burned' || st === 'expired') continue;
    const nama = (r.voucherName ?? '').trim() || code;
    out.push({
      code,
      name: nama,
      desc: nama,
      amount: Math.max(0, Math.round(Number(r.amount) || 0)),
      minBelanja: 0,
      sampai: fmtTgl(r.validTo) || '-',
      tag: tagFor(code, ''),
    });
  }
  return out;
}

/**
 * Baca live dari API main/get-voucher + main/get-promotion (apiSource.ts).
 * Gabung per kode: promotion memberi minBelanja/tipe, voucher memberi
 * amount/status. Status used/burned/expired disingkirkan.
 */
async function loadFromApi(): Promise<Promo[]> {
  const [vv, pp] = await Promise.all([
    apiFetch(ApiPath.pullVoucher, { method: 'GET' }).catch(() => null),
    apiFetch(ApiPath.pullPromotion, { method: 'GET' }).catch(() => null),
  ]);
  const byCode = new Map<string, Promo>();
  if (pp) {
    const { data } = unwrap<{ items?: Record<string, unknown>[] }>(pp.data);
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const it of items) {
      if (Number(it.flagActive ?? 1) !== 1) continue;
      const code = String(it.code ?? '').trim().toUpperCase();
      if (!code || byCode.has(code)) continue;
      const type = String(it.type ?? 'nominal').toLowerCase();
      const value = Math.max(0, Math.round(Number(it.value ?? 0) || 0));
      const maxAmt = Math.max(0, Math.round(Number(it.maxAmount ?? value) || 0));
      // Tipe persen ditampilkan sebesar batas cap nominalnya (jujur: maks. Rp X).
      const amount = type === 'percent' ? maxAmt : value;
      if (amount <= 0) continue;
      const nama = String(it.name ?? code);
      byCode.set(code, {
        code,
        name: nama,
        desc: nama,
        amount,
        minBelanja: Math.max(0, Math.round(Number(it.minSpend ?? 0) || 0)),
        sampai: fmtTgl(it.validTo) || '-',
        tag: type === 'ongkir' ? 'Ongkir' : type === 'percent' ? 'Member' : 'Voucher',
      });
    }
  }
  if (vv) {
    const { data } = unwrap<{ items?: Record<string, unknown>[] }>(vv.data);
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const it of items) {
      const code = String(it.code ?? '').trim().toUpperCase();
      if (!code) continue;
      const st = String(it.status ?? 'available').toLowerCase();
      if (st === 'used' || st === 'burned' || st === 'expired') {
        byCode.delete(code);
        continue;
      }
      const amount = Math.max(0, Math.round(Number(it.amount ?? 0) || 0));
      if (amount <= 0) continue;
      const prev = byCode.get(code);
      const nama = String(it.name ?? prev?.name ?? code);
      const tag = tagFor(code, '') === 'Ongkir' || prev?.tag === 'Ongkir' ? 'Ongkir' : (prev?.tag ?? tagFor(code, ''));
      byCode.set(code, {
        code,
        name: nama,
        desc: nama,
        amount,
        minBelanja: prev?.minBelanja ?? 0,
        sampai: fmtTgl(it.validTo) || prev?.sampai || '-',
        tag,
      });
    }
  }
  return [...byCode.values()];
}

/**
 * Daftar Promo (select_promotion) - daftar promo/voucher + tombol Pakai
 * yang kembali ke layar pemanggil dengan params voucher.
 * Daftarkan route: PromotionList.
 */
export default function PromotionListScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Semua');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const returnTo = route?.params?.returnTo ?? 'CartDetail';
  const subtotal = route?.params?.subtotal;
  const ongkir = route?.params?.ongkir;
  const [warn, setWarn] = useState('');

  // Katalog live: SQLite ms_voucher dulu (offline-first), lalu API
  // get-voucher|get-promotion, fallback konstanta bila kosong/offline.
  const [live, setLive] = useState<Promo[] | null>(null);
  const [source, setSource] = useState<'loading' | 'sqlite' | 'api' | 'fallback'>('loading');
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const rows = await loadFromSqlite();
        if (on && rows.length > 0) {
          setLive(rows);
          setSource('sqlite');
          return;
        }
      } catch {
        /* SQLite belum siap - lanjut API */
      }
      try {
        const rows = await loadFromApi();
        if (!on) return;
        if (rows.length > 0) {
          setLive(rows);
          setSource('api');
        } else {
          setSource('fallback');
        }
      } catch {
        if (on) setSource('fallback');
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  const promos = live ?? FALLBACK_PROMOS;

  const tags = useMemo(() => ['Semua', ...Array.from(new Set(promos.map((p) => p.tag)))], [promos]);
  const shown = promos.filter((p) => {
    const q = query.trim().toLowerCase();
    const matchQ = q.length === 0 || (p.code + p.name + p.desc).toLowerCase().includes(q);
    const matchTag = filter === 'Semua' || p.tag === filter;
    return matchQ && matchTag;
  });

  const pakai = async (p: Promo) => {
    if (subtotal !== undefined && subtotal < p.minBelanja) {
      setWarn(`Belanja ${rp(subtotal)} belum mencapai ${t('minSpend')} ${rp(p.minBelanja)} untuk ${p.code}.`);
      return;
    }
    setWarn('');
    const go = (amount: number) => {
      // Teruskan kind (tag) agar pemanggil tahu voucher ongkir vs diskon belanja.
      // GRATISONGKIR dipotong dari ongkir di layar pemanggil bila ongkir > 0.
      navigation?.navigate(returnTo, { voucher: { code: p.code, amount, kind: p.tag }, ...(ongkir !== undefined ? { ongkir } : {}) });
    };
    // Validasi ulang ke server (apiSource.ts validateVoucherCode): nominal
    // server menang bila backend asli menjawab; dummy/offline pakai lokal.
    try {
      const r = await validateVoucherCode(p.code, subtotal ?? p.minBelanja);
      if (!r.fromDummy) {
        if (r.ok) {
          go(r.amount);
          return;
        }
        if (r.minSpend > 0 && subtotal !== undefined && subtotal < r.minSpend) {
          setWarn(`Belanja ${rp(subtotal)} belum mencapai ${t('minSpend')} ${rp(r.minSpend)} untuk ${p.code}.`);
          return;
        }
      }
    } catch {
      /* offline - pakai nilai lokal */
    }
    go(p.amount);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('promoVoucher')}
        sub={`${shown.length} promo`} /* TODO-i18n:promo_count */
        onBack={() => navigation?.goBack()}
        right={
          <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      />
      <DrawerMenu
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigate={(r) => navigation?.navigate(r)}
      />
      <ScrollView contentContainerStyle={[styles.body, isTablet && wideCenter]}>
        {source === 'fallback' ? (
          <Text style={styles.offline}>Offline - menampilkan promo bawaan.</Text> /* TODO-i18n:promo_offline */
        ) : null}
        <AppInput
          boxStyle={styles.searchWrap}
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t('searchPromo')}
        />
        <View style={styles.chips}>
          {tags.map((tg) => (
            <TouchableOpacity key={tg} style={[styles.chip, filter === tg && styles.chipOn]} onPress={() => setFilter(tg)}>
              <Text style={[styles.chipT, filter === tg && styles.chipTOn]}>{tg}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {warn ? <Text style={styles.warn}>{warn}</Text> : null}
        {shown.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Image
              source={require('../../../assets/images/empty_promo.webp')}
              style={styles.emptyImg}
              resizeMode="contain"
            />
            <Text style={styles.emptyT}>{t('promoNotFound')}</Text>
          </View>
        ) : (
          shown.map((p) => (
            <View key={p.code} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.badge}>
                  <Text style={styles.badgeT}>{p.tag}</Text>
                </View>
                <Text style={styles.sampai}>{t('validUntil')} {p.sampai}</Text>
              </View>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.code}>{p.code} · potongan {rp(p.amount)}</Text>
              <Text style={styles.desc}>{p.desc}</Text>
              <Text style={styles.min}>{t('minSpend')} {rp(p.minBelanja)}</Text>
              <TouchableOpacity style={styles.pakai} onPress={() => pakai(p)}>
                <Text style={styles.pakaiT}>{t('useAction')}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  burger: { width: 24, height: 24 },
  offline: { fontFamily: fonts.medium, fontSize: 12, color: colors.amberDark, backgroundColor: colors.paleAmber, borderRadius: 8, padding: 10, marginBottom: 10, textAlign: 'center' },
  warn: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red, backgroundColor: colors.paleRed, borderRadius: 8, padding: 10, marginTop: 10 },
  body: { padding: 16, paddingBottom: 40 },
  searchWrap: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12 },
  search: { paddingVertical: 11, fontFamily: fonts.regular, fontSize: 14, color: colors.text, outlineStyle: 'none' as never },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  emptyWrap: { alignItems: 'center', paddingVertical: 36 },
  emptyImg: { width: 130, height: 130 },
  emptyT: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, marginTop: 10, textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { backgroundColor: colors.paleBlue, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeT: { fontFamily: fonts.bold, fontSize: 11, color: colors.navy },
  sampai: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginTop: 8 },
  code: { fontFamily: fonts.semibold, fontSize: 13, color: colors.greenDark, marginTop: 2 },
  desc: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  min: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  pakai: { backgroundColor: colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  pakaiT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
});
