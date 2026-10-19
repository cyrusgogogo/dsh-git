import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { GitCommitHorizontal, Sparkles, Upload, X } from 'lucide-react';
import { IconButton, Spinner, currentBranch, shortRef } from './ui.jsx';

function SelectionCheckbox({ mixed, ...props }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" aria-checked={mixed ? 'mixed' : props.checked} {...props} />;
}

export function CommitDialog({ state, actions }) {
  const { data, dialog, aiDraft, aiBusy } = state;
  const [selected, setSelected] = useState(() => new Set());
  const [message, setMessage] = useState('');
  const [remote, setRemote] = useState(() => currentBranch(data)?.upstream ? '__upstream' : data.remotes.includes('origin') ? 'origin' : data.remotes[0] || '');
  const [selectionError, setSelectionError] = useState('');
  const previousDraft = useRef(null);
  const messageRef = useRef(null);
  useEffect(() => {
    if (aiDraft && aiDraft !== previousDraft.current && !aiDraft.stale) {
      setMessage(aiDraft.message);
      messageRef.current?.focus();
    }
    previousDraft.current = aiDraft;
  }, [aiDraft]);
  const files = data.files;
  const chosen = files.filter((file) => selected.has(file.path));
  const stageable = chosen.filter((file) => file.unstaged && !(file.conflict && !file.unstaged));
  const unstageable = chosen.filter((file) => file.staged);
  const staged = files.filter((file) => file.staged);
  const pending = Boolean(state.busy);
  const locked = pending || aiBusy;
  const branch = currentBranch(data);
  const canPush = Boolean(branch && data.remotes.length && remote);
  const invalid = locked || !staged.length || !message.trim() || Boolean(data.operation) || Boolean(aiDraft?.stale);
  const selectFile = (path, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(path); else next.delete(path); return next; });
  const batch = async (action, items) => {
    if (items.length > 1000) { setSelectionError('每次最多处理 1000 个文件，请减少选择后重试。'); return; }
    setSelectionError('');
    if (items.length) await actions.mutate({ action, paths: items.map((file) => file.path) }, { expected: dialog.expected, keepDialog: true });
  };
  const submit = async (event) => {
    event.preventDefault();
    if (invalid) return;
    const push = event.nativeEvent.submitter?.value === 'push';
    if (push && !canPush) return;
    const stagedTree = aiDraft?.stagedTree || data.stagedTree;
    await actions.mutate({ action: push ? 'commitAndPush' : 'commit', message: message.trim(), ...(stagedTree ? { stagedTree } : {}), ...(push ? { branch: branch.ref, ...(remote !== '__upstream' ? { remote } : {}) } : {}) }, { expected: dialog.expected });
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open) actions.closeDialog(); }}>
    <Dialog.Portal><Dialog.Overlay className="dsh-git git-modal-overlay" /><Dialog.Content className="dsh-git git-dialog git-commit-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); messageRef.current?.focus(); }} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onPointerDownOutside={(event) => event.preventDefault()}>
      <div className="git-dialog-heading"><GitCommitHorizontal size={17} aria-hidden="true" /><Dialog.Title>{dialog.ai ? 'AI 提交预览' : '提交更改'}</Dialog.Title><IconButton icon={X} label="关闭操作对话框" onClick={actions.closeDialog} disabled={pending} /></div>
      <Dialog.Description className="git-dialog-description">选择文件后批量暂存；只提交已暂存的内容。AI 仅生成文本，不会自动提交或推送。</Dialog.Description>
      <form onSubmit={submit}>
        <fieldset className="git-form-fields" disabled={locked}>
          <section className="git-commit-selection" aria-label="提交文件选择">
            <div className="git-selection-toolbar">
              <label className="git-checkbox"><SelectionCheckbox aria-label="选择全部文件" checked={files.length > 0 && chosen.length === files.length} mixed={chosen.length > 0 && chosen.length < files.length} disabled={locked || !files.length} onChange={(event) => setSelected(new Set(event.target.checked ? files.map((file) => file.path) : []))} /><span>全选</span></label>
              <button type="button" className="git-button git-button-small" disabled={!files.length} onClick={() => setSelected(new Set(files.filter((file) => !selected.has(file.path)).map((file) => file.path)))}>反选</button>
              <span className="git-selection-count">已选 {chosen.length} / {files.length}</span>
              <span className="git-spacer" />
              <button type="button" className="git-button git-button-small" disabled={!stageable.length} onClick={() => batch('stage', stageable)}>暂存所选{stageable.length > 0 ? ` (${stageable.length})` : ''}</button>
              <button type="button" className="git-button git-button-small" disabled={!unstageable.length} onClick={() => batch('unstage', unstageable)}>取消暂存所选</button>
            </div>
            <div className="git-commit-files">
              {!files.length && <p className="git-small-empty">工作区干净，没有需要提交的改动。</p>}
              {files.map((file) => <div className="git-commit-file" key={file.path}>
                <label><input type="checkbox" aria-label={`选择 ${file.path}`} checked={selected.has(file.path)} onChange={(event) => selectFile(file.path, event.target.checked)} /><span className={`git-file-status git-status-${file.conflict ? 'U' : file.index === '?' ? 'A' : file.index}`}>{file.conflict ? '!' : file.index === '?' ? '+' : file.index === '.' ? file.worktree : file.index}</span><span title={file.path}>{file.path}</span></label>
                <span className={`git-stage-badge ${file.staged ? 'is-staged' : ''}`}>{file.conflict ? '冲突' : file.staged ? file.unstaged ? '部分暂存' : '已暂存' : '未暂存'}</span>
                <button type="button" className="git-button git-button-small" disabled={file.staged ? false : !file.unstaged} onClick={() => batch(file.staged ? 'unstage' : 'stage', [file])} aria-label={`${file.staged ? '取消暂存' : '暂存'} ${file.path}`}>{file.staged ? '取消暂存' : '暂存'}</button>
              </div>)}
            </div>
            <p className="git-commit-help">已暂存 {staged.length} 个文件 · 勾选仅用于批量操作；“暂存所选”会暂存所选文件的全部当前更改。</p>
            {selectionError && <p className="git-inline-error" role="alert">{selectionError}</p>}
          </section>
          <div className="git-ai-heading"><span>提交信息 <small>{aiDraft ? `AI 生成 · ${aiDraft.provider} / ${aiDraft.model}` : '支持直接编辑'}</small></span><button type="button" className="git-button git-button-small" disabled={!staged.length || Boolean(data.operation)} onClick={actions.generateCommit}><Sparkles size={13} aria-hidden="true" />{aiDraft ? '重新生成' : 'AI 生成'}</button></div>
          <label className="git-form-field"><span className="git-sr-only">提交信息</span><textarea ref={messageRef} aria-label="提交信息" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="feat(scope): 简要描述这次更改…" rows={5} maxLength={16000} required /></label>
          {aiDraft && <p className={`git-commit-help ${aiDraft.stale || aiDraft.truncated ? 'git-ai-warning' : ''}`} role="status">{aiDraft.stale ? '暂存内容已变化，请重新生成提交信息后再确认。' : aiDraft.truncated ? '差异较大，仅发送了部分内容。请核对并补充提交说明后再确认。' : '请核对并按需编辑生成结果；点击下方按钮才会执行 Git 操作。'}</p>}
          {!staged.length && <p className="git-commit-help" role="status">请先暂存至少一个文件，才能生成或提交。</p>}
          {canPush && <label className="git-form-field"><span>提交并推送的目标</span><select aria-label="提交并推送的目标" value={remote} onChange={(event) => setRemote(event.target.value)}>{branch.upstream && <option value="__upstream">已配置上游 · {shortRef(branch.upstream)}</option>}{data.remotes.map((item) => <option key={item} value={item}>{item} · {branch.name}（设置上游）</option>)}</select></label>}
          <p className="git-commit-help">生成时会将已暂存差异发送给{state.settings.model ? ` ${state.settings.provider} / ${state.settings.model}` : '宿主首个可用模型'}。请勿暂存密钥等敏感内容。模型和文本规范可在 Git 设置中修改。</p>
        </fieldset>
        {aiBusy && <div className="git-ai-progress" role="status"><Spinner /><span>正在生成提交信息，不会执行提交…</span><button type="button" className="git-button git-button-small" onClick={actions.cancelAi}>停止生成</button></div>}
        {state.error && <p className="git-inline-error" role="alert">{state.error.message}</p>}
        <div className="git-dialog-footer"><button type="button" className="git-button" onClick={actions.closeDialog} disabled={pending}>取消</button><span className="git-spacer" /><button type="submit" className="git-button git-button-primary" value="commit" disabled={invalid}>{pending ? <Spinner /> : <GitCommitHorizontal size={14} aria-hidden="true" />}提交</button><button type="submit" value="push" className="git-button" disabled={invalid || !canPush} title={canPush ? '先创建本地提交，再非强制推送；失败时保留本地提交' : '需要本地分支和远程仓库才能推送'}><Upload size={14} aria-hidden="true" />提交并推送</button></div>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
