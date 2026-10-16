import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts, rp } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';
import DrawerMenu from '../../components/DrawerMenu';
import { useLang } from '../../lib/i18n';
import { initDb, run } from '../../lib/db';
import { getJSON, setJSON } from '../../lib/storage';
import { enqueueSync } from '../../lib/sync';

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

const SEED: Resv[] = [
  { id: 'r1', name: 'Andini', tamu: 4, table: 'A2', phone: '0812-7788-9900', note: 'dekat jendela', date: 'Hari ini', time: '12:30', status: 'Datang' },
  { id: 'r2', name: 'Rudi Hartono', tamu: 2, table: 'B1', phone: '0813-2211-4455', note: 'Ulang tahun', date: 'Hari ini', time: '18:00', status: 'Terjadwal' },
  { id: 'r3', name: 'PT Maju Jaya', tamu: 10, table: 'C2', phone: '021-5566-7788', note: 'Bukber, butuh proyektor', date: 'Besok', time: '19:00', status: 'Terjadwal' },
];

/** Daftar reservasi tersimpan di perangkat agar bertahan saat aplikasi dibuka ulang. */
const BOOK_KEY = 'genfity.booking.list';

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
/** Label chip meja: "A2 · Dalam (2 kursi)" — kode kanonis + section + kapasitas. */
function tableLabel(tb: { no: string; section: string; kap: number }): string {
  return `${tb.no} · ${tb.section} (${tb.kap} kursi)`;
}

const TABLES_FREE = CANON_TABLES.map(tableLabel);

/** Booking / reservasi - form + daftar, tersimpan di perangkat dan sinkron ke denah. */
export default function BookingScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { t } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [list, setList] = useState<Resv[]>(SEED);
  const [onlyToday, setOnlyToday] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tamu, setPax] = useState('');
  const [table, setTable] = useState(TABLES_FREE[0] as string);
  const [date, setDate] = useState('Hari ini');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [warn, setWarn] = useState('');
  /** Id reservasi yang sedang diedit (null = mode tambah baru). */
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    void getJSON<Resv[]>(BOOK_KEY, SEED).then((v) => {
      if (!on || !Array.isArray(v)) return;
      const base = v.length > 0 ? v : SEED;
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
  }, []);

  const persist = (next: Resv[]) => {
    setList(next);
    void setJSON(BOOK_KEY, next);
  };

  const shown = onlyToday ? list.filter((r) => r.date === 'Hari ini') : list;

  const resetForm = () => {
    setName(''); setPhone(''); setPax(''); setTime(''); setNote('');
    setDate('Hari ini'); setTable(TABLES_FREE[0] as string);
    setEditingId(null); setWarn('');
  };

  const save = () => {
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
        await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE tableNo = ?', ['dipesan', code]);
      } catch {
        /* master belum tersedia */
      }
    })();
    setName(''); setPhone(''); setPax(''); setTime(''); setNote('');
  };

  const advance = (id: string) =>
    persist(
      list.map((r) => {
        const nx = NEXT[r.status];
        return r.id === id && nx ? { ...r, status: nx } : r;
      }),
    );

  /** Muat satu reservasi ke form untuk diedit. */
  const startEdit = (r: Resv) => {
    setEditingId(r.id);
    setName(r.name);
    setPhone(r.phone === '-' ? '' : r.phone);
    setPax(String(r.tamu));
    const match = CANON_TABLES.find((tb) => tb.no === canonTableNo(r.table));
    setTable(match ? tableLabel(match) : TABLES_FREE[0] as string);
    setDate(r.date);
    setTime(r.time);
    setNote(r.note === '-' ? '' : r.note);
    setWarn('');
  };

  /** Hapus/batalkan reservasi (tanya dua ketuk: tombol berubah jadi konfirmasi). */
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const removeResv = (r: Resv) => {
    if (confirmDel !== r.id) {
      setConfirmDel(r.id);
      return;
    }
    setConfirmDel(null);
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
    void (async () => {
      try {
        await initDb();
        await run('UPDATE ms_table SET status = ?, syncDate = NULL WHERE tableNo = ?', ['kosong', r.table]);
      } catch {
        /* master belum tersedia */
      }
    })();
  };

  const reservasiList = (
    <>
      <Text style={styles.count}>ESB Cabang Poris · {shown.length} reservasi aktif</Text>
      <TouchableOpacity onPress={() => setOnlyToday((v) => !v)} style={styles.todayToggle}>
        <Text style={styles.todayToggleT}>{onlyToday ? '☑ Hari ini saja' : '☐ Hari ini saja'}</Text>
      </TouchableOpacity>

      <Text style={styles.sec}>{t('bok_list')}</Text>
      <Text style={styles.hint}>Ketuk untuk buka di kasir (meja + nama + tamu ikut) · tombol status memajukan Terjadwal → Datang → Selesai.</Text>
      {shown.length === 0 && <Text style={styles.empty}>Belum ada reservasi - buat baru di bawah.</Text>}
      {shown.map((r) => (
        <View key={r.id} style={styles.card}>
          <TouchableOpacity
            style={styles.cardMain}
            onPress={() => navigation?.navigate('Cashier', { table: r.table, customer: r.name, mode: 'DINE IN', tamu: r.tamu })}>
            <View style={styles.avatar}><Text style={styles.avatarT}>{r.name[0]}</Text></View>
            <View style={styles.info}>
              <Text style={styles.name}>{r.name} · {r.tamu} tamu · Meja {r.table}</Text>
              <Text style={styles.meta}>{maskHp(r.phone)} · Catatan: {r.note}</Text>
              <Text style={styles.meta}>
                {r.date} · {r.time} · <Text style={[styles.statusBadge, { backgroundColor: statusStyle(r.status).bg, color: statusStyle(r.status).tx }]}>{r.status}</Text>
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
          {NEXT[r.status] && (
            <TouchableOpacity style={styles.advBtn} onPress={() => advance(r.id)}>
              <Text style={styles.advT}>→ {NEXT[r.status]}</Text>
            </TouchableOpacity>
          )}
          <View style={styles.rowBtns}>
            <TouchableOpacity style={styles.editBtn} onPress={() => startEdit(r)}>
              <Text style={styles.editT}>{editingId === r.id ? '● Diedit…' : '✎ Edit'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.delBtn, confirmDel === r.id && styles.delBtnConfirm]}
              onPress={() => removeResv(r)}>
              <Text style={[styles.delT, confirmDel === r.id && styles.delTConfirm]}>
                {confirmDel === r.id ? 'Yakin? Ketuk lagi' : '🗑 Batal/Hapus'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <View style={[styles.card, styles.moveCard]}>
        <Text style={styles.cardTitle}>Pindah item / meja</Text>
        <Text style={styles.meta}>Pindahan antar meja lewat layar khusus - bukan dari booking.</Text>
        <View style={[styles.links, { flexWrap: 'wrap', gap: 12 }]}>
          <TouchableOpacity onPress={() => navigation?.navigate('MoveItems', {})}><Text style={styles.link}>Pindah Item ›</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('MoveTable', {})}><Text style={styles.link}>Pindah Meja ›</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation?.navigate('Tables')}><Text style={styles.link}>Denah Meja ›</Text></TouchableOpacity>
        </View>
      </View>
    </>
  );

  const bookingForm = (
    <>
      <Text style={styles.sec}>{editingId ? t('bok_edit') : t('bok_new')}</Text>
      <Text style={styles.hint}>
        {editingId ? t('bok_edit_hint') : t('bok_form_hint')}
      </Text>
      <Text style={styles.label}>{t('bok_name_label')}</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t('bok_name_ph')} placeholderTextColor={colors.faint} />
      <Text style={styles.label}>{t('bok_phone_label')}</Text>
      <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder={t('bok_phone_ph')} keyboardType="phone-pad" placeholderTextColor={colors.faint} />
      <Text style={styles.label}>{t('bok_pax_label')}</Text>
      <TextInput style={styles.input} value={tamu} onChangeText={setPax} placeholder={t('bok_pax_ph')} keyboardType="numeric" placeholderTextColor={colors.faint} />
      <Text style={styles.label}>{t('c_table')}</Text>
      <View style={styles.chips}>
        {TABLES_FREE.map((tb) => (
          <TouchableOpacity key={tb} style={[styles.chip, table === tb && styles.chipOn]} onPress={() => setTable(tb)}>
            <Text style={[styles.chipT, table === tb && styles.chipTOn]}>{tb}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>{t('hist_f_date')}</Text>
      <View style={styles.chips}>
        {['Hari ini', 'Besok'].map((d) => (
          <TouchableOpacity key={d} style={[styles.chip, date === d && styles.chipOn]} onPress={() => setDate(d)}>
            <Text style={[styles.chipT, date === d && styles.chipTOn]}>{d === 'Hari ini' ? t('esb_today') : t('bok_tomorrow')}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>{t('bok_time_label')}</Text>
      <TextInput style={styles.input} value={time} onChangeText={setTime} placeholder={t('bok_time_ph')} placeholderTextColor={colors.faint} />
      <Text style={styles.label}>{t('kit_note')}</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder={t('kit_note')} placeholderTextColor={colors.faint} />
      {warn ? <Text style={styles.warn}>{warn}</Text> : null}
      <TouchableOpacity style={styles.primary} onPress={save}>
        <Text style={styles.primaryT}>{editingId ? t('bok_save_changes') : `${t('bok_save')} ›`}</Text>
      </TouchableOpacity>
      {editingId ? (
        <TouchableOpacity style={styles.cancelEdit} onPress={resetForm}>
          <Text style={styles.cancelEditT}>{t('bok_cancel_edit')}</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.fine}>{t('bok_example')}: Andini · 4 {t('guests')} · {rp(86400)} · {t('c_table')} A2.</Text>
    </>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t('title_booking')}
        onBack={() => navigation?.goBack()}
        right={
          <TouchableOpacity onPress={() => setDrawerOpen(true)} hitSlop={10}>
            <Image source={require('../../../assets/icons/burger.webp')} style={styles.burger} resizeMode="contain" />
          </TouchableOpacity>
        }
      />
      {isTablet ? (
        <View style={styles.split}>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  split: { flex: 1, flexDirection: 'row' },
  listSide: { flex: 1 },
  formSide: { flex: 1, borderLeftWidth: 1, borderLeftColor: colors.line, backgroundColor: colors.card },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipT: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  chipTOn: { color: colors.orangeDark },
  warn: { fontFamily: fonts.semibold, fontSize: 12, color: colors.red, marginTop: 8 },
  primary: { backgroundColor: colors.orange, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  primaryT: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  fine: { fontFamily: fonts.regular, fontSize: 11, color: colors.faint, marginTop: 8 },
});
