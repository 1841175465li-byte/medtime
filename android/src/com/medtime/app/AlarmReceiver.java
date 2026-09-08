package com.medtime.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;

public final class AlarmReceiver extends BroadcastReceiver {
    private static PowerManager.WakeLock handoff;
    static synchronized void releaseHandoff() {
        if (handoff != null && handoff.isHeld()) handoff.release();
        handoff=null;
    }
    @Override public void onReceive(Context ctx, Intent intent) {
        if (AlarmScheduler.STOP.equals(intent.getAction())) { AlarmScheduler.stop(ctx); return; }
        // Ignore actions from a notification or deferred alarm created by 1.7.0.
        if ("com.medtime.app.ALARM_SNOOZE".equals(intent.getAction()) || "com.medtime.app.SNOOZE_FIRE".equals(intent.getAction())) {
            AlarmScheduler.clearLegacySnoozes(ctx); return;
        }
        boolean test=AlarmScheduler.TEST_FIRE.equals(intent.getAction());
        if (!test && !AlarmScheduler.FIRE.equals(intent.getAction())) return;
        String slot=intent.getStringExtra("slot"); long at=intent.getLongExtra("at",0);
        if (!(test?AlarmScheduler.consumeTest(ctx,at):AlarmScheduler.consume(ctx,slot,at))) return;
        try {
            releaseHandoff();
            handoff=ctx.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"medtime:alarm-handoff");
            handoff.acquire(10000);
            ctx.startForegroundService(new Intent(ctx,AlarmSoundService.class).putExtra("slot",slot).putExtra("at",at).putExtra("test",test).putExtra("proofTest",test));
        } catch (Exception error) {
            releaseHandoff();
            AlarmScheduler.prefs(ctx).edit().putString("error","系统未能启动响铃，请打开应用测试闹钟").apply();
        }
    }
}
