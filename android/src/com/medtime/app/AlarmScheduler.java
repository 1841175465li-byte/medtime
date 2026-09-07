package com.medtime.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Persists a minimal offline mirror so alarms work without a live WebView. */
public final class AlarmScheduler {
    static final String CHANNEL = "medtime.alarms.v1";
    static final String FIRE = "com.medtime.app.ALARM_FIRE";
    static final String STOP = "com.medtime.app.ALARM_STOP";
    static final String OPEN = "com.medtime.app.ALARM_OPEN";
    static final int NOTIFICATION_ID = 301;
    static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences("medtime_native_alarms", Context.MODE_PRIVATE); }
    static String label(String slot) {
        return "morning".equals(slot) ? "早上" : "noon".equals(slot) ? "中午" : "evening".equals(slot) ? "晚上" : "测试";
    }
    static final class Snapshot {
        final Map<String,AlarmPlan.Alarm> alarms = new HashMap<>();
        final List<AlarmPlan.Medicine> meds = new ArrayList<>();
        final List<AlarmPlan.Dose> doses = new ArrayList<>();
        Snapshot(String text) throws Exception {
            if (text == null || text.length() > 4*1024*1024) throw new IllegalArgumentException("闹钟数据过大");
            JSONObject json = new JSONObject(text);
            if (json.getInt("version") != 1) throw new IllegalArgumentException("不支持的闹钟数据版本");
            JSONObject alarmJson = json.getJSONObject("alarms");
            if (alarmJson.getInt("version") != 1) throw new IllegalArgumentException("不支持的闹钟设置版本");
            for (String slot : AlarmPlan.SLOTS) {
                JSONObject alarm = alarmJson.getJSONObject(slot);
                alarms.put(slot, new AlarmPlan.Alarm(alarm.getBoolean("enabled"),alarm.getString("time")));
            }
            JSONArray medicineJson = json.getJSONArray("medications");
            if (medicineJson.length() < 1 || medicineJson.length() > 100) throw new IllegalArgumentException("药品数量不正确");
            Set<String> ids = new HashSet<>();
            for (int i=0; i<medicineJson.length(); i++) {
                JSONObject med = medicineJson.getJSONObject(i), schedule = med.getJSONObject("schedule");
                Set<String> slots = new HashSet<>();
                JSONArray chosen = schedule.getJSONArray("slots");
                for (int j=0;j<chosen.length();j++) slots.add(chosen.getString(j));
                Set<Integer> weekdays = new HashSet<>();
                chosen = schedule.getJSONArray("weekdays");
                for (int j=0;j<chosen.length();j++) weekdays.add(chosen.getInt(j));
                String id=med.getString("id");
                if (!ids.add(id)) throw new IllegalArgumentException("药品标识重复");
                meds.add(new AlarmPlan.Medicine(id,med.getString("name"),schedule.getString("mode"),schedule.getString("startDate"),schedule.getInt("intervalDays"),slots,weekdays));
            }
            JSONArray records = json.getJSONArray("records");
            if (records.length() > 20000) throw new IllegalArgumentException("记录过多");
            for (int i=0;i<records.length();i++) {
                JSONObject record = records.getJSONObject(i);
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
        NotificationManager manager = ctx.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL,"用药闹钟",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("早中晚的用药闹钟；铃声使用系统闹钟音量，可在通知中停止");
        // Audio is looped by the bounded alarm service, avoiding two simultaneous sounds.
        channel.setSound(null,null); channel.enableVibration(false);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }
    static boolean notificationsAllowed(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager manager = ctx.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return manager.areNotificationsEnabled() && channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    static boolean exactAllowed(Context ctx) {
        return Build.VERSION.SDK_INT < 31 || ctx.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }
    static PendingIntent openIntent(Context ctx, int request) {
        Intent intent = new Intent(ctx, MainActivity.class).setAction(OPEN)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx,request,intent,PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static PendingIntent alarmIntent(Context ctx, String slot, long at) {
        Intent intent = new Intent(ctx,AlarmReceiver.class).setAction(FIRE)
            .putExtra("slot",slot).putExtra("at",at);
        return PendingIntent.getBroadcast(ctx,400+AlarmPlan.index(slot),intent,PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void cancelAll(Context ctx) {
        for (String slot : AlarmPlan.SLOTS) cancelSlot(ctx,slot);
    }
    private static void cancelSlot(Context ctx, String slot) {
        Intent intent=new Intent(ctx,AlarmReceiver.class).setAction(FIRE);
        PendingIntent existing=PendingIntent.getBroadcast(ctx,400+AlarmPlan.index(slot),intent,PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (existing != null) ctx.getSystemService(AlarmManager.class).cancel(existing);
        prefs(ctx).edit().remove("next."+slot).apply();
    }
    public static synchronized JSONObject sync(Context ctx, String text) {
        try {
            new Snapshot(text); // Validate before persisting or scheduling anything.
            if (!prefs(ctx).edit().putString("snapshot",text).putBoolean("paused",false).commit()) throw new IllegalStateException("闹钟数据保存失败");
            reschedule(ctx);
            AlarmSoundService.refresh();
        } catch (Exception error) { suspend(ctx,"闹钟同步失败，请重新保存闹钟设置"); }
        return status(ctx);
    }
    public static synchronized void suspend(Context ctx, String reason) {
        prefs(ctx).edit().putBoolean("paused",true).putString("error",reason).commit();
        cancelAll(ctx); stop(ctx);
    }
    public static synchronized void reschedule(Context ctx) {
        ensureChannel(ctx);
        if (prefs(ctx).getBoolean("paused",false)) { cancelAll(ctx); return; }
        if (!notificationsAllowed(ctx) || !exactAllowed(ctx)) { cancelAll(ctx); stop(ctx); return; }
        if (!prefs(ctx).contains("snapshot")) { cancelAll(ctx); return; }
        try {
            Snapshot snapshot = snapshot(ctx);
            ZoneId zone = ZoneId.systemDefault();
            Set<String> done=AlarmPlan.completions(snapshot.doses,zone);
            AlarmManager manager=ctx.getSystemService(AlarmManager.class);
            Instant now=Instant.now();
            for (String slot : AlarmPlan.SLOTS) {
                AlarmPlan.Alarm alarm=snapshot.alarms.get(slot);
                String delivered=prefs(ctx).getString("delivered."+slot,"");
                long at=AlarmPlan.next(slot,alarm,snapshot.meds,done,now,zone,delivered);
                long previous=prefs(ctx).getLong("next."+slot,0);
                // Opening/saving the app at the exact due second must not erase
                // an already due broadcast before its receiver can consume it.
                if (AlarmPlan.keepDue(slot,alarm,snapshot.meds,done,previous,now,zone,delivered)) at=previous;
                if (at == 0) { cancelSlot(ctx,slot); continue; }
                // Commit the expected instant before registering the immutable intent.
                if (!prefs(ctx).edit().putLong("next."+slot,at).commit()) throw new IllegalStateException("闹钟时间保存失败");
                manager.setAlarmClock(new AlarmManager.AlarmClockInfo(at,openIntent(ctx,500+AlarmPlan.index(slot))),alarmIntent(ctx,slot,at));
            }
            prefs(ctx).edit().remove("error").apply();
        } catch (Exception error) {
            cancelAll(ctx); stop(ctx); prefs(ctx).edit().putString("error","闹钟未能排入系统，请检查授权后重新保存").apply();
        }
    }
    static synchronized boolean consume(Context ctx, String slot, long at) {
        if (AlarmPlan.index(slot) < 0 || at <= 0 || prefs(ctx).getLong("next."+slot,0) != at) return false;
        try {
            if (!notificationsAllowed(ctx) || !exactAllowed(ctx)) { reschedule(ctx); return false; }
            Snapshot snapshot=snapshot(ctx); ZoneId zone=ZoneId.systemDefault();
            long lateness=System.currentTimeMillis()-at;
            List<String> names=AlarmPlan.pending(slot,snapshot.alarms.get(slot),snapshot.meds,AlarmPlan.completions(snapshot.doses,zone),at,zone);
            boolean due=lateness >= 0 && lateness <= 60*60*1000 && !names.isEmpty();
            if (due) {
                String delivered=AlarmPlan.deliveryKey(Instant.ofEpochMilli(at).atZone(zone).toLocalDate(),snapshot.alarms.get(slot));
                if (delivered.equals(prefs(ctx).getString("delivered."+slot,""))) due=false;
                else if (!prefs(ctx).edit().putString("delivered."+slot,delivered).commit()) due=false;
            }
            reschedule(ctx); // Chain the next calendar occurrence, including intervals/weekdays.
            return due;
        } catch (Exception error) { suspend(ctx,"闹钟数据暂时无法读取，请打开应用重新保存"); return false; }
    }
    public static synchronized JSONObject status(Context ctx) {
        JSONObject result=new JSONObject(), scheduled=new JSONObject();
        try {
            ensureChannel(ctx);
            boolean notifications=notificationsAllowed(ctx), exact=exactAllowed(ctx);
            String error=prefs(ctx).getString("error","");
            if (error.isEmpty()) error=prefs(ctx).getString("audioError","");
            result.put("supported",true).put("notifications",notifications).put("exact",exact)
                .put("ready",notifications && exact && !prefs(ctx).getBoolean("paused",false) && error.isEmpty())
                .put("ringing",AlarmSoundService.isRinging()).put("error",error);
            for (String slot:AlarmPlan.SLOTS) scheduled.put(slot, notifications && exact ? prefs(ctx).getLong("next."+slot,0) : 0);
            result.put("scheduled",scheduled);
        } catch (Exception ignored) { }
        return result;
    }
    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx,AlarmSoundService.class));
        ctx.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
    }
    public static JSONObject test(Context ctx) {
        JSONObject result=new JSONObject();
        try {
            ensureChannel(ctx);
            if (!notificationsAllowed(ctx) || !exactAllowed(ctx)) throw new IllegalStateException("请先允许通知和准时闹钟");
            ctx.startForegroundService(new Intent(ctx,AlarmSoundService.class).putExtra("test",true));
            result.put("ok",true);
        } catch (Exception error) {
            try { result.put("ok",false).put("error","请先允许通知和准时闹钟，再测试响铃"); } catch (Exception ignored) { }
        }
        return result;
    }
}
