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

## 4. Yang BELUM (backlog eksplisit)

1. **Gating metode bayar per currency** — `ms_paymentmethod` seed (Tunai,
   QRIS, Transfer, EDC) tampil untuk semua cabang tanpa filter currency.
   Cabang AUD seharusnya menyembunyikan QRIS/EDC/wallet-ID. Butuh kolom
   currency di metode bayar + filter UI.
2. **Label i18n `(Rp)`** — ~10 kunci `lib/i18n.ts` hardcode `(Rp)`, bahkan di
   string `en`: `price`, `mem_nominal_label`, `vou_kind_discount`,
   `top_custom_label`, `ongkirNominal`, `discItemRp`, `unitPriceRp`,
   `menu.price` (en: `Price (Rp)`). Butuh label sadar-currency.
3. **`WIB` di struk** — `ReceiptScreen.tsx` hardcode `WIB`; kunci
   `idle_hours_val` (id) dan `help.contact` hardcode `WIB`. Cabang AUD perlu
   zona sendiri (AEST/AEDT) per cabang, bukan hardcode.
4. **Pajak per-cabang** — `Tax PPN` satu baris global; dua cabang beda pajak
   tak bisa hidup berdampingan offline. Helper uji menimpa global.
5. **Locale tanggal/waktu ikut bahasa UI** (`datefmt.ts`: `id-ID`/`en-GB`),
   bukan currency cabang — jam Sydney tampil format Jakarta bila UI `id`.
6. **Order contoh seed hanya IDR** — `seedCanon` hardcode `taxRate: 11`;
   belum ada order contoh AUD untuk baseline History/Dashboard cabang AUD.
