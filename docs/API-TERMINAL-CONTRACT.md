# Kontrak API Terminal — Genfity Order App ↔ Backend (BE)

Dokumen ini adalah acuan membangun backend sendiri untuk **multi-terminal,
multi-layar**: 1 cabang punya N terminal, 1 perangkat = 1 terminal + 1 peran
(KASIR / DAPUR / DISPLAY). Sisi aplikasi sudah diimplementasikan penuh;
BE tinggal mengimplementasikan endpoint + fan-out WS di bawah.

Acuan umum (host, envelope Yii2, header, kode error) tetap di
[`API-CONTRACT.md`](API-CONTRACT.md) §1–§2 dan tidak diulang, kecuali yang
spesifik terminal di sini.

Legenda: **[FAKTA]** = path/event sudah ada di aplikasi. **[KONTRAK]** =
ditetapkan dokumen ini, implementasikan persis.

---

## 0. Model data terminal (BE)

- Satu `branchId` punya banyak terminal (`terminalCode` unik per cabang).
- Satu perangkat memegang tepat satu `{ terminalCode, branchId, branchName }`
  + satu peran perangkat (`deviceRole`: `KASIR` | `DAPUR` | `DISPLAY`).
- Peran adalah **kunci sisi aplikasi** (navigasi/drawer dikunci di
  `src/lib/deviceRole.ts`); server menetapkan peran awal lewat setting
  per terminal `deviceRole` (§3), dan boleh menolak request yang tak sesuai
  peran (mis. `order/finish` dari `DISPLAY`) dengan `E422`.

---

## 1. Klaim terminal (sama seperti kontrak utama §3)

| Endpoint | Body | Data |
|---|---|---|
| `POST /pos/install` [FAKTA] | `{deviceID}` | `{terminalKey, terminalId, terminalCode, branchId, branchName, claimed}` |
| `POST /main/validate-terminal` [FAKTA] | `{terminalCode, deviceID}` | `{valid, branchId, branchName}` |
| `POST /main/check-branch-status` [FAKTA] | `{branchId}` | `{status: active\|inactive\|expired}` |
| `POST /terminal/get-terminal` [FAKTA] | `{terminalCode, branchId}` | `{terminalCode, branchId, branchName, deviceRole?, verified}` |
| `POST /terminal/update` [FAKTA path] | `{terminalCode, branchId, settings: {key: value}}` [KONTRAK body] | `{ok: true}` |
| `POST /esb_apiv9/terminal/verification-notify` [FAKTA] | `{terminalCode, branchId, deviceID, status}` | `{ok, verifiedAt}` |

Setelah klaim berhasil, aplikasi memanggil `syncTerminalSettings()`
(`src/lib/terminal.ts`) — yaitu pull §3 — sehingga printer default,
auto-print dapur, footer struk, dan peran mengikuti server tanpa setting
manual per tablet.

---

## 2. Header & envelope (ringkas, detail di `API-CONTRACT.md` §2)

- Semua request `POST`, `Content-Type: application/json`.
- Header: `X-Terminal-Code`, `X-Branch-Id`, `Idempotency-Key` (push),
  `Authorization: Bearer <authKey>` (bila ada).
- Envelope sukses Yii2 `{name, message, code: 0, status: 200, success: true, data}`.
- Error: `success: false` + `code` string (`E401` terminal dicabut → aplikasi
  kembali ke klaim; `E422` validasi; `E409` data basi; `E00043`/`E00044` sync).

---

## 3. Setting per terminal — `POST esb_api/pull/pull-terminal-settings` [FAKTA]

Body pull standar: `{branchId, terminalId, lastSyncDate, page}`.
Respons `data.items[]`:

```json
{ "terminalId": "T001", "settingKey": "deviceRole", "settingValue": "DAPUR",
  "flag": 1, "lastSyncDate": "2026-10-16 08:00:00" }
```

- Baris `flag: 0` diabaikan aplikasi.
- Server menang: nilai pull menimpa setting lokal.

| `settingKey` [KONTRAK] | `settingValue` | Efek di aplikasi |
|---|---|---|
| `deviceRole` | `KASIR` \| `DAPUR` \| `DISPLAY` | Kunci navigasi/drawer perangkat; rute awal ikut peran (§6) |
| `autoPrintKitchen` | `1` / `0` | Switch auto-print di Pengaturan; `1` = tiket push langsung dicetak di perangkat DAPUR |
| `printerDefault` | id station, mis. `ST-KASIR` | Tandai default di daftar station lokal (alamat BT/LAN tetap milik perangkat, tak dikirim server) |
| `receiptFooter` | teks bebas | Footer struk (`getReceiptFooter()`) |

Kunci tak dikenal tetap tersimpan di `ms_terminalsetting` dan diabaikan —
aman menambah kunci baru tanpa update aplikasi.

---

## 4. Event WS device channel (server → aplikasi)

Channel: `WS_URL` (device) sesuai kontrak utama §7; heartbeat `PING` 30 dtk
dengan `terminal` di payload (lihat `src/lib/display.ts`, `src/lib/realtime.ts`).
Semua event di bawah difan-out **per `branchId`**, hanya ke terminal yang
membutuhkan (dapur/display), bukan broadcast global.

> Catatan keamanan (aturan repo): aplikasi hanya dial WS ke server milik
> sendiri (env Custom). Di env bawaan, push tak mengalir dan perangkat
> dapur/display hanya mencerminkan data lokal — pindahkan BE ke Custom
> agar fan-out §4.1–§4.2 jalan.

### 4.1 `KITCHEN_TICKET` [KONTRAK] — kasir/server → perangkat DAPUR

Wajib dikirim server setiap ada order baru / item baru untuk dapur
(agar tiket lahir di layar dapur walau beda perangkat dengan kasir):

```json
{ "type": "KITCHEN_TICKET", "payload": {
    "ticketId": "kt-20261017-0007",
    "ticketNo": "A-007",
    "salesNum": "20261017-0007",
    "table": "M3",
    "mode": "DINE_IN",
    "time": "14:02",
    "status": "Baru",
    "stationId": "ST-DAPUR",
    "items": [
      { "name": "Nasi Goreng Spesial", "qty": 2, "note": "Pedas" },
      { "name": "Es Teh Manis", "qty": 1 }
    ] } }
```

- `status`: `Baru` | `Diproses` | `Selesai` (selain itu = `Baru`).
- `items[]` minimal `{name, qty}`; `note` opsional; `stationId`/`station`
  menentukan printer (`Checker` bila mengandung kata "check", selainnya `Dapur`).
- Aplikasi: simpan sebagai cache lokal bertanda sync (tanpa outbox —
  kasir pemilik order yang push), tampilkan di `KitchenScreen`, notifikasi
  lokal, dan **auto-print** bila peran = DAPUR dan `autoPrintKitchen = 1`.

### 4.2 `DISPLAY_ORDER` [KONTRAK] — kasir/server → perangkat DISPLAY

Wajib dikirim setiap cart/order berjalan berubah (item/qty/total) dan saat
status berubah (`preparing` → `ready` → `paid`):

```json
{ "type": "DISPLAY_ORDER", "payload": {
    "ticket": "A-007",
    "status": "preparing",
    "total": 58000,
    "items": [
      { "name": "Nasi Goreng Spesial", "qty": 2, "price": 25000 },
      { "name": "Es Teh Manis", "qty": 1, "price": 8000 }
    ] } }
```

Aplikasi (`CustomerDisplayScreen`): antrean + rincian + total berjalan
mengikuti kasir; event lokal `call`/`ready` tetap dipakai untuk panggil nomor.

### 4.3 Event lama (kontrak utama §7, tidak berubah)

`NEW_SELF_ORDER`, `MENU_SOLDOUT`, `ORDER_STATUS`, `SELF_ORDER_PAID`,
`SHIFT_NOTICE`, `FORCE_PULL {domains}` — tetap didukung; `FORCE_PULL`
bisa memakai `domains: ["terminalsettings"]` untuk memaksa tarik §3.

---

## 5. Event display lokal (antar-layar satu perangkat)

`call {ticket}` dan `ready {ticket}` disiarkan lokal via bus display dan
best-effort ke WS (`src/lib/display.ts`). Server cukup meneruskan frame
`{type: 'call'|'ready'|'order', ticket, ...}` apa adanya ke terminal DISPLAY
satu cabang bila topologinya kasir → server → display. Nama server
`DISPLAY_ORDER` (§4.2) juga diterima dan dipetakan otomatis ke event `order`
oleh aplikasi — BE bebas memakai salah satu.

---

## 6. Peran perangkat (semantik kunci sisi aplikasi)

| Peran | Rute awal | Rute diizinkan |
|---|---|---|
| `KASIR` (default) | `Dashboard` (atau `Shift` bila shift tertutup) | semua (tanpa batas, perilaku lama) |
| `DAPUR` | `Kitchen` | `Kitchen`, `Printers`, `Receipt` (cetak ulang) + utilitas |
| `DISPLAY` | `CustomerDisplay` | `CustomerDisplay`, `Idle` + utilitas |

Utilitas = `Settings`, `QrScan` (klaim via QR), `Sync`, `Log`, `About`,
`Help`, `Login` — selalu lolos agar perangkat terkunci tetap bisa diklaim
dan didiagnosis; layar transaksi selain di atas dikunci.

- Drawer dikunci ke menu peran + Pengaturan (agar peran bisa dikembalikan).
- Rute di luar peran (mis. deep-link sisa sesi) di-reset paksa ke beranda peran.
- Ganti peran manual di Pengaturan → Terminal → Peran perangkat (butuh hak
  akses edit pengaturan seperti biasa); pull §3 berikutnya bisa menimpa
  dengan nilai server.

---

## 7. Checklist implementasi BE (beda repo)

1. [ ] `terminal/get-terminal` kembalikan `deviceRole` + `verified`.
2. [ ] `terminal/update` terima `{settings}` (opsional, untuk tulis balik).
3. [ ] `pull-terminal-settings` layani 4 kunci §3 per `terminalId`.
4. [ ] Saat `order/finish` (atau new-order kasir): fan-out `KITCHEN_TICKET`
      ke terminal DAPUR + `DISPLAY_ORDER` ke terminal DISPLAY satu `branchId`.
5. [ ] Saat cart berubah / status order berubah: fan-out `DISPLAY_ORDER`.
6. [ ] `FORCE_PULL {domains: ["terminalsettings"]}` setelah admin ubah
      setting terminal agar tablet langsung menarik.
7. [ ] (Opsional) Tolak `order/finish` dari peran `DISPLAY` dengan `E422`.

Contoh fan-out minimal (pseudo):

```
on OrderFinished(order):
  branch = order.branchId
  ws.send(to=terminals(branch, role=DAPUR), KITCHEN_TICKET {…order…})
  ws.send(to=terminals(branch, role=DISPLAY), DISPLAY_ORDER {…order…})
on TerminalSettingsChanged(terminalId):
  ws.send(to=terminal(terminalId), FORCE_PULL {domains: ["terminalsettings"]})
```
