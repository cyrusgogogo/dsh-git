import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import * as ReactDOM from 'react-dom';
import * as runtime from 'react/jsx-runtime';
import { Request as Payload } from '../../src/shared/protocol.mjs';

const definitions = new Map();
window.__ModuleLoader__ = { load: (definition) => definitions.set(definition.id, definition) };
const observable = (initial) => {
  let value = initial;
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, set: (next) => { value = next; for (const listener of listeners) listener(); } };
};
const hash = (number) => Array.from({ length: 5 }, (_, index) => (Math.imul(number + index + 1, 0x9e3779b1) >>> 0).toString(16).padStart(8, '0')).join('');

function makeData() {
  const root = 'D:\\code\\dsh-git';
  const subjects = ['feat(git): 新增底部 Git 工作区与分支菜单', 'feat(worktree): 支持独立工作树与目录切换', 'fix(git): 保护未提交的工作区改动', 'feat(client): 接入 DSH 原生工具栏插槽', 'feat(git): 新增提交详情与文件差异', 'test(git): 覆盖分支切换和远程跟踪', 'feat(ui): 增加分支搜索和历史筛选', 'refactor: 隔离宿主 Git 执行与客户端状态', 'feat(worktree): 增加工作树锁定与移除保护', 'test: 验证非 Git 目录的友好提示', 'docs: 补充插件开发与安装说明', 'chore: 配置客户端 lazy-CJS 构建', 'chore: initialize plugin project'];
  const commits = subjects.map((subject, index) => ({ hash: hash(index + 1), parents: index === 0 ? [hash(2), hash(4)] : index === 2 ? [hash(5)] : index < subjects.length - 1 ? [hash(index + 2)] : [], author: index === 3 ? 'Alex' : 'cyrus', email: 'developer@example.invalid', date: new Date(Date.now() - (index === 12 ? 400 * 86400000 : index === 11 ? 45 * 86400000 : (49 + index * 37) * 60000)).toISOString(), subject, refs: index === 0 ? ['HEAD -> main'] : index === 3 ? ['feature/ui'] : index === 8 ? ['origin/main'] : index === 12 ? ['tag: v0.1.0'] : [] }));
  const branch = (kind, name, index = 0, extra = {}) => ({ kind, name, ref: `refs/${kind === 'local' ? 'heads' : kind === 'remote' ? 'remotes' : 'tags'}/${name}`, hash: commits[index].hash, subject: commits[index].subject, date: commits[index].date, upstream: null, ahead: 0, behind: 0, worktreePath: null, ...extra });
  return { state: 'ready', workspace: { id: 'workspace-main', title: 'dsh-git', path: root }, root, branch: 'main', head: commits[0].hash, ahead: 21, behind: 0, operation: null, remotes: ['origin'], commits,
    branches: [branch('local', 'main', 0, { upstream: 'refs/remotes/origin/main', ahead: 21, worktreePath: root }), branch('local', 'feature/ui', 3, { upstream: 'refs/remotes/origin/feature-ui' }), branch('local', 'feature/worktree', 5, { worktreePath: 'D:\\code\\dsh-git-worktree' }), branch('remote', 'origin/main', 8), branch('remote', 'origin/feature-ui', 3), branch('tag', 'v0.1.0', 12)],
    worktrees: [{ path: root, branch: 'main', head: commits[0].hash, main: true, locked: false, detached: false, prunable: false }, { path: 'D:\\code\\dsh-git-worktree', branch: 'feature/worktree', head: commits[5].hash, main: false, locked: false, detached: false, prunable: false }],
    files: [{ path: 'src/client/panel.jsx', index: '.', worktree: 'M', staged: false, unstaged: true, conflict: false }, { path: 'src/client/styles.css', index: 'M', worktree: '.', staged: true, unstaged: false, conflict: false }, { path: 'docs/usage.md', index: '?', worktree: '?', staged: false, unstaged: true, conflict: false }],
  };
}
const changedFiles = [{ status: 'A', path: 'src/client/panel.jsx' }, { status: 'M', path: 'src/client/styles.css' }, { status: 'M', path: 'src/host/git-service.mjs' }, { status: 'A', path: 'docs/usage.md' }];

window.testMount = ({ windowsMenu = true } = {}) => {
  const nativeMenuClicks = [];
  let menuHost = null;
  const mountWindowsMenu = () => {
    menuHost?.remove();
    document.documentElement.setAttribute('data-windows-titlebar', '');
    menuHost = document.createElement('div');
    menuHost.dataset.windowsMenu = '';
    const shadow = menuHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>:host{position:fixed;top:0;left:48px;z-index:1100;height:40px;display:flex;align-items:center;font-family:Segoe UI,Microsoft YaHei,sans-serif;-webkit-app-region:no-drag}[role=menubar]{display:flex;gap:2px}button{height:28px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#aeb3bd);font:inherit;font-size:14px;cursor:default}button:hover,button[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,#ffffff0c);color:var(--dsw-alias-label-primary,#dce0e6)}button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#83afe9);outline-offset:-2px}</style><div role="menubar" aria-label="应用菜单"><button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" tabindex="0">应用</button><button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" tabindex="-1">编辑</button></div>`;
    const buttons = [...shadow.querySelectorAll('[role=menuitem]')];
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => nativeMenuClicks.push(index));
      button.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); button.tabIndex = -1; const next = buttons[index === 0 ? 1 : 0]; next.tabIndex = 0; next.focus(); }
      });
    });
    document.body.append(menuHost);
  };
  if (windowsMenu) mountWindowsMenu();
  const panelInfo = observable({ activePanelId: null });
  const plugin = definitions.get('dsh-git').factory((name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return runtime;
    if (name === 'react-dom') return ReactDOM;
    throw new Error(`Unexpected external ${name}`);
  });
  const effects = [], entries = new Map(), requests = [];
  const server = makeData();
  const stagedTree = () => hash((server.indexVersion || 0) + server.files.filter((file) => file.staged).reduce((sum, file) => sum + [...file.path].reduce((n, char) => n + char.charCodeAt(0), 0), 0));
  const root = createRoot(document.getElementById('app'));
  const render = () => {
    const Header = entries.get('conversation.session.header.utilities');
    const Overlay = entries.get('shell.overlay');
    root.render(<div className="host-frame"><aside className="host-sidebar"><strong>DSH</strong><span>工作区</span><div className="host-project">⌁ &nbsp; dsh-git</div><small>Git 插件界面测试宿主</small></aside><main className="host-main"><header><span>Git 插件开发</span><div className="host-tools">{Header && <Header />}</div></header><div className="host-placeholder"><div className="host-kicker">WORKSPACE / DSH GIT</div><h1>思路与代码，同步向前。</h1><p>插件使用宿主工具栏和底部扩展面板，<br />真实 Git 操作由独立宿主服务完成。</p></div></main>{Overlay && <Overlay />}</div>);
  };
  const snapshot = (payload) => {
    if (payload.workspaceId === 'workspace-empty') {
      const workspace = { id: payload.workspaceId, title: 'empty-project', path: 'D:\\code\\empty-project' };
      if (!server.emptyInitialized) return { state: 'not-repository', workspace, message: '当前工作区不是 Git 仓库。可以初始化新仓库，或选择已有仓库。' };
      return { state: 'ready', workspace, root: workspace.path, branch: 'main', head: null, branches: [], files: [], worktrees: [], remotes: [], ahead: 0, behind: 0, operation: null };
    }
    const { commits, ...data } = server;
    const tree = payload.worktreePath && server.worktrees.find((item) => item.path === payload.worktreePath);
    return { ...data, stagedTree: stagedTree(), ...(tree ? { root: tree.path, branch: tree.branch, head: tree.head } : {}) };
  };
  const call = async (channel, endpoint, raw, signal) => {
    if (channel !== '/api' || endpoint !== 'dsh-git') throw new Error('Invalid transport target');
    const payload = Payload.parse(raw); requests.push(payload);
    await new Promise((resolve) => setTimeout(resolve, 8)); signal?.throwIfAborted();
    const current = snapshot(payload);
    if (payload.op === 'aiModels' && server.legacyAiModels) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Git 请求参数不合法。', details: { issues: [{ path: ['payload', 'op'], message: 'Invalid input' }] } } };
    if (payload.op === 'aiModels') return { ok: true, value: { available: true, models: [{ provider: 'test-provider', model: 'test-model', label: '测试模型' }, { provider: 'test-provider', model: 'review-model', label: 'Review model' }] } };
    if (payload.op === 'aiCommit') {
      server.aiReceivedFiles = structuredClone(server.files);
      const tree = stagedTree();
      if (server.aiDelay) await new Promise((resolve) => setTimeout(resolve, server.aiDelay));
      signal?.throwIfAborted();
      if (server.aiError) return { ok: false, error: { code: 'AI_ERROR', message: server.aiError } };
      if (!server.files.some((file) => file.staged)) return { ok: false, error: { code: 'NO_STAGED_CHANGES', message: '请先暂存文件。' } };
      return { ok: true, value: { message: server.aiText || 'feat(git): 改进提交工作流\n\n- 支持批量暂存与 AI 提交预览', provider: payload.provider || 'test-provider', model: payload.model || 'test-model', truncated: Boolean(server.aiTruncated), stagedTree: tree } };
    }
    if (payload.op === 'initialize') { server.emptyInitialized = true; return { ok: true, value: { message: '已初始化 Git 仓库（main）。' } }; }
    if (payload.op === 'snapshot') return { ok: true, value: structuredClone(current) };
    if (payload.op === 'history') {
      if (payload.workspaceId === 'workspace-empty') return { ok: true, value: { commits: [], hasMore: false } };
      let commits = server.commits;
      if (payload.ref) {
        const selected = server.branches.find((branch) => branch.ref === payload.ref);
        const reachable = new Set();
        const visit = (hash) => { if (!hash || reachable.has(hash)) return; reachable.add(hash); server.commits.find((commit) => commit.hash === hash)?.parents.forEach(visit); };
        visit(selected?.hash);
        commits = commits.filter((commit) => reachable.has(commit.hash));
      }
      commits = commits.filter((commit) => commit.subject.toLowerCase().includes(payload.search.toLowerCase()) && `${commit.author} <${commit.email}>`.includes(payload.author));
      if (payload.dateRange) {
        const since = new Date();
        if (payload.dateRange === 'today') since.setHours(0, 0, 0, 0);
        else if (payload.dateRange === '1y') since.setFullYear(since.getFullYear() - 1);
        else since.setDate(since.getDate() - Number(payload.dateRange.slice(0, -1)));
        commits = commits.filter((commit) => new Date(commit.date) >= since);
      }
      return { ok: true, value: structuredClone({ commits, hasMore: false }) };
    }
    if (payload.op === 'commit') {
      const commit = server.commits.find((commit) => commit.hash === payload.hash);
      return { ok: true, value: { ...commit, message: `${commit.subject}\n\n通过 DSH 公开扩展点提供仓库历史、分支操作和工作树管理。\n保留原生界面的紧凑信息密度。\n`, files: changedFiles } };
    }
    if (payload.op === 'diff') return { ok: true, value: { text: `diff --git a/${payload.path || 'src/client/panel.jsx'} b/${payload.path || 'src/client/panel.jsx'}\nindex 31f21dc..74ac921 100644\n--- a/panel.jsx\n+++ b/panel.jsx\n@@ -24,4 +24,6 @@ export function GitPanel() {\n-  return null;\n+  return (\n+    <section aria-label="Git 工具面板">\n+      <CommitHistory />\n+    </section>\n+  );\n }\n`, truncated: false } };
    if (payload.op === 'mutate') {
      if (payload.expected.head !== current.head || payload.expected.branch !== current.branch) return { ok: false, error: { code: 'STALE_REPOSITORY', message: '仓库已经变化，请刷新。' } };
      const m = payload.mutation;
      if (['commit', 'commitAndPush'].includes(m.action) && m.stagedTree && m.stagedTree !== stagedTree()) return { ok: false, error: { code: 'STALE_INDEX', message: '暂存内容已变化，请重新生成提交信息。' } };
      if (m.action === 'createBranch') {
        server.branches.push({ kind: 'local', name: m.name, ref: `refs/heads/${m.name}`, hash: server.head, subject: server.commits[0].subject, upstream: null, ahead: 0, behind: 0 });
        if (m.checkout) { server.branch = m.name; server.worktrees[0].branch = m.name; }
      }
      if (m.action === 'checkout') { const branch = server.branches.find((item) => item.ref === m.ref); server.branch = branch.name.replace(/^origin\//, ''); }
      if (m.action === 'createWorktree') {
        const name = m.newBranch || m.ref.replace(/^refs\/heads\//, '');
        server.worktrees.push({ path: m.path, branch: name, head: server.head, main: false, locked: false, prunable: false });
      }
      if (m.action === 'lockWorktree') server.worktrees.find((tree) => tree.path === m.path).locked = m.lock;
      if (m.action === 'removeWorktree') server.worktrees = server.worktrees.filter((tree) => tree.path !== m.path);
      if (m.action === 'cherryPick') {
        if (server.cherryPickConflicts) {
          server.operation = 'cherry-pick';
          server.files = [{ path: 'src/client/panel.jsx', index: 'U', worktree: 'U', staged: false, unstaged: true, conflict: true }];
          return { ok: false, error: { code: 'GIT_COMMAND_FAILED', message: '优选发生冲突，请解决并暂存后继续，或中止操作。' } };
        }
        const source = server.commits.find((commit) => commit.hash === m.hash);
        const picked = { ...source, hash: hash(100 + server.commits.length), parents: [server.head], date: new Date().toISOString(), refs: [`HEAD -> ${server.branch}`] };
        for (const commit of server.commits) commit.refs = commit.refs.filter((ref) => !ref.startsWith('HEAD'));
        server.commits.unshift(picked); server.head = picked.hash;
        server.branches.find((branch) => branch.kind === 'local' && branch.name === server.branch).hash = picked.hash;
        server.worktrees[0].head = picked.hash;
      }
      if (m.action === 'stage' || m.action === 'unstage') {
        if (m.action === 'stage' && server.stageDelay) { await new Promise((resolve) => setTimeout(resolve, server.stageDelay)); signal?.throwIfAborted(); }
        if (m.action === 'stage' && server.stageError) return { ok: false, error: { code: 'GIT_COMMAND_FAILED', message: server.stageError } };
        server.indexVersion = (server.indexVersion || 0) + 1;
        for (const file of server.files.filter((file) => m.paths.includes(file.path))) { file.staged = m.action === 'stage'; file.unstaged = !file.staged; if (file.staged) file.conflict = false; }
      }
      if (m.action === 'commit' || m.action === 'commitAndPush') {
        server.files = server.files.filter((file) => !file.staged);
        server.head = hash(200 + server.commits.length);
        if (m.action === 'commitAndPush' && server.pushError) return { ok: false, error: { code: 'PUSH_FAILED_AFTER_COMMIT', message: `本地提交已成功，但推送失败：${server.pushError}。请仅重试推送，不要重复提交。`, details: { committed: true } } };
      }
      if (m.action === 'abortOperation' || m.action === 'continueOperation') server.operation = null;
      return { ok: true, value: { message: '操作已完成。' } };
    }
  };
  const ctx = {
    connection: { rpc: { call } },
    sessions: { list: observable({ byId: { session1: { id: 'session1', cwd: server.root, retainedBy: { mainView: 1 } } } }) },
    workspaces: { list: observable({ items: [{ workspaceId: 'workspace-main', title: 'dsh-git', path: server.root, sessionIds: ['session1'] }, { workspaceId: 'workspace-empty', title: 'empty-project', path: 'D:\\code\\empty-project', sessionIds: [] }] }) },
    effect: (factory) => { const dispose = factory(); if (typeof dispose === 'function') effects.push(dispose); },
    slots: {
      inject: (name, callback) => { const dispose = callback(); if (typeof dispose === 'function') effects.push(dispose); },
      register: (options, Component) => {
        const face = options.inject();
        const hooks = Object.fromEntries(Object.entries(face.hooks).map(([name, source]) => [`use${name[0].toUpperCase()}${name.slice(1)}`, (selector) => selector(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot))]));
        const usePanelInfo = (selector) => selector(useSyncExternalStore(panelInfo.subscribe, panelInfo.getSnapshot, panelInfo.getSnapshot));
        const Entry = () => <Component {...hooks} usePanelInfo={usePanelInfo} actions={face.actions} />;
        entries.set(options.name, Entry); render();
        return () => { entries.delete(options.name); render(); };
      },
    },
  };
  plugin.apply(ctx);
  let pluginUnloaded = false;
  const unloadPlugin = () => { if (pluginUnloaded) return; pluginUnloaded = true; for (const effect of effects.reverse()) effect(); root.unmount(); };
  window.__gitTest = {
    server, requests, nativeMenuClicks, mountWindowsMenu, unloadPlugin,
    setWorkspaces: (items) => ctx.workspaces.list.set({ items }),
    removeWindowsMenu: () => { menuHost?.remove(); menuHost = null; },
    setSession: (active) => ctx.sessions.list.set({ byId: active ? { session1: { id: 'session1', cwd: server.root, retainedBy: { mainView: 1 } } } : {} }),
    setPanel: (activePanelId) => panelInfo.set({ activePanelId }),
    unload: () => { unloadPlugin(); menuHost?.remove(); document.documentElement.removeAttribute('data-windows-titlebar'); },
  };
};
