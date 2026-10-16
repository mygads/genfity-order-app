package id.genfity.posclone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;
import androidx.core.app.NotificationCompat;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Modul native GenfityPrinter:
 * - printBt: RFCOMM SPP ke MAC bonded (UUID SPP standar).
 * - printUsb: bulk-transfer ke device VID/PID (butuh izin via intent filter
 *   di plugin, atau requestPermission eksplisit sebelum print).
 * - listBondedBt: daftar MAC bonded untuk layar pairing.
 * - startWsService/stopWsService: foreground service agar WebSocket
 *   realtime tetap hidup saat layar mati (pola flutter_foreground_task).
 */
public class GenfityPrinterModule extends ReactContextBaseJavaModule {
  private static final UUID SPP_UUID =
      UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
  // Nordic UART (BLE): dipakai mayoritas printer thermal BLE (XPrinter dkk).
  private static final String NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  private static final String NUS_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  private static final String WS_CHANNEL = "genfity-ws";
  private static final int WS_NOTIF_ID = 6101;
  private static final String ACTION_USB_PERMISSION = "id.genfity.posclone.USB_PERMISSION";

  public GenfityPrinterModule(ReactApplicationContext ctx) {
    super(ctx);
  }

  @Override
  public String getName() {
    return "GenfityPrinter";
  }

  @ReactMethod
  public void listBondedBt(Promise promise) {
    try {
      BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
      WritableArray out = Arguments.createArray();
      if (adapter != null) {
        for (BluetoothDevice d : adapter.getBondedDevices()) {
          com.facebook.react.bridge.WritableMap m = Arguments.createMap();
          String name = d.getName();
          m.putString("name", name != null ? name : d.getAddress());
          m.putString("mac", d.getAddress());
          out.pushMap(m);
        }
      }
      promise.resolve(out);
    } catch (Exception e) {
      promise.reject("BT_LIST_FAILED", e.getMessage());
    }
  }

  /**
   * Daftar device USB yang tersambung (nama + VID/PID) untuk panel pindai —
   * tanpa perlu tahu angka VID/PID manual lagi.
   */
  @ReactMethod
  public void listUsbDevices(Promise promise) {
    try {
      UsbManager mgr =
          (UsbManager) getReactApplicationContext().getSystemService(Context.USB_SERVICE);
      WritableArray out = Arguments.createArray();
      for (UsbDevice d : mgr.getDeviceList().values()) {
        String name;
        try {
          name = d.getProductName();
        } catch (Exception ignored) {
          name = null;
        }
        if (name == null) name = d.getDeviceName();
        com.facebook.react.bridge.WritableMap m = Arguments.createMap();
        m.putString("name", name != null ? name : "USB");
        m.putInt("vendorId", d.getVendorId());
        m.putInt("productId", d.getProductId());
        out.pushMap(m);
      }
      promise.resolve(out);
    } catch (Exception e) {
      promise.reject("USB_LIST_FAILED", e.getMessage());
    }
  }

  @ReactMethod
  public void printBt(String mac, String base64, Promise promise) {
    BluetoothSocket socket = null;
    try {
      byte[] data = Base64.decode(base64, Base64.DEFAULT);
      BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
      BluetoothDevice device = adapter.getRemoteDevice(mac);
      socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
      socket.connect();
      OutputStream out = socket.getOutputStream();
      out.write(data);
      out.flush();
      promise.resolve(data.length);
    } catch (Exception e) {
      promise.reject("BT_PRINT_FAILED", e.getMessage());
    } finally {
      try {
        if (socket != null) socket.close();
      } catch (Exception ignored) {
      }
    }
  }

  /**
   * Minta izin akses USB ke device VID/PID (dialog sistem Android, satu kali
   * sampai device dicabut). Resolve true bila sudah/diizinkan; reject
   * USB_DENIED bila pengguna menolak, USB_NOT_FOUND bila tak tersambung.
   */
  @ReactMethod
  public void requestUsbPermission(int vendorId, int productId, Promise promise) {
    try {
      UsbManager mgr =
          (UsbManager) getReactApplicationContext().getSystemService(Context.USB_SERVICE);
      UsbDevice target = null;
      for (UsbDevice d : mgr.getDeviceList().values()) {
        if (d.getVendorId() == vendorId && d.getProductId() == productId) {
          target = d;
          break;
        }
      }
      if (target == null) {
        promise.reject("USB_NOT_FOUND", "device tidak tersambung");
        return;
      }
      if (mgr.hasPermission(target)) {
        promise.resolve(true);
        return;
      }
      final Context ctx = getReactApplicationContext();
      int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
          ? PendingIntent.FLAG_MUTABLE : 0;
      PendingIntent pi = PendingIntent.getBroadcast(
          ctx, target.getDeviceId(), new Intent(ACTION_USB_PERMISSION), flags);
      final Promise pending = promise;
      BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
          try {
            ctx.unregisterReceiver(this);
          } catch (Exception ignored) {
          }
          if (ACTION_USB_PERMISSION.equals(intent.getAction())) {
            boolean granted =
                intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
            if (granted) pending.resolve(true);
            else pending.reject("USB_DENIED", "izin USB ditolak pengguna");
          }
        }
      };
      if (Build.VERSION.SDK_INT >= 33) {
        ctx.registerReceiver(receiver, new IntentFilter(ACTION_USB_PERMISSION),
            Context.RECEIVER_NOT_EXPORTED);
      } else {
        ctx.registerReceiver(receiver, new IntentFilter(ACTION_USB_PERMISSION));
      }
      mgr.requestPermission(target, pi);
    } catch (Exception e) {
      promise.reject("USB_PERM_FAILED", e.getMessage());
    }
  }

  @ReactMethod
  public void printUsb(int vendorId, int productId, String base64, Promise promise) {
    try {
      byte[] data = Base64.decode(base64, Base64.DEFAULT);
      UsbManager mgr =
          (UsbManager) getReactApplicationContext().getSystemService(Context.USB_SERVICE);
      UsbDevice target = null;
      for (UsbDevice d : mgr.getDeviceList().values()) {
        if (d.getVendorId() == vendorId && d.getProductId() == productId) {
          target = d;
          break;
        }
      }
      if (target == null) {
        promise.reject("USB_NOT_FOUND", "device tidak tersambung");
        return;
      }
      if (!mgr.hasPermission(target)) {
        promise.reject("USB_NO_PERMISSION", "beri izin USB dulu");
        return;
      }
      android.hardware.usb.UsbDeviceConnection conn = mgr.openDevice(target);
      if (conn == null) {
        promise.reject("USB_OPEN_FAILED", "gagal open device");
        return;
      }
      android.hardware.usb.UsbInterface intf = target.getInterface(0);
      conn.claimInterface(intf, true);
      android.hardware.usb.UsbEndpoint epOut = null;
      for (int i = 0; i < intf.getEndpointCount(); i++) {
        android.hardware.usb.UsbEndpoint ep = intf.getEndpoint(i);
        if (ep.getDirection() == android.hardware.usb.UsbConstants.USB_DIR_OUT
            && ep.getType() == android.hardware.usb.UsbConstants.USB_ENDPOINT_XFER_BULK) {
          epOut = ep;
          break;
        }
      }
      if (epOut == null) {
        conn.close();
        promise.reject("USB_NO_EP", "endpoint bulk-out tidak ada");
        return;
      }
      int sent = conn.bulkTransfer(epOut, data, data.length, 10000);
      conn.close();
      if (sent < 0) promise.reject("USB_SEND_FAILED", "bulkTransfer gagal");
      else promise.resolve(sent);
    } catch (Exception e) {
      promise.reject("USB_PRINT_FAILED", e.getMessage());
    }
  }

  /**
   * Pindai printer BLE (8 detik, tanpa filter layanan agar printer yang tak
   * mengiklankan UUID-nya tetap ketemu). Kembalikan [{name, mac}].
   * Izin runtime BLUETOOTH_SCAN diminta dari sisi JS sebelum memanggil.
   */
  @ReactMethod
  public void scanBlePrinters(Promise promise) {
    try {
      BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
      if (adapter == null || !adapter.isEnabled()) {
        promise.reject("BLE_OFF", "bluetooth mati / tak tersedia");
        return;
      }
      final BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
      if (scanner == null) {
        promise.reject("BLE_NO_SCANNER", "pemindai BLE tak tersedia");
        return;
      }
      final List<com.facebook.react.bridge.WritableMap> found = new ArrayList<>();
      final Promise pending = promise;
      final ScanCallback cb = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
          BluetoothDevice d = result.getDevice();
          if (d == null) return;
          String mac = d.getAddress();
          for (com.facebook.react.bridge.WritableMap m : found) {
            if (mac.equals(m.getString("mac"))) return;
          }
          String name;
          try {
            name = d.getName();
          } catch (SecurityException se) {
            name = null;
          }
          com.facebook.react.bridge.WritableMap m = Arguments.createMap();
          m.putString("name", name != null ? name : mac);
          m.putString("mac", mac);
          found.add(m);
        }
      };
      scanner.startScan(null,
          new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), cb);
      new Handler(Looper.getMainLooper()).postDelayed(() -> {
        try {
          scanner.stopScan(cb);
        } catch (Exception ignored) {
        }
        WritableArray out = Arguments.createArray();
        for (com.facebook.react.bridge.WritableMap m : found) out.pushMap(m);
        pending.resolve(out);
      }, 8000);
    } catch (Exception e) {
      promise.reject("BLE_SCAN_FAILED", e.getMessage());
    }
  }

  /**
   * Cetak ke printer thermal BLE via Nordic UART: konek GATT → tulis
   * potongan 100 byte ke karakteristik RX → tutup. Dijalankan di thread
   * latar agar tak memblokir bridge. Reject BLE_NO_NUS bila device bukan
   * printer thermal BLE umum.
   */
  @ReactMethod
  public void printBle(final String mac, final String base64, final Promise promise) {
    new Thread(() -> {
      BluetoothGatt gatt = null;
      try {
        final byte[] data = Base64.decode(base64, Base64.DEFAULT);
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) {
          promise.reject("BLE_OFF", "bluetooth mati");
          return;
        }
        BluetoothDevice device;
        try {
          device = adapter.getRemoteDevice(mac);
        } catch (Exception e) {
          promise.reject("BLE_BAD_MAC", "alamat BLE tak valid: " + mac);
          return;
        }
        final CountDownLatch connLatch = new CountDownLatch(1);
        final boolean[] connOk = {false};
        final CountDownLatch[] writeLatch = {new CountDownLatch(0)};
        final boolean[] writeOk = {true};
        BluetoothGattCallback cb = new BluetoothGattCallback() {
          @Override
          public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
              connOk[0] = true;
              g.discoverServices();
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
              connLatch.countDown();
              writeLatch[0].countDown();
            }
          }

          @Override
          public void onServicesDiscovered(BluetoothGatt g, int status) {
            connLatch.countDown();
          }

          @Override
          public void onCharacteristicWrite(BluetoothGatt g,
              BluetoothGattCharacteristic c, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) writeOk[0] = false;
            writeLatch[0].countDown();
          }
        };
        gatt = device.connectGatt(
            getReactApplicationContext(), false, cb, BluetoothDevice.TRANSPORT_LE);
        if (gatt == null) {
          promise.reject("BLE_CONNECT_FAILED", "gagal mulai konek GATT");
          return;
        }
        if (!connLatch.await(12, TimeUnit.SECONDS) || !connOk[0]) {
          promise.reject("BLE_CONNECT_FAILED", "gagal konek GATT ke " + mac);
          return;
        }
        BluetoothGattService svc = gatt.getService(UUID.fromString(NUS_SERVICE));
        if (svc == null) {
          promise.reject("BLE_NO_NUS", "bukan printer thermal BLE umum (tanpa Nordic UART)");
          return;
        }
        BluetoothGattCharacteristic rx = svc.getCharacteristic(UUID.fromString(NUS_RX));
        if (rx == null) {
          promise.reject("BLE_NO_NUS", "karakteristik tulis printer tak ada");
          return;
        }
        rx.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        int offset = 0;
        while (offset < data.length) {
          int len = Math.min(100, data.length - offset);
          rx.setValue(Arrays.copyOfRange(data, offset, offset + len));
          writeLatch[0] = new CountDownLatch(1);
          writeOk[0] = true;
          if (!gatt.writeCharacteristic(rx)) {
            promise.reject("BLE_WRITE_FAILED", "tulis GATT ditolak");
            return;
          }
          if (!writeLatch[0].await(5, TimeUnit.SECONDS) || !writeOk[0]) {
            promise.reject("BLE_SEND_FAILED", "kirim GATT gagal/timeout");
            return;
          }
          offset += len;
        }
        promise.resolve(data.length);
      } catch (Exception e) {
        promise.reject("BLE_PRINT_FAILED", e.getMessage());
      } finally {
        try {
          if (gatt != null) {
            gatt.disconnect();
            gatt.close();
          }
        } catch (Exception ignored) {
        }
      }
    }).start();
  }

  private static final byte[] DRAWER_KICK = new byte[] {
      0x1B, 0x40, 0x1B, 0x70, 0x00, 0x32, (byte) 0xC8 };

  /**
   * Buka laci kas: kirim pulse ESC/POS `ESC p m t1 t2` (pin 0, 50ms×200ms).
   * targetJson = {"transport":"bt|usb|lan","address":"MAC","host":"IP","port":9100,
   * "vendorId":0,"productId":0} - bentuk yang dikirim src/native/printer.ts.
   */
  @ReactMethod
  public void openDrawer(String targetJson, Promise promise) {
    try {
      org.json.JSONObject t = new org.json.JSONObject(targetJson);
      String transport = t.optString("transport", "bt");
      if ("lan".equals(transport)) {
        String host = t.optString("host", "");
        int port = t.optInt("port", 9100);
        java.net.Socket sock = new java.net.Socket();
        try {
          sock.connect(new java.net.InetSocketAddress(host, port), 8000);
          sock.getOutputStream().write(DRAWER_KICK);
          sock.getOutputStream().flush();
        } finally {
          try { sock.close(); } catch (Exception ignored) { }
        }
        promise.resolve(true);
        return;
      }
      if ("usb".equals(transport)) {
        int vid = t.optInt("vendorId", 0);
        int pid = t.optInt("productId", 0);
        UsbManager mgr =
            (UsbManager) getReactApplicationContext().getSystemService(Context.USB_SERVICE);
        UsbDevice target = null;
        for (UsbDevice d : mgr.getDeviceList().values()) {
          if (d.getVendorId() == vid && d.getProductId() == pid) { target = d; break; }
        }
        if (target == null || !mgr.hasPermission(target)) {
          promise.reject("DRAWER_USB_UNAVAILABLE", "printer USB tak tersedia/izin");
          return;
        }
        android.hardware.usb.UsbDeviceConnection conn = mgr.openDevice(target);
        android.hardware.usb.UsbInterface intf = target.getInterface(0);
        conn.claimInterface(intf, true);
        android.hardware.usb.UsbEndpoint epOut = null;
        for (int i = 0; i < intf.getEndpointCount(); i++) {
          android.hardware.usb.UsbEndpoint ep = intf.getEndpoint(i);
          if (ep.getDirection() == android.hardware.usb.UsbConstants.USB_DIR_OUT
              && ep.getType() == android.hardware.usb.UsbConstants.USB_ENDPOINT_XFER_BULK) {
            epOut = ep; break;
          }
        }
        int sent = conn.bulkTransfer(epOut, DRAWER_KICK, DRAWER_KICK.length, 8000);
        conn.close();
        if (sent < 0) promise.reject("DRAWER_USB_FAILED", "bulkTransfer gagal");
        else promise.resolve(true);
        return;
      }
      String mac = t.optString("address", "");
      BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
      BluetoothDevice device = adapter.getRemoteDevice(mac);
      BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
      try {
        socket.connect();
        OutputStream out = socket.getOutputStream();
        out.write(DRAWER_KICK);
        out.flush();
      } finally {
        try { socket.close(); } catch (Exception ignored) { }
      }
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("DRAWER_FAILED", e.getMessage());
    }
  }

  @ReactMethod
  public void startWsService(Promise promise) {
    try {
      Context ctx = getReactApplicationContext();
      NotificationManager nm =
          (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        nm.createNotificationChannel(
            new NotificationChannel(WS_CHANNEL, "Realtime", NotificationManager.IMPORTANCE_LOW));
      }
      Intent intent = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
      PendingIntent pi =
          PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE);
      Notification notif =
          new NotificationCompat.Builder(ctx, WS_CHANNEL)
              .setContentTitle("Genfity POS realtime aktif")
              .setContentText("Menjaga koneksi order online")
              .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
              .setContentIntent(pi)
              .setOngoing(true)
              .build();
      Intent svcIntent = new Intent(ctx, GenfityWsService.class);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(svcIntent);
      } else {
        ctx.startService(svcIntent);
      }
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("WS_SERVICE_FAILED", e.getMessage());
    }
  }

  @ReactMethod
  public void stopWsService(Promise promise) {
    try {
      Context ctx = getReactApplicationContext();
      ctx.stopService(new Intent(ctx, GenfityWsService.class));
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("WS_SERVICE_FAILED", e.getMessage());
    }
  }
}
