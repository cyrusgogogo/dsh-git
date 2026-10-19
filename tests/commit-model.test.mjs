import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitModel } from '../src/client/model.mjs';
import { DEFAULT_SETTINGS } from '../src/client/settings.mjs';

const ready = { state: 'ready', head: 'a'.repeat(40), branch: 'main', stagedTree: 'b'.repeat(40), branches: [{ kind: 'local', name: 'main', ref: 'refs/heads/main' }], files: [{ path: 'staged.txt', staged: true, unstaged: false }], remotes: ['origin'], operation: null };
const ok = (value) => ({ ok: true, value });
const draft = { message: 'feat: 测试预览', provider: 'test', model: 'model', stagedTree: ready.stagedTree, truncated: false };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function makeModel(t, call, options = { storage: null }) {
  const model = new GitModel(call, options);
  model.patch({ open: true, workspaceId: 'w', data: structuredClone(ready) });
  t.after(() => model.dispose());
  return model;
}

test('AI preview sends staged scope, selected route and prompt but never submits', async (t) => {
  const calls = [];
  const model = makeModel(t, async (payload) => { calls.push(payload); return ok(draft); });
  model.patch({ settings: { ...model.state.settings, provider: 'test', model: 'model', prompt: '团队规范' } });
  model.showDialog({ type: 'commit', ai: true });
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { op: 'aiCommit', workspaceId: 'w', expected: { head: ready.head, branch: 'main' }, provider: 'test', model: 'model', prompt: '团队规范' });
  assert.equal(model.state.aiBusy, false);
  assert.equal(model.state.aiDraft.message, draft.message);
  assert.equal(model.state.dialog.type, 'commit');
});

test('no staged files blocks generation locally without an RPC or implicit staging', async (t) => {
  const calls = [];
  const model = makeModel(t, async (payload) => { calls.push(payload); return ok(draft); });
  model.patch({ data: { ...ready, files: [{ path: 'working.txt', staged: false, unstaged: true }] } });
  model.showDialog({ type: 'commit', ai: true }); await tick();
  assert.equal(calls.length, 0); assert.match(model.state.error.message, /请先.*暂存/);
});

test('closing the dialog cancels generation and discards a late provider response', async (t) => {
  let resolve, signal;
  const model = makeModel(t, (payload, abortSignal) => { signal = abortSignal; return new Promise((done) => { resolve = done; }); });
  model.showDialog({ type: 'commit', ai: true });
  assert.equal(model.state.aiBusy, true);
  model.closeDialog(); assert.equal(signal.aborted, true);
  resolve(ok(draft)); await tick();
  assert.equal(model.state.dialog, null); assert.equal(model.state.aiDraft, null); assert.equal(model.state.aiBusy, false);
});

test('cancel then regenerate ignores the older cancellation while the new request stays busy', async (t) => {
  const replies = [];
  const model = makeModel(t, () => new Promise((resolve) => replies.push(resolve)));
  model.showDialog({ type: 'commit', ai: true });
  model.cancelAi();
  const pending = model.generateCommit();
  replies[0](ok({ ...draft, message: 'old' })); await tick();
  assert.equal(model.state.aiBusy, true); assert.equal(model.state.aiDraft, null);
  replies[1](ok({ ...draft, message: 'new' })); await pending;
  assert.equal(model.state.aiDraft.message, 'new'); assert.equal(model.state.aiBusy, false);
});

test('workspace switch cancels generation and clears the old preview and notice', async (t) => {
  let resolve;
  const model = makeModel(t, (payload) => payload.op === 'aiCommit' ? new Promise((done) => { resolve = done; }) : Promise.resolve(ok({ state: 'not-repository', workspace: { path: '/new' } })));
  model.showDialog({ type: 'commit', ai: true }); model.selectWorkspace('new');
  resolve(ok(draft)); await tick();
  assert.equal(model.state.workspaceId, 'new'); assert.equal(model.state.aiDraft, null); assert.equal(model.state.aiBusy, false); assert.equal(model.state.dialog, null);
});

test('staging a batch is one mutation and marks the generated preview stale', async (t) => {
  const calls = [];
  const model = makeModel(t, async (payload) => { calls.push(payload); return ok(payload.op === 'snapshot' ? ready : { message: 'done' }); });
  model.patch({ open: false });
  model.showDialog({ type: 'commit' }); model.patch({ aiDraft: draft });
  await model.mutate({ action: 'stage', paths: ['one', 'two'] }, { keepDialog: true });
  assert.equal(calls.filter((call) => call.op === 'mutate').length, 1);
  assert.deepEqual(calls[0].mutation.paths, ['one', 'two']);
  assert.equal(model.state.aiDraft.stale, true); assert.equal(model.state.dialog.type, 'commit');
});

test('a stale-index rejection preserves text, marks preview stale and never retries', async (t) => {
  let mutations = 0;
  const model = makeModel(t, async (payload) => {
    if (payload.op === 'mutate') { mutations++; return { ok: false, error: { code: 'STALE_INDEX', message: 'changed' } }; }
    if (payload.op === 'snapshot') return ok(ready);
    return ok({ commits: [], hasMore: false });
  });
  model.showDialog({ type: 'commit' }); model.patch({ aiDraft: draft });
  assert.equal(await model.mutate({ action: 'commit', message: draft.message, stagedTree: draft.stagedTree }), false);
  assert.equal(model.state.aiDraft.stale, true); assert.equal(model.state.dialog.type, 'commit'); assert.equal(mutations, 1);
});

test('commit succeeded / push failed closes confirmation and preserves a retry-push-only error', async (t) => {
  let mutations = 0;
  const model = makeModel(t, async (payload) => {
    if (payload.op === 'mutate') { mutations++; return { ok: false, error: { code: 'PUSH_FAILED_AFTER_COMMIT', message: '本地提交成功，推送失败，请只重试推送', details: { committed: true } } }; }
    if (payload.op === 'snapshot') return ok({ ...ready, head: 'c'.repeat(40), files: [] });
    return ok({ commits: [], hasMore: false });
  });
  model.showDialog({ type: 'commit' }); model.patch({ aiDraft: draft });
  assert.equal(await model.mutate({ action: 'commitAndPush', message: draft.message, branch: 'refs/heads/main' }), false);
  assert.equal(model.state.dialog, null); assert.equal(model.state.aiDraft, null); assert.equal(model.state.error.details.committed, true); assert.equal(mutations, 1);
});

test('settings survive a model reload and failed storage leaves the form and old settings intact', (t) => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const model = makeModel(t, async () => ok({ models: [], available: false }), { storage });
  const settings = { ...DEFAULT_SETTINGS, provider: ' test ', model: ' model ', prompt: '团队提交规范', shortcuts: { ...DEFAULT_SETTINGS.shortcuts, commit: 'alt+enter' } };
  assert.equal(model.saveSettings(settings), true);
  assert.equal(model.state.settings.provider, 'test'); assert.equal(model.state.settings.shortcuts.commit, 'Alt+Enter');
  const restored = makeModel(t, async () => ok({}), { storage });
  assert.deepEqual(restored.state.settings, model.state.settings);
  restored.showDialog({ type: 'commit' });
  restored.storage = { setItem: () => { throw new Error('quota'); } };
  assert.equal(restored.saveSettings({ ...settings, prompt: 'new' }), false);
  assert.equal(restored.state.settings.prompt, '团队提交规范'); assert.equal(restored.state.dialog.type, 'commit');
});

test('overlapping model discovery retries keep newest loading state and result', async (t) => {
  const replies = [];
  const model = makeModel(t, () => new Promise((resolve) => replies.push(resolve)));
  const first = model.loadAiModels(); const second = model.loadAiModels();
  replies[0](ok({ models: [{ provider: 'old', model: 'old' }], available: true })); await first;
  assert.equal(model.state.aiModelsLoading, true);
  replies[1](ok({ models: [{ provider: 'new', model: 'new' }], available: true })); await second;
  assert.equal(model.state.aiModels[0].provider, 'new'); assert.equal(model.state.aiModelsLoading, false);
});

test('disposed models never consume plugin shortcuts after a remount', (t) => {
  const model = makeModel(t, async () => ok({}));
  const event = { key: 'Enter', ctrlKey: true, target: { closest: (selector) => selector === '#dsh-git-panel' ? {} : null }, preventDefault() { this.defaultPrevented = true; } };
  model.dispose(); model.handleShortcut(event);
  assert.equal(event.defaultPrevented, undefined); assert.equal(model.state.dialog, null);
});

test('unknown commit outcome closes confirmation without claiming success or retrying', async (t) => {
  const model = makeModel(t, async (payload) => {
    if (payload.op === 'mutate') return { ok: false, error: { code: 'COMMIT_OUTCOME_UNKNOWN', message: '无法确认提交是否已完成，请检查后再操作', details: { committed: null, doNotRetryCommit: true } } };
    if (payload.op === 'snapshot') return ok(ready);
    return ok({ commits: [], hasMore: false });
  });
  model.showDialog({ type: 'commit' });
  await model.mutate({ action: 'commit', message: 'feat: one attempt' });
  assert.equal(model.state.dialog, null); assert.equal(model.state.error.details.committed, null); assert.match(model.state.error.message, /无法确认/);
});

test('plugin-local shortcuts only open confirmation and do not capture editor/IME/repeat events', async (t) => {
  let calls = 0;
  const model = makeModel(t, async () => { calls++; return ok({}); });
  const target = { closest: (selector) => selector === '#dsh-git-panel' ? {} : null };
  const makeEvent = (patch = {}) => ({ key: 'Enter', ctrlKey: true, target, preventDefault() { this.defaultPrevented = true; }, ...patch });
  for (const patch of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { target: { closest: () => null } }, { target: { closest: () => ({}) } }]) {
    model.handleShortcut(makeEvent(patch)); assert.equal(model.state.dialog, null);
  }
  const event = makeEvent(); model.handleShortcut(event);
  assert.equal(event.defaultPrevented, true); assert.equal(model.state.dialog.type, 'commit'); assert.equal(calls, 0);
  model.closeDialog(); model.handleShortcut(makeEvent({ key: 'P', shiftKey: true }));
  assert.equal(model.state.dialog.type, 'push'); assert.equal(calls, 0);
  model.closeDialog(); model.handleShortcut(makeEvent({ key: 'F', shiftKey: true }));
  assert.equal(model.state.dialog.mutation.action, 'fetch'); assert.equal(calls, 0);
});
