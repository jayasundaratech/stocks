const STORAGE_PREFIX = 'stocks-osc-pane-ui-v1';

function storageKey(chartIndex, kind) {
  return `${STORAGE_PREFIX}-${chartIndex}-${kind}`;
}

function readState(chartIndex, kind) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(chartIndex, kind)) || 'null');
    return {
      enabled: saved?.enabled !== false,
      collapsed: saved?.collapsed === true,
    };
  } catch (_) {
    return { enabled: true, collapsed: false };
  }
}

function writeState(chartIndex, kind, state) {
  try {
    localStorage.setItem(storageKey(chartIndex, kind), JSON.stringify(state));
  } catch (_) {}
}

function refreshStack(stack) {
  const panes = [...stack.querySelectorAll('.oscillator-pane.controlled-pane')];
  if (!panes.length) return;

  const collapsedCount = panes.filter(pane => pane.classList.contains('is-collapsed')).length;
  stack.classList.toggle('all-collapsed', collapsedCount === panes.length);
  stack.classList.toggle('one-collapsed', collapsedCount === 1);

  // Lightweight Charts resize observers react to the new pane dimensions, but
  // dispatching resize as well makes the change immediate on layout switches.
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  });
}

function syncButtons(pane, state) {
  const visibility = pane.querySelector('.osc-visibility-button');
  const collapse = pane.querySelector('.osc-collapse-button');
  if (visibility) {
    visibility.textContent = state.enabled ? '👁' : '◌';
    visibility.title = state.enabled ? 'Turn indicator off' : 'Turn indicator on';
    visibility.setAttribute('aria-label', visibility.title);
    visibility.setAttribute('aria-pressed', state.enabled ? 'true' : 'false');
  }
  if (collapse) {
    collapse.textContent = state.collapsed ? '▾' : '▴';
    collapse.title = state.collapsed ? 'Expand pane' : 'Collapse pane';
    collapse.setAttribute('aria-label', collapse.title);
    collapse.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
  }
}

function applyState(pane, stack, chartIndex, kind, state) {
  pane.classList.toggle('is-disabled', !state.enabled);
  pane.classList.toggle('is-collapsed', state.collapsed);
  pane.dataset.indicatorEnabled = state.enabled ? 'true' : 'false';
  pane.dataset.collapsed = state.collapsed ? 'true' : 'false';
  syncButtons(pane, state);
  writeState(chartIndex, kind, state);
  refreshStack(stack);
}

function installPane(card, stack, pane, chartIndex, kind) {
  if (pane.dataset.paneControlsInstalled === 'true') return;
  pane.dataset.paneControlsInstalled = 'true';
  pane.classList.add('controlled-pane');

  const header = pane.querySelector('.oscillator-header');
  if (!header) return;

  const settingsButton = header.querySelector('.osc-settings-button');
  const visibilityButton = document.createElement('button');
  visibilityButton.type = 'button';
  visibilityButton.className = 'osc-pane-control osc-visibility-button';

  const collapseButton = document.createElement('button');
  collapseButton.type = 'button';
  collapseButton.className = 'osc-pane-control osc-collapse-button';

  if (settingsButton) {
    header.insertBefore(visibilityButton, settingsButton);
    header.insertBefore(collapseButton, settingsButton);
  } else {
    header.append(visibilityButton, collapseButton);
  }

  const state = readState(chartIndex, kind);

  visibilityButton.addEventListener('click', event => {
    event.stopPropagation();
    state.enabled = !state.enabled;
    applyState(pane, stack, chartIndex, kind, state);
  });

  collapseButton.addEventListener('click', event => {
    event.stopPropagation();
    state.collapsed = !state.collapsed;
    applyState(pane, stack, chartIndex, kind, state);
  });

  // Double-clicking the header also collapses/expands the pane, similar to
  // TradingView's quick pane interaction.
  header.addEventListener('dblclick', event => {
    if (event.target.closest('button')) return;
    state.collapsed = !state.collapsed;
    applyState(pane, stack, chartIndex, kind, state);
  });

  applyState(pane, stack, chartIndex, kind, state);
}

function installCard(card) {
  const stack = card.querySelector('.oscillators-stack');
  if (!stack) return false;
  stack.classList.add('pane-controls-enabled');

  const chartIndex = Number(card.dataset.chartIndex || 0);
  const stoch = stack.querySelector('.stoch-pane');
  const rsi = stack.querySelector('.rsi-pane');
  if (!stoch || !rsi) return false;

  installPane(card, stack, stoch, chartIndex, 'stoch');
  installPane(card, stack, rsi, chartIndex, 'rsi');
  refreshStack(stack);
  return true;
}

function installAll() {
  let complete = true;
  document.querySelectorAll('.chart-card').forEach(card => {
    if (!installCard(card)) complete = false;
  });
  if (!complete) requestAnimationFrame(installAll);
}

installAll();

// Re-check after layout changes so panes that were hidden while resizing get
// an immediate size refresh when they become visible again.
const grid = document.getElementById('dashboardGrid');
if (grid) {
  new MutationObserver(() => {
    document.querySelectorAll('.chart-card').forEach(card => {
      const stack = card.querySelector('.oscillators-stack');
      if (stack) refreshStack(stack);
    });
  }).observe(grid, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden', 'style'] });
}
