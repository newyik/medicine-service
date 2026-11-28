// 只用虚构数值，不放任何真实体检数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCheckups, parseRange, itemStatus, itemHistory, itemKey, summarize, parseCheckupImport, mergeCheckups } from '../checkups.js';

const sample = (id = 'c1', date = '2030-01-15', value = '50') => ({
  id, date, hospital: ' 示例诊所 ',
  items: [
    { group: '生化', name: '示例A', value, unit: 'U/L', ref: '10~40' },
    { group: '血液', name: '示例B', value: '3.0', unit: 'g/dL', ref: '3.5-5.2' },
    { group: '激素', name: '示例C', value: '12', unit: 'pg/mL', ref: '下記参照' },
    { group: '尿检', name: '示例D', value: '(-)', ref: '(-)' }
  ]
});

test('old journals without checkups default to an empty list', () => assert.deepEqual(validateCheckups(), []));

test('checkup fields are trimmed and unknown groups become 其他', () => {
  const [c] = validateCheckups([{ ...sample(), items: [{ name: 'X', value: '1', group: '奇怪' }] }]);
  assert.equal(c.hospital, '示例诊所');
  assert.equal(c.items[0].group, '其他');
  assert.equal(c.items[0].flag, '');
});

test('reject bad dates, duplicate ids, missing values and bad flags', () => {
  assert.throws(() => validateCheckups([{ ...sample(), date: '2030-02-30' }]));
  assert.throws(() => validateCheckups([sample(), sample()]));
  assert.throws(() => validateCheckups([{ ...sample(), items: [{ name: 'X', value: '' }] }]));
  assert.throws(() => validateCheckups([{ ...sample(), items: [{ name: 'X', value: '1', flag: 'bad' }] }]));
  assert.throws(() => validateCheckups([{ ...sample(), notes: 'a'.repeat(3001) }]));
});

test('reference ranges in common formats', () => {
  assert.deepEqual(parseRange('10~40'), { low: 10, high: 40 });
  assert.deepEqual(parseRange('1.008～1.034'), { low: 1.008, high: 1.034 });
  assert.deepEqual(parseRange('40以下'), { low: null, high: 40 });
  assert.deepEqual(parseRange('≤0.3'), { low: null, high: 0.3 });
  assert.deepEqual(parseRange('100以上'), { low: 100, high: null });
  assert.deepEqual(parseRange('下記参照'), { low: null, high: null });
});

test('automatic high/low and manual flags win', () => {
  const [c] = validateCheckups([sample()]);
  assert.equal(itemStatus(c.items[0]), 'high');
  assert.equal(itemStatus(c.items[1]), 'low');
  assert.equal(itemStatus(c.items[2]), '');
  assert.equal(itemStatus({ ...c.items[2], flag: 'low' }), 'low');
  assert.equal(itemStatus({ ...c.items[0], value: '20' }), 'normal');
  assert.deepEqual(summarize(c), { high: 1, low: 1, total: 4 });
});

test('history collects the same item across reports oldest first', () => {
  const list = validateCheckups([sample('c2', '2030-06-01', '30'), sample('c1', '2030-01-15', '50')]);
  const history = itemHistory(list, itemKey({ name: '示例 A' }));
  assert.deepEqual(history.map(p => [p.date, p.number, p.status]), [['2030-01-15', 50, 'high'], ['2030-06-01', 30, 'normal']]);
});

test('AI import accepts one report, arrays, wrapped lists and code fences', () => {
  let n = 0; const id = () => 'gen-' + ++n;
  assert.equal(parseCheckupImport(JSON.stringify({ ...sample(), id: undefined }), id)[0].id, 'gen-1');
  assert.equal(parseCheckupImport(JSON.stringify([sample('a'), sample('b')]), id).length, 2);
  assert.equal(parseCheckupImport('```json\n' + JSON.stringify({ checkups: [sample('z')] }) + '\n```', id)[0].id, 'z');
  assert.throws(() => parseCheckupImport('不是 JSON'), /JSON/);
  assert.throws(() => parseCheckupImport(JSON.stringify({ date: 'x' })), /格式/);
});

test('merging skips reports that already exist', () => {
  const existing = validateCheckups([sample('a')]);
  const merged = mergeCheckups(existing, validateCheckups([{ ...sample('a'), hospital: '改过' }, sample('b')]));
  assert.deepEqual(merged.map(c => [c.id, c.hospital]), [['a', '示例诊所'], ['b', '示例诊所']]);
});
