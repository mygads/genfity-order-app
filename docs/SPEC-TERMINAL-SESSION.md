# SPEC Terminal Session — Bind → Login → Kick (Acuan Implementasi)

> Turunan terkunci dari `docs/AUDIT-TERMINAL-RBAC.md` §7–§12. Semua keputusan Q1–Q15 yang CLOSED sudah dilipat ke sini.
> Status: DRAFT acuan — App + BE mengimplementasikan dokumen ini. Belum di-commit.

---

## 1. Kosakata kanonis

- **Tag** (`terminalTag`, lowercase, selalu terisi satu): `kasir | dapur | view_pelanggan | view_queue | full_access` (label "Full Access" untuk yang terakhir; parse case-insensitive).
- **PIN** (tiga, tidak tercampur):
  - `terminalPin` — per terminal, diset owner. Hanya untuk bind/re-bind device. Tidak pernah untuk login.
  - `staffPin` — per akun staff (setting di BE). Untuk login (modal), absensi, buka shift, tutup shift.
  - `ownerPin` — per akun owner. Superset staffPin + approval `void | cancel | compliment`. Setiap pemakaian tercatat (audit trail).
- **Kunci sesi**: triple `(userId, terminalId, deviceId)`. Aturan: 1 terminal = 1 user aktif; 1 user boleh di N terminal; 1 device terikat 1 terminal.

---

## 2. State yang disimpan di device

| State | Isi | Storage | Umur |
|---|---|---|---|
| Binding | `{terminalId, terminalCode, branchId, branchName, merchantName, tag, pairedKasirId/pairedViewId, boundAt}` | SQLite + tampil di login screen | Persist sampai unbind/re-bind |
| Session | `{userId, nama, role, authToken, terminalId, branchId, loginAt}` | SecureStore (token) + SQLite | Sampai logout / kick / revoke |
| Grant cache | `{userId, terminalId, deviceId, staffPinHash, grantedAt, expiresAt}` | SecureStore (hash) + SQLite | 7 hari sliding (`max_offline_grant_days`, default 7, via terminal-settings server-wins) — sliding hanya diperpanjang saat otorisasi online; login offline tidak memperpanjang |
| Display counter | `{(terminalCode, date) → lastSeq}` | SQLite meta | Per hari |

- Login pertama di device (atau grant kedaluwarsa) **wajib online**. Tidak ada grant bawaan.
- Logout = revoke server-side (`E06`); binding + grant cache tetap (grant cache tetap sampai expiry Alami, agar login ulang offline masih bisa).

---

## 3. Flow B1 — Bind fresh device (sekali)

```
Welcome-Unbound → BranchPicker (GET E07, user sudah pre-auth? TIDAK —
  bind butuh identitas: langkah 0 = input username+password owner/staff
  yang valid ATAU kode klaim owner; DIPUTUSKAN: pakai kredensial + PIN terminal,
  lihat catatan) → TerminalPicker (GET E09) → TerminalPin (POST E03 atomik
  verify+bind) → Bound (simpan binding, tampil sapaan) → Flow L1
```

- `E03 bind` gagal (PIN salah / terminal sudah terikat device lain / butuh owner) → error eksplisit, tidak ada fallback diam-diam.
- Bind atomik E03 (verify+bind satu transaksi, tanpa tulis-parsial); **dilarang** menulis binding manual ke store (fail-closed).
- Re-bind device yang sudah ter-bound ke terminal lain = Flow R1 (bukan B1).

## 4. Flow L1 — Login di device ter-bound (per sesi; SINGLE-STAGE — koreksi 2026-10-17)

```
Login screen ("Selamat datang di {merchant} — {terminal}")
 → form username+password → POST E01
 `{username,password,terminalCode,deviceId}`
 → LANGSUNG sesi penuh (session + JWT pair + tag + branches + terminals
 + grant triple 7-hari + tookOver?) → modal staffPin VERIFIKASI LOKAL
 (passesLocalWorkforcePin vs workforce-PIN record; seed-sekali saat login
 pertama) → session dibuat (+ grant offline 7 hari + notice kicked_msg
 bila tookOver)
```

- Rincian endpoint (RoE live 2026-10-17 — `E01 POST /api/v1/auth/terminal-login` SINGLE-STAGE; arah 2-tahap `credentialOk/requiresPin` + `staffPin` tahap-2 yang "diverifikasi server" DICABUT, riwayat di §14): `{username, password, terminalCode, deviceId}` → `{session, branches[], terminals[], terminal, tag, pairing, grant, authKey/accessToken/refreshToken, tookOver?}`. `staffPin` BUKAN bagian kontrak (server abaikan field tak dikenal); app TAK PERNAH mengirim PIN staff ke server. Sisa defensif: bila server menjawab kredensial-ok TANPA materi sesi (tak terjadi di BE live), app refetch jujur TANPA `staffPin`, PIN tetap gerbang lokal.
- **Okupansi**: bila terminal terisi user lain → server revoke sesi lama + respons `{tookOver:{kickedUserId}}` → app tampilkan notifikasi takeover ke **user baru** (notice `kicked_msg`; "Anda mengambil alih terminal X; sesi sebelumnya diakhiri"). TAK ADA frame `SESSION_KICKED` push ke device lama sisi server (klaim lama DICABUT 2026-10-17) — device lama belajar via event `takeover` pada feed SSE terminalnya (user/device event ≠ sesi sendiri → notice + logout; watcher sesi `startTakeoverWatch` di `App.tsx`). 401 BUKAN bukti kick (grant terminal tak dibaca middleware auth; kick tak merevoke user_sessions) — 401 = gagal auth final → re-login.
- **Offline**: lewati E01; cek grant cache (user+terminal+device cocok, belum expiry) + cocokkan PIN ke hash → session lokal bertanda `offline:true`. Konflik sesi diselesaikan server saat reconnect (baru menang).

## 5. Flow R1 — Re-bind / keluar branch

- Entry: tombol kecil di bawah sapaan login screen ter-bound + tombol di Settings ("Ganti terminal / keluar branch").
- Otorisasi: PIN terminal tujuan (wajib). + owner? → **Q14 TERBUKA** (default usulan: PIN terminal cukup; unbind binding lama otomatis + notifikasi ke device lama bila reachable).
- Efek: binding lama dicabut (server `E04`), grant cache lama dihapus, session aktif di-logout-dulu, lanjut B1-langkah-picker (branch boleh beda). Unbind+bind lewat endpoint; dilarang mengedit store binding manual.

## 6. Flow K1 — Kick (detail; koreksi 2026-10-17 — TAK ADA frame push sisi server)

1. Server tandai sesi lama `revoked{reason:takeover, by:userId, at}` + tulis audit log.
2. Server kembalikan `tookOver{kickedUserId}` (+ takeover terminal event) ke device BARU — user baru dikabari (`kicked_msg`; jalur refetch defensif: modal konfirmasi takeover).
3. Device LAMA belajar TANPA push: event `takeover` pada feed SSE terminalnya (tipe mengandung `takeover`, user/device event ≠ sesi/binding sendiri → `startTakeoverWatch` di `App.tsx` → notice `kicked_msg` + cabut sesi+grant lokal); pesan WS yang cocok pola kick/takeover/revoke/logout juga memicu pencabutan lokal sisi-klien (`realtime.ts` + `App.tsx`, future-proof). 401 BUKAN bukti kick — 401 = gagal auth final → re-login. Klaim lama "push `SESSION_KICKED {terminalId, byName, at}` (bila offline → antre)" DICABUT — frame itu tak ada sisi server.
4. Sesi baru berjalan normal; audit trail takeover tersimpan (`E24` mencakup event takeover).

- Status app-side 2026-10-17 (terverifikasi grep `src/`): sisi user BARU wired — `LoginScreen` mengunci sesi dari respons pertama + notice `kicked_msg` untuk `tookOver{kickedUserId}` (jalur refetch defensif: modal konfirmasi takeover confirm-before-session). Listener device LAMA WIRED DUA lapis: (1) watcher sesi `startTakeoverWatch` di `App.tsx` atas event `takeover` SSE terminal (notice `kicked_msg` + `revokeKickedSession`); (2) `realtime.ts` `emit()` + handler `onWsMessage` di `App.tsx` untuk pesan kick/takeover yang cocok pola sisi-klien (logout lokal + Alert `kicked_msg`, semua tag; `revokeKickedSession` + `setKickNotice` + notifikasi lokal ke Login). Koreksi 2026-10-17: lapis ketiga yang dulu diklaim (401-guard `reportBoundTerminal401` di semua fetcher `terminalApi.ts`) DIHAPUS — salah diagnosis (401 token kedaluwarsa dikira kick) dan tak pernah menembak kick nyata. Device lama yang offline belajar saat reconnect/login berikut (server sudah menandai sesi revoked).

## 7. Flow O1 — Logout

- `E06 POST /api/v1/auth/logout {sessionId}` → server revoke (anti zombie-sync). Gagal jaringan → tandai `pendingRevoke`, coba lagi saat online (outbox ringan). Status app-side 2026-10-17: store `pendingRevoke` wired (`session.ts`, `sync.ts`, `SyncScreen`); helper `logoutRevoke` (`terminalApi.ts`) WIRED — fire-and-forget di `DrawerMenu` + `flushPendingRevokes` via E06 di `sync.ts` (dipanggil akhir `pushAll` sukses + login sukses di `LoginScreen` + boot di `App.tsx`). Unbind `E04` WIRED app-side — inline `apiFetch(ApiPath.terminalUnbind)` di `SelectBranchScreen` `exitBranch` (best-effort sebelum `exitBranchAll`); catatan: tak ada fungsi bernama `terminalUnbind`, acuannya konstanta path `ApiPath.terminalUnbind` di `server.ts`.
- Binding + grant cache tetap. Landing: login screen ter-bound (profil view terkunci → kembali ke display terkunci, bukan form login — `navgate-11`).

## 8. Transport per profil (kebijakan §11.4)

| Profil | Primer | Sekunder | Fallback gagal | Aksi sensitif saat tidak-live |
|---|---|---|---|---|
| view_pelanggan | SSE `E26` (cart + QR dari kasir pasangan) | API load awal/resync | Poll berpenanda stale | QR/bayar DIBLOKIR + banner umur data |
| view_queue | SSE `E27` (feed branch) | API load awal/resync | Poll berpenanda stale | call/ready hanya indikator |
| kasir | WS dua-arah + API + auto-sync 5 mnt | SSE event masuk | SQLite offline penuh | Jalan penuh offline |
| dapur | SSE kitchen-incoming + WS | API + auto-sync | SQLite offline penuh | Jalan penuh offline |
| full_access | Keduanya (kasir + dapur) | — | SQLite offline penuh | Jalan penuh offline |

- Publish live-cart kasir→display via WS (`publishDisplayOrder` dipanggil dari `saveSale` — `realtime-06`).
- `callNext` operator via server-acked event (versi/nomor) agar display se-branch tidak divergen (`realtime-14`).

## 9. Topik event

- `online-order-incoming` → kasir, full_access
- `kitchen-incoming` / `order-accepted` → dapur, full_access
- `cart-view` / `payment-qr` (scope pasangan kasir) → view_pelanggan
- `queue-update` / `call` / `ready` (scope branch) → view_queue
- `PRINT_RECEIPT` / `PRINT_TICKET` (TBD Q8) → target terminalId
- ~~`SESSION_KICKED` → target terminalId~~ — DICABUT 2026-10-17: frame push ini TAK ADA sisi server. "kick/takeover" hanya pola pencocokan sisi-klien (`realtime.ts`/`App.tsx`, future-proof) atas pesan WS yang ada + `tookOver{kickedUserId}` di respons login ke device baru + event `takeover` SSE terminal untuk device lama; 401 BUKAN bukti kick (lihat §6).

## 10. Matriks navigasi per tag (Q5 CLOSED)

- kasir/dapur/full_access: drawer penuh (cabut nav-lock DAPUR/DISPLAY eksisting).
- view_pelanggan: sidebar HANYA CustomerView. Tanpa Settings/role-switch/cashier-entry/kontrol operator; exit hanya via aksi owner terautentikasi.
- view_queue: sidebar HANYA QueueView.
- Implementasi: allowlist per tag (default-allow 3 tag penuh, default-deny 2 tag view) + ketik rute per profil agar backdoor gagal saat compile (`navgate-12`).
- Tag efektif = nilai server (`terminalTag` via pull-terminal-settings / E13, server-wins); nilai lokal hanya fallback tampilan dan wajib ditimpa saat pull berikutnya berhasil.

## 11. Tabel endpoint final (App + BE)

| ID | Method | Path | Tujuan | Menutup temuan |
|---|---|---|---|---|
| E01 | POST | `/api/v1/auth/terminal-login` | Login SINGLE-STAGE (koreksi 2026-10-17, RoE live) — `{username,password,terminalCode,deviceId}` → LANGSUNG session + branches[] + terminals[] + terminal + tag + pairing + grant + authKey/accessToken/refreshToken; okupansi → `{tookOver:{kickedUserId}}` (baru menang, sesi lama terminal itu direvoke). `staffPin` BUKAN bagian kontrak (server abaikan field tak dikenal); gate PIN = verifikasi lokal app. Arah 2-tahap (`credentialOk/requiresPin` + `staffPin` tahap-2) dan bentuk `staff-login` tanpa identitas terminal DINYATAKAN DICABUT (riwayat salah arah di §14) | auth-01/03, SESS-04, Q11 |
| E02 | POST | `/api/v1/terminals/{id}/validate-pin` | Cek PIN terminal tanpa efek (UX bind) | auth-03 |
| E03 | POST | `/api/v1/terminals/{id}/bind` | Bind atomik `{pin,deviceId}` → binding + tag + pairing | SESS-03 |
| E04 | POST | `/api/v1/terminals/{id}/unbind` | Owner lepas binding (revoke) | SESS-09 |
| E05 | GET | `/api/v1/terminals/{id}/occupant` | Sesi aktif terminal (atau presence WS) | SESS-01/02 |
| E06 | POST | `/api/v1/auth/logout` | Revoke session (+ pendingRevoke offline) | SESS-07 |
| E07 | GET | `/api/v1/branches` | Branch milik user (branch picker) | auth-04/05/08 |
| E08 | POST | `/api/v1/branches` | Owner bikin branch | contract-branch-crud |
| E09 | GET | `/api/v1/branches/{id}/terminals` | Terminal picker → `[{terminalId,terminalCode,name,tag,pinSet,pairedKasirId,pairedViewId,verified}]` | auth-02 |
| E10 | POST | `/api/v1/branches/{id}/terminals` | Owner create `{name,tag}` (terminalCode ≤8 char, unik/branch) | termreg-no-crud, Q7 |
| E11 | PATCH | `/api/v1/terminals/{id}` | Ubah `{name,tag}` | termreg-no-crud |
| E12 | DELETE | `/api/v1/terminals/{id}` | Hapus/revoke (+ rotate terminalKey) | termreg-no-crud |
| E13 | PATCH | `/api/v1/terminals/{id}/tag` | Set 1 dari 5 tag | contract-tag-vocabulary |
| E14 | POST | `/api/v1/terminals/{id}/set-pin` | Owner set/rotate PIN terminal | contract-terminal-pin |
| E15 | POST | `/api/v1/terminals/{viewId}/pair` | Pair view→kasir (BE tolak view ke-2, E422) | termreg-pairing |
| E16 | DELETE | `/api/v1/terminals/{viewId}/pair` | Lepas pairing | contract-view-pairing |
| E17 | POST | `/api/v1/staff` | Create `{username,password,branchIds[]}` | contract-staff-crud |
| E18 | GET | `/api/v1/staff` | List staff owner | contract-staff-crud |
| E19 | PATCH | `/api/v1/staff/{id}` | Ubah `{branchIds[]}` / reset password/PIN | contract-staff-crud |
| E20 | DELETE | `/api/v1/staff/{id}` | Nonaktifkan staff (grant ikut hangus) | contract-staff-crud |
| E21 | GET | `/api/v1/staff/{id}/branches` | Branch satu staff | auth-04 |
| E22 | GET | `/api/v1/branches/{id}/staff` | Staff satu branch | contract-staff-crud |
| E23 | POST | `/api/v1/approvals` | Approval `{action:void\|cancel\|compliment, ownerPin, refId}` | SESS-05 |
| E24 | GET | `/api/v1/audit/owner-actions` | Rekap pemakaian PIN owner (+ takeover) | SESS-08, Q15 |
| E25 | POST | `/api/v1/terminals/{id}/login-qr` | QR login (TBD — Q2) | auth-10 |
| E26 | GET (SSE) | `/api/v1/terminals/{id}/events` | Feed SSE per terminal | realtime-01, contract-event-subscription |
| E27 | GET (SSE) | `/api/v1/branches/{id}/queue-events` | Feed SSE antrean per branch | realtime-04 |
| E28 | — | Policy `max_offline_grant_days` via terminal-settings | TTL grant server-driven (default 7) | Q6 |

Klarifikasi bentuk (tanpa endpoint baru, wajib sebelum koding): satukan `terminal/update` + `get-terminal` + v11 settings (§4 penutup); respons login/terminal selalu bawa `tag` + pairing + `branches[]` (§4.2).

## 12. Identitas sale offline (Q7 CLOSED — nilai final)

- PK: `client_id` UUIDv7. Display: `TRX-{BRANCH}-{TERM}-{YYYYMMDD}-{NNNN}` (contoh `TRX-B001-K01-20261017-0042`). Server upsert by `client_id`, `UNIQUE(display_no)`, konflik → 409 terlihat. Counter per (terminalCode, tanggal); unbound dilarang bikin sale. QR bawa `client_id`. Migrasi aditif (§12.1 audit).

## 13. Urutan implementasi (lihat §5 audit untuk acceptance per fase)
1. **BE dulu**: E07–E22 (branches/terminals/staff/pairing/PIN) + E01 + E26/E27 + kontrak §12 — App tidak bisa jalan tanpa ini.
2. **App Fase 1**: sesi + grant-cache + hapus fallback B001 + samakan kontrak.
3. **App Fase 2**: B1/L1/R1/K1/O1 + modal PIN + 5 tag + kunci view + QueueView + sapaan merchant-terminal.
4. **App Fase 3**: dispatcher per-tag + printer 1:1 scoping + antre cetak + UUID/counter + FIFO kausal.
5. **App Fase 4**: SSE primer + fallback berpenanda + watermark per-branch.

## 14. Catatan koreksi dokumen (2026-10-17, audit docs-only)

- **E01 = `terminal-login` (DG2/DG3 — `staff-login` DINYATAKAN DIGANTI, catatan audit awal)**. Riwayat: docs pernah memenangkan bentuk `staff-login` tanpa identitas terminal → dicabut → diganti arah "2 tahap via satu endpoint" (`terminalCode`+`deviceId` wajib di kedua tahap; tahap-1 `{credentialOk,requiresPin:true}`, tahap-2 + `staffPin` yang "diverifikasi server"). KOREKSI FINAL 2026-10-17 (probe BE live): arah 2-tahap itu SALAH — endpoint live adalah `POST /api/v1/auth/terminal-login` SINGLE-STAGE (sesi penuh langsung + grant triple 7-hari + `tookOver?`); `staffPin` bukan bagian kontrak (server abaikan field tak dikenal); gate PIN = verifikasi lokal app. §4, §6, §9, baris E01 §11, dan CONTRACT §9–§10 diselaraskan ke bentuk ini; butir audit awal di bawah dipertahankan sebagai riwayat.
- **K1 2026-10-17: TAK ADA frame `SESSION_KICKED` push sisi server.** Klaim lama (push ke device lama, antre bila offline) dicabut. Kick = revoke grant + `tookOver{kickedUserId}`/takeover event ke device BARU; device lama deteksi via event `takeover` SSE terminal (watcher sesi `startTakeoverWatch` di `App.tsx` → notice `kicked_msg` + cabut sesi lokal) + pencocokan pola kick/takeover/revoke/logout sisi-klien pada pesan WS (§6 dua lapis).
- **Koreksi K1 2026-10-17 (401→takeover):** arah "device lama deteksi via 401 pasca-sesi (`reportBoundTerminal401`)" DICABUT — kebenaran BE terverifikasi: tabel grant terminal tak dibaca middleware auth dan kick tak merevoke user_sessions, sehingga device yang ditendang TIDAK menerima 401 (401 = gagal auth final → re-login). 401-guard dihapus dari semua fetcher `terminalApi.ts`; catatan 2026-10-17 di atas dipertahankan sebagai riwayat.
- **Referensi E-number diselaraskan ke tabel §11 (tabel menang)**: §2 logout `E07`→`E06`; §3 BranchPicker `E08`→`E07`, TerminalPicker `E10`→`E09`, bind atomik `E04`→`E03`; §5 unbind `E05`→`E04`; §6 audit-takeover `E25`→`E24`; §7 logout `E07`→`E06`; §8 transport view_pelanggan `E27`→`E26`, view_queue `E28`→`E27`. Teks §9 sudah benar dan tidak diubah.
