/* 药记：完全离线的用药时间记录界面。 */
(() => {
  'use strict';
  const S = window.MedStore;
  const C = window.MedCatalog;
  const R = window.MedReminders;
  const P=window.MedPreferences, B=window.MedBackup;
  const SPONSOR_URL='https://afdian.com/a/666ccb';
  let preferences=P.defaults(), preferenceError='', exportPending=false;
  const $ = (selector, root = document) => root.querySelector(selector);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    pill: '<g transform="rotate(40 12 12)"><rect x="7" y="2" width="10" height="20" rx="5"/><path d="M7 12h10"/></g>',
    capsule: '<ellipse cx="12" cy="12" rx="6.6" ry="10.2" transform="rotate(39 12 12)"/><path d="M7.5 18c4.5 0 9-5.3 9.1-9.5"/>',
    tablet: '<circle cx="12" cy="12" r="9"/><path d="m5.7 18.3 12.6-12.6"/>',
    settings: '<path d="M3 6h4m4 0h10M3 12h11m4 0h3M3 18h3m4 0h11"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M7 2v4m10-4v4M3 9h18"/><path d="M7 13h1m3 0h1m3 0h1m-9 4h1m3 0h1m3 0h1" stroke-width="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8m-4-4h8"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    morning: '<path d="M3 17h18M5 21h14M7 17a5 5 0 0 1 10 0M12 3v3M3.5 8.5l2 2m13-2-2 2M1 14h3m16 0h3"/>',
    noon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    evening: '<path d="M20.3 14.3A8.8 8.8 0 0 1 9.7 3.7 9 9 0 1 0 20.3 14.3Z"/>',
    bedtime: '<path d="M3 18h18M4 18V9m16 9V9M4 12h16M7 8h4v4H7zM13 8h4v4h-4z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M3 5l3-3m12 0 3 3M6 20l-2 2m14-2 2 2"/>',
    heart: '<path d="M20.6 4.8a5.4 5.4 0 0 0-7.6 0L12 5.9l-1.1-1.1a5.4 5.4 0 0 0-7.6 7.6L12 21l8.6-8.6a5.4 5.4 0 0 0 0-7.6Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.pill}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  let data, storageBlocked = false;
  let tab = 'today', filterMed = '', filterDate = '', modal = null, previousFocus = null;
  let medView = 'mine', medSearch = '', medCategory = '', statsExpanded = false;
  let alarmSettings = R.defaults(), alarmError = '', nativeAlarm = {supported:false,ready:false,scheduled:{}};
  let alarmPicker = null;
  let medTimeDialog = null;
  let toastTimer, undoAction = null, observedDay = S.localDay(new Date());
  const sortRecords = records => [...records].sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
  const time = value => new Date(value).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',hour12:false});
  const dateLabel = value => new Date(value).toLocaleDateString('zh-CN', {month:'long',day:'numeric',weekday:'long'});
  const fullDate = value => new Date(value).toLocaleDateString('zh-CN', {year:'numeric',month:'long',day:'numeric'});
  const todayRecords = () => sortRecords(data.records.filter(r => S.localDay(new Date(r.takenAt)) === S.localDay(new Date())));
  const slotNames = {morning:'早上',noon:'中午',evening:'晚上',bedtime:'睡前'};
  const slots = ['morning','noon','evening','bedtime'];

  function load() {
    try { data = S.load(); storageBlocked = false; $('#storage-alert').hidden = true; }
    catch (err) {
      data = S.defaults(); storageBlocked = true;
      const alert = $('#storage-alert');
      alert.hidden = false;
      alert.innerHTML = '本地数据暂时无法读取，原始数据已保留。为防止覆盖，暂不能记录。请先导出原始数据保存。<button id="export-raw">导出原始数据</button>';
    }
    try { preferences=P.load(); } catch (_) { preferenceError='显示与备份设置无法读取，暂用默认值。'; }
    syncBackupStatus(); applyAppearance();
    try { alarmSettings = R.load(); alarmError = ''; }
    catch (error) { alarmSettings = R.defaults(); alarmError = '闹钟设置无法读取，已暂停提醒。'; }
  }
  function alarmBridge() {
    const bridge = window.MedtimeAndroid;
    return bridge && typeof bridge.syncAlarms === 'function' ? bridge : null;
  }
  function syncAlarms() {
    const bridge = alarmBridge();
    if (!bridge) { nativeAlarm = {supported:false,ready:false,scheduled:{}}; return; }
    try {
      if (storageBlocked || alarmError) { bridge.suspendAlarms(); nativeAlarm = JSON.parse(bridge.getAlarmStatus()); }
      else nativeAlarm = JSON.parse(bridge.syncAlarms(JSON.stringify(R.snapshot(data,alarmSettings))));
    } catch (error) { nativeAlarm = {supported:true,ready:false,scheduled:{},error:'闹钟暂时无法同步，请重新打开应用后保存设置。'}; }
  }
  function alarmSystemStatus(slot = modal && modal.slot) {
    if (!nativeAlarm.supported) return '<p class="form-helper alarm-browser-note">这是网页预览：可以保存安排，后台提醒和锁屏试响请在安卓安装版中完成。</p>';
    const next = slot && alarmSettings[slot].enabled ? (nativeAlarm.scheduled || {})[slot] : null;
    const nextLine = next != null ? `<p class="form-helper alarm-next">${next ? `本时段下次提醒 · ${fullDate(next)} ${time(next)}` : '目前没有待提醒安排。已记录、暂停、归档或已结束的安排不会提醒。'}</p>` : '';
    const volume = Number.isFinite(nativeAlarm.alarmVolume) ? `<div><span>系统闹钟音量<small>${nativeAlarm.alarmVolume===0?'当前为静音，请先调整':`${nativeAlarm.alarmVolume} / ${nativeAlarm.maxAlarmVolume}`}</small></span><button type="button" data-alarm-access="sound">声音设置</button></div>` : '';
    const checks = [nativeAlarm.backgroundRestricted?'系统限制了药记的后台运行，请在应用设置中检查电池限制。':'',nativeAlarm.powerSave?'当前已开启省电模式，请在此状态下做一次锁屏测试。':'',nativeAlarm.interruptionFilter>1?'勿扰模式已开启，请确认系统允许闹钟出声。':''].filter(Boolean);
    return `<div class="alarm-permissions"><div><span>用药闹钟通知<small>显示提醒与操作按钮</small></span>${nativeAlarm.notifications?'<strong>已允许</strong>':'<button type="button" data-alarm-access="notifications">允许通知</button>'}</div><div><span>准时闹钟<small>允许系统按时间触发提醒</small></span>${nativeAlarm.exact?'<strong>已允许</strong>':'<button type="button" data-alarm-access="exact">允许准时闹钟</button>'}</div>${volume}</div>${nextLine}${checks.length?`<div class="device-check-note">${checks.map(text=>`<p>${text}</p>`).join('')}<button type="button" class="text-button" data-alarm-access="app">打开应用系统设置</button></div>`:''}${nativeAlarm.error?`<p class="form-error">${escape(nativeAlarm.error)}</p>`:''}`;
  }
  function alarmBanner() {
    if (alarmError) return `<div class="alarm-notice warning"><span>${escape(alarmError)}</span><button id="reset-alarms">重置闹钟</button></div>`;
    if (nativeAlarm.ringing) return `<div class="alarm-notice"><span>${nativeAlarm.error?escape(nativeAlarm.error):'用药闹钟正在响铃'}</span><div class="alarm-banner-actions"><button id="stop-alarm">停止响铃</button></div></div>`;
    if (nativeAlarm.testScheduled || nativeAlarm.testResult==='awaiting') return '<div class="alarm-notice"><span>锁屏试响进行中，请在提醒设置中确认结果</span><button id="alarm-settings">查看测试</button></div>';
    if (!slots.some(slot=>alarmSettings[slot].enabled)) return '';
    const message = !nativeAlarm.supported?'后台提醒需使用安卓安装版':nativeAlarm.alarmVolume===0?'闹钟音量为 0，请调整音量':!nativeAlarm.ready?(nativeAlarm.error || '提醒待就绪，请检查系统授权'):'';
    if (message) return `<div class="alarm-notice warning"><span>${escape(message)}</span><button id="alarm-settings">查看设置</button></div>`;
    return '';
  }
  function alarmButton(slot) {
    const alarm = alarmSettings[slot];
    const state = alarm.enabled ? (nativeAlarm.ready ? 'is-on' : 'is-pending') : '';
    return `<div class="period-alarm-controls"><button class="period-alarm ${state}" data-alarm="${slot}" aria-label="设置${slotNames[slot]}闹钟时间，${alarm.time}">${icon('alarm')}<span>${alarm.time}</span></button><button type="button" class="home-alarm-switch ${state}" role="switch" aria-checked="${alarm.enabled}" aria-label="${slotNames[slot]}闹钟开关" data-alarm-toggle="${slot}" title="${alarm.enabled ? '关闭' : '开启'}${slotNames[slot]}闹钟"><span aria-hidden="true"></span></button></div>`;
  }
  function saveAlarm(slot, enabled, timeValue) {
    if (alarmError) throw new Error('请先在首页重置无法读取的闹钟设置');
    const latest = R.load();
    if (JSON.stringify(latest) !== JSON.stringify(alarmSettings)) {
      alarmSettings = latest; render(); throw new Error('闹钟已在另一页面修改，请重新操作');
    }
    alarmSettings = R.save(R.setAlarm(alarmSettings,slot,enabled,timeValue));
    render();
  }
  function toggleAlarm(slot) {
    if (!slots.includes(slot)) return;
    try {
      const alarm = alarmSettings[slot], enabled = !alarm.enabled;
      saveAlarm(slot,enabled,alarm.time);
      if (modal && modal.type === 'alarms') alarmOverview();
      const control = $(`[data-alarm-toggle="${slot}"]`);
      if (control) control.focus({preventScroll:true});
      toast(!enabled ? '闹钟已关闭' : nativeAlarm.supported && !nativeAlarm.ready ? '已开启，请完成授权' : '闹钟已开启', null, 1000);
    } catch (error) { showError(error); }
  }
  function alarmOverview() {
    sheet('用药提醒', `<p class="form-helper">这里设置各时段的默认时间与开关。药品的独立时间优先使用，开关同时控制该时段内的所有药品。</p><div class="setting-group">${slots.map(slot=>`<div class="reminder-overview-row"><button class="setting-row" data-alarm="${slot}">${icon(slot)}<span>${slotNames[slot]}<small>默认 ${alarmSettings[slot].time}</small></span>${icon('chevron')}</button><button type="button" class="home-alarm-switch ${alarmSettings[slot].enabled?(nativeAlarm.ready?'is-on':'is-pending'):''}" role="switch" aria-checked="${alarmSettings[slot].enabled}" aria-label="${slotNames[slot]}提醒开关" data-alarm-toggle="${slot}"><span aria-hidden="true"></span></button></div>`).join('')}</div><div id="alarm-system-status">${alarmSystemStatus()}</div>${alarmTestPanel()}<p class="form-helper">正常提醒最多响铃 1 分钟。通知提供「停止响铃」和「打开药记」两个按钮。</p>`, {type:'alarms'});
  }
  function alarmForm(slot) {
    if (!slots.includes(slot)) return;
    const alarm=alarmSettings[slot];
    sheet(`${slotNames[slot]}提醒`, `<form id="alarm-form"><p class="alarm-form-state">当前${alarm.enabled?'已开启':'已关闭'} · 开关可在首页或提醒列表操作</p><div class="alarm-time-field"><div class="time-picker-caption"><span id="time-picker-label">本时段默认时间</span><small>24 小时制</small></div><div id="alarm-time-picker" class="time-picker" role="group" aria-labelledby="time-picker-label"></div><input type="hidden" name="time" value="${alarm.time}"><p class="time-picker-help" id="time-picker-help">上下滑动选择，中间高亮为选中时间</p></div><p class="form-helper">使用独立时间的药品不受此时间调整影响。当日时间已过时，从下次安排开始。</p><p class="form-error" id="form-error" role="alert" hidden></p><button type="submit" class="primary-button">保存时间</button></form><div id="alarm-system-status" class="alarm-system-status">${alarmSystemStatus(slot)}</div>${alarmTestPanel()}`, {type:'alarm',slot});
    const field=$('#alarm-form [name="time"]');
    alarmPicker=window.MedTimePicker.mount($('#alarm-time-picker'),{value:alarm.time,disabled:false,onChange:value=>{field.value=value;}});
  }
  function refreshAlarmStatus() {
    const bridge=alarmBridge(); if (!bridge) return;
    let next;
    try { next=JSON.parse(bridge.getAlarmStatus()); } catch (error) { return; }
    if (JSON.stringify(next)===JSON.stringify(nativeAlarm)) return;
    nativeAlarm=next;
    const panel=$('#alarm-system-status'); if (panel) panel.innerHTML=alarmSystemStatus();
    const test=$('.alarm-test-panel'); if (test) test.outerHTML=alarmTestPanel();
    const guide=$('#reminder-guide-state'); if (guide && modal) guide.innerHTML=reminderGuideState(modal.id);
    if (tab==='today') $('#main').innerHTML=renderToday();
  }
  function clearToast() {
    clearTimeout(toastTimer); undoAction = null; $('#toast').hidden = true;
  }
  function toast(message, undo, duration = undo ? 4000 : 2200) {
    clearTimeout(toastTimer); undoAction = undo || null;
    const el = $('#toast');
    el.innerHTML = `<span>${escape(message)}</span>${undo ? '<button id="undo-button">撤销</button>' : ''}`;
    el.hidden = false;
    toastTimer = setTimeout(() => { el.hidden = true; undoAction = null; }, duration);
  }
  function commit(next, message, canUndo = true) {
    if (storageBlocked) throw new Error('请先保存原始数据，本地存储目前不可用。');
    const latest = S.load();
    if (JSON.stringify(latest) !== JSON.stringify(data)) {
      data = latest; render();
      throw new Error('记录已在另一页面更新，请重新操作。');
    }
    next = S.save(next);
    const previous = data;
    data = next; rememberChange(); render();
    if (message) toast(message, canUndo ? () => {
      if (data !== next) return;
      try {
        const current = S.load();
        if (JSON.stringify(current) !== JSON.stringify(next)) {
          data = current; render(); throw new Error('记录已在另一页面更新');
        }
        S.save(previous); data = previous; rememberChange(); render(); toast('已撤销');
      }
      catch (err) { toast(`撤销失败：${err.message}`); }
    } : null, canUndo ? 8000 : 1000);
  }
  function timeline(records) {
    return `<div class="timeline-list">${records.map(r => `<article class="timeline-row"><time class="timeline-time" datetime="${escape(r.takenAt)}">${time(r.takenAt)}</time><div class="timeline-content"><strong>${escape(r.medicationName)}</strong><p class="record-slot">${r.slot ? slotNames[r.slot] : '未分时段'}${r.dose ? ` · ${escape(S.getDoseLabel(r.dose))}` : ''}</p>${r.medicationStrength || r.medicationForm ? `<p>${escape([r.medicationStrength,r.medicationForm].filter(Boolean).join(' · '))}</p>` : ''}${r.note ? `<p>${escape(r.note)}</p>` : ''}</div><button class="icon-button row-menu" data-edit="${escape(r.id)}" aria-label="编辑${escape(r.medicationName)} ${time(r.takenAt)}的记录">${icon('more')}</button></article>`).join('')}</div>`;
  }
  function planRow(item, slot, records) {
    const med=item.medication, record=item.record, skip=!record && item.skip, unassigned=records.filter(r=>r.medicationId===med.id && !r.slot);
    let action;
    if (record) action=`<button class="recorded-button" data-edit="${escape(record.id)}" aria-label="编辑${escape(med.name)}${slotNames[slot]}的记录">${icon('check')}<span>已记录<small>${time(record.takenAt)}</small></span></button>`;
    else if (skip) action=`<button class="skip-button" data-edit-skip="${escape(skip.id)}" aria-label="查看${escape(med.name)}${slotNames[slot]}的跳过原因">已跳过</button><button class="text-button" data-record="${escape(med.id)}" data-slot="${slot}">补记用药</button>`;
    else {
      action=unassigned.length?`<button class="assign-button" data-assign="${escape(med.id)}" data-slot="${slot}" aria-label="关联${escape(med.name)}${slotNames[slot]}的已有记录">关联记录</button>`:`<button class="record-button" data-record="${escape(med.id)}" data-slot="${slot}" aria-label="记录${escape(med.name)}（${slotNames[slot]}）" ${storageBlocked?'disabled':''}>${icon('plus')}<span>记录</span></button>`;
      action+=`<button class="text-button skip-action" data-skip="${escape(med.id)}" data-slot="${slot}" aria-label="跳过${escape(med.name)}${slotNames[slot]}这次安排" ${storageBlocked?'disabled':''}>本次跳过</button>`;
    }
    const dose=record?record.dose:med.dose, plannedTime=med.schedule.times[slot] || alarmSettings[slot].time;
    const details=record?[record.medicationStrength,record.medicationForm]:[med.strength,med.form];
    return `<article class="plan-med ${record?'is-recorded':skip?'is-skipped':''}"><div class="plan-med-info"><h3>${escape(med.name)}</h3>${details.some(Boolean)?`<p class="med-strength">${escape(details.filter(Boolean).join(' · '))}</p>`:''}<p>${record?'已记录本时段':skip?'已跳过 · '+escape(skip.reason):`未记录 · ${plannedTime}${med.schedule.times[slot]?' · 独立时间':''}${alarmSettings[slot].enabled?'':' · 提醒关闭'}`}</p>${unassigned.length && !record && !skip?`<p>有 ${unassigned.length} 条未分时段记录</p>`:''}${dose?`<p class="plan-dose">${record?'本次':'每次'} ${escape(S.getDoseLabel(dose))}</p>`:''}<p class="last-use">${escape(lastUseText(med.id))}</p></div><div class="plan-actions">${action}</div></article>`;
  }
  function renderToday() {
    if (!data.medications.length && !storageBlocked) return welcome();
    const records=todayRecords(), plan=S.getDayPlan(data,new Date());
    const total=plan.reduce((n,g)=>n+g.medications.length,0), completed=plan.reduce((n,g)=>n+g.medications.filter(i=>i.record).length,0);
    const skipped=plan.reduce((n,g)=>n+g.medications.filter(i=>!i.record && i.skip).length,0);
    const unset=data.medications.filter(m=>m.status==='active' && m.schedule.mode==='none').length;
    return `<section class="page-heading"><h1>今天</h1><p>${dateLabel(new Date())}</p></section><div class="summary"><strong>今日安排</strong><span>${total?`已记录 ${completed} / ${total} 项${skipped?` · 跳过 ${skipped} 项`:""}`:'今天暂无安排'}</span></div>${alarmBanner()}${backupBanner()}<section aria-labelledby="plan-heading"><div class="section-title plan-title"><h2 id="plan-heading">一天的用药安排</h2><button class="text-button" id="home-schedule-settings">设置安排${icon('chevron')}</button></div>${unset?`<button class="setup-notice" id="setup-schedules"><span>${unset} 种药品未设置频率<small>选择自己的周期、时间与疗程</small></span>${icon('chevron')}</button>`:''}<p class="home-alarm-help">时段开关控制提醒；独立时间显示在药品下方</p><div class="day-plan">${plan.map(group=>`<section class="period-group" aria-labelledby="period-${group.slot}"><header class="period-header"><span class="period-icon">${icon(group.slot)}</span><h2 id="period-${group.slot}">${slotNames[group.slot]}</h2><span class="period-progress" aria-label="${group.medications.length?`已记录 ${group.medications.filter(i=>i.record).length} 项，共 ${group.medications.length} 项`:'无安排'}">${group.medications.length?`${group.medications.filter(i=>i.record).length}/${group.medications.length}`:'无安排'}</span>${alarmButton(group.slot)}</header>${group.medications.length?group.medications.slice().sort((a,b)=>(a.medication.schedule.times[group.slot] || alarmSettings[group.slot].time).localeCompare(b.medication.schedule.times[group.slot] || alarmSettings[group.slot].time)).map(item=>planRow(item,group.slot,records)).join(''):'<p class="period-empty">这个时段没有安排药品</p>'}</section>`).join('')}</div><div class="supplement-line"><button class="text-button" id="supplement-button" ${storageBlocked || !data.medications.length?'disabled':''}>${icon('clock')}<span>补记用药</span></button></div></section><section aria-labelledby="timeline-heading"><div class="section-title"><h2 id="timeline-heading">今日时间线</h2>${records.length?`<span>${records.length} 条</span>`:''}</div>${records.length?timeline(records):`<div class="empty-state">${icon('clock')}<p>今天还没有记录</p><small>用药后，轻点「记录」</small></div>`}${skipTimeline(data.skips.filter(r=>r.day===S.localDay(new Date())))}</section>`;
  }
  function renderStats() {
    const stats = S.getMedicationStats(data).map((item, order) => ({...item, order})).sort((a, b) => b.count - a.count || a.order - b.order);
    const shown = statsExpanded ? stats : stats.slice(0, 4);
    return `<section class="med-stats" aria-labelledby="stats-heading"><header><h2 id="stats-heading">累计用药次数</h2><span>共 <strong>${data.records.length}</strong> 次</span></header><p class="stats-helper">每条记录计 1 次，累计次数不受下方日期筛选影响</p><div class="stats-list">${shown.map(item => `<button class="stat-row ${filterMed === item.medicationId ? 'is-selected' : ''}" data-stat-med="${escape(item.medicationId)}" aria-label="查看${escape(medicineLabel(item))}的记录，累计${item.count}次"><span class="stat-name">${escape(medicineLabel(item))}<small>${item.lastTakenAt ? `最近 · ${fullDate(item.lastTakenAt)} ${time(item.lastTakenAt)} · ${item.lastDose?escape(S.getDoseLabel(item.lastDose)):'用量未填写'}` : '还没有记录'}</small></span><span class="stat-count"><strong>${item.count}</strong><small>次</small></span>${icon('chevron')}</button>`).join('')}</div>${stats.length > 4 ? `<button class="expand-stats" id="expand-stats" aria-expanded="${statsExpanded}">${statsExpanded ? '收起' : `查看全部 ${stats.length} 种药品`}</button>` : ''}</section>`;
  }
  function renderHistory() {
    const records=sortRecords(data.records).filter(r=>(!filterMed || r.medicationId===filterMed) && (!filterDate || S.localDay(r.takenAt)===filterDate));
    const skips=data.skips.filter(r=>(!filterMed || r.medicationId===filterMed) && (!filterDate || r.day===filterDate));
    const days=[...new Set(records.map(r=>S.localDay(r.takenAt)).concat(skips.map(r=>r.day)))].sort().reverse();
    return `<section class="page-heading"><h1>记录</h1><p>每一次用药，都有迹可循</p></section>${renderStats()}${weeklyOverview()}<div class="section-title history-detail-title"><h2>用药与跳过明细</h2><button class="text-button" id="history-supplement" ${!data.medications.length || storageBlocked?'disabled':''}>补记用药</button></div><div class="history-filters"><label><span class="filter-label">药品</span><select id="filter-med" aria-label="筛选药品"><option value="">全部药品</option>${data.medications.map(m=>`<option value="${escape(m.id)}" ${filterMed===m.id?'selected':''}>${escape(medicineLabel(m))}${m.status==='archived'?'（已归档）':''}</option>`).join('')}</select></label><label><span class="filter-label">日期</span><input type="date" id="filter-date" aria-label="筛选日期" value="${escape(filterDate)}" max="${S.localDay(new Date())}"></label></div><div class="filter-footer"><span>用药 ${records.length} 次 · 跳过 ${skips.length} 次</span>${filterMed || filterDate?'<button id="clear-filters">重置筛选</button>':'<span>按日期排列</span>'}</div>${days.length?days.map(day=>`<section class="history-day"><h2>${day}${day===S.localDay(new Date())?' · 今天':''}</h2>${timeline(records.filter(r=>S.localDay(r.takenAt)===day))}${skipTimeline(skips.filter(r=>r.day===day))}</section>`).join(''):'<div class="empty-state history-empty"><p>暂无符合条件的记录</p><small>没有记录不代表漏服，可按实际情况补记。</small></div>'}`;
  }
  function medicationResults() {
    if (medView!=='catalog') {
      const archived=medView==='archived', meds=data.medications.filter(m=>(m.status==='archived')===archived && (C.matchesMedication(m,medSearch) || medicineLabel(m).toLowerCase().includes(medSearch.toLowerCase())));
      return `<div class="med-results-heading"><span role="status">${medSearch?'找到':archived?'已归档':'已添加'} ${meds.length} 种药品</span>${archived?'':'<button id="add-med" class="text-button">手动添加</button>'}</div>${meds.length?`<div class="my-med-list">${meds.map(m=>`<article class="my-med-card"><div class="my-med-heading"><span class="med-symbol">${icon(m.icon)}</span><div><h2>${escape(m.name)}</h2>${m.strength || m.form?`<p class="med-strength">${escape([m.strength,m.form].filter(Boolean).join(' · '))}</p>`:''}<p>${escape(S.getScheduleLabel(m))}</p>${m.schedule.endDate && m.schedule.endDate<S.localDay(new Date())?'<p class="med-state-label">疗程已结束，不再提醒</p>':''}<p class="my-med-dose">${m.dose?`每次 ${escape(S.getDoseLabel(m.dose))}`:'每次用量未设置'}</p><p class="last-use">${escape(lastUseText(m.id))}</p></div></div><div class="my-med-actions"><button data-schedule="${escape(m.id)}" aria-label="设置${escape(m.name)}服药频率">设置安排</button><button data-dose="${escape(m.id)}" aria-label="设置${escape(m.name)}每次用量">设置用量</button><button data-rename="${escape(m.id)}" aria-label="查看${escape(m.name)}药品信息">药品信息</button></div></article>`).join('')}</div>`:`<div class="empty-state med-empty">${icon(archived?'clock':'search')}<p>${archived?'还没有归档药品':medSearch?'没有找到这款药品':'还没有添加药品'}</p><small>${archived?'归档后停止提醒，历史记录仍可查看':'搜索药品库或手动添加自己的药品'}</small>${archived?'':'<button id="search-catalog" class="secondary-button">去药品库搜索</button>'}</div>`}`;
    }
    const items=C.search(medSearch,medCategory);
    return `<div class="med-results-heading"><span role="status">${medSearch || medCategory?'找到':'共'} ${items.length} 种药品</span><button id="add-med" class="text-button">手动添加</button></div>${items.length?`<div class="catalog-list">${items.map(item=>{
      const added=C.findAdded(item,data.medications);
      return `<article class="catalog-row"><div><h2>${escape(item.name)}</h2><p>${escape(item.categoryName)}</p></div><button class="catalog-add ${added?'already-added':''}" ${added?`data-rename="${escape(added.id)}"`:`data-catalog-add="${escape(item.id)}"`} aria-label="${added?'管理':'添加'}${escape(item.name)}" ${storageBlocked?'disabled':''}>${icon(added?'check':'plus')}<span>${added?(added.status==='archived'?'已归档':'已添加'):'添加'}</span></button></article>`;
    }).join('')}</div>`:`<div class="empty-state med-empty">${icon('search')}<p>没有找到相关药品</p><small>换个关键词，或手动填写完整名称</small>${medCategory?'<button id="all-categories" class="secondary-button">查看全部类别</button>':''}</div>`}<p class="catalog-note">药品库仅用于名称查找。添加时请核对实际产品的药名、规格和剂型。</p>`;
  }
  function renderMedicines() {
    const archived=data.medications.filter(m=>m.status==='archived').length;
    return `<section class="page-heading"><h1>药品</h1><p>管理自己的用药与疗程</p></section><div class="med-view-tabs" role="group" aria-label="药品列表范围">${[['mine','我的药品',data.medications.length-archived],['catalog','药品库',C.items.length],['archived','已归档',archived]].map(([value,label,count])=>`<button data-med-view="${value}" class="${medView===value?'active':''}" aria-pressed="${medView===value}">${label} <span>${count}</span></button>`).join('')}</div><div class="med-search-box">${icon('search')}<input type="search" id="med-search" value="${escape(medSearch)}" placeholder="搜索药名、拼音或规格" aria-label="搜索药品" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="120"><button id="clear-med-search" aria-label="清空药品搜索" ${medSearch?'':'hidden'}>${icon('close')}</button></div>${medView==='catalog'?`<label class="catalog-filter"><span>药品分类</span><select id="med-category" aria-label="药品分类"><option value="">全部类别</option>${C.categories.map(category=>`<option value="${category.id}" ${medCategory===category.id?'selected':''}>${escape(category.name)}</option>`).join('')}</select></label>`:`<p class="mine-helper">${medView==='archived'?'归档药品停止提醒，保留全部历史记录':'在「药品信息」中修改规格、暂停安排或归档'}</p>`}<div id="med-results">${medicationResults()}</div>`;
  }
  function refreshMedicationResults() {
    const results = $('#med-results');
    if (!results) return;
    results.innerHTML = medicationResults();
    $('#clear-med-search').hidden = !medSearch;
  }
  function render() {
    syncAlarms();
    $('#main').innerHTML = tab === 'today' ? renderToday() : tab === 'history' ? renderHistory() : renderMedicines();
    document.querySelectorAll('[data-tab]').forEach(el => {
      const active = el.dataset.tab === tab;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
  }
  function switchTab(next) {
    tab = next; render(); window.scrollTo({top:0,behavior:'instant'}); $('#main').focus({preventScroll:true});
  }
  function closeModal() {
    closeMedicationTime(false);
    if (alarmPicker) { alarmPicker.destroy(); alarmPicker = null; }
    $('#dialog-root').innerHTML = ''; modal = null; document.body.style.overflow = '';
    $('.app-shell').inert=false; $('.app-shell').removeAttribute('aria-hidden');
    if ((previousFocus && previousFocus.isConnected)) previousFocus.focus({preventScroll:true});
    else $('#main').focus({preventScroll:true});
  }
  function sheet(title, body, context = {}) {
    closeMedicationTime(false);
    clearToast();
    if (alarmPicker) { alarmPicker.destroy(); alarmPicker = null; }
    if (!modal) previousFocus = document.activeElement;
    modal = context;
    $('#dialog-root').innerHTML = `<div class="modal-overlay"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><header class="sheet-header"><h2 id="sheet-title">${escape(title)}</h2><button class="icon-button close-button" data-close aria-label="关闭">${icon('close')}</button></header>${body}</section></div>`;
    document.body.style.overflow = 'hidden';
    $('.sheet').focus({preventScroll:true}); $('.app-shell').inert=true; $('.app-shell').setAttribute('aria-hidden','true');
    requestAnimationFrame(() => { const panel = $('.sheet'); if (panel) panel.focus({preventScroll:true}); });
  }
  function confirm(title, text, action, label = '确认', danger = false) {
    sheet(title, `<p class="confirm-copy">${escape(text)}</p><p class="form-error" id="form-error" role="alert" hidden></p><div class="button-row"><button class="secondary-button" data-close>取消</button><button class="${danger ? 'secondary-button load-warning' : 'primary-button'}" id="confirm-action">${escape(label)}</button></div>`, {type:'confirm',action});
  }
  function showError(error) {
    const field = $('#form-error');
    if (field) { field.textContent = error.message || String(error); field.hidden = false; }
    else toast(error.message || String(error), null, 4000);
  }
  function recordNow(id, slot = null, confirmed = false) {
    const med = data.medications.find(m => m.id === id);
    if (!med) return;
    const now = new Date();
    const recent = data.records.find(r => r.medicationId === id && Math.abs(now - new Date(r.takenAt)) < 60000);
    if (recent && !confirmed) {
      confirm('确认再次记录', `刚刚已记录过${med.name}。是否${slot ? '为' + slotNames[slot] : ''}再增加一条记录？`, () => recordNow(id, slot, true), '仍然记录');
      return;
    }
    try {
      commit(S.addRecord(data, {medicationId:id,takenAt:now.toISOString(),note:'',slot}), `已记录 ${med.name}${slot ? ' · ' + slotNames[slot] : ''} · ${time(now)}`);
      if (modal) closeModal();
    } catch (error) { showError(error); }
  }
  function recordForm(record) {
    if (!data.medications.length) { toast('请先添加自己的药品'); return; }
    const isEdit = Boolean(record);
    const selected = (record && record.medicationId) || data.medications[0].id;
    sheet(isEdit ? '编辑记录' : '补记用药', `<form id="record-form"><label class="form-field"><span>药品</span><select class="field-control" name="medicationId" required>${data.medications.map(m => `<option value="${escape(m.id)}" ${m.id === selected ? 'selected' : ''}>${escape(medicineLabel(m))}${m.status === 'archived' ? '（已归档）' : ''}</option>`).join('')}</select></label><label class="form-field"><span>用药时间</span><input class="field-control" name="takenAt" type="datetime-local" required value="${S.localDateTime(new Date((record && record.takenAt) || Date.now()))}" max="${S.localDateTime(new Date(Math.max(Date.now(), new Date((record && record.takenAt) || 0).getTime())))}" step="60"></label><label class="form-field"><span>备注 <small>选填</small></span><textarea class="field-control" name="note" maxlength="500" placeholder="例如：早餐后">${escape((record && record.note) || '')}</textarea></label><p class="form-error" id="form-error" role="alert" hidden></p><button class="primary-button" type="submit">${isEdit ? '保存修改' : '保存记录'}</button>${isEdit ? '<button type="button" class="danger-button" id="delete-record">删除这条记录</button>' : ''}</form>`, {type:'record',record});
    const slotField = document.createElement('label');
    slotField.className = 'form-field';
    slotField.innerHTML = `<span>用药时段</span><select class="field-control" name="slot"><option value="">不分时段（仅记录时间）</option>${slots.map(slot => `<option value="${slot}" ${record && record.slot === slot ? 'selected' : ''}>${slotNames[slot]}</option>`).join('')}</select>`;
    const noteField = $('#record-form [name="note"]').parentElement;
    noteField.parentElement.insertBefore(slotField, noteField);
    const dose = record ? record.dose : data.medications.find(m => m.id === selected).dose;
    noteField.insertAdjacentHTML('beforebegin', doseFields(dose, '本次用量') + '<p class="form-helper">仅保存到这次记录，不改变默认每次用量。留空表示未记录用量。</p>');
    updateDoseFields($('#record-form'));
  }
  function doseFields(dose, label) {
    const custom = dose && !S.doseUnits.includes(dose.unit);
    const unit = dose ? (custom ? 'custom' : dose.unit) : '';
    return `<fieldset class="dose-fields"><legend>${label}<small>选填</small></legend><div class="dose-input-row"><label class="form-field"><span>数量</span><input class="field-control" name="doseAmount" type="text" inputmode="decimal" autocomplete="off" maxlength="14" placeholder="如 1 或 0.5" value="${escape(dose ? dose.amount : '')}"></label><label class="form-field"><span>单位</span><select class="field-control" name="doseUnit"><option value="">选择单位</option>${S.doseUnits.map(value => `<option value="${value}" ${unit === value ? 'selected' : ''}>${value}</option>`).join('')}<option value="custom" ${custom ? 'selected' : ''}>自定义</option></select></label></div><label class="form-field dose-custom" data-dose-custom ${custom ? '' : 'hidden'}><span>自定义单位</span><input class="field-control" name="doseCustomUnit" maxlength="12" placeholder="填写单位" value="${escape(custom ? dose.unit : '')}" ${custom ? '' : 'disabled'}></label></fieldset>`;
  }
  function updateDoseFields(form, dose) {
    if (arguments.length > 1) {
      const custom = dose && !S.doseUnits.includes(dose.unit);
      form.elements.doseAmount.value = dose ? dose.amount : '';
      form.elements.doseUnit.value = dose ? (custom ? 'custom' : dose.unit) : '';
      form.elements.doseCustomUnit.value = custom ? dose.unit : '';
    }
    const custom = form.elements.doseUnit.value === 'custom';
    $('[data-dose-custom]',form).hidden = !custom;
    form.elements.doseCustomUnit.disabled = !custom;
  }
  function readDoseForm(form) {
    const amount = form.elements.doseAmount.value.trim();
    if (!amount) return null;
    const unit = form.elements.doseUnit.value;
    return {amount,unit:unit === 'custom' ? form.elements.doseCustomUnit.value.trim() : unit};
  }
  function doseForm(id) {
    const med = data.medications.find(m => m.id === id);
    if (!med) return;
    sheet('每次用量', `<p class="schedule-med-name">${escape(med.name)}</p><form id="dose-form">${doseFields(med.dose,'默认每次用量')}<p class="form-helper">填写你实际使用的数量和单位，之后记录时会自动带入。修改默认用量不会改变旧记录；数量留空可清除默认用量。</p><p class="form-error" id="form-error" role="alert" hidden></p><button type="submit" class="primary-button">保存用量</button></form>`, {type:'dose',id});
    updateDoseFields($('#dose-form'));
  }
  function assignRecord(id, slot) {
    const med = data.medications.find(m => m.id === id);
    const records = todayRecords().filter(r => r.medicationId === id && !r.slot);
    if (!med || !records.length) { render(); return; }
    sheet('关联已有记录', `<p class="confirm-copy">把${escape(med.name)}今天的哪条记录归到${slotNames[slot]}？</p><div class="setting-group">${records.map(r => `<button class="setting-row" data-assign-record="${escape(r.id)}"><span>${time(r.takenAt)}<small>${escape(r.note || '未分时段的用药记录')}</small></span>${icon('chevron')}</button>`).join('')}</div><p class="form-error" id="form-error" role="alert" hidden></p><button class="secondary-button" data-new-record="${escape(id)}" data-slot="${slot}">仍然新增一条记录</button>`, {type:'assign',slot});
  }
  function scheduleOverview() {
    const meds=data.medications.filter(m=>m.status!=='archived');
    sheet('用药安排', `<p class="form-helper">选择药品，设置周期、独立时间及疗程结束日期。</p><div class="setting-group">${meds.map(m=>`<button class="setting-row schedule-overview-row" data-schedule="${escape(m.id)}">${icon(m.icon)}<span>${escape(medicineLabel(m))}<small>${escape(S.getScheduleLabel(m))}</small></span>${icon('chevron')}</button>`).join('')}</div>${meds.length?'':'<p class="form-helper">暂无药品，请先添加自己的药品。</p><button class="primary-button" id="start-setup">添加药品</button>'}`, {type:'schedules'});
  }
  function scheduleForm(id, guided=false) {
    const med=data.medications.find(m=>m.id===id); if (!med) return;
    const schedule=med.schedule, custom=Object.keys(schedule.times).length>0, initial=guided && schedule.mode==='none';
    sheet(guided?'设置你的用药安排':'用药安排', `${guided?setupSteps(2):''}<p class="schedule-med-name">${escape(medicineLabel(med))}</p>${med.status!=='active'?`<p class="form-helper">该药${med.status==='archived'?'已归档':'已暂停'}，修改安排不会自动恢复提醒。</p>`:''}<form id="schedule-form"><label class="form-field"><span>重复周期</span><select class="field-control" name="mode" required>${initial?'<option value="" disabled selected>选择你的实际频率</option>':''}${[['none','不安排固定频率'],['daily','每天'],['interval','每隔几天'],['weekly','每周指定日期']].map(([value,label])=>`<option value="${value}" ${!initial && schedule.mode===value?'selected':''}>${label}</option>`).join('')}</select></label><div id="interval-fields"><label class="form-field"><span>每隔几天</span><input class="field-control" name="intervalDays" type="number" min="2" max="365" step="1" value="${schedule.intervalDays}" required></label></div><fieldset id="weekday-fields" class="choice-field"><legend>星期</legend><div class="weekday-options">${['一','二','三','四','五','六','日'].map((label,i)=>`<label class="choice-chip"><input type="checkbox" name="weekdays" value="${i+1}" ${schedule.weekdays.includes(i+1)?'checked':''}><span>周${label}</span></label>`).join('')}</div></fieldset><div id="active-schedule-fields"><fieldset class="choice-field"><legend>用药时段 <small>按实际安排选择</small></legend><div class="slot-options">${slots.map(slot=>`<label class="choice-chip slot-chip"><input type="checkbox" name="slots" value="${slot}" ${schedule.slots.includes(slot)?'checked':''}><span>${icon(slot)}${slotNames[slot]}</span></label>`).join('')}</div><p id="slot-count" class="form-helper" aria-live="polite"></p></fieldset><fieldset class="choice-field"><legend>提醒时间</legend><div class="timing-options"><label class="choice-chip"><input type="radio" name="timing" value="shared" ${custom?'':'checked'}><span>跟随时段默认时间</span></label><label class="choice-chip"><input type="radio" name="timing" value="custom" ${custom?'checked':''}><span>这款药使用独立时间</span></label></div></fieldset><div id="med-time-fields">${slots.map(slot=>`<div class="form-field med-time-row" data-med-time="${slot}"><span>${slotNames[slot]}</span><button type="button" class="field-control med-time-button" data-pick-med-time="${slot}" aria-haspopup="dialog" aria-label="设置${slotNames[slot]}独立时间，${schedule.times[slot] || alarmSettings[slot].time}"><span data-med-time-value>${schedule.times[slot] || alarmSettings[slot].time}</span>${icon('chevron')}</button><input type="hidden" name="time-${slot}" value="${schedule.times[slot] || alarmSettings[slot].time}"></div>`).join('')}</div><p class="form-helper" id="shared-times-hint"></p><p class="form-helper">首页时段开关控制该时段内的所有提醒；独立时间只改变这款药的时间。</p><div class="date-pair"><label class="form-field"><span>开始日期</span><input class="field-control" type="date" name="startDate" value="${schedule.mode==='none'?S.localDay(new Date()):schedule.startDate}" required></label><label class="form-field"><span>结束日期 <small>选填</small></span><input class="field-control" type="date" name="endDate" value="${schedule.endDate || ''}"></label></div><p class="form-helper">结束日期当天仍按计划安排，之后停止提醒并保留记录。留空表示暂不设结束日期。</p></div><p class="form-helper" id="no-schedule-hint">不生成固定安排，仍可通过「补记用药」记录。</p><p class="form-error" id="form-error" role="alert" hidden></p><button type="submit" class="primary-button">${guided?'保存并检查提醒':'保存安排'}</button></form>`, {type:'schedule',id,guided});
    updateScheduleForm();
  }
  function updateScheduleForm() {
    const form=$('#schedule-form'); if (!form) return;
    const mode=form.elements.mode.value, active=mode!=='' && mode!=='none';
    for (const [selector,visible] of [['#interval-fields',mode==='interval'],['#weekday-fields',mode==='weekly'],['#active-schedule-fields',active]]) {
      const field=$(selector); field.hidden=!visible; field.querySelectorAll('input').forEach(input=>{input.disabled=!visible;});
    }
    $('#no-schedule-hint').hidden=mode!=='none';
    const selected=[...form.querySelectorAll('[name="slots"]:checked')].map(input=>input.value), custom=form.elements.timing.value==='custom';
    $('#slot-count').textContent=selected.length?`每个安排用药的日期记录 ${selected.length} 次`:'请选择至少一个时段';
    form.querySelectorAll('[data-med-time]').forEach(row=>{const show=active && custom && selected.includes(row.dataset.medTime); row.hidden=!show; row.querySelector('input').disabled=!show; row.querySelector('button').disabled=!show;});
    $('#shared-times-hint').hidden=!active || custom;
    $('#shared-times-hint').textContent=selected.map(slot=>`${slotNames[slot]} ${alarmSettings[slot].time}`).join(' · ');
    form.elements.endDate.min=form.elements.startDate.value;
  }
  function openMedicationTime(slot) {
    if (!slots.includes(slot) || medTimeDialog) return;
    const form=$('#schedule-form'), field=form && form.elements['time-'+slot];
    const trigger=form && $(`[data-pick-med-time="${slot}"]`,form);
    if (!field || field.disabled || !trigger) return;
    const parent=form.closest('.sheet'), overlay=document.createElement('div');
    overlay.className='modal-overlay med-time-overlay';
    overlay.innerHTML=`<section class="sheet med-time-sheet" role="dialog" aria-modal="true" aria-labelledby="med-time-title" tabindex="-1"><header class="sheet-header"><h2 id="med-time-title">${slotNames[slot]}独立时间</h2><button type="button" class="icon-button close-button" data-med-time-cancel aria-label="关闭时间选择">${icon('close')}</button></header><div class="time-picker-caption"><span>选择提醒时间</span><small>24 小时制</small></div><div id="med-time-picker" class="time-picker" role="group" aria-label="独立提醒时间"></div><p class="time-picker-help" id="time-picker-help">小时、分钟分别上下滑动，中间高亮为选中时间</p><div class="button-row"><button type="button" class="secondary-button" data-med-time-cancel>取消</button><button type="button" class="primary-button" data-med-time-confirm>确定时间</button></div></section>`;
    $('#dialog-root').append(overlay);
    const panel=$('.sheet',overlay);
    medTimeDialog={slot,field,trigger,parent,overlay,panel,picker:window.MedTimePicker.mount($('#med-time-picker'),{value:field.value,onChange:()=>{}})};
    panel.focus({preventScroll:true}); parent.inert=true; parent.setAttribute('aria-hidden','true');
    requestAnimationFrame(()=>{if (medTimeDialog && medTimeDialog.panel===panel) panel.focus({preventScroll:true});});
  }
  function closeMedicationTime(apply) {
    if (!medTimeDialog) return;
    const current=medTimeDialog; medTimeDialog=null;
    if (apply) {
      const value=current.picker.value();
      current.field.value=value;
      $('[data-med-time-value]',current.trigger).textContent=value;
      current.trigger.setAttribute('aria-label',`设置${slotNames[current.slot]}独立时间，${value}`);
    }
    current.picker.destroy(); current.overlay.remove();
    current.parent.removeAttribute('aria-hidden'); current.parent.inert=false;
    if (current.trigger.isConnected) current.trigger.focus({preventScroll:true});
  }
  function settings() {
    sheet('设置', `<div class="setting-group"><button class="setting-row" id="alarm-settings">${icon('alarm')}<span>用药提醒<small>时段开关、系统授权与锁屏试响</small></span>${icon('chevron')}</button><button class="setting-row" id="schedule-settings">${icon('calendar')}<span>用药安排<small>周期、独立时间与疗程</small></span>${icon('chevron')}</button><button class="setting-row" id="manage-meds">${icon('pill')}<span>药品管理<small>添加药品、暂停与归档</small></span>${icon('chevron')}</button></div><div class="setting-group"><button class="setting-row" id="backup-settings">${icon('download')}<span>备份与恢复<small>${escape(backupStatusText())}</small></span>${icon('chevron')}</button><button class="setting-row" id="appearance-settings">${icon('settings')}<span>字体与显示<small>跟随系统字号 · ${preferences.largeText?'大字模式已开':'可开启大字模式'}</small></span>${icon('chevron')}</button></div><div class="setting-group"><button class="setting-row" id="about-app">${icon('info')}<span>关于药记<small>更新说明、反馈、隐私政策</small></span>${icon('chevron')}</button><button class="setting-row" id="sponsor-developer">${icon('heart')}<span>赞助开发者<small>通过爱发电自愿支持</small></span>${icon('chevron')}</button></div><p class="privacy-note">数据保存在这台设备上。卸载或清除数据前，请先保存备份。</p><p class="version-note">药记 1.8.1 · 记录每一次用药</p>`,{type:'settings'});
  }
  function sponsorDeveloper() {
    sheet('赞助开发者', `<div class="sponsor-intro"><span class="sponsor-icon">${icon('heart')}</span><h3>谢谢你支持药记</h3><p>如果药记帮到了你，欢迎在爱发电支持后续的开发、维护与改进。</p></div><div class="sponsor-platform"><strong>爱发电</strong><p>自愿赞助，不影响任何功能的使用。</p><p class="sponsor-url">${escape(SPONSOR_URL)}</p></div><button type="button" class="primary-button" data-external="sponsor">前往爱发电赞助</button><p class="sponsor-help">将在外部浏览器打开主页，金额与支付由你在爱发电选择和确认。药记不会附带用药记录。</p><button type="button" id="back-to-settings" class="secondary-button">返回设置</button>`, {type:'sponsor'});
  }
  function disclaimer() {
    sheet('免责声明', `<div class="disclaimer-copy"><section><h3>应用用途</h3><p>药记仅用于个人用药记录与辅助提醒，不提供诊断、处方或个体化治疗建议，不能替代医生、药师的专业指导。</p></section><section><h3>药品信息与用药安排</h3><p>药品库及营养补充品分类仅供查找名称，不代表推荐、安全性或适合长期使用。请按医嘱及产品说明核对药名、规格、用量、频率与疗程；不要仅凭本应用自行增减、停用或更换药物。</p></section><section><h3>记录准确性</h3><p>记录与设置由你填写，请核对数量、单位和时间。应用不计算推荐剂量，也不能判断你是否实际服药。</p></section><section><h3>提醒限制</h3><p>提醒依赖设备、系统权限、系统时间及后台状态，可能延迟或未触发。请勿将本应用作为唯一用药提醒方式。</p></section><section><h3>数据保管</h3><p>数据保存在当前设备。卸载、清除数据或设备损坏可能造成数据丢失，请定期导出备份并妥善保管。</p></section><p class="disclaimer-important">若身体不适或遇紧急情况，请及时寻求医疗帮助。本说明不免除或限制依法不能免除、限制的责任。</p></div><button type="button" id="back-to-settings" class="secondary-button">返回设置</button>`, {type:'disclaimer'});
  }
  function manageMeds() {
    closeModal(); medView = 'mine'; medSearch = ''; switchTab('medicines');
  }
  function medForm(id, options={}) {
    const med=data.medications.find(m=>m.id===id), entry=options.entry, guided=!med;
    sheet(med?'药品信息':'添加自己的药品', `${guided?setupSteps(1):''}<form id="med-form"><label class="form-field"><span>药品名称</span><input class="field-control" name="name" maxlength="60" required autocomplete="off" placeholder="填写实际使用的药品名称" value="${escape(med?med.name:entry?entry.name:'')}"></label><label class="form-field"><span>规格 <small>选填</small></span><input class="field-control" name="strength" maxlength="80" placeholder="如每片 10 mg，请核对包装" value="${escape(med?med.strength:'')}"></label><label class="form-field"><span>剂型 <small>选填</small></span><input class="field-control" name="form" maxlength="80" placeholder="如普通片、缓释片、口服液" value="${escape(med?med.form:'')}"></label>${guided?doseFields(null,'默认每次用量'):''}<p class="form-helper">按医嘱和实际产品填写。规格与每次用量分别记录，应用不推荐剂量。</p><p class="form-error" id="form-error" role="alert" hidden></p><button class="primary-button" type="submit">${guided?'保存并设置用药安排':'保存药品信息'}</button></form>${med?`<section class="medicine-lifecycle"><h3>安排与归档</h3><p>${med.status==='archived'?'已归档，提醒已停止，历史记录保留。':med.status==='paused'?'安排已暂停，保留原频率和历史记录。':'暂停或归档仅调整本应用的安排与提醒。'}</p>${med.status==='archived'?`<button class="secondary-button" data-med-status="paused" data-med-id="${escape(id)}">移回药品列表，保持暂停</button>`:`<button class="secondary-button" data-med-status="${med.status==='paused'?'active':'paused'}" data-med-id="${escape(id)}">${med.status==='paused'?'恢复安排':'暂停安排'}</button><button class="text-button lifecycle-archive" data-med-status="archived" data-med-id="${escape(id)}">归档药品</button>`}</section>`:''}`, {type:'med',id,guided,entry});
    if (guided) updateDoseFields($('#med-form'));
  }
  function saveFile(text, name, kind=null) {
    if (exportPending) throw new Error('请先完成正在保存的文件');
    if (window.MedtimeAndroid && typeof window.MedtimeAndroid.saveFile==='function') {
      exportPending=true;
      try {
        if (kind && window.MedtimeAndroid.exportBackup) window.MedtimeAndroid.exportBackup(text,name,kind);
        else window.MedtimeAndroid.saveFile(text,name,'application/json');
      } catch(error) { exportPending=false; throw error; }
      closeModal(); return;
    }
    const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    if (!kind) { toast('文件已生成，请保存下载文件'); return; }
    sheet('确认备份已保存',`<p class="confirm-copy">备份文件已生成。浏览器无法确认文件是否保存成功，请在下载列表中检查后再确认。</p><p class="form-helper">${escape(name)}</p><p class="form-error" id="form-error" role="alert" hidden></p><button class="primary-button" id="confirm-backup-saved">已确认文件保存成功</button><button class="secondary-button" data-close>尚未保存，先关闭</button>`,{type:'confirm-backup',kind});
  }
  async function importFile(file) {
    if (!file) return;
    if (file.size>32*1024*1024) { toast('备份文件过大，请选择小于 32 MB 的 JSON 文件'); return; }
    try {
      const text=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('文件读取失败'));reader.readAsText(file,'UTF-8');});
      if (B.isEncrypted(text)) decryptForm(text); else previewImport(text);
    } catch(error) { toast(`无法导入：${error.message}`,null,5000); }
  }

  function applyAppearance() {
    let scale=1;
    try { if ((window.MedtimeAndroid && window.MedtimeAndroid.getTextScale)) scale=Number(window.MedtimeAndroid.getTextScale()); } catch (_) {}
    if (!Number.isFinite(scale) || scale<0.5 || scale>5) scale=1;
    const effective=scale*(preferences.largeText?1.25:1);
    document.documentElement.style.fontSize=(16*effective)+'px';
    document.documentElement.classList.toggle('reading-large',effective>=1.3);
    document.documentElement.classList.toggle('large-text',preferences.largeText);
    window.dispatchEvent(new Event('medtime-layout-changed'));
  }
  function savePreferences(changes) {
    preferences=P.save({...preferences,...changes}); preferenceError='';
  }
  function rememberChange() {
    try { savePreferences({lastChangeAt:new Date().toISOString()}); }
    catch (_) { preferenceError='记录已保存，备份状态暂时无法更新。'; }
  }
  function markBackup(kind, at, method) {
    if (!['plain','encrypted'].includes(kind) || !Number.isFinite(at) || at<=0) return;
    savePreferences({lastBackupAt:new Date(at).toISOString(),lastBackupKind:kind,lastBackupMethod:method});
  }
  function syncBackupStatus() {
    try {
      if (!(window.MedtimeAndroid && window.MedtimeAndroid.getBackupStatus)) return;
      const status=JSON.parse(window.MedtimeAndroid.getBackupStatus());
      if (status.savedAt>(Date.parse(preferences.lastBackupAt)||0)) markBackup(status.kind,status.savedAt,'android');
    } catch (_) { preferenceError='备份状态暂时无法读取，请检查保存的文件。'; }
  }
  function backupStatusText() {
    if (!preferences.lastBackupAt) return '尚无成功备份记录';
    return `${fullDate(preferences.lastBackupAt)} ${time(preferences.lastBackupAt)} · ${preferences.lastBackupKind==='encrypted'?'加密':'普通'}备份${preferences.lastBackupMethod==='confirmed'?'（你已确认保存）':''}`;
  }
  function backupBanner() {
    if (!P.due(preferences,Boolean(data.medications.length || data.records.length || data.skips.length))) return '';
    return `<div class="backup-notice"><span>${preferences.lastBackupAt?'该备份用药记录了':'给用药记录留一份备份'}<small>${preferences.lastBackupAt?'距离上次备份已超过 '+preferences.backupDays+' 天':'记录只存在这台设备上'}</small></span><button id="home-backup">去备份</button></div>`;
  }
  function backupSettings() {
    sheet('备份与恢复', `<section class="backup-status"><h3>上次成功备份</h3><p>${escape(backupStatusText())}</p>${preferences.lastChangeAt && preferences.lastBackupAt && preferences.lastChangeAt>preferences.lastBackupAt?'<p>备份后有记录或设置变更，建议再保存一份。</p>':''}${preferenceError?`<p role="alert">${escape(preferenceError)}</p>`:''}</section><div class="setting-group"><button class="setting-row" id="export-data">${icon('download')}<span>导出备份<small>可选择普通文件或密码加密</small></span>${icon('chevron')}</button><button class="setting-row" id="import-data">${icon('upload')}<span>从备份恢复<small>预览合并内容，再确认导入</small></span>${icon('chevron')}</button><button class="setting-row" id="restore-guide">${icon('info')}<span>换机恢复指南</span>${icon('chevron')}</button></div><label class="form-field"><span>备份提醒</span><select id="backup-days" class="field-control">${[[7,'每 7 天'],[14,'每 14 天'],[30,'每 30 天'],[0,'关闭提醒']].map(([value,label])=>`<option value="${value}" ${preferences.backupDays===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="form-helper">到期后在打开应用时提醒，不会自动生成备份或后台响铃。备份含药品、用量、安排、用药与跳过记录；系统授权和时段开关需在新手机上重新设置。</p><p class="form-error" id="form-error" role="alert" hidden></p><button class="secondary-button" id="back-to-settings">返回设置</button>`,{type:'backup'});
  }
  function exportForm() {
    if (exportPending) { toast('请先完成或取消正在保存的文件'); return; }
    if (storageBlocked) { saveFile(localStorage.getItem(S.STORAGE_KEY)||'',`药记原始数据-${S.localDay(new Date())}.json`); return; }
    sheet('导出备份', `<form id="backup-form"><label class="form-field"><span>备份方式</span><select class="field-control" name="backupKind"><option value="plain">普通 JSON 备份</option><option value="encrypted">密码加密备份</option></select></label><div id="backup-passwords" hidden><label class="form-field"><span>设置备份密码</span><input type="password" class="field-control" name="password" minlength="10" maxlength="128" autocomplete="new-password" disabled></label><label class="form-field"><span>再次输入密码</span><input type="password" class="field-control" name="passwordAgain" minlength="10" maxlength="128" autocomplete="new-password" disabled></label><p class="form-helper">使用 10–128 个字符。请另外保存密码，忘记密码无法恢复此文件；应用不会保存密码。加密保护导出文件，本机记录仍由应用存储保存。</p></div><p class="form-helper">普通备份可直接查看内容，请保存到自己控制的位置。加密备份恢复时需输入密码。</p><p class="form-error" id="form-error" role="alert" hidden></p><button class="primary-button" type="submit">生成并保存备份</button></form>`,{type:'export'});
  }
  async function exportSubmit(form) {
    const owner=modal, button=$('[type="submit"]',form), kind=form.elements.backupKind.value;
    let pass=form.elements.password.value, again=form.elements.passwordAgain.value;
    if (kind==='encrypted' && pass!==again) { showError(new Error('两次输入的密码不一致')); return; }
    button.disabled=true; button.textContent='正在生成…';
    try {
      let contents=S.exportData(data);
      if (kind==='encrypted') contents=await B.encrypt(contents,pass);
      if (modal!==owner) return;
      form.elements.password.value=''; form.elements.passwordAgain.value='';
      const name=`药记${kind==='encrypted'?'加密':''}备份-${S.localDay(new Date())}.json`;
      saveFile(contents,name,kind);
    } catch(error) { if (modal===owner) showError(error); }
    finally { pass=''; again=''; if (button.isConnected) { button.disabled=false; button.textContent='生成并保存备份'; } }
  }
  function restoreGuide() {
    sheet('换机恢复指南', `<ol class="guide-list"><li>在旧手机导出最新备份，确认文件已保存。加密备份请另外记住密码。</li><li>用你信任的方式把文件传到新手机，安装药记 1.8.0 或兼容的更新版本。</li><li>在欢迎页或「备份与恢复」选择文件，按需输入密码，核对预览后确认合并。</li><li>核对药品、用量和历史记录，再到「用药提醒」设置时段开关与默认时间，完成系统授权和锁屏试响。</li><li>新手机核对完成前，请保留旧手机数据与原备份。</li></ol><p class="form-helper">导入保留本机已有记录和已设信息。相同药品的同一天同一时段已有用药记录时，以用药记录为准，不再保留对应的跳过状态。</p><button class="primary-button" id="import-data">选择备份文件</button><button class="secondary-button" id="backup-settings">返回备份与恢复</button>`,{type:'restore-guide'});
  }
  function decryptForm(text) {
    sheet('解锁加密备份', `<form id="decrypt-form"><p class="form-helper">密码仅用于本机解密，不会保存或发送。</p><label class="form-field"><span>备份密码</span><input type="password" class="field-control" name="password" minlength="10" maxlength="128" autocomplete="off" required></label><p class="form-error" id="form-error" role="alert" hidden></p><button class="primary-button" type="submit">解锁并预览</button></form>`,{type:'decrypt',encrypted:text});
  }
  async function decryptSubmit(form) {
    const owner=modal, button=$('[type="submit"]',form);
    let pass=form.elements.password.value;
    button.disabled=true; button.textContent='正在解锁…';
    try {
      const plain=await B.decrypt(owner.encrypted,pass);
      if (modal!==owner) return;
      owner.encrypted=null; form.elements.password.value=''; previewImport(plain);
    } catch(error) { if (modal===owner) showError(error); }
    finally { pass=''; if (button.isConnected) { button.disabled=false; button.textContent='解锁并预览'; } }
  }
  function previewImport(text) {
    const next=S.importData(text,data);
    if (JSON.stringify(next)===JSON.stringify(data)) { closeModal(); toast('备份中的数据已存在，无需重复导入'); return; }
    const added=next.records.length-data.records.length, meds=next.medications.length-data.medications.length;
    const skips=next.skips.filter(r=>!data.skips.some(old=>old.id===r.id)).length;
    const cleared=data.skips.filter(r=>!next.skips.some(item=>item.id===r.id)).length;
    const updated=next.medications.filter(m=>{const old=data.medications.find(item=>item.id===m.id); return old && JSON.stringify(old)!==JSON.stringify(m);}).length;
    confirm('导入备份', `将添加 ${added} 条用药记录、${skips} 条跳过记录和 ${meds} 种药品，补全 ${updated} 种药品的信息或安排${cleared?`，清除 ${cleared} 条已有实际用药的跳过状态`:''}。保留本机已有记录、已设置的信息及暂停/归档状态。`,()=>{
      try {
        commit(S.importData(text,data),'备份已合并',false);
        sheet('恢复完成',`<p class="confirm-copy">已合并备份。请核对药品、用量和记录，再检查这台设备的提醒设置。</p><p class="form-helper">时段默认时间、开关和系统授权不会从备份恢复，独立时间随药品安排恢复。</p><button class="primary-button" id="alarm-settings">检查用药提醒</button><button class="secondary-button" data-close>完成</button>`,{type:'restored'});
      } catch(error) { showError(error); }
    },'确认导入');
  }
  function appearanceSettings() {
    sheet('字体与显示', `<label class="reading-choice"><input type="checkbox" id="large-text" ${preferences.largeText?'checked':''}><span>大字模式<small>在系统字号基础上再放大 25%</small></span></label><p class="form-helper">安卓安装版跟随系统字号；开启大字模式后，设置会保存在这台设备。按钮支持键盘操作，弹窗关闭后会返回原操作位置。</p><div class="reading-preview"><strong>记录每一次用药</strong><p>这里预览当前文字大小。</p><button type="button" class="primary-button" id="back-to-settings">返回设置</button></div><p class="form-error" id="form-error" role="alert" hidden></p>`,{type:'appearance'});
  }
  function latestUse(id) {
    return data.records.reduce((last,r)=>r.medicationId===id && (!last || r.takenAt>last.takenAt)?r:last,null);
  }
  function lastUseText(id) {
    const last=latestUse(id);
    return last?`上次用药 · ${fullDate(last.takenAt)} ${time(last.takenAt)} · ${last.dose?S.getDoseLabel(last.dose):'用量未填写'}`:'上次用药 · 暂无记录';
  }
  function skipForm(id, slot, existing) {
    const med=data.medications.find(m=>m.id===id); if (!med) return;
    sheet(existing?'查看跳过记录':'本次跳过', `<p class="schedule-med-name">${escape(existing?existing.medicationName:med.name)} · ${slotNames[slot]}</p><form id="skip-form"><label class="form-field"><span>跳过原因</span><textarea class="field-control" name="reason" maxlength="200" required placeholder="按实际情况填写">${escape((existing && existing.reason) || '')}</textarea></label><p class="form-helper">仅标记 ${escape((existing && existing.day) || S.localDay(new Date()))} 的${slotNames[slot]}安排，不计入用药次数，也不代表建议停药。此时段不再提醒。</p><p class="form-error" id="form-error" role="alert" hidden></p><button type="submit" class="primary-button">${existing?'保存原因':'确认本次跳过'}</button>${existing?'<button type="button" class="danger-button" id="delete-skip">撤销这次跳过</button>':''}</form>`,{type:'skip',id,slot,day:S.localDay(new Date()),skip:existing});
  }
  function skipTimeline(skips) {
    return `<div class="skip-list">${skips.map(r=>`<article class="skip-entry"><div><strong>${escape(r.medicationName)}</strong><p>${slotNames[r.slot]} · 已跳过</p><p>${escape(r.reason)}</p>${r.medicationStrength || r.medicationForm?`<p>${escape([r.medicationStrength,r.medicationForm].filter(Boolean).join(' · '))}</p>`:''}</div><button class="icon-button" data-edit-skip="${escape(r.id)}" aria-label="查看${escape(r.medicationName)}${r.day}${slotNames[r.slot]}的跳过原因">${icon('more')}</button></article>`).join('')}</div>`;
  }
  function weeklyOverview() {
    const days=S.getWeekSummary(data,new Date(),filterMed);
    return `<section class="week-summary"><h2>近 7 天记录</h2><p>${filterMed?'当前药品':'全部药品'} · 按保存的记录汇总，不推断漏服</p><table><thead><tr><th scope="col">日期</th><th scope="col">用药次数</th><th scope="col">跳过次数</th></tr></thead><tbody>${days.map(day=>`<tr><th scope="row"><button data-week-day="${day.day}" aria-label="查看${day.day}的记录">${day.day.slice(5).replace('-','/')} ${day.day===S.localDay(new Date())?'今天':''}</button></th><td>${day.records}</td><td>${day.skips}</td></tr>`).join('')}</tbody></table></section>`;
  }
  function aboutApp() {
    sheet('关于药记', `<p class="app-version">药记 1.8.1</p><p class="form-helper">离线用药记录与辅助提醒。</p><div class="setting-group"><button class="setting-row" id="release-notes"><span>版本更新说明</span>${icon('chevron')}</button><button class="setting-row" id="feedback"><span>问题反馈</span>${icon('chevron')}</button><button class="setting-row" id="privacy-policy"><span>隐私政策</span>${icon('chevron')}</button><button class="setting-row" id="disclaimer-button"><span>免责声明</span>${icon('chevron')}</button></div><button class="secondary-button" id="back-to-settings">返回设置</button>`,{type:'about'});
  }
  function releaseNotes() {
    sheet('版本更新说明', `<div class="document-copy"><h3>1.8.1 · 2026-09-12</h3><ul><li>赞助开发者接入爱发电，点击后在外部浏览器打开主页。</li><li>赞助完全自愿，不影响功能使用；同步更新隐私说明。</li></ul><h3>1.8.0 · 2026-09-11</h3><ul><li>显示上次用药时间与用量，新增本次跳过及原因、近 7 天记录概览。</li><li>新增成功备份时间、定期提醒、密码加密备份与换机恢复指南。</li><li>跟随系统字号，新增大字模式，扩大点击区域并改善弹窗焦点。</li><li>新增更新说明、问题反馈和独立隐私政策。</li></ul><h3>1.7.1</h3><p>提醒通知保留停止响铃、打开药记两个按钮。独立时间使用弹出的小时／分钟双列滑动选择器。</p><h3>1.7.0</h3><p>空药品列表与首次引导；新增规格剂型、独立时间、睡前、疗程、暂停归档及锁屏试响。</p></div><button class="primary-button" data-external="updates">在浏览器查看项目与新版</button><button class="secondary-button" id="about-app">返回关于</button>`,{type:'release-notes'});
  }
  function feedback() {
    sheet('问题反馈', `<p class="form-helper">通过 GitHub 提交反馈，需要你在浏览器中登录并发送。反馈可能公开，请勿附上用药备份、密码或身份信息。</p><label class="form-field"><span>可复制以下模板并按需填写</span><textarea class="field-control feedback-template" readonly>药记版本：1.8.1\n手机型号与安卓版本：\n发生问题的操作步骤：\n预期结果：\n实际结果：</textarea></label><button class="primary-button" data-external="feedback">打开 GitHub 反馈页面</button><button class="secondary-button" id="about-app">返回关于</button>`,{type:'feedback'});
  }
  function privacyPolicy() {
    sheet('隐私政策', `<div class="document-copy"><p>适用版本：药记 1.8.1 · 更新日期：2026-09-12</p><h3>维护与联系</h3><p>项目由 GitHub 账号 1841175465li-byte 维护。问题可通过「关于药记 → 问题反馈」联系。</p><h3>在本机处理的数据</h3><p>药名、规格、剂型、用量、安排、用药时间、备注和跳过原因保存在本机。应用也保存提醒配置、试响结果、显示偏好和备份时间。</p><h3>收集与共享</h3><p>应用没有账号、广告或统计 SDK，没有联网权限，不向开发者服务器上传用药数据。原生提醒只读取排程所需信息；通知在锁屏上按系统设置隐藏敏感内容。</p><h3>备份</h3><p>仅在你导出或导入时通过系统文件选择器读写所选文件。普通 JSON 可直接阅读；加密备份使用你设置的密码，密码不保存在应用中，无法找回。系统文件选择器中选择的云盘按对应服务的规则处理文件。</p><h3>权限</h3><p>通知和准时闹钟用于提醒；开机接收用于重新排程；前台播放、唤醒锁和振动用于有限时长响铃。应用不读取联系人、位置、相机或麦克风。</p><h3>保存与删除</h3><p>数据一直保存在本机，直到你删除相关记录、清除应用数据或卸载。归档药品会保留历史。应用关闭系统自动备份；导出的文件需你在保存位置自行删除。</p><h3>外部页面与变更</h3><p>仅在你点开项目、反馈或赞助时，使用外部浏览器访问 GitHub 或爱发电，适用对应平台的隐私规则。不会自动附加用药记录或设备诊断信息。赞助由你在爱发电选择和确认，药记不读取或保存支付账号、交易信息或赞助状态。本政策随版本更新，可在应用内和项目仓库查看。</p></div><button class="secondary-button" id="about-app">返回关于</button>`,{type:'privacy'});
  }
  function openExternal(kind) {
    const urls={updates:'https://github.com/1841175465li-byte/medtime',feedback:'https://github.com/1841175465li-byte/medtime/issues/new',sponsor:SPONSOR_URL};
    if (!urls[kind]) return;
    if ((window.MedtimeAndroid && window.MedtimeAndroid.openExternal)) window.MedtimeAndroid.openExternal(kind);
    else window.open(urls[kind],'_blank','noopener,noreferrer');
  }

  function medicineLabel(med) {
    return [med.name, med.strength, med.form].filter(Boolean).join(' · ');
  }
  function setupSteps(step) {
    return `<ol class="setup-steps" aria-label="设置进度">${['药品信息','用药安排','开启提醒'].map((label,i) => `<li class="${i+1===step?'current':i+1<step?'done':''}" ${i+1===step?'aria-current="step"':''}><span>${i+1<step?'✓':i+1}</span>${label}</li>`).join('')}</ol>`;
  }
  function welcome() {
    return `<section class="page-heading"><h1>从你的药品开始</h1><p>按自己的安排，记录每一次用药</p></section><section class="welcome-card">${icon('pill')}<h2>添加第一种药品</h2><p>核对药名、规格与用量，再设置适合你的提醒时间。</p><ol class="welcome-list"><li><strong>添加自己的药品</strong><span>搜索药品库，也可以手动填写</span></li><li><strong>设置周期与时间</strong><span>支持早、中、晚、睡前和独立时间</span></li><li><strong>检查并开启提醒</strong><span>在安卓手机上完成授权和锁屏试响</span></li></ol><button class="primary-button" id="start-setup" ${storageBlocked?'disabled':''}>添加我的药品</button><button class="text-button" id="import-data" ${storageBlocked?'disabled':''}>已有备份？恢复用药记录</button></section><p class="welcome-note">无需账号，数据保存在本机。药品、用量与频率由你填写。</p>`;
  }
  function alarmTestStatus() {
    if (!nativeAlarm.supported) return '';
    const result = nativeAlarm.testResult;
    if (nativeAlarm.testScheduled) return `<div class="test-result pending"><strong>锁屏试响已安排 · ${time(nativeAlarm.testScheduled)}</strong><p>请回到手机桌面并锁屏，等待约 1 分钟。返回这里确认结果。</p><button class="text-button" type="button" id="cancel-test">取消这次测试</button></div>`;
    if (result === 'awaiting') return `<div class="test-result"><strong>系统已触发本次测试</strong><p>计划 ${time(nativeAlarm.testPlanned)} · 实际触发 ${time(nativeAlarm.testTriggered)}。${nativeAlarm.testAudioStarted?'播放程序已启动，请确认手机是否实际出声。':'请确认是否听到铃声；若没有，请检查音量和后台设置。'}</p><div class="button-row"><button class="secondary-button" type="button" data-test-heard="yes">已听到响铃</button><button class="secondary-button" type="button" data-test-heard="no">没有听到</button></div></div>`;
    const messages = {heard:'你已确认本次锁屏试响成功',unheard:'你反馈本次没有听到铃声，请检查上方设置后重试',cancelled:'上次测试已取消或未及时触发，可重新测试',interrupted:'测试遇到正式用药提醒，已让正式提醒优先，请重新测试'};
    return messages[result]?`<div class="test-result ${result==='heard'?'success':'pending'}"><strong>${messages[result]}</strong><p>${result==='heard'?'这只记录本次结果。重启、调整权限或省电设置后，建议再次测试。':'测试不增加用药记录。'}</p></div>`:'';
  }
  function alarmTestPanel() {
    const supported=nativeAlarm.supported;
    return `<section class="alarm-test-panel"><h3>在这台手机上检查提醒</h3><p class="form-helper">先试听铃声，再安排一次锁屏试响。试响约 5 秒，不会新增用药记录。</p><div class="button-row"><button class="secondary-button" type="button" id="test-alarm" ${supported?'':'disabled'}>立即试听（5 秒）</button><button class="secondary-button" type="button" id="schedule-test" ${supported?'':'disabled'}>1 分钟后锁屏试响</button></div><div id="alarm-test-status">${alarmTestStatus()}</div><div class="button-row"><button class="secondary-button" type="button" id="stop-alarm" ${supported?'':'disabled'}>停止响铃</button></div></section>`;
  }
  function reminderGuideState(id) {
    const med=data.medications.find(m=>m.id===id); if (!med) return '';
    const chosen=med.schedule.slots, enabled=chosen.length && chosen.every(slot=>alarmSettings[slot].enabled);
    if (!chosen.length) return '<p>已保存药品信息，本药不安排固定提醒。</p>';
    return `<strong>${enabled?(nativeAlarm.ready?'安排与提醒已保存':'安排已保存，提醒待就绪'):'安排已保存，提醒尚未开启'}</strong><p>${chosen.map(slot=>`${slotNames[slot]} ${med.schedule.times[slot] || alarmSettings[slot].time}`).join(' · ')}</p>${enabled?'':`<button class="primary-button" id="enable-med-reminders">开启上述时段提醒</button><p class="form-helper">将同时开启这些时段中其他药品的有效安排。</p>`}`;
  }
  function reminderSetup(id) {
    const med=data.medications.find(m=>m.id===id); if (!med) return;
    sheet('检查并开启提醒', `${setupSteps(3)}<p class="schedule-med-name">${escape(medicineLabel(med))}</p><div class="reminder-guide-state" id="reminder-guide-state">${reminderGuideState(id)}</div><div id="alarm-system-status">${alarmSystemStatus()}</div>${med.schedule.slots.length?alarmTestPanel():''}<p class="form-error" id="form-error" role="alert" hidden></p><button class="primary-button" type="button" id="finish-setup">完成设置，查看今日安排</button><p class="form-helper">关闭页面会保留已保存的药品与安排。提醒关闭或未授权时不会定时响铃。</p>`, {type:'reminder-setup',id});
  }
  function changeMedicationStatus(id, status) {
    const med=data.medications.find(m=>m.id===id); if (!med) return;
    const action=status==='archived'?'归档药品':status==='active'?'恢复安排':med.status==='archived'?'移回药品列表':'暂停安排';
    const message=status==='active'?'恢复后按已保存的频率、疗程和时段开关提醒。':status==='archived'?'该药会移到「已归档」，停止提醒并保留全部记录。':'停止这款药的安排与提醒，保留频率、用量和历史记录。';
    confirm(action, `${medicineLabel(med)}：${message}`, ()=>{
      try { commit(S.setMedicationStatus(data,id,status),action+'已保存',false); closeModal(); medView=status==='archived'?'archived':'mine'; medSearch=''; switchTab('medicines'); }
      catch(error) { showError(error); }
    },action);
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button,a');
    if (event.target.classList.contains('med-time-overlay')) { closeMedicationTime(false); return; }
    if (event.target.classList.contains('modal-overlay')) { closeModal(); return; }
    if (!target) return;
    if (target.hasAttribute('data-med-time-cancel')) { closeMedicationTime(false); return; }
    if (target.hasAttribute('data-med-time-confirm')) { closeMedicationTime(true); return; }
    if (target.dataset.pickMedTime) { openMedicationTime(target.dataset.pickMedTime); return; }
    if (target.matches('.brand')) { event.preventDefault(); switchTab('today'); return; }
    if (target.hasAttribute('data-close')) { closeModal(); return; }
    if (target.dataset.tab) { switchTab(target.dataset.tab); return; }
    if (target.dataset.alarmToggle) { toggleAlarm(target.dataset.alarmToggle); return; }
    if (target.dataset.alarm) { alarmForm(target.dataset.alarm); return; }
    if (target.dataset.alarmAccess) {
      const bridge = alarmBridge();
      if (bridge) bridge.requestAlarmAccess(target.dataset.alarmAccess);
      return;
    }
    if (target.dataset.medView) { medView = target.dataset.medView; render(); return; }
    if (target.dataset.statMed) {
      filterMed = target.dataset.statMed; render();
      $('.history-detail-title').scrollIntoView({block:'start'}); return;
    }
    if (target.dataset.medStatus) { changeMedicationStatus(target.dataset.medId,target.dataset.medStatus); return; }
    if (target.dataset.testHeard) {
      try {
        const result=JSON.parse(alarmBridge().confirmAlarmTest(target.dataset.testHeard==='yes'));
        if (!result.ok) throw new Error(result.error || '测试结果保存失败');
        refreshAlarmStatus();
      } catch (error) { showError(error); }
      return;
    }
    if (target.dataset.catalogAdd) {
      const entry = C.items.find(item => item.id === target.dataset.catalogAdd);
      if (!entry || C.findAdded(entry, data.medications)) return;
      try { medForm(null,{entry}); }
      catch (error) { showError(error); }
      return;
    }
    if (target.dataset.external) { openExternal(target.dataset.external); return; }
    if (target.dataset.skip) { skipForm(target.dataset.skip,target.dataset.slot); return; }
    if (target.dataset.editSkip) { const r=data.skips.find(r=>r.id===target.dataset.editSkip); if(r) skipForm(r.medicationId,r.slot,r); return; }
    if (target.dataset.weekDay) { filterDate=target.dataset.weekDay; render(); $('.history-detail-title').scrollIntoView({block:'start'}); return; }
    if (target.dataset.record) { recordNow(target.dataset.record, target.dataset.slot || null); return; }
    if (target.dataset.edit) { recordForm(data.records.find(r => r.id === target.dataset.edit)); return; }
    if (target.dataset.rename) { medForm(target.dataset.rename); return; }
    if (target.dataset.schedule) { scheduleForm(target.dataset.schedule); return; }
    if (target.dataset.dose) { doseForm(target.dataset.dose); return; }
    if (target.dataset.assign) { assignRecord(target.dataset.assign, target.dataset.slot); return; }
    if (target.dataset.newRecord) { recordNow(target.dataset.newRecord, target.dataset.slot); return; }
    if (target.dataset.assignRecord) {
      const record = data.records.find(r => r.id === target.dataset.assignRecord);
      if (record && modal && modal.type === 'assign') {
        try { commit(S.updateRecord(data, record.id, {medicationId:record.medicationId,takenAt:record.takenAt,note:record.note,slot:modal.slot}), '记录已关联到' + slotNames[modal.slot]); closeModal(); }
        catch (error) { showError(error); }
      }
      return;
    }
    switch (target.id) {
      case 'home-backup': case 'backup-settings': backupSettings(); break;
      case 'restore-guide': restoreGuide(); break;
      case 'appearance-settings': appearanceSettings(); break;
      case 'about-app': aboutApp(); break;
      case 'release-notes': releaseNotes(); break;
      case 'feedback': feedback(); break;
      case 'privacy-policy': privacyPolicy(); break;
      case 'confirm-backup-saved': try { markBackup(modal.kind,Date.now(),'confirmed'); backupSettings(); render(); toast('已记录成功备份时间'); } catch(error) { showError(error); } break;
      case 'delete-skip': {
        const skip=modal.skip;
        confirm('撤销这次跳过？','撤销后，该时段恢复为未记录。只有尚未触发且时间未过的安排才会继续提醒。',()=>{try {commit(S.deleteSkip(data,skip.id),'已撤销跳过');closeModal();}catch(error){showError(error);}},'撤销跳过'); break;
      }
      case 'settings-button': settings(); break;
      case 'sponsor-developer': sponsorDeveloper(); break;
      case 'disclaimer-button': disclaimer(); break;
      case 'back-to-settings': settings(); break;
      case 'alarm-settings': alarmOverview(); break;
      case 'start-setup': closeModal(); medView='catalog'; medSearch=''; medCategory=''; switchTab('medicines'); break;
      case 'finish-setup': medView='mine'; medSearch=''; medCategory=''; closeModal(); switchTab('today'); break;
      case 'enable-med-reminders': {
        try {
          const id=modal.id, med=data.medications.find(m=>m.id===id), latest=R.load();
          if (JSON.stringify(latest)!==JSON.stringify(alarmSettings)) { alarmSettings=latest; throw new Error('提醒设置已更新，请重新打开设置'); }
          let next=latest;
          med.schedule.slots.forEach(slot=>{next=R.setAlarm(next,slot,true,next[slot].time);});
          alarmSettings=R.save(next); render(); reminderSetup(id);
        } catch (error) { showError(error); }
        break;
      }
      case 'schedule-test': {
        try {
          const result=JSON.parse(alarmBridge().scheduleAlarmTest());
          if (!result.ok) throw new Error(result.error || '锁屏试响未能安排');
          refreshAlarmStatus(); toast('已安排 1 分钟后试响，请回到桌面并锁屏',null,4000);
        } catch (error) { showError(error); }
        break;
      }
      case 'cancel-test': if (alarmBridge()) { alarmBridge().cancelAlarmTest(); refreshAlarmStatus(); } break;
      case 'reset-alarms':
        try { alarmSettings = R.save(R.defaults()); alarmError = ''; render(); toast('闹钟已重置为关闭，用药记录保留'); } catch (error) { showError(error); }
        break;
      case 'test-alarm': {
        const bridge = alarmBridge();
        if (!bridge) { toast('请在安卓安装版中测试响铃'); break; }
        try {
          const result = JSON.parse(bridge.testAlarm());
          if (!result.ok) throw new Error(result.error || '测试响铃未能启动');
          toast('开始测试响铃，约 5 秒后停止'); setTimeout(refreshAlarmStatus,250);
        } catch (error) { showError(error); }
        break;
      }
      case 'stop-alarm':
        if (alarmBridge()) { alarmBridge().stopAlarm(); toast('已停止响铃，用药记录未改变'); setTimeout(refreshAlarmStatus,250); }
        break;
      case 'home-schedule-settings': case 'schedule-settings': case 'setup-schedules': scheduleOverview(); break;
      case 'supplement-button': case 'history-supplement': recordForm(); break;
      case 'clear-filters': filterMed = ''; filterDate = ''; render(); break;
      case 'expand-stats': statsExpanded = !statsExpanded; render(); break;
      case 'search-catalog': medView = 'catalog'; medCategory = ''; render(); break;
      case 'all-categories': medCategory = ''; render(); break;
      case 'clear-med-search': medSearch = ''; $('#med-search').value = ''; refreshMedicationResults(); $('#med-search').focus(); break;
      case 'undo-button': if (undoAction) undoAction(); break;
      case 'confirm-action': if ((modal && modal.action)) { target.disabled = true; try { modal.action(); } finally { if (target.isConnected) target.disabled = false; } } break;
      case 'delete-record': {
        const record = modal.record;
        confirm('删除这条记录？', `${record.medicationName} · ${fullDate(record.takenAt)} ${time(record.takenAt)}`, () => {
          try { commit(S.deleteRecord(data, record.id), '记录已删除'); closeModal(); }
          catch (error) { showError(error); }
        }, '删除记录', true); break;
      }
      case 'manage-meds': manageMeds(); break;
      case 'add-med': medForm(); break;
      case 'export-data': try { exportForm(); } catch(error) { showError(error); } break;
      case 'import-data': $('#import-input').value = ''; $('#import-input').click(); break;
      case 'export-raw': try { saveFile(localStorage.getItem(S.STORAGE_KEY) || '', `药记原始数据-${S.localDay(new Date())}.json`); } catch (error) { toast('系统存储不可读取，请检查应用存储状态'); } break;
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'med-search') { medSearch = event.target.value; refreshMedicationResults(); }
  });
  document.addEventListener('change', event => {
    if (event.target.name==='backupKind') {
      const enabled=event.target.value==='encrypted'; $('#backup-passwords').hidden=!enabled;
      $('#backup-form').querySelectorAll('input[type="password"]').forEach(input=>{input.disabled=!enabled;input.required=enabled; if(!enabled) input.value='';});
    }
    if (event.target.id==='backup-days') { try {savePreferences({backupDays:Number(event.target.value)}); render(); toast('备份提醒已保存');} catch(error) {showError(error);} }
    if (event.target.id==='large-text') { try {savePreferences({largeText:event.target.checked});applyAppearance();} catch(error) {event.target.checked=preferences.largeText;showError(error);} }

    if (event.target.name === 'doseUnit') updateDoseFields(event.target.form);
    if (event.target.closest('#record-form') && event.target.name === 'medicationId') {
      const med = data.medications.find(m => m.id === event.target.value);
      const original = modal.record;
      updateDoseFields(event.target.form, original && original.medicationId === med.id ? original.dose : med.dose);
    }
    if (event.target.closest('#schedule-form')) updateScheduleForm();
    if (event.target.id === 'filter-med') { filterMed = event.target.value; render(); }
    if (event.target.id === 'filter-date') { filterDate = event.target.value; render(); }
    if (event.target.id === 'med-category') { medCategory = event.target.value; refreshMedicationResults(); }
    if (event.target.id === 'import-input') importFile((event.target.files && event.target.files[0]));
  });
  document.addEventListener('submit', event => {
    if (event.target.id==='backup-form') {event.preventDefault();exportSubmit(event.target);return;}
    if (event.target.id==='decrypt-form') {event.preventDefault();decryptSubmit(event.target);return;}
    if (event.target.id==='skip-form') {
      event.preventDefault();
      try {
        const context=modal, reason=event.target.elements.reason.value;
        commit(context.skip?S.updateSkip(data,context.skip.id,reason):S.addSkip(data,{medicationId:context.id,day:context.day,slot:context.slot,reason}),context.skip?'跳过原因已更新':'本次已跳过');closeModal();
      } catch(error) {showError(error);} return;
    }

    if (!['record-form','med-form','schedule-form','alarm-form','dose-form'].includes(event.target.id)) return;
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      if (event.target.id === 'alarm-form') {
        const slot = modal.slot, enabled = alarmSettings[slot].enabled;
        if (alarmPicker) event.target.elements.time.value = alarmPicker.value();
        saveAlarm(slot,enabled,event.target.elements.time.value);
        if (enabled && nativeAlarm.supported && !nativeAlarm.ready) {
          $('#alarm-system-status').innerHTML = alarmSystemStatus();
          $('#alarm-system-status').scrollIntoView({block:'nearest'});
          toast('时间已保存', null, 1000);
        } else {
          closeModal();
          toast('时间已保存', null, 1000);
        }
      } else if (event.target.id === 'record-form') {
        const when = new Date(form.get('takenAt'));
        if (!Number.isFinite(when.getTime())) throw new Error('请选择有效的用药时间');
        const record = modal.record;
        const fields = {medicationId:form.get('medicationId'),takenAt:when.toISOString(),note:form.get('note'),slot:form.get('slot') || null};
        // 编辑未更改分钟时，保留原记录的秒数，避免无意改变时间。
        fields.dose = readDoseForm(event.target);
        if (record && S.localDateTime(new Date(record.takenAt)) === form.get('takenAt')) fields.takenAt = record.takenAt;
        commit(record ? S.updateRecord(data, record.id, fields) : S.addRecord(data, fields), record ? '记录已修改' : '用药记录已保存');
        closeModal();
      } else if (event.target.id === 'dose-form') {
        const dose = readDoseForm(event.target);
        commit(S.setDose(data,modal.id,dose), dose ? '用量已保存' : '用量已清除', false);
        closeModal();
      } else if (event.target.id === 'schedule-form') {
        const schedule = {
          mode:form.get('mode'),slots:form.getAll('slots'),
          intervalDays:Number(form.get('intervalDays') || 2),
          startDate:form.get('startDate') || S.localDay(new Date()),
          weekdays:form.getAll('weekdays').map(Number),
          endDate:form.get('endDate') || null,
          times:Object.fromEntries(form.get('timing') === 'custom' ? form.getAll('slots').map(slot=>[slot,form.get('time-'+slot)]) : [])
        };
        const id=modal.id, guided=modal.guided;
        commit(S.setSchedule(data,id,schedule),schedule.mode==='none'?'已取消固定安排':'安排已保存',false);
        if (guided) reminderSetup(id); else closeModal();
      } else {
        const context=modal, details={name:form.get('name'),strength:form.get('strength'),form:form.get('form')};
        let next, id=context.id;
        if (id) next=S.setMedicationDetails(data,id,details);
        else if (context.entry) {
          const entry=context.entry;
          if (C.findAdded(entry,data.medications)) throw new Error('这款药已添加，请在列表中管理');
          next=S.addCatalogMedication(data,{id:entry.id,name:entry.name,icon:entry.icon}); id=entry.id;
          next=S.setMedicationDetails(next,id,details);
        } else {
          next=S.addMedication(data,details.name,details); id=next.medications[next.medications.length-1].id;
        }
        if (context.guided) next=S.setDose(next,id,readDoseForm(event.target));
        commit(next,'药品信息已保存',false);
        if (context.guided) scheduleForm(id,true); else closeModal();
      }
    } catch (error) { showError(error); }
  });
  document.addEventListener('keydown', event => {
    if (!modal) return;
    if (event.key === 'Escape' && medTimeDialog) { event.preventDefault(); closeMedicationTime(false); return; }
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const panel=medTimeDialog ? medTimeDialog.panel : $('.sheet');
      if (!panel) return;
      const focusable = [...panel.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]')].filter(el => !el.disabled && !el.hidden && el.tabIndex >= 0 && el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement) || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement) || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
    }
  });
  window.MedtimeNativeBack = () => {
    if (medTimeDialog) { closeMedicationTime(false); return true; }
    if (modal) { closeModal(); return true; }
    if (tab !== 'today') { switchTab('today'); return true; }
    return false;
  };
  window.MedtimeOpenAlarm = () => { closeModal(); switchTab('today'); refreshAlarmStatus(); };
  window.addEventListener('medtime-alarm-status', refreshAlarmStatus);
  window.addEventListener('medtime-text-scale',applyAppearance);
  window.addEventListener('medtime-export-result', event => {
    exportPending=false;
    const result=event.detail || {};
    if (result.ok) {
      try {markBackup(result.kind,Number(result.savedAt),'android'); render(); if(modal && modal.type==='backup') backupSettings(); toast('备份已保存');}
      catch(error) {toast('文件已保存，备份时间更新失败：'+error.message);}
    } else if (!result.cancelled) toast('备份未能保存，请重试');
    else toast('已取消保存，成功备份时间未改变');
  });
  window.addEventListener('storage', event => {
    if (event.key === S.STORAGE_KEY || event.key === R.STORAGE_KEY || event.key === P.KEY || event.key === null) { closeModal(); load(); render(); toast('记录与闹钟已和本地存储同步'); }
  });
  function refreshDay() {
    syncBackupStatus();
    const day = S.localDay(new Date());
    if (day !== observedDay) { observedDay = day; render(); }
    const dateInput = $('[name="takenAt"]');
    if (dateInput) dateInput.max = S.localDateTime(new Date(Math.max(Date.now(), new Date((modal && modal.record && modal.record.takenAt) || 0).getTime())));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDay(); });
  window.addEventListener('focus', refreshDay);
  setInterval(refreshDay, 30000);
  setInterval(() => { if (nativeAlarm.ringing || nativeAlarm.testScheduled || (modal && ['alarm','alarms','reminder-setup'].includes(modal.type))) refreshAlarmStatus(); },1000);
  load(); render();
})();
