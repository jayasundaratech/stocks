const mainRecords = () => Array.isArray(window.__stockChartRecords) ? window.__stockChartRecords : [];
const oscRecords = () => Array.isArray(window.__oscillatorChartRecords) ? window.__oscillatorChartRecords : [];

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.0001;
}

function sameLogicalRange(a, b) {
  if (!a || !b) return false;
  return nearlyEqual(a.from, b.from) && nearlyEqual(a.to, b.to);
}

function recordsForCard(card) {
  const mainHost = card.querySelector('.chart-host');
  const main = mainRecords().find(record => record.container === mainHost) || null;
  const hosts = [...card.querySelectorAll('.osc-chart-host')];
  const lower = hosts.map(host => oscRecords().find(record => record.container === host)).filter(Boolean);
  return { card, main, lower, all: [main, ...lower].filter(Boolean) };
}

function broadcastLogicalRange(set, source, range) {
  if (!range || set.syncing) return;
  set.syncing = true;
  try {
    for (const record of set.all) {
      if (record === source) continue;
      const scale = record.chart.timeScale();
      const current = scale.getVisibleLogicalRange?.();
      if (!sameLogicalRange(current, range)) {
        scale.setVisibleLogicalRange({ from: range.from, to: range.to });
      }
    }
  } catch (error) {
    console.warn('Oscillator range sync failed', error);
  } finally {
    requestAnimationFrame(() => { set.syncing = false; });
  }
}

function paneIsExpanded(record) {
  const pane = record?.container?.closest?.('.oscillator-pane');
  if (!pane) return false;
  return !pane.classList.contains('is-collapsed');
}

function updateTimeAxisOwner(set) {
  if (!set?.main) return;

  const expandedLower = set.lower.filter(paneIsExpanded);
  const owner = expandedLower.length ? expandedLower[expandedLower.length - 1] : set.main;

  // Do not keep re-applying time-scale options while the user is dragging.
  // Only change visibility when the owner actually changes due to collapse/expand.
  if (set.timeAxisOwner === owner) return;
  set.timeAxisOwner = owner;

  try {
    set.main.chart.timeScale().applyOptions({
      visible: owner === set.main,
      timeVisible: true,
      secondsVisible: false,
    });
  } catch (_) {}

  set.lower.forEach(record => {
    try {
      record.chart.timeScale().applyOptions({
        visible: record === owner,
        timeVisible: true,
        secondsVisible: false,
      });
    } catch (_) {}
  });

  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function enablePanAndZoom(record, isLower = false) {
  if (!record?.chart) return;
  try {
    if (isLower) record.chart.priceScale('right').applyOptions({ minimumWidth: 86 });
    record.chart.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: false },
        axisDoubleClickReset: { time: true, price: false },
      },
    });
  } catch (_) {}
}

function configureChartInteractions(set) {
  if (!set.main) return;

  // Keep drag-to-pan and scroll/zoom enabled on every synchronized pane.
  enablePanAndZoom(set.main, false);
  set.lower.forEach(record => enablePanAndZoom(record, true));

  updateTimeAxisOwner(set);
}

function installCard(card) {
  if (card.__exactOscSyncInstalledV5) return true;
  const set = recordsForCard(card);
  if (!set.main || set.lower.length < 2) return false;

  card.__exactOscSyncInstalledV5 = true;
  set.syncing = false;
  set.timeAxisOwner = null;
  card.__oscSyncSetV5 = set;
  configureChartInteractions(set);

  for (const record of set.all) {
    const scale = record.chart.timeScale();
    scale.subscribeVisibleLogicalRangeChange(range => {
      if (!range || set.syncing) return;
      broadcastLogicalRange(set, record, range);
    });
  }

  // Axis ownership only needs to change when pane collapse state changes.
  const paneObserver = new MutationObserver(mutations => {
    const collapseChanged = mutations.some(mutation => {
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') return false;
      return mutation.target instanceof Element && mutation.target.classList.contains('oscillator-pane');
    });
    if (collapseChanged) requestAnimationFrame(() => updateTimeAxisOwner(set));
  });
  paneObserver.observe(card, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  set.paneObserver = paneObserver;

  const initial = set.main.chart.timeScale().getVisibleLogicalRange?.();
  if (initial) broadcastLogicalRange(set, set.main, initial);

  setTimeout(() => {
    updateTimeAxisOwner(set);
    const range = set.main.chart.timeScale().getVisibleLogicalRange?.();
    if (range) broadcastLogicalRange(set, set.main, range);
  }, 250);
  setTimeout(() => {
    updateTimeAxisOwner(set);
    const range = set.main.chart.timeScale().getVisibleLogicalRange?.();
    if (range) broadcastLogicalRange(set, set.main, range);
  }, 1000);

  return true;
}

function installAll() {
  let ready = true;
  document.querySelectorAll('.chart-card').forEach(card => {
    if (!installCard(card)) ready = false;
  });
  if (!ready) requestAnimationFrame(installAll);
}

installAll();

// Keep ranges synchronized, but do not re-apply time-axis layout options here.
setInterval(() => {
  document.querySelectorAll('.chart-card').forEach(card => {
    const set = card.__oscSyncSetV5;
    if (!set || set.syncing) return;
    const range = set.main.chart.timeScale().getVisibleLogicalRange?.();
    if (range) broadcastLogicalRange(set, set.main, range);
  });
}, 1000);
