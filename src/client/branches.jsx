import React, { useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, Check, ChevronDown, ChevronRight, CircleDot, FileDiff, FolderPlus, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequestArrow, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { RefIcon, SearchInput, IconButton, confirmAction, shortRef } from './ui.jsx';

export function branchCommands(branch, data, actions) {
  const current = branch.kind === 'local' && branch.name === data.branch;
  const blocked = branch.worktreePath && branch.worktreePath.replace(/\\/g, '/').toLowerCase() !== data.root.replace(/\\/g, '/').toLowerCase();
  const remote = branch.kind === 'remote';
  const name = branch.name;
  const target = data.branch || '当前分支';
  const canCommit = Boolean(data.head);
  const result = [];
  const add = (label, icon, run, disabled = false) => result.push({ label, icon, run, disabled });
  const sep = () => result.push({ separator: true });
  if (!current) {
    if (blocked) add('在对应工作树中打开', GitBranch, () => actions.selectWorktree(branch.worktreePath));
    add('签出', Check, () => confirmAction(actions, `签出 ${name}`, remote ? `将创建或切换到跟踪 ${name} 的本地分支。未提交的改动不会被强制丢弃。` : `切换到 ${name}。Git 会保护尚未提交的改动。`, { action: 'checkout', ref: branch.ref }), Boolean(blocked));
    add(`从 '${name}' 新建分支…`, Plus, () => actions.showDialog({ type: 'newBranch', branch }), !canCommit);
    add(`签出并变基到 '${target}'`, GitPullRequestArrow, () => confirmAction(actions, '签出并变基', `先签出 ${name}，再将它变基到当前 ${target} 的提交之上。此操作会改写所选分支的历史；冲突时会保留现场。`, { action: 'checkoutRebase', ref: branch.ref }), Boolean(blocked) || !data.branch || !canCommit);
    sep();
    add(`与 '${target}' 比较`, ArrowRightLeft, () => actions.showDiff({ kind: 'compare', ref: branch.ref }, `${target} → ${name}`), !canCommit);
  } else add(`从 '${name}' 新建分支…`, Plus, () => actions.showDialog({ type: 'newBranch', branch }), !canCommit);
  add('显示与工作树的差异', FileDiff, () => actions.showDiff({ kind: 'working', ref: branch.ref }, `${name} 与工作树的差异`), !canCommit);
  sep();
  if (!current) {
    add(`将 '${target}' 变基到 '${name}'`, GitPullRequestArrow, () => confirmAction(actions, '变基当前分支', `将当前 ${target} 的提交重放到 ${name} 之上。这会改写当前分支历史，要求工作区干净。`, { action: 'rebase', ref: branch.ref }), !data.branch || !canCommit);
    add(`将 '${name}' 合并到 '${target}' 中`, GitMerge, () => confirmAction(actions, '合并分支', `将 ${name} 合并到当前 ${target}。不会强制丢弃本地改动；出现冲突时需先解决冲突。`, { action: 'merge', ref: branch.ref }), !data.branch || !canCommit);
    sep();
  }
  add(`从 '${name}' 新建工作树…`, FolderPlus, () => actions.showDialog({ type: 'worktree', branch }), !canCommit);
  if (branch.kind === 'local') {
    sep();
    add('更新（仅快进）', ArrowDownToLine, () => confirmAction(actions, '更新分支', `从上游 ${shortRef(branch.upstream)} 更新 ${name}，只允许快进，不自动创建合并或改写历史。`, { action: 'pull', branch: branch.ref }), !branch.upstream || Boolean(blocked));
    add('推送…', ArrowUpFromLine, () => actions.showDialog({ type: 'push', branch }), !data.remotes.length || !canCommit);
    result.push({ label: branch.upstream ? `跟踪的分支 '${shortRef(branch.upstream)}'` : '设置跟踪分支', icon: GitBranch, children: data.branches.filter((item) => item.kind === 'remote').map((upstream) => ({ label: upstream.name, selected: branch.upstream === upstream.ref, run: () => confirmAction(actions, '设置跟踪分支', `将 ${name} 的上游设为 ${upstream.name}。`, { action: 'setUpstream', branch: branch.ref, upstream: upstream.ref }) })) });
    sep();
    add('重命名…', Pencil, () => actions.showDialog({ type: 'rename', branch }), Boolean(blocked) || !canCommit);
  }
  if (remote) {
    sep();
    add(`使用变基拉入 '${target}'`, GitPullRequestArrow, () => confirmAction(actions, '拉取并变基', `先抓取远程 ${name}，再将当前 ${target} 变基到抓取的提交之上。`, { action: 'pullRemote', ref: branch.ref, strategy: 'rebase' }), !data.branch || !canCommit);
    add(`使用合并拉入 '${target}'`, GitMerge, () => confirmAction(actions, '拉取并合并', `先抓取远程 ${name}，再合并到当前 ${target}。`, { action: 'pullRemote', ref: branch.ref, strategy: 'merge' }), !data.branch || !canCommit);
  }
  if (!current && branch.kind !== 'tag') {
    sep();
    result.push({ label: '删除…', icon: Trash2, danger: true, disabled: Boolean(blocked), run: () => confirmAction(actions, remote ? '删除远程分支' : '删除本地分支', remote ? `这会从远程仓库删除 ${name}，影响其他协作者。不会删除本地分支。` : `删除 ${name}。只允许安全删除已合并分支，不会强制删除未合并的提交。`, { action: 'deleteBranch', ref: branch.ref }, true) });
  }
  return result;
}

function MenuItems({ items, menu: M }) {
  return items.map((item, index) => {
    if (item.separator) return <M.Separator key={`sep-${index}`} className="git-menu-separator" />;
    const Icon = item.icon;
    if (item.children) return <M.Sub key={item.label}>
      <M.SubTrigger className="git-menu-item" disabled={!item.children.length}>{Icon && <Icon size={14} aria-hidden="true" />}<span>{item.label}</span><ChevronRight size={12} aria-hidden="true" /></M.SubTrigger>
      <M.Portal><M.SubContent className="dsh-git git-menu" sideOffset={5} collisionPadding={8}><MenuItems items={item.children} menu={M} /></M.SubContent></M.Portal>
    </M.Sub>;
    return <M.Item key={item.label} className={`git-menu-item ${item.danger ? 'git-danger' : ''}`} disabled={item.disabled} onSelect={item.run}>{Icon ? <Icon size={14} aria-hidden="true" /> : <span className="git-menu-icon-space">{item.selected && <Check size={13} aria-hidden="true" />}</span>}<span>{item.label}</span></M.Item>;
  });
}
export function BranchContext({ branch, data, actions, busy, children }) {
  const items = branchCommands(branch, data, actions).map((item) => busy ? { ...item, disabled: true, children: undefined } : item);
  return <ContextMenu.Root><ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="dsh-git git-menu" collisionPadding={8}><MenuItems items={items} menu={ContextMenu} /></ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>;
}
export function BranchMore({ branch, data, actions, busy }) {
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><IconButton icon={MoreHorizontal} label={`${branch.name} 的分支操作`} disabled={Boolean(busy)} /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content side="right" align="start" sideOffset={5} collisionPadding={8} className="dsh-git git-menu"><MenuItems items={branchCommands(branch, data, actions)} menu={DropdownMenu} /></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}

export function BranchList({ data, actions, busy, query = '', mode = 'sidebar', selected = '', onPick }) {
  const [expanded, setExpanded] = useState({ local: true, remote: true, tag: false });
  let branches = data?.branches ?? [];
  if (data?.branch && !branches.some((branch) => branch.kind === 'local' && branch.name === data.branch)) branches = [{ kind: 'local', name: data.branch, ref: `refs/heads/${data.branch}`, hash: null, upstream: null, ahead: 0, behind: 0 }, ...branches];
  const filtered = branches.filter((branch) => branch.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="git-branch-list">
    {mode === 'sidebar' && <button type="button" className={`git-branch-row git-head-row ${!selected ? 'is-selected' : ''}`} onClick={() => actions.filter({ ref: '' })}><CircleDot size={13} aria-hidden="true" /><span>HEAD<span className="git-muted">（所有分支）</span></span></button>}
    {[['local', '本地'], ['remote', '远程'], ['tag', '标签']].map(([kind, label]) => {
      const list = filtered.filter((branch) => branch.kind === kind);
      if (kind === 'tag' && mode === 'picker') return null;
      if (!list.length && !query && kind !== 'local') return null;
      return <section className="git-branch-group" key={kind}>
        <button type="button" className="git-group-label" aria-expanded={Boolean(expanded[kind] || query)} onClick={() => setExpanded((state) => ({ ...state, [kind]: !state[kind] }))}><ChevronRight size={12} className={(expanded[kind] || query) ? 'is-expanded' : ''} aria-hidden="true" />{label}<span className="git-group-count">{list.length}</span></button>
        {(expanded[kind] || query) && list.map((branch) => {
          const current = kind === 'local' && branch.name === data.branch;
          return <div key={branch.ref} className={`git-branch-row-wrap ${mode === 'sidebar' && (selected === branch.ref || (!selected && current)) ? 'is-current' : ''}`}>
            <BranchContext branch={branch} data={data} actions={actions} busy={busy}>
              <button type="button" disabled={Boolean(busy)} className={`git-branch-row ${current ? 'is-current' : ''}`} aria-current={current ? 'true' : undefined} title={`${branch.name}${branch.upstream ? ` → ${shortRef(branch.upstream)}` : ''}\n${branch.subject || '还没有提交'}\n右键查看操作`} onClick={() => mode === 'picker' ? onPick?.(branch) : actions.filter({ ref: branch.ref })} onDoubleClick={() => mode === 'sidebar' && !current && confirmAction(actions, `签出 ${branch.name}`, '切换分支，不会强制丢弃未提交的改动。', { action: 'checkout', ref: branch.ref })}>
                <RefIcon branch={branch} current={current} /><span className="git-branch-name">{branch.name}</span>{branch.ahead > 0 && <span className="git-ahead" title={`领先 ${branch.ahead} 个提交`}>↗ {branch.ahead}</span>}{branch.behind > 0 && <span className="git-behind" title={`落后 ${branch.behind} 个提交`}>↙ {branch.behind}</span>}{current && mode === 'picker' && <Check size={13} aria-label="当前分支" />}
              </button>
            </BranchContext>
            <BranchMore branch={branch} data={data} actions={actions} busy={busy} />
          </div>;
        })}
        {kind === 'local' && !list.length && <div className="git-small-empty">{query ? '无匹配分支' : '尚无本地分支'}</div>}
      </section>;
    })}
    {query && !filtered.length && <div className="git-small-empty">没有找到“{query}”</div>}
  </div>;
}

export function BranchPicker({ state, actions }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const data = state.data;
  const current = data?.branches?.find((branch) => branch.kind === 'local' && branch.name === data.branch);
  const ready = data?.state === 'ready';
  const disabled = !ready || Boolean(state.busy);
  const command = (run) => { setOpen(false); run(); };
  return <Popover.Root open={open} onOpenChange={(value) => { setOpen(value); if (!value) setQuery(''); }}>
    <Popover.Trigger asChild><button type="button" className="git-branch-trigger" disabled={disabled} title="分支列表与操作" aria-label="打开分支列表"><GitBranch size={14} aria-hidden="true" /><span>{ready ? data.branch || `detached · ${data.head?.slice(0, 7) || 'HEAD'}` : '分支'}</span>{data?.ahead > 0 && <span className="git-ahead">↗ {data.ahead}</span>}<ChevronDown size={12} aria-hidden="true" /></button></Popover.Trigger>
    <Popover.Portal><Popover.Content side="top" align="start" sideOffset={8} collisionPadding={12} onCloseAutoFocus={(event) => { if (state.dialog || state.diff) event.preventDefault(); }} className="dsh-git git-branch-popover" aria-label="Git 分支列表">
      <SearchInput value={query} onChange={setQuery} placeholder="搜索分支和操作" />
      <div className="git-picker-commands">
        <button type="button" onClick={() => command(() => current ? confirmAction(actions, '更新当前分支', '仅快进更新，不会自动合并或重写历史。', { action: 'pull', branch: current.ref }) : actions.mutate({ action: 'fetch' }))} disabled={!current?.upstream}><ArrowDownToLine size={14} aria-hidden="true" /><span>更新项目…</span><span className="git-picker-meta">仅快进</span></button>
        <button type="button" onClick={() => command(() => actions.showDialog({ type: 'commit' }))} disabled={!data?.files?.length || Boolean(data?.operation)}><GitCommitHorizontal size={14} aria-hidden="true" /><span>提交…</span><span className="git-picker-meta">{data?.files?.filter((file) => file.staged).length || 0} 已暂存</span></button>
        <button type="button" onClick={() => command(() => actions.showDialog({ type: 'push', branch: current }))} disabled={!current || !data?.remotes?.length}><ArrowUpFromLine size={14} aria-hidden="true" /><span>推送…</span></button>
      </div>
      <div className="git-picker-commands">
        <button type="button" onClick={() => command(() => actions.showDialog({ type: 'newBranch', branch: current || { ref: 'HEAD', name: 'HEAD' } }))} disabled={!data?.head}><Plus size={14} aria-hidden="true" /><span>新建分支…</span></button>
        <button type="button" onClick={() => command(() => actions.mutate({ action: 'fetch' }))} disabled={!data?.remotes?.length}><RefreshCw size={14} aria-hidden="true" /><span>获取所有远程更新</span></button>
      </div>
      <div className="git-picker-branches"><BranchList data={data} actions={actions} busy={state.busy} query={query} mode="picker" onPick={(branch) => command(() => { if (branch.kind === 'local' && branch.name === data.branch) return; confirmAction(actions, `签出 ${branch.name}`, branch.kind === 'remote' ? `创建或切换到跟踪 ${branch.name} 的本地分支，不强制覆盖改动。` : '切换到所选分支，不强制覆盖改动。', { action: 'checkout', ref: branch.ref }); })} /></div>
      <p className="git-picker-hint">单击切换分支 · 右键查看更多操作</p>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

export function AddTabMenu({ actions }) {
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><IconButton icon={Plus} label="新增 Git 标签页" className="git-add-tab" /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content side="top" align="end" sideOffset={8} className="dsh-git git-menu" collisionPadding={8}>
    <DropdownMenu.Label className="git-menu-label">新建标签页</DropdownMenu.Label>
    <DropdownMenu.Item className="git-menu-item" onSelect={() => actions.addTab('git')}><GitBranch size={14} aria-hidden="true" /><span>GIT工作区</span></DropdownMenu.Item>
    <DropdownMenu.Item className="git-menu-item" onSelect={() => actions.addTab('worktrees')}><FolderPlus size={14} aria-hidden="true" /><span>工作树</span></DropdownMenu.Item>
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}
