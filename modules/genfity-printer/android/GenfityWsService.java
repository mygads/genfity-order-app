package id.genfity.posclone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/** Foreground service agar WebSocket realtime tetap hidup saat layar mati. */
public class GenfityWsService extends Service {
  public static final String CHANNEL = "genfity-ws";
  public static final int NOTIF_ID = 6101;

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
          new NotificationChannel(CHANNEL, "Realtime", NotificationManager.IMPORTANCE_LOW));
    }
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent pi = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE);
    Notification notif =
        new NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Genfity POS realtime aktif")
            .setContentText("Menjaga koneksi order online")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
    startForeground(NOTIF_ID, notif);
    return START_STICKY;
  }
}
