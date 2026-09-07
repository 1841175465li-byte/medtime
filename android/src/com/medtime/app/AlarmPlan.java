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

/** Pure calendar rules shared by Android scheduling and JVM regression tests. */
public final class AlarmPlan {
    public static final String[] SLOTS = {"morning", "noon", "evening"};
    public static final class Alarm {
        public final boolean enabled;
        public final LocalTime time;
        public Alarm(boolean enabled, String time) {
            if (time == null || !time.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) throw new IllegalArgumentException("闹钟时间无效");
            this.enabled = enabled; this.time = LocalTime.parse(time);
        }
    }
    public static final class Medicine {
        public final String id, name, mode;
        public final LocalDate start;
        public final int interval;
        public final Set<String> slots;
        public final Set<Integer> weekdays;
        public Medicine(String id, String name, String mode, String start, int interval,
                Set<String> slots, Set<Integer> weekdays) {
            if (id == null || !id.matches("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}") || name == null || name.isEmpty() || name.length() > 60)
                throw new IllegalArgumentException("药品标识或名称无效");
            if (!mode.matches("none|daily|interval|weekly") || interval < 2 || interval > 365)
                throw new IllegalArgumentException("服药频率无效");
            this.start = LocalDate.parse(start);
            if (this.start.getYear() < 1 || this.start.getYear() > 9999) throw new IllegalArgumentException("开始日期无效");
            for (String slot : slots) if (index(slot) < 0) throw new IllegalArgumentException("时段无效");
            for (int day : weekdays) if (day < 1 || day > 7) throw new IllegalArgumentException("星期无效");
            if (!mode.equals("none") && slots.isEmpty()) throw new IllegalArgumentException("请选择时段");
            if (mode.equals("weekly") && weekdays.isEmpty()) throw new IllegalArgumentException("请选择星期");
            this.id=id; this.name=name; this.mode=mode; this.interval=interval;
            this.slots=new HashSet<>(slots); this.weekdays=new HashSet<>(weekdays);
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
        if (med.mode.equals("none") || day.isBefore(med.start)) return false;
        if (med.mode.equals("daily")) return true;
        if (med.mode.equals("interval")) return ChronoUnit.DAYS.between(med.start, day) % med.interval == 0;
        return med.weekdays.contains(day.getDayOfWeek().getValue());
    }
    private static LocalDate nextDate(Medicine med, LocalDate from) {
        LocalDate day = from.isBefore(med.start) ? med.start : from;
        if (med.mode.equals("none")) return null;
        if (med.mode.equals("interval")) {
            long remainder = ChronoUnit.DAYS.between(med.start, day) % med.interval;
            if (remainder != 0) day = day.plusDays(med.interval - remainder);
        } else if (med.mode.equals("weekly")) {
            for (int i=0; i<7; i++) {
                LocalDate candidate=day.plusDays(i);
                if (candidate.getYear()>9999) return null;
                if (med.weekdays.contains(candidate.getDayOfWeek().getValue())) return candidate;
            }
            return null;
        }
        return day.getYear() <= 9999 ? day : null;
    }
    public static String deliveryKey(LocalDate day, Alarm alarm) { return day + "T" + alarm.time; }
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
                long at = day.atTime(alarm.time).atZone(zone).toInstant().toEpochMilli();
                if (at > after.toEpochMilli() && !done.contains(key(med.id,slot,day))
                        && !deliveryKey(day,alarm).equals(delivered)) { earliest=Math.min(earliest,at); break; }
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
        // Reject broadcasts left over after a time setting change.
        if (day.atTime(alarm.time).atZone(zone).toInstant().toEpochMilli() != at) return names;
        for (Medicine med : meds) if (med.slots.contains(slot) && scheduledOn(med,day)
                && !done.contains(key(med.id,slot,day))) names.add(med.name);
        return names;
    }
    public static boolean keepDue(String slot, Alarm alarm, List<Medicine> meds, Set<String> done,
            long previous, Instant now, ZoneId zone, String delivered) {
        return previous>0 && previous<=now.toEpochMilli() && now.toEpochMilli()-previous<=60000
            && !deliveryKey(Instant.ofEpochMilli(previous).atZone(zone).toLocalDate(),alarm).equals(delivered)
            && !pending(slot,alarm,meds,done,previous,zone).isEmpty();
    }
}
