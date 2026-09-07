'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const S = require('../web/store.js');
const C = require('../web/catalog.js');
const now = new Date('2025-07-12T12:00:00Z');
const add = (data, med = 'minoxidil', slot = null, at = '2025-07-12T08:00:00Z') =>
  S.addRecord(data, {medicationId:med, slot, takenAt:at, note:''}, now);
const entry = name => C.items.find(item => item.name === name);
const fields = item => ({id:item.id, name:item.name, icon:item.icon});

test('catalog is separate from personal medicines and contains valid unique entries in every category', () => {
  assert.equal(C.items.length, 90);
  assert.equal(new Set(C.items.map(item => item.id)).size, 90);
  assert.equal(new Set(C.items.map(item => item.name)).size, 90);
  C.categories.forEach(category => assert.ok(C.search('', category.id).length > 0));
  let data = S.defaults();
  assert.equal(data.medications.length, 3);
  for (const item of C.items) data = S.addCatalogMedication(data, fields(item));
  assert.equal(data.medications.length, 90);
  assert.equal(data.records.length, 0);
  assert.ok(data.medications.every(med => med.schedule.mode === 'none'));
  assert.deepEqual(S.importData(S.exportData(data), S.defaults()), data);
});

test('search finds Chinese, pinyin, initials, spaced/tone/fullwidth input and name variants', () => {
  for (const query of ['二甲双胍','erjiashuanggua','er jia shuang gua','èr jiǎ shuāng guā','EJSG','ｅｊｓｇ']) {
    assert.equal(C.search(query)[0].name, '二甲双胍', query);
  }
  assert.equal(C.search('anlvdiping')[0].name, '氨氯地平');
  assert.equal(C.search('坦洛新')[0].name, '坦索罗辛');
  assert.equal(C.search('美沙拉秦')[0].name, '美沙拉嗪');
  assert.equal(C.search('非那雄安')[0].name, '非那雄胺');
  assert.equal(C.search('amlodipine')[0].name, '氨氯地平');
  assert.deepEqual(C.search('EJSG', 'cardio'), []);
  assert.equal(C.search('血糖').length, 12);
  assert.deepEqual(C.search('<script>alert(1)</script>'), []);
});

test('catalog adding is idempotent, survives renaming and keeps distinct formulation names', () => {
  const metformin = entry('二甲双胍');
  let data = S.addCatalogMedication(S.defaults(), fields(metformin));
  data = S.setSchedule(data, metformin.id, {mode:'daily',slots:['morning'],intervalDays:2,startDate:'2025-07-12',weekdays:[]});
  const original = S.exportData(data);
  assert.deepEqual(S.addCatalogMedication(data, fields(metformin)), data);
  data = S.renameMedication(data, metformin.id, '盐酸二甲双胍片');
  assert.equal(C.findAdded(metformin, data.medications).name, '盐酸二甲双胍片');
  assert.ok(C.matchesMedication(data.medications.at(-1), 'EJSG'));
  assert.ok(C.matchesMedication(data.medications.at(-1), '盐酸'));
  assert.deepEqual(S.addCatalogMedication(data, fields(metformin)), data);
  assert.equal(data.medications.at(-1).schedule.mode, 'daily');
  assert.ok(original.includes('二甲双胍'));
  const custom = S.addMedication(S.defaults(), '二甲双胍');
  assert.equal(C.findAdded(metformin, custom.medications).id, custom.medications.at(-1).id);
  assert.equal(S.addCatalogMedication(custom, fields(metformin)).medications.length, 4);
  const distinct = S.addMedication(S.defaults(), '二甲双胍缓释片');
  assert.equal(C.findAdded(metformin, distinct.medications), undefined);
  assert.equal(S.addCatalogMedication(distinct, fields(metformin)).medications.length, 5);
});

test('every saved event counts including repeats and unassigned slots; unused medicines show zero', () => {
  let data = add(S.defaults());
  data = add(data, 'minoxidil', 'morning');
  data = add(data, 'minoxidil', 'evening', '2025-07-12T10:00:00Z');
  data = add(data, 'finasteride', null, '2025-07-11T01:00:00Z');
  const before = S.exportData(data);
  const stats = S.getMedicationStats(data);
  assert.deepEqual(stats.map(item => item.count), [3,0,1]);
  assert.equal(stats[0].lastTakenAt, '2025-07-12T10:00:00.000Z');
  assert.equal(stats[1].lastTakenAt, null);
  assert.equal(stats.reduce((sum, item) => sum + item.count, 0), data.records.length);
  assert.equal(S.exportData(data), before);
});

test('rename, reassignment, time edits, deletion, undo snapshot and backup keep counts accurate', () => {
  let data = add(add(S.defaults()), 'minoxidil', 'evening', '2025-07-12T10:00:00Z');
  data = S.renameMedication(data, 'minoxidil', '米诺地尔片');
  assert.equal(S.getMedicationStats(data)[0].name, '米诺地尔片');
  assert.equal(S.getMedicationStats(data)[0].count, 2);
  assert.equal(data.records[0].medicationName, '米诺地尔');
  data = S.updateRecord(data, data.records[1].id, {medicationId:'finasteride',takenAt:'2025-07-11T02:00:00Z',note:'',slot:null}, now);
  assert.deepEqual(S.getMedicationStats(data).map(item => item.count), [1,0,1]);
  const beforeDelete = data;
  data = S.deleteRecord(data, data.records[0].id);
  assert.deepEqual(S.getMedicationStats(data).map(item => item.count), [0,0,1]);
  assert.equal(S.getMedicationStats(data)[0].lastTakenAt, null);
  data = beforeDelete;
  assert.deepEqual(S.getMedicationStats(data).map(item => item.count), [1,0,1]);
  const restored = S.importData(S.exportData(data), S.defaults());
  assert.deepEqual(S.getMedicationStats(restored).map(item => item.count), [1,0,1]);
  assert.deepEqual(S.getMedicationStats(S.importData(S.exportData(data), restored)), S.getMedicationStats(restored));
});

test('legacy records with historical names count by stable medicine ID', () => {
  const data = S.defaults();
  const legacy = {version:1, medications:data.medications.map(({schedule, dose, ...med}) => med), records:[
    {id:'old-1',medicationId:'minoxidil',medicationName:'旧药名',takenAt:'2024-07-01T00:00:00Z',createdAt:'2024-07-01T00:00:00Z',note:''}
  ]};
  assert.equal(S.getMedicationStats(legacy)[0].count, 1);
  assert.equal(S.getMedicationStats(legacy)[0].name, '米诺地尔');
  assert.equal(legacy.version, 1);
});
