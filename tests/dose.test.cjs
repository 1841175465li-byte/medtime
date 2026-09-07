const fixture = require('./fixtures.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../web/store.js');
const R = require('../web/reminders.js');
const now = new Date('2025-07-12T12:00:00Z');
const fields = {medicationId:'minoxidil',takenAt:'2025-07-12T08:00:00Z',slot:'morning',note:''};
const dose = (amount,unit) => ({amount,unit});

test('each medicine starts without a suggested dose; exact decimals and user units round trip', () => {
  const original = fixture();
  assert.ok(original.medications.every(m => m.dose === null));
  const changed = S.setDose(original,'minoxidil',dose('01.2500','ml'));
  assert.deepEqual(changed.medications[0].dose,dose('1.25','mL'));
  assert.equal(S.getDoseLabel(changed.medications[0].dose),'1.25 mL');
  assert.equal(original.medications[0].dose,null);
  const tiny = S.setDose(changed,'minoxidil',dose('.000001','泵'));
  assert.deepEqual(tiny.medications[0].dose,dose('0.000001','泵'));
  assert.equal(S.getDoseLabel(dose('1','粒')),'1粒');
  assert.equal(S.setDose(tiny,'minoxidil',null).medications[0].dose,null);
});

test('invalid amounts, missing units and extra fields are rejected before any mutation', () => {
  const original = fixture(), before = JSON.stringify(original);
  for (const amount of ['0','-1','','NaN','Infinity','1e3','1/2','1.1234567','1234567','1,5'])
    assert.throws(() => S.setDose(original,'minoxidil',dose(amount,'粒')),/用量/);
  for (const unit of ['', ' ', '<script>', 'a\nb', 'x'.repeat(13)])
    assert.throws(() => S.setDose(original,'minoxidil',dose('1',unit)),/单位/);
  assert.throws(() => S.setDose(original,'minoxidil',{amount:'1',unit:'粒',extra:true}),/不支持/);
  assert.equal(JSON.stringify(original),before);
});

test('recorded doses are snapshots; changing a default never rewrites history or counts', () => {
  let data = S.setDose(fixture(),'minoxidil',dose('1','mL'));
  data = S.addRecord(data,fields,now);
  const first = data.records[0].id;
  data = S.setDose(data,'minoxidil',dose('2','mL'));
  data = S.addRecord(data,fields,now);
  data = S.addRecord(data,{...fields,dose:dose('0.5','mL')},now);
  assert.deepEqual(data.records.map(r => r.dose.amount),['1','2','0.5']);
  data = S.updateRecord(data,first,{...fields,note:'仅修改备注'},now);
  assert.deepEqual(data.records[0].dose,dose('1','mL'));
  data = S.updateRecord(data,first,{...fields,dose:dose('1.5','mL')},now);
  assert.equal(data.medications[0].dose.amount,'2');
  assert.equal(S.getMedicationStats(data)[0].count,3);
  data = S.updateRecord(data,first,{...fields,dose:null},now);
  assert.equal(data.records[0].dose,null);
  assert.equal(S.getMedicationStats(data)[0].count,3);
});

test('changing a record medication gets its selected dose; rename and slot association preserve the snapshot', () => {
  let data = S.setDose(fixture(),'minoxidil',dose('1','mL'));
  data = S.setDose(data,'finasteride',dose('1','片'));
  data = S.addRecord(data,fields,now);
  const id = data.records[0].id;
  data = S.updateRecord(data,id,{...fields,medicationId:'finasteride'},now);
  assert.deepEqual(data.records[0].dose,dose('1','片'));
  data = S.renameMedication(data,'finasteride','自定义药名');
  data = S.setDose(data,'finasteride',dose('2','片'));
  data = S.updateRecord(data,id,{...fields,medicationId:'finasteride',slot:'evening'},now);
  assert.equal(data.records[0].medicationName,'非那雄胺');
  assert.deepEqual(data.records[0].dose,dose('1','片'));
  assert.deepEqual(S.getMedicationStats(data).map(m => m.count),[0,0,1]);
});

test('v1 and v2 migration preserves records and frequency without inferring old doses or writing on read', () => {
  let current = S.setSchedule(fixture(),'minoxidil',{mode:'daily',slots:['morning'],intervalDays:2,startDate:'2025-01-01',weekdays:[]});
  current = S.addRecord(current,fields,now);
  for (const version of [1,2]) {
    const old = fixture.legacy(current,version);
    const raw = JSON.stringify(old);
    const migrated = S.load({getItem:() => raw,setItem:() => {throw new Error('read must not write');}});
    assert.equal(migrated.version,4);
    assert.equal(migrated.records[0].id,current.records[0].id);
    assert.equal(migrated.records[0].dose,null);
    assert.equal(migrated.medications[0].dose,null);
    assert.equal(migrated.medications[0].schedule.mode,version===1 ? 'none' : 'daily');
    const edited = S.setDose(migrated,'minoxidil',dose('1','mL'));
    assert.equal(S.updateRecord(edited,edited.records[0].id,{...fields,note:'补充'},now).records[0].dose,null);
    assert.equal(JSON.stringify(old),raw);
  }
});

test('backup restores default and recorded doses, preserving local choices on repeated merge', () => {
  let source = S.setDose(fixture(),'minoxidil',dose('1','mL'));
  source = S.addRecord(source,{...fields,dose:dose('0.75','mL')},now);
  const backup = S.exportData(source);
  const restored = S.importData(backup,fixture());
  assert.deepEqual(restored,source);
  let local = S.setDose(restored,'minoxidil',dose('2','mL'));
  local = S.updateRecord(local,local.records[0].id,{...fields,dose:dose('0.5','mL')},now);
  assert.deepEqual(S.importData(backup,local),local);
  assert.deepEqual(S.importData(backup,S.importData(backup,local)),local);
});

test('delete and undo retain dose history, while native alarm data remains minimal', () => {
  let data = S.setDose(fixture(),'minoxidil',dose('1','mL'));
  data = S.addRecord(data,fields,now);
  const deleted = S.deleteRecord(data,data.records[0].id);
  assert.equal(S.getMedicationStats(deleted)[0].count,0);
  assert.equal(S.getMedicationStats(data)[0].count,1);
  assert.deepEqual(data.records[0].dose,dose('1','mL'));
  const mirror = R.snapshot(data,R.defaults(),now);
  assert.equal('dose' in mirror.medications[0],false);
  assert.equal('dose' in mirror.records[0],false);
});
