# GAP AUDIT - Ref vs React Native (posclone-rn)

9 ref di `refs/`, 16 layar di `src/screens/*`. Tidak ada file diubah - analisis saja.

## 1. ref_mGyfgcM0.png - layar apa, sudah ada atau belum

Layar **Order-Taking / Kasir DINE IN (POSLite, phone)**: header navy
`ESB Cabang Paris | Apriyanto QA | Shift Open | Online`, mode `DINE IN
(Exclusive) 14 seat`, tombol Tersimpan / Order Fee / Promo, kategori
`Makanan (4pcs)` aktif, list order + badge qty, CTA bawah
`Lihat Pesanan | Rp 122.500`. **SUDAH ADA** → `CashierScreen.tsx`
(mode DINE IN, kategori Makanan, cart, CTA bayar).

## 2. Defect konkret per layar vs ref

### Kasir (`CashierScreen`) vs mGyfgcM0 + bwPBnoBL + 7GlCzJHe
- D1: Typo header - kode `ESS Cabang Paris / Apriviinta QA`, ref
  `ESB Cabang Paris / Apriyanto QA` (+ `Gista` di ref tablet).
- D2: Ref phone pakai label `Order Fee`, RN pakai `Ongkir`
  (ref tablet pakai `Ongkir`) - pilih satu, samakan dengan target device.
- D3: Ref phone tidak ada input customer; ref tablet ada
  (`Info tambahan / nama customer`) - RN hanya tampil di tablet (`isWide`).
- D4: Ref kategori tampilkan count `(4pcs)/(3pcs)`; RN tidak ada count.
- D5: Ref phone list order gaya baris + badge qty biru; RN (tablet) gaya
  kartu pastel - visual phone belum diwakili.

### Bayar (`PayScreen`) vs hRwEM3MH + ewSg5BkX + na4wPy_6 + -lpMMd-D
- D6: Ref phone tunai ada grid nominal cepat (`Uang Pas, Rp 270rb…`) +
  tombol `Tambah` (split) nonaktif; cek RN: nominal ada (computed),
  tombol `Tambah` split kedua belum terlihat di flow phone.
- D7: Ref tablet non-tunai ada tombol `Ubah` biru solid + field
  `Kode verifikasi dari EDC`; RN punya field EDC tapi tanpa tombol `Ubah`.
- D8: Ref tablet ada box oranye `Voucher Terpasang`; RN hanya tombol
  `Tambah Voucher` (state terpasang tidak sejelas ref).
- D9: Nama drawer RN `Cash Child / Cash Child 2` (duplikat, Inggris);
  ref phone: `Cash Authorization, Cash Child 2…` - rapikan label ID.

### Riwayat (`HistoryScreen`) vs M5NJch6L + Qdj5AW6J
- D10: Ref tablet: filter 4 kolom + tombol reset `X` biru; RN: cek tombol
  reset semua filter ada/tidaknya (`clearAll` ada di kode - pastikan UI).
- D11: Ref kartu: `Nomor Transaksi` + `Nomor Bill` dua baris; RN
  derivasi `BILL` dari `TRX` - samakan format nomor dengan backend.
- D12: Ref phone: `Total Penjualan: Rp. 141.502` (titik setelah Rp) -
  inkonsistensi ref; RN konsisten `Rp 141.502`. Ikut RN.
- D13: Ref detail ada tombol `Metode Pembayaran >`; RN ganti via modal
  `Ubah Pembayaran` - beda pola, pastikan alur terpenuhi.

### Meja (`TablesScreen` - `Peta Meja`), Member, Shift
- D14: **Tidak ada ref meja/member/shift** di 9 file refs - ketiga layar
  ini tanpa pembanding visual; anggap layar tambahan di luar cakupan ref.
- D15: Label status RN (`Tersedia/Terisi/Dipesan/Gabung`) vs bahasa ref
  (`Shift Open`, `Online`) - tetap Indonesia, OK.

## 3. Konsistensi global

- Header/navy: `navy #16215E` dipakai semua header + badge `Online` ✓.
- Oranye/biru: `orange #F5820D` = tab/kategori aktif; biru = tombol
  Bayar/Lanjut ✓ sesuai ref.
- Bahasa: Indonesia dominan; sisa Inggris: `DINE IN, Order Fee, Promo,
  Online, Cash Authorization` - sama seperti ref, diterima.
- Format Rp: `rp()` → `Rp 122.500` ✓ konsisten; satu ref tulis `Rp.`
  (abaikan, ikut helper).

## 4. Ringkasan aksi

Prioritas: D1 (typo outlet/kasir) → D2/D9 (label) → D7 (tombol Ubah) →
D8 (Voucher Terpasang) → D4/D6 (count kategori, Tambah split) →
D10/D11 (verifikasi UI filter + format nomor). D14: meja/member/shift
butuh ref sendiri bila ingin diaudit.
