import { NativeModules } from 'react-native';

/**
 * Jembatan JS ke modul native `GenfityPrinter` (classic bridge, bukan
 * codegen - cocok dengan GenfityPrinterModule.java `getName() =
 * "GenfityPrinter"` yang didaftarkan GenfityPrinterPackage via app.plugin).
 *
 * File ini YANG HILANG selama ini: `src/native/printer.ts` me-require
 * `../specs/GenfityPrinter`, sehingga tanpa file ini `native()` selalu null
 * dan BT/USB selalu `need-dev-client` - bahkan di dev-client sekalipun.
 * Di Expo Go/web: NativeModules.GenfityPrinter undefined → null (aman).
 */

export interface BondedBtDevice {
  name: string;
  mac: string;
}

export interface UsbDeviceInfo {
  name: string;
  vendorId: number;
  productId: number;
}

export interface GenfityPrinterSpec {
  listBondedBt: () => Promise<BondedBtDevice[]>;
  printBt: (mac: string, base64: string) => Promise<number>;
  printUsb: (vendorId: number, productId: number, base64: string) => Promise<number>;
  requestUsbPermission: (vendorId: number, productId: number) => Promise<boolean>;
  /** Daftar device USB tersambung (tanpa hafal VID/PID). */
  listUsbDevices: () => Promise<UsbDeviceInfo[]>;
  /** Pindai printer BLE ±8 detik. */
  scanBlePrinters: () => Promise<BondedBtDevice[]>;
  /** Cetak ke printer thermal BLE (Nordic UART). */
  printBle: (mac: string, base64: string) => Promise<number>;
  openDrawer: (targetJson: string) => Promise<boolean>;
  startWsService: () => Promise<boolean>;
  stopWsService: () => Promise<boolean>;
}

function load(): GenfityPrinterSpec | null {
  try {
    const m = (NativeModules as Record<string, unknown>)?.GenfityPrinter as
      | GenfityPrinterSpec
      | undefined;
    if (!m || typeof m.printBt !== 'function') return null;
    return m;
  } catch {
    return null;
  }
}

export default load();
