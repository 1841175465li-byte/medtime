const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../web/store.js');
const R=require('../web/reminders.js');
const fixture=require('./fixtures.cjs');
const now=new Date('2025-07-12T12:00:00Z');
const schedule=overrides=>({mode:'daily',slots:['morning','bedtime'],intervalDays:2,startDate:'2025-07-01',weekdays:[],endDate:null,times:{morning:'09:15',bedtime:'22:45'},...overrides});
const planned=()=>S.setSchedule(fixture(),'minoxidil',schedule());

test('empty data can be saved, exported and imported without seeding medicines',()=>{
 const empty=S.defaults(); let raw=null;
 assert.deepEqual(S.save(empty,{setItem:(key,text)=>{raw=text;}}),empty);
 assert.deepEqual(S.load({getItem:()=>raw}),empty);
 assert.deepEqual(S.importData(S.exportData(empty),S.defaults()),empty);
 assert.ok(S.getDayPlan(empty,now).every(group=>group.medications.length===0));
 assert.throws(()=>S.addRecord(empty,{medicationId:'minoxidil',takenAt:now.toISOString()},now),/有效药品/);
});

test('real v3 upgrade retains existing names, doses, times and records without adding defaults',()=>{
 let before=S.setDose(S.setSchedule(fixture(),'minoxidil',{mode:'weekly',slots:['morning'],intervalDays:2,startDate:'2025-01-01',weekdays:[1,3,5]}),'minoxidil',{amount:'1',unit:'mL'});
 before=S.addRecord(before,{medicationId:'minoxidil',takenAt:'2025-07-11T01:30:00Z',slot:'morning',note:'原记录'},now);
 const old=fixture.legacy(before,3), raw=JSON.stringify(old);
 const migrated=S.load({getItem:()=>raw,setItem:()=>assert.fail('read wrote storage')});
 assert.equal(migrated.version,4);
 assert.equal(migrated.medications.length,3);
 assert.deepEqual(migrated.medications.map(m=>m.name),old.medications.map(m=>m.name));
 assert.deepEqual(migrated.medications[0].schedule.weekdays,[1,3,5]);
 assert.deepEqual(migrated.medications[0].schedule.times,{});
 assert.equal(migrated.medications[0].schedule.endDate,null);
 assert.equal(migrated.medications[0].status,'active');
 assert.equal(migrated.records[0].takenAt,old.records[0].takenAt);
 assert.equal(migrated.records[0].note,'原记录');
 assert.equal(migrated.records[0].medicationStrength,'');
 assert.equal(migrated.records[0].medicationForm,'');
 assert.deepEqual(migrated.records[0].dose,{amount:'1',unit:'mL'});
 assert.equal(JSON.stringify(old),raw);
});

test('independent times and bedtime survive backup without rewriting the shared device times',()=>{
 const data=planned(), alarms=R.defaults(), original=JSON.stringify(alarms);
 assert.deepEqual(S.getDayPlan(data,'2025-07-12').map(g=>g.medications.length),[1,0,0,1]);
 assert.deepEqual(S.importData(S.exportData(data),S.defaults()),data);
 assert.equal(JSON.stringify(alarms),original);
 const mirror=R.snapshot(data,alarms,now);
 assert.equal(mirror.version,2);
 assert.deepEqual(mirror.medications[0].schedule.times,{morning:'09:15',bedtime:'22:45'});
 assert.equal(mirror.alarms.morning.time,'08:00');
 assert.equal(mirror.alarms.bedtime.enabled,false);
});

test('course dates are inclusive; ended courses disappear from plans but retain records',()=>{
 let data=S.setSchedule(planned(),'minoxidil',schedule({endDate:'2025-07-12'}));
 data=S.addRecord(data,{medicationId:'minoxidil',takenAt:'2025-07-12T01:00:00Z',slot:'morning'},now);
 assert.equal(S.isScheduledOn(data.medications[0],'2025-06-30'),false);
 assert.equal(S.isScheduledOn(data.medications[0],'2025-07-01'),true);
 assert.equal(S.isScheduledOn(data.medications[0],'2025-07-12'),true);
 assert.equal(S.isScheduledOn(data.medications[0],'2025-07-13'),false);
 assert.ok(S.getDayPlan(data,'2025-07-13').every(g=>g.medications.length===0));
 assert.equal(S.getMedicationStats(data)[0].count,1);
});

test('pausing and archiving retain course and records; moving back can remain paused',()=>{
 let data=S.addRecord(planned(),{medicationId:'minoxidil',takenAt:'2025-07-12T01:00:00Z',slot:'morning'},now);
 const original=JSON.stringify(data);
 for(const status of ['paused','archived']) {
  const stopped=S.setMedicationStatus(data,'minoxidil',status);
  assert.ok(S.getDayPlan(stopped,'2025-07-12').every(g=>g.medications.length===0));
  assert.deepEqual(stopped.records,data.records);
  assert.deepEqual(stopped.medications[0].schedule,data.medications[0].schedule);
  assert.equal(R.snapshot(stopped,R.defaults(),now).medications[0].status,status);
  assert.equal(S.getMedicationStats(stopped)[0].count,1);
 }
 const archived=S.setMedicationStatus(data,'minoxidil','archived');
 const moved=S.setMedicationStatus(archived,'minoxidil','paused');
 assert.equal(S.isScheduledOn(moved.medications[0],'2025-07-12'),false);
 const resumed=S.setMedicationStatus(moved,'minoxidil','active');
 assert.equal(S.getDayPlan(resumed,'2025-07-12')[3].medications.length,1);
 assert.equal(JSON.stringify(data),original);
});

test('strength and formulation are record snapshots, including when editing an old record',()=>{
 let data=S.setMedicationDetails(planned(),'minoxidil',{name:'自定义药品',strength:'10 mg/片',form:'普通片'});
 data=S.addRecord(data,{medicationId:'minoxidil',takenAt:'2025-07-12T01:00:00Z',slot:'morning'},now);
 const id=data.records[0].id;
 data=S.setMedicationDetails(data,'minoxidil',{name:'自定义药品新版',strength:'20 mg/片',form:'缓释片'});
 data=S.updateRecord(data,id,{medicationId:'minoxidil',takenAt:data.records[0].takenAt,note:'修改备注'},now);
 assert.equal(data.records[0].medicationName,'自定义药品');
 assert.equal(data.records[0].medicationStrength,'10 mg/片');
 assert.equal(data.records[0].medicationForm,'普通片');
 data=S.addRecord(data,{medicationId:'minoxidil',takenAt:'2025-07-12T02:00:00Z',slot:'morning'},now);
 assert.equal(data.records[1].medicationStrength,'20 mg/片');
 assert.deepEqual(S.importData(S.exportData(data),S.defaults()),data);
});

test('the same name with different strength or form can be managed separately',()=>{
 let data=S.addMedication(S.defaults(),'自定义药品',{strength:'10 mg',form:'普通片'});
 data=S.addMedication(data,'自定义药品',{strength:'20 mg',form:'普通片'});
 data=S.addMedication(data,'自定义药品',{strength:'20 mg',form:'缓释片'});
 assert.equal(data.medications.length,3);
 assert.throws(()=>S.addMedication(data,'自定义药品',{strength:'10 mg',form:'普通片'}),/同名/);
 assert.throws(()=>S.setMedicationDetails(data,data.medications[1].id,{name:'自定义药品',strength:'10 mg',form:'普通片'}),/同名/);
 assert.notEqual(data.medications[0].id,data.medications[1].id);
});

test('invalid dates, unselected override times and malformed metadata cannot change saved data',()=>{
 const data=planned(), before=JSON.stringify(data);
 for(const bad of [{endDate:'2025-06-30'},{endDate:'2025-02-30'},{times:{morning:'24:00'}},{times:{noon:'09:00'}},{times:{morning:'9:00'}},{times:null}])
  assert.throws(()=>S.setSchedule(data,'minoxidil',schedule(bad)));
 assert.throws(()=>S.setMedicationStatus(data,'minoxidil','finished'));
 assert.throws(()=>S.setMedicationDetails(data,'minoxidil',{name:'药品',strength:'x'.repeat(81),form:''}));
 assert.throws(()=>S.setMedicationDetails(data,'minoxidil',{name:'药品',strength:'',form:'<script>'}));
 assert.equal(JSON.stringify(data),before);
});

test('backup merge does not reactivate paused or archived medicines or overwrite configured details',()=>{
 let remote=S.setMedicationDetails(planned(),'minoxidil',{name:'备份药名',strength:'10 mg',form:'片剂'});
 let local=S.setMedicationStatus(fixture(),'minoxidil','archived');
 local=S.setMedicationDetails(local,'minoxidil',{name:'本机药名',strength:'20 mg',form:''});
 const merged=S.importData(S.exportData(remote),local);
 assert.equal(merged.medications[0].status,'archived');
 assert.equal(merged.medications[0].name,'本机药名');
 assert.equal(merged.medications[0].strength,'20 mg');
 assert.equal(merged.medications[0].form,'片剂');
 assert.equal(merged.medications[0].schedule.mode,'daily');
 assert.equal(S.isScheduledOn(merged.medications[0],'2025-07-12'),false);
 assert.deepEqual(S.importData(S.exportData(remote),merged),merged);
 assert.equal(S.importData(S.exportData(local),S.defaults()).medications[0].status,'archived');
});

test('old device alarms migrate without changing times, opt-ins, or stored bytes on read',()=>{
 const old={version:1,morning:{enabled:true,time:'07:20'},noon:{enabled:false,time:'12:45'},evening:{enabled:true,time:'21:10'}};
 const raw=JSON.stringify(old), migrated=R.load({getItem:()=>raw,setItem:()=>assert.fail('read wrote storage')});
 assert.equal(migrated.version,2);
 for(const slot of ['morning','noon','evening']) assert.deepEqual(migrated[slot],old[slot]);
 assert.deepEqual(migrated.bedtime,{enabled:false,time:'22:00'});
 assert.equal(R.STORAGE_KEY,'medtime.alarms.v1');
});

test('bedtime completion stays separate from evening and import remains idempotent',()=>{
 const data=S.setSchedule(fixture(),'minoxidil',schedule({slots:['evening','bedtime'],times:{evening:'20:00',bedtime:'23:00'}}));
 const recorded=S.addRecord(data,{medicationId:'minoxidil',takenAt:'2025-07-12T10:00:00Z',slot:'bedtime'},now);
 const day=S.getDayPlan(recorded,S.localDay(now));
 assert.equal(day[2].medications[0].record,null);
 assert.equal(day[3].medications[0].record.slot,'bedtime');
 assert.equal(R.snapshot(recorded,R.defaults(),now).records[0].slot,'bedtime');
 assert.deepEqual(S.importData(S.exportData(recorded),recorded),recorded);
});
