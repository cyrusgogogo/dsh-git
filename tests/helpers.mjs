import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { GitService } from '../src/host/git-service.mjs';

const exec = promisify(execFile);
const testRoot = path.resolve('.test-tmp');
export async function git(cwd, args, { allow = [0], env = {} } = {}) {
  try { return (await exec('git', ['--no-pager', '-c', 'color.ui=false', ...args], { cwd, windowsHide: true, timeout: 20000, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_EDITOR: 'true', ...env } })).stdout.trim(); }
  catch (error) { if (allow.includes(error.code)) return (error.stdout || '').trim(); throw error; }
}
export async function fixture({ commit = true, repository = true } = {}) {
  await mkdir(testRoot, { recursive: true });
  const base = await mkdtemp(path.join(testRoot, 'repo-'));
  const root = path.join(base, 'repository with spaces');
  await mkdir(root);
  if (!repository) await git(base, ['init', '--bare', '--initial-branch=main']);
  if (repository) {
    await git(root, ['init', '--initial-branch=main']);
    await git(root, ['config', 'user.name', 'Git Plugin Test']);
    await git(root, ['config', 'user.email', 'git-plugin@example.invalid']);
    await git(root, ['config', 'commit.gpgsign', 'false']);
    await git(root, ['config', 'core.autocrlf', 'false']);
    if (commit) {
      await writeFile(path.join(root, 'readme.txt'), 'initial\n', 'utf8');
      await git(root, ['add', '--', 'readme.txt']);
      await git(root, ['commit', '-m', 'chore: initial commit']);
    }
  }
  const workspace = { id: 'test-workspace', title: 'Test repository', path: root };
  const registry = { get: (id) => id === workspace.id ? workspace : undefined };
  const service = new GitService(registry, { maxCommits: 20, commandTimeoutMs: 10000, networkTimeoutMs: 20000 });
  const scope = { workspaceId: workspace.id };
  const call = (request) => service.execute({ ...scope, ...request });
  const snapshot = (extra = {}) => call({ op: 'snapshot', ...extra });
  const mutate = async (mutation, { confirmed = true, ...extra } = {}) => {
    const data = await snapshot(extra);
    return call({ op: 'mutate', expected: { head: data.head, branch: data.branch }, confirmed, mutation, ...extra });
  };
  return { base, root, workspace, registry, service, scope, call, snapshot, mutate, async cleanup() {
    await service.dispose();
    const absolute = path.resolve(base);
    if (!absolute.startsWith(testRoot + path.sep)) throw new Error('Refusing unsafe fixture cleanup');
    await rm(absolute, { recursive: true, force: true });
  } };
}
export async function addCommit(root, name, content, message, options) {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), content, 'utf8');
  await git(root, ['add', '--', name]);
  await git(root, ['commit', '-m', message], options);
  return git(root, ['rev-parse', 'HEAD']);
}
