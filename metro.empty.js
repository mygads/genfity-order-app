// Shim kosong modul inti Node untuk bundel native (Metro/RN).
// Dipakai oleh jimp-compact (transitif via expo-location -> @expo/image-utils):
// dist-nya me-require https/http/url/stream/zlib/dll padahal tak pernah
// dipakai pada jalur read(buffer) POS (decode logo struk). Tanpa shim,
// createBundleReleaseJsAndAssets gagal "Unable to resolve module https"
// pada cache Metro dingin (build hangat lama menutupi bug laten ini).
// require yang gagal tetap ditangkap try/catch di receiptTemplate.ts
// sehingga cetak jalan tanpa logo, bukan crash.
module.exports = {};
