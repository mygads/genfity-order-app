import { useEffect, useRef, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';import { formatCurrency } from '../../theme';import AppButton from '../../components/AppButton';import { DISPLAY_STALE_MS, isBackendConfigured, publishDisplay, refreshDisplayTransport, resolveDisplaySseTerminalId, resolvePairedKasirCode, subscribeDisplay, subscribeLocalSale } from '../../lib/display';import { getBinding, subscribeSession } from '../../session';import { getDeviceRole, normalizeTag, subscribeDeviceRole, FULL_FEATURE_TAGS } from '../../lib/deviceRole';import { useConnectivity } from '../../hooks/useConnectivity';import { onWsMessage, startRealtime, subscribeRealtimeIdle } from '../../lib/realtime';import { subscribeSseFeed, terminalFeedId } from '../../lib/sse';import { getBranchCurrency, initDb, query } from '../../lib/db';import { getBranchId, getTerminal } from '../../config/server';import { useLang,

type Lang } from '../../lib/i18n';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type ViewMode = 'queue' | 'order' | 'success';/** Order nyata via bus display/event WS; kosong jujur bila tak ada data (tanpa mock). */type LiveItem = { name: string; qty: number; price: number };const EMPTY_ITEMS: LiveItem[] = [];const EMPTY_TICKETS: string[] = [];/** Promo live dari ms_promotion (flagActive=1); null = banner disembunyikan. */type LivePromo = { code: string; name: string; value: number };/** * Layar tampilan pelanggan (customer display) fullscreen. * Keputusan eksplisit: tanpa ScreenHeader by design karena layar ini * dimirror ke tampilan pelanggan; operator pratinjau via tab mode di dalam layar. */export default function CustomerDisplayScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, setLang, t } = useLang(); const [mode, setMode] = useState<ViewMode>('queue');
  /** APP-EVENTS: kunci satu halaman per tag view (SPEC §10) —
   * view_pelanggan = cart + QR live; view_queue = papan antrean saja.
   * Tab mode, tombol call-next, dan simulasi bayar adalah pratinjau operator
   * — hanya untuk tag non-view. */
  const boundTag = (() => {
    try {
      return normalizeTag(getBinding()?.tag);
    } catch {
      return null;
    }
  })();
  const activeTag = boundTag ?? normalizeTag(getDeviceRole());
  const isCustomerView = activeTag === 'view_pelanggan';
  const isQueueBoard = activeTag === 'view_queue';
  const isLockedView = isCustomerView || isQueueBoard;
  /** D2: pasangan kasir view ini ('' = tak terikat ke kasir mana pun). */
  const pairedKasirId = (() => {
    try {
      return String(getBinding()?.pairedKasirId ?? '').trim();
    } catch {
      return '';
    }
  })();
  const isUnpairedView = isCustomerView && !pairedKasirId;
  const shownMode: ViewMode = isCustomerView ? 'order' : isQueueBoard ? 'queue' : mode;
  /** APP-EVENTS liveness (§11.4 TRANSPORT): SSE primer per-feed (sseOk) + WS
   * sekunder; poll SQLite fallback WAJIB berpenanda stale (D3/D4);
   * QR/bayar diblokir offline. */
  const { online } = useConnectivity();
  /** D16: status feed SSE milik view ini (per-feed, bukan agregat modul) —
   * langganan dipasang di efek [uiTick] di bawah agar ikut re-bind. */
  const [sseOk, setSseOk] = useState(false);
  /** EFF-09: idle realtime pasca-MAX_RETRY dimunculkan ke UI (jangan diam). */
  const [rtIdle, setRtIdle] = useState(false);
  useEffect(() => subscribeRealtimeIdle(setRtIdle), []);
  const [lastDataAt, setLastDataAt] = useState<number | null>(null);
  /** GAP-19: cermin jam live untuk poll fallback (ref agar closure interval tak basi). */
  const liveAtRef = useRef<number | null>(null);
  useEffect(() => { liveAtRef.current = lastDataAt; }, [lastDataAt]);
  /** D4: jam poll fallback (tak dipakai label umur — label dari jam live). */
  const [, setLastPollAt] = useState<number | null>(null);
  /** D3-06: true bila device belum ter-bound — daftar dikosongkan + prompt ikat. */
  const [needBind, setNeedBind] = useState(false);
  const [uiTick, setUiTick] = useState(0);
  // EFF-09: tick render label umur-data 30 dtk (selaras DISPLAY_STALE_MS),
  // bukan 10 dtk — event live datang via SSE/WS/bus lokal (event-driven);
  // poll SQLite fallback di bawah tetap ber-gate SSE + berpenanda stale.
  useEffect(() => {
    const id = setInterval(() => setUiTick((x) => x + 1), 30000);
    const un1 = subscribeSession(() => setUiTick((x) => x + 1));
    const un2 = subscribeDeviceRole(() => setUiTick((x) => x + 1));
    return () => {
      clearInterval(id);
      un1();
      un2();
    };
  }, []);
  /** D16: status feed SSE milik view ini saja (bukan agregat modul). */
  useEffect(() => {
    try {
      return subscribeSseFeed(terminalFeedId(resolveDisplaySseTerminalId()), (s) => setSseOk(s === 'online'));
    } catch {
      return undefined;
    }
  }, [uiTick]);
  /** D10: transport ulang saat sesi/peran/terminal berubah (idempoten — tanpa
   * teardown bila feed sama, anti reconnect storm). */
  useEffect(() => {
    try {
      refreshDisplayTransport();
    } catch {
      /* abaikan */
    }
  }, [uiTick]);
  const staleAgeSec = lastDataAt === null ? null : Math.max(0, Math.round((Date.now() - lastDataAt) / 1000));
  const staleAgeLabel = staleAgeSec === null ? null : staleAgeSec < 120 ? `${staleAgeSec}s` : `${Math.floor(staleAgeSec / 60)}m`;
  /** D3: banner basi bila feed primer tak live ATAU jam live basi — kaki WS
   * tak menyembunyikan staleness poll. D4: jam live hanya dari kaki live. */
  const liveAgeMs = lastDataAt === null ? -1 : Math.max(0, Date.now() - lastDataAt);
  const showStaleBanner = !sseOk || liveAgeMs < 0 || liveAgeMs > DISPLAY_STALE_MS;
  const [ready, setReady] = useState<string[]>(EMPTY_TICKETS);
  const [prep, setPrep] = useState<string[]>(EMPTY_TICKETS);
  const [liveItems, setLiveItems] = useState<LiveItem[]>(EMPTY_ITEMS);
  const [promo, setPromo] = useState<LivePromo | null>(null);
  /** Mata uang cabang (ms_setting Branch/Currency); '' = fallback IDR via formatCurrency. */
  const [currency, setCurrency] = useState('');
  /** Nama cabang live dari klaim terminal; fallback label generik. */
  const shopName = (() => {
    try {
      const b = (getTerminal().branchName ?? '').trim();
      return b || t('disp_shop');
    } catch { return t('disp_shop'); }
  })();
  /** Tag order berjalan (nomor antre/meja) untuk judul kartu order. */
  const [openTag, setOpenTag] = useState('');
  /** client_id order berjalan untuk payload QR live (Q7: QR membawa client_id). */
  const [liveClientId, setLiveClientId] = useState('');
  const runningTotal = liveItems.reduce((s, it) => s + it.qty * it.price, 0);
  /** Payload QR live dari sesi (client_id + branch + terminal + total),
   * bukan aset statis — diblokir offline oleh cabang render di bawah. */
  const qrPayload = (() => {
    try {
      const term = getTerminal();
      const branch = String(term.branchId ?? '').trim();
      const code = String(term.terminalCode ?? '').trim();
      const client = (liveClientId || openTag).trim();
      return `genfity://pay?client=${encodeURIComponent(client)}&branch=${encodeURIComponent(branch)}&term=${encodeURIComponent(code)}&total=${runningTotal}`;
    } catch {
      return `genfity://pay?client=${encodeURIComponent(liveClientId || openTag)}&total=${runningTotal}`;
    }
  })();

  useEffect(() => subscribeDisplay((e) => {
    // D2: view_pelanggan tanpa pasangan tak terikat ke apa pun — abaikan
    // event (fail-closed: kosong, tanpa fallback branch-wide).
    try {
      const b = getBinding();
      if (normalizeTag(b?.tag) === 'view_pelanggan' && !String(b?.pairedKasirId ?? '').trim()) return;
    } catch {
      return;
    }
    setLastDataAt(Date.now());
    if (e.type === 'call') {
      setPrep((p) => (p[0] === e.ticket ? p.slice(1) : p.filter((t) => t !== e.ticket)));
      setReady((r) => (r.includes(e.ticket) ? r : [e.ticket, ...r].slice(0, 6)));
    } else if (e.type === 'ready') {
      setReady((r) => (r.includes(e.ticket) ? r : [...r, e.ticket].slice(0, 6)));
    } else {
      // Event order dari server (DISPLAY_ORDER): antrean + rincian berjalan.
      setPrep((p) => (p.includes(e.ticket) ? p : [...p, e.ticket].slice(0, 6)));
      if (e.items.length > 0) setLiveItems(e.items);
      // D6: client_id SSE (wired, aktif saat BE menyertakan client_id).
      const sseCid = String(e.clientId ?? '').trim();
      if (sseCid) {
        setLiveClientId(sseCid);
        setOpenTag(e.ticket);
      }
    }
  }), []);

  /** SSE E26 PRIMER tinggal di bus (subscribeDisplay di atas → ensureSse di
   * lib/display, SATU keputusan TRANSPORT via isBackendConfigured, scope kasir
   * pasangan via resolveDisplaySseTerminalId). Langganan langsung kedua di sini
   * dihapus: ia membuka SseClient duplikat untuk terminal yang sama sehingga
   * tiap event diproses 2x. WS + poll SQLite di bawah hanya fallback saat
   * primer tak live. Bus lokal notifySaleSavedLocal tetap kaki offline
   * same-device. */

  /** APP-EVENTS: sale lokal same-device (kasir→display satu device) —
   * tampil instan tanpa roundtrip server (audit row 12, offline). */
  useEffect(() => subscribeLocalSale((s) => {
    // D2: gerbang yang sama dengan bus display (lihat di atas).
    try {
      const b = getBinding();
      if (normalizeTag(b?.tag) === 'view_pelanggan' && !String(b?.pairedKasirId ?? '').trim()) return;
    } catch {
      return;
    }
    setLastDataAt(Date.now());
    if (s.salesNum) setOpenTag(s.salesNum);
    if (s.clientId) setLiveClientId(s.clientId);
    if (s.items.length > 0) {
      setLiveItems(s.items.map((it) => ({
        name: it.name,
        qty: it.qty,
        price: it.qty > 0 ? Math.round(it.subtotal / it.qty) : 0,
      })));
    }
  }), []);

  /** APP-FIXUP (fix-sse2 M5): WS SEKUNDER — fallback hanya bila SSE primer tak
   * terkonfigurasi/gagal/offline (TRANSPORT); saat SSE live, feed E26 primer
   * di atas + bus lokal yang memasok layar. Kosong jujur bila tak ada event. */
  useEffect(() => {
    // D2: tanpa pasangan = tak terikat ke apa pun — tanpa fallback WS branch-wide.
    try {
      const b = getBinding();
      if (normalizeTag(b?.tag) === 'view_pelanggan' && !String(b?.pairedKasirId ?? '').trim()) return undefined;
    } catch {
      return undefined;
    }
    // Fallback hanya bila primer tak live (SATU keputusan TRANSPORT via
    // isBackendConfigured — jangan cek isSseConfigured saja: basis URL-nya
    // beda dan bus bisa fail-closed sementara layar tetap dial).
    try {
      if (sseOk && isBackendConfigured(resolveDisplaySseTerminalId())) return undefined;
    } catch { /* abaikan — lanjut fallback WS */ }
    try { startRealtime(); } catch { /* abaikan */ }
    const off = onWsMessage((msg) => {
      setLastDataAt(Date.now());
      // D17: hanya topik display (alternatif kitchen|ticket mati — gerbang
      // tag realtime juga tak mengantarnya ke view; pratinjau operator
      // mencerminkan apa yang dilihat pelanggan).
      if (!/display|order|call|ready/i.test(msg.type)) return;
      const p = (msg.payload ?? {}) as { ticket?: unknown; code?: unknown; no?: unknown; status?: unknown; items?: unknown };
      const ticket = String(p.ticket ?? p.code ?? p.no ?? '').trim();
      if (ticket) {
        const done = /ready|call|done|selesai|paid/i.test(msg.type) || String(p.status ?? '').toLowerCase().includes('ready');
        if (done) {
          setPrep((pp) => pp.filter((x) => x !== ticket));
          setReady((r) => (r.includes(ticket) ? r : [ticket, ...r].slice(0, 6)));
        } else {
          setPrep((pp) => (pp.includes(ticket) ? pp : [...pp, ticket].slice(0, 6)));
        }
      }
      if (Array.isArray(p.items) && p.items.length > 0) {
        const mapped: LiveItem[] = [];
        for (const raw of p.items) {
          const it = raw as { name?: unknown; menuName?: unknown; qty?: unknown; price?: unknown; unitPrice?: unknown };
          const name = String(it.name ?? it.menuName ?? '').trim() || '-';
          const qty = Math.max(1, Math.round(Number(it.qty) || 0));
          const price = Math.round(Number(it.price ?? it.unitPrice) || 0);
          mapped.push({ name, qty, price });
        }
        if (mapped.length > 0) setLiveItems(mapped);
      }
    });
    // D8: lepas handler milik layar ini; channel WS global milik sesi
    // (start saat login, stop saat logout) — stopRealtime di sini akan
    // memutus feed layar lain (dapur/kasir) yang masih mount.
    return off;
  }, [sseOk]);

  /** Promo lokal ms_promotion (flagActive=1) — data lokal SQLite, dibaca selalu
   * (bukan feed realtime, jadi bukan bagian fallback TRANSPORT). */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        await initDb();
        const pr = await query<{ promoCode: string | null; promoName: string | null; value: number | null }>(
          'SELECT promoCode, promoName, value FROM ms_promotion WHERE flagActive = 1 ORDER BY rowid LIMIT 1',
        );
        if (!alive) return;
        const r0 = pr[0];
        const code = (r0?.promoCode ?? '').trim();
        setPromo(code ? { code, name: (r0?.promoName ?? '').trim() || code, value: Math.round(Number(r0?.value) || 0) } : null);
      } catch { /* promo opsional - banner disembunyikan */ }
      try {
        const bc = await getBranchCurrency();
        if (!alive) return;
        if (bc.code) setCurrency(bc.code);
      } catch { /* tanpa setting = fallback IDR */ }
    };
    void load();
    return () => { alive = false; };
  }, []);

  /** APP-FIXUP (fix-sse2 M5): poll SQLite FALLBACK — antrean + item/total
   * berjalan ikut kasir tiap 10 detik hanya bila SSE primer tak
   * terkonfigurasi/gagal/offline (TRANSPORT); berpenanda stale via banner. */
  useEffect(() => {
    try {
      if (sseOk && isBackendConfigured(resolveDisplaySseTerminalId())) return undefined;
    } catch { /* abaikan — lanjut fallback poll */ }
    let alive = true;
    const poll = async () => {
      try {
        await initDb();
        // D3-06: getBranchId() fail-closed ('', tak melempar). Belum ter-bound
        // = daftar kosong + prompt ikat; tanpa fallback B001 dan tanpa query
        // '' yang ikut menarik baris tak ber-branch.
        const branchId = getBranchId();
        if (!branchId) {
          if (alive) setNeedBind(true);
          return;
        }
        if (alive) setNeedBind(false);
        // Scope kasir pasangan (aturan 1:1): view_pelanggan yang dipair ke kasir
        // A WAJIB hanya membaca cart kasir A. Branch-wide di sini bisa
        // menampilkan cart + QR client_id/total milik kasir B (salah bayar).
        // Papan antrean (view_queue/lainnya) tetap branch-wide by design.
        // D2: tanpa pairedKasirId = tak terikat ke apa pun — berhenti di sini
        // (daftar kosong + prompt ikat), TANPA query branch-wide.
        let scopeTid = '';
        let isViewCustomer = false;
        try {
          const b = getBinding();
          isViewCustomer = normalizeTag(b?.tag) === 'view_pelanggan';
          if (isViewCustomer) scopeTid = String(b?.pairedKasirId ?? '').trim();
        } catch { /* getBinding tak melempar nyata — pola bertahan di bawah */ }
        if (isViewCustomer && !scopeTid) {
          if (alive) setNeedBind(true);
          return;
        }
        // GAP-19: poll SQLite HANYA fallback offline — bila data live
        // (SSE/WS/bus lokal) segar, jangan timpa state live dengan snapshot
        // lokal; penanda stale + banner eksisting tetap dari jam live.
        try {
          const la = liveAtRef.current;
          if (la !== null && Date.now() - la <= DISPLAY_STALE_MS) return;
        } catch { /* abaikan — lanjut fallback poll */ }
        if (isViewCustomer && scopeTid) {
          // D1: samakan namespace (kolom = terminalCode, id = id BE) via E09;
          // gagal = id mentah = kosong jujur (fail-closed).
          try {
            scopeTid = await resolvePairedKasirCode(branchId, scopeTid);
          } catch { /* id mentah di bawah */ }
        }
        const heads = await query<{ salesNum: string; tableNo: string | null; queueNumber: string | null; status: string | null; client_id: string | null }>(
          'SELECT salesNum, tableNo, queueNumber, status, client_id FROM tr_saleshead WHERE (branchId = ? OR branchId IS NULL OR branchId = ?) AND (? = \'\' OR terminalId = ?) ORDER BY createdAt DESC LIMIT 20',
          [branchId, '', scopeTid, scopeTid],
        );
        if (alive) setLastPollAt(Date.now());
        if (!alive || heads.length === 0) return;
        const tag = (h: { salesNum: string; tableNo: string | null; queueNumber: string | null }) =>
          h.queueNumber || h.tableNo || h.salesNum;
        const prepLive = heads.filter((h) => (h.status ?? 'open') !== 'paid').map(tag).slice(0, 6);
        const readyLive = heads.filter((h) => (h.status ?? '') === 'paid').map(tag).slice(0, 6);
        if (prepLive.length > 0) setPrep(prepLive);
        if (readyLive.length > 0) setReady(readyLive);
        const openHead = heads.find((h) => (h.status ?? 'open') !== 'paid');
        if (!openHead) return;
        if (alive) {
          setOpenTag(tag(openHead));
          const cid = String(openHead.client_id ?? '').trim();
          if (cid) setLiveClientId(cid);
        }
        const rows = await query<{ menuName: string | null; qty: number | null; price: number | null }>(
          'SELECT menuName, qty, price FROM tr_salesmenu WHERE salesNum = ?',
          [openHead.salesNum],
        );
        if (!alive || rows.length === 0) return;
        setLiveItems(rows.map((r) => ({ name: r.menuName ?? '-', qty: Number(r.qty ?? 0), price: Number(r.price ?? 0) })));
      } catch {
        /* DB belum siap - biarkan kosong jujur */
      }
    };
    void poll();
    // C11 EFF-09: fallback poll 10 dtk → 60 dtk. Jalur live tetap event-driven
    // (subscribeDisplay/onWsMessage/SSE + efek [sseOk]); GAP-19 di atas sudah
    // skip saat data live segar, banner basi (D3) menandai staleness.
    const timer = setInterval(() => { void poll(); }, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [sseOk]);

  /** Notice penolakan aksi operator di peran view (tanpa silent fail). */
  const [opNotice, setOpNotice] = useState('');
  const callNext = () => {
    // GAP-10: gerbang peran yang sama dengan goCashier IdleScreen — hanya tag
    // fitur-penuh (FULL_FEATURE_TAGS kanonis) boleh memanggil; view/asing
    // ditolak via notice, tanpa silent fail.
    if (isLockedView || activeTag === null || !(FULL_FEATURE_TAGS as string[]).includes(activeTag)) { setOpNotice(t('disp_locked_op')); return; }
    setOpNotice('');
    if (prep.length === 0) return;
    const [next, ...rest] = prep;
    setPrep(rest);
    setReady((r) => [next, ...r].slice(0, 6));
    // S8 (PW-3): LOKAL-ONLY by design — tak ada endpoint BE call-ticket
    // (BE nyatakan event `call` reserved dan aksi panggil server BELUM ADA).
    // JANGAN invent POST di sini (ubah kontrak BE dari sisi APP = DILARANG) —
    // server-ack/marking butuh endpoint owner-BE; hingga itu ada, siaran call
    // hanya ke bus lokal (+WS fallback).
    publishDisplay({ type: 'call', ticket: next });
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      {/* Q3 ORPHAN-DISPLAY-JADI-PROMO: pasangan dihapus = status disconnected netral; bukan prompt ikat/PIN. */}
      {isUnpairedView ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Disconnected</Text>
        </View>
      ) : null}
      {needBind && !isUnpairedView ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>{t('terminal_unbound_hint')}</Text>
        </View>
      ) : null}
      {online === false ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>{t('disp_offline_banner')}</Text>
        </View>
      ) : null}
      {showStaleBanner ? (
        <Text style={styles.staleText}>{staleAgeLabel ? `${t('disp_stale')} · ${staleAgeLabel}` : t('disp_stale')}</Text>
      ) : null}
      {/* EFF-09: idle realtime (hemat baterai pasca-retry) terlihat di UI. */}
      {rtIdle ? (
        <Text style={styles.staleText}>{t('rt_idle')}</Text>
      ) : null}
      {/* Q3 ORPHAN-DISPLAY-JADI-PROMO: promo dominan saat unpaired (mode order tak punya blok promo). */}
      {isUnpairedView && promo ? (
        <View style={styles.promo}>
          <Text style={[styles.promoT, isTablet && styles.promoTBig]}> {`${t('disp_promo_pre')}${promo.code} · ${promo.name} (${formatCurrency(promo.value, currency)})${t('disp_promo_post')}`} </Text>
        </View>
      ) : null}
      <View style={styles.langWrap}>{(['id', 'en'] as Lang[]).map((l) => (<TouchableOpacity key={l} onPress={() => setLang(l)} style={[styles.langBtn, lang === l && styles.langBtnOn]}><Text style={[styles.langT, lang === l && styles.langTOn]}>{l.toUpperCase()}</Text></TouchableOpacity> ))}</View>{isLockedView ? null : (<View style={styles.modeRow}>
        {(['queue', 'order', 'success'] as ViewMode[]).map((m) => (
          <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.modeTab, mode === m && styles.modeTabActive, isTablet && styles.modeTabTablet]}>
            <Text style={[styles.modeText, mode === m && styles.modeTextActive, isTablet && styles.modeTextBig]}>
              {m === 'queue' ? t('disp_queue') : m === 'order' ? t('disp_order') : t('disp_success')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>)}

      {shownMode === 'queue' ? (
        <>
          <View style={styles.hero}>
            <Text style={[styles.shop, isTablet && styles.shopBig]}>{shopName}</Text>
            <Text style={[styles.heroSub, isTablet && styles.heroSubBig]}>{t('disp_hero_sub')}</Text>
          </View>
          <View style={[styles.cols, !isTablet && styles.colsPhone]}>
            <View style={styles.col}>
              <Text style={[styles.colTitle, isTablet && styles.colTitleBig]}>{t('disp_preparing')}</Text>
              {prep.length === 0 && <Text style={styles.empty}>{t('disp_empty')}</Text>}
              {prep.map((n) => (
                <View key={n} style={styles.ticketPrep}>
                  <Text style={[styles.ticketNo, isTablet && styles.ticketNoBig]}>{n}</Text>
                </View>
              ))}
            </View>
            <View style={styles.col}>
              <Text style={[styles.colTitle, isTablet && styles.colTitleBig]}>{t('disp_ready')}</Text>
              {ready.length === 0 && <Text style={styles.empty}>{t('disp_empty')}</Text>}
              {ready.map((n, i) => (
                <View key={n} style={[styles.ticketReady, i === 0 && styles.ticketFirst]}>
                  <Text style={[styles.ticketNo, styles.ticketNoReady, isTablet && styles.ticketNoBig]}>{n}</Text>
                </View>
              ))}
            </View>
          </View>
          {promo ? (
            <View style={styles.promo}>
              <Text style={[styles.promoT, isTablet && styles.promoTBig]}> {`${t('disp_promo_pre')}${promo.code} · ${promo.name} (${formatCurrency(promo.value, currency)})${t('disp_promo_post')}`} </Text>
            </View>
          ) : null}
          {isLockedView ? null : (
          <AppButton
            size="md"
            title={prep.length === 0 ? t('disp_all_ready') : `${t('disp_call_pre')}${prep[0]}${t('disp_call_post')}`}
            onPress={callNext}
            disabled={prep.length === 0}
          />
          )}
          {opNotice ? <Text style={[styles.hint, { color: colors.red }]}>{opNotice}</Text> : null}
        </>
      ) : null}

      {shownMode === 'order' ? (
        <View style={styles.orderCard}>
          <Text style={styles.shopDark}>{openTag ? `${t('disp_running_title_base')} - ${openTag}` : t('disp_running_title_base')}</Text>
          <Text style={styles.orderSub}>{t('disp_running_sub')}</Text>
          <View style={styles.divider} />
          {liveItems.length === 0 && <Text style={styles.empty}>{t('disp_empty')}</Text>}
          {liveItems.map((it, i) => (
            <View key={`${it.name}#${i}`} style={styles.itemRow}>
              <Text style={styles.itemName}>{it.qty}x {it.name}</Text>
              <Text style={styles.itemPrice}>{formatCurrency(it.qty * it.price, currency)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.itemRow}>
            <Text style={styles.totalLabel}>{t('disp_total')}</Text>
            <Text style={[styles.totalVal, isTablet && styles.totalValBig]}>{formatCurrency(runningTotal, currency)}</Text>
          </View>
          <View style={styles.qrisBox}>
            <Text style={styles.qrisTitle}>{t('disp_qris_title')}</Text>
            {/* D2: QR diblokir saat unpaired (tanpa client kasir = tanpa bayar). */}
            {online === false || isUnpairedView ? (
              <Text style={styles.qrisSub}>{t('disp_qr_offline')}</Text>
            ) : (
              <Text style={styles.qrPayload} selectable>{qrPayload}</Text>
            )}
            <Text style={styles.qrisSub}>{`${t('disp_qris_pre')}${formatCurrency(runningTotal, currency)}`}</Text>
          </View>
          {isLockedView ? null : (
          <AppButton size="md" title={t('disp_sim_pay')} onPress={() => setMode('success')} disabled={online === false} />
          )}
        </View>
      ) : null}

      {shownMode === 'success' ? (
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={[styles.successTitle, isTablet && styles.successTitleBig]}>{t('disp_pay_ok')}</Text>
          <Text style={[styles.successTotal, isTablet && styles.successTotalBig]}>{formatCurrency(runningTotal, currency)}</Text>
          <Text style={styles.successSub}>{t('disp_cash_line')}</Text>
          <Text style={styles.successSub}>{t('disp_thanks')}</Text>
          <AppButton size="md" title={t('disp_back_queue')} onPress={() => setMode('queue')} />
        </View>
      ) : null}

      <Text style={styles.hint}>{t('disp_hint')}</Text>
    </ScrollView>
  );}const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navyDark },
  body: { padding: 16, paddingBottom: 40 },
  langWrap: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  langBtn: { borderWidth: 1, borderColor: colors.navy, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.navy }, langBtnOn: { backgroundColor: colors.white, borderColor: colors.white }, langT: { fontFamily: fonts.bold, fontSize: 11, color: colors.navyTint }, langTOn: { color: colors.navy }, modeRow: { flexDirection: 'row', gap: 6, marginTop: 8 }, modeTab: { flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center', backgroundColor: colors.navy },
  /* Tablet: tab mode operator memenuhi target sentuh >=48px. */
  modeTabTablet: { paddingVertical: 14, minHeight: 48 },
  modeTextBig: { fontSize: 14 },
  modeTabActive: { backgroundColor: colors.white },
  modeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.navyTint },
  modeTextActive: { color: colors.navy },
  hero: { alignItems: 'center', marginTop: 16 },
  shop: { fontFamily: fonts.bold, fontSize: 22, color: colors.white, textAlign: 'center' },
  shopBig: { fontSize: 28 }, heroSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4, textAlign: 'center' },
  heroSubBig: { fontSize: 15 }, shopDark: { fontFamily: fonts.bold, fontSize: 18, color: colors.navy, textAlign: 'center' }, orderSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' }, cols: { flexDirection: 'row', gap: 12, marginTop: 16 },
  colsPhone: { flexDirection: 'column' },
  col: { flex: 1 },
  colTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.white, marginBottom: 8 },
  colTitleBig: { fontSize: 19 }, empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.navyTint },
  ticketPrep: { backgroundColor: colors.navy, borderRadius: 12, padding: 16, marginBottom: 8, alignItems: 'center' },
  ticketReady: { backgroundColor: colors.white, borderRadius: 12, padding: 16, marginBottom: 8, alignItems: 'center' },
  ticketFirst: { borderWidth: 3, borderColor: colors.orange },
  ticketNo: { fontFamily: fonts.bold, fontSize: 28, color: colors.white },
  ticketNoReady: { color: colors.navy },
  ticketNoBig: { fontSize: 40 },
  promo: { backgroundColor: colors.orange, borderRadius: 12, padding: 14, marginTop: 8 },
  promoT: { fontFamily: fonts.bold, fontSize: 14, color: colors.white, textAlign: 'center' },
  promoTBig: { fontSize: 16 }, primary: { backgroundColor: colors.white, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.navy },
  primaryDark: { backgroundColor: colors.navy, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  primaryDarkT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  orderCard: { backgroundColor: colors.white, borderRadius: 16, padding: 18, marginTop: 16 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  itemName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  itemPrice: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  totalLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  totalVal: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy },
  totalValBig: { fontSize: 24 }, qrisBox: { backgroundColor: colors.bg, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  qrisTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  qrisImg: { width: 160, height: 160, marginVertical: 8 },
  /* Tablet: QR lebih besar agar terpindai dari jarak wajar. */
  qrisImgTablet: { width: 220, height: 220 },
  qrisSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  qrPayload: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy, textAlign: 'center', marginVertical: 8 },
  successCard: { backgroundColor: colors.white, borderRadius: 16, padding: 28, marginTop: 24, alignItems: 'center' },
  successIcon: { fontSize: 56, color: colors.green, fontFamily: fonts.bold },
  successTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 8 },
  successTitleBig: { fontSize: 24 }, successTotal: { fontFamily: fonts.bold, fontSize: 28, color: colors.text, marginTop: 6 },
  successTotalBig: { fontSize: 34 }, successSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
  offlineBanner: { backgroundColor: colors.red, borderRadius: 10, padding: 10, marginTop: 8, alignItems: 'center' },
  offlineBannerText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white, textAlign: 'center' },
  staleText: { fontFamily: fonts.medium, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 6 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 12 },});