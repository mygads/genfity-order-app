/**
 * Config plugin modul GenfityPrinter. Dipakai setelah `npx expo prebuild`:
 * tambah "./modules/genfity-printer/app.plugin.js" ke app.json plugins,
 * lalu `eas build --profile development` (dev-client).
 *
 * Menambah: permission BT/USB/foreground-service, deklarasi GenfityWsService,
 * dan registrasi GenfityPrinterPackage di MainApplication.
 */
const {
  withAndroidManifest,
  withMainApplication,
  AndroidConfig,
} = require('@expo/config-plugins');

const PERMS = [
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.USB_PERMISSION',
];

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
    if (src.includes('GenfityPrinterPackage')) return mod;
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

  return config;
}

module.exports = withGenfityPrinter;
