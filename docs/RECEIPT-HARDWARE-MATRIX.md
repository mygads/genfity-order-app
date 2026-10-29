# Matriks Uji & Kontrak Struk Thermal 1:1 (POS / BE / FE)

Tanggal: 2026-10-29. Tanpa commit — working tree.

## 1. Geometri kertas (terverifikasi spek publik Citizen CT-S310II dkk)

- 58mm: lebar cetak 384 dot, Font A 32 kolom. 80mm: 576 dot, Font A 48 kolom.
- POS: `station.cpl` 32/48 per station (`PrintersScreen`), bukan `paperSize` template.
  Merchant set `paperSize` untuk PDF/HTML BE; fisik station selalu menang (multi-station beda kertas).
- `BillPreviewScreen` menampilkan banner `58mm/80mm · ID/EN` agar kasir tahu mode pratinjau.

## 2. Matriks uji hardware (wajib sebelum merge)

Kertas {58, 80} x mode {DINE_IN, TAKEAWAY, DELIVERY, IN_STORE_PICKUP,
IN_STORE_SERVICE, HOME_SERVICE} x toggle {ON, OFF penuh} — bandingkan
PDF (BE) vs bridge (server) vs thermal (BT/LAN) vs paper (layar):

| # | Kasus baku | Ekspektasi |
|---|------------|------------|
| 1 | Nama item > 48 char | Thermal wrap ala BE (kecuali baris angka `row2` potong); PDF wrap `SplitText` |
| 2 | `customFooterText` multi-paragraf `\n` | Center per baris seperti BE |
| 3 | `customThankYouMessage` | Tampil bila toggle ON; default BE/POS kosong-mati |
| 4 | `footerPhone` | Thermal bawah dekat footer; BE ikut blok kontak |
| 5 | Addon berlapis + `showAddonPrices` OFF | Nama addon tampil, harga 0 disembunyikan |
| 6 | Voucher nominal 0 | Baris info-only kode, tanpa nominal ganda |
| 7 | Split payment | `splitText` + `paid/change` hanya bila lunas |
| 8 | Void lines | Banner VOID + tanpa QR + tombol cetak ditolak (R24) |
| 9 | Logo ada/tidak | Ada: raster mono tengah (batas 384/576 dot, lebih dibuang); tidak: tanpa gap |
| 10 | Unpaid preview | Banner BELUM BAYAR, tanpa `paid/change` |
| 11 | Offline pull gagal | Cache lama dipakai (server-wins, absen = jangan sentuh) |
| 12 | Cetak ganda: PayNow vs Success/buka-ulang | SATU cetakan per sale (dedupe 120 dtk `claimTerminalAutoPrint`) |
| 13 | Dapur: template KITCHEN eksplisit harga-ON | Audit `kitchenShowsPrices=true` (SS-4); ops alert, merchant eksplisit tetap dihormati |

## 3. Disposisi gap (disengaja — JANGAN "diperbaiki")

- G1 kertas fisik menang atas template — benar utk multi-station.
- G2 `receiptTemplateId` per-destinasi hanya server-bridge; lokal pakai default merchant (label UI `Template struk (server)`).
- G3 superset lokal (tip/feeESB/voucher/rounding/ongkirCut/unpaid/approval/member/split/void) = jejak audit rantai bayar.
- G4 QR POS (`client_id`+no, upsert) vs QR BE (URL tracking) — beda sumber, keduanya benar. QR test-print = `UJI CETAK - <station>`, tak bisa disalahartikan struk asli.
- G5 fee-nol: thermal sembunyikan (hemat 58mm), BE tampil `–`; toggle dihormati.
- G6 dapur lokal tanpa harga selamanya; fixture emas `test/fixtures/escpos-golden.json` mengunci `notContainsText: [Rp, A$, TOTAL]`.
- G7 logo raster: decode guarded (`jimp-compact`), cache `Merchant/LogoMonoJSON`, sync pull-time, print-time baca-saja (offline aman), fallback tanpa logo.

## 4. Mitigasi failure (status implementasi)

| # | Risiko | Status |
|---|--------|--------|
| F1 | Cetak ganda AUTO 120 dtk | BERES: `claimTerminalAutoPrint` (`lib/printBridge.ts`) + wiring `ReceiptScreen` + tripwire 4 checks + uji semantik node |
| F2 | Copies > 3 boros | BERES: clamp lokal `Math.min(3, ...)` (`lib/print.ts`); bridge hormati penuh |
| F3 | Test-print dikira asli | BERES: header `UJI CETAK - <station>` + QR = sampleNo |
| F4 | Pull gagal hapus cache | BERES: server-wins, absen = jangan sentuh |
| F5 | Idempotensi fan-out | BERES: key per-station `{base}:station-{id}`; fallback antrean kind-aware |
| F6 | Transliterasi non-ASCII | BERES: `ascii()` (`★`→`*`, `×`→`x`, else `?`), ESC/POS 1-byte |
| F7 | Potong kertas beda model | BERES: `GS V 0x00` hanya bila `cut !== false`; `capabilityProfile` + `GENERIC_SAFE`; label `cut:false` |
| F8 | QR > memori printer | BERES: potong 512 byte (buffer printer 4KB; konservatif-aman) |
| F9 | Dapur bocor harga (template KITCHEN eksplisit harga-ON) | BERES (observabilitas): `kitchenShowsPrices` di audit `THERMAL_TEMPLATE_CREATED/UPDATED` bila tipe KITCHEN (base + `modeOverrides`); merchant eksplisit tetap dihormati, ops alert dari audit. Default implisit aman (`useKitchenSafeDefaults`) |
| F10 | Ketuk Cetak ganda manual | BERES: guard `if (printing) return` |

## SS-4. BE follow-up (BERES 2026-10-29 — tanpa toolchain, hanya review manual + uji bentuk)

File: `services/genfity-order-services/internal/http/handlers/thermal_receipt_templates.go`
(fungsi update, blok audit `THERMAL_TEMPLATE_UPDATED`): tambahkan flag observabilitas
tanpa mengubah perilaku — bila `body.TemplateType == "KITCHEN_TICKET"` dan settings
mengandung payment-ON (`showSubtotal/showTotal/showAmountPaid/showChange/showPaymentMethod`),
isi metadata audit `"kitchenShowsPrices": true` agar ops bisa alert. Merchant eksplisit
tetap dihormati (kontrak: dapur-tanpa-harga hanya dijamin utk template implisit).

## 5. Observabilitas yang sudah ada

- Audit BE: `THERMAL_TEMPLATE_CREATED/UPDATED/DELETED` (+ guard `TEMPLATE_IN_USE`, `DEFAULT_TEMPLATE_REQUIRED`).
- POS: `printedCount` DB (R26, conditional update), `alreadyQueued` anti-ganda lokal-vs-fallback, lease `409` server.
- P1 follow-up (opsional): catat `templateId/version/rendererVersion/paperSize/copies` per job bridge + alert `TEMPLATE_IN_USE` berubah tipe.

## 6. Referensi base practice (publik)

- Kolom Font A 32 (58mm) / 48 (80mm), 384/576 dot — sesuai datasheet Citizen CT-S310/CT-S310II (ESC/POS).
- Rangkaian kanonis: `ESC @` init tiap job → `ESC a` align → `ESC E` bold → `GS !` size → `GS v 0` raster → `GS ( k` QR Model 2 → feed 4x LF → `GS V` potong.
- `GS V 0/1` tanpa feed = potong di posisi saat ini; dukungan full-vs-partial bervariasi per model — wajib hormati kapabilitas cutter (pola builder `escpos-builder-ts`, `receiptful/escpost`, `esc-pos-encoder`).
- Buffer terima printer sekelas 4KB — batas QR 512 byte Genfity konservatif dan aman.
- Pola KDS industri (routing per grup ke station, tiket tampilkan modifier) & kopling bayar→struk (paid-gating) sejajar Square/Clover; byte generik kompatibel klaim MokaPOS/Majoo/Pawoon/Olsera/Qasir.
