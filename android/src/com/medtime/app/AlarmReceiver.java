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
        if (AlarmScheduler.SNOOZE.equals(intent.getAction())) {
            org.json.JSONObject result=AlarmScheduler.snooze(ctx);
            android.widget.Toast.makeText(ctx,result.optBoolean("ok")?"已延后 10 分钟，未新增用药记录":result.optString("error","稍后提醒未能保存"),android.widget.Toast.LENGTH_SHORT).show();
            return;
        }
        boolean test=AlarmScheduler.TEST_FIRE.equals(intent.getAction());
        boolean snooze=AlarmScheduler.SNOOZE_FIRE.equals(intent.getAction());
        if (!test && !snooze && !AlarmScheduler.FIRE.equals(intent.getAction())) return;
        String slot=intent.getStringExtra("slot"); long at=intent.getLongExtra("at",0);
        long origin=snooze?intent.getLongExtra("origin",0):at;
        if (!(test?AlarmScheduler.consumeTest(ctx,at):snooze?AlarmScheduler.consumeSnooze(ctx,slot,origin,at):AlarmScheduler.consume(ctx,slot,at))) return;
        try {
            releaseHandoff();
            handoff=ctx.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"medtime:alarm-handoff");
            handoff.acquire(10000);
            ctx.startForegroundService(new Intent(ctx,AlarmSoundService.class).putExtra("slot",slot).putExtra("at",origin).putExtra("test",test).putExtra("proofTest",test));
        } catch (Exception error) {
            releaseHandoff();
            AlarmScheduler.prefs(ctx).edit().putString("error","系统未能启动响铃，请打开应用测试闹钟").apply();
        }
    }
}
