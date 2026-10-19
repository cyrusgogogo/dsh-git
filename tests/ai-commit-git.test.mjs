import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { AiCommitService } from '../src/host/ai-commit.mjs';
import { fixture, git, addCommit } from './helpers.mjs';

// These are real isolated Git repositories/local bare remotes. The llm service
// is always a deterministic in-process stub: no credentials or provider I/O.
const expectCode = (code) => (error) => { assert.equal(error.code, code, error.message); return true; };
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const chunks = [{ type: 'text-delta', index: 0, text: 'feat: summarize staged changes' }, { type: 'finish', reason: { kind: 'stop' } }];
async function host(t, options) {
  const f = await fixture(options); t.after(() => f.cleanup());
  const modelCalls = [], gitCalls = [];
  const llm = {
    listProviders: () => [{ id: 'test-only', name: 'Test Only' }],
    listModels: async (provider) => [{ provider, id: 'stub', name: 'Deterministic stub' }],
    stream(options) {
      modelCalls.push(options);
      return (async function* () { for (const chunk of chunks) yield chunk; })();
    },
  };
  await f.service.ai.dispose(); f.service.ai = new AiCommitService(llm);
  const run = f.service.runner.run.bind(f.service.runner);
  f.service.runner.run = (cwd, args, options) => { gitCalls.push(args); return run(cwd, args, options); };
  const generate = async (extra = {}) => {
    const data = await f.snapshot();
    return f.call({ op: 'aiCommit', expected: { head: data.head, branch: data.branch }, provider: '', model: '', prompt: '', ...extra });
  };
  return { ...f, llm, modelCalls, gitCalls, generate };
}
async function remote(f) {
  const directory = path.join(f.base, 'local-remote.git'); await mkdir(directory);
  await git(directory, ['init', '--bare', '--initial-branch=main']);
  await git(f.root, ['remote', 'add', 'origin', directory]);
  return directory;
}
async function stage(f, name = 'readme.txt', content = 'initial\nstaged-only\n') {
  await writeFile(path.join(f.root, name), content);
  await git(f.root, ['add', '--', name]);
}

test('real index AI diff excludes unstaged/untracked bytes, disables external diff/textconv, and creates no commit', async (t) => {
  const f = await host(t);
  await stage(f);
  await writeFile(path.join(f.root, 'readme.txt'), 'initial\nstaged-only\nWORKING_TREE_SECRET\n');
  await writeFile(path.join(f.root, 'untracked.txt'), 'UNTRACKED_SECRET\n');
  const marker = path.join(f.root, 'external-diff-ran');
  const converter = path.join(f.base, 'external-diff.sh');
  await writeFile(converter, '#!/bin/sh\nprintf unsafe > external-diff-ran\nprintf EXTERNAL_CONVERTER_SECRET\n', { mode: 0o755 });
  await git(f.root, ['config', 'diff.external', converter.replace(/\\/g, '/')]);
  await git(f.root, ['config', 'diff.secret.textconv', converter.replace(/\\/g, '/')]);
  await writeFile(path.join(f.root, '.gitattributes'), '*.txt diff=secret\n');
  const before = await f.snapshot(); const beforeStatus = await git(f.root, ['status', '--porcelain=v2', '-z']);
  const result = await f.generate();
  assert.equal(result.stagedTree, before.stagedTree); assert.equal(result.stagedTree, await git(f.root, ['write-tree']));
  assert.equal(result.provider, 'test-only'); assert.equal(result.model, 'stub');
  assert.equal(f.modelCalls.length, 1); assert.equal(f.modelCalls[0].tools, undefined);
  const input = JSON.parse(f.modelCalls[0].messages[0].content[0].text);
  assert.match(input.stagedDiff, /staged-only/); assert.doesNotMatch(input.stagedDiff, /WORKING_TREE_SECRET|UNTRACKED_SECRET|EXTERNAL_CONVERTER_SECRET/);
  assert.equal(await git(f.root, ['rev-parse', 'HEAD']), before.head);
  assert.equal(await git(f.root, ['status', '--porcelain=v2', '-z']), beforeStatus);
  assert.equal(f.gitCalls.some((args) => ['commit', 'push', 'add'].includes(args[0])), false);
  await assert.rejects(stat(marker), (error) => error.code === 'ENOENT');
});

test('real stagedTree token rejects newly staged changes for both commit mutations without moving HEAD', async (t) => {
  for (const action of ['commit', 'commitAndPush']) {
    const f = await host(t); await remote(f); await stage(f);
    const preview = await f.generate(); const head = await git(f.root, ['rev-parse', 'HEAD']);
    await stage(f, 'newly-staged.txt', 'changed after preview\n');
    assert.notEqual(await git(f.root, ['write-tree']), preview.stagedTree);
    await assert.rejects(f.mutate({ action, message: preview.message, stagedTree: preview.stagedTree, ...(action === 'commitAndPush' ? { branch: 'main', remote: 'origin' } : {}) }), expectCode('STALE_INDEX'));
    assert.equal(await git(f.root, ['rev-parse', 'HEAD']), head);
    assert.equal(f.gitCalls.some((args) => ['commit', 'push'].includes(args[0])), false);
    assert.equal(await readFile(path.join(f.root, 'newly-staged.txt'), 'utf8'), 'changed after preview\n');
  }
});

test('real external staging while a stub model waits invalidates the draft without holding the mutation lock', async (t) => {
  const f = await host(t); await stage(f);
  const began = deferred(), release = deferred();
  f.llm.stream = (options) => {
    f.modelCalls.push(options);
    return (async function* () { began.resolve(); await release.promise; for (const chunk of chunks) yield chunk; })();
  };
  const pending = f.generate(); await began.promise;
  try { await f.mutate({ action: 'stage', paths: ['readme.txt'] }); await stage(f, 'changed.txt', 'external staged\n'); }
  finally { release.resolve(); }
  await assert.rejects(pending, expectCode('STALE_INDEX'));
  assert.equal(f.gitCalls.some((args) => ['commit', 'push'].includes(args[0])), false);
});

test('real unborn index generates a token and commitAndPush creates the first local and remote commit', async (t) => {
  const f = await host(t, { commit: false }); const bare = await remote(f);
  await stage(f, 'first.txt', 'first staged file\n');
  const preview = await f.generate(); const before = await f.snapshot(); assert.equal(before.head, null);
  assert.equal(preview.stagedTree, before.stagedTree);
  const result = await f.mutate({ action: 'commitAndPush', message: preview.message, branch: 'main', remote: 'origin', stagedTree: preview.stagedTree });
  assert.equal(result.committed, true); assert.equal(result.pushed, true);
  const head = await git(f.root, ['rev-parse', 'HEAD']); assert.equal(await git(bare, ['rev-parse', 'refs/heads/main']), head);
  assert.equal(await git(f.root, ['rev-parse', 'HEAD^{tree}']), preview.stagedTree);
  assert.equal(await git(f.root, ['rev-list', '--count', 'HEAD']), '1');
});

test('real commitAndPush commits only the previewed index and pushes via explicit remote then configured upstream', async (t) => {
  const f = await host(t); const bare = await remote(f); await stage(f);
  await writeFile(path.join(f.root, 'readme.txt'), 'initial\nstaged-only\nunstaged stays local\n');
  const preview = await f.generate(); const oldHead = await git(f.root, ['rev-parse', 'HEAD']);
  const result = await f.mutate({ action: 'commitAndPush', message: preview.message, branch: 'main', remote: 'origin', stagedTree: preview.stagedTree });
  assert.equal(result.committed, true); assert.equal(result.pushed, true);
  const head = await git(f.root, ['rev-parse', 'HEAD']); assert.notEqual(head, oldHead);
  assert.equal(await git(bare, ['rev-parse', 'refs/heads/main']), head);
  assert.equal(await git(f.root, ['rev-parse', 'HEAD^{tree}']), preview.stagedTree);
  assert.equal(await git(f.root, ['show', 'HEAD:readme.txt']), 'initial\nstaged-only');
  assert.match(await git(f.root, ['diff', '--no-ext-diff', '--no-textconv']), /unstaged stays local/);
  assert.equal(f.gitCalls.filter((args) => args[0] === 'commit').length, 1);
  assert.equal(f.gitCalls.filter((args) => args[0] === 'push').length, 1);
  await stage(f, 'second.txt', 'second commit via upstream\n'); const next = await f.generate();
  assert.equal((await f.mutate({ action: 'commitAndPush', message: next.message, branch: 'main', stagedTree: next.stagedTree })).pushed, true);
  assert.equal(await git(bare, ['rev-parse', 'refs/heads/main']), await git(f.root, ['rev-parse', 'HEAD']));
});

test('real non-fast-forward push reports a successful local commit and never force pushes or repeats commit', async (t) => {
  const f = await host(t); const bare = await remote(f);
  await f.mutate({ action: 'push', branch: 'main', remote: 'origin' });
  const other = path.join(f.base, 'other-clone'); await git(f.base, ['clone', bare, other]);
  await git(other, ['config', 'user.name', 'Other']); await git(other, ['config', 'user.email', 'other@example.invalid']); await git(other, ['config', 'commit.gpgsign', 'false']);
  const remoteHead = await addCommit(other, 'remote-only.txt', 'remote diverges\n', 'feat: remote change'); await git(other, ['push', 'origin', 'main']);
  await stage(f, 'local-only.txt', 'local diverges\n');
  const before = await f.snapshot(); const count = Number(await git(f.root, ['rev-list', '--count', 'HEAD']));
  const preview = await f.generate(); const start = f.gitCalls.length;
  await assert.rejects(f.mutate({ action: 'commitAndPush', message: preview.message, branch: 'main', stagedTree: preview.stagedTree }), (error) => {
    assert.equal(error.code, 'PUSH_FAILED_AFTER_COMMIT'); assert.equal(error.details.committed, true); assert.match(error.message, /本地提交已成功/); assert.match(error.message, /请勿再次提交/); return true;
  });
  const after = await f.snapshot(); assert.notEqual(after.head, before.head); assert.equal(await git(bare, ['rev-parse', 'refs/heads/main']), remoteHead);
  assert.equal(Number(await git(f.root, ['rev-list', '--count', 'HEAD'])), count + 1);
  const calls = f.gitCalls.slice(start); assert.equal(calls.filter((args) => args[0] === 'commit').length, 1); assert.equal(calls.filter((args) => args[0] === 'push').length, 1);
  assert.equal(calls.filter((args) => args[0] === 'push').some((args) => args.includes('--force') || args.includes('-f') || args.some((arg) => arg.startsWith('+'))), false);
  await assert.rejects(f.call({ op: 'mutate', expected: { head: before.head, branch: before.branch }, confirmed: true, mutation: { action: 'commitAndPush', branch: 'main', message: preview.message, stagedTree: preview.stagedTree } }), expectCode('STALE_REPOSITORY'));
  assert.equal(Number(await git(f.root, ['rev-list', '--count', 'HEAD'])), count + 1);
});

test('real pre-commit hooks changing the index are preserved but detected after commit, with no automatic push or rollback', async (t) => {
  for (const action of ['commit', 'commitAndPush']) {
    const f = await host(t); const bare = await remote(f); await stage(f);
    const preview = await f.generate(); const oldHead = await git(f.root, ['rev-parse', 'HEAD']);
    await writeFile(path.join(f.root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nprintf "hook-added\\n" > hook-added.txt\ngit add -- hook-added.txt\n', { mode: 0o755 });
    await assert.rejects(f.mutate({ action, message: preview.message, stagedTree: preview.stagedTree, ...(action === 'commitAndPush' ? { branch: 'main', remote: 'origin' } : {}) }), (error) => {
      assert.equal(error.code, 'COMMITTED_TREE_CHANGED'); assert.equal(error.details.committed, true); assert.equal(error.details.expectedTree, preview.stagedTree); assert.notEqual(error.details.committedTree, preview.stagedTree); assert.match(error.message, /本地提交已成功/); assert.match(error.message, /未推送/); return true;
    });
    assert.notEqual(await git(f.root, ['rev-parse', 'HEAD']), oldHead);
    assert.equal(await git(f.root, ['show', 'HEAD:hook-added.txt']), 'hook-added');
    assert.notEqual(await git(f.root, ['rev-parse', 'HEAD^{tree}']), preview.stagedTree);
    assert.equal(await git(bare, ['show-ref', '--verify', 'refs/heads/main'], { allow: [0, 1, 128] }), '');
    assert.equal(f.gitCalls.filter((args) => args[0] === 'commit').length, 1); assert.equal(f.gitCalls.some((args) => ['push', 'reset', 'update-ref'].includes(args[0])), false);
  }
});

test('real post-commit hook timeout observes changed HEAD without repeating commit, pushing, or rolling back', async (t) => {
  for (const action of ['commit', 'commitAndPush']) {
    const f = await host(t); const bare = await remote(f); await stage(f);
    const preview = await f.generate(); const before = await f.snapshot();
    await writeFile(path.join(f.root, '.git', 'hooks', 'post-commit'), '#!/bin/sh\nprintf "post-commit-entered\\n" > post-commit-entered.txt\nsleep 30\n', { mode: 0o755 });
    f.service.runner.config.commandTimeoutMs = 1200;
    const start = Date.now();
    await assert.rejects(f.mutate({ action, message: preview.message, stagedTree: preview.stagedTree, ...(action === 'commitAndPush' ? { branch: 'main', remote: 'origin' } : {}) }), (error) => {
      assert.equal(error.code, 'COMMIT_FAILED_AFTER_WRITE'); assert.equal(error.details.committed, true); assert.equal(error.details.doNotRetryCommit, true); assert.equal(error.details.causeCode, 'TIMEOUT'); assert.equal(error.details.previousHead, before.head);
      assert.match(error.message, /HEAD 已变化/); assert.match(error.message, /可能已完成/); assert.match(error.message, /勿重复提交/); assert.match(error.message, /未自动推送/); return true;
    });
    assert.ok(Date.now() - start < 12000, 'post-commit timeout and independent inspection must stay bounded');
    f.service.runner.config.commandTimeoutMs = 10000;
    const head = await git(f.root, ['rev-parse', 'HEAD']); assert.notEqual(head, before.head);
    assert.equal(await git(f.root, ['rev-parse', 'HEAD^{tree}']), preview.stagedTree);
    assert.equal(await readFile(path.join(f.root, 'post-commit-entered.txt'), 'utf8'), 'post-commit-entered\n');
    assert.equal(await git(f.root, ['rev-list', '--count', 'HEAD']), '2');
    assert.equal(await git(bare, ['show-ref', '--verify', 'refs/heads/main'], { allow: [0, 1, 128] }), '');
    assert.equal(f.gitCalls.filter((args) => args[0] === 'commit').length, 1); assert.equal(f.gitCalls.some((args) => ['push', 'reset', 'update-ref'].includes(args[0])), false);
    assert.equal(f.gitCalls.filter((args) => args[0] === 'rev-parse' && args.includes('--quiet') && args.at(-1) === 'HEAD').length, 1);
  }
});
