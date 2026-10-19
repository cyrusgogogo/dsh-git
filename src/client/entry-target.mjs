// Compatibility adapter for the Windows Desktop caption in DSH 0.2.1-rc.2.
// This is not a public slot or a native menu registration API. Keep our action
// OUTSIDE the preload-owned menubar: its two-item keyboard navigation and IPC
// remain untouched. If the known open-shadow shape is absent, use the normal
// conversation/global entry instead. Never patch the installed Desktop files.
export function createMenuEntryTarget(doc = document) {
  let target = null;
  let shadow = null;
  const listeners = new Set();
  const publish = (next) => {
    if (next === target) return;
    const previous = target;
    target = next;
    previous?.remove();
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => target,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    mount: () => {
      const Observer = doc.defaultView.MutationObserver;
      const shadowObserver = new Observer(() => update());
      const update = () => {
        const host = doc.documentElement.hasAttribute('data-windows-titlebar') && doc.querySelector('[data-windows-menu]');
        const nextShadow = host?.shadowRoot || null;
        if (nextShadow !== shadow) {
          shadowObserver.disconnect();
          shadow = nextShadow;
          if (shadow) shadowObserver.observe(shadow, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-haspopup'] });
        }
        const bar = shadow?.querySelector('[role="menubar"]');
        // Only adapt the known Desktop structure, never a similarly named Web UI.
        const buttons = bar && [...bar.children];
        const compatible = bar?.parentNode === shadow && buttons?.length === 2 && buttons.every((button) => button.matches('button[role="menuitem"][aria-haspopup="menu"]'));
        if (!compatible) { publish(null); return; }
        if (target?.isConnected && target.previousElementSibling === bar) return;
        const seat = doc.createElement('span');
        seat.dataset.dshGitMenuEntry = '';
        seat.style.cssText = 'display:flex;align-items:center;margin-inline-start:2px;-webkit-app-region:no-drag';
        // A sibling action, not a third native menuitem. The caption's button
        // styles and inherited theme tokens also apply across its own shadow.
        bar.after(seat);
        publish(seat);
      };
      const observer = new Observer(update);
      observer.observe(doc.body, { childList: true });
      observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-windows-titlebar'] });
      update();
      return () => { observer.disconnect(); shadowObserver.disconnect(); shadow = null; publish(null); };
    },
  };
}
