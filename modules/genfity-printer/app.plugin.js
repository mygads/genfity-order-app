/**
 * Config plugin modul GenfityPrinter. Dipakai setelah `npx expo prebuild`:
 * tambah "./modules/genfity-printer/app.plugin.js" ke app.json plugins,
 * lalu `eas build --profile development` (dev-client).
 *
 * Melakukan 3 hal:
 * 1. withAndroidManifest: permission BT/USB/foreground-service + deklarasi
 *    GenfityWsService + uses-feature usb.host.
 * 2. withMainApplication: registrasi GenfityPrinterPackage. Template prebuild
 *    Expo modern = Kotlin (MainApplication.kt); template lama = Java.
 *    Keduanya ditangani (plugin lama hanya bisa Java → diam-diam gagal).
 * 3. withDangerousMod: salin sumber Java modul (GenfityPrinterModule,
 *    GenfityPrinterPackage, GenfityWsService) ke proyek android hasil
 *    prebuild — tanpa ini paket terdaftar tapi kelasnya tak ada (crash saat
 *    aplikasi dibuka).
 */
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PERMS = [
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
];

const JAVA_FILES = [
  'GenfityPrinterModule.java',
  'GenfityPrinterPackage.java',
  'GenfityWsService.java',
];
const JAVA_PKG_DIR = path.join('id', 'genfity', 'posclone');

function withGenfityPrinter(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    for (const p of PERMS) {
      AndroidConfig.Permissions.ensurePermission(manifest, p);
    }
    if (!manifest['uses-feature']) manifest['uses-feature'] = [];
    const hasUsbHost = manifest['uses-feature'].some(
      (f) => f.$?.['android:name'] === 'android.hardware.usb.host',
    );
    if (!hasUsbHost) {
      manifest['uses-feature'].push({
        $: { 'android:name': 'android.hardware.usb.host', 'android:required': 'false' },
      });
    }
    const app = manifest.application?.[0];
    if (app) {
      if (!app.service) app.service = [];
      const hasSvc = app.service.some(
        (s) => s.$?.['android:name'] === 'id.genfity.posclone.GenfityWsService',
      );
      if (!hasSvc) {
        app.service.push({
          $: {
            'android:name': 'id.genfity.posclone.GenfityWsService',
            'android:foregroundServiceType': 'dataSync',
            'android:exported': 'false',
          },
        });
      }
    }
    return mod;
  });

  config = withMainApplication(config, (mod) => {
    const src = mod.modResults.contents;
    const filePath = String(mod.modResults.path || '');
    if (src.includes('GenfityPrinterPackage')) return mod;
    if (filePath.endsWith('.kt')) {
      // Template Kotlin (Expo SDK 49+): tambah import + register di getPackages().
      let out = src.replace(
        'import com.facebook.react.ReactApplication',
        'import com.facebook.react.ReactApplication\nimport id.genfity.posclone.GenfityPrinterPackage',
      );
      if (out !== src) {
        // Sisip sebelum PackageList(...).packages — pola bawaan template.
        const withReg = out.replace(
          /(\bpackages\s*=\s*PackageList[^;]*\.packages)/,
          '$1.apply { add(GenfityPrinterPackage()) }',
        );
        out = withReg !== out ? withReg : out.replace(
          /return packages/,
          'packages.add(GenfityPrinterPackage())\n        return packages',
        );
      }
      mod.modResults.contents = out;
      return mod;
    }
    // Template Java lama.
    let out = src.replace(
      'import com.facebook.react.ReactApplication;',
      'import com.facebook.react.ReactApplication;\nimport id.genfity.posclone.GenfityPrinterPackage;',
    );
    out = out.replace(
      /(packages\.add\(new [^)]+\)\s*)/,
      '$1packages.add(new GenfityPrinterPackage());\n      ',
    );
    // Fallback bila pola packages.add tak ketemu: sisip sebelum return packages.
    if (out === src || !out.includes('GenfityPrinterPackage')) {
      out = src
        .replace(
          'import com.facebook.react.ReactApplication;',
          'import com.facebook.react.ReactApplication;\nimport id.genfity.posclone.GenfityPrinterPackage;',
        )
        .replace(
          /return packages;/,
          'packages.add(new GenfityPrinterPackage());\n        return packages;',
        );
    }
    mod.modResults.contents = out;
    return mod;
  });

  // Salin sumber Java modul ke proyek android hasil prebuild.
  config = withDangerousMod(config, [
    'android',
    (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, 'modules', 'genfity-printer', 'android');
      const dstDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        JAVA_PKG_DIR,
      );
      fs.mkdirSync(dstDir, { recursive: true });
      for (const f of JAVA_FILES) {
        const from = path.join(srcDir, f);
        if (fs.existsSync(from)) {
          fs.copyFileSync(from, path.join(dstDir, f));
        }
      }
      return mod;
    },
  ]);

  return config;
}

module.exports = withGenfityPrinter;
