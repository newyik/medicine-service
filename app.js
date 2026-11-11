import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { cloudConfig } from './config.js';
import { initVisits, validateVisits } from './visits.js?v=20261108-1';
import { initEmailAuth } from './email-auth.js?v=20261111-login-3';

const client = createClient(cloudConfig.url, cloudConfig.publicKey);
let signedInUser = null;
let cloudState = null;
let writeQueue = Promise.resolve();
let accountGeneration = 0;

const key = 'medicine-service.v1';
const byId = id => document.getElementById(id);
const editor = byId('editor');
const whenDate = byId('when-date');
const whenHour = byId('when-hour');
const whenMinute = byId('when-minute');
// 初始化"时/分"下拉框
(function initTimeOptions() {
  const fill = (el, count, pad) => {
    if (!el) return;
    for (let i = 0; i < count; i++) {
      const v = pad ? String(i).padStart(2, '0') : String(i);
      el.append(new Option(v, v));
    }
  };
  fill(document.getElementById('when-hour'), 24, true);
  fill(document.getElementById('when-minute'), 60, true);
})();

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortDay = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
const fullDay = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const medicineTypes = {
  oral: { label: '口服药（片剂／胶囊）', icon: '💊', unit: '粒', action: '刚吃了' },
  patch: { label: '贴剂', icon: '🩹', unit: '贴', action: '刚贴了' },
  injection: { label: '注射（打针）', icon: '💉', unit: '针', action: '刚打了' },
  liquid: { label: '口服液', icon: '🧴', unit: '毫升', action: '刚喝了' },
  eye: { label: '滴眼液', icon: '👁️', unit: '滴', action: '刚滴了' },
  ear: { label: '滴耳液', icon: '👂', unit: '滴', action: '刚滴了' },
  nasal: { label: '鼻喷剂', icon: '👃', unit: '次', action: '刚喷了' },
  topical: { label: '外用涂抹', icon: '🧴', unit: '次', action: '刚涂了' },
  inhaled: { label: '吸入／雾化', icon: '🌬️', unit: '次', action: '刚用了' },
  other: { label: '其他', icon: '✚', unit: '次', action: '刚用了' }
};
const pillColors = {
  'pill-pink': { label: '粉色药丸', color: '#db759b', light: '#fce3ed' },
  'pill-blue': { label: '蓝色药丸', color: '#5a9cd6', light: '#dfedff' },
  'pill-purple': { label: '紫色药丸', color: '#a180cb', light: '#efe4ff' },
  'pill-green': { label: '绿色药丸', color: '#64aa85', light: '#e0f4e8' },
  'pill-orange': { label: '橙色药丸', color: '#e7a05a', light: '#fff0d6' },
  'pill-red': { label: '红色药丸', color: '#d66c70', light: '#ffe6e4' }
};
const iconChoices = [
  ...Object.entries(pillColors).map(([id, value]) => [id, value.label]),
  ['💊', '药丸／胶囊'], ['🩹', '贴剂'], ['💉', '注射器'], ['🧴', '药液／药膏'],
  ['💧', '滴液'], ['👁️', '眼睛'], ['👂', '耳朵'], ['👃', '鼻子'], ['🌬️', '吸入／雾化'],
  ['🧪', '试管'], ['🌡️', '体温计'], ['🦷', '牙齿'], ['🦴', '骨骼'], ['🫁', '肺部'],
  ['🫀', '心脏'], ['🧠', '大脑'], ['🛡️', '盾牌'], ['☀️', '太阳'], ['🌙', '月亮'],
  ['⭐', '星星'], ['🌿', '叶子'], ['🌸', '花朵'], ['🍀', '四叶草'], ['❤️', '爱心'], ['✚', '十字'],
  ['🔴', '红色圆点（原有）'], ['🟠', '橙色圆点（原有）'], ['🟡', '黄色圆点（原有）'],
  ['🟢', '绿色圆点（原有）'], ['🔵', '蓝色圆点（原有）'], ['🟣', '紫色圆点（原有）'], ['🔷', '菱形（原有）']
];
const medicineIcons = iconChoices.map(([icon]) => icon);
let calendarMedicineId = '';
let editingMedicineId = null;
let editingId = null;
let calendarMonth = new Date();
let selectedDay = dayKey(calendarMonth);

function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}

function timeField(date) {
  return dayKey(date) + 'T' + clock.format(date);
}

function validate(records) {
  if (!Array.isArray(records)) throw new Error('Invalid records');
  const ids = new Set();
  return records.map(record => {
    if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id) ||
        typeof record.at !== 'number' || !Number.isFinite(new Date(record.at).getTime())) {
      throw new Error('Invalid record');
    }
    ids.add(record.id);
    if (record.medicineId === undefined) return { id: record.id, at: record.at };
    if (typeof record.medicineId !== 'string' || !record.medicineId || !validQuantity(record.quantity)) {
      throw new Error('Invalid medicine record');
    }
    return { id: record.id, at: record.at, medicineId: record.medicineId, quantity: record.quantity };
  });
}

function validQuantity(value) {
  return Number.isInteger(value) && value >= 1 && value <= 999;
}

function validateMedicines(medicines) {
  if (!Array.isArray(medicines)) throw new Error('Invalid medicines');
  const ids = new Set();
  return medicines.map(({ id, name, kind, icon, archived }) => {
    if (typeof id !== 'string' || !id || ids.has(id) || typeof name !== 'string' ||
        !name.trim() || name.length > 60 || !Object.hasOwn(medicineTypes, kind)) {
      throw new Error('Invalid medicine');
    }
    ids.add(id);
    return { id, name, kind, icon: medicineIcons.includes(icon) ? icon : defaultIcon(kind), archived: archived === true };
  });
}

function checkedState(stored) {
  if (Array.isArray(stored)) return { records: validate(stored), medicines: [], visits: [] };
  return { records: validate(stored.records), medicines: validateMedicines(stored.medicines), visits: validateVisits(stored.visits) };
}

function loadState() {
  if (!cloudState) throw new Error('Please sign in');
  return structuredClone(cloudState);
}

function loadMedicines() {
  return loadState().medicines;
}

function medicineSymbol(icon) {
  const node = element('span', pillColors[icon] ? '' : icon);
  node.className = 'medicine-symbol';
  if (pillColors[icon]) {
    node.classList.add('pill-symbol');
    node.style.setProperty('--pill-color', pillColors[icon].color);
    node.style.setProperty('--pill-light', pillColors[icon].light);
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', pillColors[icon].label);
  }
  return node;
}

function defaultIcon(kind) {
  return (medicineTypes[kind] ?? medicineTypes.oral).icon;
}

function unit(medicine) {
  return (medicineTypes[medicine?.kind] ?? medicineTypes.oral).unit;
}

function describe(record, medicines) {
  if (!record.medicineId) return medicines.size ? ' · 未分类' : '';
  const medicine = medicines.get(record.medicineId);
  return ' · ' + (medicine?.name ?? '药物') + ' ' + record.quantity + ' ' + unit(medicine);
}

function renderMedicines(medicines, today, records) {
  const container = byId('medicines');
  container.replaceChildren();
  byId('now').hidden = medicines.length > 0;
  for (const medicine of medicines.filter(item => !item.archived)) {
    const total = today.reduce((sum, record) => record.medicineId === medicine.id ? sum + record.quantity : sum, 0);
    const row = element('div', '');
    row.className = 'record';
    const name = element('div', medicine.name + ' · 今天 ' + total + ' ' + unit(medicine));
    name.className = 'med-name';
    const last = records.find(record => record.medicineId === medicine.id);
    const recent = element('small', last
      ? '上次 ' + dayKey(new Date(last.at)) + ' ' + clock.format(last.at) + ' · ' + last.quantity + ' ' + unit(medicine)
      : '还没记过这款药');
    recent.className = 'medicine-recent';
    name.append(recent);
    const controls = element('div', '');
    controls.className = 'med-controls';
    const quantity = element('input', '');
    quantity.type = 'number';
    quantity.min = '1';
    quantity.max = '999';
    quantity.step = '1';
    quantity.value = '1';
    quantity.setAttribute('aria-label', medicine.name + '本次用量（' + unit(medicine) + '）');
    const button = element('button', (medicineTypes[medicine.kind] ?? medicineTypes.oral).action);
    button.onclick = () => {
      const amount = quantity.valueAsNumber;
      if (!validQuantity(amount)) {
        quantity.reportValidity();
        quantity.focus();
        byId('status').textContent = '请输入 1 到 999 之间的整数。';
        return;
      }
      const record = { ...makeRecord(Date.now()), medicineId: medicine.id, quantity: amount };
      update(state => ({ ...state, records: [...state.records, record] }), '已记录 ' + medicine.name + ' ' + amount + ' ' + unit(medicine) + '。');
    };
    controls.append(quantity, button);
    const label = element('div', '');
    label.className = 'medicine-label';
    const icon = element('button', '');
    icon.append(medicineSymbol(medicine.icon));
    icon.className = 'medicine-icon';
    icon.setAttribute('aria-label', '修改「' + medicine.name + '」');
    icon.title = '修改药物';
    icon.onclick = () => openMedicineEditor(medicine);
    label.append(icon, name);
    row.append(label, controls);
    container.append(row);
  }
}

function renderMedicineManagement(medicines) {
  const list = byId('medicine-list');
  list.replaceChildren();
  if (!medicines.length) list.append(element('p', '添加药物后，可以在这里管理。'));
  medicines.forEach((medicine, index) => {
    const row = element('div', '');
    row.className = 'management-row';
    const name = element('div', '');
    name.append(medicineSymbol(medicine.icon), ' ' + medicine.name + (medicine.archived ? '（已收起）' : ''));
    row.append(name);
    const actions = element('div', '');
    actions.className = 'management-actions';
    const edit = element('button', '修改');
    edit.onclick = () => openMedicineEditor(medicine);
    actions.append(edit);
    for (const [offset, label] of [[-1, '上移'], [1, '下移']]) {
      const move = element('button', label);
      move.disabled = index + offset < 0 || index + offset >= medicines.length;
      move.setAttribute('aria-label', label + medicine.name);
      move.onclick = () => update(state => {
        const position = state.medicines.findIndex(item => item.id === medicine.id);
        const destination = position + offset;
        if (position < 0 || destination < 0 || destination >= state.medicines.length) return state;
        const [item] = state.medicines.splice(position, 1);
        state.medicines.splice(destination, 0, item);
        return state;
      }, '已调整药物顺序。');
      actions.append(move);
    }
    const archive = element('button', medicine.archived ? '恢复显示' : '收起');
    archive.onclick = () => update(state => {
      const item = state.medicines.find(item => item.id === medicine.id);
      if (!item) throw new Error('Missing medicine');
      item.archived = !medicine.archived;
      return state;
    }, medicine.archived ? '已恢复显示药物。' : '已收起药物，可在管理药物中恢复显示。');
    actions.append(archive);
    row.append(actions);
    list.append(row);
  });
}

async function readJournal(userId) {
  const { data, error } = await client.from('medicine_journals')
    .select('data,revision').eq('user_id', userId).single();
  if (error) throw error;
  return { state: checkedState(data.data), revision: data.revision };
}

function update(change, message, status = byId('status')) {
  const userId = signedInUser?.id;
  const generation = accountGeneration;
  const operation = async () => {
    if (!userId || generation !== accountGeneration) return false;
    status.textContent = '正在保存到云端…';
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = await readJournal(userId);
        if (generation !== accountGeneration) return false;
        const next = checkedState(change(current.state));
        const { data: saved, error } = await client.rpc('save_medicine_journal', {
          expected_revision: current.revision, new_data: next
        });
        if (error) throw error;
        if (!saved) continue;
        if (generation !== accountGeneration) return false;
        cloudState = next;
        render();
        status.textContent = message;
        byId('sync-state').textContent = '已同步 · ' + clock.format(Date.now());
        return true;
      }
      throw new Error('Concurrent edits');
    } catch (error) {
      status.textContent = error.message === 'Duplicate medicine'
        ? '这个药物名称已经在列表里，请换一个名称。'
        : '云端保存失败，本次操作尚未确认保存。请检查网络后重试。';
      byId('sync-state').textContent = '同步遇到问题，请重试';
      return false;
    }
  };
  const pending = writeQueue.then(operation, operation);
  writeQueue = pending.catch(() => {});
  return pending;
}

function makeRecord(at) {
  const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
  return { id, at };
}

function element(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function render() {
  let records;
  let medicines;
  try {
    const state = loadState();
    medicines = new Map(state.medicines.map(medicine => [medicine.id, medicine]));
    records = state.records.sort((a, b) => b.at - a.at);
  } catch {
    byId('last').textContent = '读取失败。请检查浏览器是否允许本地存储。';
    return;
  }
  const grouped = new Map();
  for (const record of records) {
    const date = new Date(record.at);
    const day = dayKey(date);
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(record);
  }

  const today = new Date();
  const todayRecords = grouped.get(dayKey(today)) ?? [];
  renderMedicines([...medicines.values()], todayRecords, records);
  renderMedicineManagement([...medicines.values()]);
  const count = todayRecords.length;
  const last = records[0];
  byId('last').textContent = last
    ? '今天已记录 ' + count + ' 次 · 最近一次 ' + shortDay.format(last.at) + ' ' + clock.format(last.at)
    : '今天还没记过用药';

  renderCalendar(grouped, medicines, today);

  const history = byId('history');
  const previousDays = new Map([...history.querySelectorAll('details[data-day]')].map(day => [day.dataset.day, day.open]));
  const previousFolds = new Map([...history.querySelectorAll('details[data-history-fold]')].map(fold => [fold.dataset.historyFold, fold.open]));
  history.replaceChildren();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayKey = dayKey(today);
  const yesterdayKey = dayKey(yesterday);
  const recentDays = new Map([[todayKey, '今天'], [yesterdayKey, '昨天']]);
  const historyDays = new Map(grouped);
  for (const dateKey of recentDays.keys()) if (!historyDays.has(dateKey)) historyDays.set(dateKey, []);
  const olderGroups = [...historyDays].filter(([dateKey]) => dateKey < yesterdayKey);
  let archive = null;
  const monthContainers = new Map();
  if (olderGroups.length) {
    archive = element('details', '');
    archive.className = 'history-archive';
    archive.dataset.historyFold = 'archive';
    archive.open = previousFolds.get('archive') ?? false;
    const summary = element('summary', '');
    summary.append(element('span', '更早记录'), element('small', olderGroups.reduce((count, [, records]) => count + records.length, 0) + ' 条 · 按月份查看'));
    archive.append(summary);
    const months = new Map();
    for (const [dateKey, group] of olderGroups) {
      const monthKey = dateKey.slice(0, 7);
      const count = months.get(monthKey) ?? { days: 0, records: 0 };
      count.days++;
      count.records += group.length;
      months.set(monthKey, count);
    }
    for (const [monthKey, count] of [...months].sort(([a], [b]) => b.localeCompare(a))) {
      const month = element('details', '');
      month.className = 'history-month';
      month.dataset.historyFold = monthKey;
      month.open = previousFolds.get(monthKey) ?? false;
      const summary = element('summary', '');
      const [year, number] = monthKey.split('-');
      summary.append(element('span', year + '年' + Number(number) + '月'), element('small', count.days + ' 天 · ' + count.records + ' 条记录'));
      month.append(summary);
      archive.append(month);
      monthContainers.set(monthKey, month);
    }
  }
  for (const [dateKey, group] of [...historyDays].sort(([a], [b]) => b.localeCompare(a))) {
    const day = element('details', '');
    day.className = 'history-day';
    day.dataset.day = dateKey;
    day.open = previousDays.get(dateKey) ?? recentDays.has(dateKey);
    const date = new Date(dateKey + 'T12:00:00');
    const prefix = recentDays.has(dateKey) ? recentDays.get(dateKey) + ' · ' : '';
    const summary = element('summary', '');
    summary.append(element('span', prefix + fullDay.format(date)), element('small', group.length + ' 条记录'));
    day.append(summary);
    if (!group.length) day.append(element('p', '这一天还没有用药记录。'));
    for (const record of group) {
      const row = element('div', '');
      row.className = 'record';
      const time = element('time', clock.format(record.at) + describe(record, medicines));
      time.dateTime = new Date(record.at).toISOString();
      const edit = element('button', '修改');
      edit.onclick = () => openEditor(record);
      const remove = element('button', '删除');
      remove.onclick = () => {
        if (confirm('删除 ' + fullDay.format(record.at) + ' ' + clock.format(record.at) + ' 的记录？')) {
          update(state => ({ ...state, records: state.records.filter(item => item.id !== record.id) }), '已删除记录。');
        }
      };
      const actions = element('div', '');
      actions.className = 'actions';
      actions.style.marginTop = '0';
      actions.append(edit, remove);
      row.append(time, actions);
      day.append(row);
    }
    (dateKey < yesterdayKey ? monthContainers.get(dateKey.slice(0, 7)) : history).append(day);
  }
  if (archive) history.append(archive);
  visitsUI.render();
}

function renderCalendar(grouped, medicines, today) {
  if (calendarMedicineId && !medicines.has(calendarMedicineId)) calendarMedicineId = '';
  const filters = byId('calendar-filters');
  filters.replaceChildren();
  const choices = [{ id: '', name: '全部药物', icon: '' }, ...medicines.values()];
  for (const medicine of choices) {
    const filter = element('button', '');
    if (medicine.icon) filter.append(medicineSymbol(medicine.icon), ' ');
    filter.append(medicine.name + (medicine.archived ? '（已收起）' : ''));
    filter.setAttribute('aria-pressed', String(calendarMedicineId === medicine.id));
    filter.onclick = () => {
      calendarMedicineId = medicine.id;
      renderCalendar(grouped, medicines, today);
      filters.children[choices.indexOf(medicine)].focus();
    };
    filters.append(filter);
  }
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const leading = (firstDay.getDay() + 6) % 7;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const todayKey = dayKey(today);
  const grid = byId('calendar-days');
  const detail = byId('calendar-detail');
  byId('calendar-month').textContent = year + '年' + (month + 1) + '月';
  grid.replaceChildren();
  detail.replaceChildren();

  function showDay(date, records) {
    detail.replaceChildren(element('h3', fullDay.format(date) + (calendarMedicineId ? ' · ' + medicines.get(calendarMedicineId).name : '')));
    if (!records.length) {
      detail.append(element('p', calendarMedicineId ? '这一天没有该药物的记录。' : '这一天还没有用药记录。'));
      return;
    }
    const list = element('ul', '');
    for (const record of [...records].reverse()) {
      list.append(element('li', clock.format(record.at) + describe(record, medicines)));
    }
    detail.append(list);
  }

  for (let i = 0; i < leading; i++) grid.append(element('span', ''));
  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(year, month, day);
    const key = dayKey(date);
    const dayRecords = grouped.get(key) ?? [];
    const records = calendarMedicineId ? dayRecords.filter(record => record.medicineId === calendarMedicineId) : dayRecords;
    const cell = element('button', '');
    cell.className = 'calendar-day';
    const counts = new Map();
    for (const record of records) {
      const id = record.medicineId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const badges = element('span', '');
    badges.className = 'calendar-badges';
    badges.setAttribute('aria-hidden', 'true');
    const labels = [];
    for (const [id, count] of counts) {
      const medicine = medicines.get(id);
      const label = (medicine?.name ?? '未分类') + ' ' + count + ' 次';
      labels.push(label);
      const badge = element('small', '');
      badge.append(medicineSymbol(medicine?.icon ?? '•'), String(count));
      badge.title = label;
      badges.append(badge);
    }
    cell.setAttribute('aria-label', fullDay.format(date) + '，' + (labels.join('，') || '暂无记录'));
    cell.setAttribute('aria-pressed', String(key === selectedDay));
    if (key === todayKey) cell.setAttribute('aria-current', 'date');
    cell.append(element('span', day), badges);
    if (calendarMedicineId) {
      const times = element('span', '');
      times.className = 'calendar-times';
      for (const record of [...records].reverse()) times.append(element('span', clock.format(record.at)));
      cell.append(times);
    }
    cell.onclick = () => {
      grid.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
      selectedDay = key;
      cell.setAttribute('aria-pressed', 'true');
      showDay(date, records);
    };
    grid.append(cell);
    if (key === selectedDay) showDay(date, records);
  }

  function moveMonth(offset) {
    calendarMonth = new Date(year, month + offset, 1);
    selectedDay = calendarMonth.getFullYear() === today.getFullYear() && calendarMonth.getMonth() === today.getMonth()
      ? todayKey
      : dayKey(calendarMonth);
    renderCalendar(grouped, medicines, today);
  }

  byId('prev-month').onclick = () => moveMonth(-1);
  byId('next-month').onclick = () => moveMonth(1);
}

function openEditor(record) {
  editingId = record?.id ?? null;
  byId('edit-title').textContent = record ? '修改时间' : '补记时间';
  byId('edit-status').textContent = '';
  const medicines = loadMedicines();
  const picker = byId('record-medicine');
  const unclassified = element('option', '未分类');
  unclassified.value = '';
  picker.replaceChildren(unclassified);
  for (const medicine of medicines) {
    const option = element('option', medicine.name + (medicine.archived ? '（已收起）' : ''));
    option.value = medicine.id;
    picker.append(option);
  }
  byId('medicine-fields').hidden = medicines.length === 0;
  picker.value = record?.medicineId ?? (record ? '' : medicines.find(item => !item.archived)?.id ?? '');
  byId('quantity').value = record?.quantity ?? 1;
  updateQuantityField();
  const initial = record ? new Date(record.at) : new Date();
  whenDate.max = dayKey(new Date());
  whenDate.value = dayKey(initial);
  const [hh, mm] = clock.format(initial).split(':');
  whenHour.value = hh;
  whenMinute.value = mm;
  editor.showModal();
}

function updateQuantityField() {
  const selected = byId('record-medicine').value;
  const medicine = loadMedicines().find(item => item.id === selected);
  const quantity = byId('quantity');
  quantity.disabled = !medicine;
  byId('quantity-label').textContent = medicine ? '本次用量（' + unit(medicine) + '）' : '本次用量';
}

byId('record-medicine').onchange = updateQuantityField;
const medicineEditor = byId('medicine-editor');
const iconPicker = byId('medicine-icon');
const kindPicker = byId('medicine-kind');
for (const [kind, type] of Object.entries(medicineTypes)) {
  const option = element('option', type.label);
  option.value = kind;
  kindPicker.append(option);
}
const autoIcon = element('option', '按类型自动选择');
autoIcon.value = '';
iconPicker.append(autoIcon);
for (const [icon, label] of iconChoices) {
  const option = element('option', (pillColors[icon] ? '💊' : icon) + ' ' + label);
  option.value = icon;
  iconPicker.append(option);
}

function renderIconPreview() {
  const grid = byId('medicine-icon-grid');
  grid.replaceChildren();
  for (const [value, label] of [['', '按类型自动选择'], ...iconChoices]) {
    const button = element('button', '');
    button.type = 'button';
    button.className = 'icon-choice';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(iconPicker.value === value));
    button.append(medicineSymbol(value || defaultIcon(kindPicker.value)));
    if (!value) {
      const marker = element('small', '↻');
      marker.setAttribute('aria-hidden', 'true');
      button.append(marker);
    }
    button.onclick = () => {
      iconPicker.value = value;
      renderIconPreview();
      grid.children[[['', '按类型自动选择'], ...iconChoices].findIndex(([id]) => id === value)].focus();
    };
    grid.append(button);
  }
}
iconPicker.onchange = renderIconPreview;
kindPicker.onchange = renderIconPreview;

function openMedicineEditor(medicine) {
  editingMedicineId = medicine?.id ?? null;
  byId('medicine-title').textContent = medicine ? '修改药物' : '添加药物';
  byId('medicine-save').textContent = medicine ? '保存' : '添加';
  byId('medicine-name').value = medicine?.name ?? '';
  kindPicker.value = medicine?.kind ?? 'oral';
  kindPicker.disabled = Boolean(medicine);
  iconPicker.value = medicine?.icon ?? '';
  renderIconPreview();
  byId('medicine-status').textContent = '';
  medicineEditor.showModal();
}
byId('add-med').onclick = () => openMedicineEditor();
byId('medicine-cancel').onclick = () => medicineEditor.close();
byId('medicine-form').onsubmit = async event => {
  event.preventDefault();
  const name = byId('medicine-name').value.trim();
  const status = byId('medicine-status');
  if (!name) {
    status.textContent = '请输入药物名称或代号。';
    return;
  }
  const medicineId = editingMedicineId;
  const newId = makeRecord(0).id;
  const kind = kindPicker.value;
  const icon = iconPicker.value;
  const saved = await update(state => {
    if (state.medicines.some(item => item.id !== medicineId && item.name === name)) {
      throw new Error('Duplicate medicine');
    }
    if (medicineId) {
      const medicine = state.medicines.find(item => item.id === medicineId);
      if (!medicine) throw new Error('Missing medicine');
      medicine.name = name;
      medicine.icon = icon || defaultIcon(medicine.kind);
    } else {
      state.medicines.push({ id: newId, name, kind, icon: icon || defaultIcon(kind) });
    }
    return state;
  }, medicineId ? '已保存「' + name + '」。' : '已添加 ' + name + '。', status);
  if (saved) medicineEditor.close();
};

byId('now').onclick = () => {
  const record = makeRecord(Date.now());
  update(state => ({ ...state, records: [...state.records, record] }), '已记录 ' + clock.format(record.at) + '。');
};
byId('manual').onclick = () => openEditor();
byId('cancel').onclick = () => editor.close();
byId('edit-form').onsubmit = async event => {
  event.preventDefault();
  const date = new Date(whenDate.value + 'T' + whenHour.value + ':' + whenMinute.value);
  const status = byId('edit-status');
  if (!whenDate.value || !whenHour.value || !whenMinute.value || !Number.isFinite(date.getTime()) || date.getTime() > Date.now()) {
    status.textContent = '请选择一个有效的服药时间。';
    return;
  }
  const targetId = editingId;
  const record = targetId ? { id: targetId, at: date.getTime() } : makeRecord(date.getTime());
  const medicineId = byId('record-medicine').value;
  if (medicineId) {
    const quantity = byId('quantity').valueAsNumber;
    if (!validQuantity(quantity)) {
      status.textContent = '请输入 1 到 999 之间的整数。';
      return;
    }
    Object.assign(record, { medicineId, quantity });
  }
  const saved = await update(state => {
    if (targetId && !state.records.some(item => item.id === targetId)) {
      throw new Error('Record removed on another device');
    }
    return {
      ...state,
      records: targetId
        ? state.records.map(item => item.id === targetId ? record : item)
        : [...state.records, record]
    };
  }, '已保存。', status);
  if (saved) {
    editor.close();
    byId('status').textContent = '已保存 ' + clock.format(record.at) + '。';
  }
};

const backupStatus = byId('backup-status');
byId('export').onclick = () => {
  try {
    const blob = new Blob([JSON.stringify({ version: 3, ...loadState() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = element('a', '');
    link.href = url;
    link.download = 'medicine-service-' + dayKey(new Date()) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    backupStatus.textContent = '已生成备份文件。';
  } catch {
    backupStatus.textContent = '无法读取记录，导出失败。';
  }
};
byId('import').onclick = () => byId('file').click();
byId('file').onchange = async event => {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (![1, 2, 3].includes(backup?.version)) throw new Error('Invalid backup version');
    const imported = validate(backup.records);
    const importedMedicines = backup.version >= 2 ? validateMedicines(backup.medicines) : [];
    await mergeBackup(imported, importedMedicines, backupStatus, backup.version >= 3 ? validateVisits(backup.visits) : []);
  } catch {
    backupStatus.textContent = '无法导入。请选择「吃药服务」导出的 JSON 备份。';
  } finally {
    input.value = '';
  }
};

async function mergeBackup(records, medicines, status, visits = []) {
  return update(state => {
    const medicineIds = new Set(state.medicines.map(item => item.id));
    const merged = [...state.medicines, ...medicines.filter(item => !medicineIds.has(item.id))];
    const mergedIds = new Set(merged.map(item => item.id));
    if (records.some(record => record.medicineId && !mergedIds.has(record.medicineId))) {
      throw new Error('Missing medicine');
    }
    const recordIds = new Set(state.records.map(item => item.id));
    const visitIds = new Set((state.visits ?? []).map(item => item.id));
    return { ...state, medicines: merged, records: [...state.records, ...records.filter(item => !recordIds.has(item.id))], visits: [...(state.visits ?? []), ...visits.filter(item => !visitIds.has(item.id))] };
  }, '已合并到云端，重复记录已跳过。', status);
}

let refreshing = false;
async function refreshJournal() {
  if (!signedInUser || refreshing || document.hidden) return;
  const generation = accountGeneration;
  const userId = signedInUser.id;
  refreshing = true;
  try {
    await writeQueue;
    const current = await readJournal(userId);
    if (generation !== accountGeneration) return;
    if (JSON.stringify(cloudState) !== JSON.stringify(current.state)) {
      cloudState = current.state;
      render();
    }
    byId('sync-state').textContent = '已同步 · ' + clock.format(Date.now());
  } catch {
    if (generation === accountGeneration) byId('sync-state').textContent = '读取云端失败，请检查网络后重试';
  } finally {
    refreshing = false;
  }
}

async function showAccount(session) {
  const user = session?.user ?? null;
  document.body.classList.toggle('signed-out', !user);
  byId('account-title').textContent = user ? '☁️ 我的云端小本本' : '欢迎回来';
  emailUI.setUser(user);
  if (signedInUser?.id === user?.id && cloudState) return;
  const generation = ++accountGeneration;
  signedInUser = user;
  cloudState = null;
  visitsUI.reset();
  byId('journal').hidden = true;
  editor.close();
  medicineEditor.close();
  byId('login').hidden = Boolean(user);
  byId('logout').hidden = !user;
  byId('account-name').textContent = user ? '已登录 · ' + (user.user_metadata.user_name || user.email || '我的账号') : '登录账号，在手机和电脑继续记录。';
  byId('sync-state').textContent = user ? '正在读取云端记录…' : '你的记录仅在登录后可见。';
  if (!user) return;
  try {
    const { error } = await client.from('medicine_journals').upsert(
      { user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true }
    );
    if (error) throw error;
    const current = await readJournal(user.id);
    if (generation !== accountGeneration) return;
    cloudState = current.state;
    byId('journal').hidden = false;
    render();
    byId('sync-state').textContent = '已同步 · ' + clock.format(Date.now());
    const local = checkedState(JSON.parse(localStorage.getItem(key) ?? '[]'));
    byId('migrate-local').hidden = !local.records.length && !local.medicines.length;
  } catch {
    if (generation === accountGeneration) byId('sync-state').textContent = '云端读取失败，请点「重新同步」重试。';
  }
}

byId('login').onclick = async () => {
  const { error } = await client.auth.signInWithOAuth({
    provider: 'github', options: { redirectTo: location.origin + location.pathname }
  });
  if (error) byId('sync-state').textContent = '登录未完成，请重试。';
};
byId('logout').onclick = async () => {
  await writeQueue;
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) byId('sync-state').textContent = '退出失败，请重试。';
};
byId('sync-retry').onclick = async () => {
  const { data, error } = await client.auth.getSession();
  if (error) return;
  if (!cloudState) await showAccount(data.session);
  else await refreshJournal();
};
byId('migrate-local').onclick = async () => {
  if (!confirm('把此浏览器里的药物和用药记录合并到当前登录账号的 Supabase 云端数据库？')) return;
  try {
    const local = checkedState(JSON.parse(localStorage.getItem(key) ?? '[]'));
    await mergeBackup(local.records, local.medicines, byId('sync-state'));
  } catch {
    byId('sync-state').textContent = '本机旧记录读取失败，可使用导出的 JSON 备份导入。';
  }
};
const visitsUI = initVisits({ loadState, update });
const emailUI = initEmailAuth({ client, onSession:showAccount, waitForWrites:()=>writeQueue, getCurrentUser:()=>signedInUser });

client.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => showAccount(session), 0);
});
client.auth.getSession().then(({ data, error }) => {
  if (error) byId('sync-state').textContent = '登录状态读取失败，请重试。';
  else showAccount(data.session);
});
window.addEventListener('focus', refreshJournal);
document.addEventListener('visibilitychange', refreshJournal);
setInterval(refreshJournal, 20000);

