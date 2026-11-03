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

  try {
    set.main.chart.timeScale().applyOptions({
      visible: owner === set.main,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 6,
    });
  } catch (_) {}

  set.lower.forEach(record => {
    try {
      record.chart.timeScale().applyOptions({
        visible: record === owner,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      });
    } catch (_) {}
  });

  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function configureChartInteractions(set) {
  if (!set.main) return;

  set.lower.forEach(record => {
    try {
      record.chart.priceScale('right').applyOptions({ minimumWidth: 86 });
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
  });

  updateTimeAxisOwner(set);
}

function installCard(card) {
  if (card.__exactOscSyncInstalledV4) return true;
  const set = recordsForCard(card);
  if (!set.main || set.lower.length < 2) return false;

  card.__exactOscSyncInstalledV4 = true;
  set.syncing = false;
  card.__oscSyncSetV4 = set;
  configureChartInteractions(set);

  for (const record of set.all) {
    const scale = record.chart.timeScale();
    scale.subscribeVisibleLogicalRangeChange(range => {
      if (!range || set.syncing) return;
      broadcastLogicalRange(set, record, range);
    });
  }

  const paneObserver = new MutationObserver(() => {
    requestAnimationFrame(() => updateTimeAxisOwner(set));
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

setInterval(() => {
  document.querySelectorAll('.chart-card').forEach(card => {
    const set = card.__oscSyncSetV4;
    if (!set || set.syncing) return;
    updateTimeAxisOwner(set);
    const range = set.main.chart.timeScale().getVisibleLogicalRange?.();
    if (range) broadcastLogicalRange(set, set.main, range);
  });
}, 1000);
