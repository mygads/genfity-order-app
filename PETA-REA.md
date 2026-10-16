# PETA-REA - ESB POSLite v2.31.13 → Clone RN (hasil REA + pemetaan)

> Target: `https://cloud.genfity.my.id/s/BMdT2S2oGHiQfDy` = **ESB POSLite v2.31.13 XAPK**.
> Dokumen pendamping: `ARCH-APK.md` (arsitektur), `REA-DEEP.md` (printer/endpoint/SQLite),
> `GAP-AUDIT.md` (gap ref-vs-RN), `AUDIT-STATIC.md` (audit awal), `DOKUMENTASI.md` (status/skor/TODO).

## 0. Identitas target (terverifikasi)

| Fakta | Nilai |
|---|---|
| Nama / paket | ESB POSLite / `id.co.esb.esb_pos` |
| Versi | 2.31.13, versionCode 761, minSdk 23, targetSdk 35, compileSdk 36 |
| Kemasan | XAPK v2, 57.546.050 bytes, 21 split (base + arm64_v8a + xxxhdpi + 18 locale) |
| SHA256 XAPK | `FB22FCBF…C141076F2` (penuh di §10) |
| SHA256 base APK | `A9B979BB…8821A9F27` |
| Engine | Flutter AOT, **arm64-v8a saja** (`libapp.so` 18.088.864 bytes + `libflutter.so` 10,76 MB) |
| Native bawaan | `libprinter_serial_port.so`, `libusb100.so`, `libbarhopper_v3.so` (MLKit), UVC camera, Sentry |

## 1. Metode REA yang dipakai

REA 6.4.0 = MCP server; di sesi ini MCP-nya tidak teregistrasi, jadi family yang
diminta dijalankan **manual setara**:

| Family REA | Setara manual (sudah jalan) | Hasil |
|---|---|---|
| `identify-flutter-build` | strings `libapp.so` (75.471 baris, min-4 ASCII) + manifest split | §0 + §5 plugin |
| `inspect-dart-aot` | grep pola atas `all.strings.txt` (screen, endpoint, tabel, printer, PIN) | §3, §4, §6 |
| `inspect-android-package` | jadx 1.5.1 → 4146/4160 class (3 error, usable) + baca `MainActivity`, `GeneratedPluginRegistrant` | §5, temuan EDC BCA |
| `decode-android-resources` | apktool 2.12.1 → manifest + `res/values*` | izin §5, warna = default lib (UI digambar Flutter, bukan XML) |

Build REA dari source: butuh Node 22/24/26 - mesin awalnya Node 23 (gagal `notsup`),
sudah OK setelah user upgrade ke **Node 26.11.1** (`npm run build:cached` 3 successful).
Choco tidak bisa dipakai (butuh admin) → apktool/jadx/commandlinetools diunduh
langsung tanpa instalasi. Artefak kerja di `%TEMP%\rea-work\` (di luar repo, sesuai `.gitignore`).

## 2. Flow boot & navigasi APK vs RN

**APK (dari screen.dart + endpoint):**
`intro → install-home (scan-QR/get-QR → select-branch → login install → install-progress/pull master) → login PIN → home (drawer) → shift-in → kasir`
Kasir: `order_screen` (QS) / `order_full_service` + `table_screen` (pax, pindah meja)
→ subscreen (load-order, order-list, split-bill, move-items, select-promotion)
→ `payment_home → payment_screen → payment_confirm → finish` → `sales_history`.

**RN (`App.tsx`, 29 route, `GuardedStacks`):**
`Login → Dashboard → Cashier → CartDetail → Pay → Success → Cashier`,
cabang ke Tables/DineIn/Booking/Member/Voucher/Shift→Recap→EndShift/Attendance,
History/EsbOrder/Kitchen/Settings→Printers/QrScan/Qris/Edc.
Rantai utama nyambung; semua orphan lama sudah ada inbound
(DineIn←Cashier, Voucher←Pay/Member, QrScan←Member, EsbOrder←Settings,
Edc←Pay:480). Peta edge lengkap terverifikasi via grep `navigate(` (Okt 2026).

**Gap flow terbesar:** seluruh alur **install/klaim terminal** belum ada di RN
(intro, install-home, get-QR, select-branch, install-progress, success-create-pin,
forgot-pin) - lihat DOKUMENTASI §3.1.

## 3. Pages: 29 route RN vs ±83 screen.dart

RN mencakup **alur kasir inti** ✅. Yang belum ada (prioritas, dari strings):

1. `install-home/*`, `intro`, `success-create-pin`, `forgot-pin`
2. `order_full_service` + `split-bill` / `move-items` / `move-table` / `select-promotion` / `order-list`
3. `detail-recap/shift-recap` (15 widget: per menu/kategori/mode/payment/user/paket/promo/pending/cancel)
4. `expense` + `petty-cash` (form, CoA `input-finance-pos/*`, foto, approve)
5. `member-deposit` + `top-up-deposit`, payment lanjutan
   (deposit/online/OVO/external, others/compliment/nonsales, pluxee/ultra-voucher,
   payment-auth, receipt-email), `sales-detail/void` + filter history
6. settings lanjutan (menu-printing, printer-connection, stock/online-stock,
   sync-data, application-setting, log), `web-view`, `customer-display` (idle/main/order/payment-success), **38 varian tablet paralel**

## 4. Fitur per domain (APK → status RN)

| Domain | APK (bukti strings/decompile) | RN |
|---|---|---|
| Login | PIN lokal vs `ms_posuser` (`posPassword/posSalt`), `pin_code_fields`, rememberMe/autoLogin, success-create-PIN | Login outlet+PIN pad demo; remember hanya outlet/username (benar, jgn tiru PIN-lokal-only) |
| Shift/attendance | shift-in/out, `shiftlog`, clock-in/out, update-pin, ganti-PIN | Shift/Recap/EndShift/Attendance ada (rekap masih ringkas, tanpa shift-recap detail) |
| Kasir QS | order_screen, tersimpan, order-fee, promo | Cashier 2-panel tablet ✅, count kategori ✅ |
| Full service | order_full_service, move-table/items, split-bill, select-promotion | Booking≈BookTable/MoveTable parsial; split-bill belum |
| Bayar tunai | cash drawer, Uang Pas, nominal cepat, split (+Tambah) | Pay ✅ (grid nominal, Tambah, drawer Cash Authorization/Child) |
| QRIS | polling status, timer 5 mnt | Qris ✅ (timer + polling sim + sideCol tablet) |
| EDC | **app-switch ke aplikasi EDC BCA** - `MainActivity.onResume` → channel `onResumeFromEdcBca`; approval 6 digit dari struk | Edc ✅ (waiting 60 dtk/error/approval + split tablet); integrasi intent asli = gap |
| Voucher | `esb-voucher+external-voucher/{validate,burn,unburn,lock,unlock}`, claim/validate-online-voucher | Voucher list+filter+apply ✅ (tanpa lock/unlock server) |
| Member/deposit | member + `member-deposit/top-up`, `membertransactionlog`, inquiry-deposit | Member ✅ (mask HP, +Baru, Deposit modal); top-up/deposit server = gap |
| Expense | expense + petty-cash + CoA, foto, approve | Recap ada form pengeluaran sederhana (tanpa CoA/foto/approve) |
| ESB order | dashboard GoFood/Grab/online: order-list, pickup/delivery, history, schedule, filter | EsbOrder tab Baru/Diproses/Selesai ✅ (tanpa schedule/filter lanjutan) |
| Kitchen | tiket dapur Baru→Diproses→Selesai | Kitchen ✅ + auto-print setting (mock) |
| Printer | BT klasik SPP (`flutter_blue_classic`, channel `…/bluetooth_printer` + `…/usb_printer`), generator `esc_pos/printer/star_prnt`, station (`characterPerLine`, `flagAutocut`, MAC), drawer = ESC/POS via koneksi printer + otorisasi | Printers list/filter/connect/test (mock); cetak nyata = gap |
| Customer display | second-screen Flutter via WS/event + `presentation_displays` | toggle di Settings (mock) |
| Kamera/scan | UVC (`serenegiant.usb`, onDestroy bersihkan monitor), MLKit (`libbarhopper_v3`, `mobile_scanner`) | QrScan placeholder |

## 5. Arsitektur APK (hasil decompile)

- **29 plugin** (`GeneratedPluginRegistrant`): sqflite, shared_preferences,
  path_provider, flutter_blue_classic + reactive_ble, mobile_scanner, image_picker,
  video_player, webview, local_notifications, foreground_task, audioplayers,
  sentry, share, url_launcher, email_sender, wakelock, connectivity, device_info,
  package_info, app_settings, flutter_udid, fluttertoast, image_compress,
  flutter_archive, presentation_displays, send_to_background, permission_handler,
  lifecycle.
- **Offline-first:** sqflite ±93 tabel (`ms_*` master, `tr_*` transaksi, `lk_*` lookup);
  cart = `tr_salesmenutemp`; antrean sync (`tr_sync`, `tr_esoprocessqueue`);
  sesi/KV di `ms_setting`/`ms_terminalsetting` + SharedPreferences.
- **Izin manifest:** BT scan/connect/advertise, lokasi (BT scan), kamera, flashlight,
  USB accessory/permission, foreground service, notifikasi, boot-completed,
  system-alert-window, battery-optimization-ignore, vibrate, wake-lock.
- **Resource XML** hanya default library - tema/warna 100% di Dart (konsisten dgn
  RN: token `src/theme`, navy `#16215E`, orange `#F5820D`).

## 6. BE & API (base + endpoint terkelompok)

Prod `https://poslite.esb.co.id/api/web` (prefix `esb_apiv9/`); loop
`loop-lite.esb.co.id`; OMS `services.esb.co.id/oms`; ESO `eso-api.esb.co.id`;
WS `wss://ws-poslite.esb.co.id/ws` (+ self-order dev7/qa7/stg-eso).
Env dev/stg/qa/smoke/int via EndpointType (ada UI ganti endpoint di install-screen).

- Install: `pos/install`, `main/validate-terminal`, `terminal/{get-terminal,update,verification-notify}`, `pos/{auth/register,create-pin,install}`, `main/check-branch-status`
- Install/klaim via WEB (terbukti visual 14 Okt 2026): tap "Masuk ke POS"
  membuka browser ke **`esb.id/esbposlite/registration/`** (bukti address-bar
  di `docs/shots/apk-web2.png`). Artinya alur install = intro → web-view
  registrasi (buat akun) → kembali ke app → install-home/scan-QR →
  select-branch → install-progress. Layar `web-view` di strings terkonfirmasi.
- Form registrasi web (bukti `docs/shots/apk-registration.png`):
  "Gabung dengan 20.000+ UMKM lainnya!", field Nama Penanggung Jawab*,
  Email*, Nomor Ponsel* (+62), Kata Sandi* (min. 8, kombinasi kecil/besar/
  angka/simbol), Kode Referal (opsional), persetujuan Syarat & Ketentuan +
  Kebijakan Privasi, tombol Daftar, link "Sudah punya akun? Masuk Sekarang".
- Login web (bukti `docs/shots/apk-weblogin2.png`): **`poslite.esb.co.id/login`**
  - form Email + Kata Sandi, link "Lupa Kata Sandi?", tombol Masuk,
  "Kirim ulang link verifikasi", "Belum punya akun? Daftar Sekarang".
  Rangkaian entry lengkap: intro(4 hal) → browser eksternal
  (`esb.id/…/registration/` daftar | `poslite.esb.co.id/login` masuk) →
  kembali ke app → klaim terminal/scan-QR → PIN kasir lokal.
- Batas uji: registrasi butuh email/HP asli + OTP prod → tidak dilanjut;
  alur pasca-login (install-home/scan-QR) butuh kredensial merchant.
- Uji bypass-PIN-lokal: `run-as` → "package not debuggable",
  `ls /data/data/…` → "Permission denied" (APK release, tanpa root).
  Kesimpulan: hash PIN `ms_posuser` tidak bisa diekstrak dari APK release -
  kabar baik utk keamanan; untuk testing pakai DB demo milik clone RN
  (`loginDemo`) bukan membobol APK.
- Pull master: `main/get-{branch-settings,master-settings,menu,branch-menu,user,table,promotion,member,voucher,sales,shift-log-data,terminal-settings}` + `pull/*`
- Push: `order/{finish,view,view-quick-service,view-by-qr,move-items,move-table,order-list,split-bill,promotion-list,load-order,pos-error-log}`, `sales/receipt-email`
- Voucher: `esb-voucher|external-voucher/{validate,burn,unburn,lock,unlock}`, `voucher/claim-online-voucher-pos-payment`, dsb.
- Attendance: `employee-attendance+attendance/{clock-in,clock-out,validate,update-pin}`
- Finance/delivery: `input-finance-pos/{create-coa,list-coa,list-coa-category}`, `ezo-delivery/*`, `member-deposit-withdrawal/inquiry-deposit`, `poslite/expense-chart-of-accounts`
- **Login kasir = PIN lokal, tanpa bearer/JWT di strings.** ⚠️ Clone: PIN+salt KDF,
  secure storage, revalidasi server saat online (AGENTS.md aturan 7).

## 7. UI / desain / warna / tata letak

- Pola APK: header navy + aksen orange, drawer home (`home_drawer`), bottom-sheet
  (filter, konfirmasi klaim, progress install, payment), PIN pad 4 digit,
  grid kategori + list menu + badge qty, CTA bawah navigasi, struk monospace.
- RN: font HKGrotesk, `rp()` konsisten, Bahasa Indonesia, `width >= 768`,
  `wideCenter*` / 2-panel & split (cashier, pay, history, tables, dashboard grid,
  qris/edc sideCol). Bukti: `docs/shots/` **66 file** (28 phone + 28 tablet RN
  via `verify/shot.win.cjs` + `shot.fix.cjs`, + 10 bukti APK asli `apk-*`
  dari emulator: intro 1-4, chrome-welcome, registrasi, web-login).
- Skor DOKUMENTASI §1 tetap; yang berubah: orphan/Edc di kode sudah terhubung
  (perlu update §6), tablet receipt/success/member/booking masih kolom-tengah (TODO §7.1).

## 8. Uji login + emulator (rencana → hasil)

Rencana: AVD `poslite` (API 34 x86_64) → `install-multiple` base+arm64+en+xxxhdpi →
buka app → screenshot login → `uiautomator dump` → konfirmasi layar PIN vs SQLite
`ms_posuser` (bypass lokal untuk testing: baca DB via `run-as`/`adb backup` -
APK release, jadi ekspektasi: verifikasi visual + skema; isi PIN tidak diutak-atik).

Hasil (14 Okt 2026, AVD `poslite` API 34 x86_64 + `install-multiple` base+arm64+en+xxxhdpi):

- Instal sukses (`Success`), app terbuka ke layar **intro/onboarding**:
  logo "ESB POSLite", ilustrasi (2 HP + globe + avatar), teks Indonesia,
  tombol **"Lanjutkan >"**, indikator 4 titik (aktif = orange).
  Bukti: `docs/shots/apk-login.png` (+ `apk-intro.png` setelah ANR di-dismiss).
- Catatan emulator: muncul dialog "System UI isn't responding" (ANR) karena
  emulasi ARM→x86_64 + swiftshader lambat - di-dismiss via tombol **Wait**,
  app di belakangnya tetap jalan normal. Ada juga dialog izin sistem
  ("Don't allow" terlihat) - izin runtime standar (kamera/BT/lokasi).
- Intro hal.1/4 (bukti `docs/shots/apk-intro2.png`): judul biru
  "Pembayaran modern", body "Ciptakan pengalaman membayar yang cepat, praktis,
  dan aman bagi konsumen. Tinggal scan QRIS Dinamis, transaksi berhasil!",
  CTA orange "Lanjutkan >". Desain: bg putih, heading biru, CTA orange -
  selaras dgn token RN (navy/orange).
- Intro hal.2/4 (bukti `docs/shots/apk-intro-p2b.png`): "Laporan bisnis yang
  akurat" + "Kontrol penuh bisnis Anda dengan laporan lengkap yang mudah
  dipahami dan raih keuntungan semakin besar.
- Intro hal.3/4 (bukti `docs/shots/apk-intro-p3b.png`): "Kelola pembukuan" +
  "Kegiatan melacak pemasukan dan pengeluaran bisnis belum pernah semudah ini!
  Dengan ESB POSLite, pembukuan jadi lebih rapi dan terorganisir.
- Intro hal.4/4 (bukti `docs/shots/apk-intro-p4.png`): "Toko online ESB Order" +
  "Jangkau lebih banyak konsumen, tampilkan produk secara menarik, dan
  tingkatkan efisiensi proses penjualan Anda." + 2 CTA: outline biru
  "Buat Akun POSLite" & solid orange "Masuk ke POS".""
- Login PIN kasir belum tercapai (butuh klaim/install terminal dulu -
  sesuai desain APK: tanpa terminal terdaftar tidak ada `ms_posuser`).
  Rencana bypass-lokal untuk testing: setelah install-screen, baca SQLite
  app (`ms_posuser`: `posPassword`/`posSalt`) via `run-as` (debug) atau
  observasi skema; PIN produksi tetap dilarang lokal-only (AGENTS.md #7).

## 9. Rekomendasi urutan tutup gap (ke DOKUMENTASI §7.1)

1. Tablet 2-panel login/receipt/success/member/booking (§7.1.1)
2. Label Order Fee/Ongkir + sisa Inggris (§7.1.2)
3. Split-bill/move-items/select-promotion (kasir full-service)
4. Shift-recap detail + expense/CoA + deposit/top-up
5. Install/klaim + PIN-server + printer nyata + EDC intent BCA

## 10. Artefak & reproduksi

- Kerja REA: `%TEMP%\rea-work\` (xapk, `all.strings.txt` 75.471, `apkdecode/`, `jadx-out/`, `libapp.so`)
- Tool: `%TEMP%\rea-tool\` (REA 6.4.0 build OK), `%TEMP%\jadx\` (1.5.1), `%TEMP%\apktool\` (2.12.1)
- SDK: `%LOCALAPPDATA%\Android\Sdk` (+ platform-tools 37.0.1, emulator 37.2.12, AVD `poslite`)
- SHA256: XAPK `FB22FCBF5B30CB7B1740E6C8CA11D50C116427FC03DA652B400E48AC141076F2`;
  base `A9B979BB35969971ED099BA6B8A4A14E685EC85DC9A18DE9A4422A8C821A9F27`
