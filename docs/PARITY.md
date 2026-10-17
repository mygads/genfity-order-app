# PARITY.md - Matriks DONE vs TODO Audit 1:1 Clone RN lawan ESB POSLite

Dokumen ini adalah jawaban final "apa yang sudah 1:1, apa yang belum" agar tidak dicari lagi.
Sumber: `docs/REA-poslite-dossier.md` (fakta APK), `DOKUMENTASI.md` (status + TODO),
`docs/API-CONTRACT.md` (kontrak sisi kita), dan laporan audit REA terbaru
(audit 8 area paralel + fix + verify, sesi af6cd402, output wx1roil3z:
17 agen, 834 tool call, 1.490.090 token) yang dijadikan isi utama peta parity.
Bukti file diverifikasi ulang via Grep 2026-10-16 (eksistensi file + nama simbol).
Revisi §2/§3/§5/§6: sinkron pasca-perbaikan T1-T9, T11, T12 (tiap klaim DONE
dicek simbolnya di kode; langkah ini hanya ubah .md, tanpa ubah src/).

## 1. Header

- APK acuan: ESB POSLite v2.31.13 (`id.co.esb.esb_pos`, vc 761) [DOSSIER],
  Flutter 3.32.5 stable, Dart AOT hash `830f4f59e7969c70b595182826435c19` [DOSSIER],
  package Dart `package:fnb_pos` [DOSSIER], tanpa Firebase [DOSSIER].
- Skala APK: 97 file layar phone + 18 tablet + 2 customer display [DOSSIER],
  37 tabel model database [DOSSIER], 29 plugin definitif [DOSSIER].
- Clone: Expo ~57.0.28, React Native 0.86.3, React Navigation 7
  [TERVERIFIKASI-KODE package.json], 55 entri route di `src/navigation/types.ts`
  [TERVERIFIKASI-KODE] (dokumen lama menyebut 54; selisih 1 entri `QrHow`),
  56 file layar di `src/screens` [TERVERIFIKASI-KODE].
- Tanggal matriks: 2026-10-16.
- Bukti visual: `docs/ss-poslite/` 47 PNG APK asli [TERVERIFIKASI-KODE],
  `docs/ss-clone/` 56 PNG phone clone [TERVERIFIKASI-KODE], `refs/` 9 PNG
  referensi [TERVERIFIKASI-KODE] [SCREENSHOT].
- Fondasi lintas-layar: `rp()` di `src/theme/index.ts:36`
  [TERVERIFIKASI-KODE], `TABLET_BP = 768` di `src/theme/responsive.ts:4`
  [TERVERIFIKASI-KODE], `ScreenHeader` dipakai di 44 file layar
  [TERVERIFIKASI-KODE], `DrawerMenu` meluncur dari kiri
  (`DrawerMenu.tsx`, layout row panel-dulu-lalu-scrim) [TERVERIFIKASI-KODE],
  kamus ID/EN `src/lib/i18n.ts` + hook `useLang()` (`i18n.ts:1009`)
  [TERVERIFIKASI-KODE].

Legenda:

- DONE = parity fungsional 1:1 tercapai di kode (ada sisa minor bila dirujuk T-nomor).
- TODO = sisa kerja konkret, bernomor T1-T13 (daftar di §6), tiap baris modul
  menyebut file yang harus diubah.
- BLOKIR = bernomor B1-B10 (§4), tidak bisa diaudit 1:1 dari artefak statis,
  dicatat agar tidak dicari lagi.

## 2. Tabel parity per modul

| Modul | Status | Bukti (file:baris) | Sisa TODO konkret + file yang harus diubah |
|---|---|---|---|
| M0. Fondasi lintas-modul (header, drawer, i18n, dashboard) | DONE | `ScreenHeader.tsx` + 44 layar pakai; `DrawerMenu.tsx` kiri; `DashboardScreen.tsx` ScreenHeader + data live SQLite (`tr_saleshead`, `ms_table`, `ms_branchmenu`, `tr_shiftlog`) + query H-1 + delta persen (`deltaTxt`, kunci `dash_vs`/`dash_vs_empty`); `i18n.ts` kamus ID/EN | T12 DONE (`DashboardScreen.tsx:75,105,161-167,250`). Sisa minor: style header lama tak terpakai boleh dihapus saat stabil |
| M1. Kasir + ongkir | DONE PENUH | `CashierScreen.tsx` MODES 5 opsi + dialog ongkir fungsional + total `subtotal + service + ongkirNet`; `CartDetailScreen.tsx` + `DineInScreen.tsx` baris Ongkir; `PromotionListScreen.tsx` kind/tag voucher; `LoadOrderScreen.tsx` filter marketplace; ScreenHeader di DineIn/CustomMenu/LoadOrder/CartDetail | T2 DONE (`src/navigation/types.ts:6,13-16,22-23,26,29,34,37,52`: `CreatePin.userId`, `LoadOrder.newOrder`+`kind`, `DineIn` ongkir+customer, `Receipt` table+cashier+items+discount+voidLines+reason, `Success` items+discount, voucher `kind`). Tanpa sisa |
| M2. Pay + struk | DONE | `PayScreen.tsx` 5 tab + split + `payments[]` tier-penuh + teruskan ongkir/mode/table/customer ke Success (`goSuccess`, navigate Success/Qris); `QrisScreen.tsx` poll + expired + persist `recordSale`+`saveSaleSafe` lalu oper paket penuh ke Success, tanpa tombol cetak pra-bayar; `SuccessScreen.tsx` tombol Riwayat (phone) + Cetak ke Receipt (phone+tablet) + baris Ongkir + teruskan items/discount/ongkir ke Receipt; `ReceiptScreen.tsx` subtotal mundur dari items (tanpa hardcode 38900), baris Ongkir di kertas+shareText+tablet, header kasir/meja/pelanggan, seksi void (`rc_void_*`, `voidItem` line-through); `ExtraPaySection.tsx` + `payments.ts` + `supervisor.ts:24` (`authorizeSupervisor`); `EdcScreen.tsx` approval 6 digit + `native/edc.ts:22` (`startEdcPayment`); `BillPreviewScreen.tsx` gate strict `nominalSum === total`; `SplitBillScreen.tsx`; `sales.ts:20` (`saveSale`) + `payments.ts:102` (`buildSalePayload`) | T3 DONE (`PayScreen.tsx:170-201,238-246`, `QrisScreen.tsx:137-139`, `SuccessScreen.tsx:61-67,112-115`, `ReceiptScreen.tsx:34-45,70-75,106-126,209`). T4 DONE (verifikasi, tanpa ubah). T5 DONE (grep `print\|cetak\|share\|unduh` di `QrisScreen.tsx` = nihil). T8 DONE (`HistoryScreen.tsx:162-174` kirim voidLines+reason; cetak ulang kirim items/diskon/mode/table asli). Sisa minor: kunci `qris_print` di kamus tak terpakai (tidak merusak) |
| M3. Shift + rekap + absensi | DONE | `ShiftScreen.tsx` open persist `tr_shiftlog` + outbox; `EndShiftScreen.tsx` ringkasan dari SQLite + close outbox; `AttendanceScreen.tsx` PIN vs `ms_posuser` + antre `clock-in`; `RecapScreen.tsx` seksi BY_USER per kasir + agregasi promo/voucher dari SQLite; ScreenHeader di semua layar shift | T6 DONE (`src/lib/db.ts:91,111-112,179` tabel `tr_salesvoucherusage` + kolom `voucherAmount`; `src/lib/sales.ts:37,87` catat head + usage; `RecapScreen.tsx:171-182,236,346` agregasi SQLite + fallback seed + kunci `rcp_used`). T11 DONE (`supervisor.ts:15-16,26-31` limit 5x/60 detik + `lockRemainingSec`/`isLocked`; pesan lock di CancelScreen + ExtraPaySection, kunci `sup_locked`/`sup_denied`). Tanpa sisa |
| M4. Meja + booking + timer | DONE | `TablesScreen.tsx` pindah/gabung/batalkan + antre outbox; `MoveTableScreen.tsx` + `MoveItemsScreen.tsx` qty parsial + antre outbox + katalog live dari SQLite (bill aktif, item per meja); `BookingScreen.tsx` persist storage + tandai `ms_table` dipesan + antre booking-create; `TableTimerScreen.tsx` config + elapsed persist; ScreenHeader di semua layar | T7 DONE (`MoveTableScreen.tsx:33-44,99` bill aktif + `ms_table`; `MoveItemsScreen.tsx:38-58,109` item per meja; konstanta `OCCUPIED`/`SOURCE` tinggal fallback saat DB kosong). Tanpa sisa |
| M5. History + ESB + kitchen | DONE | `HistoryScreen.tsx` filter + void/ubah-bayar via outbox + Cetak Rincian Void (`doVoidAndPrint` kirim voidLines+reason; cetak ulang kirim items/diskon/mode/table asli); `EsbOrderScreen.tsx` Tolak = status Batal + filter tanggal jalan + total = sub + fee 5% + ongkir + badge live (`realtime.ts` + `push.ts`) + pull `main/get-sales` via `apiFetch` (fallback `esbOrders`); `KitchenScreen.tsx` `stationOf` ikut station + total tiket asli + timer 30 dtk + harga live `ms_menu` + station live `ms_station` (fallback mock offline); `CancelScreen.tsx` PIN supervisor 6 digit + stepper parsial + void via outbox + pesan lock | T8 DONE. T9 DONE (`master.ts:53-57` domain station; `KitchenScreen.tsx:140-212`; `EsbOrderScreen.tsx:140,199`). Tanpa sisa |
| M6. Member + voucher + deposit | DONE | `VoucherScreen.tsx` lock/unlock/validate/burn via `ApiPath` server + outbox (tanpa mock); `MemberScreen.tsx` persist outbox + riwayat `rp()` + Terapkan ke Kasir (`memberId`/`nama`); `TopupDepositScreen.tsx` submit persist + kembalikan `saldoBaru`/`topupNominal` | Tanpa sisa |
| M7. Petty + expense | DONE | `PettyCashScreen.tsx` + `PettyCashFormScreen.tsx` + `PettyCashDetailScreen.tsx`: simpan `tr_branchexpense` + dokumen + outbox, foto Form terus ke Detail, ID unik `PC-{timestamp}`, approve persisten; `ExpenseScreen.tsx`: ID `EX-{timestamp}`, CoA dari pull chart-of-accounts (fallback konstanta) | Tanpa sisa |
| M8. Printer + terminal + server | TODO | `src/native/printer.ts:114` (`openCashDrawer`) LAN TCP murni JS + BT SPP/USB via modul Kotlin `GenfityPrinter`; `lib/escpos.ts:75` (`buildReceiptBytes`) + `:113` (`buildDrawerKickBytes`); `PrintersScreen.tsx` station CRUD + Uji Cetak byte nyata + probe LAN + pairing; `src/config/server.ts:31` (`ApiPath`) env prod/dev/staging/custom; `SettingsScreen.tsx` panel Terminal dan Server + Sinkronkan | T10: `npx expo prebuild` + `eas build --profile development` + uji perangkat fisik (BT SPP/USB/LAN + drawer + intent EDC APOS); di Expo Go/web tetap pratinjau. Ini aksi luar kode |
| M9. Menu + stok + printing | DONE | `MenuManagementScreen.tsx` form Ubah (nama/harga/grup) persist `ms_menu` + `ms_branchmenu` + outbox, unduh gambar nyata (tanpa stub); `StockScreen.tsx` guard NaN + persist; `MenuPrintingScreen.tsx` routing persist (footnote mock dihapus) | Tanpa sisa |
| M10. Display + idle + QR | DONE | `CustomerDisplayScreen.tsx` antrean + promo + `display.ts:18` (`subscribeDisplay`) / `:73` (`publishDisplay`); `IdleScreen.tsx` rotasi promo 5 dtk; `QrScanScreen.tsx` `CameraView` QR + 4 tab + ScreenHeader + toggle ID/EN; teks tablet varian Big; emoji display dihapus | T13 DONE (36 PNG 18 rute phone+tablet 14.44-14.46 + 10 PNG verifikasi Receipt/Success/Recap/Sync/QrScan; header tunggal terkonfirmasi di semua; nol emdash di UI; MoveTable/MoveItems header ganda hilang; Success phone "Lihat Riwayat" penuh grid 2x2). Quirk tersisa: tombol panel kanan tablet-Receipt tergeser/terpotong di web (phone pixel-perfect, style identik HEAD) - cek di device fisik (lihat T10) |
| M11. Sync + log + bantuan + tentang | DONE | `sync.ts:86` (`enqueueSync`) + `:100` (`listOutbox`) + `:125` (`pushAll`) + `:170` (`enqueueOutbox`); `master.ts:99` (`pullMaster`) 6 domain; `SyncScreen.tsx` watermark + blokir E00044 >7 hari; `LogScreen.tsx:42` (`logApp`) persisten + filter tag + ekspor; `HelpScreen.tsx` 8 FAQ i18n; `AboutScreen.tsx` | Tanpa sisa |
| M12. Auth + install | DONE | T1 DONE: `LoginScreen.tsx:15-16,127-141` revalidasi via `validateEmployee` + cocokkan/seed hash `verifyPinHash`/`savePinHash` (`src/lib/pin.ts`) + kunci sesi `loginEmployee`, tautan klaim `login_claim`; `CreatePinScreen.tsx:10,35,40-42` terima `userId` + `createPinOnServer` + `savePinHash`; 6 route tamu (Intro/Install/SelectBranch/InstallProgress/CreatePin/ForgotPin) + Login 2-panel + `WebView` registrasi; `session.ts:67` (`loginDemo`) + `:75` (`logout`); PIN demo lokal hanya demo | Catatan minor: peta eksplisit kode E401 belum ada (gagal server tampilkan `login_fail` generik; tautan klaim selalu tersedia); `CreatePin` fallback `userId='U07'` bila alur login belum dinamis; `pin.ts` fallback web via AsyncStorage (butuh dev-client produksi). Sisa: revalidasi dinamis penuh. UPDATE 2026-10-17 (lajur auth-app, Trek 1): mekanisme login DIGANTI — E01 single-stage + PIN lokal + grant triple + E29; `validateEmployee`/`loginEmployee`/CreatePin-server legacy. Status parity layar tak berubah |

## 3. Rumus-BE kanonik

Pseudocode (integer rupiah, tanpa desimal; PPN 11% default, rounding step
default 100 dari `ms_setting`, format waktu `YYYY-MM-DD HH:mm:ss`,
nomor `TRX-YYYYMMDD-NNN` unik per terminal per hari - lihat API-CONTRACT §9)
[TERVERIFIKASI-KODE docs/API-CONTRACT.md]:

```
untuk tiap item non-void:
  baris = qty * unitPrice + sum(extra.price)
subtotal = sum(baris)
diskonBelanja = sum(item.discount) + voucherBelanja
ongkirNet = max(0, ongkir - min(ongkir, voucherOngkir))
dasar = subtotal - diskonBelanja
service = round(dasar * 5 / 100)
feeESB = round(dasar * 5 / 100)       # hanya order ESB online/agregator (kontrak §5: platformFee)
pajakTampil = round(dasar * 11 / 111) # pajak 11% inclusive, info saja (kontrak §10.3 + fixtures, putusan 11% 2026-10-16)
bruto = dasar + service + ongkirNet + feeESB
grandTotal = bulatkan(bruto, step)      # ke kelipatan step
rounding = grandTotal - bruto
kembali = bayar - grandTotal
payable = grandTotal
paid = sum(split)
remaining = payable - paid
potongDeposit = min(saldo, remaining)
lunas jika remaining == 0
```

5 contoh angka dari laporan REA dan kontrak:

1. `order/finish` kontrak: subtotal 70000, discount 2500, tax 5698,
   serviceCharge 2875, voucherAmount 10000, rounding 25, grandTotal 60400,
   paidAmount 100000, changeAmount 39600 (API-CONTRACT §5.1)
   [TERVERIFIKASI-KODE docs/API-CONTRACT.md].
2. `SALE_OK`: Tunai 66000, 2 item, `payments[]` tier-penuh, tanpa data
   sensitif, via `verify/check.sale.cjs` (DOKUMENTASI §6).
3. Kertas Receipt: subtotal dihitung mundur dari items
   (`ReceiptScreen.tsx:34,43-44`; hardcode 38900/5000 sudah dihapus, lihat T3)
   [TERVERIFIKASI-KODE].
4. Dashboard: total 1284500 / 47 transaksi, rata-rata dihitung live
   `round(total/trx)` = rp(27329) (`DashboardScreen.tsx`)
   [TERVERIFIKASI-KODE].
5. Voucher `GRATISONGKIR`: amount 12000 (`PromotionListScreen.tsx:23`);
   potong = min(ongkir, 12000); bila ongkir 0 maka potong 0
   (tidak memotong belanja) [TERVERIFIKASI-KODE].

## 4. Daftar BLOKIR (tidak bisa diaudit 1:1, agar tidak dicari lagi)

1. B1: Body 200 install asli (`/erp/pos/install`, Basic kasirtest,
   `{"deviceID":"<16-hex>"}` hanya dari capture sintetis) - butuh live capture.
   [DOSSIER Lampiran D].
2. B2: Method HTTP pasti tiap grup pull/push (`v1/pull/*`, `v1/push/*`,
   `esb_api/pull/*`, `esb_apiv9/main/get-*`) - belum tertangkap; kontrak sisi
   kita tetapkan POST JSON (API-CONTRACT §4). [DOSSIER Lampiran D].
3. B3: Nama header auth runtime `eso-api` (Api Key `ms_setting` vs `authKey`
   user) - belum tertangkap; kontrak sisi kita: `X-Terminal-Code` +
   `X-Branch-Id` + `Idempotency-Key` + `Authorization: Bearer` (API-CONTRACT §2;
   nama lama `X-Terminal-Key`/`X-Terminal-Id`/`X-Device-Id` diganti via REAA-3).
   [DOSSIER Lampiran D].
4. B4: Path payment online server-side (OVO/deposit/online gateway) -
   belum tertangkap. [DOSSIER Lampiran D].
5. B5: Host dan skema `/pos/auth/register` - belum tertangkap.
   [DOSSIER Lampiran D].
6. B6: Semantik versi `v1` vs `esb_api` vs `apiv9` vs `v11` - belum diketahui.
   [DOSSIER Lampiran D].
7. B7: Field JSON camelCase (tidak terekstrak dari strings; hanya path dan
   envelope Yii2 `{name,message,code,status,success,data}` yang pasti) -
   kontrak sisi kita definisi sendiri (API-CONTRACT). [DOSSIER §4 DOK].
8. B8: Wire byte ESC/POS printer (tanpa UUID SPP/GATT dan tanpa byte ESC/POS
   di strings; hanya path `bluetooth_connection.dart` + `printImageBytes`) -
   butuh log HCI-snoop saat cetak nyata atau Ghidra atas `.so` printer.
   [DOSSIER §4 DOK].
9. B9: Kredensial merchant + sesi login untuk capture JSON (mitmproxy + CA
   test-device layak jalan karena tanpa pinning di strings; kredensial belum
   ada). [DOSSIER §4 DOK].
10. B10: Seleksi flavor-URL (prod/int/stg/qa/dev/smoke/loop-lite) serta
    auth/sesi PIN + UDID binding + shift claim - masih terbuka; master katalog
    (`ms_menu`, promosi, member, CoA, gofood/grab) selalu kosong di snapshot
    karena endpoint pull belum tertangkap. [DOSSIER Lampiran B + C].

## 5. Keputusan sadar (by-design, bukan gap)

- S1: PIN-lokal-only APK tidak ditiru. APK login = cek PIN di SQLite perangkat
  (`ms_posuser`, PIN hash 32-char, `loginPinOnly`), tanpa bearer/JWT
  [DOSSIER]. Clone: PIN lokal hanya untuk demo (`loginDemo`); login produksi
  revalidasi server via `validateEmployee` + hash lokal via `pin.ts`
  (T1 DONE; catatan minor di baris M12). UPDATE 2026-10-17 (lajur auth-app,
  Trek 1): clone kini E01 `terminal-login` single-stage + PIN staff verifikasi
  lokal + grant triple + E29 `pinVerifyTerminalPin`; `validateEmployee` legacy.
  Status parity layar tak berubah.
- S2: `Idle` + `CustomerDisplay` fullscreen tanpa `ScreenHeader` (display
  pelanggan, bukan layar kasir).
- S3: `Cashier` masih pakai header kustom `renderHeader` (belum migrasi ke
  `ScreenHeader`); dicatat eksplisit agar tidak dianggap lupa.
- S4: USB-serial inert di APK v2.31.13 (kelas `net.posprinter.*` tidak ada di
  dex; jalur hidup = BT SPP + LAN, tanpa plugin thermal-print Dart, struk
  dirakit manual via byte ESC/POS) [DOSSIER Lampiran E]. Clone: USB via
  UsbManager bulk-transfer hanya di dev-client (lihat T10).
- S5: Env bawaan = mode lokal; push/pull/WS hanya ke server env Custom milik
  sendiri agar data tak bocor ke infrastruktur pihak ketiga (API-CONTRACT §5
  dan §7; guard di `display.ts` + `realtime.ts`) [TERVERIFIKASI-KODE].

## 6. Rekap TODO bernomor (file yang harus diubah)

Status pasca-perbaikan: T1-T9, T11, T12 DONE (tiap baris nyebut bukti
file:simbol hasil Grep). Tetap TODO: T10 (aksi luar kode) dan T13 (run visual,
dikerjakan terpisah).

- T1 DONE: Revalidasi PIN ke server (`LoginScreen.tsx:15-16,127-141`,
  `src/lib/pin.ts:153,174,198`, `src/lib/apiSource.ts`; minor: tanpa peta E401
  eksplisit, fallback `U07`, fallback web `pin.ts`). UPDATE 2026-10-17: jalur
  kini E01 + E29 (`pinVerifyTerminalPin`, inti-HTTP tunggal di `terminalApi.ts`);
  401 non-PIN → auto-logout + `setUnauthorizedHandler`.
- T2 DONE: `RootStackParamList` dilebarkan (`src/navigation/types.ts:6,13-16,22-23,26,29,34,37,52`).
- T3 DONE: Ongkir + items asli + nomor asli di Pay/Qris/Success/Receipt
  (`PayScreen.tsx:170-201,238-246`, `QrisScreen.tsx:137-139`,
  `SuccessScreen.tsx:61-67,112-115`, `ReceiptScreen.tsx:34-45,70-75,106-126,209`).
- T4 DONE (verifikasi, tanpa ubah): Riwayat di phone + Cetak ke Receipt di
  phone+tablet (`SuccessScreen.tsx:185,195,224,234`).
- T5 DONE: tanpa tombol cetak pra-bayar di Qris (grep
  `print|cetak|share|unduh` di `QrisScreen.tsx` = nihil); persist + cetak hanya
  pasca-bayar via Success/Receipt.
- T6 DONE: `tr_salesvoucherusage.voucherAmount` (`src/lib/db.ts:91,111-112,179`,
  `src/lib/sales.ts:37,87`, `RecapScreen.tsx:171-182,236,346`, kunci `rcp_used`).
- T7 DONE: katalog move live SQLite + fallback konstanta
  (`MoveTableScreen.tsx:33-44,99`, `MoveItemsScreen.tsx:38-58,109`).
- T8 DONE: seksi void di Receipt (`ReceiptScreen.tsx:46-50,80-91,123-126,252-253`,
  kunci `rc_void_title`/`rc_void_reason`/`rc_void_total`);
  `HistoryScreen.tsx:162-174` kirim voidLines+reason.
- T9 DONE: domain station (`master.ts:53-57`); Kitchen live `ms_menu`/`ms_station`
  (`KitchenScreen.tsx:140-212`); EsbOrder pull via `apiFetch`
  (`EsbOrderScreen.tsx:140,199`, fallback `esbOrders`).
- T10 TODO: Prebuild + dev-client + uji perangkat fisik (luar kode).
- T11 DONE: attempt-limit 5x/60 detik (`supervisor.ts:15-16,26-31`
  `lockRemainingSec`/`isLocked`); pesan lock di `CancelScreen.tsx:112-113` +
  `ExtraPaySection.tsx:38-39` (kunci `sup_locked`/`sup_denied`).
- T12 DONE: query H-1 + delta persen (`DashboardScreen.tsx:75,105,161-167,250`,
  kunci `dash_vs_empty`).
- T13 TODO: Verifikasi visual display/idle/scan di device kecil + tablet
  (butuh run, dikerjakan terpisah).

## 7. Perbaikan sesi 2026-10-16 lanjutan (uncommitted saat ditulis)

- D1 DONE: Drawer satu-clock — `DrawerMenu.tsx` satu nilai `progress` untuk
  panel + scrim, `Modal animationType="none"`, animasi tutup 200ms via state
  `rendered`, easing cubic, stop animasi lama (perbaikan keluhan "animasi ganda").
  Verifikasi: butuh reload bundle (`expo start -c`) / rebuild APK karena fix
  belum masuk build lama.
- D2 DONE: Navbar Meja — `TablesScreen.tsx` header kanan tinggal burger
  (22px, pola `AttendanceScreen`), tombol +QS pindah ke baris legenda
  (`legendRight`); slot 70px `ScreenHeader` tidak lagi overflow.
- D3 DONE: Printer settings — kunci `printers.connect` dipendekkan
  ("Sambungkan"), catatan dev-client jadi hint kondisional
  (`printers.detectedHint`, hilang bila `hasNativePrinter()` true),
  tombol sebaris `minHeight: 42` + center, stray `marginTop: 8` di `btnTest`
  dicabut; `native/printer.ts` ekspor `hasNativePrinter()`.
- D4 DONE: Anti-bocor S5 — 7 titik `apiPost` langsung yang di Dummy Mode
  menembak default prod dialihkan via `apiFetch` (fixture lokal, tanpa data
  keluar perangkat): `supervisor.ts` (PIN; + cek `approved===true` dan
  fail-closed bila real-mode jatuh ke dummy), `history.ts` (void,
  change-payment), `push.ts` (`registerPushToken` skip total bila bukan real),
  `CancelScreen.tsx` (void), `VoucherScreen.tsx`, `TopupDepositScreen.tsx`,
  `MemberScreen.tsx`. `pullMaster`/`pushAll` sudah guard custom-only.
- D5 DONE: Audit 4 batch paralel (read-only, ~70 temuan, laporan di sesi):
  transaksi (36 temuan: rumus §3, param rute, i18n), meja-shift (P1-P3:
  persist move, filter shift, i18n `tbl_/mov_/tmr_/att_/end_/rcp_/shf_`),
  history-member (28 temuan: CancelScreen live-data, ESB outbox, voucher kind),
  settings-sistem (22 temuan: header-dalam-ScrollView 7 layar, input height,
  QrScan default). PERHATIAN: `ss-poslite/` hanya berisi intro/login/install,
  jadi visual 1:1 layar dalam tidak bisa piksel-vs-piksel; acuan = dossier.
- D6a DONE rumus §3 (batch ini): `feeESB` masuk `totals()` (esbOrder → 5% dari
  net, `platformFee` di payload §5) + baris fee di Cashier/CartDetail/SplitBill/
  Success/Receipt/BillPreview; pajak info-only = 11/111 setting-driven
  (`ms_setting` Tax/PPN, fallback 11, putusan 11% 2026-10-16); label `taxIncl`
  generik tanpa angka; Receipt fallback subtotal
  kurangi semua komponen info-only; rantai Pay/Success teruskan
  service/tax/rounding/feeESB; contoh §5.1 + fixtures order-finish/view dibuat
  konsisten (tax 5698/service 2875/rounding +25/grandTotal 60400/change 39600).
  Sisa D6 OPEN: (b) paket order penuh antar-rute (items/diskon/mode/table/voucher);
  (c) 7 layar header keluar ScrollView + pola back-vs-drawer; (d) batch i18n
  hardcode ID; (e) CancelScreen item live dari `tr_salesmenu`; (f) persist
  move/gabung meja lokal + outbox; (g) ESB status-change via outbox.

- D7 DONE Batch 1-4 sesi 2026-10-16 (lanjutan; `tsc` EXIT 0, emdash nol di
  `src/` kecuali peta transliterasi `escpos.ts:36-37` yang disengaja):
  - Batch 1 P1 pay-flow: rantai Pay-Qris/Edc-Success-Receipt tanpa loss
    (total/metode/voucher/mode/meja/ongkir/customer/memberId/items);
    `payable = max(0, total - boxVoucher)` gantikan rumus ganda-hitung;
    widening `types.ts` Pay/Qris/Edc/Success/Receipt.
  - Batch 1 P2 meja: pindah meja persist `tr_saleshead.tableNo` + status
    `ms_table`; pindah item `GROUP BY` per catatan + diskon proporsional +
    blokir tujuan = asal; Booking validasi kapasitas; DineIn/CartDetail paket
    penuh ke Pay/SplitBill/Receipt.
  - Batch 1 P3 display+shell: CustomerDisplay total berjalan + polling 10 dtk;
    Attendance header ganda hilang; Drawer toggle EN+ID; i18n default `en` +
    49 key `att_*/inst_*/sel_*`.
  - Batch 2 B2a shift+member: Shift open outbox + cegah ganda; Member
    `persistMember()` + terapkan `{memberId, nama}`; Voucher teruskan
    `{code, amount, kind}` apa adanya.
  - Batch 2 B2b history/kitchen/petty: EsbOrder/Kitchen status masuk outbox;
    Cancel item live `tr_salesmenu`; Expense/CoA pull
    `main/get-expense-chart-of-accounts` + cache.
  - Batch 2 B2c kasir+pajak: call-site paket penuh (voucher OBJEK +
    service/tax/rounding/feeESB + memberId); voucher PERSEN kanonis di
    `totals.ts` (`round(dasar*pct/100)` sebelum service/pajak); pajak
    setting-driven (`ms_setting` Tax/PPN, fallback 11); sweep emdash lib.
  - Batch 3 B3a M11+i18n: +47 key (`shf_*`, `hist_col_*`, `cx_reason_*`,
    `sync_*`, `help_faq*`, `log_empty_export`); hardcode titipan diganti `t()`;
    Member teruskan konteks order bila ada.
  - Batch 3 B3b printer+shell: 12 rute `headerShown:false` (ScreenHeader
    kustom tunggal; 4 layar tamu native tunggal); notice guard `t()`;
    Settings panel Sinkronkan; MenuPrinting `getBranchId()`; hapus station
    bersihkan DB + outbox.
  - Batch 4 visual: 36 PNG (18 rute x phone/tablet) ulang via
    `EXPO_PUBLIC_NAV_HOOK` + `verify/shot.two.cjs`; semua header TUNGGAL;
    quirk tablet-Receipt hilang di 1024x768; 34/36 PNG berubah vs HEAD.
  - Sisa D6 OPEN b-g DITUTUP: (b) paket penuh antar-rute DONE; (c) header
    tunggal DONE (16 rute diaudit); (d) i18n hardcode DONE (kecuali F3);
    (e) Cancel live DONE; (f) persist move DONE (kecuali split fisik F1);
    (g) ESB status outbox DONE.
- TODO FINAL (jujur, bernomor; tidak dicari lagi selain ini):
  - F1 DONE 2026-10-16: belah fisik `tr_salesmenu` antar `salesNum` ada +
    ter-wire: `sales.ts:moveSaleItems` (baris penuh/sebagian prorata + extras +
    head tujuan baru/gabung + kedua head kotor + outbox + push §5.2) dipanggil
    `MoveItemsScreen:227` (fallback antrean manual bila DB tak cocok).
  - F2 DONE 2026-10-16: dua arah sinkron — init Tables seed dari TIM store
    (`TABLE_TIMER_TIM_KEY`, presisi 10-dtk) via `canonTableNo`, fallback
    `SEATED_KEY`; cermin Tables→TIM monoton-naik dengan toleransi +1 mnt agar
    tick kasar 1-mnt tak membulatkan presisi TableTimer tiap menit (hanya
    perbaiki store basi); pindah meja memindahkan elapsed + nolkan asal.
  - F3 SELESAI 2026-10-16: verifikasi `grep` — `printers.*/mprint.routeTo` tak
    ada lagi di kode (dibereskan agen printer); sisa campur ID/EN minor bersih.
  - F4 DIPUTUSKAN 11% (2026-10-16): kontrak §5.1/§9/§10.3 + fixtures
    order-finish/view + rumus §3 + contoh §3 + label `taxIncl` + komentar
    `totals.ts` seluruhnya selaras 11 setting-driven. TUTUP.
  - F5 DONE 2026-10-16: `PayScreen` → Member membawa konteks order (total/
    items/mode/table/ongkir/customer/voucher(+code)/discount/service/tax/
    rounding/feeESB + memberId); `applyMember` mengembalikannya sehingga
    order tak reset; tipe rute `Member` dilebarkan.
  - F6 DONE 2026-10-16: `syncWarnLevel()` di `lib/sync.ts` ('ok'/'warn3'/
    'block7' dari `getLastSyncMs`); Pay kunci total saat block7 (panel
    `sync.blocked/blockedMsg` + tombol `sync.openSync` → Sync; Qris/Edc
    hanya dari Pay sehingga tertutup); Cashier banner + tombol Bayar mati
    (bangun keranjang tetap boleh).
  - F7 DONE 2026-10-16: `lib/pettyApproval.ts` (satu kunci kanonis + gabung-
    baca lawas + siaran in-memory) dipakai PettyCash/Detail/Expense;
    fokus-listener agen lain dipertahankan (komplementer).
  - F8: T10/T13 luar-kode tetap: prebuild + dev-client + uji fisik
    (BT SPP/USB/LAN + drawer + EDC APOS + Presentation display + keep-awake).
  - F9 DONE 2026-10-16: 3 domain M9 kini punya tabel agregat minimal
    (`ms_promotion`, `ms_coa`, `ms_menuonline`, CREATE TABLE IF NOT EXISTS di
    `db.ts` — aman untuk DB lama) + Domain pull di `master.ts`
    (`promotion`→`main/get-promotion`, `expensecoa`→
    `v1/pull/expense-chart-of-accounts`, `menuonline`→`v1/pull/get-menu-online`).
    Server menang (tak di-push, `tablePushPath` null untuk `ms_*`).
    Layar Expense/PromotionList tetap live-fetch + cache (pola lama, komplementer).
    Normalisasi `order-split-bill.json` bill-level: A 94500/kembali 5500,
    B 59750/lunas; jumlah = parent 154250, tax 14369 dan service 7250 aditif.
  - F10 DONE 2026-10-16: `Rounding/Step` dummy 50 → 100 selaras kontrak §9.
- AUDIT PRINTER/SYNC 2026-10-16 (temuan + perbaikan):
  - P1 DONE: `src/specs/GenfityPrinter.ts` dibuat — selama ini `native/
    printer.ts` me-require file yang tak ada sehingga BT/USB SELALU
    `need-dev-client` bahkan di dev-client. Sekarang bridge classic
    (NativeModules.GenfityPrinter) tersambung; Expo Go/web tetap null aman.
  - P2 DONE: struk thermal kini rincian penuh ala POSLite (`escpos.ts` +
    `ReceiptScreen.doPrint`): service, PPN inkl. info-only, feeESB, voucher,
    ongkir, pembulatan, bayar+nominal, kembali, tanggal, footer cabang
    (sebelumnya hanya subtotal/diskon/total). Tunai sukses → tendang laci
    otomatis (`openDefaultDrawer`, best-effort).
  - P3 DONE: cetak tiket dapur/checker (`buildKitchenTicketBytes` +
    `printKitchenTicket` per station + tombol `kit_print` di KitchenScreen;
    sebelumnya tombol cetak hanya menuju struk kasir).
  - P4 DONE: pull station tak lagi menghapus alamat printer lokal
    (partial upsert di `master.ts` + fallback KitchenScreen; printerPort/
    connection/autocut milik per-terminal dipertahankan).
  - P5 DONE: realtime nyala saat login (`LoginScreen`) + mati saat logout
    (`session.logout` + `setWsForeground`); sebelumnya hanya nyala bila
    membuka 3 layar tertentu.
  - P6 DONE: toggle sync-otomatis kini menjadwalkan push 5-mnt
    (`applyAutoSyncPrefs`; hormati wifiOnly via expo-network; diam-diam).
  - SISA LUAR-KODE (F8): prebuild + `eas.json` + build dev-client/APK;
    izin USB (requestPermission) belum ada di modul Java (butuh dialog
    sistem/intent-filter saat uji fisik); LAN murni-JS sudah jalan di Expo Go.
  - CATATAN: `tsc` masih merah di file lane lain (CancelScreen/InstallScreen/
    style AppButton di ReceiptScreen — refactor design-system agen lain,
    bukan file audit ini).
