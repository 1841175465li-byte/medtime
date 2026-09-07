(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MedStore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var STORAGE_KEY = 'medtime.data.v1';
  var MAX_MEDICATIONS = 100;
  var MAX_RECORDS = 20000;
  // A formatted backup needs more space than the compact localStorage value.
  var MAX_JSON_LENGTH = 32 * 1024 * 1024;
  var MAX_STORAGE_LENGTH = 5 * 1024 * 1024;
  var ICONS = ['pill', 'capsule', 'tablet'];
  var SLOTS = ['morning', 'noon', 'evening', 'bedtime'];
  var SLOT_LABELS = { morning: '早', noon: '中', evening: '晚', bedtime: '睡前' };
  var DOSE_UNITS = Object.freeze(['粒', '片', 'mL', '滴', '喷', '袋', '支', 'g', 'mg']);

  function fail(message) { throw new Error(message); }

  function defaultSchedule() {
    // Inactive plans have a stable neutral date, so unsaved v1 migrations and
    // first-run defaults do not appear changed to another reader at midnight.
    return { mode: 'none', slots: [], intervalDays: 2, startDate: '1970-01-01', weekdays: [], endDate: null, times: {} };
  }

  function defaults() {
    return {
      version: 4,
      medications: [],
      records: []
    };
  }

  function object(value, label, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '格式不正确');
    var proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail(label + '格式不正确');
    Object.keys(value).forEach(function (key) {
      if (fields.indexOf(key) < 0) fail(label + '含有不支持的字段：' + key);
    });
    fields.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) fail(label + '缺少字段：' + key);
    });
  }

  function identifier(value, label) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
      fail(label + '标识不正确');
    }
    return value;
  }

  function medicationName(value) {
    if (typeof value !== 'string') fail('药品名称格式不正确');
    var clean = value.trim();
    if (!clean || clean.length > 60) fail('药品名称需为 1–60 个字');
    return clean;
  }

  function noteText(value) {
    if (typeof value !== 'string' || value.length > 500) fail('备注最多 500 个字');
    return value;
  }

  function detailText(value, label) {
    if (typeof value !== 'string' || value.trim().length > 80 || /[\x00-\x1f<>]/.test(value)) fail(label + '需为 0–80 个字');
    return value.trim();
  }

  function medicationStatus(value) {
    if (['active', 'paused', 'archived'].indexOf(value) < 0) fail('药品状态不正确');
    return value;
  }

  function validateDose(dose) {
    if (dose === null) return null;
    object(dose, '用药量', ['amount', 'unit']);
    if (typeof dose.amount !== 'string') fail('用量需填写大于 0 的数字');
    var amount = dose.amount.trim();
    if (!/^(?:\d{1,6}(?:\.\d{1,6})?|\.\d{1,6})$/.test(amount) || Number(amount) <= 0) {
      fail('用量需大于 0，整数和小数各最多 6 位');
    }
    // Keep decimal text exact; no dose calculations or unit conversions.
    var parts = amount.split('.');
    amount = (parts[0].replace(/^0+/, '') || '0') + (parts[1] ? '.' + parts[1].replace(/0+$/, '') : '');
    amount = amount.replace(/\.$/, '');
    if (typeof dose.unit !== 'string') fail('请选择用量单位');
    var unit = dose.unit.trim();
    if (!unit || unit.length > 12 || /[\x00-\x1f<>]/.test(unit)) fail('用量单位需为 1–12 个字');
    if (unit.toLowerCase() === 'ml') unit = 'mL';
    return {amount:amount, unit:unit};
  }

  function getDoseLabel(dose) {
    var clean = validateDose(dose);
    return clean ? clean.amount + (/^[a-z]/i.test(clean.unit) ? ' ' : '') + clean.unit : '';
  }

  function asDate(value) {
    var date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) fail('时间格式不正确');
    return date;
  }

  function calendarDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('日期需为 YYYY-MM-DD');
    var year = Number(value.slice(0, 4));
    var month = Number(value.slice(5, 7));
    var day = Number(value.slice(8, 10));
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail('日期不是有效年月日');
    return value;
  }

  function planDay(value) {
    // Date-only strings already identify a local calendar day, not a UTC instant.
    return calendarDay(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDay(value));
  }

  function dayNumber(day) {
    // UTC is used only to count calendar dates. A local day can be 23 or 25 hours.
    return new Date(day + 'T00:00:00.000Z').getTime() / 86400000;
  }

  function recordSlot(value) {
    if (value !== null && SLOTS.indexOf(value) < 0) fail('用药时段不正确');
    return value;
  }

  function validateSchedule(schedule, requireExtended) {
    var extended = requireExtended || (schedule && (Object.prototype.hasOwnProperty.call(schedule, 'endDate') || Object.prototype.hasOwnProperty.call(schedule, 'times')));
    var fields = ['mode', 'slots', 'intervalDays', 'startDate', 'weekdays'];
    object(schedule, '服药频率', extended ? fields.concat(['endDate', 'times']) : fields);
    if (['none', 'daily', 'interval', 'weekly'].indexOf(schedule.mode) < 0) fail('服药频率类型不正确');
    if (!Array.isArray(schedule.slots) || schedule.slots.length > SLOTS.length) fail('请选择有效用药时段');
    var chosenSlots = new Set();
    schedule.slots.forEach(function (slot) {
      if (SLOTS.indexOf(slot) < 0) fail('用药时段不正确');
      if (chosenSlots.has(slot)) fail('用药时段不能重复');
      chosenSlots.add(slot);
    });
    if (chosenSlots.size !== schedule.slots.length) fail('用药时段不正确');
    if (schedule.mode === 'none' && schedule.slots.length !== 0) fail('未设置频率时不应选择用药时段');
    if (schedule.mode !== 'none' && schedule.slots.length === 0) fail('请至少选择一个用药时段');
    if (!Number.isInteger(schedule.intervalDays) || schedule.intervalDays < 2 || schedule.intervalDays > 365) {
      fail('间隔天数需为 2–365 的整数');
    }
    if (!Array.isArray(schedule.weekdays) || schedule.weekdays.length > 7) fail('请选择有效星期');
    var chosenDays = new Set();
    schedule.weekdays.forEach(function (day) {
      if (!Number.isInteger(day) || day < 1 || day > 7) fail('星期需为周一至周日');
      if (chosenDays.has(day)) fail('星期不能重复');
      chosenDays.add(day);
    });
    if (chosenDays.size !== schedule.weekdays.length) fail('星期不正确');
    if (schedule.mode === 'weekly' && schedule.weekdays.length === 0) fail('请至少选择一个星期');
    var startDate = calendarDay(schedule.startDate);
    var endDate = extended && schedule.endDate !== null ? calendarDay(schedule.endDate) : null;
    if (endDate && endDate < startDate) fail('结束日期不能早于开始日期');
    var times = {};
    if (extended) {
      if (!schedule.times || typeof schedule.times !== 'object' || Array.isArray(schedule.times) || Object.getPrototypeOf(schedule.times) !== Object.prototype) fail('独立时间格式不正确');
      Object.keys(schedule.times).forEach(function (slot) {
        if (!chosenSlots.has(slot) || typeof schedule.times[slot] !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.times[slot])) fail('请选择有效的独立提醒时间');
        times[slot] = schedule.times[slot];
      });
    }
    if (schedule.mode === 'none') return defaultSchedule();
    return {
      mode: schedule.mode,
      slots: SLOTS.filter(function (slot) { return chosenSlots.has(slot); }),
      intervalDays: schedule.intervalDays,
      startDate: startDate,
      weekdays: schedule.weekdays.slice().sort(function (a, b) { return a - b; }),
      endDate: endDate,
      times: times
    };
  }

  function isoDate(value, now, label) {
    if (typeof value !== 'string') fail(label + '格式不正确');
    var parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts) fail(label + '需为带时区的 ISO 时间');
    var year = Number(parts[1]);
    var month = Number(parts[2]);
    var day = Number(parts[3]);
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
        Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) {
      fail(label + '不是有效日期');
    }
    if (parts[8] !== 'Z' && (Number(parts[8].slice(1, 3)) > 23 || Number(parts[8].slice(4, 6)) > 59)) {
      fail(label + '时区不正确');
    }
    var date = asDate(value);
    if (now && date.getTime() > now.getTime()) fail(label + '不能晚于当前时间');
    return date.toISOString();
  }

  // Validation also creates a fresh, whitelisted object: callers never receive shared data.
  function validate(data, futureTakenAtClock) {
    // Stored timestamps remain valid if the device clock moves backwards. Only
    // imported doses or a newly entered dose time are checked against "now".
    var clock = futureTakenAtClock === undefined ? null : asDate(futureTakenAtClock);
    object(data, '数据', ['version', 'medications', 'records']);
    if ([1, 2, 3, 4].indexOf(data.version) < 0) fail('不支持此备份版本');
    var legacy = data.version === 1;
    var hasDoses = data.version >= 3;
    var extended = data.version >= 4;
    if (!Array.isArray(data.medications) || data.medications.length > MAX_MEDICATIONS) {
      fail('药品列表最多包含 100 种药品');
    }
    if (!Array.isArray(data.records) || data.records.length > MAX_RECORDS) fail('记录数量最多 20,000 条');
    var medicationIds = new Set();
    var recordIds = new Set();
    var medications = data.medications.map(function (medication) {
      var fields = legacy ? ['id', 'name', 'icon'] : ['id', 'name', 'icon', 'schedule'];
      if (hasDoses) fields.push('dose');
      if (extended) fields.push('strength', 'form', 'status');
      object(medication, '药品', fields);
      var id = identifier(medication.id, '药品');
      if (medicationIds.has(id)) fail('药品标识重复');
      medicationIds.add(id);
      if (ICONS.indexOf(medication.icon) < 0) fail('药品图标不正确');
      return {
        id: id,
        name: medicationName(medication.name),
        icon: medication.icon,
        schedule: legacy ? defaultSchedule() : validateSchedule(medication.schedule, extended),
        dose: hasDoses ? validateDose(medication.dose) : null,
        strength: extended ? detailText(medication.strength, '规格') : '',
        form: extended ? detailText(medication.form, '剂型') : '',
        status: extended ? medicationStatus(medication.status) : 'active'
      };
    });
    var records = data.records.map(function (record) {
      var fields = ['id', 'medicationId', 'medicationName', 'takenAt', 'createdAt', 'note'];
      if (!legacy) fields.push('slot');
      if (hasDoses) fields.push('dose');
      if (extended) fields.push('medicationStrength', 'medicationForm');
      object(record, '记录', fields);
      var id = identifier(record.id, '记录');
      if (recordIds.has(id)) fail('记录标识重复');
      recordIds.add(id);
      var medicationId = identifier(record.medicationId, '药品');
      if (!medicationIds.has(medicationId)) fail('记录关联的药品不存在');
      return {
        id: id,
        medicationId: medicationId,
        medicationName: medicationName(record.medicationName),
        takenAt: isoDate(record.takenAt, clock, '用药时间'),
        createdAt: isoDate(record.createdAt, null, '创建时间'),
        note: noteText(record.note),
        slot: legacy ? null : recordSlot(record.slot),
        dose: hasDoses ? validateDose(record.dose) : null,
        medicationStrength: extended ? detailText(record.medicationStrength, '记录规格') : '',
        medicationForm: extended ? detailText(record.medicationForm, '记录剂型') : ''
      };
    });
    return { version: 4, medications: medications, records: records };
  }

  function storageOrDefault(storage) {
    if (storage !== undefined) return storage;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (error) {
      fail('无法访问本机存储：' + error.message);
    }
    fail('此环境不支持本机存储');
  }

  function parse(text) {
    if (typeof text !== 'string' || text.length > MAX_JSON_LENGTH) fail('备份文件无效或超过 32 MB');
    try { return JSON.parse(text); }
    catch (error) { fail('数据已损坏：无法读取 JSON'); }
  }

  function load(storage) {
    var target = storageOrDefault(storage);
    var raw;
    try { raw = target.getItem(STORAGE_KEY); }
    catch (error) { fail('无法读取本机记录：' + error.message); }
    return raw === null ? defaults() : validate(parse(raw));
  }

  function save(data, storage) {
    var clean = validate(data);
    var text = JSON.stringify(clean);
    if (text.length > MAX_STORAGE_LENGTH) fail('记录超过存储大小限制，请先导出备份');
    var target = storageOrDefault(storage);
    try { target.setItem(STORAGE_KEY, text); }
    catch (error) { fail('保存失败，请导出备份后重试：' + error.message); }
    return clean;
  }

  function uniqueId(prefix, items) {
    var id;
    do {
      var token = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      id = prefix + '-' + token;
    } while (items.some(function (item) { return item.id === id; }));
    return id;
  }

  function recordFields(data, input, now, original) {
    if (!input || typeof input !== 'object') fail('记录格式不正确');
    var medication = data.medications.find(function (item) { return item.id === input.medicationId; });
    if (!medication) fail('请选择有效药品');
    var takenAt = isoDate(input.takenAt, null, '用药时间');
    // A note-only edit may retain its original time after a clock correction.
    if ((!original || takenAt !== original.takenAt) && new Date(takenAt).getTime() > now.getTime()) {
      fail('用药时间不能晚于当前时间');
    }
    return {
      medicationId: medication.id,
      medicationName: medication.name,
      medicationStrength: medication.strength,
      medicationForm: medication.form,
      takenAt: takenAt,
      note: noteText(input.note === undefined ? '' : input.note).trim(),
      slot: recordSlot(input.slot === undefined ? (original ? original.slot : null) : input.slot),
      dose: validateDose(input.dose === undefined ? (original && original.medicationId === medication.id ? original.dose : medication.dose) : input.dose)
    };
  }

  function addRecord(data, input, now) {
    var clock = asDate(now === undefined ? new Date() : now);
    var clean = validate(data);
    if (clean.records.length >= MAX_RECORDS) fail('记录数量最多 20,000 条');
    var fields = recordFields(clean, input, clock);
    clean.records.push({
      id: uniqueId('record', clean.records),
      medicationId: fields.medicationId,
      medicationName: fields.medicationName,
      medicationStrength: fields.medicationStrength,
      medicationForm: fields.medicationForm,
      takenAt: fields.takenAt,
      createdAt: clock.toISOString(),
      note: fields.note,
      slot: fields.slot,
      dose: fields.dose
    });
    return clean;
  }

  function deleteRecord(data, id) {
    var clean = validate(data);
    if (!clean.records.some(function (record) { return record.id === id; })) fail('这条记录不存在');
    clean.records = clean.records.filter(function (record) { return record.id !== id; });
    return clean;
  }

  function updateRecord(data, id, input, now) {
    var clock = asDate(now === undefined ? new Date() : now);
    var clean = validate(data);
    var index = clean.records.findIndex(function (record) { return record.id === id; });
    if (index < 0) fail('这条记录不存在');
    var original = clean.records[index];
    var fields = recordFields(clean, input, clock, original);
    clean.records[index] = {
      id: original.id,
      medicationId: fields.medicationId,
      // Editing time or note does not rewrite the historical name after a rename.
      medicationName: fields.medicationId === original.medicationId ? original.medicationName : fields.medicationName,
      medicationStrength: fields.medicationId === original.medicationId ? original.medicationStrength : fields.medicationStrength,
      medicationForm: fields.medicationId === original.medicationId ? original.medicationForm : fields.medicationForm,
      takenAt: fields.takenAt,
      createdAt: original.createdAt,
      note: fields.note,
      slot: fields.slot,
      dose: fields.dose
    };
    return clean;
  }

  function checkDuplicateName(medications, name, exceptId, strength, form) {
    if (medications.some(function (item) { return item.id !== exceptId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase() && item.strength === (strength || '') && item.form === (form || ''); })) {
      fail('已有同名、同规格和同剂型的药品，请在药品列表中管理');
    }
  }

  function addMedication(data, name, details) {
    var clean = validate(data);
    var normalized = medicationName(name);
    if (clean.medications.length >= MAX_MEDICATIONS) fail('最多添加 100 种药品');
    var strength = detailText(details && details.strength !== undefined ? details.strength : '', '规格');
    var form = detailText(details && details.form !== undefined ? details.form : '', '剂型');
    checkDuplicateName(clean.medications, normalized, null, strength, form);
    clean.medications.push({ id: uniqueId('medication', clean.medications), name: normalized, icon: 'pill', schedule: defaultSchedule(), dose: null, strength: strength, form: form, status: 'active' });
    return clean;
  }

  function renameMedication(data, id, name) {
    var clean = validate(data);
    var medication = clean.medications.find(function (item) { return item.id === id; });
    if (!medication) fail('这款药品不存在');
    var normalized = medicationName(name);
    checkDuplicateName(clean.medications, normalized, id, medication.strength, medication.form);
    medication.name = normalized;
    return clean;
  }

  function addCatalogMedication(data, entry) {
    var clean = validate(data);
    object(entry, '药品库条目', ['id', 'name', 'icon']);
    var id = identifier(entry.id, '药品');
    var name = medicationName(entry.name);
    if (ICONS.indexOf(entry.icon) < 0) fail('药品图标不正确');
    if (clean.medications.some(function (med) { return med.id === id || med.name.toLocaleLowerCase() === name.toLocaleLowerCase(); })) return clean;
    if (clean.medications.length >= MAX_MEDICATIONS) fail('最多添加 100 种药品');
    clean.medications.push({id:id, name:name, icon:entry.icon, schedule:defaultSchedule(), dose:null, strength:'', form:'', status:'active'});
    return clean;
  }

  function getMedicationStats(data) {
    var clean = validate(data);
    var byId = new Map();
    var stats = clean.medications.map(function (med) {
      var result = {medicationId:med.id, name:med.name, icon:med.icon, strength:med.strength, form:med.form, status:med.status, count:0, lastTakenAt:null};
      byId.set(med.id, result);
      return result;
    });
    clean.records.forEach(function (record) {
      var item = byId.get(record.medicationId);
      item.count += 1;
      if (!item.lastTakenAt || new Date(record.takenAt) > new Date(item.lastTakenAt)) item.lastTakenAt = record.takenAt;
    });
    return stats;
  }

  function exportData(data) {
    return JSON.stringify(validate(data), null, 2);
  }

  function importData(text, currentData) {
    var imported = validate(parse(text), new Date());
    var current = validate(currentData);
    var medicationIds = new Set(current.medications.map(function (item) { return item.id; }));
    var recordIds = new Set(current.records.map(function (item) { return item.id; }));
    imported.medications.forEach(function (item) {
      if (!medicationIds.has(item.id)) {
        current.medications.push(item);
        medicationIds.add(item.id);
      } else {
        var existing = current.medications.find(function (medication) { return medication.id === item.id; });
        if (existing.schedule.mode === 'none' && item.schedule.mode !== 'none') existing.schedule = item.schedule;
        if (!existing.dose && item.dose) existing.dose = item.dose;
        if (!existing.strength && item.strength) existing.strength = item.strength;
        if (!existing.form && item.form) existing.form = item.form;
      }
    });
    imported.records.forEach(function (item) {
      if (!recordIds.has(item.id)) {
        current.records.push(item);
        recordIds.add(item.id);
      }
    });
    return validate(current);
  }

  function setSchedule(data, id, schedule) {
    var clean = validate(data);
    var medication = clean.medications.find(function (item) { return item.id === id; });
    if (!medication) fail('这款药品不存在');
    medication.schedule = validateSchedule(schedule);
    return clean;
  }

  function setDose(data, id, dose) {
    var clean = validate(data);
    var medication = clean.medications.find(function (item) { return item.id === id; });
    if (!medication) fail('这款药品不存在');
    medication.dose = validateDose(dose);
    return clean;
  }

  function setMedicationDetails(data, id, details) {
    var clean = validate(data);
    var med = clean.medications.find(function (item) { return item.id === id; });
    if (!med) fail('这款药品不存在');
    object(details, '药品信息', ['name', 'strength', 'form']);
    var name = medicationName(details.name), strength = detailText(details.strength, '规格'), form = detailText(details.form, '剂型');
    checkDuplicateName(clean.medications, name, id, strength, form);
    med.name = name; med.strength = strength; med.form = form;
    return clean;
  }

  function setMedicationStatus(data, id, status) {
    var clean = validate(data);
    var med = clean.medications.find(function (item) { return item.id === id; });
    if (!med) fail('这款药品不存在');
    med.status = medicationStatus(status);
    return clean;
  }

  function scheduledOn(schedule, day) {
    if (schedule.mode === 'none' || day < schedule.startDate || (schedule.endDate && day > schedule.endDate)) return false;
    if (schedule.mode === 'daily') return true;
    if (schedule.mode === 'interval') return (dayNumber(day) - dayNumber(schedule.startDate)) % schedule.intervalDays === 0;
    var weekday = new Date(day + 'T00:00:00.000Z').getUTCDay() || 7;
    return schedule.weekdays.indexOf(weekday) >= 0;
  }

  function isScheduledOn(medication, date) {
    if (!medication || typeof medication !== 'object') fail('药品格式不正确');
    return (!medication.status || medication.status === 'active') && scheduledOn(validateSchedule(medication.schedule), planDay(date));
  }

  function getDayPlan(data, date) {
    var clean = validate(data);
    var day = planDay(date);
    var latest = new Map();
    clean.records.forEach(function (record) {
      if (record.slot === null || localDay(record.takenAt) !== day) return;
      var key = record.medicationId + '|' + record.slot;
      var previous = latest.get(key);
      if (!previous || record.takenAt > previous.takenAt ||
          (record.takenAt === previous.takenAt && record.createdAt >= previous.createdAt)) latest.set(key, record);
    });
    var groups = SLOTS.map(function (slot) { return { slot: slot, medications: [] }; });
    clean.medications.forEach(function (medication) {
      if (medication.status !== 'active' || !scheduledOn(medication.schedule, day)) return;
      groups.forEach(function (group) {
        if (medication.schedule.slots.indexOf(group.slot) >= 0) {
          group.medications.push({ medication: medication, record: latest.get(medication.id + '|' + group.slot) || null });
        }
      });
    });
    return groups;
  }

  function getScheduleLabel(medication) {
    if (!medication || typeof medication !== 'object') fail('药品格式不正确');
    var schedule = validateSchedule(medication.schedule);
    var state = medication.status === 'archived' ? '已归档 · ' : medication.status === 'paused' ? '已暂停 · ' : '';
    if (schedule.mode === 'none') return state + '未设置服药频率';
    var prefix;
    if (schedule.mode === 'daily') prefix = '每天 ' + schedule.slots.length + ' 次';
    else if (schedule.mode === 'interval') prefix = '每隔 ' + schedule.intervalDays + ' 天';
    else {
      var names = ['一', '二', '三', '四', '五', '六', '日'];
      prefix = '每周' + schedule.weekdays.map(function (day) { return names[day - 1]; }).join('、');
    }
    return state + prefix + ' · ' + schedule.slots.map(function (slot) { return SLOT_LABELS[slot] + (schedule.times[slot] ? ' ' + schedule.times[slot] : ''); }).join('、') + (schedule.endDate ? ' · 至 ' + schedule.endDate : '');
  }

  function pad(number) { return String(number).padStart(2, '0'); }

  function localDay(value) {
    var date = asDate(value);
    return String(date.getFullYear()).padStart(4, '0') + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function localDateTime(value) {
    var date = asDate(value);
    return localDay(date) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  return Object.freeze({
    STORAGE_KEY: STORAGE_KEY,
    defaults: defaults,
    load: load,
    save: save,
    addRecord: addRecord,
    deleteRecord: deleteRecord,
    updateRecord: updateRecord,
    addMedication: addMedication,
    addCatalogMedication: addCatalogMedication,
    renameMedication: renameMedication,
    getMedicationStats: getMedicationStats,
    setSchedule: setSchedule,
    setDose: setDose,
    setMedicationDetails: setMedicationDetails,
    setMedicationStatus: setMedicationStatus,
    getDoseLabel: getDoseLabel,
    doseUnits: DOSE_UNITS,
    isScheduledOn: isScheduledOn,
    getDayPlan: getDayPlan,
    getScheduleLabel: getScheduleLabel,
    exportData: exportData,
    importData: importData,
    localDay: localDay,
    localDateTime: localDateTime
  });
});
