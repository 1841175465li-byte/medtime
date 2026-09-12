const fixture = require('./fixtures.cjs');
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const storePath = path.resolve(__dirname, '../web/store.js');
const store = require(storePath);
const now = new Date('2025-07-12T12:00:00.000Z');

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) { assert.equal(key, store.STORAGE_KEY); return value; },
    setItem(key, text) { assert.equal(key, store.STORAGE_KEY); value = text; },
    raw() { return value; }
  };
}

function record(data = fixture(), overrides = {}) {
  return store.addRecord(data, {
    medicationId: 'minoxidil', takenAt: '2025-07-12T10:00:00.000Z', note: '早餐后', ...overrides
  }, now);
}

function freezeDeep(value) {
  Object.freeze(value);
  Object.values(value).forEach(child => {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDeep(child);
  });
  return value;
}

test('first install starts empty; new medication has no suggested schedule or dose', () => {
  const memory = memoryStorage();
  const first = store.load(memory);
  assert.deepEqual(first, {version:5,medications:[],records:[],skips:[]});
  assert.equal(memory.raw(),null);
  const added=store.addMedication(first,'我的药品');
  assert.equal(added.medications[0].dose,null);
  assert.equal(added.medications[0].schedule.mode,'none');
  assert.deepEqual(store.defaults(),first);
});

test('successful save survives load; failed writes throw and do not report success', () => {
  const memory = memoryStorage();
  const data = record();
  assert.deepEqual(store.save(data, memory), data);
  assert.deepEqual(store.load(memory), data);
  assert.throws(() => store.save(data, { setItem() { throw new Error('QuotaExceeded'); } }), /保存失败/);
  assert.throws(() => store.load({ getItem() { throw new Error('Denied'); } }), /无法读取/);
});

test('corrupted or unsupported data is never silently reset or overwritten', () => {
  ['{bad json', 'null', '{"version":99,"medications":[],"records":[]}'].forEach(raw => {
    const memory = memoryStorage(raw);
    assert.throws(() => store.load(memory));
    assert.equal(memory.raw(), raw);
  });
  const data = record();
  data.records[0].medicationId = 'unknown';
  assert.throws(() => store.save(data, memoryStorage()), /药品不存在/);
});

test('record creation and repeated intentional doses are immutable and have unique IDs', () => {
  const empty = freezeDeep(fixture());
  const first = freezeDeep(record(empty));
  const second = record(first);
  assert.equal(empty.records.length, 0);
  assert.equal(first.records.length, 1);
  assert.equal(second.records.length, 2);
  assert.notEqual(second.records[0].id, second.records[1].id);
});

test('editing preserves identity, original creation time, and historical medicine name', () => {
  const initial = freezeDeep(record());
  const renamed = store.renameMedication(initial, 'minoxidil', '米诺地尔（自定义）');
  const changed = store.updateRecord(renamed, initial.records[0].id, {
    medicationId: 'minoxidil', takenAt: '2025-07-11T23:59:00Z', note: '补记'
  }, now);
  assert.equal(changed.records[0].id, initial.records[0].id);
  assert.equal(changed.records[0].createdAt, initial.records[0].createdAt);
  assert.equal(changed.records[0].medicationName, '米诺地尔');
  assert.equal(changed.records[0].note, '补记');
  assert.equal(initial.records[0].note, '早餐后');
  const switched = store.updateRecord(changed, changed.records[0].id, {
    medicationId: 'isotretinoin', takenAt: '2025-07-11T23:59:00Z'
  }, now);
  assert.equal(switched.records[0].medicationName, '异维A酸软胶囊');
});

test('delete leaves a reusable immutable snapshot for undo and backup restoration', () => {
  const original = freezeDeep(record());
  const backup = store.exportData(original);
  const deleted = store.deleteRecord(original, original.records[0].id);
  assert.equal(deleted.records.length, 0);
  assert.equal(original.records.length, 1);
  assert.deepEqual(store.importData(backup, deleted), original);
  const memory = memoryStorage();
  store.save(original, memory);
  assert.deepEqual(store.load(memory), original);
  assert.throws(() => store.deleteRecord(original, 'missing'), /不存在/);
});

test('import merges by IDs, remains idempotent, and keeps current records and historic names', () => {
  const original = record();
  const more = record(original, { medicationId: 'finasteride', note: '第二种药' });
  const current = store.updateRecord(original, original.records[0].id, {
    medicationId: 'minoxidil', takenAt: original.records[0].takenAt, note: '本机修改保留'
  }, now);
  const merged = store.importData(store.exportData(more), current);
  assert.equal(merged.records.length, 2);
  assert.equal(merged.records[0].note, '本机修改保留');
  assert.deepEqual(store.importData(store.exportData(more), merged), merged);
  const renamed = store.renameMedication(more, 'minoxidil', '新名称');
  assert.equal(store.importData(store.exportData(renamed), fixture()).records[0].medicationName, '米诺地尔');
});

test('import supports custom medicine definitions and rejects unknown references and duplicate IDs', () => {
  let custom = store.addMedication(fixture(), '自定义药');
  custom = record(custom, { medicationId: custom.medications.at(-1).id });
  const merged = store.importData(store.exportData(custom), fixture());
  assert.equal(merged.medications.length, 4);
  assert.equal(merged.records[0].medicationName, '自定义药');
  const bad = JSON.parse(JSON.stringify(custom));
  bad.medications.pop();
  assert.throws(() => store.importData(JSON.stringify(bad), fixture()), /药品不存在/);
  bad.medications.push(custom.medications.at(-1));
  bad.records.push({ ...bad.records[0] });
  assert.throws(() => store.importData(JSON.stringify(bad), fixture()), /标识重复/);
});

test('future dates and normalized invalid calendar dates cannot be recorded or imported', () => {
  ['2025-07-12T12:00:00.001Z', '2025-02-30T12:00:00Z', '2025-07-12T24:00:00Z', '2025-07-12T10:00'].forEach(takenAt => {
    assert.throws(() => record(fixture(), { takenAt }));
  });
  const future = record();
  future.records[0].takenAt = new Date(Date.now() + 86400000).toISOString();
  assert.throws(() => store.importData(JSON.stringify(future), fixture()), /不能晚于/);
  assert.equal(record(fixture(), { takenAt: '2024-02-29T12:00:00+08:00' }).records[0].takenAt, '2024-02-29T04:00:00.000Z');
});

test('clock rollback preserves stored records, export, deletion, and unchanged-time edits', () => {
  const RealDate = Date;
  const priorClock = new RealDate('2025-07-12T12:00:00Z');
  const memory = memoryStorage();
  const stored = record(fixture(), { takenAt: priorClock.toISOString() });
  store.save(stored, memory);
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2025-07-12T11:00:00Z'])); }
    static now() { return new RealDate('2025-07-12T11:00:00Z').getTime(); }
  };
  try {
    const reloaded = store.load(memory);
    assert.deepEqual(reloaded, stored);
    assert.deepEqual(JSON.parse(store.exportData(reloaded)), stored);
    assert.deepEqual(store.save(reloaded, memory), stored);
    assert.equal(store.deleteRecord(reloaded, reloaded.records[0].id).records.length, 0);
    const fields = { medicationId: 'minoxidil', takenAt: reloaded.records[0].takenAt, note: '仅改备注' };
    const edited = store.updateRecord(reloaded, reloaded.records[0].id, fields);
    assert.equal(edited.records[0].note, '仅改备注');
    assert.equal(edited.records[0].takenAt, stored.records[0].takenAt);
    assert.throws(() => store.updateRecord(reloaded, reloaded.records[0].id, {
      ...fields, takenAt: '2025-07-12T11:30:00Z'
    }), /不能晚于/);
    assert.throws(() => store.addRecord(reloaded, fields), /不能晚于/);
    const added = store.addRecord(reloaded, { ...fields, takenAt: '2025-07-12T11:00:00Z' });
    assert.equal(added.records.length, 2);
    assert.throws(() => store.importData(store.exportData(reloaded), fixture()), /不能晚于/);
  } finally { global.Date = RealDate; }
});

test('import accepts a valid historical dose with a creation clock ahead of this device', () => {
  const source = record();
  source.records[0].createdAt = new Date(Date.now() + 86400000).toISOString();
  const imported = store.importData(JSON.stringify(source), fixture());
  assert.equal(imported.records[0].createdAt, source.records[0].createdAt);
  assert.equal(imported.records[0].takenAt, source.records[0].takenAt);
});

test('length, version, structure, and unsafe extra fields are rejected', () => {
  assert.throws(() => store.addMedication(fixture(), ' '));
  assert.throws(() => store.addMedication(fixture(), '药'.repeat(61)));
  assert.throws(() => store.addMedication(fixture(), ' 米诺地尔 '), /同名/);
  assert.throws(() => record(fixture(), { note: '字'.repeat(501) }));
  const unsupported = fixture();
  unsupported.version = 99;
  assert.throws(() => store.importData(JSON.stringify(unsupported), fixture()), /版本/);
  const unsafe = '{"version":1,"medications":[],"records":[],"__proto__":{"polluted":true}}';
  assert.throws(() => store.importData(unsafe, fixture()), /不支持的字段/);
  assert.equal({}.polluted, undefined);
});

test('a formatted backup near the local-storage limit can still be imported', () => {
  const large = record(fixture(), { note: '记'.repeat(500) });
  const template = large.records[0];
  large.records = Array.from({ length: 7200 }, (_, index) => ({ ...template, id: 'record-' + index }));
  const memory = memoryStorage();
  store.save(large, memory);
  const backup = store.exportData(large);
  assert.ok(backup.length > memory.raw().length);
  assert.deepEqual(store.importData(backup, fixture()), large);
});

test('local date helpers group midnight by device timezone, including DST transitions', () => {
  const script = `const s=require(${JSON.stringify(storePath)}); console.log(JSON.stringify([
    s.localDay('2025-07-11T15:59:59.000Z'),s.localDay('2025-07-11T16:00:00.000Z'),
    s.localDateTime('2025-07-11T16:00:00.000Z'),
    s.localDateTime('2025-03-09T06:59:00.000Z'),s.localDateTime('2025-03-09T07:00:00.000Z')
  ]));`;
  function inZone(zone) {
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, TZ: zone } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  }
  assert.deepEqual(inZone('Asia/Shanghai').slice(0, 3), ['2025-07-11', '2025-07-12', '2025-07-12T00:00']);
  assert.deepEqual(inZone('America/New_York').slice(3), ['2025-03-09T01:59', '2025-03-09T03:00']);
});

function legacy(data) {
  return {
    version: 1,
    medications: data.medications.map(({ id, name, icon }) => ({ id, name, icon })),
    records: data.records.map(({ id, medicationId, medicationName, takenAt, createdAt, note }) => ({
      id, medicationId, medicationName, takenAt, createdAt, note
    }))
  };
}

function schedule(overrides = {}) {
  return { mode: 'daily', slots: ['morning'], intervalDays: 2, startDate: '2025-07-01', weekdays: [], ...overrides };
}

function scheduledData(overrides = {}, id = 'minoxidil', data = fixture()) {
  return store.setSchedule(data, id, schedule(overrides));
}

function entry(plan, slot, id = 'minoxidil') {
  return plan.find(group => group.slot === slot).medications.find(item => item.medication.id === id);
}

function dose(data, { day = 12, hour = 8, slot = null, medicationId = 'minoxidil', note = '' } = {}) {
  return store.addRecord(data, {
    medicationId, takenAt: new Date(2025, 6, day, hour, 0, 0).toISOString(), slot, note
  }, new Date('2025-07-16T12:00:00Z'));
}

test('v1 load migrates without writing or losing history; next save uses v5 at the same key', () => {
  const original = legacy(record());
  const memory = memoryStorage(JSON.stringify(original));
  const upgraded = store.load(memory);
  assert.equal(store.STORAGE_KEY, 'medtime.data.v1');
  assert.equal(upgraded.version, 5);
  assert.deepEqual(legacy(upgraded), original);
  assert.equal(upgraded.records[0].slot, null);
  assert.ok(upgraded.medications.every(m => m.schedule.mode === 'none'));
  assert.equal(memory.raw(), JSON.stringify(original));
  store.save(upgraded, memory);
  assert.equal(JSON.parse(memory.raw()).version, 5);
  assert.deepEqual(store.load(memory), upgraded);
  assert.equal(JSON.parse(store.exportData(original)).version, 5);
});

test('inactive migration and defaults are deterministic across midnight and independent', () => {
  const RealDate = Date;
  const original = legacy(record());
  const before = store.load(memoryStorage(JSON.stringify(original)));
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2025-08-03T16:01:00Z'])); }
  };
  try {
    assert.deepEqual(store.load(memoryStorage(JSON.stringify(original))), before);
    assert.deepEqual(fixture().medications[0].schedule, before.medications[0].schedule);
  } finally { global.Date = RealDate; }
  const disabled = store.setSchedule(fixture(), 'minoxidil', schedule({ mode: 'none', slots: [], startDate: '2027-01-01', intervalDays: 3, weekdays: [1] }));
  assert.deepEqual(disabled.medications[0].schedule, fixture().medications[0].schedule);
  disabled.medications[0].schedule.slots.push('morning');
  assert.deepEqual(disabled.medications[1].schedule.slots, []);
  assert.deepEqual(fixture().medications[0].schedule.slots, []);
});

test('v1 import merges legacy custom medication and records without replacing an existing schedule', () => {
  const custom = store.addMedication(fixture(), '旧版自定义药品');
  const original = legacy(record(custom, { medicationId: custom.medications.at(-1).id, note: '旧版备注保留' }));
  const current = scheduledData({ mode: 'interval', intervalDays: 3 });
  const merged = store.importData(JSON.stringify(original), current);
  assert.equal(merged.version, 5);
  assert.equal(merged.medications.length, 4);
  assert.deepEqual(merged.medications[0].schedule, current.medications[0].schedule);
  assert.equal(merged.medications.at(-1).schedule.mode, 'none');
  assert.equal(merged.records[0].slot, null);
  assert.deepEqual(legacy(merged).records, original.records);
  assert.deepEqual(store.importData(JSON.stringify(original), merged), merged);
});

test('daily scheduling starts inclusively, respects selected slots, and never changes input data', () => {
  const empty = freezeDeep(fixture());
  const planned = freezeDeep(scheduledData({ slots: ['evening', 'morning'], startDate: '2025-07-12' }, 'minoxidil', empty));
  assert.equal(empty.medications[0].schedule.mode, 'none');
  assert.deepEqual(planned.medications[0].schedule.slots, ['morning', 'evening']);
  assert.equal(store.isScheduledOn(planned.medications[0], '2025-07-11'), false);
  assert.equal(store.isScheduledOn(planned.medications[0], '2025-07-12'), true);
  assert.equal(store.isScheduledOn(planned.medications[0], new Date(2025, 6, 13, 20)), true);
  assert.deepEqual(store.getDayPlan(planned, '2025-07-11').map(group => group.medications), [[], [], [], []]);
  const day = store.getDayPlan(planned, '2025-07-12');
  assert.deepEqual(day.map(group => group.slot), ['morning', 'noon', 'evening', 'bedtime']);
  assert.equal(entry(day, 'morning').medication.id, 'minoxidil');
  assert.equal(entry(day, 'morning').record, null);
  assert.equal(day[1].medications.length, 0);
  assert.equal(entry(day, 'evening').medication.id, 'minoxidil');
  day[0].medications[0].medication.name = 'Caller mutation';
  assert.equal(planned.medications[0].name, '米诺地尔');
  assert.equal(store.isScheduledOn(empty.medications[1], '2025-07-12'), false);
});

test('interval scheduling counts calendar days across leap days and year boundaries', () => {
  const leap = scheduledData({ mode: 'interval', startDate: '2024-02-28', intervalDays: 2 }).medications[0];
  assert.deepEqual(['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02'].map(day => store.isScheduledOn(leap, day)), [false, true, false, true, false]);
  const year = scheduledData({ mode: 'interval', startDate: '2024-12-30', intervalDays: 3 }).medications[0];
  assert.equal(store.isScheduledOn(year, '2025-01-01'), false);
  assert.equal(store.isScheduledOn(year, '2025-01-02'), true);
  const annual = scheduledData({ mode: 'interval', startDate: '2024-01-01', intervalDays: 365 }).medications[0];
  assert.equal(store.isScheduledOn(annual, '2024-12-31'), true);
});

test('interval and local-day completion stay correct through spring and autumn DST changes', () => {
  const script = `const s=require(${JSON.stringify(storePath)});
    function scheduled(start) {return s.setSchedule(require(${JSON.stringify(path.resolve(__dirname,'fixtures.cjs'))})(),'minoxidil',{mode:'interval',slots:['morning'],intervalDays:2,startDate:start,weekdays:[]});}
    const spring=scheduled('2025-03-08'); const autumn=scheduled('2025-11-01');
    const withDose=s.addRecord(spring,{medicationId:'minoxidil',takenAt:new Date(2025,2,10,0,15).toISOString(),slot:'morning'},new Date('2025-11-10T12:00:00Z'));
    console.log(JSON.stringify({
      spring:[8,9,10].map(d=>s.isScheduledOn(spring.medications[0],new Date(2025,2,d,12))),
      autumn:[1,2,3].map(d=>s.isScheduledOn(autumn.medications[0],new Date(2025,10,d,12))),
      literalDay:s.isScheduledOn(spring.medications[0],'2025-03-10'),
      done:s.getDayPlan(withDose,'2025-03-10')[0].medications[0].record.slot,
      nextDay:s.getDayPlan(withDose,'2025-03-12')[0].medications[0].record
    }));`;
  const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' } });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { spring: [true, false, true], autumn: [true, false, true], literalDay: true, done: 'morning', nextDay: null });
});

test('weekly scheduling uses Monday=1 and Sunday=7, and honors the starting date', () => {
  const weekly = scheduledData({ mode: 'weekly', weekdays: [7, 3, 1], slots: ['evening'], startDate: '2025-07-07' }).medications[0];
  assert.deepEqual(weekly.schedule.weekdays, [1, 3, 7]);
  assert.equal(store.isScheduledOn(weekly, '2025-07-06'), false);
  assert.deepEqual(['2025-07-07', '2025-07-08', '2025-07-09', '2025-07-10', '2025-07-13'].map(day => store.isScheduledOn(weekly, day)), [true, false, true, false, true]);
  assert.equal(store.getScheduleLabel(weekly), '每周一、三、日 · 晚');
});

test('invalid schedules and record slots are rejected without modifying existing data', () => {
  const initial = freezeDeep(fixture());
  const cases = [
    { mode: 'sometimes' }, { slots: [] }, { slots: ['morning', 'morning'] },
    { slots: ['night'] }, { slots: [null] }, { slots: new Array(1) }, { mode: 'none', slots: ['noon'] },
    { intervalDays: 1 }, { intervalDays: 366 }, { intervalDays: 2.5 }, { intervalDays: '2' },
    { mode: 'weekly', weekdays: [] }, { mode: 'weekly', weekdays: [0] },
    { mode: 'weekly', weekdays: [8] }, { mode: 'weekly', weekdays: [1, 1] },
    { mode: 'weekly', weekdays: ['1'] }, { mode: 'weekly', weekdays: new Array(1) }, { startDate: '2025-02-29' },
    { startDate: '2025-04-31' }, { startDate: '2025-13-01' }, { startDate: '2025-01-00' },
    { startDate: '0000-01-01' }, { startDate: '2025-7-01' }, { startDate: '2025-07-01T00:00:00Z' }
  ];
  for (const invalid of cases) assert.throws(() => store.setSchedule(initial, 'minoxidil', schedule(invalid)), JSON.stringify(invalid));
  assert.throws(() => store.setSchedule(initial, 'minoxidil', { mode: 'none' }));
  assert.throws(() => store.setSchedule(initial, 'missing', schedule()), /不存在/);
  assert.throws(() => record(initial, { slot: 'night' }), /时段/);
  assert.equal(initial.medications[0].schedule.mode, 'none');
  const badBackup = scheduledData();
  badBackup.medications[0].schedule.weekdays = [99];
  assert.throws(() => store.importData(JSON.stringify(badBackup), initial), /星期/);
  const badV2 = fixture();
  delete badV2.medications[0].schedule;
  assert.throws(() => store.load(memoryStorage(JSON.stringify(badV2))), /缺少字段/);
});

test('day-plan completion is isolated by medication, local day and explicitly assigned slot', () => {
  let planned = scheduledData({ slots: ['morning', 'noon', 'evening'] });
  planned = scheduledData({ slots: ['morning'] }, 'finasteride', planned);
  planned = dose(planned, { hour: 8 }); // A legacy or unassigned dose cannot fill any slot.
  planned = dose(planned, { day: 11, slot: 'evening', hour: 21 });
  planned = dose(planned, { day: 13, slot: 'evening', hour: 1 });
  planned = dose(planned, { medicationId: 'finasteride', slot: 'morning' });
  let plan = store.getDayPlan(planned, '2025-07-12');
  assert.equal(entry(plan, 'morning').record, null);
  assert.equal(entry(plan, 'noon').record, null);
  assert.equal(entry(plan, 'evening').record, null);
  assert.equal(entry(plan, 'morning', 'finasteride').record.medicationId, 'finasteride');
  planned = dose(planned, { slot: 'morning', hour: 9, note: '较早记录' });
  planned = dose(planned, { slot: 'morning', hour: 11, note: '较新记录' });
  planned = dose(planned, { slot: 'noon', hour: 7, note: '用户显式选择中午' });
  plan = store.getDayPlan(planned, new Date(2025, 6, 12, 23, 59));
  assert.equal(entry(plan, 'morning').record.note, '较新记录');
  assert.equal(entry(plan, 'noon').record.note, '用户显式选择中午');
  assert.equal(entry(plan, 'evening').record, null);
  assert.deepEqual(plan[0].medications.map(item => item.medication.id), ['minoxidil', 'finasteride']);
});

test('slot edits, deletion and restoration update completion without changing saved snapshots', () => {
  const planned = scheduledData({ slots: ['morning', 'evening'] });
  const before = freezeDeep(dose(planned, { slot: 'morning' }));
  const original = before.records[0];
  const edited = store.updateRecord(before, original.id, {
    medicationId: original.medicationId, takenAt: original.takenAt, note: '改为晚上', slot: 'evening'
  });
  assert.equal(entry(store.getDayPlan(before, '2025-07-12'), 'morning').record.id, original.id);
  assert.equal(entry(store.getDayPlan(edited, '2025-07-12'), 'morning').record, null);
  assert.equal(entry(store.getDayPlan(edited, '2025-07-12'), 'evening').record.id, original.id);
  const noteOnly = store.updateRecord(edited, original.id, {
    medicationId: original.medicationId, takenAt: original.takenAt, note: '保留已选时段'
  });
  assert.equal(noteOnly.records[0].slot, 'evening');
  const cleared = store.updateRecord(noteOnly, original.id, {
    medicationId: original.medicationId, takenAt: original.takenAt, note: '', slot: null
  });
  assert.equal(entry(store.getDayPlan(cleared, '2025-07-12'), 'evening').record, null);
  const deleted = store.deleteRecord(noteOnly, original.id);
  assert.equal(entry(store.getDayPlan(deleted, '2025-07-12'), 'evening').record, null);
  const memory = memoryStorage();
  store.save(noteOnly, memory); // The UI can restore this immutable snapshot when undo is clicked.
  assert.equal(entry(store.getDayPlan(store.load(memory), '2025-07-12'), 'evening').record.id, original.id);
  const imported = store.importData(store.exportData(noteOnly), deleted);
  assert.equal(entry(store.getDayPlan(imported, '2025-07-12'), 'evening').record.id, original.id);
});

test('changing a schedule never rewrites historical record slots', () => {
  const planned = scheduledData({ slots: ['morning'] });
  const recorded = dose(planned, { slot: 'evening' }); // Historical edits can use slots absent from the current plan.
  assert.equal(recorded.records[0].slot, 'evening');
  assert.equal(store.getDayPlan(recorded, '2025-07-12')[2].medications.length, 0);
  const moved = scheduledData({ slots: ['evening'] }, 'minoxidil', recorded);
  assert.equal(entry(store.getDayPlan(moved, '2025-07-12'), 'evening').record.id, recorded.records[0].id);
  const disabled = store.setSchedule(moved, 'minoxidil', schedule({ mode: 'none', slots: [] }));
  assert.deepEqual(disabled.records, recorded.records);
  assert.deepEqual(store.getDayPlan(disabled, '2025-07-12').map(group => group.medications), [[], [], [], []]);
});

test('current backups restore unset schedules but preserve configured schedules, names, and existing record IDs', () => {
  const backed = dose(scheduledData({ slots: ['morning', 'evening'] }), { slot: 'morning' });
  const current = store.renameMedication(fixture(), 'minoxidil', '本机药名');
  const imported = store.importData(store.exportData(backed), current);
  assert.equal(imported.medications[0].name, '本机药名');
  assert.deepEqual(imported.medications[0].schedule, backed.medications[0].schedule);
  assert.equal(imported.records[0].medicationName, '米诺地尔');
  assert.equal(imported.records[0].slot, 'morning');
  assert.deepEqual(store.importData(store.exportData(backed), imported), imported);
  const customized = scheduledData({ mode: 'weekly', weekdays: [2, 4], slots: ['noon'] }, 'minoxidil', current);
  assert.deepEqual(store.importData(store.exportData(backed), customized).medications[0].schedule, customized.medications[0].schedule);
  const v1Snapshot = legacy(backed);
  const sameIds = store.importData(store.exportData(backed), store.load(memoryStorage(JSON.stringify(v1Snapshot))));
  assert.equal(sameIds.records.length, 1);
  assert.equal(sameIds.records[0].slot, null); // Never infer a slot or overwrite an existing historical record.
  assert.equal(sameIds.medications[0].schedule.mode, 'daily');
  assert.equal(entry(store.getDayPlan(sameIds, '2025-07-12'), 'morning').record, null);
  const memory = memoryStorage();
  store.save(imported, memory);
  assert.deepEqual(store.load(memory), imported);
  assert.equal(JSON.parse(store.exportData(imported)).version, 5);
});

test('schedule labels describe daily, interval, weekly and unset choices', () => {
  assert.equal(store.getScheduleLabel(fixture().medications[0]), '未设置服药频率');
  assert.equal(store.getScheduleLabel(scheduledData({ slots: ['evening', 'morning'] }).medications[0]), '每天 2 次 · 早、晚');
  assert.equal(store.getScheduleLabel(scheduledData({ mode: 'interval' }).medications[0]), '每隔 2 天 · 早');
  assert.equal(store.getScheduleLabel(scheduledData({ mode: 'weekly', weekdays: [3, 1], slots: ['evening'] }).medications[0]), '每周一、三 · 晚');
});
