# REA Dossier — ESB POSLite v2.31.13 (id.co.esb.esb_pos, vc 761)

Sumber: share XAPK (split-bundle/, sha base a9b979bb…), REA rea-agents 6.5.0
(`identify-flutter-build`, `inspect-dart-aot`), apktool decode (share-dec/),
inventaris string libapp.so (reap-new-libapp-strings.txt, 42.719 string).

## 1. Identitas & toolchain

- Flutter 3.32.5 stable (fcf2c11572), Dart AOT snapshot hash `830f4f59e7969c70b595182826435c19`
- Engine libflutter.so build-id `fb5eaead…`, clang 17.0.2 (+pgo +bolt +lto)
- App package Dart: `package:fnb_pos` (250 file sumber, ≥1000 package URI total)
- Target SDK 35, min SDK 23. Tanpa Firebase (tidak ada google-services, tidak ada
  `package:firebase_*`, tidak ada FirebaseOptions di string pool).
- Crash reporting: Sentry self-hosted `https://sentry.esb.co.id/27` (+ sentry_flutter replay).
- State: `provider` + ChangeNotifier/ValueNotifier + rxdart. BUKAN getx/bloc/riverpod/mobx.
- HTTP: `dio` + `http`. Lokal: `sqflite` (+android) + `shared_preferences` + `path_provider`.
  BUKAN hive/drift/isar/objectbox.
- Background: `flutter_foreground_task` (service + Reboot/RestartReceiver),
  `flutter_local_notifications`, `send_to_background`, `wakelock_plus`.
- Lain: audioplayers, video_player, mobile_scanner (MLKit barcode), image_picker,
  image_compress, flutter_archive, share_plus, url_launcher, webview_flutter,
  flutter_email_sender, app_settings, fluttertoast, pin_code_fields,
  modal_bottom_sheet, presentation_displays (customer display!), country_code_picker,
  carousel_slider, flutter_svg, qr/barcode, encrypt/crypto/pointycastle.

## 2. Host & environment (dari string pool)

- Prod: `https://erp.esb.co.id`, `https://poslite.esb.co.id/api/web`,
  `https://eso-api.esb.co.id`, `https://services.esb.co.id/oms`
- Env lain (subdomain): dev7, dev5, stg-erp, stg-core-lite, stg7, stg-eso,
  int-erp, int-core-lite, qa7, smoke-poslite/erp, loop-lite, `poslite…/plan/form-v2`,
  OSS bucket `esb-bucket.oss-ap-southeast-5.aliyuncs.com/pos-lite/get-qr`
- OTA/min-version: `poslite.esb.co.id/api/web/esb/update/pos-lite-minimum-version-v2P`
- WebSocket: `wss://ws-poslite.esb.co.id/ws`, `wss://…/wss-self-order`,
  kode Dart `package:fnb_pos/src/utils/esb_websocket/` + `models/ws_data_models.dart`
- Registrasi publik: `https://www.esb.id/esbposlite/registration/`
- Network security: cleartext hanya untuk `*.esb.co.id`; trust system CAs saja.
- Play update: link `play.google.com/store/apps/details?id=` (self-update check).

## 3. Struktur sumber `package:fnb_pos` (peta rebuild 1:1)

- `src/blocs/` (18): order, payment, esb_order, printer_list, bluetooth_printer_list,
  test_print_station, customer_display, shift_in, split_bill_list, move_items,
  cancel_order, void_order, void_menu, custom_menu, custom_station,
  quick_service_list, expense, helper
- `src/repositories/` (11): install, menu, sales, esb_order, esb_order_dashboard,
  esb_order_voucher, print, petty_cash, attendance, attendance_recovery, brand_setting
- `src/models/database/` (37 tabel): branch, branch_menu, table, table_section,
  table_type, terminal_setting, printer_connection, printer_type, payment_method(+type),
  pos_external_payment, map_self_order_payment_method, member, gender,
  promotion_head/detail/type/category/reward, special_price_head/menu,
  voucher_template(+detail), platform_fee, sales_head, cancel_menu, cancel_reason,
  coa, external_stock_deduction, go_food_menu_group, grab_menu_detail,
  menu_image, menu_template_category_detail, menu_template_detail,
  product_detail_menu, pos_customer_display_detail
- `src/models/response/` (10): terminal_status, esb_order_dashboard,
  validate_online_payment, validate_voucher, easy_point_voucher_validation,
  generate_voucher_cashback, deposit_data, loop_lite_member,
  online_menu_package(+detail)
- `src/models/view/` (39): sales_recap_* (menu, kategori, payment, per-menu-category),
  shift_dashboard, shift_log_detail, table(+section), printing_setting,
  kitchen/checker_printing_settings, print_label_setting, payment_method_type,
  sales_payment_per_bill, bluetooth_printer_list, branch_event, sync_option,
  edc_bca_transaction, esb_order_transaction(+sales_menu, platform_fee),
  customer_display_image(+download), member_form_settings, dsb.
- `src/enums/` (12): app_mode, endpoint_type, esb_order_sync_status, table_status,
  menu_type/level, pos_filter_access_type, reprint_shift_type, app_log, event_subject,
  list_row_type, menu_group_description_color
- `src/migrations/`: `m_20250724_fix_salesnum_refnum_20_digits`
- Routes: `main_tablet_routes.dart`, `main_customer_display_routes.dart`
  (phone routes via Navigator di dalam phone screens).

## 4. Layar phone (97 file) — alur utama

Intro → install_home (install_screen + login_form, get_qr) → login (+success_create_pin)
→ order_full_service / order (menu_selection, order_list, load_order, move_items,
split_bill, select_promotion, scan_esb_order, cancel_order) → payment_home
(payment: cash, non_cash, online, ovo, member_deposit, vouchers, pluxee, ultra,
others; confirm + bill_preview + send_email) → table (hold, split_bill_list,
create_qs_transaction) → shift (shift_in/out, end_shift_confirm) →
sales_history + sales_detail (void_menu) → detail_recap + shift_recap
(sales_menu, promotion, per-menu/payment/mode/category, cancelled, filter) →
member_deposit (top_up) → petty_cash (form, coa, foto, preview) →
settings (printer_connection + custom_station, menu_printing_setting,
stock_setting, online_menu_stock_setting, other_setting + table_timer,
log_screen + log_detail, about, help, menu_management) → attendance (change_pin) →
esb_order_dashboard (order_card, schedule, pickup_delivery, tx_detail, history_filter).

## 5. Layar tablet (18) + customer display (2)

Tablet: login (+header), install_progress_dialog, attendance (main + pin_code),
detail_recap (+shift widgets: cancelled, custom_menu_sales, per_menu_category,
per_mode, per_payment), esb_order_dashboard (tablet_order_list, delivery_list,
customer_info_row), member_deposit (+form_bottom_sheet).
Customer display: 2 file (routes + display; sekunder via presentation_displays).

## 6. Printer & USB (dari smali + native + res/xml)

- Plugin BT: `flutter_blue_classic` (SPP klasik) + `reactive_ble_mobile` (BLE).
  TIDAK ada plugin thermal-print Dart — struk dirakit manual via byte ESC/POS
  (cari pola byte di string pool: init/align/bold/cut/feed/QR).
- USB: `libusb100.so` + `libprinter_serial_port.so` + `device_filter.xml`
  12 VID/PID (XPrinter 7358/7344, STMicro 1155, Seiko/Innovative 1046,
  Star Micronics 0533/1022/1317, dsb).
- Kamera/scan: mobile_scanner + MLKit (libbarhopper_v3, model tflite di assets),
  UVC camera (libUVCCamera) untuk perangkat USB camera.
- Konfigurasi printer: printer_connection (MAC tersimpan), custom_station,
  menu_printing_setting, kitchen vs checker printing settings, test_print_station,
  print_label_setting, EDC BCA transaction view.

## 7. Aset UI (flutter_assets, 712 file)

- Font: HKGrotesk (Regular/Light/Medium/SemiBold/Bold + italic) + MaterialIcons +
  CupertinoIcons. (Rebuild boleh beda font.)
- Ikon: 211 (payment: dana/gopay/ovo/qris/alipay/wechat, gojek/grab/gofood/grabfood,
  printer_*, nav_*, pos_mode_*, table_info_*, member_*), gambar 154
  (esb_logo, install_step_2.gif, scan_barcode_animation.gif, edc_bca_qris.gif,
  no_terminal_code.png, customer_display_qris_background…), beep.wav.
- i18n country_code_picker (id.json ada). Tema/warna: lihat share-dec/res/values.

## 8. Status rebuild (2026-10-16, sesi Gas-2)

- App Expo: 54 route terdaftar (`src/navigation/types.ts`), tsc EXIT 0.
- Lapisan native JS: `src/native/printer.ts` (LAN TCP murni JS; BT SPP + USB
  via modul Kotlin `GenfityPrinter` + config plugin, aktif setelah prebuild +
  EAS dev-client), `src/native/edc.ts` (intent APOS BCA), kamera QR
  (expo-camera) + foto expense (kamera-dulu).
- Realtime + push: `src/lib/realtime.ts` (WS device + self-order, heartbeat,
  backoff), `src/lib/push.ts` (token Expo + `register-push` + notif lokal).
- Kontrak BE: `docs/API-CONTRACT.md` v2 (host, envelope, install/PIN,
  pull 11 grup, push, voucher, OTA, WS JSON, push-register).
- Bukti visual: `docs/ss-poslite/` (APK asli) + `docs/ss-clone/`
  (`phone|tablet-<Route>.png`, 55 route × 2 + IntroLast); folder lama
  `docs/shots/` dihapus. Pixel-fix 6 layar tamu (Intro cs) oleh agen
  paralel — vonis 1:1 final di `DOKUMENTASI.md` §1.

## 10. Lampiran A — Route map + label ID (dari agen UI)

Route string literal (GetX-style, ~48): `/intro`, `/install-home`,
`/install-home/install`, `/install-home/select-branch`,
`/install-home/no-terminal-code` + root `/no-terminal-code`,
`/install-home/how-to-get-qr`, `/login`, `/success-create-pin`, `/absensi`,
`/webview`, `/home`, `/order-full-service`, `/qr-scan-screen`,
`/order/order-list`, `/order/load-order`, `/order/promotion-list`,
`/order/move-table`, `/order/move-items`, `/order/split-bill`,
`/payment-home`, `/payment-home/payment`, `/payment-home/payment-confirm`,
`/sales-history/sales-detail`, `/detail-recap/shift-recap`,
`/expense/index|/form|/detail`, `/expense-chart-of-accounts`,
`/member/index`, `/top-up-deposit`, `/top-up-deposit-form`,
`/petty-cash-form`, `/petty-cash-detail-transaksi`, `/petty-cash-preview-photo`,
`/settings/printer-connection|/printing-setting|/menu-printing-setting|/stock-setting|/online-menu-stock-setting|/application|/sync-data|/log`,
`/idle-screen`, `/dual-display-order-screen`,
`/dual-display-payment-success-screen`, `/resume-route`.
Tanpa route (drawer/tab/modal host): TableScreen, OrderScreen parent,
ShiftScreen, EsbOrderDashboardScreen.

Alur: splash putih → `/intro` → `/install-home` (install/scan-QR/pilih
terminal/claim → pilih cabang → no-terminal-code) → `/login` (PIN-box,
Lupa PIN, absensi) → `/home` (drawer: order, table, shift, sales-history,
detail-recap, esb-order-dashboard, member, expense, petty-cash, settings).

Responsif di kode (bukan resource qualifier): phone = bottom sheets,
tablet = dialog + master-detail 2 panel; `layout-sw600dp` hanya framework.

Aset: 211 ikon webp (+pasangan state blue/gray/white), 154 gambar,
35 GIF animasi (tanpa Lottie), 1 audio `beep.wav`, font HKGrotesk 10 file.
`strings.xml`/`colors.xml` = 100% default framework — semua copy & brand
di Dart. Brand hex disampling dari `esb_logo*.webp` saat runtime.

Katalog label ID lengkap (aksi Bayar/Simpan/Cetak 40x, 60+ string hak akses
"Anda tidak memiliki akses untuk fitur…", guard promo/member, state
offline/sync, konfirmasi) — lihat laporan agen di transcript.

## 11. Lampiran B — Skema SQLite (97 tabel, dari agen DB)

Aturan offline: kolom `syncDate` NULL = belum ter-push
(`WHERE COALESCE(syncDate,'')=''`), watermark di `tr_sync(syncType,
pushDateTime, pullDateTime)`, outbox `tr_esoprocessqueue(orderID, serverID)`,
audit HTTP `tr_transactionlogapi`, event `tr_branchevent`/`tr_applog`.
Re-print mereset `syncDate=NULL` (paksa push ulang).

Config = KV `ms_setting(key1,key2,value1,value2)`: Api Url/Key, Branch ID,
Terminal ID, Device ID Check, Login Type (`loginPinOnly`), Version,
Enable Customer Display. Claim terminal = baris
`ms_terminalsetting('T001','flagClaimed','1',1)`. Sesi = baris `ms_posuser`
(PIN hash 32-char, dual kolom posPassword/password + authKey).
Printer pairing di `ms_station` (printerName/Port/Connection/Type/Mode/
charPerLine/localIdentifier/flagAutocut) — kosong di semua snapshot.

Inti transaksi: `tr_saleshead` (salesNum TEXT, 60+ kolom: subtotal, diskon,
pajak PPN, voucher, platformFee, rounding, external* member/API) +
`tr_salesmenu/menuextra/payment/voucherusage/info` + `tr_platformfee` +
`tr_cancelmenu` + `tr_shiftlog/shiftlogdetail` + `tr_memberdeposit` +
`tr_branchexpense(+document)` + `tr_sync`.

Master katalog (DDL ada, selalu kosong — endpoint belum tertangkap):
ms_menu/branchmenu/category(+detail)/group/package/extra/image,
menu-template set, 8 tabel promosi, 4 special-price, ms_table(+section),
ms_station, visit-purpose + 4 map, payment-method, member, coa, voucher,
marketplace gofood/grab. 14 tabel `lk_*` lookup (dikirim kosong).
Tanpa views/triggers/FK — port verbatim ke expo-sqlite.

File referensi terkaya: `stub/cur7.db`, `stub/pincheck.db`.
Catatan: seed harness (Cabang Menteng/Kuningan, kasirtest) sintetis —
skema asli, nilai contoh jangan dianggap produksi.

## 12. Lampiran C — Arsitektur + padanan Expo (dari agen arsitektur)

29 plugin definitif (GeneratedPluginRegistrant). Tanpa Firebase/FCM/Workmanager/
kamera-plugin/geolocator. Realtime = WS persisten + foreground service
(`specialUse`, Reboot/RestartReceiver, SYSTEM_ALERT_WINDOW overlay saat locked).
Update = minimum-version endpoint + download-unzip side-load (flutter_archive,
tanpa play-core). Struk = generator ESC/POS Dart sendiri
(`utils/printer/esc_pos_generator.dart`).

Padanan Expo: expo-av, expo-network, expo-device/application, expo-file-system,
expo-mail-composer, expo-notifications (lokal), expo-image-picker/manipulator,
expo-camera/vision-camera, expo-linking/web-browser, expo-sharing,
expo-secure-store + async-storage, expo-sqlite, expo-keep-awake,
@sentry/react-native, react-native-webview, in-JS toast.
WAJIB dev-client (EAS, tanpa Expo Go): printer USB/BT-classic/BLE
(react-native-bluetooth-classic/ble-plx + modul USB serial), foreground WS
service, Presentation-API customer display, intent EDC BCA APOS
(Castles/Ingenico/PAX/Verifone), MLKit/UVC scan.

State: bloc custom tanpa framework → port ke Zustand/TanStack Query
(jangan tiru bloc 1:1). Env = URL paralel per subdomain
(prod poslite/erp/eso-api/services, int/stg/qa/dev/smoke/loop-lite);
seleksi flavor↔URL belum diketahui. Auth/sesi PIN + UDID binding + shift claim
(masih terbuka). Notifikasi lokal saja; push harus dibangun baru
(FCM via expo-notifications atau WS+foreground-service).

## 13. Lampiran D — Kontrak API (dari agen API)

Host: `erp.esb.co.id` (install Yii2, `/erp/pos/install` Basic kasirtest,
body `{"deviceID":"<16-hex>"}`), `eso-api.esb.co.id` (runtime utama, default
ms_setting Api Url), `poslite.esb.co.id/api/web` (OTA `esb/update/*`),
`loop-lite…/api/web` (loyalti/voucher), OSS get-qr, WS ganda (ESB device
channel + ESO self-order channel, header `x-esb-ws-secret-token`).

Pull (`eso-api`): `v1/pull/{menu,promotion,master-settings,branch-settings,
get-menu-online,sales,user,voucher,table,expense-chart-of-accounts}` +
`esb_api/pull/{member,shift,pos-version,terminal-settings,station,
branch-menu,voucher,branch-event,sales,cancel-menu,…}` +
`esb_apiv9/main/get-{branch-settings,branch-menu,voucher,member,promotion,
table,master-settings,user,menu,sales}`.
Push: `v1/push/{sales,pos-version,sold-out-menu-*,branch-expenses,
branch-menu,cancel-menu-data,shift,branch-event,station,
branch-menu-transaction,voucher}` + `posv1/order/{finish,view,…}` +
`erp/ezo-delivery/{push-data,create-booking,…}`.
Voucher: `posv1/esb-voucher/{validate,lock,unlock,burn}` + external-voucher.
PIN: `esb/pos/{create-pin,validate-create-pin}`, `esb/employee/{validate,
update-pin}`, attendance clock-in/out. Email struk: `esb/sales/
send-receipt-email`. OTA: `POST /api/web/esb/update/
pos-lite-minimum-version-v2 {"platform":"android"}` → array `[{key1:POS,
key2:Version,value1:591,value2:655}]` (tanpa envelope!).

Auth runtime: Api Key ms_setting + authKey user; tanpa Bearer/OAuth/FCM.
Envelop Yii2 `{name,message,code,status,success,data}` + list
`{totalRecords,pageCount}`. Sync: Timer.periodic (tanpa Workmanager),
dirty = syncDate NULL, watermark tr_sync + per-domain lastSyncDate,
peringatan >3/7 hari. Urutan pull: install→branch→menu→user/terminal→
promo/voucher/member/settings; push: shift→sales→event/expense→deposit→ESO.

Belum tertangkap (butuh live capture/Frida): body 200 install asli, method
pasti grup pull/push, nama header auth eso-api, path payment online,
host `/pos/auth/register`, semantik versi v1/esb_api/apiv9/v11.

## 14. Lampiran E — Printer & offline (dari agen printer)

Satu-satunya transport printer plugin = `flutter_blue_classic` (SPP) +
discovery `getBondedBluetoothPrinterList`; BLE (`reactive_ble`) bukan printer.
TIDAK ada plugin thermal/sunmi/usb-serial Dart — generator ESC/POS + Star
line-mode hand-made (`utils/printer/esc_pos_generator.dart`,
`star_prnt_generator.dart`, QR raster di-Dart). Repo: print, print_checker,
print_bill, print_setting, print_shift. Metode: _printBluetooth/_printNetwork/
_printUsb/_printXprinterBluetooth/_printDataOnce.

Konfig per station (`ms_station` + lk_*): connection/type/mode, printerName/
Port (IP+port untuk LAN), characterPerLine (32/48, tanpa string mm),
flagDefault/flagActive/flagAutocut, localIdentifier. Pairing BT timeout 120 dtk,
izin BT+lokasi. Persist prefs: `bluetooth_printer`, `star_printer`,
`xPrinter4`. Test print per station. Peran: kasir vs kitchen/checker vs label
(`_printStationSticker/_printStationXprinterSticker`), routing per-menu,
margin atas, toggle info pembayaran/penjualan/waktu. Drawer: flagOpenCashdrawer
+ tombol Buka Drawer per station. Receipt: header cabang, no. transaksi/meja/
kasir, item+catatan/void, subtotal+pajak+diskon+voucher+rounding+grand total,
metode bayar + kembalian, footer custom, kode voucher wajib tercetak.
Shift: cetak shift keluar/ringkasan/per-kasir + FailedPrintLog retry.

USB: manifest host required + USB_PERMISSION tapi tanpa intent-filter;
device_filter.xml 12 VID/PID (XPrinter receipt 0483:5740/41, XPrinter label
0416:5011/AABB, Sunmi candidate, Netchip bridge). `libprinter_serial_port.so`
hanya shim open/close; kelas `net.posprinter.*` TIDAK ada di dex → USB-serial
inert di v2.31.13. Jalur hidup = BT SPP + LAN (+Star). Expo: USB via UsbManager
bulk-transfer (dev-client), BT SPP modul native, LAN TCP socket.

Offline: sqflite local-first, syncDate NULL, enforcement >7 hari (E00044),
Sync Options screen manual, antrean tr_esoprocessqueue + attendance_recovery,
member butuh online, print 100% lokal (BT/LAN dari SQLite, tanpa internet).

## 9. Rencana rebuild Expo (sasaran 1:1, warna/font boleh beda)

Selesai 2026-10-16: 60 route terdaftar (intro→install→login→kasir→bayar→
shift→rekap→member→kas-kecil→pengaturan→display), fondasi data
(storage AsyncStorage + expo-sqlite 26 tabel + watermark tr_sync + outbox),
cetak stub dev-client, harness screenshot `verify/shot.two.cjs`
(phone 390×844 + tablet 1024×768, `EXPO_PUBLIC_NAV_HOOK=1`).
Sisa: pasang server sendiri (kontrak JSON ikut server Anda), modul native
dev-client (BT SPP/LAN/USB print, foreground WS, Presentation-API,
intent EDC, MLKit/UVC), push notification.

## 15. Lampiran F - verifikasi ulang 2026-10-16 (REA-1, read-only + lampiran)

Metode: tanpa apktool/jadx. Strings ASCII dibaca langsung dari biner
menggunakan PowerShell + System.IO.Compression (buka APK sebagai ZIP,
baca stream entry, ambil run ASCII printable >= 4 karakter, saring pola).
Sumber biner: lib/arm64-v8a/libapp.so (18.088.864 byte, 75.471 string)
dari split config.arm64_v8a.apk + classes.dex (5.995.252 byte) dan
classes2.dex dari base APK. Aturan tulis: hanya lampiran ini yang
ditambah, isi lama tidak diubah.

### F.1 Identitas APK utama

- APK utama (base): split-bundle/id.co.esb.esb_pos.apk, 20.396.209 byte,
  md5 65a515bfab93aa31b719fd978801b4e5, mtime 2026-10-16 11:40 +0700.
- Salinan identik (byte + md5 sama): stub/base.apk (mtime 2026-10-16
  01:25), stub/base-check.apk (mtime 2026-10-16 11:21).
- Manifest (split-bundle/manifest.json): ESB POSLite, package
  id.co.esb.esb_pos, version_name 2.31.13, version_code 761, minSdk 23,
  targetSdk 35. Target v2.31.13 TERKONFIRMASI.
- reap/apk/base.apk (14 Okt, 20.396.209 byte) berukuran sama, kemungkinan
  salinan yang sama (md5 tidak dihitung ulang di sesi ini).
- apktest/work/xapk/ dan reap/rea-apk/ hanya berisi split config
  (config.*.apk), tanpa file base id.co.esb.esb_pos.apk.
- Catatan jujur: header dossier §0 menulis "sha base a9b979bb..." yang
  TIDAK cocok dengan md5 terukur 65a515bf... (mungkin SHA atas file
  lain atau subset). Perlu klarifikasi sumber hash itu.

### F.2 Temuan BARU (belum di dossier, bernomor REA-x)

REA-2 grup erp/ezo-delivery lengkap (7 path, dossier hanya sebut 2):
erp/ezo-delivery/approve, create-booking, finish-by-outlet, push-data,
schedule-order, search-ongoing, search-outstanding.
Baru: approve, finish-by-outlet, schedule-order, search-ongoing,
search-outstanding.

REA-3 grup erp/member (baru seluruhnya): erp/member/,
erp/member/balance-deposit, erp/member/deposit, erp/member/sales.
Dugaan: alur member/deposit juga lewat host erp, bukan hanya eso-api.

REA-4 path tak dikenal: erp/steroid/find. Butuh riset (mungkin search
atau modul internal).

REA-5 esb_api/employee-attendance lengkap: base, clock-in, clock-out,
update-pin, validate. Dossier hanya sebut clock-in/out generik.
Kembaran di grup esb/: esb/employee/update-pin, esb/employee/validate,
esb/attendance/clock-in, esb/attendance/clock-out.

REA-6 esb_api/external-voucher: burn, unburn, validate.
Baru: unburn (dossier sebut external-voucher generik saja).

REA-7 voucher online claim (baru): esb_api/voucher/
claim-online-voucher-pos-payment, validate-online-voucher-pos-payment,
claim-voucher-template.

REA-8 spesimen v11 (baru): esb_apiv11/main/get-terminal-settings.
Satu contoh konkret grup v11 untuk B6.

REA-9 verifikasi terminal (baru): esb_apiv9/terminal/
verification-notify.

REA-10 varian posv1/order (baru): pos-error-log, view-by-qr,
view-quick-service. Dossier hanya finish dan view.

REA-11 pull shift log (baru): esb_api/main/get-shift-log-data.
Peluang clone: tarik log shift dari server.

REA-12 daftar konkret esb_api/pull (dossier hanya ringkasan generik):
pull-branch-event-data, pull-branch-menu-data, branch-menu-transaction,
pull-cancel-menu-data, pull-pos-version, pull-sales-data, pull-shift-data,
pull-station-data, pull-terminal-settings, pull-voucher-data,
pull-member-data, sales-expenseX (nama berekor X, curiga terpotong,
jangan dipakai mentah, lihat REA-19).

REA-13 URL WS konkret per env: prod wss://ws-poslite.esb.co.id/ws,
dev7 wss://dev7.esb.co.id/wss-self-order, qa7
wss://qa7.esb.co.id/wss-self-order (baru), stg-eso
wss://stg-eso.esb.co.id/wss-self-order, wss://esb.co.id/wss-self-order
(baru), emulator ws://10.0.2.2:8082/ws (baru). Artefak gabungan
wss://dev7.esb.co.id/wss-poslite.esb.co.id/ws (lihat REA-19).
Catatan divergensi: clone staging WS memakai /ws di stg-eso, APK memakai
/wss-self-order. Perlu diselaraskan.

REA-14 kunci ms_setting baru (8, dossier hanya sebut Api Url/Key,
Branch ID, Terminal ID, Device ID Check, Login Type, Version, Enable
Customer Display): Customer Display Logo, Enable ESB Order Web Socket,
Enable Queue Prefix, Enable Realtime Stock, Enable Sound ESB Order,
Enable Wakelock, Rounding Mode, Rounding Nearest Value.
Kaitan: kunci Rounding menyentuh isu F10 (step rounding).

REA-15 tabel dan kolom baru di luar daftar dossier:
(a) tabel: ms_brandsetting, ms_cashmethod, ms_gofoodmenudetail,
ms_gofoodmenugroup, ms_gofoodmenupackage, ms_grabmenugroup,
ms_grabmenupackage (dossier hanya go_food_menu_group + grab_menu_detail),
ms_menucategory, ms_menucategorydetail, ms_menuextra, ms_menugroup,
ms_menupackage, ms_menutemplatehead, ms_notes, ms_notescategory,
ms_poscustomerdisplayapplication, ms_poscustomerdisplayhead,
ms_posuseraccess, ms_posuserrole, ms_promotionday,
ms_promotionemployeegroup, ms_promotionheadr (curiga terpotong, lihat
REA-19), ms_promotionrequirement, ms_promotiontime, ms_specialpriceday,
ms_specialpricetime, ms_visitpurpose, tr_branchmenutransaction,
tr_membertransactionlog. Total nama tabel cocok pola ms/tr/lk yang
terekstrak: 88.
(b) SQL migrasi terlihat di pool: ALTER TABLE tr_saleshead ADD
promotionVoucherCode, ALTER TABLE tr_salesmenu ADD
promotionVoucherCode, ALTER TABLE ms_paymentmethod ADD voucherCategoryID
dan voucherSourceID, ALTER TABLE ms_station ADD flagAutocut (+ UPDATE
flagAutocut), CREATE TABLE ms_vouchertemplate(+detail), tr_memberdeposit,
ms_station, ms_voucher, tr_salesvoucherusage.
(c) Model map_ terkonfirmasi: map_self_order_payment_method_model,
map_branchvisitpurpose, map_visitpurposepaymentmethod, dan varian
map_branch_visit_purpose_* (mendukung klaim dossier "visit-purpose + 4
map"). Tidak ditemukan bentuk ms_gender dan ms_tabletype (yang ada
lk_gender dan lk_tabletype); kemungkinan dossier memakai nama file model,
bukan nama tabel. Perlu cek satu baris saat senggang.

REA-16 temuan printer/BT dari classes.dex: UUID SPP penuh
00001101-0000-1000-8000-00805F9B34FB ADA (dari plugin BT), createRfcomm
ADA, prefs id.co.esb.pos_lite/bluetooth_printer ADA, usb_printer ADA,
bca_apos ADA, bca_apos_callback ADA (EDC BCA APOS), camera_check ADA,
check_auto_time_setting ADA, usb_uvc_scanner ADA. net.posprinter.*
TETAP NIHIL di classes.dex dan classes2.dex (S4 bertahan: USB-serial
inert). star_printer nihil di dex (kunci Dart-side sesuai dossier).

REA-17 daftar acquirer QRIS dari string pool (baru): qrisbni, qrisbri,
qriscimb, qrisdki, qrisesb, qrisgpay, qrisnobu, qrisshopee, qrisyukk.
xendit dan midtrans NIHIL di pool. dana, gopay, pluxee, ultra ADA
sebagai nama aset/model.

REA-18 divergensi clone (12 path ApiPath + 2 header TANPA padanan literal
di libapp.so, status tebakan clean-room sampai terbukti):
main/get-menu-online (APK: v1/pull/get-menu-online),
main/get-expense-chart-of-accounts (APK: v1/pull/expense-chart-of-accounts
dan esb_api/poslite/expense-chart-of-accounts),
main/get-payment-method (TIDAK ADA di APK),
main/get-station (APK: esb_api/pull/pull-station-data),
shift/open dan shift/close (APK: v1/push/shift),
branch-expenses/push (APK: v1/push/branch-expenses),
device/register-push (TIDAK ADA di APK; registerPush juga nihil),
auth/supervisor-approve dan auth/cashier-login (TIDAK ADA di APK;
supervisor dan cashier-login nihil),
member-deposit-withdrawal/topup (inquiry-deposit ADA, topup nihil),
member/register (TIDAK ADA; APK memakai grup erp/member/*).
Header: X-Terminal-Code dan X-Branch-Id TANPA padanan (X-Terminal,
X-Branch, X-Device nihil; kandidat yang ADA: authKey, deviceID/DeviceID,
UDID/udid, Authorization/Bearer, ApiKey, x-esb-ws-secret-token).
Yang cocok (28 path, tidak diulang di sini): seluruh grup
esb_apiv9/main/get-*, terminal/*, pos/install, pos/create-pin,
check-branch-status, order/finish, order/view, order/split-bill,
order/move-items, order/move-table, posv1/esb-voucher/*,
employee-attendance/clock-in dan clock-out,
member-deposit-withdrawal/inquiry-deposit, sales/receipt-email.

REA-19 string artefak/terpotong (jangan dipakai mentah, butuh konfirmasi
biner): wss://dev7.esb.co.id/wss-poslite.esb.co.id/ws,
pos-lite-minimum-version-v2P (P gantung),
esb_api/poslite/expense-chart-of-accounts& (& gantung),
esb-order/eso-qs/pos-void& (& gantung), sales-expenseX (X gantung),
ms_promotionheadr (r gantung).

Yang COCOK dengan dossier (verifikasi akurat, tidak diulang rinci):
host prod + dev7/dev5/stg/int/qa/smoke/loop-lite + OSS get-qr + Sentry +
registrasi (§2, 1:1 dengan reap/urls.txt), envelope list totalRecords dan
pageCount, header x-esb-ws-secret-token, rute /pos/auth/register dan
/esb/update/esb-ws-secret ADA di pool, 8 tabel promosi dan 4 tabel
special-price (nama konkret kini diketahui), klaim S4 dan B8-bagian-USB.

### F.3 Status B1-B10 pasca verifikasi murah

- B1 masih valid (tetap tak bisa). Menyempit: dua path install diketahui
  (erp/pos/install, esb_apiv9/pos/install). Butuh live capture body 200.
- B2 masih valid. Method tiap grup pull/push tak terlihat dari string.
  Kontrak POST JSON sisi kita tetap asumsi.
- B3 masih valid. Nama header auth runtime tak tertangkap. Kandidat yang
  ADA: authKey, deviceID/UDID, Authorization/Bearer, ApiKey. Header
  X-Terminal-Code/X-Branch-Id versi clone tanpa padanan APK.
- B4 masih valid untuk charge gateway (OVO/deposit/online). Sebagian
  terbuka: path voucher online (REA-7), eso/gateway/pos-void, dan
  external-voucher burn/unburn/validate (REA-6) kini diketahui.
- B5 menyempit, tetap blokir untuk method/body. Path /pos/auth/register
  TERKONFIRMASI ada di libapp.so.
- B6 masih valid. Satu spesimen v11 konkret baru (REA-8). Semantik versi
  tetap misteri.
- B7 masih valid. Field camelCase tetap tak terekstrak. Envelope
  {totalRecords,pageCount} terkonfirmasi di pool.
- B8 sebagian terbuka. UUID SPP + createRfcomm + prefs printer kini
  diketahui (REA-16). Wire byte ESC/POS tetap gelap. Butuh HCI-snoop
  saat cetak nyata atau Ghidra atas .so printer.
- B9 masih valid. Tanpa pinning/CertificatePinner/sha256 di pool
  (mitmproxy layak jalan), tapi kredensial merchant tetap nihil.
- B10 masih valid sebagai blokir umum. Menyempit banyak: peta WS per env
  (REA-13), 8 kunci setting baru (REA-14), shift-log pull (REA-11), grup
  erp/member (REA-3). Pull payment-method/station/master-settings bentuk
  main/get-* tetap tanpa padanan (lihat REA-18).

### F.4 Antrean untuk agen fix (endpoint/tabel yang perlu dipakai clone)

1. Selaraskan 12 path + 2 header divergen (REA-18) ke path APK, atau
   tandai eksplisit sebagai asumsi di docs/API-CONTRACT.md.
2. Tambah pull: esb_api/main/get-shift-log-data,
   esb_api/pull/pull-station-data, esb_api/pull/pull-terminal-settings,
   v1/pull/get-menu-online, v1/pull/expense-chart-of-accounts,
   esb_api/pull/pull-pos-version, esb_apiv11/main/get-terminal-settings,
   esb_apiv9/terminal/verification-notify.
3. Tambah order: posv1/order/view-by-qr, view-quick-service, pos-error-log.
4. Tambah voucher online: claim/validate-online-voucher-pos-payment,
   claim-voucher-template, esb_api/external-voucher/*.
5. Tambah delivery: erp/ezo-delivery/approve, finish-by-outlet,
   schedule-order, search-ongoing, search-outstanding.
6. Tambah member via erp/member/* (balance-deposit, deposit, sales) dan
   selidiki erp/steroid/find (REA-4).
7. WS: selaraskan path staging ke /wss-self-order, catat URL qa7 dan
   emulator (REA-13).
8. Masukkan 8 kunci setting baru ke kamus sync ms_setting (REA-14).
9. Tambah tabel REA-15 via migrasi aman (prioritas: ms_notes(+category),
   ms_posuseraccess/role, ms_cashmethod, ms_brandsetting,
   tr_membertransactionlog, tr_branchmenutransaction, kolom
   promotionVoucherCode, voucherCategoryID/voucherSourceID, flagAutocut).
10. Pakai prefs native bca_apos*, bluetooth/usb_printer, usb_uvc_scanner
   untuk modul EDC/printer (REA-16) dan daftar acquirer QRIS (REA-17)
   untuk label metode bayar.
