const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../web/store.js'),R=require('../web/reminders.js'),B=require('../web/backup.js'),P=require('../web/preferences.js');
const now=new Date('2025-07-12T12:00:00Z');
function seed(){let d=S.addMedication(S.defaults(),'记录测试',{strength:'10 mg',form:'普通片'});return S.setSchedule(d,d.medications[0].id,{mode:'daily',slots:['morning','bedtime'],intervalDays:2,startDate:'2025-07-01',weekdays:[],endDate:null,times:{morning:'09:15'}});}
function skip(d,changes={}){return S.addSkip(d,{medicationId:d.medications[0].id,day:'2025-07-12',slot:'morning',reason:'按实际情况填写的原因',...changes},now);}
function taken(d,changes={}){return S.addRecord(d,{medicationId:d.medications[0].id,takenAt:now.toISOString(),slot:'morning',...changes},now);}
test('v4 load is lossless, creates no skips and does not write until saved',()=>{
 const before=taken(seed()),old={version:4,medications:before.medications,records:before.records},raw=JSON.stringify(old);
 const loaded=S.load({getItem:()=>raw,setItem:()=>assert.fail('read mutated data')});
 assert.deepEqual(loaded,{...before,skips:[]});assert.equal(raw,JSON.stringify(old));
});
test('skip resolves exactly one day and slot without recording a dose',()=>{
 const before=seed(),d=skip(before),row=S.getDayPlan(d,'2025-07-12')[0].medications[0];
 assert.equal(row.record,null);assert.equal(row.skip.reason,'按实际情况填写的原因');
 assert.equal(S.getDayPlan(d,'2025-07-12')[3].medications[0].skip,null);
 assert.equal(S.getDayPlan(d,'2025-07-13')[0].medications[0].skip,null);
 assert.equal(S.getMedicationStats(d)[0].count,0);assert.equal(d.records.length,0);assert.equal(before.skips.length,0);
});
test('skip validates plans, duplicate occurrences, reasons and future days atomically',()=>{
 const d=seed(),raw=S.exportData(d);
 for(const changes of [{day:'2025-07-13'},{day:'2025-02-30'},{slot:'noon'},{slot:null},{reason:''},{reason:'x'.repeat(201)}]) assert.throws(()=>skip(d,changes));
 assert.throws(()=>skip(S.setMedicationStatus(d,d.medications[0].id,'paused')));
 assert.throws(()=>skip(skip(d)),/已经/);assert.throws(()=>skip(taken(d)),/已记录/);
 assert.equal(S.exportData(d),raw);
});
test('actual use replaces matching skip; unassigned and other-slot use does not',()=>{
 const d=skip(seed());assert.equal(taken(d).skips.length,0);
 assert.equal(taken(d,{slot:'bedtime'}).skips.length,1);assert.equal(taken(d,{slot:null}).skips.length,1);
 const unassigned=taken(d,{slot:null});const updated=S.updateRecord(unassigned,unassigned.records[0].id,{medicationId:d.medications[0].id,takenAt:now.toISOString(),slot:'morning'},now);
 assert.equal(updated.skips.length,0);assert.equal(updated.records.length,1);assert.equal(d.skips.length,1);
});
test('skip editing and cancellation preserve snapshots, archived history and undo input',()=>{
 const d=skip(seed()),id=d.skips[0].id,renamed=S.renameMedication(d,d.medications[0].id,'新名称');
 const updated=S.updateSkip(S.setMedicationStatus(renamed,d.medications[0].id,'archived'),id,'改正原因');
 assert.equal(updated.skips[0].medicationName,'记录测试');assert.equal(updated.skips[0].medicationStrength,'10 mg');
 assert.equal(updated.skips[0].createdAt,d.skips[0].createdAt);assert.equal(S.deleteSkip(updated,id).skips.length,0);assert.equal(updated.skips.length,1);
});
test('backup merge is idempotent and reconciles real use versus conflicting skips',()=>{
 const d=skip(seed()),copy=JSON.parse(S.exportData(d));copy.skips[0].id='different-id';copy.skips[0].reason='旧原因';
 const merged=S.importData(JSON.stringify(copy),d);assert.deepEqual(merged,d);
 assert.deepEqual(S.importData(S.exportData(d),S.defaults()),d);
 const actual=taken(d);assert.equal(S.importData(S.exportData(d),actual).skips.length,0);
 assert.equal(S.importData(S.exportData(actual),d).skips.length,0);
 assert.equal(S.importData(S.exportData(actual),d).records.length,1);
});
test('latest use keeps actual dose, and seven-day summary includes zeros and independent skip counts',()=>{
 let d=taken(seed(),{dose:{amount:'0.5',unit:'片'}});d=skip(d,{slot:'bedtime'});
 const stat=S.getMedicationStats(d)[0];assert.deepEqual(stat.lastDose,{amount:'0.5',unit:'片'});
 const week=S.getWeekSummary(d,'2025-07-12');assert.equal(week.length,7);assert.equal(week[0].day,'2025-07-06');assert.deepEqual(week[6],{day:'2025-07-12',records:1,skips:1});
 assert.deepEqual(week.slice(0,6).map(d=>[d.records,d.skips]),Array(6).fill([0,0]));
 assert.equal(S.getWeekSummary(d,'2025-07-12','other').reduce((n,r)=>n+r.records+r.skips,0),0);
 assert.equal(S.getWeekSummary(d,'2024-03-01')[5].day,'2024-02-29');
});
test('native skip mirror includes calendar resolution but excludes reason and stale history',()=>{
 let d=skip(seed());d=skip(d,{day:'2025-07-01',slot:'bedtime',reason:'private reason'});
 const mirror=R.snapshot(d,R.defaults(),now);assert.equal(mirror.version,3);assert.deepEqual(mirror.skips,[{medicationId:d.medications[0].id,day:'2025-07-12',slot:'morning'}]);
 assert.ok(!JSON.stringify(mirror).includes('private reason'));assert.equal(mirror.records.length,0);
});
test('encrypted backups round trip unicode without exposing medicine text and use fresh randomness',async()=>{
 const plain=S.exportData(skip(seed())),pass='本机备份密码-123456';
 const encrypted=await B.encrypt(plain,pass),second=await B.encrypt(plain,pass);
 assert.ok(B.isEncrypted(encrypted));assert.ok(!B.isEncrypted(plain));assert.ok(!encrypted.includes('记录测试'));assert.notEqual(encrypted,second);
 assert.equal(await B.decrypt(encrypted,pass),plain);assert.deepEqual(S.importData(await B.decrypt(encrypted,pass),S.defaults()),JSON.parse(plain));
});
test('wrong passwords, altered ciphertext and hostile envelopes fail without changing storage',async()=>{
 const raw=await B.encrypt(S.exportData(seed()),'test-password-123');
 await assert.rejects(B.decrypt(raw,'wrong-password-456'),/密码不正确/);
 const changed=JSON.parse(raw);changed.data=(changed.data[0]==='A'?'B':'A')+changed.data.slice(1);
 await assert.rejects(B.decrypt(JSON.stringify(changed),'test-password-123'),/损坏/);
 for(const changes of [{iterations:999999999},{cipher:'AES-CBC'},{version:2},{salt:'abcd'},{iv:'a'.repeat(16)+'='},{unexpected:true}])await assert.rejects(B.decrypt(JSON.stringify({...JSON.parse(raw),...changes}),'test-password-123'));
 await assert.rejects(B.encrypt('text','short'),/10–128/);
 assert.throws(()=>B.isEncrypted('{broken'),/无法读取/);
});
test('large encrypted payload avoids recursive base64 operations',async()=>{
 const plain='记录'.repeat(250000),encrypted=await B.encrypt(plain,'long-backup-password');
 assert.equal(await B.decrypt(encrypted,'long-backup-password'),plain);
});
test('backup reminders follow confirmed-save time, opt-out, and data presence',()=>{
 let prefs=P.defaults(),time=now.getTime();assert.ok(P.due(prefs,true,time));assert.ok(!P.due(prefs,false,time));
 prefs.lastBackupAt=now.toISOString();assert.ok(!P.due(prefs,true,time+6*86400000));assert.ok(P.due(prefs,true,time+7*86400000));
 prefs.backupDays=0;assert.ok(!P.due(prefs,true,time+30*86400000));assert.ok(!P.due({...prefs,backupDays:7},true,time-100000));
});
test('failed preference persistence never reports a successful backup or changes the previous value',()=>{
 const prefs=P.defaults(),raw=JSON.stringify(prefs);assert.throws(()=>P.save({...prefs,lastBackupAt:now.toISOString()},{setItem:()=>{throw Error('quota');}}));assert.equal(JSON.stringify(prefs),raw);
 let stored;P.save({...prefs,largeText:true},{setItem:(_,v)=>stored=v});assert.equal(P.load({getItem:()=>stored}).largeText,true);
 assert.throws(()=>P.load({getItem:()=>'{broken'}));
});
