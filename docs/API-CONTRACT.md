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

REA-13: APK memakai path `/wss-self-order` di semua env non-prod
(`dev7`, `qa7`, `stg-eso`, emulator `ws://10.0.2.2:8082/ws` untuk device
channel). Staging clone diselaraskan ke
`wss://stg-eso.esb.co.id/wss-self-order` (lihat §7).

Ganti semua via layar Pengaturan → Terminal & Server (`src/config/server.ts`).

## 2. Konvensi umum

- Semua request: `POST`, `Content-Type: application/json`.
- [KONTRAK] Header auth setiap request runtime (kode: `apiGet`/`apiPost`
  di `src/config/server.ts`):

```http
X-Terminal-Code: <terminalCode dari hasil install>
X-Branch-Id: <B001>
Idempotency-Key: <id unik per item antre> (push saja)
Authorization: Bearer <authKey user> (bila ada token)
```

REA-18: `X-Terminal-Code` / `X-Branch-Id` TANPA padanan literal di APK
(status `asumsi-clean-room`). Kandidat yang ADA di APK: `authKey`,
`deviceID`/`DeviceID`, `UDID`/`udid`, `Authorization`/`Bearer`, `ApiKey`,
`x-esb-ws-secret-token` (WS saja). Backend sendiri cukup menerima header
[KONTRAK] di atas apa adanya.

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
| CoA | `POST v1/pull/expense-chart-of-accounts` [FAKTA] | `ms_coa` |
| Menu online | `POST v1/pull/get-menu-online` [FAKTA] | stok online + mapping gofood/grab |
| Station | `POST esb_api/pull/pull-station-data` [FAKTA] | `ms_station` |
| Versi | `POST esb_api/pull/pull-pos-version` [FAKTA] | `{minVersion, latestVersion}` (tanpa tabel) |
| Log shift | `POST esb_api/main/get-shift-log-data` [FAKTA] | `tr_shiftlog` |
| Setting terminal | `POST esb_api/pull/pull-terminal-settings` [FAKTA] | `ms_terminalsetting` |
| Setting terminal (v11) | `POST esb_apiv11/main/get-terminal-settings` [FAKTA] | dibaca langsung (tanpa tabel) |
| Verifikasi terminal | `POST esb_apiv9/terminal/verification-notify` [FAKTA] | `{ok, verifiedAt}` (tanpa tabel) |
| Payment method | `POST main/get-payment-method` [asumsi-clean-room] | `ms_paymentmethod` |

Contoh item menu:

```json
{ "menuId": "M001", "name": "Ayam Geprek", "price": 45000,
  "categoryId": "C01", "groupId": "G01", "stationId": "DAPUR",
  "flagActive": 1, "soldOut": 0, "imageUrl": "https://…/m001.webp",
  "lastSyncDate": "2026-10-16 10:00:00" }
```

### 4.1 REA-18: path per path (asli APK vs asumsi)

| Path lama (tebakan) | Path kini | Status |
|---|---|---|
| `main/get-menu-online` | `v1/pull/get-menu-online` | [FAKTA] |
| `main/get-expense-chart-of-accounts` | `v1/pull/expense-chart-of-accounts` | [FAKTA] |
| `main/get-payment-method` | `main/get-payment-method` (tetap) | `asumsi-clean-room`, TIDAK ADA di APK |
| `main/get-station` | `esb_api/pull/pull-station-data` | [FAKTA] (REA-12) |
| `shift/open` | `v1/push/shift` (`body.op: 'shift-open'`) | [FAKTA] |
| `shift/close` | `v1/push/shift` (`body.op: 'shift-close'`) | [FAKTA] |
| `branch-expenses/push` | `v1/push/branch-expenses` | [FAKTA] |
| `device/register-push` | `device/register-push` (tetap) | `asumsi-clean-room`, TIDAK ADA di APK |
| `auth/supervisor-approve` | `auth/supervisor-approve` (tetap) | `asumsi-clean-room`, TIDAK ADA di APK |
| `auth/cashier-login` | `auth/cashier-login` (tetap) | `asumsi-clean-room`, TIDAK ADA di APK |
| `member-deposit-withdrawal/topup` | `member-deposit-withdrawal/topup` (tetap) | `asumsi-clean-room` (inquiry-deposit ADA, topup nihil) |
| `member/register` | `erp/member` (path dasar grup) | grup [FAKTA] (REA-3), sub-path pasti `asumsi-clean-room` |

Fungsi tidak ada yang dihapus, hanya pathnya yang dialihkan
(`src/config/server.ts` + kunci katalog `src/lib/apiSource.ts`).

### 4.2 Pull baru REA-11/12/8/9

| Endpoint | Body | `data` |
|---|---|---|
| `POST esb_api/main/get-shift-log-data` | `{branchId, terminalId, lastSyncDate, page}` | `{totalRecords, pageCount, page, items[]}` dengan item `{shiftId, branchId, terminalId, userId, shiftName, clockIn, clockOut, cashInDrawer, totalSales, cashActual, cashDiff, status}` → `tr_shiftlog` (INSERT OR IGNORE, baris lokal dilindungi) |
| `POST esb_api/pull/pull-terminal-settings` | `{branchId, terminalId, lastSyncDate, page}` | `{totalRecords, pageCount, page, items[]}` dengan item `{terminalId, settingKey, settingValue, flag}` → `ms_terminalsetting` (server menang) |
| `POST esb_api/pull/pull-pos-version` | `{branchId, terminalId, platform}` | `{minVersion, latestVersion}` (tanpa tabel; helper `fetchPosVersion()` di `apiSource`) |
| `POST esb_apiv11/main/get-terminal-settings` | `{branchId, terminalId, lastSyncDate, page}` | `{terminalId, branchId, settings: [{key, value}]}` (dibaca langsung, tanpa tabel) |
| `POST esb_apiv9/terminal/verification-notify` | `{terminalCode, branchId, deviceID, status}` | `{ok, terminalCode, verifiedAt}` (helper `notifyTerminalVerification()`) |

### 4.3 Delapan kunci setting baru (REA-14)

Nama [FAKTA], pemetaan `(key1, key2)` [KONTRAK] (pecahan pasti tak
terverifikasi). Domain `branchsettings` menarik generik ke `ms_setting`,
jadi 8 baris ini ikut pull otomatis (dummy `pull/main-get-branch-settings.json`):

| Nama APK | `(key1, key2)` kontrak | `value1` contoh |
|---|---|---|
| Customer Display Logo | `(CustomerDisplay, Logo)` | URL logo |
| Enable ESB Order Web Socket | `(EsbOrder, EnableWebSocket)` | `1` |
| Enable Queue Prefix | `(Queue, EnablePrefix)` | `1` (`value2`: prefix `A`) |
| Enable Realtime Stock | `(Stock, EnableRealtime)` | `1` |
| Enable Sound ESB Order | `(EsbOrder, EnableSound)` | `1` |
| Enable Wakelock | `(Device, EnableWakelock)` | `1` |
| Rounding Mode | `(Rounding, Mode)` | `NEAREST` (`UP`/`DOWN`) |
| Rounding Nearest Value | `(Rounding, NearestValue)` | `100` |

REA-19: string berikut JANGAN dipakai mentah (artefak/terpotong):
`wss://dev7.esb.co.id/wss-poslite.esb.co.id/ws`,
`pos-lite-minimum-version-v2P`, `esb_api/poslite/expense-chart-of-accounts&`,
`esb-order/eso-qs/pos-void&`, `sales-expenseX`, `ms_promotionheadr`.
Tidak ada yang dipakai di kontrak ini maupun di kode lane REA-FIX-A.

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

### 5.1.1 Pola action-flag di `POST order/finish` [KONTRAK]

Satu path `order/finish` melayani mutasi pasca-penjualan selain body penuh
§5.1. Pembedanya adalah field `action` (string, wajib untuk varian ini);
server membalas envelope Yii2 §2 yang sama
(`{name,message,code,status,success,data}`). Setiap varian SELALU dicatat
ke outbox fisik (`enqueueOutbox('tr_saleshead', no, 'update')`) + antrean
sync (`enqueueSync('order', {action, ...})`) agar aman offline, lalu
`apiFetch` ke `ApiPath.pushOrderFinish` bila online (offline: terkirim via
push berikutnya).

**a) Void — `{action:"void", no, reason}`**

Request (`no` = nomor penjualan; `salesNum` boleh dikirim sebagai alias
kompatibilitas; `voidLines[]` opsional untuk void parsial per item):

```json
{
  "action": "void",
  "no": "TRX-20261016-014",
  "salesNum": "TRX-20261016-014",
  "reason": "Pesanan salah input",
  "voidLines": [{ "id": "M001", "qty": 1 }]
}
```

Respons:

```json
{
  "name": "OK",
  "message": "Order dibatalkan",
  "code": 0,
  "status": 200,
  "success": true,
  "data": {
    "no": "TRX-20261016-014",
    "salesNum": "TRX-20261016-014",
    "status": "void",
    "receivedAt": "2026-10-16 12:41:10",
    "syncDate": "2026-10-16 12:41:10"
  }
}
```

Pemanggil: `persistVoidDb()` (`src/lib/history.ts`, void penuh),
`persistVoid()` (`src/screens/bill/CancelScreen.tsx`, void parsial +
otorisasi supervisor via `authorizeSupervisor`), `doVoid`/`doVoidAndPrint`
(`src/screens/history/HistoryScreen.tsx`, PIN supervisor wajib).
Dummy: `src/data/dummy/push/order-void.json` (alias katalog `order/void`).

**b) Ganti metode bayar — `{action:"change-payment", no, method}`**

Request (`method` salah satu `Tunai|QRIS|EDC|Debit|Kredit|Transfer`):

```json
{
  "action": "change-payment",
  "no": "TRX-20261016-014",
  "salesNum": "TRX-20261016-014",
  "method": "QRIS"
}
```

Respons:

```json
{
  "name": "OK",
  "message": "Metode bayar diperbarui",
  "code": 0,
  "status": 200,
  "success": true,
  "data": {
    "no": "TRX-20261016-014",
    "salesNum": "TRX-20261016-014",
    "paymentMethod": "QRIS",
    "grandTotal": 60400,
    "receivedAt": "2026-10-16 12:42:20",
    "syncDate": "2026-10-16 12:42:20"
  }
}
```

Pemanggil: `persistPayChangeDb()` (`src/lib/history.ts`).
Dummy: `src/data/dummy/push/order-change-payment.json`
(alias katalog `order/change-payment`).

**c) Status order ESB — `{action:"esb-accept"|"esb-done"|"esb-reject", no, status}`**

Dipakai `persistEsbStatus()` (`src/screens/history/EsbOrderScreen.tsx`):
`Diproses → esb-accept`, `Selesai → esb-done`, penolakan → `esb-reject`
(+ `reason` wajib untuk reject). Body:
`{action, no, status, ...(reason ? {reason} : {})}`; respons envelope
`data: {no, status, receivedAt, syncDate}`.

**d) Status tiket dapur — `{action:"kitchen-advance"|"kitchen-status", ...}`**

Kontrak pemajuan tiket (`Baru → Diproses → Selesai`): body
`{action:"kitchen-advance", ticketNo, status}` atau
`{action:"kitchen-status", ticketNo, status}`; respons envelope
`data: {ticketNo, status, receivedAt, syncDate}`. Implementasi kini
(`persistKitchenStatus` di `src/screens/history/KitchenScreen.tsx`)
menyimpan lokal + outbox fisik dulu (offline-first); POST action-flag
menyusul saat wiring online diaktifkan.

**e) Registrasi member — BUKAN `order/finish`**

`member-register` adalah `kind` antrean sync (`enqueueSync('other',
{kind:'member-register', memberId, nama, noHp})`), sedangkan POST-nya ke
`erp/member` (`{memberId, name, phone}` → `{memberId, name, ok:true}`,
lihat §5.5), bukan ke `order/finish`. Pemanggil: `persistMember()`
(`src/screens/member/MemberScreen.tsx`).

### 5.2 Endpoint push lain

| Endpoint | Payload inti |
|---|---|
| `POST order/split-bill` | `{parentSalesNum, bills:[{…seperti finish…}]}` |
| `POST order/move-items` | `{fromSalesNum, toTableNo, itemIds[]}` |
| `POST order/move-table` | `{salesNum, fromTableNo, toTableNo}` |
| `POST order/view` | `{salesNum}` → detail (untuk load-order lintas terminal) |
| `POST posv1/order/view-by-qr` [FAKTA] | `{qrCode, branchId}` → detail seperti `order/view` + `qrCode` |
| `POST posv1/order/view-quick-service` [FAKTA] | `{queueNumber, branchId}` → detail order quick-service + `queueNumber` |
| `POST posv1/order/pos-error-log` [FAKTA] | `{terminalId, branchId, errorCode, errorMessage, salesNum?}` → `{ok, logId}` |
| `POST v1/push/shift` [FAKTA] | buka: `{op:'shift-open', userId, terminalId, startCash}` / tutup: `{op:'shift-close', shiftId, endCash, expectedCash}` (satu path, beda `op`) |
| `POST v1/push/branch-expenses` [FAKTA] | `{date, coaId, amount, note, photoUrl?}` |
| `POST member-deposit-withdrawal/inquiry-deposit` | `{memberId}` → `{saldo, poin}` |
| `POST member-deposit-withdrawal/topup` [asumsi-clean-room] | `{memberId, amount, paymentMethod}` |
| `POST sales/receipt-email` | `{salesNum, email}` |

### 5.3 Voucher online (lock/burn agar tidak dipakai 2x)

```
POST posv1/esb-voucher/validate {code, grandTotal} → {valid, amount}
POST posv1/esb-voucher/lock     {code, salesNum}   → {locked:true}
POST posv1/esb-voucher/unlock   {code, salesNum}   → {ok:true}   (batal bayar)
POST posv1/esb-voucher/burn     {code, salesNum}   → {ok:true}   (lunas)
```

### 5.4 Voucher online + eksternal (REA-6/REA-7)

```
POST esb_api/external-voucher/validate {code, grandTotal?} → {valid, amount, source:'external'}
POST esb_api/external-voucher/burn     {code, salesNum}    → {burned:true, amount}
POST esb_api/external-voucher/unburn   {code, salesNum}    → {unburned:true, amount}
POST esb_api/voucher/validate-online-voucher-pos-payment {code, grandTotal} → {valid, amount}
POST esb_api/voucher/claim-online-voucher-pos-payment    {code, salesNum}   → {claimed:true, amount}
POST esb_api/voucher/claim-voucher-template {templateId, salesNum} → {code, claimed:true, amount}
```

Helper siap di `src/lib/apiSource.ts`: `validateOnlineVoucher()`,
`claimOnlineVoucher()`, `externalVoucher(op)`.
TODO(pemilik layar VoucherScreen): panggil helper ini untuk alur
claim/unburn online (wiring UI bukan lane REA-FIX-A).

### 5.5 Member via erp/member/* (REA-3)

```
POST erp/member                 {memberId, name, phone}                              → {memberId, name, ok:true} (register; sub-path pasti asumsi-clean-room)
POST erp/member/balance-deposit {memberId, branchId}                                 → {saldo, poin}
POST erp/member/deposit         {memberId, branchId, amount, paymentMethod, userId} → {amount, balanceBefore, balanceAfter, ok:true}
POST erp/member/sales           {memberId, branchId, page}                           → {totalRecords, pageCount, page, items[]}
```

Helper siap: `memberErpApi(op, body)` di `src/lib/apiSource.ts`.
TODO(pemilik layar Member/TopupDeposit): alihkan inquiry/topup/register
ke helper ini. Catatan: `erp/steroid/find` (REA-4) belum dipetakan,
butuh riset biner lanjutan.

### 5.6 Delivery erp/ezo-delivery/* (REA-2)

```
POST erp/ezo-delivery/approve          {bookingId, branchId, userId}      → {approved:true, status}
POST erp/ezo-delivery/create-booking   {orderId, branchId, courier, slot} → {bookingId, status:'BOOKED'}
POST erp/ezo-delivery/finish-by-outlet {bookingId, branchId, userId}      → {finished:true, status}
POST erp/ezo-delivery/push-data        {orderId, customerName, address, items[], subtotal, discount, tax, serviceCharge, ongkir, grandTotal} → {received:true, status}
POST erp/ezo-delivery/schedule-order   {orderId, branchId, slot}          → {scheduleId, status:'SCHEDULED'}
POST erp/ezo-delivery/search-ongoing   {branchId, page}                   → {totalRecords, pageCount, page, items[]}
POST erp/ezo-delivery/search-outstanding {branchId, page}                 → {totalRecords, pageCount, page, items[]}
```

Helper siap: `deliveryApi(op, body)` di `src/lib/apiSource.ts`.
TODO(pemilik layar EsbOrder/dashboard delivery, batch lain): bangun UI
di atas helper ini. Angka contoh ikut rumus §10.3
(`tax = round(net * 11 / 111)`).

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
`src/lib/realtime.ts`). Guard custom-only TIDAK diubah (S5).

URL per env [FAKTA] (REA-13):

| Env | Device channel | Self-order channel |
|---|---|---|
| prod | `wss://ws-poslite.esb.co.id/ws` | `wss://…/wss-self-order` |
| dev7 | (device, path sama) | `wss://dev7.esb.co.id/wss-self-order` |
| qa7 | (device, path sama) | `wss://qa7.esb.co.id/wss-self-order` |
| stg-eso | (device, path sama) | `wss://stg-eso.esb.co.id/wss-self-order` |
| emulator | `ws://10.0.2.2:8082/ws` | - |

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
  `ms_setting(Tax, PPN)` (info-only, inklusif, lih. rumus §10.3). Pembulatan: `rounding` = selisih ke kelipatan
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
- `src/data/dummy/pull/` - `main-get-branch-settings` (13 baris, termasuk
  8 kunci REA-14 di §4.3), `main-get-menu`,
  `main-get-branch-menu`, `main-get-user`, `main-get-table`,
  `main-get-promotion`, `main-get-voucher`, `main-get-member`,
  `main-get-sales`, `v1-pull-get-menu-online`,
  `v1-pull-expense-chart-of-accounts`, `esb-api-pull-pull-pos-version`,
  `esb-api-pull-pull-station-data`, `esb-api-pull-pull-terminal-settings`,
  `esb-api-main-get-shift-log-data`,
  `esb-apiv11-main-get-terminal-settings`,
  `esb-apiv9-terminal-verification-notify`,
  `main-get-payment-method` ([asumsi-clean-room]), `terminal-get-terminal`,
  `terminal-update`
- `src/data/dummy/push/` - `order-finish` (angka persis contoh §5.1:
  subtotal 70000, discount 2500, tax 5698, voucher 10000, rounding 25,
  grandTotal 60400, paid 100000, change 39600), `order-void`
  (action-flag void §5.1.1a, alias katalog `order/void`),
  `order-change-payment` (action-flag change-payment §5.1.1b, alias katalog
  `order/change-payment`), `order-split-bill`,
  `order-move-items`, `order-move-table`, `order-view`,
  `posv1-order-view-by-qr`, `posv1-order-view-quick-service`,
  `posv1-order-pos-error-log`, `v1-push-shift` (satu file untuk
  `shift-open` + `shift-close`: respons superset, bedakan via `body.op`),
  `v1-push-branch-expenses`,
  `member-deposit-withdrawal-inquiry-deposit`,
  `member-deposit-withdrawal-topup` ([asumsi-clean-room]),
  `sales-receipt-email`,
  `posv1-esb-voucher-validate/lock/unlock/burn`,
  `esb-api-external-voucher-validate/burn/unburn`,
  `esb-api-voucher-validate-online-voucher-pos-payment`,
  `esb-api-voucher-claim-online-voucher-pos-payment`,
  `esb-api-voucher-claim-voucher-template`,
  `erp-member` (+ `erp-member-balance-deposit/deposit/sales`),
  `erp-ezo-delivery-approve/create-booking/finish-by-outlet/push-data/schedule-order/search-ongoing/search-outstanding`,
  `auth-cashier-login` ([asumsi-clean-room]),
  `auth-supervisor-approve` ([asumsi-clean-room]),
  `device-register-push` ([asumsi-clean-room])
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

---

## 11. Temuan REA-FIX-A (REAA-x) + TODO wiring pemilik layar

- REAA-1: `order-finish.json` / `order-view.json` lama memakai tax 5698
  untuk net 67500, tidak cocok rumus §10.3 (harusnya 6691). Dibiarkan apa
  adanya agar contoh §5.1 tetap konsisten; semua dummy BARU memakai angka
  kanonis §10.3 (cek: 66000→6541, 50000→4955, 45000→4459).
- REAA-2: kunci katalog lama `esb_api/pull/pos-version` adalah tebakan
  tanpa padanan; nama konkret APK adalah `pull-pos-version` (REA-12),
  sudah dikoreksi di `ApiPath.pullPosVersion` + katalog dummy.
- REAA-3: nama header §2 (`X-Terminal-Code`/`X-Branch-Id`) berbeda dari
  draf kontrak lama (`X-Terminal-Key`/`X-Terminal-Id`/`X-Device-Id`);
  diselaraskan ke kode (`apiGet`/`apiPost`) dan diberi status
  `asumsi-clean-room` (REA-18).
- REAA-4: `pushShiftOpen` dan `pushShiftClose` kini bernilai sama
  (`v1/push/shift`); pembeda open/close adalah `body.op` + field
  (`startCash` vs `endCash`). Antrean `sync.ts` (`pathFor`) tetap
  membedakan via `payload.op`, jadi tidak ada perubahan layar.
- REA-16/REA-17: konstanta siap di `src/lib/master.ts` (`QRIS_ACQUIRERS`
  9 acquirer, `NATIVE_PREF_KEYS` 7 kunci prefs) + key i18n `qris_acq_*`.
  TODO(pemilik layar QrisScreen): pakai untuk label metode bayar.
  TODO(pemilik layar PrintersScreen/EdcScreen): pakai untuk modul
  EDC/printer native.

TODO wiring (bukan lane REA-FIX-A, helper sudah siap di `apiSource.ts`):

| Helper | Pemilik layar |
|---|---|
| `validateOnlineVoucher`, `claimOnlineVoucher`, `externalVoucher` | VoucherScreen |
| `deliveryApi` (7 op) | EsbOrder / dashboard delivery |
| `memberErpApi` (3 op) | MemberScreen / TopupDepositScreen |
| `fetchPosVersion`, `notifyTerminalVerification` | Install / Settings / Sync |
| `QRIS_ACQUIRERS` + `qris_acq_*` | QrisScreen |
| `NATIVE_PREF_KEYS` | PrintersScreen / EdcScreen |

