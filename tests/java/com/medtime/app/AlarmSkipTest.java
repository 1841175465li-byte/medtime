package com.medtime.app;
import java.time.*;
import java.util.*;
public final class AlarmSkipTest {
    static int count;
    static void check(boolean value,String message){count++;if(!value)throw new AssertionError(message);}
    public static void main(String[] args){
        ZoneId zone=ZoneId.of("Asia/Shanghai");
        AlarmPlan.Alarm alarm=new AlarmPlan.Alarm(true,"08:00");
        AlarmPlan.Medicine med=new AlarmPlan.Medicine("a","药品A","daily","2025-07-01",2,new HashSet<>(Arrays.asList("morning","bedtime")),Collections.emptySet());
        List<AlarmPlan.Medicine> meds=Arrays.asList(med);
        List<AlarmPlan.Skip> skips=Arrays.asList(new AlarmPlan.Skip("a","morning","2025-07-12"));
        Set<String> resolved=AlarmPlan.resolved(Collections.emptyList(),skips,zone);
        Instant before=Instant.parse("2025-07-11T23:00:00Z");
        long next=AlarmPlan.next("morning",alarm,meds,resolved,before,zone,"");
        check(next==Instant.parse("2025-07-13T00:00:00Z").toEpochMilli(),"skip moves only this occurrence to next day");
        check(AlarmPlan.pending("morning",alarm,meds,resolved,Instant.parse("2025-07-12T00:00:00Z").toEpochMilli(),zone).isEmpty(),"broadcast filters skipped medicine");
        check(!AlarmPlan.pending("bedtime",alarm,meds,resolved,Instant.parse("2025-07-12T00:00:00Z").toEpochMilli(),zone).isEmpty(),"another slot stays pending");
        check(AlarmPlan.next("morning",alarm,meds,Collections.emptySet(),before,zone,"")==Instant.parse("2025-07-12T00:00:00Z").toEpochMilli(),"cancel restores future schedule");
        ZoneId other=ZoneId.of("America/New_York");
        Set<String> moved=AlarmPlan.resolved(Collections.emptyList(),skips,other);
        check(moved.equals(resolved),"skip uses explicit calendar date through timezone changes");
        List<AlarmPlan.Dose> doses=Arrays.asList(new AlarmPlan.Dose("a","morning","2025-07-12T00:00:00Z"));
        check(AlarmPlan.resolved(doses,skips,zone).size()==1,"dose and skip cannot cause duplicate resolution");
        boolean rejected=false;try{new AlarmPlan.Skip("a","invalid","2025-07-12");}catch(Exception e){rejected=true;}check(rejected,"reject invalid slot");
        rejected=false;try{new AlarmPlan.Skip("a","morning","2025-02-30");}catch(Exception e){rejected=true;}check(rejected,"reject invalid day");
        System.out.println("PASS AlarmSkipTest "+count+" assertions");
    }
}
