import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { unlink, writeFile } from 'node:fs/promises';
import { GitModel } from '../src/client/model.mjs';
import { AiCommitService } from '../src/host/ai-commit.mjs';
import { fixture, git, addCommit } from './helpers.mjs';

// Git is real and isolated in fixture directories; the advertised host model is
// an in-process deterministic stub. No credentials, provider calls, or remotes.
async function host(t, { failModel = false } = {}) {
  const f = await fixture();
  const modelCalls = [], gitCalls = [], requests = [];
  const llm = {
    listProviders: () => [{ id: 'test-only', name: 'Test Only' }],
    listModels: async (provider) => [{ provider, id: 'stub', name: 'Deterministic stub' }],
    stream(options) {
      modelCalls.push(options);
      if (failModel) throw new Error('Intentional local stub failure');
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: 'feat: preview all automatically staged changes' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  await f.service.ai.dispose();
  f.service.ai = new AiCommitService(llm);
  const run = f.service.runner.run.bind(f.service.runner);
  f.service.runner.run = (cwd, args, options) => { gitCalls.push([...args]); return run(cwd, args, options); };
  const model = new GitModel(async (payload, signal) => {
    requests.push(structuredClone(payload));
    try { return { ok: true, value: await f.service.execute(payload, signal) }; }
    catch (error) { return { ok: false, error: { code: error.code, message: error.message, details: error.details } }; }
  }, { storage: null });
  t.after(async () => { model.dispose(); await f.cleanup(); });
  return { ...f, model, modelCalls, gitCalls, requests };
}

function clickAiAndWait(model) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const finish = (error, state) => {
      clearTimeout(timer); unsubscribe();
      if (error) reject(error); else resolve(state);
    };
    const timer = setTimeout(() => finish(new Error('AI auto-stage entry did not settle within 30 seconds')), 30000);
    const check = () => {
      const state = model.source.getSnapshot();
      // Preparation clears its flags immediately before generateCommit starts.
      // Require a result/error as well, so that synchronous handoff is not idle.
      if ((state.aiDraft || state.error) && !state.aiPreparing && !state.aiBusy && !state.busy) finish(null, state);
    };
    unsubscribe = model.source.subscribe(check);
    try { model.showDialog({ type: 'commit', ai: true }); check(); }
    catch (error) { finish(error); }
  });
}

function assertNoSubmission(f) {
  assert.equal(f.gitCalls.some((args) => ['commit', 'push'].includes(args[0])), false);
  assert.equal(f.requests.some((request) => request.op === 'mutate' && ['commit', 'commitAndPush', 'push', 'unstage'].includes(request.mutation.action)), false);
}

const sortedPaths = (files) => files.map((file) => file.path).sort();

test('real AI entry stages partial, untracked and deleted files for one preview, then creates exactly one commit only after explicit confirmation', async (t) => {
  const f = await host(t);
  await addCommit(f.root, 'delete-me.txt', 'DELETE_TRACKED_MARKER\n', 'test: prepare tracked deletion');
  await writeFile(path.join(f.root, 'readme.txt'), 'initial\nINDEX_ONLY_MARKER\n');
  await git(f.root, ['add', '--', 'readme.txt']);
  await writeFile(path.join(f.root, 'readme.txt'), 'initial\nINDEX_ONLY_MARKER\nWORKTREE_ONLY_MARKER\n');
  await writeFile(path.join(f.root, 'new file.txt'), 'UNTRACKED_MARKER\n');
  // This exact file was created above inside the verified isolated fixture root.
  await unlink(path.join(f.root, 'delete-me.txt'));
  const before = await f.snapshot();
  const beforeCount = Number(await git(f.root, ['rev-list', '--count', 'HEAD']));
  assert.equal(before.files.find((file) => file.path === 'readme.txt').staged, true);
  assert.equal(before.files.find((file) => file.path === 'readme.txt').unstaged, true);
  assert.equal(before.files.find((file) => file.path === 'new file.txt').staged, false);
  assert.equal(before.files.find((file) => file.path === 'delete-me.txt').unstaged, true);
  f.model.patch({ open: true, workspaceId: f.workspace.id, data: before });

  const state = await clickAiAndWait(f.model);
  assert.equal(state.error, null); assert.ok(state.aiDraft);
  assert.deepEqual(state.aiSelectedPaths.slice().sort(), ['delete-me.txt', 'new file.txt', 'readme.txt']);
  const after = await f.snapshot();
  assert.deepEqual(sortedPaths(after.files), ['delete-me.txt', 'new file.txt', 'readme.txt']);
  assert.equal(after.files.every((file) => file.staged && !file.unstaged && !file.conflict), true);
  assert.equal(await git(f.root, ['show', ':readme.txt']), 'initial\nINDEX_ONLY_MARKER\nWORKTREE_ONLY_MARKER');
  assert.equal(await git(f.root, ['show', ':new file.txt']), 'UNTRACKED_MARKER');
  assert.match(await git(f.root, ['diff', '--cached', '--name-status']), /D\s+delete-me\.txt/);
  assert.equal(f.modelCalls.length, 1);
  const input = JSON.parse(f.modelCalls[0].messages[0].content[0].text);
  assert.match(input.stagedDiff, /INDEX_ONLY_MARKER/);
  assert.match(input.stagedDiff, /WORKTREE_ONLY_MARKER/);
  assert.match(input.stagedDiff, /UNTRACKED_MARKER/);
  assert.match(input.stagedDiff, /-DELETE_TRACKED_MARKER/);
  assert.match(input.stagedDiff, /deleted file mode/);
  assert.equal(f.modelCalls[0].tools, undefined);
  assert.equal(state.aiDraft.stagedTree, after.stagedTree);
  assert.equal(after.head, before.head); assert.equal(await git(f.root, ['rev-parse', 'HEAD']), before.head);
  assert.equal(Number(await git(f.root, ['rev-list', '--count', 'HEAD'])), beforeCount);
  assertNoSubmission(f);

  const preview = state.aiDraft;
  assert.equal(await f.model.mutate({ action: 'commit', message: preview.message, stagedTree: preview.stagedTree }, { expected: state.dialog.expected }), true);
  assert.equal(Number(await git(f.root, ['rev-list', '--count', 'HEAD'])), beforeCount + 1);
  assert.notEqual(await git(f.root, ['rev-parse', 'HEAD']), before.head);
  assert.equal(await git(f.root, ['rev-parse', 'HEAD^{tree}']), preview.stagedTree);
  assert.equal(await git(f.root, ['show', 'HEAD:readme.txt']), 'initial\nINDEX_ONLY_MARKER\nWORKTREE_ONLY_MARKER');
  assert.equal(await git(f.root, ['show', 'HEAD:new file.txt']), 'UNTRACKED_MARKER');
  assert.equal(await git(f.root, ['ls-tree', '--name-only', 'HEAD', '--', 'delete-me.txt']), '');
  assert.equal(f.gitCalls.filter((args) => args[0] === 'commit').length, 1);
  assert.equal(f.gitCalls.filter((args) => args[0] === 'push').length, 0);
  assert.equal(f.requests.filter((request) => request.op === 'mutate' && request.mutation.action === 'commit').length, 1);
});

test('real AI provider failure preserves all automatic staging without a commit, and the user can explicitly submit handwritten text afterward', async (t) => {
  const f = await host(t, { failModel: true });
  await writeFile(path.join(f.root, 'readme.txt'), 'initial\nFAILURE_TRACKED_MARKER\n');
  await writeFile(path.join(f.root, 'new file.txt'), 'FAILURE_UNTRACKED_MARKER\n');
  const before = await f.snapshot();
  const beforeCount = Number(await git(f.root, ['rev-list', '--count', 'HEAD']));
  f.model.patch({ open: true, workspaceId: f.workspace.id, data: before });

  const state = await clickAiAndWait(f.model);
  assert.equal(state.aiDraft, null); assert.equal(state.error.code, 'AI_MODEL_ERROR');
  assert.match(state.error.message, /全部更改已暂存/); assert.match(state.error.message, /保留/); assert.match(state.error.message, /手写/);
  assert.equal(state.aiPreparing, false); assert.equal(state.aiBusy, false); assert.equal(state.busy, '');
  assert.deepEqual(state.aiSelectedPaths.slice().sort(), ['new file.txt', 'readme.txt']);
  const staged = await f.snapshot();
  assert.equal(staged.files.length, 2); assert.equal(staged.files.every((file) => file.staged && !file.unstaged), true);
  assert.equal(staged.head, before.head); assert.equal(await git(f.root, ['rev-parse', 'HEAD']), before.head);
  assert.equal(Number(await git(f.root, ['rev-list', '--count', 'HEAD'])), beforeCount);
  assert.equal(f.modelCalls.length, 1);
  const input = JSON.parse(f.modelCalls[0].messages[0].content[0].text);
  assert.match(input.stagedDiff, /FAILURE_TRACKED_MARKER/); assert.match(input.stagedDiff, /FAILURE_UNTRACKED_MARKER/);
  assertNoSubmission(f);

  const message = 'fix: explicitly submit after AI failure';
  assert.equal(await f.model.mutate({ action: 'commit', message, stagedTree: staged.stagedTree }, { expected: state.dialog.expected }), true);
  assert.equal(await git(f.root, ['log', '-1', '--format=%s']), message);
  assert.equal(Number(await git(f.root, ['rev-list', '--count', 'HEAD'])), beforeCount + 1);
  assert.equal(await git(f.root, ['rev-parse', 'HEAD^{tree}']), staged.stagedTree);
  assert.equal(f.gitCalls.filter((args) => args[0] === 'commit').length, 1);
  assert.equal(f.gitCalls.filter((args) => args[0] === 'push').length, 0);
  assert.equal(f.modelCalls.length, 1);
});
