package com.medtime.app;
import java.time.*;
import java.util.*;

public final class AlarmPlanTest {
    private static int assertions;
    private static final ZoneId SH=ZoneId.of("Asia/Shanghai");
    private static final AlarmPlan.Alarm ON=new AlarmPlan.Alarm(true,"08:00");
    private static final Set<String> EMPTY=Collections.emptySet();
    private static AlarmPlan.Medicine med(String id,String mode,String start,int interval,String[] slots,Integer... weekdays) {
        return new AlarmPlan.Medicine(id,id,mode,start,interval,new HashSet<>(Arrays.asList(slots)),new HashSet<>(Arrays.asList(weekdays)));
    }
    private static long at(String text) { return Instant.parse(text).toEpochMilli(); }
    private static long next(String slot,AlarmPlan.Alarm alarm,List<AlarmPlan.Medicine> meds,Set<String> done,String after,ZoneId zone,String delivered) {
        return AlarmPlan.next(slot,alarm,meds,done,Instant.parse(after),zone,delivered);
    }
    private static void check(boolean pass,String message) { assertions++; if (!pass) throw new AssertionError(message); }
    private static void equal(long got,long expected,String message) { check(got==expected,message+" got="+got+" expected="+expected); }
    public static void main(String[] args) {
        AlarmPlan.Medicine daily=med("daily","daily","2025-01-01",2,new String[]{"morning","evening"});
        List<AlarmPlan.Medicine> meds=Arrays.asList(daily);
        equal(next("morning",ON,meds,EMPTY,"2025-07-12T23:00:00Z",SH,""),at("2025-07-13T00:00:00Z"),"today before 08:00");
        equal(next("morning",ON,meds,EMPTY,"2025-07-13T00:00:00Z",SH,""),at("2025-07-14T00:00:00Z"),"new alarm at elapsed time starts next occurrence");
        equal(next("noon",ON,meds,EMPTY,"2025-07-12T23:00:00Z",SH,""),0,"only chosen periods");
        equal(next("morning",new AlarmPlan.Alarm(false,"08:00"),meds,EMPTY,"2025-07-12T23:00:00Z",SH,""),0,"off cancels schedule");
        equal(next("morning",ON,Collections.emptyList(),EMPTY,"2025-07-12T23:00:00Z",SH,""),0,"no medicines no reminder");
        AlarmPlan.Medicine none=med("none","none","1970-01-01",2,new String[]{});
        equal(next("morning",ON,Arrays.asList(none),EMPTY,"2025-07-12T23:00:00Z",SH,""),0,"no frequency no reminder");
        AlarmPlan.Medicine interval=med("interval","interval","2024-02-28",2,new String[]{"morning"});
        equal(next("morning",ON,Arrays.asList(interval),EMPTY,"2024-02-29T00:01:00Z",SH,""),at("2024-03-01T00:00:00Z"),"interval crosses leap day");
        AlarmPlan.Medicine weekly=med("weekly","weekly","2025-07-01",2,new String[]{"morning"},1,7);
        equal(next("morning",ON,Arrays.asList(weekly),EMPTY,"2025-07-11T23:00:00Z",SH,""),at("2025-07-13T00:00:00Z"),"weekly Sunday=7");
        equal(next("morning",ON,Arrays.asList(weekly),EMPTY,"2025-07-13T00:01:00Z",SH,""),at("2025-07-14T00:00:00Z"),"weekly Monday=1");
        AlarmPlan.Medicine distant=med("future","daily","2050-01-01",2,new String[]{"morning"});
        equal(next("morning",ON,Arrays.asList(distant),EMPTY,"2025-01-01T00:00:00Z",SH,""),at("2050-01-01T00:00:00Z"),"no finite lookahead horizon");
        Set<String> done=AlarmPlan.completions(Arrays.asList(new AlarmPlan.Dose("daily","morning","2025-07-12T23:00:00Z")),SH);
        equal(next("morning",ON,meds,done,"2025-07-12T23:30:00Z",SH,""),at("2025-07-14T00:00:00Z"),"completed medicine skips date");
        equal(next("evening",new AlarmPlan.Alarm(true,"20:00"),meds,done,"2025-07-12T23:30:00Z",SH,""),at("2025-07-13T12:00:00Z"),"morning completion never skips evening");
        List<AlarmPlan.Medicine> two=Arrays.asList(daily,med("other","daily","2025-01-01",2,new String[]{"morning"}));
        equal(next("morning",ON,two,done,"2025-07-12T23:30:00Z",SH,""),at("2025-07-13T00:00:00Z"),"another pending medicine still rings");
        check(AlarmPlan.pending("morning",ON,two,done,at("2025-07-13T00:00:00Z"),SH).equals(Arrays.asList("other")),"only pending names");
        check(AlarmPlan.pending("morning",new AlarmPlan.Alarm(false,"08:00"),two,EMPTY,at("2025-07-13T00:00:00Z"),SH).isEmpty(),"disabled intent is stale");
        check(AlarmPlan.pending("morning",new AlarmPlan.Alarm(true,"09:00"),two,EMPTY,at("2025-07-13T00:00:00Z"),SH).isEmpty(),"changed time invalidates old intent");
        equal(next("morning",ON,meds,EMPTY,"2025-07-12T23:30:00Z",SH,"2025-07-13T08:00"),at("2025-07-14T00:00:00Z"),"already delivered does not ring again after clock rollback");
        equal(next("morning",new AlarmPlan.Alarm(true,"09:00"),meds,EMPTY,"2025-07-13T00:30:00Z",SH,"2025-07-13T08:00"),at("2025-07-13T01:00:00Z"),"explicit new time can remind again");
        long due=at("2025-07-13T00:00:00Z");
        check(AlarmPlan.keepDue("morning",ON,meds,EMPTY,due,Instant.ofEpochMilli(due+1000),SH,""),"refresh at due time keeps queued broadcast");
        check(!AlarmPlan.keepDue("morning",ON,meds,EMPTY,due,Instant.ofEpochMilli(due+1000),SH,"2025-07-13T08:00"),"consumed broadcast never kept");
        check(!AlarmPlan.keepDue("morning",ON,meds,done,due,Instant.ofEpochMilli(due+1000),SH,""),"completion removes queued reminder");
        check(!AlarmPlan.keepDue("morning",ON,meds,EMPTY,due,Instant.ofEpochMilli(due+3600001),SH,""),"old due time expires");
        ZoneId ny=ZoneId.of("America/New_York");
        equal(next("morning",new AlarmPlan.Alarm(true,"02:30"),meds,EMPTY,"2025-03-09T05:00:00Z",ny,""),at("2025-03-09T07:30:00Z"),"DST gap shifts to first valid corresponding time");
        equal(next("morning",new AlarmPlan.Alarm(true,"01:30"),meds,EMPTY,"2025-11-02T04:00:00Z",ny,""),at("2025-11-02T05:30:00Z"),"DST overlap uses earlier offset");
        equal(next("morning",new AlarmPlan.Alarm(true,"01:30"),meds,EMPTY,"2025-11-02T06:00:00Z",ny,""),at("2025-11-03T06:30:00Z"),"DST overlap does not repeat same date");
        Set<String> utcDone=AlarmPlan.completions(Arrays.asList(new AlarmPlan.Dose("daily","morning","2025-07-12T23:00:00Z")),ZoneId.of("UTC"));
        equal(next("morning",ON,meds,utcDone,"2025-07-13T00:00:00Z",ZoneId.of("UTC"),""),at("2025-07-13T08:00:00Z"),"completions reinterpret original UTC instant after timezone change");
        AlarmPlan.Medicine edge=med("edge","weekly","9999-12-31",2,new String[]{"morning"},1);
        equal(next("morning",ON,Arrays.asList(edge),EMPTY,"9999-12-30T00:00:00Z",ZoneId.of("UTC"),""),0,"date upper bound");
        try { new AlarmPlan.Alarm(true,"24:00"); throw new AssertionError("bad time accepted"); } catch (IllegalArgumentException expected) { assertions++; }
        try { med("bad","interval","2025-01-01",1,new String[]{"morning"}); throw new AssertionError("bad interval accepted"); } catch (IllegalArgumentException expected) { assertions++; }
        try { med("bad","weekly","2025-01-01",2,new String[]{"morning"}); throw new AssertionError("empty weekdays accepted"); } catch (IllegalArgumentException expected) { assertions++; }
        System.out.println("AlarmPlan: "+assertions+" assertions passed");
    }
}
