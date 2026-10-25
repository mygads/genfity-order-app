import React, { useEffect, useRef, useState } from 'react';
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
import { TABLET_BP, colors, fonts, rp, rpNum, wideCenterLg } from '../../theme';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { fmtDate } from '../../lib/datefmt';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { ApiPath, getBranchId, getTerminal } from '../../config/server';import { apiFetch, memberErpApi, unwrap } from '../../lib/apiSource';
import { initDb, query, queryFirst, run } from '../../lib/db';
import { getJSON, setJSON } from '../../lib/storage';
import { newDepositKey, postDepositOnce } from '../../lib/deposit';
import { searchServerCustomers } from '../../lib/posWire';
import {
  customerIdFromLocalKey,
  localMemberKeyForCustomer,
  parseCustomerId,
} from '../../lib/memberRef';
import { getMemberLookupEnabled } from '../../lib/posConfigSync';
import { isValidEmail } from '../../lib/payments';
import { enqueueOutbox, enqueueOutboxPhysical, enqueueSync } from '../../lib/sync';
import { tOf, useLang, tCur } from '../../lib/i18n';
import type { Lang } from '../../lib/i18n';
import { getSession } from '../../session';
import { hasOpenShift } from '../../lib/shiftGuard';
import * as Network from 'expo-network';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
/** Konteks order opsional (cermin params Pay): dibawa saat Member dibuka dari
 * alur transaksi agar Terapkan ke Pay tidak me-reset order berjalan. */
type OrderCtx = {
  total?: number;
  items?: { id: string; name: string; basePrice: number; qty: number; modifiers?: { name: string; price: number }[]; discount?: number; note?: string }[];
  method?: string;
  mode?: string;
  table?: string;
  ongkir?: number;
  // Potongan ongkir voucher terpisah (bruto + cut): teruskan apa adanya.
  ongkirCut?: number;
  customer?: string;
  voucher?: string | { code: string; amount: number; kind?: string } | number;
  voucherCode?: string;
  discount?: number;
  service?: number;
  tax?: number;
  rounding?: number;
  feeESB?: number;
  /** Biaya kemasan order — teruskan apa adanya agar tak hilang pulang-pergi. */
  packaging?: number;
  /** Tip/gratuity pelanggan — teruskan apa adanya agar tak hilang pulang-pergi. */
  tip?: number;
};
type Props = {
  navigation?: Nav;
  route?: { params?: { memberId?: string; saldoBaru?: number; topupNominal?: number; from?: string; returnTo?: string; ongkirCut?: number } & Partial<OrderCtx> };
};

type Member = {
  id: string;
  nama: string;
  noHp: string;
  email: string;
  tipe: string;
  saldo: number;
  poin: number;
  /** true bila server menandai loyaltyMember (hasil /customers/search). */
  loyalty: boolean;
};

type Riwayat = { id: string; tanggal: string; keterangan: string; nominal?: number; poin?: number };

/** Baris ms_member SQLite (skema db.ts): id, memberName, phone, email (M1),
 * depositBalance. Tanpa kolom tier — tipe default Regular. */
type MemberRow = {
  id: string | null;
  memberName: string | null;
  phone: string | null;
  email: string | null;
  depositBalance: number | null;
};

/** Cache baca poin SERVER per member (AsyncStorage): ditulis HANYA dari data
 * server (/customers/search, inquiry, pull) agar offline tetap tampil angka
 * terakhir yang sah. M1: overlay lokal TAK mencetak poin (earn 1pt/Rp1000
 * DIHAPUS — poin milik loyalty server, server-wins). */
const POINTS_KEY = 'genfity.member.points';
async function loadPoints(): Promise<Record<string, number>> {
  try {
    const v = await getJSON<Record<string, number>>(POINTS_KEY, {});
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
/** Simpan nilai poin server apa adanya (server-wins, bukan maks/earn). */
async function cacheServerPoints(memberId: string, points: number): Promise<void> {
  try {
    const cur = await loadPoints();
    const next = Math.max(0, Math.round(Number(points) || 0));
    if (Math.round(Number(cur[memberId]) || 0) === next) return;
    await setJSON(POINTS_KEY, { ...cur, [memberId]: next });
  } catch {
    /* abaikan */
  }
}
/** Samakan digit HP untuk pencocokan lokal↔server (08… vs +62… vs 62…). */
function phoneKey(hp: string): string {
  const d = String(hp ?? '').replace(/[^0-9]/g, '');
  return d.length >= 7 ? d.slice(-9) : d;
}
/** Baca koleksi nyata dari SQLite ms_member (hasil seed/pull/koleksi kasir).
 * Kosong = belum ada member (pemanggil tampilkan empty-state). Poin = cache
 * terakhir dari server (M1: tanpa earn lokal). */
async function loadMembersFromSqlite(): Promise<Member[]> {
  await initDb();
  const rows = await query<MemberRow>(
    'SELECT id, memberName, phone, email, depositBalance FROM ms_member ORDER BY memberName',
  );
  const pts = await loadPoints();
  const out: Member[] = [];
  for (const r of rows) {
    const id = (r.id ?? '').trim();
    const nama = (r.memberName ?? '').trim();
    if (!id || !nama) continue;
    out.push({
      id,
      nama,
      noHp: (r.phone ?? '').trim(),
      email: (r.email ?? '').trim(),
      tipe: 'Regular',
      saldo: Math.max(0, Math.round(Number(r.depositBalance) || 0)),
      poin: Math.max(0, Math.round(Number(pts[id]) || 0)),
      loyalty: false,
    });
  }
  return out;
}

/** Riwayat nyata per member dari SQLite: deposit/withdraw
 * (tr_memberdeposit + tr_membertransactionlog) + penjualan yang menyebut
 * memberId ini (tr_saleshead). Kosong = belum ada transaksi. */
async function loadMemberHistoryFromSqlite(memberId: string, lang: Lang): Promise<Riwayat[]> {
  await initDb();
  const out: Riwayat[] = [];
  try {
    const deps = await query<{
      id: string | null; trxType: string | null; amount: number | null;
      trxDate: string | null;
    }>(
      'SELECT id, trxType, amount, trxDate FROM tr_memberdeposit WHERE memberId = ? ORDER BY trxDate DESC LIMIT 50',
      [memberId],
    );
    for (const d of deps) {
      const amt = Math.round(Number(d.amount) || 0);
      if (!amt) continue;
      const tipe = String(d.trxType ?? '').toLowerCase();
      out.push({
        id: String(d.id ?? `dep-${out.length}`),
        tanggal: String(d.trxDate ?? '').slice(0, 10),
        keterangan: tipe.includes('withdraw') || amt < 0
          ? tOf('mem_pay_deposit', lang)
          : tOf('mem_topup_deposit', lang),
        nominal: amt,
      });
    }
  } catch {
    /* tabel/log boleh kosong */
  }
  try {
    const logs = await query<{
      id: string | null; trxType: string | null; amount: number | null;
      trxDate: string | null;
    }>(
      'SELECT id, trxType, amount, trxDate FROM tr_membertransactionlog WHERE memberId = ? ORDER BY trxDate DESC LIMIT 50',
      [memberId],
    );
    for (const l of logs) {
      const amt = Math.round(Number(l.amount) || 0);
      if (!amt) continue;
      out.push({
        id: String(l.id ?? `log-${out.length}`),
        tanggal: String(l.trxDate ?? '').slice(0, 10),
        keterangan: String(l.trxType ?? tOf('mem_txn_fallback', lang)),
        nominal: amt,
      });
    }
  } catch {
    /* abaikan */
  }
  try {
    const sales = await query<{
      salesNum: string | null; salesDate: string | null;
      grandTotal: number | null; paymentMethod: string | null;
    }>(
      'SELECT salesNum, salesDate, grandTotal, paymentMethod FROM tr_saleshead WHERE memberId = ? ORDER BY salesDate DESC LIMIT 50',
      [memberId],
    );
    for (const sh of sales) {
      const total = Math.round(Number(sh.grandTotal) || 0);
      if (total <= 0) continue;
      out.push({
        id: String(sh.salesNum ?? `sale-${out.length}`),
        tanggal: String(sh.salesDate ?? '').slice(0, 10),
        keterangan: tOf('mem_pay_line', lang).replace('{n}', String(sh.salesNum ?? '')).replace('{m}', String(sh.paymentMethod ?? '')),
        nominal: -total,
      });
    }
  } catch {
    /* abaikan */
  }
  return out;
}

/** Deposit cepat minimal 10000 rupiah (lihat MIN_TOPUP) - sama dengan layar Top Up Deposit. */
const MIN_TOPUP = 10000;

/** Samarkan nomor HP di daftar: 0812---7890 (privasi kasir). */
function maskHp(hp: string): string {
  const d = hp.replace(/[^0-9]/g, '');
  if (d.length < 7) return hp;
  return `${d.slice(0, 4)}---${d.slice(-4)}`;
}

/** Member baru: catat ke outbox + antrean sync (offline-first), lalu POST ke
 * endpoint register-member saat online. Offline apiFetch jatuh ke dummy lokal
 * dan data tetap antre via outbox untuk push berikutnya. Email (M1) ikut
 * payload bila diisi; server yang tak kenal field mengabaikannya. */
async function persistMember(id: string, nama: string, noHp: string, email?: string): Promise<void> {
  const mail = String(email ?? '').trim();
  try {
    await enqueueOutbox('ms_member', id, 'insert');
  } catch {
    /* abaikan */
  }
  try {
    enqueueSync('other', { kind: 'member-register', memberId: id, nama, noHp, ...(mail ? { email: mail } : {}) });
  } catch {
    /* abaikan */
  }
  try {
    await apiFetch(ApiPath.registerMember, { body: { memberId: id, name: nama, phone: noHp, ...(mail ? { email: mail } : {}) } });
  } catch {
    /* offline - terkirim via push berikutnya */
  }
}

/**
 * Deposit member ikut kontrak §5.2 seperti TopupDepositScreen: POST
 * member-deposit-withdrawal/topup {memberId, amount, paymentMethod, note}.
 * inquiry-deposit hanya untuk cek saldo, bukan top up.
 *
 * SINGLE-POST (satu-satunya jalur tulis deposit layar ini): satu tap = SATU
 * kunci `dep-…` bersama untuk ledger + fisik + light + direct
 * (direct-or-one-light). Light 'member-deposit' terpisah DIHAPUS — yang hidup
 * hanya light kind 'deposit-topup' (routing pathFor tak diubah agar antrean
 * warisan tetap terkuras). Selalu catat lokal dulu agar aman offline.
 */
async function persistDeposit(memberId: string, amount: number, via: string): Promise<void> {
  // 'cepat' adalah label UI deposit cepat - kirim metode bayar yang dikenal server.
  const paymentMethod = via === 'cepat' ? 'Tunai' : via;
  // SATU kunci idempotensi untuk semua kanal tap ini.
  const key = newDepositKey();
  // Lokal dulu: bump saldo + ledger (id = kunci bersama) + fisik SAJA.
  try {
    await initDb();
    await run('UPDATE ms_member SET depositBalance = COALESCE(depositBalance, 0) + ?, syncDate = NULL WHERE id = ?', [amount, memberId]);
    let after: number | null = null;
    try {
      const cur = await queryFirst<{ depositBalance: number | null }>(
        'SELECT depositBalance FROM ms_member WHERE id = ? LIMIT 1',
        [memberId],
      );
      after = Math.max(0, Math.round(Number(cur?.depositBalance) || 0));
    } catch {
      /* balanceAfter boleh null — saldo ms_member tetap naik */
    }
    const nowIso = new Date().toISOString();
    // WIRE-APPROVAL: baris ledger wajib membawa branchId sesi/binding
    // (paritas TopupDepositScreen/sales.ts) agar push + rekap per cabang benar.
    // Ledger juga mencatat id kasir (kolom userId sudah ada di skema).
    const depUser = getSession()?.userId || getSession()?.username || null;
    await run(
      'INSERT OR IGNORE INTO tr_memberdeposit (id, memberId, branchId, trxType, amount, balanceAfter, userId, trxDate, syncDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
      [key, memberId, getTerminal().branchId || null, 'topup', amount, after, depUser, nowIso],
    );
  } catch {
    /* abaikan - outbox + direct di bawah tetap jalan */
  }
  try {
    await enqueueOutbox('ms_member', memberId, 'update');
  } catch {
    /* abaikan */
  }
  try {
    // Fisik SAJA (tanpa light generik kembar {table,rowId,op}).
    await enqueueOutboxPhysical('tr_memberdeposit', key, 'insert');
  } catch {
    /* abaikan */
  }
  // Direct-or-one-light dengan kunci yang sama; light twin HANYA bila direct
  // tak posted (offline/gagal/timeout).
  let posted = false;
  try {
    posted = (await postDepositOnce({ key, memberId, amount, method: paymentMethod, note: 'Deposit cepat Member' })).posted;
  } catch {
    posted = false;
  }
  if (!posted) {
    try {
      // Alias kanonis kontrak §5.2 (amount/paymentMethod) di samping kunci
      // ringan lama (nominal/method) agar server ketat tetap memproses retry.
      enqueueSync('other', { kind: 'deposit-topup', memberId, nominal: amount, method: paymentMethod, amount, paymentMethod, clientId: key }, key);
    } catch {
      /* abaikan */
    }
  }
}

export default function MemberScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Member punya dua peran: layar akar drawer (dibuka dari sidebar/dashboard,
  // tanpa params alur) vs layar anak alur transaksi (dibuka dari
  // Pay/BillPreview/Cashier dengan from/returnTo/konteks order). Anak alur =
  // header onBack-only TANPA burger/drawer; akar drawer = burger + drawer.
  const callerParams = route?.params;
  const openedFromFlow = Boolean(
    callerParams?.from || callerParams?.returnTo ||
    callerParams?.items != null || callerParams?.total != null,
  );
  const [q, setQ] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [riwayat, setRiwayat] = useState<Record<string, Riwayat[]>>({});
  const [selected, setSelected] = useState<Member | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [depositVisible, setDepositVisible] = useState(false);
  const [depositNominal, setDepositNominal] = useState('');
  const [depositErr, setDepositErr] = useState('');
  // Guard ketuk-ganda deposit cepat: ref sinkron (anti-interleave antar-tap)
  // + state untuk menonaktifkan tombol modal selama menyimpan.
  const depositBusy = useRef(false);
  const [depositSaving, setDepositSaving] = useState(false);
  // U4: error gerbang identitas tambah-member (tampil di modal tambah).
  const [addErr, setAddErr] = useState('');
  // Saldo inquiry server untuk member terpilih (null = belum ada / hanya dummy).
  const [inquiry, setInquiry] = useState<{ saldo: number; poin: number } | null>(null);
  // Ronde-3 Q1/Q5: peta lokal-id → customerId GO hasil resolve search server.
  // Terapkan WAJIB resolve via searchCustomers sebelum tempel (attach tanpa
  // GO id = diblokir + toast, bukan fallback alias).
  const localToServer = useRef(new Map<string, number>());
  // Ronde-3 Q5: gate lookup/search server (absen = enabled).
  const [lookupEnabled, setLookupEnabled] = useState(true);
  // Ronde-3 Q1: pesan blokir tempel (member tanpa customerId GO).
  const [applyErr, setApplyErr] = useState('');
  // WIRE REA-3: saldo via erp/member balance-deposit di samping inquiry-deposit
  // (best-effort - null = belum ada / hanya dummy, cache lokal tetap dipakai).
  const [erpBalance, setErpBalance] = useState<number | null>(null);
  // Riwayat server per member (kosong = fallback cache lokal `riwayat`).
  const [serverHistory, setServerHistory] = useState<Riwayat[]>([]);

  // Riwayat member diambil dari server - guard online; offline tampilkan cache lokal.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    Network.getNetworkStateAsync()
      .then((ns) => { if (live) setOnline(ns.isConnected ?? true); })
      .catch(() => { if (live) setOnline(true); });
    return () => { live = false; };
  }, [selected]);

  // Member dari SQLite ms_member dulu (offline-first: seed/pull/koleksi
  // nyata), lalu pengayaan dari server bila ada. Kosong = empty-state.
  // Ronde-3 Q5: flag gate lookup dibaca sekali saat mount (cache pos-config;
  // absen = enabled).
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const v = await getMemberLookupEnabled();
        if (live) setLookupEnabled(v);
      } catch {
        /* absen = enabled */
      }
    })();
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const local = await loadMembersFromSqlite();
        if (live && local.length > 0) {
          setMembers(local);
        }
      } catch {
        /* SQLite belum siap - lanjut API */
      }
      try {
        const res = await apiFetch(ApiPath.pullMember, { method: 'GET' });
        const { data } = unwrap<{ items?: Record<string, unknown>[] }>(res.data);
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!live || items.length === 0) return;
        // M1: poin = nilai server apa adanya (server-wins). Overlay lokal
        // tak mencetak poin; cache hanya ditulis dari angka server.
        const mapped: Member[] = [];
        for (const [idx, it] of items.entries()) {
          const nama = String(it.name ?? it.memberName ?? '').trim();
          const id = String(it.memberId ?? it.id ?? '').trim() || `M${String(idx + 1).padStart(3, '0')}`;
          if (!id || !nama) continue;
          const tierRaw = String(it.tier ?? 'Regular');
          const pts = Math.max(0, Math.round(Number(it.points ?? 0) || 0));
          mapped.push({
            id,
            nama,
            noHp: String(it.phone ?? ''),
            email: String(it.email ?? ''),
            tipe: tierRaw.charAt(0).toUpperCase() + tierRaw.slice(1).toLowerCase(),
            saldo: Math.max(0, Math.round(Number(it.balance ?? it.depositBalance ?? 0) || 0)),
            poin: pts,
            loyalty: false,
          });
          void cacheServerPoints(id, pts);
        }
        if (!live || mapped.length === 0) return;
        setMembers(mapped);
        setSelected((sb) => (sb ? mapped.find((m) => m.id === sb.id) ?? sb : sb));
      } catch {
        /* offline - koleksi SQLite tetap dipakai */
      }
    })();
    return () => { live = false; };
  }, []);

  // M1: pencarian server via /customers/search (GET ?q,take, debounce 400ms,
  // hanya saat online + kata kunci tak kosong). Baris server dicocokkan ke
  // koleksi lokal via id materialisasi (MC{id}), digit HP, atau email; cocok =
  // gabung (email/poin/loyalty dari server, server-wins); tak cocok =
  // materialisasi ke ms_member (id `MC{id}`) agar alur deposit/terapkan tetap
  // memakai identitas lokal. Gagal/offline = koleksi lokal tetap dipakai.
  useEffect(() => {
    const keyword = q.trim();
    // Ronde-3 Q5: lookup server digate pos-config (mati = koleksi lokal saja).
    if (keyword.length === 0 || !online || !lookupEnabled) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await searchServerCustomers(keyword, 20);
          if (!live || !res.ok) return;
          const rows = res.data;
          if (rows.length === 0) return;
          await initDb();
          const local = await loadMembersFromSqlite();
          const byId = new Map(local.map((m) => [m.id, m]));
          const byPhone = new Map<string, Member>();
          const byEmail = new Map<string, Member>();
          for (const m of local) {
            const pk = phoneKey(m.noHp);
            if (pk && !byPhone.has(pk)) byPhone.set(pk, m);
            const ek = m.email.trim().toLowerCase();
            if (ek && !byEmail.has(ek)) byEmail.set(ek, m);
          }
          const merged: Member[] = [...local];
          let dirty = false;
          for (const r of rows) {
            const rName = String(r.name ?? '').trim();
            if (!rName) continue;
            const rPhone = String(r.phone ?? '').trim();
            const rEmail = String(r.email ?? '').trim();
            // Ronde-3 Q1: kunci lokal = turunan deterministik customerId GO
            // (satu-satunya produsen format MC — JANGAN inline `MC${}`).
            const mcId = localMemberKeyForCustomer(r.id);
            const hit =
              (mcId ? byId.get(mcId) : undefined) ??
              (rPhone ? byPhone.get(phoneKey(rPhone)) : undefined) ??
              (rEmail ? byEmail.get(rEmail.toLowerCase()) : undefined);
            if (hit) {
              // Resolve: alias lokal ini = customerId GO r.id.
              localToServer.current.set(hit.id, r.id);
              const next: Member = {
                ...hit,
                nama: rName || hit.nama,
                noHp: rPhone || hit.noHp,
                email: rEmail || hit.email,
                poin: r.pointsBalance,
                loyalty: r.loyaltyMember || hit.loyalty,
              };
              const idx = merged.findIndex((m) => m.id === hit.id);
              if (idx >= 0) merged[idx] = next;
              void cacheServerPoints(hit.id, r.pointsBalance);
              if (rEmail && rEmail !== hit.email) {
                try {
                  await run('UPDATE ms_member SET email = ?, syncDate = NULL WHERE id = ?', [rEmail, hit.id]);
                } catch {
                  /* abaikan */
                }
              }
              dirty = true;
            } else {
              if (!mcId) continue;
              const nid = mcId;
              if (byId.has(nid)) continue;
              // Resolve: materialisasi lokal = customerId GO r.id.
              localToServer.current.set(nid, r.id);
              const nm = { id: nid, nama: rName, noHp: rPhone, email: rEmail, tipe: 'Regular', saldo: 0, poin: r.pointsBalance, loyalty: r.loyaltyMember };
              try {
                await run(
                  'INSERT OR IGNORE INTO ms_member (id, memberName, phone, email, depositBalance, syncDate) VALUES (?, ?, ?, ?, 0, NULL)',
                  [nid, rName, rPhone || null, rEmail || null],
                );
              } catch {
                /* abaikan - state memori tetap jalan */
              }
              merged.push(nm);
              byId.set(nid, nm);
              void cacheServerPoints(nid, r.pointsBalance);
              dirty = true;
            }
          }
          if (live && dirty) {
            merged.sort((a, b) => a.nama.localeCompare(b.nama));
            setMembers(merged);
            setSelected((sb) => (sb ? merged.find((m) => m.id === sb.id) ?? sb : sb));
          }
        } catch {
          /* offline/gagal - koleksi lokal tetap dipakai */
        }
      })();
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, online, lookupEnabled]);

  // Saldo inquiry server untuk member terpilih (inquiry-deposit hanya cek saldo,
  // bukan top up). Dummy Mode selalu fromDummy + menggemakan M001 - hanya
  // tampilkan bila respons backend asli (bukan dummy) dan memberId cocok,
  // agar tidak menyesatkan kasir.
  useEffect(() => {
    if (!selected) {
      setInquiry(null);
      return;
    }
    let live = true;
    const mid = selected.id;
    const localPoin = selected.poin;
    setInquiry(null);
    (async () => {
      try {
        const res = await apiFetch(ApiPath.depositInquiry, { body: { memberId: mid } });
        if (!live || res.fromDummy) return;
        const { data } = unwrap<Record<string, unknown>>(res.data);
        const echo = String(data.memberId ?? '');
        if (echo && echo !== mid) return;
        const saldo = Number(data.saldo ?? data.balance ?? NaN);
        if (!live || !Number.isFinite(saldo)) return;
        const poin = Number(data.poin ?? data.points ?? NaN);
        // M1: poin server menang; tanpa angka server = cache lokal tetap.
        const poinEff = Number.isFinite(poin) ? Math.max(0, Math.round(poin)) : localPoin;
        setInquiry({
          saldo: Math.max(0, Math.round(saldo)),
          poin: poinEff,
        });
        if (Number.isFinite(poin)) {
          void cacheServerPoints(mid, poinEff);
        }
      } catch {
        /* offline - kartu memakai cache lokal */
      }
    })();
    return () => { live = false; };
  }, [selected]);

  // WIRE REA-3: saldo ERP (erp/member balance-deposit) sebagai jalur kedua di
  // samping inquiry-deposit. Guard sama: hanya backend asli + memberId cocok.
  useEffect(() => {
    if (!selected) {
      setErpBalance(null);
      return;
    }
    let live = true;
    const mid = selected.id;
    setErpBalance(null);
    (async () => {
      try {
        const res = await memberErpApi('balance-deposit', { memberId: mid, branchId: getTerminal().branchId });
        if (!live || res.fromDummy) return;
        const { data } = unwrap<Record<string, unknown>>(res.data);
        const echo = String(data.memberId ?? '');
        if (echo && echo !== mid) return;
        const saldo = Number(data.saldo ?? data.balance ?? data.depositBalance ?? NaN);
        if (!live || !Number.isFinite(saldo)) return;
        setErpBalance(Math.max(0, Math.round(saldo)));
      } catch {
        /* offline - fallback inquiry/cache lokal */
      }
    })();
    return () => { live = false; };
  }, [selected]);

  // Riwayat nyata per member: SQLite dulu (tr_memberdeposit /
  // tr_membertransactionlog / tr_saleshead), lalu saring pullSales server
  // bila online. Kosong = belum ada transaksi (empty-state riwayat).
  useEffect(() => {
    if (!selected) {
      setServerHistory([]);
      return;
    }
    let live = true;
    const mid = selected.id;
    const nama = selected.nama;
    (async () => {
      try {
        const local = await loadMemberHistoryFromSqlite(mid, lang);
        if (live) {
          setRiwayat((rw) => ({ ...rw, [mid]: local }));
        }
      } catch {
        /* abaikan - lanjut server */
      }
      if (!online) {
        if (live) setServerHistory([]);
        return;
      }
      try {
        const res = await apiFetch(ApiPath.pullSales, { method: 'GET' });
        const { data } = unwrap<{ items?: Record<string, unknown>[] }>(res.data);
        const items = Array.isArray(data?.items) ? data.items : [];
        const rows: Riwayat[] = [];
        for (const it of items) {
          const cust = String(it.customerName ?? '');
          const m = String(it.memberId ?? '');
          if (cust !== nama && m !== mid) continue;
          const total = Math.round(Number(it.grandTotal ?? 0) || 0);
          if (total <= 0) continue;
          rows.push({
            id: String(it.salesNum ?? `srv-${rows.length}`),
            tanggal: String(it.salesDate ?? '').slice(0, 10),
            keterangan: t('mem_pay_line').replace('{n}', String(it.salesNum ?? '')).replace('{m}', String(it.paymentMethod ?? '')),
            nominal: -total,
          });
        }
        if (live) setServerHistory(rows);
      } catch {
        if (live) setServerHistory([]);
      }
    })();
    return () => { live = false; };
  }, [selected, online]);

  /** Terima saldo baru dari layar Top Up Deposit: saldo + riwayat ikut bertambah. */
  useEffect(() => {
    const mid = route?.params?.memberId;
    const baru = route?.params?.saldoBaru;
    const topup = route?.params?.topupNominal;
    if (!mid || typeof baru !== 'number') return;
    setMembers((ms) => ms.map((m) => (m.id === mid ? { ...m, saldo: baru } : m)));
    setSelected((sb) => (sb && sb.id === mid ? { ...sb, saldo: baru } : sb));
    // M1: tanpa earn poin lokal — poin milik loyalty server (muncul via pull /
    // search / inquiry berikutnya). Param topupNominal warisan diabaikan.
    setRiwayat((rw) => ({
      ...rw,
      [mid]: [
        // Riwayat mencatat nominal top up-nya, bukan saldo akhir.
        { id: `r-${Date.now()}`, tanggal: fmtDate(new Date(), lang), keterangan: t('mem_topup_full'), nominal: typeof topup === 'number' ? topup : baru },
        ...(rw[mid] ?? []),
      ],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Form tambah member
  const [nama, setNama] = useState('');
  const [noHp, setNoHp] = useState('');
  const [email, setEmail] = useState('');
  const [tglLahir, setTglLahir] = useState('');

  const hasil =
    q.trim().length === 0
      ? members
      : members.filter(
          (m) =>
            m.nama.toLowerCase().includes(q.toLowerCase()) ||
            m.noHp.includes(q) ||
            m.email.toLowerCase().includes(q.toLowerCase()) ||
            m.id.toLowerCase().includes(q.toLowerCase()),
        );

  const saveMember = async () => {
    // U4: member-create = gerbang identitas (bound terminal + shift buka, fail-closed).
    if (!getBranchId().trim()) {
      setAddErr(t('terminal_unbound_hint'));
      return;
    }
    if (!(await hasOpenShift())) {
      setAddErr(`${t('dash_shift_closed')} - ${t('shf_open_btn')}`);
      return;
    }
    // M1: email opsional, tetapi bila diisi harus valid (dipakai struk email).
    const mail = email.trim();
    if (mail && !isValidEmail(mail)) {
      setAddErr(t('mem_email_bad'));
      return;
    }
    setAddErr('');
    if (nama.trim() && noHp.trim()) {
      const id = `M${String(Date.now()).slice(-6)}`;
      const nm = nama.trim();
      const hp = noHp.trim();
      void persistMember(id, nm, hp, mail || undefined);
      // Simpan koleksi nyata ke SQLite ms_member agar bertahan offline.
      void (async () => {
        try {
          await initDb();
          await run(
            'INSERT OR REPLACE INTO ms_member (id, memberName, phone, email, depositBalance, syncDate) VALUES (?, ?, ?, ?, 0, NULL)',
            [id, nm, hp, mail || null],
          );
        } catch {
          /* abaikan - state memori tetap jalan */
        }
      })();
      setMembers((ms) => [...ms, { id, nama: nm, noHp: hp, email: mail, tipe: 'Regular', saldo: 0, poin: 0, loyalty: false }]);
      setRiwayat((rw) => ({ ...rw, [id]: [] }));
    }
    setAddVisible(false);
    setNama('');
    setNoHp('');
    setEmail('');
    setTglLahir('');
  };

  const saveDeposit = async () => {
    // Guard ketuk-ganda: set SEBELUM await pertama agar tap kedua yang datang
    // saat gerbang identitas/persist menunggu langsung ditolak.
    if (depositBusy.current || depositSaving) return;
    depositBusy.current = true;
    setDepositSaving(true);
    try {
      const n = Number(depositNominal) || 0;
      if (!selected) {
        setDepositVisible(false);
        setDepositNominal('');
        setDepositErr('');
        return;
      }
      // U3: deposit-save = gerbang bound terminal + shift buka (fail-closed).
      if (!getBranchId().trim()) {
        setDepositErr(t('terminal_unbound_hint'));
        return;
      }
      if (!(await hasOpenShift())) {
        setDepositErr(`${t('dash_shift_closed')} - ${t('shf_open_btn')}`);
        return;
      }
      // Deposit cepat menolak nominal di bawah MIN_TOPUP dengan pesan.
      if (n < MIN_TOPUP) {
        setDepositErr(t('top_hint').replace('{m}', rp(MIN_TOPUP)));
        return;
      }
      setDepositErr('');
      const mid = selected.id;
      // SATU jalur tulis (persistDeposit): lokal + fisik + direct-or-one-light
      // dengan satu kunci bersama. Blok ledger inline ganda DIHAPUS.
      // M1: tanpa earn poin lokal — poin milik loyalty server.
      await persistDeposit(mid, n, 'cepat');
      setMembers((ms) =>
        ms.map((m) =>
          m.id === mid ? { ...m, saldo: m.saldo + n } : m,
        ),
      );
      setSelected((sb) =>
        sb ? { ...sb, saldo: sb.saldo + n } : sb,
      );
      setRiwayat((rw) => ({
        ...rw,
        [mid]: [
          { id: `r-${Date.now()}`, tanggal: fmtDate(new Date(), lang), keterangan: t('mem_topup_quick'), nominal: n },
          ...(rw[mid] ?? []),
        ],
      }));
      setDepositVisible(false);
      setDepositNominal('');
    } finally {
      depositBusy.current = false;
      setDepositSaving(false);
    }
  };

  const goTopup = () => {
    if (!selected) return;
    setDepositVisible(false);
    setDepositErr('');
    navigation?.navigate('TopupDeposit', { memberId: selected.id, nama: selected.nama, saldo: selected.saldo });
  };

  /** Terapkan member: SELALU kembali ke layar pemanggil, tidak pernah
   * menebak tujuan. `navigate` ke rute yang sudah ada di stack akan kembali
   * ke instance itu (merge params), bukan menumpuk layar baru - sehingga
   * order/bill context pemanggil tidak hilang:
   * - returnTo eksplisit -> ke rute itu;
   * - from === 'Pay' -> kembali ke Pay yang sama (bukan Pay baru);
   * - from lain -> kembali ke rute bernama itu;
   * - konteks order tanpa from (BillPreview) -> kembali ke BillPreview
   *   yang sama, BUKAN lompat ke Cashier;
   * - standalone (sidebar/dashboard) -> ke Cashier, BUKAN ke Pay. */
  const applyMember = () => {
    if (!selected) return;
    // Ronde-3 Q1: tempel WAJIB customerId GO hasil resolve search server.
    // Kunci lokal MC{id} → parse langsung; alias lain → peta resolve; tanpa
    // keduanya = blokir + pesan (bukan fallback alias ke payload).
    const customerId =
      customerIdFromLocalKey(selected.id) ??
      localToServer.current.get(selected.id) ??
      parseCustomerId(selected.id);
    if (customerId == null) {
      setApplyErr(t('mem_attach_needs_go'));
      return;
    }
    setApplyErr('');
    const p = route?.params;
    const memberPick = {
      memberId: selected.id,
      nama: selected.nama,
      saldo: selected.saldo,
      customerId,
      memberPoin: selected.poin,
    };
    const ctx = {
      ...memberPick,
      ...(p?.total != null ? { total: p.total } : {}),
      ...(p?.items ? { items: p.items } : {}),
      ...(p?.method ? { method: p.method } : {}),
      ...(p?.mode ? { mode: p.mode } : {}),
      ...(p?.table ? { table: p.table } : {}),
      ...(p?.ongkir != null ? { ongkir: p.ongkir } : {}),
      ...(p?.ongkirCut != null ? { ongkirCut: p.ongkirCut } : {}),
      ...(p?.customer ? { customer: p.customer } : {}),
      ...(p?.voucher != null ? { voucher: p.voucher } : {}),
      ...(p?.voucherCode ? { voucherCode: p.voucherCode } : {}),
      ...(p?.discount != null ? { discount: p.discount } : {}),
      ...(p?.service != null ? { service: p.service } : {}),
      ...(p?.tax != null ? { tax: p.tax } : {}),
      ...(p?.rounding != null ? { rounding: p.rounding } : {}),
      ...(p?.feeESB != null ? { feeESB: p.feeESB } : {}),
      ...(p?.packaging != null ? { packaging: p.packaging } : {}),
      ...(p?.tip != null ? { tip: p.tip } : {}),
    };
    if (typeof p?.returnTo === 'string' && p.returnTo) {
      navigation?.navigate(p.returnTo, ctx);
      return;
    }
    if (typeof p?.from === 'string' && p.from) {
      navigation?.navigate(p.from, ctx);
      return;
    }
    if (p?.items != null || p?.total != null) {
      navigation?.navigate('BillPreview', ctx);
      return;
    }
    navigation?.navigate('Cashier', memberPick);
  };

  const list = (
    <ScrollView contentContainerStyle={s.body}>
      <Text style={s.count}>
        {hasil.length} {t('mem_registered')}{q.trim() ? t('mem_search_suffix').replace('{q}', q.trim()) : ''}
      </Text>
      {hasil.length === 0 ? (
        <View style={s.empty}>
          <Image source={require('../../../assets/images/member_not_found.webp')} style={s.emptyImg} resizeMode="contain" />
          <Text style={s.emptyTitle}>{t('mem_not_found')}</Text>
          <Text style={s.emptySub}>{t('mem_not_found_sub')}</Text>
          <AppButton size="md" title={t('mem_add_new')} onPress={() => setAddVisible(true)} />
        </View>
      ) : (
        hasil.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={[s.card, selected?.id === m.id && s.cardActive]}
            onPress={() => { setSelected(m); setApplyErr(''); }}>
            <View style={s.cardTop}>
              <View style={s.avatar}>
                <Text style={s.avatarTxt}>{m.nama.charAt(0)}</Text>
              </View>
              <View style={s.cardInfo}>
                <Text style={s.cardName}>{m.nama}</Text>
                <Text style={s.cardMeta}>
                  {m.id} - {maskHp(m.noHp)}
                </Text>
                {m.email ? (
                  <Text style={s.cardMeta} numberOfLines={1}>{m.email}</Text>
                ) : null}
                <Text style={[s.cardTipe, m.tipe === 'Gold' ? s.cardTipeGold : s.cardTipeReg]}>{m.tipe} Member{m.tipe === 'Gold' ? ' ★' : ''}</Text>
              </View>
            </View>
            <View style={s.cardBottom}>
              <Text style={s.saldoTxt}>{t('mem_balance')} {rp(m.saldo)}</Text>
              <Text style={s.poinTxt}>{m.poin} {t('mem_points')}</Text>
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );

  // Riwayat tampil: server dulu bila ada, lalu riwayat nyata SQLite/lokal.
  // Kosong = belum ada transaksi (empty-state riwayat).
  const historyList = selected
    ? (serverHistory.length > 0 ? serverHistory : (riwayat[selected.id] ?? []))
    : [];

  const detail = (
    <View style={s.detailSide}>
      {selected ? (
        <ScrollView contentContainerStyle={s.detailScroll}>
          <View style={s.memberCardWrap}>
            <Image source={require('../../../assets/images/member_card.webp')} style={s.memberCardImg} resizeMode="cover" />
            <View style={s.memberCardOverlay}>
              <Text style={s.memberCardName}>{selected.nama}</Text>
              <Text style={s.memberCardId}>{selected.id} - {selected.tipe}</Text>
              <Text style={s.memberCardSaldo}>{rp(selected.saldo)}</Text>
              <Text style={s.memberCardPoin}>{selected.poin} {t('mem_points')}</Text>
            </View>
          </View>
          <Text style={s.detailMeta}>
            {selected.id} - {maskHp(selected.noHp)}
          </Text>
          {selected.email ? (
            <Text style={s.detailMeta}>{selected.email}</Text>
          ) : null}
          <View style={s.detailStats}>
            <View style={s.detailStat}>
              <Text style={s.detailStatLabel}>{t('mem_balance')}</Text>
              <Text style={s.detailStatValue}>{rp(selected.saldo)}</Text>
            </View>
            <View style={s.detailStat}>
              <Text style={s.detailStatLabel}>{t('mem_points')}</Text>
              <Text style={s.detailStatValue}>{selected.poin} {t('mem_points')}</Text>
            </View>
          </View>
          {inquiry ? (
            <Text style={s.serverSaldo}>
              {t('mem_erp_balance')}: {rp(inquiry.saldo)}
            </Text>
          ) : erpBalance != null ? (
            <Text style={s.serverSaldo}>
              {t('mem_erp_balance')}: {rp(erpBalance)}
            </Text>
          ) : null}
          <Text style={s.riwayatTitle}>{t('mem_history')}</Text>
          {!online && (
            <Text style={s.offlineNote}>{t('mem_offline_note')}</Text>
          )}
          {historyList.map((r) => (
            <View key={r.id} style={s.riwayatRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.riwayatKet}>{r.keterangan}</Text>
                <Text style={s.riwayatTgl}>{r.tanggal}</Text>
              </View>
              <Text style={s.riwayatNominal}>
                {r.nominal != null
                  ? `${r.nominal < 0 ? '-' : '+'}${rp(Math.abs(r.nominal))}`
                  : `+${r.poin} poin`}
              </Text>
            </View>
          ))}
          {historyList.length === 0 && (
            <Text style={s.emptySub}>{t('mem_no_history')}</Text>
          )}
          <AppButton
            size="md"
            title={t('mem_deposit')}
            variant="secondary"
            onPress={() => setDepositVisible(true)}
          />
          <AppButton size="md" title={t('mem_apply')} onPress={applyMember} />
          {applyErr ? <Text style={s.minErr}>{applyErr}</Text> : null}
        </ScrollView>
      ) : (
        <View style={s.detailEmpty}>
          <Text style={s.emptyTitle}>{t('mem_pick')}</Text>
          <Text style={s.emptySub}>{t('mem_pick_sub')}</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={s.root}>
      <ScreenHeader
        title={t('mem_title')}
        sub={`${members.length} ${t('mem_registered')}`}
        {...(openedFromFlow
          ? { onBack: () => navigation?.goBack() }
          : {
              left: (
                <Pressable onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
                  <Image source={require('../../../assets/icons/burger.webp')} style={s.burger} resizeMode="contain" />
                </Pressable>
              ),
            })}
      />
      {openedFromFlow ? null : (
        <DrawerMenu
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          navigate={(r) => navigation?.navigate(r)}
        />
      )}

      <View style={s.searchWrap}>
        <View style={[s.searchInner, isTablet && wideCenterLg]}>
          <View style={s.searchRow}>
            <View style={s.searchField}>
              <AppInput
                placeholder={t('mem_search_ph')}
                accessibilityLabel={t('mem_search_label')}
                value={q}
                onChangeText={setQ}
                boxStyle={s.searchBox}
                style={s.searchFieldText}
              />
            </View>
            <TouchableOpacity
              style={s.searchAction}
              onPress={() => setAddVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={t('mem_add_new')}>
              <Text style={s.searchActionTxt}>{t('mem_new')}</Text>
            </TouchableOpacity>
          </View>
          <View style={s.searchLinks}>
            <TouchableOpacity onPress={() => navigation?.navigate('QrScan')}>
              <Text style={s.searchLink}>{t('mem_scan')} ›</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation?.navigate('Voucher')}>
              <Text style={s.searchLink}>{t('mem_voucher')} ›</Text>
            </TouchableOpacity>
          </View>
          {/* Ronde-3 Q5: lookup server dimatikan pos-config = catatan jujur,
              koleksi lokal tetap bisa dipakai/ditempel bila ter-resolve. */}
          {lookupEnabled ? null : (
            <Text style={s.minErr}>{t('mem_lookup_disabled')}</Text>
          )}
        </View>
      </View>

      {isTablet ? (
        <View style={[s.split, wideCenterLg]}>
          <View style={s.listSide}>{list}</View>
          {detail}
        </View>
      ) : (
        <>
          {list}
          {selected ? (
            <View style={s.selBar}>
              <View style={s.selInfo}>
                <Text style={s.selName} numberOfLines={1}>{selected.nama}</Text>
                <Text style={s.selMeta} numberOfLines={1}>{rp(selected.saldo)} · {selected.poin} {t('mem_points')}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelected(null)} hitSlop={8} accessibilityRole="button">
                <Text style={s.selClear}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {selected ? (
            <View style={s.footer}>
              <AppButton
                title={t('mem_deposit')}
                variant="secondary"
                fullWidth={false}
                style={{ flex: 1, marginTop: 0, marginRight: 8 }}
                onPress={() => setDepositVisible(true)}
              />
              <AppButton
                title={t('mem_apply')}
                fullWidth={false}
                style={{ flex: 1, marginTop: 0, marginLeft: 8 }}
                onPress={applyMember}
              />
            </View>
          ) : null}
          {selected && applyErr ? (
            <Text style={[s.minErr, { textAlign: 'center', paddingHorizontal: 16 }]}>{applyErr}</Text>
          ) : null}
        </>
      )}

      {/* Tambah member */}
      <Modal visible={addVisible} transparent animationType="slide">
        <View style={[s.modalBg, isTablet && s.modalBgTablet]}>
          <View style={[s.modalCard, isTablet && s.modalCardTablet]}>
            <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>{t('mem_add_new')}</Text>
            <AppInput
              label={t('mem_name_label')}
              placeholder={t('mem_name_ph')}
              value={nama}
              onChangeText={setNama}
            />
            <AppInput
              label={t('mem_phone_label')}
              placeholder={t('mem_phone_ph')}
              keyboardType="phone-pad"
              value={noHp}
              onChangeText={setNoHp}
            />
            <AppInput
              label={t('mem_email_label')}
              placeholder={t('mem_email_ph')}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <AppInput
              label={t('mem_dob_label')}
              placeholder={t('mem_dob_ph')}
              value={tglLahir}
              onChangeText={setTglLahir}
            />
            <AppButton size="sm" title={t('mem_save')} onPress={() => void saveMember()} />
            {addErr ? <Text style={s.minErr}>{addErr}</Text> : null}
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => { setAddVisible(false); setAddErr(''); }}>
              <Text style={s.cancelTxt}>{t('mem_cancel_add')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Deposit cepat */}
      <Modal visible={depositVisible} transparent animationType="slide">
        <View style={[s.modalBg, isTablet && s.modalBgTablet]}>
          <View style={[s.modalCard, isTablet && s.modalCardTablet]}>
            <Text style={[s.modalTitle, isTablet && s.modalTitleBig]}>{t('mem_quick_title')}</Text>
            {selected ? (
              <Text style={s.modalHint}>
                {selected.nama} - {t('mem_balance')} {rp(selected.saldo)}
              </Text>
            ) : null}
            <AppInput
              label={tCur('mem_nominal_label')}
              keyboardType="number-pad"
              placeholder="0"
              value={depositNominal ? rpNum(Number(depositNominal)) : ''}
              onChangeText={(txt) => {
                setDepositNominal(txt.replace(/\D/g, ''));
                setDepositErr('');
              }}
              error={depositErr || undefined}
              boxStyle={{ borderColor: colors.orange, backgroundColor: colors.paleOrange }}
              style={{ textAlign: 'right', fontFamily: fonts.bold, fontSize: 20 }}
            />
            <View style={s.chips}>
              {[50000, 100000, 200000, 500000].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={s.chip}
                  onPress={() => {
                    setDepositNominal(
                      String((Number(depositNominal) || 0) + n),
                    );
                    setDepositErr('');
                  }}>
                  <Text style={s.chipTxt}>+{rpNum(n)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <AppButton size="sm" title={t('mem_quick_btn')} disabled={depositSaving} onPress={() => void saveDeposit()} />
            <AppButton size="sm" title={`${t('mem_full_form')} ›`} variant="secondary" onPress={goTopup} />
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => {
                setDepositVisible(false);
                setDepositErr('');
              }}>
              <Text style={s.cancelTxt}>{t('c_cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  langTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  burger: { width: 22, height: 22 },
  searchWrap: { backgroundColor: colors.white, paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  searchInner: { width: '100%' },
  searchLinks: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchField: { flex: 1 },
  searchBox: { height: 42, paddingHorizontal: 12 },
  searchFieldText: { fontSize: 13 },
  searchAction: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  searchActionTxt: { color: colors.white, fontFamily: fonts.bold, fontSize: 12 },
  selBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 88,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selInfo: { flex: 1 },
  selName: { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
  selMeta: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted, marginTop: 2 },
  selClear: { fontSize: 14, fontFamily: fonts.bold, color: colors.muted, paddingHorizontal: 6, paddingVertical: 4 },
  searchLink: { fontFamily: fonts.semibold, fontSize: 12, color: colors.orangeDark },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 10, marginBottom: 2 },
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
  count: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginBottom: 4 },
  body: { padding: 16, paddingBottom: 160 },
  split: { flex: 1, flexDirection: 'row', width: '100%', alignSelf: 'center' },
  listSide: { flex: 1 },
  detailSide: {
    flex: 1,
    backgroundColor: colors.card,
    borderLeftWidth: 1,
    borderLeftColor: colors.line,
  },
  detailScroll: { padding: 24, alignItems: 'center', paddingBottom: 40 },
  memberCardWrap: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: colors.navy },
  memberCardImg: { width: '100%', height: 150 },
  memberCardOverlay: { position: 'absolute', left: 16, right: 16, top: 14, bottom: 14, justifyContent: 'space-between' },
  memberCardName: { fontSize: 17, fontFamily: fonts.bold, color: colors.white },
  memberCardId: { fontSize: 12, fontFamily: fonts.medium, color: colors.navyTint },
  memberCardSaldo: { fontSize: 20, fontFamily: fonts.bold, color: colors.white },
  memberCardPoin: { fontSize: 12, fontFamily: fonts.medium, color: colors.navyTint },
  detailMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 10 },
  detailStats: { flexDirection: 'row', gap: 12, marginTop: 12, marginBottom: 8 },
  detailStat: { backgroundColor: colors.bg, borderRadius: 10, padding: 12, minWidth: 130, alignItems: 'center' },
  detailStatLabel: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  detailStatValue: { fontSize: 16, fontFamily: fonts.bold, color: colors.navy, marginTop: 4 },
  serverSaldo: { fontSize: 12, fontFamily: fonts.medium, color: colors.navy, marginTop: 8 },
  riwayatTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.text, alignSelf: 'flex-start', marginTop: 12, marginBottom: 6 },
  offlineNote: { fontSize: 12, fontFamily: fonts.medium, color: colors.amberDark, alignSelf: 'flex-start', marginBottom: 6 },
  riwayatRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 10, padding: 10, marginTop: 6, width: '100%' },
  riwayatKet: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
  riwayatTgl: { fontSize: 11, fontFamily: fonts.regular, color: colors.faint, marginTop: 2 },
  riwayatNominal: { fontSize: 13, fontFamily: fonts.bold, color: colors.navy },
  detailEmpty: { alignItems: 'center', justifyContent: 'center', flex: 1, padding: 24 },
  ghostBtnFull: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 14,
  },
  applyBtnFull: {
    width: '100%',
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  cardActive: { borderColor: colors.orange },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { color: colors.white, fontSize: 18, fontFamily: fonts.bold },
  cardInfo: { marginLeft: 12, flex: 1 },
  cardName: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  cardMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  cardTipe: { fontSize: 12, fontFamily: fonts.medium },
  cardTipeReg: { color: colors.muted },
  cardTipeGold: { color: colors.orangeDark, fontFamily: fonts.bold },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  saldoTxt: { fontSize: 13, fontFamily: fonts.bold, color: colors.navy },
  poinTxt: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyImg: { width: 160, height: 120, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  emptySub: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.faint,
    marginTop: 6,
  },
  primaryBtn: {
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryTxt: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  primaryBtnOutline: {
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 10,
  },
  primaryOutlineTxt: { color: colors.navy, fontSize: 14, fontFamily: fonts.bold },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: 'row',
    padding: 16,
  },
  ghostBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginRight: 8,
  },
  ghostTxt: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  applyBtn: {
    flex: 1,
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginLeft: 8,
  },
  applyTxt: { fontSize: 14, fontFamily: fonts.bold, color: colors.white },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  // Tablet: sheet bawah jadi dialog tengah yang dibatasi lebarnya.
  modalBgTablet: { justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
  },
  // Tablet: kartu dialog tengah maxWidth 520, bukan selebar layar.
  modalCardTablet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
  },
  // Tablet: judul dialog sedikit lebih besar.
  modalTitleBig: { fontSize: 19 },
  modalHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  cancelBtn: { marginTop: 10, padding: 10, alignItems: 'center' },
  cancelTxt: { fontSize: 14, fontFamily: fonts.medium, color: colors.muted },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.orange,
    borderRadius: 10,
    paddingHorizontal: 14,
    marginTop: 4,
    backgroundColor: colors.paleOrange,
  },
  rpPrefix: { fontSize: 18, fontFamily: fonts.bold, color: colors.orange },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontFamily: fonts.bold,
    color: colors.text,
    paddingVertical: 12,
    marginLeft: 8,
    textAlign: 'right',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  minErr: { fontSize: 12, fontFamily: fonts.medium, color: colors.red, marginTop: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  chipTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
});
