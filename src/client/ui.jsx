import React from 'react';
import { LoaderCircle, GitBranch, GitFork, Tag, Check, AlertCircle, FolderGit2, Search, X } from 'lucide-react';

export function Spinner() { return <LoaderCircle className="git-spin" size={14} aria-hidden="true" />; }
export const IconButton = React.forwardRef(function IconButton({ icon: Icon, label, className = '', ...props }, ref) {
  return <button ref={ref} type="button" className={`git-icon-button ${className}`} aria-label={label} title={label} {...props}><Icon size={15} strokeWidth={1.6} aria-hidden="true" /></button>;
});
export function RefIcon({ branch, current = false, size = 14 }) {
  const Icon = branch?.kind === 'tag' ? Tag : branch?.kind === 'remote' ? GitFork : GitBranch;
  return <Icon size={size} strokeWidth={1.6} className={current ? 'git-current-icon' : ''} aria-hidden="true" />;
}
export function EmptyState({ title, description, icon: Icon = FolderGit2, children, compact = false }) {
  return <div className={`git-empty ${compact ? 'git-empty-compact' : ''}`}><span className="git-empty-icon" aria-hidden="true"><Icon size={compact ? 17 : 22} strokeWidth={1.6} /></span><h3>{title}</h3>{description && <p>{description}</p>}{children}</div>;
}
export function SearchInput({ value, onChange, placeholder, label, ...props }) {
  return <div className="git-search"><Search size={14} strokeWidth={1.6} aria-hidden="true" /><input aria-label={label || placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} {...props} />{value && <button type="button" aria-label={`清除${label || '搜索'}`} onClick={() => onChange('')}><X size={12} aria-hidden="true" /></button>}</div>;
}
export function Notice({ state, actions }) {
  if (!state.error && !state.notice) return null;
  return <div className={`git-notice ${state.error ? 'git-notice-error' : ''}`} role={state.error ? 'alert' : 'status'}>
    {state.error ? <AlertCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
    <span title={state.error?.message || state.notice}>{state.error?.message || state.notice}</span>
    <IconButton icon={X} label="关闭消息" onClick={actions.dismissMessage} />
  </div>;
}
export function navigateTabs(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.closest('[role="tablist"]').querySelectorAll('[role="tab"]')].filter((tab) => !tab.disabled);
  const current = tabs.indexOf(event.currentTarget);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
}
export function shortRef(ref) { return ref?.replace(/^refs\/(heads|remotes|tags)\//, '') || ''; }
export function currentBranch(data) { return data?.branches?.find((branch) => branch.kind === 'local' && branch.name === data.branch); }
export function confirmAction(actions, title, description, mutation, danger = false) { actions.showDialog({ type: 'confirm', title, description, mutation, danger }); }
