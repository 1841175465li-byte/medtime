package com.medtime.app;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Minimal private mirror, regular alarms, and explicit lock-screen tests. */
public final class AlarmScheduler {
    static final String CHANNEL="medtime.alarms.v1", FIRE="com.medtime.app.ALARM_FIRE";
    static final String STOP="com.medtime.app.ALARM_STOP", OPEN="com.medtime.app.ALARM_OPEN";
    static final String TEST_FIRE="com.medtime.app.TEST_FIRE";
    static final int NOTIFICATION_ID=301;
    static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences("medtime_native_alarms",Context.MODE_PRIVATE); }
    static String label(String slot) {
        return "morning".equals(slot)?"早上":"noon".equals(slot)?"中午":"evening".equals(slot)?"晚上":"bedtime".equals(slot)?"睡前":"测试";
    }
    static final class Snapshot {
        final Map<String,AlarmPlan.Alarm> alarms=new HashMap<>();
        final List<AlarmPlan.Medicine> meds=new ArrayList<>();
        final List<AlarmPlan.Dose> doses=new ArrayList<>();
        Snapshot(String text) throws Exception {
            if (text==null || text.length()>4*1024*1024) throw new IllegalArgumentException("闹钟数据过大");
            JSONObject json=new JSONObject(text);
            int version=json.getInt("version");
            if (version!=1 && version!=2) throw new IllegalArgumentException("不支持的闹钟数据版本");
            JSONObject alarmJson=json.getJSONObject("alarms");
            int alarmVersion=alarmJson.getInt("version");
            if (alarmVersion!=1 && alarmVersion!=2) throw new IllegalArgumentException("不支持的闹钟设置版本");
            for (String slot:AlarmPlan.SLOTS) {
                if (alarmVersion==1 && "bedtime".equals(slot)) { alarms.put(slot,new AlarmPlan.Alarm(false,"22:00")); continue; }
                JSONObject alarm=alarmJson.getJSONObject(slot);
                alarms.put(slot,new AlarmPlan.Alarm(alarm.getBoolean("enabled"),alarm.getString("time")));
            }
            JSONArray medicineJson=json.getJSONArray("medications");
            if (medicineJson.length()>100) throw new IllegalArgumentException("药品数量不正确");
            Set<String> ids=new HashSet<>();
            for (int i=0;i<medicineJson.length();i++) {
                JSONObject med=medicineJson.getJSONObject(i), schedule=med.getJSONObject("schedule");
                Set<String> slots=new HashSet<>(); JSONArray chosen=schedule.getJSONArray("slots");
                for (int j=0;j<chosen.length();j++) if (!slots.add(chosen.getString(j))) throw new IllegalArgumentException("时段重复");
                Set<Integer> weekdays=new HashSet<>(); chosen=schedule.getJSONArray("weekdays");
                for (int j=0;j<chosen.length();j++) if (!weekdays.add(chosen.getInt(j))) throw new IllegalArgumentException("星期重复");
                String id=med.getString("id");
                if (!ids.add(id)) throw new IllegalArgumentException("药品标识重复");
                Map<String,String> times=new HashMap<>();
                if (version==2) {
                    JSONObject overrides=schedule.getJSONObject("times");
                    Iterator<String> keys=overrides.keys();
                    while (keys.hasNext()) { String key=keys.next(); times.put(key,overrides.getString(key)); }
                }
                meds.add(new AlarmPlan.Medicine(id,med.getString("name"),schedule.getString("mode"),schedule.getString("startDate"),schedule.getInt("intervalDays"),slots,weekdays,
                    version==1 || schedule.isNull("endDate")?null:schedule.getString("endDate"),version==1?"active":med.getString("status"),times));
            }
            JSONArray records=json.getJSONArray("records");
            if (records.length()>20000) throw new IllegalArgumentException("记录过多");
            for (int i=0;i<records.length();i++) {
                JSONObject record=records.getJSONObject(i);
                if (!ids.contains(record.getString("medicationId"))) throw new IllegalArgumentException("记录药品不存在");
                doses.add(new AlarmPlan.Dose(record.getString("medicationId"),record.getString("slot"),record.getString("takenAt")));
            }
        }
    }
    static Snapshot snapshot(Context ctx) throws Exception {
        if (prefs(ctx).getBoolean("paused",false)) throw new IllegalStateException("闹钟已暂停");
        return new Snapshot(prefs(ctx).getString("snapshot",null));
    }
    static void ensureChannel(Context ctx) {
        NotificationManager manager=ctx.getSystemService(NotificationManager.class);
        NotificationChannel channel=new NotificationChannel(CHANNEL,"用药闹钟",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("早中晚及睡前提醒，使用系统闹钟音量，可停止响铃或打开药记");
        channel.setSound(null,null); channel.enableVibration(false);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }
    static boolean notificationsAllowed(Context ctx) {
        if (Build.VERSION.SDK_INT>=33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager manager=ctx.getSystemService(NotificationManager.class);
        NotificationChannel channel=manager.getNotificationChannel(CHANNEL);
        return manager.areNotificationsEnabled() && channel!=null && channel.getImportance()!=NotificationManager.IMPORTANCE_NONE;
    }
    static boolean exactAllowed(Context ctx) { return Build.VERSION.SDK_INT<31 || ctx.getSystemService(AlarmManager.class).canScheduleExactAlarms(); }
    static PendingIntent openIntent(Context ctx,int request) {
        return PendingIntent.getActivity(ctx,request,new Intent(ctx,MainActivity.class).setAction(OPEN).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private static PendingIntent alarmIntent(Context ctx,String slot,long at,int flags) {
        return PendingIntent.getBroadcast(ctx,400+AlarmPlan.index(slot),new Intent(ctx,AlarmReceiver.class).setAction(FIRE).putExtra("slot",slot).putExtra("at",at),flags|PendingIntent.FLAG_IMMUTABLE);
    }
    private static PendingIntent testIntent(Context ctx,long at,int flags) {
        return PendingIntent.getBroadcast(ctx,701,new Intent(ctx,AlarmReceiver.class).setAction(TEST_FIRE).putExtra("at",at),flags|PendingIntent.FLAG_IMMUTABLE);
    }
    private static void register(Context ctx,long at,PendingIntent intent) {
        ctx.getSystemService(AlarmManager.class).setAlarmClock(new AlarmManager.AlarmClockInfo(at,openIntent(ctx,600)),intent);
    }
    private static void cancel(Context ctx,PendingIntent intent) {
        if (intent!=null) { ctx.getSystemService(AlarmManager.class).cancel(intent); intent.cancel(); }
    }
    private static void cancelSlot(Context ctx,String slot) {
        cancel(ctx,alarmIntent(ctx,slot,0,PendingIntent.FLAG_NO_CREATE));
        prefs(ctx).edit().remove("next."+slot).apply();
    }
    /** Cancel 1.7.0 deferred alarms during upgrade; never register them again. */
    static synchronized void clearLegacySnoozes(Context ctx) {
        if (!prefs(ctx).contains("snoozes")) return;
        try {
            JSONArray items=new JSONArray(prefs(ctx).getString("snoozes","[]"));
            for (int i=0;i<items.length();i++) {
                try {
                    JSONObject item=items.getJSONObject(i);
                    Intent intent=new Intent(ctx,AlarmReceiver.class).setAction("com.medtime.app.SNOOZE_FIRE")
                        .setData(Uri.parse("medtime://snooze/"+item.getString("slot")+"/"+item.getLong("origin")));
                    cancel(ctx,PendingIntent.getBroadcast(ctx,700,intent,PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE));
                } catch (Exception ignored) { }
            }
        } catch (Exception ignored) { }
        prefs(ctx).edit().remove("snoozes").apply();
        cancel(ctx,PendingIntent.getBroadcast(ctx,602,new Intent(ctx,AlarmReceiver.class).setAction("com.medtime.app.ALARM_SNOOZE"),PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE));
    }
    private static void cancelAll(Context ctx) {
        for (String slot:AlarmPlan.SLOTS) cancelSlot(ctx,slot);
        clearLegacySnoozes(ctx);
        cancelTest(ctx);
    }
    public static synchronized JSONObject sync(Context ctx,String text) {
        try {
            new Snapshot(text);
            if (!prefs(ctx).edit().putString("snapshot",text).putBoolean("paused",false).commit()) throw new IllegalStateException("闹钟数据保存失败");
            reschedule(ctx); AlarmSoundService.refresh();
        } catch (Exception error) { suspend(ctx,"闹钟同步失败，请重新保存闹钟设置"); }
        return status(ctx);
    }
    public static synchronized void suspend(Context ctx,String reason) {
        prefs(ctx).edit().putBoolean("paused",true).putString("error",reason).commit();
        cancelAll(ctx); stop(ctx);
    }
    public static synchronized void reschedule(Context ctx) {
        reschedule(ctx,null,0);
    }
    private static synchronized void reschedule(Context ctx,String catchingSlot,long caughtAt) {
        clearLegacySnoozes(ctx);
        ensureChannel(ctx);
        if (prefs(ctx).getBoolean("paused",false) || !notificationsAllowed(ctx) || !exactAllowed(ctx)) { cancelAll(ctx); stop(ctx); return; }
        if (!prefs(ctx).contains("snapshot")) return;
        try {
            Snapshot snapshot=snapshot(ctx); ZoneId zone=ZoneId.systemDefault();
            Set<String> done=AlarmPlan.completions(snapshot.doses,zone); Instant now=Instant.now();
            for (String slot:AlarmPlan.SLOTS) {
                AlarmPlan.Alarm alarm=snapshot.alarms.get(slot); String delivered=prefs(ctx).getString("delivered."+slot,"");
                // A late broadcast must not skip a different medicine's later time
                // in the same period. Chain already-due occurrences within one hour.
                Instant after=slot.equals(catchingSlot)?Instant.ofEpochMilli(Math.max(caughtAt,now.toEpochMilli()-60*60*1000)):now;
                long at=AlarmPlan.next(slot,alarm,snapshot.meds,done,after,zone,delivered), previous=prefs(ctx).getLong("next."+slot,0);
                if (AlarmPlan.keepDue(slot,alarm,snapshot.meds,done,previous,now,zone,delivered)) at=previous;
                if (at==0) { cancelSlot(ctx,slot); continue; }
                if (!prefs(ctx).edit().putLong("next."+slot,at).commit()) throw new IllegalStateException("闹钟时间保存失败");
                register(ctx,at,alarmIntent(ctx,slot,at,PendingIntent.FLAG_UPDATE_CURRENT));
            }
            long testAt=prefs(ctx).getLong("test.next",0);
            if (testAt>0) {
                if (testAt<now.toEpochMilli()-60000) cancelTest(ctx);
                else register(ctx,testAt,testIntent(ctx,testAt,PendingIntent.FLAG_UPDATE_CURRENT));
            }
            prefs(ctx).edit().remove("error").apply();
        } catch (Exception error) {
            cancelAll(ctx); stop(ctx); prefs(ctx).edit().putString("error","闹钟未能排入系统，请检查授权后重新保存").apply();
        }
    }
    static synchronized boolean consume(Context ctx,String slot,long at) {
        if (AlarmPlan.index(slot)<0 || at<=0 || prefs(ctx).getLong("next."+slot,0)!=at) return false;
        try {
            if (!notificationsAllowed(ctx) || !exactAllowed(ctx)) { reschedule(ctx); return false; }
            Snapshot snapshot=snapshot(ctx); ZoneId zone=ZoneId.systemDefault(); long lateness=System.currentTimeMillis()-at;
            List<String> names=AlarmPlan.pending(slot,snapshot.alarms.get(slot),snapshot.meds,AlarmPlan.completions(snapshot.doses,zone),at,zone);
            boolean due=lateness>=0 && lateness<=60*60*1000 && !names.isEmpty();
            if (due) {
                String delivered=AlarmPlan.deliveryKey(at,zone);
                if (delivered.equals(prefs(ctx).getString("delivered."+slot,""))) due=false;
                else if (!prefs(ctx).edit().putString("delivered."+slot,delivered).commit()) due=false;
            }
            if (lateness>=0) reschedule(ctx,slot,at); else reschedule(ctx);
            return due;
        } catch (Exception error) { suspend(ctx,"闹钟数据暂时无法读取，请打开应用重新保存"); return false; }
    }
    public static synchronized JSONObject scheduleTest(Context ctx) {
        try {
            ensureChannel(ctx);
            if (!notificationsAllowed(ctx) || !exactAllowed(ctx)) throw new IllegalStateException("请先允许通知和准时闹钟");
            if (AlarmSoundService.isRinging()) throw new IllegalStateException("请先处理当前响铃，再安排锁屏测试");
            long at=System.currentTimeMillis()+60000;
            if (!prefs(ctx).edit().putLong("test.next",at).putLong("test.planned",at).putLong("test.triggered",0).putLong("test.audio",0).putString("test.result","pending").commit()) throw new IllegalStateException("测试时间保存失败");
            register(ctx,at,testIntent(ctx,at,PendingIntent.FLAG_UPDATE_CURRENT));
            return reply(true,"").put("at",at);
        } catch (Exception error) { cancelTest(ctx); return reply(false,error.getMessage()); }
    }
    public static synchronized void cancelTest(Context ctx) {
        cancel(ctx,testIntent(ctx,0,PendingIntent.FLAG_NO_CREATE));
        SharedPreferences.Editor edit=prefs(ctx).edit();
        if (prefs(ctx).getLong("test.next",0)>0) edit.putString("test.result","cancelled");
        edit.remove("test.next").apply();
    }
    static synchronized boolean consumeTest(Context ctx,long at) {
        long now=System.currentTimeMillis();
        if (at<=0 || prefs(ctx).getLong("test.next",0)!=at || now<at) return false;
        if (now-at>5*60*1000 || !notificationsAllowed(ctx) || !exactAllowed(ctx)) { cancelTest(ctx); return false; }
        cancel(ctx,testIntent(ctx,0,PendingIntent.FLAG_NO_CREATE));
        return prefs(ctx).edit().remove("test.next").putLong("test.triggered",now).putString("test.result","awaiting").commit();
    }
    public static synchronized JSONObject confirmTest(Context ctx,boolean heard) {
        String previous=prefs(ctx).getString("test.result","");
        if (prefs(ctx).getLong("test.triggered",0)==0 || !(previous.equals("awaiting") || previous.equals("heard") || previous.equals("unheard"))) return reply(false,"请先完成一次锁屏测试");
        boolean saved=prefs(ctx).edit().putString("test.result",heard?"heard":"unheard").commit();
        return reply(saved,saved?"":"测试结果保存失败");
    }
    static JSONObject reply(boolean ok,String error) {
        JSONObject result=new JSONObject();
        try { result.put("ok",ok); if (error!=null && !error.isEmpty()) result.put("error",error); } catch (Exception ignored) { }
        return result;
    }
    public static synchronized JSONObject status(Context ctx) {
        JSONObject result=new JSONObject(), scheduled=new JSONObject();
        try {
            ensureChannel(ctx); boolean notifications=notificationsAllowed(ctx), exact=exactAllowed(ctx);
            String error=prefs(ctx).getString("error",""); if (error.isEmpty()) error=prefs(ctx).getString("audioError","");
            AudioManager audio=ctx.getSystemService(AudioManager.class); int volume=audio.getStreamVolume(AudioManager.STREAM_ALARM);
            result.put("supported",true).put("notifications",notifications).put("exact",exact)
                .put("ready",notifications && exact && volume>0 && !prefs(ctx).getBoolean("paused",false) && error.isEmpty())
                .put("ringing",AlarmSoundService.isRinging()).put("error",error)
                .put("alarmVolume",volume).put("maxAlarmVolume",audio.getStreamMaxVolume(AudioManager.STREAM_ALARM))
                .put("powerSave",ctx.getSystemService(PowerManager.class).isPowerSaveMode())
                .put("backgroundRestricted",Build.VERSION.SDK_INT>=28 && ctx.getSystemService(ActivityManager.class).isBackgroundRestricted())
                .put("interruptionFilter",ctx.getSystemService(NotificationManager.class).getCurrentInterruptionFilter())
                .put("testScheduled",prefs(ctx).getLong("test.next",0)).put("testPlanned",prefs(ctx).getLong("test.planned",0))
                .put("testTriggered",prefs(ctx).getLong("test.triggered",0)).put("testAudioStarted",prefs(ctx).getLong("test.audio",0))
                .put("testResult",prefs(ctx).getString("test.result","none"));
            for (String slot:AlarmPlan.SLOTS) scheduled.put(slot,notifications && exact?prefs(ctx).getLong("next."+slot,0):0);
            result.put("scheduled",scheduled);
        } catch (Exception ignored) { }
        return result;
    }
    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx,AlarmSoundService.class)); ctx.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
    }
    public static JSONObject test(Context ctx) {
        try {
            ensureChannel(ctx);
            if (!notificationsAllowed(ctx)) throw new IllegalStateException("请先允许通知，再试听铃声");
            if (AlarmSoundService.isRinging()) throw new IllegalStateException("请先处理当前响铃");
            ctx.startForegroundService(new Intent(ctx,AlarmSoundService.class).putExtra("test",true)); return reply(true,"");
        } catch (Exception error) { return reply(false,error.getMessage()); }
    }
}
