import { GitModel } from './model.mjs';
import { createMenuEntryTarget } from './entry-target.mjs';
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
    loadAiModels: model.loadAiModels, saveSettings: model.saveSettings,
    generateCommit: model.generateCommit, cancelAi: model.cancelAi,
    refresh: () => model.refresh(), loadMore: () => model.loadHistory(true),
    mutate: (mutation, options) => model.mutate(mutation, options), copy: (text) => model.copy(text),
  };
  const menuEntry = createMenuEntryTarget();
  const face = () => ({ hooks: { git: model.source, gitMenuEntry: menuEntry }, actions });
  ctx.effect(() => {
    const offMenuEntry = menuEntry.mount();
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
    document.addEventListener('keydown', model.handleShortcut);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      document.removeEventListener('keydown', model.handleShortcut);
      offWorkspace(); offSessions(); offMenuEntry();
      model.dispose(); style.remove();
    };
  }, 'dsh-git: model, style and refresh subscriptions');
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-git.dock', order: 80, inject: face }, GitShell));
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'dsh-git.toolbar', order: 80, inject: face }, GitToolbarButton));
}
