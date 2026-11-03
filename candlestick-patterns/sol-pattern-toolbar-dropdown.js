(() => {
  'use strict';

  const SYMBOL = 'SOLUSDT';
  const DETAILS_CLASS = 'sol-pattern-toolbar-dropdown';
  const MENU_CLASS = 'sol-pattern-toolbar-menu';

  function isSolCard(card) {
    const ticker = card?.querySelector('.ticker')?.textContent?.trim().toUpperCase();
    const input = card?.querySelector('.symbol-search')?.value?.trim().toUpperCase();
    return ticker === SYMBOL || input === SYMBOL;
  }

  function ensureDropdown(card) {
    if (!card) return false;

    const toolbar = card.querySelector('.chart-toolbar');
    const panel = card.querySelector('.sol-pattern-monitor');
    if (!toolbar || !panel) return false;

    let details = card.querySelector(`.${DETAILS_CLASS}`);
    let menu;

    if (!details) {
      details = document.createElement('details');
      details.className = DETAILS_CLASS;

      const summary = document.createElement('summary');
      summary.className = 'control-button sol-pattern-toolbar-trigger';
      summary.title = 'Open SOLUSDT 38 Pattern Scanner';
      summary.setAttribute('aria-label', 'Open SOLUSDT 38 Pattern Scanner');
      summary.innerHTML = '<span class="sol-pattern-toolbar-icon">▦</span><span>Patterns</span><span class="sol-pattern-toolbar-caret">▾</span>';

      menu = document.createElement('div');
      menu.className = MENU_CLASS;

      details.append(summary, menu);
      toolbar.appendChild(details);

      details.addEventListener('click', event => event.stopPropagation());
    } else {
      menu = details.querySelector(`.${MENU_CLASS}`);
    }

    if (!menu) return false;
    if (panel.parentElement !== menu) menu.appendChild(panel);

    const visible = isSolCard(card);
    details.hidden = !visible;
    if (!visible) details.removeAttribute('open');

    return true;
  }

  function installAll() {
    let complete = true;
    document.querySelectorAll('.chart-card').forEach(card => {
      if (!ensureDropdown(card)) complete = false;
    });
    return complete;
  }

  function boot() {
    installAll();

    const observer = new MutationObserver(() => {
      requestAnimationFrame(installAll);
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'value'],
    });

    document.addEventListener('click', event => {
      document.querySelectorAll(`.${DETAILS_CLASS}[open]`).forEach(details => {
        if (!details.contains(event.target)) details.removeAttribute('open');
      });
    });

    globalThis.__solPatternToolbarDropdown = {
      installAll,
      refresh: installAll,
      observer,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
