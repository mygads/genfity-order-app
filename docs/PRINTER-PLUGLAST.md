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

## 4. Batas scope (bukan S10)

- **BE print-bridge** (`POST /api/print-bridge/device/jobs/claim`, alur klaim job sisi-server) = alur TERPISAH dari cetak lokal APP. S10 hanya mencakup stack lokal (`escpos → print → printqueue → native/printer`). Pairing APP↔print-bridge butuh keputusan/endpoint owner.
- **EDC/intent APOS**: di luar printer; tetap butuh perangkat (lihat PARITY M8/T10).

## Berkas terkait

- `src/native/printer.ts` — 4 transport + `loopback` + jurnal (`LOOPBACK_TARGET`, `getLoopbackJournal`, `clearLoopbackJournal`).
- `src/lib/escpos.ts` — builder byte (murni, tanpa import — syarat bisa diuji node).
- `src/lib/printqueue.ts` — antrean persisten + drain (`DrainDeps.send` injeksi uji).
- `src/lib/print.ts` — routing station/scope; loopback SENGAJA tak masuk `targetOf` (bukan station produksi).
