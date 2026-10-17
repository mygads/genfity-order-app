# Audit Integrasi POS Terminal — genfity-order-app × services × main

> **Tanggal:** 2026-10-17 · **Scope:** login/session terminal, RBAC, PIN, sync offline-first, transaksi POS inti, print-bridge merge, kontrak API/shift · **Acuan yang disepakati:** WEB (`genfity-order-main`) + BE Go (`services/genfity-order-services`) sebagai sumber kebenaran; app (`genfity-order-app`) menyelaraskan diri ke kontrak itu (yang app-only disembunyikan di balik flag, bukan dihapus).
> **Dokumen terkait (sudah ada, dibaca audit ini):** `API-CONTRACT.md`, `API-TERMINAL-CONTRACT.md`, `SPEC-TERMINAL-SESSION.md`, `AUDIT-TERMINAL-RBAC.md`, `AUDIT-ALIGNMENT-TERMINAL.md`, `GAP-ANALYSIS-TERMINAL-MODEL.md`, `PARITY.md` — semua di `genfity-order-app/docs/`.

---

## 1. Ringkasan eksekutif

**Kematangan per repo:**

| Repo | Status | Keterangan |
|---|---|---|
| BE Go (`services/genfity-order-services`) | **Paling matang (~80% SPEC E01–E28 live)** | `terminal-login` single-stage + implicit-claim/takeover + grant 7 hari, registry terminal + 5 tag + pairing 1:1, SSE ganda (terminal + queue), `staff_pos_pins` server-side + lockout. |
| App (`genfity-order-app`) | **Superset fungsional, kontrak menyimpang** | Offline-first paling matang (SQLite + dual outbox + watermark), 15+ metode bayar, dual voucher store, table-map lokal — tapi banyak yang tidak dikenali BE (payment, voucher lokal, move/merge meja). |
| Web (`genfity-order-main`) | **Acuan kontrak, nol terminal-UI** | POS online-only + voucher template + 4 metode bayar + loyalty server-side — tapi tanpa halaman manajemen terminal/tag/PIN/pairing/QR-issue. |

**5 gap kritis (blokir integrasi):**

1. **Logout server-side (E06) — CLOSED 2026-10-17.** Revoke kanonis = `POST /api/v1/auth/terminal-logout` (router, `h.TerminalLogout`; device tetap bound untuk fast-login). `/api/v1/auth/logout` memang tak ada — klaim lama "selalu 404 → sesi zombie" basi. App: `logoutRevoke`/`terminalLogout` → terminal-logout, DrawerMenu 1x revoke, utang-revoke di-flush worker sync.
2. **PIN staff/owner hanya gerbang lokal.** App memverifikasi PIN dari hash yang di-seed dari PIN yang diketik saat login pertama — siapa pun yang tahu username+password bisa menentukan PIN sendiri. `staff_pos_pins` + lockout server-side tidak dikonsultasikan saat login.
3. **E01 implicit-claim mem-bypass PIN terminal.** Login langsung dengan ketik `terminalCode` otomatis bind tanpa PIN — PIN terminal jadi advisory, bukan gerbang.
4. **Gate akses-terminal per staff tidak ada.** Tidak ada tabel `pos_staff_terminal_access`; staff dengan nol permission web tetap bisa login ke semua terminal di branch-nya. Aturan "staff hanya bisa login app jika diberi akses terminal" belum ditegakkan di mana pun.
5. **Idempotency-key tidak durable + tanpa endpoint sync generik.** Middleware idempotency hanya memori TTL 2 menit (jawab 409, bukan replay); keselamatan nyata hanya via `client_id` UNIQUE di POS-create. Tidak ada `?since`/revision, tidak ada `/bootstrap` untuk initial-load.

---

## 2. Current-state per dimensi

### D1 — Auth / session / binding terminal

- **BE live:** E01 `POST /api/v1/auth/terminal-login {username,password,terminalCode,deviceId}` → user session + JWT pair + `branches[]` + `terminals[]` + terminal + tag + grant 7 hari + `tookOver{kickedUserId}`; login sekaligus implicit-claim/bind (`SELECT FOR UPDATE`, last-writer-wins) — `internal/http/handlers/terminal_auth.go`. Registry protektif (UserAuth): E07 branches, E09 terminals, E10 create, E11 patch name+tag, E12 soft-delete, E14 set-pin, E02 validate-pin, E03 bind atomik, E04 unbind (**owner-only**), claim takeover, E15/E16 pair/unpair, E26 SSE terminal events (snapshot+takeover fan-out via `LISTEN/NOTIFY`, migrasi `00151`), E27 SSE queue-events, pin-reset staff owner-only + burn grants (`internal/http/handlers/terminal.go`, `router.go:1077-1113`). DB: `pos_terminals` / `pos_terminal_grants` (triple unique) / `pos_terminal_events` (`00149`), orders `client_id`/`display_no` (`00150`). Middleware UserAuth **tidak** membaca tabel grant dan kick **tidak** merevoke `user_sessions` (401 = auth failure, bukan bukti kick — sudah sesuai koreksi SPEC).
- **App wired:** BranchPicker (E07), TerminalPicker (E09), TerminalPin (E02 pre-check + E03 bind), SelectBranch exitBranch (E04 best-effort); LoginScreen E01 single-stage + PIN staff **verifikasi lokal** + grant offline 7 hari + tookOver notice; watcher takeover SSE di `App.tsx`; `src/lib/session.ts` (Binding/Session/Grant/PendingRevoke, `adoptTerminalBinding`, `exitBranchAll`, `revokeKickedSession`).
- **Web:** login email-only + MerchantSelectionModal + switch-merchant, sesi HttpOnly cookie; **nol** terminal UI (tanpa CRUD/tag/set-pin/pairing, occupant, QR issuance); `qrCodeGenerator`/`qris.ts` hanya untuk QRIS bayar.

**Gap D1 (dengan bukti):**

| # | Gap | Bukti |
|---|---|---|
| G-E06 | CLOSED 2026-10-17 — revoke kanonis `POST /api/v1/auth/terminal-logout` (`h.TerminalLogout`); app `logoutRevoke`→terminal-logout, DrawerMenu 1x revoke; sisa: flush utang-revoke worker | `terminalApi.ts` `logoutRevoke` vs router (terminal-logout) |
| G-E05 | `GET /terminals/{id}/occupant` tanpa route/handler; `fetchOccupant` nol pemanggil | router.go grup terminal; info occupant hanya via snapshot SSE E26 |
| G-E13 | Rute `/tag` dedikasi tetap tak ada (tag di-cover E11 `patchTerminal`); `setTerminalTag` DEPRECATED 2026-10-17 → pakai E11 | `terminalApi.ts` vs router |
| G-E25 | QR-pair mendarat 2026-10-17: `qr-issue` + `qr-consume` ada di BE, klien `issueTerminalQr`/`consumeTerminalQr` wired; sisa: endpoint E25-login-qr (login sekali-pakai dari QR) + UI | router grup terminal; `terminal_qr*.go`; `terminalApi.ts` |
| G-E17–22 | staff-CRUD `/api/v1` tidak ada; staff hanya via `/api/merchant/staff` (email+password+invite, MerchantAuth) | konstanta `ApiPath` E17–E22 mati |
| G-E08 | `POST /api/v1/branches` tidak ada; owner fresh-device tak bisa bikin branch | grup terminal hanya GET |
| G-preauth | **Circular pre-auth:** E07/E09/E02/E03 butuh UserAuth, tapi token fresh-device hanya dari E01 yang butuh `terminalCode` → picker B1 pra-login tak executable lawan BE real (hanya dummy) | SPEC §3 vs middleware |
| G-bypass | E01 implicit-claim bypass PIN terminal | `terminal_auth.go` |
| G-collide | `terminalCode` unik per merchant saja; user multi-merchant bisa login ke cabang yang salah (first-match) | `terminal_auth.go:149-161` |
| G-grant | CLOSED 2026-10-17 — BE `device_grants` multi-slot per triple user‖terminal‖device; app pinVersion compare+heal pasca-E29; sisa: enforcement sisi-sync (Trek Sync) | `session.ts` grant-map; `terminalApi.ts` E29 |
| G-fastpath | PARTIAL 2026-10-17 — 401 non-PIN → auto-logout (`sessionInvalidated` + `setUnauthorizedHandler` override); sisa: account-picker multi-akun eksplisit | app `apiSource.ts` |
| G-unbind | PARTIAL 2026-10-17 — route E04 unbind ADA + klien `unbindTerminal` wired; sisa: aturan peran Q-E (staff "keluar resto") + UI exit | `requireTerminalOwner`, Q14 SPEC terbuka |
| G-kickoff | Kicked-device offline tetap bisa login dari grant cache sampai expiry (maks 7 hari) — trade-off Q6 belum dinyatakan diterima | desain grant |
| G-user | `users` tanpa kolom username (login = email atau `name`, ambigu bila kembar; first-match); `must_change_password` + `email_verified` + invite-WAITING memblokir login terminal → staff baru wajib via web/email dulu | `GetUserByLoginIdentity`, `resolveBranchUserIDByUsername` |
| G-pair | CLOSED 2026-10-17 — `pairTerminalView`/`unpairTerminalView` ↔ E15/E16 wired; sisa: UI owner | E15/E16; `terminalApi.ts` |
| G-dupe | CLOSED 2026-10-17 (putusan user Q0) — `genfity-order-main/apps/pos-mobile/` DIHAPUS permanen; bridge diekstrak ke `apps/print-bridge-android/` sebagai backup | repo; CI `android_apk` rewire |

### D2 — Terminal model + RBAC + roles

- **BE live:** `00149_pos_terminals.sql` (`terminal_code VARCHAR(8)` UNIQUE per merchant, tag NULL CHECK 5 nilai, `pin_hash`, `paired_kasir_id` self-FK, `bound_device_id/user_id`, `is_active`) + `terminal.sql` (20 query) + `terminal.go:39-68` (`normalizeTerminalTag`, NULL→`full_access`; `terminalTopics`: kasir→`online-order-incoming`, dapur→`kitchen-incoming`/`order-accepted`, view_pelanggan→`cart-view`/`payment-qr`, view_queue→`queue-update`/`call`/`ready`, full→keduanya). Pairing 1:1 (`terminal_pairing.go:78-187`, owner-only; target harus tag kasir + merchant sama + aktif; view kedua ke kasir sama → 422 `PAIR_CONFLICT`; re-pair last-write-wins). Kasir-first ditegakkan **di level pair, bukan create**. SSE ganda: `terminal.go:879-988` + `terminal_branch_queue_events.go:330-406` (auth `?token=`). RBAC web: `merchant_staff.go` (create wajib name+email+password≥8, invite 7 hari WAITING, permissions get/put/toggle + revoke sesi + audit; owner-only untuk terminal-write) + `permissions.ts` (~40 permission, template cashier/kitchen/manager) + `roles.ts`.
- **App:** 5 tag + `resolve legacy→full_access`, binding persisten, login username+password lalu modal PIN staff lokal (tak dikirim ke server), B1/R1/K1/O1, QueueViewScreen + CustomerDisplayScreen terkunci, DrawerMenu `allowedRoutesFor`/`homeRouteFor` (kasir/dapur/full drawer penuh, views singleton).

**Gap D2:**

| # | Gap |
|---|---|
| G1 | **Staff username-tanpa-verifikasi-email BELUM ADA.** Create wajib email valid + unik + invite ACCEPTED sebelum aktif. Bertentangan dengan permintaan "staff bisa email atau username+pw tanpa verifikasi". |
| G2 | **Gate akses-terminal per staff BELUM ADA.** Tidak ada `pos_staff_terminal_access`; login/bind/claim hanya cek link merchant aktif. |
| G3 | **Batas 1 view_queue per cabang BELUM ADA.** Tanpa partial UNIQUE index maupun cek count. (Pairing 1:1 kasir-display sudah ada.) |
| G4 | View yatim (tanpa pair) boleh dibuat dan tetap bisa login/bind — app hanya banner `unpaired`, bukan blokir. |
| G5 | Klaim-vs-realita routing event: `terminalTopics()` memetakan topik per tag, tapi hub live hanya memancarkan lifecycle terminal (bind/takeover/pair) tanpa filter topik; pemancar `online-order-incoming`/`kitchen-incoming` dari order tak ditemukan di handler terminal. Pembedaan kasir/dapur/full bertumpu pada filter sisi app. |
| G6 | Web tanpa manajemen terminal (CRUD/tag/PIN/pairing/grant akses) — RBAC terminal tak bisa dioperasikan owner dari web. |
| G7 | Pairing masih owner-only di kode vs Q3-final docs (owner ATAU staff-settings) — belum diselaraskan. |
| G8 | Verifikasi belum dieksekusi: `go build`, `goose validate`, `tsc` app+web, e2e fisik (kick 2 HP, SSE kedua view) — vonis CLOSED selama ini read-only. |

### D3 — Sistem PIN

**Inventarisasi existing (5 secret + 2 throttle lokal):**

| Secret | Scope | Store | Dipakai untuk |
|---|---|---|---|
| `staff_pos_pins` | per-branch (`merchant_id,user_id`) | bcrypt + `failed_attempts`/`locked_until` 5x/5 mnt (`00081…`) | clock-in/out/break, cash open-close-movement bila `require_pin_for_pos` |
| `manager_pin` (supervisor) | per-merchant (shared, non-atributif) | `merchants` | gate void/refund bila `RequirePinForVoid/Refund` |
| `owner_pin` | per-merchant (shared) | `merchants` | gate hapus order; remove-manager butuh owner PIN |
| `delete_pin` | per-merchant | `merchants` | verifikasi sebelum hapus data (web `DeletePinModal`) |
| terminal bind-PIN | per-terminal | `pos_terminals.pin_hash` (`00149`) | E02/E03; reset via pin-reset owner-only + bakar grants (`terminal.go:1059-1183`) |
| Mobile lokal | per-userId SecureStore, SHA-256 x2000 | `src/lib/pin.ts` (**SATU hash untuk semua jalur lokal — PARTIAL**), `supervisor.ts` (throttle persisten), `shiftGuard.ts`, `seed.ts` (seed `1234` + migrasi kolom legacy) | login/absensi/shift/void-lokal |

**Gap D3:**

1. **Scope 3 definisi beda:** `staff_pos_pins` per-branch vs permintaan PIN staff/owner global lintas cabang vs SecureStore mobile per-userId global-per-device. Belum ada keputusan kanonis.
2. **Login vs otorisasi tidak terpisah (offline):** `verifyLocalEscalation` void/kompliment memverifikasi hash yang **sama** dengan PIN absensi/login — supervisor tak punya kredensial berbeda secara lokal.
3. **Shared-secret non-atributif:** verifikasi manager/owner/delete PIN hanya bcrypt-compare tanpa mencatat approver `userId` (bandingkan `staff_attendance_events` dan `pettyApproval` by+at yang sudah atributif).
4. **Rate-limit asimetris:** manager/owner/delete PIN tanpa lockout/attempt-counter (hanya auth rate-limit umum); throttle absensi mobile in-memory (hilang saat restart).
5. **KDF asimetris:** server bcrypt (cost 10) vs mobile SHA-256 x2000 custom + fallback AsyncStorage bila SecureStore tak tersedia (risiko backup).
6. **Anomali delete-PIN:** `MerchantDeletePinSet` (`merchant_misc.go:275`) memakai query `SetMerchantDeletePin` dengan field `ManagerPin` — **perlu verifikasi kolom yang ditulis** (delete_pin vs menimpa manager_pin). Kebijakan panjang 4-digit (delete modal) vs min-4-tanpa-batas (manager/owner) vs 4–8 (staff) vs 4–6 (mobile) — 4 kebijakan berbeda.
7. **Print tanpa PIN gate** (`lib/print.ts` + `native/printer.ts` hanya routing).
8. Model "cabang" belum dikonfirmasi: `merchants.id` vs `merchant_branches` — menentukan scope per-branch semua PIN.

**Taksonomi yang diusulkan (adopsi):** 3 kelas × 2 scope + bind-PIN:

- **(A) LOGIN-PIN** — global-per-akun: login, absensi, buka-shift.
- **(B) AUTHZ-PIN** — per-branch-per-orang: void/return/refund/kompliment/petty-approve/cash-variance. Hash terpisah, tidak boleh equal (A). Larang reuse antar kelas.
- **(C) ADMIN-PIN** — per-branch, **website-only**: hapus data, remove-PIN orang lain, unbind. Selalu + alasan tertulis + konfirmasi ulang.
- **(D) TERMINAL-BIND-PIN** — per-terminal (existing, pertahankan).

### D4 — Sync offline-first

- **App (satu-satunya offline-first nyata):** SQLite `poslite.db` (`db.ts` + `dbSchema.ts`, ~30 tabel `ms_*`/`tr_*`), dirty flag `syncDate IS NULL`, watermark per-domain `tr_sync`, **dual queue** (ringan AsyncStorage `genfity.sync.outbox` UUIDv7 + fisik `tr_esoprocessqueue`), `master.ts` `pullMaster()` 14 domain pola watermark-pull → `GET ?since&limit=200` → upsert → watermark (server-wins dengan pengecualian lokal: saldo member + kuota voucher dipertahankan bila `syncDate` NULL; sales/shift `INSERT OR IGNORE`; station partial-upsert lindungi `printerPort`), `pushAll()` drain FIFO strict `createdAt` ASC + pacing 150ms + breaker 3-gagal + `Idempotency-Key=item.id` + `classify409` duplicate-vs-display + re-issue displayNo maks 2, auto-sync 5 menit + wifiOnly, enforcement 7-hari block / 3-hari warn, WS ganda + heartbeat 30s + reconnect picu `pullMaster`, `sse.ts` (Last-Event-ID + dedupe, E26/E27), boot `initDb → seedIfEmpty → pullMaster → startRealtime`, kompat `toGoPosRequest` → `POST api/merchant/orders/pos`.
- **BE:** POS create idempoten via `client_id` UUID UNIQUE (retry sama return existing; displayNo tanpa clientId ditolak; tabrakan → 409 `SALE_DISPLAY_CONFLICT`) — `orders_pos_create.go`; middleware idempotency **in-memory TTL** (payment 30s, POS 2 menit; jawab 409 `DUPLICATE_REQUEST` tanpa replay); stok transaksional (`FOR UPDATE` + `stock_deducted_at` guard + restore) + cron alert + email queue; realtime `ws/server.go` 5 hub + PG `LISTEN/NOTIFY` + SSE; queue RabbitMQ + DLQ **hanya** email/notifikasi/order-status-outbox (bukan POS-sync); **tanpa** `?since`/pull generik.
- **Web:** SWR online-first (dedup 2s, revalidate focus/reconnect, 429 cooldown, cache merchant-scoped) + `useOfflineSync.ts` (localStorage merchant-scoped v2, expiry 7 hari, cart persist, auto-sync on-online+2s, preflight `GET /api/merchant/pos/menu` deteksi `MENU_MISSING/MENU_INACTIVE/ADDON_MISSING/PRICE_CHANGED` + resolusi manual, `X-Idempotency-Key` + offlineOrderId) + SSE/WS hooks.

**Gap D4:**

1. Outbox durability: antrean ringan AsyncStorage fire-and-forget (jendela rugi crash, diakui komentar M13 `sync.ts`); main hanya localStorage (~5MB, tanpa dirty-flag/watermark, expiry bisa buang order).
2. Idempotency-key mismatch (detail di §1.5).
3. Tanpa content-version/vector-clock: revisi hanya di stock hub (string) tanpa kolom version per baris.
4. Konflik tak lengkap: harga implisit server-wins; stok offline bisa oversell (tanpa hold/reservasi); voucher burn offline vs lock online → double-spend lintas terminal saat offline; move/split/void/change-payment masih ESB-path tanpa padanan Go (404 → gagal+retry).
5. Initial-load tanpa bundle: app 14 domain sekuensial `limit=200` **tanpa loop pagination** (`watermark=now` → sisa page hilang); main N SWR paralel tanpa bundle.
6. Monitoring stok tak sampai ke badge kasir (hanya cron email + SSE yang tak terhubung ke badge POS offline).
7. **M9-3: edit master lokal (sold-out/branch-menu/station) antre fisik lalu di-DELETE diam-diam saat drain** (`sync.ts:646-651,924-936`) — kasir mengira tersimpan.

### D5 — Transaksi POS inti (FOKUS UTAMA)

- **App = superset fungsional:** 5 sales mode, 15+ metode bayar, dual voucher (`ms_voucher` kuota + `ms_promotion` reusable + `OrderVoucher` passthrough + 2 picker), table-map lokal (pindah/gabung/batal), member deposit + points overlay (1pt/Rp1000), Kitchen/Queue/CustomerDisplay, `totals.ts` kanonis (service 5%, PPN-11 info-only, platform fee 5% marketplace, rounding Rp100).
- **BE+Web = acuan:** 4 metode POS (`CASH_ON_COUNTER, CARD_ON_COUNTER, QRIS, SPLIT`, shift-required), voucher template (`internal/voucher`, `AudiencePOS`, stacking, ~17 kode `VOUCHER_*`), table-management (floors/tables CRUD + status), loyalty/customers/email-delivery, delivery zones/quote/dispatch, GPay dynamic QRIS + static QRIS (IDR-only), `/pos/menu` (categories+items+addonCategories+addonItems+stock). Web POS 2927 baris: orderType `DINE_IN/TAKEAWAY` (atau `IN_STORE_*` untuk PRODUCT/SERVICE, DELIVERY future-proofed), cart localStorage, tax/service/packaging/delivery dari merchantSettings, kitchen/queue/history, display thank-you/review WS push.

**Gap D5 (keputusan hide-vs-samakan, acuan = web):**

| # | Gap | Keputusan |
|---|---|---|
| V1 | Voucher dualisme app vs template server (+ stacking) | Deprecate `ms_promotion` (read-only legacy); single validate = server saat online, `assertVoucherUsable` backstop offline; gabung 2 picker → 1 picker template-cache; `totals()` murni kalkulator (promo truth dari server) |
| V2 | Web `discountAmount = 0` hardcoded (`pos/page.tsx:1477`) padahal state + BE field ada | Wire discountType/Value → `MerchantPOSPayment` + aturan stacking vs voucher, atau hapus UI-nya. Jangan ship silent-zero |
| P1 | 15+ metode app vs 4 BE → ekstra gagal/rekonsiliasi salah | PayScreen → Tunai/Kartu-EDC/QRIS/Split; sisanya (transfer/deposit/kompliment/nonsales/pluxee/ultra/e-wallet-direct) → seksi "Lainnya (unavailable)" di balik flag; EDC approval-code → field `approvalCode` `CARD_ON_COUNTER`; split-tunai dipertahankan + `normalizeMethod` |
| T1 | Table move/merge/cancel lokal-only; BE tanpa endpoint move/merge | Denah UX dipertahankan, persist via table status API; pindah = status-swap 2 meja + pindah `tableNumber` (`PUT /orders/pos/{id}`); gabung = bill-combine di BillPreview + status updates (tunggu keputusan endpoint merge) |
| T2 | Model addon app (modifiers-in-payload, tanpa manajemen kategori) vs `/pos/menu` addon-model web | Ikut web (`addon-categories/addon-items` pages) |
| S1 | Flag `track/allowSellEmpty` app local-storage-only (TODO M9-10; `ms_branchmenu` tanpa kolom) | Tambah kolom + sync ke server |
| S2 | `totals()` hardcode (service 5%, fee 5%, round 100, PPN-11 fallback) vs settings web | Ganti ke pos-settings + merchantSettings (cache untuk offline); ongkir online = delivery-quote/fee settings, offline = dialog manual |
| M1 | Member app (SQLite `ms_member` tanpa email, points overlay storage) vs loyalty/members/rewards + email-delivery server | Search via `/customers/search`, deposit via `postDepositOnce`, drop points overlay → loyalty server; tambah email capture + receipt-email via email-delivery settings |
| O1 | Void app (CancelScreen: supervisor auth, lokal-only, outbox `order-void`) tak wire ke void/refund/cancel/restore + POS-refund PIN+idempotency BE; partial-refund amount hilang | Single flow: reason + supervisor PIN + idempotency key → void (full) / POS-refund (partial) / restore; offline = enqueue request idempoten yang sama |
| K1 | KDS/queue accept/bump tak terkonfirmasi (kitchen/queue via orders list + WS actions + queue-events; tiap UI turunkan status sendiri) | Konfirmasi kontrak WS-actions + status kanonis, ikat KitchenScreen + web kitchen + QueueView + web queue ke transisi yang sama |
| C1 | Protokol display: web thank-you/review push vs `display.ts` bus app — belum tentu sama | Unifikasi protokol display |
| D1 | Ongkir app manual (default 0) + voucher ongkir-cut vs delivery quote/zones + settings web | Ikut web saat online |

### D6 — Print-bridge merge

- **App (direct-print, setara print-bridge untuk cetak langsung):** transport LAN murni-JS, BT SPP, BLE Nordic UART chunk 100B, USB bulk + permission, openDrawer semua transport, foreground WS service (`native/printer.ts` + `GenfityPrinterModule.java`, spec `specs/GenfityPrinter.ts`, plugin `app.json`); builder ESC/POS (`lib/escpos.ts`: kasir ber-harga 32/48 kolom + logo raster + QR + autocut; kitchen tanpa harga; queue slip); dispatcher tag-aware (`lib/print.ts`: `printForTag`, view tak pernah dapat struk harga; resolusi `{branchId,terminalCode}`; drain kind-aware dapur-tak-jatuh-ke-kasir); antrean offline (`printqueue.ts`: `tr_printqueue`, envelope kind/label/retries, FIFO, max 5 retry, count di SyncScreen); settings station Kasir/Dapur/Checker/Label + routing menu→station (`PrintersScreen.tsx`, `MenuPrintingScreen.tsx`, `config/device.ts`); preview BillPreview (pracetak+split+unpaid) + Receipt (kertas+share+email+autoPrint sekali).
- **BE+Web (server-mediated, lengkap):** `print_bridge.go` (payload `lines[]` + TTL manual 30m/auto 4h/kitchen 15m/lease 2m) + outbox `SKIP LOCKED` + gate route aktif + thermal templates + push + observabilitas; receipt preview PDF+HTML; POS auto_print; `ws/merchant_orders.go`; web `printBridge.ts` + `usePrintBridge.ts` + PrintBridgeTab + RoutingEditor (event `MANUAL_RECEIPT/KITCHEN_MANUAL_RECEIPT/ORDER_CREATED/PAYMENT_CREATED/REFUNDED/VOIDED` + failover) + ReceiptTemplateTab (ReceiptSettings + modeOverrides + preview iframe + CRUD).

**Gap D6:** app tanpa (1) custom thermal template berversion, (2) picker Template Kasir vs Dapur per terminal, (3) preview terikat template (+ tab Kasir/Dapur), (4) route-engine event→auto-print (order online hanya banner/sound, `autoPrintKitchen` belum terverifikasi wiring-nya), (5) claim/lease/ack/TTL/failover/priority server, (6) negosiasi encoding (app transliterasi ASCII NFKD vs bridge CP437/CP850/WINDOWS-1252/UTF-8 + capabilityProfile), (7) observabilitas (hanya count pending), (8) parity renderer (server `lines[]` vs client ESC/POS — butuh `rendererVersion`).

**Keputusan merge:** penyatuan **template + settings**, bukan tulis-ulang transport. App tetap direct-print di v1 (bridge companion tetap untuk kasir tetap); app bukan bridge-device (tanpa claim/ack) di v1.

### D7 — Kontrak API + shift/kasir

- **Live:** E01–E04, E06(revoke umum), E07, E09–E12, E14–E16, E26 (envelope `terminal.event/terminal.refresh`), E27 (`queue-update`, id `qb-{branch}-{seq}`). Web shift/cash modern: workforce/shifts, current-shift, clock-in/out, break, time-correction, timesheet-review, cash-registers/sessions open/close/approve/movements, pos/cash-sessions, customer-display/sessions.
- **Hilang/menyimpang:** E05, E08 (scope), E13 (kanonis vs generic PATCH), E17–E22 (atau retire → merchant `/staff` + workforce), E23 approvals (void/cancel/compliment + ownerPin) + E24 audit owner-actions (**wajib untuk aksi kasir sensitif**), E25 login-qr (TBD Q2 — putuskan defer eksplisit); **tanpa shift open/close terminal-scoped** (app masih legacy `v1/push/shift` + `employee-attendance/*` tanpa padanan Go → shift mobile lokal-only `tr_shiftlog` + `shiftGuard`); **tanpa cash open/close terminal-scoped** (sumber expectedCash/variance tak terdefinisi); attendance vs cash-shift tercampur di `tr_shiftlog` (BE memisahkan workforce clock vs cash session); SSE drift (tanpa `cart-view`/`payment-qr`/`KITCHEN_TICKET`/`DISPLAY_ORDER`/`PRINT_*`, tanpa `call`, tanpa server-acked `callNext`, tanpa fan-out finish ke dapur/display); tanpa kebijakan versioning (`/api/v1` additive-only, breaking → `/api/v2` + sunset + fixture).

---

## 3. Matriks parity (S = ada, P = sebagian, X = hilang)

| Fitur | App | BE-Go | Web-main | Keputusan |
|---|---|---|---|---|
| Login terminal E01 + takeover/grant | S | S | X (email-only) | Q-H: web tambah halaman terminal? |
| Logout revoke E06 | S | S (terminal-logout) | P | CLOSED 2026-10-17 — sisa: flush utang-revoke worker |
| Occupant E05 / SSE E26 snapshot | P (SSE) | P | X | Q-F: implement vs drop → SSE saja |
| Branch/picker pre-auth E07/E09 | P (dummy) | P (butuh auth) | X | Q-A: pilih opsi pre-auth |
| Staff username-no-email | X | X | X | Q1/Q2/L: skema username |
| Akses-terminal per staff | X | X | X | Tabel `pos_staff_terminal_access` + 403 (Q3) |
| view_queue 1/cabang | P | X | X | Partial unique index + migrasi (Q4) |
| Pairing 1:1 + pelonggaran Q3 | P | S (owner-only) | X | Q6: owner-only vs staff-settings |
| PIN taksonomi 3-kelas × 2-scope | P | P | P | Adopsi A/B/C + D-bind |
| Sync pull `?since`/bootstrap | P | X | X | `GET /pos/bootstrap` + revision/domain |
| Push idempoten durable | P (UUIDv7) | P (memori) | P | Tabel `idempotency_keys` + replay 200 |
| Voucher template vs dual-lokal | P | S | S | Deprecate `ms_promotion`, single validate |
| Payment 4-metode vs 15+ | P | S(4) | S(4) | Sembunyikan "Lainnya" + `normalizeMethod` |
| Discount manual | P | S | X (=0) | Wire atau hapus UI |
| Table move/merge | P (lokal) | P (status) | P | Endpoint merge vs emulasi |
| Shift terminal-scoped | X (legacy ESB) | X | S (cash modern) | REST shift/cash terminal-scoped baru |
| KDS accept/bump kanonis | P | P | P | Konfirmasi WS-actions + status |
| Customer display protocol | P | P | P | Unifikasi protokol |
| Print bridge claim/ack | X | S | S | App = direct-only di v1 |
| Template Kasir vs Dapur | X | S | S | Web-edit + snapshot read-only di app |
| Auto-print event→printer | X | S | S | Toggle per terminal, default mati |

---

## 4. Alur yang diminta user — existing vs usulan

### F1. Fresh device (belum bind): username/email+pw → pilih merchant → pilih terminal + PIN terminal (+ QR terminal) → PIN login

- **Existing:** B1 (BranchPicker→TerminalPicker→TerminalPin→Login) wired di app tapi **circular** (picker butuh auth yang hanya lahir dari E01). E01 single-stage `{username,password,terminalCode,deviceId}` bisa dipakai langsung (ketik code manual) tapi **bypass PIN terminal**.
- **Usulan (pilih satu, Q-A):** (a) E07/E09 publik-terbatas pra-auth (token claim sekali pakai, daftar cabang/terminal yang boleh dilihat device itu saja); atau (b) ketik `terminalCode` manual dulu → E01 → picker pasca-login (menerima tabrakan kode → wajib `{merchantId,terminalCode}`, Q-J); atau (c) pre-auth claim-token sekali pakai via QR terminal. PIN pad khusus dengan visual berbeda untuk terminal-PIN vs staff-PIN vs owner-PIN. QR-terminal (pilih terminal, prefill code) **terpisah** dari QR-login (otentikasi).

### F2. Bound device (re-login cepat / ganti shift): hanya akun + PIN login

- **Existing:** hanya jalur offline (PIN-grant); online tetap password penuh, tanpa account-picker tersimpan, `apiFetch` tak handle 401.
- **Usulan:** grantmap per-user (bukan single-slot) + account-picker tersimpan; online = password/PIN + refresh-token flow; offline = PIN-grant. Pertahankan takeover/kicked UX yang ada. Unbind/keluar-resto eksplisit per peran sesuai jawaban Q-E (usulan: staff boleh unbind dengan PIN terminal tujuan, bukan owner-only).

### F3. QR-login dari main: scan → langsung ke user view, hanya PIN login

- **Existing:** greenfield total (E25 tidak ada; jalur QR mobile legacy ESB).
- **Usulan:** main terbitkan token sekali pakai short-lived (single-use, TTL menit) → app scan → tukar di E25 → sesi + binding mengikuti token (tanpa pilih merchant/terminal) → minta PIN login (A). **Jangan pernah** taruh kredensial mentah dalam QR.

### F4. Shift: buka/tutup kasir + absensi

- **Existing:** app legacy ESB (`v1/push/shift`, `employee-attendance/*`) + `tr_shiftlog` campur absen-vs-kas; web modern tapi bukan terminal-scoped; BE Go tanpa padanan.
- **Usulan:** pisahkan **Attendance** (siapa kerja: clock-in/out per user, PIN-A milik diri, anti-titip) vs **Cash-shift** (akuntabilitas laci: per register/terminal). REST baru `POST /api/v1/terminals/{id}/shifts/open {userId,deviceId,openingCash,shiftName}`, `POST /shifts/{id}/close {actualCash,note,pin}`, `GET current`; sale membawa `shiftId` + `cashSessionId`; `expectedCash` dihitung server, variance dikonfirmasi client (+ approval owner bila > threshold). Open-shift butuh staffPin lokal + online; close = hitung kas + dialog variance.

### F5. Transaksi sensitif: void/return/refund + hapus data

- **Existing:** void app lokal-only; BE punya void/refund/cancel/restore + POS-refund (supervisor PIN + idempotency) tapi tak dipakai app; hapus data = delete-PIN (web) dengan anomali field-mapping.
- **Usulan:** E23 approvals + E24 audit (owner-PIN escalation, trail termasuk takeover). Void = reason + PIN-B approver **beda orang** bila kasir=staff (tampilkan nama approver). Hapus data = PIN-C + alasan, **website-only** (final). Perbaiki `SetMerchantDeletePin` + tambah OWNER_PIN-gate untuk remove owner PIN (saat ini tanpa PIN).

### F6. Dapur / queue / display + event routing per tag

- **Existing:** `terminalTopics()` + SSE snapshot mengiklankan topik; live hub hanya lifecycle; queue-SSE hanya `queue-update/call/ready`.
- **Usulan (pilih satu, Q7):** (a) hub filter live frame per `terminalTopics(tag)` server-side + pancarkan `online-order-incoming`/`kitchen-incoming` dari pemicu order; atau (b) dokumentasikan TerminalEventsSSE = lifecycle saja, payload order via queue-SSE+WS dengan filter sisi app. Standarkan envelope `{id,event,version,scope:{branchId,terminalId,tag},data}`; `callNext` server-acked berversion; 401 = auth failure bukan kick. Kasir/dapur/full-akses: drawer penuh, beda hanya di event yang diterima. View pelanggan: scope kasir pasangan; view queue: scope branch.

### F7. Print: preview bill/struk → template kasir/dapur → print

- **Existing:** §D6. BillPreview (unpaid+split) + Receipt (kertas+share+email+autoPrint sekali) + test-print teks+hex — belum template-driven.
- **Usulan tahap:** (a) snapshot template read-only via `pullMaster` + picker Template Kasir + Template Dapur per-terminal (`ms_terminalsetting`: `receiptTemplateCashierId/KitchenId`, `autoPrintOnlineOrder/Kitchen`, `copies`, station; server-wins via `syncTerminalSettings`; fallback default merchant) + preview tab Kasir/Dapur dari satu builder; (b) toggle auto-print + wiring event (WS `online-order-incoming` tag kasir/full → fetch detail → struk kasir + tiket dapur per routing menu → `printBytes`; gagal → `enqueuePrint`; default mati per terminal); (c) drain triggers (reconnect, master-pull sukses, test-print sukses, foreground, pull EsbOrder sukses) + observabilitas lokal; (d) bila perlu: copies/failover/encoding. Paper/cutter ikut station (status quo) kecuali diputuskan ikut template (Q-print6).

---

## 5. Rekomendasi prioritas

### P0 — blokir, keamanan/data-loss

1. E06 logout (tambah route atau arahkan ke `/api/auth/logout`; verifikasi revoke sesi token-berjalan).
2. Strict-mode PIN-terminal (Q-B) + tutup bypass E01; atau nyatakan advisory dengan threat-model tertulis.
3. PIN staff naik ke server-verify tahap-2 (`staff_pos_pins` + lockout) atau nyatakan gesture-lokal tertulis (Q-C).
4. Tabel `pos_staff_terminal_access` + `403 TERMINAL_ACCESS_DENIED` + burn saat staff dihapus/dinonaktifkan.
5. Partial unique index 1 view_queue/cabang + migrasi konsolidasi pelanggar.
6. Perbaiki `discountAmount=0` (wire atau hapus UI).
7. Tabel `idempotency_keys` + replay 200; `clientId` wajib bila bawa `displayNo`.
8. Perbaiki M9-3 (edit master dibuang diam-diam) — definisikan endpoint push master atau nyatakan read-only di UI.
9. Verifikasi/perbaiki anomali `SetMerchantDeletePin` field mapping.
10. Grantmap per-user + account-picker (ganti single-slot).

### P1 — sprint berikut

Pre-auth flow (Q-A) + `{merchantId,terminalCode}` (Q-J); E25 QR issuance; E05 drop-vs-implement; halaman web Terminal + staff-PIN-reset + QR-issue; taksonomi PIN A/B/C/D + migrasi re-enroll + lockout seragam + audit atributif (`approved_by`); `GET /pos/bootstrap` + pagination-loop + matriks konflik §5.7 API-CONTRACT; voucher single-picker + stacking; payment 4-metode + EDC-map; void/refund wire; table status-API + gabung-bill; stock-hub badge + threshold; template-sharing Kasir/Dapur snapshot.

### P2 — hardening

KDF naik (bcrypt ≥11 / PBKDF2/argon2, hapus AsyncStorage-fallback, fail-closed tanpa SecureStore); throttle persisten; retensi audit (90 hari vs 1 tahun) + endpoint GET + purge; SSE-vs-WS final; copies/failover/priority; kanonisitas mobile (`genfity-order-app` vs `apps/pos-mobile` — satu diarsipkan); verifikasi e2e penuh (`go build ./...`, `goose validate`, `tsc` app+web, kick-2-HP, SSE kedua view, push Real-Mode ke Go).

---

## 6. Usulan kontrak API (delta dari E01–E28)

**Tambah:** `E06 POST /api/v1/auth/logout {sessionId}` (atau kanoniskan `/api/auth/logout`); `E25 POST /api/v1/auth/login-qr` (tukar token sekali pakai issuance-main); `E23 POST /api/v1/approvals` + `E24 GET /api/v1/audit/owner-actions`; shift/cash terminal-scoped (`POST /terminals/{id}/shifts/open`, `POST /shifts/{id}/close`, `GET current`); `GET /pos/bootstrap` (menu+stok/addon/kategori/meja/member/voucher/pajak-fee/payment + revision/domain + `deletedIds`, dukung `?since&limit&cursor`); tabel `idempotency_keys` (replay 200, 409 hanya `SALE_DISPLAY_CONFLICT {existingOrderId}`); `GET /api/v1/terminals/{id}/occupant` (atau drop resmi → SSE snapshot).
**Putuskan:** E05 drop-vs-implement; E13 (alias vs route khusus — usulan: generic PATCH kanonis); E17–E22 (adapter tipis vs retire → merchant `/staff` + workforce); E08 (atau dokumentasikan merchant-prefix kanonis).
**Standarkan:** envelope SSE `{id,event,version,scope,data}`; routing tag (§F6); matriks konflik offline (§D4.5); versioning (`/api/v1` additive-only, breaking → `/api/v2` + sunset + fixture `terminal-login.json`, `terminal-bind.json`, `branch-terminals.json`, `queue-events.json`).

## 7. Usulan skema DB (migrasi goose baru, satu perubahan logis per file)

1. `pos_staff_terminal_access (merchant_id, terminal_id, user_id, granted_by, created_at)` + `UNIQUE(terminal_id,user_id)`.
2. Partial unique `pos_terminals_one_queue_per_merchant (merchant_id) WHERE tag='view_queue' AND is_active` (+ migrasi konsolidasi).
3. Backfill `tag NOT NULL DEFAULT 'full_access'`.
4. `idempotency_keys (merchant_id, key UNIQUE, response, created_at)` + TTL/purge.
5. Login-PIN global (level users) + `pin_class` pada PIN per-branch; pisahkan SecureStore mobile `genfity.pin.login.<uid>` vs `genfity.pin.authz.<merchant>.<uid>`.
6. `approved_by_user_id` pada void/refund/delete (ganti boolean); tambah kolom `branchmenu` (`track`, `allowSellEmpty`); tambah kolom version/revision per baris master (atau tabel revision per-domain).
7. Tambah `username` unik di users **bila** Q-L memilih username (jika email-only resmi, selaraskan invite/create-staff).
8. Format goose sesuai `CLAUDE.md` (Up/Down, `StatementBegin/End`, tanpa inline CHECK pada `ADD COLUMN`, tanpa subquery di partial index).

## 8a. Keputusan user (2026-10-17) — sudah diambil, mengikat implementasi

1. **Pre-auth = login-first (Q-A terjawab).** Login username/email+pw dulu; bila kredensial benar, server kembalikan list merchant → user pilih merchant → tampilkan list terminal merchant itu. Implikasi: E01 butuh varian **login tanpa `terminalCode`** (kembalikan `branches[]` + `terminals[]`), lalu pilih terminal + PIN terminal + PIN login. Tabrakan `terminalCode` lintas merchant teratasi karena terminal di-scope per merchant terpilih.
2. **PIN hybrid lokal + server-sync (Q-C terjawab).** Verifikasi lokal untuk kecepatan (shift), server sebagai source of truth; **saat sync, cek apakah PIN berubah** — bila versi server lebih baru, invalidate cache lokal dan paksa re-verifikasi/re-enroll. Implikasi: tiap PIN butuh `version`/`updated_at` yang ikut di payload sync + endpoint cek-versi ringan; aturan invalidate ditulis eksplisit (kasir tidak boleh terkunci diam-diam — tampilkan "PIN berubah, hubungi owner/supervisor").
3. **Mobile kanonis = `genfity-order-app` (Q-I terjawab).** Semua pekerjaan terminal/bind/print/offline-first di sini; `genfity-order-main/apps/pos-mobile/` diarsipkan/dihapus agar tidak ganda.
4. **1 cabang = 1 merchant (Q-J/Q4 terjawab).** Merchant main dan merchant cabang masing-masing 1 row `merchants` yang berdiri sendiri; **yang digabung ke main hanya penagihannya (billing)**. Implikasi: scope `merchant_id` untuk PIN per-branch, view_queue 1/cabang, dan terminal tetap sah; butuh mekanisme **grouped-billing** (satu tagihan main mencakup cabang-cabang) sebagai concern terpisah — belum diaudit, masuk backlog.

## 8. Pertanyaan klarifikasi (butuh jawaban sebelum implementasi)

1. **Pre-auth picker:** (a) publik-terbatas, (b) ketik-code→E01→picker, (c) claim-token sekali pakai? (Q-A)
2. **PIN terminal** strict-gerbang vs advisory? (Q-B) — **PIN staff** server-verify vs gesture-lokal? (Q-C)
3. **QR-login:** issuance-main short-lived single-use vs kredensial-dalam-QR? TTL? (Q-D)
4. **Unbind:** owner-only vs staff boleh keluar-resto + PIN-terminal-tujuan? (Q-E/Q14)
5. **E05 occupant:** implement vs drop → SSE-snapshot saja? (Q-F)
6. **Multi-akun:** grantmap per-user + picker vs single-slot? (Q-G)
7. **Scope web:** main masuk scope (halaman Terminal/Staff-PIN/QR + proxy `/api/v1`) atau API-only? (Q-H)
8. **Mobile kanonis:** `genfity-order-app` vs `genfity-order-main/apps/pos-mobile` — mana diarsipkan? (Q-I)
9. **Model cabang:** `merchants.id` = cabang vs `merchant_branches`? `terminalCode` global-unik vs `{merchantId,code}`? (Q-J/Q4)
10. **Offline-after-kick 7 hari:** terima vs mitigasi (TTL kecil/strict-online)? (Q-K)
11. **Identity:** `users.username` unik vs email-only resmi? Staff tanpa email langsung ACTIVE? Owner tetap `email_verified`? (Q-L/Q1/Q2)
12. **RBAC terminal:** akses per-terminal / per-tag / per-branch? Owner bypass? Pairing owner-only vs staff-settings? View yatim blokir vs banner? (Q3/Q5/Q6)
13. **Event kasir-vs-dapur:** filter-app cukup vs pancar topik terpisah + filter-server? (Q7)
14. **Retensi audit** 90-hari vs 1-tahun + endpoint GET + purge? QR-login HIDE vs build-now? (Q8/Q9)
15. **PIN:** 1 PIN lintas-cabang vs per-cabang-sync? Login-PIN vs authz-PIN terpisah? `delete_pin` = `owner_pin` vs terpisah? Print perlu PIN-gate? Panjang unifikasi 6-digit? Panjang migrasi tanpa lockout kasir?
16. **Sync:** harga server-wins vs toleransi+supervisor? Oversell tolak-vs-backorder + hold? Retensi 7-hari samakan? `displayNo TRX-{BRANCH}-{TERM}-{YMD}-{NNNN}` final + re-issue auto? Voucher offline final-lokal vs online-only? Setuju `idempotency_keys` + `/pos/bootstrap`? SSE+revision cukup vs WS-dua-arah?
17. **POS-core:** deposit = metode ke-5 vs hidden? Marketplace-mode keep vs TAKEAWAY/DELIVERY+channel (apakah `orders_pos_create` terima channel hari ini)? Voucher-cache offline boleh? Discount hak kasir + stacking? Merge endpoint vs emulasi? KDS WS-actions + status kanonis? Display-protocol unifikasi? Points overlay drop vs rekonsiliasi?
18. **Print:** app = bridge-device (claim/ack) vs direct-only? Auto-print default + dapur-bunyi-vs-cetak? Edit template web-only vs app-edit? Copies/failover v1? Foreground-WS always-on (baterai)? Paper/cutter ikut station vs template? Logo/QR format jaminan? Companion bridge dipertahankan?

## 9. Rencana verifikasi (sebelum klaim selesai)

`go build ./...` · `goose -dir internal/db/migrations validate` (up+down) · `make sqlc-generate` + `npx tsc --noEmit` (app+web) · uji: login staff tanpa email, staff tanpa akses ditolak 403, pair kedua 422, view_queue kedua ditolak, SSE `?token=` kedua view, kick 2 HP fisik, push Real-Mode ke Go, re-issue displayNo, void/refund idempoten replay.

---

*Disusun dari audit paralel 7 dimensi (256 tool-uses, 8 agen) lintas ketiga repo. Keputusan pada §8 menentukan bentuk implementasi; P0 pada §5 adalah prasyarat keamanan sebelum merge print-bridge dan pembukaan akses staff.*
