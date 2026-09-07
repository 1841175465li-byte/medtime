package com.medtime.app;
import java.time.*;
import java.util.*;

public final class AlarmManagementTest {
    private static int count;
    private static final ZoneId SH=ZoneId.of("Asia/Shanghai");
    private static final AlarmPlan.Alarm ON=new AlarmPlan.Alarm(true,"08:00");
    private static final Set<String> EMPTY=Collections.emptySet();
    private static long at(String instant) { return Instant.parse(instant).toEpochMilli(); }
    private static void check(boolean value,String message) { count++; if (!value) throw new AssertionError(message); }
    private static void equal(long actual,long expected,String message) { check(actual==expected,message+": "+actual+" expected "+expected); }
    private static AlarmPlan.Medicine med(String id,String status,String end,String morning,String bedtime) {
        Map<String,String> times=new HashMap<>(); if (morning!=null) times.put("morning",morning); if (bedtime!=null) times.put("bedtime",bedtime);
        return new AlarmPlan.Medicine(id,id,"daily","2025-07-01",2,new HashSet<>(Arrays.asList("morning","bedtime")),Collections.emptySet(),end,status,times);
    }
    private static long next(String slot,AlarmPlan.Alarm alarm,List<AlarmPlan.Medicine> meds,String after,String delivered) {
        return AlarmPlan.next(slot,alarm,meds,EMPTY,Instant.parse(after),SH,delivered);
    }
    public static void main(String[] args) {
        AlarmPlan.Medicine a=med("a","active",null,"09:15","22:45"), b=med("b","active",null,"10:00",null);
        List<AlarmPlan.Medicine> both=Arrays.asList(a,b);
        equal(next("morning",ON,both,"2025-07-12T00:00:00Z",""),at("2025-07-12T01:15:00Z"),"earliest medicine override");
        equal(next("morning",ON,both,"2025-07-12T01:15:00Z","2025-07-12T09:15"),at("2025-07-12T02:00:00Z"),"later override in same period still rings");
        equal(next("morning",ON,both,"2025-07-12T02:00:00Z","2025-07-12T10:00"),at("2025-07-13T01:15:00Z"),"next day after both times");
        check(AlarmPlan.pending("morning",ON,both,EMPTY,at("2025-07-12T01:15:00Z"),SH).equals(Arrays.asList("a")),"only medicine at that time is pending");
        check(AlarmPlan.pending("morning",new AlarmPlan.Alarm(true,"07:00"),both,EMPTY,at("2025-07-12T01:15:00Z"),SH).equals(Arrays.asList("a")),"shared time edit leaves override intact");
        check(AlarmPlan.pending("morning",ON,both,EMPTY,at("2025-07-12T00:00:00Z"),SH).isEmpty(),"shared broadcast cannot remind custom medicine early");
        AlarmPlan.Alarm bed=new AlarmPlan.Alarm(true,"22:00");
        equal(next("bedtime",bed,Arrays.asList(a),"2025-07-12T13:00:00Z",""),at("2025-07-12T14:45:00Z"),"bedtime override");
        equal(next("bedtime",bed,Arrays.asList(b),"2025-07-12T13:00:00Z",""),at("2025-07-12T14:00:00Z"),"bedtime shared fallback");
        equal(next("morning",new AlarmPlan.Alarm(false,"08:00"),both,"2025-07-12T00:00:00Z",""),0,"master switch also stops overrides");
        for (String status:new String[]{"paused","archived"}) {
            AlarmPlan.Medicine stopped=med("a",status,null,"09:15","22:45");
            equal(next("morning",ON,Arrays.asList(stopped),"2025-07-12T00:00:00Z",""),0,status+" stops schedule");
            check(AlarmPlan.pending("morning",ON,Arrays.asList(stopped),EMPTY,at("2025-07-12T01:15:00Z"),SH).isEmpty(),status+" invalidates old broadcast");
        }
        AlarmPlan.Medicine course=med("a","active","2025-07-12","09:15","22:45");
        check(AlarmPlan.scheduledOn(course,LocalDate.parse("2025-07-12")),"course last day is inclusive");
        check(!AlarmPlan.scheduledOn(course,LocalDate.parse("2025-07-13")),"course stops following day");
        equal(next("morning",ON,Arrays.asList(course),"2025-07-12T02:00:00Z",""),0,"no next morning after course ends");
        equal(next("bedtime",bed,Arrays.asList(course),"2025-07-12T02:00:00Z",""),at("2025-07-12T14:45:00Z"),"last bedtime remains scheduled");
        long origin=at("2025-07-12T01:15:00Z"), later=origin+10*60*1000;
        check(AlarmPlan.snoozeEligible("morning",ON,both,EMPTY,origin,later,SH),"same-day pending occurrence may be snoozed");
        Set<String> done=AlarmPlan.completions(Arrays.asList(new AlarmPlan.Dose("a","morning","2025-07-12T01:16:00Z")),SH);
        check(!AlarmPlan.snoozeEligible("morning",ON,both,done,origin,later,SH),"recording cancels snooze");
        check(!AlarmPlan.snoozeEligible("morning",new AlarmPlan.Alarm(false,"08:00"),both,EMPTY,origin,later,SH),"switch off cancels snooze");
        check(!AlarmPlan.snoozeEligible("morning",ON,Arrays.asList(med("a","paused",null,"09:15",null)),EMPTY,origin,later,SH),"pause cancels snooze");
        check(!AlarmPlan.snoozeEligible("morning",ON,Arrays.asList(med("a","archived",null,"09:15",null)),EMPTY,origin,later,SH),"archive cancels snooze");
        check(!AlarmPlan.snoozeEligible("morning",ON,Arrays.asList(med("a","active",null,"10:15",null)),EMPTY,origin,later,SH),"time change invalidates old snooze");
        check(!AlarmPlan.snoozeEligible("morning",ON,both,EMPTY,origin,at("2025-07-13T01:25:00Z"),SH),"never snooze into another day");
        check(!AlarmPlan.snoozeEligible("morning",ON,both,EMPTY,origin,origin-1,SH),"never snooze earlier than original");
        check(AlarmPlan.keepDue("morning",ON,both,EMPTY,origin,Instant.ofEpochMilli(origin+30*60*1000),SH,""),"refresh retains queued late alarm within delivery window");
        check(!AlarmPlan.keepDue("morning",ON,both,EMPTY,origin,Instant.ofEpochMilli(origin+60*60*1000+1),SH,""),"expired queued alarm is not revived");
        equal(next("morning",ON,both,"2025-07-12T01:15:00Z","2025-07-12T09:15"),at("2025-07-12T02:00:00Z"),"late delivery can chain from original time instead of skipping later doses");
        for (String bad:new String[]{"2025-06-30","2025-02-30"}) {
            try { med("bad","active",bad,"09:15",null); throw new AssertionError("bad end date accepted"); } catch (RuntimeException expected) {count++;}
        }
        try { med("bad","finished",null,null,null); throw new AssertionError("bad status accepted"); } catch (IllegalArgumentException expected) {count++;}
        System.out.println("AlarmManagement: "+count+" assertions passed");
    }
}
