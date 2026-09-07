'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../web/reminders.js');
const S=require('../web/store.js');
const C=require('../web/catalog.js');
const memory=(initial=null)=>({value:initial,getItem(key){assert.equal(key,R.STORAGE_KEY);return this.value;},setItem(key,value){assert.equal(key,R.STORAGE_KEY);this.value=value;}});

test('all alarms are opt-in and have independent times; loading never overwrites other data',()=>{
  const db=memory(), first=R.load(db);
  assert.equal(db.value,null);
  assert.deepEqual(first,{version:1,morning:{enabled:false,time:'08:00'},noon:{enabled:false,time:'12:30'},evening:{enabled:false,time:'20:00'}});
  const next=R.setAlarm(first,'morning',true,'07:15');
  assert.equal(first.morning.enabled,false);
  assert.equal(next.morning.time,'07:15');
  assert.equal(next.noon.enabled,false);
  assert.deepEqual(R.load(memory(JSON.stringify(next))),next);
  assert.deepEqual(R.save(next,db),next);
  assert.equal(R.STORAGE_KEY,'medtime.alarms.v1');
  assert.notEqual(R.STORAGE_KEY,S.STORAGE_KEY);
});

test('invalid/corrupt alarm settings and failed writes fail explicitly',()=>{
  for(const time of ['24:00','8:00','07:60','07:15:00','',null]) assert.throws(()=>R.setAlarm(R.defaults(),'morning',true,time));
  assert.throws(()=>R.setAlarm(R.defaults(),'unknown',true,'08:00'));
  assert.throws(()=>R.setAlarm(R.defaults(),'morning','false','08:00'));
  const db=memory('{invalid');
  assert.throws(()=>R.load(db)); assert.equal(db.value,'{invalid');
  assert.throws(()=>R.validate({...R.defaults(),unsupported:true}));
  assert.throws(()=>R.save(R.defaults(),{setItem(){throw Error('quota');}}),/保存失败/);
});

test('disabling an alarm preserves its selected time and other periods',()=>{
  const on=R.setAlarm(R.setAlarm(R.defaults(),'morning',true,'06:35'),'evening',true,'21:45');
  const off=R.setAlarm(on,'morning',false,'06:35');
  assert.deepEqual(off.morning,{enabled:false,time:'06:35'});
  assert.deepEqual(off.evening,on.evening);
});

test('native mirror carries schedules and explicit-slot completions without notes or unrelated history',()=>{
  let data=S.defaults();
  data=S.setSchedule(data,'minoxidil',{mode:'interval',slots:['morning','evening'],intervalDays:2,startDate:'2025-07-01',weekdays:[]});
  const clock=new Date('2025-07-12T12:00:00Z');
  for(const [slot,at] of [[null,'2025-07-12T01:00:00Z'],['morning','2025-07-12T01:00:00Z'],['evening','2025-01-01T01:00:00Z']])
    data=S.addRecord(data,{medicationId:'minoxidil',slot,takenAt:at,note:'不要复制这条备注'},clock);
  const before=S.exportData(data), alarms=R.setAlarm(R.defaults(),'morning',true,'07:30');
  const snapshot=R.snapshot(data,alarms,clock);
  assert.equal(snapshot.records.length,1);
  assert.equal(snapshot.records[0].slot,'morning');
  assert.deepEqual(snapshot.medications[0].schedule,data.medications[0].schedule);
  assert.equal(snapshot.alarms.morning.enabled,true);
  assert.equal(JSON.stringify(snapshot).includes('不要复制'),false);
  snapshot.medications[0].schedule.slots.push('noon');
  assert.equal(S.exportData(data),before);
});

test('mirror refresh reflects editing/deletion/undo so completed periods can cancel pending alarms',()=>{
  const now=new Date('2025-07-12T12:00:00Z');
  const original=S.addRecord(S.defaults(),{medicationId:'minoxidil',slot:'morning',takenAt:'2025-07-12T00:00:00Z',note:''},now);
  const changed=S.updateRecord(original,original.records[0].id,{medicationId:'minoxidil',slot:'evening',takenAt:original.records[0].takenAt,note:''},now);
  assert.equal(R.snapshot(changed,R.defaults(),now).records[0].slot,'evening');
  assert.equal(R.snapshot(S.deleteRecord(changed,changed.records[0].id),R.defaults(),now).records.length,0);
  assert.equal(R.snapshot(original,R.defaults(),now).records[0].slot,'morning');
  // A clock correction must not discard a stored completion now in the future.
  assert.equal(R.snapshot(original,R.defaults(),'2025-07-01T00:00:00Z').records.length,1);
});

test('20 supplement names support Chinese/pinyin/common aliases and the existing frequency/count flow',()=>{
  assert.equal(C.search('','supplements').length,20);
  for(const query of ['鱼油','yu you','yy','Omega-3','深海鱼油']) assert.ok(C.search(query,'supplements').some(i=>i.name==='鱼油'));
  assert.equal(C.search('VC')[0].name,'维生素C');
  assert.equal(C.search('Q10')[0].name,'辅酶Q10');
  assert.equal(C.search('钙片')[0].name,'钙补充剂');
  assert.equal(C.search('DHA')[0].name,'藻油DHA');
  const fish=C.items.find(i=>i.name==='鱼油');
  let data=S.addCatalogMedication(S.defaults(),{id:fish.id,name:fish.name,icon:fish.icon});
  data=S.setSchedule(data,fish.id,{mode:'weekly',slots:['evening'],intervalDays:2,startDate:'2025-07-01',weekdays:[1,3,5]});
  data=S.addRecord(data,{medicationId:fish.id,takenAt:'2025-07-11T11:00:00Z',slot:'evening',note:''},new Date('2025-07-12T12:00:00Z'));
  assert.equal(S.getMedicationStats(data).find(s=>s.medicationId===fish.id).count,1);
  assert.deepEqual(S.importData(S.exportData(data),S.defaults()),data);
  assert.equal(R.snapshot(data,R.defaults(),'2025-07-12T12:00:00Z').medications.at(-1).schedule.mode,'weekly');
});
