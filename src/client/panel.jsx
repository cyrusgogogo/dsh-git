import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderGit2, GitBranch, GitFork, Maximize2, Minimize2, Minus, RefreshCw, Settings, Sparkles, X } from 'lucide-react';
import { SelectControl, SelectGroup, SelectItem, SelectLabel } from './select.jsx';
import { AddTabMenu, BranchPicker } from './branches.jsx';
import { DiffDialog, OperationDialog } from './dialogs.jsx';
import { CommitDialog } from './commit-dialog.jsx';
import { SettingsDialog } from './settings-dialog.jsx';
import { History, Inspector, RepositorySidebar } from './history.jsx';
import { Worktrees } from './worktrees.jsx';
import { EmptyState, IconButton, Notice, Spinner, confirmAction, currentBranch, navigateTabs, shortRef } from './ui.jsx';

export function GitToolbarButton({ useGit, useGitMenuEntry, actions }) {
  const open = useGit((state) => state.open);
  const menuEntry = useGitMenuEntry((target) => target);
  if (menuEntry) return null;
  return <button type="button" className={`dsh-git git-toolbar-entry ${open ? 'is-active' : ''}`} aria-label={open ? '收起 Git 工具栏' : '打开 Git 工具栏'} aria-expanded={open} aria-controls="dsh-git-panel" onClick={actions.toggle} title="Git 工具栏"><GitBranch size={16} strokeWidth={1.7} aria-hidden="true" /><span>Git</span></button>;
}
function GitTitlebarButton({ open, actions }) {
  return <button type="button" className="git-titlebar-entry" style={{ whiteSpace: 'nowrap', WebkitAppRegion: 'no-drag' }} aria-label={open ? '收起 Git 工具栏' : '打开 Git 工具栏'} aria-expanded={open} onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={actions.toggle} title="Git 工具栏">Git</button>;
}
function OperationBanner({ data, actions, busy }) {
  if (!data.operation) return null;
  const operation = { rebase: '变基', merge: '合并', 'cherry-pick': '优选（拣选提交）' }[data.operation];
  const conflicts = data.files.filter((file) => file.conflict).length;
  return <div className="git-operation-banner" role="status"><GitFork size={14} aria-hidden="true" /><span>{operation}进行中{conflicts ? ` · ${conflicts} 个未解决冲突` : ' · 解决冲突后可继续'}。请在编辑器中处理文件，再于“更改”中暂存。</span><button type="button" className="git-button git-button-small" disabled={Boolean(busy) || conflicts > 0} onClick={() => confirmAction(actions, `继续${operation}`, '使用当前已暂存的冲突解决结果继续此操作。', { action: 'continueOperation', operation: data.operation })}>继续</button><button type="button" className="git-button git-button-small" disabled={Boolean(busy)} onClick={() => confirmAction(actions, `中止${operation}`, `中止当前${operation}，Git 将尝试恢复操作前的状态。`, { action: 'abortOperation', operation: data.operation }, true)}>中止</button></div>;
}
function WorkspaceSelector({ state, actions }) {
  return <SelectControl label="Git 工作区目录" icon={FolderGit2} value={state.workspaceId || ''} onValueChange={actions.selectWorkspace} disabled={Boolean(state.busy) || !state.workspaces.length} placeholder={state.workspaces.length ? '选择工作区…' : '暂无工作区'} title={state.data?.root || state.workspaces.find((item) => item.workspaceId === state.workspaceId)?.path || '请选择 DSH 工作区'} className="git-workspace-selector" contentClassName="git-select-workspaces" align="end">
    <SelectGroup><SelectLabel>切换工作区</SelectLabel>{state.workspaces.map((workspace) => <SelectItem value={workspace.workspaceId} key={workspace.workspaceId} icon={FolderGit2} description={workspace.path} textValue={workspace.title}>{workspace.title}</SelectItem>)}</SelectGroup>
  </SelectControl>;
}
function Panel({ state, actions }) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const data = state.data;
  const ready = data?.state === 'ready';
  const tab = state.tabs.find((item) => item.id === state.activeTab) || state.tabs[0];
  const current = ready && currentBranch(data);
  const statusText = state.loading ? '正在读取仓库…' : data?.state === 'not-repository' ? '非 Git 仓库' : data?.state === 'git-unavailable' ? 'Git 不可用' : data ? '工作区暂时不可用' : '等待仓库数据';
  return <section id="dsh-git-panel" className={`dsh-git git-panel ${state.maximized ? 'is-maximized' : ''} ${dragging ? 'is-resizing' : ''}`} style={{ height: state.maximized ? undefined : state.height }} aria-label="Git 底部工具面板">
    <div className="git-resize-handle" role="separator" aria-label="调整 Git 面板高度" aria-orientation="horizontal" aria-valuenow={state.height} aria-valuemin={180} aria-valuemax={Math.max(180, (globalThis.innerHeight || 1000) - 80)} tabIndex={0} onDoubleClick={actions.maximize} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); drag.current = { y: event.clientY, height: state.height }; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }} onPointerMove={(event) => { if (drag.current) actions.setHeight(drag.current.height + drag.current.y - event.clientY); }} onPointerUp={(event) => { drag.current = null; setDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; setDragging(false); }} onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); actions.setHeight(event.key === 'Home' ? 230 : event.key === 'End' ? globalThis.innerHeight - 80 : state.height + (event.key === 'ArrowUp' ? 24 : -24)); } }} />
    <header className="git-panel-header"><strong className="git-panel-name">Git</strong><div className="git-tabs" role="tablist" aria-label="Git 工具视图">{state.tabs.map((item) => <div key={item.id} className={`git-tab-wrap ${item.id === state.activeTab ? 'is-active' : ''}`}><button type="button" role="tab" id={`git-tab-${item.id}`} aria-selected={item.id === state.activeTab} tabIndex={item.id === state.activeTab ? 0 : -1} onKeyDown={navigateTabs} aria-controls={`git-content-${item.id}`} onClick={() => actions.activateTab(item.id)}>{item.kind === 'git' ? <GitBranch size={12} aria-hidden="true" /> : <GitFork size={12} aria-hidden="true" />}<span>{item.kind === 'git' ? `日志: ${shortRef(item.ref) || '全部分支'}` : '工作树'}</span></button><button type="button" className="git-tab-close" aria-label={`关闭${item.kind === 'git' ? '日志' : '工作树'}标签页`} onClick={() => actions.closeTab(item.id)}><X size={11} aria-hidden="true" /></button></div>)}</div><BranchPicker state={state} actions={actions} /><AddTabMenu actions={actions} /><span className="git-spacer" /><WorkspaceSelector state={state} actions={actions} /><span className="git-header-divider" /><IconButton icon={RefreshCw} className={state.loading ? 'git-is-loading' : ''} label="刷新仓库" disabled={!state.workspaceId || state.loading || Boolean(state.busy)} onClick={actions.refresh} /><IconButton icon={state.maximized ? Minimize2 : Maximize2} label={state.maximized ? '还原 Git 面板' : '最大化 Git 面板'} onClick={actions.maximize} /><IconButton icon={Settings} label="Git 设置" disabled={Boolean(state.busy)} onClick={() => actions.showDialog({ type: 'settings' })} /><IconButton icon={Minus} label="收起 Git 面板" onClick={actions.toggle} /></header>
    {ready && <OperationBanner data={data} actions={actions} busy={state.busy} />}
    <div className="git-panel-content" role="tabpanel" id={`git-content-${tab.id}`} aria-labelledby={`git-tab-${tab.id}`}>
      {!state.workspaceId ? <EmptyState title="选择一个 DSH 工作区" description="Git 工具栏会读取当前所选工作区的仓库。可在右上方切换工作区目录，不会扫描其他目录。" /> : !data && state.loading ? <div className="git-loading"><Spinner />正在读取工作区的 Git 仓库…</div> : data && !ready ? <EmptyState title={data.state === 'not-repository' ? '此工作区尚未使用 Git' : data.state === 'git-unavailable' ? '需要安装 Git' : '工作区暂时不可用'} description={data.message}><div className="git-empty-path" title={data.workspace.path}>{data.workspace.path}</div><div className="git-empty-actions">{data.state === 'not-repository' && <button type="button" className="git-button git-button-primary" disabled={Boolean(state.busy)} onClick={() => confirmAction(actions, '初始化 Git 仓库', `在 ${data.workspace.path} 中创建 main 分支的空仓库。不会自动提交文件，也不会设置 Git 用户身份。已有 .git 元数据不会被覆盖。`, { action: 'initialize' })}><GitBranch size={13} aria-hidden="true" />初始化 Git 仓库</button>}<button type="button" className="git-button" onClick={actions.refresh} disabled={Boolean(state.busy)}><RefreshCw size={13} aria-hidden="true" />重新检测</button></div></EmptyState> : ready ? tab.kind === 'git' ? <div className="git-repository-grid"><RepositorySidebar state={state} actions={actions} tab={tab} /><History state={state} tab={tab} actions={actions} /><Inspector state={state} tab={tab} actions={actions} /></div> : <Worktrees state={state} actions={actions} /> : <EmptyState title="暂时无法读取仓库" description="请检查上方提示，或刷新重试。"><button className="git-button" onClick={actions.refresh}>重试</button></EmptyState>}
    </div>
    {state.tabs.filter((item) => item.id !== tab.id).map((item) => <div key={item.id} hidden role="tabpanel" id={`git-content-${item.id}`} aria-labelledby={`git-tab-${item.id}`} />)}
    <footer className="git-statusbar"><span className={`git-status-dot ${ready ? 'is-ready' : ''}`} aria-hidden="true" />{state.busy ? <><Spinner /><span>正在执行 Git 操作…</span></> : ready ? <><span className="git-status-root" title={data.root}>{data.root}</span>{state.worktreePath && <span className="git-subtle-badge">工作树视图</span>}<span className="git-status-branch"><GitBranch size={11} aria-hidden="true" />{data.branch || 'detached HEAD'}</span>{data.ahead > 0 && <span className="git-ahead">↑ {data.ahead}</span>}{data.behind > 0 && <span className="git-behind">↓ {data.behind}</span>}</> : <span>{state.workspaceId ? statusText : '未选择工作区'}</span>}<Notice state={state} actions={actions} /><span className="git-spacer" />{ready && <><span className="git-status-summary">{data.files.length ? `${data.files.length} 项更改` : '工作区干净'}</span><button type="button" className="git-status-action" onClick={() => actions.showDialog({ type: 'commit' })} disabled={!data.files.length || Boolean(state.busy) || Boolean(data.operation)} title="提交已暂存的更改">提交</button><button type="button" className="git-status-action" onClick={() => actions.showDialog({ type: 'commit', ai: true })} disabled={!data.files.length || Boolean(state.busy) || Boolean(data.operation)} title="生成可编辑的提交信息，确认后再提交"><Sparkles size={11} aria-hidden="true" />AI 提交</button><button type="button" className="git-status-action" onClick={() => actions.mutate({ action: 'fetch' })} disabled={!data.remotes.length || Boolean(state.busy)} title="获取所有远程更新">获取</button><button type="button" className="git-status-action" onClick={() => actions.showDialog({ type: 'push', branch: current })} disabled={!current || !data.remotes.length || Boolean(state.busy)} title="推送当前分支">推送</button></>}</footer>
  </section>;
}

export function GitShell({ useGit, useGitMenuEntry, usePanelInfo, actions }) {
  const state = useGit((value) => value);
  const menuEntry = useGitMenuEntry((target) => target);
  const activePanel = usePanelInfo?.((value) => value.activePanelId);
  return <>
    {menuEntry ? createPortal(<GitTitlebarButton open={state.open} actions={actions} />, menuEntry) : (!state.hasSession || activePanel) && <div className="git-global-launcher"><GitToolbarButton useGit={useGit} useGitMenuEntry={useGitMenuEntry} actions={actions} /></div>}
    {state.open && <Panel state={state} actions={actions} />}
    <OperationDialog state={state} actions={actions} />{state.dialog?.type === 'commit' && state.data?.state === 'ready' && <CommitDialog state={state} actions={actions} />}<SettingsDialog state={state} actions={actions} /><DiffDialog state={state} actions={actions} />
  </>;
}
