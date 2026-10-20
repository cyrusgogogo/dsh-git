import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitModel } from '../src/client/model.mjs';

const HEAD = 'a'.repeat(40), TREE = 'b'.repeat(40), NEXT_TREE = 'c'.repeat(40);
const ok = (value) => ({ ok: true, value });
const failure = (code, message, details) => ({ ok: false, error: { code, message, details } });
const clone = (value) => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const file = (path, extra = {}) => ({ path, staged: false, unstaged: true, conflict: false, ...extra });
const ready = (files = []) => ({ state: 'ready', head: HEAD, branch: 'main', stagedTree: TREE, operation: null, branches: [{ kind: 'local', name: 'main', ref: 'refs/heads/main' }], remotes: ['origin'], files });

function fixture(t, { files = [file('working.txt')], cachedFiles = files, snapshot, stage, ai, worktreePath } = {}) {
  const server = ready(clone(files));
  const calls = [], signals = [];
  let snapshotCount = 0, stageCount = 0;
  const model = new GitModel(async (payload, signal) => {
    calls.push(clone(payload)); signals.push(signal);
    if (payload.op === 'snapshot') {
      snapshotCount++;
      if (snapshot) { const response = await snapshot({ payload, signal, server, count: snapshotCount, model }); if (response !== undefined) return response; }
      return ok(clone(server));
    }
    if (payload.op === 'mutate') {
      assert.equal(payload.mutation.action, 'stage', 'AI preparation must never commit, push or unstage');
      stageCount++;
      if (stage) { const response = await stage({ payload, signal, server, count: stageCount, model }); if (response !== undefined) return response; }
      for (const item of server.files) if (payload.mutation.paths.includes(item.path)) { item.staged = true; item.unstaged = false; }
      return ok({ message: 'staged' });
    }
    if (payload.op === 'aiCommit') {
      if (ai) { const response = await ai({ payload, signal, server, model }); if (response !== undefined) return response; }
      return ok({ message: 'feat: 自动暂存后的预览', provider: 'test', model: 'test', stagedTree: server.stagedTree, truncated: false });
    }
    if (payload.op === 'history') return ok({ commits: [], hasMore: false });
    assert.fail(`Unexpected operation ${payload.op}`);
  }, { storage: null });
  model.patch({ open: true, workspaceId: 'w', worktreePath, data: ready(clone(cachedFiles)) });
  t.after(() => model.dispose());
  const enter = async () => {
    model.showDialog({ type: 'commit', ai: true });
    for (let count = 0; count < 20 && (model.state.aiPreparing || model.state.aiBusy); count++) await tick();
  };
  return { model, server, calls, signals, enter };
}

const stages = (calls) => calls.filter((call) => call.op === 'mutate');
const generated = (calls) => calls.filter((call) => call.op === 'aiCommit');

test('AI entry refreshes first, stages all changes, verifies, selects every file, then generates without submitting', async (t) => {
  const f = fixture(t, { files: [file('tracked.txt'), file('new file.txt', { index: '?', worktree: '?' }), file('deleted.txt', { worktree: 'D' })], cachedFiles: [] });
  const observed = [];
  f.model.source.subscribe(() => observed.push({ busy: f.model.state.busy, preparing: f.model.state.aiPreparing, aiBusy: f.model.state.aiBusy }));
  f.model.showDialog({ type: 'commit', ai: true });
  const dialog = f.model.state.dialog;
  assert.equal(f.model.state.busy, 'stage'); assert.equal(f.model.state.aiPreparing, true); assert.equal(f.model.state.aiBusy, false);
  for (let count = 0; count < 10 && !f.model.state.aiDraft; count++) await tick();
  assert.deepEqual(f.calls.map((call) => call.op), ['snapshot', 'mutate', 'snapshot', 'aiCommit']);
  assert.deepEqual(stages(f.calls)[0], { op: 'mutate', workspaceId: 'w', expected: { head: HEAD, branch: 'main' }, confirmed: true, mutation: { action: 'stage', paths: ['tracked.txt', 'new file.txt', 'deleted.txt'] } });
  assert.deepEqual(f.model.state.aiSelectedPaths, ['tracked.txt', 'new file.txt', 'deleted.txt']);
  assert.equal(f.model.state.dialog, dialog); assert.equal(f.model.state.aiPreparing, false); assert.equal(f.model.state.busy, '');
  assert.equal(f.model.state.aiDraft.message, 'feat: 自动暂存后的预览');
  assert.ok(observed.some((state) => state.aiBusy && !state.preparing && !state.busy));
});

test('AI preparation handles a globally unborn empty cache and uses the latest actual file list', async (t) => {
  const f = fixture(t, { files: [file('untracked.txt')], cachedFiles: [] });
  f.server.head = null; f.server.branch = 'main';
  f.model.patch({ data: { ...f.model.state.data, head: null } });
  await f.enter();
  assert.equal(stages(f.calls).length, 1); assert.equal(generated(f.calls).length, 1);
  assert.deepEqual(stages(f.calls)[0].expected, { head: null, branch: 'main' });
  assert.deepEqual(f.model.state.aiSelectedPaths, ['untracked.txt']);
});

test('pre-existing staged files are preserved and partially staged files are staged completely', async (t) => {
  const f = fixture(t, { files: [file('already.txt', { staged: true, unstaged: false }), file('partial.txt', { staged: true }), file('untracked.txt')] });
  await f.enter();
  assert.deepEqual(stages(f.calls)[0].mutation.paths, ['partial.txt', 'untracked.txt']);
  assert.equal(f.server.files.find((item) => item.path === 'already.txt').staged, true);
  assert.equal(f.server.files.find((item) => item.path === 'partial.txt').unstaged, false);
  assert.deepEqual(f.model.state.aiSelectedPaths, ['already.txt', 'partial.txt', 'untracked.txt']);
});

test('more than 1000 paths are staged in fixed bounded batches before one final verification and one generation', async (t) => {
  const paths = Array.from({ length: 2003 }, (_, index) => `file-${index}.txt`);
  const f = fixture(t, { files: paths.map((path) => file(path)) });
  await f.enter();
  assert.deepEqual(stages(f.calls).map((call) => call.mutation.paths.length), [1000, 1000, 3]);
  assert.deepEqual(stages(f.calls).flatMap((call) => call.mutation.paths), paths);
  assert.deepEqual(f.calls.map((call) => call.op), ['snapshot', 'mutate', 'mutate', 'mutate', 'snapshot', 'aiCommit']);
  assert.equal(f.model.state.aiSelectedPaths.length, 2003);
});

test('an already staged repository skips staging, but still verifies two snapshots before generating', async (t) => {
  const f = fixture(t, { files: [file('staged.txt', { staged: true, unstaged: false })] });
  await f.enter();
  assert.deepEqual(f.calls.map((call) => call.op), ['snapshot', 'snapshot', 'aiCommit']);
  assert.equal(f.model.state.aiDraft.stagedTree, TREE);
});

test('clean repositories never stage or call a model', async (t) => {
  const f = fixture(t, { files: [], cachedFiles: [file('old-cache.txt')] });
  await f.enter();
  assert.deepEqual(f.calls.map((call) => call.op), ['snapshot', 'snapshot']);
  assert.equal(f.model.state.error.code, 'NOTHING_STAGED'); assert.match(f.model.state.error.message, /没有可提交/);
  assert.deepEqual(f.model.state.aiSelectedPaths, []); assert.equal(f.model.state.aiDraft, null);
});

test('conflicts and operations are refused before any stage or model call, including stale cache', async (t) => {
  for (const type of ['conflict', 'operation']) {
    const f = fixture(t, { files: [file('unsafe.txt')], cachedFiles: [] });
    if (type === 'conflict') f.server.files[0].conflict = true; else f.server.operation = 'merge';
    await f.enter();
    assert.deepEqual(f.calls.map((call) => call.op), ['snapshot']);
    assert.equal(f.model.state.error.code, type === 'conflict' ? 'UNRESOLVED_CONFLICTS' : 'OPERATION_IN_PROGRESS');
    assert.equal(f.model.state.aiPreparing, false); assert.equal(f.model.state.busy, '');
  }
});

test('changed HEAD or branch is refused before staging and expected values stay fixed', async (t) => {
  for (const field of ['head', 'branch']) {
    const f = fixture(t);
    f.server[field] = field === 'head' ? 'd'.repeat(40) : 'other';
    await f.enter();
    assert.deepEqual(f.calls.map((call) => call.op), ['snapshot']); assert.equal(f.model.state.error.code, 'STALE_HEAD');
    assert.deepEqual(f.model.state.dialog.expected, { head: HEAD, branch: 'main' });
  }
});

test('a failed later batch leaves successful staging intact, refreshes selection and never generates or rolls back', async (t) => {
  const files = Array.from({ length: 1001 }, (_, index) => file(`path-${index}`));
  const f = fixture(t, { files, stage: ({ count }) => count === 2 ? failure('STAGE_FAILED', '模拟暂存失败') : undefined });
  await f.enter();
  assert.deepEqual(f.calls.map((call) => call.op), ['snapshot', 'mutate', 'mutate', 'snapshot']);
  assert.equal(f.server.files.filter((item) => item.staged).length, 1000); assert.equal(generated(f.calls).length, 0);
  assert.match(f.model.state.error.message, /已完成 1000.*暂存.*保留/); assert.match(f.model.state.error.message, /手写|重试/);
  assert.equal(f.model.state.error.code, 'STAGE_FAILED'); assert.equal(f.model.state.aiSelectedPaths.length, 1001); assert.equal(f.model.state.busy, '');
});

test('the first stage may partially fail; its current index is shown without retrying or unstage', async (t) => {
  const f = fixture(t, { files: [file('one'), file('two')], stage: ({ server }) => { server.files[0].staged = true; server.files[0].unstaged = false; return failure('STAGE_FAILED', '部分写入后失败'); } });
  await f.enter();
  assert.equal(stages(f.calls).length, 1); assert.equal(generated(f.calls).length, 0);
  assert.equal(f.model.state.data.files[0].staged, true); assert.match(f.model.state.error.message, /部分更改可能已暂存/);
});

test('new unstaged changes during staging block generation and are never chased', async (t) => {
  const f = fixture(t, { stage: ({ server }) => { server.files.push(file('late.txt')); } });
  await f.enter();
  assert.equal(stages(f.calls).length, 1); assert.deepEqual(stages(f.calls)[0].mutation.paths, ['working.txt']);
  assert.equal(generated(f.calls).length, 0); assert.equal(f.model.state.error.code, 'AI_PREPARATION_CHANGED');
  assert.match(f.model.state.error.message, /未发送给模型/); assert.deepEqual(f.model.state.aiSelectedPaths, ['working.txt', 'late.txt']);
});

test('HEAD changes, new operations or conflicts after staging keep the index but block the model', async (t) => {
  for (const type of ['head', 'branch', 'conflict', 'operation']) {
    const f = fixture(t, { stage: ({ server }) => { if (type === 'conflict') server.files[0].conflict = true; else if (type === 'operation') server.operation = 'rebase'; else server[type] = type === 'head' ? 'd'.repeat(40) : 'different'; } });
    await f.enter();
    assert.equal(stages(f.calls).length, 1); assert.equal(generated(f.calls).length, 0); assert.equal(f.server.files[0].staged, true);
    assert.match(f.model.state.error.message, /暂存内容已保留/);
  }
});

test('failed snapshots cannot trigger staging or a model and never leave the preparation locked', async (t) => {
  const initial = fixture(t, { snapshot: () => failure('SNAPSHOT_FAILED', '无法读取仓库') });
  await initial.enter();
  assert.equal(stages(initial.calls).length, 0); assert.equal(generated(initial.calls).length, 0); assert.equal(initial.model.state.busy, '');
  const final = fixture(t, { snapshot: ({ count }) => count > 1 ? failure('SNAPSHOT_FAILED', '无法读取仓库') : undefined });
  await final.enter();
  assert.equal(stages(final.calls).length, 1); assert.equal(generated(final.calls).length, 0); assert.match(final.model.state.error.message, /暂存内容已保留/);
});

test('preparation blocks other mutations, close, worktree/collapse and repeated entries, and defers workspace changes', async (t) => {
  const gate = deferred();
  const f = fixture(t, { stage: async () => { await gate.promise; } });
  f.model.showDialog({ type: 'commit', ai: true }); await tick();
  const dialog = f.model.state.dialog;
  assert.equal(f.model.state.aiPreparing, true);
  assert.equal(await f.model.mutate({ action: 'fetch' }), false);
  f.model.closeDialog(); f.model.toggle(); f.model.selectWorktree('/other'); f.model.showDialog({ type: 'settings' }); f.model.cancelAi();
  assert.equal(f.model.state.dialog, dialog); assert.equal(f.model.state.open, true); assert.equal(f.model.state.worktreePath, undefined);
  f.model.selectWorkspace('other'); assert.equal(f.model.state.workspaceId, 'w'); assert.equal(f.model.pendingWorkspace, 'other');
  gate.resolve(); await tick(); await tick();
  assert.equal(generated(f.calls).length, 0); assert.equal(f.model.state.workspaceId, 'other'); assert.equal(f.model.state.dialog, null); assert.equal(f.model.pendingWorkspace, undefined);
});

test('disposing during the initial snapshot sends no stage or follow-up snapshot/model request', async (t) => {
  const gate = deferred();
  const f = fixture(t, { snapshot: async () => { await gate.promise; } });
  f.model.showDialog({ type: 'commit', ai: true }); f.model.dispose();
  assert.equal(f.signals[0].aborted, true); gate.resolve(); await tick();
  assert.deepEqual(f.calls.map((call) => call.op), ['snapshot']);
});

test('disposing while a stage is pending never triggers its normal refresh or any later model request', async (t) => {
  const gate = deferred();
  const f = fixture(t, { stage: async () => { await gate.promise; } });
  f.model.showDialog({ type: 'commit', ai: true }); await tick(); f.model.dispose(); gate.resolve(); await tick();
  assert.deepEqual(f.calls.map((call) => call.op), ['snapshot', 'mutate']); assert.equal(f.signals[1].aborted, true);
});

test('cancelled stage reports preserved index and never automatically retries or calls the model', async (t) => {
  const f = fixture(t, { stage: () => { throw new DOMException('cancelled', 'AbortError'); } });
  await f.enter();
  assert.deepEqual(f.calls.map((call) => call.op), ['snapshot', 'mutate', 'snapshot']);
  assert.equal(f.model.state.error.code, 'CANCELLED'); assert.match(f.model.state.error.message, /保留/);
});

test('generation remains cancelable after preparation and keeps the newly staged index for manual text or retry', async (t) => {
  const gate = deferred(); let aiSignal;
  const f = fixture(t, { ai: async ({ signal }) => { aiSignal = signal; return gate.promise; } });
  f.model.showDialog({ type: 'commit', ai: true }); await tick();
  assert.equal(f.model.state.aiPreparing, false); assert.equal(f.model.state.aiBusy, true); assert.equal(f.model.state.busy, '');
  f.model.cancelAi(); assert.equal(aiSignal.aborted, true); assert.equal(f.server.files[0].staged, true);
  gate.resolve(ok({ message: 'late result', stagedTree: TREE })); await tick();
  assert.equal(f.model.state.aiDraft, null); assert.match(f.model.state.notice, /已暂存.*已停止/);
});

test('AI failure after successful automatic staging clearly preserves index and retry generation does not stage again', async (t) => {
  let fail = true;
  const f = fixture(t, { ai: () => fail ? failure('AI_ERROR', '模型暂时不可用') : undefined });
  await f.enter();
  assert.equal(f.model.state.error.code, 'AI_ERROR'); assert.match(f.model.state.error.message, /全部更改已暂存.*AI 生成失败.*手写.*重试/);
  assert.equal(f.model.state.data.files[0].staged, true); assert.equal(f.model.state.aiPreparing, false);
  assert.equal(f.model.state.notice, '');
  fail = false; assert.equal(await f.model.generateCommit(), true);
  assert.equal(stages(f.calls).length, 1); assert.equal(generated(f.calls).length, 2);
});

test('a model result tied to another staged tree is not adopted after automatic preparation', async (t) => {
  const f = fixture(t, { ai: () => ok({ message: 'wrong index', stagedTree: NEXT_TREE }) });
  await f.enter();
  assert.equal(f.model.state.error.code, 'STALE_INDEX'); assert.equal(f.model.state.aiDraft, null);
});

test('new arrays publish selection after preparing and show/close/reset clear the signal without replacing dialog identity', async (t) => {
  const f = fixture(t);
  await f.enter(); const first = f.model.state.aiSelectedPaths;
  f.model.closeDialog(); assert.equal(f.model.state.aiSelectedPaths, null);
  await f.enter(); assert.notEqual(f.model.state.aiSelectedPaths, first); assert.deepEqual(f.model.state.aiSelectedPaths, first);
  f.model.closeDialog(); f.model.showDialog({ type: 'commit' }); assert.equal(f.model.state.aiSelectedPaths, null);
  f.model.patch({ aiSelectedPaths: ['old'], aiPreparing: false }); f.model.resetScope({ workspaceId: 'new' });
  assert.equal(f.model.state.aiSelectedPaths, null);
});

test('AI shortcut uses the same auto-stage entry even if the cached file list is empty', async (t) => {
  const f = fixture(t, { cachedFiles: [] });
  const event = { key: 'Enter', ctrlKey: true, shiftKey: true, target: { closest: (selector) => selector === '#dsh-git-panel' ? {} : null }, preventDefault() { this.defaultPrevented = true; } };
  f.model.handleShortcut(event); await tick();
  assert.equal(event.defaultPrevented, true); assert.equal(stages(f.calls).length, 1); assert.equal(generated(f.calls).length, 1);
});

test('the original scope/worktree is used consistently until preparation finishes', async (t) => {
  const f = fixture(t, { worktreePath: '/repo-linked' });
  await f.enter();
  for (const call of f.calls) { assert.equal(call.workspaceId, 'w'); assert.equal(call.worktreePath, '/repo-linked'); }
});

test('an older mutation finally snapshot cannot overwrite preparation or consume its queued workspace change', async (t) => {
  const oldSnapshot = deferred(), autoStage = deferred();
  let stale;
  const f = fixture(t, {
    files: [file('manual.txt'), file('automatic.txt')],
    snapshot: async ({ count, server }) => { if (count === 1) { stale = clone(server); await oldSnapshot.promise; return ok(stale); } },
    stage: async ({ count }) => { if (count === 2) await autoStage.promise; },
  });
  const manual = f.model.mutate({ action: 'stage', paths: ['manual.txt'] });
  await tick();
  assert.equal(f.model.state.busy, ''); assert.equal(f.model.state.loading, true);
  f.model.showDialog({ type: 'commit', ai: true }); await tick();
  assert.equal(f.model.state.aiPreparing, true); assert.equal(f.model.state.busy, 'stage');
  f.model.selectWorkspace('other'); oldSnapshot.resolve(); await manual;
  assert.equal(f.model.state.aiPreparing, true); assert.equal(f.model.state.busy, 'stage');
  assert.equal(f.model.state.workspaceId, 'w'); assert.equal(f.model.pendingWorkspace, 'other');
  autoStage.resolve(); await tick(); await tick();
  assert.equal(generated(f.calls).length, 0); assert.equal(f.model.state.workspaceId, 'other'); assert.equal(f.model.pendingWorkspace, undefined);
});

test('a stale mutation finally response arriving after AI preparation does not replace the verified file state', async (t) => {
  const oldSnapshot = deferred();
  const f = fixture(t, { files: [file('manual.txt'), file('automatic.txt')], snapshot: async ({ count, server }) => { if (count === 1) { const stale = clone(server); await oldSnapshot.promise; return ok(stale); } } });
  const manual = f.model.mutate({ action: 'stage', paths: ['manual.txt'] }); await tick();
  await f.enter();
  assert.equal(f.model.state.aiDraft.message, 'feat: 自动暂存后的预览');
  assert.equal(f.model.state.data.files.every((item) => item.staged && !item.unstaged), true);
  oldSnapshot.resolve(); await manual;
  assert.equal(f.model.state.data.files.every((item) => item.staged && !item.unstaged), true);
  assert.deepEqual(f.model.state.aiSelectedPaths, ['manual.txt', 'automatic.txt']);
});

test('an old host compatibility rejection after auto-staging keeps index and never falls back to commit/push', async (t) => {
  const f = fixture(t, { ai: () => failure('INVALID_REQUEST', 'Git 请求参数不合法。', { issues: [{ path: ['payload', 'op'], message: 'Invalid input' }] }) });
  await f.enter();
  assert.equal(f.model.state.error.code, 'HOST_UPGRADE_REQUIRED'); assert.match(f.model.state.error.message, /已暂存.*版本不一致/);
  assert.equal(stages(f.calls).length, 1); assert.equal(generated(f.calls).length, 1); assert.equal(f.server.files[0].staged, true);
});
