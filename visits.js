const fields = ['hospital', 'address', 'department', 'doctor', 'reason', 'summary', 'cost', 'followup', 'notes'];
export function validateVisits(visits = []) {
  if (!Array.isArray(visits)) throw new Error('Invalid visits');
  const ids = new Set();
  return visits.map(visit => {
    if (!visit || typeof visit.id !== 'string' || !visit.id || visit.id.length > 100 || ids.has(visit.id) || typeof visit.at !== 'number' || !Number.isFinite(new Date(visit.at).getTime())) throw new Error('Invalid visit');
    ids.add(visit.id);
    if (visit.status !== undefined && !['completed','scheduled','cancelled'].includes(visit.status)) throw new Error('Invalid visit status');
    if (visit.followupOf !== undefined && (typeof visit.followupOf !== 'string' || visit.followupOf.length > 100)) throw new Error('Invalid followup reference');
    if (visit.followupCancelled !== undefined && typeof visit.followupCancelled !== 'boolean') throw new Error('Invalid followup cancellation');
    const result = { ...(visit.followupCancelled ? {followupCancelled:true} : {}), id: visit.id, at: visit.at, status: visit.status ?? 'completed', ...(visit.followupOf ? {followupOf:visit.followupOf} : {}) };
    for (const key of fields) {
      const value = visit[key] ?? '';
      if (typeof value !== 'string' || value.length > (['summary', 'notes', 'reason'].includes(key) ? 3000 : 300)) throw new Error('Invalid visit field');
      result[key] = value.trim();
    }
    if (!result.hospital || (result.cost && !/^\d{1,8}(\.\d{1,2})?$/.test(result.cost)) || (result.followup && !validDate(result.followup))) throw new Error('Invalid visit');
    return result;
  });
}
export function buildVisitEvents(visits) {
  const completed = visits.filter(v => !v.status || v.status === 'completed');
  const appointments = visits.filter(v => v.status === 'scheduled');
  for (const visit of completed) {
    if (visit.followup && !visit.followupCancelled && !visits.some(v => v.followupOf === visit.id)) {
      appointments.push({ ...visit, id:'followup:' + visit.id, at:+new Date(visit.followup + 'T09:00:00'), status:'scheduled', virtual:true, sourceId:visit.id, dateOnly:true, reason:'复诊预约', summary:'', cost:'', notes:'' });
    }
  }
  return { completed: [...completed].sort((a,b)=>b.at-a.at), appointments: [...appointments].sort((a,b)=>a.at-b.at), cancelled: visits.filter(v=>v.status==='cancelled') };
}
export function appointmentTiming(visit, now = Date.now()) {
  if (visit.status !== 'scheduled') return 'none';
  if (visit.dateOnly) {
    const date=localDate(new Date(visit.at)), today=localDate(new Date(now));
    return date<today ? 'overdue' : date===today ? 'due' : 'upcoming';
  }
  return visit.at>now ? 'upcoming' : now-visit.at<60000 ? 'due' : 'overdue';
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00');
  return Number.isFinite(+date) && localDate(date) === value;
}
function localDate(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function localTime(date) { return localDate(date) + 'T' + String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0'); }
const el = (tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; };
export function initVisits({ loadState, update }) {
  const $ = id => document.getElementById(id);
  const page = $('visits-page'), dialog = $('visit-editor'), form = $('visit-form');
  let editingOriginal = null, editingId = null, generation = 0, activeController = null, searching = false, lastSearch = 0;
  const cache = new Map();
  let activeTab = 'completed', selectedDate = null, month = new Date(new Date().getFullYear(),new Date().getMonth(),1), followupOf = '';
  const formatter = new Intl.DateTimeFormat('zh-CN', { year:'numeric',month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23' });
  function route() {
    let signedIn = true;
    try { loadState(); } catch { signedIn = false; }
    const isVisit = location.hash === '#visits';
    page.hidden = !(isVisit && signedIn);
    $('journal').hidden = isVisit || !signedIn;
    document.body.classList.toggle('visits-view', isVisit);
    $('visit-link').href = isVisit ? '#' : '#visits';
    $('visit-link').textContent = isVisit ? '💊 用药记录 ↗' : '🏥 看病记录 ↗';
    document.title = isVisit ? '看病记录 · 吃药服务' : '吃药服务';
  }
  window.addEventListener('hashchange', () => { route(); window.scrollTo({ top:0, behavior:'instant' }); });
  function open(visit) {
    activeController?.abort(); generation++;
    editingOriginal = visit ?? null;
    editingId = visit?.id ?? null;
    followupOf = visit?.followupOf ?? '';
    form.reset();
    $('visit-status-kind').value = visit?.status ?? 'completed';
    updateFormLabels();
    $('visit-at').value = localTime(new Date(visit?.at ?? Date.now()));
    for (const key of fields) $('visit-' + key).value = visit?.[key] ?? '';
    $('hospital-results').replaceChildren(); $('hospital-search-status').textContent = ''; $('visit-status').textContent = '';
    dialog.showModal();
  }
  function updateFormLabels() {
    const scheduled = $('visit-status-kind').value === 'scheduled';
    $('visit-editor-title').textContent = scheduled ? '预约／复诊安排' : '就诊记录';
    $('visit-at-label').textContent = scheduled ? '预约日期和时间' : '就诊日期和时间';
    $('visit-save').textContent = scheduled ? '保存预约' : '保存就诊记录';
    $('visit-completed-fields').hidden = scheduled;
  }
  $('visit-status-kind').onchange = () => { if ($('visit-status-kind').value==='completed' && +new Date($('visit-at').value)>Date.now()) $('visit-at').value=localTime(new Date()); updateFormLabels(); };
  $('visit-add').onclick = () => open();
  $('appointment-add').onclick = () => { const next=new Date();next.setDate(next.getDate()+1);next.setHours(9,0,0,0);open({status:'scheduled',at:+next}); };
  for (const [id,tab] of [['visits-tab-planned','scheduled'],['visits-tab-completed','completed']]) $(id).onclick=()=>{activeTab=tab;render();};
  $('visit-calendar-prev').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);selectedDate=null;render();};
  $('visit-calendar-next').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);selectedDate=null;render();};
  $('visit-calendar-today').onclick=()=>{const now=new Date();month=new Date(now.getFullYear(),now.getMonth(),1);selectedDate=null;render();};
  $('visit-calendar-clear').onclick=()=>{selectedDate=null;render();};
  $('visit-cancel').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { activeController?.abort(); generation++; });
  $('visits-filter').oninput = render;
  function appointmentActions(visit) {
    const actions=el('div','','appointment-actions');
    const complete=el('button','已完成就诊','primary');complete.type='button';
    complete.onclick=()=>open(visit.virtual ? {hospital:visit.hospital,address:visit.address,department:visit.department,doctor:visit.doctor,at:Date.now(),status:'completed',followupOf:visit.sourceId} : {...visit,status:'completed',at:Date.now()});
    const reschedule=el('button','改期');reschedule.type='button';
    reschedule.onclick=()=>open(visit.virtual ? {hospital:visit.hospital,address:visit.address,department:visit.department,doctor:visit.doctor,at:visit.at,status:'scheduled',followupOf:visit.sourceId} : visit);
    const cancel=el('button','取消预约');cancel.type='button';
    let cancellationConfirmed=false;
    cancel.onclick=async()=>{
      if(!cancellationConfirmed){cancellationConfirmed=true;cancel.textContent='确认取消';const note=el('small','仅取消本本里的安排，可恢复，不会通知医院。','cancellation-note');actions.append(note);return;}
      cancel.disabled=true;
      await update(state=>({...state,visits:state.visits.map(v=>visit.virtual ? (v.id===visit.sourceId ? {...v,followupCancelled:true} : v) : (v.id===visit.id && v.status==='scheduled' ? {...v,status:'cancelled'} : v))}),'已取消本本里的安排，可在「已取消的安排」恢复。',$('appointment-action-status'));
    };
    actions.append(complete,reschedule,cancel);return actions;
  }
  function renderReminders(events) {
    const section=$('appointment-reminders');section.replaceChildren();
    const due=events.appointments.filter(v=>['due','overdue'].includes(appointmentTiming(v)));
    section.hidden=!due.length;
    if(!due.length)return;
    section.append(el('h2','🔔 预约时间提醒'),el('p','完成就诊后请确认，记录不会自动转入就诊记录。','field-hint'));
    for(const visit of due.slice(0,2)) {
      const item=el('div','','appointment-reminder');
      const timing=appointmentTiming(visit);
      item.append(el('strong',timing==='overdue' ? '已过预约时间，待确认' : visit.dateOnly ? '今天有复诊，时间待确认' : '预约时间到了'),el('p',visit.hospital+' · '+(visit.dateOnly?localDate(new Date(visit.at)):formatter.format(visit.at))));
      item.append(appointmentActions(visit));section.append(item);
    }
    if(due.length>2) {
      const more=el('button','查看全部 '+due.length+' 条待确认预约');more.type='button';more.onclick=()=>{location.hash='visits';activeTab='scheduled';selectedDate=null;render();};section.append(more);
    }
  }
  function renderCancelled(visits,events) {
    const section=$('cancelled-appointments');section.replaceChildren();
    const cancelled=[...events.cancelled,...visits.filter(v=>v.followupCancelled).map(v=>({...v,virtual:true,sourceId:v.id,at:+new Date(v.followup+'T09:00:00')}))];
    section.hidden=!cancelled.length;
    if(!cancelled.length)return;
    section.append(el('summary','已取消的安排 · '+cancelled.length));
    for(const visit of cancelled) {
      const row=el('div','','cancelled-appointment');row.append(el('span',visit.hospital+' · '+localDate(new Date(visit.at))));
      const restore=el('button','恢复预约');restore.type='button';restore.onclick=()=>update(state=>({...state,visits:state.visits.map(v=>v.id===(visit.virtual?visit.sourceId:visit.id) ? (visit.virtual?{...v,followupCancelled:false}:{...v,status:'scheduled'}) : v)}),'已恢复预约。',$('appointment-action-status'));
      row.append(restore);section.append(row);
    }
  }
  function render() {
    route();
    let visits;
    try { visits = loadState().visits ?? []; } catch { $('visits-list').replaceChildren();$('appointment-reminders').replaceChildren();$('appointment-reminders').hidden=true;return; }
    const term = $('visits-filter').value.trim().toLocaleLowerCase();
    const events = buildVisitEvents(visits);
    renderReminders(events);
    renderCancelled(visits,events);
    const all = [...events.completed,...events.appointments];
    const filtered = all.filter(v => [v.hospital,v.department,v.reason,v.summary,v.doctor,v.notes].join(' ').toLocaleLowerCase().includes(term));
    $('visits-tab-planned').textContent = '预约／复诊 ' + events.appointments.length;
    $('visits-tab-completed').textContent = '就诊记录 ' + events.completed.length;
    $('visits-tab-planned').setAttribute('aria-pressed',String(activeTab==='scheduled'));
    $('visits-tab-completed').setAttribute('aria-pressed',String(activeTab==='completed'));
    const source = activeTab==='scheduled' ? events.appointments : events.completed;
    const matches = source.filter(v=>filtered.includes(v) && (!selectedDate || localDate(new Date(v.at))===selectedDate));
    $('visit-list-title').textContent = selectedDate ? selectedDate + ' 的记录' : activeTab==='scheduled' ? '预约与复诊安排' : '就诊记录';
    $('visit-calendar-clear').hidden = !selectedDate;
    renderCalendar(filtered);
    const list = $('visits-list'); list.replaceChildren();
    if (!matches.length) {
      const empty = el('div','','visit-empty');
      empty.append(el('div','🏥','visit-empty-icon'), el('h3',selectedDate ? '这一天没有这类记录' : term ? '没有找到这条记录' : activeTab==='scheduled' ? '暂时没有预约安排' : '还没有就诊记录'), el('p','可以切换分类、选择其他日期，或新增一条记录。'));
      list.append(empty); return;
    }
    for (const visit of matches) {
      const card = el('article','','visit-entry');
      const top = el('div','','visit-entry-top');
      top.append(el('span','🏥','section-icon lilac'),el('h3',visit.hospital));
      card.append(top,el('p',(visit.dateOnly ? localDate(new Date(visit.at)) + ' · 时间待补充' : formatter.format(visit.at)) + (visit.department ? ' · ' + visit.department : ''),'visit-meta'));
      if (visit.reason) card.append(el('p',visit.reason,'visit-reason'));
      const chips = el('div','','visit-chips');
      chips.append(el('span',visit.status==='scheduled' ? (appointmentTiming(visit)==='overdue' ? '已过预约时间，待确认' : appointmentTiming(visit)==='due' ? '预约时间到了' : '预约／复诊') : '就诊记录',visit.status==='scheduled' ? 'planned-tag' : 'completed-tag'));
      if (visit.status !== 'scheduled' && visit.cost) chips.append(el('span','自付 ¥' + Number(visit.cost).toLocaleString('zh-CN')));
      if (visit.status !== 'scheduled' && visit.followup) chips.append(el('span',visit.followupCancelled ? '复诊安排已取消' : '复诊 ' + visit.followup));
      card.append(chips);
      const detail = el('details'); detail.append(el('summary','展开就诊详情'));
      for (const [key,label] of [['address','医院地址'],['doctor','医生'],['summary','诊疗摘要／检查结果'],['notes','备注']]) {
        if (visit[key]) { detail.append(el('h4',label),el('p',visit[key],'visit-detail-text')); }
      }
      if (![visit.address,visit.doctor,visit.summary,visit.notes].some(Boolean)) detail.append(el('p','暂时没有补充详情。'));
      const edit = el('button',visit.virtual ? '修改原记录的复诊日期' : '修改记录'); edit.type='button'; edit.onclick=()=>open(visit.virtual ? visits.find(v=>v.id===visit.sourceId) : visit);
      detail.append(edit);card.append(detail);
      if (visit.status==='scheduled') card.append(appointmentActions(visit));
      list.append(card);
    }
  }
  function renderCalendar(events) {
    const grid=$('visit-calendar-days');grid.replaceChildren();
    const year=month.getFullYear(), index=month.getMonth();
    $('visit-calendar-month').textContent=year+'年'+(index+1)+'月';
    const leading=(new Date(year,index,1).getDay()+6)%7;
    for(let i=0;i<leading;i++)grid.append(el('span'));
    for(let day=1;day<=new Date(year,index+1,0).getDate();day++) {
      const key=localDate(new Date(year,index,day));
      const daily=events.filter(v=>localDate(new Date(v.at))===key);
      const planned=daily.filter(v=>v.status==='scheduled').length, completed=daily.length-planned;
      const cell=el('button','','visit-calendar-day');cell.type='button';cell.append(el('span',String(day)));
      const marks=el('span','','visit-calendar-marks');
      if(planned)marks.append(el('small','约'+planned,'planned-mark'));
      if(completed)marks.append(el('small','诊'+completed,'completed-mark'));
      cell.append(marks);cell.setAttribute('aria-label',key+'，预约'+planned+'条，就诊记录'+completed+'条');
      cell.setAttribute('aria-pressed',String(selectedDate===key));
      if(key===localDate(new Date()))cell.setAttribute('aria-current','date');
      cell.onclick=()=>{selectedDate=selectedDate===key?null:key;if(planned&&!completed)activeTab='scheduled';if(completed&&!planned)activeTab='completed';render();};
      grid.append(cell);
    }
  }
  form.onsubmit = async event => {
    event.preventDefault();
    const at = new Date($('visit-at').value);
    const status = $('visit-status');
    if (!Number.isFinite(+at) || ($('visit-status-kind').value==='completed' && +at > Date.now()) || localTime(at) !== $('visit-at').value) { status.textContent='请选择有效时间；未来的安排请将记录类型选为「预约／复诊」。'; return; }
    const visit = { id: editingId ?? crypto.randomUUID(), at:+at, status:$('visit-status-kind').value, ...(followupOf ? {followupOf} : {}) };
    for (const key of fields) visit[key] = $('visit-' + key).value.trim();
    if (editingOriginal?.followupCancelled && editingOriginal.followup===visit.followup) visit.followupCancelled=true;
    try { validateVisits([visit]); } catch { status.textContent='请检查医院名称、费用或复诊日期是否填写正确。'; return; }
    const existingId = editingId; const ownGeneration = generation;
    $('visit-save').disabled=true;
    try {
      const saved = await update(state => {
        const visits = state.visits ?? [];
        if (visit.followupOf && !existingId && visits.some(v=>v.followupOf===visit.followupOf)) throw new Error('Followup already recorded');
        if (existingId && !visits.some(v=>v.id===existingId)) throw new Error('Missing visit');
        let next=existingId ? visits.map(v=>v.id===existingId ? visit : v) : [...visits,visit];
        if(visit.followupOf && visit.status==='scheduled') next=next.map(v=>v.id===visit.followupOf ? {...v,followup:localDate(new Date(visit.at)),followupCancelled:false}:v);
        return {...state, visits:next};
      },'看病记录已保存。',status);
      if (saved && ownGeneration===generation) { activeTab=visit.status;selectedDate=null;month=new Date(at.getFullYear(),at.getMonth(),1);render();dialog.close(); }
    } finally { $('visit-save').disabled=false; }
  };
  $('hospital-search').onclick = async () => {
    const query = $('hospital-query').value.trim();
    const status = $('hospital-search-status');
    if (query.length < 2) { status.textContent='请输入至少两个字的医院名或地区，例如「東京大学病院」。'; return; }
    if (searching || Date.now()-lastSearch < 1200) return;
    const ownGeneration = generation;
    activeController?.abort(); activeController = new AbortController(); searching=true; lastSearch=Date.now();
    $('hospital-search').disabled=true; status.textContent='正在查找日本的医院与诊所…'; $('hospital-results').replaceChildren();
    const timer = setTimeout(()=>activeController?.abort(),15000);
    try {
      let results = cache.get(query);
      if (!results) {
        const endpoint = new URL('https://nominatim.openstreetmap.org/search');
        endpoint.search = new URLSearchParams({q:query,countrycodes:'jp',format:'jsonv2',addressdetails:'1',namedetails:'1',limit:'12','accept-language':'ja,zh,en'});
        const response = await fetch(endpoint,{signal:activeController.signal,referrerPolicy:'strict-origin-when-cross-origin'});
        if (!response.ok) throw new Error('Search unavailable');
        const raw = await response.json();
        if (!Array.isArray(raw)) throw new Error('Invalid search result');
        results = raw.filter(r=>['hospital','clinic','doctors','dentist'].includes(r.type) || /病院|クリニック|医院|診療所|医療センター|hospital|clinic/i.test(r.name ?? r.display_name ?? '')).slice(0,8).map(r=>({name:r.namedetails?.['name:ja'] || r.name || r.display_name.split(',')[0],address:r.display_name}));
        cache.set(query,results);
      }
      if (ownGeneration!==generation || !dialog.open) return;
      status.textContent=results.length ? '点选医院会填入名称和地址，也可以自行修改。' : '暂时没找到。试试日文全名、加上城市，或直接在下方填写。';
      for (const result of results) {
        const button = el('button','','hospital-result'); button.type='button';button.append(el('strong',result.name),el('small',result.address));
        button.onclick=()=>{ $('visit-hospital').value=result.name; $('visit-address').value=result.address.slice(0,300); $('hospital-results').replaceChildren(); status.textContent='已选择：' + result.name; };
        $('hospital-results').append(button);
      }
    } catch { if(ownGeneration===generation)status.textContent='搜索暂时不可用，医院名称仍可手动填写。'; }
    finally { clearTimeout(timer); searching=false; $('hospital-search').disabled=false; }
  };
  function reset() { generation++; activeController?.abort();dialog.close();form.reset();$('visits-filter').value='';$('visits-list').replaceChildren();page.hidden=true;activeTab='completed';selectedDate=null;const now=new Date();month=new Date(now.getFullYear(),now.getMonth(),1);followupOf='';$('appointment-reminders').replaceChildren();$('appointment-reminders').hidden=true;$('appointment-action-status').textContent=''; }
  setInterval(()=>{if(!document.hidden&&!dialog.open)render();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!dialog.open)render();});
  return { render, reset };
}
