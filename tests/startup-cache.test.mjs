import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function setup(cached, fail = false) {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const nodes = new Map();
  const cachedState = { medicines: [], records: [{ id: 'old' }], visits: [] };
  const latestState = { medicines: [], records: [{ id: 'new' }], visits: [] };
  const removed = [];
  const context = vm.createContext({
    document: { body: { classList: { toggle() {} } } },
    byId(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: '' });
      return nodes.get(id);
    },
    signedInUser: null, cloudState: null, cloudRevision: -1, cacheUserId: null, accountGeneration: 0,
    emailUI: { setUser() {} }, visitsUI: { reset() {} },
    editor: { close() {} }, medicineEditor: { close() {} },
    render() {}, clock: { format() { return '12:00'; } },
    localStorage: { getItem() { return '[]'; } }, key: 'legacy',
    checkedState() { return { records: [], medicines: [] }; },
    journalCache: {
      read(id) { return cached && id === 'alice' ? { state: cachedState, revision: 1 } : null; },
      write() {}, remove(id) { removed.push(id); }
    },
    client: { from() { return { async upsert() { await gate; return { error: fail ? Error('Offline') : null }; } }; } },
    async readJournal() { return { state: latestState, revision: 2 }; }
  });
  vm.runInContext(source.slice(source.indexOf('function acceptJournal('), source.indexOf('let writeQueue')), context);
  vm.runInContext(source.slice(source.indexOf('function revealApp()'), source.indexOf("byId('logout').onclick")), context);
  return { context, nodes, finish, removed, cachedState, latestState };
}
const session = { user: { id: 'alice', email: 'alice@example.test', user_metadata: {} } };

test('startup reveals account cache before network responds, then replaces it with latest data', async () => {
  const f = setup(true);
  const task = f.context.showAccount(session);
  assert.equal(f.nodes.get('app-main').hidden, false);
  assert.equal(f.context.cloudState, f.cachedState);
  f.finish();
  await task;
  assert.equal(f.context.cloudState, f.latestState);
  assert.equal(f.context.cloudRevision, 2);
});
test('failed background refresh keeps cached records visible', async () => {
  const f = setup(true, true);
  const task = f.context.showAccount(session);
  f.finish(); await task;
  assert.equal(f.nodes.get('app-main').hidden, false);
  assert.equal(f.context.cloudState, f.cachedState);
  assert.match(f.nodes.get('sync-state').textContent, /上次保存/);
});
test('signout during startup clears the account and rejects a late cloud response', async () => {
  const f = setup(true);
  const task = f.context.showAccount(session);
  await f.context.showAccount(null);
  f.finish(); await task;
  assert.equal(f.context.cloudState, null);
  assert.deepEqual(f.removed, ['alice']);
  assert.equal(f.nodes.get('journal').hidden, true);
});
test('first launch waits for cloud when there is no account cache', async () => {
  const f = setup(false);
  const task = f.context.showAccount(session);
  assert.equal(f.nodes.get('app-main').hidden, true);
  f.finish(); await task;
  assert.equal(f.nodes.get('app-main').hidden, false);
});
