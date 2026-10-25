// Tripwire SESI-FINAL-APP K4: gambar katalog tanpa dep baru.
// Kunci statik (tanpa runtime RN — dicek dari sumber):
//  C-01: lib/catalogImages — prefetch via Image.prefetch bawaan RN
//        (TANPA expo-file-system/sharing), cache sesi + cap, fail-closed
//        (tak pernah melempar), hanya https≤2048.
//  C-02: MenuManagement downloadImage — URL valid → prefetch verifikasi;
//        'ok' HANYA bila prefetch sukses (gagal = missing + imgFail).
//  C-03: render graceful — remote HANYA bila isCatalogImageReady;
//        onError → placeholder lokal (tanpa ikon rusak); tanpa URL =
//        placeholder seperti dulu.
//  C-04: KitchenScreen fallback ESB pullMenu/pullStation DIPERTAHANKAN +
//        catatan kanonis (tak ada endpoint menu gambar GO-terminal).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const readRaw = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const read = (p) => strip(readRaw(p));

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, name) => {
    checks++;
    if (!cond) failures.push(name);
  };

  // ---- C-01: lib/catalogImages ----
  const lib = read('lib/catalogImages.ts');
  const libRaw = readRaw('lib/catalogImages.ts');
  ok(/export async function prefetchCatalogImage|export function prefetchCatalogImage/.test(lib),
    'C-01: prefetchCatalogImage diekspor');
  ok(/Image\.prefetch/.test(lib),
    'C-01: verifikasi via Image.prefetch bawaan RN (tanpa dep baru)');
  ok(/export function isCatalogImageReady/.test(lib) && /export function noteCatalogImageError/.test(lib),
    'C-01: isCatalogImageReady + noteCatalogImageError diekspor');
  ok(!/expo-file-system|expo-sharing|FileSystem\.|Sharing\./.test(libRaw),
    'C-01: tanpa expo-file-system/sharing (tak ada di package.json)');
  ok(/https:\\\/\\\/\//.test(libRaw) || /\^https/.test(libRaw),
    'C-01: hanya URL https (≤2048) yang diprefetch');
  ok(/\.catch\(\(\) => false\)/.test(libRaw),
    'C-01: fail-closed (tak pernah melempar)');

  // ---- C-02: downloadImage ----
  const menu = read('screens/settings/MenuManagementScreen.tsx');
  const menuRaw = readRaw('screens/settings/MenuManagementScreen.tsx');
  ok(/prefetchCatalogImage/.test(menu),
    'C-02: downloadImage verifikasi via prefetchCatalogImage');
  ok(/const okFetch = await prefetchCatalogImage\(url\)/.test(menuRaw),
    'C-02: ok HANYA bila prefetch sukses (gagal = missing + imgFail)');
  ok(!/downloadAsync/.test(menuRaw),
    'C-02: tanpa downloadAsync (dep tak ada — URL remote dipakai apa adanya)');

  // ---- C-03: render graceful ----
  ok(/isCatalogImageReady\(m\.imageUrl\)/.test(menuRaw),
    'C-03: remote HANYA bila terverifikasi prefetch');
  ok(/onError=/.test(menuRaw) && /noteCatalogImageError/.test(menu),
    'C-03: onError → placeholder lokal (tanpa ikon rusak)');
  ok(/empty_menu.*\.webp/.test(menuRaw),
    'C-03: placeholder lokal lestari (tanpa URL = seperti dulu)');

  // ---- C-04: KitchenScreen fallback ----
  const kit = read('screens/history/KitchenScreen.tsx');
  const kitRaw = readRaw('screens/history/KitchenScreen.tsx');
  ok(/pullMenu/.test(kit) && /pullStation/.test(kit),
    'C-04: fallback ESB pullMenu/pullStation DIPERTAHANKAN');
  ok(/SESI-FINAL-APP K4/.test(kitRaw) && /KANONIS/.test(kitRaw),
    'C-04: catatan kanonis (tak ada endpoint menu gambar GO-terminal)');

  return { failures, checks };
}

module.exports = { run };
