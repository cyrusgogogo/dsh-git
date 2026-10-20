import { loadSettings, saveSettings as persistSettings, validateSettings, matchesShortcut } from './settings.mjs';

const newTab = (kind, id) => ({ id, kind, ref: '', search: '', author: '', path: '', dateRange: '', commits: [], hasMore: false, selected: null, detail: null, loading: false });
const errorMessage = (error) => error?.message || String(error);
const makeExpected = (data) => ({ head: data?.head ?? null, branch: data?.branch ?? null });

/** Stable observable model; renderer binds this source to the injected useGit hook. */
export class GitModel {
  constructor(call, { storage } = {}) {
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
    this.call = call;
    this.disposed = false;
    this.storage = storage;
    this.listeners = new Set();
    this.requests = new Map();
    this.sequence = 1;
    this.aiSequence = 0;
    this.aiPreparationSequence = 0;
    this.snapshotSequence = 0;
    this.modelsSequence = 0;
    this.generation = 0;
    let height = 380;
    try { height = Number(storage?.getItem('dsh-git.height')) || height; } catch { /* Browser storage may be disabled. */ }
    this.state = { settings: loadSettings(storage), aiModels: [], aiModelsLoading: false, aiModelsError: '', aiModelsErrorCode: '', aiBusy: false, aiPreparing: false, aiSelectedPaths: null, aiDraft: null, open: false, maximized: false, height: Math.max(230, Math.min(800, height)), tabs: [newTab('git', 'git-1')], activeTab: 'git-1', workspaceId: '', worktreePath: undefined, workspaces: [], hasSession: false, data: null, loading: false, busy: '', error: null, notice: '', dialog: null, diff: null, sidebarTab: 'branches' };
    this.source = { getSnapshot: () => this.state, subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); } };
  }
  patch(update) { if (this.disposed) return; this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  patchTab(id, update) { this.patch({ tabs: this.state.tabs.map((tab) => tab.id === id ? { ...tab, ...update } : tab) }); }
  tab() { return this.state.tabs.find((tab) => tab.id === this.state.activeTab); }
  scope() { return { workspaceId: this.state.workspaceId, ...(this.state.worktreePath ? { worktreePath: this.state.worktreePath } : {}) }; }
  async request(name, payload) {
    if (this.disposed) throw new DOMException('Plugin disposed', 'AbortError');
    this.requests.get(name)?.abort();
    const controller = new AbortController();
    this.requests.set(name, controller);
    try {
      const result = await this.call(payload, controller.signal);
      controller.signal.throwIfAborted();
      if (!result || typeof result.ok !== 'boolean') throw new Error('Git 响应格式不正确，请检查插件与宿主版本。');
      if (!result.ok) {
        const error = new Error(result.error.message);
        error.code = result.error.code;
        error.details = result.error.details;
        const issues = Array.isArray(error.details?.issues) ? error.details.issues : [];
        const rejectedOperation = issues.some((issue) => Array.isArray(issue.path) && issue.path.join('.') === 'payload.op');
        const rejectedMutation = issues.some((issue) => Array.isArray(issue.path) && issue.path.join('.') === 'payload.mutation.action');
        if (error.code === 'INVALID_REQUEST' && ((['aiModels', 'aiCommit'].includes(payload.op) && rejectedOperation) || (payload.op === 'mutate' && payload.mutation?.action === 'commitAndPush' && rejectedMutation))) {
          error.code = 'HOST_UPGRADE_REQUIRED';
          error.message = 'Git 插件前后端版本不一致：运行中的宿主尚不支持此功能。请完全退出并重启 DSH；仅刷新页面不会重载宿主插件。若仍失败，请确认当前 profile 已更新插件。';
        }
        throw error;
      }
      return result.value;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally { if (this.requests.get(name) === controller) this.requests.delete(name); }
  }
  syncContext(workspaces, sessions) {
    const items = workspaces?.items ?? [];
    const active = Object.values(sessions?.byId ?? {}).find((session) => (session.retainedBy?.mainView ?? 0) > 0);
    const workspace = active && items.find((item) => item.sessionIds?.includes(active.id) || (active.cwd && item.path === active.cwd));
    this.patch({ workspaces: items, hasSession: Boolean(active) });
    if (workspace && active.id !== this.lastSession) {
      this.lastSession = active.id;
      if (this.state.busy) this.pendingWorkspace = workspace.workspaceId;
      else this.selectWorkspace(workspace.workspaceId);
    } else if (!this.state.workspaceId && items.length === 1) this.selectWorkspace(items[0].workspaceId);
    else if (this.state.workspaceId && !items.some((item) => item.workspaceId === this.state.workspaceId)) this.selectWorkspace('');
  }
  toggle = () => {
    if (this.state.aiPreparing) return;
    const open = !this.state.open;
    this.patch({ open });
    if (open) void this.refresh();
    else for (const [name, controller] of this.requests) if (name !== 'mutate') controller.abort();
  };
  open = () => { if (!this.state.open) this.toggle(); };
  setHeight = (height) => {
    const max = Math.max(180, (globalThis.innerHeight || 1000) - 80);
    height = Math.max(Math.min(230, max), Math.min(max, Math.round(height)));
    this.patch({ height });
    try { this.storage?.setItem('dsh-git.height', String(height)); } catch { /* Optional preference. */ }
  };
  maximize = () => this.patch({ maximized: !this.state.maximized });
  selectWorkspace = (workspaceId) => {
    if (workspaceId === this.state.workspaceId && !this.state.worktreePath) return;
    if (this.state.busy) { this.pendingWorkspace = workspaceId; return; }
    this.resetScope({ workspaceId, worktreePath: undefined });
  };
  selectWorktree = (worktreePath) => {
    if (this.state.busy) return;
    this.resetScope({ worktreePath });
    const gitTab = this.state.tabs.find((tab) => tab.kind === 'git');
    if (gitTab) this.activateTab(gitTab.id); else this.addTab('git');
  };
  resetScope(update) {
    this.generation++;
    this.aiPreparationSequence++;
    this.snapshotSequence++;
    this.preparedAiCommit = null;
    for (const controller of this.requests.values()) controller.abort();
    this.patch({ ...update, data: null, loading: false, error: null, notice: '', aiBusy: false, aiPreparing: false, aiSelectedPaths: null, aiDraft: null, aiModelsLoading: false, diff: null, dialog: null, tabs: this.state.tabs.map((tab) => ({ ...newTab(tab.kind, tab.id) })) });
    if (this.state.open) void this.refresh();
  }
  async refresh({ quiet = false } = {}) {
    if (this.disposed || !this.state.workspaceId || this.state.busy || this.state.loading) return;
    const generation = this.generation;
    const sequence = ++this.snapshotSequence;
    const old = this.state.data;
    this.patch({ loading: true, ...(quiet ? {} : { error: null }) });
    try {
      const data = await this.request('snapshot', { op: 'snapshot', ...this.scope() });
      if (generation !== this.generation || sequence !== this.snapshotSequence) return;
      this.patch({ data, loading: false });
      const changed = old?.head !== data.head || old?.branch !== data.branch || JSON.stringify(old?.branches) !== JSON.stringify(data.branches);
      if (data.state === 'ready' && this.tab()?.kind === 'git' && (!quiet || changed || this.tab().commits.length === 0)) await this.loadHistory();
    } catch (error) {
      if (generation === this.generation && sequence === this.snapshotSequence) this.patch({ loading: false, ...(error.name === 'AbortError' ? {} : { error: { message: errorMessage(error), code: error.code } }) });
    }
  }
  addTab = (kind) => {
    const id = `${kind}-${++this.sequence}`;
    this.patch({ tabs: [...this.state.tabs, newTab(kind, id)], activeTab: id });
    if (kind === 'git' && this.state.data?.state === 'ready') void this.loadHistory();
  };
  activateTab = (id) => {
    if (id === this.state.activeTab) return;
    this.requests.get('history')?.abort();
    this.requests.get('detail')?.abort();
    this.patch({ activeTab: id });
    if (this.tab()?.kind === 'git' && this.state.data?.state === 'ready') void this.loadHistory();
  };
  closeTab = (id) => {
    const tabs = this.state.tabs.filter((tab) => tab.id !== id);
    if (!tabs.length) { this.patch({ tabs: [newTab('git', `git-${++this.sequence}`)], activeTab: `git-${this.sequence}` }); this.toggle(); return; }
    const index = this.state.tabs.findIndex((tab) => tab.id === id);
    this.patch({ tabs, activeTab: this.state.activeTab === id ? tabs[Math.min(index, tabs.length - 1)].id : this.state.activeTab });
    if (this.tab()?.kind === 'git') void this.loadHistory();
  };
  setSidebarTab = (sidebarTab) => this.patch({ sidebarTab });
  filter = (update) => {
    const tab = this.tab();
    if (!tab || tab.kind !== 'git') return;
    this.requests.get('history')?.abort();
    this.requests.get('detail')?.abort();
    this.patchTab(tab.id, { ...update, selected: null, detail: null });
    clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => void this.loadHistory(), 220);
  };
  async loadHistory(append = false) {
    const tab = this.tab();
    if (!tab || tab.kind !== 'git' || this.state.data?.state !== 'ready') return;
    const generation = this.generation;
    this.patchTab(tab.id, { loading: true });
    try {
      const result = await this.request('history', { op: 'history', ...this.scope(), ref: tab.ref || undefined, search: tab.search, author: tab.author, path: tab.path, dateRange: tab.dateRange, skip: append ? tab.commits.length : 0 });
      if (generation !== this.generation || tab.id !== this.state.activeTab) return;
      const commits = append ? [...tab.commits, ...result.commits.filter((item) => !tab.commits.some((existing) => existing.hash === item.hash))] : result.commits;
      const selected = commits.some((item) => item.hash === this.tab().selected) ? this.tab().selected : commits[0]?.hash ?? null;
      this.patchTab(tab.id, { commits, hasMore: result.hasMore, loading: false, selected });
      if (selected) await this.selectCommit(selected);
      else this.patchTab(tab.id, { detail: null });
    } catch (error) {
      if (generation === this.generation && tab.id === this.state.activeTab) {
        this.patchTab(tab.id, { loading: false });
        if (error.name !== 'AbortError') this.patch({ error: { message: errorMessage(error), code: error.code } });
      }
    }
  }
  selectCommit = async (hash) => {
    const tab = this.tab();
    if (!tab) return;
    const generation = this.generation;
    this.patchTab(tab.id, { selected: hash, detail: null });
    try {
      const detail = await this.request('detail', { op: 'commit', ...this.scope(), hash });
      if (generation === this.generation && tab.id === this.state.activeTab && this.tab().selected === hash) this.patchTab(tab.id, { detail });
    } catch (error) { if (error.name !== 'AbortError' && generation === this.generation) this.patch({ error: { message: errorMessage(error), code: error.code } }); }
  };
  showDiff = async (options, title) => {
    const generation = this.generation;
    this.patch({ diff: { title, loading: true, text: '' } });
    try {
      const diff = await this.request('diff', { op: 'diff', ...this.scope(), ...options });
      if (generation === this.generation) this.patch({ diff: { title, ...diff, loading: false } });
    } catch (error) { if (error.name !== 'AbortError' && generation === this.generation) this.patch({ diff: { title, loading: false, error: errorMessage(error), text: '' } }); }
  };
  closeDiff = () => { this.requests.get('diff')?.abort(); this.patch({ diff: null }); };
  showDialog = (dialog) => {
    if (this.disposed || this.state.busy) return;
    this.requests.get('aiCommit')?.abort();
    this.preparedAiCommit = null;
    this.patch({ dialog: { ...dialog, expected: makeExpected(this.state.data) }, error: null, aiBusy: false, aiPreparing: false, aiSelectedPaths: null, aiDraft: null });
    if (dialog.type === 'settings') void this.loadAiModels();
    if (dialog.type === 'commit' && dialog.ai) void this.prepareAiCommit();
  };
  closeDialog = () => {
    if (this.state.busy) return;
    this.requests.get('aiCommit')?.abort();
    this.preparedAiCommit = null;
    this.patch({ dialog: null, aiBusy: false, aiPreparing: false, aiSelectedPaths: null, aiDraft: null });
  };
  prepareAiCommit = async () => {
    const dialog = this.state.dialog;
    if (this.disposed || dialog?.type !== 'commit' || !dialog.ai || this.state.busy || this.state.aiBusy) return false;
    const sequence = ++this.aiPreparationSequence;
    const generation = this.generation;
    const scope = this.scope();
    const expected = { ...dialog.expected };
    let latest = this.state.data;
    let attempted = false;
    let completed = 0;
    let prepared = false;
    const current = () => !this.disposed && sequence === this.aiPreparationSequence && generation === this.generation && this.state.dialog === dialog && this.state.workspaceId === scope.workspaceId && this.state.worktreePath === scope.worktreePath;
    const checkCurrent = () => { if (!current()) throw new DOMException('AI preparation superseded', 'AbortError'); };
    const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
    const checkSnapshot = (data) => {
      checkCurrent();
      if (data?.state !== 'ready' || !Array.isArray(data.files)) fail('REPOSITORY_UNAVAILABLE', '仓库暂时不可用，请刷新后重试 AI 提交。');
      if ((data.head ?? null) !== expected.head || (data.branch ?? null) !== expected.branch) fail('STALE_HEAD', 'HEAD 或当前分支已变化，未继续自动暂存或生成。请重新打开 AI 提交。');
      if (data.operation) fail('OPERATION_IN_PROGRESS', '仓库正在执行 Git 操作，未自动暂存或生成。请先完成或中止当前操作。');
      if (data.files.some((file) => file.conflict)) fail('UNRESOLVED_CONFLICTS', '工作区存在冲突，未自动解决或暂存冲突。请先手动处理冲突。');
    };
    const publish = (data) => {
      if (current() && data?.state === 'ready' && Array.isArray(data.files)) this.patch({ data, aiSelectedPaths: data.files.map((file) => file.path) });
    };
    // Do not use mutate(): its finally refresh/unlock belongs to one user action,
    // whereas this preparation owns the entire fixed snapshot -> stage -> verify chain.
    this.snapshotSequence++;
    for (const [name, controller] of this.requests) if (name !== 'mutate') controller.abort();
    clearTimeout(this.noticeTimer);
    this.patch({ busy: 'stage', aiPreparing: true, aiBusy: false, aiDraft: null, error: null, notice: '正在暂存全部更改…', loading: false, aiModelsLoading: false });
    try {
      latest = await this.request('aiPrepareSnapshot', { op: 'snapshot', ...scope });
      checkCurrent(); publish(latest); checkSnapshot(latest);
      const paths = [...new Set(latest.files.filter((file) => file.unstaged).map((file) => file.path))];
      for (let start = 0; start < paths.length; start += 1000) {
        checkCurrent();
        attempted = true;
        await this.request('mutate', { op: 'mutate', ...scope, expected, confirmed: true, mutation: { action: 'stage', paths: paths.slice(start, start + 1000) } });
        checkCurrent();
        completed += Math.min(1000, paths.length - start);
      }
      // Fixed initial path list: new edits are not chased or silently omitted.
      latest = await this.request('aiPrepareSnapshot', { op: 'snapshot', ...scope });
      checkCurrent(); publish(latest); checkSnapshot(latest);
      if (latest.files.some((file) => file.unstaged)) fail('AI_PREPARATION_CHANGED', '自动暂存期间出现新的未暂存改动，未发送给模型。已暂存内容保留，请检查后重新打开 AI 提交。');
      if (!latest.files.some((file) => file.staged)) fail('NOTHING_STAGED', '没有可提交的更改，未调用 AI 模型。');
      this.preparedAiCommit = { dialog, staged: completed > 0, stagedTree: latest.stagedTree || null };
      prepared = true;
    } catch (error) {
      if (current()) {
        // A failed/aborted stage can have partially updated the index. Read once to
        // show its actual state; never unstage, retry staging, commit, or push here.
        if (attempted) {
          try { latest = await this.request('aiPrepareSnapshot', { op: 'snapshot', ...scope }); } catch { /* Keep the last known snapshot; the error asks the user to inspect. */ }
        }
        if (current()) {
          publish(latest);
          const prefix = attempted ? completed ? `已完成 ${completed} 个文件的暂存；其余更改也可能已部分暂存，暂存内容已保留。` : '部分更改可能已暂存，暂存内容已保留。' : '';
          const message = error.name === 'AbortError' ? 'AI 提交准备已停止；未生成提交信息。请检查暂存内容后手写提交信息或重新打开 AI 提交。' : errorMessage(error);
          this.patch({ notice: '', error: { message: `${prefix}${message}${attempted ? ' 未自动提交或推送；可手写提交信息，或检查后重试。' : ''}`, code: error.name === 'AbortError' ? 'CANCELLED' : error.code || 'AI_PREPARATION_FAILED', details: error.details } });
        }
      }
    } finally {
      if (current()) {
        this.patch({ busy: '', aiPreparing: false, notice: prepared ? completed > 0 ? '全部更改已暂存，正在生成提交信息…' : '正在根据已暂存更改生成提交信息…' : '' });
        if (this.pendingWorkspace !== undefined) {
          const id = this.pendingWorkspace; this.pendingWorkspace = undefined;
          if (id !== this.state.workspaceId || this.state.worktreePath) { this.selectWorkspace(id); prepared = false; }
        }
      }
    }
    if (!prepared || !current()) return false;
    // Synchronous handoff: no idle tick permits another mutation before aiBusy.
    return this.generateCommit();
  };
  loadAiModels = async () => {
    if (this.disposed) return;
    const sequence = ++this.modelsSequence;
    this.patch({ aiModelsLoading: true, aiModelsError: '', aiModelsErrorCode: '' });
    try {
      const result = await this.request('aiModels', { op: 'aiModels' });
      if (sequence !== this.modelsSequence) return;
      this.patch({ aiModels: result.models || [], aiModelsLoading: false, aiModelsError: result.available === false ? 'DSH 尚未启用可用的模型服务。请先在宿主中配置模型。' : '', aiModelsErrorCode: result.available === false ? 'AI_UNAVAILABLE' : '' });
    } catch (error) {
      if (sequence !== this.modelsSequence) return;
      if (error.name !== 'AbortError') this.patch({ aiModelsLoading: false, aiModelsError: errorMessage(error), aiModelsErrorCode: error.code || '', ...(error.code === 'HOST_UPGRADE_REQUIRED' ? { aiModels: [] } : {}) });
      else this.patch({ aiModelsLoading: false });
    }
  };
  saveSettings = (settings) => {
    const error = validateSettings(settings);
    if (error) { this.patch({ error: { message: error } }); return false; }
    if (!persistSettings(this.storage, settings)) {
      this.patch({ error: { message: '无法保存设置，请检查浏览器是否允许本地存储。' } });
      return false;
    }
    this.patch({ settings: loadSettings(this.storage), dialog: null, error: null, notice: 'Git 设置已保存。' });
    return true;
  };
  generateCommit = async () => {
    const dialog = this.state.dialog;
    if (this.disposed || dialog?.type !== 'commit' || this.state.busy || this.state.aiPreparing || this.state.aiBusy) return false;
    if (!this.state.data?.files?.some((file) => file.staged)) {
      this.patch({ error: { message: '请先选择并暂存要提交的文件，再生成 AI 提交信息。' } });
      return false;
    }
    const generation = this.generation;
    const sequence = ++this.aiSequence;
    const preparation = this.preparedAiCommit?.dialog === dialog ? this.preparedAiCommit : null;
    const { provider, model, prompt } = this.state.settings;
    this.patch({ aiBusy: true, error: null });
    try {
      const draft = await this.request('aiCommit', { op: 'aiCommit', ...this.scope(), expected: dialog.expected, provider, model, prompt });
      if (generation !== this.generation || sequence !== this.aiSequence || this.state.dialog !== dialog) return false;
      if (preparation?.stagedTree && draft.stagedTree !== preparation.stagedTree) {
        const error = new Error('自动准备后暂存内容已变化，未采用生成结果。请检查后重新打开 AI 提交。');
        error.code = 'STALE_INDEX';
        throw error;
      }
      this.patch({ aiBusy: false, aiDraft: { ...draft, stale: false }, notice: 'AI 提交信息已生成，等待你预览并确认。' });
      return true;
    } catch (error) {
      if (generation === this.generation && sequence === this.aiSequence && this.state.dialog === dialog) this.patch({ aiBusy: false, notice: '', ...(error.name === 'AbortError' ? {} : { error: { message: preparation?.staged ? `全部更改已暂存，但 AI 生成失败。${errorMessage(error)} 暂存内容已保留；可手写提交信息或重试生成，未自动提交或推送。` : errorMessage(error), code: error.code } }) });
      return false;
    }
  };
  cancelAi = () => {
    if (this.state.aiPreparing) return;
    this.aiSequence++;
    this.requests.get('aiCommit')?.abort();
    const staged = this.preparedAiCommit?.dialog === this.state.dialog && this.preparedAiCommit.staged;
    this.patch({ aiBusy: false, ...(staged ? { notice: '全部更改已暂存，AI 生成已停止；可手写提交信息或重试生成。' } : {}) });
  };
  handleShortcut = (event) => {
    if (this.disposed || !this.state.open || this.state.dialog || this.state.diff || this.state.busy || this.state.aiBusy || this.state.data?.state !== 'ready' || event.defaultPrevented || event.repeat || event.isComposing) return;
    const target = event.composedPath?.()[0] || event.target;
    // Shortcuts belong to this plugin, never to the host editor or another modal.
    const activeOverlay = [...(globalThis.document?.querySelectorAll('[role="dialog"], [role="menu"]') || [])].some((element) => !element.closest('[hidden], [aria-hidden="true"], [inert]') && element.getClientRects().length > 0);
    if (!target?.closest?.('#dsh-git-panel') || target.closest('input, textarea, select, [role="combobox"], [contenteditable]:not([contenteditable="false"])') || activeOverlay) return;
    const shortcuts = this.state.settings.shortcuts;
    const action = Object.keys(shortcuts).find((key) => matchesShortcut(event, shortcuts[key]));
    const data = this.state.data;
    const branch = data.branches.find((item) => item.kind === 'local' && item.name === data.branch);
    if (['commit', 'aiCommit'].includes(action) && (action === 'aiCommit' || data.files.length) && !data.operation) { event.preventDefault(); this.showDialog({ type: 'commit', ai: action === 'aiCommit' }); }
    if (action === 'push' && branch && data.remotes.length) { event.preventDefault(); this.showDialog({ type: 'push', branch }); }
    if (action === 'fetch' && data.remotes.length) { event.preventDefault(); this.showDialog({ type: 'confirm', title: '获取远程更新', description: '获取所有远程更新并清理过期跟踪引用，不会自动合并或推送。', mutation: { action: 'fetch' } }); }
  };
  async mutate(mutation, { expected, keepDialog = false } = {}) {
    const initializing = mutation.action === 'initialize';
    if (this.disposed || this.state.busy || this.state.aiBusy || this.state.data?.state !== (initializing ? 'not-repository' : 'ready')) return false;
    for (const [name, controller] of this.requests) if (name !== 'mutate') controller.abort();
    this.patch({ busy: mutation.action, error: null, notice: '', loading: false, aiModelsLoading: false });
    try {
      const result = await this.request('mutate', initializing ? { op: 'initialize', workspaceId: this.state.workspaceId, confirmed: true } : { op: 'mutate', ...this.scope(), expected: expected ?? makeExpected(this.state.data), confirmed: true, mutation });
      if (['stage', 'unstage'].includes(mutation.action)) this.preparedAiCommit = null;
      this.patch({ notice: result.message || '操作已完成。', ...(['stage', 'unstage'].includes(mutation.action) && this.state.aiDraft ? { aiDraft: { ...this.state.aiDraft, stale: true } } : {}), ...(keepDialog ? {} : { dialog: null, aiPreparing: false, aiSelectedPaths: null, aiDraft: null }) });
      clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => this.patch({ notice: '' }), 6500);
      return true;
    } catch (error) {
      const committed = error.details?.committed === true || error.details?.doNotRetryCommit === true;
      this.patch({ error: { message: errorMessage(error), code: error.code, details: error.details }, ...(committed ? { dialog: null, aiPreparing: false, aiSelectedPaths: null, aiDraft: null } : {}), ...(error.code === 'STALE_INDEX' && this.state.aiDraft ? { aiDraft: { ...this.state.aiDraft, stale: true } } : {}) });
      return false;
    } finally {
      if (!this.disposed) {
        this.patch({ busy: '' });
        await this.refresh({ quiet: true });
        if (!this.state.busy && !this.state.aiPreparing && this.pendingWorkspace !== undefined) { const id = this.pendingWorkspace; this.pendingWorkspace = undefined; this.selectWorkspace(id); }
      }
    }
  }
  dismissMessage = () => this.patch({ error: null, notice: '' });
  async copy(text) {
    try { await navigator.clipboard.writeText(text); this.patch({ notice: '已复制到剪贴板。' }); }
    catch { this.patch({ error: { message: '无法访问剪贴板。请手动复制所需内容。' } }); }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.filterTimer); clearTimeout(this.noticeTimer);
    for (const controller of this.requests.values()) controller.abort();
    this.listeners.clear();
  }
}
