package com.medtime.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import java.time.ZoneId;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** A user-visible alarm, bounded to 60 seconds, with a notification stop action. */
public final class AlarmSoundService extends Service {
    private static volatile AlarmSoundService running;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Map<String,Long> active=new LinkedHashMap<>();
    private final Runnable stopTask=this::stopSelf;
    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wake;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private volatile long deadline;
    private boolean sounding;
    static boolean isRinging() { AlarmSoundService service=running; return service != null && SystemClock.elapsedRealtime() < service.deadline; }
    static void refresh() {
        AlarmSoundService service=running;
        if (service != null) service.handler.post(service::refreshActive);
    }
    @Override public void onCreate() {
        super.onCreate(); running=this;
        wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"medtime:alarm-sound");
        wake.acquire(70000);
        AlarmReceiver.releaseHandoff();
        AlarmScheduler.ensureChannel(this);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !AlarmScheduler.notificationsAllowed(this)) { stopSelf(); return START_NOT_STICKY; }
        boolean test=intent.getBooleanExtra("test",false);
        String slot=test ? "test" : intent.getStringExtra("slot");
        if (!test && AlarmPlan.index(slot) < 0) { stopSelf(); return START_NOT_STICKY; }
        active.put(slot,intent.getLongExtra("at",System.currentTimeMillis()));
        long duration=test && active.size()==1 ? 5000 : 60000;
        deadline=SystemClock.elapsedRealtime()+duration;
        Notification notification=notification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(AlarmScheduler.NOTIFICATION_ID,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(AlarmScheduler.NOTIFICATION_ID,notification);
        if (wake.isHeld()) wake.release();
        wake.acquire(duration+5000);
        AlarmReceiver.releaseHandoff();
        handler.removeCallbacks(stopTask); handler.postDelayed(stopTask,duration);
        if (!sounding) startSound();
        refreshActive();
        return START_NOT_STICKY;
    }
    private Notification notification() {
        StringBuilder labels=new StringBuilder();
        for (String slot:active.keySet()) { if (labels.length()>0) labels.append("、"); labels.append(AlarmScheduler.label(slot)); }
        PendingIntent stop=PendingIntent.getBroadcast(this,601,new Intent(this,AlarmReceiver.class).setAction(AlarmScheduler.STOP),PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification publicVersion=new Notification.Builder(this,AlarmScheduler.CHANNEL).setSmallIcon(R.drawable.ic_alarm)
            .setContentTitle("药记 · 用药闹钟").setContentText("点击查看或停止响铃").build();
        return new Notification.Builder(this,AlarmScheduler.CHANNEL).setSmallIcon(R.drawable.ic_alarm)
            .setContentTitle(labels + "用药闹钟")
            .setContentText(active.containsKey("test") && active.size()==1 ? "测试响铃，约 5 秒后停止" : "查看今日安排，用药后再记录；响铃最多 1 分钟")
            .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion).setOngoing(true).setOnlyAlertOnce(true)
            .setContentIntent(AlarmScheduler.openIntent(this,600))
            .setDeleteIntent(stop)
            .addAction(new Notification.Action.Builder(null,"停止响铃",stop).build())
            .addAction(new Notification.Action.Builder(null,"打开药记",AlarmScheduler.openIntent(this,600)).build()).build();
    }
    private void startSound() {
        sounding=true;
        AudioAttributes attrs=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        audio=getSystemService(AudioManager.class);
        focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener(change -> { if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) stopSelf(); }).build();
        if (audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            try {
                Uri sound=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (sound == null) sound=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                player=new MediaPlayer(); player.setAudioAttributes(attrs); player.setDataSource(this,sound); player.setLooping(true);
                player.setOnPreparedListener(ready -> {
                    if (running == this && isRinging()) {
                        ready.start(); AlarmScheduler.prefs(this).edit().remove("audioError").apply();
                    }
                });
                player.setOnErrorListener((failed,what,extra) -> { reportSoundFailure(); return true; });
                player.prepareAsync();
            } catch (Exception error) { reportSoundFailure(); }
        } else { reportSoundFailure(); }
        vibrator=getSystemService(Vibrator.class);
        if (vibrator != null && vibrator.hasVibrator()) vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0,500,600,500,1600},0),attrs);
    }
    private void reportSoundFailure() {
        AlarmScheduler.prefs(this).edit().putString("audioError","铃声未能播放，请检查系统闹钟音量并测试响铃").apply();
    }
    private void refreshActive() {
        if (running != this || active.isEmpty()) return;
        if (!AlarmScheduler.notificationsAllowed(this)) { stopSelf(); return; }
        try {
            // Testing works without setting a medicine frequency or exact-alarm access.
            if (active.size()==1 && active.containsKey("test")) return;
            AlarmScheduler.Snapshot snapshot=AlarmScheduler.snapshot(this); ZoneId zone=ZoneId.systemDefault();
            Set<String> done=AlarmPlan.completions(snapshot.doses,zone);
            Iterator<Map.Entry<String,Long>> iterator=active.entrySet().iterator();
            while (iterator.hasNext()) {
                Map.Entry<String,Long> entry=iterator.next();
                if ("test".equals(entry.getKey())) continue;
                if (AlarmPlan.pending(entry.getKey(),snapshot.alarms.get(entry.getKey()),snapshot.meds,done,entry.getValue(),zone).isEmpty()) iterator.remove();
            }
            if (active.isEmpty()) stopSelf();
            else getSystemService(NotificationManager.class).notify(AlarmScheduler.NOTIFICATION_ID,notification());
        } catch (Exception error) { stopSelf(); }
    }
    @Override public void onDestroy() {
        running=null; deadline=0; handler.removeCallbacksAndMessages(null);
        if (player != null) { player.release(); player=null; }
        if (vibrator != null) vibrator.cancel();
        if (audio != null && focus != null) audio.abandonAudioFocusRequest(focus);
        if (wake != null && wake.isHeld()) wake.release();
        AlarmReceiver.releaseHandoff();
        stopForeground(true);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
