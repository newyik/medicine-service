import test from 'node:test';
import assert from 'node:assert/strict';
import { createJournalCache } from '../journal-cache.js';

function fixture() {
  const rows = new Map();
  const storage = {
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: key => rows.delete(key)
  };
  const validate = state => {
    if (!state || !Array.isArray(state.records)) throw Error('Invalid state');
    return state;
  };
  return { rows, cache: createJournalCache(storage, validate) };
}
test('cached records stay scoped to the authenticated account and are removed on logout', () => {
  const { cache } = fixture();
  const state = { records: [{ id: 'one' }], medicines: [], visits: [] };
  cache.write('alice', state, 5);
  assert.equal(cache.read('bob'), null);
  assert.deepEqual(cache.read('alice').state, state);
  assert.equal(cache.read('alice').revision, 5);
  cache.remove('alice');
  assert.equal(cache.read('alice'), null);
});
test('corrupt, invalid and mismatched caches fall back to the cloud', () => {
  const { rows, cache } = fixture();
  cache.write('alice', { records: [] }, 5);
  const key = [...rows.keys()][0];
  for (const value of ['{', JSON.stringify({ userId: 'bob', state: { records: [] }, revision: 5, savedAt: 1 }),
    JSON.stringify({ userId: 'alice', state: {}, revision: 5, savedAt: 1 }),
    JSON.stringify({ userId: 'alice', state: { records: [] }, revision: -1, savedAt: 1 })]) {
    rows.set(key, value);
    assert.equal(cache.read('alice'), null);
  }
});
test('full or unavailable local storage never blocks cloud operation', () => {
  const fail = () => { throw Error('Storage denied'); };
  const cache = createJournalCache({ getItem: fail, setItem: fail, removeItem: fail }, state => state);
  assert.equal(cache.read('alice'), null);
  assert.doesNotThrow(() => cache.write('alice', { records: [] }, 1));
  assert.doesNotThrow(() => cache.remove('alice'));
});
