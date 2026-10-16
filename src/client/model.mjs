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
    this.generation = 0;
    let height = 380;
    try { height = Number(storage?.getItem('dsh-git.height')) || height; } catch { /* Browser storage may be disabled. */ }
    this.state = { open: false, maximized: false, height: Math.max(230, Math.min(800, height)), tabs: [newTab('git', 'git-1')], activeTab: 'git-1', workspaceId: '', worktreePath: undefined, workspaces: [], hasSession: false, data: null, loading: false, busy: '', error: null, notice: '', dialog: null, diff: null, sidebarTab: 'branches' };
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
      if (!result.ok) { const error = new Error(result.error.message); error.code = result.error.code; throw error; }
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
    for (const controller of this.requests.values()) controller.abort();
    this.patch({ ...update, data: null, loading: false, error: null, diff: null, dialog: null, tabs: this.state.tabs.map((tab) => ({ ...newTab(tab.kind, tab.id) })) });
    if (this.state.open) void this.refresh();
  }
  async refresh({ quiet = false } = {}) {
    if (this.disposed || !this.state.workspaceId || this.state.busy || this.state.loading) return;
    const generation = this.generation;
    const old = this.state.data;
    this.patch({ loading: true, ...(quiet ? {} : { error: null }) });
    try {
      const data = await this.request('snapshot', { op: 'snapshot', ...this.scope() });
      if (generation !== this.generation) return;
      this.patch({ data, loading: false });
      const changed = old?.head !== data.head || old?.branch !== data.branch || JSON.stringify(old?.branches) !== JSON.stringify(data.branches);
      if (data.state === 'ready' && this.tab()?.kind === 'git' && (!quiet || changed || this.tab().commits.length === 0)) await this.loadHistory();
    } catch (error) {
      if (generation === this.generation) this.patch({ loading: false, ...(error.name === 'AbortError' ? {} : { error: { message: errorMessage(error), code: error.code } }) });
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
  showDialog = (dialog) => this.patch({ dialog: { ...dialog, expected: makeExpected(this.state.data) }, error: null });
  closeDialog = () => { if (!this.state.busy) this.patch({ dialog: null }); };
  async mutate(mutation, { expected, keepDialog = false } = {}) {
    const initializing = mutation.action === 'initialize';
    if (this.disposed || this.state.busy || this.state.data?.state !== (initializing ? 'not-repository' : 'ready')) return false;
    for (const [name, controller] of this.requests) if (name !== 'mutate') controller.abort();
    this.patch({ busy: mutation.action, error: null, notice: '', loading: false });
    try {
      const result = await this.request('mutate', initializing ? { op: 'initialize', workspaceId: this.state.workspaceId, confirmed: true } : { op: 'mutate', ...this.scope(), expected: expected ?? makeExpected(this.state.data), confirmed: true, mutation });
      this.patch({ notice: result.message || '操作已完成。', ...(keepDialog ? {} : { dialog: null }) });
      clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => this.patch({ notice: '' }), 6500);
      return true;
    } catch (error) {
      this.patch({ error: { message: errorMessage(error), code: error.code } });
      return false;
    } finally {
      if (!this.disposed) {
        this.patch({ busy: '' });
        await this.refresh({ quiet: true });
        if (this.pendingWorkspace !== undefined) { const id = this.pendingWorkspace; this.pendingWorkspace = undefined; this.selectWorkspace(id); }
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
