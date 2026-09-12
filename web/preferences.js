(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MedPreferences = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';
  const KEY = 'medtime.preferences.v1';
  const defaults = () => ({version:1,largeText:false,backupDays:7,lastBackupAt:null,lastBackupKind:null,lastBackupMethod:null,lastChangeAt:null});
  function validate(value) {
    const out = defaults();
    if (!value || value.version !== 1 || typeof value.largeText !== 'boolean' || ![0,7,14,30].includes(value.backupDays)) throw new Error('显示与备份设置无法读取');
    out.largeText=value.largeText; out.backupDays=value.backupDays;
    for (const key of ['lastBackupAt','lastChangeAt']) {
      if (value[key] !== null && (typeof value[key] !== 'string' || !Number.isFinite(Date.parse(value[key])))) throw new Error('备份时间无效');
      out[key]=value[key];
    }
    out.lastBackupKind=['plain','encrypted'].includes(value.lastBackupKind)?value.lastBackupKind:null;
    out.lastBackupMethod=['android','confirmed'].includes(value.lastBackupMethod)?value.lastBackupMethod:null;
    return out;
  }
  function load(storage) {
    const raw=(storage || localStorage).getItem(KEY);
    if (raw===null) return defaults();
    if (raw.length>4096) throw new Error('显示与备份设置无法读取');
    return validate(JSON.parse(raw));
  }
  function save(value, storage) {
    const clean=validate(value);
    (storage || localStorage).setItem(KEY,JSON.stringify(clean)); return clean;
  }
  function due(value, hasData, now=Date.now()) {
    if (!hasData || !value.backupDays) return false;
    return !value.lastBackupAt || now-Date.parse(value.lastBackupAt)>=value.backupDays*86400000;
  }
  return Object.freeze({KEY,defaults,load,save,due});
});
