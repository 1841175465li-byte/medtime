package com.medtime.app;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.HashMap;
import java.util.Collections;

/** Pure calendar rules shared by Android scheduling and JVM regression tests. */
public final class AlarmPlan {
    public static final String[] SLOTS = {"morning", "noon", "evening", "bedtime"};
    public static final class Alarm {
        public final boolean enabled;
        public final LocalTime time;
        public Alarm(boolean enabled, String time) {
            if (time == null || !time.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) throw new IllegalArgumentException("闹钟时间无效");
            this.enabled = enabled; this.time = LocalTime.parse(time);
        }
    }
    public static final class Medicine {
        public final String id, name, mode, status;
        public final LocalDate start, end;
        public final int interval;
        public final Set<String> slots;
        public final Set<Integer> weekdays;
        public final Map<String,LocalTime> times;
        public Medicine(String id, String name, String mode, String start, int interval,
                Set<String> slots, Set<Integer> weekdays) {
            this(id,name,mode,start,interval,slots,weekdays,null,"active",Collections.emptyMap());
        }
        public Medicine(String id, String name, String mode, String start, int interval,
                Set<String> slots, Set<Integer> weekdays, String end, String status, Map<String,String> times) {
            if (id == null || !id.matches("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}") || name == null || name.isEmpty() || name.length() > 60)
                throw new IllegalArgumentException("药品标识或名称无效");
            if (!mode.matches("none|daily|interval|weekly") || interval < 2 || interval > 365)
                throw new IllegalArgumentException("服药频率无效");
            this.start = LocalDate.parse(start);
            if (this.start.getYear() < 1 || this.start.getYear() > 9999) throw new IllegalArgumentException("开始日期无效");
            this.end = end == null ? null : LocalDate.parse(end);
            if (this.end != null && (this.end.isBefore(this.start) || this.end.getYear()>9999)) throw new IllegalArgumentException("结束日期无效");
            if (!status.matches("active|paused|archived")) throw new IllegalArgumentException("药品状态无效");
            for (String slot : slots) if (index(slot) < 0) throw new IllegalArgumentException("时段无效");
            for (int day : weekdays) if (day < 1 || day > 7) throw new IllegalArgumentException("星期无效");
            if (!mode.equals("none") && slots.isEmpty()) throw new IllegalArgumentException("请选择时段");
            if (mode.equals("weekly") && weekdays.isEmpty()) throw new IllegalArgumentException("请选择星期");
            this.id=id; this.name=name; this.mode=mode; this.interval=interval; this.status=status;
            this.slots=new HashSet<>(slots); this.weekdays=new HashSet<>(weekdays);
            this.times=new HashMap<>();
            for (Map.Entry<String,String> entry:times.entrySet()) {
                if (!slots.contains(entry.getKey())) throw new IllegalArgumentException("独立时间时段无效");
                this.times.put(entry.getKey(),new Alarm(true,entry.getValue()).time);
            }
        }
    }
    public static final class Dose {
        public final String medicationId, slot;
        public final Instant takenAt;
        public Dose(String id, String slot, String takenAt) {
            if (index(slot) < 0) throw new IllegalArgumentException("时段无效");
            this.medicationId=id; this.slot=slot; this.takenAt=Instant.parse(takenAt);
        }
    }
    public static final class Skip {
        public final String medicationId, slot;
        public final LocalDate day;
        public Skip(String id, String slot, String day) {
            if (index(slot) < 0 || id == null || !id.matches("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}")) throw new IllegalArgumentException("跳过安排无效");
            this.medicationId=id; this.slot=slot; this.day=LocalDate.parse(day);
            if (this.day.getYear()<1 || this.day.getYear()>9999) throw new IllegalArgumentException("跳过日期无效");
        }
    }
    public static Set<String> resolved(List<Dose> doses, List<Skip> skips, ZoneId zone) {
        Set<String> done=completions(doses,zone);
        for (Skip skip:skips) done.add(key(skip.medicationId,skip.slot,skip.day));
        return done;
    }
    public static int index(String slot) {
        for (int i=0; i<SLOTS.length; i++) if (SLOTS[i].equals(slot)) return i;
        return -1;
    }
    private static String key(String id, String slot, LocalDate day) { return id + "|" + slot + "|" + day; }
    public static Set<String> completions(List<Dose> doses, ZoneId zone) {
        Set<String> done = new HashSet<>();
        for (Dose dose : doses) done.add(key(dose.medicationId, dose.slot, dose.takenAt.atZone(zone).toLocalDate()));
        return done;
    }
    public static boolean scheduledOn(Medicine med, LocalDate day) {
        if (!med.status.equals("active") || med.mode.equals("none") || day.isBefore(med.start) || (med.end != null && day.isAfter(med.end))) return false;
        if (med.mode.equals("daily")) return true;
        if (med.mode.equals("interval")) return ChronoUnit.DAYS.between(med.start, day) % med.interval == 0;
        return med.weekdays.contains(day.getDayOfWeek().getValue());
    }
    private static LocalDate nextDate(Medicine med, LocalDate from) {
        LocalDate day = from.isBefore(med.start) ? med.start : from;
        if (!med.status.equals("active") || med.mode.equals("none") || (med.end != null && day.isAfter(med.end))) return null;
        if (med.mode.equals("interval")) {
            long remainder = ChronoUnit.DAYS.between(med.start, day) % med.interval;
            if (remainder != 0) day = day.plusDays(med.interval - remainder);
        } else if (med.mode.equals("weekly")) {
            for (int i=0; i<7; i++) {
                LocalDate candidate=day.plusDays(i);
                if (candidate.getYear()>9999) return null;
                if (med.weekdays.contains(candidate.getDayOfWeek().getValue())) return med.end == null || !candidate.isAfter(med.end) ? candidate : null;
            }
            return null;
        }
        return day.getYear() <= 9999 && (med.end == null || !day.isAfter(med.end)) ? day : null;
    }
    public static String deliveryKey(LocalDate day, Alarm alarm) { return day + "T" + alarm.time; }
    public static String deliveryKey(long at, ZoneId zone) {
        return Instant.ofEpochMilli(at).atZone(zone).toLocalDateTime().withSecond(0).withNano(0).toString();
    }
    private static LocalTime effectiveTime(Medicine med, String slot, Alarm fallback) {
        return med.times.containsKey(slot) ? med.times.get(slot) : fallback.time;
    }
    public static long next(String slot, Alarm alarm, List<Medicine> meds, Set<String> done,
            Instant after, ZoneId zone, String delivered) {
        if (!alarm.enabled || index(slot) < 0) return 0;
        LocalDate today = after.atZone(zone).toLocalDate();
        long earliest = Long.MAX_VALUE;
        for (Medicine med : meds) {
            if (!med.slots.contains(slot)) continue;
            LocalDate day = nextDate(med, today);
            // A completion or delivered reminder may skip multiple future dates.
            // Each skip consumes a distinct completion (plus at most today/delivered).
            for (int tries=0; day != null && tries <= done.size()+3; tries++) {
                long at = day.atTime(effectiveTime(med,slot,alarm)).atZone(zone).toInstant().toEpochMilli();
                if (at > after.toEpochMilli() && !done.contains(key(med.id,slot,day))
                        && !deliveryKey(at,zone).equals(delivered)) { earliest=Math.min(earliest,at); break; }
                if (day.getYear() >= 9999 && day.getDayOfYear() >= day.lengthOfYear()) break;
                day = nextDate(med, day.plusDays(1));
            }
        }
        return earliest == Long.MAX_VALUE ? 0 : earliest;
    }
    public static List<String> pending(String slot, Alarm alarm, List<Medicine> meds,
            Set<String> done, long at, ZoneId zone) {
        List<String> names = new ArrayList<>();
        if (!alarm.enabled || index(slot) < 0) return names;
        LocalDate day = Instant.ofEpochMilli(at).atZone(zone).toLocalDate();
        for (Medicine med : meds) if (med.slots.contains(slot) && scheduledOn(med,day)
                && day.atTime(effectiveTime(med,slot,alarm)).atZone(zone).toInstant().toEpochMilli() == at
                && !done.contains(key(med.id,slot,day))) names.add(med.name);
        return names;
    }
    public static boolean keepDue(String slot, Alarm alarm, List<Medicine> meds, Set<String> done,
            long previous, Instant now, ZoneId zone, String delivered) {
        return previous>0 && previous<=now.toEpochMilli() && now.toEpochMilli()-previous<=60*60*1000
            && !deliveryKey(previous,zone).equals(delivered)
            && !pending(slot,alarm,meds,done,previous,zone).isEmpty();
    }
}
