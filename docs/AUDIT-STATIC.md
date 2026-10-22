# AUDIT STATIS - posclone-rn (kode saja, tanpa run)

Metode: grep + baca file. Threshold tablet konsisten `width >= 768`. Tema acuan: `src/theme/index.ts` (`navy #16215E`, `orange #F5820D`, helper `rp()`).

## 1. RESPONSIVITAS - skor 6/10

Layar adaptif tablet (3 dari 29):
- `cashier/CashierScreen.tsx:99-100` - `isWide = width >= 768`; 2-panel (`bodyRow` katalog + `cartPanel`) di `462`; phone = katalog + bottom bar.
- `payment/PayScreen.tsx:55-56` - `isTablet = width >= 768`; split `tabletSplit/tabletContent` (`522,539`); bottom CTA disembunyikan di tablet (`252,257` → `if (isTablet) return null`).
- `history/HistoryScreen.tsx:45-46` - `isTablet`; 2-pane di `192`, filter sheet hanya phone (`210`).

Single-layout / tanpa `Dimensions` (26 layar): Login, Dashboard, CartDetail, DineIn, CustomMenu, LoadOrder, BillPreview, Receipt, Cancel, Tables, Booking, Member, Voucher, QrScan, Qris, Edc, Success, Attendance, Shift, Recap, EndShift, EsbOrder, Kitchen, Printers, Settings.
- Risiko: Qris/Edc/Success (ujung alur bayar) & Dashboard (grid menu) phone-only - di tablet POS melebar jelek.

Cashier 2-panel & spacer:
- Threshold `768` (`100`); spacer ganjil OK - `gridData` append `null` saat `isWide && odd` (`137-139`), `renderItem` kembalikan spacer view (`323`), `numColumns={isWide?2:1}` (`318`).
- Bug label per breakpoint: `CashierScreen.tsx:236` - phone tampil **"Order Fee"**, tablet **"Ongkir"** (inkonsisten + Inggris).

## 2. KONSISTENSI - skor 5/10

Warna (hex liar di 17 file; terparah: Pay, Cashier, History, Dashboard, Kitchen, EsbOrder, Settings, Printers, QrScan, DineIn, CartDetail, CustomMenu, Cancel, BillPreview, Edc, Recap):
- Biru liar `#1B5BD7`×7, `#1438C9`×4, `#1A73E8`×1 (seharusnya navy `#16215E`/`paleBlue #EAF2FF`); ungu `#4B0082`×1; kuning `#FFE600`×1.
- Hijau liar `#1B7A43`×8, `#79B62A`×2, `#3DDC74`×1 (tema: `#1FA855`/`#E8F7EE`); amber `#FFF6E0/#D99A00/#9A6B00`, `#FFE9D2/#B25A09`; abu `#CBD2DE`×4, `#B9C2E8`×6, `#C6CFE8`×5, `#C9D4F5`×3, `#E3F0FF`, `#F7F8FA`, `#C6CBD6`.

Format Rp:
- `rp()` dipakai 10 layar (benar). Manual `toLocaleString('id-ID')` tanpa prefix: `ReceiptScreen.tsx:30` (struk tampil angka polos!), `EndShiftScreen.tsx:120`, `ShiftScreen.tsx:92`, `MemberScreen.tsx:195`; `rp(...).replace('Rp ','')` ×3 (`EndShift:169`, `Shift:104`, `Member:211`).

Bahasa (Inggris sisa): `CashierScreen:236` "Order Fee" · `DashboardScreen:32` "station Bill" · `:28` "Jual · 47 trx" · `:58` "Open · Kas … Clock in" · `BookingScreen:78` "Jumlah pax" (+var `pax`) · `ReceiptScreen:17` hardcode "Take Away" · `MODES` all-caps (`DINE IN/TAKE AWAY/GOFOOD…`, `Cashier:61`) · tombol "Print" di Kitchen (`151,254,261`) & EsbOrder (`192,325,332`) · `customerDisplay` (`SettingsScreen:11`).

## 3. FLOW NAVIGATOR - skor 6/10

Guard: `App.tsx` `GuardedStacks` - belum login hanya stack `Login` (`subscribeSession`). OK.
- 29 route terdaftar. Tanpa inbound `navigate` sama sekali (orphan, mati dari UI): **DineIn, Voucher, QrScan, EsbOrder, Settings** (5 rute). `Edc` = 0 inbound - PayScreen pakai form EDC inline (`edcCode`), jadi `EdcScreen` ter-bypass.
- `BillPreview`/`Booking`/`Recap` hanya via menu dinamis Dashboard (`m.route`, `Dashboard:141`) - tidak ada link dari Kasir → BillPreview putus dari alur kasir.
- Rantai utama **nyambung**: Cashier (`goCart:171`) → CartDetail (`goPay`) → Pay (`goSuccess:124`, via Qris `:40`) → Success → "Order Baru" → Cashier (`Success:86`). Ekor putus: Success→Receipt/History tidak ada; tombol "Cetak Struk" no-op (`Success:80`, komentar `/* Cetak Struk */`); tombol cetak serupa mati di BillPreview:47, DineIn:81, CartDetail:99, Qris:88, Cashier:447.
- **Logout mati**: Dashboard "Keluar" hanya `navigate('Login')` tanpa `logout()` (`Dashboard:64-66`, sesi tetap hidup); tombol Keluar Settings tanpa `onPress` (`SettingsScreen:77-79`); `logout()` di `session.ts:42` tidak dipanggil layar mana pun.
- `Login` tetap ter-mount di stack login (harmless); Receipt hanya via BillPreview/DineIn (nominal hardcode 60900 di DineIn:80,83).

## Prioritas perbaikan
1. Sambungkan `logout()` ke kedua tombol Keluar (guard jadi fungsional). 2. Beri inbound ke 5 orphan (atau hapus rute) + putuskan nasib `EdcScreen` vs form inline. 3. `ReceiptScreen:30` pakai `rp()` (bug kasat mata). 4. Ganti hex liar → token `colors.*` (17 file). 5. Label phone/tablet Cashier disamakan ("Ongkos Kirim"/"Promo"). 6. Success → tambah "Lihat Riwayat"/cetak nyata.
