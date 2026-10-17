# Gap Analysis — Model Terminal/PIN Genfity vs Implementasi

Tanggal: 2026-10-17 · Status: **keputusan model FINAL, belum ada perubahan kode**
Sumber normatif: spec product owner (paste 2026-10-17) + jawaban 8 keputusan final.
Metode: audit paralel 6 dimensi + verifikasi silang ke kode (file:line di bawah).

---

## 1. Keputusan final yang mengikat

1. **5 tag terminal**: `kasir`, `dapur`, `view_pelanggan`, `view_queue`, `full_access` (tag ke-5 = Full Access).
2. **Tutup shift = PIN staff** (ikut spec; kode saat ini wajib owner = salah, harus diubah).
3. **Kasir/dapur/full_access = FULL fitur semua**, beda hanya notifikasi/event. Nav-lock DAPUR yang ada sekarang **harus dicabut**. View pelanggan & view queue tetap terkunci (sidebar hanya halamannya, sisanya hide).
4. **Transport**: SSE untuk satu arah (tanpa timbal-balik, cth. view/queue), WS bila butuh dua arah, kombinasi SSE+API dimungkinkan, **polling = fallback bila gagal**.
5. **Login staff = username + password, lalu MODAL PIN pasca-login** (3 faktor berurutan; PIN bukan pengganti password).
6. **Picker branch/terminal di bind-time**; HP terikat pindah branch via tombol **REBIND / keluar-branch**.
7. **Kick = last-writer-wins**: tolak sesi lama, terima login baru, **notifikasi ke perangkat yang baru login**. Tabrakan dua-HP-offline diselesaikan saat reconnect — login fresh menang.
8. **Printer di-scope per `{branchId, terminalCode}`**; ganti branch/rebind = pairing ikut terminal.

---

## 2. Trio temuan kritis (dari temuan lapangan, terkonfirmasi di kode)

### A. Dua HP offline bersamaan akan tabrakan nomor TRX

- Gejala: nomor `TRX-YYYYMMDD-NNN` dicetak per-device tanpa segmen terminal, dan dipakai sebagai **primary key**. Saat merge/sync, baris yang kalah **hilang diam-diam** via `INSERT OR IGNORE`.
- Akar: counter lokal per-device + PK = nomor human-readable. Dua device offline = dua counter yang sama-sama mulai dari NNN yang sama.
- Dampak: penjualan hilang tanpa jejak; struk tercetak tapi data tidak ada. Belum ada resolusi konflik untuk edit bill yang sama dari dua device.
- Arah perbaikan: §3 (UUID + penomoran otoritas server). Tidak bisa ditambal dengan segmen saja tanpa mengubah PK.

### B. Printer tidak ter-scope branch/terminal

- Gejala: pairing printer bersifat global per-device. Printer branch A terbawa saat sesi pindah ke branch B.
- Akar: tidak ada namespace `{branchId, terminalCode}` pada penyimpanan pairing; tidak ada konsep "1 device = 1 terminal = 1 printer" yang ditegakkan.
- Dampak: struk kasir tercetak di printer cabang lain; dapur menerima tiket yang bukan miliknya.
- Arah perbaikan: namespaced key `genfity.printer.{branchId}.{terminalCode}` + re-pair wajib saat rebind/ganti branch + validasi sebelum cetak (terminalCode header vs pairing aktif).

### C. Display bisa kabur

- Gejala 1 (backdoor): peran DISPLAY masih memegang menu **Settings**, dan dari Settings role bisa di-switch ke KASIR penuh. Kunci display = hiasan.
- Gejala 2 (offline penuh): CustomerDisplay mem-poll SQLite lokal tiap 10 detik (`CustomerDisplayScreen.tsx:67-111`), sehingga jalan offline penuh — padahal spec: view = online-only SSE.
- Gejala 3 (lubang navigasi): CTA IdleScreen → `navigate('Cashier')` tanpa cek role (`IdleScreen.tsx:62-68`); hanya self-healing ±60ms via listener App.tsx. Tombol operator `callNext` hidup di layar yang seharusnya view-only.
- Arah perbaikan: peran terkunci (PELANGGAN/QUEUE) tidak membuka Settings-role-switch tanpa PIN owner/terminal; hapus/gate `callNext`; cek role di `goCashier`; display tanpa data lokal (no-poll) + banner offline + SSE dengan fallback polling.

---

## 3. Best practice: identitas sale offline (rekomendasi final)

**Keputusan: UUID sebagai primary key + nomor human-readable sebagai display-only otoritas server.**

| Lapisan | Bentuk | Contoh | Otoritas |
|---|---|---|---|
| Primary key (merge-safe) | UUID v7 (time-ordered) | `0193…` | Client (dibuat offline, tabrakan mustahil) |
| Nomor struk provisional (offline) | Per-terminal sequence | `TRX-B001-K01-0042` | Device, ditandai sementara |
| Nomor struk kanonis | `TRX-YYYYMMDD-NNN` | `TRX-20261017-015` | **Server, saat sync** |

Alasan:

1. **UUID menghilangkan seluruh kelas tabrakan.** Dua HP offline selamanya tidak akan menghasilkan PK yang sama. `INSERT OR IGNORE` berhenti menelan data — yang ada hanya dua baris berbeda yang sama-sama sah.
2. **Nomor cantik tidak boleh jadi PK.** Syarat nomor cantik (urut, pendek, harian) justru berlawanan dengan syarat PK offline (unik tanpa koordinasi). Mencampur keduanya = bug A di atas. Pisahkan: mesin pakai UUID, manusia pakai nomor server.
3. **Segmen-terminal saja tidak cukup.** `TRX-{terminal}-NNN` mencegah tabrakan antar-device, tapi tidak menyelesaikan: (a) reinstall/reset counter mengulang NNN, (b) dua shift/kasir di terminal yang sama, (c) lubang audit saat nomor dipakai ulang. UUID menutup ketiganya sekaligus.
4. **UUID v7, bukan v4.** Time-ordered = index SQLite/Postgres tetap performant (locality), tetap bisa di-sort kronologis tanpa kolom tambahan.
5. **Reuse idempotencyKey yang sudah ada.** `sync.ts` sudah punya antrean offline + `idempotencyKey` — isi dengan UUID yang sama. Retry/reconnect tidak akan menduplikasi sale di server.

Alur cetak offline: struk keluar dengan nomor provisional + (opsional, bisa diputuskan kemudian) penanda kecil "sementara". Saat sync berhasil, server mengembalikan nomor kanonis; riwayat/reprint menampilkan nomor kanonis; UUID tetap jadi kunci relasi selamanya. Edit bill yang sama dari dua device: last-writer-wins per-field dengan `updatedAt` + UUID baris (konsisten dengan kebijakan kick §1.7).

Konsekuensi skema (dicatat untuk Fase 2, bukan dikerjakan sekarang): tambah kolom `uuid` (lalu promosikan jadi PK), `trx_no` nullable sampai server mengisi, `trx_provisional` untuk nomor sementara. Struk membaca `trx_no ?? trx_provisional`.

---

## 4. Tabel gap spec-vs-kode (18 baris)

Legenda: OK = pertahankan · PARTIAL = setengah jalan · MISSING = belum ada · CONTRADICTS = kode melawan spec.

**Identitas & RBAC**

| # | Poin spec | Status | Bukti kode |
|---|---|---|---|
| 1 | Staff relasi multi-branch | MISSING | `ms_posuser.branchId` kolom tunggal; semua seed B001; tanpa junction table (`dbSchema.ts:14-16`) |
| 2 | Pilih branch saat login bila >1 | MISSING | LoginScreen hanya username+PIN+QR; pilih cabang hanya di alur install |
| 3 | RBAC akses-terminal | MISSING | `access.ts` hanya kunci aksi; body login `{username,pin}` tanpa identitas terminal |
| 4 | Role kanonis Owner/Staff | OK | `access.ts:29-61` + normalizer legacy; pertahankan, tolak role tak dikenal eksplisit |

**Ikatan, claim, presence**

| # | Poin spec | Status | Bukti kode |
|---|---|---|---|
| 5 | PIN terminal terpisah | MISSING | Klaim = kode + deviceID (`InstallScreen.tsx:27,32`; `apiSource.ts:310-324`); grep `terminalPin/pinTerminal` nihil |
| 6 | Ikatan device-terminal persisten lewat logout | OK | `genfity.server.terminal` + `genfity.device.id` stabil; logout hanya hapus sesi |
| 7 | Welcome merchant+terminal di login | MISSING | Sapaan generik "Selamat Datang Juragan!"; nol pemakaian `getTerminal()` di LoginScreen |
| 8 | Claim logout-kan user lama | MISSING | `loginEmployee` menimpa buta; nol handler kick; satu-satunya "KICK" di repo = tendangan laci kasir |
| 9 | 1 user di N terminal | OK | Body login tanpa deviceID; authKey dibuang; login local-first per-device independen |

**PIN & atribusi**

| # | Poin spec | Status | Bukti kode |
|---|---|---|---|
| 15 | Tutup shift = PIN staff | CONTRADICTS | `EndShiftScreen.tsx:47-58` menolak PIN Staff via `settings.edit` khusus Owner |
| 16 | PIN owner universal | PARTIAL | `verifyAttendancePin` loop semua user (bisa untuk absen/buka-shift), tapi login form per-username sehingga PIN owner tak bisa dipakai sebagai user lain |
| 17 | Pemakaian PIN owner terekap | PARTIAL | Kompliment offline catat approver; void keranjang & cancel buang `userId` pemegang PIN; shift-close tanpa kolom penutup; jalur server anonim |

**Tag, peran, display, transport**

| # | Poin spec | Status | Bukti kode |
|---|---|---|---|
| 11 | 5 tag + full access | CONTRADICTS | Hanya `KASIR/DAPUR/DISPLAY` (`deviceRole.ts:15`); checker/label cuma peran printer; `FULL_ACCESS` nol hit |
| 12 | Kasir & dapur full; view terkunci | PARTIAL | DAPUR terkunci (harus dibuka); DISPLAY bocor: 3 tab + `callNext` + CTA Idle→Cashier tanpa cek role |
| 13 | Ubah peran butuh PIN/hak | PARTIAL | `pickRole` di balik `settings.edit` + fail-open saat DB error; tanpa PIN; server bisa override via `syncTerminalSettings` |
| 14 | Pairing 1:1 kasir-display; queue level branch | MISSING | Query display global per-branch; `publishDisplayOrder` nol pemanggil; tanpa route Queue; QR bayar statis |
| 18 | Transport per-tag + event terpisah | PARTIAL | WS ada tapi **mati total di non-custom env** (`realtime.ts:84-86`); SSE nol implementasi; filter broadcast tag-blind; `notifyLocal` tanpa tag |

---

## 5. Kontradiksi antar-temuan yang sudah diputus

- K1 `allowedRoutesFor` **dipakai** di navigator (App.tsx:196-231), bukan dead code — klaim dead-code keliru karena pemakainya di root repo, di luar `src/`.
- K2 DAPUR terkunci di kode vs full di spec → **spec menang** (keputusan #3).
- K3 WS ada tapi di-gate custom-only → default prod = tanpa WS; display hidup dari polling. Putuskan arsitektur transport default sebelum kontrak kick/SSE ditulis.
- K4 Pilih-branch hanya di install + urutan terbalik (kode-terminal dulu, branch belakangan) vs spec (branch→terminal→PIN terminal) → ikut spec + tombol rebind.
- K5 Tutup shift owner-only di kode vs PIN-staff di spec → **spec menang** (keputusan #2).

---

## 6. Roadmap (belum dieksekusi)

- **Fase 1 — fondasi (app-only)**: 5 role perangkat 1:1 dengan tag; cabut lock DAPUR; kunci PELANGGAN/QUEUE (tutup backdoor Settings, `callNext`, CTA Idle); tutup shift PIN staff; modal PIN pasca-login; sapaan merchant+terminal.
- **Fase 2 — identitas offline**: UUID v7 PK + nomor provisional/kanonis (§3); printer scope per `{branchId, terminalCode}`; tombol rebind/keluar-branch; kolom audit approver (`closedBy`, pemegang PIN void/cancel).
- **Fase 3 — presence (butuh BE)**: endpoint occupant/bind + push `SESSION_KICKED` + handler `logout()` + 401 session-taken; pilih branch saat login; relasi multi-branch; RBAC akses-terminal.
- **Fase 4 — display**: model pairing kasir-display; layar queue level branch; SSE + fallback polling; QR bayar dinamis per order; view = no-local-poll + banner offline.

## 7. Kontrak BE yang dibutuhkan (di luar repo app ini)

`bind/unbind/occupant`, PIN terminal verify, `SESSION_KICKED`, `auth/supervisor-approve` (aturan 6-digit + pemilik per outlet/merchant), penomoran kanonis saat sync, daftar branch+terminal per staff, RBAC akses-terminal. Repo Go saat ini belum punya entitas terminal — domain terminal harus dibangun backend-first.

## 8. File kunci

`App.tsx`, `src/session.ts`, `src/lib/deviceRole.ts`, `src/lib/access.ts`, `src/lib/pin.ts`, `src/lib/supervisor.ts`, `src/lib/apiSource.ts`, `src/config/server.ts`, `src/screens/auth/LoginScreen.tsx`, `src/screens/install/InstallScreen.tsx`, `src/screens/shift/ShiftScreen.tsx`, `src/screens/shift/EndShiftScreen.tsx`, `src/screens/display/CustomerDisplayScreen.tsx`, `src/screens/display/IdleScreen.tsx`, `src/lib/display.ts`, `src/lib/realtime.ts`, `src/lib/push.ts`, `src/lib/terminal.ts`, `src/components/DrawerMenu.tsx`, `src/navigation/types.ts`.
