# Daftar Colok-Akhir Printer (S10/PP-015, APP-side)

> Status: fixture + mock loopback DONE di cabang ini (uji: `node test/tripwire-printer.cjs`).
> Verifikasi fisik di bawah BELUM dilakukan — butuh dev-client/APK + perangkat
> nyata + owner di lokasi. DILARANG mengklaim "cetak lolos" dari probe web/loopback.

## 1. Yang sudah dibuktikan tanpa hardware (CI)

| Klaim | Bukti |
|---|---|
| Byte struk IDR/AUD/dapur/no-cut benar (ESC @ … GS V, `Rp 45.000` / `A$10.50`, dapur tanpa harga) | `test/tripwire-printer.cjs` menjalankan `buildReceiptBytes`/`buildKitchenTicketBytes` ASLI (transpile `src/lib/escpos.ts`) atas `test/fixtures/escpos-golden.json` |
| Payload antrean tak korup (base64 bolak-balik identik) | tripwire yang sama (`toBase64→fromBase64`) |
| Drawer-kick kanonis tak berubah | `toHex(buildDrawerKickBytes()) === DRAWER_KICK_HEX` |
| Cetak tanpa printer bisa diuji ujung-ke-ujung | `printBytes(LOOPBACK_TARGET, bytes)` → `getLoopbackJournal()`; antrean: `enqueuePrint(bytes, LOOPBACK_TARGET, …)` lalu `drainPrintQueue()` tanpa deps (send default = `printBytes`) |
| Antrean loopback tak macet diam-diam | `envelopeOf` menerima `transport: 'loopback'` (`src/lib/printqueue.ts`) — sebelumnya target dibuang jadi `null` → macet `'antre'` selamanya |

## 2. Yang TIDAK dibuktikan (batas jujur)

- **Loopback sukses ≠ kertas keluar.** Jurnal = memori (`LOOPBACK_CAP = 20`, hilang saat reload), bukan bukti printer fisik menerima byte.
- **Probe LAN (ESC @) ≠ cetak lolos.** `PrintersScreen` probe hanya membuktikan soket TCP tersambung.
- **Pratinjau/hex di Expo Go ≠ cetak.** Tanpa modul native, byte hanya ditampilkan.
- **Antrian `queued` ≠ tercetak.** `PrintOutcome.queued` = byte aman di `tr_printqueue`, BUKAN kertas keluar.

## 3. Plug-last: wajib perangkat fisik + dev-client/APK (butuh owner)

- [ ] LAN: uji cetak per station ke printer thermal Wi-Fi/Ethernet nyata (58mm + 80mm bila ada), autocut on/off.
- [ ] BT SPP: pairing MAC bonded → uji cetak nyata.
- [ ] BLE: scan → uji cetak nyata (butuh izin Android 12+).
- [ ] USB serial: dialog izin sistem → uji cetak nyata (VID/PID tercatat).
- [ ] Cash drawer: `openDrawer` → laci menendang fisik (kick via koneksi printer).
- [ ] Drain antrean ke printer nyata: enqueue saat printer mati → nyalakan → drain → kertas keluar + status `'cetak'`.
- [ ] Struk panjang (>1 halaman thermal) + logo raster + QR: tak ada byte terpotong/garbled.

## 4. Jalur server (BE terminal print-jobs FULL — server-wins)

- **Enqueue/claim/ack**: `POST /api/v1/terminals/{id}/print-jobs` → `POST .../print-jobs/claim`
  (FIFO atomik `SKIP LOCKED`, lease 120s) → `POST .../print-jobs/{jobId}/ack {PRINTED|FAILED}`.
  Klaim kosong → `204` (idle, tanpa cetak saat ragu).
- **Fan-out**: `POST .../print-fanout` → 1 request jadi N job (satu per station kind ≠ `dapur`;
  BE yang putuskan destinasi). Tanpa station bound → `404 STATION_NOT_FOUND` (jawaban benar).
- **Server-wins** (`src/lib/printBridge.ts pollServerPrintJobs`, tripwire-print-bridge hijau):
  byte yang dicetak = payload server (klaim), bukan echo lokal; lease basi → `409`, jangan retry buta.
  Job `AUTO` (payload kosong) = render dari order server + template BE (`printAutoServerJob`),
  JANGAN cetak byte kosong; order offline → ack `FAILED ORDER_UNAVAILABLE` (BE backoff).
  Penjaga byte-kosong (F-008-AUTO): `fromBase64('')` tak melempar — `pollServerPrintJobs`
  + jalur manual `PrintersScreen` menolak `bytes.length === 0` via ack `FAILED INVALID_PAYLOAD`
  tanpa `printFn`/`printBytes` (anti cetak-buta + anti ack PRINTED palsu; tripwire-print-bridge §7).
- **EDC/intent APOS**: di luar printer; tetap butuh perangkat (lihat PARITY M8/T10).

## 5. Simulasi tanpa printer fisik (F-008, hijau 2026-10-27)

Prosedur (tanpa dev-client/APK, tanpa ubah kode produksi; skrip rerunnable di
`../../_workspace/laporan/artifacts/F-008/f008-sim.cjs`):

1. Sesi terminal-auth (owner/K01; hormati limiter `terminal-login` 30/15 mnt/IP — reuse sesi hidup bila kena `429`).
2. Bangun byte struk MANUAL via builder asli (`src/lib/escpos.ts`, marker unik) → enqueue
   (`idempotencyKey` unik) → `201 QUEUED`.
3. Claim → verifikasi payload server IDENTIK (byte + marker) → `printBytes(LOOPBACK_TARGET, bytes)`
   (jurnal memori, §2) → ack `PRINTED` → claim → `204`.
4. Fanout MANUAL → catat hasil jujur (`404 STATION_NOT_FOUND` bila nol station).
5. Bukti: `laporan/F-008.md` + `laporan/artifacts/F-008/` (`sim.log`, JSON tiap langkah).

Batas: loopback OK ≠ kertas keluar; job AUTO tak boleh di-ack PRINTED tanpa render order.

## 6. Kontrak FINAL AUTO payload-kosong (F-008-AUTO, 2026-10-27)

`isAutoPrintJob` (source `AUTO` case-insensitive, atau payload kosong + `metadata.orderId`)
→ `printAutoServerJob` (detail penuh order server + template BE; customer → stations
non-dapur, kitchen → station dapur) → `PRINTED`; order/offline tak tersedia → `FAILED
ORDER_UNAVAILABLE`. Skrip rerunnable `../../_workspace/laporan/artifacts/F-008-AUTO/f008b-auto-sim.cjs`
+ `laporan/F-008-AUTO.md`. Tanpa hardware; sim/loopback saja.

## Berkas terkait

- `src/native/printer.ts` — 4 transport + `loopback` + jurnal (`LOOPBACK_TARGET`, `getLoopbackJournal`, `clearLoopbackJournal`).
- `src/lib/escpos.ts` — builder byte (murni, tanpa import — syarat bisa diuji node).
- `src/lib/printqueue.ts` — antrean persisten + drain (`DrainDeps.send` injeksi uji).
- `src/lib/print.ts` — routing station/scope; loopback SENGAJA tak masuk `targetOf` (bukan station produksi).
