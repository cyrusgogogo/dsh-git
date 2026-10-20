import React, { useMemo, useState } from 'react';
import { ArrowDownToLine, CalendarDays, Check, Cherry, ChevronRight, CircleDot, Copy, FileCode, Folder, GitBranch, GitCommitHorizontal, GitFork, Minus, Plus, Sparkles, Tag, X } from 'lucide-react';
import { SelectControl, SelectGroup, SelectItem, SelectLabel, SelectSeparator } from './select.jsx';
import { BranchList } from './branches.jsx';
import { EmptyState, IconButton, SearchInput, Spinner, confirmAction, navigateTabs, shortRef } from './ui.jsx';
import { GRAPH_COLORS, layoutGraph, relativeDate } from './graph.mjs';

export function ChangesList({ state, actions }) {
  const data = state.data;
  const files = data.files;
  const groups = [['staged', '已暂存', files.filter((file) => file.staged)], ['working', '工作区', files.filter((file) => file.unstaged)]];
  if (!files.length) return <EmptyState compact title="工作区干净" description="所有更改均已提交" icon={Check} />;
  return <div className="git-changes-list">{groups.map(([kind, label, items]) => <section key={kind}>
    <div className="git-change-group"><span>{label} <span className="git-muted">{items.length}</span></span>{items.length > 0 && <IconButton icon={kind === 'staged' ? Minus : Plus} label={kind === 'staged' ? '取消暂存全部文件' : '暂存全部更改'} disabled={Boolean(state.busy)} onClick={() => actions.mutate({ action: kind === 'staged' ? 'unstage' : 'stage', paths: items.map((file) => file.path) })} />}</div>
    {items.map((file) => <div key={file.path} className="git-change-row"><button type="button" className="git-change-file" title={file.path} onClick={() => actions.showDiff({ kind, path: file.path }, `${label} · ${file.path}`)}><FileCode size={13} aria-hidden="true" /><span>{file.path}</span><b className={`git-file-status git-status-${file.conflict ? 'U' : kind === 'staged' ? file.index : file.worktree}`}>{file.conflict ? '!' : kind === 'staged' ? file.index : file.worktree === '?' ? '+' : file.worktree}</b></button><IconButton icon={kind === 'staged' ? Minus : Plus} label={`${kind === 'staged' ? '取消暂存' : '暂存'} ${file.path}`} disabled={Boolean(state.busy)} onClick={() => actions.mutate({ action: kind === 'staged' ? 'unstage' : 'stage', paths: [file.path] })} /></div>)}
  </section>)}</div>;
}

function ChangesActions({ state, actions }) {
  const disabled = Boolean(state.busy || state.aiBusy || state.data.operation) || !state.data.files.length;
  return <div className="git-changes-toolbar">
    <div className="git-change-commit-actions" role="group" aria-label="更改提交操作">
      <button type="button" className="git-button git-commit-trigger" disabled={disabled} onClick={() => actions.showDialog({ type: 'commit' })}><GitCommitHorizontal size={14} aria-hidden="true" />提交更改…</button>
      <button type="button" className="git-button" disabled={disabled || state.data.files.some((file) => file.conflict)} title="自动暂存全部当前改动并生成提交信息；确认后才提交" onClick={() => actions.showDialog({ type: 'commit', ai: true })}><Sparkles size={13} aria-hidden="true" />AI 提交</button>
    </div>
    <p className="git-changes-toolbar-hint">AI 将暂存全部改动，确认后才提交</p>
  </div>;
}

export function RepositorySidebar({ state, actions, tab }) {
  const [query, setQuery] = useState('');
  const id = React.useId();
  return <aside className="git-sidebar" aria-label="仓库导航"><div className="git-sidebar-tabs" role="tablist" aria-label="仓库导航视图">{[['branches', '分支'], ['changes', '更改']].map(([value, label]) => <button key={value} role="tab" type="button" id={`${id}-${value}`} aria-controls={`${id}-panel-${value}`} aria-selected={state.sidebarTab === value} tabIndex={state.sidebarTab === value ? 0 : -1} onKeyDown={navigateTabs} onClick={() => actions.setSidebarTab(value)}>{label}{value === 'changes' && <span className="git-count">{state.data.files.length}</span>}</button>)}</div>
    <div className="git-sidebar-content" role="tabpanel" id={`${id}-panel-${state.sidebarTab}`} aria-labelledby={`${id}-${state.sidebarTab}`}>
      {state.sidebarTab === 'branches' ? <><div className="git-sidebar-search"><SearchInput value={query} onChange={setQuery} placeholder="分支或标签" /></div><div className="git-sidebar-scroll"><BranchList data={state.data} actions={actions} busy={state.busy} query={query} selected={tab.ref} /></div></> : <><ChangesActions state={state} actions={actions} /><div className="git-sidebar-scroll"><ChangesList state={state} actions={actions} /></div></>}
    </div>
    <div hidden role="tabpanel" id={`${id}-panel-${state.sidebarTab === 'branches' ? 'changes' : 'branches'}`} aria-labelledby={`${id}-${state.sidebarTab === 'branches' ? 'changes' : 'branches'}`} />
  </aside>;
}

function CommitGraph({ graph, width, current }) {
  const x = (lane) => 12 + lane * 14;
  const color = (lane) => GRAPH_COLORS[lane % GRAPH_COLORS.length];
  return <svg className="git-graph" width={width} height={29} viewBox={`0 0 ${width} 29`} aria-hidden="true">
    {graph.through.filter((edge) => edge.to >= 0).map((edge) => <path key={`${edge.from}-${edge.to}`} d={`M${x(edge.from)} 0 C${x(edge.from)} 14,${x(edge.to)} 14,${x(edge.to)} 29`} fill="none" stroke={color(edge.from)} strokeWidth={1.5} />)}
    {graph.connectedFromAbove && <path d={`M${x(graph.lane)} 0 V14`} stroke={color(graph.lane)} strokeWidth={1.5} />}
    {graph.parents.map((parent) => <path key={parent.hash} d={`M${x(graph.lane)} 14 C${x(graph.lane)} 23,${x(parent.lane)} 18,${x(parent.lane)} 29`} fill="none" stroke={color(parent.lane)} strokeWidth={1.5} />)}
    <circle cx={x(graph.lane)} cy={14} r={current ? 4.8 : 3.6} fill={current ? 'var(--git-row-bg, var(--git-bg))' : color(graph.lane)} stroke={color(graph.lane)} strokeWidth={current ? 2 : 0} />
  </svg>;
}
function RefBadges({ refs }) {
  return <span className="git-ref-badges">{refs.slice(0, 3).map((ref) => <span key={ref} className={`git-ref-badge ${ref.startsWith('HEAD') ? 'git-ref-head' : ref.startsWith('tag:') ? 'git-ref-tag' : ''}`} title={ref}>{ref.replace(/^HEAD -> /, '').replace(/^tag: /, '')}</span>)}{refs.length > 3 && <span className="git-muted">+{refs.length - 3}</span>}</span>;
}

export function History({ state, tab, actions }) {
  const graph = useMemo(() => layoutGraph(tab.commits), [tab.commits]);
  const selected = tab.commits.find((commit) => commit.hash === tab.selected);
  const hasFilters = Boolean(tab.ref || tab.author || tab.dateRange || tab.search || tab.path);
  const branches = state.data.branches;
  const pickBlocked = state.busy ? '请等待当前操作完成' : state.data.operation ? '请先继续或中止正在进行的 Git 操作' : !state.data.branch || !state.data.head ? '请先签出一个已有提交的本地分支' : tab.loading || !selected ? '请先选择一个提交' : selected.hash === state.data.head ? '当前 HEAD 已是此提交' : selected.parents.length > 1 ? '暂不支持优选合并提交，请选择普通提交' : state.data.files.length ? '请先提交或自行保存未提交的改动' : '';
  return <section className="git-history" aria-label="提交历史"><div className="git-history-toolbar">
    <SearchInput value={tab.search} onChange={(search) => actions.filter({ search })} placeholder="文本或提交信息" label="搜索提交" />
    <div className="git-history-filters" role="group" aria-label="提交筛选">
      <SelectControl label="按分支筛选" prefix="分支" value={tab.ref || 'all'} title={shortRef(tab.ref) || '所有分支'} onValueChange={(ref) => actions.filter({ ref: ref === 'all' ? '' : ref })} className={`git-history-filter ${tab.ref ? 'is-active' : ''}`} contentClassName="git-select-branches">
        <SelectItem value="all" icon={CircleDot}>全部</SelectItem>
        {tab.ref && !branches.some((branch) => branch.ref === tab.ref) && <SelectItem value={tab.ref} icon={GitBranch}>{shortRef(tab.ref)}</SelectItem>}
        {[[ 'local', '本地分支', GitBranch ], [ 'remote', '远程分支', GitFork ], [ 'tag', '标签', Tag ]].map(([kind, label, Icon]) => {
          const items = branches.filter((branch) => branch.kind === kind);
          return items.length > 0 && <SelectGroup key={kind}><SelectSeparator /><SelectLabel>{label}</SelectLabel>{items.map((branch) => <SelectItem key={branch.ref} value={branch.ref} icon={Icon} title={branch.name}>{branch.name}</SelectItem>)}</SelectGroup>;
        })}
      </SelectControl>
      <label className={`git-history-filter git-history-author ${tab.author ? 'is-active' : ''}`}><span>用户</span><input aria-label="按用户筛选" title="按作者姓名或邮箱筛选" value={tab.author} onChange={(event) => actions.filter({ author: event.target.value })} placeholder="姓名或邮箱" maxLength={150} /></label>
      <SelectControl label="按日期筛选" prefix="日期" title="按 Git 提交时间筛选" value={tab.dateRange || 'any'} onValueChange={(dateRange) => actions.filter({ dateRange: dateRange === 'any' ? '' : dateRange })} className={`git-history-filter ${tab.dateRange ? 'is-active' : ''}`}>
        <SelectItem value="any" icon={CalendarDays}>不限</SelectItem><SelectSeparator />
        {[['today', '今天'], ['7d', '最近 7 天'], ['30d', '最近 30 天'], ['90d', '最近 90 天'], ['1y', '最近一年']].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectControl>
    </div>
    <div className="git-history-filter-actions">{hasFilters && <IconButton icon={X} label="清除全部提交筛选" onClick={() => actions.filter({ author: '', path: '', dateRange: '', search: '', ref: '' })} />}</div>
    <button type="button" className="git-button git-cherry-pick" disabled={Boolean(pickBlocked)} title={pickBlocked || `优选 ${selected.hash.slice(0, 8)} 到 ${state.data.branch}（cherry-pick）`} onClick={() => selected && confirmAction(actions, '优选提交（cherry-pick）', `将 ${selected.hash.slice(0, 8)}「${selected.subject}」的更改应用到当前分支 ${state.data.branch}，并创建新提交。不切换分支，不自动暂存现有改动。发生冲突时会保留现场，可解决并暂存后继续，或中止优选。`, { action: 'cherryPick', hash: selected.hash })}><Cherry size={13} aria-hidden="true" />优选</button>
  </div>
    <div className="git-history-columns" aria-hidden="true"><span style={{ paddingLeft: graph.width }}>提交信息<span className="git-history-count">{tab.loading ? <Spinner /> : `${tab.commits.length}${tab.hasMore ? '+' : ''} 个提交`}</span></span><span>作者</span><span>日期</span></div>
    {tab.loading && !tab.commits.length ? <div className="git-loading"><Spinner />正在读取提交历史…</div> : !tab.commits.length ? <EmptyState title={state.data.head ? '没有匹配的提交' : '还没有提交'} description={state.data.head ? '试试调整搜索词或清除筛选条件。' : '仓库已就绪。你可以在“更改”中暂存文件并创建首次提交。'} compact icon={GitCommitHorizontal} /> : <div className="git-commit-list" role="listbox" aria-label="提交列表" aria-busy={tab.loading} tabIndex={0} aria-activedescendant={tab.selected ? `commit-${tab.id}-${tab.selected}` : undefined} onKeyDown={(event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const selected = tab.commits.findIndex((commit) => commit.hash === tab.selected);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tab.commits.length - 1 : Math.min(tab.commits.length - 1, Math.max(0, selected + (event.key === 'ArrowDown' ? 1 : -1)));
      const target = tab.commits[index];
      void actions.selectCommit(target.hash);
      document.getElementById(`commit-${tab.id}-${target.hash}`)?.scrollIntoView({ block: 'nearest' });
    }}>
      {tab.commits.map((commit, index) => <div key={commit.hash} id={`commit-${tab.id}-${commit.hash}`} role="option" aria-selected={tab.selected === commit.hash} className={`git-commit-row ${tab.selected === commit.hash ? 'is-selected' : ''}`} onClick={() => actions.selectCommit(commit.hash)} title={`${commit.hash}\n${commit.subject}`}>
        <div className="git-commit-main"><CommitGraph graph={graph.rows[index]} width={graph.width} current={commit.hash === state.data.head} /><span className="git-commit-subject">{commit.subject}</span><RefBadges refs={commit.refs} /></div><span className="git-commit-author" title={`${commit.author} <${commit.email}>`}>{commit.author}</span><time className="git-commit-date" dateTime={commit.date} title={new Date(commit.date).toLocaleString('zh-CN')}>{relativeDate(commit.date)}</time>
      </div>)}
      {tab.hasMore && <button type="button" className="git-load-more" disabled={tab.loading} onClick={actions.loadMore}>{tab.loading ? <Spinner /> : <ArrowDownToLine size={13} aria-hidden="true" />}加载更多提交</button>}
    </div>}
  </section>;
}

function makeFileTree(files) {
  const root = { children: new Map() };
  for (const file of files) {
    const segments = file.path.split('/');
    let current = root;
    segments.forEach((segment, index) => {
      if (!current.children.has(segment)) current.children.set(segment, { name: segment, path: segments.slice(0, index + 1).join('/'), children: new Map(), ...(index === segments.length - 1 ? { file } : {}) });
      current = current.children.get(segment);
    });
  }
  return [...root.children.values()];
}
function FileTree({ nodes, hash, actions, depth = 0 }) {
  return nodes.map((node) => node.file ? <button type="button" key={node.path} className="git-tree-file" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => actions.showDiff({ kind: 'commit', hash, path: node.file.path }, node.file.path)} title={node.file.originalPath ? `${node.file.originalPath} → ${node.file.path}` : node.file.path}><FileCode size={13} aria-hidden="true" /><span className={`git-file-status git-status-${node.file.status}`}>{node.file.status}</span><span>{node.name}</span></button> : <details key={node.path} open={depth < 2} className="git-tree-folder"><summary style={{ paddingLeft: 10 + depth * 14 }}><ChevronRight size={12} aria-hidden="true" /><Folder size={13} aria-hidden="true" /><span>{node.name}</span><span className="git-muted">{node.children.size}</span></summary><FileTree nodes={[...node.children.values()]} hash={hash} actions={actions} depth={depth + 1} /></details>);
}
export function Inspector({ state, tab, actions }) {
  const detail = tab.detail;
  const nodes = useMemo(() => makeFileTree(detail?.files || []), [detail?.files]);
  return <aside className="git-inspector" aria-label="提交详情">
    {!detail ? <div className="git-inspector-placeholder">{tab.selected ? <><Spinner />读取提交详情…</> : <><span className="git-inspector-placeholder-icon" aria-hidden="true"><GitCommitHorizontal size={22} strokeWidth={1.5} /></span><span>选择提交以查看详情</span></>}</div> : <>
      <div className="git-inspector-heading"><span>变更文件</span><span className="git-count">{detail.files.length}</span><span className="git-spacer" /><IconButton icon={FileCode} label="查看此提交的完整差异" onClick={() => actions.showDiff({ kind: 'commit', hash: detail.hash }, detail.subject)} /></div>
      <div className="git-file-tree">{nodes.length ? <FileTree nodes={nodes} hash={detail.hash} actions={actions} /> : <p className="git-small-empty">此提交没有文件变更</p>}</div>
      <div className="git-commit-details"><p className="git-commit-message">{detail.message?.trim() || detail.subject}</p><div className="git-commit-facts"><button type="button" className="git-copy-hash" title="复制完整提交哈希" onClick={() => actions.copy(detail.hash)}><code>{detail.hash.slice(0, 8)}</code><Copy size={11} aria-hidden="true" /></button><span title={detail.email}>{detail.author}</span><span className="git-muted">·</span><time dateTime={detail.date}>{new Date(detail.date).toLocaleString('zh-CN', { hour12: false })}</time></div><div className="git-detail-refs"><RefBadges refs={detail.refs} /></div>{detail.parents.length > 1 && <p className="git-muted git-merge-note">合并提交 · 文件差异相对于第一个父提交</p>}</div>
    </>}
  </aside>;
}
