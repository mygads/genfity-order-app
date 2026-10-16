# Audit 1:1 POSLite → Genfity Order App (PERMANEN)

> Dibuat 2026-10-16 dari perbandingan piksel lawan capture asli di `docs/ss-poslite/`.
> Aturan main: `docs/ss-poslite/` HANYA berisi original TAMU (intro/install/login/cabang/QR-how).
> Tidak ada original post-login - klaim "1:1" di balik login dinilai lawan
> `docs/REA-poslite-dossier.md` Lampiran A + konsistensi internal, BUKAN lawan foto.
> File ini penanda permanen: yang ✅ jangan dicari/diulik lagi; yang ⏳ daftar tutupnya.

## Legenda
- ✅ = selesai, terverifikasi lawan original (jangan disentuh lagi kecuali regresi)
- ⏳ = belum / aproksimasi jujur (tutupnya dicatat di kolom "Kurang apa")
- ➕ = superset disengaja (fungsi wajib yang tidak ada di asli - JANGAN dihapus demi 1:1)

## Grup TAMU (punya original - dinilai ketat)

| Layar | Status | Catatan kunci |
|---|---|---|
| Intro p1-p4 | ✅ | Judul biru semua; tanpa "Lewati"; tombol stadium r26; `Lanjutkan  ›` spasi sesuai asli; dots oranye |
| Pilih Cabang | ✅ | Panah ← dalam layar (tanpa navy header); pin `install_location_pin.webp`; spinner biru saat load; CTA stadium pucat saat loading/kosong |
| Login email | ✅ | Ikon kartu/input/mata/gagal semua aset asli (`login_username_*`, `login_scanqr_*`, `username/password/show/hide.webp`, `fail_red.webp`); error merah + border merah; Masuk stadium penuh-oranye saat terisi, pucat saat kosong |
| Login QR | ✅ | Ilustrasi + outline "Cara mendapatkan QR" + "Scan QR" glow; tanpa kotak-simulasi/manual (tidak ada di asli) |
| QrHow (Cara mendapatkan QR) | ✅ | Header biru + banner `get_qr_banner*.webp` + 4 thumbnail `get_qr_thumbnail_*.webp` + teks langkah verbatim capture how1-4 |
| Help (?) login | ✅ | QR WA asli `whatsapp_qr.webp`; logo ESB; "0822-1066-6969" strip; tombol "Oke" |
| Show-pass / filled / error states | ✅ | Sesuai `login-showpass`, `05b-login-filled`, `login-error` (ikon abu saat normal, merah saat error) |
| Ilustrasi tablet-QR mode login | ⏳ | Aproksimasi View (tidak ada aset ini di bundle); jika APK asli dibongkar dan ketemu, ganti Image |
| Video tutorial QrHow (play) | ⏳ | Thumbnail statis; video butuh URL stream dari backend - belum ada kontraknya |
| Search + kartu cabang | ➕ | Tidak ada di capture (capture = loading); dipertahankan untuk multi-cabang |
| "Lupa PIN?" di Login | ➕ | Tidak ada di capture; dipertahankan (navigasi wajib, komitmen sebelumnya) |

## Grup POST-LOGIN (tanpa original - dinilai lawan dossier + konsistensi)

| Area | Status | Catatan |
|---|---|---|
| Drawer kiri | ✅ | Slide dari kiri (diperbaiki dari kanan); isi sesuai Lampiran A |
| Payment: Qris/Edc/Success/Receipt | ✅ | FauxQr dekoratif jujur (payload asli butuh merchant ID backend); Success orderNo deterministik; Cetak → Receipt dua form-factor; split-bill genap |
| BillPreview/Cancel split & void | ✅ | Sisa genap; void split toggle; bayar-sisa → Pay; supervisor PIN via server |
| Cashier ↔ Tables/Booking/Voucher/Member | ✅ | Mode TAKE AWAY; table attach; voucher menempel ke transaksi; riwayat member rp()+offline guard |
| QrScan kamera | ✅ | CameraView QR asli + tab claim/esb/member/voucher (milik worker lain - jangan sentuh file ini) |
| Receipt void-lines (T8) | ✅ | Cancel → Receipt oper `voidLines`+`reason`+`table`+`cashier`; Receipt render seksi void + shareText; key `rc_void_*` sudah ada di kamus `src/lib/i18n.ts:383-385` (milik worker lain); Props terima `table`/`cashier`/`customer`/`ongkir`; hardcode 38900/5000 sudah dihapus worker lain (T3 ikut maju) |
| Shift/History/Cash/Settings | ⏳ | **JANGAN SENTUH** - sedang refactor i18n worker lain (tsc sempat merah `EsbStatus 'Batal'`, sudah hijau lagi 2026-10-16) |
| Print fisik | ⏳ | `printReceipt` stub; modul `genfity-printer` milik worker lain |
| Backend API/WS/sync/push | ⏳ | Kontrak di `docs/API-CONTRACT.md` (milik worker lain); outbox+sync sudah terpasang di Cancel |

## Hasil audit 12-area (2026-10-16, workflow wf_e5d2cbe1 - 12 agen, 229 tool call)

Vonis per rute vs dossier + konsistensi (bukan vs foto - tidak ada original post-login).
Detail gap per file ada di output workflow; ringkasan jadi TODO bernomor di bawah.

| Area | Vonis | Inti sisa |
|---|---|---|
| Dashboard + Drawer + ScreenHeader + guard | DONE / PARTIAL (navbar 2 pola, guard T1) | ✅ H-1 SUDAH ADA (vonis lama "T12 H-1" usang — REA 2026-10-16: DashboardScreen 76,108-117 baseline SQLite). SISA: logout tanpa reset stack; titik shift selalu hijau; Cashier header kustom (S3 by-design); guard per-CTA Transaksi Baru (guard navigator ada); ikon drawer nav_* tak dipasang. ✅ FIXER 2026-10-16 (aeb07c1, tsc EXIT 0): logout reset stack (DrawerMenu + DashboardScreen); titik shift live tr_shiftlog di drawer (hijau/merah/kuning) + dashboard (hijau/merah); guard per-CTA Transaksi Baru → Shift + notice; ikon nav_* 8 berkas terpasang di 10 baris (Tables→nav_order, Expense→nav_petty_cash, Member→nav_attendance, rationale di komentar). SISA AKHIR: Cashier header kustom (S3 by-design) |
| Kasir & order | PARTIAL | ✅ Pajak tampil PPN 11/111 + rounding step 100 + baris Rounding di Cashier/CartDetail/DineIn (2026-10-16, tsc hijau); ✅ CustomMenu saveNotes ke item benar + tipe CustomMenu dilebarkan; ✅ SplitBill reaporsi proporsional + oper items/mode/table ke Pay. ✅ HOLD worker SELESAI 2026-10-16: refactor totals+SQLite hijau (`tsc` EXIT:0); konten batch-4 saya terverifikasi selamat semua (marker `bill_qr_after_pay/bok_open_hint/bok_empty/cart_restore/promo_remove/tmr_sub/guestFallback/searchMenu/customer-tamu` utuh) + `Rounding` Cashier ikut `t()`; batch-4 tercommit (`f69662e`). SISA: LoadOrder seed; salesNum bukan TRX-YYYYMMDD-NNN; master.ts 6 domain vs kontrak 11+ grup (file milik worker lain — JANGAN SENTUH) |
| Pembayaran (Pay/Qris/Edc/Success/Receipt/BillPreview/Cancel) | PARTIAL (T8 ✅, T5 decided) | ✅ Batch-2 2026-10-16: method mentah per-split (bank tak hilang); transfer wajib referensi; approvalCode EDC → Success/Receipt; Success ringkasan mini + cetak langsung; BillPreview tanpa hardcode + teruskan konteks; Receipt baris voucher/approval/terminal + footer cabang + key kamus `xp_ref_*`/`ok_*`/`rc_voucher|approval|terminal`. ✅ Batch-4 T5: TIDAK ada aksi Cetak-QR pra-bayar di BillPreview — diputus tambah teks jujur `bill_qr_after_pay` ("QR struk tercetak setelah pembayaran"); ✅ terverifikasi visual 2026-10-16 (10/10 PNG baru phone+tablet: hint tampil; alarm "hilang di tablet-ID" terbukti PNG basi — shot segar tampilkan hint; NOL kunci mentah bocor). CartDetail/Cashier punya tombol print→Receipt pra-bayar yang ambigu — keputusan produk: gate QR di Receipt (file worker) atau biarkan. SISA: QR dekoratif (butuh merchant ID BE); poll lokal; bank/terminal hardcode; ULTRA10 persen vs Cashier flat; mock display BillPreview (TRX-047/ESB CABANG PORIS/021-5566) butuh profil merchant BE; Pay `?? 266000` + MEMBER_DEPOSIT_DB/CARDS/DRAWERS mock butuh master BE; ✅ tanggal Pay DAYS/MONTHS ikut bahasa (2026-10-16) |
| Shift/kas (Attendance/Shift/Recap/EndShift) | PARTIAL (milik worker lain - JANGAN SENTUH) | ✅ REA 2026-10-16: vonis lama "tanpa proteksi shift-ganda / PIN tak verifikasi / promo statis" USANG — guard shift-ganda ADA (ShiftScreen 62-70), PIN via authorizeSupervisor+fallback ADA (75-89), promo rekap agregasi DB ADA (RecapScreen 176-238, seed fallback), tr_shiftlogdetail ditulis saat tutup. SISA NYATA: tanpa cetak shift/rekap + FailedPrintLog; state absensi tak pulih; baris Istirahat placeholder; RANGES + string Shift/EndShift hardcode ID; attempt-limit (T11); kebijakan panjang PIN 4-vs-6 (keputusan produk, dossier tak tetapkan angka) |
| Meja & booking | PARTIAL | ✅ Batch-2: format kanonis A1-A4/B1-B3/C1-C2 + section di Move/DineIn/Booking/Timer; Booking edit + hapus + oper konteks ke Cashier; timer tick 10 dtk live + autoExtend nyata. ✅ Batch-3+: Cashier terima `customer`/`tamu` dari Booking (nama prefill + "(N tamu)" di kolom info, terus ke CartDetail). SISA: TablesScreen kanonis milik worker (rujukan read-only); denah live ms_table (butuh pull BE) |
| Member/Voucher/Topup | PARTIAL | ✅ Batch-2: nominal topup benar; guard offline voucher + banner; MIN_TOPUP 10000; prefix Rp via rp(). ✅ Batch-3: tipe Member dilebarkan (`memberId/saldoBaru/topupNominal`, dua-arah terverifikasi). SISA: endpoint voucherBurn/deposit-topup di `server.ts` (milik worker); ULTRA10 persen vs Cashier flat; pesan min_topup pakai ulang key |
| History/EsbOrder/Kitchen | PARTIAL (milik worker lain - JANGAN SENTUH) | Email antre lokal; nav tanpa items → struk dummy; nomor order inkonsisten; action void/change-payment di luar kontrak; void tanpa supervisor; ESB/Kitchen state lokal tanpa outbox; filter tanggal mock; total ESB tanpa rumus kanonik; tolak tanpa alasan; harga/station fallback; tanpa label station/print retry |
| PettyCash/Expense | PARTIAL (milik worker lain - JANGAN SENTUH) | Saldo hanya PC-%; tanpa saldo berjalan; tanpa ubah/hapus; CoA tak tersinkron; push salah rute order/finish; approve tanpa PIN/audit; tanpa layar preview-foto; Expense tanpa filter bulan |
| Settings/Printers/Menu/Stock/Sync/Log/About/Help | PARTIAL+DONE campur | Tanpa timeout 120 dtk + izin BT; tanpa FailedPrintLog; Menu tanpa tambah/hapus; tanpa layar online-menu-stock (GAP); Log di AsyncStorage bukan tr_applog + tanpa tr_transactionlogapi; escpos tanpa QR raster/pajak/voucher/rounding/footer + tanpa Star/label; autoCut tak persist; T10 fisik luar kode |
| Display/Idle/QrScan/Install/CreatePin/ForgotPin | PARTIAL | CustomerDisplay hardcode + tanpa Presentation API; Idle statis; QrScan QR-only + kartu hasil prematur; Install klaim simulasi + tanpa no-terminal-code; InstallProgress timer palsu; CreatePin userId hardcode + pesan hardcode; ForgotPin lokal-only + hardcode |
| Bahasa & konsistensi UI | DONE kamus / PARTIAL cakupan | ✅ Batch-2: 5 layar tamu (Login/QrHow/Intro/ForgotPin/InstallProgress) pakai `useLang()` + 63 key `g_*`; key pay-chain `xp_ref_*`/`ok_*`/`rc_*` ditambah. ✅ Batch-3: Booking form full `t()` + 17 key `bok_*` baru (data tersimpan SENGAJA tetap ID — butuh migrasi data, batch terpisah); NOL literal `768` di 31 file sehat (semua `TABLET_BP`); 9 style input outlier → font 14 kanonis. ✅ Batch-4: 7 key baru (`bill_qr_after_pay/rounding/cart_restore/promo_remove/bok_open_hint/bok_empty/tmr_sub`) di-append ke `src/lib/i18n.ts` (file UNTRACKED milik worker — HELD, jangan commit); kritikus verifikasi rumus/`TABLET_BP`/font-14 NOL temuan di file sehat. SISA: TopupDeposit/Voucher/Booking `undefined` di types (sengaja — tak ada pemanggil kirim params) |
| Data & API (dummy/server.ts/db.ts/sync/CONTRACT) | PARTIAL | ✅ REA 2026-10-16: 39 ApiPath ↔ DUMMY 1:1 (apiSource katalog) + envelope Yii2 + OTA array via unwrap() + fallback offline→dummy. ✅ Alarm "TAX_DEFAULT=10" SALAH — `src/lib/totals.ts:33` SUDAH 11 (kontrak §10.3, fixtures 66000→6541 cocok). SISA: tr_transactionlogapi hanya CREATE tanpa tulis; logApp() 1 hit (tak pernah dipanggil); B001 fallback hardcode; pull paging lastSyncDate/page tak dipakai pemanggil; ApiPath hilang 9 endpoint kontrak; pushAll kind other→order/finish + tak kuras tr_esoprocessqueue; OTA apkUrl placeholder |

## Verdict REA 2026-10-16 (workflow wf_ba0b1083 — 7 sweep + kritikus, input kritikus TERPOTONG: hanya 2/7 area masuk)

> Kritikus hanya menerima NAV+UI dan DASHBOARD+SHIFT (input harness terpotong di 12000 char). 5 area lain (kasir/pay/member-hist/settings/data) TIDAK sempat divonis — TODO mentah sweep tersimpan, JANGAN dianggap vonis. Fixer 2 agen tak jalan (bug script: `agent()` tanpa await) — harus re-run.

### CONFIRMED DONE (25 item — jangan dicari lagi)
- Drawer kiri translateX [-drawerW,0] 300/340, 10 item cocok dossier:159-160, anim 260ms cubic-out / 200ms cubic-in
- ScreenHeader tunggal navy tengah sisi-70; SEMUA Stack.Screen headerShown:false — tak ada tumpuk native
- burger.webp Dashboard+Cashier; TABLET_BP=768 tunggal (nol literal); wideCenter 880/560/1024
- HKGrotesk 4 weight (dossier:113); font input 14; modal fade=form / slide=detail; stack anim default platform
- Dashboard: kartu shift tr_shiftlog, omzet tr_saleshead+demo, H-1 delta SQLite, peta meja, stok menipis qty<=8, grid 11 menu+Absensi/Keluar+sync
- Shift: cegah-ganda, PIN authorizeSupervisor+fallback, insert tr_shiftlog+outbox+enqueue, kas awal+terbilang+chip+maks 10jt
- Absensi: clock-in/out+enqueue, ganti PIN hash+updatePinOnServer; Rekap: filter H/Kemarin/7H+hero+seksi SQLite+seed, promo T6 agregasi DB (seed fallback); Tutup: TUNAI murni+rumus+tulis tr_shiftlogdetail+enqueue
- Guard navigator: shiftlog kosong bebas / ada-riwayat-tanpa-open mulai di Shift+notice

### KILLED STALE (10 item — vonis lama usang, baris tabel di atas SUDAH dikoreksi)
- "7 hasil sweep" (hanya 2 area teks diterima); "CTA tanpa cek shift" (guard navigator ADA — sisa benar hanya guard per-CTA)
- AUDIT:51 "T12 H-1" — H-1 ADA (DashboardScreen 76,108-117); AUDIT:54 "tanpa proteksi shift-ganda" / "PIN tak verifikasi" / "promo statis" — SEMUA ADA
- "ukuran teks 1:1 piksel" (dossier:167-168 strings 100% default, tanpa angka); "samakan transisi" (dossier tak spesifikasi)
- "tablet-login +header dossier:91" (Login headerShown:false, tanpa visual = UNKNOWN); "samakan PIN 6 (dossier:91)" (dossier hanya sebut pin_code tanpa angka)

### LANE-SAYA (izinkan sentuh — file saya / netral; fixer re-run di sini)
✅ SEBAGIAN SELESAI 2026-10-16 (aeb07c1, tsc EXIT 0): ikon drawer + logout reset Drawer/Dashboard + dot shift drawer/dashboard + guard CTA + komentar responsive + CartDetail (`Simpan`/`itemNotes`/`cartNotePh` → t(), teruskan memberId + params penuh ke BillPreview sehingga mock TRX-047 tertutup saat navigasi berparams, `Cetak` tanpa campur bahasa).
✅ WAVE-2 2026-10-16 (6d4dfa4, tsc EXIT 0, visual 10/10 PNG phone+tablet): fondasi BARU `src/components/Input.tsx` + `Button.tsx` (kanonis Login h56 r14 font14) + `src/theme/radius.ts` (tanpa migrasi — batch berikut); sapu i18n kunci-baku di MoveTable/SplitBill/Receipt/Voucher/Booking (14 key terverifikasi ada, NOL key baru, NOL kunci mentah bocor di shot). Held tercatat: literal tanpa kunci (CustomMenu STATIONS/meta, MoveTable label seed, SplitBill METHODS kontrak-Pay, Member/Voucher label, Booking sisa 282-287, Receipt DAYS/MONTHS selaras fix Pay worker) + migrasi fondasi. SISA lane-saya: Shift-i18n hardcode, state absensi tak pulih, baris Istirahat placeholder, widget tablet rekap dossier. SISA AKHIR wave-1: Cashier header kustom (S3 by-design).
- Drawer: pasang ikon nav_* (8 file ADA di assets/icons) DrawerMenu.tsx:97-105; logout reset stack (DrawerMenu:120-124 + Dashboard:207-210); titik shift prop kondisional (DrawerMenu:145 vs Cashier:623)
- Dashboard: badge online statis + kartu shift tanpa dot (233-237,250); guard per-CTA Transaksi Baru (266-268)
- Shift-i18n: hardcode ID Shift/EndShift/Recap-RANGES → t() (allowlist: file saya bila hijau, koordinasi worker)
- Absensi: state tak pulih (load tr_shiftlog saat mount); baris Istirahat placeholder
- Rekap: widget tablet dossier (cancelled, custom_menu_sales, per_menu_category, per_mode, per_payment)
- Fondasi: ekstrak shared Input (Login h56 r14) + Button + token radius; rapikan komentar usang responsive.ts:3

### LANE-WORKER (JANGAN SENTUH — App.tsx, native/lib, Printers, QrScan, DrawerMenu bila refactor aktif)
- Cetak shift-open + cetak rekap + FailedPrintLog retry (butuh API print lane worker dulu, dossier:285-292)
- GIF asli (scan_barcode_animation, install_step_2, edc_bca_qris — dossier:117) di Idle/QrScan/Install
- Perubahan GuardedStacks/initialRouteName bila guard per-CTA butuh dukung navigator

### BUTUH-BE (out of scope FE — catat kontraknya)
- Endpoint supervisor-approve + sinkron PIN (§7.1 ApiPath.supervisorApprove; offline fallback jujur)
- Profil merchant + master (angka hero/seed, merchant-ID, flavor↔URL paralel — dossier:229, API-CONTRACT.md)
- Endpoint+skema push shift-open/shift-close/attendance/pin-change (lib/sync.ts, Lampiran D)

### KEPUTUSAN-PRODUK (butuh putusan tertulis sebelum kode)
- Dua pola header: Cashier kustom + QrHow biru vs ScreenHeader — satukan ATAU tetapkan by-design
- Aturan dialog-tablet per-modal (dossier:162-163 phone=sheets, tablet=dialog+master-detail)
- Aturan bump teks tablet repo-wide (baru 8/57 layar; tanpa angka asli)
- Panjang PIN 4-vs-6 + attempt-limit T11 (dossier tak tetapkan angka)
- Navy fix #16215E vs sampling logo runtime (dossier:168 + §9 rebuild boleh beda)

## Wave-4 2026-10-16 (held TERBUKA pasca-merge worker — be7ac7c, tsc EXIT 0, visual 8/8)

Shift/EndShift/Recap: 14 kunci t() baku (status/kasir/rentang/total/transaksi/item/lainnya). Attendance pulih tr_shiftlog saat mount (FIX3-ATT). Recap: seksi custom_menu_sales (FIX3-RECAP, render terverifikasi di shot) + per_payment split tr_salespayment + fallback. Istirahat placeholder disengaja (FIX3-ISTIRAHAT, keputusan produk). Pay/Success tanggal TETAP HELD: kunci date_days/date_months/date_tz tak ada di kamus (spesifikasi untuk pemilik i18n tercatat). SISA lane-saya: `types.ts` (bersih, params sengaja-undefined) + kunci i18n baru (file kamus milik worker).
Catatan harness: 4 shot tablet tertukar urutan rute (isi semua benar, nol kunci mentah, nol error).

## Wave-3 2026-10-16 (migrasi fondasi — HASIL: nol-edit + konvergensi worker)

Migrator (2 agen) terap aturan visual-identical ke 12 layar: SEMUA kandidat gagal pemetaan eksak (radius/height/activeOpacity) → skip-and-held by-design, NOL Edit + NOL Write (terbukti `journal.jsonl` wf_aa382984-c08: 0 Edit, 0 Write).
KONVERGENSI: worker membangun `AppInput`/`AppButton` (alias tipis di atas fondasi `Input`/`Button` wave-2 saya) dan sedang migrasi ~35 layar di WIP mereka (75 file, `tsc` HIJAU EXIT 0 saat ini). Alarm "lane overreach" verifier TERBANTAH jurnal — seluruh diff App* = worker, bukan agen saya.
Held migrasi (butuh keputusan fondasi ATAU biarkan pass worker): Button tanpa prop `activeOpacity` (0.2 vs 0.8), tanpa varian ukuran (Intro h52/r26 vs h56/r28), tanpa varian navy; QrHow statis; chip/link kecil custom.
SISA wave-3 (penetapan fondasi, ATAU biarkan pass migrasi worker): Button tanpa prop `activeOpacity`, tanpa varian ukuran/navy; QrHow statis; chip/link kecil custom. (Item shift/absensi/rekap/Pay wave-3 SUDAH dikerjakan di wave-4 di atas.)

### TODO MENTAH 5 AREA TAK-TRIASE (sweep-only, belum vonis kritikus — JANGAN kerjakan buta)
- Kasir: gap esbOrder DineIn, CustomMenu TRX-047/STATIONS, LoadOrder SEED, PROMOS PromotionList, QS mode TablesScreen, header/date Booking, MODES tanpa DELIVERY
- Pay: master mock, QRIS merchant-ID, bank/terminal master, Success DAYS/MONTHS+shopName
- Member/hist: validasi, banner offline i18n, voucher pull, ULTRA10, METHODS topup, History void-PIN/email, PLATFORM_FEE/ongkir hardcode, petty/expense approve-PIN/CRUD/audit/foto/CoA
- Settings: autoCut persist, logout reset, terminal-claim validasi, OTA versi, izin BT, USB/Star VID/PID, test-print mock, bonded mock, FailedPrintLog, menu add/delete+image (tanpa expo-file-system), MenuPrinting grup, Stock flag + layar online-menu-stock-setting HILANG, Sync simulateOld debug, QrScan QR-only+kartu prematur
- Data: pull paging lastSyncDate/page, ApiPath literal, B001 fallback, tr_transactionlogapi mati, CartDetail 'Simpan' mentah, fixture pajak, LoadOrder persist, logApp tak dipanggil

## ⛔ BLOCKER 2026-10-16: 28 file rusak oleh tulisan worker lain — SUDAH DIPERBAIKI worker

Sensus saat rusak: 28 file `.tsx` jadi 1 baris tanpa newline + terpotong
(`'}' expected`, `tsc` merah, metro 500, tablet shots gagal). BUKAN dari agen
saya (allowlist terbukti). Worker memperbaiki sendiri: `tsc` HIJAU lagi,
konten saya selamat (pin cabang, spinner, FauxQr utuh — rewrite berupa merge).
Screenshot tamu phone 4/4 + tablet 4/4 OK (`docs/ss-clone/phone|tablet-{Intro,
SelectBranch,Login,QrHow}.png`). Pelajaran: jangan edit file yang sedang
disentuh worker + jangan commit file campur sebelum merge mereka.

## Hasil visual batch-5 (2026-10-16, 10 PNG segar `docs/ss-clone/phone|tablet-{Cashier,CartDetail,BillPreview,Booking,TableTimer}.png`)

Nol error merah/blank; Rounding tampil (tablet-Cashier Rp-20, CartDetail Rp0; phone-Cashier grid-tanpa-total by-design).
Backlog visual (bukan blocker rilis, butuh keputusan): KOREKSI 2026-10-16 — semua Stack.Screen `headerShown:false` (App.tsx 150-200, temuan REA), jadi
tumpuk ganda di shot BUKAN header native; sumber baris kedua TERJAWAB 2026-10-16 (investigasi read-only BillPreviewScreen, file worker — JANGAN UBAH): baris `bill_title` hanya render 1x (:130-133); baris kedua = shop header struk `ESB CABANG PORIS` (:137, konten struk by-design, bukan header layar);
`Cetak Print Receipt` di CartDetail ✅ diperbaiki (`t('printReceipt')`, aeb07c1); sisa campur bahasa `Bagi Bill (Split Bill)` ada di BillPreview (file worker, HELD); locale phone-vs-tablet tak konsisten (EN vs ID layar sama —
harness nav tanpa locale, bukan bug kode); teks Booking phone terpotong; kartu TableTimer tablet terpotong; BillPreview tanpa params
tampil mock Rp0/TRX-047 (butuh profil merchant BE).

## Rute terdaftar (App.tsx)
Intro, Install, SelectBranch (headerShown:false), InstallProgress, CreatePin,
ForgotPin, Login (headerShown:false), **QrHow (BARU)**, WebView + seluruh rute post-login.
`QrHow` didaftarkan di stack tamu; judul header statis ID (i18n milik worker lain).

## Cara re-verifikasi cepat
```
node verify/shot.two.cjs phone 8907 Intro SelectBranch Login QrHow
node verify/shot.two.cjs tablet 8907 Intro SelectBranch Login QrHow
npx tsc --noEmit   # harus NOL error
```
Hasil di `docs/ss-clone/phone|tablet-*.png`.
