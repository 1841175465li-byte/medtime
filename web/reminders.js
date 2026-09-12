(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MedReminders = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var STORAGE_KEY = 'medtime.alarms.v1';
  var slots = ['morning','noon','evening','bedtime'];
  function defaults() {
    return {version:2,morning:{enabled:false,time:'08:00'},noon:{enabled:false,time:'12:30'},evening:{enabled:false,time:'20:00'},bedtime:{enabled:false,time:'22:00'}};
  }
  function validate(value) {
    if (!value || ![1,2].includes(value.version) || Object.keys(value).sort().join('|') !== (value.version === 1 ? 'evening|morning|noon|version' : 'bedtime|evening|morning|noon|version')) throw new Error('闹钟设置格式不正确');
    var clean = {version:2};
    slots.forEach(function (slot) {
      var alarm = slot === 'bedtime' && value.version === 1 ? {enabled:false,time:'22:00'} : value[slot];
      if (!alarm || Object.keys(alarm).sort().join('|') !== 'enabled|time' || typeof alarm.enabled !== 'boolean' ||
          typeof alarm.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(alarm.time)) throw new Error('请选择有效的闹钟时间');
      clean[slot] = {enabled:alarm.enabled,time:alarm.time};
    });
    return clean;
  }
  function load(storage) {
    var raw = (storage || localStorage).getItem(STORAGE_KEY);
    if (raw === null) return defaults();
    if (raw.length > 4096) throw new Error('闹钟设置文件过大');
    return validate(JSON.parse(raw));
  }
  function save(value, storage) {
    var clean = validate(value);
    try { (storage || localStorage).setItem(STORAGE_KEY,JSON.stringify(clean)); }
    catch (error) { throw new Error('闹钟设置保存失败，请重试'); }
    return clean;
  }
  function setAlarm(value, slot, enabled, time) {
    if (slots.indexOf(slot) < 0) throw new Error('闹钟时段不正确');
    var next = validate(value);
    next[slot] = {enabled:enabled,time:time};
    return validate(next);
  }
  function snapshot(data, alarms, now) {
    // The native mirror needs recurrence rules and recent/future explicit-slot
    // completions, never notes or a full backup. Keep UTC instants for zone changes.
    var cutoff = new Date(now === undefined ? Date.now() : now).getTime() - 48*60*60*1000;
    if (!Number.isFinite(cutoff)) throw new Error('设备时间无效');
    return {version:3,alarms:validate(alarms),medications:data.medications.map(function (med) {
      return {id:med.id,name:med.name,status:med.status,schedule:JSON.parse(JSON.stringify(med.schedule))};
    }),records:data.records.filter(function (record) {
      return slots.indexOf(record.slot) >= 0 && new Date(record.takenAt).getTime() >= cutoff;
    }).map(function (record) { return {medicationId:record.medicationId,slot:record.slot,takenAt:record.takenAt}; }),skips:(data.skips || []).filter(function(skip) {
      return skip.day >= new Date(cutoff-86400000).toISOString().slice(0,10);
    }).map(function(skip) { return {medicationId:skip.medicationId,slot:skip.slot,day:skip.day}; })};
  }
  return Object.freeze({STORAGE_KEY:STORAGE_KEY,defaults:defaults,validate:validate,load:load,save:save,setAlarm:setAlarm,snapshot:snapshot});
});
