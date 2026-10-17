import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';
import { useLang, type Lang } from '../../lib/i18n';
import { useConnectivity } from '../../hooks/useConnectivity';
import { initDb, query } from '../../lib/db';
import { getBinding, subscribeSession } from '../../session';
import { getTerminal } from '../../config/server';
/** APP-FIXUP (fix-sse2 M5): jalur SSE dipakai STATIS (bukan require dinamis)
 * agar feed primer E27 dikonsumsi nyata oleh view ini. */
import { isSseConfigured, subscribeQueueEvents } from '../../lib/sse';

/**
 * Layar antrean terkunci untuk tag view_queue (SPEC-TERMINAL-SESSION §8/§10).
 * Terikat ke BRANCH (bukan ke kasir): daftar branch-scoped + indikator
 * call/ready saja — tanpa cart/QR/payment, tanpa kontrol operator, tanpa
 * drawer/header/back. Fullscreen terkunci seperti CustomerDisplayScreen.
 *
 * Transport (§11.4): primer SSE E27 (feed antrean per branch) + API load
 * awal/resync; fallback poll SQLite BERPENANDA stale; aksi sensitif
 * (call/ready) hanya indikator di sini (operator melakukannya di kasir).
 *
 * REGISTRASI RUTE (milik task pemilik App.tsx — file ini TIDAK menyentuh
 * App.tsx / navigation/types.ts):
 *   App.tsx:  <Stack.Screen name="QueueView" component={QueueViewScreen}
 *               options={{ title: t('queue_title'), headerShown: false }} />
 *   navigation/types.ts:  QueueView: undefined;
 * Home + allowlist per tag sudah mendarat di Wave1
 * (homeRouteFor → 'QueueView', allowedRoutesFor(view_queue) → {'QueueView'}).
 */
export const QUEUE_VIEW_ROUTE = 'QueueView';

type QueueTicket = { ticket: string; done: boolean };

/** Bentuk event SSE E27 yang defensif (kontrak final mendarat di Fase 4). */
type QueueEvent = {
  ticket?: unknown;
  code?: unknown;
  no?: unknown;
  status?: unknown;
  preparing?: unknown;
  ready?: unknown;
  tickets?: unknown;
};

function str(v: unknown): string {
  return String(v ?? '').trim();
}

/**
 * APP-FIXUP (fix-sse2 M5): langganan SSE E27 kini STATIS via lib/sse
 * (subscribeQueueEvents, lihat efek primer di bawah) — helper require()
 * dinamis dihapus; modul sse selalu ada di repo sehingga Metro me-resolve
 * statis dengan aman. Kegagalan/kontrak absen = fallback poll SQLite
 * berpenanda di bawah. Tak pernah melempar.
 */

function currentBranch(): { id: string; name: string } {
  try {
    const b = getBinding();
    if (b && b.branchId.trim()) return { id: b.branchId.trim(), name: (b.branchName ?? '').trim() };
  } catch {
    /* abaikan */
  }
  try {
    const t = getTerminal();
    return { id: (t.branchId ?? '').trim(), name: (t.branchName ?? '').trim() };
  } catch {
    return { id: '', name: '' };
  }
}

export default function QueueViewScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, setLang, t } = useLang();
  const { online } = useConnectivity();
  const [prep, setPrep] = useState<string[]>([]);
  const [ready, setReady] = useState<string[]>([]);
  // SSE E27 primer bila kontrak tersedia; fallback poll berpenanda (§11.4).
  const [sseLive, setSseLive] = useState(false);
  const [lastDataAt, setLastDataAt] = useState<number | null>(null);
  const [branchName, setBranchName] = useState(() => currentBranch().name);
  const [, setUiTick] = useState(0);

  useEffect(() => subscribeSession(() => setUiTick((x) => x + 1)), []);
  useEffect(() => {
    const id = setInterval(() => setUiTick((x) => x + 1), 10000);
    return () => clearInterval(id);
  }, []);

  const applyEvent = (e: QueueEvent) => {
    const ticket = str(e.ticket ?? e.code ?? e.no);
    const listOf = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(str).filter((s) => s !== '') : [];
    const prepList = listOf(e.preparing ?? e.tickets);
    const readyList = listOf(e.ready);
    if (prepList.length > 0) setPrep(prepList.slice(0, 12));
    if (readyList.length > 0) setReady(readyList.slice(0, 12));
    if (ticket) {
      const done = /ready|call|done|selesai|paid/i.test(str(e.status));
      if (done) {
        setPrep((p) => p.filter((x) => x !== ticket));
        setReady((r) => (r.includes(ticket) ? r : [ticket, ...r].slice(0, 12)));
      } else {
        setPrep((p) => (p.includes(ticket) ? p : [...p, ticket].slice(0, 12)));
      }
    }
    setLastDataAt(Date.now());
  };

  /** APP-FIXUP (fix-sse2 M5): SSE E27 PRIMER — langganan statis feed antrean
   * per branch saat backend terkonfigurasi (isSseConfigured); tipe event
   * diteruskan sebagai status fallback agar event tunggal 'ready'/'call'
   * tanpa status tetap menandai tiket selesai. */
  const branchId = currentBranch().id;
  const sseConfigured = (() => {
    try {
      return isSseConfigured();
    } catch {
      return false;
    }
  })();
  useEffect(() => {
    try {
      if (!isSseConfigured()) return undefined;
      const id = currentBranch().id;
      if (!id) return undefined;
      return subscribeQueueEvents(
        id,
        (e) => {
          const raw = e.data;
          const d = (raw && typeof raw === 'object' ? raw : {}) as QueueEvent;
          applyEvent({ ...d, status: d.status ?? e.type });
        },
        { onStatus: (s) => setSseLive(s === 'online') },
      );
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  /** Nama cabang selalu sinkron (poll di bawah berhenti saat SSE live). */
  useEffect(() => {
    const name = currentBranch().name;
    if (name !== branchName) setBranchName(name);
  });

  /** APP-FIXUP (fix-sse2 M5): poll SQLite FALLBACK — hanya bila SSE primer tak
   * terkonfigurasi/gagal/offline (TRANSPORT); berpenanda stale via banner. */
  useEffect(() => {
    if (sseConfigured && sseLive) return undefined;
    let alive = true;
    const poll = async () => {
      try {
        await initDb();
        const branch = currentBranch();
        if (alive && branch.name !== branchName) setBranchName(branch.name);
        // Jujur tanpa fallback B001: belum ter-bound = daftar kosong.
        if (!branch.id) return;
        const heads = await query<{
          salesNum: string;
          tableNo: string | null;
          queueNumber: string | null;
          status: string | null;
        }>(
          'SELECT salesNum, tableNo, queueNumber, status FROM tr_saleshead WHERE (branchId = ? OR branchId IS NULL OR branchId = ?) ORDER BY createdAt DESC LIMIT 20',
          [branch.id, ''],
        );
        if (!alive) return;
        const tag = (h: { salesNum: string; tableNo: string | null; queueNumber: string | null }) =>
          h.queueNumber || h.tableNo || h.salesNum;
        setPrep(heads.filter((h) => (h.status ?? 'open') !== 'paid').map(tag).filter((s) => s).slice(0, 12));
        setReady(heads.filter((h) => (h.status ?? '') === 'paid').map(tag).filter((s) => s).slice(0, 12));
        setLastDataAt(Date.now());
      } catch {
        /* DB belum siap — biarkan kosong jujur */
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sseLive]);

  const staleAgeSec =
    lastDataAt === null ? null : Math.max(0, Math.round((Date.now() - lastDataAt) / 1000));
  const staleAgeLabel =
    staleAgeSec === null
      ? null
      : staleAgeSec < 120
        ? `${staleAgeSec}s`
        : `${Math.floor(staleAgeSec / 60)}m`;
  const isEmpty = prep.length === 0 && ready.length === 0;
  const rows: QueueTicket[] = [
    ...ready.map((ticket) => ({ ticket, done: true })),
    ...prep.map((ticket) => ({ ticket, done: false })),
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenterLg]}>
      <View style={styles.langWrap}>
        {(['id', 'en'] as Lang[]).map((l) => (
          <TouchableOpacity
            key={l}
            onPress={() => setLang(l)}
            style={[styles.langBtn, lang === l && styles.langBtnOn]}>
            <Text style={[styles.langT, lang === l && styles.langTOn]}>{l.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.hero}>
        <Text style={[styles.title, isTablet && styles.titleBig]}>{t('queue_title')}</Text>
        <Text style={[styles.branch, isTablet && styles.branchBig]}>
          {branchName ? `${t('queue_branch')} · ${branchName}` : t('queue_branch')}
        </Text>
      </View>
      {online === false ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>{t('disp_offline_banner')}</Text>
        </View>
      ) : null}
      {!sseLive && staleAgeLabel !== null ? (
        <Text style={styles.staleText}>{`${t('disp_stale')} · ${staleAgeLabel}`}</Text>
      ) : null}
      {isEmpty ? (
        <View style={styles.emptyCard}>
          <Text style={[styles.emptyText, isTablet && styles.emptyTextBig]}>{t('queue_empty')}</Text>
        </View>
      ) : (
        <View style={[styles.cols, !isTablet && styles.colsPhone]}>
          <View style={styles.col}>
            <Text style={[styles.colTitle, isTablet && styles.colTitleBig]}>{t('disp_preparing')}</Text>
            {rows
              .filter((r) => !r.done)
              .map((r) => (
                <View key={r.ticket} style={styles.ticketPrep}>
                  <Text style={[styles.ticketNo, isTablet && styles.ticketNoBig]}>{r.ticket}</Text>
                </View>
              ))}
          </View>
          <View style={styles.col}>
            <Text style={[styles.colTitle, isTablet && styles.colTitleBig]}>{t('disp_ready')}</Text>
            {rows
              .filter((r) => r.done)
              .map((r, i) => (
                <View key={r.ticket} style={[styles.ticketReady, i === 0 && styles.ticketFirst]}>
                  <Text style={[styles.ticketNo, styles.ticketNoReady, isTablet && styles.ticketNoBig]}>
                    {r.ticket}
                  </Text>
                </View>
              ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navyDark },
  body: { padding: 16, paddingBottom: 40 },
  langWrap: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  langBtn: {
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.navy,
  },
  langBtnOn: { backgroundColor: colors.white, borderColor: colors.white },
  langT: { fontFamily: fonts.bold, fontSize: 11, color: colors.navyTint },
  langTOn: { color: colors.navy },
  hero: { alignItems: 'center', marginTop: 16 },
  title: { fontFamily: fonts.bold, fontSize: 22, color: colors.white, textAlign: 'center' },
  titleBig: { fontSize: 28 },
  branch: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4, textAlign: 'center' },
  branchBig: { fontSize: 15 },
  offlineBanner: {
    backgroundColor: colors.red,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    alignItems: 'center',
  },
  offlineBannerText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white, textAlign: 'center' },
  staleText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.navyTint,
    textAlign: 'center',
    marginTop: 6,
  },
  emptyCard: { backgroundColor: colors.navy, borderRadius: 12, padding: 24, marginTop: 16, alignItems: 'center' },
  emptyText: { fontFamily: fonts.medium, fontSize: 15, color: colors.navyTint, textAlign: 'center' },
  emptyTextBig: { fontSize: 17 },
  cols: { flexDirection: 'row', gap: 12, marginTop: 16 },
  colsPhone: { flexDirection: 'column' },
  col: { flex: 1 },
  colTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.white, marginBottom: 8 },
  colTitleBig: { fontSize: 19 },
  ticketPrep: {
    backgroundColor: colors.navy,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    alignItems: 'center',
  },
  ticketReady: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    alignItems: 'center',
  },
  ticketFirst: { borderWidth: 3, borderColor: colors.orange },
  ticketNo: { fontFamily: fonts.bold, fontSize: 28, color: colors.white },
  ticketNoReady: { color: colors.navy },
  ticketNoBig: { fontSize: 40 },
});
