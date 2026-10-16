package id.genfity.posclone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
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
import java.util.UUID;

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
  private static final String WS_CHANNEL = "genfity-ws";
  private static final int WS_NOTIF_ID = 6101;

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
