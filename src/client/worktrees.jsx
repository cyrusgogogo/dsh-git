import React from 'react';
import { Copy, FolderGit2, FolderOpen, GitBranch, LockKeyhole, Plus, Trash2, UnlockKeyhole } from 'lucide-react';
import { EmptyState, IconButton, confirmAction, currentBranch } from './ui.jsx';

export function Worktrees({ state, actions }) {
  const data = state.data;
  const same = (a, b) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
  return <section className="git-worktrees" aria-label="Git 工作树列表"><div className="git-worktree-toolbar"><div><FolderGit2 size={16} strokeWidth={1.6} aria-hidden="true" /><strong>工作树</strong><span className="git-count">{data.worktrees.length}</span><span className="git-muted">同一仓库，独立的工作目录</span></div><button type="button" className="git-button" disabled={!data.head || Boolean(state.busy)} onClick={() => actions.showDialog({ type: 'worktree', branch: currentBranch(data) || { name: 'HEAD', ref: 'HEAD' } })}><Plus size={13} aria-hidden="true" />新建工作树</button></div>
    <div className="git-worktree-columns" aria-hidden="true"><span>工作目录 / 分支</span><span>HEAD</span><span>状态</span><span>操作</span></div>
    <div className="git-worktree-list">{data.worktrees.map((tree) => {
      const selected = same(tree.path, data.root);
      return <article className={`git-worktree-row ${selected ? 'is-selected' : ''}`} key={tree.path}>
        <div className="git-worktree-name"><FolderGit2 size={20} strokeWidth={1.5} aria-hidden="true" /><div><div className="git-worktree-branch"><GitBranch size={13} aria-hidden="true" /><strong>{tree.branch || (tree.detached ? 'detached HEAD' : '尚无提交')}</strong>{tree.main && <span className="git-subtle-badge">主工作树</span>}{selected && <span className="git-active-badge">当前</span>}</div><span className="git-worktree-path" title={tree.path}>{tree.path}</span></div></div>
        <code>{tree.head?.slice(0, 8) || '—'}</code>
        <span className="git-worktree-state">{tree.locked ? <><LockKeyhole size={12} aria-hidden="true" /><span title={tree.lockReason}>已锁定</span></> : tree.prunable ? '路径不可用' : '可用'}</span>
        <div className="git-worktree-actions"><button type="button" className="git-button git-button-small" disabled={selected || tree.prunable || Boolean(state.busy)} title="在此面板中查看该工作树" onClick={() => actions.selectWorktree(tree.path)}><FolderOpen size={12} aria-hidden="true" />打开</button><IconButton icon={Copy} label={`复制工作树路径 ${tree.path}`} onClick={() => actions.copy(tree.path)} />{!tree.main && <><IconButton icon={tree.locked ? UnlockKeyhole : LockKeyhole} label={`${tree.locked ? '解锁' : '锁定'}工作树 ${tree.branch || tree.path}`} disabled={Boolean(state.busy)} onClick={() => actions.mutate({ action: 'lockWorktree', path: tree.path, lock: !tree.locked })} /><IconButton icon={Trash2} label={`移除工作树 ${tree.branch || tree.path}`} disabled={selected || tree.locked || Boolean(state.busy)} onClick={() => confirmAction(actions, '移除工作树', `移除工作目录 ${tree.path}。只允许移除干净且未锁定的非当前工作树；不会删除对应分支，也不会强制丢弃文件。`, { action: 'removeWorktree', path: tree.path }, true)} /></>}</div>
      </article>;
    })}</div>
    <footer className="git-worktree-footer">工作树列表来自 <code>git worktree list</code>。“打开”仅切换本面板的查看目录，不改变 DSH 会话工作区。</footer>
  </section>;
}
