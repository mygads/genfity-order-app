# PullMaster 6 Domain BE -> POS — Audit + Adapter (2026-10-27)

## Ringkasan

`pullMaster` (jalur ESB-legacy: `main/get-*`, `v1/pull/*`, `esb_api/*`) **404 di backend Go**
(`:8086`), sehingga 5 domain (menu/table/promo/member/voucher) tak pernah hijau dan CoA
tak punya sumber. Menu sudah diselamatkan `masterGo.pullGoCatalog`; modul baru
`src/lib/masterBe.ts` memetakan 4 domain tersisa ke **endpoint BE nyata** + tripwire
untuk CoA yang memang belum ada di BE. Wiring di `master.ts` aktif **hanya saat backend
terbukti Go** (`goOk`); fallback legacy utuh bila BE bukan Go.

## Bukti curl vs BE :8086 (2026-10-27, tanpa token)

| Target | Hasil | Arti |
|---|---|---|
| `GET /health` | `200 ok` | BE hidup |
| `GET main/get-menu`, `main/get-table`, `main/get-promotion`, `main/get-member`, `main/get-voucher` | `404` | Path ESB-legacy TAK ADA di BE Go |
| `GET v1/pull/expense-chart-of-accounts` | `404` | Path CoA ESB TAK ADA di BE Go |
| `GET api/merchant/pos/menu`, `api/merchant/table-management`, `api/merchant/orders/pos/voucher-templates`, `api/merchant/order-vouchers/templates`, `api/merchant/loyalty/members`, `api/merchant/customers/search` | `401 {"error":"UNAUTHORIZED"}` | Jalur `api/*` digerbang auth pra-routing (butuh sesi; beda dari 404 = rute dikenali lapis auth, dibuktikan definitif via `router.go` di bawah) |
| Kontrol `api/merchant/no-such-thing-xyz` | `401` (identik) | Middleware `MerchantAuth` (router.go:334) jalan sebelum pencocokan rute — bukti HTTP butuh sesi valid; kepastian eksistensi rute dari sumber |

> Live-hijau penuh (200 + sesi) butuh JWT merchant/sesi terminal yang tak tersedia di
>investigasi ini; kolom "Bukti rute" memakai registrasi sumber sebagai kontrak.

## Tabel expected/actual per domain

| # | Domain | Tabel lokal | Endpoint BE nyata (bukti rute) | Envelope respons | Status |
|---|---|---|---|---|---|
| 1 | menu | `ms_menu`, `ms_branchmenu`, `ms_setting` | `GET api/merchant/pos/menu` (router.go:398, `MerchantPOSMenuGet`) | `{success,data:{merchant,categories,menuItems}}` | **live** (sudah ada, `masterGo.ts`) |
| 2 | table | `ms_table` | `GET api/merchant/table-management` (router.go:596, `MerchantTableManagementGet`) | `{success,data:{floors:[{id,tables:[{id,floorId,tableNumber,seats,status}]}]}}` | **live via adapter** (`parseBeTables`) |
| 3 | promo | `ms_promotion` | `GET api/merchant/orders/pos/voucher-templates` (router.go:382, `MerchantPOSVoucherTemplates`) | `{success,data:[{id,name,discountType,discountValue,maxDiscountAmount,minOrderAmount,validFrom,validUntil}]}` | **live via adapter** (agregat template, `promoCode=TPL-<id>`; kode klaim di domain voucher) |
| 4 | member | `ms_member` | `GET api/merchant/loyalty/members` (router.go:782, `MerchantLoyaltyMembersList`) | `{success,data:[{id,name,status,pointsBalance,joinedAt}]}` | **live via adapter** (`parseBeMembers`; hanya `ACTIVE`; telepon dipertahankan lokal — BE tak mengirim nomor) |
| 5 | voucher | `ms_voucher` | `GET api/merchant/order-vouchers/templates` (router.go:800) + `GET .../{id}/codes` (router.go:806, `MerchantOrderVoucherTemplateCodesList`) | template + `[{id,code,isActive,createdAt,validFrom,validUntil,usedCount}]` | **live via adapter** (cap 25 template × 200 kode; kuota = semantik sekali-pakai krn BE hanya `used_count`; penegakan final di server saat settle) |
| 6 | CoA | `ms_coa` | **TIDAK ADA** (`grep -ri coa/chart-of-account` di `router.go` + `handlers/` + `migrations/` nihil; push expense = `POST .../expenses` body bebas, `TerminalExpenseCreate`) | — | **tripwire `missing-endpoint`** (dilewati + warn, `ms_coa` lokal utuh) |

## Gap pemetaan (jujur, by-design)

- **Member tanpa telepon**: loyalty tak kirim nomor; `customers/search` punya telepon
  tapi hanya untuk pelanggan ber-order + tanpa jaminan 1:1 membership. Nomor lokal tak
  pernah ditimpa NULL (upsert preservasi). Pengayaan telepon = kerja lanjutan eksplisit.
- **Voucher tanpa kuota maksimum**: skema BE (`order_voucher_codes`) hanya `used_count`.
  Adapter memakai semantik sekali-pakai (`quota = isActive && !used ? 1 : 0`); burn lokal
  belum push tetap diproteksi (cermin L10 `syncDate NULL`).
- **Promo = agregat template**: `ms_promotion.promoCode` diisi `TPL-<id>` agar baris
  valid; validasi kode aktual lewat domain voucher / `validate-voucher[-preview]` server.
- **CoA**: endpoint belum ada — bila BE kelak menambah daftar akun, tambah
  `ApiPath.pullGoCoa` + cabang `pullBeCoa()`; tripwire `BeEndpointMissing` otomatis hijau.

## Perubahan kode (tanpa ubah skema DB BE, tanpa sentuh Login/SelectBranch, tanpa commit)

- `src/config/server.ts` (+11): `pullGoTables`, `pullGoPromoTemplates`,
  `pullGoVoucherTemplates`, `pullGoMembers`, `pullGoCustomers` (prefix `api/` = bearer
  sesi otomatis). CoA SENGAJA tanpa path.
- `src/lib/masterBe.ts` (baru, 406 baris): parser murni per domain + `pullBeDomain` /
  `pullBeMaster` + `BeEndpointMissing` (404 -> `missing-endpoint`, 401 -> throw).
- `src/lib/master.ts` (+17): cabang adapter bila `goOk`; `missing-endpoint` -> `skipped`.
- `test/tripwire-master-be.cjs` (baru, 30 checks): kontrak rute, path, parser, tripwire,
  wiring goOk-only, batasan kepemilikan. `tsc --noEmit` exit 0.

## Verifikasi

- `node test/run.cjs`: `tripwire-master-be` **PASS (30 checks)**.
- 2 tripwire lain gagal (`pin-escalation-parkir` C6, `shiftcash` W1-05) = **pra-ada**,
  terbukti tetap gagal saat file tugas ini disingkirkan (milik state tree pekerja lain:
  `LoginScreen.tsx` / `SelectBranchScreen.tsx` termodifikasi konkurensi — tak disentuh).

## Follow-up MEM-PHONE (2026-10-27): pengayaan telepon member POS-side

Gap "Member tanpa telepon" di atas kini dikerjakan TANPA ubah BE: `pullBeMembers`
mencocokkan tiap loyalty member dengan `customers/search` (q = nama, take 50) dan
mengisi telepon HANYA bila match yakin 1:1 (nama ternormalisasi sama persis +
`loyaltyMember` + nomor valid + tunggal). Preservasi dua arah di SQL CASE
(donasi NULL/'' dan lokal-isi = pertahankan lokal); 401 fail-closed, sisanya
best-effort. Detail + tabel match/no-match:
`genfity-order/_workspace/laporan/MEM-PHONE-20261027.md`;
tripwire `test/tripwire-member-phone-enrich.cjs` PASS (40 checks).
