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
| Dashboard + Drawer + ScreenHeader + guard | DONE / PARTIAL (navbar 2 pola, guard T1) | T12 H-1; logout tanpa reset stack; titik shift selalu hijau; Cashier header kustom (S3 by-design) |
| Kasir & order | PARTIAL | ✅ Pajak tampil PPN 11/111 + rounding step 100 + baris Rounding di Cashier/CartDetail/DineIn (2026-10-16, tsc hijau); ✅ CustomMenu saveNotes ke item benar + tipe CustomMenu dilebarkan; ✅ SplitBill reaporsi proporsional + oper items/mode/table ke Pay. SISA: katalog/meja seed in-memory (T7); LoadOrder seed; salesNum bukan TRX-YYYYMMDD-NNN; master.ts 6 domain vs kontrak 11+ grup (file milik worker lain — JANGAN SENTUH) |
| Pembayaran (Pay/Qris/Edc/Success/Receipt/BillPreview/Cancel) | PARTIAL (T8 ✅) | ✅ Batch-2 2026-10-16: method mentah per-split (bank tak hilang); transfer wajib referensi; approvalCode EDC → Success/Receipt; Success ringkasan mini + cetak langsung; BillPreview tanpa hardcode + teruskan konteks; Receipt baris voucher/approval/terminal + footer cabang + key kamus `xp_ref_*`/`ok_*`/`rc_voucher|approval|terminal`. SISA: QR dekoratif (butuh merchant ID BE); poll lokal; bank/terminal hardcode; ULTRA10 persen vs Cashier flat |
| Shift/kas (Attendance/Shift/Recap/EndShift) | PARTIAL (milik worker lain - JANGAN SENTUH) | PIN absensi max 4 vs 6; state absensi tak pulih; PIN buka-shift tak verifikasi; tanpa proteksi shift-ganda; promo rekap statis (T6); tanpa cetak shift + FailedPrintLog; fallback kas EndShift cacat saat nol tunai; tr_shiftlogdetail tak terpakai; attempt-limit (T11) |
| Meja & booking | PARTIAL | ✅ Batch-2: format kanonis A1-A4/B1-B3/C1-C2 + section di Move/DineIn/Booking/Timer; Booking edit + hapus + oper konteks ke Cashier; timer tick 10 dtk live + autoExtend nyata. SISA: TablesScreen kanonis milik worker (rujukan read-only); denah live ms_table (butuh pull BE) |
| Member/Voucher/Topup | PARTIAL | ✅ Batch-2: nominal topup benar; guard offline voucher + banner; MIN_TOPUP 10000; prefix Rp via rp(). ✅ Batch-3: tipe Member dilebarkan (`memberId/saldoBaru/topupNominal`, dua-arah terverifikasi). SISA: endpoint voucherBurn/deposit-topup di `server.ts` (milik worker); ULTRA10 persen vs Cashier flat; pesan min_topup pakai ulang key |
| History/EsbOrder/Kitchen | PARTIAL (milik worker lain - JANGAN SENTUH) | Email antre lokal; nav tanpa items → struk dummy; nomor order inkonsisten; action void/change-payment di luar kontrak; void tanpa supervisor; ESB/Kitchen state lokal tanpa outbox; filter tanggal mock; total ESB tanpa rumus kanonik; tolak tanpa alasan; harga/station fallback; tanpa label station/print retry |
| PettyCash/Expense | PARTIAL (milik worker lain - JANGAN SENTUH) | Saldo hanya PC-%; tanpa saldo berjalan; tanpa ubah/hapus; CoA tak tersinkron; push salah rute order/finish; approve tanpa PIN/audit; tanpa layar preview-foto; Expense tanpa filter bulan |
| Settings/Printers/Menu/Stock/Sync/Log/About/Help | PARTIAL+DONE campur | Tanpa timeout 120 dtk + izin BT; tanpa FailedPrintLog; Menu tanpa tambah/hapus; tanpa layar online-menu-stock (GAP); Log di AsyncStorage bukan tr_applog + tanpa tr_transactionlogapi; escpos tanpa QR raster/pajak/voucher/rounding/footer + tanpa Star/label; autoCut tak persist; T10 fisik luar kode |
| Display/Idle/QrScan/Install/CreatePin/ForgotPin | PARTIAL | CustomerDisplay hardcode + tanpa Presentation API; Idle statis; QrScan QR-only + kartu hasil prematur; Install klaim simulasi + tanpa no-terminal-code; InstallProgress timer palsu; CreatePin userId hardcode + pesan hardcode; ForgotPin lokal-only + hardcode |
| Bahasa & konsistensi UI | DONE kamus / PARTIAL cakupan | ✅ Batch-2: 5 layar tamu (Login/QrHow/Intro/ForgotPin/InstallProgress) pakai `useLang()` + 63 key `g_*`; key pay-chain `xp_ref_*`/`ok_*`/`rc_*` ditambah. ✅ Batch-3: Booking form full `t()` + 17 key `bok_*` baru (data tersimpan SENGAJA tetap ID — butuh migrasi data, batch terpisah); NOL literal `768` di 31 file sehat (semua `TABLET_BP`); 9 style input outlier → font 14 kanonis. SISA: TopupDeposit/Voucher/Booking `undefined` di types (sengaja — tak ada pemanggil kirim params); Cashier abaikan `customer`/`tamu` dari Booking (follow-up CashierScreen) |
| Data & API (dummy/server.ts/db.ts/sync/CONTRACT) | PARTIAL | Dummy tax tak cocok rumus; harga menu vs transaksi beda; split-bill tak rekonsiliasi; ApiPath hilang 9 endpoint kontrak; apiPost langsung lewati apiFetch; pushAll kind other→order/finish + tak kuras tr_esoprocessqueue; hardcode ESB-PORIS-01/B001; OTA apkUrl placeholder |

## ⛔ BLOCKER 2026-10-16: 28 file rusak oleh tulisan worker lain — SUDAH DIPERBAIKI worker

Sensus saat rusak: 28 file `.tsx` jadi 1 baris tanpa newline + terpotong
(`'}' expected`, `tsc` merah, metro 500, tablet shots gagal). BUKAN dari agen
saya (allowlist terbukti). Worker memperbaiki sendiri: `tsc` HIJAU lagi,
konten saya selamat (pin cabang, spinner, FauxQr utuh — rewrite berupa merge).
Screenshot tamu phone 4/4 + tablet 4/4 OK (`docs/ss-clone/phone|tablet-{Intro,
SelectBranch,Login,QrHow}.png`). Pelajaran: jangan edit file yang sedang
disentuh worker + jangan commit file campur sebelum merge mereka.

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
