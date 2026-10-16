# Audit 1:1 POSLite → Genfity Order App (PERMANEN)

> Dibuat 2026-10-16 dari perbandingan piksel lawan capture asli di `docs/ss-poslite/`.
> Aturan main: `docs/ss-poslite/` HANYA berisi original TAMU (intro/install/login/cabang/QR-how).
> Tidak ada original post-login — klaim "1:1" di balik login dinilai lawan
> `docs/REA-poslite-dossier.md` Lampiran A + konsistensi internal, BUKAN lawan foto.
> File ini penanda permanen: yang ✅ jangan dicari/diulik lagi; yang ⏳ daftar tutupnya.

## Legenda
- ✅ = selesai, terverifikasi lawan original (jangan disentuh lagi kecuali regresi)
- ⏳ = belum / aproksimasi jujur (tutupnya dicatat di kolom "Kurang apa")
- ➕ = superset disengaja (fungsi wajib yang tidak ada di asli — JANGAN dihapus demi 1:1)

## Grup TAMU (punya original — dinilai ketat)

| Layar | Status | Catatan kunci |
|---|---|---|
| Intro p1–p4 | ✅ | Judul biru semua; tanpa "Lewati"; tombol stadium r26; `Lanjutkan  ›` spasi sesuai asli; dots oranye |
| Pilih Cabang | ✅ | Panah ← dalam layar (tanpa navy header); pin `install_location_pin.webp`; spinner biru saat load; CTA stadium pucat saat loading/kosong |
| Login email | ✅ | Ikon kartu/input/mata/gagal semua aset asli (`login_username_*`, `login_scanqr_*`, `username/password/show/hide.webp`, `fail_red.webp`); error merah + border merah; Masuk stadium penuh-oranye saat terisi, pucat saat kosong |
| Login QR | ✅ | Ilustrasi + outline "Cara mendapatkan QR" + "Scan QR" glow; tanpa kotak-simulasi/manual (tidak ada di asli) |
| QrHow (Cara mendapatkan QR) | ✅ | Header biru + banner `get_qr_banner*.webp` + 4 thumbnail `get_qr_thumbnail_*.webp` + teks langkah verbatim capture how1–4 |
| Help (?) login | ✅ | QR WA asli `whatsapp_qr.webp`; logo ESB; "0822-1066-6969" strip; tombol "Oke" |
| Show-pass / filled / error states | ✅ | Sesuai `login-showpass`, `05b-login-filled`, `login-error` (ikon abu saat normal, merah saat error) |
| Ilustrasi tablet-QR mode login | ⏳ | Aproksimasi View (tidak ada aset ini di bundle); jika APK asli dibongkar dan ketemu, ganti Image |
| Video tutorial QrHow (play) | ⏳ | Thumbnail statis; video butuh URL stream dari backend — belum ada kontraknya |
| Search + kartu cabang | ➕ | Tidak ada di capture (capture = loading); dipertahankan untuk multi-cabang |
| "Lupa PIN?" di Login | ➕ | Tidak ada di capture; dipertahankan (navigasi wajib, komitmen sebelumnya) |

## Grup POST-LOGIN (tanpa original — dinilai lawan dossier + konsistensi)

| Area | Status | Catatan |
|---|---|---|
| Drawer kiri | ✅ | Slide dari kiri (diperbaiki dari kanan); isi sesuai Lampiran A |
| Payment: Qris/Edc/Success/Receipt | ✅ | FauxQr dekoratif jujur (payload asli butuh merchant ID backend); Success orderNo deterministik; Cetak → Receipt dua form-factor; split-bill genap |
| BillPreview/Cancel split & void | ✅ | Sisa genap; void split toggle; bayar-sisa → Pay; supervisor PIN via server |
| Cashier ↔ Tables/Booking/Voucher/Member | ✅ | Mode TAKE AWAY; table attach; voucher menempel ke transaksi; riwayat member rp()+offline guard |
| QrScan kamera | ✅ | CameraView QR asli + tab claim/esb/member/voucher (milik worker lain — jangan sentuh file ini) |
| Shift/History/Cash/Settings | ⏳ | **JANGAN SENTUH** — sedang refactor i18n worker lain (tsc sempat merah `EsbStatus 'Batal'`, sudah hijau lagi 2026-10-16) |
| Print fisik | ⏳ | `printReceipt` stub; modul `genfity-printer` milik worker lain |
| Backend API/WS/sync/push | ⏳ | Kontrak di `docs/API-CONTRACT.md` (milik worker lain); outbox+sync sudah terpasang di Cancel |

## Rute terdaftar (App.tsx)
Intro, Install, SelectBranch (headerShown:false), InstallProgress, CreatePin,
ForgotPin, Login (headerShown:false), **QrHow (BARU)**, WebView + seluruh rute post-login.
`QrHow` didaftarkan di stack tamu; judul header statis ID (i18n milik worker lain).

## Cara re-verifikasi cepat
```
node verify/shot.two.cjs phone 8907 Intro SelectBranch Login QrHow
node verify/shot.two.cjs tablet 8907 Intro SelectBranch Login QrHow
npx tsc --noEmit   # harus NOL error
```
Hasil di `docs/ss-clone/phone|tablet-*.png`.
