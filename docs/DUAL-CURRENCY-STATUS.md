# Status Dual-Currency (IDR + AUD)

Dokumen milik agen wire-up + data uji. Fondasi (`src/lib/currency.ts`) milik
agen lain — file ini hanya mencatat status, cara uji, dan backlog.

## 1. Yang SUDAH jalan

- `lib/currency.ts`: cache in-memory + persist `ms_setting(Branch, Currency)`.
  Urutan sumber: profil server (`GET api/merchant/profile`, field `currency`)
  → baris lokal → fallback `IDR`/`id-ID` (perilaku lama, tak pernah blank).
- `LoginScreen.tsx`: `syncCurrencyFromProfile()` dipanggil fire-and-forget
  (best-effort `try/catch` + `.catch(() => {})`, tak memblokir login) di tiga
  titik sesi diterbitkan: `completeOnline`, `completeOffline`, `completeLogin`
  (jalur QR). Currency tak ada = fallback IDR.
- `theme` `rp()` / `formatCurrency()`: sadar cache currency.
- `totals.ts` `getTaxRate(currency)` / `getRoundStep(currency)`: setting
  eksplisit `ms_setting` selalu menang; default per currency bila tak ada.
- Seed: instalasi segar default IDR (tak berubah); relasi katalog `B004`
  (cabang uji AUD) ikut di-seed aditif; helper
  `switchSeedBranchForTest('AUD' | 'IDR')` untuk alih cabang aktif (test-only).

## 2. Cara uji 2 merchant (cabang IDR + AUD)

DB lokal hanya memegang SATU cabang aktif (tak ada tabel `ms_branch`).

1. Instalasi segar → seed IDR: `Branch Name = Genfity Cabang Poris`,
   `Currency = IDR/id`, `Tax PPN = 11`. Uji kasir: harga tampil `Rp`.
2. Aktifkan cabang AUD: panggil `switchSeedBranchForTest('AUD')`
   (via console dev / tombol uji sementara) → Name `Genfity Sydney (Uji AUD)`,
   `Currency = AUD/en-AU`, `Tax PPN = 10`. Muat ulang → harga tampil `A$`.
3. Login online dengan profil merchant yang membawa `currency` → sync
   menimpa cache + persist otomatis (verifikasi: format berubah tanpa switch).
4. Login offline / tanpa field `currency` → baris lokal dipakai; bila tak ada
   → fallback IDR (perilaku lama).
5. Kembali ke IDR: `switchSeedBranchForTest('IDR')`.

## 3. Perilaku per currency

| Aspek | IDR | AUD |
|---|---|---|
| Format (`rp()`) | `Rp 15.000` (titik, tanpa desimal) | `A$ 15,000.00` (koma, 2 desimal) |
| Locale | `id-ID` | `en-AU` |
| Pajak default (`getTaxRate`) | 11 (PPN) | 10 (GST) |
| Pajak di total | Inklusif, info-only (keduanya) | Inklusif, info-only |
| Rounding default | 100 (rupiah) | 1 (sen) |
| Kode asing / kosong | — | Fallback IDR + warn sekali |

Catatan: setting eksplisit `ms_setting(Tax, PPN)` / `ms_setting(Rounding, …)`
selalu menang atas default per currency di atas.

## 4. Backlog §4 — SELESAI (gelombang-15 SESI-APP-DUALCUR, 2026-10-23)

Verifikasi ulang tiap item di kode + perbaikan ikut pola existing
(profil currency live dari BE; format per-currency; timezone cabang).

1. **Gating metode bayar per currency — DONE.**
   Verifikasi: UI Pay memakai tab hardcode (`PayScreen.tsx`: `SIDEBAR_IDS`,
   `WALLETS`, `CARDS`), tabel `ms_paymentmethod` seed (Tunai/QRIS/Transfer/EDC)
   tak dikonsumsi UI mana pun — kolom currency di tabel = data mati, SENGAJA
   tak ditambah. Gerbang hidup di `PayScreen.tsx` (`isAudBranch` dari
   `getCachedCurrency()`): cabang AUD menyembunyikan tab `nontunai` (EDC/kartu
   BCA/OCBC) + `online` (OVO/GoPay/DANA/QRIS/ShopeePay); usulan metode ID
   (mis. SplitBill QRIS) jatuh ke `tunai`. Tunai/member-deposit/tender
   (transfer/kompliment/non-penjualan) netral-currency, tetap tampil.
2. **Label i18n `(Rp)` — DONE (8 kunci).**
   Verifikasi: `lib/i18n.ts` hardcode `(Rp)` di `price`, `mem_nominal_label`,
   `vou_kind_discount`, `top_custom_label`, `ongkirNominal`, `discItemRp`,
   `unitPriceRp`, `menu.price` (termasuk varian `en`). Perbaikan: 8 varian
   `*_aud` (`(A$)`) + helper `tCur(base)` (fallback kunci dasar bila varian
   tak ada — tak pernah blank; pola pasangan mengikuti
   `vou_kind_disc_idr/aud`). Call-site beralih ke `tCur`: CustomMenuScreen,
   MemberScreen, VoucherScreen, TopupDepositScreen, CartDetailScreen (2),
   CashierScreen (2), MenuManagementScreen (2).
3. **`WIB` di struk — DONE.**
   Verifikasi: `ReceiptScreen.tsx` SUDAH bersih (header tanggal memakai
   `fmtDateInTz`/`fmtTimeInTz`, tanpa sufiks zona — dikerjakan lane S4).
   Sisa hardcode: `idle_hours_val` (id) + `help.contact` (id+en).
   Perbaikan: kedua kunci memakai placeholder `{tz}` +
   `getTimezoneShort()` baru di `lib/timezone.ts` (Jakarta→WIB,
   Perth→AWST, Sydney→AEST, fallback jujur = nama zona); call-site
   IdleScreen + HelpScreen me-replace `{tz}`. `switchSeedBranchForTest`
   kini ikut menulis baris `Branch/Timezone` (IDR→Asia/Jakarta,
   AUD→Australia/Perth) + `setCachedTimezone()` tanpa perlu restart.
4. **Pajak per-cabang — DONE.**
   Verifikasi: `Tax PPN` satu baris global; helper uji menimpa global.
   Perbaikan: `getTaxRate(currency?, branchId?)` di `lib/totals.ts` menang
   berurut — `ms_setting('Tax','PPN_<branchId>')` → global `Tax/PPN` →
   default currency (11/10). Helper uji menulis kedua tarif
   (`PPN_B001=11`, `PPN_B004=10`) sehingga hidup berdampingan; global tetap
   cermin cabang aktif (kompatibel pembaca lama). Tanpa baris per-cabang =
   perilaku lama persis.
5. **Locale tanggal vs currency — DONE.**
   Verifikasi: `fmtDateInTz` memakai locale bahasa UI (`id→id-ID`), sehingga
   cabang AUD + UI `id` tampil format Jakarta. Perbaikan: `branchLocale()`
   baru di `lib/datefmt.ts` — cabang AUD selalu `en-AU`, selain itu peta lama
   (tanpa ubah `fmtDate`/`fmtSalesDate` device-time). Pemakai InTz
   (Receipt, SyncScreen, sync.ts) otomatis ikut. Asumsi: kasir Sydney melihat
   nama bulan Inggris (revert mudah bila owner mau ikut bahasa UI).
6. **Seed order AUD — DONE.**
   Verifikasi: `seedCanon` hardcode `taxRate: 11`; belum ada order AUD.
   Perbaikan: `SeedOrderSpec` +`taxRate?`/`branchId?`; `seedCanon` memakai
   keduanya (`roundStep` 1 untuk B004 — perlu karena `totals()` integer);
   `seedSaleDirect` memakai `branchId` spec (dulu literal `'B001'`).
   `SEED-AUD-001` (Jack, TAKE AWAY cash, Ayam Bakar 25×1 + Kopi 5×2 = 35,
   GST 10 → pajak 3, service 2, total A$37.00) di-seed HANYA dari
   `switchSeedBranchForTest('AUD')` (idempoten via cek salesNum) — instalasi
   segar tetap IDR murni. `totals()` +`roundStep?` opsional (default 100,
   kompatibel).

   Tap-flow: instalasi segar (IDR: `Rp 15.000`, PPN 11) → panggil
   `switchSeedBranchForTest('AUD')` → label `(A$)` + `A$` 2-desimal,
   tab QRIS/EDC hilang, jam `AWST`/tanggal `en-AU`, pajak GST 10,
   `SEED-AUD-001` tampil di History → kembali `switchSeedBranchForTest('IDR')`.
   Gate: `npm run typecheck` + `npm test` hijau (tanpa emulator).
