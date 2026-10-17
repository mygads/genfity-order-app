# Desain F1 — Login-First (fresh device → login → pilih terminal → PIN)

> **Tanggal:** 2026-10-17 · **Status:** terimplementasi (revisi dari desain awal — lihat "Divergensi dari desain awal" di bawah) · **Keputusan pengikat:** login-first, PIN hybrid lokal+server berversi, kanonis `genfity-order-app`, 1 cabang = 1 merchant (lihat `AUDIT-INTEGRASI-POS-TERMINAL.md` §8a).
> **Metode:** 3 pendekatan paralel (security-first, shift-speed-first, minimal-BE-change) dinilai juri per bagian. Hasil: endpoint + migrasi + versi-PIN ikut **security-first**, UX + grant-map ikut **shift-speed-first**. Pendekatan minimal (PIN invalidate-only tanpa verify server) **ditolak** — tidak memenuhi keputusan "server sebagai source of truth".

---

## 1. Sekuens final (screen app ↔ endpoint BE ↔ DB) — sesuai implementasi

| # | Screen (app) | Endpoint (BE) | DB / aturan |
|---|---|---|---|
| S1 | `LoginScreen` fresh-device: username+password+deviceId **saja** (tanpa terminalCode, tanpa binding gate) | `POST /api/v1/auth/terminal-login` **stage-A** (terminalCode kosong/absen, device belum bound) | Gate password / email-verified / mustChangePassword sama seperti E01 + dummy-bcrypt bila user tak dikenal; 401 generik. **Tanpa** `user_sessions`/JWT/grant/token di tahap ini — kredensial terverifikasi, tanpa sesi |
| S2 | **Picker inline di LoginScreen** (`pickA` state): chips cabang dari `branches` respons stage-A + chips terminal dari `terminals` (filter per cabang, auto-pilih bila 1) | **Nol call tambahan** — data cabang+terminal sudah di body stage-A | Auto-skip bila 1 cabang + 1 terminal (langsung tahap-B). Password fase-1 hanya di memori (`pickA`), di-nol-kan usai fase-B |
| S3 | Tahap-B (`submitPickA`): E01 lagi **dengan** `terminalCode` (+`merchantId` hasil scope + `terminalPin` bila dituntut) | `POST /api/v1/auth/terminal-login` **dengan terminalCode** (jalur E01-with-code existing, backward-compat) | Resolve `GetTerminalByCode` scope merchant bila `merchantId>0`; klien lama tanpa `merchantId` → first-match legacy. Pre-check kapasitas tag sebelum create session → 409 `TERMINAL_TAG_CONFLICT`; `terminalPin` salah/terkunci → 401/423 `PIN_REQUIRED/PIN_INVALID/PIN_LOCKED` |
| S4 | `StaffPinModal` existing: PIN-login staff (faktor 3) | **`POST /api/v1/terminals/{id}/pin-verify` (E29, sudah ada — server-side verify)** | `verifyWorkforcePIN` (bcrypt + lockout pola `verifyWorkforcePIN`) → respons `{terminalId, verified, pinVersion}`. Sukses → `completeOnline()` + `buildGrant/saveGrant` ber-tag `pinVersion` |
| S5 | Kunci sesi + notice takeover (`tookOver{kickedUserId}` tampil sekali) | — | Grant-map per-triple `userId‖terminalId‖deviceId` (ganti single-slot), envelope `{v:1, active, grants}` + migrasi sekali dari `LS_GRANT` legacy. Binding device↔terminal **persisten lintas logout** → ganti shift ≈ hanya S4 (<5 dtk, 0 ketikan) |
| S6 | Logout eksplisit | **`POST /api/v1/auth/terminal-logout` (E06 — sudah ada, closed)** | Body `{deviceId}` (app melampirkan otomatis via `getDeviceId()`); path lama `/auth/logout` di `server.ts` sudah dibetulkan |

**Sync/reconnect:** bandingkan `pinVersion` cache vs server (E29 kembalikan versi); mismatch → `clearGrant(triple)` + wajib re-login online + copy "PIN diubah manajer". Offline-login hanya via grant-map valid dan belum expired (<100 ms buka POS, badge `OFFLINE:true` + antre rekonsiliasi). **F1 fresh-device tanpa jaringan ditolak jujur** (`need_be`, tanpa fallback `DEV_BRANCHES`).

---

## 2. JSON exact (sesuai implementasi)

**E01 stage-A request** (path sama, `terminalCode` absen/kosong):
```json
{ "username": "kasir1", "password": "...", "deviceId": "9f3a..." }
```
**E01 stage-A response** (tanpa session/grant/token; **tanpa preAuth** — lihat divergensi):
```json
{ "success": true, "data": { "stage": "pick-terminal", "userId": "123",
  "branches": [{ "id": "45", "code": "PORIS", "name": "Genfity Cabang Poris" }],
  "terminals": [{ "terminalId": "78", "terminalCode": "KASIR1", "tag": "kasir", "merchantId": "45", "pinSet": true }] },
  "message": "...", "statusCode": 200 }
```

**Tanpa preAuth JWT.** Stage-A tidak menerbitkan token apa pun; tahap-B mengulang E01 dengan kredensial yang sama dari memori + `terminalCode` (+`merchantId`, +`terminalPin`). Akibatnya tidak ada scope preAuth, tidak ada TTL staged, tidak ada tabel/token staged.

**Occupant (E05):** daftar terminal stage-A memakai bentuk redacted (tanpa occupant); occupant hanya di endpoint full-auth. PIN terminal yang dituntut server dikembalikan sebagai 401/423 `PIN_REQUIRED/PIN_INVALID/PIN_LOCKED` pada tahap-B, lalu picker menampilkan field PIN (`pickPinNeeded`) dan user menekan Lanjut lagi.

**E29 pin-verify response** (ditambah `pinVersion`):
```json
{ "success": true, "data": { "terminalId": "78", "verified": true, "pinVersion": 3 } }
```
`pinVersion` = `staff_pos_pins.pin_version` (migrasi 00153). `version` bertipe number; app mem-parse number/string defensif.

**`terminalShape` (+`merchantId`):** setiap respons terminal kini memuat `"merchantId"` string agar app bisa scope cabang tanpa call tambahan (1 cabang = 1 merchant).

**Error kapasitas baru:**
- `409 TERMINAL_TAG_CONFLICT` — user sudah menempati tag eksklusif itu di merchant ini (kasir/dapur kedua, full_akses kedua, atau campur full_akses↔kasir/dapur). Berlaku di bind, claim, create/update terminal, dan E01-with-code.
- `409 TERMINAL_QUEUE_EXISTS` — merchant sudah punya terminal `view_queue` aktif (1 per merchant).

**Rate-limit:** stage-A ikut limiter existing `terminal-login` (`AuthRateLimit`, 30/8/15 mnt); E29 ikut `terminal-pin-verify` (`AuthPrincipalRateLimit`, 30/10/15 mnt). Tidak ada key limiter baru.

---

## 3. Perubahan app (`genfity-order-app` saja) — sesuai implementasi

1. `screens/auth/LoginScreen.tsx` — mode fresh-device = kredensial saja; stage-A (`{stage:'pick-terminal'}`) → simpan kredensial di state memori `pickA` (bukan SecureStore — password di-nol-kan usai fase-B); render picker inline cabang→terminal→(PIN terminal kondisional)→Lanjut/Kembali; `submitPickA` = tahap-B; sukses → `adoptTerminalBinding()` (cerminkan binding server ke 3 store lokal) → kandidat online → `StaffPinModal`. Unbound + offline tetap diblokir jujur.
2. `lib/terminalApi.ts` — `StaffLoginInput` += `terminalPin?` + `merchantId?`; `logoutRevoke` lampirkan `deviceId` otomatis; `PinVerifyData` += `pinVersion` (parse number/string).
3. `lib/session.ts` — grant-map `LS_GRANTS` envelope `{v:1, active, grants}` keyed `userId‖terminalId‖deviceId {grant, pinVersion, grantedAt, expiresAt}` + migrasi sekali dari `LS_GRANT` legacy; `getGrant/saveGrant/clearGrant` scoped triple (param triple opsional, kompatibel); `verifyGrantPin(pin, triple?)` exact-key tanpa fallback lintas-triple; `getGrantPinVersion/setGrantPinVersion`; `clearGrantsForDevice`; `revokeKickedSession` cabut hanya triple sesi; `adoptTerminalBinding` pakai `clearGrantsForDevice`.
4. `config/server.ts` — `authLogout` dibetulkan ke `api/v1/auth/terminal-logout` (BE tidak punya `/auth/logout`).
5. `lib/i18n.ts` — 6 kunci picker (`pick_terminal_title/hint`, `pick_branch_label`, `pick_terminal_label/empty/continue`, id+en).
6. Seeding `passesLocalWorkforcePin` hanya untuk jalur offline, **tidak pernah** menggantikan verify server saat online pertama.
7. **Disentuh tapi tidak diubah logikanya:** `apiFetch` (tanpa refresh-token; 401 = re-login, bukan bukti kick — takeover via SSE E26), pola `completeOnline`, dialog claim-409 existing.

Tidak ada file/screen baru (`SelectBranchScreen`, `TerminalPickerScreen`, `TerminalPinScreen`, `StaffPinModal`-baru, `<PinPad>`, `<AccountPicker>` dari desain awal **tidak dibuat** — diganti picker inline + modal existing).

---

## 4. Delta DB (goose, satu perubahan logis per file) — sesuai implementasi

- **00153 (wajib):** `staff_pos_pins ADD COLUMN pin_version INTEGER NOT NULL DEFAULT 1` (+ Down `DROP COLUMN`). Pendamping: `MerchantWorkforcePINPut` + `MerchantWorkforceStaffPINPut` + `StaffPinReset` bump `pin_version+1`, reset `failed_attempts/locked_until`, `updated_at=NOW()` — setiap set/reset meng-invalidate cache offline. Format sesuai `CLAUDE.md` (`StatementBegin/End`, tanpa inline CHECK).
- **00154 (kapasitas tag):** drop `uq_pos_terminals_bound_user`; 3 partial unique index `UNIQUE(merchant_id, bound_user_id) WHERE tag='<kasir|dapur|full_access>' AND is_active AND bound_user_id IS NOT NULL` (satu per tag — tanpa subquery, tanpa inline CHECK); backfill `tag NULL→full_access`; dedupe `view_queue` per merchant. + Down (drop index, restore constraint).
- **00152 sudah ada:** `pos_terminals.pin_failed_attempts + pin_locked_until` (lockout PIN terminal 5-gagal/15-mnt) — M-conditional desain awal **tidak diperlukan**.
- **Nol tabel preAuth** (tanpa JWT staged — tidak ada token staged sama sekali). Nol perubahan `UNIQUE(merchant_id, terminal_code)` dan `UNIQUE(terminal_id,user_id,device_id)`.
- Alternatif yang **ditolak juri:** versi PIN via `updated_at` (resolusi detik, rawan zona-waktu) — pakai `pin_version` INT monotonik.

**Enforcement kapasitas (scope: per user per merchant; `view_queue` 1 per merchant):** pre-check deterministik di handler (`terminalTagCapacityConflict` via `ListActiveTerminalsByUserInMerchant`) → 409 `TERMINAL_TAG_CONFLICT`; 3 partial index sebagai race backstop (mapping `isTagCapacityViolation` via pgcode 23505 + nama constraint `*_per_user`); guard `view_queue` di create/update (`terminalQueueConflict` → 409 `TERMINAL_QUEUE_EXISTS`). Berlaku di bind, claim, create/update terminal, E01-with-code. Takeover/kick **per-terminal** (login kasir di device B menendang sesi kasir device A, tidak menyentuh sesi dapur/view user itu). SQLC: `ListActiveTerminalsByUserInMerchant(:many)` + `GetStaffPinVersion(:one)`; query lama `FindActiveTerminalByUser` / `UnbindTerminalsByUserExcept` dibuang (claim tidak lagi unbind-melebar — device move dipertahankan).

---

## 5. Aturan PIN hybrid berversi (mengikat)

1. Online pertama **wajib** server-verify (E01-with-code + E29).
2. Cache lokal = grant + `pinVersion` dari respons sukses; buka-cepat lokal, konfirmasi server di background saat online.
3. Beda versi saat sync → invalidate grant triple itu, paksa re-login online.
4. TTL grant 7 hari; token di SecureStore; KDF SHA-256 berantai dicatat sebagai utang (naik ke bcrypt/argon2 di P1).
5. E02 tidak ada; enforcement selalu server-side (E01-with-code, E29, bind/claim).

---

## 6. Edge cases

- **terminalCode kembar lintas merchant:** resolve `GetTerminalByCode(merchantID, code)` bila `merchantId>0`; klien lama tanpa `merchantId` → first-match legacy (bukan `TERMINAL_AMBIGUOUS` — desain awal disederhanakan).
- **Kick/takeover:** `tookOver{kickedUserId}` di complete + SSE E26; grant-map tidak auto-hapus korban (`revokeKickedSession` hanya cabut triple sesi sendiri).
- **Unbound + offline:** tolak jujur (`need_be`), bukan error mentah; unbound + online → stage-A.
- **Fase-B E01-with-code (backward-compat):** request lama `{username,password,terminalCode,deviceId}` tetap diterima sebagai complete satu-langkah.
- **✅ Keputusan user 2026-10-17 (revisi): kapasitas sesi per-tag, di-scope per merchant.** 1 user bersamaan boleh menempati: **1 kasir + 1 dapur + N view_queue + N view_pelanggan**. Aturan eksklusi:
  | Punya | Boleh tambah | Dilarang tambah |
  |---|---|---|
  | kasir | 1 dapur, N view | kasir lagi, full_akses |
  | dapur | 1 kasir, N view | dapur lagi, full_akses |
  | kasir + dapur | N view | kasir/dapur/full_akses lagi |
  | full_akses | N view | full_akses lagi, kasir, dapur |
  | hanya view | apa pun (ikut baris di atas) | — |
  Enforcement per §4. Takeover/kick berlaku **per-terminal**.
- **Password fase-1** hanya di memori (`pickA`), di-nol-kan usai fase-B; `MUST_CHANGE_PASSWORD`/email-verified jalan di stage-A.

---

## 7. Divergensi dari desain awal (dicatat agar audit bisa telusur)

| Desain awal | Implementasi aktual | Alasan |
|---|---|---|
| preAuth JWT stateless (`purpose=pos-preauth`, TTL 600) + scope E07/E09/E02/E03/complete | **Tanpa token staged**: stage-A password-verified tanpa sesi; tahap-B = E01 ulang + kredensial dari memori | Lebih sedikit permukaan serangan (nol token baru, nol TTL staged, nol risiko device-mismatch staged); kredensial tidak transit lebih dari yang sudah dilakukan E01 |
| Screen baru: SelectBranch, TerminalPicker, TerminalPin; E07/E09-preAuth/E02/E03/`terminal-complete` | Picker **inline** di LoginScreen dari `branches`+`terminals` stage-A; E01-with-code + E29 existing | Nol endpoint baru, nol screen baru; E29 ternyata sudah server-side verify (asumsi desain "belum ada" keliru) |
| `TERMINAL_AMBIGUOUS + candidates[]` untuk code kembar | Scope `merchantId` opsional; tanpa itu first-match legacy | Backward-compat klien lama; konflik kembar diselesaikan via pilihan cabang di picker |
| Lockout staff-PIN 5/5 mnt di terminal-complete | Lockout ikut pola `verifyWorkforcePIN` existing via E29 | Pakai mekanisme yang sudah ada dan teruji |
| Tombol/navigasi `BIND_FLOW_ROUTE` dihapus untuk jalur fresh | `BIND_FLOW_ROUTE` tetap untuk jalur unbound/blocked non-stage-A | Jalur install/claim device tetap butuh entry bind |

---

## 8. Verifikasi

`go -C services/genfity-order-services build ./...` · `go vet ./internal/http/handlers/` · `goose -dir internal/db/migrations validate` · `sqlc.exe generate -f sqlc.yaml` · `expo lint` (app; tanpa `tsc` di proyek ini — error lint pre-existing di `DrawerMenu`/`MiniCharts`/efek kick-notice tidak terkait) · E2E: fresh-device S1–S5; shift-change S4-only <5 dtk; auto-skip 1-merchant/1-terminal; offline-tolak vs offline-relogin; lockout PIN-terminal 5x; takeover 2 device; `KASIR1` kembar lintas merchant; bump `pin_version` meng-invalidate cache. **Uji migrasi 00153+00154 up+down di DB dev sebelum merge.**

**File yang disentuh saat implementasi** — BE: `terminal_auth.go` (cabang stage-A + pre-check kapasitas), `terminal_session.go` (E29 += pinVersion), `terminal.go` (helper kapasitas + guard queue + bump versi di reset + `merchantId` di shape), `merchant_workforce.go` (bump versi 2 upsert), `queries/terminal.sql` + regenerate (`ListActiveTerminalsByUserInMerchant`, `GetStaffPinVersion`), migrasi 00153+00154, `router.go` (tidak perlu route baru). App: LoginScreen, session.ts, terminalApi.ts, server.ts, i18n.ts.
