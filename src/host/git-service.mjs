import path from 'node:path';
import { realpath, stat, lstat, open } from 'node:fs/promises';
import { GitRunner, GitError } from './git-runner.mjs';
import { parseBranches, parseLog, parseNameStatus, parseStatus, parseWorktrees, LOG_FORMAT } from './parsers.mjs';
import { PluginConfig, Request } from '../shared/protocol.mjs';

const keyPath = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const samePath = (a, b) => keyPath(a) === keyPath(b);
const inside = (root, target) => { const relative = path.relative(keyPath(root), keyPath(target)); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const exists = async (file) => { try { await stat(file); return true; } catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return false; throw e; } };
const operationNames = { merge: '合并', rebase: '变基', 'cherry-pick': '优选（拣选提交）' };
const dangerous = new Set(['deleteBranch', 'merge', 'rebase', 'cherryPick', 'checkoutRebase', 'removeWorktree', 'continueOperation', 'abortOperation', 'push', 'pull', 'pullRemote', 'commit']);

/** All authority comes from a registered workspace id, never a browser cwd. */
export class GitService {
  constructor(workspaces, config = {}, runner) {
    this.workspaces = workspaces;
    this.config = PluginConfig.parse(config);
    this.runner = runner ?? new GitRunner(this.config);
    this.locks = new Map();
  }
  async execute(raw, signal) {
    const request = Request.parse(raw);
    if (request.op === 'initialize') return this.initialize(request, signal);
    if (request.op === 'snapshot') return this.snapshot(request, signal);
    const repo = await this.repository(request, signal);
    if (repo.state !== 'ready') throw new GitError('REPOSITORY_UNAVAILABLE', repo.message);
    if (request.op === 'mutate') {
      return this.serial(repo.commonDir, async () => {
        const fresh = await this.repository(request, signal);
        if (fresh.state !== 'ready' || !samePath(fresh.commonDir, repo.commonDir)) throw new GitError('REPOSITORY_CHANGED', '仓库已变化，请刷新后重试。');
        return this.mutate(fresh, request, signal);
      });
    }
    if (request.op === 'history') return this.history(repo, request, signal);
    if (request.op === 'commit') return this.commit(repo, request.hash, signal);
    if (request.op === 'diff') return this.diff(repo, request, signal);
  }
  async serial(key, task) {
    key = keyPath(key);
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    this.locks.set(key, current);
    try { return await current; } finally { if (this.locks.get(key) === current) this.locks.delete(key); }
  }
  git(repo, args, signal, options = {}) { return this.runner.run(typeof repo === 'string' ? repo : repo.root, args, { signal, ...options }); }
  async repository(request, signal) {
    const workspace = this.workspaces.get(request.workspaceId);
    if (!workspace) throw new GitError('UNKNOWN_WORKSPACE', '工作区已被移除，请重新选择。');
    const info = { id: request.workspaceId, title: workspace.title, path: workspace.path };
    let directory;
    try { directory = await realpath(workspace.path); if (!(await stat(directory)).isDirectory()) throw { code: 'ENOTDIR' }; }
    catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return { state: 'missing-directory', workspace: info, message: '工作区目录不存在或暂时不可用。请在 DSH 中重新选择目录。' };
      throw error;
    }
    const rootResult = await this.git(directory, ['rev-parse', '--show-toplevel'], signal, { allow: [0, 128] }).catch((error) => {
      if (error.code === 'GIT_NOT_INSTALLED') return { unavailable: true, message: error.message };
      throw error;
    });
    if (rootResult.unavailable) return { state: 'git-unavailable', workspace: info, message: rootResult.message };
    if (rootResult.code !== 0) {
      if (/not a git repository|must be run in a work tree/i.test(rootResult.stderr)) return { state: 'not-repository', workspace: info, message: '当前工作区不是 Git 仓库。可以初始化新仓库，或选择已有仓库。' };
      throw new GitError('GIT_COMMAND_FAILED', rootResult.stderr || '无法读取仓库，请检查目录权限。');
    }
    let root = await realpath(rootResult.stdout.trim());
    const authoritativeCommon = await realpath((await this.git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal)).stdout.trim());
    const initial = { root };
    const trees = await this.worktrees(initial, signal);
    if (request.worktreePath && !samePath(request.worktreePath, root)) {
      const tree = trees.find((item) => samePath(item.path, request.worktreePath));
      if (!tree || tree.prunable || tree.bare) throw new GitError('INVALID_WORKTREE', '所选路径不是此仓库的可用工作树，请刷新列表。');
      root = await realpath(tree.path);
    }
    const [gitDir, commonDir, branch, head] = await Promise.all([
      this.git(root, ['rev-parse', '--absolute-git-dir'], signal),
      this.git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal),
      this.git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal, { allow: [0, 1] }),
      this.git(root, ['rev-parse', '--verify', 'HEAD'], signal, { allow: [0, 128] }),
    ]);
    const canonicalCommon = await realpath(commonDir.stdout.trim());
    if (!samePath(authoritativeCommon, canonicalCommon)) throw new GitError('WORKTREE_REPOSITORY_CHANGED', '工作树路径已被另一个仓库替换，已阻止访问。请修复工作树登记后重试。');
    return { state: 'ready', workspace: info, root, gitDir: gitDir.stdout.trim(), commonDir: canonicalCommon, branch: branch.code === 0 ? branch.stdout.trim() : null, head: head.code === 0 ? head.stdout.trim() : null };
  }
  async initialize(request, signal) {
    const detected = await this.repository(request, signal);
    if (detected.state !== 'not-repository') throw new GitError('INITIALIZE_UNAVAILABLE', detected.message || '此目录已处于 Git 仓库中，不需要再次初始化。');
    const directory = await realpath(detected.workspace.path);
    return this.serial(path.join(directory, '.git'), async () => {
      const current = await this.repository(request, signal);
      if (current.state !== 'not-repository' || !samePath(await realpath(current.workspace.path), directory)) throw new GitError('REPOSITORY_CHANGED', '工作区已变化，请重新检测后再初始化。');
      let metadata;
      try { metadata = await lstat(path.join(directory, '.git')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (metadata) throw new GitError('REPOSITORY_EXISTS', '目录已有 .git 元数据，不会覆盖。请先在终端中检查或修复仓库。');
      const gitDirectory = await this.git(directory, ['rev-parse', '--absolute-git-dir'], signal, { allow: [0, 128] });
      if (gitDirectory.code === 0 && samePath(gitDirectory.stdout.trim(), directory)) throw new GitError('REPOSITORY_EXISTS', '此目录是 bare 仓库，不能重新初始化为工作区。');
      await this.git(directory, ['init', '--initial-branch=main'], signal, { readOnly: false });
      return { message: '已初始化 Git 仓库（main）。尚未创建提交，也未修改 Git 用户配置。' };
    });
  }
  async worktrees(repo, signal) { return parseWorktrees((await this.git(repo, ['worktree', 'list', '--porcelain', '-z'], signal)).stdout); }
  async branches(repo, signal) {
    const format = '%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track)%00%(committerdate:iso8601-strict)%00%(subject)%00%(worktreepath)%00%(symref)%00';
    return parseBranches((await this.git(repo, ['for-each-ref', `--format=${format}`, '--sort=refname', 'refs/heads', 'refs/remotes', 'refs/tags'], signal)).stdout);
  }
  async operation(repo) {
    if (await exists(path.join(repo.gitDir, 'rebase-merge')) || await exists(path.join(repo.gitDir, 'rebase-apply'))) return 'rebase';
    if (await exists(path.join(repo.gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
    if (await exists(path.join(repo.gitDir, 'MERGE_HEAD'))) return 'merge';
    return null;
  }
  async snapshot(request, signal) {
    const repo = await this.repository(request, signal);
    if (repo.state !== 'ready') return repo;
    const [status, branches, worktrees, remotes, operation] = await Promise.all([
      this.git(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], signal),
      this.branches(repo, signal), this.worktrees(repo, signal), this.git(repo, ['remote'], signal), this.operation(repo),
    ]);
    const { gitDir, commonDir, ...publicRepo } = repo;
    return { ...publicRepo, ...parseStatus(status.stdout), branches, worktrees, remotes: remotes.stdout.trim().split('\n').filter(Boolean), operation };
  }
  async resolveRef(repo, ref, signal) {
    if (ref !== 'HEAD' && !/^[a-f\d]{40,64}$/i.test(ref)) {
      const branches = await this.branches(repo, signal);
      const match = branches.find((item) => item.ref === ref || item.name === ref);
      if (!match) throw new GitError('UNKNOWN_REF', '引用不存在或已被删除，请刷新后重试。');
      ref = match.ref;
    }
    const value = await this.git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], signal);
    return value.stdout.trim();
  }
  repoPath(repo, file) {
    if (path.isAbsolute(file) || file.includes('\0') || file.split(/[\\/]/).some((segment) => segment === '..' || segment.toLowerCase() === '.git')) throw new GitError('INVALID_PATH', '只能读取当前仓库内的文件。');
    const target = path.resolve(repo.root, file);
    if (!inside(repo.root, target)) throw new GitError('INVALID_PATH', '文件路径超出仓库范围。');
    return { relative: path.relative(repo.root, target).split(path.sep).join('/') || '.', absolute: target };
  }
  async history(repo, request, signal) {
    if (!repo.head) return { commits: [], hasMore: false };
    const args = ['log', '-z', '--topo-order', '--decorate=short', `--format=${LOG_FORMAT}`, `--max-count=${this.config.maxCommits + 1}`, `--skip=${request.skip}`];
    if (request.search) args.push('--fixed-strings', '--regexp-ignore-case', `--grep=${request.search}`);
    // Author input is literal, not a user-provided regular expression.
    if (request.author) args.push('--fixed-strings', `--author=${request.author}`);
    if (request.dateRange) {
      const since = new Date();
      if (request.dateRange === 'today') since.setHours(0, 0, 0, 0);
      else if (request.dateRange === '1y') since.setFullYear(since.getFullYear() - 1);
      else since.setDate(since.getDate() - Number(request.dateRange.slice(0, -1)));
      args.push(`--since=${since.toISOString()}`);
    }
    if (request.ref) args.push(await this.resolveRef(repo, request.ref, signal));
    else args.push('--all', 'HEAD');
    args.push('--');
    if (request.path) args.push(this.repoPath(repo, request.path).relative);
    const commits = parseLog((await this.git(repo, args, signal)).stdout);
    return { commits: commits.slice(0, this.config.maxCommits), hasMore: commits.length > this.config.maxCommits };
  }
  async commit(repo, hash, signal) {
    const oid = await this.resolveRef(repo, hash, signal);
    const format = `${LOG_FORMAT}%x00%B`;
    const details = parseLog((await this.git(repo, ['show', '-s', '-z', '--decorate=short', `--format=${format}`, oid, '--'], signal)).stdout, true)[0];
    const args = details.parents.length
      ? ['diff', '--name-status', '-z', '-M', details.parents[0], oid, '--']
      : ['diff-tree', '--root', '--no-commit-id', '--name-status', '-z', '-r', '-M', oid, '--'];
    const files = parseNameStatus((await this.git(repo, args, signal)).stdout);
    return { ...details, files };
  }
  async diff(repo, request, signal) {
    const args = ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--unified=3'];
    if (request.kind === 'staged') args.push('--cached');
    if (request.kind === 'working' && request.ref) args.push(await this.resolveRef(repo, request.ref, signal));
    if (request.kind === 'compare') {
      if (!request.ref) throw new GitError('INVALID_REQUEST', '请选择要比较的分支。');
      args.push('HEAD', await this.resolveRef(repo, request.ref, signal));
    }
    if (request.kind === 'commit') {
      if (!request.hash) throw new GitError('INVALID_REQUEST', '请选择提交。');
      const oid = await this.resolveRef(repo, request.hash, signal);
      const details = await this.commit(repo, oid, signal);
      if (details.parents[0]) args.push(details.parents[0], oid);
      else args.splice(0, args.length, 'show', '--format=', '--no-ext-diff', '--no-textconv', '--find-renames', oid);
    }
    args.push('--');
    if (request.path) args.push(this.repoPath(repo, request.path).relative);
    if (request.kind === 'working' && request.path) {
      const status = parseStatus((await this.git(repo, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', this.repoPath(repo, request.path).relative], signal)).stdout);
      if (status.files.some((file) => file.path === request.path && file.index === '?')) return this.untrackedDiff(repo, request.path);
    }
    const result = await this.git(repo, args, signal, { truncate: true, maxBytes: 1024 * 1024 });
    return { text: result.stdout, truncated: result.truncated };
  }
  async untrackedDiff(repo, file) {
    const resolved = this.repoPath(repo, file);
    const canonical = await realpath(resolved.absolute);
    if (!inside(repo.root, canonical)) throw new GitError('INVALID_PATH', '符号链接指向仓库外部，已跳过内容预览。');
    const handle = await open(canonical, 'r');
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) return { text: '此路径不是普通文件。', truncated: false };
      const buffer = Buffer.alloc(Math.min(metadata.size, 256 * 1024));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const content = buffer.subarray(0, bytesRead);
      if (content.includes(0)) return { text: `Binary file: ${file}`, truncated: false };
      const lines = content.toString('utf8').split('\n');
      return { text: `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => '+' + line).join('\n')}`, truncated: metadata.size > buffer.length };
    } finally { await handle.close(); }
  }
  async localBranch(repo, value, signal) {
    const branch = (await this.branches(repo, signal)).find((item) => item.kind === 'local' && (item.ref === value || item.name === value));
    if (!branch) throw new GitError('INVALID_BRANCH', '请选择已有的本地分支。');
    await this.checkName(repo, branch.name, signal);
    return branch;
  }
  async checkName(repo, name, signal) {
    if (name.startsWith('-') || name === 'HEAD' || name === '@' || name.includes('@{')) throw new GitError('INVALID_BRANCH_NAME', '分支名称不合法或包含特殊 Git 语法。');
    const result = await this.git(repo, ['check-ref-format', '--branch', name], signal, { allow: [0, 128, 1] });
    if (result.code !== 0) throw new GitError('INVALID_BRANCH_NAME', '分支名称不合法，请避免空格、.. 和特殊字符。');
  }
  async clean(repo, signal) {
    const status = parseStatus((await this.git(repo, ['status', '--porcelain=v2', '-z', '--untracked-files=all'], signal)).stdout);
    if (status.files.length) throw new GitError('DIRTY_WORKTREE', '工作区存在未提交的改动。请先提交或自行暂存改动，再执行此操作。');
  }
  async upstream(repo, branch, signal) {
    const format = '%(upstream:remotename)%00%(upstream:remoteref)';
    const result = (await this.git(repo, ['for-each-ref', `--format=${format}`, branch.ref], signal)).stdout.trim().split('\0');
    if (!result[0] || !result[1]) throw new GitError('NO_UPSTREAM', '分支尚未设置上游。请在分支菜单中选择跟踪分支。');
    if (result[0] === '.') throw new GitError('LOCAL_UPSTREAM', '此分支跟踪的是本地分支，请直接使用合并或变基。');
    return { remote: result[0], ref: result[1] };
  }
  async remoteMapping(repo, ref, signal) {
    const remotes = (await this.git(repo, ['remote'], signal)).stdout.trim().split('\n').filter(Boolean);
    const matches = new Map();
    const match = (pattern, value) => {
      const star = pattern.indexOf('*');
      if (star < 0) return pattern === value ? '' : null;
      if (pattern.indexOf('*', star + 1) >= 0) return null;
      const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
      return value.startsWith(prefix) && value.endsWith(suffix) && value.length >= prefix.length + suffix.length ? value.slice(prefix.length, value.length - suffix.length) : null;
    };
    for (const remote of remotes) {
      const result = await this.git(repo, ['config', '--null', '--get-all', `remote.${remote}.fetch`], signal, { allow: [0, 1] });
      const specs = result.stdout.split('\0').filter(Boolean);
      for (const raw of specs) {
        if (raw.startsWith('^')) continue;
        const spec = raw.replace(/^\+/, ''), colon = spec.indexOf(':');
        if (colon < 0) continue;
        const sourcePattern = spec.slice(0, colon), destination = spec.slice(colon + 1);
        const capture = match(destination, ref);
        if (capture === null) continue;
        const source = sourcePattern.replace('*', capture);
        if (!source.startsWith('refs/heads/') || specs.some((negative) => negative.startsWith('^') && match(negative.slice(1), source) !== null)) continue;
        matches.set(`${remote}\0${source}`, { remote, source, name: source.slice('refs/heads/'.length) });
      }
    }
    if (matches.size !== 1) throw new GitError(matches.size ? 'AMBIGUOUS_REMOTE' : 'INVALID_REMOTE_MAPPING', matches.size ? '多个远程 fetch 配置映射到了同一引用，无法安全确定目标。请消除映射歧义后重试。' : '无法从 fetch 配置确定此远程分支的真实来源。');
    return [...matches.values()][0];
  }
  async checkout(repo, ref, signal) {
    const branches = await this.branches(repo, signal);
    const branch = branches.find((item) => item.ref === ref || item.name === ref);
    if (!branch) throw new GitError('UNKNOWN_REF', '所选分支不存在，请刷新。');
    if (branch.kind === 'local') { await this.checkName(repo, branch.name, signal); return this.git(repo, ['switch', '--', branch.name], signal, { readOnly: false }); }
    if (branch.kind === 'tag') return this.git(repo, ['switch', '--detach', '--', await this.resolveRef(repo, branch.ref, signal)], signal, { readOnly: false });
    const { name } = await this.remoteMapping(repo, branch.ref, signal);
    await this.checkName(repo, name, signal);
    const local = branches.find((item) => item.kind === 'local' && item.name === name);
    if (local) {
      if (local.upstream !== branch.ref) throw new GitError('BRANCH_EXISTS', '同名本地分支跟踪其他引用，请选择本地分支或创建不同名称。');
      return this.git(repo, ['switch', '--', name], signal, { readOnly: false });
    }
    return this.git(repo, ['switch', '--track', '-c', name, '--', branch.ref], signal, { readOnly: false });
  }
  async checkedTree(repo, target, signal) {
    const trees = await this.worktrees(repo, signal);
    const tree = trees.find((item) => samePath(item.path, target));
    if (!tree) throw new GitError('INVALID_WORKTREE', '工作树不属于当前仓库。');
    return tree;
  }
  async mutate(repo, request, signal) {
    const { mutation: m, expected, confirmed } = request;
    if (repo.head !== expected.head || repo.branch !== expected.branch) throw new GitError('STALE_REPOSITORY', 'HEAD 或当前分支已变化。已阻止旧页面操作，请刷新后重试。');
    if (dangerous.has(m.action) && !confirmed) throw new GitError('CONFIRMATION_REQUIRED', '此操作需要明确确认。');
    const operation = await this.operation(repo);
    if (operation && !['continueOperation', 'abortOperation', 'stage', 'unstage'].includes(m.action)) throw new GitError('OPERATION_IN_PROGRESS', `仓库正在${operationNames[operation]}中。请先解决冲突并继续，或中止操作。`);
    const write = (args, options) => this.git(repo, args, signal, { readOnly: false, ...options });
    let result;
    switch (m.action) {
      case 'createBranch': {
        await this.checkName(repo, m.name, signal);
        const start = await this.resolveRef(repo, m.start, signal);
        result = await write(m.checkout ? ['switch', '-c', m.name, '--', start] : ['branch', '--', m.name, start]);
        break;
      }
      case 'checkout': result = await this.checkout(repo, m.ref, signal); break;
      case 'checkoutRebase': {
        await this.clean(repo, signal);
        const base = repo.head;
        if (!base) throw new GitError('UNBORN_BRANCH', '当前分支还没有提交。');
        await this.checkout(repo, m.ref, signal);
        result = await write(['rebase', base]);
        break;
      }
      case 'renameBranch': {
        const branch = await this.localBranch(repo, m.branch, signal);
        await this.checkName(repo, m.name, signal);
        if (branch.worktreePath && !samePath(branch.worktreePath, repo.root)) throw new GitError('BRANCH_IN_USE', '分支正在另一工作树中使用，请切换到该工作树后重命名。');
        result = await write(['branch', '-m', '--', branch.name, m.name]);
        break;
      }
      case 'deleteBranch': {
        const branch = (await this.branches(repo, signal)).find((item) => item.ref === m.ref || item.name === m.ref);
        if (!branch || branch.kind === 'tag') throw new GitError('INVALID_BRANCH', '所选分支不可删除。');
        if (branch.kind === 'local') {
          if (branch.name === repo.branch || branch.worktreePath) throw new GitError('BRANCH_IN_USE', '不能删除当前分支或正被工作树使用的分支。');
          await this.checkName(repo, branch.name, signal);
          result = await write(['branch', '-d', '--', branch.name]);
        } else {
          const mapping = await this.remoteMapping(repo, branch.ref, signal);
          result = await write(['push', '--delete', '--', mapping.remote, mapping.source], { network: true });
        }
        break;
      }
      case 'merge': case 'rebase': {
        if (!repo.head || !repo.branch) throw new GitError('NO_CURRENT_BRANCH', '请先签出一个已有提交的本地分支。');
        await this.clean(repo, signal);
        const oid = await this.resolveRef(repo, m.ref, signal);
        result = await write(m.action === 'merge' ? ['merge', '--no-edit', oid] : ['rebase', oid]);
        break;
      }
      case 'cherryPick': {
        if (!repo.head || !repo.branch) throw new GitError('NO_CURRENT_BRANCH', '请先签出一个已有提交的本地分支。');
        await this.clean(repo, signal);
        const oid = await this.resolveRef(repo, m.hash, signal);
        if (oid === repo.head) throw new GitError('ALREADY_AT_COMMIT', '当前 HEAD 已是此提交，无需优选。');
        const parents = (await this.git(repo, ['show', '-s', '--format=%P', oid, '--'], signal)).stdout.trim().split(/\s+/).filter(Boolean);
        if (parents.length > 1) throw new GitError('MERGE_COMMIT_UNSUPPORTED', '暂不支持优选合并提交，请选择普通提交。不会自动猜测主父提交。');
        result = await write(['cherry-pick', '--no-edit', oid]);
        break;
      }
      case 'fetch': result = await write(['fetch', '--all', '--prune'], { network: true }); break;
      case 'stage': case 'unstage': {
        const files = new Set(m.paths.map((file) => this.repoPath(repo, file).relative));
        if (m.action === 'unstage') {
          const status = parseStatus((await this.git(repo, ['status', '--porcelain=v2', '-z', '--untracked-files=all'], signal)).stdout);
          for (const file of status.files) if (file.originalPath && (files.has(file.path) || files.has(file.originalPath))) { files.add(file.path); files.add(file.originalPath); }
        }
        if (m.action === 'stage') result = await write(['add', '--', ...files]);
        else if (repo.head) result = await write(['restore', '--staged', '--', ...files]);
        else result = await write(['rm', '--cached', '--', ...files]);
        break;
      }
      case 'commit': {
        const status = parseStatus((await this.git(repo, ['status', '--porcelain=v2', '-z'], signal)).stdout);
        if (!status.files.some((file) => file.staged)) throw new GitError('NOTHING_STAGED', '请先暂存要提交的文件。');
        if (status.files.some((file) => file.conflict)) throw new GitError('UNRESOLVED_CONFLICTS', '请先解决并暂存所有冲突。');
        result = await write(['commit', '-m', m.message]);
        break;
      }
      case 'pullRemote': {
        await this.clean(repo, signal);
        if (!repo.branch || !repo.head) throw new GitError('NO_CURRENT_BRANCH', '请先签出一个已有提交的本地分支。');
        const branch = (await this.branches(repo, signal)).find((item) => item.kind === 'remote' && (item.ref === m.ref || item.name === m.ref));
        if (!branch) throw new GitError('INVALID_REMOTE', '请选择已有远程分支。');
        const mapping = await this.remoteMapping(repo, branch.ref, signal);
        await write(['fetch', '--', mapping.remote, mapping.source], { network: true });
        // FETCH_HEAD is pinned under the same common-dir mutation lock.
        const fetched = (await this.git(repo, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], signal)).stdout.trim();
        result = await write(m.strategy === 'merge' ? ['merge', '--no-edit', fetched] : ['rebase', fetched]);
        break;
      }
      case 'pull': {
        const branch = await this.localBranch(repo, m.branch, signal);
        const upstream = await this.upstream(repo, branch, signal);
        if (branch.name === repo.branch) {
          await this.clean(repo, signal);
          result = await write(['pull', '--ff-only', '--', upstream.remote, upstream.ref], { network: true });
        } else {
          if (branch.worktreePath) throw new GitError('BRANCH_IN_USE', '分支正被另一工作树使用，请在那里更新。');
          result = await write(['fetch', '--', upstream.remote, `${upstream.ref}:${branch.ref}`], { network: true });
        }
        break;
      }
      case 'push': {
        const branch = await this.localBranch(repo, m.branch, signal);
        if (m.remote) {
          const remotes = (await this.git(repo, ['remote'], signal)).stdout.trim().split('\n');
          if (!remotes.includes(m.remote)) throw new GitError('INVALID_REMOTE', '远程仓库不存在。');
          result = await write(['push', '--set-upstream', '--', m.remote, `${branch.ref}:refs/heads/${branch.name}`], { network: true });
        } else {
          const upstream = await this.upstream(repo, branch, signal);
          result = await write(['push', '--', upstream.remote, `${branch.ref}:${upstream.ref}`], { network: true });
        }
        break;
      }
      case 'setUpstream': {
        const branch = await this.localBranch(repo, m.branch, signal);
        const upstream = (await this.branches(repo, signal)).find((item) => item.kind === 'remote' && (item.ref === m.upstream || item.name === m.upstream));
        if (!upstream) throw new GitError('INVALID_UPSTREAM', '请选择已有远程分支。');
        result = await write(['branch', `--set-upstream-to=${upstream.name}`, '--', branch.name]);
        break;
      }
      case 'createWorktree': {
        if (!path.isAbsolute(m.path)) throw new GitError('INVALID_PATH', '工作树目录必须是绝对路径。');
        const target = path.resolve(m.path);
        // Canonicalize the existing parent so symlinks cannot bypass repository guards.
        const canonical = path.join(await realpath(path.dirname(target)), path.basename(target));
        if (inside(repo.root, canonical) || inside(repo.commonDir, canonical) || inside(canonical, repo.root)) throw new GitError('INVALID_PATH', '请在仓库目录之外选择一个新的工作树目录。');
        const branches = await this.branches(repo, signal);
        const source = branches.find((item) => item.ref === m.ref || item.name === m.ref);
        const oid = await this.resolveRef(repo, m.ref, signal);
        let args;
        if (m.newBranch) { await this.checkName(repo, m.newBranch, signal); args = ['worktree', 'add', '-b', m.newBranch, '--', target, oid]; }
        else if (source?.kind === 'local') args = ['worktree', 'add', '--', target, source.name];
        else args = ['worktree', 'add', '--detach', '--', target, oid];
        result = await write(args);
        break;
      }
      case 'removeWorktree': {
        const tree = await this.checkedTree(repo, m.path, signal);
        if (tree.main || samePath(tree.path, repo.root)) throw new GitError('PROTECTED_WORKTREE', '不能移除主工作树或当前打开的工作树。');
        if (tree.locked) throw new GitError('LOCKED_WORKTREE', '工作树已锁定，请先解锁。');
        // Git itself refuses dirty worktrees. Never use --force or recursive fs removal.
        result = await write(['worktree', 'remove', '--', tree.path]);
        break;
      }
      case 'lockWorktree': {
        const tree = await this.checkedTree(repo, m.path, signal);
        if (tree.main) throw new GitError('PROTECTED_WORKTREE', '主工作树不支持锁定操作。');
        result = await write(['worktree', m.lock ? 'lock' : 'unlock', '--', tree.path]);
        break;
      }
      case 'continueOperation': case 'abortOperation': {
        if (operation !== m.operation) throw new GitError('OPERATION_CHANGED', '正在进行的 Git 操作已变化，请刷新。');
        result = await write([m.operation, m.action === 'abortOperation' ? '--abort' : '--continue'], { });
        break;
      }
      default: throw new GitError('INVALID_ACTION', '不支持的 Git 操作。');
    }
    return { message: result?.stderr || result?.stdout?.trim() || '操作已完成。' };
  }
  async dispose() {
    await this.runner.dispose();
    await Promise.allSettled([...this.locks.values()]);
  }
}
