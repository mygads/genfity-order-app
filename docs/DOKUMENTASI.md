# DOKUMENTASI - posclone-rn (Clone RN ESB POSLite)

> Clone visual + alur kasir **ESB POSLite v2.31.13** (`id.co.esb.esb_pos`, Flutter)
> ke **Expo SDK 57 / React Native 0.86 / React Navigation 7**.
> APK asli: [Play Store - ESB POS / POSLite](https://play.google.com/store/apps/details?id=id.co.esb.esb_pos) (terverifikasi HTTP 200, Okt 2026).
> Dokumen pendukung: `ARCH-APK.md` (arsitektur hasil bedah APK), `REA-DEEP.md`
> (printer/endpoint/SQLite/screen-gap), `GAP-AUDIT.md` (gap ref-vs-RN),
> `AUDIT-STATIC.md` (audit statis awal - sebagian besar sudah diperbaiki, lihat §6).

Sesi demo: `src/session.ts` (`loginDemo()` - user *Gista / ESB Cabang Poris*).
Hook verifikasi: `EXPO_PUBLIC_NAV_HOOK=1` → `__NAV__.go(name)` di `App.tsx`.

---

## 1. Status per layar + skor

Skala 1-10 (visual vs ref APK + kelengkapan interaksi), dinilai dari screenshot
verifikasi Playwright (Expo web, viewport phone ±390px & tablet ±820px).

### 1a. Layar utama (10) - phone 10/10 semua, tablet rata-rata 8,7

| # | Layar (route) | Phone | Tablet | Catatan tablet |
|---|---|---|---|---|
| 1 | Login | 10 | 9 | 2-panel: panel brand navy (outlet/kasir live) + form PIN |
| 2 | Dashboard | 10 | 8 | grid menu adaptif (`menuGridTablet`); KPI/chart ikut melebar |
| 3 | Cashier | 10 | 9 | 2-panel katalog + cart (`bodyRow`/`cartPanel`, `numColumns=2`) |
| 4 | Pay | 10 | 9 | split tunai/non-tunai (`tabletSplit`/`tabletContent`); CTA bawah disembunyikan di tablet |
| 5 | Receipt | 10 | 9 | 2-panel: kertas struk + panel ringkasan/aksi vertikal |
| 6 | Success | 10 | 9 | 2-panel: status + kartu struk; footer 3 tombol full-width |
| 7 | History | 10 | 9 | split list + detail (`split`/`splitList`/`splitDetail`); filter sheet khusus phone |
| 8 | Member | 10 | 9 | 2-panel: daftar + panel detail (saldo/poin, Deposit, Terapkan) |
| 9 | Booking | 10 | 9 | 2-panel: daftar reservasi kiri + form reservasi/pindah meja kanan |
| 10 | Tables | 10 | 8 | grid kartu meja + filter; centered `wideCenterLg` |

10 tablet sudah 2-panel/adaptif (dashboard, cashier, pay, history, tables,
login, receipt, success, member, booking). Pola: konten phone diekstrak ke
fragmen/variabel lalu disusun ulang di cabang `isTablet`, phone tidak berubah.

### 1b. Layar tambahan (15+) - phone ≥9 semua

DineIn, CustomMenu, LoadOrder, Cancel/void, BillPreview, CartDetail, QrScan,
Qris, Edc, Attendance, Shift, Recap, EndShift, EsbOrder, Kitchen, Voucher,
Printers (Okt 2026: +panel Station kasir/dapur), Settings (Okt 2026: +panel Terminal & Server + Sinkronisasi outbox). **Alur install/klaim tamu (6 route baru, Okt 2026)**:
Intro (4 halaman onboarding APK), Install (klaim terminal + simulasi pindai),
SelectBranch (3 cabang + radio), InstallProgress (3 langkah auto + %),
CreatePin (PIN pad 2 fase + mismatch-reset), ForgotPin (reset via supervisor).
Total route terdaftar: **55** (`src/navigation/types.ts` - dokumen lama menyebut 54,
selisih 1 entri `QrHow`) - termasuk WebView + 18 route pekerja paralel (SplitBill, MoveItems, MoveTable, PromotionList, MenuPrinting, Stock, TableTimer, Sync, Log, About, Help, MenuManagement, Idle, TopupDeposit, PettyCash/Form/Detail, Expense).
56 file layar di `src/screens`.

### 1c. Bukti screenshot (konvensi tetap - 2 folder saja)

- `docs/ss-poslite/` - screenshot **APK asli** (referensi, jangan diubah):
  `01-intro-*.png` (onboarding 1-4), `install-*.png`, `01-pilih-cabang.png`,
  `login*.png`, `apk-*.png` (10 bukti emulator: intro, registrasi, web-login).
- `docs/ss-clone/` - screenshot **hasil clone RN** (driver
  `verify/shot.two.cjs`, `EXPO_PUBLIC_NAV_HOOK=1`): `phone-<Route>.png` +
  `tablet-<Route>.png`, 54 route × 2. Tepat 108 file + pasangan
  `phone|tablet-IntroLast.png` (halaman akhir onboarding) - tidak ada nama
  lain; file warisan di luar konvensi (`BillSplit`, `MemberDeposit`,
  `PrintersEsc`, `RecapPhoto`, `TablesMove`) sudah dihapus Okt 2026.
- Folder lama `docs/shots/` (nama `01-34`, `apk-*` campur) sudah dihapus -
  duplikatnya (`09-booking`=`11-booking-fix`, `07-history`=`12-history-fix`)
  juga dibuang. Jangan bikin folder screenshot baru.
- `verify/final/` - 19 screenshot final phone+tablet (cashier, dashboard,
  history, pay-tunai, login, booking, member, receipt, success, tables).

---

## 2. Flow navigator (`App.tsx` + `src/navigation/types.ts`)

Guard: belum login → stack tamu (`Intro` awal; Intro→Install→SelectBranch→
InstallProgress→CreatePin→Login, +ForgotPin dari Login). Sesudah `loginDemo()`
→ 48 route utama (8 route tamu). Hook nav `__NAV__.goGuest` (EXPO_PUBLIC_NAV_HOOK=1) untuk alur tamu.

```
Login → Dashboard → Cashier → CartDetail → Pay → Success → Cashier (Order Baru)
                        ↓                      ├→ Receipt (Cetak Struk)
                        ├→ Tables / DineIn     └→ History (Lihat Riwayat)
                        ├→ Booking / Member / Voucher
                        ├→ Shift → Recap / EndShift / Attendance
                        ├→ History / EsbOrder / Kitchen
                        └→ Settings / Printers / QrScan / Qris / Edc
```

Rantai utama **nyambung penuh**. Tombol Keluar (Dashboard + Settings)
sudah memanggil `logout()` (perbaikan dari AUDIT-STATIC §3).
`Success` sudah punya 3 aksi: Cetak Struk → Receipt, Lihat Riwayat → History,
Order Baru → Cashier (`SuccessScreen.tsx:88,93,98`).
Catatan: `EdcScreen` koeksis dgn form EDC inline Pay (`edcCode`) - Edc←Pay:480,
cerminkan APK (app-switch EDC BCA + approval 6 digit). Putusan Okt 2026, lihat §6.

---

## 3. Fitur APK vs RN - gap 83-vs-29

APK: **83 `*screen.dart`** (4 customer-display + 41 phone + 38 tablet paralel).
RN: **29 route**. Cakupan RN = alur kasir inti ✅ (detail di `REA-DEEP.md` §4).

Yang **belum ada di RN** (prioritas):
1. ~~Install/klaim terminal (`intro`, `install-home`, scan-QR/get-QR,
   `select-branch`, `install-progress`, `success-create-pin`, `forgot-pin`)
   + login PIN-lokal → server~~ ✅ selesai Okt 2026: 6 route tamu
   (Intro/Install/SelectBranch/InstallProgress/CreatePin/ForgotPin),
   Login 2-panel + tautan "Terminal baru? Klaim di sini ›", PIN-lokal hanya
   demo (tetap `loginDemo()`, lihat §4). Sisa: revalidasi PIN ke server.
2. ~~`order_full_service` + `split-bill` / `move-items` / `move-table` /
   `select-promotion` / `order-list`~~ ✅ selesai Okt 2026 kecuali
   full-service/move-items: BillPreview split **fungsional** (rata + per-item
   assign ketuk + nominal dgn sisa + Bayar & Tandai Lunas per split);
   Tables **pindah** (ke kosong), **gabung** (total merge), **batalkan**
   (konfirmasi 2-ketuk); select-promotion = Voucher di Pay (sudah ada);
   order-list = filter status History (sudah ada).
3. ~~`detail-recap/shift-recap` (rekap per menu/kategori/mode/payment/user),
   `expense` + `petty-cash` (form, CoA, foto, approve)~~ ✅ selesai Okt 2026:
   Recap form + CoA chips + badge approve + tombol Setujui + **foto struk**
   (`expo-image-picker`, thumbnail di baris expense).
4. ~~Printer BT (SPP/RFCOMM via `flutter_blue_classic`) / USB / LAN + cash
   drawer (ESC/POS `ESC p m…` via koneksi printer) + flag autocut~~ ✅ sebagian
   Okt 2026: `src/lib/escpos.ts` (generator byte 32-kolom: init, judul 2x,
   total tebal, potong kertas) + Uji Cetak di Printers menghasilkan byte
   **nyata** (371 byte contoh) dengan aksi Salin Hex / Unduh .bin / Kirim
   Bluetooth (Web Bluetooth BLE Nordic UART, Chrome/Edge). Sisa native:
   SPP klasik/USB/LAN + cash drawer (butuh modul native).
5. ~~`member-deposit/top-up`, payment lanjutan (deposit/online/OVO/external,
   others/compliment/nonsales, pluxee/ultra-vouchers, payment-auth,
   send-email), `sales-detail/void` + filter history, settings lanjutan
   (menu-printing, printer-connection, stock, sync-data, app-setting, log),
   `web-view`, `customer-display` (4 screen), seluruh varian tablet (38 file)~~
   ✅ sebagian Okt 2026: deposit fungsional; **CustomerDisplay** (route ke-36,
   papan antrean Disiapkan/Siap + promo + Panggil Berikutnya, dibuka dari
   Pengaturan → Tampilan Pelanggan). Sisa: payment lanjutan, web-view,
   sinkronisasi display via WS/event.

---

## 4. REA ringkas (dari `REA-DEEP.md` + `ARCH-APK.md`)

- **Printer:** BT klasik SPP (`id.co.esb.pos_lite/bluetooth_printer`,
  `.../usb_printer`); tanpa UUID di strings (SPP tak perlu UUID di Dart).
  Generator struk: `esc_pos_generator / printer_generator / star_prnt_generator`.
- **Station (`ms_station`):** printer per station (BT/USB/LAN port 9100),
  `characterPerLine`, `flagAutocut` (ID 3 = tanpa autocut), `localIdentifier` = MAC.
- **Drawer:** kick = ESC/POS standar via koneksi printer; `flagOpenCashdrawer`
  + `flagAuthorization` (buka drawer butuh otorisasi).
- **Customer display:** second-screen Flutter (`idle/main/order/payment-success`),
  update via WS/event - bukan VFD/serial.
- **API:** prod `https://poslite.esb.co.id/api/web` (prefix `esb_apiv9/`),
  loop `loop-lite.esb.co.id`, OMS `services.esb.co.id/oms`,
  ESO `eso-api.esb.co.id`, WS `wss://ws-poslite.esb.co.id/ws`.
  Pull master `main/get-*` + `pull/*`; push `order/finish`, voucher
  `{lock,unlock,validate,burn}`, attendance `{clock-in,clock-out}`.
  Field JSON camelCase tak terekstrak dari strings. Cek Okt 2026: tanpa pinning di strings (tanpa okhttp/CertificatePinner/sha256-pin; hanya callback TLS generik Dart VM) - mitmproxy + CA test-device layak jalan; tanpa UUID SPP/GATT & byte ESC/POS di strings (hanya path `bluetooth_connection.dart` + `printImageBytes`). Blocker konkret: (1) kredensial merchant + sesi login untuk capture JSON; (2) log HCI-snoop saat cetak nyata / Ghidra atas `.so` printer untuk wire byte. Sementara itu kontrak SISI KITA sudah final di `src/lib/sync.ts` + `src/lib/payments.ts` - server Anda ikut itu.
- **SQLite (~93 tabel):** `ms_menu`/`ms_branchmenu`, cart `tr_salesmenutemp`,
  transaksi `tr_saleshead`/`tr_salesmenu`/`tr_salespayment`, shift
  `tr_shiftlog`, expense, deposit, antrean sync, `ms_posuser(username PK,
  posPassword, posSalt)`, KV `ms_setting`/`ms_terminalsetting`.
- **Login = PIN lokal** (cek SQLite di perangkat, `rememberMe/autoLogin`);
  tanpa bearer/JWT di strings. ⚠️ Jangan tiru PIN-lokal-only: pakai KDF,
  secure storage, revalidasi server saat online.
- **APK sumber:** ESB POSLite v2.31.13 - [Play Store](https://play.google.com/store/apps/details?id=id.co.esb.esb_pos).
  Artefak strings `apktest/` **tidak ikut di repo** (ada saat REA, tidak di-commit).

---

## 5. Metode verifikasi

1. `npx expo start` (atau `npm run web`), set `EXPO_PUBLIC_NAV_HOOK=1`.
2. Driver Playwright `verify/shot.two.cjs`
   (`node verify/shot.two.cjs phone|tablet <port> <Route...>` - bisa per layar)
   membuka tiap route via `__NAV__.go(name)` / `goGuest(name)` untuk alur tamu,
   screenshot viewport phone (390×844) & tablet (1024×768).
3. Hasil: langsung ke `docs/ss-clone/phone|tablet-<Route>.png`.
4. Penilaian: bandingkan dengan ref `refs/` (9 PNG) + screenshot APK.

---

## 6. Bug / temuan (audit awal → status)

| Temuan (sumber) | Status |
|---|---|
| Logout mati - hanya `navigate('Login')` (AUDIT §3) | ✅ diperbaiki: `logout()` di Dashboard:67 + Settings:89 |
| Success buntu - tanpa Receipt/History (AUDIT §3) | ✅ diperbaiki: 3 tombol Success:88,93,98 |
| Receipt angka polos tanpa `rp()` (AUDIT §2) | ✅ diperbaiki, pakai `rp()` |
| Hex liar 17 file (AUDIT §2) | ✅ dikonsolidasi ke token `src/theme` |
| Typo header ESS/Apriviinta (GAP D1) | ✅ ESB Cabang Poris / Gista (`session.ts`) |
| Label phone `Order Fee` vs tablet `Ongkir` (Cashier:253) | ✅ disamakan Okt 2026: selalu "Ongkir"; BillPreview "Info pelanggan"→"Pelanggan", Dashboard sub "split"→"bagi bill", "void"→"pembatalan" |
| Tombol cetak no-op (Cashier, BillPreview, DineIn, CartDetail, Qris) | ✅ sebagian Okt 2026: `lib/escpos.ts` + Uji Cetak Printers (byte nyata + Salin/Unduh/BT); Receipt Cetak→`printReceipt()` + Bagikan→`shareReceipt()`; titik kasir lain masih mock |
| Pengeluaran kas tanpa CoA/approve + deposit member mati | ✅ Okt 2026: Recap CoA chips + badge Disetujui/Menunggu + tombol Setujui + foto struk; MemberDeposit menambah saldo + poin, sinkron panel detail |
| Aksi meja mati (Pindah/Gabung/Batalkan hanya tutup modal) | ✅ Okt 2026: pindah ke meja kosong, gabung (merge total), batalkan (konfirmasi 2-ketuk) - state lokal |
| Split-bill hanya rata visual | ✅ Okt 2026: rata + per-item (ketuk assign) + nominal (sisa) + Bayar & Lunas per split |
| Tampilan Pelanggan mati (hanya Switch) | ✅ Okt 2026: route CustomerDisplay (papan antrean + promo + panggil), dibuka dari baris Pengaturan |
| 5 rute orphan dari UI (DineIn, Voucher, QrScan, EsbOrder, Settings) | ✅ terhubung Okt 2026: DineIn←Cashier:527,572; Voucher←Pay:261/Member:98; QrScan←Member:95; EsbOrder←Settings:83 (reroute, bukan orphan) |
| `EdcScreen` vs form EDC inline di Pay | ✅ koeksis by-design Okt 2026: Edc←Pay:480, mirroring APK (BCA EDC-01 app-switch, approval 6 digit) |
| 5 layar tablet masih kolom phone (login, receipt, success, member, booking) | ✅ 2-panel Okt 2026 (skor tablet 9; pola ekstrak-fragmen, phone tak berubah) |
| `tsc --noEmit` gagal karena folder tooling tak-terlacak (`rea-tool/`, `reap/`, `emu/`, `stub/`) ikut dikompilasi | ✅ Okt 2026: `tsconfig.json` exclude 4 folder tsb (file tetap ada, tak dihapus); tsc EXIT 0 |
| Lint (baru dipasang via `npx expo lint`): timer EDC/QRIS set-state sinkron di effect | ✅ Okt 2026: pola timeout-callback di `EdcScreen` + `QrisScreen`; lint 0 error (9 warning unused-var lama) |
| Payment lanjutan + web-view + display sync belum ada | ✅ Okt 2026 (gabungan dua pekerja paralel): `src/lib/payments.ts` (transfer/deposit/kompliment/nonsales + outbox + email-validation), `src/lib/supervisor.ts` (otorisasi server, fail-closed offline, tanpa simpan PIN), `ExtraPaySection` di Pay + tab Pluxee/Ultra, tombol Email di Receipt + History (`sales/receipt-email` via outbox), route `WebView` (registrasi web dari Install), `src/lib/display.ts` (bus lokal + WS best-effort) dipakai CustomerDisplay; bukti `docs/ss-clone/phone|tablet-{Pay,Receipt,CustomerDisplay,Install,WebView}.png` |
| Aplikasi mendial WS prod pihak ketiga saat start (bukti: cek DOM, 403/404 console) | ✅ Okt 2026: `display.ts` + `realtime.ts` hanya connect saat env Custom; bukti ulang `verify/check.sale.cjs` = console 0 error |
| Sync menembak prod pihak ketiga + drawer tanpa byte teruji + penjualan tanpa persist SQLite + Sync mock | ✅ Okt 2026: push/pull/WS Custom-only (bukti `SYNC_OK` + pesan penjaga, `verify/check.sync.cjs`); `openDrawer` BT/USB/LAN di Java + `buildDrawerKickBytes` (bukti `DRAWER_OK` TS==Java); `saveSale` SQLite per kasir + `pullMaster` 6 domain + SyncScreen antrean nyata (bukti `SALE_OK` + `ss-clone/phone|tablet-Sync.png`) |
| Tier-penuh order/finish belum terkirim (hanya ringkasan) | ✅ Okt 2026: `buildSalePayload` + rantai Cashier→CartDetail→Pay bawa item; bukti `SALE_OK` (Tunai 66000, 2 item, payments, tanpa data sensitif) via `verify/check.sale.cjs` |
| Backend milik sendiri belum ada acuannya | ✅ Okt 2026: `docs/API-CONTRACT.md` v1 - konvensi, 11 grup endpoint + WS display + contoh tempel; klien diselaraskan (`apiPost` kirim X-Terminal-Code/X-Branch-Id/Idempotency-Key/Bearer, outbox sertakan `clientId`, supervisor pakai `auth/supervisor-approve`) |
| Tautan Pratinjau Bill di CartDetail belum terbukti piksel (keranjang kosong di driver) | ✅ Okt 2026: driver `PARAMS.CartDetail` kini kirim 2 item; DOM cek `verify/check.cart.cjs` = item tampil + tautan ada + console 0 error + klik sampai BillPreview; bukti `docs/ss-clone/phone|tablet-CartDetail.png` |
| 3 route orphan tanpa inbound (CustomMenu, BillPreview, Booking - aturan AGENTS.md #6) | ✅ Okt 2026: tombol Custom di toolbar Kasir → CustomMenu, tautan Pratinjau Bill di CartDetail → BillPreview, kartu Booking di menu Dashboard → Booking; semua 54 route kini terjangkau (Intro via awal, sisanya via navigate/go terverifikasi grep; duplikat `SavedTransactions` - searti `LoadOrder` - dihapus Okt 2026, tautan `Lupa PIN?` di Login → ForgotPin, burger Kasir → Dashboard); bukti `docs/ss-clone/phone-{Cashier,Dashboard}.png` + `tablet-{Cashier,Dashboard,Booking,CustomMenu,BillPreview}.png` |
| Dialog modal melebar penuh di tablet + modal email History ganda | ✅ Okt 2026: `dialogNarrow` (maxWidth 480, tengah) di dialog Receipt/Settings/ExtraPay; modal email History milik pekerja paralel sudah lengkap - duplikat saya dihapus, tidak ada kode mati; bukti `docs/ss-clone/phone|tablet-History.png` |
| Konfigurasi terminal/server/sync masih mock | ✅ Okt 2026: `src/config/server.ts` (env prod/dev/staging/custom + terminal + ApiPath fakta REA), `src/lib/sync.ts` (outbox antre/kirim/terakhir), `src/config/device.ts` (station kasir/dapur + notif); Settings ada panel Terminal & Server + Sinkronkan, Printers ada panel Station (tambah/hapus/utama) - bukti `docs/ss-clone/phone|tablet-{Settings,Printers}.png` via `verify/shot.two.cjs` |
| Kirim cetak cuma pratinjau (LAN/BT/USB/drawer stub) | ✅ Okt 2026: `src/native/printer.ts` - LAN murni JS (`react-native-tcp-socket`), BT SPP + USB serial via modul native `GenfityPrinter` (Kotlin, `modules/genfity-printer/` + config plugin, aktif setelah prebuild + EAS dev-client); PrintersScreen Uji Cetak/Uji Koneksi (probe ESC @)/Pairing BT/Buka Drawer semuanya memanggil lapisan ini, fallback `need-dev-client` + pratinjau di Expo Go/web |
| EDC cuma timer + approval manual | ✅ Okt 2026: `src/native/edc.ts` - `startEdcPayment()` lempar intent ke APOS BCA saat layar EDC dibuka (Android dev-client); approval 6 digit tetap manual sesuai alur APK; Expo Go/web no-op |
| QR scan cuma gambar + input manual | ✅ Okt 2026: QrScanScreen pakai `CameraView` expo-camera (barcode `qr`) + tombol Aktifkan/Matikan Kamera; hasil scan masuk ke `code` seperti input manual; bukti `docs/ss-clone/phone|tablet-QrScan.png` di-shoot ulang |
| Foto expense cuma galeri | ✅ Okt 2026: `pickPhoto()` kamera dulu (`launchCameraAsync`), galeri sebagai cadangan |
| Push + realtime WS belum ada | ✅ Okt 2026: `src/lib/realtime.ts` (WS device + self-order, heartbeat 30 dtk, backoff), `src/lib/push.ts` (izin + token Expo + `register-push` + notif lokal NEW_SELF_ORDER → badge EsbOrder); dependensi `expo-notifications`, `expo-camera`, `expo-intent-launcher`, `react-native-tcp-socket` terpasang |
| Kontrak backend untuk server sendiri | ✅ Okt 2026: `docs/API-CONTRACT.md` v2 - 3 host + loyalty, header + envelope Yii2 + paging + kode error, endpoint install/PIN/pull/push/voucher/OTA/WS/push-register + contoh JSON tempel + checklist minimal BE |
| Kontrak void/change-payment + supervisor PIN (PAY-03) | ✅ DONE: `history.ts` outbox + `apiFetch` change-payment, dummy `push/auth-supervisor-approve.json`, `supervisor.ts` fail-closed |
| 5 fix member/voucher/deposit (MEM-08) | ✅ DONE: persist outbox + Terapkan `{memberId, nama}` + Topup `saldoBaru` + Voucher lock/unlock/validate/burn via `ApiPath` + Pay→Member konteks order |
| Kanonik totals/split/master/header/tablet/realtime/esb/promo/shift (P1 ×11) | ✅ DONE: `lib/totals.ts` + SplitBill rata/nominal + katalog/meja live + header tunggal + Login 2-panel + WS/push-retry + outbox ESB + `FEE_DEFAULTS` + `pushAll`/drain |
| Komponen/log-tanggal/animasi-dark (P2 ×3) | ✅ DONE: `AppInput`/`AppButton` + `tr_applog`/`fmtDate` + §7.4 |

---

## 7. TODO sisa + delegasi ke Claude Code

### 7.1 Prioritas (sesuai skor & gap)

1. ~~Tablet 2-panel: login, receipt, success, member, booking (target ≥8)~~ ✅ selesai Okt 2026 (tablet 9/9/9/9/9; bukti `verify/tablet-{Login,Receipt,Success,Member,Booking}.png`).
2. ~~Samakan label `Order Fee`/`Ongkir` + sisa bahasa Inggris~~ ✅ selesai Okt 2026 (Cashier selalu "Ongkir", BillPreview/Dashboard labels ID).
3. ~~Putuskan orphan routes + `EdcScreen` vs inline~~ ✅ diputuskan Okt 2026 (semua terhubung; Edc koeksis dgn inline, cerminkan APK).
4. ~~Gap APK (§3): install/klaim → split-bill → recap/expense → printer → deposit~~ ✅ selesai Okt 2026: +split per-item/nominal+lunas, pindah/gabung/batal meja, ESC/POS nyata (Salin/Unduh/BT), foto expense, CustomerDisplay. Sisa butuh backend/native: revalidasi PIN server, SPP klasik/USB/LAN + drawer, payment lanjutan, WS display.
5. ~~Cetak nyata (ganti no-op) + `logout()` di semua titik keluar~~ ✅ selesai Okt 2026: Receipt Cetak→`printReceipt()` (window.print di web) + Bagikan→`shareReceipt()`; PrintersScreen kirim nyata via `src/native/printer.ts` (LAN langsung, BT/USB perlu dev-client); sweep logout bersih (hanya 2 `logout()`, keduanya di Dashboard + Settings).
6. ~~Modul native + push + kontrak BE~~ ✅ selesai sisi JS Okt 2026: printer LAN/BT/USB + drawer, intent EDC APOS, kamera QR, realtime WS + push, `docs/API-CONTRACT.md` v2. Sisa butuh aksi di luar kode: `npx expo prebuild` + `eas build --profile development`, daftar Expo Push, dan bangun BE ikut kontrak.

### 7.2 Cara delegasi (Claude Code)

```bash
cd /opt/data/home/programming/posclone-rn   # atau hasil git clone URL §8
npx expo start        # dev server; verifikasi visual via verify/*.cjs
npx tsc --noEmit      # typecheck wajib lolos sebelum klaim selesai
```

Prompt serah-terima (tempel ke Claude Code):

> Lanjut repo clone RN ESB POSLite (Expo 57, React Navigation 7, route di
> `src/navigation/types.ts`, tema `src/theme`, sesi `src/session.ts`).
> Baca `DOKUMENTASI.md` §7.1, kerjakan item N. Aturan: threshold tablet
> `width >= 768`, warna hanya token `colors.*`, Rupiah via `rp()`, Bahasa
> Indonesia, `tsc --noEmit` lolos, buktikan dengan screenshot Playwright
> (`EXPO_PUBLIC_NAV_HOOK=1` + `__NAV__.go`) phone+tablet di `verify/final/`.
> Jangan tiru PIN-lokal-only APK (lihat §4).

### 7.3 Sisa TODO pasca-audit 1:1 (sinkron dengan `docs/PARITY.md`, 2026-10-16)

Audit 8 area paralel + fix + verify selesai (laporan REA sesi af6cd402).
Perbaikan lanjutan T1-T9, T11, T12 selesai dan tiap klaim DONE dicek simbolnya
via Grep (langkah dokumentasi ini hanya ubah .md, tanpa ubah `src/`).
Hasil per modul: 11 modul DONE (M0-M7, M9-M12), 1 modul TODO (M8
printer+perangkat, T10 aksi luar kode). Tugas visual T13 dikerjakan terpisah.
Sisa konkret:

1. ~~T1: Revalidasi PIN ke server saat login~~ ✅ DONE: `LoginScreen.tsx`
   revalidasi via `validateEmployee` + `verifyPinHash`/`savePinHash` (`pin.ts`)
   + `loginEmployee`; `CreatePin` terima `userId` + `createPinOnServer`.
   Minor: tanpa peta E401 eksplisit (gagal = `login_fail` generik, tautan klaim
   selalu tampil), fallback `userId='U07'`, `pin.ts` fallback web.
2. ~~T2: Lebarkan `RootStackParamList`~~ ✅ DONE (`src/navigation/types.ts`).
3. ~~T3: Baris Ongkir + item cart asli + nomor asli di Pay/Receipt/Success~~
   ✅ DONE (Pay teruskan ongkir/mode/table/customer; Qris persist
   `recordSale`+`saveSaleSafe`; Success teruskan ke Receipt + baris Ongkir;
   Receipt subtotal mundur, tanpa hardcode 38900, header kasir/meja/pelanggan).
4. ~~T4: Lihat Riwayat di phone + samakan Cetak tablet~~ ✅ DONE (verifikasi,
   tanpa ubah: phone ada Riwayat, tablet Cetak ke Receipt).
5. ~~T5: Putuskan cetak-QR-pra-bayar~~ ✅ DONE: tanpa tombol cetak pra-bayar di
   Qris; persist + cetak hanya pasca-bayar via Success/Receipt.
6. ~~T6: Tabel ringkasan promo/voucher-usage~~ ✅ DONE
   (`tr_salesvoucherusage.voucherAmount` + catat `sales.ts` + agregasi SQLite
   Recap + fallback seed + kunci `rcp_used`).
7. ~~T7: Katalog move dari data live~~ ✅ DONE (MoveTable/MoveItems baca bill
   aktif SQLite + fallback konstanta).
8. ~~T8: Render void-lines di Receipt~~ ✅ DONE (seksi void + kunci
   `rc_void_*` + `voidItem` line-through; `doVoidAndPrint` kirim
   voidLines+reason; cetak ulang kirim data asli).
9. ~~T9: Pull menu/station untuk Kitchen/ESB~~ ✅ DONE (domain station di
   `master.ts`; Kitchen harga live `ms_menu` + station live `ms_station`;
   EsbOrder pull `main/get-sales` via `apiFetch` + fallback).
10. T10: Prebuild + EAS dev-client + uji perangkat fisik BT SPP/USB/LAN +
    drawer + EDC (aksi luar kode; Expo Go/web tetap pratinjau). TODO TERBUKA.
11. ~~T11: Kebijakan attempt-limit PIN~~ ✅ DONE (limit 5x/60 detik +
    `lockRemainingSec`/`isLocked`; pesan lock di CancelScreen + ExtraPaySection).
12. ~~T12: Query pembanding H-1 untuk "naik 12%"~~ ✅ DONE (query H-1 + delta
    persen naik/turun + fallback `dash_vs_empty`).
13. T13: Verifikasi visual display/idle/scan di device kecil + tablet (butuh
    run, dikerjakan terpisah). TODO TERBUKA.

Lapisan Dummy DONE: 43 JSON `src/data/dummy/` (8 install + 16 pull + 18 push +
1 ota), `apiSource.ts`, `pin.ts`, `.env.example`, API-CONTRACT §10 Dummy Mode,
SyncScreen E00043/E00044 nyata, install wire ApiPath. i18n: 867 kunci resolve,
0 hilang (laporan pekerja sebelumnya; hitung ulang saat sentuh kamus).
Minor tak-merusak: kunci `qris_print` di kamus tak terpakai.

BLOKIR B1-B10 (tidak bisa diaudit 1:1 dari artefak statis, jangan dicari lagi)
dan rumus-BE kanonik + 5 contoh angka: lihat `docs/PARITY.md` §3-§4.

Workflow 4 (2026-10-16, `tsc` EXIT 0) ✅ DONE semua:
14. PAY-03: kontrak void/change-payment + dummy + supervisor PIN
    (`history.ts:190,195` outbox + `apiFetch`; dummy
    `push/auth-supervisor-approve.json`; `supervisor.ts` fail-closed).
15. MEM-08: 5 fix member/voucher/deposit (persist outbox + Terapkan ke Kasir
    `{memberId, nama}` + Topup kembalikan `saldoBaru` + Voucher
    lock/unlock/validate/burn via `ApiPath` + Pay→Member bawa konteks order).
16. P1-totals: `lib/totals.ts` kanonis (`FEE_DEFAULTS`, voucher PERSEN,
    pajak setting-driven) dipakai Cashier/CartDetail/SplitBill (+ baris fee
    Success/Receipt/BillPreview).
17. P1-split: rata + per-item assign + nominal sisa + Bayar & Lunas per split
    (BillPreview gate `nominalSum === total`).
18. P1-master: katalog/meja live SQLite (bill aktif + item per meja) +
    `salesNum` kanonis `tr_saleshead`.
19. P1-header: `ScreenHeader` 44 layar (12 rute `headerShown:false`, header
    tunggal) + burger Tables + nav-ganda tamu/utama + outlet dinamis sesi.
20. P1-tablet: Login 2-panel (brand navy + form PIN, skor tablet 9, lihat §1a).
21. P1-realtime: Kitchen station live + CustomerDisplay polling 10 dtk +
    `push.ts` `retryPendingPushToken` (WS custom-only).
22. P1-esb: EsbOrder persist outbox + status kanonis + alasan Tolak +
    pull `main/get-sales` fallback.
23. P1-promo-fee: promo live (`PromotionList` kind/tag) + `FEE_DEFAULTS`
    (`platformFee` 5% khusus `esbOrder`).
24. P1-shift-sync: guard custom-only + anti-ganda open-shift + PIN server
    (`validateEmployee`) + `pushAll` + drain + `syncWarnLevel` block7 kunci Pay.
25. P2-components: `AppInput`/`AppButton` + migrasi layar (ganti input/button
    mentah).
26. P2-log-date: `tr_applog` (`db.ts:218`) + `fmtDate` (`lib/datefmt.ts`) +
    LogScreen filter tag + ekspor.
27. P2-anim-dark: lihat §7.4.

### 7.4 Animasi + dark-mode (P2-anim-dark) ✅ DONE

- DrawerMenu: slide dari kiri 260ms buka / 200ms tutup, cubic,
  native-driver, `Modal animationType="none"` (satu-clock, tanpa fade ganda).
- Modal dialog: `animationType` bawaan (`fade`/`slide`); `dialogNarrow`
  maxWidth 480 tengah di tablet.
- Loading: `ActivityIndicator` bawaan; tanpa Reanimated/Lottie (nol
  dependensi animasi di `package.json`).
- Dark-mode: light-only by-design - palet tunggal `src/theme`, abaikan
  `Appearance`/`useColorScheme`.

---

## 8. Repo & push

- Remote: `https://github.com/mygads/genfity-order-app.git` (branch `main`).
- `node_modules/` (385 MB), `.expo/`, PNG nyasar root (`f-cashier.png`,
  `rn-cashier*.png`, `v-*.png`) tidak ikut push; `docs/ss-clone/` (37 bukti)
  + `verify/` + `refs/` ikut. `docs/ss-clone/` kini 88 bukti (lihat §1c).
