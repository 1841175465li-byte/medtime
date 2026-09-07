/* 药记：完全离线的用药时间记录界面。 */
(() => {
  'use strict';
  const S = window.MedStore;
  const C = window.MedCatalog;
  const R = window.MedReminders;
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
  let toastTimer, undoAction = null, observedDay = S.localDay(new Date());
  const sortRecords = records => [...records].sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
  const time = value => new Date(value).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',hour12:false});
  const dateLabel = value => new Date(value).toLocaleDateString('zh-CN', {month:'long',day:'numeric',weekday:'long'});
  const fullDate = value => new Date(value).toLocaleDateString('zh-CN', {year:'numeric',month:'long',day:'numeric'});
  const todayRecords = () => sortRecords(data.records.filter(r => S.localDay(new Date(r.takenAt)) === S.localDay(new Date())));
  const slotNames = {morning:'早上',noon:'中午',evening:'晚上'};
  const slots = ['morning','noon','evening'];

  function load() {
    try { data = S.load(); storageBlocked = false; $('#storage-alert').hidden = true; }
    catch (err) {
      data = S.defaults(); storageBlocked = true;
      const alert = $('#storage-alert');
      alert.hidden = false;
      alert.innerHTML = '本地数据暂时无法读取，原始数据已保留。为防止覆盖，暂不能记录。请先导出原始数据保存。<button id="export-raw">导出原始数据</button>';
    }
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
    if (!nativeAlarm.supported) return '<p class="form-helper alarm-browser-note">定时响铃仅在安卓安装版中运行，网页可查看和保存设置。</p>';
    const next = slot && nativeAlarm.ready && alarmSettings[slot].enabled ? (nativeAlarm.scheduled || {})[slot] : null;
    const nextLine = next != null ? `<p class="form-helper alarm-next">${next ? `下次提醒 · ${fullDate(next)} ${time(next)}` : '目前没有待提醒安排，请先设置本时段的服药频率；已完成的安排会自动跳过。'}</p>` : '';
    return `<div class="alarm-permissions"><div><span>用药闹钟通知<small>显示提醒与停止响铃按钮</small></span>${nativeAlarm.notifications ? '<strong>已允许</strong>' : '<button type="button" data-alarm-access="notifications">允许通知</button>'}</div><div><span>准时闹钟<small>让锁屏和后台提醒按时触发</small></span>${nativeAlarm.exact ? '<strong>已允许</strong>' : '<button type="button" data-alarm-access="exact">允许准时闹钟</button>'}</div></div>${nextLine}${nativeAlarm.error ? `<p class="form-error">${escape(nativeAlarm.error)}</p>` : ''}`;
  }
  function alarmBanner() {
    if (alarmError) return `<div class="alarm-notice warning"><span>${escape(alarmError)}</span><button id="reset-alarms">重置闹钟</button></div>`;
    if (nativeAlarm.ringing) return `<div class="alarm-notice"><span>${nativeAlarm.error ? `闹钟提醒中：${escape(nativeAlarm.error)}` : '用药闹钟正在响铃'}</span><button id="stop-alarm">停止响铃</button></div>`;
    if (!slots.some(slot => alarmSettings[slot].enabled)) return '';
    const message = !nativeAlarm.supported ? '定时响铃需使用安卓安装版' : !nativeAlarm.ready ? (nativeAlarm.error || '闹钟已保存，等待系统授权') : '';
    return message ? `<div class="alarm-notice warning"><span>${escape(message)}</span><button id="alarm-settings">查看设置</button></div>` : '';
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
      const control = $(`[data-alarm-toggle="${slot}"]`);
      if (control) control.focus({preventScroll:true});
      toast(!enabled ? '闹钟已关闭' : nativeAlarm.supported && !nativeAlarm.ready ? '已开启，请完成授权' : '闹钟已开启', null, 1000);
    } catch (error) { showError(error); }
  }
  function alarmOverview() {
    sheet('早中晚闹钟', `<p class="form-helper">按早、中、晚分别设置时间。只有当天本时段有尚未记录的安排时才会响铃。</p><div class="setting-group">${slots.map(slot => `<button class="setting-row" data-alarm="${slot}">${icon(slot)}<span>${slotNames[slot]}<small>${alarmSettings[slot].enabled ? alarmSettings[slot].time : '未开启'}</small></span>${icon('chevron')}</button>`).join('')}</div><div id="alarm-system-status">${alarmSystemStatus()}</div><p class="form-helper">闹钟不会自动增加用药记录；未分时段的记录需先关联到早、中、晚。</p>`, {type:'alarms'});
  }
  function alarmForm(slot) {
    if (!slots.includes(slot)) return;
    const alarm = alarmSettings[slot];
    sheet(`${slotNames[slot]}闹钟`, `<form id="alarm-form"><p class="alarm-form-state">开关在首页 · 当前${alarm.enabled ? '已开启' : '已关闭'}</p><div class="alarm-time-field"><div class="time-picker-caption"><span id="time-picker-label">响铃时间</span><small>24 小时制</small></div><div id="alarm-time-picker" class="time-picker" role="group" aria-labelledby="time-picker-label"></div><input type="hidden" name="time" value="${alarm.time}"><p class="time-picker-help" id="time-picker-help">上下滑动选择，中间高亮为选中时间</p></div><p class="form-helper">仅提醒本时段尚未记录的安排；已完成或当天无安排时跳过。当日时间已过时，从下次安排开始。</p><p class="form-error" id="form-error" role="alert" hidden></p><button type="submit" class="primary-button">保存时间</button><div id="alarm-system-status" class="alarm-system-status">${alarmSystemStatus(slot)}</div><div class="button-row alarm-test-actions"><button class="secondary-button" type="button" id="test-alarm" ${nativeAlarm.supported ? '' : 'disabled'}>测试响铃（5 秒）</button><button class="secondary-button" type="button" id="stop-alarm" ${nativeAlarm.supported ? '' : 'disabled'}>停止响铃</button></div><p class="alarm-sound-note">使用系统闹钟铃声和音量，正常提醒最多响铃 1 分钟，也可从通知栏停止。开启后可先测试一次。</p></form>`, {type:'alarm',slot});
    const timeField = $('#alarm-form [name="time"]');
    alarmPicker = window.MedTimePicker.mount($('#alarm-time-picker'), {value:alarm.time,disabled:false,onChange:value => { timeField.value = value; }});
  }
  function refreshAlarmStatus() {
    const bridge = alarmBridge();
    if (!bridge) return;
    try { nativeAlarm = JSON.parse(bridge.getAlarmStatus()); } catch (error) { return; }
    const panel = $('#alarm-system-status');
    if (panel) panel.innerHTML = alarmSystemStatus();
    if (tab === 'today') $('#main').innerHTML = renderToday();
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
    S.save(next);
    const previous = data;
    data = next; render();
    if (message) toast(message, canUndo ? () => {
      if (data !== next) return;
      try {
        const current = S.load();
        if (JSON.stringify(current) !== JSON.stringify(next)) {
          data = current; render(); throw new Error('记录已在另一页面更新');
        }
        S.save(previous); data = previous; render(); toast('已撤销');
      }
      catch (err) { toast(`撤销失败：${err.message}`); }
    } : null, canUndo ? 4000 : 1000);
  }
  function timeline(records) {
    return `<div class="timeline-list">${records.map(r => `<article class="timeline-row"><time class="timeline-time" datetime="${escape(r.takenAt)}">${time(r.takenAt)}</time><div class="timeline-content"><strong>${escape(r.medicationName)}</strong><p class="record-slot">${r.slot ? slotNames[r.slot] : '未分时段'}${r.dose ? ` · ${escape(S.getDoseLabel(r.dose))}` : ''}</p>${r.note ? `<p>${escape(r.note)}</p>` : ''}</div><button class="icon-button row-menu" data-edit="${escape(r.id)}" aria-label="编辑${escape(r.medicationName)} ${time(r.takenAt)}的记录">${icon('more')}</button></article>`).join('')}</div>`;
  }
  function planRow(item, slot, records) {
    const med = item.medication, record = item.record;
    const unassigned = records.filter(r => r.medicationId === med.id && !r.slot);
    let action;
    if (record) action = `<button class="recorded-button" data-edit="${escape(record.id)}" aria-label="编辑${escape(med.name)}${slotNames[slot]}的记录">${icon('check')}<span>已记录<small>${time(record.takenAt)}</small></span></button>`;
    else if (unassigned.length) action = `<button class="assign-button" data-assign="${escape(med.id)}" data-slot="${slot}" aria-label="关联${escape(med.name)}${slotNames[slot]}的已有记录">关联记录</button>`;
    else action = `<button class="record-button" data-record="${escape(med.id)}" data-slot="${slot}" aria-label="记录${escape(med.name)}（${slotNames[slot]}）" ${storageBlocked ? 'disabled' : ''}>${icon('plus')}<span>记录</span></button>`;
    const dose = record ? record.dose : med.dose;
    return `<article class="plan-med ${record ? 'is-recorded' : ''}"><div class="plan-med-info"><h3>${escape(med.name)}</h3><p>${record ? '已记录本时段' : unassigned.length ? `今天有 ${unassigned.length} 条未分时段记录` : escape(S.getScheduleLabel(med))}</p>${dose ? `<p class="plan-dose">${record ? '本次' : '每次'} ${escape(S.getDoseLabel(dose))}</p>` : ''}</div>${action}</article>`;
  }
  function renderToday() {
    const records = todayRecords();
    const plan = S.getDayPlan(data, new Date());
    const total = plan.reduce((n, group) => n + group.medications.length, 0);
    const completed = plan.reduce((n, group) => n + group.medications.filter(item => item.record).length, 0);
    const unset = data.medications.filter(m => m.schedule.mode === 'none').length;
    return `<section class="page-heading"><h1>今天</h1><p>${dateLabel(new Date())}</p></section>
      <div class="summary"><strong>今日安排</strong><span>${total ? `已记录 ${completed} / ${total} 项` : '今天暂无安排'}</span></div>
      ${alarmBanner()}<section aria-labelledby="plan-heading"><div class="section-title plan-title"><h2 id="plan-heading">早 · 中 · 晚</h2><button class="text-button" id="home-schedule-settings">设置频率${icon('chevron')}</button></div>
      ${unset ? `<button class="setup-notice" id="setup-schedules"><span>${unset === data.medications.length ? '先设置服药频率' : `${unset} 种药品未设置频率`}<small>选择周期和时段，自动生成每日安排</small></span>${icon('chevron')}</button>` : ''}
      <p class="home-alarm-help">点时间调整闹钟，旁边开关可直接启停</p><div class="day-plan">${plan.map(group => `<section class="period-group" aria-labelledby="period-${group.slot}"><header class="period-header"><span class="period-icon">${icon(group.slot)}</span><h2 id="period-${group.slot}">${slotNames[group.slot]}</h2><span class="period-progress" aria-label="${group.medications.length ? `已记录 ${group.medications.filter(i => i.record).length} 项，共 ${group.medications.length} 项` : '无安排'}">${group.medications.length ? `${group.medications.filter(i => i.record).length}/${group.medications.length}` : '无安排'}</span>${alarmButton(group.slot)}</header>${group.medications.length ? group.medications.map(item => planRow(item, group.slot, records)).join('') : '<p class="period-empty">这个时段没有安排药品</p>'}</section>`).join('')}</div>
      <div class="supplement-line"><button class="text-button" id="supplement-button" ${storageBlocked ? 'disabled' : ''}>${icon('clock')}<span>补记用药</span></button></div></section>
      <section aria-labelledby="timeline-heading"><div class="section-title"><h2 id="timeline-heading">今日时间线</h2>${records.length ? `<span>${records.length} 条</span>` : ''}</div>${records.length ? timeline(records) : `<div class="empty-state">${icon('clock')}<p>今天还没有记录</p><small>用药后，轻点「记录」</small></div>`}</section>`;
  }
  function renderStats() {
    const stats = S.getMedicationStats(data).map((item, order) => ({...item, order})).sort((a, b) => b.count - a.count || a.order - b.order);
    const shown = statsExpanded ? stats : stats.slice(0, 4);
    return `<section class="med-stats" aria-labelledby="stats-heading"><header><h2 id="stats-heading">累计用药次数</h2><span>共 <strong>${data.records.length}</strong> 次</span></header><p class="stats-helper">每条记录计 1 次，累计次数不受下方日期筛选影响</p><div class="stats-list">${shown.map(item => `<button class="stat-row ${filterMed === item.medicationId ? 'is-selected' : ''}" data-stat-med="${escape(item.medicationId)}" aria-label="查看${escape(item.name)}的记录，累计${item.count}次"><span class="stat-name">${escape(item.name)}<small>${item.lastTakenAt ? `最近 · ${fullDate(item.lastTakenAt)} ${time(item.lastTakenAt)}` : '还没有记录'}</small></span><span class="stat-count"><strong>${item.count}</strong><small>次</small></span>${icon('chevron')}</button>`).join('')}</div>${stats.length > 4 ? `<button class="expand-stats" id="expand-stats" aria-expanded="${statsExpanded}">${statsExpanded ? '收起' : `查看全部 ${stats.length} 种药品`}</button>` : ''}</section>`;
  }
  function renderHistory() {
    let records = sortRecords(data.records).filter(r => (!filterMed || r.medicationId === filterMed) && (!filterDate || S.localDay(new Date(r.takenAt)) === filterDate));
    const groups = new Map();
    for (const record of records) {
      const key = S.localDay(new Date(record.takenAt));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    return `<section class="page-heading"><h1>记录</h1><p>每一次用药，都有迹可循</p></section>${renderStats()}
      <div class="section-title history-detail-title"><h2>用药明细</h2><button class="text-button" id="history-supplement">补记用药</button></div>
      <div class="history-filters"><label><span class="filter-label">药品</span><select id="filter-med" aria-label="筛选药品"><option value="">全部药品</option>${data.medications.map(m => `<option value="${escape(m.id)}" ${filterMed === m.id ? 'selected' : ''}>${escape(m.name)}</option>`).join('')}</select></label><label><span class="filter-label">日期</span><input type="date" id="filter-date" aria-label="筛选日期" value="${escape(filterDate)}" max="${S.localDay(new Date())}"></label></div>
      <div class="filter-footer"><span>${filterMed || filterDate ? '筛选结果' : '全部记录'} · ${records.length} 次</span>${filterMed || filterDate ? '<button id="clear-filters">重置筛选</button>' : '<span>按时间排列</span>'}</div>
      ${groups.size ? [...groups].map(([day, items]) => `<section class="history-day"><h2>${fullDate(items[0].takenAt)}${day === S.localDay(new Date()) ? ' · 今天' : ''}<span>${items.length} 条</span></h2>${timeline(items)}</section>`).join('') : `<div class="empty-state history-empty">${icon('clock')}<p>${data.records.length ? '没有符合条件的记录' : '还没有用药记录'}</p><small>${data.records.length ? '换个日期或药品试试' : '在首页记录一次，就会出现在这里'}</small></div>`}`;
  }
  function medicationResults() {
    if (medView === 'mine') {
      const meds = data.medications.filter(m => C.matchesMedication(m, medSearch));
      return `<div class="med-results-heading"><span role="status">${medSearch ? '找到' : '已添加'} ${meds.length} 种药品</span><button id="add-med" class="text-button">手动添加</button></div>${meds.length ? `<div class="my-med-list">${meds.map(m => `<article class="my-med-card"><div class="my-med-heading"><span class="small-med-symbol">${icon(m.icon)}</span><div><h2>${escape(m.name)}</h2><p>${escape(S.getScheduleLabel(m))}</p><p class="my-med-dose">${m.dose ? `每次 ${escape(S.getDoseLabel(m.dose))}` : '每次用量未设置'}</p></div></div><div class="my-med-actions"><button data-schedule="${escape(m.id)}" aria-label="设置${escape(m.name)}服药频率">设置频率</button><button data-dose="${escape(m.id)}" aria-label="设置${escape(m.name)}每次用量">设置用量</button><button data-rename="${escape(m.id)}" aria-label="修改${escape(m.name)}名称">改名</button></div></article>`).join('')}</div>` : `<div class="empty-state med-empty">${icon('search')}<p>我的药品中没有找到</p><small>试试药品库，或手动添加药名</small><button id="search-catalog" class="secondary-button">去药品库搜索</button></div>`}`;
    }
    const items = C.search(medSearch, medCategory);
    return `<div class="med-results-heading"><span role="status">${medSearch || medCategory ? '找到' : '共'} ${items.length} 种药品</span><button id="add-med" class="text-button">手动添加</button></div>${items.length ? `<div class="catalog-list">${items.map(item => {
      const added = C.findAdded(item, data.medications);
      return `<article class="catalog-row"><div><h2>${escape(item.name)}</h2><p>${escape(item.categoryName)}</p></div><button class="catalog-add ${added ? 'already-added' : ''}" data-catalog-add="${escape(item.id)}" aria-label="${added ? '已添加' : '添加'}${escape(item.name)}" ${added || storageBlocked ? 'disabled' : ''}>${icon(added ? 'check' : 'plus')}<span>${added ? '已添加' : '添加'}</span></button></article>`;
    }).join('')}</div>` : `<div class="empty-state med-empty">${icon('search')}<p>没有找到相关药品</p><small>换个关键词、类别，或手动添加药名</small>${medCategory ? '<button id="all-categories" class="secondary-button">查看全部类别</button>' : ''}</div>`}<p class="catalog-note">药品库包含药品与营养补充品，仅用于名称查找和记录。请按实际使用的产品选择；需要区分剂型或规格时，可手动添加完整名称。</p>`;
  }
  function renderMedicines() {
    return `<section class="page-heading"><h1>药品</h1><p>常用药品，随时查找</p></section><div class="med-view-tabs" role="group" aria-label="药品列表范围"><button data-med-view="mine" class="${medView === 'mine' ? 'active' : ''}" aria-pressed="${medView === 'mine'}">我的药品 <span>${data.medications.length}</span></button><button data-med-view="catalog" class="${medView === 'catalog' ? 'active' : ''}" aria-pressed="${medView === 'catalog'}">药品库 <span>${C.items.length}</span></button></div><div class="med-search-box">${icon('search')}<input type="search" id="med-search" value="${escape(medSearch)}" placeholder="搜索药名、拼音或首字母" aria-label="搜索药品" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="120"><button id="clear-med-search" aria-label="清空药品搜索" ${medSearch ? '' : 'hidden'}>${icon('close')}</button></div>${medView === 'catalog' ? `<label class="catalog-filter"><span>药品分类</span><select id="med-category" aria-label="药品分类"><option value="">全部类别</option>${C.categories.map(category => `<option value="${category.id}" ${medCategory === category.id ? 'selected' : ''}>${escape(category.name)}</option>`).join('')}</select></label>` : '<p class="mine-helper">点击「药品库」可搜索并添加更多常用药品</p>'}<div id="med-results">${medicationResults()}</div>`;
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
    tab = next; render(); window.scrollTo({top:0,behavior:'instant'});
  }
  function closeModal() {
    if (alarmPicker) { alarmPicker.destroy(); alarmPicker = null; }
    $('#dialog-root').innerHTML = ''; modal = null; document.body.style.overflow = '';
    if ((previousFocus && previousFocus.isConnected)) previousFocus.focus({preventScroll:true});
  }
  function sheet(title, body, context = {}) {
    clearToast();
    if (alarmPicker) { alarmPicker.destroy(); alarmPicker = null; }
    if (!modal) previousFocus = document.activeElement;
    modal = context;
    $('#dialog-root').innerHTML = `<div class="modal-overlay"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><header class="sheet-header"><h2 id="sheet-title">${escape(title)}</h2><button class="icon-button close-button" data-close aria-label="关闭">${icon('close')}</button></header>${body}</section></div>`;
    document.body.style.overflow = 'hidden';
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
    const isEdit = Boolean(record);
    const selected = (record && record.medicationId) || data.medications[0].id;
    sheet(isEdit ? '编辑记录' : '补记用药', `<form id="record-form"><label class="form-field"><span>药品</span><select class="field-control" name="medicationId" required>${data.medications.map(m => `<option value="${escape(m.id)}" ${m.id === selected ? 'selected' : ''}>${escape(m.name)}</option>`).join('')}</select></label><label class="form-field"><span>用药时间</span><input class="field-control" name="takenAt" type="datetime-local" required value="${S.localDateTime(new Date((record && record.takenAt) || Date.now()))}" max="${S.localDateTime(new Date(Math.max(Date.now(), new Date((record && record.takenAt) || 0).getTime())))}" step="60"></label><label class="form-field"><span>备注 <small>选填</small></span><textarea class="field-control" name="note" maxlength="500" placeholder="例如：早餐后">${escape((record && record.note) || '')}</textarea></label><p class="form-error" id="form-error" role="alert" hidden></p><button class="primary-button" type="submit">${isEdit ? '保存修改' : '保存记录'}</button>${isEdit ? '<button type="button" class="danger-button" id="delete-record">删除这条记录</button>' : ''}</form>`, {type:'record',record});
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
    sheet('服药频率', `<p class="form-helper">为每种药选择重复周期和时段，首页会显示当天安排。</p><div class="setting-group">${data.medications.map(m => `<button class="setting-row schedule-overview-row" data-schedule="${escape(m.id)}">${icon(m.icon)}<span>${escape(m.name)}<small>${escape(S.getScheduleLabel(m))}</small></span>${icon('chevron')}</button>`).join('')}</div><button class="secondary-button" id="manage-meds">管理药品</button>`, {type:'schedules'});
  }
  function scheduleForm(id) {
    const med = data.medications.find(m => m.id === id);
    if (!med) return;
    const schedule = med.schedule;
    const modes = [['none','不安排固定频率'],['daily','每天'],['interval','每隔几天'],['weekly','每周指定日期']];
    const weekLabels = ['一','二','三','四','五','六','日'];
    sheet('服药频率', `<p class="schedule-med-name">${escape(med.name)}</p><form id="schedule-form"><label class="form-field"><span>重复周期</span><select name="mode" class="field-control">${modes.map(([value,label]) => `<option value="${value}" ${schedule.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="form-field" id="interval-fields"><span>间隔天数</span><input class="field-control" type="number" name="intervalDays" min="2" max="365" step="1" value="${schedule.intervalDays}"><small class="inline-helper">2 表示隔天，3 表示每三天。</small></label><fieldset class="choice-field" id="weekday-fields"><legend>每周哪几天</legend><div class="weekday-options">${weekLabels.map((label,index) => `<label class="choice-chip"><input type="checkbox" name="weekdays" value="${index+1}" ${schedule.weekdays.includes(index+1) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset><div id="active-schedule-fields"><fieldset class="choice-field"><legend>用药时段 <small>可多选</small></legend><div class="slot-options">${slots.map(slot => `<label class="choice-chip slot-chip"><input type="checkbox" name="slots" value="${slot}" ${schedule.slots.includes(slot) ? 'checked' : ''}><span>${icon(slot)}${slotNames[slot]}</span></label>`).join('')}</div><p id="slot-count" class="form-helper" aria-live="polite"></p></fieldset><label class="form-field"><span>开始日期</span><input class="field-control" type="date" name="startDate" value="${schedule.mode === 'none' ? S.localDay(new Date()) : schedule.startDate}" required></label></div><p class="form-helper" id="no-schedule-hint">该药暂不出现在每日安排中，仍可手动记录。</p><p class="form-error" id="form-error" role="alert" hidden></p><button type="submit" class="primary-button">保存频率</button></form>`, {type:'schedule',id});
    updateScheduleForm();
  }
  function updateScheduleForm() {
    const form = $('#schedule-form');
    if (!form) return;
    const mode = form.elements.mode.value;
    for (const [selector,visible] of [['#interval-fields',mode === 'interval'],['#weekday-fields',mode === 'weekly'],['#active-schedule-fields',mode !== 'none']]) {
      const field = $(selector); field.hidden = !visible;
      field.querySelectorAll('input').forEach(input => { input.disabled = !visible; });
    }
    $('#no-schedule-hint').hidden = mode !== 'none';
    const count = form.querySelectorAll('[name="slots"]:checked').length;
    $('#slot-count').textContent = count ? `每个安排用药的日期记录 ${count} 次` : '请选择至少一个时段';
  }
  function settings() {
    sheet('设置', `<div class="setting-group"><button class="setting-row" id="manage-meds">${icon('pill')}<span>药品管理<small>搜索药品库、添加药品或改名</small></span>${icon('chevron')}</button></div><div class="setting-group"><button class="setting-row" id="export-data">${icon('download')}<span>导出备份<small>保存全部药品与用药记录</small></span>${icon('chevron')}</button><button class="setting-row" id="import-data">${icon('upload')}<span>导入备份<small>合并记录，保留已有数据</small></span>${icon('chevron')}</button></div><p class="privacy-note">数据仅保存在这台设备上，无需登录。卸载应用或清理应用数据会移除记录，建议定期导出备份。备份文件含用药记录，请妥善保存。</p><p class="version-note">药记 1.6.0 · 记录每一次用药</p>`, {type:'settings'});
    $('.setting-group').insertAdjacentHTML('afterbegin', `<button class="setting-row" id="schedule-settings">${icon('calendar')}<span>服药频率<small>按药品设置周期和早中晚时段</small></span>${icon('chevron')}</button>`);
    $('.setting-group').insertAdjacentHTML('afterbegin', `<button class="setting-row" id="alarm-settings">${icon('alarm')}<span>早中晚闹钟<small>设置响铃时间、通知授权与测试</small></span>${icon('chevron')}</button>`);
    $('.privacy-note').insertAdjacentHTML('beforebegin', `<div class="setting-group"><button class="setting-row" id="sponsor-developer">${icon('heart')}<span>赞助开发者<small>支持药记的开发与维护</small></span>${icon('chevron')}</button></div>`);
    $('#sponsor-developer').insertAdjacentHTML('afterend', `<button class="setting-row" id="disclaimer-button">${icon('info')}<span>免责声明<small>了解应用用途、提醒与数据限制</small></span>${icon('chevron')}</button>`);
  }
  function sponsorDeveloper() {
    sheet('赞助开发者', `<div class="sponsor-intro"><span class="sponsor-icon">${icon('heart')}</span><h3>谢谢你支持药记</h3><p>如果药记帮到了你，欢迎支持后续的开发、维护与改进。</p></div><div class="sponsor-pending"><strong>赞助方式暂未开放</strong><p>收款方式确定后，会在这里提供赞助入口。</p></div><button type="button" id="back-to-settings" class="secondary-button">返回设置</button>`, {type:'sponsor'});
  }
  function disclaimer() {
    sheet('免责声明', `<div class="disclaimer-copy"><section><h3>应用用途</h3><p>药记仅用于个人用药记录与辅助提醒，不提供诊断、处方或个体化治疗建议，不能替代医生、药师的专业指导。</p></section><section><h3>药品信息与用药安排</h3><p>药品库及营养补充品分类仅供查找名称，不代表推荐、安全性或适合长期使用。请按医嘱及产品说明核对药名、规格、用量、频率与疗程；不要仅凭本应用自行增减、停用或更换药物。</p></section><section><h3>记录准确性</h3><p>记录与设置由你填写，请核对数量、单位和时间。应用不计算推荐剂量，也不能判断你是否实际服药。</p></section><section><h3>提醒限制</h3><p>提醒依赖设备、系统权限、系统时间及后台状态，可能延迟或未触发。请勿将本应用作为唯一用药提醒方式。</p></section><section><h3>数据保管</h3><p>数据保存在当前设备。卸载、清除数据或设备损坏可能造成数据丢失，请定期导出备份并妥善保管。</p></section><p class="disclaimer-important">若身体不适或遇紧急情况，请及时寻求医疗帮助。本说明不免除或限制依法不能免除、限制的责任。</p></div><button type="button" id="back-to-settings" class="secondary-button">返回设置</button>`, {type:'disclaimer'});
  }
  function manageMeds() {
    closeModal(); medView = 'mine'; medSearch = ''; switchTab('medicines');
  }
  function medForm(id) {
    const med = data.medications.find(m => m.id === id);
    sheet(med ? '修改药品名称' : '添加药品', `<form id="med-form"><label class="form-field"><span>药品名称</span><input class="field-control" name="name" maxlength="60" required autocomplete="off" placeholder="输入药品名称" value="${escape((med && med.name) || '')}"></label><p class="form-error" id="form-error" role="alert" hidden></p><button class="primary-button" type="submit">保存药品</button></form>`, {type:'med',id});
  }
  function saveFile(text, name) {
    if (window.MedtimeAndroid && typeof window.MedtimeAndroid.saveFile === 'function') {
      window.MedtimeAndroid.saveFile(text, name, 'application/json');
      return;
    }
    const blob = new Blob([text], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('备份已生成，请保存下载文件');
  }
  async function importFile(file) {
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) { toast('备份文件过大，请选择小于 32 MB 的 JSON 文件'); return; }
    try {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('文件读取失败，请重新选择'));
        reader.readAsText(file, 'UTF-8');
      });
      const next = S.importData(text, data);
      const added = next.records.length - data.records.length;
      const meds = next.medications.length - data.medications.length;
      const plans = next.medications.filter(m => {
        const current = data.medications.find(old => old.id === m.id);
        return current && current.schedule.mode === 'none' && m.schedule.mode !== 'none';
      }).length;
      const doses = next.medications.filter(m => {
        const current = data.medications.find(old => old.id === m.id);
        return current && !current.dose && m.dose;
      }).length;
      if (!added && !meds && !plans && !doses) { toast('备份中的数据已存在，无需重复导入'); return; }
      confirm('导入备份', `将添加 ${added} 条记录和 ${meds} 种药品${plans ? `，恢复 ${plans} 种药品的服药频率` : ''}${doses ? `，恢复 ${doses} 种药品的每次用量` : ''}。已有记录和已设置的频率、用量会保留。`, () => {
        try { commit(S.importData(text, data), '备份已合并', false); closeModal(); }
        catch (error) { showError(error); }
      }, '确认导入');
    } catch (error) { toast(`无法导入：${error.message}`); }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button,a');
    if (event.target.classList.contains('modal-overlay')) { closeModal(); return; }
    if (!target) return;
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
    if (target.dataset.catalogAdd) {
      const entry = C.items.find(item => item.id === target.dataset.catalogAdd);
      if (!entry || C.findAdded(entry, data.medications)) return;
      try { commit(S.addCatalogMedication(data, {id:entry.id,name:entry.name,icon:entry.icon}), '药品已添加', false); }
      catch (error) { showError(error); }
      return;
    }
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
      case 'settings-button': settings(); break;
      case 'sponsor-developer': sponsorDeveloper(); break;
      case 'disclaimer-button': disclaimer(); break;
      case 'back-to-settings': settings(); break;
      case 'alarm-settings': alarmOverview(); break;
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
      case 'export-data': try { saveFile(storageBlocked ? localStorage.getItem(S.STORAGE_KEY) || '' : S.exportData(data), `药记${storageBlocked ? '原始数据' : '备份'}-${S.localDay(new Date())}.json`); } catch (error) { toast(error.message); } break;
      case 'import-data': $('#import-input').value = ''; $('#import-input').click(); break;
      case 'export-raw': try { saveFile(localStorage.getItem(S.STORAGE_KEY) || '', `药记原始数据-${S.localDay(new Date())}.json`); } catch (error) { toast('系统存储不可读取，请检查应用存储状态'); } break;
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'med-search') { medSearch = event.target.value; refreshMedicationResults(); }
  });
  document.addEventListener('change', event => {
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
          weekdays:form.getAll('weekdays').map(Number)
        };
        commit(S.setSchedule(data, modal.id, schedule), schedule.mode === 'none' ? '已取消固定安排' : '频率已保存', false);
        closeModal();
      } else {
        const next = modal.id ? S.renameMedication(data, modal.id, form.get('name')) : S.addMedication(data, form.get('name'));
        commit(next, '药品已保存', false); manageMeds();
      }
    } catch (error) { showError(error); }
  });
  document.addEventListener('keydown', event => {
    if (!modal) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const focusable = [...document.querySelectorAll('.sheet button,.sheet input,.sheet select,.sheet textarea,.sheet [tabindex="0"]')].filter(el => !el.disabled && !el.hidden && el.tabIndex >= 0 && el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === $('.sheet'))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === $('.sheet'))) { event.preventDefault(); first.focus(); }
    }
  });
  window.MedtimeNativeBack = () => {
    if (modal) { closeModal(); return true; }
    if (tab !== 'today') { switchTab('today'); return true; }
    return false;
  };
  window.MedtimeOpenAlarm = () => { closeModal(); switchTab('today'); refreshAlarmStatus(); };
  window.addEventListener('medtime-alarm-status', refreshAlarmStatus);
  window.addEventListener('medtime-export-result', event => {
    if ((event.detail && event.detail.ok)) toast('备份已保存');
    else if (!(event.detail && event.detail.cancelled)) toast('备份未能保存，请重试');
  });
  window.addEventListener('storage', event => {
    if (event.key === S.STORAGE_KEY || event.key === R.STORAGE_KEY || event.key === null) { closeModal(); load(); render(); toast('记录与闹钟已和本地存储同步'); }
  });
  function refreshDay() {
    const day = S.localDay(new Date());
    if (day !== observedDay) { observedDay = day; render(); }
    const dateInput = $('[name="takenAt"]');
    if (dateInput) dateInput.max = S.localDateTime(new Date(Math.max(Date.now(), new Date((modal && modal.record && modal.record.takenAt) || 0).getTime())));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDay(); });
  window.addEventListener('focus', refreshDay);
  setInterval(refreshDay, 30000);
  setInterval(() => { if (nativeAlarm.ringing || (modal && (modal.type === 'alarm' || modal.type === 'alarms'))) refreshAlarmStatus(); },1000);
  load(); render();
})();
