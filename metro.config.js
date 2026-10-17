// Metro config: ajari Metro membundel `.wasm` sebagai aset statis.
// Dibutuhkan expo-sqlite web (worker.ts mengimpor wa-sqlite.wasm; tanpa
// ini bundling web gagal "Unable to resolve ...wa-sqlite.wasm" dan seluruh
// SQLite web mati total sehingga login offline tak pernah bisa jalan di web).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
