import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, wideCenterLg } from '../../theme';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { useLang } from '../../lib/i18n';
import { ensureShiftOpen } from '../../lib/shiftGuard';
import { initDb, query, run } from '../../lib/db';
import { getJSON, setJSON } from '../../lib/storage';
import { getBranchId, getTerminal } from '../../config/server';
import { enqueueSync } from '../../lib/sync';
import SupervisorApprovalDialog from '../../components/SupervisorApprovalDialog';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

type Status = 'Terjadwal' | 'Datang' | 'Selesai';
interface Resv { id: string; name: string; tamu: number; table: string; phone: string; note: string; date: string; time: string; status: Status; }

/** Samarkan nomor HP di daftar reservasi (privasi customer). */
function maskHp(hp: string): string {
  const d = hp.replace(/[^0-9]/g, '');
  if (d.length < 7) return hp;
  return `${d.slice(0, 4)}•••${d.slice(-4)}`;
}

/** Warna badge status reservasi. */
function statusStyle(status: Status) {
  if (status === 'Datang') return { bg: colors.paleGreen, tx: colors.greenDark };
  if (status === 'Selesai') return { bg: colors.paleBlue, tx: colors.navy };
  return { bg: colors.paleAmber, tx: colors.amberDark };
}

const NEXT: Record<Status, Status | null> = { Terjadwal: 'Datang', Datang: 'Selesai', Selesai: null };

/** Daftar reservasi tersimpan di perangkat PER CABANG agar bertahan saat dibuka
 * ulang; kosong = empty-state (tanpa contoh). Kunci dicabang supaya reservasi
 * cabang A tak bocor ke cabang B. */
/** M9: '' = unbound — segmen kunci 'unbound' (tanpa fallback B001 agar reservasi
 * cabang A tak bocor/terbaca sebagai cabang lain). */
const bookKeyFor = (branchId: string) => `genfity.booking.list.${(branchId || '').trim() || 'unbound'}`;

/** Baris meja untuk chip + validasi kapasitas (kanonis fallback / live ms_table). */
interface LiveTable { no: string; section: string; kap: number; }

/** Kanonis mengikuti TablesScreen: no tanpa strip + section Dalam/Teras/VIP. */
const CANON_TABLES: { no: string; section: string; kap: number }[] = [
  { no: 'A1', section: 'Dalam', kap: 2 },
  { no: 'A2', section: 'Dalam', kap: 2 },
  { no: 'A3', section: 'Dalam', kap: 4 },
  { no: 'A4', section: 'Dalam', kap: 4 },
  { no: 'B1', section: 'Teras', kap: 4 },
  { no: 'B2', section: 'Teras', kap: 6 },
  { no: 'B3', section: 'Teras', kap: 6 },
  { no: 'C1', section: 'VIP', kap: 2 },
  { no: 'C2', section: 'VIP', kap: 8 },
];
/** Kode kanonis dari label lama ber-strip ("A-03" → "A3"). */
function canonTableNo(raw: string): string {
  const t = (raw || '').trim().toUpperCase().replace(/\s*\(.*\)\s*$/, '').trim();
  const m = t.match(/^([A-Z]+)-?0*(\d+)$/);
  if (m) return `${m[1]}${m[2]}`;
  return t.replace(/-/g, '');
}
/** Label chip meja: "A2 · Dalam (2 kursi)" - kode kanonis + section + kapasitas. */
function tableLabel(tb: { no: string; section: string; kap: number }): string {
  return `${tb.no} · ${tb.section} (${tb.kap} kursi)`;
}

const TABLES_FREE = CANON_TABLES.map(tableLabel);

/** Booking / reservasi - form + daftar, tersimpan di perangkat dan sinkron ke denah. */
export default function BookingScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  // M9: '' = unbound (tanpa fallback B001); banner unbound di daftar bawah.
  const [branchId] = useState(() => {
    try { return getBranchId(); } catch { return ''; }
  });
  const bookKey = bookKeyFor(branchId);
  const shopLabel = (() => {
    try {
      const term = getTerminal();
      return (term.branchName ?? '').trim() || branchId;
    } catch { return branchId; }
  })();
  /** Meja live dari ms_table (denah merchant via Tables); null = belum muat. */
  const [liveTables, setLiveTables] = useState<LiveTable[] | null>(null);
  const tablesSrc: LiveTable[] = liveTables ?? CANON_TABLES;
  const tablesFree = tablesSrc.map(tableLabel);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [list, setList] = useState<Resv[]>([]);
  const [onlyToday, setOnlyToday] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tamu, setPax] = useState('');
  const [table, setTable] = useState(TABLES_FREE[0] as string);
  const [date, setDate] = useState('Hari ini');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [warn, setWarn] = useState('');
  /** Notice gerbang shift saat buka reservasi ke kasir (shift tutup → ke layar Shift). */
  const [gateNotice, setGateNotice] = useState('');
  /** Id reservasi yang sedang diedit (null = mode tambah baru). */
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    void getJSON<Resv[]>(bookKey, []).then((v) => {
      if (!on || !Array.isArray(v)) return;
      const base = v;
      // Migrasi kode lama ber-strip ke kanonis sekali saat muat.
      const canonSet = new Set(CANON_TABLES.map((tb) => tb.no));
      const migrated = base.map((r) => {
        const code = canonTableNo(r.table);
        return canonSet.has(code) ? { ...r, table: code } : r;
      });
      setList(migrated);
    });
    return () => {
      on = false;
    };
  }, [bookKey]);

  // Live: chip + kapasitas mengikuti denah ms_table (merchant bisa ubah via
  // Tables); DB kosong = fallback kanonis. Pilihan default ikut label live
  // bila pengguna belum menyentuh form.
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        await initDb();
        const rows = await query<{ tableNo: string | null; sectionId: string | null; capacity: number | null }>(
          'SELECT tableNo, sectionId, capacity FROM ms_table LIMIT 60',
        );
        const mapped: LiveTable[] = [];
        for (const r of rows) {
          const no = canonTableNo(String(r.tableNo ?? ''));
          if (!no) continue;
          mapped.push({
            no,
            section: (r.sectionId ?? '').trim() || 'Dalam',
            kap: Number(r.capacity) || 0,
          });
        }
        if (!on || mapped.length === 0) return;
        setLiveTables(mapped);
        const first = mapped[0];
        if (first) setTable((prev) => (prev === TABLES_FREE[0] ? tableLabel(first) : prev));
      } catch {
        /* master belum tersedia - fallback kanonis tetap dipakai */
      }
    })();
    return () => { on = false; };
  }, []);

  const persist = (next: Resv[]) => {
    setList(next);
    void setJSON(bookKey, next);
  };

  const shown = onlyToday ? list.filter((r) => r.date === 'Hari ini') : list;

  const resetForm = () => {
    setName(''); setPhone(''); setPax(''); setTime(''); setNote('');
    setDate('Hari ini'); setTable(tablesFree[0] as string);
    setEditingId(null); setWarn('');
  };

  const save = () => {
    // U5: mutasi booking = gerbang bound terminal (fail-closed).
    if (!branchId.trim()) {
      setWarn(t('terminal_unbound_hint'));
      return;
    }
    if (!name.trim()) {
      setWarn(t('bok_warn_name'));
      return;
    }
    if (!time.trim()) {
      setWarn(t('bok_warn_time'));
      return;
    }
    setWarn('');
    const code = canonTableNo(table);
    // Validasi kapasitas ala POSLite: tamu tak boleh melebihi kursi meja tujuan.
    // Kunci i18n khusus belum ada (lihat laporan) - pesan ID ringkas di sini.
    const picked = tablesSrc.find((tb) => tb.no === code);
    const paxNum = Number(tamu) || 2;
    if (picked && paxNum > picked.kap) {
      setWarn(t('bok_warn_capacity'));
      return;
    }
    if (editingId) {
      const next = list.map((r) =>
        r.id === editingId
          ? {
              ...r, name: name.trim(), tamu: Number(tamu) || 2,
              table: code, phone: phone.trim() || '-', note: note.trim() || '-',
              date, time: time.trim(),
            }
          : r,
      );
      persist(next);
      try {
        enqueueSync('other', {
          op: 'booking-update', id: editingId, table: code, name: name.trim(),
          time: time.trim(), pax: Number(tamu) || 2, date,
          at: new Date().toISOString(),
        });
      } catch {
        /* antrean belum siap */
      }
      resetForm();
      return;
    }
    const row: Resv = {
      id: `r${Date.now()}`, name: name.trim(), tamu: Number(tamu) || 2,
      table: code, phone: phone.trim() || '-', note: note.trim() || '-',
      date, time: time.trim(), status: 'Terjadwal',
    };
    persist([...list, row]);
    // Sinkron ke denah: tandai meja dipesan di master + antre sync (best-effort).
    try {
      enqueueSync('other', {
        op: 'booking-create', table: code, name: row.name, time: row.time,
        pax: row.tamu, date: row.date, at: new Date().toISOString(),
      });
    } catch {
      /* antrean belum siap */
    }
    void (async () => {
      try {
        await initDb();
        await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE TRIM(tableNo) = ? OR id = ?', ['dipesan', code, code]);
      } catch {
        /* master belum tersedia */
      }
    })();
    setName(''); setPhone(''); setPax(''); setTime(''); setNote('');
  };

  // U5: mutasi booking = gerbang bound terminal (fail-closed).
  const advance = (id: string) => {
    if (!branchId.trim()) {
      setGateNotice(t('terminal_unbound_hint'));
      return;
    }
    persist(
      list.map((r) => {
        const nx = NEXT[r.status];
        return r.id === id && nx ? { ...r, status: nx } : r;
      }),
    );
  };

  /** Muat satu reservasi ke form untuk diedit. */
  const startEdit = (r: Resv) => {
    setEditingId(r.id);
    setName(r.name);
    setPhone(r.phone === '-' ? '' : r.phone);
    setPax(String(r.tamu));
    const match = tablesSrc.find((tb) => tb.no === canonTableNo(r.table));
    setTable(match ? tableLabel(match) : tablesFree[0] as string);
    setDate(r.date);
    setTime(r.time);
    setNote(r.note === '-' ? '' : r.note);
    setWarn('');
  };

  /** Hapus/batalkan reservasi (tanya dua ketuk: tombol berubah jadi konfirmasi).
   * U5: ketuk kedua = dialog persetujuan supervisor V1 'order.cancel'
   * (S7: kontrak BE baru, legacy NOL; PIN + identitas pindah ke dialog). */
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [pendingDel, setPendingDel] = useState<Resv | null>(null);
  const [approveDelOpen, setApproveDelOpen] = useState(false);
  const removeResv = async (r: Resv) => {
    // U5: mutasi booking = gerbang bound terminal (fail-closed).
    if (!branchId.trim()) {
      setGateNotice(t('terminal_unbound_hint'));
      return;
    }
    if (confirmDel !== r.id) {
      setConfirmDel(r.id);
      setGateNotice(t('void_need_pin').replace('{r}', 'order.cancel'));
      return;
    }
    // Ketuk kedua: buka dialog V1 (otorisasi + alasan tercatat di audit BE).
    setPendingDel(r);
    setGateNotice('');
    setApproveDelOpen(true);
  };
  /** Eksekusi hapus sesudah dialog V1 disetujui (server approvalId / lokal). */
  const approveDel = () => {
    const r = pendingDel;
    setApproveDelOpen(false);
    setPendingDel(null);
    if (!r) return;
    setConfirmDel(null);
    setGateNotice('');
    if (editingId === r.id) resetForm();
    persist(list.filter((x) => x.id !== r.id));
    try {
      enqueueSync('other', {
        op: 'booking-cancel', id: r.id, table: r.table, name: r.name,
        at: new Date().toISOString(),
      });
    } catch {
      /* antrean belum siap */
    }
    // Bebaskan denah hanya bila tamu belum datang (Terjadwal): bila sudah
    // Datang/Selesai, meja dikuasai order kasir - jangan timpa jadi kosong.
    if (r.status !== 'Terjadwal') return;
    void (async () => {
      try {
        await initDb();
        await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE TRIM(tableNo) = ? OR id = ?', ['kosong', r.table, r.table]);
      } catch {
        /* master belum tersedia */
      }
    })();
  };

  /** Buka reservasi ke kasir: status ikut maju Terjadwal → Datang (tamu tiba). */
  const openResv = (r: Resv) => {
    void (async () => {
      const params = { table: r.table, customer: r.name, mode: 'DINE IN', tamu: r.tamu };
      if (!(await ensureShiftOpen(navigation, `${t('dash_shift_closed')} - ${t('shf_open_btn')}`, setGateNotice))) return;
      setGateNotice('');
      if (r.status === 'Terjadwal') {
        persist(list.map((x) => (x.id === r.id ? { ...x, status: 'Datang' as Status } : x)));
      }
      navigation?.navigate('Cashier', params);
    })();
  };

  const reservasiList = (
    <>
      <Text style={[styles.count, isTablet && styles.countBig]}>{shopLabel || t('terminal_unbound_title')}{t('bok_count').replace('{n}', String(shown.length))}</Text>
      {!branchId ? <Text style={styles.warn}>{t('terminal_unbound_hint')}</Text> : null}
      <TouchableOpacity onPress={() => setOnlyToday((v) => !v)} style={styles.todayToggle}>
        <Text style={styles.todayToggleT}>{onlyToday ? '☑' : '☐'} {t('bok_today_only')}</Text>
      </TouchableOpacity>

      <Text style={[styles.sec, isTablet && styles.secBig]}>{t('bok_list')}</Text>
      <Text style={[styles.hint, isTablet && styles.hintBig]}>{t('bok_open_hint')}</Text>
      {gateNotice ? <Text style={styles.warn}>{gateNotice}</Text> : null}
      {shown.length === 0 && <Text style={styles.empty}>{t('bok_empty')}</Text>}
      {shown.map((r) => (
        <View key={r.id} style={styles.card}>
          <TouchableOpacity
            style={styles.cardMain}
            onPress={() => openResv(r)}>
            <View style={styles.avatar}><Text style={styles.avatarT}>{r.name[0]}</Text></View>
            <View style={styles.info}>
              <Text style={[styles.name, isTablet && styles.nameBig]}>{r.name} · {r.tamu} {t('guests')} · {t('c_table')} {r.table}</Text>
              <Text style={[styles.meta, isTablet && styles.metaBig]}>{maskHp(r.phone)} · {t('kit_note')}: {r.note}</Text>
              <Text style={[styles.meta, isTablet && styles.metaBig]}>
                {r.date} · {r.time} · <Text style={[styles.statusBadge, { backgroundColor: statusStyle(r.status).bg, color: statusStyle(r.status).tx }]}>{r.status}</Text>
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
          {NEXT[r.status] && (
            <AppButton
              size="sm"
              title={`→ ${NEXT[r.status]}`}
              onPress={() => advance(r.id)}
              style={[styles.advBtn, { marginTop: 8 }]}
              textStyle={styles.advT}
            />
          )}
          <View style={styles.rowBtns}>
            <AppButton
              size="sm"
              variant="secondary"
              title={editingId === r.id ? t('bok_edited') : t('bok_edit')}
              onPress={() => startEdit(r)}
              fullWidth={false}
              style={[styles.editBtn, { marginTop: 0, borderColor: colors.navy }]}
              textStyle={styles.editT}
            />
            <AppButton
              size="sm"
              variant="secondary"
              title={confirmDel === r.id ? t('tbl_confirm_again') : t('bok_del')}
              onPress={() => void removeResv(r)}
              fullWidth={false}
              style={[styles.delBtn, confirmDel === r.id && styles.delBtnConfirm, { marginTop: 0, borderColor: colors.red }]}
              textStyle={[styles.delT, confirmDel === r.id && styles.delTConfirm]}
            />
          </View>
          {/* S7: PIN supervisor pindah ke dialog V1 (ketuk kedua buka dialog). */}
          {confirmDel === r.id ? (
            <Text style={styles.hint}>{t('void_need_pin').replace('{r}', 'order.cancel')}</Text>
          ) : null}
        </View>
      ))}

      <View style={[styles.card, styles.moveCard]}>
        <Text style={[styles.cardTitle, isTablet && styles.cardTitleBig]}>Pindah item / meja</Text>
        <Text style={[styles.meta, isTablet && styles.metaBig]}>Pindahan antar meja lewat layar khusus - bukan dari booking.</Text>
        <View style={[styles.links, { flexWrap: 'wrap', gap: 12 }]}>
          <TouchableOpacity onPress={() => navigation?.navigate('MoveItems', {})}><Text style={[styles.link, isTablet && styles.linkBig]}>{t('moveItems')}</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('MoveTable', {})}><Text style={[styles.link, isTablet && styles.linkBig]}>{t('moveTable')}</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}><Text style={[styles.link, isTablet && styles.linkBig]}>Denah Meja ›</Text></TouchableOpacity>
        </View>
      </View>
      {/* S7: hapus reservasi via persetujuan supervisor V1 (aksi cancel). */}
      <SupervisorApprovalDialog
        visible={approveDelOpen}
        action="cancel"
        refId={pendingDel?.id ?? ''}
        reasonPreset={pendingDel ? `Batal reservasi ${pendingDel.name} meja ${pendingDel.table}` : ''}
        fallbackAccessKey="order.cancel"
        onApproved={() => approveDel()}
        onCancel={() => { setApproveDelOpen(false); setPendingDel(null); }}
      />
    </>
  );

  const bookingForm = (
    <>
      <Text style={[styles.sec, isTablet && styles.secBig]}>{editingId ? t('bok_edit_title') : t('bok_new')}</Text>
      <Text style={[styles.hint, isTablet && styles.hintBig]}>
        {editingId ? t('bok_edit_hint') : t('bok_form_hint')}
      </Text>
      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('bok_name_label')}</Text>
      <AppInput boxStyle={styles.input} style={[styles.fieldText, isTablet && styles.inputBig]} value={name} onChangeText={setName} placeholder={t('bok_name_ph')} />
      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('bok_phone_label')}</Text>
      <AppInput boxStyle={styles.input} style={[styles.fieldText, isTablet && styles.inputBig]} value={phone} onChangeText={setPhone} placeholder={t('bok_phone_ph')} keyboardType="phone-pad" />
      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('bok_pax_label')}</Text>
      <AppInput boxStyle={styles.input} style={[styles.fieldText, isTablet && styles.inputBig]} value={tamu} onChangeText={setPax} placeholder={t('bok_pax_ph')} keyboardType="numeric" />
      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('c_table')}</Text>
      <View style={styles.chips}>
        {tablesFree.map((tb) => (
          <TouchableOpacity key={tb} style={[styles.chip, table === tb && styles.chipOn]} onPress={() => setTable(tb)}>
            <Text style={[styles.chipT, table === tb && styles.chipTOn, isTablet && styles.chipTBig]}>{tb}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('hist_f_date')}</Text>
      <View style={styles.chips}>
        {['Hari ini', 'Besok'].map((d) => (
          <TouchableOpacity key={d} style={[styles.chip, date === d && styles.chipOn]} onPress={() => setDate(d)}>
            <Text style={[styles.chipT, date === d && styles.chipTOn, isTablet && styles.chipTBig]}>{d === 'Hari ini' ? t('esb_today') : t('bok_tomorrow')}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('bok_time_label')}</Text>
      <AppInput boxStyle={styles.input} style={[styles.fieldText, isTablet && styles.inputBig]} value={time} onChangeText={setTime} placeholder={t('bok_time_ph')} />
      <Text style={[styles.label, isTablet && styles.labelBig]}>{t('kit_note')}</Text>
      <AppInput boxStyle={styles.input} style={[styles.fieldText, isTablet && styles.inputBig]} value={note} onChangeText={setNote} placeholder={t('kit_note')} />
      {warn ? <Text style={styles.warn}>{warn}</Text> : null}
      <AppButton
        size="md"
        title={editingId ? t('bok_save_changes') : `${t('bok_save')} ›`}
        onPress={save}
        style={styles.primary}
      />
      {editingId ? (
        <TouchableOpacity style={styles.cancelEdit} onPress={resetForm}>
          <Text style={styles.cancelEditT}>{t('bok_cancel_edit')}</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.fine}>{t('bok_example')}: Andini · 4 {t('guests')} · {t('c_table')} A2 · 19:00.</Text>
    </>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('title_booking')}
        left={
          <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('action_open_menu')}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      />
      {isTablet ? (
        <View style={[styles.split, wideCenterLg]}>
          <ScrollView style={styles.listSide} contentContainerStyle={styles.body}>
            {reservasiList}
          </ScrollView>
          <ScrollView style={styles.formSide} contentContainerStyle={styles.body}>
            {bookingForm}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {reservasiList}
          {bookingForm}
        </ScrollView>
      )}
      <DrawerMenu
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navigate={(r) => {
          navigation?.navigate(r);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  burger: { width: 22, height: 22 },
  body: { padding: 16, paddingBottom: 40 },
  count: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  todayToggle: { marginTop: 6 },
  todayToggleT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  sec: { fontFamily: fonts.bold, fontSize: 16, color: colors.navy, marginTop: 18 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 8 },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.faint, backgroundColor: colors.card, borderRadius: 10, padding: 14 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: colors.line },
  cardMain: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  advBtn: { backgroundColor: colors.paleGreen, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 8 },
  advT: { fontFamily: fonts.bold, fontSize: 12, color: colors.greenDark },
  rowBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  editBtn: { flex: 1, borderWidth: 1, borderColor: colors.navy, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  editT: { fontFamily: fonts.bold, fontSize: 12, color: colors.navy },
  delBtn: { flex: 1, borderWidth: 1, borderColor: colors.red, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  delBtnConfirm: { backgroundColor: colors.red, borderColor: colors.red },
  delT: { fontFamily: fonts.bold, fontSize: 12, color: colors.red },
  delTConfirm: { color: colors.white },
  cancelEdit: { marginTop: 10, padding: 10, alignItems: 'center' },
  cancelEditT: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  moveCard: { flexDirection: 'column' },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, marginBottom: 6 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paleBlue, alignItems: 'center', justifyContent: 'center' },
  avatarT: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy },
  info: { flex: 1 },
  name: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  statusBadge: { fontFamily: fonts.semibold, fontSize: 12, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  chev: { fontFamily: fonts.bold, fontSize: 20, color: colors.faint, alignSelf: 'center' },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.orangeDark },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  /** Teks di dalam AppInput: medium ala form lama. */
  fieldText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  split: { flex: 1, flexDirection: 'row' },
  listSide: { flex: 1 },
  formSide: { flex: 1, borderLeftWidth: 1, borderLeftColor: colors.line, backgroundColor: colors.card },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  warn: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red, marginTop: 8 },
  /* Varian tablet (breakpoint 768): teks +1..2pt agar proporsional di panel ganda. */
  countBig: { fontSize: 14 },
  secBig: { fontSize: 18 },
  hintBig: { fontSize: 13 },
  nameBig: { fontSize: 15 },
  metaBig: { fontSize: 13 },
  cardTitleBig: { fontSize: 15 },
  linkBig: { fontSize: 14 },
  labelBig: { fontSize: 13 },
  inputBig: { fontSize: 15 },
  chipTBig: { fontSize: 13 },
  primaryTBig: { fontSize: 16 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  fine: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, marginTop: 8 },
});
