import { useEffect, useState } from 'react';import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';import * as ImagePicker from 'expo-image-picker';import ScreenHeader from '../../components/ScreenHeader';import AppInput from '../../components/AppInput';import AppButton from '../../components/AppButton';import { TABLET_BP, colors, fonts, successCheck, rp, rpNum, wideCenterLg } from '../../theme';import { useLang } from '../../lib/i18n';import { getJSON, setJSON } from '../../lib/storage';import { ApiPath } from '../../config/server';import { apiFetch, unwrap } from '../../lib/apiSource';import { getSession } from '../../session';import { postExpenseToTerminal, isRemotePhoto, markPhotoPending, uploadExpensePhotoFirst, retryPendingExpensePhotos } from '../../lib/terminalExpense';import { getBranchId } from '../../config/server';import { initDb, queryFirst, run } from '../../lib/db';import { enqueueOutbox, enqueueSync } from '../../lib/sync';import {
  cashMoveBe,
  cashMovePayload,
  getCashSessionId,
  mapArusToMoveType,
  shouldQueueW1,
} from '../../lib/beWorkforce';import { uuidv7 } from '../../lib/uuidv7';
import { preparePhoto } from '../../lib/photo';type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };type Props = { navigation?: Nav };const FALLBACK_COA = ['Operasional', 'Bahan Baku', 'Gaji', 'Utilitas', 'Kas Kecil', 'Lainnya'];

interface CoaPullItem { coaId?: unknown; coaName?: unknown; name?: unknown; flagActive?: unknown; }/** CoA kas kecil: daftar dari pull chart-of-accounts bila tersedia di ms_setting, fallback konstanta. */async function loadCoa(): Promise<string[]> { try { await initDb(); const row = await queryFirst<{ value1: string | null }>( "SELECT value1 FROM ms_setting WHERE key1 = 'expense' AND key2 = 'coa_list'", ); if (row?.value1) { const parsed = JSON.parse(row.value1) as unknown; if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') && parsed.length > 0) { return parsed as string[]; } } } catch { /* abaikan: coba pull */ } try { const res = await apiFetch(ApiPath.pullExpenseCoa, { method: 'GET' }); const { data } = unwrap<{ items?: CoaPullItem[] }>(res.data); const pulled = Array.isArray(data?.items) ? data.items : []; const names = pulled.filter((it) => Number(it.flagActive ?? 1) !== 0).map((it) => String(it.coaName ?? it.name ?? '').trim()).filter((s) => s.length > 0); if (names.length > 0) { const uniq = [...new Set(names)]; try { await setJSON('genfity.expense.coa', uniq); } catch { /* abaikan */ } return uniq; } } catch { /* abaikan: pakai cache */ } try { const cached = await getJSON<string[]>('genfity.expense.coa', FALLBACK_COA); return cached.length > 0 ? cached : FALLBACK_COA; } catch { return FALLBACK_COA; }}export default function PettyCashFormScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const { lang, t } = useLang(); const [coaList, setCoaList] = useState<string[]>(FALLBACK_COA); const [arus, setArus] = useState<'Keluar' | 'Masuk'>('Keluar');
  const [coa, setCoa] = useState(FALLBACK_COA[0]);
  const [keterangan, setKeterangan] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState('');
  const [saving, setSaving] = useState(false); const [done, setDone] = useState<null | { id: string; arus: string; coa: string; jumlah: number; photo: string | null; photoPending?: boolean }>(null); useEffect(() => { let alive = true; void loadCoa().then((list) => { if (!alive) return; setCoaList(list); setCoa((c) => (list.includes(c) ? c : list[0])); }); void retryPendingExpensePhotos().catch(() => { /* best-effort */ }); return () => { alive = false; }; }, []);

  const jumlahNum = Number(jumlah.replace(/\D/g, '')) || 0;
  const ready = keterangan.trim().length >= 3 && jumlahNum > 0 && !saving;

  const pickPhoto = async () => {
    setPhotoErr('');
    try {
      // Tanpa izin pustaka media, galeri gagal diam-diam di Android (khususnya
      // Android lawas tanpa photo picker) - minta dulu, tampilkan pesan bila ditolak.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setPhotoErr(t('petty.photoDenied'));
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
      });
      // EFF-08: resize maks-1280px sisi-terpanjang sebelum simpan (galeri).
      if (!res.canceled && res.assets?.[0]?.uri) {
        const a = res.assets[0];
        setPhoto(await preparePhoto(a.uri, a.width, a.height));
      }
    } catch {
      setPhotoErr(t('petty.photoFailed'));
    }
  };

  const takePhoto = async () => {
    setPhotoErr('');
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setPhotoErr(t('petty.photoDenied'));
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.5 });
      // EFF-08: resize maks-1280px sisi-terpanjang sebelum simpan (kamera).
      if (!res.canceled && res.assets?.[0]?.uri) {
        const a = res.assets[0];
        setPhoto(await preparePhoto(a.uri, a.width, a.height));
      }
    } catch {
      setPhotoErr(t('petty.photoFailed'));
    }
  };

  /** Simpan ke tr_branchexpense + dokumen foto, antrekan outbox branch-expenses, lalu tampilkan hasil. */ const save = async () => { if (!ready) return; setSaving(true); const id = uuidv7(); const now = new Date().toISOString(); const signed = arus === 'Masuk' ? jumlahNum : -jumlahNum; const sess = getSession(); const kasir = sess?.userId || sess?.username || sess?.name || ''; const branchId = getBranchId(); const note = catatan.trim() ? `${keterangan.trim()} | ${catatan.trim()}` : keterangan.trim(); let finalPhoto: string | null = photo; let finalPending = false; try { await initDb(); await run( `INSERT INTO tr_branchexpense (id, branchId, coaId, coaName, amount, note, userId, expenseDate, photoPath, syncDate, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`, [id, branchId, coa, coa, signed, note, kasir || null, now, photo, now], ); if (photo) { await run( `INSERT INTO tr_branchexpensedocument (id, expenseId, docPath, docType, syncDate) VALUES (?, ?, ?, 'photo', NULL)`, [uuidv7(), id, photo], ); }
      // A10: handoff endpoint terminal (immediate-first, best-effort).
      // clientExpenseId = id baris (uuidv7 mentah, dibangun SEKALI di atas,
      // dipakai ulang saat retry); sukses terminal = LEWATI antrean ESB
      // (tutup ledger ganda); gagal/BE-BELUM-ADA = fallback ESB lama.
      // SESI-FINAL-APP: upload-DULU — foto lokal diunggah SEBELUM handoff;
      // sukses = kirim photoUrl + DB lokal dimutakhirkan ke URL remote;
      // gagal/offline = photoPending (marker storage + banner layar hasil +
      // retry saat mount/fokus layar kas).
      let terminalPosted = false;
      const alreadyRemote = isRemotePhoto(photo) ? String(photo).trim() : '';
      let remotePhoto = alreadyRemote;
      if (!remotePhoto && photo) {
        remotePhoto = await uploadExpensePhotoFirst(String(photo));
      }
      const localPhotoOnly = !!photo && !remotePhoto;
      try {
        const h = await postExpenseToTerminal({
          rowId: id,
          clientExpenseId: id,
          kind: 'PETTY_CASH',
          amount: signed,
          note,
          occurredAt: now,
          ...(remotePhoto ? { photoUrl: remotePhoto } : {}),
        });
        terminalPosted = h.posted === true;
      } catch { /* abaikan: fallback ESB */ }
      if (remotePhoto && remotePhoto !== photo) {
        // Upload-dulu sukses: mutakhirkan baris lokal ke URL remote.
        try {
          await initDb();
          await run('UPDATE tr_branchexpense SET photoPath = ? WHERE id = ?', [remotePhoto, id]);
          await run("UPDATE tr_branchexpensedocument SET docPath = ? WHERE expenseId = ? AND docType = 'photo'", [remotePhoto, id]);
        } catch { /* best-effort: handoff sudah bawa photoUrl */ }
      }
      if (localPhotoOnly) {
        try { await markPhotoPending(id, String(photo)); } catch { /* best-effort */ }
      }
      finalPhoto = remotePhoto || photo;
      finalPending = localPhotoOnly;
      if (!terminalPosted) {
        await enqueueOutbox('tr_branchexpense', id, 'insert'); enqueueSync('other', { table: 'tr_branchexpense', rowId: id, op: 'insert', ...(localPhotoOnly ? { photoPending: true } : {}) });
      }
      // W1 (SESI-FIX-APPW1): cermin mutasi kas ke sesi kas server — immediate-
      // first fire-and-forget SETELAH lokal menang di atas. Tanpa sesi server
      // (mis. open offline belum terkirim) = langsung antrekan op be-cash-move
      // (drain menunggu open via FIFO, lalu memakai id sesi hasil open); 4xx
      // deterministik = error jujur (tak diantre). PIN tak pernah ikut.
      void (async () => {
        try {
          const moveType = mapArusToMoveType(arus);
          const reason = note || keterangan.trim();
          if (!moveType || jumlahNum <= 0 || !reason) return;
          const sid = await getCashSessionId();
          if (sid) {
            const mv = await cashMoveBe(sid, moveType, jumlahNum, reason);
            if (!mv.ok && shouldQueueW1(mv)) {
              try {
                enqueueSync('other', cashMovePayload(moveType, jumlahNum, reason));
              } catch {
                /* abaikan */
              }
            }
          } else {
            try {
              enqueueSync('other', cashMovePayload(moveType, jumlahNum, reason));
            } catch {
              /* abaikan */
            }
          }
        } catch {
          /* abaikan */
        }
      })(); } catch { /* DB belum init: alur kasir tetap jalan, data dipegang layar daftar */ } setSaving(false); setDone({ id, arus, coa, jumlah: jumlahNum, photo: finalPhoto, ...(finalPending ? { photoPending: true } : {}) }); }; if (done) {
    return (
      <View style={s.root}>
        <ScreenHeader title={t('petty.formTitle')} onBack={() => navigation?.goBack?.()} /><View style={[s.body, isTablet && wideCenterLg]}>
          <View style={s.checkCircle}><Text style={s.checkMark}>✓</Text></View>
          <Text style={s.title}>{t('petty.doneTitle')}</Text>
          <Text style={s.sub}>{done.arus === 'Masuk' ? t('petty_flow_in') : t('petty_flow_out')} - {done.coa} - {rp(done.jumlah)}</Text>{done.photo ? <Image source={{ uri: done.photo }} style={s.donePhoto} /> : null}{done.photoPending ? <Text style={s.pending}>{t('expense.photoPending')}</Text> : null}
          <AppButton title={t('petty.detailTitle')} onPress={() => navigation?.navigate('PettyCashDetail', { id: done.id, tanggal: new Date().toLocaleString(lang === 'en' ? 'en-US' : 'id-ID'), keterangan, coa: done.coa, arus: done.arus, jumlah: done.jumlah, kasir: getSession()?.name ?? '', disetujui: false, photo: done.photo, })} />
          <AppButton title={t('petty.viewList')} variant="secondary" onPress={() => navigation?.navigate('PettyCash')} />
          <AppButton title={t('petty.recordAgain')} variant="secondary" style={s.ghost} textStyle={s.ghostT} onPress={() => { setDone(null); setKeterangan(''); setJumlah(''); setCatatan(''); setPhoto(null); setPhotoErr(''); }} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScreenHeader title={t('petty.formTitle')} onBack={() => navigation?.goBack?.()}  />

      <ScrollView contentContainerStyle={[s.body, isTablet && wideCenterLg]}>
        <View style={s.card}>
          <Text style={s.cardTitle}>{t('petty.flow')}</Text>
          <View style={s.arusRow}>
            {(['Keluar', 'Masuk'] as const).map((a) => (
              <TouchableOpacity
                key={a}
                style={[s.arusBtn, arus === a && (a === 'Keluar' ? s.arusOut : s.arusIn)]}
                onPress={() => setArus(a)}>
                <Text style={[s.arusTxt, arus === a && s.arusTxtOn]}>
                  {a === 'Keluar' ? '- ' + t('petty.out') : '+ ' + t('petty.in')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('petty.account')}</Text>
          <View style={s.chips}>
            {coaList.map((c) => (
              <TouchableOpacity
                key={c}
                style={[s.chip, coa === c && s.chipOn]}
                onPress={() => setCoa(c)}>
                <Text style={[s.chipTxt, coa === c && s.chipTxtOn]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('petty.nominalDesc')}</Text>
          <AppInput
            label={t('petty.amount')}
            keyboardType="number-pad"
            placeholder="0"
            value={jumlahNum ? rpNum(jumlahNum) : ''}
            onChangeText={(v) => setJumlah(v.replace(/\D/g, '').slice(0, 12))}
            style={{ textAlign: 'right', fontFamily: fonts.bold, fontSize: 20 }}
          />
          <AppInput
            label={t('petty.desc')}
            placeholder={t('petty.descPh')}
            value={keterangan}
            onChangeText={setKeterangan}
          />
          <AppInput
            label={t('petty.note')}
            placeholder={t('petty.notePh')}
            multiline
            value={catatan}
            onChangeText={setCatatan}
            boxStyle={{ height: 'auto', minHeight: 70, alignItems: 'flex-start' }}
            style={{ textAlignVertical: 'top' }}
          />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{t('petty.photo')}</Text>
          {photo ? (
            <Image source={{ uri: photo }} style={s.preview} />
          ) : (
            <Text style={s.hintLeft}>{t('petty.photoHint')}</Text>
          )}
          <View style={s.photoRow}>
            <AppButton
              size="md"
              title={t('petty.camera')}
              variant="secondary"
              fullWidth={false}
              style={{ marginTop: 0 }}
              onPress={takePhoto}
            />
            <AppButton
              size="md"
              title={t('petty.gallery')}
              variant="secondary"
              fullWidth={false}
              style={{ marginTop: 0 }}
              onPress={pickPhoto}
            />
            {photo ? (
              <TouchableOpacity onPress={() => setPhoto(null)} hitSlop={10}>
                <Text style={s.del}>{t('common.delete')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {photoErr ? <Text style={s.err}>{photoErr}</Text> : null}
        </View>

        <AppButton
          title={`${t('petty.save')} - ${rp(jumlahNum)}`}
          disabled={!ready}
          onPress={() => void save()}
        />
        {!ready && (
          <Text style={s.hint}>{t('petty.fillHint')}</Text>
        )}
      </ScrollView>
    </View>
  );}const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  body: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  label: { fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, marginTop: 12, marginBottom: 6 },
  arusRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  arusBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.card },
  arusOut: { backgroundColor: colors.red, borderColor: colors.red },
  arusIn: { backgroundColor: colors.green, borderColor: colors.green },
  arusTxt: { fontSize: 14, fontFamily: fonts.bold, color: colors.muted },
  arusTxtOn: { color: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  chip: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 20,
    paddingVertical: 7, paddingHorizontal: 12, marginRight: 8, marginBottom: 8, backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.paleOrange },
  chipTxt: { fontSize: 12, fontFamily: fonts.medium, color: colors.muted },
  chipTxtOn: { color: colors.orangeDark },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.line,
    borderRadius: 10, paddingHorizontal: 12, backgroundColor: colors.white,
  },
  rpPrefix: { fontSize: 16, fontFamily: fonts.bold, color: colors.muted },
  amountInput: { flex: 1, fontSize: 20, fontFamily: fonts.bold, color: colors.text, paddingVertical: 10, marginLeft: 8, textAlign: 'right' },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 14, fontFamily: fonts.regular, color: colors.text,
  backgroundColor: colors.white, },
  noteInput: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 14, fontFamily: fonts.regular, color: colors.text, backgroundColor: colors.white, minHeight: 70, textAlignVertical: 'top',
  },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 8, textAlign: 'center' },
  hintLeft: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 8 }, preview: { width: '100%', height: 200, borderRadius: 10, backgroundColor: colors.line, marginTop: 10 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  photoBtn: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  photoBtnT: { fontFamily: fonts.semibold, fontSize: 13, color: colors.navy },
  del: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red },
  err: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 8 },
  // A-P1-6: banner foto-menunggu-upload di layar hasil (kuning/merah lembut,
  // bukan error picker).
  pending: { fontFamily: fonts.medium, fontSize: 12, color: colors.orange, marginTop: 8, textAlign: 'center' },
  primary: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  disabled: { opacity: 0.5 },
  primaryT: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  ghost: { borderWidth: 1, borderColor: colors.navy, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  ghostT: { fontSize: 14, fontFamily: fonts.bold, color: colors.navy },
  checkCircle: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', marginTop: 32, alignSelf: 'center',
  },
  checkMark: { color: colors.white, fontSize: successCheck.mark, fontFamily: fonts.bold },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.text, marginTop: 14, textAlign: 'center' },
  sub: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
  donePhoto: { width: '100%', height: 200, borderRadius: 10, backgroundColor: colors.line, marginTop: 14 },});