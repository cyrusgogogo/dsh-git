import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { GitModel } from '../src/client/model.mjs';
import { Request as GitRequest } from '../src/shared/protocol.mjs';
import { createHandler, Config } from '../src/index.mjs';

const ready = { state: 'ready', head: 'a'.repeat(40), branch: 'main', branches: [], files: [], worktrees: [], remotes: [], root: 'D:/repo' };
const success = (value) => ({ ok: true, value });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('unloading an in-flight mutation never starts a post-disposal refresh', async () => {
  const calls = []; let resolve;
  const model = new GitModel((payload) => { calls.push(payload); return new Promise((r) => { resolve = r; }); }, { storage: null });
  model.patch({ open: true, workspaceId: 'w', data: ready });
  const pending = model.mutate({ action: 'fetch' });
  model.dispose(); resolve(success({ message: 'done' }));
  assert.equal(await pending, false); await tick();
  assert.equal(calls.length, 1); assert.equal(calls[0].op, 'mutate');
  await assert.rejects(model.request('after', { op: 'snapshot' }), { name: 'AbortError' });
});
test('confirmation retains the expected HEAD from the moment the dialog opened', async (t) => {
  const calls = [];
  const model = new GitModel(async (payload) => { calls.push(payload); if (payload.op === 'snapshot') return success(ready); return success({ message: 'done' }); }, { storage: null });
  t.after(() => model.dispose());
  model.patch({ workspaceId: 'w', data: ready });
  model.showDialog({ type: 'confirm', mutation: { action: 'fetch' } });
  const expected = model.state.dialog.expected;
  model.patch({ data: { ...ready, head: 'b'.repeat(40) } });
  await model.mutate({ action: 'fetch' }, { expected });
  assert.equal(calls[0].expected.head, 'a'.repeat(40));
});
test('main-view session selects its registered workspace rather than process cwd', () => {
  const model = new GitModel(async () => success({}), { storage: null });
  const items = [{ workspaceId: 'one', path: 'D:/one', sessionIds: ['s1'] }, { workspaceId: 'two', path: 'D:/two', sessionIds: ['s2'] }];
  model.syncContext({ items }, { byId: { s1: { id: 's1', retainedBy: {} }, s2: { id: 's2', retainedBy: { mainView: 1 } } } });
  assert.equal(model.state.workspaceId, 'two'); assert.equal(model.state.hasSession, true);
  model.dispose();
});
test('each Git tab keeps its own filter state; the last close safely collapses the panel', () => {
  const model = new GitModel(async () => success({}), { storage: null });
  model.patch({ open: true });
  model.filter({ search: 'first' }); const first = model.state.activeTab;
  model.addTab('git'); model.filter({ search: 'second' }); const second = model.state.activeTab;
  model.activateTab(first); assert.equal(model.tab().search, 'first');
  model.closeTab(first); assert.equal(model.tab().id, second); assert.equal(model.tab().search, 'second');
  model.closeTab(second); assert.equal(model.state.open, false); assert.equal(model.state.tabs.length, 1);
  model.dispose();
});
test('late canceled requests do not overwrite a newly selected workspace', async (t) => {
  let resolveOld;
  const model = new GitModel((payload) => payload.workspaceId === 'old' ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(success({ state: 'not-repository', workspace: { path: 'D:/new' }, message: 'new' })), { storage: null });
  t.after(() => model.dispose());
  model.patch({ open: true, workspaceId: 'old' });
  const old = model.refresh();
  model.selectWorkspace('new'); await tick();
  resolveOld(success(ready)); await old; await tick();
  assert.equal(model.state.workspaceId, 'new'); assert.equal(model.state.data.message, 'new'); assert.equal(model.state.error, null);
});
test('RPC handler validates envelopes, preserves correlation and marks data uncacheable', async () => {
  let requestSeen;
  const handler = createHandler({ execute: async (payload, signal) => { requestSeen = { payload, signal }; return { state: 'not-repository' }; } });
  const response = await handler(new Request('http://localhost/api/dsh-git', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'id-1', method: 'dsh-git', payload: { op: 'snapshot', workspaceId: 'w' } }) }));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { type: 'server-response', rpcId: 'id-1', result: { ok: true, value: { state: 'not-repository' } } });
  assert.equal(requestSeen.payload.workspaceId, 'w'); assert.ok(requestSeen.signal instanceof AbortSignal);
  const invalid = await handler(new Request('http://localhost/api/dsh-git', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'id-2', method: 'dsh-git', payload: { op: 'arbitrary-command', workspaceId: 'w' } }) }));
  assert.equal((await invalid.json()).result.error.code, 'INVALID_REQUEST'); assert.ok(Config['~standard']);
});
test('history date presets and cherry-pick hashes are validated at the protocol boundary', () => {
  const scope = { workspaceId: 'w' };
  assert.equal(GitRequest.parse({ op: 'history', ...scope }).dateRange, '');
  for (const dateRange of ['today', '7d', '30d', '90d', '1y']) assert.equal(GitRequest.parse({ op: 'history', ...scope, dateRange }).dateRange, dateRange);
  assert.equal(GitRequest.safeParse({ op: 'history', ...scope, dateRange: '--all' }).success, false);
  const mutation = { op: 'mutate', ...scope, expected: { head: ready.head, branch: 'main' }, confirmed: true };
  assert.equal(GitRequest.parse({ ...mutation, mutation: { action: 'cherryPick', hash: ready.head } }).mutation.hash, ready.head);
  assert.equal(GitRequest.safeParse({ ...mutation, mutation: { action: 'cherryPick', hash: '--abort' } }).success, false);
  assert.equal(GitRequest.parse({ ...mutation, mutation: { action: 'continueOperation', operation: 'cherry-pick' } }).mutation.operation, 'cherry-pick');
});
test('date, user and branch filters remain independent per tab and reach the history request', async (t) => {
  const calls = [];
  const model = new GitModel(async (payload) => { calls.push(payload); return success({ commits: [], hasMore: false }); }, { storage: null });
  t.after(() => model.dispose());
  model.patch({ workspaceId: 'w', data: ready });
  model.filter({ dateRange: '30d', author: 'Alex', ref: 'refs/heads/topic' });
  const first = model.tab().id;
  await model.loadHistory();
  assert.equal(calls[0].dateRange, '30d'); assert.equal(calls[0].author, 'Alex'); assert.equal(calls[0].ref, 'refs/heads/topic');
  model.addTab('git'); assert.equal(model.tab().dateRange, '');
  model.filter({ dateRange: '7d' }); model.activateTab(first);
  assert.equal(model.tab().dateRange, '30d'); assert.equal(model.tab().author, 'Alex');
});
test('changing a filter cancels an old history result before it can reselect a stale commit', async (t) => {
  let resolve;
  const model = new GitModel(() => new Promise((done) => { resolve = done; }), { storage: null });
  t.after(() => model.dispose());
  model.patch({ workspaceId: 'w', data: ready });
  const pending = model.loadHistory();
  model.filter({ dateRange: '7d' });
  resolve(success({ commits: [{ hash: ready.head }], hasMore: false }));
  await pending;
  assert.deepEqual(model.tab().commits, []); assert.equal(model.tab().selected, null); assert.equal(model.state.error, null);
});
test('a failed mutation keeps its error visible while refreshing the interrupted operation', async (t) => {
  const model = new GitModel(async (payload) => {
    if (payload.op === 'mutate') return { ok: false, error: { code: 'GIT_COMMAND_FAILED', message: '优选发生冲突' } };
    if (payload.op === 'snapshot') return success({ ...ready, operation: 'cherry-pick' });
    return success({ commits: [], hasMore: false });
  }, { storage: null });
  t.after(() => model.dispose());
  model.patch({ open: true, workspaceId: 'w', data: ready });
  model.showDialog({ type: 'confirm', mutation: { action: 'cherryPick', hash: 'b'.repeat(40) } });
  assert.equal(await model.mutate(model.state.dialog.mutation), false);
  assert.equal(model.state.error.message, '优选发生冲突'); assert.equal(model.state.data.operation, 'cherry-pick');
  assert.equal(model.state.dialog.type, 'confirm'); assert.equal(model.state.busy, '');
});
test('published client registers lazily through the installed DSH facade', async () => {
  const content = await readFile('dist/client.js', 'utf8');
  let definition;
  vm.runInNewContext(content, { window: { __ModuleLoader__: { load: (row) => { definition = row; } } } });
  assert.equal(definition.id, 'dsh-git'); assert.equal(typeof definition.factory, 'function');
  const require = createRequire(import.meta.url);
  const allowed = new Set(['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client']);
  const exported = definition.factory((name) => { assert.ok(allowed.has(name), `Unexpected external module ${name}`); return require(name); });
  assert.equal(typeof exported.apply, 'function'); assert.ok(exported.inject.includes('connection'));
});
