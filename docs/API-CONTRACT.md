# Kontrak API - Genfity Order App ↔ Server

Dokumen ini adalah SATU-SATUNYA acuan membangun backend (BE) sendiri.
Struktur flow/endpoint/urutan mirror ESB POSLite v2.31.13 (fakta bedah di
`REA-poslite-dossier.md` Lampiran D); skema JSON di bawah adalah kontrak
resmi clone ini - implementasikan di server apa adanya agar aplikasi jalan.

Legenda: **[FAKTA]** = terverifikasi dari string/APK. **[KONTRAK]** = ditetapkan
dokumen ini (ikuti persis bila bangun BE baru).

---

## 1. Host & environment

| Fungsi | [FAKTA] Host asli | [KONTRAK] variabel |
|---|---|---|
| Install/registrasi (Yii2) | `https://erp.esb.co.id` | `INSTALL_BASE_URL` |
| Runtime pull/push utama | `https://eso-api.esb.co.id` | `API_BASE_URL` |
| OTA + update | `https://poslite.esb.co.id/api/web` | `OTA_BASE_URL` |
| Loyalti/voucher | `https://loop-lite…/api/web` | `LOYALTY_BASE_URL` |
| WS device channel | `wss://ws-poslite.esb.co.id/ws` | `WS_URL` |
| WS self-order channel | `wss://…/wss-self-order` | `WS_SELF_ORDER_URL` |

Ganti semua via layar Pengaturan → Terminal & Server (`src/config/server.ts`).

## 2. Konvensi umum

- Semua request: `POST`, `Content-Type: application/json`.
- [KONTRAK] Header auth setiap request runtime:

```http
X-Terminal-Key: <terminalKey dari hasil install>
X-Terminal-Id: <T001>
X-Device-Id: <16-hex deviceID>
```

- [KONTRAK] Envelope sukses Yii2-style:

```json
{
  "name": "OK",
  "message": "Berhasil",
  "code": 0,
  "status": 200,
  "success": true,
  "data": { }
}
```

- [KONTRAK] List ber-paging:

```json
{ "success": true, "data": {
  "totalRecords": 128, "pageCount": 3, "page": 1, "items": [ ] } }
```

- [KONTRAK] Error: `success:false` + `code` string. Kode yang dipakai aplikasi:

| Kode | Arti | Aksi aplikasi |
|---|---|---|
| `E00044` | Data >7 hari belum sync | Blokir transaksi, paksa sync |
| `E00043` | >3 hari belum sync | Banner peringatan |
| `E401` | Terminal key salah/dicabut | Kembali ke klaim terminal |
| `E422` | Validasi gagal | Tampilkan `message` + `errors{}` |
| `E409` | Versi data basi (pull lama) | Pull ulang domain terkait |

## 3. Install & klaim terminal - `INSTALL_BASE_URL`

### 3.1 `POST /pos/install` [FAKTA path]

Request:

```json
{ "deviceID": "a91f3c..." }
```

Response `data`:

```json
{
  "terminalKey": "uuid-atau-opaque-string",
  "terminalId": "T001",
  "terminalCode": "ESB-PORIS-001",
  "branchId": "B001",
  "branchName": "ESB Cabang Poris",
  "claimed": false
}
```

### 3.2 `POST /main/validate-terminal` - klaim via QR/kode

```json
{ "terminalCode": "ESB-PORIS-001", "deviceID": "a91f3c..." }
```

→ `data: { "valid": true, "branchId": "B001", "branchName": "…" }`

### 3.3 `POST /main/check-branch-status`

```json
{ "branchId": "B001" }
```

→ `data: { "status": "active" }` (`active|inactive|expired` - selain active
tampilkan ilustrasi `branch_inactive/branch_expired` + blokir login).

### 3.4 PIN & user

| Endpoint | Body | Data |
|---|---|---|
| `POST /pos/create-pin` | `{userId, pin, deviceID}` | `{ok:true}` |
| `POST /esb/employee/validate` | `{username, pin}` | `{userId, nama, authKey, role}` |
| `POST /esb/employee/update-pin` | `{userId, oldPin, newPin}` | `{ok:true}` |
| `POST /employee-attendance/clock-in` | `{userId, terminalId, shiftId}` | `{attendanceId, clockIn}` |
| `POST /employee-attendance/clock-out` | `{attendanceId}` | `{clockOut}` |

## 4. Pull (server → aplikasi) - `API_BASE_URL`

Urutan pull [FAKTA]: cabang → menu → pengguna/terminal → promo/voucher →
member → pengaturan → penjualan (riwayat). Semua pull memakai body:

```json
{ "branchId": "B001", "terminalId": "T001", "lastSyncDate": "2026-10-01 00:00:00", "page": 1 }
```

Server kembalikan hanya baris yang berubah sejak `lastSyncDate`.

| Domain | Endpoint | Isi `data.items[]` → tabel lokal |
|---|---|---|
| Cabang & setting | `POST main/get-branch-settings` | `ms_setting`, `ms_terminalsetting`, `ms_station`, `ms_paymentmethod` |
| Menu | `POST main/get-menu` | `ms_menu`, `ms_category`, `ms_menu_group`, `ms_extra`, `ms_menu_image` |
| Menu cabang | `POST main/get-branch-menu` | `ms_branchmenu`, harga/spesial, sold-out |
| Pengguna | `POST main/get-user` | `ms_posuser` |
| Meja | `POST main/get-table` | `ms_table`, `ms_tablesection` |
| Promo | `POST main/get-promotion` | 8 tabel `ms_promotion_*` |
| Voucher | `POST main/get-voucher` | `ms_voucher`, template |
| Member | `POST main/get-member` | `ms_member` |
| Penjualan | `POST main/get-sales` | riwayat `tr_saleshead*` |
| CoA | `POST main/get-expense-chart-of-accounts` | `ms_coa` |
| Menu online | `POST main/get-menu-online` | stok online + mapping gofood/grab |
| Versi | `POST esb_api/pull/pos-version` | `{minVersion, latestVersion}` |

Contoh item menu:

```json
{ "menuId": "M001", "name": "Ayam Geprek", "price": 45000,
  "categoryId": "C01", "groupId": "G01", "stationId": "DAPUR",
  "flagActive": 1, "soldOut": 0, "imageUrl": "https://…/m001.webp",
  "lastSyncDate": "2026-10-16 10:00:00" }
```

## 5. Push (aplikasi → server) -dirty = `syncDate IS NULL`

Aturan kirim [KONTRAK]: push/pull/WS HANYA ke server env Custom (milik sendiri); env bawaan = mode lokal, aplikasi menolak sync agar data tak bocor ke infrastruktur pihak ketiga. Urutan push [FAKTA]: shift → penjualan → event/expense → deposit → ESO.
Aplikasi mengirim per batch (maks 50/batch), server membalas id yang diterima;
yang gagal TETAP `syncDate NULL` (retry berikutnya).

### 5.1 `POST order/finish` - penjualan

```json
{
  "salesNum": "TRX-20261016-014",
  "branchId": "B001", "terminalId": "T001", "userId": "U07",
  "shiftId": "S20261016P", "salesDate": "2026-10-16 12:40:00",
  "salesMode": "DINE_IN", "tableNo": "A-01",
  "subtotal": 70000, "discount": 2500, "tax": 5698,
  "serviceCharge": 2875,
  "voucherAmount": 10000, "platformFee": 0, "rounding": 25,
  "grandTotal": 60400, "paidAmount": 100000, "changeAmount": 39600,
  "paymentMethod": "Tunai",
  "items": [
    { "menuId": "M001", "name": "Ayam Geprek", "qty": 2,
      "unitPrice": 45000, "discount": 2500, "note": "level 3",
      "extras": [{ "name": "Nasi", "price": 5000 }], "voided": 0 }
  ],
  "payments": [{ "method": "Tunai", "amount": 100000 }],
  "vouchers": [{ "code": "HEMAT10K", "amount": 10000 }]
}
```

### 5.2 Endpoint push lain

| Endpoint | Payload inti |
|---|---|
| `POST order/split-bill` | `{parentSalesNum, bills:[{…seperti finish…}]}` |
| `POST order/move-items` | `{fromSalesNum, toTableNo, itemIds[]}` |
| `POST order/move-table` | `{salesNum, fromTableNo, toTableNo}` |
| `POST order/view` | `{salesNum}` → detail (untuk load-order lintas terminal) |
| `POST shift/open` | `{userId, terminalId, startCash}` |
| `POST shift/close` | `{shiftId, endCash, expectedCash}` |
| `POST branch-expenses/push` | `{date, coaId, amount, note, photoUrl?}` |
| `POST member-deposit-withdrawal/inquiry-deposit` | `{memberId}` → `{saldo, poin}` |
| `POST member-deposit-withdrawal/topup` | `{memberId, amount, paymentMethod}` |
| `POST sales/receipt-email` | `{salesNum, email}` |

### 5.3 Voucher online (lock/burn agar tidak dipakai 2x)

```
POST posv1/esb-voucher/validate {code, grandTotal} → {valid, amount}
POST posv1/esb-voucher/lock     {code, salesNum}   → {locked:true}
POST posv1/esb-voucher/unlock   {code, salesNum}   → {ok:true}   (batal bayar)
POST posv1/esb-voucher/burn     {code, salesNum}   → {ok:true}   (lunas)
```

## 6. OTA - `OTA_BASE_URL`

`POST /api/web/esb/update/pos-lite-minimum-version-v2` [FAKTA, tanpa envelope]:

```json
{ "platform": "android" }
```

→

```json
[{ "key1": "POS", "key2": "Version", "value1": 591, "value2": 655 }]
```

`value2` = versi minimum yang boleh jalan; bila app < minimum → tampilkan
layar update + unduh APK dari `data[].apkUrl` (tambahkan key `apkUrl` di BE Anda).

## 7. WebSocket (realtime)

Aturan koneksi [KONTRAK]: kedua channel + bus display HANYA tersambung saat env server = Custom (milik sendiri); env bawaan = mode lokal, aplikasi tidak pernah mendial infrastruktur pihak ketiga tanpa kredensial merchant. Dua channel [FAKTA], reconnect otomatis + heartbeat 30 dtk (lihat
`src/lib/realtime.ts`).

### 7.1 Device channel - `WS_URL`

Server → app (`type` + `payload`):

```json
{ "type": "ORDER_STATUS", "payload": { "salesNum": "…", "status": "PAID" } }
{ "type": "MENU_SOLDOUT",  "payload": { "menuId": "M001", "soldOut": 1 } }
{ "type": "FORCE_PULL",    "payload": { "domains": ["menu", "promotion"] } }
{ "type": "SHIFT_NOTICE",  "payload": { "message": "Shift Pagi dibuka …" } }
```

### 7.2 Self-order channel - `WS_SELF_ORDER_URL`

```json
{ "type": "NEW_SELF_ORDER", "payload": { "orderId": "SO-881", "tableNo": "A-03",
  "items": [ { "menuId": "M001", "qty": 1 } ] } }
{ "type": "SELF_ORDER_PAID", "payload": { "orderId": "SO-881",
  "paymentMethod": "QRIS", "amount": 45000 } }
```

## 8. Push notification (FCM)

[KONTRAK] Aplikasi memakai `expo-notifications` (`src/lib/push.ts`):
lokal berfungsi tanpa server; remote butuh BE menyimpan token:

```
POST device/register-push {userId, terminalId, expoPushToken, platform}
```

BE kirim via Expo Push API (`https://exp.host/--/api/v2/push/send`) untuk:
order online baru, voucher berhasil, peringatan sync >3 hari, pengumuman shift.
Format `data` selaras §7 (`{type, payload}`) agar handler sama.

## 9. Kode area & format

- Uang: integer rupiah (tanpa desimal). Pajak 11% default dari
  `ms_setting(Tax, PPN)` (info-only, inklusif — lih. rumus §10.3). Pembulatan: `rounding` = selisih ke kelipatan
  (`ms_setting(Rounding, Step)`, default 100).
- Waktu: `YYYY-MM-DD HH:mm:ss` (zona terminal).
- Nomor transaksi: `TRX-YYYYMMDD-NNN` unik per terminal per hari.

---

**Checklist BE minimal agar aplikasi bisa dipakai penuh:**
1. §3 install + PIN + clock-in/out
2. §4 pull cabang/menu/user/meja/payment (8 endpoint)
3. §5.1 push `order/finish` + balasan id
4. §8 register-push (atau abaikan push remote, lokal tetap jalan)
5. §6 OTA (atau kembalikan array kosong - app lanjut)

---

## 10. Dummy Mode (FE tanpa BE) - [KONTRAK]

Seluruh layar memanggil backend HANYA lewat satu titik:
`src/lib/apiSource.ts` (`apiFetch` + helper install). Layar tidak me-require
JSON dummy langsung dan tidak memanggil `apiGet`/`apiPost` langsung.

### 10.1 Pemilihan sumber

| Kondisi | Mode | Perilaku |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` kosong (default) | Dummy | Respons dari `src/data/dummy/**` (offline, tanpa dial ke mana pun) |
| `EXPO_PUBLIC_API_BASE_URL` terisi URL backend sendiri | Real | `apiGet`/`apiPost` ke backend asli (header X-Terminal-Code/X-Branch-Id/Idempotency-Key/Bearer) |
| Real Mode tapi fetch gagal/offline | Jatuh-balik dummy | Respons dummy + flag `fromDummy: true` agar kasir tetap jalan |

Beralih ke backend asli: cukup isi `EXPO_PUBLIC_API_BASE_URL` (lihat
`.env.example`) - tidak ada perubahan layar. JANGAN isi URL prod pihak
ketiga; hanya backend Custom milik sendiri.

### 10.2 Isi folder dummy

Satu file per endpoint, tiap file = pasangan `{request, response}`:

- `src/data/dummy/install/` - `pos-install`, `main-validate-terminal`,
  `main-check-branch-status`, `pos-create-pin`, `esb-employee-validate`,
  `esb-employee-update-pin`, `employee-attendance-clock-in`,
  `employee-attendance-clock-out`
- `src/data/dummy/pull/` - `main-get-branch-settings`, `main-get-menu`,
  `main-get-branch-menu`, `main-get-user`, `main-get-table`,
  `main-get-promotion`, `main-get-voucher`, `main-get-member`,
  `main-get-sales`, `main-get-expense-chart-of-accounts`,
  `main-get-menu-online`, `esb_api-pull-pos-version`,
  `main-get-payment-method`, `main-get-station`, `terminal-get-terminal`,
  `terminal-update`
- `src/data/dummy/push/` - `order-finish` (angka persis contoh §5.1:
  subtotal 70000, discount 2500, tax 5698, voucher 10000, rounding 25,
  grandTotal 60400, paid 100000, change 39600), `order-split-bill`,
  `order-move-items`, `order-move-table`, `order-view`, `shift-open`,
  `shift-close`, `branch-expenses-push`,
  `member-deposit-withdrawal-inquiry-deposit`,
  `member-deposit-withdrawal-topup`, `sales-receipt-email`,
  `posv1-esb-voucher-validate/lock/unlock/burn`, `auth-cashier-login`,
  `auth-supervisor-approve`, `device-register-push`
- `src/data/dummy/ota/pos-lite-minimum-version-v2.json` - array tanpa
  envelope `[{key1,key2,value1,value2}]` + `apkUrl` milik sendiri

Data realistis: merchant ESB Cabang Poris (B001), user Gista (U07,
gista.kasir), terminal T001/ESB-PORIS-001, harga rupiah wajar.

### 10.3 Rumus kasir kanonik (wajib konsisten di data dummy)

- Uang integer rupiah. `net = subtotal - discount`.
- Pajak 11% INKLUSIF informatif: `tax = round(net * 11 / 111)`.
- Service 5% EKSKLUSIF: `service = round(net * 0.05)`.
- `GRATISONGKIR` memotong ongkir: `ongkirNet = max(0, ongkir - amount)`.
- Order ESB/marketplace: fee platform 5% dari net (`platformFee`),
  `grandTotal = net + service + ongkirNet + platformFee + rounding`.
- `grandTotal = net + service + ongkirNet + rounding`.
- Contoh konsisten: subtotal 66000, discount 0, tax 6541, service 3300,
  rounding 0, grandTotal 69300, paid 100000, change 30700.
- Contoh delivery: subtotal 52000, discount 2000 (net 50000), tax 4955,
  service 2500, ongkir 12000 - GRATISONGKIR 10000 = ongkirNet 2000,
  grandTotal 54500.

### 10.4 PIN dan kode error

- Layar install memanggil `validateTerminal` / `checkBranch` /
  `createPinOnServer` lewat `apiSource` (tetap jalan offline via dummy).
- PIN plaintext tidak pernah disimpan; yang disimpan hanya hash KDF
  (salt + 2000 iterasi SHA-256) via `expo-secure-store`
  (`src/lib/pin.ts`). Verifikasi login wajib revalidasi server
  (`validateEmployee`), bukan PIN lokal saja.
- Kode error kontrak: `E00044` (>7 hari belum sync, blokir transaksi),
  `E00043` (>3 hari, banner di SyncScreen), `E401`, `E422`, `E409`.
  Banner E00043/E00044 dihitung dari timestamp sync sukses terakhir
  (`getLastSyncMs`), bukan nilai statis.

