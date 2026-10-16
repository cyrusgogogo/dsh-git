import { GitModel } from './model.mjs';
import { GitShell, GitToolbarButton } from './panel.jsx';
import styles from './styles.css';

export const inject = ['slots', 'connection', 'sessions', 'workspaces'];

export function apply(ctx) {
  const model = new GitModel((payload, signal) => ctx.connection.rpc.call('/api', 'dsh-git', payload, signal));
  const actions = {
    toggle: model.toggle, open: model.open, setHeight: model.setHeight, maximize: model.maximize,
    selectWorkspace: model.selectWorkspace, selectWorktree: model.selectWorktree,
    addTab: model.addTab, activateTab: model.activateTab, closeTab: model.closeTab,
    setSidebarTab: model.setSidebarTab, filter: model.filter, selectCommit: model.selectCommit,
    showDiff: model.showDiff, closeDiff: model.closeDiff, showDialog: model.showDialog, closeDialog: model.closeDialog,
    dismissMessage: model.dismissMessage,
    refresh: () => model.refresh(), loadMore: () => model.loadHistory(true),
    mutate: (mutation, options) => model.mutate(mutation, options), copy: (text) => model.copy(text),
  };
  const face = () => ({ hooks: { git: model.source }, actions });
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.dshGit = '';
    style.textContent = styles;
    document.head.append(style);
    const update = () => model.syncContext(ctx.workspaces.list.getSnapshot(), ctx.sessions.list.getSnapshot());
    const offWorkspace = ctx.workspaces.list.subscribe(update);
    const offSessions = ctx.sessions.list.subscribe(update);
    update();
    const refresh = () => { if (model.state.open && !document.hidden && !model.state.busy) void model.refresh({ quiet: true }); };
    const interval = setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      offWorkspace(); offSessions();
      model.dispose(); style.remove();
    };
  }, 'dsh-git: model, style and refresh subscriptions');
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-git.dock', order: 80, inject: face }, GitShell));
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'dsh-git.toolbar', order: 80, inject: face }, GitToolbarButton));
}
