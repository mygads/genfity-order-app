# DOKUMENTASI — posclone-rn (Clone RN ESB POSLite)

> Clone visual + alur kasir **ESB POSLite v2.31.13** (`id.co.esb.esb_pos`, Flutter)
> ke **Expo SDK 57 / React Native 0.86 / React Navigation 7**.
> APK asli: [Play Store — ESB POS / POSLite](https://play.google.com/store/apps/details?id=id.co.esb.esb_pos) (terverifikasi HTTP 200, Okt 2026).
> Dokumen pendukung: `ARCH-APK.md` (arsitektur hasil bedah APK), `REA-DEEP.md`
> (printer/endpoint/SQLite/screen-gap), `GAP-AUDIT.md` (gap ref-vs-RN),
> `AUDIT-STATIC.md` (audit statis awal — sebagian besar sudah diperbaiki, lihat §6).

Sesi demo: `src/session.ts` (`loginDemo()` — user *Gista / ESB Cabang Poris*).
Hook verifikasi: `EXPO_PUBLIC_NAV_HOOK=1` → `__NAV__.go(name)` di `App.tsx`.

---

## 1. Status per layar + skor

Skala 1–10 (visual vs ref APK + kelengkapan interaksi), dinilai dari screenshot
verifikasi Playwright (Expo web, viewport phone ±390px & tablet ±820px).

### 1a. Layar utama (10) — phone 10/10 semua, tablet rata-rata 7,7

| # | Layar (route) | Phone | Tablet | Catatan tablet |
|---|---|---|---|---|
| 1 | Login | 10 | 6 | kolom phone di tengah (`wideCenterSm`); belum 2-panel |
| 2 | Dashboard | 10 | 8 | grid menu adaptif (`menuGridTablet`); KPI/chart ikut melebar |
| 3 | Cashier | 10 | 9 | 2-panel katalog + cart (`bodyRow`/`cartPanel`, `numColumns=2`) |
| 4 | Pay | 10 | 9 | split tunai/non-tunai (`tabletSplit`/`tabletContent`); CTA bawah disembunyikan di tablet |
| 5 | Receipt | 10 | 6 | kolom struk di tengah; belum 2-panel |
| 6 | Success | 10 | 6 | kolom di tengah (tunai+kembalian+tanggal OK); belum 2-panel |
| 7 | History | 10 | 9 | split list + detail (`split`/`splitList`/`splitDetail`); filter sheet khusus phone |
| 8 | Member | 10 | 6 | kolom di tengah (`wideCenterLg`); belum 2-panel |
| 9 | Booking | 10 | 6 | kolom di tengah (`wideCenter`); belum 2-panel |
| 10 | Tables | 10 | 8 | grid kartu meja + filter; centered `wideCenterLg` |

5 tablet sudah 2-panel/adaptif (dashboard, cashier, pay, history, tables);
5 masih kolom phone terpusat (login, receipt, success, member, booking).

### 1b. Layar tambahan (15+) — phone ≥9 semua

DineIn, CustomMenu, LoadOrder, Cancel/void, BillPreview, CartDetail, QrScan,
Qris, Edc, Attendance, Shift, Recap, EndShift, EsbOrder, Kitchen, Voucher,
Printers, Settings. Total route terdaftar: **29** (`src/navigation/types.ts`).

### 1c. Bukti screenshot

- `docs/shots/` — 37 file: `01–10` (phone utama), `t01–t10` (tablet utama),
  `11–12` (fix booking/history), `20–34` (15 layar tambahan).
- `verify/final/` — 14 screenshot final phone+tablet (cashier, dashboard,
  history, pay-tunai, login, booking, member, receipt, success, tables).

---

## 2. Flow navigator (`App.tsx` + `src/navigation/types.ts`)

Guard: belum login → hanya stack `Login`. Sesudah `loginDemo()` → 29 route.

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
Catatan: `EdcScreen` ter-bypass — Pay memakai form EDC inline (`edcCode`).

---

## 3. Fitur APK vs RN — gap 83-vs-29

APK: **83 `*screen.dart`** (4 customer-display + 41 phone + 38 tablet paralel).
RN: **29 route**. Cakupan RN = alur kasir inti ✅ (detail di `REA-DEEP.md` §4).

Yang **belum ada di RN** (prioritas):
1. Install/klaim terminal (`intro`, `install-home`, scan-QR/get-QR,
   `select-branch`, `install-progress`, `success-create-pin`, `forgot-pin`)
   + login PIN-lokal → server.
2. `order_full_service` + `split-bill` / `move-items` / `move-table` /
   `select-promotion` / `order-list`.
3. `detail-recap/shift-recap` (rekap per menu/kategori/mode/payment/user),
   `expense` + `petty-cash` (form, CoA, foto, approve).
4. Printer BT (SPP/RFCOMM via `flutter_blue_classic`) / USB / LAN + cash
   drawer (ESC/POS `ESC p m…` via koneksi printer) + flag autocut.
5. `member-deposit/top-up`, payment lanjutan (deposit/online/OVO/external,
   others/compliment/nonsales, pluxee/ultra-vouchers, payment-auth,
   send-email), `sales-detail/void` + filter history, settings lanjutan
   (menu-printing, printer-connection, stock, sync-data, app-setting, log),
   `web-view`, `customer-display` (4 screen), seluruh varian tablet (38 file).

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
  update via WS/event — bukan VFD/serial.
- **API:** prod `https://poslite.esb.co.id/api/web` (prefix `esb_apiv9/`),
  loop `loop-lite.esb.co.id`, OMS `services.esb.co.id/oms`,
  ESO `eso-api.esb.co.id`, WS `wss://ws-poslite.esb.co.id/ws`.
  Pull master `main/get-*` + `pull/*`; push `order/finish`, voucher
  `{lock,unlock,validate,burn}`, attendance `{clock-in,clock-out}`.
  Field JSON camelCase tak terekstrak dari strings — butuh mitmproxy/dekompilasi.
- **SQLite (~93 tabel):** `ms_menu`/`ms_branchmenu`, cart `tr_salesmenutemp`,
  transaksi `tr_saleshead`/`tr_salesmenu`/`tr_salespayment`, shift
  `tr_shiftlog`, expense, deposit, antrean sync, `ms_posuser(username PK,
  posPassword, posSalt)`, KV `ms_setting`/`ms_terminalsetting`.
- **Login = PIN lokal** (cek SQLite di perangkat, `rememberMe/autoLogin`);
  tanpa bearer/JWT di strings. ⚠️ Jangan tiru PIN-lokal-only: pakai KDF,
  secure storage, revalidasi server saat online.
- **APK sumber:** ESB POSLite v2.31.13 — [Play Store](https://play.google.com/store/apps/details?id=id.co.esb.esb_pos).
  Artefak strings `apktest/` **tidak ikut di repo** (ada saat REA, tidak di-commit).

---

## 5. Metode verifikasi

1. `npx expo start` (atau `npm run web`), set `EXPO_PUBLIC_NAV_HOOK=1`.
2. Driver Playwright di `verify/` (`shot.cjs`, `shot8903/04/05.cjs`,
   `shots-driver*.js`) membuka tiap route via `__NAV__.go(name)`,
   screenshot viewport phone (±390) & tablet (±820).
3. Hasil: `/shots` → disalin ke `docs/shots/`; final ke `verify/final/`.
4. Penilaian: bandingkan dengan ref `refs/` (9 PNG) + screenshot APK.

---

## 6. Bug / temuan (audit awal → status)

| Temuan (sumber) | Status |
|---|---|
| Logout mati — hanya `navigate('Login')` (AUDIT §3) | ✅ diperbaiki: `logout()` di Dashboard:67 + Settings:89 |
| Success buntu — tanpa Receipt/History (AUDIT §3) | ✅ diperbaiki: 3 tombol Success:88,93,98 |
| Receipt angka polos tanpa `rp()` (AUDIT §2) | ✅ diperbaiki, pakai `rp()` |
| Hex liar 17 file (AUDIT §2) | ✅ dikonsolidasi ke token `src/theme` |
| Typo header ESS/Apriviinta (GAP D1) | ✅ ESB Cabang Poris / Gista (`session.ts`) |
| Label phone `Order Fee` vs tablet `Ongkir` (Cashier:253) | ⚠️ **masih ada** — samakan ("Ongkos Kirim"/"Promo") |
| Tombol cetak no-op (Cashier, BillPreview, DineIn, CartDetail, Qris) | ⚠️ masih mock — butuh printer (§3.4) |
| 5 rute orphan dari UI (DineIn, Voucher, QrScan, EsbOrder, Settings) | ⚠️ cek ulang inbound / hapus rute |
| `EdcScreen` vs form EDC inline di Pay | ⚠️ putuskan salah satu |
| 5 layar tablet masih kolom phone (login, receipt, success, member, booking) | ⚠️ TODO §7.1 |

---

## 7. TODO sisa + delegasi ke Claude Code

### 7.1 Prioritas (sesuai skor & gap)

1. Tablet 2-panel: login, receipt, success, member, booking (target ≥8).
2. Samakan label `Order Fee`/`Ongkir` + sisa bahasa Inggris.
3. Putuskan orphan routes + `EdcScreen` vs inline.
4. Gap APK (§3): install/klaim → split-bill → recap/expense → printer → deposit.
5. Cetak nyata (ganti no-op) + `logout()` di semua titik keluar.

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

---

## 8. Repo & push

- Remote: `https://github.com/mygads/genfity-order-app.git` (branch `main`).
- `node_modules/` (385 MB), `.expo/`, PNG nyasar root (`f-cashier.png`,
  `rn-cashier*.png`, `v-*.png`) tidak ikut push; `docs/shots/` (37 bukti)
  + `verify/` + `refs/` ikut.
