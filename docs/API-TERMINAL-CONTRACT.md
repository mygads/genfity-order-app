# Kontrak API Terminal — Genfity Order App ↔ Backend (BE)

Dokumen ini adalah acuan membangun backend sendiri untuk **multi-terminal,
multi-layar**: 1 cabang punya N terminal, 1 perangkat = 1 terminal + 1 peran
(KASIR / DAPUR / DISPLAY). Sisi aplikasi sudah diimplementasikan penuh;
BE tinggal mengimplementasikan endpoint + fan-out WS di bawah.

Acuan umum (host, envelope Yii2, header, kode error) tetap di
[`API-CONTRACT.md`](API-CONTRACT.md) §1–§2 dan tidak diulang, kecuali yang
spesifik terminal di sini.

> **Status 2026-10-17 — otoritas kanonis**: alur sesi terminal (bind →
> login → kick), kosakata tag, tabel endpoint E01–E28, format identitas
> sale (Q7), dan kebijakan grant offline (Q6) dikunci di
> [`SPEC-TERMINAL-SESSION.md`](SPEC-TERMINAL-SESSION.md) (turunan dari
> [`AUDIT-TERMINAL-RBAC.md`](AUDIT-TERMINAL-RBAC.md) §7–§12). Bila ada
> bagian §0–§7 di bawah yang bertentangan dengan SPEC (mis. `deviceRole`
> 3-nilai vs 5 tag, nav-lock DAPUR/DISPLAY), **SPEC yang menang**; §8–§10
> dokumen ini merangkum nilai finalnya. Status 2026-10-17 (terverifikasi grep `src/` + probe BE live): E01 = terminal-login **SINGLE-STAGE** (sesi penuh langsung; arah 2-tahap `credentialOk/requiresPin` + `staffPin` tahap-2 DICABUT 2026-10-17 — riwayat salah arah di SPEC §14). SUDAH wired app-side: `LoginScreen` mengunci sesi dari respons pertama + gerbang PIN **lokal** (`passesLocalWorkforcePin`; `staffPin` tak pernah dikirim — server abaikan field tak dikenal) + notice `kicked_msg` untuk `tookOver{kickedUserId}` ke user baru; fixture `terminal-login.json`, `terminal-bind.json` ada. Kick: TAK ADA frame `SESSION_KICKED` push sisi server — device lama deteksi via event `takeover` SSE terminal + pencocokan pola kick/takeover sisi-klien (401 = gagal auth final → re-login, BUKAN bukti kick; koreksi 2026-10-17 atas arah 401-guard yang salah). Yang BE-pending: fan-out WS/SSE sisi server (rincian per endpoint di §10). Fixture dummy §10 tetap acuan sampai BE siap.

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

> **LEGACY (DG1 — SPEC menang)**: `deviceRole` 3-nilai di §0–§7 adalah model
> lama — digantikan 5 tag kanonis (`kasir | dapur | view_pelanggan |
> view_queue | full_access`, SPEC §1; nilai final §8). Bila bertentangan,
> SPEC menang. Server tetap boleh mengirim `deviceRole` sebagai alias, tetapi
> bila `terminalTag` ada maka tag yang menang. Jangan membangun fitur baru di
> atas `deviceRole`.

---

## 1. Klaim terminal (sama seperti kontrak utama §3)

| Endpoint | Body | Data |
|---|---|---|
| `POST /pos/install` PLANNED/UNWIRED (2026-10-17: tanpa pemanggil di `src/`, hanya registrasi dummy) | `{deviceID}` | `{terminalKey, terminalId, terminalCode, branchId, branchName, claimed}` |
| `POST /main/validate-terminal` [FAKTA] | `{terminalCode, deviceID}` | `{valid, branchId, branchName}` |
| `POST /main/check-branch-status` PLANNED/UNWIRED (2026-10-17: helper `checkBranch` tanpa pemanggil layar) | `{branchId}` | `{status: active\|inactive\|expired}` |
| `POST /terminal/get-terminal` PLANNED/UNWIRED (2026-10-17: tanpa pemanggil di `src/`, hanya registrasi dummy) | `{terminalCode, branchId}` | `{terminalCode, branchId, branchName, deviceRole?, verified}` |
| `POST /terminal/update` PLANNED/UNWIRED (2026-10-17: tanpa pemanggil di `src/`, hanya registrasi dummy) | `{terminalCode, branchId, settings: {key: value}}` [KONTRAK body] | `{ok: true}` |
| `POST /esb_apiv9/terminal/verification-notify` [FAKTA] | `{terminalCode, branchId, deviceID, status}` | `{ok, verifiedAt}` |

Setelah klaim berhasil, aplikasi memanggil `syncTerminalSettings()`
(`src/lib/terminal.ts`) — yaitu pull §3 — sehingga printer default,
auto-print dapur, footer struk, dan peran mengikuti server tanpa setting
manual per tablet.

> Status klaim 2026-10-17 (terverifikasi grep `src/`): WIRED app-side = `validateTerminal` (`apiSource.ts`, dipanggil `InstallScreen`), `verification-notify` (`apiSource.ts`, dipanggil InstallScreen/SyncScreen/SettingsScreen), dan flow bind B1 baru (`fetchBranches`/`fetchTerminals`/`bindTerminal` — InstallScreen + TerminalPinScreen + TerminalPickerScreen). PLANNED/UNWIRED = `pos/install`, `terminal/get-terminal`, `terminal/update` (hanya registrasi dummy `apiSource.ts`, nol pemanggil), helper `checkBranch`/`claimTerminal`/`terminalLogin` (definisi tanpa pemanggil layar). Jangan tambah konsumen baru ke jalur legacy.

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
| `deviceRole` | `KASIR` \| `DAPUR` \| `DISPLAY` | LEGACY (alias; §6 digantikan SPEC §10) — kunci navigasi/drawer lama; `terminalTag` menang bila ada |
| `terminalTag` | `kasir` \| `dapur` \| `view_pelanggan` \| `view_queue` \| `full_access` | **Server-wins** (DG7): menang atas `deviceRole` bila ada; kunci navigasi/drawer ikut SPEC §10 |
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

> **Pemetaan peran→tag (SPEC menang)**: filter `role=DAPUR` di §4.1 dibaca
> sebagai tag `dapur` + `full_access`; `role=DISPLAY` di §4.2 sebagai
> `view_pelanggan` + `view_queue` (rinci per event di §8).

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

## 6. Peran perangkat (semantik kunci sisi aplikasi) — LEGACY, digantikan SPEC §10

> **LEGACY (DG1 — SPEC §10 menang)**: tabel 3-nilai di bawah digantikan
> matriks navigasi per tag — `kasir`/`dapur`/`full_access` drawer penuh
> (nav-lock DAPUR/DISPLAY dicabut); `view_pelanggan` sidebar HANYA
> CustomerView; `view_queue` sidebar HANYA QueueView. Tabel lama
> dipertahankan agar diff terbaca — jangan dipakai untuk fitur baru.

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

1. [ ] `terminal/get-terminal` kembalikan `tag` (+ `deviceRole` sebagai alias legacy) + `verified` + pairing.
2. [ ] `terminal/update` terima `{settings}` (opsional, untuk tulis balik).
3. [ ] `pull-terminal-settings` layani 5 kunci §3 per `terminalId` (`terminalTag` + alias legacy `deviceRole` + 3 operasional).
4. [ ] Saat `order/finish` (atau new-order kasir): fan-out `KITCHEN_TICKET`
      ke terminal DAPUR + `DISPLAY_ORDER` ke terminal DISPLAY satu `branchId`.
5. [ ] Saat cart berubah / status order berubah: fan-out `DISPLAY_ORDER`.
6. [ ] `FORCE_PULL {domains: ["terminalsettings"]}` setelah admin ubah
      setting terminal agar tablet langsung menarik.
7. [ ] (Opsional) Tolak `order/finish` dari tag view (`view_pelanggan`/`view_queue`) dengan `E422`.

Contoh fan-out minimal (pseudo):

```
on OrderFinished(order):
  branch = order.branchId
  ws.send(to=terminals(branch, role=DAPUR), KITCHEN_TICKET {…order…})
  ws.send(to=terminals(branch, role=DISPLAY), DISPLAY_ORDER {…order…})
on TerminalSettingsChanged(terminalId):
  ws.send(to=terminal(terminalId), FORCE_PULL {domains: ["terminalsettings"]})
```

---

## 8. Kosakata tag kanonis — 5 tag (SPEC §1, Q1 CLOSED)

Nilai `tag` selalu terisi satu dari 5 nilai (parse case-insensitive,
simpan lowercase). Label "Full Access" untuk `full_access`.

| Tag | Fitur app | Event yang diterima | Navigasi |
|---|---|---|---|
| `kasir` | penuh | `online-order-incoming` | drawer penuh |
| `dapur` | penuh (Q5: sama dengan kasir, beda hanya notifikasi/event) | `kitchen-incoming` / `order-accepted` | drawer penuh |
| `view_pelanggan` | halaman customer view terkunci (cart + QR bayar) | `cart-view` / `payment-qr` (scope kasir pasangan 1:1) | sidebar HANYA CustomerView; tanpa Settings/role-switch/cashier-entry/kontrol operator; keluar hanya via aksi owner terautentikasi |
| `view_queue` | halaman antrean terkunci (terikat branch, bukan kasir) | `queue-update` / `call` / `ready` (scope branch) | sidebar HANYA QueueView |
| `full_access` | penuh (semua fitur kecuali halaman view pelanggan) | KEDUANYA (order-online-masuk DAN kitchen-incoming) | drawer penuh |

- Respons login (`terminal-login` E01 — body selalu membawa
  `terminalCode`+`deviceId`) dan respons terminal (get-terminal,
  daftar terminal per branch) **selalu membawa `tag`** + pairing
  (`pairedKasirId` / `pairedViewId`, `myKasir` / `myView`).
- **Server-wins tag (DG7)**: tag efektif selalu nilai server
  (`terminalTag` via pull-terminal-settings / E13); nilai lokal hanya
  fallback tampilan dan wajib ditimpa saat pull berikutnya berhasil.
- Kunci `pull-terminal-settings` membawa `terminalTag` (server-wins);
  bila ada, ia menang atas `deviceRole` lama.
- Kompatibilitas: `deviceRole` `KASIR|DAPUR|DISPLAY` di §0–§7 adalah
  model legacy. Terminal legacy tanpa tag diperlakukan sebagai
  `full_access` (fallback baca sisi klien, konsisten dengan perilaku
  default-terbuka hari ini). `PATCH /api/v1/terminals/{id}/tag`
  menerima 5 nilai (E13).

## 9. Ringkasan flow B1 / L1 / R1 / K1 / O1 (SPEC §3–§7)

- **B1 — Bind fresh device (sekali)**: Welcome-Unbound → BranchPicker
  (`E07`) → TerminalPicker (`E09`) → PIN terminal (`E03` atomik
  verify+bind — verifikasi + tulis binding satu transaksi, tanpa
  tulis-parsial) → Bound (simpan binding, tampilkan sapaan
  "Selamat datang di {merchant} — {terminal}") → L1. Gagal (PIN salah /
  terminal terikat device lain / butuh owner) → error eksplisit,
  **fail-closed**, tanpa fallback diam-diam. **Dilarang** menulis store
  binding manual / menyuntik binding dummy — binding hanya lahir dari
  `E03` sukses.
- **L1 — Login di device ter-bound (per sesi, SINGLE-STAGE — koreksi
  2026-10-17)**: form username+password → `E01 terminal-login`
  (`{username,password,terminalCode,deviceId}` → LANGSUNG sesi penuh:
  session + JWT pair + tag + branches + terminals + grant + `tookOver?`)
  → modal PIN staff (**VERIFIKASI LOKAL** — server tak pernah memverifikasi
  PIN staff; `staffPin` bukan bagian kontrak, E02 validate-pin = PIN
  terminal) → session. Arah lama 2-tahap (`credentialOk/requiresPin` tahap-1
  + `staffPin` tahap-2 yang "diverifikasi server") DICABUT — riwayat di
  SPEC §14. **Login pertama wajib online** (tanpa grant bawaan).
  Offline: lewati `E01`, cek grant cache (triple user+terminal+device
  cocok, belum expiry) + cocokkan PIN staff ke hash → session lokal
  `offline:true`. PIN terminal **tidak** dipakai saat login.
- **R1 — Re-bind / keluar branch**: tombol kecil di bawah sapaan login
  screen ter-bound + tombol di Settings. Otorisasi: PIN terminal tujuan
  (wajib); perlu owner atau tidak = **Q14 TERBUKA** (usulan default: PIN
  terminal cukup; binding lama otomatis dicabut + notifikasi ke device
  lama bila reachable). Efek: binding lama dicabut (`E04`), grant cache
  lama dihapus, session aktif di-logout-dulu, lanjut picker B1 (branch
  boleh beda). Unbind+bind lewat endpoint (atomik per langkah);
  **dilarang** mengedit store binding manual.
- **K1 — Kick (baru menang; koreksi 2026-10-17 — TAK ADA frame
  `SESSION_KICKED` push sisi server)**: login sukses di terminal terisi →
  server revoke sesi lama (`reason:takeover`) + audit log + `tookOver
  {kickedUserId}` ke **device baru** (takeover terminal event). Device LAMA
  belajar via event `takeover` pada feed SSE terminalnya (tipe mengandung
  `takeover` dengan user/device event ≠ sesi/binding sendiri → notice
  `kicked_msg` + logout via watcher sesi `startTakeoverWatch` di `App.tsx`;
  401 BUKAN bukti kick — 401 = gagal auth final → re-login, karena grant
  terminal tak dibaca middleware auth dan kick tak merevoke user_sessions
  sehingga device lama tak menerima 401), dan (b) pencocokan pola
  kick/takeover sisi-klien pada pesan WS yang masuk (future-proof). Klaim lama "push
  `SESSION_KICKED` ke device lama (bila offline → antre)" DICABUT — tak ada
  frame itu sisi server. App tampilkan notifikasi takeover ke **user baru**
  (notice `kicked_msg`; jalur refetch defensif: modal konfirmasi takeover
  confirm-before-session). Konflik sesi offline diselesaikan server saat
  reconnect (baru menang). Status app-side 2026-10-17: notifikasi user
  BARU wired (respons pertama + modal takeover di `LoginScreen`);
  deteksi device LAMA WIRED dua lapis — (1) watcher sesi `startTakeoverWatch`
  di `App.tsx` atas event `takeover` SSE terminal (notice + cabut sesi+grant
  lokal); (2) `realtime.ts` `emit()` + handler `onWsMessage` di `App.tsx`
  menangani pesan kick/takeover yang cocok pola sisi-klien (logout lokal +
  Alert `kicked_msg`, semua tag; `revokeKickedSession` helper `session.ts` +
  notice + notifikasi lokal). Koreksi 2026-10-17: lapis 401-guard
  (`reportBoundTerminal401` di semua fetcher `terminalApi.ts`) DIHAPUS —
  salah diagnosis (401 kedaluwarsa token dikira kick) dan tak pernah
  menembak kick nyata.
- **O1 — Logout**: `E06` revoke server-side (anti zombie-sync); gagal
  jaringan → tandai `pendingRevoke`, coba lagi saat online. Binding +
  grant cache tetap (grant sampai expiry alami agar login ulang offline
  masih bisa). Landing: login screen ter-bound (profil view terkunci →
  display terkunci, bukan form login).

Transport per profil (SPEC §8, kebijakan §11.4 audit): `view_pelanggan`
SSE `E26` primer + API resync + poll berpenanda stale (QR/bayar
**diblokir** + banner umur data saat tidak-live); `view_queue` SSE
`E27` primer + API resync + poll berpenanda stale; `kasir`/`dapur`/
`full_access` WS dua-arah + API + auto-sync 5 mnt, SQLite offline penuh.
Aksi operator `callNext` via event server-acked (versi/nomor) agar
display se-branch tidak divergen.

## 10. Tabel endpoint E01–E28, identitas sale (Q7), grant (Q6), fixture

Tabel final E01–E28 ada di **SPEC §11** (satu-satunya acuan; tidak
didobel di sini agar tidak divergen). Ringkas status + bentuk:

- **E01** `POST /api/v1/auth/terminal-login` `{username, password,
  terminalCode, deviceId}` — **SINGLE-STAGE** (koreksi 2026-10-17, RoE live):
  satu panggilan → LANGSUNG `{session, branches[], terminals[],
  terminal{tag, pairing}, terminalAccess, grant, policy, authKey/JWT pair,
  tookOver?}`. `staffPin` BUKAN bagian kontrak (server abaikan field tak
  dikenal); gate PIN staff = verifikasi lokal app. Arah lama 2-tahap
  (`{credentialOk, requiresPin:true}` tahap-1 + `staffPin` tahap-2 yang
  "diverifikasi server") dan bentuk lama `staff-login` tanpa identitas
  terminal **DINYATAKAN DICABUT** (bukan alternatif; riwayat salah arah di
  SPEC §14). Fail-closed (RBAC terminal-access, login pertama). Status:
  kontrak dikunci ke `terminal-login` single-stage; pemanggil
  (`LoginScreen.callStaffLogin`, tanpa `staffPin`) + fixture
  (`terminal-login.json` = bentuk sukses single-stage) selaras; isi respons
  penuh mengikuti BE live.
- **E02–E06**: validate-pin E02 WIRED — helper `validateTerminalPin`
  (`terminalContract.ts`/`terminalApi.ts`) dipakai sebagai pre-check tanpa
  efek di `TerminalPinScreen` sebelum `bindTerminal` → bind atomik
  `{pin,deviceId}` (WIRED via `bindTerminal`, dipanggil
  `InstallScreen` + `TerminalPinScreen`; kick-notice
  device baru di `InstallScreen`; fixture `terminal-bind.json`
  bawa `kickedUserId`) → unbind owner E04 (WIRED app-side —
  inline `apiFetch(ApiPath.terminalUnbind)` di `SelectBranchScreen`
  dalam `exitBranch`, best-effort sebelum local clear) → occupant E05
  (PLANNED/UNWIRED — `fetchOccupant` di `terminalApi.ts` tanpa
  pemanggil) → logout revoke E06 (WIRED app-side — `logoutRevoke`
  fire-and-forget di `DrawerMenu` + `flushPendingRevokes`
  via E06 di `sync.ts`, dipanggil akhir `pushAll` sukses
  + login sukses (`LoginScreen`) +
  boot (`App.tsx`); store `pendingRevoke` wired
  di `session.ts`/`sync.ts`/`SyncScreen`).
- **E07–E22**: branches / terminals CRUD + `tag` + `set-pin` +
  pair/unpair view→kasir (BE tolak view ke-2 dengan E422) + staff CRUD
  + pemetaan staff↔branch. Status: WIRED app-side = E07
  `fetchBranches` (dipanggil `InstallScreen`) + E09
  `fetchTerminals`/`fetchBranchTerminals` (dipanggil
  `InstallScreen` + `TerminalPickerScreen`; fixture
  `branch-terminals.json`). PLANNED/UNWIRED = E08, E10–E14, E15/E16
  pair-unpair, E17–E22 staff-CRUD (hanya konstanta path di
  `server.ts`, nol pemanggil).
- **E23–E25**: approvals `{action:void|cancel|compliment, ownerPin,
  refId}` → audit owner-actions → login-qr (TBD, Q2).
  (PLANNED/UNWIRED — hanya konstanta path di `server.ts`,
  nol pemanggil; pengecualian: `pin-reset` di luar tabel dipakai
  `ForgotPinScreen` via `terminalContract.ts`.)
- **E26–E27**: SSE per terminal (`cart-view`/`payment-qr` scope kasir
  pasangan) + SSE antrean per branch (`queue-update`/`call`/`ready`,
  berversi). (Subscriber WIRED app-side: `subscribeTerminalEvents`
  dipanggil `display.ts`, `subscribeQueueEvents` dipanggil
  `QueueViewScreen`, fixture `queue-events.json`; transport
  live + auth BE-pending.)
- **E28**: policy `max_offline_grant_days` via terminal-settings
  (server-wins). (Reader WIRED app-side: `offlineGrantPolicyKey` di
  `server.ts`, dibaca `session.ts` + `LoginScreen`;
  fixture `pull-terminal-settings-v2.json`; nilai server-pending.)

**Q7 — identitas sale (CLOSED, nilai final, SPEC §12)**: PK =
`client_id` **UUIDv7** device-generated (merge/upsert/retry/outbox/
expense/doc-id satu generator; QR pembayaran membawa `client_id`,
stabil). Nomor display tersegmen
`TRX-{BRANCH}-{TERM}-{YYYYMMDD}-{NNNN}` (4-digit zero-padded,
0001–9999/hari/terminal, lanjut 5 digit bila jebol; contoh
`TRX-B001-K01-20261017-0042`; FINAL pasca-sync agar struk printed tetap
valid). Syarat BE: `terminalCode` unik per branch, ≤8 char alfanumerik
kapital; `UNIQUE(display_no)`; konflik → **409 terlihat** (bukan
silent-ignore). Counter per `(terminalCode, tanggal)` persist di
SQLite, init dari `MAX(suffix)` lokal; device belum ter-bound
**dilarang** membuat sale. Migrasi aditif (kolom + backfill; baris lama
tidak ditulis ulang; BE terima dua format selama transisi).

**Q6 — grant offline (CLOSED, nilai final, SPEC §12.2)**: TTL **7 hari
sliding** sejak otorisasi BE terakhir — sliding **hanya** diperpanjang
saat otorisasi online (login online sukses via `E01` single-stage
memperpanjang `expiresAt`); login offline (cek grant cache) **tidak**
memperpanjang, sehingga grant yang tak pernah online lagi kedaluwarsa
alami. Grant terikat `(user, terminal, device)`; PIN staff
tetap wajib tiap login offline (vs hash cache); revoke/unbind/
ganti-role ditegakkan saat online pertama. Policy key
**`max_offline_grant_days`** (default 7) via `pull-terminal-settings`
(server-wins) — BE bisa mengecilkan untuk merchant high-risk tanpa
update APK. Trade-off diterima: ganti PIN owner/staff maks 7 hari masih
bisa dipakai di device offline.

**Status wiring app-side vs BE-pending (2026-10-17, terverifikasi grep `src/`)** — baris E01–E28 di bawah tetap acuan implementasi sisi BE; yang dicatat di sini status sisi APLIKASI. Fixture dummy acuan (envelope Yii2 §2):

| Endpoint | Fixture |
|---|---|
| E01 terminal-login single-stage (user+branches+tag+pairing+grant+policy+tookOver) | `src/data/dummy/install/terminal-login.json` (bentuk sukses single-stage: sesi penuh + `tookOver:null`) |
| E03 bind atomik (binding+tag+pairing) | `src/data/dummy/install/terminal-bind.json` (`kickedUserId:null`; varian takeover menyusul) |
| E09 daftar terminal branch (5 tag + `pairedKasirId`) | `src/data/dummy/pull/branch-terminals.json` |
| E27 feed antrean branch (versi per event) | `src/data/dummy/pull/queue-events.json` (sampel `queue-update`/`call`/`ready`; transport SSE live menyusul Fase 4) |
| get-terminal diperluas (tag/pinSet/pairing/verified) | `src/data/dummy/pull/terminal-get-terminal-v2.json` (menggantikan bentuk legacy `terminal-get-terminal.json` yang tanpa tag/pairing/verified) |
| pull-terminal-settings diperluas (`terminalTag`, `max_offline_grant_days`) | `src/data/dummy/pull/pull-terminal-settings-v2.json` (kunci lama `deviceRole` dipertahankan sebagai alias legacy; `terminalTag` menang bila ada) |

Fixture legacy (`terminal-get-terminal.json`, `terminal-update.json`,
`esb-api-pull-pull-terminal-settings.json`,
`esb-employee-validate.json`, `auth-cashier-login.json`) tetap dipakai
jalur lama sampai klien Fase 1–2 bermigrasi; jangan tambah konsumen
baru ke bentuk legacy.

**Gate dummy-vs-real (DG6, fail-closed)**: fixture di atas **hanya** untuk
daftar/picker (E07 branches, E09 daftar terminal) agar UI bisa
dikembangkan sebelum BE siap. **PIN terminal, bind/unbind (E03/E04), dan
login (E01) wajib jalur real** — tidak ada PIN/bind/login dummy;
kredensial salah / terminal tak dikenal / device tak terikat = error
eksplisit tanpa fallback diam-diam.
