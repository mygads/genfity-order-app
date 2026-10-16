/**
 * Uji plugin prebuild modules/genfity-printer TANPA menjalankan prebuild
 * (tanpa mengotori repo dengan folder android/).
 *
 * Cara pakai: node verify/check.prebuild.cjs
 * Keluar 0 = manifest + MainApplication (Kotlin & Java) + salinan sumber
 * Java benar; selain itu nonzero + pesan.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 1. Stub @expo/config-plugins sebelum plugin di-require.
const pluginPath = require.resolve('@expo/config-plugins', { paths: [ROOT] });
const captured = {};
require.cache[pluginPath] = {
  id: pluginPath,
  filename: pluginPath,
  loaded: true,
  exports: {
    withAndroidManifest: (c, fn) => { captured.manifest = fn; return c; },
    withMainApplication: (c, fn) => { captured.app = fn; return c; },
    withDangerousMod: (c, pair) => { captured.dangerous = pair; return c; },
    AndroidConfig: {
      Permissions: {
        // Tiru API asli: terima dokumen utuh ({ manifest: {...} }).
        ensurePermission: (doc, name) => {
          const manifest = doc.manifest;
          if (!manifest['uses-permission']) manifest['uses-permission'] = [];
          const has = manifest['uses-permission'].some((e) => e.$?.['android:name'] === name);
          if (!has) manifest['uses-permission'].push({ $: { 'android:name': name } });
        },
      },
    },
  },
};

const fail = (msg) => { console.error(`GAGAL: ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`OK: ${msg}`);

const withGenfityPrinter = require('../modules/genfity-printer/app.plugin.js');
withGenfityPrinter({});

// 2. Manifest: permission + service + uses-feature.
const manifest = { manifest: { application: [{ $: {}, service: [] }] } };
captured.manifest({ modResults: manifest, modRequest: {} });
const perms = (manifest.manifest['uses-permission'] || []).map((e) => e.$['android:name']);
for (const p of [
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
]) {
  if (!perms.includes(p)) fail(`permission ${p} tidak ditambahkan`);
}
ok('permission BT + foreground-service');
const feats = manifest.manifest['uses-feature'] || [];
if (!feats.some((f) => f.$?.['android:name'] === 'android.hardware.usb.host')) {
  fail('uses-feature usb.host hilang');
}
ok('uses-feature usb.host');
const svc = (manifest.manifest.application[0].service || [])[0]?.$ || {};
if (svc['android:name'] !== 'id.genfity.posclone.GenfityWsService') fail('service WS tak terdaftar');
ok('service GenfityWsService');

// 3. MainApplication Kotlin — tiru template Expo modern ASLI (blok .apply).
const ktIn = `package com.example
import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
class MainApplication : Application(), ReactApplication {
  override val reactHost by lazy {
    getDefaultReactHost(
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here
        }
    )
  }
}`;
const ktMod = { modResults: { contents: ktIn, path: 'MainApplication.kt' }, modRequest: {} };
captured.app(ktMod);
const ktOut = ktMod.modResults.contents;
if (!ktOut.includes('import id.genfity.posclone.GenfityPrinterPackage')) fail('import Kotlin hilang');
if (!ktOut.includes('add(GenfityPrinterPackage())')) fail('registrasi Kotlin hilang');
ok('patch MainApplication.kt');

// 4. MainApplication Java lama (harus tetap bisa).
const javaIn = `import com.facebook.react.ReactApplication;
class MainApplication {
  List<ReactPackage> getPackages() {
    List<ReactPackage> packages = new PackageList(this).getPackages();
    packages.add(new ModuleA());
    return packages;
  }
}`;
const javaMod = { modResults: { contents: javaIn, path: 'MainApplication.java' }, modRequest: {} };
captured.app(javaMod);
if (!javaMod.modResults.contents.includes('packages.add(new GenfityPrinterPackage());')) {
  fail('registrasi Java hilang');
}
ok('patch MainApplication.java (kompat lama)');

// 5. DangerousMod: salin 3 sumber Java ke proyek android.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'genfity-prebuild-'));
const srcDir = path.join(tmp, 'modules', 'genfity-printer', 'android');
fs.mkdirSync(srcDir, { recursive: true });
for (const f of ['GenfityPrinterModule.java', 'GenfityPrinterPackage.java', 'GenfityWsService.java']) {
  fs.copyFileSync(path.join(ROOT, 'modules', 'genfity-printer', 'android', f), path.join(srcDir, f));
}
const [platform, fn] = captured.dangerous;
if (platform !== 'android') fail('dangerous mod bukan android');
fn({ modRequest: { projectRoot: tmp }, modResults: {} });
for (const f of ['GenfityPrinterModule.java', 'GenfityPrinterPackage.java', 'GenfityWsService.java']) {
  const dst = path.join(tmp, 'android', 'app', 'src', 'main', 'java', 'id', 'genfity', 'posclone', f);
  if (!fs.existsSync(dst)) fail(`salinan ${f} tidak sampai`);
  const body = fs.readFileSync(dst, 'utf8');
  if (f === 'GenfityPrinterModule.java' && !body.includes('requestUsbPermission')) {
    fail('GenfityPrinterModule.java usang (tanpa requestUsbPermission)');
  }
}
ok('salinan 3 sumber Java modul');
fs.rmSync(tmp, { recursive: true, force: true });

console.log('SEMUA PEMERIKSAAN PREBUILD LULUS');
