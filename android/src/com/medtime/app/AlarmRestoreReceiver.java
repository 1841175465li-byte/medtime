package com.medtime.app;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class AlarmRestoreReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent intent) {
        String action=intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
            // Restore scheduling only. Never start media playback from a boot broadcast.
            AlarmScheduler.reschedule(ctx);
        }
    }
}
