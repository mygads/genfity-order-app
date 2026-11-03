// Metro config:
// 1. Bundel `.wasm` sebagai aset statis (expo-sqlite web / wa-sqlite.wasm).
// 2. Shim modul inti Node untuk bundel native (lihat metro.empty.js).
//    jimp-compact (transitif expo-location) me-require https/http/url/stream/
//    zlib/dll di dist-nya; Metro native tak menyediakan core Node sehingga
//    build release gagal pada cache dingin. buffer dipakai yang asli
//    (paket `buffer` sudah ada di node_modules) agar decode gambar berpeluang
//    jalan; sisanya shim kosong + try/catch di pemanggil.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

const emptyShim = path.resolve(__dirname, 'metro.empty.js');
let bufferPkg = emptyShim;
try {
  bufferPkg = require.resolve('buffer/');
} catch {
  try {
    bufferPkg = require.resolve('buffer');
  } catch {
    bufferPkg = emptyShim;
  }
}

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  assert: emptyShim,
  buffer: bufferPkg,
  child_process: emptyShim,
  cluster: emptyShim,
  crypto: emptyShim,
  dgram: emptyShim,
  dns: emptyShim,
  domain: emptyShim,
  events: emptyShim,
  fs: emptyShim,
  http: emptyShim,
  http2: emptyShim,
  https: emptyShim,
  inspector: emptyShim,
  net: emptyShim,
  os: emptyShim,
  path: emptyShim,
  perf_hooks: emptyShim,
  punycode: emptyShim,
  querystring: emptyShim,
  readline: emptyShim,
  stream: emptyShim,
  string_decoder: emptyShim,
  timers: emptyShim,
  tls: emptyShim,
  tty: emptyShim,
  url: emptyShim,
  util: emptyShim,
  v8: emptyShim,
  vm: emptyShim,
  worker_threads: emptyShim,
  zlib: emptyShim,
};

module.exports = config;
