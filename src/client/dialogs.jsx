import React, { useEffect, useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Check, Copy, FileDiff, GitCommitHorizontal, X } from 'lucide-react';
import { IconButton, Spinner, shortRef } from './ui.jsx';

function siblingPath(root = '') {
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]$/, '')}-worktree`.split(/[\\/]/).join(sep);
}
function TextField({ label, value, onChange, hint, required = true, ...props }) {
  const id = useId();
  return <label className="git-form-field" htmlFor={id}><span>{label}</span><input id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} {...props} />{hint && <small>{hint}</small>}</label>;
}
const titles = { newBranch: '新建分支', rename: '重命名分支', worktree: '新建工作树', push: '推送分支', commit: '提交更改' };

export function OperationDialog({ state, actions }) {
  const dialog = state.dialog;
  const [name, setName] = useState(''), [directory, setDirectory] = useState(''), [newBranch, setNewBranch] = useState(''), [checkout, setCheckout] = useState(true), [remote, setRemote] = useState(''), [message, setMessage] = useState(''), [confirmation, setConfirmation] = useState('');
  useEffect(() => {
    if (!dialog) return;
    setName(dialog.type === 'rename' ? dialog.branch.name : '');
    setDirectory(siblingPath(state.data?.root));
    setNewBranch(`${dialog.branch?.name?.split('/').at(-1) || 'branch'}-worktree`);
    setCheckout(true); setMessage(''); setConfirmation('');
    setRemote(dialog.branch?.upstream ? '__upstream' : state.data?.remotes?.includes('origin') ? 'origin' : state.data?.remotes?.[0] || '');
  }, [dialog]);
  if (!dialog) return null;
  const data = state.data, branch = dialog.branch;
  const title = dialog.title || titles[dialog.type];
  const typedTarget = dialog.danger && dialog.mutation?.action === 'deleteBranch' && dialog.mutation.ref.startsWith('refs/remotes/') ? shortRef(dialog.mutation.ref) : '';
  const descriptions = {
    newBranch: `基于 ${branch?.name || 'HEAD'} 创建本地分支。`,
    rename: `仅修改本地分支 ${branch?.name} 的名称，不重命名远程分支。`,
    worktree: `基于 ${branch?.name || 'HEAD'} 创建独立工作目录。请使用仓库之外的新目录；不覆盖已有文件。`,
    push: `推送本地 ${branch?.name || '当前分支'}。不会使用强制推送。凭据由宿主已有的 Git 配置提供。`,
    commit: '只提交已经暂存的文件。不会自动暂存全部改动，也不会修改 Git 用户身份。',
  };
  const submit = async (event) => {
    event.preventDefault();
    let mutation;
    if (dialog.type === 'confirm') mutation = dialog.mutation;
    if (dialog.type === 'newBranch') mutation = { action: 'createBranch', name: name.trim(), start: branch?.ref || 'HEAD', checkout };
    if (dialog.type === 'rename') mutation = { action: 'renameBranch', branch: branch.ref, name: name.trim() };
    if (dialog.type === 'worktree') mutation = { action: 'createWorktree', path: directory.trim(), ref: branch?.ref || 'HEAD', ...(newBranch.trim() ? { newBranch: newBranch.trim() } : {}) };
    if (dialog.type === 'push') mutation = { action: 'push', branch: branch.ref, ...(remote !== '__upstream' ? { remote } : {}) };
    if (dialog.type === 'commit') mutation = { action: 'commit', message: message.trim() };
    if (mutation) await actions.mutate(mutation, { expected: dialog.expected });
  };
  const pending = Boolean(state.busy);
  const noStaged = dialog.type === 'commit' && !data?.files?.some((file) => file.staged);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) actions.closeDialog(); }}>
    <Dialog.Portal><Dialog.Overlay className="dsh-git git-modal-overlay" /><Dialog.Content className="dsh-git git-dialog" onOpenAutoFocus={(event) => { const field = event.target.querySelector('input:not([type="checkbox"]), textarea, select'); if (field) { event.preventDefault(); field.focus(); field.select?.(); } }} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onPointerDownOutside={(event) => event.preventDefault()}>
      <div className="git-dialog-heading"><Dialog.Title>{title}</Dialog.Title><IconButton icon={X} label="关闭操作对话框" onClick={actions.closeDialog} disabled={pending} /></div>
      <Dialog.Description className="git-dialog-description">{dialog.description || descriptions[dialog.type]}</Dialog.Description>
      <form onSubmit={submit}>
        <fieldset disabled={pending} className="git-form-fields">
          {['newBranch', 'rename'].includes(dialog.type) && <TextField label="分支名称" value={name} onChange={setName} placeholder="例如 feature/git-toolbar" maxLength={250} autoFocus />}
          {dialog.type === 'newBranch' && <label className="git-checkbox"><input type="checkbox" checked={checkout} onChange={(event) => setCheckout(event.target.checked)} /><span>创建后切换到新分支</span></label>}
          {dialog.type === 'worktree' && <>
            <TextField label="工作树目录（绝对路径）" value={directory} onChange={setDirectory} maxLength={32000} autoFocus />
            <TextField label="新分支名称（可选）" value={newBranch} onChange={setNewBranch} required={false} placeholder="留空使用所选已有分支" hint="已有分支不能同时被多个工作树签出。远程引用未指定新分支时使用 detached HEAD。" maxLength={250} />
          </>}
          {dialog.type === 'push' && <label className="git-form-field"><span>推送目标</span><select aria-label="推送目标" value={remote} onChange={(event) => setRemote(event.target.value)} required>{branch?.upstream && <option value="__upstream">已配置上游 · {shortRef(branch.upstream)}</option>}{data?.remotes?.map((item) => <option key={item} value={item}>{item} · {branch?.name}（设置上游）</option>)}</select></label>}
          {dialog.type === 'commit' && <>
            <div className="git-commit-files"><div className="git-form-section-label">选择要暂存的文件 <span>{data.files.filter((file) => file.staged).length} / {data.files.length}</span></div>
              {!data.files.length && <p className="git-muted">工作区干净，没有需要提交的改动。</p>}
              {data.files.map((file) => <label className="git-commit-file" key={file.path}><input type="checkbox" checked={file.staged} aria-label={`暂存 ${file.path}`} disabled={file.conflict && !file.unstaged} onChange={() => actions.mutate({ action: file.staged ? 'unstage' : 'stage', paths: [file.path] }, { expected: dialog.expected, keepDialog: true })} /><span className={`git-file-status git-status-${file.index === '?' ? 'A' : file.index}`}>{file.index === '?' ? '+' : file.index === '.' ? file.worktree : file.index}</span><span title={file.path}>{file.path}</span></label>)}
            </div>
            <label className="git-form-field"><span>提交信息</span><textarea aria-label="提交信息" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="简要描述这次更改…" rows={4} maxLength={16000} required autoFocus /></label>
          </>}
          {dialog.danger && <div className="git-form-warning"><AlertTriangle size={16} aria-hidden="true" /><span>请确认所选仓库与目标。此操作不会自动为你创建备份。</span></div>}
          {typedTarget && <TextField label={`输入 ${typedTarget} 以确认`} value={confirmation} onChange={setConfirmation} placeholder={typedTarget} autoComplete="off" />}
          {state.error && <p className="git-inline-error" role="alert">{state.error.message}</p>}
        </fieldset>
        <div className="git-dialog-footer"><button type="button" className="git-button" onClick={actions.closeDialog} disabled={pending}>取消</button><button type="submit" className={`git-button ${dialog.danger ? 'git-button-danger' : 'git-button-primary'}`} disabled={pending || noStaged || (typedTarget && confirmation !== typedTarget)}>{pending ? <Spinner /> : dialog.type === 'commit' ? <GitCommitHorizontal size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{pending ? '操作中…' : dialog.type === 'confirm' ? '确认执行' : title}</button></div>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}

export function DiffDialog({ state, actions }) {
  const diff = state.diff;
  if (!diff) return null;
  const lines = (diff.text || '').split('\n');
  const maxLines = 6000;
  return <Dialog.Root open onOpenChange={(open) => { if (!open) actions.closeDiff(); }}><Dialog.Portal><Dialog.Overlay className="dsh-git git-modal-overlay" /><Dialog.Content className="dsh-git git-dialog git-diff-dialog">
    <div className="git-dialog-heading"><FileDiff size={16} aria-hidden="true" /><Dialog.Title>{diff.title || '文件差异'}</Dialog.Title><span className="git-spacer" /><IconButton icon={Copy} label="复制差异" onClick={() => actions.copy(diff.text)} disabled={!diff.text} /><IconButton icon={X} label="关闭文件差异" onClick={actions.closeDiff} /></div>
    <Dialog.Description className="git-sr-only">统一差异视图。加号表示新增，减号表示删除。内容只读。</Dialog.Description>
    {diff.loading ? <div className="git-diff-placeholder"><Spinner /><span>读取差异…</span></div> : diff.error ? <div className="git-diff-placeholder" role="alert">{diff.error}</div> : !diff.text ? <div className="git-diff-placeholder">没有可显示的差异。</div> : <div className="git-diff-scroll" tabIndex={0} aria-label="差异内容"><pre>{lines.slice(0, maxLines).map((line, index) => <span key={index} className={`git-diff-line ${line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') ? 'git-diff-file' : line.startsWith('+') ? 'git-diff-add' : line.startsWith('-') ? 'git-diff-remove' : line.startsWith('@@') ? 'git-diff-hunk' : ''}`}><span className="git-diff-number" aria-hidden="true">{index + 1}</span><code>{line || ' '}</code></span>)}</pre></div>}
    {(diff.truncated || lines.length > maxLines) && <p className="git-diff-truncated" role="status">差异较大，当前仅显示部分内容。请在终端中查看完整差异。</p>}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
