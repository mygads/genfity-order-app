import { useEffect, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import { TABLET_BP, colors, fonts, rp, wideCenterLg } from '../../theme';import AppButton from '../../components/AppButton';import { publishDisplay, subscribeDisplay } from '../../lib/display';import { onWsMessage, startRealtime } from '../../lib/realtime';import { initDb, query } from '../../lib/db';import { getBranchId, getTerminal } from '../../config/server';import { useLang,

type Lang } from '../../lib/i18n';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };type ViewMode = 'queue' | 'order' | 'success';/** Order nyata via bus display/event WS; kosong jujur bila tak ada data (tanpa mock). */type LiveItem = { name: string; qty: number; price: number };const EMPTY_ITEMS: LiveItem[] = [];const EMPTY_TICKETS: string[] = [];/** Promo live dari ms_promotion (flagActive=1); null = banner disembunyikan. */type LivePromo = { code: string; name: string; value: number };/** * Layar tampilan pelanggan (customer display) fullscreen. * Keputusan eksplisit: tanpa ScreenHeader by design karena layar ini * dimirror ke tampilan pelanggan; operator pratinjau via tab mode di dalam layar. */export default function CustomerDisplayScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, setLang, t } = useLang(); const [mode, setMode] = useState<ViewMode>('queue');
  const [ready, setReady] = useState<string[]>(EMPTY_TICKETS);
  const [prep, setPrep] = useState<string[]>(EMPTY_TICKETS);
  const [liveItems, setLiveItems] = useState<LiveItem[]>(EMPTY_ITEMS);
  const [promo, setPromo] = useState<LivePromo | null>(null);
  /** Nama cabang live dari klaim terminal; fallback label generik. */
  const shopName = (() => {
    try {
      const b = (getTerminal().branchName ?? '').trim();
      return b || t('disp_shop');
    } catch { return t('disp_shop'); }
  })();
  /** Tag order berjalan (nomor antre/meja) untuk judul kartu order. */
  const [openTag, setOpenTag] = useState('');
  const runningTotal = liveItems.reduce((s, it) => s + it.qty * it.price, 0);

  useEffect(() => subscribeDisplay((e) => {
    if (e.type === 'call') {
      setPrep((p) => (p[0] === e.ticket ? p.slice(1) : p.filter((t) => t !== e.ticket)));
      setReady((r) => (r.includes(e.ticket) ? r : [e.ticket, ...r].slice(0, 6)));
    } else if (e.type === 'ready') {
      setReady((r) => (r.includes(e.ticket) ? r : [...r, e.ticket].slice(0, 6)));
    } else {
      // Event order dari server (DISPLAY_ORDER): antrean + rincian berjalan.
      setPrep((p) => (p.includes(e.ticket) ? p : [...p, e.ticket].slice(0, 6)));
      if (e.items.length > 0) setLiveItems(e.items);
    }
  }), []);

  /** Order nyata dari event WS (display/order/kitchen/ticket) - kosong jujur bila tak ada. */
  useEffect(() => {
    try { startRealtime(); } catch { /* abaikan */ }
    const off = onWsMessage((msg) => {
      if (!/display|order|kitchen|ticket|call|ready/i.test(msg.type)) return;
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
    return off;
  }, []);

  /** Poll status order tiap 10 detik dari SQLite: antrean + item/total berjalan ikut kasir. */
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        await initDb();
        let branchId = '';
        try { branchId = getBranchId(); } catch { branchId = 'B001'; }
        const heads = await query<{ salesNum: string; tableNo: string | null; queueNumber: string | null; status: string | null }>(
          'SELECT salesNum, tableNo, queueNumber, status FROM tr_saleshead WHERE (branchId = ? OR branchId IS NULL OR branchId = ?) ORDER BY createdAt DESC LIMIT 20',
          [branchId, ''],
        );
        try {
          const pr = await query<{ promoCode: string | null; promoName: string | null; value: number | null }>(
            'SELECT promoCode, promoName, value FROM ms_promotion WHERE flagActive = 1 ORDER BY rowid LIMIT 1',
          );
          if (alive) {
            const r0 = pr[0];
            const code = (r0?.promoCode ?? '').trim();
            setPromo(code ? { code, name: (r0?.promoName ?? '').trim() || code, value: Math.round(Number(r0?.value) || 0) } : null);
          }
        } catch { /* promo opsional - banner disembunyikan */ }
        if (!alive || heads.length === 0) return;
        const tag = (h: { salesNum: string; tableNo: string | null; queueNumber: string | null }) =>
          h.queueNumber || h.tableNo || h.salesNum;
        const prepLive = heads.filter((h) => (h.status ?? 'open') !== 'paid').map(tag).slice(0, 6);
        const readyLive = heads.filter((h) => (h.status ?? '') === 'paid').map(tag).slice(0, 6);
        if (prepLive.length > 0) setPrep(prepLive);
        if (readyLive.length > 0) setReady(readyLive);
        const openHead = heads.find((h) => (h.status ?? 'open') !== 'paid');
        if (!openHead) return;
        if (alive) setOpenTag(tag(openHead));
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
    const timer = setInterval(() => { void poll(); }, 10000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const callNext = () => {
    if (prep.length === 0) return;
    const [next, ...rest] = prep;
    setPrep(rest);
    setReady((r) => [next, ...r].slice(0, 6));
    publishDisplay({ type: 'call', ticket: next });
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.langWrap}>{(['id', 'en'] as Lang[]).map((l) => (<TouchableOpacity key={l} onPress={() => setLang(l)} style={[styles.langBtn, lang === l && styles.langBtnOn]}><Text style={[styles.langT, lang === l && styles.langTOn]}>{l.toUpperCase()}</Text></TouchableOpacity> ))}</View><View style={styles.modeRow}>
        {(['queue', 'order', 'success'] as ViewMode[]).map((m) => (
          <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.modeTab, mode === m && styles.modeTabActive, isTablet && styles.modeTabTablet]}>
            <Text style={[styles.modeText, mode === m && styles.modeTextActive, isTablet && styles.modeTextBig]}>
              {m === 'queue' ? t('disp_queue') : m === 'order' ? t('disp_order') : t('disp_success')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'queue' ? (
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
              <Text style={[styles.promoT, isTablet && styles.promoTBig]}> {`${t('disp_promo_pre')}${promo.code} · ${promo.name} (${rp(promo.value)})${t('disp_promo_post')}`} </Text>
            </View>
          ) : null}
          <AppButton
            size="md"
            title={prep.length === 0 ? t('disp_all_ready') : `${t('disp_call_pre')}${prep[0]}${t('disp_call_post')}`}
            onPress={callNext}
            disabled={prep.length === 0}
          />
        </>
      ) : null}

      {mode === 'order' ? (
        <View style={styles.orderCard}>
          <Text style={styles.shopDark}>{openTag ? `${t('disp_running_title_base')} - ${openTag}` : t('disp_running_title_base')}</Text>
          <Text style={styles.orderSub}>{t('disp_running_sub')}</Text>
          <View style={styles.divider} />
          {liveItems.length === 0 && <Text style={styles.empty}>{t('disp_empty')}</Text>}
          {liveItems.map((it) => (
            <View key={it.name} style={styles.itemRow}>
              <Text style={styles.itemName}>{it.qty}x {it.name}</Text>
              <Text style={styles.itemPrice}>{rp(it.qty * it.price)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.itemRow}>
            <Text style={styles.totalLabel}>{t('disp_total')}</Text>
            <Text style={[styles.totalVal, isTablet && styles.totalValBig]}>{rp(runningTotal)}</Text>
          </View>
          <View style={styles.qrisBox}>
            <Text style={styles.qrisTitle}>{t('disp_qris_title')}</Text>
            <Image source={require('../../../assets/images/payment_qris.webp')} style={[styles.qrisImg, isTablet && styles.qrisImgTablet]} resizeMode="contain" />
            <Text style={styles.qrisSub}>{`${t('disp_qris_pre')}${rp(runningTotal)}`}</Text>
          </View>
          <AppButton size="md" title={t('disp_sim_pay')} onPress={() => setMode('success')} />
        </View>
      ) : null}

      {mode === 'success' ? (
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={[styles.successTitle, isTablet && styles.successTitleBig]}>{t('disp_pay_ok')}</Text>
          <Text style={[styles.successTotal, isTablet && styles.successTotalBig]}>{rp(runningTotal)}</Text>
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
  successCard: { backgroundColor: colors.white, borderRadius: 16, padding: 28, marginTop: 24, alignItems: 'center' },
  successIcon: { fontSize: 56, color: colors.green, fontFamily: fonts.bold },
  successTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.navy, marginTop: 8 },
  successTitleBig: { fontSize: 24 }, successTotal: { fontFamily: fonts.bold, fontSize: 28, color: colors.text, marginTop: 6 },
  successTotalBig: { fontSize: 34 }, successSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.navyTint, textAlign: 'center', marginTop: 12 },});