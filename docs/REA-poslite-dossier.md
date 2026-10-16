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

- App Expo: 55 route terdaftar (`src/navigation/types.ts`), tsc EXIT 0.
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
