// 体检报告：每份报告有日期、医院和一串检查项目。
// 数据放在账号那一行 JSON 的顶层字段 checkups 里。
export const checkupGroups = ['血液', '生化', '激素', '尿检', '其他'];
const flags = ['', 'high', 'low', 'normal'];
const textLimits = { hospital: 200, department: 200, lab: 200, notes: 3000 };
const itemLimits = { name: 100, group: 20, value: 60, unit: 40, ref: 120, note: 300 };

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function cleanText(value, limit) {
  const text = value ?? '';
  if (typeof text !== 'string' && typeof text !== 'number') throw new Error('Invalid checkup field');
  const result = String(text).trim();
  if (result.length > limit) throw new Error('Checkup field too long');
  return result;
}

export function validateCheckups(checkups = []) {
  if (!Array.isArray(checkups) || checkups.length > 500) throw new Error('Invalid checkups');
  const ids = new Set();
  return checkups.map(checkup => {
    if (!checkup || typeof checkup.id !== 'string' || !checkup.id || checkup.id.length > 100 || ids.has(checkup.id)) throw new Error('Invalid checkup');
    ids.add(checkup.id);
    if (!validDate(checkup.date)) throw new Error('Invalid checkup date');
    if (checkup.reportDate && !validDate(checkup.reportDate)) throw new Error('Invalid report date');
    const result = { id: checkup.id, date: checkup.date, reportDate: checkup.reportDate || '' };
    for (const [key, limit] of Object.entries(textLimits)) result[key] = cleanText(checkup[key], limit);
    const items = checkup.items ?? [];
    if (!Array.isArray(items) || items.length > 300) throw new Error('Invalid checkup items');
    result.items = items.map(validateItem);
    if (checkup.deletedAt !== undefined && checkup.deletedAt !== null) {
      if (typeof checkup.deletedAt !== 'number' || !Number.isFinite(checkup.deletedAt)) throw new Error('Invalid deletedAt');
      result.deletedAt = checkup.deletedAt;
    }
    return result;
  });
}

function validateItem(item) {
  if (!item || typeof item !== 'object') throw new Error('Invalid checkup item');
  const result = {};
  for (const [key, limit] of Object.entries(itemLimits)) result[key] = cleanText(item[key], limit);
  if (!result.name || !result.value) throw new Error('Checkup item needs name and value');
  if (!checkupGroups.includes(result.group)) result.group = '其他';
  const flag = item.flag ?? '';
  if (!flags.includes(flag)) throw new Error('Invalid checkup flag');
  result.flag = flag;
  return result;
}

// 把「3.5~5.2」「≤40」「40以下」「1.008～1.034」这类参考范围拆成上下限。
export function parseRange(ref = '') {
  const text = String(ref).replace(/[～〜~－—–]/g, '-').replace(/\s+/g, '');
  let match = text.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)/);
  if (match) return { low: Number(match[1]), high: Number(match[2]) };
  match = text.match(/^(?:≤|<=|<|＜)(\d+(?:\.\d+)?)/) || text.match(/^(\d+(?:\.\d+)?)(?:以下|未満)/);
  if (match) return { low: null, high: Number(match[1]) };
  match = text.match(/^(?:≥|>=|>|＞)(\d+(?:\.\d+)?)/) || text.match(/^(\d+(?:\.\d+)?)(?:以上|超)/);
  if (match) return { low: Number(match[1]), high: null };
  return { low: null, high: null };
}

export function numericValue(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

// 手动标记优先；没有标记就按参考范围自动判断。
export function itemStatus(item) {
  if (item.flag) return item.flag;
  const value = numericValue(item.value);
  if (value === null) return '';
  const { low, high } = parseRange(item.ref);
  if (high !== null && value > high) return 'high';
  if (low !== null && value < low) return 'low';
  if (high !== null || low !== null) return 'normal';
  return '';
}

export function itemKey(item) {
  return item.name.replace(/\s+/g, '').toLocaleLowerCase();
}

// 同一个检查项目在历次报告里的数值，按日期从旧到新。
export function itemHistory(checkups, key) {
  const points = [];
  for (const checkup of checkups) {
    for (const item of checkup.items) {
      if (itemKey(item) === key) points.push({ date: checkup.date, checkupId: checkup.id, hospital: checkup.hospital, ...item, status: itemStatus(item), number: numericValue(item.value) });
    }
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

export function summarize(checkup) {
  let high = 0, low = 0;
  for (const item of checkup.items) {
    const status = itemStatus(item);
    if (status === 'high') high++;
    if (status === 'low') low++;
  }
  return { high, low, total: checkup.items.length };
}

// 解析 AI 整理好的 JSON：可以是一份报告、报告数组，或 {checkups:[...]}。
// 没有 id 的会自动生成，返回的是校验过的报告列表。
export function parseCheckupImport(text, makeId = () => crypto.randomUUID()) {
  let data;
  try { data = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { throw new Error('不是有效的 JSON 格式'); }
  const list = Array.isArray(data) ? data : Array.isArray(data?.checkups) ? data.checkups : [data];
  if (!list.length) throw new Error('里面没有报告');
  try {
    return validateCheckups(list.map(checkup => ({ ...checkup, id: typeof checkup?.id === 'string' && checkup.id ? checkup.id : makeId() })));
  } catch (error) {
    throw new Error('内容格式不对：' + error.message);
  }
}

export const activeCheckups = (list = []) => list.filter(c => !c.deletedAt);
export const deletedCheckups = (list = []) => list.filter(c => c.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);

// 导入前挑出可疑的地方，提醒用户对着纸质单再看一眼。
export function checkupWarnings(checkup, existing = []) {
  const warnings = [];
  if (!checkup.hospital) warnings.push('没填医院');
  const same = activeCheckups(existing).find(c => c.id !== checkup.id && c.date === checkup.date && c.hospital === checkup.hospital);
  if (same) warnings.push(`${checkup.date} ${checkup.hospital || ''} 已经录过一份，可能重复了`);
  const seen = new Set();
  for (const item of checkup.items) {
    const key = itemKey(item);
    if (seen.has(key)) warnings.push(`「${item.name}」出现了两次`);
    seen.add(key);
    if (numericValue(item.value) === null && !/^[(（]?[-+±]/.test(item.value)) warnings.push(`「${item.name}」的数值「${item.value}」不是数字`);
    if (!item.unit && numericValue(item.value) !== null && !/比|A\/G/i.test(item.name)) warnings.push(`「${item.name}」没有单位`);
    if (!item.ref) warnings.push(`「${item.name}」没有参考范围`);
  }
  if (!checkup.items.length) warnings.push('一个检查项目都没有');
  return warnings;
}

// 合并导入：id 相同的报告跳过，不覆盖已有内容。
export function mergeCheckups(existing = [], incoming = []) {
  const ids = new Set(existing.map(item => item.id));
  return [...existing, ...incoming.filter(item => !ids.has(item.id))];
}

export const aiFormatGuide = `请把体检报告整理成下面这种 JSON（可以一次放多份报告）：
{"checkups":[{
  "date":"采血日期 YYYY-MM-DD",
  "reportDate":"出报告日期 YYYY-MM-DD，可省略",
  "hospital":"医院",
  "department":"科室，可省略",
  "lab":"检验公司，可省略",
  "notes":"备注，可省略",
  "items":[{"group":"血液|生化|激素|尿检|其他","name":"检查名","value":"数值（照抄）","unit":"单位","ref":"参考范围，如 3.5~5.2 或 40以下","flag":"high|low|normal 或留空（留空会按参考范围自动判断）","note":"备注，可省略"}]
}]}`;

const el = (tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n; };
const statusText = { high: '偏高 ↑', low: '偏低 ↓', normal: '正常', '': '' };

export function initCheckups({ loadState, update }) {
  const $ = id => document.getElementById(id);
  const page = $('checkups-page'), editor = $('checkup-editor'), form = $('checkup-form'), rows = $('checkup-items');
  const importer = $('checkup-import'), trend = $('checkup-trend');
  const status = () => $('checkup-action-status');
  let editingId = null, onlyAbnormal = false;

  function route() {
    let signedIn = true;
    try { loadState(); } catch { signedIn = false; }
    const active = location.hash === '#checkups';
    page.hidden = !(active && signedIn);
    document.body.classList.toggle('checkups-view', active);
    if (active) document.title = '体检报告 · 吃药服务';
  }
  window.addEventListener('hashchange', () => render());

  function allCheckups() {
    try { return loadState().checkups ?? []; } catch { return []; }
  }
  function checkups() {
    try { return activeCheckups(loadState().checkups ?? []); } catch { return []; }
  }

  function addRow(item = {}) {
    const row = el('div', '', 'checkup-item-row');
    const group = el('select'); group.setAttribute('aria-label', '分类');
    for (const name of checkupGroups) group.append(new Option(name, name));
    group.value = checkupGroups.includes(item.group) ? item.group : '其他';
    const input = (key, placeholder, size) => { const n = el('input'); n.dataset.key = key; n.placeholder = placeholder; n.value = item[key] ?? ''; n.setAttribute('aria-label', placeholder); n.maxLength = itemLimits[key]; if (size) n.className = size; return n; };
    const flag = el('select'); flag.setAttribute('aria-label', '标记');
    for (const [value, label] of [['', '自动'], ['high', '偏高'], ['low', '偏低'], ['normal', '正常']]) flag.append(new Option(label, value));
    flag.value = item.flag ?? '';
    group.dataset.key = 'group'; flag.dataset.key = 'flag';
    const remove = el('button', '×', 'checkup-row-remove'); remove.type = 'button'; remove.setAttribute('aria-label', '删掉这一项');
    remove.onclick = () => row.remove();
    row.append(group, input('name', '检查名'), input('value', '数值', 'short'), input('unit', '单位', 'short'), input('ref', '参考范围'), flag, input('note', '备注'), remove);
    rows.append(row);
  }

  function open(checkup) {
    editingId = checkup?.id ?? null;
    form.reset(); rows.replaceChildren(); $('checkup-status').textContent = '';
    $('checkup-editor-title').textContent = checkup ? '修改体检报告' : '新建体检报告';
    $('checkup-date').value = checkup?.date ?? new Date().toLocaleDateString('sv');
    for (const key of ['reportDate', 'hospital', 'department', 'lab', 'notes']) $('checkup-' + key).value = checkup?.[key] ?? '';
    for (const item of checkup?.items ?? []) addRow(item);
    if (!checkup?.items?.length) addRow();
    editor.showModal();
  }

  form.onsubmit = async event => {
    event.preventDefault();
    const items = [...rows.children].map(row => Object.fromEntries([...row.querySelectorAll('[data-key]')].map(n => [n.dataset.key, n.value])))
      .filter(item => item.name.trim() || item.value.trim());
    const draft = { id: editingId ?? crypto.randomUUID(), date: $('checkup-date').value, items };
    for (const key of ['reportDate', 'hospital', 'department', 'lab', 'notes']) draft[key] = $('checkup-' + key).value;
    let checked;
    try { [checked] = validateCheckups([draft]); }
    catch { $('checkup-status').textContent = '请检查：日期要填，每一项都要有检查名和数值。'; return; }
    const id = editingId;
    const saved = await update(state => ({ ...state, checkups: id ? (state.checkups ?? []).map(c => c.id === id ? checked : c) : [...(state.checkups ?? []), checked] }), '已保存体检报告。', $('checkup-status'));
    if (saved) { editor.close(); status().textContent = '已保存体检报告。'; }
  };
  $('checkup-add-row').onclick = () => addRow();
  $('checkup-cancel').onclick = () => editor.close();
  $('checkup-add').onclick = () => open();

  $('checkup-import-open').onclick = () => { $('checkup-import-text').value = ''; $('checkup-import-preview').replaceChildren(); $('checkup-import-save').disabled = true; $('checkup-import-confirm-row').hidden = true; $('checkup-import-status').textContent = ''; importer.showModal(); };
  $('checkup-import-cancel').onclick = () => importer.close();
  let pending = [];
  $('checkup-import-check').onclick = () => {
    const preview = $('checkup-import-preview'); preview.replaceChildren(); pending = [];
    try {
      pending = parseCheckupImport($('checkup-import-text').value);
      for (const checkup of pending) {
        const s = summarize(checkup);
        preview.append(el('h3', `${checkup.date} ${checkup.hospital || '未填医院'} · ${s.total} 项` + (s.high || s.low ? `（偏高 ${s.high}、偏低 ${s.low}）` : '')));
        const warnings = checkupWarnings(checkup, allCheckups());
        if (warnings.length) {
          const box = el('div', '', 'checkup-warnings'); box.append(el('strong', '⚠️ 请特别留意：'));
          const ul = el('ul'); for (const w of warnings) ul.append(el('li', w)); box.append(ul); preview.append(box);
        }
        const table = el('table', '', 'checkup-verify');
        const head = el('tr'); for (const h of ['分类', '检查名', '数值', '单位', '参考范围', '判断']) head.append(el('th', h));
        table.append(head);
        for (const item of checkup.items) {
          const state = itemStatus(item), tr = el('tr', '', 'flag-row-' + (state || 'none'));
          for (const v of [item.group, item.name + (item.note ? `（${item.note}）` : ''), item.value, item.unit, item.ref]) tr.append(el('td', v));
          tr.append(el('td', statusText[state] || '—', 'flag-' + (state || 'none')));
          table.append(tr);
        }
        preview.append(table);
      }
      $('checkup-import-confirm').checked = false;
      $('checkup-import-confirm-row').hidden = false;
    } catch (error) {
      preview.append(el('p', error.message, 'checkup-error'));
      $('checkup-import-confirm-row').hidden = true;
      $('checkup-import-save').disabled = true;
    }
  };
  $('checkup-import-text').oninput = () => { $('checkup-import-save').disabled = true; $('checkup-import-confirm-row').hidden = true; };
  $('checkup-import-confirm').onchange = event => { $('checkup-import-save').disabled = !event.target.checked || !pending.length; };
  $('checkup-import-save').onclick = async () => {
    const incoming = pending;
    const saved = await update(state => ({ ...state, checkups: mergeCheckups(state.checkups ?? [], incoming) }), `已导入 ${incoming.length} 份报告（重复的已跳过）。`, $('checkup-import-status'));
    if (saved) { importer.close(); status().textContent = `已导入 ${incoming.length} 份报告。`; }
  };
  $('checkup-copy-guide').onclick = () => copy(aiFormatGuide, '已复制格式说明，发给 AI 就行。');
  $('checkup-copy-all').onclick = () => copy(JSON.stringify({ checkups: checkups() }, null, 2), '已复制全部体检数据，可以粘贴给 AI 分析。');
  async function copy(text, message) {
    try { await navigator.clipboard.writeText(text); status().textContent = message; }
    catch { status().textContent = '没能复制，请换个浏览器再试。'; }
  }
  $('checkup-abnormal-only').onchange = event => { onlyAbnormal = event.target.checked; render(); };
  $('checkup-trend-close').onclick = () => trend.close();

  function showTrend(item) {
    const points = itemHistory(checkups(), itemKey(item));
    $('checkup-trend-title').textContent = item.name + ' 的变化';
    const body = $('checkup-trend-body'); body.replaceChildren();
    const numbers = points.filter(p => p.number !== null);
    if (numbers.length >= 2) body.append(chart(numbers, parseRange(item.ref)));
    const list = el('div', '', 'checkup-trend-list');
    for (const point of [...points].reverse()) {
      const row = el('div', '', 'checkup-trend-row');
      row.append(el('span', point.date), el('strong', point.value + (point.unit ? ' ' + point.unit : ''), 'flag-' + (point.status || 'none')), el('small', [statusText[point.status], point.ref && '参考 ' + point.ref].filter(Boolean).join(' · ')));
      list.append(row);
    }
    body.append(list);
    if (points.length < 2) body.append(el('p', '目前只有一次数据，多录几次就能看到变化。', 'field-hint'));
    trend.showModal();
  }

  function chart(points, range) {
    const ns = 'http://www.w3.org/2000/svg', w = 320, h = 140, pad = 24;
    const values = points.map(p => p.number).concat([range.low, range.high].filter(v => v !== null));
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const x = i => pad + (points.length === 1 ? 0 : i * (w - pad * 2) / (points.length - 1));
    const y = v => h - pad - (v - min) * (h - pad * 2) / (max - min);
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('class', 'checkup-chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '数值变化折线图');
    const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
    if (range.low !== null || range.high !== null) {
      const top = y(range.high ?? max), bottom = y(range.low ?? min);
      add('rect', { x: pad, y: top, width: w - pad * 2, height: Math.max(bottom - top, 1), class: 'chart-normal' });
    }
    add('polyline', { points: points.map((p, i) => `${x(i)},${y(p.number)}`).join(' '), class: 'chart-line' });
    points.forEach((p, i) => {
      add('circle', { cx: x(i), cy: y(p.number), r: 4, class: 'chart-dot flag-' + (p.status || 'none') });
      const label = add('text', { x: x(i), y: h - 6, 'text-anchor': 'middle', class: 'chart-label' }); label.textContent = p.date.slice(2).replace(/-/g, '/');
    });
    return svg;
  }

  function renderDeleted() {
    const box = $('checkups-deleted'); box.replaceChildren();
    const removed = deletedCheckups(allCheckups());
    box.hidden = !removed.length;
    if (!removed.length) return;
    box.append(el('summary', '最近删除 · ' + removed.length));
    for (const checkup of removed) {
      const row = el('div', '', 'cancelled-appointment');
      row.append(el('span', `${checkup.date} ${checkup.hospital || '体检报告'} · ${checkup.items.length} 项`));
      const restore = el('button', '恢复'); restore.type = 'button';
      restore.onclick = () => update(state => ({ ...state, checkups: (state.checkups ?? []).map(c => { if (c.id !== checkup.id) return c; const { deletedAt, ...rest } = c; return rest; }) }), '已恢复体检报告。', status());
      const purge = el('button', '彻底删除'); purge.type = 'button';
      purge.onclick = () => {
        if (!confirm(`彻底删除 ${checkup.date} 的体检报告？这一步不能在页面上恢复。`)) return;
        update(state => ({ ...state, checkups: (state.checkups ?? []).filter(c => c.id !== checkup.id) }), '已彻底删除。', status());
      };
      row.append(restore, purge); box.append(row);
    }
  }

  function render() {
    route();
    if (page.hidden) return;
    renderDeleted();
    const list = $('checkups-list'); list.replaceChildren();
    const all = [...checkups()].sort((a, b) => b.date.localeCompare(a.date));
    if (!all.length) {
      const empty = el('div', '', 'visit-empty');
      empty.append(el('div', '🩸', 'visit-empty-icon'), el('h3', '还没有体检报告'), el('p', '把报告照片发给 AI 整理成格式，再点「粘贴导入」；也可以手动新建。'));
      list.append(empty); return;
    }
    for (const checkup of all) {
      const card = el('article', '', 'visit-entry checkup-entry');
      const top = el('div', '', 'visit-entry-top');
      top.append(el('span', '🩸', 'section-icon lilac'), el('h3', checkup.date + ' · ' + (checkup.hospital || '体检报告')));
      card.append(top);
      const meta = [checkup.department, checkup.lab && '检验：' + checkup.lab, checkup.reportDate && '出报告 ' + checkup.reportDate].filter(Boolean).join(' · ');
      if (meta) card.append(el('p', meta, 'visit-meta'));
      const s = summarize(checkup);
      const chips = el('div', '', 'visit-chips');
      chips.append(el('span', s.total + ' 项'));
      if (s.high) chips.append(el('span', '偏高 ' + s.high, 'flag-chip-high'));
      if (s.low) chips.append(el('span', '偏低 ' + s.low, 'flag-chip-low'));
      if (!s.high && !s.low && s.total) chips.append(el('span', '都在范围内', 'completed-tag'));
      card.append(chips);
      const detail = el('details'); detail.append(el('summary', '展开检查结果'));
      for (const group of checkupGroups) {
        const items = checkup.items.filter(item => item.group === group && (!onlyAbnormal || ['high', 'low'].includes(itemStatus(item))));
        if (!items.length) continue;
        const heading = el('h4', group); heading.append(el('small', ' · ' + items.length + ' 项'));
        detail.append(heading);
        const table = el('div', '', 'checkup-table');
        for (const item of items) {
          const state = itemStatus(item);
          const row = el('button', '', 'checkup-row flag-row-' + (state || 'none')); row.type = 'button';
          row.title = '点一下看历次变化';
          const value = el('span', '', 'checkup-value flag-' + (state || 'none'));
          value.append(el('strong', item.value + (state === 'high' ? ' ↑' : state === 'low' ? ' ↓' : '')), el('small', item.unit));
          const name = el('span', '', 'checkup-name'); name.append(el('span', item.name));
          if (item.note) name.append(el('small', item.note, 'checkup-note'));
          row.append(name, value, el('small', item.ref ? '参考 ' + item.ref : '', 'checkup-ref'));
          row.onclick = () => showTrend(item);
          table.append(row);
        }
        detail.append(table);
      }
      if (checkup.notes) detail.append(el('h4', '备注'), el('p', checkup.notes, 'visit-detail-text'));
      const actions = el('div', '', 'actions');
      const edit = el('button', '修改'); edit.type = 'button'; edit.onclick = () => open(checkup);
      const remove = el('button', '删除'); remove.type = 'button';
      remove.onclick = () => {
        if (!confirm(`删除 ${checkup.date} 的体检报告？会先放进「最近删除」，可以恢复。`)) return;
        const at = Date.now();
        update(state => ({ ...state, checkups: (state.checkups ?? []).map(c => c.id === checkup.id ? { ...c, deletedAt: at } : c) }), '已移到「最近删除」，可以恢复。', status());
      };
      actions.append(edit, remove); detail.append(actions);
      card.append(detail);
      list.append(card);
    }
  }

  return { render, reset() { editor.close(); importer.close(); trend.close(); } };
}
