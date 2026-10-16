import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranches, parseLog, parseNameStatus, parseStatus, parseWorktrees } from '../src/host/parsers.mjs';
import { Request, PluginConfig } from '../src/shared/protocol.mjs';
import { layoutGraph } from '../src/client/graph.mjs';
import { redact } from '../src/host/git-runner.mjs';

test('porcelain v2 preserves Unicode, spaces and rename source paths', () => {
  const status = parseStatus('# branch.ab +21 -2\0' + '1 M. N... 100644 100644 100644 a b src/中文 文件.ts\0' + '2 R. N... 100644 100644 100644 a b R100 new name.txt\0old name.txt\0' + '? untracked space.txt\0' + 'u UU N... 100644 100644 100644 100644 a b c conflict.txt\0');
  assert.equal(status.ahead, 21); assert.equal(status.behind, 2);
  assert.equal(status.files[0].path, 'src/中文 文件.ts');
  assert.equal(status.files[1].originalPath, 'old name.txt');
  assert.equal(status.files[1].path, 'new name.txt');
  assert.equal(status.files[2].staged, false);
  assert.equal(status.files[3].path, 'conflict.txt'); assert.equal(status.files[3].conflict, true);
});
test('branch parsing excludes symbolic origin/HEAD and retains tracking metadata', () => {
  const branches = parseBranches(['refs/heads/main', 'a'.repeat(40), 'refs/remotes/origin/main', '[ahead 2, behind 1]', '2026-01-01T12:00:00Z', 'hello', 'D:/repo\nwith newline', ''].join('\0') + '\0\n' + ['refs/remotes/origin/HEAD', 'a'.repeat(40), '', '', '', '', '', 'refs/remotes/origin/main'].join('\0') + '\0\n');
  assert.equal(branches.length, 1); assert.equal(branches[0].ahead, 2); assert.equal(branches[0].behind, 1); assert.equal(branches[0].worktreePath, 'D:/repo\nwith newline');
});
test('worktree porcelain handles detached, locked and missing paths', () => {
  const trees = parseWorktrees('worktree D:/main\0HEAD abc\0branch refs/heads/main\0\0worktree D:/feature with space\0HEAD def\0detached\0locked portable drive\0prunable gitdir missing\0\0');
  assert.equal(trees[0].main, true); assert.equal(trees[1].path, 'D:/feature with space'); assert.equal(trees[1].detached, true); assert.equal(trees[1].lockReason, 'portable drive'); assert.equal(trees[1].prunable, true);
});
test('name status parser correctly consumes rename pairs', () => {
  assert.deepEqual(parseNameStatus('R100\0old name\0new name\0M\0x\0'), [{ status: 'R', originalPath: 'old name', path: 'new name' }, { status: 'M', path: 'x' }]);
});
test('log parser exposes actual parent relationships and optional bodies', () => {
  const parsed = parseLog(['a'.repeat(40), 'b'.repeat(40) + ' ' + 'c'.repeat(40), 'User', 'a@example.invalid', '2026-01-01', 'subject\x1elegal', 'HEAD -> main, origin/main', 'body\nnext\x1e\n'].join('\0') + '\0', true);
  assert.deepEqual(parsed[0].parents, ['b'.repeat(40), 'c'.repeat(40)]); assert.deepEqual(parsed[0].refs, ['HEAD -> main', 'origin/main']); assert.equal(parsed[0].message, 'body\nnext\x1e\n');
  assert.equal(parsed.length, 1); assert.equal(parsed[0].subject, 'subject\x1elegal');
});
test('graph lanes are based on merge parents, not a decorative straight line', () => {
  const commits = [{ hash: 'merge', parents: ['a', 'b'] }, { hash: 'a', parents: ['root'] }, { hash: 'b', parents: ['root'] }, { hash: 'root', parents: [] }];
  const { rows, width } = layoutGraph(commits);
  assert.equal(rows[0].parents.length, 2); assert.notEqual(rows[0].parents[0].lane, rows[0].parents[1].lane); assert.equal(rows[2].parents[0].lane, rows[3].lane); assert.ok(width >= 40);
});
test('protocol rejects arbitrary argv, invalid names and unbounded inputs', () => {
  assert.equal(Request.safeParse({ op: 'exec', workspaceId: 'w', argv: ['reset', '--hard'] }).success, false);
  assert.equal(Request.safeParse({ op: 'mutate', workspaceId: 'w', expected: { head: null, branch: 'main' }, mutation: { action: 'checkout', ref: '--force' } }).success, false);
  assert.equal(Request.safeParse({ op: 'history', workspaceId: 'w', skip: -1 }).success, false);
  assert.equal(PluginConfig.parse({}).maxCommits, 300);
  assert.equal(PluginConfig.safeParse({ maxCommits: 100000 }).success, false);
});
test('error redaction strips embedded URL credentials and query secrets', () => {
  assert.equal(redact('https://user:secret@example.com/x?token=abc&ok=1 password=hunter2'), 'https://[redacted]@example.com/x?token=[redacted]&ok=1 password=[redacted]');
});
